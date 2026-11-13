import * as THREE from 'three';
import { CREATURES } from './creatures/index.js';
import {
  phaseAt,
  ENTER_MS,
  REACT_MS,
  REST_HOP_MS,
  WOBBLE_MS,
  SPLAT_MS,
  REFORM_MS,
} from './timeline.js';
import { createSplat } from './splat.js';
import { summarize, merge, reactionSound } from './reaction.js';
import { discTexture, starTexture } from './textures.js';
import {
  edgeSpot,
  restSpot,
  offPoint,
  fitArea,
  obstacle,
  SLIDE,
  PET_HEIGHT,
  KIND_FOOTPRINT,
} from './resting.js';

/** At most this many pets on screen at once. */
export const MAX_PETS = 3;
/**
 * A die hits a pet at this speed (scene units per second; the physics' relative speed) or more and
 * it splats; between WOBBLE_SPEED and it, the pet only wobbles; below WOBBLE_SPEED, nothing.
 * Measured on the real sim (see the task 4 report): a d6 arriving from a throw at full pace hits at
 * 14 (10th percentile) to 27, median 22; a die tumbling into a pet as it comes to rest at about
 * 2 to 4, rarely above 10.
 */
export const SPLAT_SPEED = 10;
export const WOBBLE_SPEED = 1.5;
const PUDDLE_MS = 600; // the eyes open and blink once, then the puddle holds
const WOBBLE_PUSH = 0.3; // of the height, the recoil away from the die
// The states of a pet knocked flat: bursting, lying there, pulling back together, fading away.
const NO_LOOK = { yaw: 0 }; // shared: poses only read it
const WOBBLE_LOOK = { yaw: 0, leanX: 0, leanZ: 0 }; // reused: the push in the pet's own space
const DOWN = new Set(['splat', 'puddle', 'reform', 'fade']);
const HOP = 0.45; // of the height
const LOOK_MAX = 0.6;
const MOVED = 1e-3; // a re-used pet farther than this from its new spot hops there
// Foundry's UI that the dice canvas draws over (v14 puts it at z-index 30, the canvas at 60).
const UI_IDS = ['ui-left', 'players', 'hotbar', 'navigation', 'ui-top'];
const AREAS_HOOK = 'dicerRollAreasChanged';

// The crit's sparkle burst: a few additive star points thrown out around the pet.
const SPARKS = 12;
const BURST_MS = 900; // from the start of the crit reaction
const SPARK_SIZE = 1.7; // PointsMaterial size: about 0.3 die units under Dicer's FOV-20 camera
const GOLD = [1, 0.78, 0.3];
const WHITE = [1, 0.96, 0.86];
// Fixed per spark (every burst alike, nothing random per frame): direction, reach, rise, twinkle phase.
const SPARK = Array.from({ length: SPARKS }, (_, i) => {
  const j = Math.sin((i + 1) * 12.9898) * 43758.5453;
  const r = j - Math.floor(j);
  return {
    a: (i / SPARKS) * Math.PI * 2 + r * 0.5,
    reach: 0.7 + 0.5 * r,
    rise: 0.25 + 0.6 * ((r * 7) % 1),
    ph: r * Math.PI * 2,
    c: i % 3 === 0 ? WHITE : GOLD,
  };
});

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);

/**
 * The pet layer (lazy chunk): one pet per roller, driven by DiceBox's PetHook. A pet's whole life
 * is a timeline (timeline.js); update() poses and places it each frame and removes it when gone.
 * A pet re-used by overlapping rolls keeps each roll's ghost flag and landed summary by key: it
 * reacts once every live roll has landed, to their merged summaries (reaction.js).
 */
export function createPetLayer(deps) {
  const { scene, getSetting, playSound, warm } = deps;
  const clock = deps.now || (() => performance.now()); // test seam; DiceBox's update() is on this clock
  const rand = deps.random || Math.random; // test seam: the rest spots
  const doc = deps.doc || globalThis.document; // test seam: Foundry's UI, which rest spots avoid
  const hooks = deps.hooks || globalThis.Hooks; // test seam: Foundry's hooks (area edits)
  // The last stage DiceBox told us ({cx, cz, halfWidth, halfDepth, rect?}: rect is its px rect): a
  // rest area is always fitted inside it.
  let stage = null;
  const pets = new Map(); // userId -> pet
  const keyOwner = new Map(); // roll key -> userId
  let shadowTex = null;
  let shadowGeo = null;
  let sparkTex = null;
  let sparkMat = null;
  let disposed = false;

  const makeShadow = () => {
    shadowTex ??= discTexture();
    shadowGeo ??= new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
    const shadow = new THREE.Mesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    shadow.name = 'petShadow';
    shadow.position.y = 0.01;
    return shadow;
  };

  /** The burst's points: one shared material, a small geometry per pet rewritten in place. */
  const makeSparkle = () => {
    sparkTex ??= starTexture();
    sparkMat ??= new THREE.PointsMaterial({
      size: SPARK_SIZE,
      map: sparkTex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const geo = new THREE.BufferGeometry();
    for (const name of ['position', 'color'])
      geo.setAttribute(
        name,
        new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3).setUsage(THREE.DynamicDrawUsage),
      );
    const pts = new THREE.Points(geo, sparkMat);
    pts.name = 'petSparkle';
    pts.visible = false;
    pts.frustumCulled = false; // its bounds change every frame
    return pts;
  };

  /** Writes the burst at s (0..1) in the pet's own space, anchored to the ground while it jumps. */
  function burst(pts, s, h, hop) {
    const pos = pts.geometry.attributes.position;
    const col = pts.geometry.attributes.color;
    const P = pos.array;
    const C = col.array;
    const grow = 1 - (1 - s) ** 3;
    const fade = 1 - s * s;
    for (let i = 0; i < SPARKS; i++) {
      const sp = SPARK[i];
      const k = i * 3;
      const r = sp.reach * h * grow;
      P[k] = Math.sin(sp.a) * r;
      P[k + 1] = h * (0.55 + sp.rise * grow) - 0.5 * h * s * s;
      P[k + 2] = Math.cos(sp.a) * r;
      const b = Math.min(1, fade * (0.6 + 0.4 * Math.sin(s * 22 + sp.ph))); // twinkle, clamped
      C[k] = sp.c[0] * b;
      C[k + 1] = sp.c[1] * b;
      C[k + 2] = sp.c[2] * b;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    pts.position.y = -hop;
  }

  function removePet(pet) {
    pets.delete(pet.userId);
    for (const k of pet.rolls.keys()) keyOwner.delete(k);
    pet.rolls.clear();
    scene.remove(pet.group);
    try {
      pet.creature.dispose();
    } catch {
      /* already torn down */
    }
    pet.shadow.material.dispose();
    pet.sparkle.geometry.dispose();
    dropSplat(pet);
  }

  /** The pet's splat (made when it first needs one), in the pet's own colour. */
  function ensureSplat(pet) {
    if (!pet.splat) {
      pet.splat = createSplat(pet.kind, pet.color);
      pet.group.add(pet.splat.root);
    }
    return pet.splat;
  }
  function dropSplat(pet) {
    if (!pet.splat) return;
    pet.group.remove(pet.splat.root);
    pet.splat.dispose();
    pet.splat = null;
  }

  /** Puts a new creature in the pet (the first, or a new kind or colour); the old one is freed. */
  function setCreature(pet, creature, spec) {
    if (pet.creature) {
      pet.group.remove(pet.creature.root);
      try {
        pet.creature.dispose();
      } catch {
        /* already torn down */
      }
    }
    pet.creature = creature;
    pet.kind = spec.kind;
    pet.color = spec.color;
    pet.group.add(creature.root);
    pet.group.children.unshift(pet.group.children.pop()); // the creature stays the first child
    pet.shadow.scale.setScalar(creature.height * 0.7);
    if (pet.splat) {
      dropSplat(pet); // a new kind or colour: the puddle is made again in it
      ensureSplat(pet);
    }
  }

  function place(pet, edge, area) {
    const { out, base, inward } = edgeSpot(edge, area, pet.creature.height);
    pet.out = out;
    pet.base = base;
    pet.inward = inward;
  }

  const wake = () => {
    try {
      deps.wake?.();
    } catch {
      /* a stopped engine */
    }
  };
  /** Whether resting is on: petsStay, and pets allowed and shown at all. */
  const stays = () => {
    try {
      return (
        getSetting('petsStay') !== false &&
        getSetting('petsAllowed') !== false &&
        getSetting('showPets') !== false
      );
    } catch {
      return true;
    }
  };
  const pos = (pet) => ({ x: pet.px ?? pet.base.x, z: pet.pz ?? pet.base.z, y: pet.hop ?? 0 });
  /** Where a pet stands (or will, at the end of its hop): what the others keep their distance from. */
  const spotOf = (pet) => pet.spot ?? pet.base;
  const standing = (pet) => pet.state !== 'off' && pet.state !== 'fade';
  /** Whether dice bump into it: a standing pet that is not a splat or a puddle. */
  const solid = (pet) => standing(pet) && pet.state !== 'splat' && pet.state !== 'puddle';

  /** Starts a hop of the pet from where it is to `to` (a rest spot, or off the table). */
  function hopTo(pet, to, state, now) {
    const from = pos(pet);
    pet.hopFrom = from;
    pet.hopTo = to;
    pet.hopAt = now;
    pet.state = state;
    if (state === 'hop') {
      pet.spot = to;
      pet.yaw0 = pet.yaw;
      pet.yawTo = Math.atan2(pet.area.cx - to.x, pet.area.cz - to.z); // faces the middle of the table
    }
    wake();
  }
  /**
   * Foundry's UI on the stage (I-4: the dice canvas draws over it), in die units from the stage
   * centre: measured now, so a players list opened since counts. Missing or hidden parts are left out.
   */
  function uiRects() {
    const r = stage?.rect;
    const out = [];
    if (!r || !(stage.halfWidth > 0) || !(r.width > 0)) return out;
    const px = r.width / 2 / stage.halfWidth;
    const ox = r.left + r.width / 2;
    const oz = r.top + r.height / 2;
    for (const id of UI_IDS) {
      try {
        const b = doc?.getElementById?.(id)?.getBoundingClientRect?.();
        if (!(b?.width > 0 && b.height > 0)) continue;
        out.push({
          x0: (b.left - ox) / px,
          x1: (b.left + b.width - ox) / px,
          z0: (b.top - oz) / px,
          z1: (b.top + b.height - oz) / px,
        });
      } catch {
        /* unreadable: ignored */
      }
    }
    return out;
  }
  /** A free rest spot for `pet` in its area: spaced from the other pets, off Foundry's UI. */
  function freeSpot(pet) {
    const taken = [];
    for (const o of pets.values()) if (o !== pet && standing(o)) taken.push(spotOf(o));
    return restSpot(pet.area, pet.creature.height, taken, rand, uiRects());
  }
  const restOf = (pet, now) => {
    if (pet.state === 'routine') pet.idleAt = now; // idle since its routine ended
    if (stage) pet.area = fitArea(pet.area, stage);
    hopTo(pet, freeSpot(pet), 'hop', now);
  };
  const sendOff = (pet, now) => {
    if (pet.state === 'off' || pet.state === 'fade') return;
    if (pet.state === 'puddle') {
      pet.state = 'fade'; // a puddle does not hop: it fades
      pet.fadeAt = now;
      wake();
      return;
    }
    hopTo(pet, offPoint(pet.area, pos(pet), pet.creature.height), 'off', now);
  };

  /**
   * Whether a pet of `userId` may stand: it has a place already, or there is a free place, or a
   * resting pet (never one mid-routine) can give its place up; the one idle longest goes (victim).
   */
  function slotFor(userId) {
    const mine = pets.get(userId);
    let count = 0;
    let victim = null;
    for (const p of pets.values()) {
      if (p === mine || !standing(p)) continue;
      count++;
      if (
        (p.state === 'hop' || p.state === 'rest' || p.state === 'puddle') &&
        (!victim || p.idleAt < victim.idleAt)
      )
        victim = p;
    }
    return count < MAX_PETS ? { ok: true } : { ok: !!victim, victim };
  }

  function begin(key, { spec, edge, area, centre }) {
    if (disposed) return;
    const make = CREATURES[spec.kind];
    let pet = pets.get(spec.userId);
    const fresh = !pet;
    if (!make && fresh) return;
    const down = !fresh && DOWN.has(pet.state); // a splat or puddle: reforms before the routine
    if (fresh || pet.state === 'off' || pet.state === 'fade') {
      const slot = slotFor(spec.userId);
      if (!slot.ok) return;
      if (slot.victim) sendOff(slot.victim, clock());
    }
    if (fresh) {
      const creature = make(spec.color);
      const group = new THREE.Group();
      group.userData.dicerPet = { phase: 'enter' };
      const shadow = makeShadow();
      const sparkle = makeSparkle();
      group.add(shadow, sparkle);
      pet = {
        userId: spec.userId,
        group,
        shadow,
        sparkle,
        creature: null,
        rolls: new Map(),
        state: 'routine',
      };
      setCreature(pet, creature, spec);
      scene.add(group);
      pets.set(spec.userId, pet);
    } else if (make && (pet.kind !== spec.kind || pet.color !== spec.color)) {
      setCreature(pet, make(spec.color), spec); // the editor's Throw shows the new pick at once
    }
    const now = clock();
    if (down) {
      pet.group.scale.setScalar(1);
      pet.wobble = null;
      if (pet.state === 'splat')
        pet.reformNext = true; // the burst finishes, then it reforms
      else if (pet.state !== 'reform') {
        pet.state = 'reform';
        pet.reformAt = now;
      }
    } else pet.state = 'routine'; // a resting or leaving pet starts its routine from where it stands
    pet.gone = false;
    pet.spot = null;
    pet.area = { ...area }; // the owner's resting area: that of their most recent roll
    pet.rolls.set(key, { ghost: !!spec.ghost, summary: null, consumed: false });
    keyOwner.set(key, spec.userId);
    // The newest roll (pet.current) owns the throw, the place and the leave; each roll keeps its
    // own ghost flag and summary for the merged reaction.
    pet.current = key;
    pet.centre = centre;
    const was = fresh ? null : { x: pet.px, z: pet.pz, y: pet.hop };
    place(pet, edge, area);
    pet.yaw = pet.inward;
    pet.reaction = 'plain';
    pet.soundDone = false;
    pet.exitFrom = null;
    pet.lastNow = now;
    // A re-used pet standing at its new spot restarts from the throw, with no re-enter; one that
    // is elsewhere (mid-exit, another edge or area) hops there from where it is.
    const moved =
      !!was && (Math.hypot(was.x - pet.base.x, was.z - pet.base.z) > MOVED || was.y > MOVED);
    pet.from = moved ? was : null;
    pet.track = { beganAt: fresh || moved ? now : now - ENTER_MS };
  }

  const petOf = (key) => {
    const u = keyOwner.get(key);
    return u === undefined ? null : pets.get(u) || null;
  };

  /**
   * Starts the reaction once every live, not yet reacted-to roll of the pet has landed, to their
   * merged summaries; those rolls are then consumed, so a roll is reacted to once (a later roll
   * of the same roller never re-cheers an earlier 20). A consumed roll keeps the pet until its end.
   */
  function settle(pet) {
    if (pet.track.landedAt != null) return;
    const summaries = [];
    for (const r of pet.rolls.values()) {
      if (r.consumed) continue;
      if (!r.summary) return;
      summaries.push(r.summary);
    }
    for (const r of pet.rolls.values()) r.consumed = true;
    pet.reaction = merge(summaries);
    pet.soundDone = false;
    pet.track.landedAt = clock();
  }

  function landed(key, dice) {
    const pet = petOf(key);
    const roll = pet?.rolls.get(key);
    if (!roll || roll.summary) return;
    roll.summary = summarize(dice, roll.ghost); // a ghost roll only ever says 'plain'
    settle(pet);
  }

  function leave(key, msLeft) {
    const pet = petOf(key);
    if (!pet || pet.current !== key) return;
    pet.track.leaveAt = clock();
    pet.track.leaveMs = msLeft;
  }

  function end(key) {
    const pet = petOf(key);
    keyOwner.delete(key);
    if (!pet) return;
    pet.rolls.delete(key);
    if (pet.rolls.size) return settle(pet); // the rolls still on screen may all have landed now
    if (pet.state !== 'routine') return; // resting or leaving: the pet outlives its roll
    if (stays() && !pet.gone) restOf(pet, clock());
    else removePet(pet);
  }

  /** Poses and places the pet for this frame: the shared end of every state's step. */
  function show(pet, now, phase, t, px, pz, hop, shadows) {
    const h = pet.creature.height;
    pet.px = px;
    pet.pz = pz;
    pet.hop = hop;
    const dt = Math.max(0, now - (pet.lastNow ?? now));
    pet.lastNow = now;
    let look = 0;
    if (phase === 'watch' || phase === 'react') {
      const c = pet.centre();
      const toDice = Math.atan2(c.x - px, c.z - pz);
      pet.yaw = wrap(pet.yaw + wrap(toDice - pet.yaw) * (1 - Math.exp(-dt / 90)));
      look = Math.max(-LOOK_MAX, Math.min(LOOK_MAX, wrap(toDice - pet.yaw)));
    }
    // A wobble: a squash on the creature and a push away from the die, out and back.
    let wt = -1;
    let push = 0;
    if (pet.wobble) {
      const e = (now - pet.wobble.at) / WOBBLE_MS;
      if (e < 1) {
        wt = clamp01(e);
        push = WOBBLE_PUSH * h * Math.sin(wt * Math.PI);
      } else pet.wobble = null; // over: nothing carries into the next frame or roll
    }
    pet.group.position.set(
      px + (wt >= 0 ? pet.wobble.dx * push : 0),
      hop,
      pz + (wt >= 0 ? pet.wobble.dz * push : 0),
    );
    pet.group.rotation.y = pet.yaw;
    pet.group.userData.dicerPet.phase = phase;
    pet.shadow.position.y = 0.01 - hop;
    pet.shadow.visible = shadows;
    if (wt >= 0) {
      // the push direction turned into the creature's space (the group is turned by pet.yaw)
      const cy = Math.cos(pet.yaw);
      const sy = Math.sin(pet.yaw);
      WOBBLE_LOOK.leanX = pet.wobble.dx * cy - pet.wobble.dz * sy;
      WOBBLE_LOOK.leanZ = pet.wobble.dx * sy + pet.wobble.dz * cy;
      pet.creature.pose('wobble', wt, pet.reaction, WOBBLE_LOOK);
    } else pet.creature.pose(phase, t, pet.reaction, { yaw: look });
    // A ghost roll is never 'crit', so it never bursts.
    const s = phase === 'react' && pet.reaction === 'crit' ? (t * REACT_MS) / BURST_MS : 1;
    pet.sparkle.visible = s < 1;
    if (s < 1) burst(pet.sparkle, s, h, hop);
    if (phase === 'react' && !pet.soundDone) {
      pet.soundDone = true;
      const name = reactionSound(pet.reaction);
      if (name && getSetting('petSounds') !== false && getSetting('sounds') !== false)
        playSound({ builtin: name });
    }
  }

  /** A hop to a rest spot or off the table, on the exit pose. Returns false once a leaver is gone. */
  function stepHop(pet, now, shadows) {
    const e = Math.min(1, Math.max(0, (now - pet.hopAt) / REST_HOP_MS));
    const { hopFrom: from, hopTo: to } = pet;
    const s = smooth(e);
    if (pet.state === 'off' && e >= 1) return false;
    if (pet.state === 'hop') pet.yaw = wrap(pet.yaw0 + wrap(pet.yawTo - pet.yaw0) * s);
    const px = from.x + (to.x - from.x) * s;
    const pz = from.z + (to.z - from.z) * s;
    const hop = e >= 1 ? 0 : from.y * (1 - s) + Math.sin(s * Math.PI) * HOP * pet.creature.height;
    show(pet, now, 'exit', e, px, pz, hop, shadows);
    if (e >= 1) pet.state = 'rest'; // the last frame is posed: from here nothing redraws
    return true;
  }

  /** A puddle (or a splat that is becoming one) snaps to the spot the stage change gave it. */
  function moveDown(pet) {
    const to = pet.moveTo;
    pet.moveTo = null;
    pet.px = to.x;
    pet.pz = to.z;
    pet.spot = to;
  }

  /**
   * A splat bursting, a puddle, a puddle reforming or fading, for this frame. The creature is
   * hidden while it is down; the splat is the visual. Returns like step().
   */
  function stepDown(pet, now, shadows, stay) {
    const g = pet.group;
    const sp = ensureSplat(pet);
    g.userData.dicerPet.phase = pet.state;
    g.position.set(pet.px ?? pet.base.x, 0, pet.pz ?? pet.base.z);
    g.rotation.y = pet.yaw;
    pet.hop = 0;
    pet.sparkle.visible = false;
    if (pet.state === 'splat') {
      pet.creature.root.visible = false;
      pet.shadow.visible = false;
      const e = clamp01((now - pet.splatAt) / SPLAT_MS);
      sp.pose('burst', e);
      if (e >= 1) {
        pet.puddleAt = now;
        pet.puddleDone = false;
        if (pet.moveTo) moveDown(pet);
        pet.state = pet.reformNext ? 'reform' : 'puddle';
        pet.reformAt = now;
        pet.reformNext = false;
      }
      return true;
    }
    if (pet.state === 'puddle') {
      if (!stay || pet.gone) {
        pet.state = 'fade';
        pet.fadeAt = now;
        return true;
      }
      if (pet.puddleDone) return 'rest'; // it lies there: nothing redraws
      const e = clamp01((now - pet.puddleAt) / PUDDLE_MS);
      sp.pose('puddle', e);
      if (e >= 1) pet.puddleDone = true;
      return e < 1 ? true : 'rest';
    }
    if (pet.state === 'reform') {
      const e = clamp01((now - pet.reformAt) / REFORM_MS);
      pet.creature.root.visible = true;
      pet.shadow.visible = shadows && e > 0.5;
      sp.pose('reform', e);
      pet.creature.pose('reform', e, 'plain', NO_LOOK);
      if (e >= 1) {
        dropSplat(pet);
        pet.shadow.visible = shadows;
        pet.state = 'routine';
        pet.lastNow = now;
        pet.track.beganAt = pet.from ? now : now - ENTER_MS; // hops to its edge spot from the puddle
      }
      return true;
    }
    // fade: it shrinks away, and the pet is gone
    const e = clamp01((now - pet.fadeAt) / REST_HOP_MS);
    if (e >= 1) return false;
    pet.shadow.visible = false;
    g.scale.setScalar(Math.max(1e-3, 1 - smooth(e)));
    return true;
  }

  /** One pet, one frame: true if it moved, 'rest' if it sits still, false once it is gone. */
  function step(pet, now, shadows, stay) {
    if (DOWN.has(pet.state)) return stepDown(pet, now, shadows, stay);
    if (pet.state === 'rest') {
      if (stay && pet.wobble) {
        show(pet, now, 'exit', 1, pet.px, pet.pz, 0, shadows); // the wobble, or the plain pose once it is over (show clears it)
        return pet.wobble ? true : 'rest';
      }
      if (stay) {
        const was = pet.shadow.visible;
        pet.shadow.visible = shadows; // the only thing that can change while it sits
        return was !== shadows || 'rest'; // a frame to draw it; otherwise nothing moves
      }
      sendOff(pet, now);
    }
    if (pet.state === 'hop' && !stay) sendOff(pet, now);
    if (pet.state !== 'routine') return stepHop(pet, now, shadows);
    const { phase, t } = phaseAt(pet.track, now);
    if ((phase === 'exit' || phase === 'gone') && stay && !pet.gone) {
      restOf(pet, now); // the exit becomes a hop to a resting spot
      return stepHop(pet, now, shadows);
    }
    if (phase === 'gone') return false;
    const h = pet.creature.height;
    const { base, out } = pet;
    let px = base.x;
    let pz = base.z;
    let hop = 0;
    if (phase === 'enter') {
      const e = smooth(t);
      const from = pet.from;
      if (from) {
        // a re-used pet hops from where it was to its new spot
        px = from.x + (base.x - from.x) * e;
        pz = from.z + (base.z - from.z) * e;
        hop = from.y * (1 - e) + Math.sin(e * Math.PI) * HOP * h;
      } else {
        const slide = (1 - e) * SLIDE * h;
        px += out[0] * slide;
        pz += out[1] * slide;
        hop = Math.sin(e * Math.PI) * HOP * h;
      }
    } else if (phase === 'exit') {
      // Leave from wherever the pet is now (a leave can land mid-hop), not from its base.
      const from = (pet.exitFrom ??= { x: pet.px ?? base.x, z: pet.pz ?? base.z, y: pet.hop ?? 0 });
      const e = smooth(t);
      px = from.x + (base.x + out[0] * SLIDE * h - from.x) * e;
      pz = from.z + (base.z + out[1] * SLIDE * h - from.z) * e;
      hop = from.y * (1 - e) + Math.sin(e * Math.PI) * HOP * h;
    }
    show(pet, now, phase, t, px, pz, hop, shadows);
    return true;
  }

  /**
   * One frame. true while anything moves; 'rest' when pets stand but nothing moves (DiceBox holds
   * the last frame with no rAF; wake() restarts it); false with no pets. A resting pet is not
   * posed again, so it costs nothing until its owner rolls, or a setting, a user or the area
   * changes (each of those wakes the loop).
   */
  function update(now) {
    if (!pets.size) return false;
    let shadows = true;
    try {
      shadows = getSetting('shadows') !== false; // once per frame, not per pet
    } catch {
      /* unreadable: keep the default */
    }
    const stay = stays();
    let moving = false;
    for (const pet of [...pets.values()]) {
      let alive = false;
      try {
        alive = step(pet, now, shadows, stay);
      } catch (err) {
        console.warn('Dicer | pet', err);
      }
      if (alive === false) removePet(pet);
      else if (alive === true) moving = true;
    }
    return moving ? true : pets.size > 0 ? 'rest' : false;
  }

  /**
   * The pets the physics should treat as fixed, for a throw about to start (PetHook.obstaclesFor):
   * every standing pet, a resting one at its spot and a rolling one at its edge spot, and, for
   * `spec`'s own user, the edge spot its pet is about to take, from the same placement as begin
   * (which replaces that pet's own entry). A pet leaving, or about to be replaced, stands no more.
   */
  function obstaclesFor({ spec, edge, area, stage: now }) {
    if (now) stage = now; // the layer may have loaded after DiceBox's last areaChanged
    const own = spec ? slotFor(spec.userId) : null;
    const list = [];
    if (own?.ok) {
      const h = pets.get(spec.userId)?.creature.height ?? PET_HEIGHT;
      list.push(obstacle(edgeSpot(edge, area, h).base, h, spec.userId, KIND_FOOTPRINT[spec.kind]));
    }
    for (const p of pets.values())
      if (solid(p) && p !== own?.victim && !(own?.ok && p.userId === spec.userId))
        list.push(obstacle(spotOf(p), p.creature.height, p.userId, p.creature.footprint));
    return list;
  }

  /** The user left: their resting pet hops off; one mid-routine leaves when its roll ends. */
  function userGone(userId) {
    const pet = pets.get(userId);
    if (!pet) return;
    pet.gone = true;
    if (pet.state === 'hop' || pet.state === 'rest' || pet.state === 'puddle')
      sendOff(pet, clock());
  }

  /** Whether petSplat is on. */
  const splatOn = () => {
    try {
      return getSetting('petSplat') !== false;
    } catch {
      return true;
    }
  };

  /** A die hit the standing pet hard: its routine ends (no reaction), and it bursts into a puddle. */
  function splat(pet, now) {
    for (const k of pet.rolls.keys()) keyOwner.delete(k); // the roll's landed, leave and end now find no pet
    pet.rolls.clear();
    pet.current = null;
    pet.spot = { x: pet.px ?? pet.base.x, z: pet.pz ?? pet.base.z }; // the puddle lies where it was hit
    pet.wobble = null;
    pet.reformNext = false;
    pet.state = 'splat';
    pet.splatAt = now;
    pet.idleAt = now;
    ensureSplat(pet).root.visible = true;
    if (getSetting('petSounds') !== false && getSetting('sounds') !== false)
      playSound({ builtin: 'petSplat' });
    wake();
  }

  /**
   * DiceBox's PetHook.hit(id, { speed, position, dieKey }), at playback time: a die touches the pet
   * of user `id`. At SPLAT_SPEED or more (and petSplat on) it splats; from WOBBLE_SPEED it wobbles,
   * pushed away from `position` (a new hit restarts it); less does nothing. A splat, puddle or
   * pet already down is not hit again, so several hits in one frame give one splat and one sound.
   */
  function hit(id, info) {
    if (disposed) return;
    const pet = pets.get(id);
    if (!pet || !['routine', 'hop', 'rest'].includes(pet.state)) return;
    const speed = info?.speed;
    if (!(speed >= WOBBLE_SPEED)) return; // also NaN
    const now = clock();
    if (speed >= SPLAT_SPEED && splatOn()) return splat(pet, now);
    let dx = (pet.px ?? pet.base.x) - (info.position?.x ?? 0);
    let dz = (pet.pz ?? pet.base.z) - (info.position?.z ?? 0);
    const len = Math.hypot(dx, dz);
    if (len > 1e-6 && Number.isFinite(len)) ((dx /= len), (dz /= len));
    else ((dx = 1), (dz = 0));
    pet.wobble = { at: now, dx, dz };
    wake();
  }

  /**
   * The stage changed size. Each resting pet hops to a fresh valid spot inside its owner's area:
   * the area of that owner's most recent roll (kept on the pet at begin), shrunk and shifted to fit
   * the new stage. Rolling pets keep their edge spot: their roll has its own area.
   */
  function areaChanged(next) {
    const same =
      stage &&
      ['cx', 'cz', 'halfWidth', 'halfDepth'].every((k) => (stage[k] ?? 0) === (next[k] ?? 0));
    stage = next;
    if (same) return; // a resize event with the same size: nobody hops for no visible reason
    const now = clock();
    for (const pet of pets.values()) replace(pet, now);
  }

  /**
   * A resting pet hops to a fresh spot in its (re-fitted) area; a puddle snaps to one, and a splat
   * gets one when it becomes a puddle. Its old spot keeps nobody away. Others are left alone.
   */
  function replace(pet, now) {
    if (pet.state === 'splat' || pet.state === 'puddle') {
      if (stage) pet.area = fitArea(pet.area, stage);
      pet.spot = null;
      pet.moveTo = freeSpot(pet);
      if (pet.state === 'puddle') {
        moveDown(pet);
        pet.puddleDone = false; // drawn again, once, at the new spot
        pet.puddleAt = now - PUDDLE_MS;
        wake();
      } else pet.spot = { x: pet.px ?? pet.base.x, z: pet.pz ?? pet.base.z };
    } else if (pet.state === 'hop' || pet.state === 'rest') {
      pet.spot = null;
      restOf(pet, now);
    }
  }

  /**
   * The GM edited the roll areas (main's dicerRollAreasChanged): a resting pet or puddle whose
   * owner's area is now another moves into it. `deps.areaOf(userId)` is that user's area in die
   * units, from the resolver DiceBox throws with; a user whose area did not change keeps their spot.
   */
  function onAreas() {
    if (disposed) return;
    const now = clock();
    for (const pet of pets.values()) {
      let a = null;
      try {
        a = deps.areaOf?.(pet.userId);
      } catch {
        /* no area: the pet stays */
      }
      if (!a || ['cx', 'cz', 'halfWidth', 'halfDepth'].every((k) => a[k] === pet.area?.[k])) continue;
      // A pet mid-routine rests in the new area once its roll is over.
      pet.area = { cx: a.cx, cz: a.cz, halfWidth: a.halfWidth, halfDepth: a.halfDepth };
      replace(pet, now);
    }
  }
  const areasHook = hooks?.on?.(AREAS_HOOK, onAreas);

  // One of each creature, plus a shadow and a sparkle, compiled up front so the first pet costs no
  // programs mid-roll. They stay alive (never in the scene) until dispose(): freeing their
  // materials would release, and so delete, the programs just compiled.
  const samples = [];
  let sampleShadow = null;
  let sampleSparkle = null;
  if (warm) {
    try {
      const objs = [];
      for (const make of Object.values(CREATURES)) {
        const c = make('#ffffff');
        samples.push(c);
        c.root.traverse((o) => {
          if (o.isMesh || o.isPoints) objs.push(o);
        });
      }
      for (const kind of Object.keys(CREATURES)) {
        const sp = createSplat(kind, '#ffffff'); // a splat has the same dispose()
        samples.push(sp);
        sp.root.traverse((o) => {
          if (o.isMesh) objs.push(o);
        });
      }
      sampleShadow = makeShadow();
      sampleSparkle = makeSparkle();
      objs.push(sampleShadow, sampleSparkle);
      Promise.resolve(warm(objs)).catch(() => {}); // a context loss or timeout: compiled on use
    } catch (err) {
      console.warn('Dicer | pet', err);
    }
  }

  function dispose() {
    disposed = true;
    try {
      hooks?.off?.(AREAS_HOOK, areasHook);
    } catch {
      /* Foundry is gone */
    }
    for (const pet of [...pets.values()]) removePet(pet);
    for (const c of samples) {
      try {
        c.dispose();
      } catch {
        /* already torn down */
      }
    }
    samples.length = 0;
    sampleShadow?.material.dispose();
    sampleSparkle?.geometry.dispose();
    sampleShadow = sampleSparkle = null;
    shadowTex?.dispose();
    shadowGeo?.dispose();
    sparkTex?.dispose();
    sparkMat?.dispose();
    shadowTex = shadowGeo = sparkTex = sparkMat = null;
  }

  return {
    begin,
    landed,
    leave,
    end,
    update,
    obstaclesFor,
    userGone,
    areaChanged,
    hit,
    dispose,
    /** The contact speed at which the physics splats a pet (THROW splatSpeed); null: petSplat off. */
    get splatSpeed() {
      return splatOn() ? SPLAT_SPEED : null;
    },
  };
}

import * as THREE from 'three';
import { CREATURES } from './creatures/index.js';
import { phaseAt, ENTER_MS, REACT_MS, REST_HOP_MS } from './timeline.js';
import { summarize, merge, reactionSound } from './reaction.js';
import { discTexture, starTexture } from './textures.js';
import { edgeSpot, restSpot, offPoint, fitArea, obstacle, SLIDE, PET_HEIGHT } from './resting.js';

/** At most this many pets on screen at once. */
export const MAX_PETS = 3;
const HOP = 0.45; // of the height
const LOOK_MAX = 0.6;
const MOVED = 1e-3; // a re-used pet farther than this from its new spot hops there

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
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.4, depthWrite: false }),
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
      return getSetting('petsStay') !== false && getSetting('petsAllowed') !== false && getSetting('showPets') !== false;
    } catch {
      return true;
    }
  };
  const pos = (pet) => ({ x: pet.px ?? pet.base.x, z: pet.pz ?? pet.base.z, y: pet.hop ?? 0 });
  /** Where a pet stands (or will, at the end of its hop): what the others keep their distance from. */
  const spotOf = (pet) => pet.spot ?? pet.base;
  const standing = (pet) => pet.state !== 'off';

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
  const restOf = (pet, now) => {
    if (pet.state === 'routine') pet.idleAt = now; // idle since its routine ended
    const taken = [];
    for (const o of pets.values()) if (o !== pet && standing(o)) taken.push(spotOf(o));
    hopTo(pet, restSpot(pet.area, pet.creature.height, taken, rand), 'hop', now);
  };
  const sendOff = (pet, now) => {
    if (pet.state === 'off') return;
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
      if ((p.state === 'hop' || p.state === 'rest') && (!victim || p.idleAt < victim.idleAt)) victim = p;
    }
    return count < MAX_PETS ? { ok: true } : { ok: !!victim, victim };
  }

  function begin(key, { spec, edge, area, centre }) {
    if (disposed) return;
    const make = CREATURES[spec.kind];
    let pet = pets.get(spec.userId);
    const fresh = !pet;
    if (!make && fresh) return;
    if (fresh || pet.state === 'off') {
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
      pet = { userId: spec.userId, group, shadow, sparkle, creature: null, rolls: new Map(), state: 'routine' };
      setCreature(pet, creature, spec);
      scene.add(group);
      pets.set(spec.userId, pet);
    } else if (make && (pet.kind !== spec.kind || pet.color !== spec.color)) {
      setCreature(pet, make(spec.color), spec); // the editor's Throw shows the new pick at once
    }
    pet.state = 'routine'; // a resting or leaving pet starts its routine from where it stands
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
    const now = clock();
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
    pet.group.position.set(px, hop, pz);
    pet.group.rotation.y = pet.yaw;
    pet.group.userData.dicerPet.phase = phase;
    pet.shadow.position.y = 0.01 - hop;
    pet.shadow.visible = shadows;
    pet.creature.pose(phase, t, pet.reaction, { yaw: look });
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

  /** One pet, one frame: true if it moved, 'rest' if it sits still, false once it is gone. */
  function step(pet, now, shadows, stay) {
    if (pet.state === 'rest') {
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
  function obstaclesFor({ spec, edge, area }) {
    const own = spec ? slotFor(spec.userId) : null;
    const list = [];
    if (own?.ok) {
      const h = pets.get(spec.userId)?.creature.height ?? PET_HEIGHT;
      list.push(obstacle(edgeSpot(edge, area, h).base, h, spec.userId));
    }
    for (const p of pets.values())
      if (standing(p) && p !== own?.victim && !(own?.ok && p.userId === spec.userId))
        list.push(obstacle(spotOf(p), p.creature.height, p.userId));
    return list;
  }

  /** The user left: their resting pet hops off; one mid-routine leaves when its roll ends. */
  function userGone(userId) {
    const pet = pets.get(userId);
    if (!pet) return;
    pet.gone = true;
    if (pet.state === 'hop' || pet.state === 'rest') sendOff(pet, clock());
  }

  /**
   * The stage changed size. Each resting pet hops to a fresh valid spot inside its owner's area:
   * the area of that owner's most recent roll (kept on the pet at begin), shrunk and shifted to fit
   * the new stage. Rolling pets keep their edge spot: their roll has its own area.
   */
  function areaChanged(stage) {
    const now = clock();
    for (const pet of pets.values()) {
      if (pet.state !== 'hop' && pet.state !== 'rest') continue;
      pet.area = fitArea(pet.area, stage);
      pet.spot = null; // its old spot keeps nobody away
      restOf(pet, now);
    }
  }

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

  return { begin, landed, leave, end, update, obstaclesFor, userGone, areaChanged, hit() {}, dispose };
}

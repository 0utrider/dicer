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
  inRestRing,
  offPoint,
  fitArea,
  obstacle,
  SLIDE,
  SPACING,
  PET_HEIGHT,
  KIND_FOOTPRINT,
} from './resting.js';
import { spotFor as chosenSpot, atEdge } from './rest-spots.js';
import { petFor } from '../pet-for.js';

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
/** A puddle fades this long after its splat when its owner hasn't rolled again (owner, 2026-11-14). */
export const PUDDLE_LEAVE_MS = 5000;
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

const FLY_PEAK = 1.2; // the dragonling's flight arc on a move (alignFor), die units

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
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms)); // test seams: the idle timer
  const clearTimer = deps.clearTimer || ((id) => clearTimeout(id));
  const doc = deps.doc || globalThis.document; // test seam: Foundry's UI, which rest spots avoid
  const hooks = deps.hooks || globalThis.Hooks; // test seam: Foundry's hooks (area edits)
  const userOf = deps.userOf || ((id) => globalThis.game?.users?.get?.(id)); // test seam: alignFor's absent pets
  // The last stage DiceBox told us ({cx, cz, halfWidth, halfDepth, rect?}: rect is its px rect): a
  // rest area is always fitted inside it.
  let stage = null;
  const pets = new Map(); // userId -> pet
  const keyOwner = new Map(); // roll key -> userId
  // userId -> {area, spot}: the rest spot obstaclesFor chose for a pet that has none yet, which
  // begin then takes (so the physics and the pet agree on it)
  const pending = new Map();
  let shadowTex = null;
  let shadowGeo = null;
  let sparkTex = null;
  let sparkMat = null;
  let disposed = false;
  let timer = null; // the one timer, aimed at the earliest leaveAt (so a held loop wakes up)
  let timerAt = Infinity;

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
    pending.delete(pet.userId);
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
  /** Whether pets are allowed and shown. */
  const shown = () => {
    try {
      return getSetting('petsAllowed') !== false && getSetting('showPets') !== false;
    } catch {
      return true;
    }
  };
  /** Whether resting is on: petStay is not 0 (leave after the roll), and pets allowed and shown. */
  const stays = () => {
    try {
      return getSetting('petStay') !== 0 && shown();
    } catch {
      return true;
    }
  };
  /** petStay in seconds: 0 leaves after the roll, -1 never leaves. */
  const stayFor = () => {
    try {
      const v = getSetting('petStay');
      return typeof v === 'number' ? v : 60;
    } catch {
      return 60;
    }
  };
  /** Aims the single idle timer at `at` (Infinity: none); it only wakes the loop. */
  function arm(at) {
    if (at === timerAt) return;
    if (timer !== null) clearTimer(timer);
    timer = null;
    timerAt = at;
    if (at === Infinity || disposed) return;
    timer = setTimer(
      () => {
        if (disposed) return;
        timer = null;
        timerAt = Infinity;
        wake();
      },
      Math.max(0, at - clock()),
    );
  }
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
  /** The page-to-stage mapping: px per die unit and the stage centre in page px; null with no stage rect. */
  function pageMap() {
    const r = stage?.rect;
    if (!r || !(stage.halfWidth > 0) || !(r.width > 0)) return null;
    return { r, px: r.width / 2 / stage.halfWidth, ox: r.left + r.width / 2, oz: r.top + r.height / 2 };
  }
  function uiRects() {
    const out = [];
    const map = pageMap();
    if (!map) return out;
    const { px, ox, oz } = map;
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
  /**
   * A free rest spot in `area` for user `userId`'s pet of `height`: spaced from the other pets
   * (but not `skip`, a pet about to be sent off), off Foundry's UI, and where `clear` holds
   * (restSpot's).
   */
  function spotFor(userId, area, height, skip, clear) {
    const taken = [];
    for (const o of pets.values())
      if (o.userId !== userId && o !== skip && standing(o)) taken.push(spotOf(o));
    return restSpot(area, height, taken, rand, uiRects(), clear);
  }

  const activeRolls = () => {
    try {
      return deps.activeRolls?.() ?? 0;
    } catch {
      return 0;
    }
  };
  /** True while the throw overlay holds dice (H-8: pets hold still, so a player may aim at one). */
  const holding = () => {
    try {
      return deps.holding?.() === true;
    } catch {
      return false;
    }
  };

  // ---- where pets rest on this screen (petRestSpot) ----
  /** The petRestSpot choice ('dice' when unreadable): read when a pet comes to rest, and by update. */
  const choice = () => {
    try {
      return getSetting('petRestSpot') ?? 'dice';
    } catch {
      return 'dice';
    }
  };
  let shownChoice = choice(); // the choice the resting pets sit by (update moves them on a change)
  /**
   * The pet's spot at this screen's corner or edge choice, or null for 'dice' (the ring of its
   * owner's area) or with no stage yet. It keeps its slot while no other pet holds it (so it goes
   * back to the same place after its owner's roll); otherwise it takes the lowest free one: slots
   * go in the order pets arrive. Sets pet.slot (null for 'dice').
   */
  function cornerSpot(pet) {
    const c = choice();
    const h = pet.creature.height;
    if (!stage || !atEdge(c)) {
      pet.slot = null;
      return null;
    }
    const held = new Set();
    for (const o of pets.values()) if (o !== pet && o.slot != null && standing(o)) held.add(o.slot);
    let slot = pet.slot != null && !held.has(pet.slot) ? pet.slot : null;
    for (let k = 0; slot === null && k < MAX_PETS; k++) if (!held.has(k)) slot = k;
    pet.slot = slot ?? 0;
    return chosenSpot(c, pet.slot, stage, h, uiRects());
  }
  /** A move of a standing pet from `at` to `to` over `ms` (stepMove), facing `yawTo` at the end. */
  function goTo(pet, at, to, ms, yawTo, now) {
    pet.goFrom = at;
    pet.goTo = to;
    pet.goAt = now;
    pet.goMs = ms;
    pet.spot = to; // obstaclesFor reports the destination (a throw may start mid-move)
    pet.state = 'move';
    pet.yaw0 = pet.yaw;
    pet.yawGo = Math.atan2(to.x - at.x, to.z - at.z); // faces where it goes
    pet.yawTo = yawTo;
    wake();
  }
  /** A fresh spot for a puddle: its corner slot, or a ring spot in its owner's area. */
  const freeSpot = (pet) => {
    const at = cornerSpot(pet);
    pet.cornered = !!at; // at its corner: its owner's next roll is watched from the roll area
    return at ?? spotFor(pet.userId, pet.area, pet.creature.height);
  };
  const fitted = (area) => (stage ? fitArea(area, stage) : area);
  const sameArea = (a, b) => ['cx', 'cz', 'halfWidth', 'halfDepth'].every((k) => a[k] === b[k]);
  /**
   * Where `userId`'s pet will rest if it has no resting spot yet: the one obstaclesFor chose (kept
   * while its area is the same and it still clears the others), or a new one. `keep` leaves it
   * pending (obstaclesFor); begin takes it.
   */
  function newSpot(userId, area, height, skip, keep) {
    const a = fitted(area);
    const p = pending.get(userId);
    let spot = null;
    if (p && sameArea(p.area, a)) {
      const clear = [...pets.values()].every(
        (o) =>
          o.userId === userId ||
          o === skip ||
          !standing(o) ||
          Math.hypot(spotOf(o).x - p.spot.x, spotOf(o).z - p.spot.z) >= SPACING * height - 1e-9,
      );
      if (clear) spot = p.spot;
    }
    spot ??= spotFor(userId, a, height, skip);
    if (keep) pending.set(userId, { area: a, spot });
    else pending.delete(userId);
    return spot;
  }
  /**
   * The spot a pet watches its owner's roll from, when it already has a resting one: where it rests
   * (or will, at the end of its hop), a puddle's spot, or the spot its roll is already using.
   */
  function restingSpot(pet) {
    if (!pet) return null;
    if (pet.state === 'hop' || pet.state === 'rest' || pet.state === 'move') return pet.spot ?? { x: pet.px, z: pet.pz };
    if (pet.state === 'splat' || pet.state === 'puddle')
      return pet.moveTo ?? pet.spot ?? { x: pet.px ?? pet.base.x, z: pet.pz ?? pet.base.z };
    if (pet.state === 'reform' && pet.atRest) return { x: pet.px ?? pet.base.x, z: pet.pz ?? pet.base.z };
    if (pet.state === 'routine' && pet.atRest) return pet.base;
    return null;
  }
  /**
   * Where a pet watches its owner's roll from: not its corner (it hops out to the roll area), but
   * the thrower's spot a hand replay put it on (alignFor).
   */
  const watchSpot = (pet) => (pet?.cornered && !pet.aligned ? null : restingSpot(pet));
  const restOf = (pet, now) => {
    pet.aligned = false;
    if (pet.state === 'routine') pet.idleAt = now; // idle since its routine ended
    if (stage) pet.area = fitArea(pet.area, stage);
    const corner = cornerSpot(pet);
    pet.cornered = !!corner;
    if (!corner && pet.state === 'routine' && pet.atRest && inRestRing(pet.area, pet.creature.height, pet.base)) {
      // it watched from its resting spot: it stays, with a little hop in place
      hopTo(pet, { x: pet.base.x, z: pet.base.z }, 'hop', now);
      pet.yawTo = pet.yaw; // no turning round
      return;
    }
    pet.atRest = false;
    hopTo(pet, corner ?? spotFor(pet.userId, pet.area, pet.creature.height), 'hop', now);
  };
  const sendOff = (pet, now) => {
    pet.aligned = false;
    pet.slot = null; // its corner slot is free for the next pet to arrive
    pet.cornered = false;
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
   * resting pet (never one mid-routine, nor one of `spare`, a Set of user ids) can give its place
   * up; the one idle longest goes (victim).
   */
  function slotFor(userId, spare) {
    const mine = pets.get(userId);
    let count = 0;
    let victim = null;
    for (const p of pets.values()) {
      if (p === mine || !standing(p)) continue;
      count++;
      if (
        !spare?.has(p.userId) &&
        (p.state === 'hop' || p.state === 'rest' || p.state === 'move' || p.state === 'puddle') &&
        (!victim || p.idleAt < victim.idleAt)
      )
        victim = p;
    }
    return count < MAX_PETS ? { ok: true } : { ok: !!victim, victim };
  }

  /** A new pet of `spec` in the scene, not yet placed (its creature made from CREATURES). */
  function makePet(spec) {
    const group = new THREE.Group();
    group.userData.dicerPet = { phase: 'enter' };
    const shadow = makeShadow();
    const sparkle = makeSparkle();
    group.add(shadow, sparkle);
    const pet = { userId: spec.userId, group, shadow, sparkle, creature: null, rolls: new Map(), state: 'routine' };
    setCreature(pet, CREATURES[spec.kind](spec.color), spec);
    scene.add(group);
    pets.set(spec.userId, pet);
    return pet;
  }

  /**
   * A roll with a pet begins (PetHook.begin). `hand` (H-5): a hand throw, with no throw pose; its
   * edge is the hand edge. A pet alignFor put at the thrower's spot watches from there.
   */
  function begin(key, { spec, edge, area, centre, hand }) {
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
    if (fresh) pet = makePet(spec);
    else if (make && (pet.kind !== spec.kind || pet.color !== spec.color)) {
      setCreature(pet, make(spec.color), spec); // the editor's Throw shows the new pick at once
    }
    const now = clock();
    // resting is on: the pet watches from where it rests (a first appearance hops straight to a new
    // rest spot, the one obstaclesFor sent the physics); otherwise it takes the edge spot.
    // A hand replay's pet that alignFor placed at the thrower's spot watches from it (petStay 0 too).
    // One resting at a corner or edge spot (petRestSpot) hops out to the roll area to watch, and
    // back to its slot afterwards.
    const rest = stays()
      ? (watchSpot(pet) ?? newSpot(spec.userId, area, pet.creature.height, null, false))
      : hand && pet.aligned
        ? restingSpot(pet)
        : null;
    if (!rest) pending.delete(spec.userId);
    pet.cornered = false;
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
    pet.leaveAt = null; // its idle time starts again when this roll ends
    pet.spot = null;
    pet.area = { ...area }; // the owner's resting area: that of their most recent roll
    pet.rolls.set(key, { ghost: !!spec.ghost, summary: null, consumed: false });
    keyOwner.set(key, spec.userId);
    // The newest roll (pet.current) owns the throw, the place and the leave; each roll keeps its
    // own ghost flag and summary for the merged reaction.
    pet.current = key;
    pet.centre = centre;
    const was = fresh ? null : { x: pet.px, z: pet.pz, y: pet.hop };
    if (rest) {
      pet.base = { x: rest.x, z: rest.z };
      pet.atRest = true;
      pet.spot = pet.base;
      const off = offPoint(area, rest, pet.creature.height);
      const len = Math.hypot(off.x - rest.x, off.z - rest.z) || 1;
      pet.out = [(off.x - rest.x) / len, (off.z - rest.z) / len];
      pet.inward = Math.atan2(-pet.out[0], -pet.out[1]);
      if (fresh) pet.yaw = Math.atan2(centre().x - rest.x, centre().z - rest.z);
    } else {
      place(pet, edge, area);
      pet.atRest = false;
      pet.yaw = pet.inward;
    }
    pet.reaction = 'plain';
    pet.soundDone = false;
    pet.exitFrom = null;
    pet.lastNow = now;
    // A re-used pet standing at its new spot restarts from the throw, with no re-enter; one that
    // is elsewhere (mid-exit, another edge or area) hops there from where it is.
    const moved =
      !!was && (Math.hypot(was.x - pet.base.x, was.z - pet.base.z) > MOVED || was.y > MOVED);
    // a first appearance at a rest spot hops in from just outside the area
    const outside = rest && fresh ? { ...offPoint(area, rest, pet.creature.height), y: 0 } : null;
    pet.from = moved ? was : outside;
    pet.track = { beganAt: fresh || moved ? now : now - ENTER_MS, hand: !!hand };
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
    // DiceBox ends a roll after taking it off its list: the last one over, a move held back while
    // it flew (a petRestSpot change, a replay's pets going home) wakes the loop now.
    if (!disposed && activeRolls() === 0 && (choice() !== shownChoice || [...pets.values()].some((p) => p.aligned)))
      wake();
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

  /** The pet comes to rest: from here it costs nothing until something wakes the loop. */
  function toRest(pet) {
    pet.state = 'rest';
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
    if (e >= 1) toRest(pet); // the last frame is posed: from here nothing redraws
    return true;
  }

  /**
   * A move (alignFor), on the creature's 'move' pose: the dragonling takes off, flies over in an
   * arc and lands; the slime boings over in two hops (its pose does the springs, airborne from 0.2
   * to 0.8 of each); the mimic scuttles over low. It turns to face the way it goes, then to
   * `yawTo` as it settles.
   */
  function stepMove(pet, now, shadows) {
    const e = clamp01((now - pet.goAt) / pet.goMs);
    const { goFrom: from, goTo: to } = pet;
    let s;
    let hop = 0;
    if (pet.kind === 'dragonling') {
      s = smooth(clamp01((e - 0.12) / 0.78)); // up first, then across, then down
      hop = FLY_PEAK * (smooth(clamp01(e / 0.35)) - smooth(clamp01((e - 0.65) / 0.35)));
    } else if (pet.kind === 'slime') {
      const i = e < 0.5 ? 0 : 1; // it travels while it is in the air
      s = (i + smooth(clamp01((e * 2 - i - 0.2) / 0.6))) / 2;
    } else s = smooth(e);
    const turn = wrap(pet.yaw0 + wrap(pet.yawGo - pet.yaw0) * smooth(clamp01(e / 0.2)));
    pet.yaw = wrap(turn + wrap(pet.yawTo - pet.yawGo) * smooth(clamp01((e - 0.75) / 0.25)));
    const px = from.x + (to.x - from.x) * s;
    const pz = from.z + (to.z - from.z) * s;
    show(pet, now, 'move', e, px, pz, e >= 1 ? 0 : hop, shadows);
    if (e >= 1) toRest(pet); // posed on the standing pose: nothing redraws from here
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
    if ((pet.state === 'hop' || pet.state === 'move') && !stay) sendOff(pet, now);
    if (pet.state === 'move') return stepMove(pet, now, shadows);
    if (pet.state !== 'routine') return stepHop(pet, now, shadows);
    const { phase, t } = phaseAt(pet.track, now);
    if ((phase === 'exit' || phase === 'gone') && stay && !pet.gone) {
      restOf(pet, now); // the exit becomes a hop to a resting spot (in place, if it watched from one)
      return stepHop(pet, now, shadows);
    }
    if ((phase === 'exit' || phase === 'gone') && pet.atRest) {
      sendOff(pet, now); // resting is off, or its user left: it hops out from its spot, not slides
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
    if (!pets.size) {
      arm(Infinity);
      return false;
    }
    let shadows = true;
    try {
      shadows = getSetting('shadows') !== false; // once per frame, not per pet
    } catch {
      /* unreadable: keep the default */
    }
    const stay = stays();
    const idle = stayFor();
    // Dice held by hand (H-8) count as busy too, and no idle leave is armed while they are: the
    // first frame after the release (or drop) arms it again.
    const held = holding();
    const busy = held || activeRolls() > 0; // once per frame
    // No roll in flight (the physics fixed every pet's spot when a throw started): a new
    // petRestSpot moves the resting pets, and a replay's pets go home. Held back until then.
    if (stay && !busy) {
      try {
        restSpotChanged(now);
      } catch (err) {
        console.warn('Dicer | pet', err);
      }
    }
    let nextLeave = Infinity;
    let moving = false;
    for (const pet of [...pets.values()]) {
      let alive = false;
      try {
        // a resting pet or puddle leaves once its idle time is up (a hop off, or a fade)
        // (a puddle fades PUDDLE_LEAVE_MS after its splat, whatever petStay says, unless sooner)
        const waits = ['rest', 'hop', 'move', 'puddle'].includes(pet.state);
        const wait =
          pet.state === 'puddle' ? (idle > 0 ? Math.min(idle * 1000, PUDDLE_LEAVE_MS) : PUDDLE_LEAVE_MS) : idle * 1000;
        pet.leaveAt = stay && wait > 0 && waits && Number.isFinite(pet.idleAt) ? pet.idleAt + wait : null;
        if (pet.leaveAt !== null) {
          // An overdue leave waits while any roll is in flight (the physics has the pet as an
          // obstacle, and the owner's roll may be between obstaclesFor and begin); the timer is
          // not aimed at it (it would spin the loop), and the roll's end runs update anyway.
          if (now >= pet.leaveAt) {
            if (!busy) sendOff(pet, now);
          } else if (!held) nextLeave = Math.min(nextLeave, pet.leaveAt);
        }
        // A pet alignFor placed stays while the replay flies, even with petStay 0 (not mid-routine:
        // that one follows its own roll).
        alive = step(pet, now, shadows, stay || (pet.aligned && busy && pet.state !== 'routine'));
      } catch (err) {
        console.warn('Dicer | pet', err);
      }
      if (alive === false) removePet(pet);
      else if (alive === true) moving = true;
    }
    arm(nextLeave);
    return moving ? true : pets.size > 0 ? 'rest' : false;
  }

  /**
   * The pets the physics should treat as fixed, for a throw about to start (PetHook.obstaclesFor):
   * every standing pet, a resting one at its spot (one moving at its destination) and
   * a rolling one at its edge spot, and, for
   * `spec`'s own user, the edge spot its pet is about to take, from the same placement as begin
   * (which replaces that pet's own entry). A pet leaving, or about to be replaced, stands no more.
   */
  function obstaclesFor({ spec, edge, area, stage: now }) {
    if (now) stage = now; // the layer may have loaded after DiceBox's last areaChanged
    const own = spec ? slotFor(spec.userId) : null;
    const list = [];
    if (own?.ok) {
      const mine = pets.get(spec.userId);
      const h = mine?.creature.height ?? PET_HEIGHT;
      // with resting on the pet rolls from its resting spot (a first appearance: the one it will hop
      // to, kept pending for begin); otherwise from the edge spot
      const at = stays()
        ? (watchSpot(mine) ?? newSpot(spec.userId, area, h, own.victim, true))
        : edgeSpot(edge, area, h).base;
      list.push(obstacle(at, h, spec.userId, KIND_FOOTPRINT[spec.kind]));
    }
    for (const p of pets.values())
      if (solid(p) && p !== own?.victim && !(own?.ok && p.userId === spec.userId))
        list.push(obstacle(spotOf(p), p.creature.height, p.userId, p.creature.footprint));
    return list;
  }

  /**
   * H-6: a hand replay is about to play here with the thrower's pet layout (`list`: {id, x, z, r, h}
   * in this screen's die units, placed like the dice; `area`: the replay's area; `paths(x, z)`: the
   * distance to the nearest recorded die centre over the whole replay). Each listed standing pet
   * moves to its spot (REST_HOP_MS); a listed pet not here hops in to it at rest, if slotFor finds
   * it a place (a full cap sends the longest-idle resting pet off, never one mid-routine or listed);
   * a listed pet mid-routine, splatted, a puddle or fading stays as it is (a puddle is no obstacle:
   * its die passes over it), and one with no place or no pet here is skipped (its die bounces off
   * empty air, and its splat finds no pet). An unlisted standing pet whose footprint the paths come
   * within r + 1 of moves to a rest spot they clear, if it finds one. Nothing with pets hidden or
   * not allowed, or while dice are held (H-8: the held throw's pets stay where its player aims).
   * A pet whose owner is gone is never moved or brought back. A placed or moved pet stays while
   * the replay flies, even with petStay 0. Returns the Set of listed ids standing at their spot
   * (or hopping to it): only those take the replay's hits (the caller drops the others).
   */
  function alignFor(list, area, paths) {
    const done = new Set();
    if (disposed || !shown() || holding()) return done;
    const now = clock();
    const items = (Array.isArray(list) ? list : []).filter(
      (o) => o && o.id != null && Number.isFinite(o.x) && Number.isFinite(o.z),
    );
    const spare = new Set(items.map((o) => o.id));
    const yawAt = (to) => Math.atan2(area.cx - to.x, area.cz - to.z); // faces the replay's dice
    const absent = [];
    for (const o of items) {
      const pet = pets.get(o.id);
      const to = { x: o.x, z: o.z };
      if (!pet || pet.state === 'off') absent.push([o, to]);
      else if (!pet.gone && (pet.state === 'hop' || pet.state === 'rest' || pet.state === 'move')) {
        const at = pos(pet);
        pet.aligned = true;
        done.add(o.id);
        if (Math.hypot(at.x - to.x, at.z - to.z) > MOVED || at.y > MOVED)
          goTo(pet, at, to, REST_HOP_MS, yawAt(to), now);
      }
    }
    for (const [o, to] of absent) {
      let pet = pets.get(o.id);
      if (pet?.gone) continue;
      const spec = pet ? null : petFor({ user: userOf(o.id), view: 'real', getSetting });
      if (!pet && !CREATURES[spec?.kind]) continue;
      const slot = slotFor(o.id, spare);
      if (!slot.ok) continue;
      if (slot.victim) sendOff(slot.victim, now);
      if (!pet) {
        pet = makePet({ ...spec, userId: o.id });
        let own = null;
        try {
          own = deps.areaOf?.(o.id);
        } catch {
          /* no area: the replay's */
        }
        pet.area = fitted(own ?? area);
        const from = offPoint(area, to, pet.creature.height); // hops in from just outside
        pet.px = from.x;
        pet.pz = from.z;
        pet.hop = 0;
        pet.base = to;
        pet.yaw = Math.atan2(to.x - from.x, to.z - from.z);
        pet.reaction = 'plain';
        pet.lastNow = now;
      }
      pet.atRest = true;
      pet.idleAt = now;
      hopTo(pet, to, 'hop', now);
      pet.aligned = true;
      done.add(o.id);
    }
    for (const pet of pets.values()) {
      if (spare.has(pet.userId) || pet.gone || !(pet.state === 'hop' || pet.state === 'rest' || pet.state === 'move')) continue;
      const r = pet.creature.footprint ?? 0.45 * pet.creature.height;
      const clear = (p) => paths(p.x, p.z) > r + 1;
      const at = spotOf(pet);
      if (clear(at)) continue;
      pet.area = fitted(pet.area);
      const to = spotFor(pet.userId, pet.area, pet.creature.height, null, clear);
      if (!clear(to)) continue; // nowhere the paths clear: it stays
      pet.aligned = true;
      goTo(pet, pos(pet), to, REST_HOP_MS, yawAt(to), now);
    }
    return done;
  }

  /** The user left: their resting pet hops off; one mid-routine leaves when its roll ends. */
  function userGone(userId) {
    const pet = pets.get(userId);
    if (!pet) return;
    pet.gone = true;
    if (['hop', 'rest', 'move', 'puddle'].includes(pet.state))
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
    if (!pet || !['routine', 'hop', 'rest', 'move'].includes(pet.state)) return;
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
   * Where pets rest may have changed (petRestSpot's onChange wakes the loop, and update asks here
   * each frame with no roll in flight; also the layer's restSpotChanged()). On a new choice the
   * resting pets hop, and puddles snap, to it, taking corner slots in the order they came to rest
   * (corner to corner keeps each pet's slot). At a corner or edge choice a pet a hand replay moved
   * (alignFor) goes back to its slot once it stands there and the replay is over. Nothing while a
   * roll is in flight, dice are held or resting is off. Afterwards the layer goes idle again.
   */
  function restSpotChanged(now = clock()) {
    if (disposed || activeRolls() > 0 || holding() || !stays()) return;
    const c = choice();
    if (c !== shownChoice) {
      shownChoice = c;
      const order = [...pets.values()].sort((a, b) => (a.idleAt ?? 0) - (b.idleAt ?? 0));
      for (const pet of order) replace(pet, now);
    }
    const corner = !!stage && atEdge(c);
    for (const pet of pets.values()) {
      if (!pet.aligned || pet.state === 'routine') continue;
      if (!corner) pet.aligned = false; // 'dice': it stays where the replay put it, as before
      else if (pet.state === 'rest' && !pet.gone) restOf(pet, now);
    }
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
    } else if (pet.state === 'hop' || pet.state === 'rest' || pet.state === 'move') {
      pet.spot = null;
      pet.atRest = false; // a new area: a new spot
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
    arm(Infinity);
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
    alignFor,
    userGone,
    areaChanged,
    /** petRestSpot may have changed: resting pets move to the new spot (update also checks). */
    restSpotChanged: () => restSpotChanged(),
    hit,
    dispose,
    /** The contact speed at which the physics splats a pet (THROW splatSpeed); null: petSplat off. */
    get splatSpeed() {
      return splatOn() ? SPLAT_SPEED : null;
    },
  };
}

import * as THREE from 'three';
import { KIND } from './particles.js';
import { SHAPE } from './shapes.js';

/**
 * Elemental trails: a die with an element leaves a trail of it while it flies. The effect layer
 * calls flight(roll.dice, nowMs) on every playing frame (its own gates first: effects on, not
 * safe mode); this decides the rest (elementalTrails, effect budget, which dice, how much) and
 * drops particles from the shared pool behind each moving element die. Emission stops when the
 * die rests, and what was emitted fades over its short particle life, so the landed number stays
 * clear. Lives in the lazy effects chunk.
 *
 * Hot path: called every frame for every die of a roll, so it allocates nothing per frame (one
 * state object per die, first time it is seen; the recipes reuse module-level emit specs, which
 * the pool copies and never keeps).
 */

/** The element ids, in the order of the design. */
export const ELEMENTS = Object.freeze(['fire', 'lava', 'frost', 'storm', 'acid', 'void', 'vitality', 'poison']);

/** Interior types that are elements themselves (they win over the damage type). */
const INSIDE_ELEMENTS = new Set(['fire', 'lava', 'frost', 'storm']);
/** Damage type -> element. */
const DAMAGE_ELEMENTS = Object.freeze({
  fire: 'fire',
  cold: 'frost',
  electricity: 'storm',
  lightning: 'storm',
  acid: 'acid',
  void: 'void',
  necrotic: 'void',
  vitality: 'vitality',
  radiant: 'vitality',
  healing: 'vitality',
  poison: 'poison',
});

/**
 * The element a die shows: its elemental inside (fire, lava, frost, storm), else the element of
 * its damage type, else null (no trail).
 * @param {object} [appearance] a (normalized) appearance
 * @param {string} [damageType]
 * @returns {string|null}
 */
export function elementOf(appearance, damageType) {
  const inside = appearance?.interior?.type;
  if (INSIDE_ELEMENTS.has(inside)) return inside;
  if (typeof damageType !== 'string') return null;
  const key = damageType.toLowerCase();
  return Object.hasOwn(DAMAGE_ELEMENTS, key) ? DAMAGE_ELEMENTS[key] : null;
}

// --- recipes ---------------------------------------------------------------------------------

/** Below this speed (world units/s) a die counts as resting: no emission. */
const REST_SPEED = 1.5;
/** At and above this speed a die emits at the full rate. */
const FULL_SPEED = 14;
/** The nominal die radius the recipe sizes are tuned for (a d20, as catalogue.js's fallback). */
const DEFAULT_DIE_R = 0.95;

const rand = Math.random;
/** count -> an integer, rounding the fraction up at random (so small rates still trickle). */
const dither = (n) => Math.floor(n + rand());
const UP = Object.freeze({ x: 0, y: 1, z: 0 });

/** Writes into `o` the point `back` die radii behind the die (against its motion), jittered. */
function behind(o, emit, back, jitter) {
  const { at, vel, speed, radius } = emit;
  const inv = speed > 0 ? 1 / speed : 0;
  const j = jitter * radius;
  o.x = at.x - vel.x * inv * back * radius + (rand() - 0.5) * j;
  o.y = at.y - vel.y * inv * back * radius + (rand() - 0.5) * j;
  o.z = at.z - vel.z * inv * back * radius + (rand() - 0.5) * j;
  return o;
}

/** A reusable pool.emit spec: the pool copies every field and keeps nothing. */
const spec = (fields) => ({ count: 0, origin: { x: 0, y: 0, z: 0 }, now: 0, ...fields });

const C = (hex) => new THREE.Color(hex);

const FIRE = {
  flame: spec({
    dir: { x: 0, y: 1, z: 0 },
    speed: 0.7,
    spread: 0.35,
    gravity: 1.6, // buoyant: the tongues lick upward
    life: 0.6,
    color: C('#ffe08a'),
    colorEnd: C('#e0400c'),
    size: 0.55,
    sizeEnd: 0.3,
    shape: SHAPE.FLAME,
    halo: 0.25,
  }),
  // The same tongues, normal blend: additive light washes out on a light map, this keeps the colour.
  tongue: spec({
    dir: { x: 0, y: 1, z: 0 },
    speed: 0.6,
    spread: 0.35,
    gravity: 1.4,
    life: 0.5,
    color: C('#ff8a1c'),
    colorEnd: C('#b0260a'),
    size: 0.4,
    sizeEnd: 0.3,
    shape: SHAPE.FLAME,
    blend: 'normal',
    alpha: 0.75,
  }),
  ember: spec({
    dir: UP,
    speed: 1.3,
    spread: 0.9,
    gravity: 1.1,
    life: 1.2,
    color: C('#ffc060'),
    colorEnd: C('#ff3c0a'),
    size: 0.11,
    sizeEnd: 0.5,
    shape: SHAPE.DOT,
    halo: 0.8,
  }),
  smoke: spec({
    dir: UP,
    speed: 0.45,
    spread: 0.6,
    gravity: 0.3,
    life: 0.7,
    color: C('#3a2418'),
    colorEnd: C('#1c1410'),
    size: 0.35,
    sizeEnd: 2.2,
    kind: KIND.SMOKE,
    shape: SHAPE.SMOKE,
    blend: 'normal',
    alpha: 0.32,
    spin: 0.6,
  }),
};

/** Fire: flickering flame tongues and rising embers, a wisp of dark smoke for light maps. */
function fireTrail(pool, emit) {
  const { k, reduced, now, radius, speed, vel } = emit;
  const r = radius / DEFAULT_DIE_R;
  const s = speedShare(speed);
  const thin = reduced ? 0.5 : 1;
  const w = k * (0.35 + 0.65 * s) * thin;
  // The flames lean back along the path a little (against the motion).
  const inv = speed > 0 ? 0.35 / speed : 0;

  const flame = FIRE.flame;
  flame.count = dither(3.2 * w);
  if (flame.count) {
    flame.dir.x = -vel.x * inv;
    flame.dir.z = -vel.z * inv;
    behind(flame.origin, emit, 0.35, 0.5);
    flame.kind = reduced ? KIND.SPARK : KIND.EMBER; // EMBER flickers and sways
    flame.size = (reduced ? 0.5 : 0.7) * r;
    flame.now = now;
    pool.emit(flame);
  }
  const tongue = FIRE.tongue;
  tongue.count = dither(1.2 * w);
  if (tongue.count) {
    tongue.dir.x = -vel.x * inv;
    tongue.dir.z = -vel.z * inv;
    behind(tongue.origin, emit, 0.45, 0.5);
    tongue.kind = reduced ? KIND.SPARK : KIND.EMBER;
    tongue.size = (reduced ? 0.4 : 0.5) * r;
    tongue.now = now;
    pool.emit(tongue);
  }
  const ember = FIRE.ember;
  ember.count = dither(1.6 * w * s);
  if (ember.count) {
    behind(ember.origin, emit, 0.3, 0.8);
    ember.kind = reduced ? KIND.SPARK : KIND.EMBER;
    ember.speed = reduced ? 0.6 : 1.3;
    ember.size = 0.13 * r;
    ember.now = now;
    pool.emit(ember);
  }
  const smoke = FIRE.smoke;
  smoke.count = dither(0.5 * w);
  if (smoke.count) {
    behind(smoke.origin, emit, 0.6, 0.4);
    smoke.size = (reduced ? 0.28 : 0.35) * r;
    smoke.now = now;
    pool.emit(smoke);
  }
}

const FROST = {
  mist: spec({
    dir: { x: 0, y: -0.2, z: 0 },
    speed: 0.3,
    spread: 1.2,
    gravity: -0.25, // cold air sinks
    life: 1.1,
    color: C('#eaf6ff'),
    colorEnd: C('#86b8de'),
    size: 0.5,
    sizeEnd: 2.6,
    kind: KIND.SMOKE,
    shape: SHAPE.SMOKE,
    blend: 'normal',
    alpha: 0.75,
    spin: 0.4,
  }),
  glint: spec({
    dir: UP,
    speed: 0.25,
    spread: 1.5,
    gravity: 0,
    life: 0.8,
    color: C('#ffffff'),
    colorEnd: C('#9ad8ff'),
    size: 0.38,
    sizeEnd: 0.4,
    shape: SHAPE.GLINT,
    spin: 1.5,
    halo: 0.8,
  }),
  // Small ice chips shed by the die (normal blend: they read on a light map), falling to the table.
  chip: spec({
    dir: UP,
    speed: 1.1,
    spread: 1.0,
    gravity: -7,
    life: 0.55,
    color: C('#b4e2ff'),
    colorEnd: C('#4f8fc0'),
    size: 0.11,
    sizeEnd: 0.8,
    kind: KIND.SHARD,
    shape: SHAPE.SHARD,
    blend: 'normal',
    spin: 5,
  }),
};

/** Frost: a cold mist rolling off the die, twinkling ice glints, a few falling ice chips. */
function frostTrail(pool, emit) {
  const { k, reduced, now, radius, speed } = emit;
  const r = radius / DEFAULT_DIE_R;
  const s = speedShare(speed);
  const thin = reduced ? 0.5 : 1;
  const w = k * (0.35 + 0.65 * s) * thin;

  const mist = FROST.mist;
  mist.count = dither(2.4 * w);
  if (mist.count) {
    behind(mist.origin, emit, 0.4, 0.6);
    mist.size = (reduced ? 0.55 : 0.75) * r;
    mist.now = now;
    pool.emit(mist);
  }
  const glint = FROST.glint;
  glint.count = dither(2.4 * w);
  if (glint.count) {
    behind(glint.origin, emit, 0.2, 1.4);
    glint.kind = reduced ? KIND.SPARK : KIND.GLINT; // GLINT twinkles
    glint.size = (reduced ? 0.45 : 0.6) * r;
    glint.now = now;
    pool.emit(glint);
  }
  const chip = FROST.chip;
  chip.count = dither(1.0 * w * s);
  if (chip.count) {
    behind(chip.origin, emit, 0.2, 0.9);
    chip.speed = reduced ? 0.5 : 1.1;
    chip.size = 0.14 * r;
    chip.now = now;
    pool.emit(chip);
  }
}

/** Speed -> 0..1: 0 at rest, 1 at FULL_SPEED and above. */
function speedShare(speed) {
  return Math.min(1, Math.max(0, (speed - REST_SPEED) / (FULL_SPEED - REST_SPEED)));
}

/**
 * element -> (pool, emit) => void. `emit` = { at, vel, speed, radius, k, reduced, now }: the die's
 * world position and velocity (units/s), its speed, its bounding radius, the emission scale (tier
 * particleScale x crowd x frame time), reduced motion, and the ms clock every pool emit passes.
 * The recipe owns nothing in `emit` (it is reused for every die).
 */
export const TRAIL_RECIPES = Object.freeze({
  fire: fireTrail,
  frost: frostTrail,
});

// --- the emitter ------------------------------------------------------------------------------

/** A recipe runs at most once per this many seconds per die (frame-rate independent counts). */
const STEP_S = 0.015;
/** Its counts are tuned for one 60 Hz frame; a longer step emits proportionally more (capped). */
const NOMINAL_S = 1 / 60;
const MAX_STEP_SCALE = 3;
/** A gap longer than this (a stall, a hidden tab) restarts the die: no velocity across it. */
const MAX_GAP_S = 0.1;
/** Above this many moving element dice, each emits less (total grows as sqrt): big pools stay cheap. */
const CROWD = 6;

const dieScale = new THREE.Vector3(); // reused: radiusOf allocates nothing

/** The die's bounding-sphere radius (its mesh's geometry radius x largest world scale), else 0.95. */
function radiusOf(die) {
  let mesh = die.inner?.isMesh ? die.inner : null;
  if (!mesh) {
    die.outer?.traverse?.((o) => {
      if (!mesh && o.isMesh && o.geometry) mesh = o;
    });
  }
  const geometry = mesh?.geometry;
  if (!geometry) return DEFAULT_DIE_R;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere?.();
  const r = geometry.boundingSphere?.radius;
  if (!(r > 0) || typeof mesh.getWorldScale !== 'function') return DEFAULT_DIE_R;
  mesh.updateWorldMatrix?.(true, false);
  mesh.getWorldScale(dieScale);
  const R = r * Math.max(Math.abs(dieScale.x), Math.abs(dieScale.y), Math.abs(dieScale.z));
  return Number.isFinite(R) && R > 0 ? R : DEFAULT_DIE_R;
}

/**
 * @param {object} o the effect layer's library deps
 * @param {() => object|null} o.getPool the shared particle pool
 * @param {() => {effectBudget: number, particleScale: number}} o.getTier
 * @param {() => number} o.now ms clock
 * @param {() => boolean} o.reducedMotion
 * @param {(key: string) => unknown} [o.setting]
 * @param {(key: string, message: string, err: unknown) => void} [o.warnOnce]
 */
export function createTrailFx({ getPool, getTier, now, reducedMotion, setting, warnOnce }) {
  let states = new WeakMap(); // die -> { x, y, z, t, acc, vx, vy, vz, speed, element, radius }
  const emit = {
    at: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    speed: 0,
    radius: DEFAULT_DIE_R,
    k: 1,
    reduced: false,
    now: 0,
  };

  /** Updates a die's state for this frame; true when it moves fast enough to trail. */
  function track(die, t) {
    if (!die || (die.trail !== 1 && die.trail !== 2)) return false;
    const outer = die.outer;
    const p = outer?.position;
    if (!p) return false;
    let st = states.get(die);
    if (!st) {
      const element = elementOf(die.appearance, die.damageType);
      st = { x: 0, y: 0, z: 0, t: NaN, acc: 0, vx: 0, vy: 0, vz: 0, speed: 0, element, radius: 0 };
      states.set(die, st);
    }
    if (!st.element || !TRAIL_RECIPES[st.element]) return false;
    if (outer.visible === false) {
      st.t = NaN; // not placed yet: the first placed frame is a first sight
      return false;
    }
    const dt = (t - st.t) / 1000; // NaN at first sight
    if (dt === 0) return false; // the same frame again: nothing new
    const fresh = !(dt > 0 && dt <= MAX_GAP_S); // first sight, a stall or a clock reset
    if (fresh) {
      st.speed = 0;
    } else {
      st.vx = (p.x - st.x) / dt;
      st.vy = (p.y - st.y) / dt;
      st.vz = (p.z - st.z) / dt;
      st.speed = Math.hypot(st.vx, st.vy, st.vz);
    }
    st.x = p.x;
    st.y = p.y;
    st.z = p.z;
    st.t = t;
    if (!(st.speed >= REST_SPEED)) {
      st.acc = 0;
      return false;
    }
    st.acc += dt;
    return true;
  }

  return {
    flight(dice, nowMs) {
      try {
        if (setting?.('elementalTrails') === false) return;
        if (!dice || !(dice.length > 0)) return;
        const tier = getTier?.();
        if (Number(tier?.effectBudget) <= 2) return;
        const t = Number.isFinite(nowMs) ? nowMs : now();
        let movers = 0;
        for (let i = 0; i < dice.length; i++) if (track(dice[i], t)) movers++;
        if (!movers) return;
        const pool = getPool();
        if (!pool) return;
        const scale = Number(tier?.particleScale);
        const crowd = movers > CROWD ? Math.sqrt(CROWD / movers) : 1;
        const base = (scale > 0 ? scale : 1) * crowd;
        const reduced = reducedMotion?.() === true;
        for (let i = 0; i < dice.length; i++) {
          const die = dice[i];
          const st = die && states.get(die);
          if (!st || !(st.acc >= STEP_S) || st.t !== t || !(st.speed >= REST_SPEED)) continue;
          if (!st.radius) st.radius = radiusOf(die);
          emit.at.x = st.x;
          emit.at.y = st.y;
          emit.at.z = st.z;
          emit.vel.x = st.vx;
          emit.vel.y = st.vy;
          emit.vel.z = st.vz;
          emit.speed = st.speed;
          emit.radius = st.radius;
          emit.k = base * Math.min(MAX_STEP_SCALE, st.acc / NOMINAL_S);
          emit.reduced = reduced;
          emit.now = t;
          st.acc = 0;
          TRAIL_RECIPES[st.element](pool, emit);
        }
      } catch (err) {
        warnOnce?.('trail', 'trail effect failed', err);
      }
    },
    /** Forgets every die (the layer's clear()): what was emitted is the pool's to clear. */
    clear() {
      states = new WeakMap();
    },
  };
}

import * as THREE from 'three';
import { KIND } from './particles.js';
import { SHAPE } from './shapes.js';
import { elementOf } from '../element-of.js';

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

/** The element ids, in the order of the design (one list, shared with world start). */
export { ELEMENTS } from '../elements.js';

/** The element a die shows (element-of.js, shared with the pet chunk's reactions). */
export { elementOf };

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

/** A recipe's emission weight this step: k, more when the die is faster, halved under reduced motion. */
function rateOf(emit) {
  return emit.k * (0.35 + 0.65 * speedShare(emit.speed)) * (emit.reduced ? 0.5 : 1);
}

/**
 * Emits one layer of a recipe: dither(n) particles of the reusable spec `s`, from `back` die radii
 * behind the die (jittered by `jitter` radii), sized `size` (tuned for the default die, scaled by
 * this die's radius), at emit.now. Per-frame fields (kind, dir, speed) go on `s` before the call.
 * Allocates nothing.
 */
function emitLayer(pool, s, n, emit, back, jitter, size) {
  s.count = dither(n);
  if (!s.count) return;
  behind(s.origin, emit, back, jitter);
  s.size = (size * emit.radius) / DEFAULT_DIE_R;
  s.now = emit.now;
  pool.emit(s);
}

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
  const { reduced, speed, vel } = emit;
  const w = rateOf(emit);
  const kind = reduced ? KIND.SPARK : KIND.EMBER; // EMBER flickers and sways
  // The flames lean back along the path a little (against the motion).
  const inv = speed > 0 ? 0.35 / speed : 0;

  const flame = FIRE.flame;
  flame.dir.x = -vel.x * inv;
  flame.dir.z = -vel.z * inv;
  flame.kind = kind;
  emitLayer(pool, flame, 3.2 * w, emit, 0.35, 0.5, reduced ? 0.5 : 0.7);
  const tongue = FIRE.tongue;
  tongue.dir.x = -vel.x * inv;
  tongue.dir.z = -vel.z * inv;
  tongue.kind = kind;
  emitLayer(pool, tongue, 1.2 * w, emit, 0.45, 0.5, reduced ? 0.4 : 0.5);
  const ember = FIRE.ember;
  ember.kind = kind;
  ember.speed = reduced ? 0.6 : 1.3;
  emitLayer(pool, ember, 1.6 * w * speedShare(speed), emit, 0.3, 0.8, 0.13);
  emitLayer(pool, FIRE.smoke, 0.5 * w, emit, 0.6, 0.4, reduced ? 0.28 : 0.35);
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
  const { reduced, speed } = emit;
  const w = rateOf(emit);

  emitLayer(pool, FROST.mist, 2.4 * w, emit, 0.4, 0.6, reduced ? 0.55 : 0.75);
  const glint = FROST.glint;
  glint.kind = reduced ? KIND.SPARK : KIND.GLINT; // GLINT twinkles
  emitLayer(pool, glint, 2.4 * w, emit, 0.2, 1.4, reduced ? 0.45 : 0.6);
  const chip = FROST.chip;
  chip.speed = reduced ? 0.5 : 1.1;
  emitLayer(pool, chip, 1.0 * w * speedShare(speed), emit, 0.2, 0.9, 0.14);
}

/** Drips land a hair above the table (catalogue.js's FLOOR_Y): no z-fight with a floor plane. */
const DRIP_FLOOR = 0.02;

const STORM = {
  // Crackling sparks: short jagged dashes flung out from the die, flickering (EMBER, gravity 0: no sway).
  spark: spec({
    dir: UP,
    speed: 2.4,
    spread: Math.PI,
    gravity: 0,
    life: 0.34,
    color: C('#ffffff'),
    colorEnd: C('#7fa8ff'),
    size: 0.26,
    sizeEnd: 0.5,
    shape: SHAPE.STREAK,
    stretch: 0.8,
    drag: 3,
    halo: 0.7,
  }),
  // The thin glow streak: dashes launched along the die's path, which slow (drag) and shorten as they fade.
  streak: spec({
    dir: { x: 1, y: 0, z: 0 },
    speed: 0,
    spread: 0.05,
    gravity: 0,
    life: 0.32,
    color: C('#e6f0ff'),
    colorEnd: C('#5a7cff'),
    size: 0.2,
    sizeEnd: 0.6,
    kind: KIND.STREAK,
    shape: SHAPE.STREAK,
    stretch: 2.5,
    drag: 2.5,
    halo: 0.5,
  }),
  // The same crackle in deep electric blue, normal blend: additive light washes out on a light map.
  arc: spec({
    dir: UP,
    speed: 2.2,
    spread: Math.PI,
    gravity: 0,
    life: 0.3,
    color: C('#3c5cff'),
    colorEnd: C('#241c9a'),
    size: 0.2,
    sizeEnd: 0.5,
    shape: SHAPE.STREAK,
    stretch: 0.8,
    drag: 3,
    blend: 'normal',
    alpha: 0.9,
  }),
};

/** Storm: crackling sparks around the die and a thin glow streak along its path. */
function stormTrail(pool, emit) {
  const { reduced, speed, vel } = emit;
  const w = rateOf(emit);
  const kind = reduced ? KIND.SPARK : KIND.EMBER; // EMBER flickers: the crackle

  const spark = STORM.spark;
  spark.kind = kind;
  emitLayer(pool, spark, 3.4 * w, emit, 0.4, 1.4, reduced ? 0.2 : 0.26);
  const streak = STORM.streak;
  streak.dir.x = vel.x; // the pool normalizes dir
  streak.dir.y = vel.y;
  streak.dir.z = vel.z;
  streak.speed = 0.2 * speed;
  emitLayer(pool, streak, 2.2 * w, emit, 0.5, 0.3, reduced ? 0.16 : 0.2);
  const arc = STORM.arc;
  arc.kind = kind;
  emitLayer(pool, arc, 1.6 * w, emit, 0.4, 1.4, reduced ? 0.15 : 0.2);
}

const LAVA = {
  // Molten drips: glowing beads that fall to the table, bounce once and cool from yellow to dark red.
  drip: spec({
    dir: { x: 0, y: -1, z: 0 },
    speed: 0.8,
    spread: 0.9,
    gravity: -9,
    floor: DRIP_FLOOR,
    life: 0.8,
    color: C('#ffd25a'),
    colorEnd: C('#a01c04'),
    size: 0.15,
    sizeEnd: 0.6,
    kind: KIND.SPARK,
    shape: SHAPE.DOT,
    halo: 0.6,
  }),
  // The molten bead's body, normal blend (it keeps its colour on a light map), cooling to a dark crust.
  bead: spec({
    dir: { x: 0, y: -1, z: 0 },
    speed: 0.7,
    spread: 0.9,
    gravity: -9,
    floor: DRIP_FLOOR,
    life: 0.7,
    color: C('#ff6a12'),
    colorEnd: C('#3a0c04'),
    size: 0.11,
    sizeEnd: 0.7,
    kind: KIND.SPARK,
    shape: SHAPE.DOT,
    blend: 'normal',
    alpha: 0.95,
  }),
  smoke: spec({
    dir: UP,
    speed: 0.45,
    spread: 0.6,
    gravity: 0.35,
    life: 0.8,
    color: C('#2a1a14'),
    colorEnd: C('#100c0a'),
    size: 0.4,
    sizeEnd: 2.4,
    kind: KIND.SMOKE,
    shape: SHAPE.SMOKE,
    blend: 'normal',
    alpha: 0.5,
    spin: 0.5,
  }),
};

/** Lava: molten drips that fall to the table and dark smoke rising off the die. */
function lavaTrail(pool, emit) {
  const { reduced } = emit;
  const w = rateOf(emit);

  emitLayer(pool, LAVA.drip, 2.0 * w, emit, 0.25, 0.8, reduced ? 0.2 : 0.26);
  emitLayer(pool, LAVA.bead, 1.4 * w, emit, 0.25, 0.8, reduced ? 0.15 : 0.19);
  emitLayer(pool, LAVA.smoke, 0.9 * w, emit, 0.6, 0.4, reduced ? 0.4 : 0.5);
}

const ACID = {
  // Green drips, normal blend (the colour that reads on a light map), falling to the table.
  drip: spec({
    dir: { x: 0, y: -1, z: 0 },
    speed: 0.8,
    spread: 0.9,
    gravity: -8,
    floor: DRIP_FLOOR,
    life: 0.7,
    color: C('#7ee82a'),
    colorEnd: C('#2f7a0c'),
    size: 0.12,
    sizeEnd: 0.8,
    kind: KIND.SPARK,
    shape: SHAPE.DOT,
    blend: 'normal',
    alpha: 0.95,
  }),
  // A sickly glow on some drips (additive): it reads on the dark map.
  glow: spec({
    dir: { x: 0, y: -1, z: 0 },
    speed: 0.7,
    spread: 0.9,
    gravity: -8,
    floor: DRIP_FLOOR,
    life: 0.6,
    color: C('#c4ff5a'),
    colorEnd: C('#2ea80e'),
    size: 0.12,
    sizeEnd: 0.6,
    kind: KIND.SPARK,
    shape: SHAPE.DOT,
    halo: 0.5,
  }),
  // A faint caustic fume off the die.
  fume: spec({
    dir: UP,
    speed: 0.35,
    spread: 0.8,
    gravity: 0.25,
    life: 0.7,
    color: C('#a6e070'),
    colorEnd: C('#4f7a34'),
    size: 0.35,
    sizeEnd: 2.2,
    kind: KIND.SMOKE,
    shape: SHAPE.SMOKE,
    blend: 'normal',
    alpha: 0.38,
    spin: 0.5,
  }),
};

/** Acid: green drips falling from the die, a faint green fume. */
function acidTrail(pool, emit) {
  const { reduced } = emit;
  const w = rateOf(emit);

  emitLayer(pool, ACID.drip, 2.2 * w, emit, 0.25, 0.8, reduced ? 0.16 : 0.21);
  emitLayer(pool, ACID.glow, 1.2 * w, emit, 0.25, 0.8, reduced ? 0.16 : 0.2);
  emitLayer(pool, ACID.fume, 0.5 * w, emit, 0.5, 0.4, reduced ? 0.34 : 0.45);
}

const VOID = {
  // Dark smoke, normal blend: near-black violet that swallows the light map behind the die.
  smoke: spec({
    dir: UP,
    speed: 0.3,
    spread: 1.1,
    gravity: 0.1,
    life: 0.8,
    color: C('#1c1028'),
    colorEnd: C('#050308'),
    size: 0.45,
    sizeEnd: 2.4,
    kind: KIND.SMOKE,
    shape: SHAPE.SMOKE,
    blend: 'normal',
    alpha: 0.6,
    spin: 0.8,
  }),
  // A faint violet rim around the smoke (additive): dark smoke alone is lost on the dark map.
  rim: spec({
    dir: UP,
    speed: 0.3,
    spread: 1.1,
    gravity: 0.1,
    life: 0.6,
    color: C('#9060ff'),
    colorEnd: C('#2a1060'),
    size: 0.4,
    sizeEnd: 2.0,
    kind: KIND.SMOKE,
    shape: SHAPE.SMOKE,
    alpha: 0.5,
    halo: 0.45,
    spin: 0.8,
  }),
  // Pale violet motes flung off the die and quickly dragged to a halt.
  mote: spec({
    dir: UP,
    speed: 0.9,
    spread: Math.PI,
    gravity: 0,
    life: 0.5,
    color: C('#c0a0ff'),
    colorEnd: C('#3c1a90'),
    size: 0.1,
    sizeEnd: 0.3,
    kind: KIND.SPARK,
    shape: SHAPE.DOT,
    drag: 3,
    halo: 0.8,
  }),
};

/** Void: dark smoke curling off the die, rimmed in faint violet, a few violet motes. */
function voidTrail(pool, emit) {
  const { reduced } = emit;
  const w = rateOf(emit);

  emitLayer(pool, VOID.smoke, 1.6 * w, emit, 0.45, 0.6, reduced ? 0.45 : 0.6);
  emitLayer(pool, VOID.rim, 1.1 * w, emit, 0.45, 0.6, reduced ? 0.4 : 0.5);
  emitLayer(pool, VOID.mote, 1.2 * w, emit, 0.3, 1.0, reduced ? 0.1 : 0.13);
}

const VITALITY = {
  // Golden motes drifting upward, twinkling (GLINT kind, DOT shape).
  mote: spec({
    dir: UP,
    speed: 0.5,
    spread: 1.6,
    gravity: 0.8,
    life: 0.9,
    color: C('#fff0a8'),
    colorEnd: C('#ffb020'),
    size: 0.14,
    sizeEnd: 0.4,
    shape: SHAPE.DOT,
    halo: 0.9,
  }),
  // A few four-point sparkles among them.
  sparkle: spec({
    dir: UP,
    speed: 0.3,
    spread: 1.5,
    gravity: 0.4,
    life: 0.6,
    color: C('#fffbe0'),
    colorEnd: C('#ffc840'),
    size: 0.35,
    sizeEnd: 0.4,
    shape: SHAPE.GLINT,
    spin: 1.5,
    halo: 0.8,
  }),
  // The same motes in deep gold, normal blend: additive light washes out on a light map.
  gold: spec({
    dir: UP,
    speed: 0.45,
    spread: 1.6,
    gravity: 0.6,
    life: 0.8,
    color: C('#e8a018'),
    colorEnd: C('#a86808'),
    size: 0.12,
    sizeEnd: 0.5,
    kind: KIND.SPARK,
    shape: SHAPE.DOT,
    blend: 'normal',
    alpha: 0.95,
  }),
};

/** Vitality: golden motes rising and twinkling behind the die. */
function vitalityTrail(pool, emit) {
  const { reduced } = emit;
  const w = rateOf(emit);
  const kind = reduced ? KIND.SPARK : KIND.GLINT; // GLINT twinkles

  const mote = VITALITY.mote;
  mote.kind = kind;
  emitLayer(pool, mote, 2.6 * w, emit, 0.3, 1.2, reduced ? 0.13 : 0.17);
  const sparkle = VITALITY.sparkle;
  sparkle.kind = kind;
  emitLayer(pool, sparkle, 0.8 * w, emit, 0.25, 1.2, reduced ? 0.35 : 0.45);
  emitLayer(pool, VITALITY.gold, 1.6 * w, emit, 0.3, 1.2, reduced ? 0.11 : 0.14);
}

const POISON = {
  // A sickly yellow-green haze, normal blend, hanging in the air (it neither rises nor drips).
  haze: spec({
    dir: UP,
    speed: 0.25,
    spread: 1.4,
    gravity: -0.05,
    life: 0.9,
    color: C('#8fb83a'),
    colorEnd: C('#4f6a22'),
    size: 0.6,
    sizeEnd: 3.0,
    kind: KIND.SMOKE,
    shape: SHAPE.SMOKE,
    blend: 'normal',
    alpha: 0.45,
    spin: 0.4,
  }),
  // A faint green glow in the haze (additive): it reads on the dark map.
  glow: spec({
    dir: UP,
    speed: 0.25,
    spread: 1.4,
    gravity: -0.05,
    life: 0.7,
    color: C('#7aff3a'),
    colorEnd: C('#1e6a10'),
    size: 0.5,
    sizeEnd: 2.4,
    kind: KIND.SMOKE,
    shape: SHAPE.SMOKE,
    alpha: 0.25,
    halo: 0.2,
    spin: 0.4,
  }),
  // Small bubbles rising out of the haze.
  bubble: spec({
    dir: UP,
    speed: 0.4,
    spread: 1.2,
    gravity: 0.5,
    life: 0.6,
    color: C('#b4e050'),
    colorEnd: C('#5a8a20'),
    size: 0.12,
    sizeEnd: 1.2,
    kind: KIND.SPARK,
    shape: SHAPE.RING,
    blend: 'normal',
    alpha: 0.85,
  }),
};

/** Poison: a sickly green haze trailing the die, with a few rising bubbles. */
function poisonTrail(pool, emit) {
  const { reduced } = emit;
  const w = rateOf(emit);

  emitLayer(pool, POISON.haze, 1.6 * w, emit, 0.45, 0.7, reduced ? 0.55 : 0.75);
  emitLayer(pool, POISON.glow, 0.8 * w, emit, 0.45, 0.7, reduced ? 0.5 : 0.65);
  emitLayer(pool, POISON.bubble, 1.0 * w, emit, 0.3, 1.0, reduced ? 0.13 : 0.17);
}

const SONIC = {
  // Sound rings left hanging where the die passed (speed 0: they stay put), widening as they fade.
  wave: spec({
    dir: UP,
    speed: 0,
    spread: 0,
    gravity: 0,
    life: 0.5,
    color: C('#fff2cc'),
    colorEnd: C('#e0a850'),
    size: 0.7,
    sizeEnd: 4.2,
    kind: KIND.SPARK,
    shape: SHAPE.RING,
    spin: 0,
    halo: 0.15,
  }),
  // An inner ripple from the same point, normal blend (it reads on a light map), widening slower.
  ripple: spec({
    dir: UP,
    speed: 0,
    spread: 0,
    gravity: 0,
    life: 0.45,
    color: C('#a8782a'),
    colorEnd: C('#6a4610'),
    size: 0.5,
    sizeEnd: 3.0,
    kind: KIND.SPARK,
    shape: SHAPE.RING,
    spin: 0,
    blend: 'normal',
    alpha: 0.75,
  }),
};

/** Sonic: rippling sound rings left behind along the path, widening as they fade (no flicker). */
function sonicTrail(pool, emit) {
  const { reduced } = emit;
  const w = rateOf(emit);

  emitLayer(pool, SONIC.wave, 0.4 * w, emit, 0.2, 0, reduced ? 0.55 : 0.7);
  emitLayer(pool, SONIC.ripple, 0.4 * w, emit, 0.2, 0, reduced ? 0.4 : 0.5);
}

const FORCE = {
  // Pale violet shards flung off the die, dragged to a hover, shimmering (GLINT: alpha twinkles).
  shard: spec({
    dir: UP,
    speed: 1.4,
    spread: Math.PI,
    gravity: 0,
    life: 0.55,
    color: C('#e2ccff'),
    colorEnd: C('#8a50ff'),
    size: 0.3,
    sizeEnd: 0.5,
    shape: SHAPE.SHARD,
    drag: 2.5,
    spin: 5,
    halo: 0.6,
  }),
  // The same shards in deep violet, normal blend: additive light washes out on a light map.
  facet: spec({
    dir: UP,
    speed: 1.2,
    spread: Math.PI,
    gravity: 0,
    life: 0.5,
    color: C('#7a3de0'),
    colorEnd: C('#3e1698'),
    size: 0.24,
    sizeEnd: 0.5,
    shape: SHAPE.SHARD,
    drag: 2.5,
    spin: 5,
    blend: 'normal',
    alpha: 0.9,
  }),
  // A faint violet streak along the path (fainter and shorter-lived than storm's blue-white one).
  streak: spec({
    dir: { x: 1, y: 0, z: 0 },
    speed: 0,
    spread: 0.05,
    gravity: 0,
    life: 0.3,
    color: C('#c8a8ff'),
    colorEnd: C('#5a2ad8'),
    size: 0.2,
    sizeEnd: 0.6,
    kind: KIND.STREAK,
    shape: SHAPE.STREAK,
    stretch: 2.5,
    drag: 2.5,
    alpha: 0.45,
    halo: 0.4,
  }),
};

/** Force: violet shimmering shards around the die and a faint violet streak along its path. */
function forceTrail(pool, emit) {
  const { reduced, speed, vel } = emit;
  const w = rateOf(emit);
  const kind = reduced ? KIND.SHARD : KIND.GLINT; // GLINT shimmers

  const shard = FORCE.shard;
  shard.kind = kind;
  emitLayer(pool, shard, 1.8 * w, emit, 0.3, 1.2, reduced ? 0.24 : 0.3);
  const facet = FORCE.facet;
  facet.kind = kind;
  emitLayer(pool, facet, 1.3 * w, emit, 0.3, 1.2, reduced ? 0.19 : 0.24);
  const streak = FORCE.streak;
  streak.dir.x = vel.x; // the pool normalizes dir
  streak.dir.y = vel.y;
  streak.dir.z = vel.z;
  streak.speed = 0.2 * speed;
  emitLayer(pool, streak, 1.4 * w, emit, 0.5, 0.25, reduced ? 0.15 : 0.19);
}

const MENTAL = {
  // Pink swirl strokes flung out that curl as they go (SPIRAL turns their path; the streak follows it).
  swirl: spec({
    dir: UP,
    speed: 2.6,
    spread: Math.PI,
    gravity: 0.3,
    life: 0.8,
    color: C('#ff9ad8'),
    colorEnd: C('#b04dff'),
    size: 0.16,
    sizeEnd: 0.5,
    shape: SHAPE.STREAK,
    stretch: 2.4,
    drag: 1.5,
    halo: 0.6,
  }),
  // The same curls in deep magenta, normal blend: they keep their colour on a light map.
  curl: spec({
    dir: UP,
    speed: 2.4,
    spread: Math.PI,
    gravity: 0.3,
    life: 0.75,
    color: C('#d0308f'),
    colorEnd: C('#7a1a9a'),
    size: 0.13,
    sizeEnd: 0.5,
    shape: SHAPE.STREAK,
    stretch: 2.4,
    drag: 1.5,
    blend: 'normal',
    alpha: 0.9,
  }),
  // A soft pink glow over the die's wake.
  glow: spec({
    dir: UP,
    speed: 0.2,
    spread: 1.2,
    gravity: 0.2,
    life: 0.45,
    color: C('#ff7ac8'),
    colorEnd: C('#902a9a'),
    size: 0.5,
    sizeEnd: 1.6,
    kind: KIND.SPARK,
    shape: SHAPE.DOT,
    alpha: 0.5,
    halo: 0.3,
  }),
};

/** Mental: pink psychic swirls curling away from the die over a soft pink glow. */
function mentalTrail(pool, emit) {
  const { reduced } = emit;
  const w = rateOf(emit);
  const kind = reduced ? KIND.SPARK : KIND.SPIRAL; // SPIRAL curls and twinkles

  const swirl = MENTAL.swirl;
  swirl.kind = kind;
  emitLayer(pool, swirl, 2.4 * w, emit, 0.3, 1.0, reduced ? 0.12 : 0.16);
  const curl = MENTAL.curl;
  curl.kind = kind;
  emitLayer(pool, curl, 1.6 * w, emit, 0.3, 1.0, reduced ? 0.1 : 0.13);
  emitLayer(pool, MENTAL.glow, 0.8 * w, emit, 0.3, 0.6, reduced ? 0.4 : 0.5);
}

const SPIRIT = {
  // Ghostly cyan wisps, normal blend, drifting up off the die (frost's mist sinks; these rise).
  wisp: spec({
    dir: UP,
    speed: 0.4,
    spread: 0.9,
    gravity: 1.1,
    life: 0.9,
    color: C('#3cc4e4'),
    colorEnd: C('#a8eefc'),
    size: 0.3,
    sizeEnd: 2.2,
    kind: KIND.SMOKE,
    shape: SHAPE.SMOKE,
    blend: 'normal',
    alpha: 0.65,
    spin: 0.9,
  }),
  // A cold cyan glow in the wisps (additive): it reads on the dark map.
  glow: spec({
    dir: UP,
    speed: 0.4,
    spread: 0.9,
    gravity: 1.1,
    life: 0.75,
    color: C('#8ff0ff'),
    colorEnd: C('#1e7a9a'),
    size: 0.3,
    sizeEnd: 1.8,
    kind: KIND.SMOKE,
    shape: SHAPE.SMOKE,
    alpha: 0.7,
    halo: 0.4,
    spin: 0.9,
  }),
  // Thin pale strands rising out of the wisps.
  strand: spec({
    dir: UP,
    speed: 0.9,
    spread: 0.5,
    gravity: 1.2,
    life: 0.6,
    color: C('#d4fbff'),
    colorEnd: C('#4ec6e0'),
    size: 0.12,
    sizeEnd: 0.4,
    kind: KIND.SPARK,
    shape: SHAPE.STREAK,
    stretch: 1.4,
    drag: 0.8,
    halo: 0.5,
  }),
};

/** Spirit: ghostly cyan wisps and pale strands drifting up from the die's path. */
function spiritTrail(pool, emit) {
  const { reduced } = emit;
  const w = rateOf(emit);

  emitLayer(pool, SPIRIT.wisp, 2.0 * w, emit, 0.4, 0.6, reduced ? 0.3 : 0.4);
  emitLayer(pool, SPIRIT.glow, 1.4 * w, emit, 0.4, 0.6, reduced ? 0.36 : 0.48);
  emitLayer(pool, SPIRIT.strand, 1.6 * w, emit, 0.3, 1.0, reduced ? 0.12 : 0.16);
}

const BLEED = {
  // Blood drops, normal blend (dark red reads on a light map): they fall to the table, bounce once
  // and keep widening as they rest there, the splat.
  drop: spec({
    dir: { x: 0, y: -1, z: 0 },
    speed: 0.6,
    spread: 0.8,
    gravity: -10,
    floor: DRIP_FLOOR,
    life: 0.9,
    color: C('#b0101c'),
    colorEnd: C('#5a0408'),
    size: 0.12,
    sizeEnd: 2.4,
    kind: KIND.SPARK,
    shape: SHAPE.DOT,
    blend: 'normal',
    alpha: 0.95,
  }),
  // A deep red glow on some drops (additive): dark red alone is lost on the dark map.
  glow: spec({
    dir: { x: 0, y: -1, z: 0 },
    speed: 0.6,
    spread: 0.8,
    gravity: -10,
    floor: DRIP_FLOOR,
    life: 0.6,
    color: C('#ff2a2a'),
    colorEnd: C('#600008'),
    size: 0.11,
    sizeEnd: 1.4,
    kind: KIND.SPARK,
    shape: SHAPE.DOT,
    halo: 0.4,
  }),
  // Fine spatter flung sideways off the die, falling to the table.
  spatter: spec({
    dir: UP,
    speed: 1.2,
    spread: 1.4,
    gravity: -10,
    floor: DRIP_FLOOR,
    life: 0.6,
    color: C('#c41420'),
    colorEnd: C('#4a0206'),
    size: 0.06,
    sizeEnd: 1.6,
    kind: KIND.SPARK,
    shape: SHAPE.DOT,
    blend: 'normal',
    alpha: 0.9,
  }),
};

/** Bleed: blood drops that fall from the die and splat on the table, a little fine spatter. */
function bleedTrail(pool, emit) {
  const { reduced, speed } = emit;
  const w = rateOf(emit);

  emitLayer(pool, BLEED.drop, 1.6 * w, emit, 0.25, 0.7, reduced ? 0.13 : 0.17);
  emitLayer(pool, BLEED.glow, 0.9 * w, emit, 0.25, 0.7, reduced ? 0.11 : 0.14);
  const spatter = BLEED.spatter;
  spatter.speed = reduced ? 0.6 : 1.2;
  emitLayer(pool, spatter, 1.0 * w * speedShare(speed), emit, 0.2, 0.8, 0.08);
}

/** Writes the die's direction of motion, tilted down by `drop` (the pool normalizes dir), into d. */
function along(d, vel, speed, drop) {
  d.x = vel.x;
  d.y = vel.y - drop * speed;
  d.z = vel.z;
}

const SLASHING = {
  // Thin silver slash streaks fanned out along the path; gravity curves their path and the streak
  // follows it, so each is a short arc. Not flickering: a clean blade glint.
  slash: spec({
    dir: { x: 1, y: 0, z: 0 },
    speed: 0,
    spread: 0.45,
    gravity: -4,
    life: 0.3,
    color: C('#f4f7ff'),
    colorEnd: C('#8a94a6'),
    size: 0.09,
    sizeEnd: 0.5,
    kind: KIND.STREAK,
    shape: SHAPE.STREAK,
    stretch: 1.8,
    drag: 2.5,
    halo: 0.35,
  }),
  // The same arcs in dark steel, normal blend: additive silver washes out on a light map.
  steel: spec({
    dir: { x: 1, y: 0, z: 0 },
    speed: 0,
    spread: 0.45,
    gravity: -4,
    life: 0.28,
    color: C('#5e6878'),
    colorEnd: C('#3a404c'),
    size: 0.07,
    sizeEnd: 0.5,
    kind: KIND.STREAK,
    shape: SHAPE.STREAK,
    stretch: 1.8,
    drag: 2.5,
    blend: 'normal',
    alpha: 0.85,
  }),
};

/** Slashing: thin silver slash arcs fanned out behind the die. */
function slashingTrail(pool, emit) {
  const { reduced, speed, vel } = emit;
  const w = rateOf(emit);

  const slash = SLASHING.slash;
  along(slash.dir, vel, speed, 0.15);
  slash.speed = 0.22 * speed;
  emitLayer(pool, slash, 1.4 * w, emit, 0.4, 0.6, reduced ? 0.07 : 0.09);
  const steel = SLASHING.steel;
  along(steel.dir, vel, speed, 0.15);
  steel.speed = 0.2 * speed;
  emitLayer(pool, steel, 1.0 * w, emit, 0.4, 0.6, reduced ? 0.055 : 0.07);
}

const PIERCING = {
  // Sharp white needles shot straight back along the path: no spread, no gravity, long and thin.
  needle: spec({
    dir: { x: 1, y: 0, z: 0 },
    speed: 0,
    spread: 0.02,
    gravity: 0,
    life: 0.24,
    color: C('#ffffff'),
    colorEnd: C('#dce6ff'),
    size: 0.06,
    sizeEnd: 0.4,
    kind: KIND.STREAK,
    shape: SHAPE.STREAK,
    stretch: 4,
    drag: 1.5,
    halo: 0.3,
  }),
  // The same needles in dark steel, normal blend: white additive light washes out on a light map.
  shaft: spec({
    dir: { x: 1, y: 0, z: 0 },
    speed: 0,
    spread: 0.02,
    gravity: 0,
    life: 0.22,
    color: C('#383e48'),
    colorEnd: C('#1e2228'),
    size: 0.05,
    sizeEnd: 0.4,
    kind: KIND.STREAK,
    shape: SHAPE.STREAK,
    stretch: 4,
    drag: 1.5,
    blend: 'normal',
    alpha: 1,
  }),
};

/** Piercing: sharp, straight white needle streaks along the die's path (straighter than slashing). */
function piercingTrail(pool, emit) {
  const { reduced, speed, vel } = emit;
  const w = rateOf(emit);

  const needle = PIERCING.needle;
  along(needle.dir, vel, speed, 0);
  needle.speed = 0.32 * speed;
  emitLayer(pool, needle, 1.2 * w, emit, 0.3, 0.35, reduced ? 0.045 : 0.06);
  const shaft = PIERCING.shaft;
  along(shaft.dir, vel, speed, 0);
  shaft.speed = 0.3 * speed;
  emitLayer(pool, shaft, 0.9 * w, emit, 0.3, 0.35, reduced ? 0.04 : 0.05);
}

const BLUDGEONING = {
  // Brownish-grey dust puffs, normal blend, kicked up and settling (void's smoke is near-black and
  // rises).
  puff: spec({
    dir: UP,
    speed: 0.4,
    spread: 1.3,
    gravity: -0.15,
    life: 0.7,
    color: C('#9a8a78'),
    colorEnd: C('#766c60'),
    size: 0.35,
    sizeEnd: 2.0,
    kind: KIND.SMOKE,
    shape: SHAPE.SMOKE,
    blend: 'normal',
    alpha: 0.6,
    spin: 0.7,
  }),
  // Pale dust motes catching the light (additive): grey dust alone is dull on the dark map.
  mote: spec({
    dir: UP,
    speed: 0.6,
    spread: 1.4,
    gravity: -1,
    life: 0.5,
    color: C('#e0d2bc'),
    colorEnd: C('#6a5c4a'),
    size: 0.08,
    sizeEnd: 0.5,
    kind: KIND.SPARK,
    shape: SHAPE.DOT,
    drag: 2,
    alpha: 0.85,
    halo: 0.3,
  }),
  // Grit: small dark chips shed by the die, falling to the table.
  grit: spec({
    dir: UP,
    speed: 1.0,
    spread: 1.1,
    gravity: -8,
    floor: DRIP_FLOOR,
    life: 0.55,
    color: C('#6e5e4c'),
    colorEnd: C('#3a3028'),
    size: 0.07,
    sizeEnd: 0.8,
    kind: KIND.SHARD,
    shape: SHAPE.SHARD,
    blend: 'normal',
    spin: 6,
  }),
};

/** Bludgeoning: brownish-grey dust puffs kicked up behind the die, a few pale motes and grit. */
function bludgeoningTrail(pool, emit) {
  const { reduced, speed } = emit;
  const w = rateOf(emit);

  emitLayer(pool, BLUDGEONING.puff, 1.2 * w, emit, 0.45, 0.6, reduced ? 0.4 : 0.5);
  emitLayer(pool, BLUDGEONING.mote, 1.4 * w, emit, 0.3, 1.0, reduced ? 0.08 : 0.1);
  const grit = BLUDGEONING.grit;
  grit.speed = reduced ? 0.5 : 1.0;
  emitLayer(pool, grit, 1.0 * w * speedShare(speed), emit, 0.2, 0.9, 0.12);
}

/** Speed -> 0..1: 0 at rest, 1 at FULL_SPEED and above. */
function speedShare(speed) {
  return Math.min(1, Math.max(0, (speed - REST_SPEED) / (FULL_SPEED - REST_SPEED)));
}

/**
 * element -> (pool, emit) => void, one per element in ELEMENTS. `emit` = { at, vel, speed, radius, k, reduced, now }: the die's
 * world position and velocity (units/s), its speed, its bounding radius, the emission scale (tier
 * particleScale x crowd x frame time), reduced motion, and the ms clock every pool emit passes.
 * The recipe owns nothing in `emit` (it is reused for every die).
 */
export const TRAIL_RECIPES = Object.freeze({
  fire: fireTrail,
  lava: lavaTrail,
  frost: frostTrail,
  storm: stormTrail,
  acid: acidTrail,
  void: voidTrail,
  vitality: vitalityTrail,
  poison: poisonTrail,
  sonic: sonicTrail,
  force: forceTrail,
  mental: mentalTrail,
  spirit: spiritTrail,
  bleed: bleedTrail,
  slashing: slashingTrail,
  piercing: piercingTrail,
  bludgeoning: bludgeoningTrail,
});

// --- the emitter ------------------------------------------------------------------------------

/**
 * One reused stand-in for the pool: every layer a recipe emits takes the look's own two colours
 * (appearance.trail.colors). The recipe's specs are shared, so theirs are put back after.
 */
const tint = {
  pool: null,
  colors: null,
  emit(s) {
    const { color, colorEnd } = s;
    s.color = tint.colors[0];
    s.colorEnd = tint.colors[1];
    tint.pool.emit(s);
    s.color = color;
    s.colorEnd = colorEnd;
  },
};

/** A recipe runs at most once per this many seconds per die (frame-rate independent counts). */
const STEP_S = 0.015;
/** Its counts are tuned for one 60 Hz frame; a longer step emits proportionally more (capped). */
const NOMINAL_S = 1 / 60;
const MAX_STEP_SCALE = 3;
/** A gap longer than this (a stall, a hidden tab) restarts the die: no velocity across it. */
const MAX_GAP_S = 0.1;
/** Above this many moving element dice, each emits less (total grows as sqrt): big pools stay cheap. */
const CROWD = 6;
/** Reduced motion is re-read this often (ms): the effect layer's reducedMotion() calls matchMedia, which allocates. */
const REDUCED_MS = 1000;

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
  let reduced = false;
  let reducedAt = -Infinity; // the clock at the last reducedMotion() read

  /** Updates a die's state for this frame; true when it moves fast enough to trail. */
  function track(die, t) {
    if (!die || (die.trail !== 1 && die.trail !== 2)) return false;
    const outer = die.outer;
    const p = outer?.position;
    if (!p) return false;
    let st = states.get(die);
    if (!st) {
      // the look's own trail wins over its inside and damage type ('none' has no recipe: no trail)
      const own = die.appearance?.trail;
      const element = own?.element ?? elementOf(die.appearance, die.damageType);
      st = { colors: own?.colors?.map(C), x: 0, y: 0, z: 0, t: NaN, acc: 0, vx: 0, vy: 0, vz: 0, speed: 0, element, radius: 0 };
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
      st.speed = Math.sqrt(st.vx * st.vx + st.vy * st.vy + st.vz * st.vz); // hypot is slower, per die per frame
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
        if (!pool) {
          // Nothing to emit into: bank nothing either, or the first frame with a pool bursts at the cap.
          for (let i = 0; i < dice.length; i++) {
            const st = dice[i] && states.get(dice[i]);
            if (st) st.acc = 0;
          }
          return;
        }
        const scale = Number(tier?.particleScale);
        const crowd = movers > CROWD ? Math.sqrt(CROWD / movers) : 1;
        const base = (scale > 0 ? scale : 1) * crowd;
        if (!(t - reducedAt < REDUCED_MS && t >= reducedAt)) {
          reduced = reducedMotion?.() === true;
          reducedAt = t;
        }
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
          if (st.colors) {
            tint.pool = pool;
            tint.colors = st.colors;
          }
          TRAIL_RECIPES[st.element](st.colors ? tint : pool, emit);
        }
      } catch (err) {
        warnOnce?.('trail', 'trail effect failed', err);
      }
    },
    /** Forgets every die (the layer's clear()): what was emitted is the pool's to clear. */
    clear() {
      states = new WeakMap();
      reducedAt = -Infinity;
    },
  };
}

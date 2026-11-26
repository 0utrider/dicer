import { mimic } from './mimic.js';
import { slime } from './slime.js';
import { dragonling } from './dragonling.js';
import { owl } from './owl.js';
import { frog } from './frog.js';
import { ghost } from './ghost.js';
import { mushroom } from './mushroom.js';
import { eye } from './eye.js';
import { golem } from './golem.js';
import { cat } from './cat.js';
import { fox } from './fox.js';
import { lantern } from './lantern.js';
import { imp } from './imp.js';
import { robot } from './robot.js';
import { jester } from './jester.js';
import { raven } from './raven.js';
import { spider } from './spider.js';
import { skull } from './skull.js';
import { drone } from './drone.js';
import { REFORM_IN, outBack, smooth, span } from './parts.js';

/**
 * The creatures. Each is (color: '#rrggbb') -> Creature, where a Creature is
 * { root, height, pose(phase, t, reaction, look: {yaw}), dispose() }.
 * - phase 'enter'|'throw'|'watch'|'react'|'exit'|'wobble'|'reform', t 0..1 within it (watch: t is 0,
 *   so idle motion runs on the creature's own clock; look.now, if given, replaces that clock for
 *   tests and screenshots). 'wobble' is a hit that does not splat it (a squash that rings out and a
 *   lean away from the die on top of the standing pose; look.leanX/leanZ is the push direction in
 *   the creature's own space, and the layer also pushes it away); 'reform' is it popping back out
 *   of the gathering goo (hidden until t 0.38, then a grow with overshoot and a stretch). Both are
 *   handled here, for every creature, on the root's scale and tilt. 'move' is a dodge out of the
 *   cursor's way (each creature its own: the dragonling flies, the slime boings twice, the mimic
 *   scuttles); it starts and ends on the standing pose (exit at t 1), and the layer moves the root
 *   across (with a flight arc for the dragonling). 'pet' (clicked: a happy wiggle) and 'huff'
 *   (clicked too often: a puff and a glance away) start and end on the standing pose; look.calm
 *   (reduced motion) makes their wiggle smaller. The elemental reactions (a die landing by a
 *   resting pet) do too: 'scorch' (fire, lava: it fans itself), 'shiver' (frost; look.calm a slower,
 *   smaller shiver), 'bristle' (storm: it stands tall, wide-eyed) and 'startle' (a jump). The
 *   moods 'proud' (chest out) and 'sulk' (head down; the mimic's lid shut, the slime flattened)
 *   settle from the standing pose over t and hold, static, from t 1. 'cheer' (someone else's
 *   natural 20: two happy hops; look.calm one small one) starts and ends on the standing pose.
 * - reaction 'crit'|'fumble'|'mixed'|'plain' (meaningful in react and exit; may be null).
 * - look.yaw is the yaw of what it looks at (the dice centre, or for a resting pet the cursor)
 *   RELATIVE TO the body's current facing, in radians, clamped to +-0.6, and 0 when it looks
 *   ahead: the head, eyes and pupils turn by it, in any phase.
 * The layer owns the root's position and turns the body; a creature only animates inside its
 * root. Its local forward (toward the dice) is +Z, up is +Y and it stands on y = 0.
 * footprint (optional, scene units) is the top-down body radius the physics obstacle uses; without
 * it the layer uses 0.45 x height. Measure it from the built geometry in XZ, leaving out wings and tails.
 * height is the creature's standing body height (the layer scales its inset, hops and shadow by
 * it). For the mimic it is the closed chest: its open jaw rises above that (about 2.3 in watch),
 * so that its top-down footprint is as wide as the other pets' and a d20's.
 */
// t is clamped to 0..1 (NaN -> 0) once here, so no creature can put a NaN into a matrix.
const NO_LOOK = { yaw: 0 }; // shared: poses only read it
/** A hit spring: rises to 1 over `attack`, then rings down, and is exactly 0 at t = 0 and t = 1. */
const ring = (t, attack, freq, damp) => {
  const fade = 1 - smooth(span(t, 0.72, 1));
  if (t < attack) return Math.sin((t / attack) * Math.PI * 0.5) * fade;
  const k = t - attack;
  return Math.exp(-damp * k) * Math.cos(Math.PI * 2 * freq * k) * fade;
};
const finite = (x) => (Number.isFinite(x) ? x : 0);

// Wobble: a squash on impact that rings out like a spring, and a lean of the whole body (pivoting
// on its feet) away from the die, a beat behind the squash, swinging back past upright once.
const WOBBLE_SQUASH = 0.26;
const WOBBLE_LEAN = 0.34; // rad at the peak
// Reform: hidden inside the gathering goo until REFORM_IN (parts.js, shared with the splat), then
// it pops out of the goo dome (growing with a back-ease overshoot), stretching tall first and
// ringing down to its pose.
const REFORM_POP = 0.72;
const MIN_SCALE = 1e-3;

export const safe = (make) => (color) => {
  const c = make(color);
  const pose = c.pose;
  const r = c.root;
  c.pose = (phase, t, reaction, look) => {
    t = t > 0 ? (t < 1 ? t : 1) : 0;
    if (phase !== 'wobble' && phase !== 'reform') {
      r.scale.setScalar(1);
      r.rotation.set(0, 0, 0);
      return pose(phase, t, reaction, look);
    }
    pose('exit', 1, 'plain', NO_LOOK); // the standing pose, squashed below
    if (phase === 'wobble') {
      const sy = 1 - WOBBLE_SQUASH * ring(t, 0.09, 2.3, 4.5);
      const sxz = 1 / Math.sqrt(sy);
      r.scale.set(sxz, sy, sxz);
      // look.leanX/leanZ: the push direction in the creature's own space (unit, or absent)
      const lean = WOBBLE_LEAN * ring(t, 0.16, 1.7, 3.6);
      const lx = finite(look?.leanX);
      const lz = finite(look?.leanZ);
      r.rotation.set(lz * lean, 0, -lx * lean); // the top goes toward (lx, lz)
      return;
    }
    r.rotation.set(0, 0, 0);
    if (t < REFORM_IN) {
      r.scale.setScalar(MIN_SCALE);
      return;
    }
    const g = 0.3 + 0.7 * outBack(span(t, REFORM_IN, REFORM_POP), 2.4);
    const k = span(t, REFORM_IN, 1);
    const j =
      0.2 * Math.exp(-4.5 * k) * Math.sin(Math.PI * 2 * 1.6 * k) * (1 - smooth(span(t, 0.82, 1)));
    const sy = Math.max(MIN_SCALE, g * (1 + j));
    const sxz = Math.max(MIN_SCALE, g / Math.sqrt(1 + j));
    r.scale.set(sxz, sy, sxz);
  };
  return c;
};

/**
 * Pet kinds made from an artist's model (docs/reference/pet-model-spec.md): kind -> the url of its
 * .glb. Such a kind shows its code-built creature until the model has loaded, then the model
 * (model-pet.js); a model that fails to load leaves the code-built one.
 */
export const PET_MODELS = Object.fromEntries(
  // built by scripts/pets/build-<kind>.js; shipped in the module's assets (the release zip has
  // them), fetched through Foundry's route like the sounds and fonts
  ['mimic', 'slime', 'dragonling', 'owl', 'frog', 'ghost', 'mushroom', 'eye', 'golem', 'cat', 'fox', 'lantern', 'imp', 'robot', 'jester', 'raven', 'spider', 'skull', 'drone'].map((k) => [k, `modules/dicer/assets/pets/${k}.glb`]),
);
/** The height a model kind is drawn at, when not the standing 1.5 (the mimic's open lid stands taller). */
export const MODEL_FIT = { mimic: 2.0 };

/** Each kind's own colour, for a pet set to natural colours (its PetSpec colour is null). */
export const NATURAL_COLORS = {
  mimic: '#9a6a32',
  slime: '#2bb3a3',
  dragonling: '#c0392b',
  owl: '#8a5a2b',
  frog: '#3f9b3a',
  ghost: '#b9c4e8',
  mushroom: '#c0392b',
  eye: '#7b3fa8',
  golem: '#7d7f86',
  cat: '#e08a2c',
  fox: '#d9682a',
  lantern: '#e8b04a',
  imp: '#b8322f',
  robot: '#b08d57',
  jester: '#8e44ad',
  raven: '#40456a',
  spider: '#6b4f8a',
  skull: '#6fd08c',
  drone: '#2fa8c9',
};
/** A PetSpec's colour: its own, or its kind's natural one. */
export const specColor = (spec) => spec?.color ?? NATURAL_COLORS[spec?.kind] ?? '#c9a227';

export const CREATURES = {
  mimic: safe(mimic),
  slime: safe(slime),
  dragonling: safe(dragonling),
  owl: safe(owl),
  frog: safe(frog),
  ghost: safe(ghost),
  mushroom: safe(mushroom),
  eye: safe(eye),
  golem: safe(golem),
  cat: safe(cat),
  fox: safe(fox),
  lantern: safe(lantern),
  imp: safe(imp),
  robot: safe(robot),
  jester: safe(jester),
  raven: safe(raven),
  spider: safe(spider),
  skull: safe(skull),
  drone: safe(drone),
};

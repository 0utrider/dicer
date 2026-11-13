import { mimic } from './mimic.js';
import { slime } from './slime.js';
import { dragonling } from './dragonling.js';

/**
 * The creatures. Each is (color: '#rrggbb') -> Creature, where a Creature is
 * { root, height, pose(phase, t, reaction, look: {yaw}), dispose() }.
 * - phase 'enter'|'throw'|'watch'|'react'|'exit'|'wobble'|'reform', t 0..1 within it (watch: t is 0,
 *   so idle motion runs on the creature's own clock; look.now, if given, replaces that clock for
 *   tests and screenshots). 'wobble' is a hit that does not splat it (a jiggle on top of the
 *   standing pose; the layer pushes it away); 'reform' is it pulling back together from a puddle
 *   (grows from flat). Both are handled here, for every creature, as a squash of the root.
 * - reaction 'crit'|'fumble'|'mixed'|'plain' (meaningful in react and exit; may be null).
 * - look.yaw is the yaw of the dice centre RELATIVE TO the body's current facing, in radians,
 *   clamped to +-0.6 and 0 outside watch/react: the head, eyes and pupils turn by it.
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
const smooth = (t) => t * t * (3 - 2 * t);
const safe = (make) => (color) => {
  const c = make(color);
  const pose = c.pose;
  c.pose = (phase, t, reaction, look) => {
    t = t > 0 ? (t < 1 ? t : 1) : 0;
    if (phase !== 'wobble' && phase !== 'reform') {
      c.root.scale.setScalar(1);
      return pose(phase, t, reaction, look);
    }
    pose('exit', 1, 'plain', NO_LOOK); // the standing pose, squashed below
    let sy;
    if (phase === 'wobble') sy = 1 - 0.22 * Math.sin(t * Math.PI * 3) * (1 - t); // a damped jiggle
    else sy = 0.03 + 0.97 * smooth(t < 0.15 ? 0 : (t - 0.15) / 0.85) + 0.08 * Math.sin(t * Math.PI) * t; // grows from flat, with a little overshoot
    const sxz = Math.min(1.8, 1 / Math.sqrt(sy));
    c.root.scale.set(sxz, sy, sxz);
  };
  return c;
};

export const CREATURES = { mimic: safe(mimic), slime: safe(slime), dragonling: safe(dragonling) };

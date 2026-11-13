import { mimic } from './mimic.js';
import { slime } from './slime.js';
import { dragonling } from './dragonling.js';

/**
 * The creatures. Each is (color: '#rrggbb') -> Creature, where a Creature is
 * { root, height, pose(phase, t, reaction, look: {yaw}), dispose() }.
 * - phase 'enter'|'throw'|'watch'|'react'|'exit', t 0..1 within it (watch: t is 0, so idle motion
 *   runs on the creature's own clock; look.now, if given, replaces that clock for tests and
 *   screenshots).
 * - reaction 'crit'|'fumble'|'mixed'|'plain' (meaningful in react and exit; may be null).
 * - look.yaw is the yaw of the dice centre RELATIVE TO the body's current facing, in radians,
 *   clamped to +-0.6 and 0 outside watch/react: the head, eyes and pupils turn by it.
 * The layer owns the root's position and turns the body; a creature only animates inside its
 * root. Its local forward (toward the dice) is +Z, up is +Y and it stands on y = 0.
 * height is the creature's standing body height (the layer scales its inset, hops and shadow by
 * it). For the mimic it is the closed chest: its open jaw rises above that (about 2.3 in watch),
 * so that its top-down footprint is as wide as the other pets' and a d20's.
 */
export const CREATURES = { mimic, slime, dragonling };

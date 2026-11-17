import { elementOf } from '../../effects/element-of.js';
import { ELEMENT_FX } from './element-fx.js';

/** A die with an element lands within this many die widths of a resting pet and the pet reacts. */
export const REACT_REACH = 2;

/**
 * The pose each element sets off (element-fx.js ELEMENT_FX: fire and lava scorch, frost, acid,
 * poison, void and spirit shiver, storm and sonic bristle, vitality wiggles happily, the rest
 * startle); an element it does not know startles.
 */
export const REACTION_OF = Object.freeze(Object.fromEntries(Object.entries(ELEMENT_FX).map(([el, fx]) => [el, fx.pose])));
export const reactionOf = (element) => REACTION_OF[element] ?? 'startle';

/**
 * Whether a pet may react to a die landing by it: settled at its spot (not hopping, throwing,
 * down or wobbling) and not huffy (mid-huff or in its ignore window). A pet being petted may: the
 * reaction replaces its wiggle.
 */
export const resting = (pet) => pet.state === 'rest' && !pet.gone && !pet.wobble && !pet.huff;

/**
 * The elemental reactions to one landing: for each resting pet, the nearest die with an element
 * within REACT_REACH x `dieWidth` of it on the table (x, z), at most one per pet. A ghost die
 * never counts (its element would leak what this viewer may not see; Task 1 strips its appearance
 * and damage type anyway). Dice are DiceBox's landed dice ({ x, z, appearance, damageType, ghost });
 * a pet's place is px/pz (base before its first frame).
 * @returns {Array<{ pet: object, element: string, from: { x: number, z: number } }>}
 */
export function elementReactions(dice, pets, { dieWidth = 1 } = {}) {
  const out = [];
  const reach = REACT_REACH * dieWidth;
  const hot = [];
  for (const d of dice || []) {
    if (!d || d.ghost || !Number.isFinite(d.x) || !Number.isFinite(d.z)) continue;
    // the damage type alone: a die that only looks fiery (a lava or fire inside) is no fire
    const element = elementOf(null, d.damageType);
    if (element) hot.push({ d, element });
  }
  if (!hot.length) return out;
  for (const pet of pets || []) {
    if (!pet || !resting(pet)) continue;
    const x = pet.px ?? pet.base?.x;
    const z = pet.pz ?? pet.base?.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    let best = null;
    let bestD = Infinity;
    for (const h of hot) {
      const dist = Math.hypot(h.d.x - x, h.d.z - z);
      if (dist <= reach && dist < bestD) {
        best = h;
        bestD = dist;
      }
    }
    if (best) out.push({ pet, element: best.element, from: { x: best.d.x, z: best.d.z } });
  }
  return out;
}

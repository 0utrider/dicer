import { dieTypeForFaces } from '../core/dice-shapes.js';

/**
 * @typedef {{kind:'glyph', text:string}|{kind:'text', text:string}|{kind:'image', url:string}|{kind:'blank'}} FaceLabel
 * @typedef {{ key: string, labels: FaceLabel[] }} FaceSet indexed like getShape(type).values
 * @typedef {{ type: string, value: number, variant?: 'd100tens', appearance?: object,
 *   faces?: FaceSet, ghost?: boolean, model?: string,
 *   fx?: import('../effects/fx-resolver.js').Fx[], damageType?: string }} DieSpec
 *   `fx` and `damageType` are result-dependent: set only for real views (never on a ghost).
 */

/** The dice one result throws: a d100 is a tens d10 plus a ones d10. */
function diceFor(faces, r, shape) {
  if (shape) return [{ type: shape, value: r }];
  if (faces === 100) {
    return [
      { type: 'd10', value: Math.floor((r % 100) / 10) * 10, variant: 'd100tens' },
      { type: 'd10', value: r % 10 || 10 },
    ];
  }
  const type = dieTypeForFaces(faces);
  return type ? [{ type, value: r }] : null;
}

/**
 * Turns a Foundry Roll into the dice to throw. Hidden results are not thrown; unsupported
 * faces and dice beyond maxDice are counted in `skipped`. With showExtra false, discarded and
 * inactive results are not thrown (and not counted). `decorate(term, result, termIndex)` returns
 * a partial DieSpec merged into every die of that result (both dice of a d100); type, value and
 * variant are never overwritten, and a throwing decorate warns once and leaves the die as is.
 * `shapeFor(term)` returns a base die type (or null) and is consulted before the face count.
 * @returns {{ dice: DieSpec[], skipped: number }}
 */
export function planThrow(roll, { maxDice = 20, showExtra = true, decorate, shapeFor } = {}) {
  const dice = [];
  let skipped = 0;
  let warned = false;
  const decorateSafely = (term, res, termIndex) => {
    try {
      return decorate(term, res, termIndex);
    } catch (err) {
      if (!warned) {
        warned = true;
        console.warn('dicer: a die decorator threw; the die is shown undecorated', err);
      }
      return null;
    }
  };
  const shapeOf = (term) => {
    try {
      return shapeFor?.(term) || null;
    } catch {
      return null;
    }
  };
  (roll?.dice ?? []).forEach((term, termIndex) => {
    for (const res of term.results ?? []) {
      if (res.hidden) continue;
      if (!showExtra && (res.discarded === true || res.active === false)) continue;
      let out = diceFor(term.faces, res.result, shapeOf(term));
      const extra = out && decorate ? decorateSafely(term, res, termIndex) : null;
      if (out && extra) {
        out = out.map((d) => {
          const merged = { ...d, ...extra, type: d.type, value: d.value };
          if (d.variant) merged.variant = d.variant;
          else delete merged.variant;
          return merged;
        });
      }
      if (!out) skipped += 1;
      else if (dice.length + out.length > maxDice) skipped += out.length;
      else dice.push(...out);
    }
  });
  return { dice, skipped };
}

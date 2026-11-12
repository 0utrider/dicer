import { dieTypeForFaces, dsnTypeOf } from '../core/dice-shapes.js';
import { FATE_FACES } from '../compat/faces.js';

/**
 * @typedef {{kind:'glyph', text:string}|{kind:'text', text:string}|{kind:'image', url:string}|{kind:'blank'}} FaceLabel
 * @typedef {{ key: string, labels: FaceLabel[] }} FaceSet indexed like getShape(type).values
 * @typedef {{ type: string, value: number, variant?: 'd100tens'|'dF'|'d3'|'d5'|'d7', appearance?: object,
 *   faces?: FaceSet, ghost?: boolean, model?: string,
 *   fx?: import('../effects/fx-resolver.js').Fx[], damageType?: string }} DieSpec
 *   `fx` and `damageType` are result-dependent: set only for real views (never on a ghost).
 */

/** The die a dN without its own shape is thrown on: face v or v + N shows v (labelFor). */
const RELABEL = { 3: 'd6', 5: 'd10', 7: 'd14' };
/** Fate result -1 / 0 / +1 -> d6 face, [even, odd] result index (FATE_FACES: 1, 2 +; 3, 4 blank; 5, 6 -). */
const FATE = [[6, 5], [3, 4], [1, 2]];

/**
 * The dice one result throws: a d100 is a tens d10 plus a ones d10. `odd` is the result's index
 * in its term mod 2: a relabelled die picks between its two faces by it, never by chance, so
 * every client and ghost shows the same face.
 */
function diceFor(term, r, shape, odd) {
  const faces = term.faces;
  // Before shapeFor: a DSN preset aliases df onto the d6, whose faces cannot show -1 or 0.
  if (dsnTypeOf(term) === 'df') {
    const value = FATE[r + 1]?.[odd];
    return value ? [{ type: 'd6', value, variant: 'dF', faces: FATE_FACES }] : null;
  }
  if (shape) return [{ type: shape, value: r }];
  if (faces === 100) {
    return [
      { type: 'd10', value: Math.floor((r % 100) / 10) * 10, variant: 'd100tens' },
      { type: 'd10', value: r % 10 || 10 },
    ];
  }
  if (RELABEL[faces]) return [{ type: RELABEL[faces], value: r + odd * faces, variant: `d${faces}` }];
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
 * A Fate die (dsnTypeOf 'df') and a d3 / d5 / d7 are thrown as relabelled d6 / d6 / d10 / d14.
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
    (term.results ?? []).forEach((res, i) => {
      if (res.hidden) return;
      if (!showExtra && (res.discarded === true || res.active === false)) return;
      let out = diceFor(term, res.result, shapeOf(term), i & 1);
      const extra = out && decorate ? decorateSafely(term, res, termIndex) : null;
      if (out && extra) {
        out = out.map((d) => {
          const merged = { ...d, ...extra, type: d.type, value: d.value };
          if (d.variant) merged.variant = d.variant;
          else delete merged.variant;
          // A relabelled die (dF, d3, d5, d7) keeps its own faces: a preset's fit another shape.
          if (d.faces) merged.faces = d.faces;
          else if (d.variant && d.variant !== 'd100tens') delete merged.faces;
          return merged;
        });
      }
      if (!out) skipped += 1;
      else if (dice.length + out.length > maxDice) skipped += out.length;
      else dice.push(...out);
    });
  });
  return { dice, skipped };
}

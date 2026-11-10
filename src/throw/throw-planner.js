import { dieTypeForFaces } from '../core/dice-shapes.js';

/**
 * @typedef {{kind:'glyph', text:string}|{kind:'text', text:string}|{kind:'image', url:string}|{kind:'blank'}} FaceLabel
 * @typedef {{ key: string, labels: FaceLabel[] }} FaceSet indexed like getShape(type).values
 * @typedef {{ type: string, value: number, variant?: 'd100tens', appearance?: object,
 *   faces?: FaceSet, ghost?: boolean, model?: string }} DieSpec
 */

/** The dice one result throws: a d100 is a tens d10 plus a ones d10. */
function diceFor(faces, r) {
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
 * a partial DieSpec merged into every die of that result (both dice of a d100).
 * @returns {{ dice: DieSpec[], skipped: number }}
 */
export function planThrow(roll, { maxDice = 20, showExtra = true, decorate } = {}) {
  const dice = [];
  let skipped = 0;
  (roll?.dice ?? []).forEach((term, termIndex) => {
    for (const res of term.results ?? []) {
      if (res.hidden) continue;
      if (!showExtra && (res.discarded === true || res.active === false)) continue;
      let out = diceFor(term.faces, res.result);
      const extra = out && decorate ? decorate(term, res, termIndex) : null;
      if (out && extra) out = out.map((d) => ({ ...d, ...extra, type: d.type, value: d.value }));
      if (!out) skipped += 1;
      else if (dice.length + out.length > maxDice) skipped += out.length;
      else dice.push(...out);
    }
  });
  return { dice, skipped };
}

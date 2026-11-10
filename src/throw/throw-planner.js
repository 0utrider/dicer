import { dieTypeForFaces } from '../core/dice-shapes.js';

/**
 * @typedef {{ type: string, value: number, variant?: 'd100tens' }} DieSpec
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
 * faces and dice beyond maxDice are counted in `skipped`.
 * @returns {{ dice: DieSpec[], skipped: number }}
 */
export function planThrow(roll, { maxDice = 20 } = {}) {
  const dice = [];
  let skipped = 0;
  for (const term of roll?.dice ?? []) {
    for (const res of term.results ?? []) {
      if (res.hidden) continue;
      const out = diceFor(term.faces, res.result);
      if (!out) skipped += 1;
      else if (dice.length + out.length > maxDice) skipped += out.length;
      else dice.push(...out);
    }
  }
  return { dice, skipped };
}

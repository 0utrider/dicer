/**
 * Foundry-like evaluated rolls for the ghost tests: `dice`/`terms` are live term objects (their
 * class carries DENOMINATION, as Foundry's Coin and FateDie do) and `toJSON` returns what
 * Foundry serializes (a dynamic count or face count adds `_number` / `_faces`).
 */
export class Die {
  static DENOMINATION = 'd';
  constructor(data) {
    Object.assign(this, data);
  }
}

export class Coin extends Die {
  static DENOMINATION = 'c';
}

const ok = (result) => ({ result, active: true });

export function foundryRoll(...terms) {
  return {
    dice: terms,
    terms,
    toJSON: () => ({
      class: 'Roll',
      formula: '',
      terms: terms.map((t) => ({ class: t.constructor.name, ...structuredClone({ ...t }) })),
      evaluated: true,
    }),
  };
}

/** 1d6x that rolled 6, 6, 2. */
export const explodingD6 = () =>
  foundryRoll(
    new Die({
      number: 1,
      faces: 6,
      modifiers: ['x'],
      results: [
        { result: 6, active: true, exploded: true },
        { result: 6, active: true, exploded: true },
        ok(2),
      ],
    }),
  );

/** 1d20r1 that rolled 1, then 14. */
export const rerolledD20 = () =>
  foundryRoll(
    new Die({
      number: 1,
      faces: 20,
      modifiers: ['r1'],
      results: [{ result: 1, active: false, rerolled: true }, ok(14)],
    }),
  );

/** (1d4)d6: the count is the inner roll's total (3), serialized with `_number`. */
export const dynamicCountD6 = () =>
  foundryRoll(
    new Die({
      number: 3,
      _number: { class: 'Roll', formula: '1d4' },
      faces: 6,
      results: [ok(4), ok(5), ok(1)],
    }),
  );

/** 1dc that rolled heads. */
export const coin = () => foundryRoll(new Coin({ number: 1, faces: 2, results: [ok(2)] }));

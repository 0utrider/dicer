import { planThrow } from '../../src/throw/throw-planner.js';
import { coin } from './foundry-roll.js';

const term = (faces, results) => ({
  faces,
  results: results.map((r) => (typeof r === 'number' ? { result: r, active: true } : r)),
});

test('basic dice', () => {
  expect(planThrow({ dice: [term(20, [17]), term(6, [3, 4])] }).dice).toEqual([
    { type: 'd20', value: 17 },
    { type: 'd6', value: 3 },
    { type: 'd6', value: 4 },
  ]);
});
test('d100 becomes tens + ones', () => {
  expect(planThrow({ dice: [term(100, [47, 100, 10])] }).dice).toEqual([
    { type: 'd10', value: 40, variant: 'd100tens' },
    { type: 'd10', value: 7 },
    { type: 'd10', value: 0, variant: 'd100tens' },
    { type: 'd10', value: 10 },
    { type: 'd10', value: 10, variant: 'd100tens' },
    { type: 'd10', value: 10 },
  ]);
});
test('unsupported counts (d9) still skipped', () => {
  expect(planThrow({ dice: [term(9, [3]), term(11, [2])] })).toEqual({ dice: [], skipped: 2 });
});

test('a Foundry coin (0 tails / 1 heads) is thrown as the d2 on face 2 / 1; other results are skipped', () => {
  const heads = planThrow(coin(1)).dice;
  const tails = planThrow(coin(0)).dice;
  expect(heads).toEqual([{ type: 'd2', value: 1, variant: 'dc' }]);
  expect(tails).toEqual([{ type: 'd2', value: 2, variant: 'dc' }]);
  expect(planThrow(coin(2))).toEqual({ dice: [], skipped: 1 });
  // A preset aliasing the coin onto another shape still shows face 1 / 2.
  expect(planThrow(coin(0), { shapeFor: () => 'd6' }).dice).toEqual([{ type: 'd6', value: 2, variant: 'dc' }]);
  // A decorator's faces stay on the coin (a preset's heads / tails labels).
  const faces = { key: 'k', labels: [] };
  expect(planThrow(coin(1), { decorate: () => ({ faces }) }).dice[0].faces).toBe(faces);
  // A plain 1d2 (results 1 / 2) is unchanged.
  expect(planThrow({ dice: [term(2, [2])] }).dice).toEqual([{ type: 'd2', value: 2 }]);
});

/** Modelled on Foundry v14's FateDie: DENOMINATION 'f', faces 3, minValue -1, results -1..1. */
class FateDie {
  static DENOMINATION = 'f';
  constructor(results) {
    this.faces = 3;
    this.minValue = -1;
    this.results = results.map((r) => ({ result: r, active: true }));
  }
}

test('dF, d3, d5, d7, d14, d16 are thrown with the table\'s type/variant/value; the face choice follows the result index', () => {
  const { dice, skipped } = planThrow({
    dice: [
      new FateDie([1, 1, 0, 0, -1, -1]),
      term(3, [2, 2]),
      term(5, [5, 5]),
      term(7, [7, 1]),
      term(14, [14]),
      term(16, [16]),
    ],
  });
  expect(skipped).toBe(0);
  const fate = dice.slice(0, 6);
  expect(fate.map((d) => [d.type, d.variant, d.value])).toEqual([
    ['d6', 'dF', 1],
    ['d6', 'dF', 2],
    ['d6', 'dF', 3],
    ['d6', 'dF', 4],
    ['d6', 'dF', 6],
    ['d6', 'dF', 5],
  ]);
  expect(fate.every((d) => d.faces === fate[0].faces && d.faces.labels.length === 6)).toBe(true);
  expect(dice.slice(6)).toEqual([
    { type: 'd6', value: 2, variant: 'd3' },
    { type: 'd6', value: 5, variant: 'd3' },
    { type: 'd10', value: 5, variant: 'd5' },
    { type: 'd10', value: 10, variant: 'd5' },
    { type: 'd14', value: 7, variant: 'd7' },
    { type: 'd14', value: 8, variant: 'd7' },
    { type: 'd14', value: 14 },
    { type: 'd16', value: 16 },
  ]);
  // Deterministic: the same roll plans the same faces every time (sync, ghosts).
  expect(planThrow({ dice: [new FateDie([0, -1]), term(7, [3, 3])] }).dice.map((d) => d.value)).toEqual(
    planThrow({ dice: [new FateDie([0, -1]), term(7, [3, 3])] }).dice.map((d) => d.value),
  );
  // A DSN preset aliasing df onto the d6 still throws the Fate die (a d6 cannot show -1).
  expect(planThrow({ dice: [new FateDie([-1])] }, { shapeFor: () => 'd6' }).dice).toEqual([
    { type: 'd6', value: 6, variant: 'dF', faces: fate[0].faces },
  ]);
  // A Fate result out of range is skipped, never thrown on a wrong face.
  expect(planThrow({ dice: [new FateDie([2])] })).toEqual({ dice: [], skipped: 1 });
});

test('the face choice follows the index in term.results, hidden and discarded results included', () => {
  const t = term(3, [{ result: 1, active: true, hidden: true }, { result: 1, active: false }, 1]);
  expect(planThrow({ dice: [t] }, { showExtra: false }).dice).toEqual([
    { type: 'd6', value: 1, variant: 'd3' },
  ]);
  expect(planThrow({ dice: [t] }).dice.map((d) => d.value)).toEqual([4, 1]);
});

test('a relabelled result outside 1..n is skipped, never thrown on a wrong face', () => {
  // A legacy show() sends a Fate die as a plain 3-faced Die: its -1 / 0 / +1 meet the d3 path.
  expect(planThrow({ dice: [term(3, [-1, 0, 1, 4]), term(5, [6]), term(7, [8, 7])] })).toEqual({
    dice: [
      { type: 'd6', value: 1, variant: 'd3' },
      { type: 'd14', value: 14, variant: 'd7' },
    ],
    skipped: 5,
  });
});

test('a mixed roll counts skipped correctly', () => {
  const roll = { dice: [term(20, [17]), new FateDie([1]), term(7, [4]), term(16, [9]), term(9, [3]), term(100, [55])] };
  const { dice, skipped } = planThrow(roll);
  expect(skipped).toBe(1);
  expect(dice.map((d) => d.variant ?? d.type)).toEqual(['d20', 'dF', 'd7', 'd16', 'd100tens', 'd10']);
  expect(planThrow(roll, { maxDice: 4 }).skipped).toBe(3); // the d9 and both d100 dice
});

test('the d100 pair is unchanged', () => {
  expect(planThrow({ dice: [term(100, [47])] }).dice).toEqual([
    { type: 'd10', value: 40, variant: 'd100tens' },
    { type: 'd10', value: 7 },
  ]);
});

test('decorate keeps a relabelled die\'s variant and its own faces', () => {
  const decorate = () => ({ appearance: { n: 1 }, faces: { key: 'preset', labels: [] }, variant: 'x' });
  const [fate, d3] = planThrow({ dice: [new FateDie([0]), term(3, [1])] }, { decorate }).dice;
  expect(fate.variant).toBe('dF');
  expect(fate.faces.key).not.toBe('preset');
  expect(fate.appearance).toEqual({ n: 1 });
  expect(d3).toEqual({ type: 'd6', value: 1, variant: 'd3', appearance: { n: 1 } });
});
test('hidden results are not thrown', () => {
  expect(
    planThrow({ dice: [term(6, [{ result: 2, active: true, hidden: true }, 5])] }).dice,
  ).toEqual([{ type: 'd6', value: 5 }]);
});
test('100d6 is capped at maxDice', () => {
  const r = planThrow({ dice: [term(6, Array(100).fill(1))] }, { maxDice: 20 });
  expect(r.dice.length).toBe(20);
  expect(r.skipped).toBe(80);
});

test('decorate output is merged into each die, both dice of a d100', () => {
  const decorate = vi.fn((t, r, i) => ({ appearance: { n: i }, ghost: r.result === 47 }));
  const { dice } = planThrow({ dice: [term(6, [3]), term(100, [47])] }, { decorate });
  expect(dice).toEqual([
    { type: 'd6', value: 3, appearance: { n: 0 }, ghost: false },
    { type: 'd10', value: 40, variant: 'd100tens', appearance: { n: 1 }, ghost: true },
    { type: 'd10', value: 7, appearance: { n: 1 }, ghost: true },
  ]);
  expect(decorate).toHaveBeenCalledWith(
    expect.objectContaining({ faces: 6 }),
    expect.anything(),
    0,
  );
});
test('decorate returning null leaves the die alone and cannot change type or value', () => {
  expect(planThrow({ dice: [term(6, [3])] }, { decorate: () => null }).dice).toEqual([
    { type: 'd6', value: 3 },
  ]);
  expect(
    planThrow({ dice: [term(6, [3])] }, { decorate: () => ({ type: 'd20', value: 9 }) }).dice,
  ).toEqual([{ type: 'd6', value: 3 }]);
});
test('decorate cannot overwrite the d100 tens variant', () => {
  const { dice } = planThrow(
    { dice: [term(100, [40])] },
    { decorate: () => ({ variant: 'x', appearance: { n: 1 } }) },
  );
  expect(dice.map((d) => d.variant)).toEqual(['d100tens', undefined]);
  expect(dice[1]).not.toHaveProperty('variant');
});
test('a throwing decorate warns once and leaves the dice undecorated', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const decorate = () => {
    throw new Error('boom');
  };
  const { dice } = planThrow({ dice: [term(6, [3, 4])] }, { decorate });
  expect(dice).toEqual([
    { type: 'd6', value: 3 },
    { type: 'd6', value: 4 },
  ]);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});
test('shapeFor is consulted first; null falls back to the face count', () => {
  const shapeFor = vi.fn((t) => (t.faces === 7 ? 'd8' : null));
  const roll = { dice: [term(7, [3]), term(6, [2]), term(100, [40])] };
  const { dice, skipped } = planThrow(roll, { shapeFor });
  expect(dice.map((d) => d.type)).toEqual(['d8', 'd6', 'd10', 'd10']);
  expect(dice[0]).toEqual({ type: 'd8', value: 3 });
  expect(skipped).toBe(0);
  expect(planThrow({ dice: [term(9, [3])] }, { shapeFor: () => null })).toEqual({
    dice: [],
    skipped: 1,
  });
});
test('showExtra false drops discarded and inactive results without counting them skipped', () => {
  const roll = {
    dice: [
      term(6, [
        { result: 1, active: true },
        { result: 2, active: false },
        { result: 3, active: true, discarded: true },
        { result: 4, active: true },
      ]),
    ],
  };
  expect(planThrow(roll, { showExtra: false })).toEqual({
    dice: [
      { type: 'd6', value: 1 },
      { type: 'd6', value: 4 },
    ],
    skipped: 0,
  });
  expect(planThrow(roll).dice.length).toBe(4);
});

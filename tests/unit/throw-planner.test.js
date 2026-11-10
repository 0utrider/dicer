import { planThrow } from '../../src/throw/throw-planner.js';

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
test('unsupported faces are skipped', () => {
  expect(planThrow({ dice: [term(7, [3]), term(3, [2])] })).toEqual({ dice: [], skipped: 2 });
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
  expect(planThrow({ dice: [term(7, [3])] }, { shapeFor: () => null })).toEqual({
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

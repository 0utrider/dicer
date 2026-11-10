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

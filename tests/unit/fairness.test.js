import { expect, test } from 'vitest';
import { chiSquare, FAIR_TYPES, runFairness } from '../../scripts/fairness.mjs';
import { HAND_UNFAIR } from '../../src/hand/unfair.js';

// The full 10,000-throw run is `npm run test:fairness` (P6-D6: the fairness script stays
// separate from the suite). These are its fast, fixed-seed regression checks.

test('chiSquare matches known values (df 5, stat 11.07 -> p ~0.05)', () => {
  // Six faces of 100 expected each; deviations chosen so stat = 11.07 (the 5 % critical value).
  const e = 100;
  const d = Math.sqrt((11.07 * e) / 2);
  const r = chiSquare([e + d, e - d, e, e, e, e]);
  expect(r.df).toBe(5);
  expect(r.stat).toBeCloseTo(11.07, 6);
  expect(r.p).toBeCloseTo(0.05, 3);
  // More table values: df 1 at 3.841 -> 0.05, df 19 at 36.191 -> 0.01, df 3 at 0.584 -> 0.90.
  const at = (df, stat) => {
    const k = df + 1;
    const dev = Math.sqrt((stat * 1000) / 2);
    return chiSquare([1000 + dev, 1000 - dev, ...Array(k - 2).fill(1000)]).p;
  };
  expect(at(1, 3.841)).toBeCloseTo(0.05, 3);
  expect(at(19, 36.191)).toBeCloseTo(0.01, 4);
  expect(at(3, 0.584)).toBeCloseTo(0.9, 3);
  expect(at(9, 40)).toBeLessThan(1e-5);
});

test('uniform counts -> p ~1', () => {
  const r = chiSquare(Array(20).fill(50));
  expect(r.stat).toBe(0);
  expect(r.df).toBe(19);
  expect(r.p).toBeCloseTo(1, 10);
});

test('smoke: d6 600 throws and d20 1,200 throws, fixed seeds, p > 0.001', async () => {
  const r = await runFairness({ types: ['d6', 'd20'], throws: 600, seed0: 1 });
  expect(r.d6.counts.reduce((s, c) => s + c, 0)).toBe(600);
  expect(r.d6.p).toBeGreaterThan(0.001);
  const r20 = await runFairness({ types: ['d20'], throws: 1200, seed0: 2 });
  expect(r20.d20.counts).toHaveLength(20);
  expect(r20.d20.p).toBeGreaterThan(0.001);
  // Every throw is read: no die is left cocked after its nudges.
  expect(r.d6.cocked + r20.d20.cocked).toBe(0);
}, 60000);

test('smoke: d16 1,600 throws p > 0.001', async () => {
  const r = await runFairness({ types: ['d16'], throws: 1600, seed0: 3 });
  expect(r.d16.counts).toHaveLength(16);
  expect(r.d16.p).toBeGreaterThan(0.001);
}, 60000);

test('the same seeds give the same counts', async () => {
  const a = await runFairness({ types: ['d2'], throws: 40, seed0: 9 });
  const b = await runFairness({ types: ['d2'], throws: 40, seed0: 9 });
  expect(a).toEqual(b);
  expect(a.d2.rimRate).toBeGreaterThanOrEqual(0);
});

test('HAND_UNFAIR lists only fairness-run shapes', () => {
  expect(Array.isArray(HAND_UNFAIR)).toBe(true);
  for (const t of HAND_UNFAIR) expect(FAIR_TYPES).toContain(t);
});

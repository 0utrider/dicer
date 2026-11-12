import { summarize, TARGETS } from '../../src/bench/stats.js';

test('summarize uses nearest-rank percentiles', () => {
  const s = summarize(Array.from({ length: 100 }, (_, i) => i + 1));
  expect(s).toEqual({ n: 100, mean: 50.5, p50: 50, p95: 95, p99: 99, max: 100 });
});

test('summarize returns null for empty or non-finite input', () => {
  expect(summarize([])).toBeNull();
  expect(summarize([NaN])).toBeNull();
  expect(summarize(undefined)).toBeNull();
});

test('summarize drops non-finite samples', () => {
  expect(summarize([1, NaN, 3, Infinity]).n).toBe(2);
});

test('TARGETS is frozen with the G2 values', () => {
  expect(Object.isFrozen(TARGETS)).toBe(true);
  expect(TARGETS).toEqual({
    frameP95Ms: 16.7, longTaskMs: 50, firstFrameMs: 50, bigPoolVisibleMs: 100,
    heapGrowthBytes: 2 * 1024 * 1024, heapGrowthRatio: 0.05, clearlyLessRatio: 0.9,
    h2hRatio: 1.1,
  });
});

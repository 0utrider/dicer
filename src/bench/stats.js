/** Pure measurement maths for the benchmark. No imports. */

export const TARGETS = Object.freeze({
  frameP95Ms: 16.7,
  longTaskMs: 50,
  firstFrameMs: 50,
  bigPoolVisibleMs: 100,
  heapGrowthBytes: 2 * 1024 * 1024,
  heapGrowthRatio: 0.05,
  clearlyLessRatio: 0.9,
  // P9-R20 (owner's decision): the head-to-head passes within 10% of DSN, the margin the
  // benchmark resolves (identical runs vary by up to about 20%).
  h2hRatio: 1.1,
});

function rank(sorted, p) {
  const i = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[i - 1];
}

/** Nearest-rank summary; null when there is no finite sample. */
export function summarize(samples) {
  if (!Array.isArray(samples)) return null;
  const s = samples.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const sum = s.reduce((a, b) => a + b, 0);
  return { n: s.length, mean: sum / s.length, p50: rank(s, 50), p95: rank(s, 95), p99: rank(s, 99), max: s[s.length - 1] };
}

import { checkTargets, compare, summaryText } from '../../src/bench/report.js';

const MB = 1024 * 1024;
const sum = (p95) => ({ n: 10, mean: p95, p50: p95, p95, p99: p95, max: p95 });
const base = (o = {}) => ({
  scenario: 's', product: 'dicer', profile: 'vsync', kind: 'typical', rolls: 1, failures: 0,
  frame: null, longTasks: null, firstFrame: null, dicerFirstFrame: null,
  heap: null, resources: null, notes: [], ...o,
});
const get = (checks, id) => checks.find((c) => c.id === id);

test('frame p95 target', () => {
  expect(get(checkTargets(base({ frame: sum(16.8) })), 'frameP95Ms').pass).toBe(false);
  expect(get(checkTargets(base({ frame: sum(16.7) })), 'frameP95Ms').pass).toBe(true);
});

test('long task target', () => {
  expect(get(checkTargets(base({ longTasks: { count: 1, maxMs: 51 } })), 'longTaskMs').pass).toBe(false);
  expect(get(checkTargets(base({ longTasks: { count: 1, maxMs: 50 } })), 'longTaskMs').pass).toBe(true);
});

test('first frame: typical vs bigPool', () => {
  expect(get(checkTargets(base({ firstFrame: sum(50) })), 'firstFrameMs').pass).toBe(true);
  expect(get(checkTargets(base({ firstFrame: sum(51) })), 'firstFrameMs').pass).toBe(false);
  const big = checkTargets(base({ kind: 'bigPool', firstFrame: sum(101) }));
  expect(get(big, 'bigPoolVisibleMs').pass).toBe(false);
  expect(get(big, 'firstFrameMs')).toBeUndefined();
});

test('longTask and firstFrame checks skip burst and soak', () => {
  for (const kind of ['burst', 'soak']) {
    const c = checkTargets(base({ kind, longTasks: { count: 1, maxMs: 99 }, firstFrame: sum(500) }));
    expect(get(c, 'longTaskMs')).toBeUndefined();
    expect(get(c, 'firstFrameMs')).toBeUndefined();
    expect(get(c, 'bigPoolVisibleMs')).toBeUndefined();
  }
});

test('null values give pass null (n/a)', () => {
  const c = checkTargets(base());
  expect(get(c, 'frameP95Ms').pass).toBeNull();
  expect(get(c, 'longTaskMs').pass).toBeNull();
});

test('heap leak checks', () => {
  const heap = (before, after) => get(checkTargets(base({ heap: { before, after } })), 'heapGrowth');
  expect(heap(100 * MB, 102.1 * MB).pass).toBe(false);
  expect(heap(10 * MB, 10.6 * MB).pass).toBe(false);
  expect(heap(100 * MB, 101 * MB).pass).toBe(true);
});

test('resource leak checks', () => {
  const res = (a, b) => get(checkTargets(base({ resources: { before: a, after: b } })), 'resources');
  expect(res({ geometries: 40 }, { geometries: 41 }).pass).toBe(false);
  expect(res({ geometries: 40, textures: 3 }, { geometries: 40, textures: 3 }).pass).toBe(true);
});

test('compare', () => {
  const r = (p95) => base({ frame: sum(p95) });
  expect(compare(r(9), r(10), { requireClearlyLess: true })).toMatchObject({ ratio: 0.9, pass: true });
  expect(compare(r(9.5), r(10), { requireClearlyLess: true }).pass).toBe(false);
  expect(compare(r(10), r(10), { requireClearlyLess: false }).pass).toBe(true);
  expect(compare(r(11), r(10), { requireClearlyLess: false }).pass).toBe(false);
  expect(compare(base(), r(10), {}).pass).toBeNull();
});

const suite = (o = {}) => ({
  browser: 'Chrome 130', gpu: 'ANGLE (RTX)', tier: 'high', version: '1.0.0', profile: 'chromium',
  results: [base({ heap: null })], ...o,
});

test('summaryText prints n/a for null fields, never NaN/undefined', () => {
  const t = summaryText(suite());
  expect(t).toContain('n/a');
  expect(t).not.toMatch(/NaN|undefined/);
  expect(t.split('\n').length).toBeLessThanOrEqual(40);
  expect(t.split('\n')[0]).toContain('Chrome 130');
  expect(t).not.toContain('best effort');
});

test('summaryText flags best effort for firefox', () => {
  expect(summaryText(suite({ profile: 'firefox' }))).toContain('best effort');
});

test('summaryText caps at 40 lines', () => {
  const many = Array.from({ length: 80 }, () => base({ frame: sum(10) }));
  expect(summaryText(suite({ results: many })).split('\n').length).toBeLessThanOrEqual(40);
});

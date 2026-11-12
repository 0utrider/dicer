import { checkTargets, compare, compareBusy, summaryText } from '../../src/bench/report.js';

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

test('H-R10: Dicer first-frame and big-pool checks judge dicerFirstFrame when there is one', () => {
  const ff = get(checkTargets(base({ firstFrame: sum(70), dicerFirstFrame: sum(30) })), 'firstFrameMs');
  expect(ff).toMatchObject({ value: 30, pass: true, measure: 'dicerFirstFrame', info: { id: 'firstFrame', value: 70 } });
  const big = get(checkTargets(base({ kind: 'bigPool', firstFrame: sum(90), dicerFirstFrame: sum(120) })), 'bigPoolVisibleMs');
  expect(big).toMatchObject({ value: 120, pass: false, measure: 'dicerFirstFrame', info: { id: 'firstFrame', value: 90 } });
  // No gate timing (in-game, no message): the roll-call measure (H-D4) is judged.
  const fallback = get(checkTargets(base({ firstFrame: sum(40) })), 'firstFrameMs');
  expect(fallback).toMatchObject({ value: 40, pass: true, measure: 'firstFrame', info: { id: 'dicerFirstFrame', value: null } });
  // DSN results always use the product-neutral measure.
  const dsn = get(checkTargets(base({ product: 'dice-so-nice', firstFrame: sum(70), dicerFirstFrame: sum(30) })), 'firstFrameMs');
  expect(dsn).toMatchObject({ value: 70, measure: 'firstFrame' });
});

test('summaryText shows both first-frame measures when the gate timing exists', () => {
  const t = summaryText(suite({ results: [base({ firstFrame: sum(70), dicerFirstFrame: sum(30) })] }));
  expect(t).toContain('first 70.0 ms');
  expect(t).toContain('msg->frame 30.0 ms');
  expect(summaryText(suite())).not.toContain('msg->frame');
});

test('perturb kind: no frame, long-task or first-frame checks; recovered is checked when present', () => {
  const r = base({ kind: 'perturb', frame: sum(900), longTasks: { count: 1, maxMs: 300 }, firstFrame: sum(500) });
  expect(checkTargets(r)).toEqual([]);
  expect(get(checkTargets({ ...r, recovered: true }), 'recovered')).toMatchObject({ target: true, value: true, pass: true });
  expect(get(checkTargets({ ...r, recovered: false }), 'recovered').pass).toBe(false);
  expect(get(checkTargets({ ...r, recovered: null }), 'recovered').pass).toBeNull();
});

test('a refresh-limited display gives the frame check pass null, value kept', () => {
  const c = get(checkTargets(base({ frame: sum(33.3), refreshLimited: true })), 'frameP95Ms');
  expect(c).toMatchObject({ value: 33.3, pass: null });
});

test('summaryText prints suite notes under the header', () => {
  const t = summaryText(suite({ notes: ['display refresh below 60 Hz: frame checks n/a'] }));
  expect(t.split('\n')[1]).toBe('note: display refresh below 60 Hz: frame checks n/a');
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

// P9-R8: a tier change rebuilds textures and materials, so heap growth no longer means a leak.
test('heap growth is n/a when the tier changed during the scenario', () => {
  const heap = { before: 1e8, after: 1e8 + 5e6 };
  expect(get(checkTargets(base({ heap, tier: { before: 'ultra', after: 'low' } })), 'heapGrowth').pass).toBeNull();
  expect(get(checkTargets(base({ heap, tier: { before: 'ultra', after: 'ultra' } })), 'heapGrowth').pass).toBe(false);
  expect(get(checkTargets(base({ heap })), 'heapGrowth').pass).toBe(false);
});

test('non-finite heap readings are n/a, not a spurious FAIL', () => {
  for (const heap of [{ before: NaN, after: 5 }, { before: 5, after: undefined }, { before: Infinity, after: 1 }]) {
    const c = get(checkTargets(base({ heap })), 'heapGrowth');
    expect(c.pass).toBeNull();
    expect(c.value).toBeNull();
    const t = summaryText({ browser: 'Chrome', gpu: 'x', tier: 'a', version: '1', profile: 'vsync', results: [base({ heap })] });
    expect(t).not.toMatch(/NaN|FAIL/);
  }
});

test('summaryText prints each scenario note on its own line, within the 40-line cap', () => {
  const r = (scenario, notes) => ({ scenario, kind: 'typical', product: 'dicer', frame: { p95: 5 }, rolls: 1, failures: 0, notes });
  const text = summaryText({ results: [r('pool30', ['pool30 threw 20 of 30 dice (maxDice)', 'second'])] });
  const lines = text.split(String.fromCharCode(10));
  expect(lines).toContain('  note: pool30 threw 20 of 30 dice (maxDice)');
  expect(lines).toContain('  note: second');
  const many = summaryText({ results: Array.from({ length: 60 }, (_, i) => r(`s${i}`, ['n'])) });
  expect(many.split(String.fromCharCode(10)).length).toBeLessThanOrEqual(40);
});

// P9-R3: a tier change swaps programs and textures; the counts no longer indicate a leak.
test('resources check is n/a when the tier changed during the scenario', () => {
  const resources = { before: { geometries: 9, textures: 10, programs: 3 }, after: { geometries: 11, textures: 6, programs: 5 } };
  const changed = checkTargets(base({ kind: 'soak', resources, tier: { before: 'ultra', after: 'low' } }));
  expect(get(changed, 'resources')).toEqual({ id: 'resources', target: 0, value: 3, pass: null });
  const kept = checkTargets(base({ kind: 'soak', resources, tier: { before: 'ultra', after: 'ultra' } }));
  expect(get(kept, 'resources').pass).toBe(false);
});

// P9-R2: a side with failed (unanimated) rolls did not measure the same work.
test('compare: ratio shown, verdict n/a when either side has failures', () => {
  const d = base({ scenario: 'd20', frame: sum(1) });
  const s = base({ scenario: 'd20', product: 'dice-so-nice', frame: sum(4), failures: 1 });
  expect(compare(d, s, { requireClearlyLess: true })).toEqual({ scenario: 'd20', dicerP95: 1, dsnP95: 4, ratio: 0.25, pass: null });
  expect(compare({ ...d, failures: 2 }, { ...s, failures: 0 }).pass).toBeNull();
  expect(compare(d, { ...s, failures: 0 }).pass).toBe(true);
});

// P9-R13: the head-to-head compares main-thread busy ms per second at the display cap.
test('compareBusy: ratio on busy time, clearly-less limit, n/a without both or with failures', () => {
  const r = (msPerSec, o = {}) => base({ busy: { msPerSec }, frame: sum(6), ...o });
  expect(compareBusy(r(90), r(100), { requireClearlyLess: true })).toMatchObject({
    dicerBusy: 90, dsnBusy: 100, ratio: 0.9, pass: true, dicerP95: 6, dsnP95: 6,
  });
  expect(compareBusy(r(95), r(100), { requireClearlyLess: true }).pass).toBe(false);
  expect(compareBusy(r(100), r(100)).pass).toBe(true);
  expect(compareBusy(r(101), r(100)).pass).toBe(false);
  expect(compareBusy(base({ frame: sum(1) }), r(100))).toMatchObject({ ratio: null, pass: null });
  expect(compareBusy(r(50, { failures: 1 }), r(100))).toMatchObject({ ratio: 0.5, pass: null });
});

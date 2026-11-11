import { TARGETS } from './stats.js';

const EPS = 1e-9;

const check = (id, target, value, pass) => ({ id, target, value, pass: value == null ? null : pass });

/** G2 target checks for one ScenarioResult (vsync reports only, see H-R1/H-R5). */
export function checkTargets(r) {
  const out = [];
  const timed = r.kind === 'typical' || r.kind === 'bigPool';
  const fp95 = r.frame?.p95 ?? null;
  out.push(check('frameP95Ms', TARGETS.frameP95Ms, fp95, fp95 <= TARGETS.frameP95Ms));
  if (timed) {
    const lt = r.longTasks?.maxMs ?? null;
    out.push(check('longTaskMs', TARGETS.longTaskMs, lt, lt <= TARGETS.longTaskMs));
    const ff = r.firstFrame?.p95 ?? null;
    if (r.kind === 'bigPool') out.push(check('bigPoolVisibleMs', TARGETS.bigPoolVisibleMs, ff, ff <= TARGETS.bigPoolVisibleMs));
    else out.push(check('firstFrameMs', TARGETS.firstFrameMs, ff, ff <= TARGETS.firstFrameMs));
  }
  if (r.heap) {
    const growth = r.heap.after - r.heap.before;
    const ratio = r.heap.before > 0 ? growth / r.heap.before : growth > 0 ? Infinity : 0;
    out.push(check('heapGrowth', TARGETS.heapGrowthBytes, growth,
      growth <= TARGETS.heapGrowthBytes && ratio <= TARGETS.heapGrowthRatio));
  }
  if (r.resources) {
    const { before, after } = r.resources;
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    const diff = [...keys].filter((k) => (before?.[k] ?? 0) !== (after?.[k] ?? 0));
    out.push({ id: 'resources', target: 0, value: diff.length, pass: diff.length === 0 });
  }
  return out;
}

/** Head-to-head on frame p95. */
export function compare(dicer, dsn, { requireClearlyLess = false } = {}) {
  const d = dicer?.frame?.p95 ?? null;
  const s = dsn?.frame?.p95 ?? null;
  const scenario = dicer?.scenario ?? dsn?.scenario;
  if (d == null || s == null || !(s > 0)) return { scenario, dicerP95: d, dsnP95: s, ratio: null, pass: null };
  const ratio = d / s;
  const limit = requireClearlyLess ? TARGETS.clearlyLessRatio : 1;
  return { scenario, dicerP95: d, dsnP95: s, ratio, pass: ratio <= limit + EPS };
}

const num = (v, digits = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : 'n/a');
const mb = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${(v / 1048576).toFixed(2)} MiB` : 'n/a');
const verdict = (p) => (p === null ? 'n/a' : p ? 'PASS' : 'FAIL');

/** Plain-text summary, at most 40 lines. */
export function summaryText(suite) {
  const profile = suite.profile ?? 'n/a';
  const browser = String(suite.browser ?? '');
  const bestEffort = /firefox|safari/i.test(String(profile)) || (/firefox|safari/i.test(browser) && !/chrom|edg/i.test(browser));
  const head = `Dicer benchmark | ${suite.browser ?? 'n/a'} | GPU ${suite.gpu ?? 'n/a'} | tier ${suite.tier ?? 'n/a'} | Dicer ${suite.version ?? 'n/a'} | profile ${profile}`;
  const lines = [bestEffort ? `${head} | best effort` : head];
  for (const r of suite.results ?? []) {
    const checks = checkTargets(r);
    const failed = checks.filter((c) => c.pass === false).map((c) => c.id);
    const bits = [
      `frame p95 ${num(r.frame?.p95)} ms`,
      `long ${num(r.longTasks?.maxMs, 0)} ms`,
      `first ${num(r.firstFrame?.p95)} ms`,
      `heap ${r.heap ? mb(r.heap.after - r.heap.before) : 'n/a'}`,
      `rolls ${r.rolls ?? 'n/a'}`,
      `fail ${r.failures ?? 'n/a'}`,
    ];
    const v = failed.length ? `FAIL (${failed.join(', ')})` : verdict(checks.some((c) => c.pass === true) ? true : null);
    lines.push(`${r.scenario} [${r.product}]: ${bits.join(', ')} -> ${v}`);
  }
  if (lines.length > 40) {
    const extra = lines.length - 39;
    lines.length = 39;
    lines.push(`... ${extra} more lines omitted`);
  }
  return lines.join('\n');
}

export function comparisonMarkdown(rows) {
  const out = ['| Scenario | Dicer p95 (ms) | DSN p95 (ms) | Ratio | Result |', '| --- | --- | --- | --- | --- |'];
  for (const r of rows ?? []) {
    out.push(`| ${r.scenario ?? 'n/a'} | ${num(r.dicerP95, 2)} | ${num(r.dsnP95, 2)} | ${num(r.ratio, 2)} | ${verdict(r.pass)} |`);
  }
  return out.join('\n');
}

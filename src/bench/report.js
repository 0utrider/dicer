import { TARGETS } from './stats.js';

const EPS = 1e-9;

const check = (id, target, value, pass) => ({ id, target, value, pass: value == null ? null : pass });

/**
 * The first-frame measure a result is judged on (H-R10). For Dicer, dicerFirstFrame (the message
 * gate intercepting the message -> its first drawn frame: G2's "message arriving") when it exists;
 * otherwise firstFrame (roll call -> first frame, H-D4, the product-neutral head-to-head measure).
 * `info` carries the other measure so reports can show both.
 */
export function firstFrameMeasure(r) {
  const roll = r?.firstFrame?.p95 ?? null;
  const gate = r?.product === 'dicer' ? (r?.dicerFirstFrame?.p95 ?? null) : null;
  if (gate != null) return { measure: 'dicerFirstFrame', value: gate, info: { id: 'firstFrame', value: roll } };
  return { measure: 'firstFrame', value: roll, info: { id: 'dicerFirstFrame', value: gate } };
}

/**
 * G2 target checks for one ScenarioResult (vsync reports only, see H-R1/H-R5).
 * - frameP95Ms on every kind but perturb; pass null when `refreshLimited` (display below 60 Hz).
 * - longTaskMs and firstFrameMs / bigPoolVisibleMs on typical and bigPool only.
 * - perturb (resize, contextLoss, hidden): only `recovered` here, when the result has it; the
 *   harness adds failures and noRebuild.
 */
export function checkTargets(r) {
  const out = [];
  const timed = r.kind === 'typical' || r.kind === 'bigPool';
  if (r.kind !== 'perturb') {
    const fp95 = r.frame?.p95 ?? null;
    const c = check('frameP95Ms', TARGETS.frameP95Ms, fp95, fp95 <= TARGETS.frameP95Ms);
    if (r.refreshLimited) c.pass = null;
    out.push(c);
  }
  if (timed) {
    const lt = r.longTasks?.maxMs ?? null;
    out.push(check('longTaskMs', TARGETS.longTaskMs, lt, lt <= TARGETS.longTaskMs));
    const { measure, value: ff, info } = firstFrameMeasure(r);
    const [id, target] = r.kind === 'bigPool' ? ['bigPoolVisibleMs', TARGETS.bigPoolVisibleMs] : ['firstFrameMs', TARGETS.firstFrameMs];
    out.push({ ...check(id, target, ff, ff <= target), measure, info });
  }
  if (r.kind === 'perturb' && r.recovered !== undefined) {
    const v = typeof r.recovered === 'boolean' ? r.recovered : null;
    out.push(check('recovered', true, v, v === true));
  }
  // P9-R3/R8: a tier change swaps programs, textures and materials, so neither the resource counts
  // nor the heap growth mean a leak any more.
  const tierChanged = r.tier?.before != null && r.tier?.after != null && r.tier.before !== r.tier.after;
  if (r.heap) {
    const raw = r.heap.after - r.heap.before;
    const growth = Number.isFinite(raw) ? raw : null;
    const ratio = r.heap.before > 0 ? growth / r.heap.before : growth > 0 ? Infinity : 0;
    const c = check('heapGrowth', TARGETS.heapGrowthBytes, growth,
      growth <= TARGETS.heapGrowthBytes && ratio <= TARGETS.heapGrowthRatio);
    out.push(tierChanged ? { ...c, pass: null } : c);
  }
  if (r.resources) {
    const { before, after } = r.resources;
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    const diff = [...keys].filter((k) => (before?.[k] ?? 0) !== (after?.[k] ?? 0));
    out.push({ id: 'resources', target: 0, value: diff.length, pass: tierChanged ? null : diff.length === 0 });
  }
  return out;
}

/**
 * P9-R13 head-to-head: main-thread busy ms per second (`busy.msPerSec`, CDP TaskDuration over the
 * scenario) at the display's frame cap, passing up to `limit` (TARGETS.h2hRatio, 1.1, P9-R20).
 * Both frame p95s ride along for the table. A failed roll on
 * either side means unequal work: the ratio is shown, the verdict is n/a (like compare).
 */
export function compareBusy(dicer, dsn, { limit = TARGETS.h2hRatio } = {}) {
  const scenario = dicer?.scenario ?? dsn?.scenario;
  const d = dicer?.busy?.msPerSec ?? null;
  const s = dsn?.busy?.msPerSec ?? null;
  const out = { scenario, dicerBusy: d, dsnBusy: s, dicerP95: dicer?.frame?.p95 ?? null, dsnP95: dsn?.frame?.p95 ?? null };
  if (d == null || s == null || !(s > 0)) return { ...out, ratio: null, pass: null };
  const ratio = d / s;
  if ((dicer?.failures ?? 0) > 0 || (dsn?.failures ?? 0) > 0) return { ...out, ratio, pass: null };
  return { ...out, ratio, pass: ratio <= limit + EPS };
}

/** Head-to-head on frame p95 (the pre-P9-R13 measure, kept for the in-game benchmark's API). */
export function compare(dicer, dsn, { requireClearlyLess = false } = {}) {
  const d = dicer?.frame?.p95 ?? null;
  const s = dsn?.frame?.p95 ?? null;
  const scenario = dicer?.scenario ?? dsn?.scenario;
  if (d == null || s == null || !(s > 0)) return { scenario, dicerP95: d, dsnP95: s, ratio: null, pass: null };
  const ratio = d / s;
  const limit = requireClearlyLess ? TARGETS.clearlyLessRatio : 1;
  // P9-R2: a failed roll (one that timed out, or that the product did not animate) means the
  // two sides did not measure the same work: the ratio is shown, the verdict is n/a.
  if ((dicer?.failures ?? 0) > 0 || (dsn?.failures ?? 0) > 0) return { scenario, dicerP95: d, dsnP95: s, ratio, pass: null };
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
  for (const n of suite.notes ?? []) lines.push(`note: ${n}`);
  for (const r of suite.results ?? []) {
    const checks = checkTargets(r);
    const failed = checks.filter((c) => c.pass === false).map((c) => c.id);
    const gate = r.product === 'dicer' ? (r.dicerFirstFrame?.p95 ?? null) : null;
    const bits = [
      `frame p95 ${num(r.frame?.p95)} ms`,
      `long ${num(r.longTasks?.maxMs, 0)} ms`,
      `first ${num(r.firstFrame?.p95)} ms`,
      // H-R10: the gate -> first frame time, judged for Dicer when present (both stay visible).
      ...(gate != null ? [`msg->frame ${num(gate)} ms`] : []),
      `heap ${r.heap ? mb(r.heap.after - r.heap.before) : 'n/a'}`,
      `rolls ${r.rolls ?? 'n/a'}`,
      `fail ${r.failures ?? 'n/a'}`,
    ];
    const v = failed.length ? `FAIL (${failed.join(', ')})` : verdict(checks.some((c) => c.pass === true) ? true : null);
    lines.push(`${r.scenario} [${r.product}]: ${bits.join(', ')} -> ${v}`);
    for (const n of r.notes ?? []) lines.push(`  note: ${n}`);
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

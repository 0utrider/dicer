// Pure decisions for the live benchmark harness (tests/live/bench.mjs): the run matrix, DSN's
// effects-off settings, the verdicts, the restore decision and the summary. No I/O, no browser:
// unit-tested in tests/unit/bench-harness.test.js.
import { SCENARIOS } from '../../src/bench/scenarios.js';
import { checkTargets, compareBusy } from '../../src/bench/report.js';
import { TARGETS } from '../../src/bench/stats.js';

export const RESTORE_FILE = 'artifacts/bench/restore.json';

/** True for an https URL on this machine (localhost, 127.0.0.1, ::1), whose certificate is usually self-signed. */
export function isLocalHttps(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}
const H2H = Object.freeze(['d20', 'mixed10', 'pool30', 'burst100']);
// P9-R13: burst100 too, so the throttled run is also the low-end head-to-head partner.
const THROTTLED_VSYNC = Object.freeze(['d20', 'mixed10', 'pool30', 'burst100']);

/** The two machine profiles. The throttled one is the G2 low-end estimate. */
export function profiles() {
  return {
    pc: {
      cpuThrottle: 1,
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      dicerQuality: null,
    },
    throttled: {
      cpuThrottle: 4,
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      dicerQuality: 'medium',
    },
  };
}

/**
 * Browser modes. P9-R13: only vsync. The head-to-head used to run uncapped (no frame cap), but
 * uncapped frame intervals reward a product that skips redraws, not one that does less work: it
 * now runs at the display cap and compares main-thread busy time per second.
 */
export function modes() {
  return {
    // P9-R14: Windows' native occlusion tracking stops a covered window drawing (about a frame a
    // second) while the page still reports itself visible; off, a covered window keeps its frames.
    // A minimized window still stops: the README says to keep it up.
    vsync: { args: ['--disable-features=CalculateNativeWinOcclusion'] },
  };
}

/** Scenarios only Dicer has (rolling by hand): never in a DSN run or a comparison. */
const DICER_ONLY = new Set(SCENARIOS.filter((s) => s.dicerOnly).map((s) => s.id));

function mk(product, profile, mode, variant, ids) {
  if (product !== 'dicer') ids = ids.filter((id) => !DICER_ONLY.has(id));
  const dicerQuality =
    product !== 'dicer' ? null : variant === 'low' ? 'low' : profiles()[profile].dicerQuality;
  return Object.freeze({
    product,
    profile,
    mode,
    variant,
    ids: Object.freeze([...ids]),
    dicerQuality,
  });
}

/**
 * The run order. Every pairing of the brief; each product's runs are back to back so the world
 * is reloaded for a module switch only once.
 */
export function matrix() {
  const all = SCENARIOS.map((s) => s.id);
  return [
    mk('dicer', 'pc', 'vsync', 'defaults', all),
    mk('dicer', 'throttled', 'vsync', 'defaults', THROTTLED_VSYNC),
    mk('dicer', 'pc', 'vsync', 'low', H2H),
    mk('dice-so-nice', 'pc', 'vsync', 'defaults', H2H),
    mk('dice-so-nice', 'throttled', 'vsync', 'defaults', H2H),
    mk('dice-so-nice', 'pc', 'vsync', 'effectsOff', H2H),
  ];
}

/** `<product>-<profile>-<mode>[-<variant>]`: the report file name and the suite's profile. */
export function runName(e) {
  const base = `${e.product}-${e.profile}-${e.mode}`;
  return e.variant && e.variant !== 'defaults' ? `${base}-${e.variant}` : base;
}

/** H-R7: Dicer's world maxDice for the run (G2's big pool is 30 dice). */
export const DICER_MAX_DICE = 30;
/** DSN's world maxDiceNumber for the run (range 20-100, step 5): above pool30, like for like. */
export const DSN_MAX_DICE = 35;

/**
 * H-R8: DSN 6.4.5 keeps its graphics options in the user flag `flags['dice-so-nice'].settings`,
 * merged over defaults derived from core.performanceMode. The effects-off run writes these.
 */
export const DSN_EFFECTS_OFF = Object.freeze({
  shadowQuality: 'none',
  glow: false,
  bumpMapping: false,
  antialiasing: 'none',
  sounds: false,
  useHighDPI: false,
  persistentDiceOutlines: false,
  advancedGlass: false,
});

/**
 * The DSN user flag a run needs, as `{exists, value?}` (the restore.json shape): the overrides for
 * effects-off, unset for DSN defaults (the GM's own customisation must not bias it), null for Dicer.
 */
export function dsnFlagFor(entry) {
  if (entry?.product !== 'dice-so-nice') return null;
  return entry.variant === 'effectsOff'
    ? { exists: true, value: { ...DSN_EFFECTS_OFF } }
    : { exists: false };
}

const isEmptyObj = (v) => v == null || (typeof v === 'object' && Object.keys(v).length === 0);

/** Whether the flag read back (`{exists, value}`) is what `want` asked for. */
export function flagApplied(readBack, want) {
  if (!readBack || !want) return false;
  if (!want.exists) return !readBack.exists || isEmptyObj(readBack.value);
  if (!readBack.exists || !readBack.value || typeof readBack.value !== 'object') return false;
  return Object.entries(want.value ?? {}).every(([k, v]) => readBack.value[k] === v);
}

const PAIRINGS = Object.freeze([
  {
    pairing: 'defaults',
    profile: 'pc',
    dicer: 'defaults',
    dsn: 'defaults',
  },
  {
    pairing: 'defaults',
    profile: 'throttled',
    dicer: 'defaults',
    dsn: 'defaults',
  },
  {
    pairing: 'effectsOff',
    profile: 'pc',
    dicer: 'low',
    dsn: 'effectsOff',
  },
]);

/**
 * Rows for the summary and the exit code.
 * - `type: 'target'`: G2 checks (Task 1's checkTargets) on Dicer vsync reports only (H-R1), plus
 *   `failures` (every roll completed), `noRebuild` (resize and context loss must not rebuild the
 *   renderer) and, for contextLoss, `recovered` (the roll after the restore drew on a live context).
 * - `type: 'h2h'`: compareBusy (P9-R13: main-thread busy ms per second at 60 fps) on the vsync
 *   reports, passing within 10% of DSN (P9-R20); each row also shows both frame p95s.
 * @param {{entry: object, suite: {results: object[]}}[]} reports
 */
export function verdicts(reports) {
  const rows = [];
  const list = Array.isArray(reports) ? reports : [];
  for (const { entry, suite } of list) {
    // G2 targets judge Dicer at its defaults; the Low run exists only for the effects-off pairing.
    if (entry.product !== 'dicer' || entry.mode !== 'vsync' || entry.variant !== 'defaults') continue;
    const run = runName(entry);
    for (const r of suite?.results ?? []) {
      for (const c of checkTargets(r))
        rows.push({ type: 'target', run, scenario: r.scenario, ...c });
      const f = typeof r.failures === 'number' ? r.failures : null;
      rows.push({
        type: 'target',
        run,
        scenario: r.scenario,
        id: 'failures',
        target: 0,
        value: f,
        pass: f == null ? null : f === 0,
      });
      // I3: checkTargets emits `recovered` when the result has it; contextLoss always gets a row.
      if (r.scenario === 'contextLoss' && r.recovered === undefined) {
        rows.push({
          type: 'target',
          run,
          scenario: r.scenario,
          id: 'recovered',
          target: true,
          value: null,
          pass: null,
        });
      }
      if ((r.scenario === 'resize' || r.scenario === 'contextLoss') && typeof r.rebuilt === 'boolean') {
        rows.push({
          type: 'target',
          run,
          scenario: r.scenario,
          id: 'noRebuild',
          target: false,
          value: r.rebuilt,
          pass: !r.rebuilt,
        });
      }
    }
  }
  const find = (product, profile, variant) =>
    list.find(
      (x) =>
        x.entry.product === product &&
        x.entry.profile === profile &&
        x.entry.mode === 'vsync' &&
        x.entry.variant === variant,
    );
  for (const p of PAIRINGS) {
    const d = find('dicer', p.profile, p.dicer);
    const s = find('dice-so-nice', p.profile, p.dsn);
    if (!d && !s) continue;
    const ids = [];
    for (const r of [...(d?.suite?.results ?? []), ...(s?.suite?.results ?? [])])
      if (!ids.includes(r.scenario)) ids.push(r.scenario);
    for (const id of ids) {
      if (DICER_ONLY.has(id)) continue;
      const dr = d?.suite?.results?.find((r) => r.scenario === id) ?? null;
      const sr = s?.suite?.results?.find((r) => r.scenario === id) ?? null;
      const c = compareBusy(dr ?? { scenario: id }, sr ?? { scenario: id });
      const dicerFailures = dr?.failures ?? null;
      const dsnFailures = sr?.failures ?? null;
      // A side that dropped rolls did less work: never a valid win.
      const failed = dicerFailures > 0 || dsnFailures > 0;
      rows.push({
        type: 'h2h',
        pairing: p.pairing,
        profile: p.profile,
        limit: TARGETS.h2hRatio,
        ...c,
        pass: failed ? false : c.pass,
        scenario: id,
        dicerFailures,
        dsnFailures,
      });
    }
  }
  return rows;
}

/** 1 when any check failed or a run errored; n/a (pass null) does not fail. */
export function exitCode(rows, errors) {
  return (rows ?? []).some((r) => r.pass === false) || (errors ?? []).length > 0 ? 1 : 0;
}

/**
 * What to do with `artifacts/bench/restore.json` at startup.
 * @param {string | null} text the file's contents, null when it does not exist
 */
export function startupDecision(text) {
  if (text == null) return { action: 'fresh' };
  let restore;
  try {
    restore = JSON.parse(text);
  } catch (e) {
    return {
      action: 'abort',
      reason: `${RESTORE_FILE} is not JSON (${e.message}); fix or delete it by hand`,
    };
  }
  if (
    !restore ||
    typeof restore !== 'object' ||
    !restore.moduleConfiguration ||
    typeof restore.moduleConfiguration !== 'object'
  ) {
    return {
      action: 'abort',
      reason: `${RESTORE_FILE} has no moduleConfiguration; fix or delete it by hand`,
    };
  }
  const bad = (what) => ({
    action: 'abort',
    reason: `${RESTORE_FILE} has a malformed ${what}; fix or delete it by hand`,
  });
  const finiteNum = (v) => typeof v === 'number' && Number.isFinite(v);
  if ('maxDice' in restore && !finiteNum(restore.maxDice)) return bad('maxDice');
  if ('dsnMaxDiceNumber' in restore && !finiteNum(restore.dsnMaxDiceNumber))
    return bad('dsnMaxDiceNumber');
  if ('dsnUserFlag' in restore) {
    const f = restore.dsnUserFlag;
    if (!f || typeof f !== 'object' || typeof f.exists !== 'boolean') return bad('dsnUserFlag');
  }
  if (
    'runStartedAt' in restore &&
    !(typeof restore.runStartedAt === 'string' && Number.isFinite(Date.parse(restore.runStartedAt)))
  )
    return bad('runStartedAt');
  if (
    'messageIds' in restore &&
    !(
      Array.isArray(restore.messageIds) &&
      restore.messageIds.every((id) => typeof id === 'string' && id !== '')
    )
  )
    return bad('messageIds');
  return { action: 'restore', restore };
}

/**
 * H-R11: records a chat message id the harness created in `restore.messageIds` (the caller then
 * persists restore.json). True when the id was new.
 */
export function trackMessageId(restore, id) {
  if (typeof id !== 'string' || id === '') return false;
  restore.messageIds ??= [];
  if (restore.messageIds.includes(id)) return false;
  restore.messageIds.push(id);
  return true;
}

/** Only the two product keys of a `core.moduleConfiguration` snapshot, as booleans. */
export function pickProductModules(cfg) {
  return { dicer: Boolean(cfg?.dicer), 'dice-so-nice': Boolean(cfg?.['dice-so-nice']) };
}

/**
 * Steps that put the world back. A product's world settings can only be written while it is the
 * active module (Dicer: maxDice; DSN: maxDiceNumber and its user flag), so each product's group
 * runs with that product active, the currently active one first. Then (H-R11) the chat messages:
 * always the ids the harness tracked (`messageIds`); only when restoring after a crash
 * (`crashed`, restore.json found at startup) also every message the GM authored since
 * `runStartedAt`, the fallback for ids the crash kept from being persisted. A normal end or a
 * Ctrl+C in the same process never sweeps, so the GM's own chat is safe. The module configuration
 * last, merging back only the dicer / dice-so-nice keys.
 * @param {{moduleConfiguration: object, maxDice?: number, dsnMaxDiceNumber?: number,
 *   dsnUserFlag?: {exists: boolean, value?: object}, runStartedAt?: string,
 *   messageIds?: string[]}} restore
 * @param {'dicer' | 'dice-so-nice' | null} active
 * @param {{crashed?: boolean}} [opts]
 */
export function restorePlan(restore, active, { crashed = false } = {}) {
  const groups = {
    dicer: [],
    'dice-so-nice': [],
  };
  if (restore?.maxDice !== undefined)
    groups.dicer.push({ op: 'setMaxDice', value: restore.maxDice });
  if (restore?.dsnMaxDiceNumber !== undefined)
    groups['dice-so-nice'].push({ op: 'setDsnMaxDiceNumber', value: restore.dsnMaxDiceNumber });
  if (restore?.dsnImmediateDisplay !== undefined)
    groups['dice-so-nice'].push({ op: 'setDsnImmediateDisplay', value: restore.dsnImmediateDisplay });
  if (restore?.dsnUserFlag !== undefined)
    groups['dice-so-nice'].push({ op: 'setDsnUserFlag', value: restore.dsnUserFlag });
  const order = active === 'dice-so-nice' ? ['dice-so-nice', 'dicer'] : ['dicer', 'dice-so-nice'];
  const steps = [];
  let current = active;
  for (const product of order) {
    if (!groups[product].length) continue;
    if (current !== product) steps.push({ op: 'switch', product });
    current = product;
    steps.push(...groups[product]);
  }
  if (Array.isArray(restore?.messageIds) && restore.messageIds.length)
    steps.push({ op: 'deleteMessages', ids: [...restore.messageIds] });
  if (crashed && typeof restore?.runStartedAt === 'string')
    steps.push({ op: 'deleteMessagesSince', since: restore.runStartedAt });
  if (restore?.moduleConfiguration)
    steps.push({
      op: 'setModuleConfiguration',
      value: pickProductModules(restore.moduleConfiguration),
    });
  return steps;
}

/** `artifacts/bench/<ISO date>`; colons are not allowed in Windows paths. */
export function outDirName(date) {
  return `artifacts/bench/${date
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replace(/:/g, '-')}`;
}

/**
 * `--dry-run`, `--quick`, `--only <names>` (or `--only=<names>`, comma-separated). `error` is set
 * for an `--only` without names or an unknown flag.
 */
export function parseArgs(argv) {
  const args = [...(argv ?? [])];
  const out = { dryRun: false, quick: false, only: null, profile: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--quick') out.quick = true;
    else if (a === '--profile') out.profile = true;
    else if (a.startsWith('--profile=')) {
      // P9-R15: --profile=<scenario> profiles that scenario instead of burst100.
      const id = a.slice('--profile='.length).trim();
      if (!id) return { ...out, error: '--profile= needs a scenario, e.g. --profile=pool30' };
      out.profile = id;
    }
    else if (a === '--only' || a.startsWith('--only=')) {
      const raw = a === '--only' ? args[++i] : a.slice('--only='.length);
      const names = String(raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('--'));
      if (!names.length) return { ...out, error: '--only needs run names, e.g. --only dice-so-nice' };
      out.only = names;
    } else return { ...out, error: `unknown option ${a} (known: --dry-run, --quick, --only, --profile)` };
  }
  return out;
}

/**
 * P9-R6 quick mode: fewer rolls where the count only buys precision. The soak keeps enough
 * rolls to tell a leak (heap at roll 50 and at its last roll); the bursts keep 30 back to back.
 */
export const QUICK_ROLLS = Object.freeze({ soak500: 200, burst100: 30 });

/**
 * The runs to make: the matrix, without the throttled runs in quick mode (each run then carries
 * `rolls`, the QUICK_ROLLS overrides), and only the runs whose name contains one of `only`.
 * `error` when the filter leaves nothing.
 */
export function planFor({ quick = false, only = null, profile = false } = {}) {
  const { plan, error } = selectRuns({ quick, only });
  if (!profile) return { plan, ...(error ? { error } : {}) };
  // P9-R10: --profile records a CPU profile of each run's burst100; P9-R15: or of the scenario named.
  const id = profile === true ? PROFILE_SCENARIO : profile;
  if (!SCENARIOS.some((s) => s.id === id)) {
    return { plan, error: `--profile=${id}: no such scenario. Scenarios: ${SCENARIOS.map((s) => s.id).join(', ')}` };
  }
  return {
    plan: plan.map((e) => (e.ids.includes(id) ? Object.freeze({ ...e, profileScenario: id }) : e)),
    ...(error ? { error } : {}),
  };
}

/** P9-R10: the scenario --profile records (back-to-back rolls, the steady per-frame cost). */
export const PROFILE_SCENARIO = 'burst100';

function selectRuns({ quick, only }) {
  const all = matrix();
  const names = new Set(all.map(runName));
  // P9-R9: a term that is a whole run name selects that run only (dicer-pc-vsync, not -low).
  const matches = (e, n) => (names.has(n) ? runName(e) === n : runName(e).includes(n));
  const named = (e) => only?.some((n) => matches(e, n));
  let plan = only?.length ? all.filter(named) : all;
  // Quick skips the throttled runs, unless --only names them (P9-R9).
  if (quick) {
    plan = plan
      .filter((e) => e.profile !== 'throttled' || (only?.length && named(e) && only.some((n) => n.includes('throttled'))))
      .map((e) => Object.freeze({ ...e, rolls: QUICK_ROLLS }));
  }
  if (only?.length && !plan.length) {
    return { plan, error: `--only ${only.join(',')} matches no run. Runs: ${all.map(runName).join(', ')}` };
  }
  return { plan };
}

const num = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const verdict = (p) => (p === null || p === undefined ? 'n/a' : p ? 'PASS' : 'FAIL');
const val = (v) => (typeof v === 'number' ? num(v) : typeof v === 'boolean' ? String(v) : 'n/a');

const MEASURE_LABEL = Object.freeze({
  firstFrame: 'firstFrame (roll call -> frame)',
  dicerFirstFrame: 'dicerFirstFrame (gate -> frame)',
});

/** H-R10: a first-frame row names the measure judged and shows the other one. */
function checkNote(r) {
  if (!r.measure) return '';
  const judged = MEASURE_LABEL[r.measure] ?? r.measure;
  const other = r.info?.id;
  if (!other) return judged;
  const v = r.info.value;
  return typeof v === 'number' && Number.isFinite(v)
    ? `${judged}; ${MEASURE_LABEL[other] ?? other} ${num(v)}`
    : `${judged}; ${other} n/a`;
}

/** Console lines world.js prints for the terminal start with this (bench.mjs relays them). */
export const PROGRESS_PREFIX = '[dicer-bench]';

/**
 * The Runs table's tier: the tier the run started at (its first scenario's tier.before), and
 * `start -> end` when it ended on another one (an adaptive drop). Falls back to suite.tier.
 */
export function runTier(suite) {
  const results = (suite?.results ?? []).filter(Boolean);
  const start = results.find((r) => r.tier?.before != null)?.tier.before ?? null;
  const end = [...results].reverse().find((r) => r.tier?.after != null)?.tier.after ?? null;
  if (start == null) return suite?.tier ?? 'n/a';
  return end != null && end !== start ? `${start} -> ${end}` : start;
}

/** P9-R10: which part of the page a CPU profile call frame belongs to. */
export function bucketOf({ url = '', functionName = '' } = {}) {
  if (functionName === '(garbage collector)') return 'gc';
  if (!url) return 'browser'; // (program), native and DOM calls
  if (/\/modules\/dicer\//.test(url)) return 'dicer';
  if (/\/modules\/dice-so-nice\//.test(url)) return 'dice-so-nice';
  if (/\/modules\//.test(url)) return 'other modules';
  if (/\/systems\//.test(url)) return 'system';
  return 'foundry';
}

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * P9-R10: self time of a Chrome .cpuprofile (CDP Profiler.stop), idle excluded: per bucket and the
 * `top` hottest functions (name, file:line, 1-based). ms and pct rounded to 0.1. null without one.
 */
export function profileSummary(profile, { top = 15 } = {}) {
  if (!profile?.nodes || !profile.samples || !profile.timeDeltas) return null;
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map(); // node id -> microseconds
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const fns = new Map();
  const buckets = new Map();
  let total = 0;
  for (const [id, us] of self) {
    const f = byId.get(id)?.callFrame ?? {};
    if (f.functionName === '(idle)' || f.functionName === '(root)') continue;
    total += us;
    const bucket = bucketOf(f);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + us);
    const file = String(f.url ?? '').split(/[/?#]/).filter(Boolean).pop() ?? '';
    const where = file ? `${file}:${(f.lineNumber ?? 0) + 1}` : '';
    const key = `${f.functionName}|${where}`;
    const cur = fns.get(key) ?? { name: f.functionName || '(anonymous)', where, bucket, us: 0 };
    cur.us += us;
    fns.set(key, cur);
  }
  const shape = (us) => ({ ms: round1(us / 1000), pct: total ? round1((100 * us) / total) : 0 });
  return {
    totalMs: round1(total / 1000),
    buckets: [...buckets].sort((a, b) => b[1] - a[1]).map(([bucket, us]) => ({ bucket, ...shape(us) })),
    top: [...fns.values()]
      .sort((a, b) => b.us - a.us)
      .slice(0, top)
      .map(({ name, where, bucket, us }) => ({ name, where, bucket, ...shape(us) })),
  };
}

/**
 * P9-R8: one adaptive drop as text, e.g. "quality dropped ultra -> high 1004 s in (GPU timer:
 * GPU p95 18.2 ms, CPU median 4.1 ms; GPU over budget)".
 */
export function dropText(d) {
  const ms = (v) => (Number.isFinite(v) ? `${v.toFixed(1)} ms` : 'n/a');
  const when = Number.isFinite(d?.at) ? ` ${Math.round(d.at / 1000)} s in` : '';
  let why;
  if (d?.path === 'gpu') {
    const over = [d.gpuSlow && 'GPU', d.cpuSlow && 'CPU'].filter(Boolean).join(' and ') || 'nothing';
    why = `GPU timer: GPU p95 ${ms(d.gpuP95)}, CPU median ${ms(d.cpuMedian)}; ${over} over budget`;
  } else if (d?.path === 'ema') {
    why = `frame EMA ${ms(d.ema)}, baseline ${ms(d.baseline)}, ${d.streak ?? '?'} slow frames`;
  } else {
    why = 'reason unknown';
  }
  return `quality dropped ${d?.from ?? '?'} -> ${d?.to ?? '?'}${when} (${why})`;
}

/** summary.md: runs, G2 target checks, then the head-to-head table. */
export function summaryMarkdown({ date, reports, rows, errors, dsnFlag, quick = false, only = null }) {
  const out = [`# Dicer benchmark ${date}`, ''];
  // P9-R6: a partial run says so first, so it is not read as the full benchmark.
  if (quick || only?.length) {
    const parts = [];
    if (quick)
      parts.push(
        `quick mode (throttled runs only when --only names them; ${Object.entries(QUICK_ROLLS).map(([k, v]) => `${k} ${v} rolls`).join(', ')})`,
      );
    if (only?.length) parts.push(`only runs matching ${only.join(', ')}`);
    out.push(`Partial run: ${parts.join('; ')}. The full benchmark is the one that decides.`, '');
  }
  out.push(
    '## Runs',
    '',
    '| Run | Browser | GPU | Tier | Version |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const { entry, suite } of reports ?? []) {
    out.push(
      `| ${runName(entry)} | ${suite?.browser ?? 'n/a'} | ${suite?.gpu ?? 'n/a'} | ${runTier(suite)} | ${suite?.version ?? 'n/a'} |`,
    );
  }
  for (const e of errors ?? []) out.push('', `Run error: ${e.run}: ${e.error}`);
  // M6: G2 measures with a Foundry scene loaded (its canvas competes for the GPU).
  for (const { entry, settings } of reports ?? []) {
    if (settings?.sceneLoaded === false)
      out.push(
        '',
        `Warning: ${runName(entry)}: no Foundry scene loaded (G2 assumes one; the numbers may read better than in play)`,
      );
  }
  // P9-R2: a product that skipped the warm-up animation skipped the scenarios' too.
  // P9-R7: also a warm-up that was over at once, and a page hidden during the warm-up or a scenario.
  for (const { entry, suite } of reports ?? []) {
    const w = suite?.warmup;
    if (w?.started === false || w?.tooFast === true)
      out.push(
        '',
        `Warning: ${runName(entry)}: the warm-up roll did not animate${w.tooFast ? ` (over in ${w.ms} ms)` : ''}, so its frames measure nothing (${JSON.stringify(w.why ?? {})})`,
      );
    // P9-R8: every adaptive drop, with the judge that fired and its numbers.
    for (const r of suite?.results ?? []) {
      for (const d of r?.qualityDrops ?? []) out.push('', `Note: ${runName(entry)}: ${r.scenario}: ${dropText(d)}`);
    }
    const starved = (suite?.results ?? []).filter((r) => r?.starved === true).map((r) => r.scenario);
    if (starved.length)
      out.push(
        '',
        `Warning: ${runName(entry)}: frames came about once a second during ${starved.join(', ')} (window minimized or covered?), so those results are not valid`,
      );
    const hidden = (suite?.results ?? []).filter((r) => r?.pageHidden === true).map((r) => r.scenario);
    if (w?.hidden === true) hidden.unshift('warm-up');
    if (hidden.length)
      out.push(
        '',
        `Warning: ${runName(entry)}: the page was hidden during ${hidden.join(', ')}, so those results are not valid (keep the benchmark window visible)`,
      );
  }
  out.push('', 'Throttled results are estimates of a low-end machine.', '');
  out.push(
    '## G2 target checks',
    '',
    '| Run | Scenario | Check | Target | Value | Result | Note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const r of (rows ?? []).filter((x) => x.type === 'target')) {
    out.push(
      `| ${r.run} | ${r.scenario} | ${r.id} | ${val(r.target)} | ${val(r.value)} | ${verdict(r.pass)} | ${checkNote(r)} |`,
    );
  }
  // P9-R13: judged on main-thread busy time per second at 60 fps; the frame p95s are shown only.
  out.push('', '## Head-to-head (60 fps, main-thread busy ms per second)', '');
  out.push(
    '| Pairing | Profile | Scenario | Dicer busy (ms/s) | DSN busy (ms/s) | Ratio | Limit | Dicer p95 (ms) | DSN p95 (ms) | Dicer fail | DSN fail | Result |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  const count = (v) => (typeof v === 'number' ? String(v) : 'n/a');
  for (const r of (rows ?? []).filter((x) => x.type === 'h2h')) {
    out.push(
      `| ${r.pairing} | ${r.profile} | ${r.scenario} | ${num(r.dicerBusy, 1)} | ${num(r.dsnBusy, 1)} | ${num(r.ratio)} | ${num(r.limit)} | ${num(r.dicerP95)} | ${num(r.dsnP95)} | ${count(r.dicerFailures)} | ${count(r.dsnFailures)} | ${verdict(r.pass)} |`,
    );
  }
  // P9-R10: --profile. Per run: the sampled total and buckets, then one table of hot functions.
  const profiled = (reports ?? []).filter((r) => r?.cpu);
  if (profiled.length) {
    out.push('', '## CPU profile (self time)', '');
    for (const { entry, cpu } of profiled) {
      const parts = cpu.buckets.map((b) => `${b.bucket} ${num(b.ms, 1)} ms (${num(b.pct, 1)}%)`).join(', ');
      out.push(`- ${runName(entry)}, ${cpu.scenario}: ${num(cpu.totalMs, 1)} ms sampled; ${parts}`);
    }
    out.push('', '| Run | Function | Where | Part | Self ms | % |', '| --- | --- | --- | --- | --- | --- |');
    for (const { entry, cpu } of profiled) {
      for (const t of cpu.top)
        out.push(`| ${runName(entry)} | ${t.name} | ${t.where} | ${t.bucket} | ${num(t.ms, 1)} | ${num(t.pct, 1)} |`);
    }
  }
  // P9-R12: WebGL work per canvas per frame, over the profiled scenario.
  const glRows = [];
  for (const { entry, suite } of reports ?? []) {
    for (const r of suite?.results ?? []) {
      const f = r?.gl?.frames;
      if (!(f > 0)) continue;
      for (const [kind, t] of Object.entries(r.gl.byCanvas ?? {})) {
        const size = t.width && t.height ? `${t.width}x${t.height}` : 'n/a';
        glRows.push(
          `| ${runName(entry)} | ${r.scenario} | ${kind} | ${size} | ${num(t.draws / f, 1)} | ${Math.round(t.triangles / f)} | ${num(t.fbBinds / f, 1)} | ${num(t.clears / f, 1)} |`,
        );
      }
    }
  }
  if (glRows.length) {
    out.push('', '## GPU work per frame (WebGL calls per animation frame, per canvas)', '');
    out.push(
      '| Run | Scenario | Canvas | Size | Draws | Triangles | Render-target binds | Clears |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...glRows,
    );
  }
  const keys = Object.entries(dsnFlag?.exists ? (dsnFlag.value ?? {}) : {});
  out.push('', "## DSN effects-off user flag (flags['dice-so-nice'].settings, read back)", '');
  out.push(
    keys.length ? keys.map(([k, v]) => `- ${k} = ${JSON.stringify(v)}`).join('\n') : '- n/a',
  );
  const failed = (rows ?? []).filter((r) => r.pass === false).length;
  const na = (rows ?? []).filter((r) => r.pass == null).length;
  out.push('', `Result: ${failed} failed, ${na} n/a, ${(errors ?? []).length} run errors.`, '');
  return out.join('\n');
}

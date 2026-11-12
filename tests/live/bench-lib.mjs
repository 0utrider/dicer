// Pure decisions for the live benchmark harness (tests/live/bench.mjs): the run matrix, DSN's
// effects-off settings, the verdicts, the restore decision and the summary. No I/O, no browser:
// unit-tested in tests/unit/bench-harness.test.js.
import { SCENARIOS } from '../../src/bench/scenarios.js';
import { checkTargets, compare } from '../../src/bench/report.js';
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
const THROTTLED_VSYNC = Object.freeze(['d20', 'mixed10', 'pool30']);

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

/** Browser modes (H-D2): vsync for the 60 fps targets, uncapped for the head-to-head. */
export function modes() {
  return {
    vsync: { args: [] },
    uncapped: { args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] },
  };
}

function mk(product, profile, mode, variant, ids) {
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
    mk('dicer', 'pc', 'uncapped', 'defaults', H2H),
    mk('dicer', 'throttled', 'uncapped', 'defaults', H2H),
    mk('dicer', 'pc', 'uncapped', 'low', H2H),
    mk('dice-so-nice', 'pc', 'uncapped', 'defaults', H2H),
    mk('dice-so-nice', 'throttled', 'uncapped', 'defaults', H2H),
    mk('dice-so-nice', 'pc', 'uncapped', 'effectsOff', H2H),
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
    requireClearlyLess: true,
  },
  {
    pairing: 'defaults',
    profile: 'throttled',
    dicer: 'defaults',
    dsn: 'defaults',
    requireClearlyLess: false,
  },
  {
    pairing: 'effectsOff',
    profile: 'pc',
    dicer: 'low',
    dsn: 'effectsOff',
    requireClearlyLess: false,
  },
]);

/**
 * Rows for the summary and the exit code.
 * - `type: 'target'`: G2 checks (Task 1's checkTargets) on Dicer vsync reports only (H-R1), plus
 *   `failures` (every roll completed), `noRebuild` (resize and context loss must not rebuild the
 *   renderer) and, for contextLoss, `recovered` (the roll after the restore drew on a live context).
 * - `type: 'h2h'`: Task 1's compare on uncapped reports, clearly-less only for pc defaults.
 * @param {{entry: object, suite: {results: object[]}}[]} reports
 */
export function verdicts(reports) {
  const rows = [];
  const list = Array.isArray(reports) ? reports : [];
  for (const { entry, suite } of list) {
    if (entry.product !== 'dicer' || entry.mode !== 'vsync') continue;
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
        x.entry.mode === 'uncapped' &&
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
      const dr = d?.suite?.results?.find((r) => r.scenario === id) ?? null;
      const sr = s?.suite?.results?.find((r) => r.scenario === id) ?? null;
      const c = compare(dr ?? { scenario: id }, sr ?? { scenario: id }, {
        requireClearlyLess: p.requireClearlyLess,
      });
      const dicerFailures = dr?.failures ?? null;
      const dsnFailures = sr?.failures ?? null;
      // A side that dropped rolls did less work: never a valid win.
      const failed = dicerFailures > 0 || dsnFailures > 0;
      rows.push({
        type: 'h2h',
        pairing: p.pairing,
        profile: p.profile,
        requireClearlyLess: p.requireClearlyLess,
        limit: p.requireClearlyLess ? TARGETS.clearlyLessRatio : 1,
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
  const out = { dryRun: false, quick: false, only: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--quick') out.quick = true;
    else if (a === '--only' || a.startsWith('--only=')) {
      const raw = a === '--only' ? args[++i] : a.slice('--only='.length);
      const names = String(raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('--'));
      if (!names.length) return { ...out, error: '--only needs run names, e.g. --only dice-so-nice' };
      out.only = names;
    } else return { ...out, error: `unknown option ${a} (known: --dry-run, --quick, --only)` };
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
export function planFor({ quick = false, only = null } = {}) {
  const all = matrix();
  const names = new Set(all.map(runName));
  // P9-R9: a term that is a whole run name selects that run only (dicer-pc-uncapped, not -low).
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
  out.push('', '## Head-to-head (uncapped, frame p95)', '');
  out.push(
    '| Pairing | Profile | Scenario | Dicer p95 (ms) | DSN p95 (ms) | Ratio | Limit | Dicer fail | DSN fail | Result |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  const count = (v) => (typeof v === 'number' ? String(v) : 'n/a');
  for (const r of (rows ?? []).filter((x) => x.type === 'h2h')) {
    out.push(
      `| ${r.pairing} | ${r.profile} | ${r.scenario} | ${num(r.dicerP95)} | ${num(r.dsnP95)} | ${num(r.ratio)} | ${num(r.limit)} | ${count(r.dicerFailures)} | ${count(r.dsnFailures)} | ${verdict(r.pass)} |`,
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

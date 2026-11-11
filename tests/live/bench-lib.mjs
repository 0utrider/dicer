// Pure decisions for the live benchmark harness (tests/live/bench.mjs): the run matrix, DSN's
// effects-off settings, the verdicts, the restore decision and the summary. No I/O, no browser:
// unit-tested in tests/unit/bench-harness.test.js.
import { SCENARIOS } from '../../src/bench/scenarios.js';
import { checkTargets, compare } from '../../src/bench/report.js';
import { TARGETS } from '../../src/bench/stats.js';

export const RESTORE_FILE = 'artifacts/bench/restore.json';
export const PRODUCTS = Object.freeze(['dicer', 'dice-so-nice']);
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
    dsnEffectsOff: product === 'dice-so-nice' && variant === 'effectsOff',
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

const EFFECT_RE = /shadow|glow|bump|antialias|sound|effect|immersive/i;
const NEGATED_RE = /^(disable|no[A-Z_]|hide)/;
const OFF_CHOICE_RE = /^(none|off|disabled?|false|0)$/i;

/**
 * DSN's effects-off client settings, picked by key pattern from the runtime settings registry
 * (`game.settings.settings` as plain `{namespace, key, scope, type, choices}`). Booleans go off
 * (true for a negated key such as disableShadows); a choice setting goes to its "none"/"off"
 * choice when it has one. Only client scope: a fresh browser context resets those.
 * @returns {Record<string, boolean | string>}
 */
export function dsnEffectsOff(settingsList) {
  const out = {};
  for (const s of Array.isArray(settingsList) ? settingsList : []) {
    if (s?.namespace !== 'dice-so-nice' || s.scope !== 'client') continue;
    const key = String(s.key ?? '');
    if (!EFFECT_RE.test(key)) continue;
    if (s.type === 'Boolean') {
      out[key] = NEGATED_RE.test(key);
    } else if (Array.isArray(s.choices)) {
      const off = s.choices.find((c) => OFF_CHOICE_RE.test(String(c)));
      if (off !== undefined) out[key] = off;
    }
  }
  return out;
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
 *   `failures` (every roll completed) and `noRebuild` (resize must not rebuild the renderer).
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
      if (r.scenario === 'resize' && typeof r.rebuilt === 'boolean') {
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
      rows.push({
        type: 'h2h',
        pairing: p.pairing,
        profile: p.profile,
        requireClearlyLess: p.requireClearlyLess,
        limit: p.requireClearlyLess ? TARGETS.clearlyLessRatio : 1,
        ...c,
        scenario: id,
        dicerFailures: dr?.failures ?? null,
        dsnFailures: sr?.failures ?? null,
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
  return { action: 'restore', restore };
}

/**
 * Steps that put the world back. Dicer's world maxDice can only be written while Dicer is the
 * active module, so it comes first (switching to Dicer if needed); the module configuration last.
 * @param {{moduleConfiguration: object, maxDice?: number}} restore
 * @param {'dicer' | 'dice-so-nice' | null} active
 */
export function restorePlan(restore, active) {
  const steps = [];
  if (restore?.maxDice !== undefined) {
    if (active !== 'dicer') steps.push({ op: 'switch', product: 'dicer' });
    steps.push({ op: 'setMaxDice', value: restore.maxDice });
  }
  if (restore?.moduleConfiguration)
    steps.push({ op: 'setModuleConfiguration', value: restore.moduleConfiguration });
  return steps;
}

/** `core.moduleConfiguration` with exactly one of dicer / dice-so-nice enabled. */
export function moduleConfigFor(cfg, product) {
  if (!PRODUCTS.includes(product)) throw new Error(`unknown product: ${product}`);
  return { ...(cfg ?? {}), dicer: product === 'dicer', 'dice-so-nice': product === 'dice-so-nice' };
}

/** `artifacts/bench/<ISO date>`; colons are not allowed in Windows paths. */
export function outDirName(date) {
  return `artifacts/bench/${date
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replace(/:/g, '-')}`;
}

export function parseArgs(argv) {
  return { dryRun: (argv ?? []).includes('--dry-run') };
}

const num = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const verdict = (p) => (p === null || p === undefined ? 'n/a' : p ? 'PASS' : 'FAIL');
const val = (v) => (typeof v === 'number' ? num(v) : typeof v === 'boolean' ? String(v) : 'n/a');

/** summary.md: runs, G2 target checks, then the head-to-head table. */
export function summaryMarkdown({ date, reports, rows, errors, dsnKeys }) {
  const out = [`# Dicer benchmark ${date}`, ''];
  out.push(
    '## Runs',
    '',
    '| Run | Browser | GPU | Tier | Version |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const { entry, suite } of reports ?? []) {
    out.push(
      `| ${runName(entry)} | ${suite?.browser ?? 'n/a'} | ${suite?.gpu ?? 'n/a'} | ${suite?.tier ?? 'n/a'} | ${suite?.version ?? 'n/a'} |`,
    );
  }
  for (const e of errors ?? []) out.push('', `Run error: ${e.run}: ${e.error}`);
  out.push('', 'Throttled results are estimates of a low-end machine.', '');
  out.push(
    '## G2 target checks',
    '',
    '| Run | Scenario | Check | Target | Value | Result |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const r of (rows ?? []).filter((x) => x.type === 'target')) {
    out.push(
      `| ${r.run} | ${r.scenario} | ${r.id} | ${val(r.target)} | ${val(r.value)} | ${verdict(r.pass)} |`,
    );
  }
  out.push('', '## Head-to-head (uncapped, frame p95)', '');
  out.push(
    '| Pairing | Profile | Scenario | Dicer p95 (ms) | DSN p95 (ms) | Ratio | Limit | Result |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const r of (rows ?? []).filter((x) => x.type === 'h2h')) {
    out.push(
      `| ${r.pairing} | ${r.profile} | ${r.scenario} | ${num(r.dicerP95)} | ${num(r.dsnP95)} | ${num(r.ratio)} | ${num(r.limit)} | ${verdict(r.pass)} |`,
    );
  }
  const keys = Object.entries(dsnKeys ?? {});
  out.push('', '## DSN effects-off settings', '');
  out.push(
    keys.length ? keys.map(([k, v]) => `- ${k} = ${JSON.stringify(v)}`).join('\n') : '- n/a',
  );
  const failed = (rows ?? []).filter((r) => r.pass === false).length;
  const na = (rows ?? []).filter((r) => r.pass == null).length;
  out.push('', `Result: ${failed} failed, ${na} n/a, ${(errors ?? []).length} run errors.`, '');
  return out.join('\n');
}

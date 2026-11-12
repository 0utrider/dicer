import { expect, test } from 'vitest';
import {
  profiles,
  modes,
  matrix,
  runName,
  DSN_EFFECTS_OFF,
  DICER_MAX_DICE,
  DSN_MAX_DICE,
  dsnFlagFor,
  flagApplied,
  verdicts,
  exitCode,
  startupDecision,
  restorePlan,
  trackMessageId,
  pickProductModules,
  outDirName,
  parseArgs,
  summaryMarkdown,
  RESTORE_FILE,
  isLocalHttps,
  runTier,
  PROGRESS_PREFIX,
  planFor,
  QUICK_ROLLS,
} from '../../tests/live/bench-lib.mjs';

test('a self-signed certificate is trusted only for a local https Foundry', () => {
  expect(isLocalHttps('https://localhost:30000')).toBe(true);
  expect(isLocalHttps('https://127.0.0.1:30000')).toBe(true);
  expect(isLocalHttps('https://[::1]:30000')).toBe(true);
  expect(isLocalHttps('http://localhost:30000')).toBe(false);
  expect(isLocalHttps('https://foundry.example.com')).toBe(false);
  expect(isLocalHttps('https://localhost.example.com')).toBe(false);
  expect(isLocalHttps('not a url')).toBe(false);
});

const H2H = ['d20', 'mixed10', 'pool30', 'burst100'];
const ALL = [
  'd20',
  'mixed10',
  'pool30',
  'burst100',
  'burst20',
  'soak500',
  'resize',
  'contextLoss',
  'hidden',
];

const sum = (p95) => ({ n: 10, mean: p95, p50: p95, p95, p99: p95, max: p95 });
const result = (scenario, o = {}) => ({
  scenario,
  kind:
    scenario === 'pool30'
      ? 'bigPool'
      : scenario.startsWith('burst')
        ? 'burst'
        : ['resize', 'contextLoss', 'hidden'].includes(scenario)
          ? 'perturb'
          : 'typical',
  product: 'dicer',
  profile: null,
  rolls: 1,
  failures: 0,
  frame: sum(10),
  longTasks: { count: 0, maxMs: 0 },
  firstFrame: sum(20),
  dicerFirstFrame: null,
  heap: null,
  resources: null,
  notes: [],
  ...o,
});
const entry = (product, profile, mode, variant = 'defaults') =>
  matrix().find(
    (e) =>
      e.product === product && e.profile === profile && e.mode === mode && e.variant === variant,
  );
const report = (e, results) => ({
  entry: e,
  suite: {
    browser: 'Chrome 140',
    gpu: 'g',
    tier: 'high',
    version: '1',
    profile: runName(e),
    results,
  },
});

test('profiles: pc and throttled (CPU 4x, 1920x1080, dpr 1, Dicer medium); modes vsync and uncapped (H-D2)', () => {
  const p = profiles();
  expect(Object.keys(p).sort()).toEqual(['pc', 'throttled']);
  expect(p.throttled).toMatchObject({
    cpuThrottle: 4,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    dicerQuality: 'medium',
  });
  expect(p.pc.cpuThrottle).toBe(1);
  expect(p.pc.dicerQuality).toBeNull();
  const m = modes();
  expect(Object.keys(m).sort()).toEqual(['uncapped', 'vsync']);
  expect(m.vsync.args).toEqual([]);
  expect(m.uncapped.args).toEqual(['--disable-gpu-vsync', '--disable-frame-rate-limit']);
});

test('matrix contains every pairing and nothing else', () => {
  const key = (e) => `${e.product}|${e.profile}|${e.mode}|${e.variant}|${e.ids.join(',')}`;
  const got = matrix().map(key).sort();
  const want = [
    { product: 'dicer', profile: 'pc', mode: 'vsync', variant: 'defaults', ids: ALL },
    {
      product: 'dicer',
      profile: 'throttled',
      mode: 'vsync',
      variant: 'defaults',
      ids: ['d20', 'mixed10', 'pool30'],
    },
    { product: 'dicer', profile: 'pc', mode: 'uncapped', variant: 'defaults', ids: H2H },
    { product: 'dicer', profile: 'throttled', mode: 'uncapped', variant: 'defaults', ids: H2H },
    { product: 'dice-so-nice', profile: 'pc', mode: 'uncapped', variant: 'defaults', ids: H2H },
    {
      product: 'dice-so-nice',
      profile: 'throttled',
      mode: 'uncapped',
      variant: 'defaults',
      ids: H2H,
    },
    { product: 'dicer', profile: 'pc', mode: 'uncapped', variant: 'low', ids: H2H },
    { product: 'dice-so-nice', profile: 'pc', mode: 'uncapped', variant: 'effectsOff', ids: H2H },
  ]
    .map(key)
    .sort();
  expect(got).toEqual(want);
});

test('matrix: Dicer pc-vsync runs first; each product runs back to back (fewest world reloads)', () => {
  const m = matrix();
  expect(m[0]).toMatchObject({ product: 'dicer', profile: 'pc', mode: 'vsync' });
  const switches = m.filter((e, i) => i > 0 && e.product !== m[i - 1].product).length;
  expect(switches).toBe(1);
});

test('matrix: Dicer quality per entry (throttled medium, effects-off pairing low, pc defaults untouched)', () => {
  expect(entry('dicer', 'pc', 'vsync').dicerQuality).toBeNull();
  expect(entry('dicer', 'pc', 'uncapped').dicerQuality).toBeNull();
  expect(entry('dicer', 'throttled', 'vsync').dicerQuality).toBe('medium');
  expect(entry('dicer', 'throttled', 'uncapped').dicerQuality).toBe('medium');
  expect(entry('dicer', 'pc', 'uncapped', 'low').dicerQuality).toBe('low');
});

test('runName is unique per entry and file-safe', () => {
  const names = matrix().map(runName);
  expect(new Set(names).size).toBe(names.length);
  expect(runName(entry('dicer', 'pc', 'vsync'))).toBe('dicer-pc-vsync');
  expect(runName(entry('dice-so-nice', 'pc', 'uncapped', 'effectsOff'))).toBe(
    'dice-so-nice-pc-uncapped-effectsOff',
  );
  for (const n of names) expect(n).toMatch(/^[a-z0-9-]+$/i);
});

test('H-R8: DSN effects-off overrides, verbatim', () => {
  expect(DSN_EFFECTS_OFF).toEqual({
    shadowQuality: 'none',
    glow: false,
    bumpMapping: false,
    antialiasing: 'none',
    sounds: false,
    useHighDPI: false,
    persistentDiceOutlines: false,
    advancedGlass: false,
  });
  expect(Object.isFrozen(DSN_EFFECTS_OFF)).toBe(true);
});

test('dsnFlagFor: effects-off writes the overrides, DSN defaults unset the flag, Dicer leaves it', () => {
  expect(dsnFlagFor(entry('dice-so-nice', 'pc', 'uncapped', 'effectsOff'))).toEqual({
    exists: true,
    value: { ...DSN_EFFECTS_OFF },
  });
  expect(dsnFlagFor(entry('dice-so-nice', 'pc', 'uncapped'))).toEqual({ exists: false });
  expect(dsnFlagFor(entry('dice-so-nice', 'throttled', 'uncapped'))).toEqual({ exists: false });
  expect(dsnFlagFor(entry('dicer', 'pc', 'uncapped', 'low'))).toBeNull();
});

test('flagApplied: read-back must hold every override, or be unset for a defaults run', () => {
  const want = { exists: true, value: { ...DSN_EFFECTS_OFF } };
  expect(flagApplied({ exists: true, value: { ...DSN_EFFECTS_OFF, extra: 1 } }, want)).toBe(true);
  expect(flagApplied({ exists: true, value: { ...DSN_EFFECTS_OFF, glow: true } }, want)).toBe(
    false,
  );
  expect(flagApplied({ exists: false }, want)).toBe(false);
  expect(flagApplied(null, want)).toBe(false);
  expect(flagApplied({ exists: false }, { exists: false })).toBe(true);
  expect(flagApplied({ exists: true, value: { glow: false } }, { exists: false })).toBe(false);
});

test('caps: Dicer maxDice 30 (H-R7), DSN maxDiceNumber 35 (range 20-100 step 5)', () => {
  expect(DICER_MAX_DICE).toBe(30);
  expect(DSN_MAX_DICE).toBe(35);
  expect(DSN_MAX_DICE % 5).toBe(0);
});

test('verdicts: pc-defaults 9.5 vs 10 fails (needs clearly less), throttled with the same numbers passes', () => {
  const reports = [
    report(entry('dicer', 'pc', 'uncapped'), [result('d20', { frame: sum(9.5) })]),
    report(entry('dice-so-nice', 'pc', 'uncapped'), [
      result('d20', { product: 'dice-so-nice', frame: sum(10) }),
    ]),
    report(entry('dicer', 'throttled', 'uncapped'), [result('d20', { frame: sum(9.5) })]),
    report(entry('dice-so-nice', 'throttled', 'uncapped'), [
      result('d20', { product: 'dice-so-nice', frame: sum(10) }),
    ]),
  ];
  const h2h = verdicts(reports).filter((r) => r.type === 'h2h');
  const pc = h2h.find((r) => r.profile === 'pc');
  const thr = h2h.find((r) => r.profile === 'throttled');
  expect(pc).toMatchObject({
    pairing: 'defaults',
    scenario: 'd20',
    requireClearlyLess: true,
    pass: false,
  });
  expect(thr).toMatchObject({
    pairing: 'defaults',
    scenario: 'd20',
    requireClearlyLess: false,
    pass: true,
  });
  expect(h2h).toHaveLength(2);
});

test('verdicts: effects-off pairing compares DSN effects-off with Dicer low, not clearly-less', () => {
  const reports = [
    report(entry('dicer', 'pc', 'uncapped', 'low'), [result('pool30', { frame: sum(9.5) })]),
    report(entry('dice-so-nice', 'pc', 'uncapped', 'effectsOff'), [
      result('pool30', { product: 'dice-so-nice', frame: sum(10) }),
    ]),
  ];
  const [row] = verdicts(reports).filter((r) => r.type === 'h2h');
  expect(row).toMatchObject({
    pairing: 'effectsOff',
    profile: 'pc',
    scenario: 'pool30',
    requireClearlyLess: false,
    pass: true,
  });
});

test('verdicts: G2 target checks only on Dicer vsync reports (H-R1), never on uncapped or DSN', () => {
  const reports = [
    report(entry('dicer', 'pc', 'vsync'), [result('d20', { frame: sum(20) })]),
    report(entry('dicer', 'pc', 'uncapped'), [result('d20', { frame: sum(20) })]),
    report(entry('dice-so-nice', 'pc', 'uncapped'), [
      result('d20', { product: 'dice-so-nice', frame: sum(20) }),
    ]),
  ];
  const targets = verdicts(reports).filter((r) => r.type === 'target');
  expect(targets.length).toBeGreaterThan(0);
  expect(targets.every((r) => r.run === 'dicer-pc-vsync')).toBe(true);
  expect(targets.find((r) => r.id === 'frameP95Ms').pass).toBe(false);
});

test('verdicts: roll failures and a renderer rebuilt on resize or context loss fail', () => {
  const reports = [
    report(entry('dicer', 'pc', 'vsync'), [
      result('burst100', { failures: 2 }),
      result('resize', { rebuilt: true }),
      result('contextLoss', { rebuilt: true }),
    ]),
  ];
  const rows = verdicts(reports).filter((r) => r.type === 'target');
  expect(rows.find((r) => r.scenario === 'burst100' && r.id === 'failures').pass).toBe(false);
  expect(rows.find((r) => r.scenario === 'resize' && r.id === 'noRebuild').pass).toBe(false);
  expect(rows.find((r) => r.scenario === 'contextLoss' && r.id === 'noRebuild').pass).toBe(false);
  expect(rows.find((r) => r.scenario === 'contextLoss' && r.id === 'failures').pass).toBe(true);
});

test('verdicts: a head-to-head row fails when either side had roll failures, even if faster', () => {
  const reports = [
    report(entry('dicer', 'throttled', 'uncapped'), [
      result('d20', { frame: sum(5), failures: 1 }),
      result('mixed10', { frame: sum(5) }),
    ]),
    report(entry('dice-so-nice', 'throttled', 'uncapped'), [
      result('d20', { product: 'dice-so-nice', frame: sum(10) }),
      result('mixed10', { product: 'dice-so-nice', frame: sum(10), failures: 3 }),
    ]),
  ];
  const h2h = verdicts(reports).filter((r) => r.type === 'h2h');
  expect(h2h.find((r) => r.scenario === 'd20')).toMatchObject({ dicerFailures: 1, pass: false });
  expect(h2h.find((r) => r.scenario === 'mixed10')).toMatchObject({ dsnFailures: 3, pass: false });
});

test('verdicts: a missing counterpart yields an n/a row, not a crash', () => {
  const reports = [report(entry('dicer', 'pc', 'uncapped'), [result('d20')])];
  const [row] = verdicts(reports).filter((r) => r.type === 'h2h');
  expect(row).toMatchObject({ scenario: 'd20', pass: null, dsnP95: null });
});

test('exitCode: 1 on any failed check or run error, 0 otherwise (n/a does not fail)', () => {
  expect(exitCode([{ pass: true }, { pass: null }], [])).toBe(0);
  expect(exitCode([{ pass: true }, { pass: false }], [])).toBe(1);
  expect(exitCode([{ pass: true }], [{ run: 'x', error: 'boom' }])).toBe(1);
});

test('restore decision: restore.json at startup means restore first; garbage aborts; none means fresh', () => {
  expect(RESTORE_FILE).toBe('artifacts/bench/restore.json');
  expect(startupDecision(null)).toEqual({ action: 'fresh' });
  const saved = { moduleConfiguration: { dicer: true, 'dice-so-nice': false }, maxDice: 20 };
  expect(startupDecision(JSON.stringify(saved))).toEqual({ action: 'restore', restore: saved });
  expect(startupDecision('{not json').action).toBe('abort');
  expect(startupDecision('{}').action).toBe('abort');
});

test('restore decision: the DSN items (user flag, maxDiceNumber) round-trip; malformed ones abort', () => {
  const cfg = { dicer: true, 'dice-so-nice': false };
  const full = {
    moduleConfiguration: cfg,
    maxDice: 20,
    dsnMaxDiceNumber: 20,
    dsnUserFlag: { exists: true, value: { glow: true } },
  };
  expect(startupDecision(JSON.stringify(full))).toEqual({ action: 'restore', restore: full });
  const unset = { moduleConfiguration: cfg, dsnUserFlag: { exists: false } };
  expect(startupDecision(JSON.stringify(unset)).action).toBe('restore');
  for (const bad of [
    { moduleConfiguration: cfg, dsnUserFlag: { value: {} } },
    { moduleConfiguration: cfg, dsnUserFlag: 'x' },
    { moduleConfiguration: cfg, dsnMaxDiceNumber: 'many' },
    { moduleConfiguration: cfg, maxDice: null },
  ]) {
    expect(startupDecision(JSON.stringify(bad)).action).toBe('abort');
  }
});

const CFG = { dicer: true, 'dice-so-nice': false, foo: true };
const PICKED = { dicer: true, 'dice-so-nice': false };
const FLAG = { exists: true, value: { glow: true } };

test('restorePlan: maxDice needs Dicer active; module configuration (its two keys) last', () => {
  const r = { moduleConfiguration: CFG, maxDice: 20 };
  expect(restorePlan(r, 'dicer')).toEqual([
    { op: 'setMaxDice', value: 20 },
    { op: 'setModuleConfiguration', value: PICKED },
  ]);
  expect(restorePlan(r, 'dice-so-nice')).toEqual([
    { op: 'switch', product: 'dicer' },
    { op: 'setMaxDice', value: 20 },
    { op: 'setModuleConfiguration', value: PICKED },
  ]);
  expect(restorePlan({ moduleConfiguration: CFG }, null)).toEqual([
    { op: 'setModuleConfiguration', value: PICKED },
  ]);
});

test('restorePlan: DSN maxDiceNumber and the user flag need DSN active; the active product goes first', () => {
  const r = { moduleConfiguration: CFG, maxDice: 20, dsnMaxDiceNumber: 25, dsnUserFlag: FLAG };
  expect(restorePlan(r, 'dice-so-nice')).toEqual([
    { op: 'setDsnMaxDiceNumber', value: 25 },
    { op: 'setDsnUserFlag', value: FLAG },
    { op: 'switch', product: 'dicer' },
    { op: 'setMaxDice', value: 20 },
    { op: 'setModuleConfiguration', value: PICKED },
  ]);
  expect(restorePlan(r, 'dicer')).toEqual([
    { op: 'setMaxDice', value: 20 },
    { op: 'switch', product: 'dice-so-nice' },
    { op: 'setDsnMaxDiceNumber', value: 25 },
    { op: 'setDsnUserFlag', value: FLAG },
    { op: 'setModuleConfiguration', value: PICKED },
  ]);
  const dsnOnly = { moduleConfiguration: CFG, dsnUserFlag: { exists: false } };
  expect(restorePlan(dsnOnly, null)).toEqual([
    { op: 'switch', product: 'dice-so-nice' },
    { op: 'setDsnUserFlag', value: { exists: false } },
    { op: 'setModuleConfiguration', value: PICKED },
  ]);
});

test('pickProductModules keeps only the dicer and dice-so-nice keys, as booleans', () => {
  expect(pickProductModules({ dicer: true, foo: true })).toEqual({
    dicer: true,
    'dice-so-nice': false,
  });
  expect(pickProductModules(null)).toEqual({ dicer: false, 'dice-so-nice': false });
});

test('outDirName is an ISO date without colons', () => {
  expect(outDirName(new Date('2026-11-11T09:05:07.123Z'))).toBe(
    'artifacts/bench/2026-11-11T09-05-07Z',
  );
});

test('parseArgs', () => {
  expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true, quick: false, only: null });
  expect(parseArgs([])).toEqual({ dryRun: false, quick: false, only: null });
});

test('summaryMarkdown: target checks, then the head-to-head table, n/a for missing values', () => {
  const reports = [
    report(entry('dicer', 'pc', 'vsync'), [result('d20', { firstFrame: null })]),
    report(entry('dicer', 'pc', 'uncapped'), [result('d20', { frame: sum(8) })]),
    report(entry('dice-so-nice', 'pc', 'uncapped'), [
      result('d20', { product: 'dice-so-nice', frame: sum(10) }),
    ]),
  ];
  const rows = verdicts(reports);
  const md = summaryMarkdown({
    date: '2026-11-11T09-05-07Z',
    reports,
    rows,
    errors: [],
    dsnFlag: { exists: true, value: { glow: false } },
  });
  const targetsAt = md.indexOf('## G2 target checks');
  const h2hAt = md.indexOf('## Head-to-head');
  expect(targetsAt).toBeGreaterThan(-1);
  expect(h2hAt).toBeGreaterThan(targetsAt);
  expect(md).toContain('n/a');
  expect(md).not.toContain('NaN');
  expect(md).toContain('glow');
  expect(md).toMatch(
    /\| defaults \| pc \| d20 \| 8\.00 \| 10\.00 \| 0\.80 \| 0\.90 \| 0 \| 0 \| PASS \|/,
  );
});

test('verdicts: contextLoss gets noRebuild and recovered (I3); resize/hidden get no frame checks (perturb)', () => {
  const reports = [
    report(entry('dicer', 'pc', 'vsync'), [
      result('contextLoss', { rolls: 2, rebuilt: false, recovered: true, frame: sum(900) }),
      result('hidden', { frame: sum(900) }),
    ]),
  ];
  const rows = verdicts(reports).filter((r) => r.type === 'target');
  const cl = rows.filter((r) => r.scenario === 'contextLoss');
  expect(cl.map((r) => r.id).sort()).toEqual(['failures', 'noRebuild', 'recovered']);
  expect(cl.every((r) => r.pass === true)).toBe(true);
  expect(rows.filter((r) => r.scenario === 'hidden').map((r) => r.id)).toEqual(['failures']);
  const failed = verdicts([
    report(entry('dicer', 'pc', 'vsync'), [result('contextLoss', { recovered: false, rebuilt: true })]),
  ]).filter((r) => r.scenario === 'contextLoss');
  expect(failed.find((r) => r.id === 'recovered').pass).toBe(false);
  expect(failed.find((r) => r.id === 'noRebuild').pass).toBe(false);
  // A contextLoss result without the field still gets an n/a recovered row.
  const legacy = verdicts([report(entry('dicer', 'pc', 'vsync'), [result('contextLoss')])]);
  expect(legacy.find((r) => r.id === 'recovered')).toMatchObject({ value: null, pass: null });
});

test('summaryMarkdown: the first-frame rows say which measure was judged and show the other (H-R10)', () => {
  const reports = [
    report(entry('dicer', 'pc', 'vsync'), [
      result('d20', { firstFrame: sum(70), dicerFirstFrame: sum(30) }),
      result('mixed10', { firstFrame: sum(40) }),
    ]),
  ];
  const md = summaryMarkdown({ date: 'd', reports, rows: verdicts(reports), errors: [] });
  expect(md).toContain('| Run | Scenario | Check | Target | Value | Result | Note |');
  expect(md).toMatch(/\| d20 \| firstFrameMs \| 50\.00 \| 30\.00 \| PASS \| dicerFirstFrame \(gate -> frame\); firstFrame \(roll call -> frame\) 70\.00 \|/);
  expect(md).toMatch(/\| mixed10 \| firstFrameMs \| 50\.00 \| 40\.00 \| PASS \| firstFrame \(roll call -> frame\); dicerFirstFrame n\/a \|/);
});

test('summaryMarkdown warns when a run had no Foundry scene loaded (M6)', () => {
  const e = entry('dicer', 'pc', 'vsync');
  const withScene = { ...report(e, [result('d20')]), settings: { sceneLoaded: true } };
  const noScene = { ...report(e, [result('d20')]), settings: { sceneLoaded: false } };
  const warn = /no Foundry scene loaded/;
  expect(summaryMarkdown({ date: 'd', reports: [withScene], rows: [], errors: [] })).not.toMatch(warn);
  expect(summaryMarkdown({ date: 'd', reports: [noScene], rows: [], errors: [] })).toMatch(
    /Warning: dicer-pc-vsync: no Foundry scene loaded/,
  );
});

test('restore: runStartedAt round-trips; a malformed one aborts (H-R11)', () => {
  const cfg = { dicer: true, 'dice-so-nice': false };
  const ok = { moduleConfiguration: cfg, runStartedAt: '2026-11-11T09:05:07.123Z' };
  expect(startupDecision(JSON.stringify(ok))).toEqual({ action: 'restore', restore: ok });
  for (const runStartedAt of ['yesterday', 5, null])
    expect(startupDecision(JSON.stringify({ moduleConfiguration: cfg, runStartedAt })).action).toBe(
      'abort',
    );
});

test('restore: persisted messageIds round-trip; a malformed list aborts (H-R11)', () => {
  const cfg = { dicer: true, 'dice-so-nice': false };
  const ok = { moduleConfiguration: cfg, messageIds: ['a', 'b'] };
  expect(startupDecision(JSON.stringify(ok))).toEqual({ action: 'restore', restore: ok });
  for (const messageIds of ['a', [1], null, ['a', null]])
    expect(startupDecision(JSON.stringify({ moduleConfiguration: cfg, messageIds })).action).toBe(
      'abort',
    );
});

const SINCE = '2026-11-11T09:05:07.123Z';
const TRACKED = { moduleConfiguration: CFG, maxDice: 20, dsnUserFlag: FLAG, runStartedAt: SINCE, messageIds: ['m1', 'm2'] };

test('restorePlan, normal end: deletes only the tracked ids, never the time sweep (H-R11)', () => {
  for (const opts of [undefined, { crashed: false }]) {
    const steps = restorePlan(TRACKED, 'dicer', opts);
    expect(steps.slice(-2)).toEqual([
      { op: 'deleteMessages', ids: ['m1', 'm2'] },
      { op: 'setModuleConfiguration', value: PICKED },
    ]);
    expect(steps.some((s) => s.op === 'deleteMessagesSince')).toBe(false);
  }
  const none = restorePlan({ ...TRACKED, messageIds: [] }, 'dicer');
  expect(none.some((s) => s.op.startsWith('deleteMessages'))).toBe(false);
});

test('restorePlan, crash restore: the persisted ids, then the time sweep, then the module configuration (H-R11)', () => {
  expect(restorePlan(TRACKED, 'dicer', { crashed: true }).slice(-3)).toEqual([
    { op: 'deleteMessages', ids: ['m1', 'm2'] },
    { op: 'deleteMessagesSince', since: SINCE },
    { op: 'setModuleConfiguration', value: PICKED },
  ]);
  // No runStartedAt (an older restore.json): no sweep, even after a crash.
  const old = { ...TRACKED, runStartedAt: undefined };
  expect(restorePlan(old, 'dicer', { crashed: true }).some((s) => s.op === 'deleteMessagesSince')).toBe(false);
});

test('trackMessageId: adds a new id once, in order (persisted into restore.json as it grows)', () => {
  const r = {};
  expect(trackMessageId(r, 'a')).toBe(true);
  expect(trackMessageId(r, 'b')).toBe(true);
  expect(trackMessageId(r, 'a')).toBe(false);
  expect(trackMessageId(r, '')).toBe(false);
  expect(trackMessageId(r, 5)).toBe(false);
  expect(r.messageIds).toEqual(['a', 'b']);
});

test('world.js messageIdsSince: only the GM\'s own messages at or after the run start (H-R11)', async () => {
  const { messageIdsSince } = await import('../../tests/live/world.js');
  const msgs = [
    { id: 'a', author: { id: 'gm' }, timestamp: 1000 },
    { id: 'b', author: { id: 'gm' }, timestamp: 999 },
    { id: 'c', author: { id: 'player' }, timestamp: 2000 },
    { id: 'd', _source: { author: 'gm' }, timestamp: 1500 },
    { id: 'e', author: null, timestamp: 3000 },
  ];
  expect(messageIdsSince(msgs, 'gm', 1000)).toEqual(['a', 'd']);
  expect(messageIdsSince(null, 'gm', 0)).toEqual([]);
  expect(messageIdsSince(msgs, 'gm', NaN)).toEqual([]);
});

test('world.js recoveryVerdict: a live context and a drawn frame (I3)', async () => {
  const { recoveryVerdict } = await import('../../tests/live/world.js');
  expect(recoveryVerdict({ lost: false, firstFrame: 12 })).toBe(true);
  expect(recoveryVerdict({ lost: false, firstFrame: null, framesBefore: 10, framesAfter: 40 })).toBe(true);
  expect(recoveryVerdict({ lost: false, firstFrame: null, framesBefore: 10, framesAfter: 10 })).toBe(false);
  expect(recoveryVerdict({ lost: true, firstFrame: 12, framesBefore: 1, framesAfter: 9 })).toBe(false);
  expect(recoveryVerdict({ lost: null, firstFrame: 12 })).toBeNull();
  expect(recoveryVerdict({ lost: false, firstFrame: null, framesBefore: null, framesAfter: null })).toBeNull();
});

test('Runs tier: the tier the run started at, and start -> end after an adaptive drop', () => {
  const r = (before, after) => ({ tier: { before, after } });
  expect(runTier({ tier: 'low', results: [r('ultra', 'ultra'), r('ultra', 'low'), r('low', 'low')] })).toBe('ultra -> low');
  expect(runTier({ tier: 'ultra', results: [r('ultra', 'ultra')] })).toBe('ultra');
  expect(runTier({ tier: null, results: [r(null, null)] })).toBe('n/a');
  expect(runTier({ tier: 'medium', results: [] })).toBe('medium');
  expect(runTier(null)).toBe('n/a');
});

test('summaryMarkdown warns when the warm-up roll did not animate (P9-R2)', () => {
  const e = entry('dice-so-nice', 'pc', 'uncapped');
  const ok = { ...report(e, [result('d20')]) };
  ok.suite = { ...ok.suite, warmup: { completed: true, started: true } };
  const skipped = { ...report(e, [result('d20')]) };
  skipped.suite = { ...skipped.suite, warmup: { completed: true, started: false, why: { dsnHideNpcRolls: true } } };
  const warn = /warm-up roll did not animate/;
  expect(summaryMarkdown({ date: 'd', reports: [ok], rows: [], errors: [] })).not.toMatch(warn);
  expect(summaryMarkdown({ date: 'd', reports: [skipped], rows: [], errors: [] })).toMatch(
    /Warning: dice-so-nice-pc-uncapped: the warm-up roll did not animate.*"dsnHideNpcRolls":true/,
  );
});

test('summaryMarkdown warns on a too-fast warm-up and a hidden page (P9-R7)', () => {
  const e = entry('dice-so-nice', 'pc', 'uncapped');
  const fast = { ...report(e, [result('d20')]) };
  fast.suite = { ...fast.suite, warmup: { completed: true, started: true, tooFast: true, ms: 15, why: { documentHidden: true } } };
  expect(summaryMarkdown({ date: 'd', reports: [fast], rows: [], errors: [] })).toMatch(
    /Warning: dice-so-nice-pc-uncapped: the warm-up roll did not animate \(over in 15 ms\).*"documentHidden":true/,
  );
  const hid = { ...report(e, [{ ...result('d20'), pageHidden: true }, { ...result('burst20'), pageHidden: false }]) };
  hid.suite = { ...hid.suite, warmup: { completed: true, started: true, hidden: true } };
  expect(summaryMarkdown({ date: 'd', reports: [hid], rows: [], errors: [] })).toMatch(
    /Warning: dice-so-nice-pc-uncapped: the page was hidden during warm-up, d20, so those results are not valid/,
  );
  const ok = { ...report(e, [{ ...result('d20'), pageHidden: false }]) };
  ok.suite = { ...ok.suite, warmup: { completed: true, started: true, tooFast: false, hidden: false } };
  const md = summaryMarkdown({ date: 'd', reports: [ok], rows: [], errors: [] });
  expect(md).not.toMatch(/page was hidden/);
  expect(md).not.toMatch(/did not animate/);
});

test('the progress prefix is the one world.js prints', () => {
  expect(PROGRESS_PREFIX).toBe('[dicer-bench]');
});

// P9-R6: --quick and --only make shorter, clearly labelled partial runs.
test('parseArgs: --quick and --only, with errors for a missing name or an unknown flag', () => {
  expect(parseArgs(['--quick'])).toEqual({ dryRun: false, quick: true, only: null });
  expect(parseArgs(['--only', 'dice-so-nice,dicer-pc-vsync'])).toEqual({
    dryRun: false,
    quick: false,
    only: ['dice-so-nice', 'dicer-pc-vsync'],
  });
  expect(parseArgs(['--only=dicer', '--dry-run']).only).toEqual(['dicer']);
  expect(parseArgs(['--only']).error).toMatch(/--only needs run names/);
  expect(parseArgs(['--only', '--quick']).error).toMatch(/--only needs run names/);
  expect(parseArgs(['--fast']).error).toMatch(/unknown option --fast/);
});

test('planFor: quick drops the throttled runs and carries the roll overrides', () => {
  expect(planFor().plan.map(runName)).toEqual(matrix().map(runName));
  const { plan } = planFor({ quick: true });
  expect(plan.map(runName)).toEqual([
    'dicer-pc-vsync',
    'dicer-pc-uncapped',
    'dicer-pc-uncapped-low',
    'dice-so-nice-pc-uncapped',
    'dice-so-nice-pc-uncapped-effectsOff',
  ]);
  expect(plan.every((e) => e.rolls === QUICK_ROLLS)).toBe(true);
  expect(QUICK_ROLLS).toEqual({ soak500: 200, burst100: 30 });
  expect(planFor().plan.every((e) => e.rolls === undefined)).toBe(true);
});

test('planFor: --only keeps the runs whose name contains a term; nothing left is an error', () => {
  expect(planFor({ only: ['dice-so-nice'] }).plan.every((e) => e.product === 'dice-so-nice')).toBe(true);
  expect(planFor({ only: ['dicer'] }).plan.every((e) => e.product === 'dicer')).toBe(true);
  expect(planFor({ quick: true, only: ['dice-so-nice'] }).plan.map(runName)).toEqual([
    'dice-so-nice-pc-uncapped',
    'dice-so-nice-pc-uncapped-effectsOff',
  ]);
  const none = planFor({ quick: true, only: ['throttled'] });
  expect(none.plan).toEqual([]);
  expect(none.error).toMatch(/matches no run/);
});

test('summaryMarkdown labels a partial run first; a full run has no label', () => {
  const md = (o) => summaryMarkdown({ date: 'd', reports: [], rows: [], errors: [], ...o });
  expect(md({})).not.toMatch(/Partial run/);
  expect(md({ quick: true })).toMatch(/Partial run: quick mode \(no throttled runs; soak500 200 rolls, burst100 30 rolls\)/);
  expect(md({ only: ['dice-so-nice'] })).toMatch(/Partial run: only runs matching dice-so-nice/);
});

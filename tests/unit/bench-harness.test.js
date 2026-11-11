import { expect, test } from 'vitest';
import {
  profiles,
  modes,
  matrix,
  runName,
  dsnEffectsOff,
  verdicts,
  exitCode,
  startupDecision,
  restorePlan,
  moduleConfigFor,
  outDirName,
  parseArgs,
  summaryMarkdown,
  RESTORE_FILE,
} from '../../tests/live/bench-lib.mjs';

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
  kind: scenario === 'pool30' ? 'bigPool' : scenario.startsWith('burst') ? 'burst' : 'typical',
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
  expect(entry('dice-so-nice', 'pc', 'uncapped', 'effectsOff').dsnEffectsOff).toBe(true);
  expect(entry('dice-so-nice', 'pc', 'uncapped').dsnEffectsOff).toBe(false);
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

test('dsnEffectsOff picks shadow-like and glow Boolean keys, leaves unrelated keys alone', () => {
  const list = [
    {
      namespace: 'dice-so-nice',
      key: 'shadowQuality',
      scope: 'client',
      type: 'String',
      choices: ['none', 'low', 'high'],
    },
    { namespace: 'dice-so-nice', key: 'glow', scope: 'client', type: 'Boolean' },
    { namespace: 'dice-so-nice', key: 'bumpMapping', scope: 'client', type: 'Boolean' },
    {
      namespace: 'dice-so-nice',
      key: 'antialiasing',
      scope: 'client',
      type: 'String',
      choices: ['none', 'smaa', 'msaa'],
    },
    { namespace: 'dice-so-nice', key: 'sounds', scope: 'client', type: 'Boolean' },
    { namespace: 'dice-so-nice', key: 'immersiveDarkness', scope: 'client', type: 'Boolean' },
    { namespace: 'dice-so-nice', key: 'disableShadows', scope: 'client', type: 'Boolean' },
    // unrelated, non-Boolean without an off choice, other scope, other module
    {
      namespace: 'dice-so-nice',
      key: 'enabledSimultaneousRolls',
      scope: 'client',
      type: 'Boolean',
    },
    { namespace: 'dice-so-nice', key: 'hideAfterRoll', scope: 'client', type: 'Boolean' },
    { namespace: 'dice-so-nice', key: 'soundsVolume', scope: 'client', type: 'Number' },
    {
      namespace: 'dice-so-nice',
      key: 'soundsSurface',
      scope: 'client',
      type: 'String',
      choices: ['felt', 'wood'],
    },
    { namespace: 'dice-so-nice', key: 'glowWorld', scope: 'world', type: 'Boolean' },
    { namespace: 'other', key: 'glow', scope: 'client', type: 'Boolean' },
  ];
  expect(dsnEffectsOff(list)).toEqual({
    shadowQuality: 'none',
    glow: false,
    bumpMapping: false,
    antialiasing: 'none',
    sounds: false,
    immersiveDarkness: false,
    disableShadows: true,
  });
  expect(dsnEffectsOff([])).toEqual({});
  expect(dsnEffectsOff(null)).toEqual({});
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

test('verdicts: roll failures and a renderer rebuilt on resize fail; a rebuild on context loss is only recorded', () => {
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
  expect(rows.find((r) => r.scenario === 'contextLoss' && r.id === 'noRebuild')).toBeUndefined();
  expect(rows.find((r) => r.scenario === 'contextLoss' && r.id === 'failures').pass).toBe(true);
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

test('restorePlan: maxDice needs Dicer active; module configuration is restored last', () => {
  const r = { moduleConfiguration: { dicer: true, 'dice-so-nice': true }, maxDice: 20 };
  expect(restorePlan(r, 'dicer')).toEqual([
    { op: 'setMaxDice', value: 20 },
    { op: 'setModuleConfiguration', value: r.moduleConfiguration },
  ]);
  expect(restorePlan(r, 'dice-so-nice')).toEqual([
    { op: 'switch', product: 'dicer' },
    { op: 'setMaxDice', value: 20 },
    { op: 'setModuleConfiguration', value: r.moduleConfiguration },
  ]);
  expect(restorePlan({ moduleConfiguration: r.moduleConfiguration }, null)).toEqual([
    { op: 'setModuleConfiguration', value: r.moduleConfiguration },
  ]);
});

test('moduleConfigFor enables exactly one product and keeps the other modules', () => {
  const cfg = { dicer: true, 'dice-so-nice': true, foo: true, bar: false };
  expect(moduleConfigFor(cfg, 'dicer')).toEqual({
    dicer: true,
    'dice-so-nice': false,
    foo: true,
    bar: false,
  });
  expect(moduleConfigFor(cfg, 'dice-so-nice')).toEqual({
    dicer: false,
    'dice-so-nice': true,
    foo: true,
    bar: false,
  });
  expect(cfg.dicer).toBe(true); // not mutated
  expect(() => moduleConfigFor(cfg, 'nope')).toThrow();
});

test('outDirName is an ISO date without colons', () => {
  expect(outDirName(new Date('2026-11-11T09:05:07.123Z'))).toBe(
    'artifacts/bench/2026-11-11T09-05-07Z',
  );
});

test('parseArgs', () => {
  expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true });
  expect(parseArgs([])).toEqual({ dryRun: false });
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
    dsnKeys: { glow: false },
  });
  const targetsAt = md.indexOf('## G2 target checks');
  const h2hAt = md.indexOf('## Head-to-head');
  expect(targetsAt).toBeGreaterThan(-1);
  expect(h2hAt).toBeGreaterThan(targetsAt);
  expect(md).toContain('n/a');
  expect(md).not.toContain('NaN');
  expect(md).toContain('glow');
  expect(md).toMatch(/\| defaults \| pc \| d20 \| 8\.00 \| 10\.00 \| 0\.80 \| 0\.90 \| PASS \|/);
});

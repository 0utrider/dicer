// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { duplicateKeys, usedKeys, resolve } from './lang-check.js';
import { registerSettings } from '../../src/settings.js';

class FakeApplicationV2 {
  static DEFAULT_OPTIONS = {};
  constructor(options = {}) {
    this.options = options;
    this.renders = 0;
  }
  async render() {
    this.renders++;
    this.lastContext = await this._prepareContext();
    return this;
  }
}

const suite = {
  browser: 'Chrome 131',
  gpu: 'Test GPU',
  tier: 'high',
  version: '1.0.0',
  profile: 'in-game',
  results: [
    { scenario: 'd20', kind: 'typical', product: 'dicer', frame: { p95: 12 }, longTasks: { count: 0, maxMs: 0 }, firstFrame: { p95: 20 }, heap: null, resources: null, rolls: 1, failures: 0 },
    { scenario: 'pool30', kind: 'bigPool', product: 'dicer', frame: { p95: 30 }, longTasks: { count: 1, maxMs: 80 }, firstFrame: { p95: 300 }, heap: null, resources: null, rolls: 1, failures: 0 },
  ],
};

let App;
beforeAll(async () => {
  globalThis.foundry = { applications: { api: { ApplicationV2: FakeApplicationV2, HandlebarsApplicationMixin: (B) => B } } };
  ({ BenchmarkApp: App } = await import('../../src/bench/benchmark-app.js'));
});
afterAll(() => {
  delete globalThis.foundry;
});
beforeEach(() => {
  globalThis.game = { i18n: { localize: (k) => k }, dice3d: {} };
  globalThis.ui = { notifications: { warn: vi.fn(), info: vi.fn() } };
});
afterEach(() => {
  delete globalThis.game;
  delete globalThis.ui;
});

test('before a run: nothing to copy, no rows', async () => {
  const ctx = await new App()._prepareContext();
  expect(ctx.rows).toEqual([]);
  expect(ctx.canCopy).toBe(false);
  expect(ctx.running).toBe(false);
});

test('a finished suite shows one row per scenario with its verdict', async () => {
  const ctx = await new App({ suite, text: 'SUMMARY' })._prepareContext();
  expect(ctx.rows.map((r) => r.scenario)).toEqual(['d20', 'pool30']);
  expect(ctx.rows[0]).toMatchObject({ verdict: 'pass', frame: '12.0' });
  expect(ctx.rows[1].verdict).toBe('fail');
  expect(ctx.rows[1].failed).toContain('longTaskMs');
  expect(ctx.meta).toContain('Test GPU');
  expect(ctx.canCopy).toBe(true);
});

test('Run calls game.dice3d.benchmark, shows progress, then the result', async () => {
  let resolveRun;
  const bench = vi.fn(({ onProgress }) => {
    onProgress({ index: 0, total: 4, id: 'd20' });
    return new Promise((r) => (resolveRun = r));
  });
  globalThis.game.dice3d.benchmark = bench;
  const app = new App();
  const p = App.DEFAULT_OPTIONS.actions.run.call(app);
  await new Promise((r) => setTimeout(r, 0));
  expect(app.lastContext.running).toBe(true);
  expect(app.lastContext.progress).toContain('d20');
  resolveRun({ suite, text: 'SUMMARY' });
  await p;
  expect(app.lastContext.running).toBe(false);
  expect(app.lastContext.rows).toHaveLength(2);
  expect(bench).toHaveBeenCalledTimes(1);
});

test('Run with a busy engine (benchmark returns null) leaves the window usable', async () => {
  globalThis.game.dice3d.benchmark = vi.fn(async () => null);
  const app = new App();
  await App.DEFAULT_OPTIONS.actions.run.call(app);
  expect(app.lastContext.running).toBe(false);
  expect(app.lastContext.canCopy).toBe(false);
});

test('Run reports a thrown benchmark instead of hanging', async () => {
  globalThis.game.dice3d.benchmark = vi.fn(async () => {
    throw new Error('boom');
  });
  const app = new App();
  await App.DEFAULT_OPTIONS.actions.run.call(app);
  expect(app.lastContext.running).toBe(false);
  expect(app.lastContext.progress).toContain('boom');
});

test('Copy summary writes the summary text to the clipboard', async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });
  const app = new App({ suite, text: 'SUMMARY' });
  await App.DEFAULT_OPTIONS.actions.copy.call(app);
  expect(writeText).toHaveBeenCalledWith('SUMMARY');
  expect(globalThis.ui.notifications.info).toHaveBeenCalled();
});

test('Copy falls back to game.clipboard when navigator.clipboard is missing', async () => {
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: undefined, configurable: true });
  const copyPlainText = vi.fn(async () => {});
  globalThis.game.clipboard = { copyPlainText };
  await App.DEFAULT_OPTIONS.actions.copy.call(new App({ suite, text: 'SUMMARY' }));
  expect(copyPlainText).toHaveBeenCalledWith('SUMMARY');
});

test('Copy that fails warns instead of throwing', async () => {
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
  await App.DEFAULT_OPTIONS.actions.copy.call(new App({ suite, text: 'SUMMARY' }));
  expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith('DICER.Bench.CopyFailed');
});

test('the template has the controls, the table and the privacy note', () => {
  const html = readFileSync('templates/benchmark.hbs', 'utf8');
  expect(html).toContain('data-action="run"');
  expect(html).toContain('data-action="copy"');
  expect(html).toContain('DICER.Bench.Private');
  expect(html).toContain('role="status"');
});

describe('lang/en.json', () => {
  const lang = JSON.parse(readFileSync('lang/en.json', 'utf8'));
  it('has no duplicate keys', () => expect(duplicateKeys()).toEqual([]));
  it('has every DICER.Bench key the app, the template and the API use', () => {
    const keys = usedKeys('Bench', ['src/bench/benchmark-app.js', 'templates/benchmark.hbs', 'src/api/dice3d.js']);
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) expect(typeof resolve(lang.DICER.Bench, k), `DICER.Bench.${k}`).toBe('string');
  });
  it('has the settings menu strings', () => {
    expect(Object.keys(lang.DICER.Settings.benchmark).sort()).toEqual(['Hint', 'Label', 'Name']);
    expect(lang.DICER.Settings.benchmark.Label).toBe('Run the dice benchmark');
  });
});

test('the settings menu is a lazy ApplicationV2 proxy for everyone', () => {
  class FakeApp {}
  const menus = {};
  globalThis.foundry = { applications: { api: { ApplicationV2: FakeApp } } };
  globalThis.game = { settings: { register: () => {}, registerMenu: (ns, key, cfg) => (menus[key] = { ns, ...cfg }) } };
  try {
    registerSettings();
  } finally {
    globalThis.foundry = { applications: { api: { ApplicationV2: FakeApplicationV2, HandlebarsApplicationMixin: (B) => B } } };
  }
  expect(menus.benchmark).toMatchObject({ ns: 'dicer', restricted: false, label: 'DICER.Settings.benchmark.Label' });
  expect(Object.getPrototypeOf(menus.benchmark.type)).toBe(FakeApp);
});

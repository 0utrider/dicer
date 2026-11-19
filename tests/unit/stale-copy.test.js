import { readFileSync } from 'node:fs';
import { watchStaleCopy, resetStaleCopy } from '../../src/foundry/stale-copy.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const flush = () => new Promise((r) => setTimeout(r, 0));

function deps(over = {}) {
  const store = new Map();
  const listeners = {};
  const d = {
    served: pkg.version,
    route: (p) => `/base/${p}`,
    storage: () => ({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }),
    fetch: vi.fn(async () => ({ ok: true })),
    reload: vi.fn(),
    notify: vi.fn(),
    win: { addEventListener: (n, f) => (listeners[n] = f) },
    ...over,
  };
  return { d, store, listeners };
}

beforeEach(() => {
  resetStaleCopy();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

test('module.json and package.json carry the same version (the code compares them)', () => {
  expect(JSON.parse(readFileSync('module.json', 'utf8')).version).toBe(pkg.version);
});

test('the version Foundry serves matches the code: nothing happens', async () => {
  const { d } = deps();
  expect(watchStaleCopy(d)).toBe(false);
  await flush();
  expect(d.fetch).not.toHaveBeenCalled();
  expect(d.reload).not.toHaveBeenCalled();
});

test("an old cached copy: Dicer's files are fetched past the cache, then the page reloads once", async () => {
  const { d, store } = deps({ served: '99.0.0' });
  expect(watchStaleCopy(d)).toBe(true);
  await flush();
  expect(d.fetch.mock.calls).toEqual([
    ['/base/modules/dicer/dist/dicer.js', { cache: 'reload' }],
    ['/base/modules/dicer/styles/dicer.css', { cache: 'reload' }],
  ]);
  expect(d.reload).toHaveBeenCalledTimes(1);
  expect(store.get('dicer.staleReload')).toMatch(/^99\.0\.0\|\d+$/);
  expect(console.warn).toHaveBeenCalledWith(`dicer: old cached copy (running ${pkg.version}, served 99.0.0)`);
  // still stale right after that reload: no loop, the player is asked to hard-reload
  resetStaleCopy();
  const again = deps({ served: '99.0.0', storage: () => ({ getItem: () => `99.0.0|${Date.now() - 5000}`, setItem() {} }) }).d;
  watchStaleCopy(again);
  await flush();
  expect(again.reload).not.toHaveBeenCalled();
  expect(again.notify).toHaveBeenCalledTimes(1);
});

test('a reload over a minute ago, or for another version, may try again (the files may be fixed since)', async () => {
  for (const mark of [`99.0.0|${Date.now() - 120000}`, `98.0.0|${Date.now()}`]) {
    resetStaleCopy();
    const { d } = deps({ served: '99.0.0', storage: () => ({ getItem: () => mark, setItem() {} }) });
    watchStaleCopy(d);
    await flush();
    expect(d.reload, mark).toHaveBeenCalledTimes(1);
    expect(d.notify).not.toHaveBeenCalled();
  }
});

test('a failed fetch still reloads; blocked storage only asks', async () => {
  const { d } = deps({ served: '99.0.0', fetch: vi.fn(async () => Promise.reject(new Error('offline'))) });
  watchStaleCopy(d);
  await flush();
  expect(d.reload).toHaveBeenCalledTimes(1);
  resetStaleCopy();
  const blocked = deps({
    served: '99.0.0',
    storage: () => {
      throw new Error('blocked');
    },
  }).d;
  watchStaleCopy(blocked);
  await flush();
  expect(blocked.reload).not.toHaveBeenCalled();
  expect(blocked.notify).toHaveBeenCalledTimes(1);
});

test("a Dicer chunk that fails to load triggers the refresh; another module's or another error does not", async () => {
  const { d, listeners } = deps();
  watchStaleCopy(d);
  const fail = (message) => listeners.unhandledrejection({ reason: new TypeError(message) });
  fail('Failed to fetch dynamically imported module: https://x/modules/other/dist/a.js');
  fail('Something else broke in /modules/dicer/');
  await flush();
  expect(d.reload).not.toHaveBeenCalled();
  fail('Failed to fetch dynamically imported module: https://x/modules/dicer/dist/roll-stats-Do7IQJyE.js');
  await flush();
  expect(d.reload).toHaveBeenCalledTimes(1);
});

test('main starts the check first thing in init, with the version Foundry serves', () => {
  const src = readFileSync('src/main.js', 'utf8').replace(/\r\n/g, '\n');
  expect(src).toMatch(/Hooks\.once\('init', \(\) => \{[\s\S]{0,200}?watchStaleCopy\(\{\s*served: game\.modules\.get\('dicer'\)\?\.version,/);
  expect(JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Notice.Stale).toMatch(/Hard-reload/);
});

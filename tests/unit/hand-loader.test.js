import { readFileSync } from 'node:fs';
import { loadHand, prefetchHand, handNow, _setHandImport } from '../../src/hand/hand-loader.js';

afterEach(() => vi.restoreAllMocks());

test('the loader is the only world-start seam: no static import, the chunk only by import()', () => {
  const src = readFileSync('src/hand/hand-loader.js', 'utf8');
  expect(src).not.toMatch(/^\s*import\s/m);
  expect(src).toContain("import('./hand.js')");
});

test('imports the chunk once, on demand, and attaches it to the box', async () => {
  const handFor = vi.fn();
  const mod = { handFor };
  const load = vi.fn(async () => mod);
  _setHandImport(load);
  expect(load).not.toHaveBeenCalled();
  const box = {};
  const [a, b] = await Promise.all([loadHand(box), loadHand(box)]);
  expect(a).toBe(mod);
  expect(b).toBe(mod);
  expect(await loadHand()).toBe(mod); // no box: the module only
  expect(load).toHaveBeenCalledTimes(1);
  expect(handFor).toHaveBeenCalledTimes(2);
  expect(handFor).toHaveBeenCalledWith(box);
});

test('a failing import warns once and resolves null; never retried', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const load = vi.fn(() => Promise.reject(new Error('offline')));
  _setHandImport(load);
  expect(await loadHand({})).toBeNull();
  expect(await loadHand({})).toBeNull();
  expect(load).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('the real chunk is marked and carries the hand code', async () => {
  _setHandImport(() => import('../../src/hand/hand.js'));
  const m = await loadHand();
  expect(m.CHUNK).toBe('dicer-hand-chunk');
  for (const k of [
    'handFor',
    'readFree',
    'handEdge',
    'encodeTrajectory',
    'decodeTrajectory',
    'placeTrajectory',
    'replaySource',
    'sendHand',
    'replayFor',
  ])
    expect(typeof m[k]).toBe('function');
});

test('handNow: the chunk synchronously once a load resolved, else null', async () => {
  const mod = { handFor: () => {} };
  _setHandImport(async () => mod);
  expect(handNow()).toBeNull();
  const p = loadHand();
  expect(handNow()).toBeNull();
  await p;
  expect(handNow()).toBe(mod);
  _setHandImport(async () => mod);
  expect(handNow()).toBeNull();
});

describe('H-20: the chunk is prefetched at idle after ready', () => {
  test('prefetchHand loads the chunk for the box', async () => {
    const handFor = vi.fn();
    const load = vi.fn(async () => ({ handFor }));
    _setHandImport(load);
    const box = {};
    prefetchHand(box, () => 'all');
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(handFor).toHaveBeenCalledWith(box);
  });

  test("never when handRollsAllowed is 'none'; an unregistered setting reads as allowed ('all')", async () => {
    const load = vi.fn(async () => ({ handFor: () => {} }));
    _setHandImport(load);
    prefetchHand({}, () => 'none');
    await flush();
    expect(load).not.toHaveBeenCalled();
    for (const v of ['gm', 'trusted', 'all']) prefetchHand({}, () => v);
    prefetchHand({}, () => {
      throw new Error('not a registered game setting');
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(1); // imported once
  });

  test('main.js prefetches in an idle callback at ready, and the pets read DiceBox.holding', () => {
    const src = readFileSync('src/main.js', 'utf8');
    const ready = src.slice(src.indexOf("Hooks.once('ready'"));
    expect(ready).toContain("idle(() => prefetchHand(diceBox, () => getSetting('handRollsAllowed')))");
    expect(src).toContain(
      "const idle = (run) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(run) : setTimeout(run, 200));",
    );
    expect(src).toContain('holding: () => box?.holding');
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

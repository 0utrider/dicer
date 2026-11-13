import { readFileSync } from 'node:fs';
import { loadHand, _setHandImport } from '../../src/hand/hand-loader.js';

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
  for (const k of ['handFor', 'readFree', 'handEdge']) expect(typeof m[k]).toBe('function');
});

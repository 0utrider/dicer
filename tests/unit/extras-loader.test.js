import {
  getLookExtras,
  requestLookExtras,
  onLookExtrasReady,
  _setLookExtrasImport,
} from '../../src/render/extras-loader.js';

afterEach(() => vi.restoreAllMocks());

test('requestLookExtras imports once, resolves after ready, and notifies listeners once', async () => {
  let release;
  const ready = new Promise((r) => (release = r));
  const mod = { ready, patchMaterial: vi.fn(() => ({})) };
  const load = vi.fn(async () => mod);
  _setLookExtrasImport(load);
  const listener = vi.fn();
  onLookExtrasReady(listener);
  expect(getLookExtras()).toBeNull();
  const a = requestLookExtras();
  const b = requestLookExtras();
  expect(a).toBe(b);
  await Promise.resolve();
  await Promise.resolve();
  expect(getLookExtras()).toBeNull(); // not before ready
  expect(listener).not.toHaveBeenCalled();
  release();
  const [ma, mb] = await Promise.all([a, b]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(ma).toBe(mod);
  expect(mb).toBe(mod);
  expect(getLookExtras()).toBe(mod);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(await requestLookExtras()).toBe(mod);
  expect(load).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledTimes(1);
});

test('a failed import resolves null, warns once and is never retried', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const load = vi.fn(() => Promise.reject(new Error('offline')));
  _setLookExtrasImport(load);
  const listener = vi.fn();
  onLookExtrasReady(listener);
  const results = await Promise.all([requestLookExtras(), requestLookExtras()]);
  expect(await requestLookExtras()).toBeNull();
  expect(results).toEqual([null, null]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toBe('dicer: look extras unavailable; looks use their fallback');
  expect(getLookExtras()).toBeNull();
  expect(listener).not.toHaveBeenCalled();
});

test('a failing ready resolves null and warns once', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const ready = Promise.reject(new Error('asset'));
  ready.catch(() => {});
  _setLookExtrasImport(vi.fn(async () => ({ ready })));
  expect(await requestLookExtras()).toBeNull();
  expect(await requestLookExtras()).toBeNull();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(getLookExtras()).toBeNull();
});

test('a throwing listener does not stop the others', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const mod = { ready: Promise.resolve() };
  _setLookExtrasImport(async () => mod);
  const first = vi.fn(() => {
    throw new Error('listener');
  });
  const second = vi.fn();
  onLookExtrasReady(first);
  onLookExtrasReady(second);
  expect(await requestLookExtras()).toBe(mod);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('an unsubscribed listener is not called', async () => {
  _setLookExtrasImport(async () => ({ ready: Promise.resolve() }));
  const listener = vi.fn();
  const stop = onLookExtrasReady(listener);
  stop();
  await requestLookExtras();
  expect(listener).not.toHaveBeenCalled();
});

test('the real chunk honours the contract', async () => {
  _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
  const mod = await requestLookExtras();
  expect(mod.EXTRAS_ID).toBe('dicer-look-extras');
  expect(mod.patchMaterial({ numbers: { relief: 'engraved' } }, {}, { shape: null, labels: [], atlas: null })).toEqual(
    expect.any(Object),
  );
});

test('mergePatches joins chunks, assigns defines and uniforms, concatenates replace; last labels/atlas win', async () => {
  const { mergePatches } = await import('../../src/render/extras/look-extras.js');
  const atlasA = { id: 'a' };
  const atlasB = { id: 'b' };
  const u1 = { value: 1 };
  const u2 = { value: 2 };
  const m = mergePatches(
    {
      defines: { A: '' },
      uniforms: { uA: u1 },
      chunks: { pars: 'p1', emissive: 'e1' },
      replace: [['x', 'y']],
      labels: ['1'],
      atlas: atlasA,
    },
    {},
    {
      defines: { B: '1' },
      uniforms: { uB: u2 },
      chunks: { pars: 'p2' },
      replace: [['z', 'w']],
      labels: ['2'],
      atlas: atlasB,
    },
  );
  expect(m.defines).toEqual({ A: '', B: '1' });
  expect(m.uniforms).toEqual({ uA: u1, uB: u2 });
  expect(m.chunks).toEqual({ pars: 'p1\np2', emissive: 'e1' });
  expect(m.replace).toEqual([
    ['x', 'y'],
    ['z', 'w'],
  ]);
  expect(m.labels).toEqual(['2']);
  expect(m.atlas).toBe(atlasB);
  const empty = mergePatches();
  expect(empty.labels).toBeUndefined();
  expect(empty.atlas).toBeUndefined();
  expect(empty.replace ?? []).toEqual([]);
});

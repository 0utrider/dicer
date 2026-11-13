import { getPets, requestPets, releasePets, _setPetImport } from '../../src/pet/pet-loader.js';

afterEach(() => vi.restoreAllMocks());

test('loads once and shares the layer', async () => {
  const layer = { update: () => false };
  const createPetLayer = vi.fn(() => layer);
  const load = vi.fn(async () => ({ createPetLayer }));
  _setPetImport(load);
  expect(getPets()).toBeNull();
  const deps = { scene: 1 };
  const [a, b] = await Promise.all([requestPets(deps), requestPets(deps)]);
  expect(a).toBe(layer);
  expect(b).toBe(layer);
  expect(await requestPets(deps)).toBe(layer);
  expect(load).toHaveBeenCalledTimes(1);
  expect(createPetLayer).toHaveBeenCalledTimes(1);
  expect(createPetLayer).toHaveBeenCalledWith(deps);
  expect(getPets()).toBe(layer);
});

test('a failing import warns once and resolves null; getPets stays null; no retry', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const load = vi.fn(() => Promise.reject(new Error('offline')));
  _setPetImport(load);
  expect(await requestPets({})).toBeNull();
  expect(await requestPets({})).toBeNull();
  expect(load).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(getPets()).toBeNull();
});

test('the real chunk is a no-op PetHook', async () => {
  _setPetImport(() => import('../../src/pet/chunk/pets.js'));
  const layer = await requestPets({});
  for (const m of ['begin', 'landed', 'leave', 'end', 'update', 'dispose']) expect(typeof layer[m]).toBe('function');
  expect(layer.update(0)).toBe(false);
});

test('two engines: one import, two layers, the first disposed when the second is made', async () => {
  const made = [];
  const createPetLayer = vi.fn(() => {
    const l = { dispose: vi.fn() };
    made.push(l);
    return l;
  });
  const load = vi.fn(async () => ({ createPetLayer }));
  _setPetImport(load);
  const d1 = { scene: 1 };
  const d2 = { scene: 2 };
  const a = await requestPets(d1);
  expect(await requestPets(d1)).toBe(a);
  const b = await requestPets(d2);
  expect(load).toHaveBeenCalledTimes(1);
  expect(a).not.toBe(b);
  expect(a.dispose).toHaveBeenCalledTimes(1);
  expect(b.dispose).not.toHaveBeenCalled();
  expect(getPets()).toBe(b);
  releasePets();
  expect(b.dispose).toHaveBeenCalledTimes(1);
  expect(getPets()).toBeNull();
});

test('a request released before its import resolves makes no layer', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const createPetLayer = vi.fn(() => ({ dispose: vi.fn() }));
  _setPetImport(async () => (await gate, { createPetLayer }));
  const p = requestPets({ scene: 1 });
  releasePets();
  release();
  expect(await p).toBeNull();
  expect(createPetLayer).not.toHaveBeenCalled();
  expect(getPets()).toBeNull();
});

test('a request superseded before its import resolves makes no layer; only the newest does', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const createPetLayer = vi.fn((d) => ({ d, dispose: vi.fn() }));
  _setPetImport(async () => (await gate, { createPetLayer }));
  const a = { scene: 'a' };
  const b = { scene: 'b' };
  const pa = requestPets(a);
  const pb = requestPets(b);
  release();
  expect(await pa).toBeNull();
  const lb = await pb;
  expect(lb.d).toBe(b);
  expect(createPetLayer).toHaveBeenCalledTimes(1);
  expect(getPets()).toBe(lb);
});

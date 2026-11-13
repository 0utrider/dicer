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

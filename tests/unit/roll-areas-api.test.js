import { createDice3dApi } from '../../src/api/dice3d.js';
import { planThrow } from '../../src/throw/throw-planner.js';

let me, store, areaFor, areas, warn;
const make = (extra = {}) =>
  createDice3dApi({
    diceBox: { roll: vi.fn(), activeRolls: 0 },
    gate: { disabled: false, waitFor: vi.fn(async () => true) },
    planThrow,
    getSetting: (k) => store[k],
    writeSetting: async (k, v) => {
      store[k] = structuredClone(v);
    },
    currentUser: () => me,
    areaFor,
    ...extra,
  }).rollAreas;

beforeEach(() => {
  me = { id: 'gm', isGM: true };
  store = { rollAreas: { default: { preset: 'full' }, users: {} }, gmPrivateArea: { preset: 'corner' } };
  areaFor = vi.fn(({ rollerId }) => ({ left: 1, top: 2, width: 3, height: rollerId === 'p1' ? 9 : 4 }));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  areas = make();
});
afterEach(() => warn.mockRestore());

test('is enumerable on game.dice3d and lists the presets', () => {
  const a = createDice3dApi({
    diceBox: { roll: vi.fn() },
    gate: {},
    planThrow,
    getSetting: () => undefined,
  });
  expect(Object.keys(a)).toContain('rollAreas');
  expect(a.rollAreas.presets).toEqual(['full', 'centre', 'bottom', 'corner']);
});

test('get returns the default for null and for a user without an entry', () => {
  expect(areas.get()).toEqual({ preset: 'full' });
  expect(areas.get(null)).toEqual({ preset: 'full' });
  expect(areas.get('p1')).toEqual({ preset: 'full' });
});

test('set/get/rect round trip', async () => {
  await expect(areas.set('p1', { preset: 'corner' })).resolves.toBe(true);
  expect(areas.get('p1')).toEqual({ preset: 'corner' });
  expect(areas.rect('p1')).toEqual({ left: 1, top: 2, width: 3, height: 9 });
  expect(areaFor).toHaveBeenCalledWith({ rollerId: 'p1', gmPrivate: false });
  expect(areas.rect()).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  expect(areaFor).toHaveBeenLastCalledWith({ rollerId: undefined, gmPrivate: false });
});

test('rect is the whole stage when the resolver has no area, and null if that fails', () => {
  areaFor = vi.fn(() => null);
  const stage = { left: 0, top: 0, width: 800, height: 600 };
  expect(make({ getArea: () => ({ ...stage, extra: 1 }) }).rect('p1')).toEqual(stage);
  expect(
    make({
      getArea: () => {
        throw new Error('no stage');
      },
    }).rect('p1'),
  ).toBeNull();
});

test('set(null, def) sets the default; set(userId, null) removes only that user', async () => {
  await areas.set(null, { preset: 'bottom' });
  await areas.set('p1', { preset: 'corner' });
  await areas.set('p2', { preset: 'centre' });
  expect(areas.get('zzz')).toEqual({ preset: 'bottom' });
  await expect(areas.set('p1', null)).resolves.toBe(true);
  expect(areas.get('p1')).toEqual({ preset: 'bottom' });
  expect(areas.get('p2')).toEqual({ preset: 'centre' });
});

test('a malformed def is normalized', async () => {
  await areas.set('p1', { preset: 'bogus' });
  expect(areas.get('p1')).toEqual({ preset: 'full' });
  await areas.set('p2', { preset: 'custom', x: 5, y: -1, w: 0.4, h: 0.4 });
  expect(areas.get('p2')).toEqual({ preset: 'custom', x: 0.6, y: 0, w: 0.4, h: 0.4 });
  await areas.set('p3', 'nope');
  expect(areas.get('p3')).toEqual({ preset: 'full' });
});

test('a player set writes nothing, resolves false and warns once', async () => {
  me = { id: 'p1', isGM: false };
  const before = structuredClone(store);
  await expect(areas.set('p1', { preset: 'corner' })).resolves.toBe(false);
  await expect(areas.set(null, { preset: 'corner' })).resolves.toBe(false);
  await expect(areas.setGmPrivateArea({ preset: 'full' })).resolves.toBe(false);
  expect(store).toEqual(before);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('entries for other users are kept, even unreadable ones', async () => {
  store.rollAreas = { default: { preset: 'centre' }, users: { p2: { preset: 'garbage' }, p3: 7 }, extra: 1 };
  await areas.set('p1', { preset: 'corner' });
  expect(store.rollAreas).toEqual({
    default: { preset: 'centre' },
    users: { p2: { preset: 'garbage' }, p3: 7, p1: { preset: 'corner' } },
    extra: 1,
  });
  await areas.set('p1', null);
  expect(store.rollAreas.users).toEqual({ p2: { preset: 'garbage' }, p3: 7 });
});

test('get reports what the dice use: unreadable entry = the default; perPlayerAreas off = the default', () => {
  store.rollAreas = { default: { preset: 'centre' }, users: { p1: { preset: 'bad' }, p2: { preset: 'corner' } } };
  expect(areas.get('p1')).toEqual({ preset: 'centre' });
  expect(areas.get('p2')).toEqual({ preset: 'corner' });
  store.perPlayerAreas = false;
  expect(areas.get('p2')).toEqual({ preset: 'centre' });
});

test('set refuses to overwrite unreadable stored data (false + warning, nothing written)', async () => {
  store.rollAreas = { default: { preset: 'centre' }, users: 'junk' };
  const before = structuredClone(store);
  await expect(areas.set('p1', { preset: 'corner' })).resolves.toBe(false);
  expect(store).toEqual(before);
  expect(warn).toHaveBeenCalledTimes(1);
  store.rollAreas = 'junk';
  await expect(areas.set(null, { preset: 'corner' })).resolves.toBe(false);
  expect(store.rollAreas).toBe('junk');
});

test('set always returns a promise, even when reading the setting throws', async () => {
  const a = make({
    getSetting: () => {
      throw new Error('unreadable');
    },
  });
  let p;
  expect(() => {
    p = a.set('p1', { preset: 'corner' });
  }).not.toThrow();
  await expect(p).resolves.toBe(false);
});

test('a "__proto__" user id is refused', async () => {
  await expect(areas.set('__proto__', { preset: 'corner' })).resolves.toBe(false);
  expect({}.preset).toBeUndefined();
  expect(Object.keys(store.rollAreas.users)).toEqual([]);
});

test('get returns a copy', async () => {
  await areas.set('p1', { preset: 'custom', x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  const got = areas.get('p1');
  got.x = 0.9;
  got.preset = 'full';
  expect(areas.get('p1')).toEqual({ preset: 'custom', x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
});

test('setGmPrivateArea normalizes and writes gmPrivateArea (GM only)', async () => {
  await expect(areas.setGmPrivateArea({ preset: 'bottom' })).resolves.toBe(true);
  expect(store.gmPrivateArea).toEqual({ preset: 'bottom' });
  await areas.setGmPrivateArea({ preset: 'nope' });
  expect(store.gmPrivateArea).toEqual({ preset: 'full' });
});

test('a failing write resolves false with a warning, never throws', async () => {
  const a = make({
    writeSetting: async () => {
      throw new Error('denied');
    },
  });
  await expect(a.set('p1', { preset: 'corner' })).resolves.toBe(false);
  expect(warn).toHaveBeenCalled();
});

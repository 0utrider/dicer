import { snapshotAreas, withArea, areaDefFor, emitRollAreasChanged } from '../../src/areas/area-store.js';
import { createAreaResolver } from '../../src/areas/area-resolver.js';

const reader = (store) => (k) => store[k];

test('snapshotAreas returns what the dice use, as copies', () => {
  const store = {
    rollAreas: {
      default: { preset: 'centre' },
      users: { p1: { preset: 'corner' }, p2: 'bad' },
    },
    gmPrivateArea: { preset: 'bottom' },
  };
  const snap = snapshotAreas(reader(store));
  expect(snap).toEqual({
    default: { preset: 'centre' },
    users: { p1: { preset: 'corner' }, p2: { preset: 'centre' } }, // unreadable -> the default
    gmPrivate: { preset: 'bottom' },
  });
  snap.users.p1.preset = 'full';
  expect(store.rollAreas.users.p1.preset).toBe('corner');
});

test('an unreadable corner reads as the default corner; unreadable settings as the full stage', () => {
  expect(snapshotAreas(() => undefined)).toEqual({
    default: { preset: 'full' },
    users: {},
    gmPrivate: { preset: 'corner' },
  });
  expect(snapshotAreas(reader({ rollAreas: 5, gmPrivateArea: 'x' }))).toEqual({
    default: { preset: 'full' },
    users: {},
    gmPrivate: { preset: 'corner' },
  });
});

test('with perPlayerAreas off a user reads as the default', () => {
  const store = {
    rollAreas: { default: { preset: 'centre' }, users: { p1: { preset: 'corner' } } },
    perPlayerAreas: false,
  };
  expect(areaDefFor(reader(store), 'p1')).toEqual({ preset: 'centre' });
  expect(snapshotAreas(reader(store)).users.p1).toEqual({ preset: 'centre' });
});

test('get/snapshot agree with the resolver for every roller', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const stores = [
    { rollAreas: { default: { preset: 'bottom' }, users: { a: { preset: 'corner' }, b: { preset: 'x' }, c: 4 } } },
    { rollAreas: { default: 'bad', users: { a: { preset: 'centre' } } } },
    { rollAreas: { default: { preset: 'centre' }, users: { a: { preset: 'corner' } } }, perPlayerAreas: false },
    { rollAreas: { default: { preset: 'centre' }, users: 'junk' } },
  ];
  const usable = { left: 0, top: 0, width: 1000, height: 800 };
  const full = { ...usable };
  for (const store of stores) {
    const resolver = createAreaResolver({
      getSetting: reader(store),
      measureUsable: () => usable,
      currentUser: () => ({ isGM: false }),
    });
    for (const id of ['a', 'b', 'c', 'zzz', null]) {
      const expected = resolver.rectFor({ rollerId: id ?? undefined }) ?? full;
      const viaGet = createAreaResolver({
        getSetting: (k) => (k === 'rollAreas' ? { default: areaDefFor(reader(store), id), users: {} } : store[k]),
        measureUsable: () => usable,
        currentUser: () => ({ isGM: false }),
      }).rectFor({}) ?? full;
      expect(viaGet).toEqual(expected);
    }
  }
  vi.restoreAllMocks();
});

test('withArea does not mutate its input and keeps other entries', () => {
  const stored = { default: { preset: 'full' }, users: { a: { preset: 'corner' }, z: 7 } };
  const out = withArea(stored, 'b', { preset: 'centre' });
  expect(stored.users).toEqual({ a: { preset: 'corner' }, z: 7 });
  expect(out.users).toEqual({ a: { preset: 'corner' }, z: 7, b: { preset: 'centre' } });
});

test('withArea refuses (null) to overwrite an unreadable stored value or users container', () => {
  expect(withArea('junk', 'p1', { preset: 'corner' })).toBeNull();
  expect(withArea(7, null, { preset: 'corner' })).toBeNull();
  expect(withArea({ default: { preset: 'full' }, users: 'junk' }, 'p1', { preset: 'corner' })).toBeNull();
  expect(withArea({ default: { preset: 'full' }, users: [1] }, null, { preset: 'corner' })).toBeNull();
  expect(withArea(undefined, 'p1', { preset: 'corner' }).users.p1).toEqual({ preset: 'corner' });
});

test('withArea refuses the "__proto__" id', () => {
  expect(withArea({ default: {}, users: {} }, '__proto__', { preset: 'corner' })).toBeNull();
});

test('snapshotAreas copes with a stored "__proto__" user key', () => {
  const store = { rollAreas: JSON.parse('{"default":{"preset":"full"},"users":{"__proto__":{"preset":"corner"}}}') };
  const snap = snapshotAreas(reader(store));
  expect(Object.hasOwn(snap.users, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(snap.users)).toBe(Object.prototype);
});

describe('emitRollAreasChanged', () => {
  const store = { rollAreas: { default: { preset: 'centre' }, users: { p1: { preset: 'corner' } } } };

  test('fires dicerRollAreasChanged once with a snapshot copy', () => {
    const hooks = { callAll: vi.fn() };
    emitRollAreasChanged(hooks, reader(store));
    expect(hooks.callAll).toHaveBeenCalledTimes(1);
    const [name, payload] = hooks.callAll.mock.calls[0];
    expect(name).toBe('dicerRollAreasChanged');
    expect(payload).toEqual({
      default: { preset: 'centre' },
      users: { p1: { preset: 'corner' } },
      gmPrivate: { preset: 'corner' },
    });
    payload.users.p1.preset = 'full';
    expect(store.rollAreas.users.p1.preset).toBe('corner');
  });

  test('a throwing listener is contained', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hooks = {
      callAll: () => {
        throw new Error('listener');
      },
    };
    expect(() => emitRollAreasChanged(hooks, reader(store))).not.toThrow();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

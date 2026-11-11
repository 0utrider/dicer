import { snapshotAreas, withArea } from '../../src/areas/area-store.js';

test('snapshotAreas returns normalized copies', () => {
  const store = {
    rollAreas: { default: { preset: 'centre' }, users: { p1: { preset: 'corner' }, p2: 'bad' } },
    gmPrivateArea: { preset: 'bottom' },
  };
  const snap = snapshotAreas((k) => store[k]);
  expect(snap).toEqual({
    default: { preset: 'centre' },
    users: { p1: { preset: 'corner' }, p2: { preset: 'full' } },
    gmPrivate: { preset: 'bottom' },
  });
  snap.users.p1.preset = 'full';
  expect(store.rollAreas.users.p1.preset).toBe('corner');
});

test('snapshotAreas survives unreadable settings', () => {
  expect(snapshotAreas(() => undefined)).toEqual({
    default: { preset: 'full' },
    users: {},
    gmPrivate: { preset: 'corner' },
  });
  expect(snapshotAreas((k) => (k === 'rollAreas' ? 5 : null)).default).toEqual({ preset: 'full' });
});

test('withArea does not mutate its input', () => {
  const stored = { default: { preset: 'full' }, users: { a: { preset: 'corner' } } };
  const out = withArea(stored, 'b', { preset: 'centre' });
  expect(stored.users).toEqual({ a: { preset: 'corner' } });
  expect(out.users.b).toEqual({ preset: 'centre' });
});

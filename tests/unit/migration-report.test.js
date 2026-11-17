/** The GM's Dice So Nice migration report data (src/compat/migration-report.js). */
import { describe, expect, test } from 'vitest';
import { buildReport } from '../../src/compat/migration-report.js';
import { worldSettingsReader } from '../../src/compat/migration.js';

/** A fake user: raw DSN source flags and live dicer flags. */
function makeUser({ id = 'u1', name = 'Ann', dsn, dicer = {} } = {}) {
  return {
    id,
    name,
    _source: { flags: dsn === undefined ? {} : { 'dice-so-nice': dsn } },
    getFlag: (scope, key) => (scope === 'dicer' ? dicer[key] : undefined),
  };
}

const worldOf = (values) => ({ get: (k) => values[k] });
const settingsOf = (values) => (k) => values[k];

function report({ users = [], world = {}, settings = {}, isCustomized = () => false, dsnModule } = {}) {
  return buildReport({
    users,
    world: typeof world.get === 'function' ? world : worldOf(world),
    getSetting: settingsOf(settings),
    isCustomized,
    dsnModule,
  });
}

const row = (r, dsnKey) => r.world.find((w) => w.dsnKey === dsnKey);
const scopes = (u) => Object.fromEntries(u.scopes.map((s) => [s.scope, s.status]));

describe('world rows', () => {
  const world = { maxDiceNumber: 30, showGhostDice: 'yes', hideNpcRolls: true };

  test('migrated world: copied, invalid, absent, no-counterpart', () => {
    const r = report({ world, settings: { dsnWorldMigrated: 1, maxDice: 30 } });
    expect(row(r, 'maxDiceNumber')).toEqual({ dsnKey: 'maxDiceNumber', key: 'maxDice', status: 'copied', value: 30 });
    expect(row(r, 'showGhostDice').status).toBe('invalid');
    expect(row(r, 'showGhostDice').value).toBe('yes');
    expect(row(r, 'immediatelyDisplayChatMessages').status).toBe('absent');
    expect(row(r, 'hideNpcRolls')).toEqual({ dsnKey: 'hideNpcRolls', key: null, status: 'no-counterpart', value: true });
    expect(row(r, 'diceCanBeFlipped')).toBeUndefined();
  });

  test('migrated world where Dicer holds another value: dicer', () => {
    const r = report({ world, settings: { dsnWorldMigrated: 1, maxDice: 50 } });
    expect(row(r, 'maxDiceNumber').status).toBe('dicer');
  });

  test('unmigrated world: would-keep when the GM set it, would-copy otherwise', () => {
    expect(row(report({ world, isCustomized: (k) => k === 'maxDice' }), 'maxDiceNumber').status).toBe('would-keep');
    expect(row(report({ world }), 'maxDiceNumber').status).toBe('would-copy');
  });

  test('corrupt stored JSON is absent', () => {
    const r = report({ world: worldSettingsReader({ getItem: () => '{bad' }) });
    expect(r.world.every((w) => w.status === 'absent')).toBe(true);
  });
});

describe('users', () => {
  test('pending user: would-copy, would-keep, unusable', () => {
    const user = makeUser({
      dsn: { appearance: { global: { colorset: 'fire' }, d20: { colorset: 'ice' }, d6: { diceColor: 42 } } },
      dicer: { appearance: { d20: { look: 'ember' } } },
    });
    const [u] = report({ users: [user] }).users;
    expect(u.status).toBe('pending');
    expect(scopes(u)).toEqual({ global: 'would-copy', d20: 'would-keep', d6: 'unusable' });
  });

  test('a mirrored default counts as no choice', () => {
    const user = makeUser({
      dsn: { appearance: { global: { colorset: 'fire' } } },
      dicer: { appearance: { global: { theme: 'default' } } },
    });
    expect(scopes(report({ users: [user] }).users[0])).toEqual({ global: 'would-copy' });
  });

  test('migrated user: copied, and dicer after a later change', () => {
    const user = makeUser({
      dsn: { appearance: { global: { colorset: 'fire' }, d20: { colorset: 'ice' } } },
      dicer: { migratedFromDsn: 1, appearance: { global: { colorset: 'fire' }, d20: { look: 'x' } } },
    });
    const [u] = report({ users: [user] }).users;
    expect(u.status).toBe('migrated');
    expect(scopes(u)).toEqual({ global: 'copied', d20: 'dicer' });
  });

  test('save profiles and other DSN keys are listed', () => {
    const user = makeUser({
      dsn: { appearance: { global: { colorset: 'fire' } }, saves: { a: {}, b: {} }, sfxList: [], settings: {} },
    });
    const [u] = report({ users: [user] }).users;
    expect(u.saves).toBe(2);
    expect(u.otherKeys).toEqual(['settings', 'sfxList']);
  });

  test('garbage flags never throw and give none', () => {
    for (const dsn of [null, 'x', { appearance: 'x', saves: [] }, { appearance: { 'a b': {} } }]) {
      let u;
      expect(() => {
        [u] = report({ users: [makeUser({ dsn })] }).users;
      }).not.toThrow();
      expect(u.status).toBe('none');
      expect(u.saves).toBe(0);
    }
  });

  test('a throwing getFlag is survived', () => {
    const user = makeUser({ dsn: { appearance: { global: { colorset: 'fire' } } } });
    user.getFlag = () => {
      throw new Error('boom');
    };
    expect(report({ users: [user] }).users[0].status).toBe('pending');
  });

  test('order: pending, migrated, none, then name', () => {
    const fire = { appearance: { global: { colorset: 'fire' } } };
    const users = [
      makeUser({ id: 'n', name: 'Ann' }),
      makeUser({ id: 'm', name: 'Bob', dsn: fire, dicer: { migratedFromDsn: 1 } }),
      makeUser({ id: 'p2', name: 'Zed', dsn: fire }),
      makeUser({ id: 'p1', name: 'Cat', dsn: fire }),
    ];
    expect(report({ users }).users.map((u) => u.id)).toEqual(['p1', 'p2', 'm', 'n']);
  });
});

describe('status', () => {
  test('no DSN data at all', () => {
    const r = report({ users: [makeUser()] });
    expect(r.hasData).toBe(false);
    expect(r.world.every((w) => w.status === 'absent')).toBe(true);
  });

  test('data present', () => {
    expect(report({ world: { maxDiceNumber: 5 } }).hasData).toBe(true);
    expect(report({ users: [makeUser({ dsn: { appearance: { global: { colorset: 'fire' } } } })] }).hasData).toBe(true);
  });

  test('migration switch, world flag and DSN module state', () => {
    expect(report().enabled).toBe(true);
    expect(report({ settings: { migrateFromDsn: false } }).enabled).toBe(false);
    expect(report({ settings: { dsnWorldMigrated: 1 } }).worldMigrated).toBe(true);
    expect(report().worldMigrated).toBe(false);
    expect(report().dsn).toBe('missing');
    expect(report({ dsnModule: { active: false } }).dsn).toBe('installed');
    expect(report({ dsnModule: { active: true } }).dsn).toBe('active');
  });
});

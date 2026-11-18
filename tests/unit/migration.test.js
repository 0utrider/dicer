import {
  dsnAppearanceToLooks,
  migrateUser,
  migrateWorld,
  runMigration,
  loadSaveFile,
  worldSettingsReader,
  saveToTheme,
  migrateSaves,
  migrateAll,
  userThemeId,
} from '../../src/compat/migration.js';
import { userThemeId as formThemeId } from '../../src/ui/theme-form.js';
import { normalizeTheme } from '../../src/themes/themes.js';

/** A fake user: raw DSN source flags, live dicer flags, setFlag/update recording. */
function makeUser({ dsn, dicer = {} } = {}) {
  const flags = { ...dicer };
  const user = {
    _source: { flags: dsn ? { 'dice-so-nice': dsn } : {} },
    flags,
    getFlag: (scope, key) => (scope === 'dicer' ? flags[key] : undefined),
    setFlag: vi.fn(async (scope, key, value) => {
      flags[key] = value;
    }),
    update: vi.fn(async (data) => {
      for (const [k, v] of Object.entries(data.flags.dicer)) flags[k.replace(/^==/, '')] = v;
    }),
  };
  return user;
}

const CUSTOM = { diceColor: '#ff0000', labelColor: '#ffffff', outlineColor: '#000000', edgeColor: '#880000', colorset: 'custom', material: 'plastic' };

describe('dsnAppearanceToLooks', () => {
  test('named colorsets become colorset refs, with the system', () => {
    expect(dsnAppearanceToLooks({ global: { colorset: 'fire' }, d20: { colorset: 'ice', system: 'standard' } })).toEqual({
      global: { colorset: 'fire' },
      d20: { colorset: 'ice', system: 'standard' },
    });
  });
  test('a custom entry becomes an appearance whose body colour is the diceColor in hex', () => {
    const looks = dsnAppearanceToLooks({ global: { ...CUSTOM, diceColor: 'rgb(255, 0, 0)' } });
    expect(looks.global.appearance.body.color).toBe('#ff0000');
  });
  test('garbage gives defaults or skips, never throws', () => {
    let looks;
    expect(() => {
      looks = dsnAppearanceToLooks({ global: 'x', d6: { diceColor: 42 } });
    }).not.toThrow();
    expect(looks.global).toBeUndefined();
    expect(looks.d6).toBeUndefined();
    for (const bad of [null, 'x', 5, [], undefined]) expect(dsnAppearanceToLooks(bad)).toEqual({});
  });
  test('unrelated keys are ignored', () => {
    expect(dsnAppearanceToLooks({ __proto__x: { colorset: 'fire' }, 'a b': { colorset: 'fire' } })).toEqual({});
  });
});

describe('migrateUser', () => {
  test('writes the looks and sets the migrated flag', async () => {
    const user = makeUser({ dsn: { appearance: { global: { colorset: 'fire' }, d20: { colorset: 'ice' } } } });
    await expect(migrateUser(user)).resolves.toBe(true);
    expect(user.flags.appearance).toEqual({ global: { colorset: 'fire' }, d20: { colorset: 'ice' } });
    expect(user.flags.migratedFromDsn).toBe(1);
  });
  test('is idempotent: a second run writes nothing', async () => {
    const user = makeUser({ dsn: { appearance: { global: { colorset: 'fire' } } } });
    await migrateUser(user);
    user.setFlag.mockClear();
    await expect(migrateUser(user)).resolves.toBe(false);
    expect(user.setFlag).not.toHaveBeenCalled();
  });
  test('keeps existing Dicer choices and adds only the missing scope', async () => {
    const user = makeUser({
      dsn: { appearance: { global: { colorset: 'fire' }, d20: { colorset: 'ice' } } },
      dicer: { appearance: { global: { look: 'ember' } } },
    });
    await expect(migrateUser(user)).resolves.toBe(true);
    expect(user.flags.appearance).toEqual({ global: { look: 'ember' }, d20: { colorset: 'ice' } });
  });
  test('a user without DSN flags is not migrated and not flagged', async () => {
    const user = makeUser();
    await expect(migrateUser(user)).resolves.toBe(false);
    expect(user.setFlag).not.toHaveBeenCalled();
  });
  test('only unusable DSN data counts as no data', async () => {
    const user = makeUser({ dsn: { appearance: { global: 'x', d6: { diceColor: 42 } } } });
    await expect(migrateUser(user)).resolves.toBe(false);
    expect(user.setFlag).not.toHaveBeenCalled();
  });
  test('a bare mirrored {look:default} is not a choice: the DSN entry replaces it; other entries win', async () => {
    const user = makeUser({
      dsn: { appearance: { global: { colorset: 'fire' }, d20: { colorset: 'ice' } } },
      dicer: { appearance: { global: { look: 'default' }, d20: { look: 'default', system: 'x' } } },
    });
    await expect(migrateUser(user)).resolves.toBe(true);
    expect(user.flags.appearance).toEqual({ global: { colorset: 'fire' }, d20: { look: 'default', system: 'x' } });
  });
  test('the Plan 5 mirror {theme:default} is not a choice either', async () => {
    const user = makeUser({
      dsn: { appearance: { global: { colorset: 'fire' } } },
      dicer: { appearance: { global: { theme: 'default' } } },
    });
    await expect(migrateUser(user)).resolves.toBe(true);
    expect(user.flags.appearance).toEqual({ global: { colorset: 'fire' } });
  });
  test('all scopes already chosen: flagged, nothing written to the appearance', async () => {
    const user = makeUser({
      dsn: { appearance: { global: { colorset: 'fire' } } },
      dicer: { appearance: { global: { look: 'ember' } } },
    });
    await expect(migrateUser(user)).resolves.toBe(false);
    expect(user.flags.appearance).toEqual({ global: { look: 'ember' } });
    expect(user.flags.migratedFromDsn).toBe(1);
  });
});

function makeSettings(initial = {}) {
  const values = { ...initial };
  return {
    values,
    get: (scope, key) => values[key],
    set: vi.fn(async (scope, key, value) => {
      values[key] = value;
    }),
  };
}
const dsnWorld = (data) => ({ get: (key) => data[key] });

describe('migrateWorld', () => {
  test('maps maxDiceNumber, flags the world, and a second run does nothing', async () => {
    const settings = makeSettings();
    const world = dsnWorld({ maxDiceNumber: 40 });
    await expect(migrateWorld(world, { settings })).resolves.toEqual({ maxDice: 40 });
    expect(settings.values).toEqual({ maxDice: 40, dsnWorldMigrated: 1 });
    settings.set.mockClear();
    await expect(migrateWorld(world, { settings })).resolves.toEqual({});
    expect(settings.set).not.toHaveBeenCalled();
  });
  test('keeps a world value the GM already set in Dicer', async () => {
    const settings = makeSettings();
    const mapped = await migrateWorld(dsnWorld({ maxDiceNumber: 40, showGhostDice: true }), {
      settings,
      isCustomized: (key) => key === 'maxDice',
    });
    expect(mapped).toEqual({ showGhostDice: true });
    expect(settings.values.maxDice).toBeUndefined();
    expect(settings.values.dsnWorldMigrated).toBe(1);
  });
  test('maps the booleans, clamps maxDice, logs unmapped settings', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const settings = makeSettings();
    const mapped = await migrateWorld(
      dsnWorld({ maxDiceNumber: 500, immediatelyDisplayChatMessages: true, showGhostDice: true, hideNpcRolls: true, diceCanBeFlipped: false }),
      { settings },
    );
    expect(mapped).toEqual({ maxDice: 100, immediatelyDisplayChatMessages: true, showGhostDice: true });
    expect(info).toHaveBeenCalledTimes(2);
    info.mockRestore();
  });
  test('ignores wrong types; no DSN world data means no flag', async () => {
    const settings = makeSettings();
    await expect(migrateWorld(dsnWorld({}), { settings })).resolves.toEqual({});
    expect(settings.set).not.toHaveBeenCalled();
    await expect(migrateWorld(dsnWorld({ maxDiceNumber: 'many', showGhostDice: 'yes' }), { settings })).resolves.toEqual({});
  });
});

describe('worldSettingsReader', () => {
  test('parses the JSON value of dice-so-nice.<key>; missing or broken is undefined', () => {
    const reader = worldSettingsReader({ getItem: (k) => ({ 'dice-so-nice.maxDiceNumber': '40', 'dice-so-nice.bad': '{' })[k] ?? null });
    expect(reader.get('maxDiceNumber')).toBe(40);
    expect(reader.get('bad')).toBeUndefined();
    expect(reader.get('nope')).toBeUndefined();
  });
});

describe('runMigration', () => {
  test('a failing step warns and the other still runs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const user = makeUser({ dsn: { appearance: { global: { colorset: 'fire' } } } });
    user.setFlag.mockRejectedValue(new Error('boom'));
    const settings = makeSettings();
    const done = await runMigration({ user, isGM: true, worldSettings: dsnWorld({ maxDiceNumber: 30 }), settings });
    expect(done).toBe(true);
    expect(settings.values.maxDice).toBe(30);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  test('a non-GM never touches the world', async () => {
    const settings = makeSettings();
    const done = await runMigration({ user: makeUser(), isGM: false, worldSettings: dsnWorld({ maxDiceNumber: 30 }), settings });
    expect(done).toBe(false);
    expect(settings.set).not.toHaveBeenCalled();
  });
});

describe('loadSaveFile', () => {
  const saves = { mine: { appearance: { global: { colorset: 'fire' } } }, empty: {} };
  test('overwrites dicer.appearance with the mapped profile, even over existing choices', async () => {
    const user = makeUser({ dsn: { saves }, dicer: { appearance: { global: { look: 'default' }, d20: { look: 'default' } } } });
    await expect(loadSaveFile(user, 'mine', { replace: (v) => v })).resolves.toBe(true);
    expect(user.flags.appearance).toEqual({ global: { colorset: 'fire' } });
  });
  test('replaces through the injected ForcedReplacement, in the update payload', async () => {
    const user = makeUser({ dsn: { saves } });
    const replace = vi.fn((v) => ({ forced: v }));
    await loadSaveFile(user, 'mine', { replace });
    expect(user.update).toHaveBeenCalledWith({
      flags: { dicer: { appearance: { forced: { global: { colorset: 'fire' } } } } },
    });
  });
  test('a missing or empty profile warns and returns false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const user = makeUser({ dsn: { saves } });
    await expect(loadSaveFile(user, 'nope')).resolves.toBe(false);
    await expect(loadSaveFile(user, 'empty')).resolves.toBe(false);
    await expect(loadSaveFile(user, 'constructor')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(user.update).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// --- saved looks (save profiles) as themes ---------------------------------------------------
const FIRE = { appearance: { global: { colorset: 'fire' }, d20: { colorset: 'ice' } } };
const MINE = { appearance: { global: CUSTOM } };
const ODD = { appearance: { global: { colorset: 'some-module-set' } } }; // not registered yet

describe('saveToTheme', () => {
  test('a save becomes a valid user theme: its global look, its die-type looks, marked with its name', () => {
    const t = saveToTheme('Fire!', FIRE, { userId: 'u1' });
    expect(t).toMatchObject({ id: 'user.u1.fire', name: 'Fire!', dsnSave: 'Fire!' });
    expect(Object.keys(t.perType)).toEqual(['d20']);
    const theme = normalizeTheme(t, 'user', () => {});
    expect(theme).not.toBeNull();
    expect(theme.perType.d20).toBeTruthy();
    expect(saveToTheme('Mine', MINE, { userId: 'u1' }).appearance.body.color).toBe('#ff0000');
  });
  test('ids never clash with taken ones; a save with only die-type looks takes its first as the look', () => {
    expect(saveToTheme('Fire', FIRE, { userId: 'u1', taken: ['user.u1.fire'] }).id).not.toBe('user.u1.fire');
    const t = saveToTheme('D6 only', { appearance: { d6: CUSTOM } }, { userId: 'u1' });
    expect(t.appearance.body.color).toBe('#ff0000');
  });
  test('a colorset found only in the registry (a module dice set) is drawn from it; unknown, it is null', () => {
    expect(saveToTheme('Odd', ODD, { userId: 'u1' })).toBeNull();
    const registry = { colorsets: new Map([['some-module-set', { name: 'some-module-set', foreground: '#00ff00', background: '#0000ff', outline: '#000', edge: '#000', material: 'plastic' }]]) };
    expect(saveToTheme('Odd', ODD, { userId: 'u1', registry })?.appearance).toBeTruthy();
    expect(saveToTheme('Bad', { appearance: 'x' }, { userId: 'u1' })).toBeNull();
  });
});

describe('migrateSaves', () => {
  const user = (saves, dicer = {}) => ({ ...makeUser({ dsn: { saves }, dicer }), id: 'u1' });

  test('adds every save to My themes, after the themes already there, and lists them as imported', async () => {
    const u = user({ Fire: FIRE, Mine: MINE }, { themes: [{ id: 'user.u1.old', name: 'Old', appearance: {} }] });
    await expect(migrateSaves(u)).resolves.toBe(2);
    expect(u.flags.themes.map((t) => t.name)).toEqual(['Old', 'Fire', 'Mine']);
    expect(u.flags.dsnSavesImported).toEqual(['Fire', 'Mine']);
  });
  test('once: a second run adds nothing, and a theme the user deleted does not come back', async () => {
    const u = user({ Fire: FIRE });
    await migrateSaves(u);
    u.flags.themes = [];
    await expect(migrateSaves(u)).resolves.toBe(0);
    expect(u.flags.themes).toEqual([]);
  });
  test('a save that cannot be drawn yet is left for a later load, the others go in', async () => {
    const u = user({ Fire: FIRE, Odd: ODD });
    await expect(migrateSaves(u)).resolves.toBe(1);
    expect(u.flags.dsnSavesImported).toEqual(['Fire']);
    const registry = { colorsets: new Map([['some-module-set', { name: 'some-module-set', foreground: '#00ff00', background: '#0000ff' }]]) };
    await expect(migrateSaves(u, { registry })).resolves.toBe(1);
    expect(u.flags.themes.map((t) => t.name)).toEqual(['Fire', 'Odd']);
  });
  test('no saves, or garbage: nothing is written', async () => {
    for (const saves of [undefined, null, 'x', []]) {
      const u = user(saves);
      await expect(migrateSaves(u)).resolves.toBe(0);
      expect(u.setFlag).not.toHaveBeenCalled();
    }
  });
});

describe('migrateAll (the GM report)', () => {
  test('every user: colours and saves; the world settings; one failing user does not stop the rest', async () => {
    const a = { ...makeUser({ dsn: { appearance: { global: { colorset: 'fire' } }, saves: { Fire: FIRE } } }), id: 'a' };
    const b = { ...makeUser({ dsn: { saves: { Mine: MINE } } }), id: 'b' };
    const bad = { ...makeUser({ dsn: { saves: { Fire: FIRE } } }), id: 'x', name: 'Bad', setFlag: vi.fn(async () => { throw new Error('denied'); }) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stored = {};
    const settings = { get: (s, k) => stored[k], set: vi.fn(async (s, k, v) => { stored[k] = v; }) };
    const out = await migrateAll({ users: [a, bad, b], worldSettings: { get: (k) => (k === 'maxDiceNumber' ? 30 : undefined) }, settings });
    expect(out).toEqual({ users: 1, themes: 2, world: true });
    expect(a.flags.appearance.global).toEqual({ colorset: 'fire' });
    expect(b.flags.themes[0].name).toBe('Mine');
    expect(stored.maxDice).toBe(30);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

test("userThemeId here gives the theme browser's ids", () => {
  for (const [name, taken] of [['Fire!', []], ['  ', []], ['Fire', ['user.u1.fire']], ['Fire', ['user.u1.fire', 'user.u1.fire-2']], ['Ünïcode Dice', []]])
    expect(userThemeId('u1', name, taken)).toBe(formThemeId('u1', name, taken));
});

test("Dice So Nice 4.2+'s showGhostDice choice ('0'..'3') maps to Dicer's on/off; garbage is not copied", async () => {
  const { WORLD_MAP } = await import('../../src/compat/migration.js');
  const [key, check] = WORLD_MAP.showGhostDice;
  expect(key).toBe('showGhostDice');
  expect([check('0'), check('1'), check('2'), check('3'), check(0), check(true), check(false)]).toEqual([false, true, true, true, false, true, false]);
  expect(check('9')).toBeUndefined();
  expect(check(null)).toBeUndefined();
});

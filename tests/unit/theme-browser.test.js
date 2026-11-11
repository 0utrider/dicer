// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { duplicateKeys, usedKeys, resolve } from './lang-check.js';
import { themeRef } from '../../src/compat/user-looks.js';
import {
  assignTheme,
  slotPatch,
  roleSlot,
  assignDamage,
  importThemes,
  exportJson,
  themeFromForm,
  formFromTheme,
  publishToWorld,
  upsertTheme,
  removeTheme,
  galleryEntries,
  duplicateTheme,
  mergeEdited,
  KEEP,
} from '../../src/ui/theme-form.js';
import { BUILTIN_THEMES, normalizeTheme } from '../../src/themes/themes.js';

vi.mock('../../src/themes/thumbnailer.js', () => ({
  createThumbnailer: vi.fn(() => ({ thumbnail: vi.fn(async () => null), dispose: vi.fn() })),
}));

const raw = (id, name = id, extra = {}) => ({
  id,
  name,
  appearance: BUILTIN_THEMES[0].appearance,
  ...extra,
});

describe('assignTheme / slotPatch / assignDamage', () => {
  it('writes the right slot and leaves the others alone', () => {
    const looks = { global: { theme: 'a' }, d20: { theme: 'b' } };
    expect(assignTheme(looks, 'd6', 'c')).toEqual({ global: { theme: 'a' }, d20: { theme: 'b' }, d6: { theme: 'c' } });
    expect(assignTheme(looks, roleSlot('attack'), 'x')['role:attack']).toEqual({ theme: 'x' });
    expect(looks).toEqual({ global: { theme: 'a' }, d20: { theme: 'b' } }); // input untouched
  });
  it('Clear removes the slot only', () => {
    const looks = { global: { theme: 'a' }, d20: { theme: 'b' } };
    expect(assignTheme(looks, 'd20', null)).toEqual({ global: { theme: 'a' } });
    expect(assignTheme(undefined, 'd20', null)).toEqual({});
  });
  it('the flag patch sets one slot or uses the -= unset syntax', () => {
    // Every competing key is nulled, so a merge over an imported colorset/appearance can't outrank the theme.
    expect(slotPatch('d20', 'x')).toEqual({
      d20: { theme: 'x', appearance: null, colorset: null, look: null, system: null },
    });
    expect(slotPatch('role:save', null, () => 'DEL')).toEqual({ 'role:save': 'DEL' });
  });
  it('a damage map keeps other (even odd) entries', () => {
    expect(assignDamage({ fire: 'a', odd: { x: 1 } }, 'cold', 't')).toEqual({ fire: 'a', odd: { x: 1 }, cold: 't' });
    expect(assignDamage({ fire: 'a' }, 'fire', null)).toEqual({});
    expect(assignDamage(undefined, 'fire', 't')).toEqual({ fire: 't' });
    expect(assignDamage('junk', 'fire', 't')).toBeNull(); // never replace unreadable data
    expect(assignDamage([1], 'fire', 't')).toBeNull();
  });
});

describe('importThemes / exportJson', () => {
  it('imports the valid theme and warns about the invalid one', () => {
    const file = JSON.stringify({ themes: [raw('t1', 'One'), { id: 'bad', name: 'Bad' }] });
    const { themes, warnings } = importThemes(file, 'u1');
    expect(themes).toHaveLength(1);
    expect(themes[0].id).toBe('user.u1.one');
    expect(themes[0].source).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/bad/);
  });
  it('renames colliding ids with -2, -3 (against stored ids and within the file)', () => {
    const file = JSON.stringify([raw('a', 'Same'), raw('b', 'Same'), raw('c', 'Same')]);
    const { themes } = importThemes(file, 'u1', { existingIds: ['user.u1.same'] });
    expect(themes.map((t) => t.id)).toEqual(['user.u1.same-2', 'user.u1.same-3', 'user.u1.same-4']);
  });
  it('tolerates junk files', () => {
    expect(importThemes('not json', 'u').themes).toEqual([]);
    expect(importThemes('not json', 'u').warnings).toHaveLength(1);
    expect(importThemes('42', 'u').warnings).toHaveLength(1);
  });
  it('an export round-trips through import', () => {
    const mine = [normalizeTheme(raw('user.u1.one', 'One', { soundMaterial: 'wood' }), 'user'), BUILTIN_THEMES[7]];
    const text = exportJson(mine);
    const { themes, warnings } = importThemes(text, 'u2');
    expect(warnings).toEqual([]);
    expect(themes).toHaveLength(2);
    expect(themes[0].id).toBe('user.u2.one');
    expect(themes[0].soundMaterial).toBe('wood');
    expect(themes[1].name).toBe(BUILTIN_THEMES[7].name);
    expect(themes[1].appearance).toEqual(JSON.parse(JSON.stringify(BUILTIN_THEMES[7].appearance)));
    expect(themes[1].rules.map((r) => r.id)).toEqual(BUILTIN_THEMES[7].rules.map((r) => r.id));
  });
});

describe('the simple edit form', () => {
  const base = normalizeTheme(
    raw('user.u1.x', 'X', {
      perType: { d20: BUILTIN_THEMES[3].appearance },
      soundMaterial: 'metal',
      rules: [
        { id: 'dicer.nat20', name: 'N20', die: 'd20', result: { kind: 'value', value: 20 }, effect: { id: 'sparkles' }, sound: { builtin: 'chime' } },
        { id: 'mine', name: 'Mine', effect: { id: 'frost' } },
      ],
    }),
    'user',
  );

  it('formFromTheme names looks, sounds and effects', () => {
    const f = formFromTheme(base);
    expect(f.base).toBe('default');
    expect(f.perType.d20).toBe(BUILTIN_THEMES[3].id);
    expect(f.perType.d6).toBe('');
    expect(f.soundMaterial).toBe('metal');
    expect(f.nat20).toEqual({ effect: 'sparkles', sound: 'chime' });
    expect(f.nat1).toEqual({ effect: '', sound: '' });
  });
  it('an untouched form gives back an equivalent theme', () => {
    const back = themeFromForm(formFromTheme(base), base);
    const norm = normalizeTheme(back, 'user');
    expect(norm).not.toBeNull();
    expect(norm.appearance).toEqual(base.appearance);
    expect(norm.perType.d20).toEqual(base.perType.d20);
    expect(norm.rules.map((r) => r.id).sort()).toEqual(['dicer.nat20', 'mine']);
  });
  it('edits: base look, per-type, material, celebration', () => {
    const f = formFromTheme(base);
    f.name = '  Renamed ';
    f.base = 'ruby-classic';
    f.perType.d20 = '';
    f.perType.d6 = 'sharp-crystal';
    f.soundMaterial = '';
    f.nat20 = { effect: '', sound: '' };
    f.nat1 = { effect: 'shatter', sound: 'thud' };
    const t = normalizeTheme(themeFromForm(f, base), 'user');
    expect(t.name).toBe('Renamed');
    expect(t.id).toBe('user.u1.x');
    expect(t.appearance.body.color).toBe('#b3202a');
    expect(Object.keys(t.perType)).toEqual(['d6']);
    expect(t.soundMaterial).toBeNull();
    expect(t.rules.map((r) => r.id).sort()).toEqual(['dicer.nat1', 'mine']);
    const n1 = t.rules.find((r) => r.id === 'dicer.nat1');
    expect([n1.effect.id, n1.sound.builtin, n1.die, n1.result.value]).toEqual(['shatter', 'thud', 'd20', 1]);
  });
  it('keep leaves a custom look or a file sound as it was', () => {
    const custom = normalizeTheme(
      raw('user.u1.c', 'C', {
        appearance: { body: { type: 'opaque', color: '#123456' } },
        rules: [{ id: 'dicer.nat20', die: 'd20', result: { kind: 'value', value: 20 }, sound: { src: 'a.ogg' } }],
      }),
      'user',
    );
    const f = formFromTheme(custom);
    expect([f.base, f.nat20.sound]).toEqual([KEEP, KEEP]);
    const t = normalizeTheme(themeFromForm(f, custom), 'user');
    expect(t.appearance.body.color).toBe('#123456');
    expect(t.rules[0].sound.src).toBe('a.ogg');
  });
  it('duplicateTheme makes a new user id and name without a source', () => {
    const copy = duplicateTheme(BUILTIN_THEMES[0], 'u1', [{ id: 'user.u1.sapphire-nebula-copy' }]);
    expect(copy.id).toBe('user.u1.sapphire-nebula-copy-2');
    expect(copy.name).toBe('Sapphire Nebula (copy)');
    expect(copy.source).toBeUndefined();
    expect(normalizeTheme(copy, 'user')).not.toBeNull();
  });
});

describe('stored lists', () => {
  const stored = [raw('user.u1.ok', 'Ok'), { id: 'user.u1.broken', name: 'Broken' }, 'junk'];
  it('lists unreadable entries and keeps them through upsert and remove', () => {
    const g = galleryEntries({ userList: stored, warn: () => {} });
    expect(g.unreadable.map((u) => u.source)).toEqual(['user', 'user']);
    expect(g.themes.some((t) => t.id === 'user.u1.ok')).toBe(true);
    const saved = upsertTheme(stored, raw('user.u1.new', 'New'));
    expect(saved).toHaveLength(4);
    expect(saved).toContain(stored[1]);
    expect(saved).toContain('junk');
    const edited = upsertTheme(saved, raw('user.u1.ok', 'Edited'));
    expect(edited[0].name).toBe('Edited');
    expect(edited).toContain(stored[1]);
    expect(removeTheme(edited, 'user.u1.ok')).toEqual([stored[1], 'junk', saved[3]]);
  });
});

describe('mergeEdited', () => {
  it('keeps stored fields the edit does not know', () => {
    const out = mergeEdited({ id: 'a', name: 'Old', future: { x: 1 } }, { id: 'a', name: 'New' });
    expect(out).toEqual({ id: 'a', name: 'New', future: { x: 1 } });
  });
});

describe('theme setting choices (P5-R10)', () => {
  it('offers built-ins, world and my themes, so a chosen default stays valid', async () => {
    const { themeChoices } = await import('../../src/settings.js');
    const get = (k) => (k === 'worldThemes' ? [raw('world.w', 'W')] : []);
    const user = () => ({ getFlag: () => [raw('user.u1.m', 'M')] });
    const c = themeChoices(get, user);
    expect(Object.keys(c)).toContain('default');
    expect(c['world.w']).toBe('W (world)');
    expect(c['user.u1.m']).toBe('M (mine)');
  });
  it('getAppearance resolves a user theme', async () => {
    vi.stubGlobal('Hooks', { on: () => {}, once: () => {}, callAll: () => {} });
    const { getAppearance } = await import('../../src/main.js');
    const appearance = { body: { type: 'opaque', color: '#123456' } };
    vi.stubGlobal('game', {
      user: { getFlag: () => [{ id: 'user.u1.m', name: 'M', appearance }] },
      settings: { get: (_n, k) => (k === 'theme' ? 'user.u1.m' : []) },
    });
    expect(getAppearance().body.color).toBe('#123456');
    vi.unstubAllGlobals();
  });
});

describe('publishToWorld', () => {
  it('a player cannot publish', async () => {
    const setWorld = vi.fn();
    const res = await publishToWorld(BUILTIN_THEMES[0], { isGM: false, worldList: [], setWorld });
    expect(res.ok).toBe(false);
    expect(setWorld).not.toHaveBeenCalled();
  });
  it('the GM publishes a copy as world.<slug>, suffixed on collision, keeping unreadable entries', async () => {
    const setWorld = vi.fn();
    const world = [{ id: 'world.sapphire-nebula', name: 'Old', appearance: {} }, 'odd'];
    const res = await publishToWorld(BUILTIN_THEMES[0], { isGM: true, worldList: world, setWorld });
    expect(res).toEqual({ ok: true, id: 'world.sapphire-nebula-2' });
    const written = setWorld.mock.calls[0][0];
    expect(written).toHaveLength(3);
    expect(written).toContain('odd');
    expect(normalizeTheme(written[2], 'world')).not.toBeNull();
  });
});

describe('the browser actions', () => {
  let mod;
  let flags;
  let store;
  let actors;
  let user;
  beforeAll(async () => {
    class FakeApp {
      constructor(options = {}) {
        this.options = options;
      }
      static DEFAULT_OPTIONS = {};
    }
    vi.stubGlobal('foundry', {
      applications: { api: { ApplicationV2: FakeApp, HandlebarsApplicationMixin: (B) => class extends B {} } },
      utils: { saveDataToFile: vi.fn() },
      data: { operators: { ForcedDeletion: { create: () => 'DELETE' } } },
    });
    mod = await import('../../src/ui/theme-browser.js');
  });
  beforeEach(() => {
    flags = {};
    store = { theme: 'default', damageThemeOverrides: { acid: 'x' }, damageTypeMap: {}, worldThemes: [] };
    actors = new Map([
      ['mine', { id: 'mine', isOwner: true, setFlag: vi.fn(async () => {}) }],
      ['theirs', { id: 'theirs', isOwner: false, setFlag: vi.fn(async () => {}) }],
    ]);
    user = {
      id: 'u1',
      isGM: false,
      setFlag: vi.fn(async (s, k, v) => {
        flags[k] = v;
      }),
      getFlag: (s, k) => flags[k],
    };
    vi.stubGlobal('game', {
      user,
      actors,
      i18n: { localize: (k) => k },
      settings: { get: (_n, k) => store[k], set: vi.fn(async (_n, k, v) => (store[k] = v)) },
    });
    vi.stubGlobal('ui', { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  });
  afterAll(() => vi.unstubAllGlobals());

  it('parseTarget', () => {
    expect(mod.parseTarget('default')).toEqual({ kind: 'default', key: '' });
    expect(mod.parseTarget('role:attack')).toEqual({ kind: 'role', key: 'attack' });
    expect(mod.parseTarget('bogus:x')).toBeNull();
    expect(mod.parseTarget('die:')).toBeNull();
  });
  it('default sets the theme setting; clear goes back to the default theme', async () => {
    expect(await mod.assignTarget('default', 'ruby-classic')).toBe(true);
    expect(store.theme).toBe('ruby-classic');
    await mod.clearTarget('default');
    expect(store.theme).toBe('default');
  });
  it('die type and role write one slot of dicer.appearance; clear unsets it', async () => {
    await mod.assignTarget('die:d20', 'ruby-classic');
    await mod.assignTarget('role:attack', 'verdant');
    await mod.clearTarget('role:attack');
    expect(user.setFlag.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      ['dicer', 'appearance', { d20: themeRef('ruby-classic') }],
      ['dicer', 'appearance', { 'role:attack': themeRef('verdant') }],
      ['dicer', 'appearance', { 'role:attack': 'DELETE' }],
    ]);
    expect(await mod.assignTarget('die:d3', 'x')).toBe(false);
    expect(await mod.assignTarget('role:nope', 'x')).toBe(false);
  });
  it('an owned actor gets global = { theme }; an unowned one is refused', async () => {
    expect(await mod.assignTarget('actor:mine', 'verdant')).toBe(true);
    expect(actors.get('mine').setFlag).toHaveBeenCalledWith('dicer', 'appearance', { global: themeRef('verdant') });
    expect(await mod.assignTarget('actor:theirs', 'verdant')).toBe(false);
    expect(actors.get('theirs').setFlag).not.toHaveBeenCalled();
    expect(await mod.assignTarget('actor:ghost', 'verdant')).toBe(false);
  });
  it('a player writes damage overrides (keeping other entries); the world map needs a GM', async () => {
    await mod.assignTarget('damage:fire', 'ember-core');
    expect(store.damageThemeOverrides).toEqual({ acid: 'x', fire: 'ember-core' });
    await mod.clearTarget('damage:acid');
    expect(store.damageThemeOverrides).toEqual({ fire: 'ember-core' });
    expect(await mod.assignTarget('worlddamage:fire', 'ember-core')).toBe(false);
    expect(store.damageTypeMap).toEqual({});
    user.isGM = true;
    expect(await mod.assignTarget('worlddamage:fire', 'ember-core')).toBe(true);
    expect(store.damageTypeMap).toEqual({ fire: 'ember-core' });
  });
  it('a save keeps unreadable stored themes; import adds and notifies with warnings', async () => {
    flags.themes = [{ id: 'user.u1.broken', name: 'Broken' }, raw('user.u1.ok', 'Ok')];
    await mod.saveMine(raw('user.u1.ok', 'Ok 2'));
    expect(flags.themes).toHaveLength(2);
    expect(flags.themes[0].id).toBe('user.u1.broken');
    expect(flags.themes[1].name).toBe('Ok 2');
    const res = await mod.importFromText(JSON.stringify([raw('a', 'Ok'), { id: 'nope' }]));
    expect(res.themes.map((t) => t.id)).toEqual(['user.u1.ok-2']);
    expect(flags.themes.map((t) => t.id)).toEqual(['user.u1.broken', 'user.u1.ok', 'user.u1.ok-2']);
    expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
    await mod.deleteMine('user.u1.ok');
    expect(flags.themes.map((t) => t.id)).toEqual(['user.u1.broken', 'user.u1.ok-2']);
  });
  it('an owned actor theme written by the browser is read by the look resolver (global slot)', async () => {
    const { createLookResolver } = await import('../../src/compat/resolve-looks.js');
    const { createRegistry } = await import('../../src/compat/registry.js');
    const fake = { id: 'mine', flags: { dicer: {} } };
    actors.get('mine').setFlag = vi.fn(async (s, k, v) => {
      fake.flags[s][k] = { ...(fake.flags[s][k] ?? {}), ...v }; // setFlag merges
    });
    await mod.assignTarget('actor:mine', 'dragon-hoard');
    const resolver = createLookResolver({
      registry: createRegistry({ warn: () => {} }),
      getUser: () => undefined,
      getActor: () => fake,
      warn: () => {},
    });
    const t = { faces: 20, options: { dsnActorId: 'mine' }, results: [{ result: 1 }] };
    expect(resolver.decorate(null, {}, 'u')(t, { result: 1 }, 0).themeId).toBe('dragon-hoard');
  });
  it('a stored theme list or damage map of the wrong shape refuses the write and warns once', async () => {
    flags.themes = 'junk';
    expect(await mod.saveMine(raw('user.u1.a', 'A'))).toBe(false);
    expect(await mod.deleteMine('x')).toBe(false);
    expect((await mod.importFromText(JSON.stringify([raw('a', 'A')]))).themes).toEqual([]);
    expect(user.setFlag).not.toHaveBeenCalled();
    expect(flags.themes).toBe('junk');
    store.worldThemes = { not: 'a list' };
    user.isGM = true;
    expect((await mod.publish(BUILTIN_THEMES[0])).ok).toBe(false);
    expect(await mod.deleteWorld('x')).toBe(false);
    expect(store.worldThemes).toEqual({ not: 'a list' });
    store.damageThemeOverrides = 'junk';
    expect(await mod.assignTarget('damage:fire', 'ember-core')).toBe(false);
    expect(store.damageThemeOverrides).toBe('junk');
    store.damageTypeMap = [1];
    expect(await mod.assignTarget('worlddamage:fire', 'ember-core')).toBe(false);
    expect(store.damageTypeMap).toEqual([1]);
    // one warning per stored value kind, however often it is hit
    expect(ui.notifications.warn.mock.calls.length).toBe(4);
  });
  it('publish and delete-world are GM only', async () => {
    expect((await mod.publish(BUILTIN_THEMES[0])).ok).toBe(false);
    expect(store.worldThemes).toEqual([]);
    expect(await mod.deleteWorld('world.x')).toBe(false);
    user.isGM = true;
    const res = await mod.publish(BUILTIN_THEMES[0]);
    expect(res.ok).toBe(true);
    expect(store.worldThemes.map((t) => t.id)).toEqual([res.id]);
    expect(await mod.deleteWorld(res.id)).toBe(true);
    expect(store.worldThemes).toEqual([]);
  });
  it('exportToFile hands JSON to saveDataToFile', () => {
    mod.exportToFile([BUILTIN_THEMES[0]], 'f.json');
    const [json, type, name] = foundry.utils.saveDataToFile.mock.calls[0];
    expect([type, name]).toEqual(['application/json', 'f.json']);
    expect(JSON.parse(json).themes[0].id).toBe(BUILTIN_THEMES[0].id);
  });
  it('targetGroups offers actors and world damage types only as allowed', () => {
    const player = mod.targetGroups({ actors: [{ id: 'a', name: 'A' }], damageTypes: ['fire'], isGM: false });
    expect(player.map((g) => g.label)).not.toContain('DICER.Themes.Group.worldDamage');
    const gm = mod.targetGroups({ actors: [], damageTypes: ['fire'], isGM: true });
    expect(gm.map((g) => g.label)).toContain('DICER.Themes.Group.worldDamage');
    expect(gm.map((g) => g.label)).not.toContain('DICER.Themes.Group.actor');
  });
});

describe('lang/en.json', () => {
  it('has no duplicate keys and resolves every DICER.Themes key the browser and template use', () => {
    expect(duplicateKeys()).toEqual([]);
    const lang = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Themes;
    const keys = usedKeys('Themes', ['src/ui/theme-browser.js', 'templates/theme-browser.hbs']);
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect(typeof resolve(lang, k), `DICER.Themes.${k}`).toBe('string');
  });
  it('has the themeBrowser menu keys', () => {
    const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Settings.themeBrowser;
    expect(Object.keys(en).sort()).toEqual(['Hint', 'Label', 'Name']);
  });
});

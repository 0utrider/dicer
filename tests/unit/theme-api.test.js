import { afterEach, describe, expect, test, vi } from 'vitest';
import { createThemeApi, preloadReferencedStubs } from '../../src/api/theme-api.js';
import { MATERIALS, PROVIDERS, WARM_THEMES, flagChoice, providedTheme } from '../../src/api/theme-registry.js';
import { ADDON_THEMES, MISSING, findTheme } from '../../src/themes/themes.js';
import { ADDON_FONTS, fontGroups } from '../../src/api/addon-fonts.js';
import { BROWSER_TABS, SHOW_IN_ALL, STUBS, inAll, loadStub, stubView, tabEntries } from '../../src/api/addon-registry.js';
import { galleryEntries } from '../../src/ui/theme-form.js';

const MOD = 'necromancer-thrall-helper';
const theme = (slug, extra = {}) => ({ id: `${MOD}.${slug}`, name: slug, appearance: { body: { type: 'opaque', color: '#203020' } }, ...extra });
const make = () => {
  const hooks = { callAll: vi.fn() };
  const modules = () => ({ get: (id) => (id === MOD || id === 'other' ? { id, title: 'Necromancer Thrall Helper' } : undefined) });
  return { api: createThemeApi({ hooks, modules }), hooks };
};
/** An actor with a dice flag, owned or not. */
const actor = (flag, isOwner = true) => {
  const a = {
    isOwner,
    flags: { dicer: flag === undefined ? {} : { appearance: flag } },
    getFlag: (s, k) => a.flags.dicer?.[k],
    setFlag: vi.fn(async (s, k, v) => (a.flags.dicer[k] = { ...(a.flags.dicer[k] ?? {}), ...v })),
    unsetFlag: vi.fn(async (s, k) => delete a.flags.dicer[k]),
  };
  return a;
};

afterEach(() => {
  ADDON_FONTS.clear();
  MATERIALS.clear();
  STUBS.clear();
  MISSING.hook = null;
  BROWSER_TABS.clear();
  ADDON_THEMES.clear();
  PROVIDERS.clear();
});

describe('registerTheme', () => {
  test("a module's theme registers, resolves through findTheme, shows in the gallery and fires dicer.themesChanged", () => {
    const { api, hooks } = make();
    expect(api.registerTheme(theme('necromancer'), { moduleId: MOD })).toBe(true);
    expect(findTheme(`${MOD}.necromancer`)).toMatchObject({ name: 'necromancer', source: 'addon', moduleId: MOD });
    expect(hooks.callAll).toHaveBeenCalledWith('dicer.themesChanged');
    expect(galleryEntries({}).themes.some((t) => t.id === `${MOD}.necromancer` && t.source === 'addon')).toBe(true);
    expect(api.listThemes(MOD).map((t) => t.id)).toEqual([`${MOD}.necromancer`]);
  });

  test('ids must be namespaced by an installed module; a bad theme is refused', () => {
    const { api } = make();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(api.registerTheme(theme('x'), { moduleId: 'missing-module' })).toBe(false);
    expect(api.registerTheme({ ...theme('x'), id: 'other.x' }, { moduleId: MOD })).toBe(false); // not its namespace
    expect(api.registerTheme(theme('x'))).toBe(false);
    expect(api.registerTheme({ id: `${MOD}.y` }, { moduleId: MOD })).toBe(false); // no name or appearance
    expect(ADDON_THEMES.size).toBe(0);
    warn.mockRestore();
  });

  test('re-registering replaces; unregistering removes; a built-in id always wins', () => {
    const { api } = make();
    api.registerTheme(theme('thralls', { name: 'Old' }), { moduleId: MOD });
    api.registerTheme(theme('thralls', { name: 'New' }), { moduleId: MOD });
    expect(findTheme(`${MOD}.thralls`).name).toBe('New');
    expect(api.unregisterTheme(`${MOD}.thralls`)).toBe(true);
    expect(findTheme(`${MOD}.thralls`)).toBeNull();
    expect(api.unregisterTheme(`${MOD}.thralls`)).toBe(false);
  });

  test('registered themes are read-only: list copies, frozen entries', () => {
    const { api } = make();
    api.registerTheme(theme('necromancer'), { moduleId: MOD });
    api.listThemes()[0].name = 'changed';
    expect(findTheme(`${MOD}.necromancer`).name).toBe('necromancer');
    expect(Object.isFrozen(ADDON_THEMES.get(`${MOD}.necromancer`))).toBe(true);
  });
});

describe('actor choices', () => {
  test('hasActorChoice: a theme, a non-default look, an appearance, a colorset or a system on any slot', () => {
    const { api } = make();
    expect(api.hasActorChoice(actor(undefined))).toBe(false);
    expect(api.hasActorChoice(actor({ global: { look: 'default' } }))).toBe(false);
    expect(api.hasActorChoice(actor({ global: { theme: 'default', chosen: null } }))).toBe(false); // never chose
    expect(api.hasActorChoice(actor({ global: { theme: 'verdant' } }))).toBe(true);
    expect(api.hasActorChoice(actor({ d20: { colorset: 'fire' } }))).toBe(true);
    expect(api.hasActorChoice(actor({ system: 'trs' }))).toBe(true); // a flat Dice So Nice ref
  });

  test('setActorTheme writes a chosen global; ifUnset leaves an existing choice; unknown theme or no owner refused', async () => {
    const { api } = make();
    api.registerTheme(theme('necromancer'), { moduleId: MOD });
    const a = actor(undefined);
    expect(await api.setActorTheme(a, `${MOD}.necromancer`, { ifUnset: true })).toBe(true);
    expect(api.getActorTheme(a)).toBe(`${MOD}.necromancer`);
    const chose = actor({ global: { theme: 'verdant' } });
    expect(await api.setActorTheme(chose, `${MOD}.necromancer`, { ifUnset: true })).toBe(false);
    expect(chose.setFlag).not.toHaveBeenCalled();
    expect(await api.setActorTheme(actor(undefined), 'no-such-theme')).toBe(false);
    expect(await api.setActorTheme(actor(undefined, false), `${MOD}.necromancer`)).toBe(false);
    expect(await api.clearActorTheme(a)).toBe(true);
    expect(api.hasActorChoice(a)).toBe(false);
  });

  test('a default provider answers for an actor with no choice only, never writing to it', () => {
    const { api } = make();
    api.registerTheme(theme('necromancer'), { moduleId: MOD });
    expect(api.registerDefaultProvider(MOD, (a) => (a.necro ? `${MOD}.necromancer` : null))).toBe(true);
    const necro = { ...actor(undefined), necro: true };
    expect(api.getActorTheme(necro)).toBe(`${MOD}.necromancer`);
    expect(necro.setFlag).not.toHaveBeenCalled();
    expect(api.getActorTheme({ ...actor({ global: { theme: 'verdant' } }), necro: true })).toBe('verdant'); // a choice wins
    expect(api.getActorTheme(actor(undefined))).toBeNull();
    expect(api.registerDefaultProvider('missing-module', () => null)).toBe(false);
  });
});

describe('the registry rolls use', () => {
  test('providedTheme skips a throwing provider and ids that name no theme', () => {
    PROVIDERS.set('a', () => {
      throw new Error('bad');
    });
    PROVIDERS.set('b', () => 'not-a-theme');
    PROVIDERS.set('c', () => 'verdant');
    expect(providedTheme({})).toBe('verdant');
    expect(flagChoice(undefined)).toBe(false);
  });
});

test('registering a default provider fires dicer.themesChanged (its looks are warmed)', () => {
  const { api, hooks } = make();
  expect(api.registerDefaultProvider(MOD, () => null)).toBe(true);
  expect(hooks.callAll).toHaveBeenCalledWith('dicer.themesChanged');
});

describe('warmThemes', () => {
  afterEach(() => WARM_THEMES.clear());

  test('queues known ids, ignores unknown ones and returns the count', () => {
    const { api } = make();
    api.registerTheme(theme('blood'), { moduleId: MOD });
    expect(api.warmThemes([`${MOD}.blood`, `${MOD}.missing`, 42, 'obsidian'])).toBe(2);
    expect([...WARM_THEMES]).toEqual([`${MOD}.blood`, 'obsidian']);
  });

  test('fires dicer.themesChanged only when an id is new', () => {
    const { api, hooks } = make();
    api.warmThemes(['obsidian']);
    expect(hooks.callAll).toHaveBeenCalledTimes(1);
    expect(api.warmThemes(['obsidian'])).toBe(1);
    expect(hooks.callAll).toHaveBeenCalledTimes(1);
  });

  test('a non-array queues nothing', () => {
    const { api, hooks } = make();
    expect(api.warmThemes('obsidian')).toBe(0);
    expect(api.warmThemes()).toBe(0);
    expect(WARM_THEMES.size).toBe(0);
    expect(hooks.callAll).not.toHaveBeenCalled();
  });
});

describe('registerFont', () => {
  const font = (slug, extra = {}) => ({ id: `${MOD}.${slug}`, label: 'Lexend', file: 'modules/necromancer-thrall-helper/fonts/Lexend-Bold.woff2', ...extra });

  test('registers, replaces, lists copies, fires dicer.fontsChanged and unregisters', () => {
    const { api, hooks } = make();
    expect(api.registerFont(MOD, font('lexend'))).toBe(true);
    expect(hooks.callAll).toHaveBeenCalledWith('dicer.fontsChanged');
    expect(api.registerFont(MOD, font('lexend', { label: ' Lexend Bold ' }))).toBe(true);
    expect(api.listFonts(MOD)).toEqual([{ id: `${MOD}.lexend`, moduleId: MOD, label: 'Lexend Bold', file: font('x').file }]);
    api.listFonts(MOD)[0].label = 'changed';
    expect(api.listFonts()[0].label).toBe('Lexend Bold'); // copies
    expect(api.unregisterFont(`${MOD}.lexend`)).toBe(true);
    expect(api.unregisterFont(`${MOD}.lexend`)).toBe(false);
  });

  test('needs an installed module, a namespaced id, a label and a file path a theme could name', () => {
    const { api } = make();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(api.registerFont('missing', font('x'))).toBe(false);
    expect(api.registerFont(MOD, font('x', { id: 'other.x' }))).toBe(false);
    expect(api.registerFont(MOD, font('x', { label: '  ' }))).toBe(false);
    expect(api.registerFont(MOD, font('x', { file: '/etc/passwd' }))).toBe(false); // absolute
    expect(api.registerFont(MOD, font('x', { file: 'fonts/../secret.woff2' }))).toBe(false);
    expect(api.registerFont(MOD, font('x', { file: 'fonts/readme.txt' }))).toBe(false); // not a font file
    expect(api.registerFont(MOD)).toBe(false);
    expect(ADDON_FONTS.size).toBe(0);
    warn.mockRestore();
  });

  test('fontGroups lists the fonts by module, in registration order', () => {
    const { api } = make();
    api.registerFont(MOD, font('a', { label: 'A' }));
    api.registerFont('other', { id: 'other.b', label: 'B', file: 'modules/other/b.woff2' });
    api.registerFont(MOD, font('c', { label: 'C' }));
    expect(fontGroups().map((g) => [g.moduleId, g.fonts.map((f) => f.label)])).toEqual([[MOD, ['A', 'C']], ['other', ['B']]]);
  });
});

describe('theme metadata and showInAll', () => {
  test('badge, category and preview are kept on a registered theme; blanks and non-strings are dropped', () => {
    const { api } = make();
    api.registerTheme(theme('a', { badge: 'Halloween', category: 'damage', preview: 'modules/x/a.webp' }), { moduleId: MOD });
    api.registerTheme(theme('b', { badge: '', category: 5, preview: null }), { moduleId: MOD });
    expect(findTheme(`${MOD}.a`)).toMatchObject({ badge: 'Halloween', category: 'damage', preview: 'modules/x/a.webp' });
    const b = findTheme(`${MOD}.b`);
    expect(b).not.toHaveProperty('badge');
    expect(b).not.toHaveProperty('category');
    expect(b).not.toHaveProperty('preview');
  });

  test('showInAll takes a boolean or a predicate (theme, date); re-registering resets it', async () => {
    const { inAll, SHOW_IN_ALL } = await import('../../src/api/addon-registry.js');
    const { api } = make();
    const id = `${MOD}.s`;
    api.registerTheme(theme('s'), { moduleId: MOD });
    expect(inAll(findTheme(id))).toBe(true); // no rule: in All
    api.registerTheme(theme('s'), { moduleId: MOD, showInAll: false });
    expect(inAll(findTheme(id))).toBe(false);
    const rule = vi.fn((t, date) => date.getMonth() === 9);
    api.registerTheme(theme('s'), { moduleId: MOD, showInAll: rule });
    expect(inAll(findTheme(id), new Date(2026, 9, 31))).toBe(true);
    expect(inAll(findTheme(id), new Date(2026, 10, 1))).toBe(false);
    expect(rule.mock.calls[0][0].id).toBe(id);
    api.registerTheme(theme('s'), { moduleId: MOD });
    expect(inAll(findTheme(id))).toBe(true);
    api.registerTheme(theme('s'), { moduleId: MOD, showInAll: false });
    api.unregisterTheme(id);
    expect(SHOW_IN_ALL.has(id)).toBe(false);
  });

  test('a throwing showInAll predicate leaves the theme in All', async () => {
    const { inAll } = await import('../../src/api/addon-registry.js');
    const { api } = make();
    api.registerTheme(theme('t'), { moduleId: MOD, showInAll: () => { throw new Error('x'); } });
    expect(inAll(findTheme(`${MOD}.t`))).toBe(true);
  });

  test('a duplicate or world copy of a module theme drops its badge, category and preview', async () => {
    const { duplicateTheme } = await import('../../src/ui/theme-form.js');
    const { api } = make();
    api.registerTheme(theme('d', { badge: 'Yule', category: 'x', preview: 'p.webp' }), { moduleId: MOD });
    const copy = duplicateTheme(findTheme(`${MOD}.d`), 'u1', []);
    expect(copy).not.toHaveProperty('badge');
    expect(copy).not.toHaveProperty('category');
    expect(copy).not.toHaveProperty('preview');
  });
});

describe('getUserDefault / setUserDefault', () => {
  const settingsStore = (init = {}) => {
    const store = { theme: 'default', worldDefaultTheme: '', lockPlayerLooks: false, worldThemes: [], ...init };
    return { store, get: (m, k) => store[k], set: vi.fn(async (m, k, v) => (store[k] = v)) };
  };
  const userOf = (flags = {}, isGM = false) => {
    const u = {
      isGM,
      flags: { dicer: flags },
      getFlag: (s, k) => u.flags.dicer[k],
      setFlag: vi.fn(async (s, k, v) => (u.flags.dicer[k] = { ...(u.flags.dicer[k] ?? {}), ...v })),
    };
    return u;
  };
  const withGame = (user, settings) => {
    globalThis.game = { user, settings };
  };
  afterEach(() => delete globalThis.game);

  test('the stored global theme wins, then the world default, then the client setting, else "default"', () => {
    const { api } = make();
    const me = userOf();
    const settings = settingsStore();
    withGame(me, settings);
    expect(api.getUserDefault()).toBe('default');
    settings.store.theme = 'ruby-classic';
    expect(api.getUserDefault()).toBe('ruby-classic');
    api.registerTheme(theme('w'), { moduleId: MOD });
    settings.store.worldDefaultTheme = `${MOD}.w`;
    expect(api.getUserDefault()).toBe(`${MOD}.w`);
    me.flags.dicer.appearance = { global: { theme: 'abyss-liquid', chosen: true } };
    expect(api.getUserDefault()).toBe('abyss-liquid');
    expect(api.getUserDefault(userOf())).toBe(`${MOD}.w`); // another user: no client setting
  });

  test('set writes the flag and the setting like the browser button, then reads back', async () => {
    const { api } = make();
    const me = userOf();
    const settings = settingsStore();
    withGame(me, settings);
    api.registerTheme(theme('h'), { moduleId: MOD });
    expect(await api.setUserDefault(`${MOD}.h`)).toBe(true);
    expect(me.flags.dicer.appearance.global).toMatchObject({ theme: `${MOD}.h`, chosen: true });
    expect(settings.set).toHaveBeenCalledWith('dicer', 'theme', `${MOD}.h`);
    expect(api.getUserDefault()).toBe(`${MOD}.h`);
    expect(await api.setUserDefault('default')).toBe(true);
    expect(settings.set).toHaveBeenLastCalledWith('dicer', 'theme', 'default');
    expect(api.getUserDefault()).toBe('default');
  });

  test('an unknown theme, a locked player and another user without a GM are refused', async () => {
    const { api } = make();
    const me = userOf();
    const settings = settingsStore();
    withGame(me, settings);
    expect(await api.setUserDefault('nope.nothing')).toBe(false);
    expect(await api.setUserDefault('ruby-classic', userOf())).toBe(false); // not a GM
    settings.store.lockPlayerLooks = true;
    settings.store.worldDefaultTheme = 'ruby-classic';
    expect(await api.setUserDefault('abyss-liquid')).toBe(false);
    expect(me.setFlag).not.toHaveBeenCalled();
  });

  test('a GM sets another user\'s default: the flag only, no client setting', async () => {
    const { api } = make();
    const gm = userOf({}, true);
    const player = userOf();
    const settings = settingsStore();
    withGame(gm, settings);
    expect(await api.setUserDefault('ruby-classic', player)).toBe(true);
    expect(player.flags.dicer.appearance.global.theme).toBe('ruby-classic');
    expect(settings.set).not.toHaveBeenCalled();
  });
});

describe('registerBrowserTab', () => {
  const tab = (extra = {}) => ({ id: `${MOD}-holidays`, label: 'Holidays', icon: 'fa-solid fa-gift', filter: (t) => t.category === 'holiday', ...extra });

  test('registers a tab, replaces one of the same id, fires dicer.themesChanged and unregisters', () => {
    const { api, hooks } = make();
    expect(api.registerBrowserTab(MOD, tab())).toBe(true);
    expect(hooks.callAll).toHaveBeenCalledWith('dicer.themesChanged');
    expect(BROWSER_TABS.get(`${MOD}-holidays`)).toMatchObject({ moduleId: MOD, label: 'Holidays', icon: 'fa-solid fa-gift' });
    api.registerBrowserTab(MOD, tab({ label: 'Seasons' }));
    expect(BROWSER_TABS.size).toBe(1);
    expect(BROWSER_TABS.get(`${MOD}-holidays`).label).toBe('Seasons');
    expect(api.unregisterBrowserTab(`${MOD}-holidays`)).toBe(true);
    expect(api.unregisterBrowserTab(`${MOD}-holidays`)).toBe(false);
  });

  test('needs an installed module, an id with its prefix, a label and a filter function', () => {
    const { api } = make();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(api.registerBrowserTab('missing', tab({ id: 'missing-x' }))).toBe(false);
    expect(api.registerBrowserTab(MOD, tab({ id: 'other-holidays' }))).toBe(false);
    expect(api.registerBrowserTab(MOD, tab({ id: MOD }))).toBe(false);
    expect(api.registerBrowserTab(MOD, tab({ label: '' }))).toBe(false);
    expect(api.registerBrowserTab(MOD, tab({ filter: 'nope' }))).toBe(false);
    expect(api.registerBrowserTab(MOD)).toBe(false);
    expect(BROWSER_TABS.size).toBe(0);
    warn.mockRestore();
  });

  test('tabEntries filters, sorts and groups by section (sections in first-seen order)', () => {
    const themes = [
      { id: 'a', name: 'A', category: 'holiday', when: 3 },
      { id: 'b', name: 'B', category: 'holiday', when: 1 },
      { id: 'c', name: 'C', category: 'other', when: 2 },
      { id: 'd', name: 'D', category: 'holiday', when: 2 },
    ];
    const { api } = make();
    api.registerBrowserTab(MOD, tab({ sort: (x, y) => x.when - y.when, sections: (t) => (t.when < 3 ? 'In season' : 'Coming up') }));
    const entries = tabEntries(BROWSER_TABS.get(`${MOD}-holidays`), themes);
    expect(entries.map((e) => [e.theme.id, e.section])).toEqual([['b', 'In season'], ['d', 'In season'], ['a', 'Coming up']]);
  });

  test('without sections there are no headings; throwing callbacks fall back quietly', () => {
    const themes = [{ id: 'a', category: 'holiday' }, { id: 'b', category: 'holiday' }];
    const { api } = make();
    api.registerBrowserTab(MOD, tab());
    expect(tabEntries(BROWSER_TABS.get(`${MOD}-holidays`), themes).map((e) => e.section)).toEqual([null, null]);
    api.registerBrowserTab(MOD, tab({ sort: () => { throw new Error('s'); }, sections: () => { throw new Error('h'); } }));
    expect(tabEntries(BROWSER_TABS.get(`${MOD}-holidays`), themes).map((e) => [e.theme.id, e.section])).toEqual([['a', null], ['b', null]]);
    api.registerBrowserTab(MOD, tab({ filter: () => { throw new Error('f'); } }));
    expect(tabEntries(BROWSER_TABS.get(`${MOD}-holidays`), themes)).toEqual([]);
  });
});

describe('registerThemeStub', () => {
  const stub = (slug, load, extra = {}) => ({ id: `${MOD}.${slug}`, name: slug, badge: 'Yule', preview: 'p.webp', load, ...extra });

  test('a stub is a gallery card with its preview and resolves to nothing until loaded', () => {
    const { api, hooks } = make();
    expect(api.registerThemeStub(MOD, stub('snow', async () => theme('snow')))).toBe(true);
    expect(hooks.callAll).toHaveBeenCalledWith('dicer.themesChanged');
    const card = galleryEntries({}).themes.find((t) => t.id === `${MOD}.snow`);
    expect(card).toMatchObject({ stub: true, name: 'snow', badge: 'Yule', preview: 'p.webp', source: 'addon', moduleId: MOD });
    expect(ADDON_THEMES.has(`${MOD}.snow`)).toBe(false);
  });

  test('loadStub swaps the stub for the full theme, keeps the stub badge and preview, fires themesChanged, loads once', async () => {
    const { api, hooks } = make();
    const load = vi.fn(async () => theme('snow'));
    api.registerThemeStub(MOD, stub('snow', load));
    hooks.callAll.mockClear();
    globalThis.Hooks = hooks;
    const [a, b] = await Promise.all([loadStub(`${MOD}.snow`, { hooks }), loadStub(`${MOD}.snow`, { hooks })]);
    delete globalThis.Hooks;
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(findTheme(`${MOD}.snow`)).toMatchObject({ source: 'addon', moduleId: MOD, badge: 'Yule', preview: 'p.webp' });
    expect(STUBS.has(`${MOD}.snow`)).toBe(false);
    expect(hooks.callAll).toHaveBeenCalledWith('dicer.themesChanged');
    expect(galleryEntries({}).themes.filter((t) => t.id === `${MOD}.snow`)).toHaveLength(1);
  });

  test('a roll reaching a stored reference (findTheme) starts the load; the roll itself gets nothing yet', async () => {
    const { api } = make();
    const load = vi.fn(async () => theme('snow'));
    api.registerThemeStub(MOD, stub('snow', load));
    expect(findTheme(`${MOD}.snow`)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(findTheme(`${MOD}.snow`)).toMatchObject({ name: 'snow' });
    expect(findTheme('nobody.knows')).toBeNull(); // not a stub: nothing loads
  });

  test('a failing load warns once, keeps the stub, is not retried by rolls and can be retried on request', async () => {
    const { api } = make();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let ok = false;
    const load = vi.fn(async () => {
      if (!ok) throw new Error('offline');
      return theme('snow');
    });
    api.registerThemeStub(MOD, stub('snow', load));
    expect(await loadStub(`${MOD}.snow`)).toBeNull();
    expect(await loadStub(`${MOD}.snow`)).toBeNull(); // no retry on its own
    findTheme(`${MOD}.snow`);
    expect(load).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(STUBS.has(`${MOD}.snow`)).toBe(true);
    ok = true;
    expect(await loadStub(`${MOD}.snow`, { retry: true })).toMatchObject({ name: 'snow' });
    warn.mockRestore();
  });

  test('a load that returns the wrong id or an invalid theme is a failure', async () => {
    const { api } = make();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.registerThemeStub(MOD, stub('a', async () => theme('other')));
    api.registerThemeStub(MOD, stub('b', async () => ({ id: `${MOD}.b` })));
    expect(await loadStub(`${MOD}.a`)).toBeNull();
    expect(await loadStub(`${MOD}.b`)).toBeNull();
    expect(ADDON_THEMES.size).toBe(0);
    warn.mockRestore();
  });

  test('needs a module, a namespaced id, a name and load(); a loaded id is not stubbed again; unregister removes a stub', () => {
    const { api } = make();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(api.registerThemeStub('missing', stub('x', async () => ({})))).toBe(false);
    expect(api.registerThemeStub(MOD, { ...stub('x', async () => ({})), id: 'other.x' })).toBe(false);
    expect(api.registerThemeStub(MOD, { ...stub('x', async () => ({})), name: '' })).toBe(false);
    expect(api.registerThemeStub(MOD, { ...stub('x'), load: undefined })).toBe(false);
    api.registerTheme(theme('full'), { moduleId: MOD });
    expect(api.registerThemeStub(MOD, stub('full', async () => theme('full')))).toBe(false);
    api.registerThemeStub(MOD, stub('y', async () => theme('y')));
    expect(api.unregisterTheme(`${MOD}.y`)).toBe(true);
    expect(STUBS.size).toBe(0);
    warn.mockRestore();
  });
});

describe('theme materials', () => {
  test("registerTheme's material names a hook in every look of the theme", () => {
    const { api } = make();
    const beforeShaderCompile = vi.fn();
    const t = theme('lights', { perType: { d20: { body: { type: 'opaque', color: '#111111' } } } });
    expect(api.registerTheme(t, { moduleId: MOD, material: { beforeShaderCompile, cacheKey: `${MOD}-lights` } })).toBe(true);
    const found = findTheme(`${MOD}.lights`);
    expect(found.appearance.material).toBe(`${MOD}-lights`);
    expect(found.perType.d20.material).toBe(`${MOD}-lights`);
    expect(MATERIALS.get(`${MOD}-lights`)).toMatchObject({ cacheKey: `${MOD}-lights`, moduleId: MOD, themeId: `${MOD}.lights` });
    expect(api.unregisterTheme(`${MOD}.lights`)).toBe(true);
    expect(MATERIALS.size).toBe(0);
  });

  test('a look can name a material registered on its own; bad registrations are refused', () => {
    const { api } = make();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = () => {};
    expect(api.registerMaterial(MOD, { cacheKey: `${MOD}-snow`, beforeShaderCompile: fn })).toBe(`${MOD}-snow`);
    api.registerTheme(theme('snow', { appearance: { body: { type: 'opaque', color: '#fff' }, material: `${MOD}-snow` } }), { moduleId: MOD });
    expect(findTheme(`${MOD}.snow`).appearance.material).toBe(`${MOD}-snow`);
    expect(api.registerMaterial(MOD, { cacheKey: 'other-snow', beforeShaderCompile: fn })).toBeNull(); // not prefixed
    expect(api.registerMaterial(MOD, { cacheKey: `${MOD}-x` })).toBeNull(); // no callback
    expect(api.registerMaterial('missing', { cacheKey: 'missing-x', beforeShaderCompile: fn })).toBeNull();
    expect(api.registerTheme(theme('bad'), { moduleId: MOD, material: { cacheKey: 'nope' } })).toBe(false);
    expect(ADDON_THEMES.has(`${MOD}.bad`)).toBe(false);
    warn.mockRestore();
  });
});

describe('review fixes: stubs, ids, materials', () => {
  const stubOf = (slug, load = async () => theme(slug), extra = {}) => ({ id: `${MOD}.${slug}`, name: slug, load, ...extra });
  afterEach(() => delete globalThis.game);

  test('registerTheme over a stub replaces it: one card, and a later load cannot overwrite the theme', async () => {
    const { api } = make();
    const load = vi.fn(async () => theme('x', { name: 'FromStub' }));
    api.registerThemeStub(MOD, stubOf('x', load));
    expect(api.registerTheme(theme('x', { name: 'Real' }), { moduleId: MOD })).toBe(true);
    expect(STUBS.has(`${MOD}.x`)).toBe(false);
    expect(galleryEntries({}).themes.filter((t) => t.id === `${MOD}.x`)).toHaveLength(1);
    expect(await loadStub(`${MOD}.x`)).toMatchObject({ name: 'Real' });
    expect(load).not.toHaveBeenCalled();
    expect(findTheme(`${MOD}.x`).name).toBe('Real');
  });

  test('registerTheme and the other registrars work destructured from the api', () => {
    const { api } = make();
    const { registerTheme, registerMaterial } = api;
    expect(registerTheme(theme('d'), { moduleId: MOD, material: { cacheKey: `${MOD}-d`, beforeShaderCompile() {} } })).toBe(true);
    expect(MATERIALS.has(`${MOD}-d`)).toBe(true);
    expect(registerMaterial(MOD, { cacheKey: `${MOD}-e`, beforeShaderCompile() {} })).toBe(`${MOD}-e`);
  });

  test('registering a theme again without a material drops its old hook', () => {
    const { api } = make();
    api.registerTheme(theme('m'), { moduleId: MOD, material: { cacheKey: `${MOD}-m`, beforeShaderCompile() {} } });
    expect(MATERIALS.has(`${MOD}-m`)).toBe(true);
    api.registerMaterial(MOD, { cacheKey: `${MOD}-shared`, beforeShaderCompile() {} }); // another, registered alone: kept
    api.registerTheme(theme('m'), { moduleId: MOD });
    expect(MATERIALS.has(`${MOD}-m`)).toBe(false);
    expect(MATERIALS.has(`${MOD}-shared`)).toBe(true);
  });

  test('ids need a separator after the module id, so one module cannot claim another one\'s keys', () => {
    const modules = () => ({ get: (id) => (['dice', 'dicer', MOD].includes(id) ? { id } : undefined) });
    const api = createThemeApi({ hooks: { callAll: vi.fn() }, modules });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tab = (id) => ({ id, label: 'T', filter: () => true });
    expect(api.registerBrowserTab('dice', tab('dicer-holidays'))).toBe(false); // "dice" is not "dicer"
    expect(api.registerBrowserTab('dicer', tab('dicer-holidays'))).toBe(true);
    expect(api.registerBrowserTab('dice', tab('dice.holidays'))).toBe(true); // a dot works too
    expect(api.registerBrowserTab('dice', tab('dice'))).toBe(false);
    expect(api.registerBrowserTab('dice', tab('dice-'))).toBe(false); // nothing after the separator
    const mat = (cacheKey) => ({ cacheKey, beforeShaderCompile() {} });
    expect(api.registerMaterial('dice', mat('dicer-lights'))).toBeNull();
    expect(api.registerMaterial('dice', mat('dice-lights'))).toBe('dice-lights');
    expect(api.registerMaterial('dice', mat('dice.lights'))).toBe('dice.lights');
    expect(api.registerMaterial('dice', mat('diceX'))).toBeNull();
    warn.mockRestore();
  });

  test('each registration of a cacheKey is a revision, part of the key dice and programs use', () => {
    const { api } = make();
    const hooks = [vi.fn(), vi.fn()];
    api.registerMaterial(MOD, { cacheKey: `${MOD}-r`, beforeShaderCompile: hooks[0] });
    const first = MATERIALS.get(`${MOD}-r`);
    api.registerMaterial(MOD, { cacheKey: `${MOD}-r`, beforeShaderCompile: hooks[1] });
    const second = MATERIALS.get(`${MOD}-r`);
    expect(second.rev).toBe(first.rev + 1);
    expect(first.key).toBe(`${MOD}-r@${first.rev}`);
    expect(second.key).toBe(`${MOD}-r@${second.rev}`);
    second.hook('d20')({ uniforms: {}, fragmentShader: '' }, {});
    expect(hooks[1]).toHaveBeenCalledTimes(1);
    expect(hooks[0]).not.toHaveBeenCalled();
  });

  test('a revision is never reused after the entry is deleted, and a new cacheKey drops the theme\'s old entry', () => {
    const { api } = make();
    const mat = (cacheKey) => ({ cacheKey, beforeShaderCompile() {} });
    api.registerTheme(theme('rv'), { moduleId: MOD, material: mat(`${MOD}-rv`) });
    const first = MATERIALS.get(`${MOD}-rv`).key;
    api.unregisterTheme(`${MOD}.rv`);
    api.registerTheme(theme('rv'), { moduleId: MOD, material: mat(`${MOD}-rv`) });
    expect(MATERIALS.get(`${MOD}-rv`).key).not.toBe(first);
    api.registerTheme(theme('rv'), { moduleId: MOD, material: mat(`${MOD}-rv2`) });
    expect(MATERIALS.has(`${MOD}-rv`)).toBe(false);
    expect(MATERIALS.has(`${MOD}-rv2`)).toBe(true);
  });

  test('a stub takes showInAll, keeps it after it loads, and a stub registered without one has none', async () => {
    const { api } = make();
    api.registerThemeStub(MOD, stubOf('s', undefined, { showInAll: false }));
    expect(inAll(stubView(STUBS.get(`${MOD}.s`)))).toBe(false);
    await loadStub(`${MOD}.s`);
    expect(inAll(findTheme(`${MOD}.s`))).toBe(false); // still out of All once loaded
    const rule = vi.fn((t, date) => date.getMonth() === 11);
    api.registerThemeStub(MOD, stubOf('t', undefined, { showInAll: rule }));
    expect(inAll(stubView(STUBS.get(`${MOD}.t`)), new Date(2026, 11, 1))).toBe(true);
    expect(inAll(stubView(STUBS.get(`${MOD}.t`)), new Date(2026, 5, 1))).toBe(false);
    api.registerThemeStub(MOD, stubOf('u', undefined, { showInAll: false }));
    api.registerThemeStub(MOD, stubOf('u'));
    expect(SHOW_IN_ALL.has(`${MOD}.u`)).toBe(false);
  });

  describe('a default that is a stub', () => {
    const store = (extra = {}) => {
      const values = { theme: 'default', worldDefaultTheme: '', lockPlayerLooks: false, worldThemes: [], ...extra };
      return { values, get: (m, k) => values[k], set: vi.fn(async (m, k, v) => (values[k] = v)) };
    };
    const userOf = () => {
      const u = { isGM: false, flags: { dicer: {} }, getFlag: (s, k) => u.flags.dicer[k], setFlag: vi.fn(async (s, k, v) => (u.flags.dicer[k] = { ...(u.flags.dicer[k] ?? {}), ...v })) };
      return u;
    };

    test('setUserDefault loads the stub first and succeeds on the first call; a failed load stores nothing', async () => {
      const { api } = make();
      const me = userOf();
      const settings = store();
      globalThis.game = { user: me, settings };
      const load = vi.fn(async () => theme('d'));
      api.registerThemeStub(MOD, stubOf('d', load));
      expect(await api.setUserDefault(`${MOD}.d`)).toBe(true);
      expect(load).toHaveBeenCalledTimes(1);
      expect(me.flags.dicer.appearance.global.theme).toBe(`${MOD}.d`);
      expect(settings.set).toHaveBeenCalledWith('dicer', 'theme', `${MOD}.d`);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const me2 = userOf();
      globalThis.game = { user: me2, settings: store() };
      api.registerThemeStub(MOD, stubOf('bad', async () => { throw new Error('offline'); }));
      expect(await api.setUserDefault(`${MOD}.bad`)).toBe(false);
      expect(me2.setFlag).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    test('getUserDefault returns a world default that is a stub without starting its load', () => {
      const { api } = make();
      const load = vi.fn(async () => theme('w'));
      api.registerThemeStub(MOD, stubOf('w', load));
      globalThis.game = { user: userOf(), settings: store({ worldDefaultTheme: `${MOD}.w` }) };
      expect(api.getUserDefault()).toBe(`${MOD}.w`);
      expect(load).not.toHaveBeenCalled();
    });
  });

  describe('stubs named by stored choices load before a roll needs them', () => {
    const wait = () => new Promise((r) => setTimeout(r, 5));
    test('preloadReferencedStubs loads the ones the default, the world default, damage maps, users and actors name, and no others', async () => {
      const { api } = make();
      const loads = {};
      for (const slug of ['own', 'world', 'map', 'over', 'user', 'actor', 'idle']) {
        loads[slug] = vi.fn(async () => theme(slug));
        api.registerThemeStub(MOD, stubOf(slug, loads[slug]));
      }
      const values = { theme: `${MOD}.own`, worldDefaultTheme: `${MOD}.world`, damageTypeMap: { fire: `${MOD}.map` }, damageThemeOverrides: { cold: `${MOD}.over` } };
      globalThis.game = {
        settings: { get: (m, k) => values[k] },
        users: [{ flags: { dicer: { appearance: { global: { theme: `${MOD}.user` }, d20: { theme: 'ruby-classic' } } } } }],
        actors: [{ flags: { dicer: { appearance: { global: { theme: `${MOD}.actor` } } } } }, { flags: {} }],
      };
      await preloadReferencedStubs();
      for (const slug of ['own', 'world', 'map', 'over', 'user', 'actor']) expect(loads[slug]).toHaveBeenCalledTimes(1);
      expect(loads.idle).not.toHaveBeenCalled();
      expect(STUBS.has(`${MOD}.idle`)).toBe(true);
    });

    test('registering stubs starts one preload after the registering code, not one per stub', async () => {
      const { api } = make();
      const get = vi.fn((m, k) => (k === 'theme' ? `${MOD}.s1` : null));
      globalThis.game = { settings: { get }, users: [], actors: [] };
      const load = vi.fn(async () => theme('s1'));
      api.registerThemeStub(MOD, stubOf('s1', load));
      for (let i = 2; i <= 6; i++) api.registerThemeStub(MOD, stubOf(`s${i}`));
      expect(load).not.toHaveBeenCalled(); // not yet: after the code that registers them
      await wait();
      expect(load).toHaveBeenCalledTimes(1);
      expect(get.mock.calls.filter(([, k]) => k === 'theme')).toHaveLength(1); // one scan for six stubs
    });

    test('without a game (a bare test or an early call) nothing is scanned', async () => {
      const { api } = make();
      const load = vi.fn(async () => theme('z'));
      api.registerThemeStub(MOD, stubOf('z', load));
      await wait();
      expect(load).not.toHaveBeenCalled();
      expect(await preloadReferencedStubs()).toEqual([]);
    });
  });
});

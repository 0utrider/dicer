import { afterEach, describe, expect, test, vi } from 'vitest';
import { createThemeApi } from '../../src/api/theme-api.js';
import { PROVIDERS, WARM_THEMES, flagChoice, providedTheme } from '../../src/api/theme-registry.js';
import { ADDON_THEMES, findTheme } from '../../src/themes/themes.js';
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

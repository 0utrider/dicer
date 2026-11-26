/**
 * Dicer's theme API for other modules (a lazy chunk): main.js loads it at ready, sets it as
 * game.modules.get('dicer').api and calls the `dicer.ready` hook with it.
 *
 * - registerTheme(theme, {moduleId, showInAll, material}): a read-only theme for this session, id
 *   `<moduleId>.<slug>`. Every client runs the registering module, so it resolves for every player
 *   with no GM involved. Re-registering an id replaces it. Fires `dicer.themesChanged`. `showInAll`
 *   (boolean or (theme, date) -> boolean) keeps it out of the browser's All tab while false. A theme
 *   may carry `badge`, `category` and `preview`; `material` gives its dice an animated surface.
 * - registerMaterial(moduleId, {cacheKey, beforeShaderCompile}): an animated material a look names.
 * - registerThemeStub(moduleId, {id, name, badge, preview, showInAll, load}): a card now, the theme
 *   from `load()` when it is first selected, assigned, used by a roll or named by a stored default.
 * - registerBrowserTab(moduleId, tab): a tab in the theme browser after Dicer's own.
 * - getUserDefault / setUserDefault: a user's default theme, as "Use as my default" sets it.
 * - registerPetAccessory(moduleId, {id, model, slot, scale, offset, kinds, when}): a model the dice
 *   pets wear.
 * - registerFont(moduleId, {id, label, file}): a number font in the appearance editor, under the
 *   module's name. It is the `file:<file>` font a theme can already name.
 * - hasActorChoice / getActorTheme / setActorTheme / clearActorTheme: an actor's dice choice (its
 *   flags.dicer.appearance, as the actor or token sees it).
 * - registerDefaultProvider(moduleId, fn): fn(actor) -> theme id | null, asked (in registration
 *   order) for an actor with no dice choice; its answer is never written to the actor.
 * - warmThemes(ids): compile these themes' shaders ahead (themes applied outside actors).
 */
import { ADDON_THEMES, MISSING, findTheme, normalizeTheme, readThemeList } from '../themes/themes.js';
import { normalizeAppearance } from '../look/appearance.js';
import { DICER_TIME } from '../render/dice-material.js';
import { ADDON_FONTS } from './addon-fonts.js';
import { chosenRef, isNeverChose, mirrorLookSetting, neverChoseRef } from '../compat/user-looks.js';
import { BROWSER_TABS, SHOW_IN_ALL, STUBS, loadStub, metaOf } from './addon-registry.js';
import { ACCESSORIES_HOOK, PET_ACCESSORIES, PET_ACCESSORY_SLOTS } from './pet-accessories.js';
import { MATERIALS, PROVIDERS, WARM_THEMES, named, flagChoice, providedTheme } from './theme-registry.js';

// the looks compiled ahead for actors and named themes ride this chunk: main.js hooks them up at ready
export { aheadLooks } from '../render/actor-looks.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The actor's dice flag as the actor or token sees it (a token's synthetic actor carries its delta). */
const flagOf = (actor) => {
  try {
    return actor?.getFlag?.('dicer', 'appearance') ?? actor?.flags?.dicer?.appearance;
  } catch {
    return actor?.flags?.dicer?.appearance;
  }
};

const readSetting = (key) => {
  try {
    return globalThis.game?.settings?.get('dicer', key);
  } catch {
    return null;
  }
};

/** Whether a theme id names a built-in, add-on, world or (for `user`) personal theme. */
function themeExists(id, user = globalThis.game?.user) {
  if (STUBS.has(id)) return true; // a registered stub is a theme (findTheme would start its load as a side effect)
  const world = readThemeList(readSetting('worldThemes'), 'world', () => {});
  const mine = readThemeList(user?.getFlag?.('dicer', 'themes'), 'user', () => {});
  return !!findTheme(id, { worldThemes: world, userThemes: mine });
}

/** Theme ids the stored settings, flags and damage maps name that are registered stubs. */
function referencedStubIds() {
  if (!STUBS.size) return [];
  const g = globalThis.game;
  const out = new Set();
  const add = (v) => typeof v === 'string' && STUBS.has(v) && out.add(v);
  const slots = (flag) => isObj(flag) && Object.values(flag).forEach((slot) => add(slot?.theme));
  add(readSetting('theme'));
  add(readSetting('worldDefaultTheme'));
  for (const key of ['damageTypeMap', 'damageThemeOverrides']) {
    const map = readSetting(key);
    if (isObj(map)) Object.values(map).forEach(add);
  }
  for (const user of g?.users ?? []) slots(user?.flags?.dicer?.appearance);
  for (const actor of g?.actors ?? []) slots(actor?.flags?.dicer?.appearance);
  return [...out];
}

/** Loads every stub a stored default, a user's or an actor's choice or a damage map names, so no roll meets one unloaded. */
export function preloadReferencedStubs() {
  return Promise.all(referencedStubIds().map((id) => loadStub(id)));
}

/** The API object; `hooks` (Hooks) and `modules` (game.modules) are seams for tests. */
export function createThemeApi({ hooks = globalThis.Hooks, modules = () => globalThis.game?.modules } = {}) {
  const changed = () => {
    try {
      hooks?.callAll?.('dicer.themesChanged');
    } catch {
      /* a listener's error is its own */
    }
  };
  const fontsChanged = () => {
    try {
      hooks?.callAll?.('dicer.fontsChanged');
    } catch {
      /* a listener's error is its own */
    }
  };
  const isModule = (id) => typeof id === 'string' && !!modules()?.get?.(id);
  /** `id` is `<moduleId>-...` or `<moduleId>.…`: a separator, so a module "dice" cannot claim "dicer-..." keys. */
  const hasPrefix = (id, moduleId) => typeof id === 'string' && (id.startsWith(`${moduleId}-`) || id.startsWith(`${moduleId}.`)) && id.length > moduleId.length + 1;
  /** One refresh of the stubs the stored settings name, however many are registered in a row. */
  let preloadQueued = false;
  const queuePreload = () => {
    if (preloadQueued || !globalThis.game?.users) return; // the users (and so their flags) exist whenever a module can call the API
    preloadQueued = true;
    queueMicrotask(() => {
      preloadQueued = false;
      preloadReferencedStubs();
    });
  };
  let revisions = 0; // never resets, so a re-registered hook is never mistaken for a cached one
  /**
   * Registers an animated material for dice: `{ beforeShaderCompile(shader, material, { themeId,
   * dieType }), cacheKey }`. `cacheKey` (starting with `<moduleId>-` or `<moduleId>.`) names it: a look
   * with `material: "<cacheKey>"` uses it, so does a theme registered with `{ material }`. The hook runs
   * after Dicer's own shader patch, wherever the look is drawn (rolled dice, browser thumbnails and
   * live preview, tray), and gets `uniform float uTime` (seconds, wrapping at 3600) and
   * `vDicerPosition` (object-space position) in the fragment shader. Registering a cacheKey again
   * replaces the hook for dice made afterwards (each registration is a revision that is part of the
   * material and program keys). Returns the id, or null. `themeId` is the theme that registered it
   * (the module id when registered alone).
   */
  const registerMaterial = (moduleId, material, themeId = moduleId) => {
    const id = isObj(material) ? material.cacheKey : null;
    if (!isModule(moduleId) || !hasPrefix(id, moduleId) || id.length > 64 || typeof material.beforeShaderCompile !== 'function') {
      console.warn('Dicer | registerMaterial: needs an installed moduleId, a cacheKey starting with "<moduleId>-" or "<moduleId>." (64 characters at most) and a beforeShaderCompile function', id);
      return null;
    }
    // hook(dieType) is a shader hook for chainShaderHook (dice-material.js), run after Dicer's own patch:
    // the fragment shader gets `uniform float uTime` and `vDicerPosition` (object space) ahead of its code
    const run = material.beforeShaderCompile;
    const hook = (dieType) => (shader, mat) => {
      shader.uniforms.uTime = DICER_TIME;
      shader.fragmentShader = `uniform float uTime;\n#define vDicerPosition vLocalPos\n${shader.fragmentShader}`;
      run(shader, mat, { themeId, dieType });
    };
    const rev = ++revisions;
    // key: the cache key part of dice and programs; the revision makes a re-registered hook a new material
    MATERIALS.set(id, { hook, cacheKey: id, rev, key: `${id}@${rev}`, moduleId, themeId });
    return id;
  };
  return {
    /** Registers (or replaces) a module's read-only theme; true when it is in. */
    registerTheme(theme, { moduleId, showInAll, material } = {}) {
      if (!isModule(moduleId) || !isObj(theme) || typeof theme.id !== 'string' || !theme.id.startsWith(`${moduleId}.`)) {
        console.warn('Dicer | registerTheme: the id must start with "<moduleId>." of an installed module', theme?.id);
        return false;
      }
      // a material hook: the look names it (its `material` field) so every place that draws the look finds it
      let named = theme;
      if (material !== undefined) {
        const id = registerMaterial(moduleId, material, theme.id);
        if (!id) return false;
        // a different cacheKey than the theme's earlier one: the old entry goes
        for (const [key, m] of MATERIALS) if (m.themeId === theme.id && key !== id) MATERIALS.delete(key);
        const tag = (a) => (isObj(a) ? { ...a, material: id } : a);
        named = { ...theme, appearance: tag(theme.appearance) };
        if (isObj(theme.perType)) named.perType = Object.fromEntries(Object.entries(theme.perType).map(([k, a]) => [k, tag(a)]));
      }
      const t = normalizeTheme(named, 'addon');
      if (!t) return false;
      // a theme registered over its own stub replaces it (one card, and a later load cannot overwrite the theme)
      STUBS.delete(t.id);
      // registered again without a material: its old hook goes (a look that still names it draws plain)
      if (material === undefined) for (const [key, m] of MATERIALS) if (m.themeId === t.id) MATERIALS.delete(key);
      ADDON_THEMES.set(t.id, Object.freeze({ ...t, ...metaOf(theme), moduleId }));
      if (typeof showInAll === 'boolean' || typeof showInAll === 'function') SHOW_IN_ALL.set(t.id, showInAll);
      else SHOW_IN_ALL.delete(t.id);
      changed();
      return true;
    },
    /**
     * Offers a number font (a font file served by a module) in the appearance editor, under the
     * module's name: `{ id, label, file }`. `id` starts with `<moduleId>.`; `file` is the path
     * a theme's `numbers.font: "file:<path>"` takes (under the same rules). Registering an id
     * again replaces it. Fires `dicer.fontsChanged`.
     */
    registerFont(moduleId, font) {
      const file = font?.file;
      const usable =
        isModule(moduleId) &&
        isObj(font) &&
        typeof font.id === 'string' &&
        font.id.startsWith(`${moduleId}.`) &&
        typeof font.label === 'string' &&
        font.label.trim() &&
        typeof file === 'string' &&
        normalizeAppearance({ numbers: { font: `file:${file}` } }).numbers.font === `file:${file}`;
      if (!usable) {
        console.warn('Dicer | registerFont: needs an installed moduleId, an id starting with "<moduleId>.", a label and a usable font file path', font?.id);
        return false;
      }
      ADDON_FONTS.set(font.id, { id: font.id, moduleId, label: font.label.trim(), file });
      fontsChanged();
      return true;
    },
    /** Removes a registered font (true when there was one). */
    unregisterFont(id) {
      const had = ADDON_FONTS.delete(id);
      if (had) fontsChanged();
      return had;
    },
    /** The registered fonts (copies), all or one module's. */
    listFonts(moduleId) {
      return [...ADDON_FONTS.values()].filter((f) => !moduleId || f.moduleId === moduleId).map((f) => ({ ...f }));
    },
    /**
     * A model the dice pets wear: `{ id, model, slot?, scale?, offset?, kinds?, when? }`. `id` starts
     * with `<moduleId>-` or `<moduleId>.`; `model` is a .glb a module serves; `slot` is 'head' (the
     * only one so far). `scale` and `offset` (in pet heights: x right, y up, z forward) tune the fit,
     * `kinds: { cat: { scale, offset } }` per pet; `when(kind)` returning false takes it off.
     * Registering an id again replaces it. Fires `dicer.petAccessoriesChanged`.
     */
    registerPetAccessory(moduleId, accessory) {
      const a = isObj(accessory) ? accessory : {};
      const slot = a.slot ?? 'head';
      const ok =
        isModule(moduleId) &&
        typeof a.id === 'string' &&
        hasPrefix(a.id, moduleId) &&
        typeof a.model === 'string' &&
        /\.(glb|gltf)$/i.test(a.model) &&
        PET_ACCESSORY_SLOTS.includes(slot);
      if (!ok) {
        console.warn('Dicer | registerPetAccessory: needs an installed moduleId, an id starting with "<moduleId>-" or "<moduleId>.", a .glb model and the slot "head"', a.id);
        return false;
      }
      PET_ACCESSORIES.delete(a.id); // registered again, it is the latest: it wins its slot
      PET_ACCESSORIES.set(a.id, {
        id: a.id,
        moduleId,
        slot,
        model: a.model,
        scale: Number.isFinite(a.scale) && a.scale > 0 ? a.scale : 1,
        offset: isObj(a.offset) ? { ...a.offset } : null,
        kinds: isObj(a.kinds) ? { ...a.kinds } : null,
        when: typeof a.when === 'function' ? a.when : null,
      });
      hooks?.callAll?.(ACCESSORIES_HOOK);
      return true;
    },
    /** Takes a registered pet accessory away (true when there was one). */
    unregisterPetAccessory(id) {
      const had = PET_ACCESSORIES.delete(id);
      if (had) hooks?.callAll?.(ACCESSORIES_HOOK);
      return had;
    },
    /**
     * Adds (or replaces) a tab in the theme browser, after Dicer's own: `{ id, label, icon, filter,
     * sort?, sections? }`. `id` starts with `<moduleId>-` or `<moduleId>.`; `label` is text or an i18n key; `icon` is
     * a Font Awesome class or an image path; `filter(theme)` says which themes it shows;
     * `sort(a, b)` orders them; `sections(theme)` names the heading a theme sits under.
     */
    registerBrowserTab(moduleId, tab) {
      const ok =
        isModule(moduleId) &&
        isObj(tab) &&
        typeof tab.id === 'string' &&
        hasPrefix(tab.id, moduleId) &&
        !tab.id.includes(' ') &&
        typeof tab.label === 'string' &&
        tab.label &&
        typeof tab.filter === 'function';
      if (!ok) {
        console.warn('Dicer | registerBrowserTab: needs an installed moduleId, an id starting with "<moduleId>-" or "<moduleId>.", a label and a filter function', tab?.id);
        return false;
      }
      const fn = (f) => (typeof f === 'function' ? f : undefined);
      BROWSER_TABS.set(tab.id, {
        id: tab.id,
        moduleId,
        label: tab.label,
        icon: typeof tab.icon === 'string' ? tab.icon : '',
        filter: tab.filter,
        sort: fn(tab.sort),
        sections: fn(tab.sections),
      });
      changed();
      return true;
    },
    /** Removes a module's browser tab (true when there was one). */
    unregisterBrowserTab(id) {
      const had = BROWSER_TABS.delete(id);
      if (had) changed();
      return had;
    },
    registerMaterial,
    /**
     * A theme that loads on demand: `{ id, name, badge?, preview?, category?, load }`, `load()`
     * resolving to the full theme (same id). It shows as a card with its static preview. Selecting
     * it, assigning it, or a roll that reaches a stored reference to it loads it and swaps it in
     * (then `dicer.themesChanged` fires). A roll that reaches an unloaded stub first uses the
     * default look, so stubs a stored default, an actor or the damage map names are also loaded as soon as
     * they are registered (the load starts right after the registering code finishes), before any roll needs them.
     * `showInAll` (boolean or (card, date) -> boolean) works as in registerTheme and carries over to the theme.
     */
    registerThemeStub(moduleId, stub) {
      const ok =
        isModule(moduleId) &&
        isObj(stub) &&
        typeof stub.id === 'string' &&
        stub.id.startsWith(`${moduleId}.`) &&
        typeof stub.name === 'string' &&
        stub.name &&
        typeof stub.load === 'function';
      if (!ok) {
        console.warn('Dicer | registerThemeStub: needs an installed moduleId, an id starting with "<moduleId>.", a name and a load function', stub?.id);
        return false;
      }
      if (ADDON_THEMES.has(stub.id)) return false; // already loaded: the full theme stays
      const text = (v) => (typeof v === 'string' && v ? v : undefined);
      STUBS.set(stub.id, {
        id: stub.id,
        moduleId,
        name: stub.name,
        badge: text(stub.badge),
        preview: text(stub.preview),
        category: text(stub.category),
        load: stub.load,
        loading: null,
        failed: false,
      });
      if (typeof stub.showInAll === 'boolean' || typeof stub.showInAll === 'function') SHOW_IN_ALL.set(stub.id, stub.showInAll);
      else SHOW_IN_ALL.delete(stub.id);
      MISSING.hook = (id) => {
        if (STUBS.has(id)) loadStub(id);
      };
      changed();
      queuePreload();
      return true;
    },
    /** Removes a module's theme or stub (true when there was one). */
    unregisterTheme(id) {
      for (const [key, m] of MATERIALS) if (m.themeId === id) MATERIALS.delete(key);
      const stubbed = STUBS.delete(id);
      const had = ADDON_THEMES.delete(id) || stubbed;
      SHOW_IN_ALL.delete(id);
      if (had) changed();
      return had;
    },
    /** The registered module themes (copies), all or one module's. */
    listThemes(moduleId) {
      return [...ADDON_THEMES.values()].filter((t) => !moduleId || t.moduleId === moduleId).map((t) => structuredClone(t));
    },
    /**
     * The theme id a user's dice default to, or "default": what the browser's "Use as my default"
     * stored, else the GM's world default, else (for this client's user) the `theme` setting.
     */
    getUserDefault(user = globalThis.game?.user) {
      const global = flagOf(user)?.global;
      if (isObj(global) && !isNeverChose(global) && typeof global.theme === 'string' && global.theme) return global.theme;
      const world = readSetting('worldDefaultTheme');
      if (typeof world === 'string' && world && themeExists(world)) return world;
      const own = user === globalThis.game?.user ? readSetting('theme') : null;
      return typeof own === 'string' && own ? own : 'default';
    },
    /**
     * Sets a user's default theme, as "Use as my default" does ("default" clears it). Another
     * user's default needs a GM. Refused (false) for an unknown theme, and for a player under the
     * GM's look lock.
     */
    async setUserDefault(themeId, user = globalThis.game?.user) {
      const me = globalThis.game?.user;
      if (!user || !me || typeof themeId !== 'string' || !themeId) return false;
      if (user !== me && !me.isGM) return false;
      if (!me.isGM && readSetting('lockPlayerLooks') && readSetting('worldDefaultTheme')) return false;
      const clear = themeId === 'default';
      // a stub becomes its theme first (the default is stored by id, and a failed load stores nothing)
      if (STUBS.has(themeId) && !(await loadStub(themeId, { retry: true }))) return false;
      if (!clear && !themeExists(themeId, user)) return false;
      const settings = globalThis.game.settings;
      if (clear) {
        await user.setFlag('dicer', 'appearance', { global: neverChoseRef() });
        if (user === me) await settings.set('dicer', 'theme', 'default');
      } else {
        await mirrorLookSetting(user, themeId);
        if (user === me) await settings.set('dicer', 'theme', themeId);
      }
      return true;
    },
    /** Whether anybody picked dice for this actor (theme, look, appearance, colorset or system). */
    hasActorChoice(actor) {
      return flagChoice(flagOf(actor));
    },
    /** The theme id the actor's dice use: its own choice, else a provider's default; null when neither. */
    getActorTheme(actor) {
      const f = flagOf(actor);
      const ref = isObj(f?.global) ? f.global : f;
      if (named(ref)) return typeof ref.theme === 'string' ? ref.theme : null;
      return flagChoice(f) || !actor ? null : providedTheme(actor);
    },
    /** Sets the actor's dice theme (needs ownership); `ifUnset`: only when nobody picked dice. */
    async setActorTheme(actor, themeId, { ifUnset = false } = {}) {
      if (!actor?.isOwner || !findTheme(themeId) || (ifUnset && flagChoice(flagOf(actor)))) return false;
      await actor.setFlag('dicer', 'appearance', { global: chosenRef(themeId) });
      return true;
    },
    /** Clears the actor's dice choice, so a provider's default applies again (needs ownership). */
    async clearActorTheme(actor) {
      if (!actor?.isOwner) return false;
      await actor.unsetFlag('dicer', 'appearance');
      return true;
    },
    /** fn(actor) -> theme id | null for actors with no choice; registering again replaces it. */
    registerDefaultProvider(moduleId, fn) {
      if (!isModule(moduleId) || typeof fn !== 'function') return false;
      PROVIDERS.set(moduleId, fn);
      changed(); // the looks it hands out are compiled ahead (render/actor-looks.js)
      return true;
    },
    /**
     * Asks for these themes' shaders to be compiled ahead, so their first roll does not freeze the
     * canvas. Only for themes applied outside actors: an actor's theme and a provider's default
     * are warmed already. Returns how many ids name a theme; nothing is stored.
     */
    warmThemes(ids) {
      if (!Array.isArray(ids)) return 0;
      const known = ids.filter((id) => typeof id === 'string' && findTheme(id));
      const before = WARM_THEMES.size;
      for (const id of known) WARM_THEMES.add(id);
      if (WARM_THEMES.size > before) changed();
      return known.length;
    },
  };
}

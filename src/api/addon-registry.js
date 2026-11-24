/**
 * What add-on modules registered for Dicer's windows (api.registerTheme options). Read only by
 * lazy chunks (the theme browser and the API), so none of it is in the world-start bundle.
 */

import { ADDON_THEMES, normalizeTheme } from '../themes/themes.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The add-on metadata a theme may carry: badge (the card's tag), category, preview (a static card image). */
export const metaOf = (raw) =>
  Object.fromEntries(
    ['badge', 'category', 'preview']
      .filter((k) => typeof raw?.[k] === 'string' && raw[k])
      .map((k) => [k, raw[k]]),
  );

/** Theme id -> `showInAll` (a boolean, or (theme, date) -> boolean) from registerTheme's options. */
export const SHOW_IN_ALL = new Map();

/** Whether the theme belongs in the browser's All tab now. Absent or a throwing predicate: it does. */
export function inAll(theme, date = new Date()) {
  const rule = SHOW_IN_ALL.get(theme?.id);
  if (typeof rule === 'boolean') return rule;
  if (typeof rule !== 'function') return true;
  try {
    return rule(theme, date) !== false;
  } catch {
    return true;
  }
}

/** Tab id -> { id, moduleId, label, icon, filter, sort, sections } (api.registerBrowserTab), in registration order. */
export const BROWSER_TABS = new Map();

const run = (fn, fallback, ...args) => {
  try {
    return fn(...args);
  } catch {
    return fallback;
  }
};

/**
 * The themes a module tab shows, ordered, with each one's section heading (null without
 * `sections`). A throwing callback is a theme the tab does not show, an unsorted tab, no heading.
 * Themes of one section stay together, sections in the order they first appear.
 * @returns {{theme: object, section: string|null}[]}
 */
export function tabEntries(tab, themes) {
  const shown = themes.filter((t) => run(tab.filter, false, t) === true);
  if (typeof tab.sort === 'function') {
    const sorted = run((list) => [...list].sort(tab.sort), null, shown);
    if (sorted) shown.splice(0, shown.length, ...sorted);
  }
  if (typeof tab.sections !== 'function') return shown.map((theme) => ({ theme, section: null }));
  const sectionOf = (t) => {
    const name = run(tab.sections, null, t);
    return typeof name === 'string' && name ? name : null;
  };
  const groups = new Map();
  for (const theme of shown) {
    const name = sectionOf(theme);
    (groups.get(name) ?? groups.set(name, []).get(name)).push({ theme, section: name });
  }
  return [...groups.values()].flat();
}

/** Theme id -> { id, moduleId, name, badge, preview, category, load, loading, failed } (api.registerThemeStub). */
export const STUBS = new Map();

/** A stub as a gallery entry: a card with its static preview, no appearance to render. */
export const stubView = (stub) => ({
  id: stub.id,
  name: stub.name,
  source: 'addon',
  moduleId: stub.moduleId,
  stub: true,
  appearance: {},
  perType: {},
  rules: [],
  ...(stub.badge && { badge: stub.badge }),
  ...(stub.category && { category: stub.category }),
  ...(stub.preview && { preview: stub.preview }),
});

/**
 * Loads a stub's theme and swaps the stub for it (then fires `dicer.themesChanged`). Resolves to
 * the theme, or null when the id is no stub, the load failed (one warning, no retry on its own;
 * `retry` tries again) or the stub was replaced meanwhile. Concurrent calls share one load().
 */
export function loadStub(id, { retry = false, hooks = globalThis.Hooks } = {}) {
  const stub = STUBS.get(id);
  if (!stub) return Promise.resolve(ADDON_THEMES.get(id) ?? null);
  if (stub.failed && !retry) return Promise.resolve(null);
  stub.failed = false;
  stub.loading ??= (async () => {
    try {
      const raw = await stub.load();
      if (!isObj(raw) || raw.id !== id) throw new Error(`load() must return the theme "${id}"`);
      const base = normalizeTheme(raw, 'addon');
      if (!base) throw new Error('the theme it returned is not valid');
      const theme = { ...base, ...metaOf(stub), ...metaOf(raw) };
      if (STUBS.get(id) !== stub) return null;
      STUBS.delete(id);
      ADDON_THEMES.set(id, Object.freeze({ ...theme, moduleId: stub.moduleId }));
      try {
        hooks?.callAll?.('dicer.themesChanged');
      } catch {
        /* a listener's error is its own */
      }
      return ADDON_THEMES.get(id);
    } catch (err) {
      stub.failed = true;
      stub.loading = null;
      console.warn(
        `Dicer | the theme stub "${id}" could not be loaded; its dice use the default look`,
        err,
      );
      return null;
    }
  })();
  return stub.loading;
}

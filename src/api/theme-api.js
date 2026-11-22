/**
 * Dicer's theme API for other modules (a lazy chunk): main.js loads it at ready, sets it as
 * game.modules.get('dicer').api and calls the `dicer.ready` hook with it.
 *
 * - registerTheme(theme, {moduleId}): a read-only theme for this session, id `<moduleId>.<slug>`.
 *   Every client runs the registering module, so it resolves for every player with no GM involved.
 *   Re-registering an id replaces it. Fires `dicer.themesChanged`.
 * - hasActorChoice / getActorTheme / setActorTheme / clearActorTheme: an actor's dice choice (its
 *   flags.dicer.appearance, as the actor or token sees it).
 * - registerDefaultProvider(moduleId, fn): fn(actor) -> theme id | null, asked (in registration
 *   order) for an actor with no dice choice; its answer is never written to the actor.
 */
import { ADDON_THEMES, findTheme, normalizeTheme } from '../themes/themes.js';
import { chosenRef } from '../compat/user-looks.js';
import { PROVIDERS, named, flagChoice, providedTheme } from './theme-registry.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The actor's dice flag as the actor or token sees it (a token's synthetic actor carries its delta). */
const flagOf = (actor) => {
  try {
    return actor?.getFlag?.('dicer', 'appearance') ?? actor?.flags?.dicer?.appearance;
  } catch {
    return actor?.flags?.dicer?.appearance;
  }
};

/** The API object; `hooks` (Hooks) and `modules` (game.modules) are seams for tests. */
export function createThemeApi({ hooks = globalThis.Hooks, modules = () => globalThis.game?.modules } = {}) {
  const changed = () => {
    try {
      hooks?.callAll?.('dicer.themesChanged');
    } catch {
      /* a listener's error is its own */
    }
  };
  const isModule = (id) => typeof id === 'string' && !!modules()?.get?.(id);
  return {
    /** Registers (or replaces) a module's read-only theme; true when it is in. */
    registerTheme(theme, { moduleId } = {}) {
      if (!isModule(moduleId) || !isObj(theme) || typeof theme.id !== 'string' || !theme.id.startsWith(`${moduleId}.`)) {
        console.warn('Dicer | registerTheme: the id must start with "<moduleId>." of an installed module', theme?.id);
        return false;
      }
      const t = normalizeTheme(theme, 'addon');
      if (!t) return false;
      ADDON_THEMES.set(t.id, Object.freeze({ ...t, moduleId }));
      changed();
      return true;
    },
    /** Removes a module's theme (true when there was one). */
    unregisterTheme(id) {
      const had = ADDON_THEMES.delete(id);
      if (had) changed();
      return had;
    },
    /** The registered module themes (copies), all or one module's. */
    listThemes(moduleId) {
      return [...ADDON_THEMES.values()].filter((t) => !moduleId || t.moduleId === moduleId).map((t) => structuredClone(t));
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
      return true;
    },
  };
}

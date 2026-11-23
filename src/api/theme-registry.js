/**
 * What rolls need of the theme API (world start): the module themes live in themes.js
 * ADDON_THEMES; here are the default providers and the "has anybody picked dice" test. The API
 * object itself (theme-api.js) is a lazy chunk, loaded at ready.
 */
import { findTheme } from '../themes/themes.js';
import { isNeverChose } from '../compat/user-looks.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** moduleId -> fn(actor) -> theme id | null, in registration order (api.registerDefaultProvider). */
export const PROVIDERS = new Map();
/** Theme ids a module asked to have compiled ahead (api.warmThemes); this session only. */
export const WARM_THEMES = new Set();

/** A stored slot that names dice: a theme, a look other than the default, an appearance, a colorset or a system. */
export const named = (r) =>
  isObj(r) && !isNeverChose(r) && !!(r.theme || (r.look && r.look !== 'default') || r.appearance || r.colorset || r.system);

/**
 * Whether an actor's stored dice flag (flags.dicer.appearance: {global, d20, role:...} slots, or a
 * Dice So Nice-migrated flat ref) makes a choice: the one answer to "has anybody picked dice here".
 */
export const flagChoice = (stored) => isObj(stored) && (named(stored) || Object.values(stored).some(named));

/** The first provider's theme for `actor` that exists, or null. A throwing provider is skipped. */
export function providedTheme(actor) {
  for (const fn of PROVIDERS.values()) {
    try {
      const id = fn(actor);
      if (findTheme(id)) return id;
    } catch {
      /* a bad provider never reaches the roll */
    }
  }
  return null;
}

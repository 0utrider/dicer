/**
 * The per-user look flag `dicer.appearance`: `{ global: LookRef, [dieType]: LookRef }` with
 * `LookRef = { look?, theme?, appearance?, colorset?, system? }`; keys may also be `role:<role>`. Flags are shared data any client (or
 * script) can write, so everything read here is validated and never throws.
 */
import { LOOKS } from '../look/looks.js';
import { normalizeAppearance } from '../look/appearance.js';
import { colorsetToAppearance, BUILTIN_COLORSETS } from './colorset-map.js';
import { findTheme } from '../themes/themes.js';

export const FLAG_SCOPE = 'dicer';
export const FLAG_KEY = 'appearance';

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The raw flag value, or undefined when absent or unreadable. */
function rawFlag(user) {
  try {
    if (typeof user?.getFlag === 'function') return user.getFlag(FLAG_SCOPE, FLAG_KEY);
    return user?.flags?.[FLAG_SCOPE]?.[FLAG_KEY];
  } catch {
    return undefined;
  }
}

/** @returns {Record<string, object>} entries that are objects, always including `global`. */
export function readUserLooks(user) {
  const out = {};
  const flag = rawFlag(user);
  if (isPlainObject(flag)) {
    for (const [key, ref] of Object.entries(flag)) if (isPlainObject(ref)) out[key] = ref;
  }
  if (!out.global) out.global = { look: 'default' };
  return out;
}

/** A colorset by name: the registry first, then the built-ins; exact name before any case. */
export function findColorset(name, registry) {
  if (typeof name !== 'string' || !name) return null;
  const lower = name.toLowerCase();
  const sources = [registry?.colorsets, new Map(Object.entries(BUILTIN_COLORSETS))];
  for (const map of sources) {
    if (!map || typeof map.get !== 'function') continue;
    if (map.has(name)) return map.get(name);
    for (const [key, value] of map) if (String(key).toLowerCase() === lower) return value;
  }
  return null;
}

export function colorsetNameToAppearance(name, registry, index = 0) {
  const colorset = findColorset(name, registry);
  return colorset ? colorsetToAppearance(colorset, { textures: registry?.textures, index }) : null;
}

/** A theme as a resolved look: the die type's own look if it has one, its sound and its id. */
export function themeLook(theme, dieType) {
  const out = { appearance: theme.perType?.[dieType] ?? theme.appearance, themeId: theme.id };
  if (theme.soundMaterial) out.soundMaterial = theme.soundMaterial;
  return out;
}

/**
 * appearance > colorset > theme > look; null when the ref names nothing usable.
 * @param {object} [opts]
 * @param {string} [opts.dieType] picks the theme's per-type look
 * @param {{worldThemes?: object[], userThemes?: object[]}} [opts.themes] where non-built-in themes are found
 * @param {(themeId: string) => void} [opts.onMissingTheme] a ref names a theme that does not exist
 * @returns {{appearance: object, themeId?: string, soundMaterial?: string} | null}
 */
export function lookRefToAppearance(ref, registry, index = 0, { dieType, themes, onMissingTheme } = {}) {
  if (!isPlainObject(ref)) return null;
  if (isPlainObject(ref.appearance)) return { appearance: normalizeAppearance(ref.appearance) };
  const fromColorset = colorsetNameToAppearance(ref.colorset, registry, index);
  if (fromColorset) return { appearance: fromColorset };
  if (typeof ref.theme === 'string' && ref.theme) {
    const theme = findTheme(ref.theme, themes);
    if (theme) return themeLook(theme, dieType);
    onMissingTheme?.(ref.theme);
  }
  if (typeof ref.look === 'string' && Object.hasOwn(LOOKS, ref.look)) return { appearance: LOOKS[ref.look].appearance };
  return null;
}

/** Mirrors the client `theme` setting into the user flag so other clients can see it. */
export async function mirrorLookSetting(user, themeId) {
  const looks = readUserLooks(user);
  looks.global = { theme: themeId };
  await user.setFlag(FLAG_SCOPE, FLAG_KEY, looks);
}

/** The once-at-ready mirror: only when this user has no flag yet. */
export async function mirrorLookIfMissing(user, themeId) {
  const flag = rawFlag(user);
  if (isPlainObject(flag)) return;
  await mirrorLookSetting(user, themeId);
}

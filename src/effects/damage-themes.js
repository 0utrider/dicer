/**
 * Built-in damage themes (PF2e and dnd5e): a look, an impact sound material and a landing effect
 * per damage type, and the chain that picks one for a type:
 *   user override -> world map -> DSN addDamageTypeDefaults -> DEFAULT_DAMAGE_MAP.
 * A value naming a damage theme id gives the full damage theme; one naming a Plan 5 theme (built-in,
 * world or the roller's) gives its look for the die type and its sound material (no landing);
 * any other value is a colorset name (look only).
 * The look lands between flavor colorsets and actor/user looks (P4-D3). Nothing here depends on a
 * roll's result, so none of it leaks a hidden roll; callers still reach it for real views only.
 */
import { normalizeAppearance } from '../look/appearance.js';
import { isPlainObject, colorsetNameToAppearance, themeLook } from '../compat/user-looks.js';
import { findTheme, readThemeList } from '../themes/themes.js';
import { damageTypesByTerm, KNOWN_DAMAGE_TYPES } from './roll-context.js';
import { dsnTypeOf } from '../core/dice-shapes.js';

// [id, body, interior, numbers, glow, soundMaterial, landing effect, landing sound]
const rows = [
  ['fire', { type: 'resin', color: '#3a0f06', color2: '#140402', roughness: 0.05 },
    { type: 'liquid', colors: ['#ff4a12', '#ffb347'], density: 0.75 },
    { fill: 'gold', color: '#ffb060', depth: 0.5 }, { color: '#ff7a1a', intensity: 0.8 },
    'glass', { id: 'embers' }, 'crackle'],
  ['cold', { type: 'resin', color: '#cfeaf7', color2: '#8cc7e6', roughness: 0.02 },
    { type: 'glitter', colors: ['#ffffff', '#bfe6ff'], density: 0.5 },
    { fill: 'silver', color: '#17405c', depth: 0.5 }, null,
    'glass', { id: 'frost' }],
  ['acid', { type: 'resin', color: '#0f3d12', color2: '#04180a', roughness: 0.04 },
    { type: 'liquid', colors: ['#7dff2a', '#2fbf1e'], density: 0.7 },
    { fill: 'paint', color: '#eaffd0', depth: 0.5 }, null,
    'glass', { id: 'smoke', color: '#7dff2a' }],
  ['electricity', { type: 'resin', color: '#14125a', color2: '#05052a', roughness: 0.04 },
    { type: 'nebula', colors: ['#4d6bff', '#b066ff'], density: 0.7 },
    { fill: 'silver', color: '#e8ecff', depth: 0.5 }, { color: '#7aa2ff', intensity: 0.9 },
    'glass', { id: 'lightning' }, 'zap'],
  ['sonic', { type: 'pearl', color: '#f3e6b8', color2: '#d9c27a', roughness: 0.25 },
    null, { fill: 'enamel', color: '#3a2d0a', depth: 0.5 }, null,
    'plastic', { id: 'shockwave' }],
  ['poison', { type: 'opaque', color: '#1b4d22', color2: '#0a2410', roughness: 0.3 },
    null, { fill: 'silver', color: '#d8e4ee', depth: 0.5 }, null,
    'plastic', { id: 'smoke', color: '#6b8f1f' }],
  ['force', { type: 'resin', color: '#2a0f5e', color2: '#0d0524', roughness: 0.04 },
    { type: 'swirl', colors: ['#b07aff', '#6a3df0'], density: 0.7 },
    { fill: 'silver', color: '#efe6ff', depth: 0.5 }, null,
    'glass', { id: 'glow-pulse' }],
  ['vitality', { type: 'pearl', color: '#fffaf0', color2: '#f3e3b0', roughness: 0.25 },
    null, { fill: 'gold', color: '#d9a93a', depth: 0.5 }, { color: '#ffd76a', intensity: 0.5 },
    'plastic', { id: 'light-burst', color: '#ffe27a' }],
  ['void', { type: 'opaque', color: '#08040f', color2: '#000000', roughness: 0.35 },
    null, { fill: 'silver', color: '#c9a0ff', depth: 0.5 }, { color: '#8a3dff', intensity: 0.8 },
    'stone', { id: 'smoke', color: '#15151c' }],
  ['mental', { type: 'resin', color: '#4a0f3e', color2: '#1d0518', roughness: 0.04 },
    { type: 'nebula', colors: ['#ff7ac8', '#b04dff'], density: 0.7 },
    { fill: 'silver', color: '#ffe6f4', depth: 0.5 }, null,
    'glass', { id: 'glow-pulse', color: '#ff7ac8' }],
  ['bleed', { type: 'resin', color: '#3a0408', color2: '#140103', roughness: 0.04 },
    { type: 'liquid', colors: ['#b3121e', '#6b0710'], density: 0.75 },
    { fill: 'silver', color: '#f0d8da', depth: 0.5 }, null, 'glass', null],
  ['spirit', { type: 'resin', color: '#0c3a4a', color2: '#04141c', roughness: 0.04 },
    { type: 'swirl', colors: ['#8ff0ff', '#4ec6e0'], density: 0.65 },
    { fill: 'silver', color: '#e6fbff', depth: 0.5 }, null,
    'glass', { id: 'glow-pulse', color: '#8ff0ff' }],
  ['physical', { type: 'metal', color: '#9aa3ad', color2: '#4a5057', finish: 'antique', roughness: 0.4 },
    null, { fill: 'enamel', color: '#101215', depth: 0.6 }, null, 'metal', null],
];

/** @type {Readonly<Record<string, {id: string, appearance: object, soundMaterial: string, landing: {effect: object, sound: object|null}|null}>>} */
export const DAMAGE_THEMES = Object.freeze(
  Object.fromEntries(
    rows.map(([id, body, interior, numbers, glow, soundMaterial, effect, sound]) => [
      id,
      Object.freeze({
        id,
        appearance: normalizeAppearance({ body, interior: interior ?? { type: 'none' }, numbers, glow: glow ?? undefined }),
        soundMaterial,
        landing: effect
          ? Object.freeze({ effect: Object.freeze(effect), sound: sound ? Object.freeze({ builtin: sound }) : null })
          : null,
      }),
    ]),
  ),
);

/** PF2e and dnd5e damage type -> theme id. `untyped` is deliberately absent. */
export const DEFAULT_DAMAGE_MAP = Object.freeze({
  ...Object.fromEntries(
    ['acid', 'cold', 'electricity', 'fire', 'force', 'mental', 'poison', 'sonic', 'spirit', 'vitality', 'void', 'bleed'].map(
      (t) => [t, t],
    ),
  ),
  bludgeoning: 'physical',
  piercing: 'physical',
  slashing: 'physical',
  lightning: 'electricity',
  thunder: 'sonic',
  radiant: 'vitality',
  necrotic: 'void',
  psychic: 'mental',
  healing: 'vitality',
});

const own = (obj, key) => isPlainObject(obj) && Object.hasOwn(obj, key) && typeof obj[key] === 'string';

/**
 * @param {string} [opts.dieType] the die type, for a theme's per-type look
 * @param {{worldThemes?: object[], userThemes?: object[]}} [opts.themes] non-built-in themes
 * @returns {{id?: string, appearance: object, soundMaterial?: string, landing?: object|null, themeId?: string}|null}
 *   null: no theme (no mapping at any level, the type is switched off, or the mapping is unusable).
 *   A mapping VALUE naming neither a theme nor a known colorset warns (once per `warned` set).
 */
export function resolveDamageTheme(
  type,
  { userOverrides, worldMap, moduleDefaults, registry, index = 0, warn = console.warn, warned, dieType, themes } = {},
) {
  if (typeof type !== 'string' || !type) return null;
  const levels = [userOverrides, worldMap, moduleDefaults ?? registry?.damageTypeDefaults, DEFAULT_DAMAGE_MAP];
  const level = levels.find((m) => own(m, type));
  if (!level) return null;
  const value = level[type];
  if (value === 'none') return null;
  if (Object.hasOwn(DAMAGE_THEMES, value)) return DAMAGE_THEMES[value];
  // The viewer's own themes first (their override may name one), then the roller's, then world/built-in.
  const own1 = (list) => (Array.isArray(list) ? list.find((t) => t && t.id === value) : undefined);
  const theme =
    own1(themes?.viewerThemes) ?? own1(themes?.userThemes) ?? findTheme(value, { worldThemes: themes?.worldThemes });
  if (theme) {
    const look = themeLook(theme, dieType);
    return { appearance: look.appearance, soundMaterial: theme.soundMaterial, landing: null, themeId: theme.id };
  }
  const appearance = colorsetNameToAppearance(value, registry, index);
  if (appearance) return { appearance };
  const key = `${type}=${value}`;
  if (!warned || !warned.has(key)) {
    warned?.add(key);
    try {
      warn(`Dicer: damage type "${type}" maps to "${value}", which is neither a damage theme nor a colorset`);
    } catch {
      /* a throwing logger must not reach the roll */
    }
  }
  return null;
}

const safe = (fn, fallback) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/**
 * Binds the settings, the registry and the roller's own themes (getUserThemes(userId)): `forRoll(roll)` gives `(term, index) => theme | null` (null
 * with damagePresets off); `knownTypes()` is the set damage detection recognises (the systems'
 * types, the DSN defaults' and the world map's keys).
 */
export function createDamageThemer({
  registry,
  getSetting,
  getUserThemes = () => undefined,
  getViewerId = () => undefined,
  warn = console.warn,
}) {
  const warned = new Set();
  const get = (k) => safe(() => getSetting(k), undefined);
  let key = null;
  let known = KNOWN_DAMAGE_TYPES;

  const knownTypes = () => {
    const world = get('damageTypeMap');
    const extra = [...Object.keys(registry?.damageTypeDefaults ?? {}), ...(isPlainObject(world) ? Object.keys(world) : [])];
    const next = extra.join('|');
    if (next !== key) {
      key = next;
      known = new Set([...KNOWN_DAMAGE_TYPES, ...extra]);
    }
    return known;
  };

  return {
    knownTypes,
    /** @param {string} [userId] the roller, whose own themes a map value may name */
    forRoll(roll, userId) {
      if (get('damagePresets') === false) return null;
      const types = safe(() => damageTypesByTerm(roll, knownTypes()), new WeakMap());
      const worldMap = get('damageTypeMap');
      const userOverrides = get('damageThemeOverrides');
      const viewerId = safe(getViewerId, undefined);
      const themes = {
        worldThemes: safe(() => readThemeList(get('worldThemes'), 'world', warn), []),
        userThemes: userId ? safe(() => readThemeList(getUserThemes(userId), 'user', warn), []) : [],
        // The viewer's own themes (P5-R8): their override may name one, on anyone's roll.
        viewerThemes: viewerId ? safe(() => readThemeList(getUserThemes(viewerId), 'user', warn), []) : [],
      };
      return (term, index = 0) => {
        const type = term !== null && typeof term === 'object' ? types.get(term) : undefined;
        if (typeof type !== 'string') return null;
        const dieType = dsnTypeOf(term) ?? undefined;
        return safe(
          () => resolveDamageTheme(type, { userOverrides, worldMap, registry, index, warn, warned, dieType, themes }),
          null,
        );
      };
    },
  };
}

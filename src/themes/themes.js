// Themes: a look per die type, an impact-sound material and celebration rules (Plan 5, P5-D4).
// Pure data and validation; no Foundry or DOM access.
import { LOOKS } from '../look/looks.js';
import { normalizeAppearance } from '../look/appearance.js';
import { normalizeRule } from '../effects/rules.js';
import { EFFECT_IDS } from '../effects/effect-ids.js';

export const DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
/** perType keys a theme may carry: the editor's DIE_TYPES plus the dice it has no tab for yet. */
const THEME_TYPES = [...DIE_TYPES, 'd3', 'd5', 'd7', 'd14', 'd16', 'df'];
export const SOUND_MATERIALS = ['plastic', 'metal', 'wood', 'glass', 'stone'];
/** Effect catalogue ids (world start's own list: the library chunk is lazy); 'dsn:' ids are also allowed. */
export const KNOWN_EFFECTS = [...EFFECT_IDS];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

export function deepFreeze(o) {
  for (const v of Object.values(o))
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return Object.freeze(o);
}

const fail = (warn, msg) => (warn(msg), null);

/**
 * Validate and canonicalise a raw theme (built-in, world or imported).
 * @returns {object|null} the frozen theme, or null after exactly one warn() call.
 */
export function normalizeTheme(raw, source = 'user', warn = console.warn) {
  if (!isObj(raw)) return fail(warn, 'Dicer: ignoring theme: not an object');
  const label = isStr(raw.id) ? ` "${raw.id}"` : '';
  if (!isStr(raw.id)) return fail(warn, 'Dicer: ignoring theme: missing id');
  if (!isStr(raw.name)) return fail(warn, `Dicer: ignoring theme${label}: missing name`);
  if (!isObj(raw.appearance))
    return fail(warn, `Dicer: ignoring theme${label}: missing appearance`);
  const perType = {};
  if (isObj(raw.perType)) {
    for (const t of THEME_TYPES)
      if (isObj(raw.perType[t])) perType[t] = normalizeAppearance(raw.perType[t]);
  }
  let soundMaterial = null;
  if (raw.soundMaterial != null) {
    if (SOUND_MATERIALS.includes(raw.soundMaterial)) soundMaterial = raw.soundMaterial;
    else warn(`Dicer: theme${label}: unknown sound material "${String(raw.soundMaterial)}"`);
  }
  const rules = [];
  for (const r of Array.isArray(raw.rules) ? raw.rules : []) {
    const rule = normalizeRule(r, 'theme', warn);
    if (!rule) continue;
    const fx = rule.effect?.id;
    if (fx && !KNOWN_EFFECTS.includes(fx) && !fx.startsWith('dsn:')) {
      warn(`Dicer: theme${label}: ignoring rule "${rule.id}": unknown effect "${fx}"`);
      continue;
    }
    rules.push(rule);
  }
  return deepFreeze({
    id: raw.id,
    name: raw.name,
    appearance: normalizeAppearance(raw.appearance),
    perType,
    soundMaterial,
    rules,
    source,
  });
}

// --- built-in library -------------------------------------------------------
const nat = (v, fx, snd, color) => ({
  id: v === 20 ? 'dicer.nat20' : 'dicer.nat1',
  name: v === 20 ? 'Natural 20' : 'Natural 1',
  die: 'd20',
  result: { kind: 'value', value: v },
  effect: color ? { id: fx, color } : { id: fx },
  sound: { builtin: snd },
});
const A = (id) => LOOKS[id].appearance;
const N = normalizeAppearance;
const build = (id, name, appearance, soundMaterial, perType, rules) =>
  deepFreeze({
    id,
    name,
    appearance,
    perType: perType || {},
    soundMaterial,
    rules: rules.map((r) => normalizeRule(r, 'theme')),
    source: 'builtin',
  });
/** A theme from an existing look: [look id, sound material, celebration?]. */
const L = ([id, mat, rule]) => build(id, LOOKS[id].name, A(id), mat, null, rule ? [rule] : []);

const D = [
  '@@dicer-themes-start',
  [
    ['default', 'glass'],
    ['ruby-classic', 'plastic'],
    ['abyss-liquid', 'glass'],
    ['starlit-glitter', 'glass', nat(20, 'sparkles', 'sparkle')],
    ['galaxy-nebula', 'glass', nat(20, 'glow-pulse', 'chime', '#c04dff')],
    ['sharp-crystal', 'glass'],
    ['dwarven-brass', 'metal'],
    ['silver-brushed', 'metal'],
    ['gold-polished', 'metal', nat(20, 'light-burst', 'fanfare')],
    ['marble-white', 'stone'],
    ['jade-marble', 'stone'],
    ['pearl-moon', 'stone'],
    ['ember-core', 'glass', nat(20, 'embers', 'crackle')],
    ['frost-crystal', 'glass', nat(20, 'frost', 'chime')],
    ['void-star', 'glass', nat(20, 'shockwave', 'boom')],
    ['smoke-swirl', 'plastic', nat(20, 'smoke', 'whoosh')],
  ],
  [
    build(
      'dragon-hoard',
      'Dragon Hoard',
      N({
        body: { type: 'resin', color: '#6b3a0a', color2: '#2a1203', roughness: 0.05 },
        interior: { type: 'glitter', colors: ['#ffd24a', '#ff9a1f'], density: 0.75 },
        numbers: { fill: 'gold', color: '#ffd24a', depth: 0.5 },
      }),
      'metal',
      {
        d20: N({
          body: {
            type: 'metal',
            color: '#e3b341',
            color2: '#9a6d12',
            finish: 'polished',
            roughness: 0.15,
          },
          numbers: { fill: 'enamel', color: '#2a1a05', depth: 0.6 },
          glow: { color: '#ff9a1f', intensity: 0.5 },
        }),
      },
      [nat(20, 'embers', 'fanfare')],
    ),
    build(
      'stormcaller',
      'Stormcaller',
      N({
        body: { type: 'resin', color: '#0b1030', color2: '#04061a', roughness: 0.04 },
        interior: { type: 'nebula', colors: ['#6cf0ff', '#7a5cff'], density: 0.7 },
        numbers: { fill: 'silver', color: '#e8f8ff', depth: 0.5 },
        glow: { color: '#6cf0ff', intensity: 0.5 },
      }),
      'glass',
      null,
      [nat(20, 'lightning', 'zap')],
    ),
    build(
      'blood-moon',
      'Blood Moon',
      N({
        body: { type: 'resin', color: '#4a0610', color2: '#1a0206', roughness: 0.04 },
        interior: { type: 'liquid', colors: ['#c4121f', '#7a0a14'], density: 0.7 },
        numbers: { fill: 'silver', color: '#e8d0d0', depth: 0.5 },
      }),
      'glass',
      null,
      [nat(20, 'smoke', 'whoosh', '#c4121f')],
    ),
    build(
      'celestial',
      'Celestial',
      N({
        body: { type: 'pearl', color: '#f2eff6', color2: '#b9d4f2', roughness: 0.25 },
        numbers: { fill: 'gold', color: '#d9a93a', depth: 0.5 },
      }),
      'glass',
      { d20: A('starlit-glitter') },
      [nat(20, 'sparkles', 'chime')],
    ),
    build(
      'obsidian',
      'Obsidian',
      N({
        body: { type: 'resin', color: '#050507', color2: '#000000', roughness: 0.02 },
        interior: { type: 'none' },
        numbers: { fill: 'silver', color: '#d8dde6', depth: 0.6 },
        edges: { style: 'sharp' },
      }),
      'glass',
      null,
      [nat(1, 'shatter', 'thud')],
    ),
    build('verdant', 'Verdant', A('jade-marble'), 'wood', null, []),
  ],
  '@@dicer-themes-end',
];

export const BUILTIN_THEMES = Object.freeze([...D[1].map(L), ...D[2]]);
/** Markers around the table in the bundle; build.test.js measures the span. */
export const THEME_TABLE_MARKS = Object.freeze([D[0], D[3]]);

const listCache = new WeakMap();
const textCache = new Map(); // settings may hand out a fresh copy per read: also cache by content
/**
 * A stored theme list (world setting or user flag) as valid frozen themes. Cached per array and
 * per content, so a bad entry warns once per stored value, not once per roll; unreadable entries
 * are skipped here, never removed from storage.
 */
export function readThemeList(list, source, warn = console.warn) {
  if (!Array.isArray(list)) return [];
  let out = listCache.get(list);
  let text = null;
  if (!out) {
    try {
      text = `${source}:${JSON.stringify(list)}`;
    } catch {
      /* uncacheable by content */
    }
    out = text === null ? undefined : textCache.get(text);
    if (out) listCache.set(list, out);
  }
  if (!out) {
    out = [];
    for (const raw of list) {
      const theme = normalizeTheme(raw, source, (msg) => {
        try {
          warn(msg);
        } catch {
          /* a throwing logger must not reach the roll */
        }
      });
      if (theme) out.push(theme);
    }
    listCache.set(list, out);
    if (text !== null) {
      if (textCache.size >= 16) textCache.delete(textCache.keys().next().value);
      textCache.set(text, out);
    }
  }
  return out;
}

/** Built-in, else the world list, else the roller's own list. */
export function findTheme(id, { worldThemes, userThemes } = {}) {
  if (!isStr(id)) return null;
  const hit = (list) => (Array.isArray(list) ? list.find((t) => t && t.id === id) : undefined);
  return BUILTIN_THEMES.find((t) => t.id === id) ?? hit(worldThemes) ?? hit(userThemes) ?? null;
}

/**
 * Pure helpers of the theme browser (no Foundry, no DOM): look-slot assignment, the simple edit
 * form <-> theme conversion, theme file import/export and the id rules. Stored theme lists are
 * only ever edited entry by entry (upsert / remove by id), so a stored entry this build cannot
 * read is carried through every save untouched.
 */
import { LOOKS } from '../look/looks.js';
import { appearanceKey } from '../look/appearance.js';
import { USER_SOUNDS } from '../audio/sound-names.js';
import { themeRef } from '../compat/user-looks.js';
import {
  DIE_TYPES,
  SOUND_MATERIALS,
  KNOWN_EFFECTS,
  BUILTIN_THEMES,
  normalizeTheme,
  readThemeList,
} from '../themes/themes.js';

export const ROLL_ROLES = ['attack', 'damage', 'save', 'skill', 'initiative', 'check'];
/** A form value meaning "leave what the theme has" (a look, effect or sound the form cannot name). */
export const KEEP = 'keep';
export const FILE_KIND = 'dicer-themes';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const plain = (v) => JSON.parse(JSON.stringify(v));
const noop = () => {};

export function slugify(name) {
  const s = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'theme';
}

/** `base`, else `base-2`, `base-3`... the first id not in `taken`. */
export function uniqueId(base, taken) {
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export const userThemeId = (userId, name, taken = []) => uniqueId(`user.${userId}.${slugify(name)}`, taken);
export const worldThemeId = (name, taken = []) => uniqueId(`world.${slugify(name)}`, taken);

// --- assignment ----------------------------------------------------------------------------
/** The `dicer.appearance` key of a roll role (die types use their own name, the default 'global'). */
export const roleSlot = (role) => `role:${role}`;

/**
 * The look flag with one slot set to `{ theme }`, or removed when `themeId` is empty. Other slots
 * (and anything else stored in them) are untouched.
 */
export function assignTheme(looks, slot, themeId) {
  const out = isObj(looks) ? { ...looks } : {};
  if (typeof themeId === 'string' && themeId) out[slot] = { theme: themeId };
  else delete out[slot];
  return out;
}

/**
 * The flag update for one slot: setFlag merges nested keys, so a removal needs a deletion
 * operator (`foundry.data.operators.ForcedDeletion.create()`, injected; the `-=` key is deprecated).
 */
export const slotPatch = (slot, themeId, deletion = () => globalThis.foundry?.data?.operators?.ForcedDeletion?.create?.()) =>
  typeof themeId === 'string' && themeId ? { [slot]: themeRef(themeId) } : { [slot]: deletion() };

/** A damage-type map (setting value) with one type set to a theme id or removed; other entries kept. A non-object map gives null. */
export function assignDamage(map, type, themeId) {
  // Stored data of the wrong shape is never replaced: null means the write is refused.
  if (map !== undefined && map !== null && !isObj(map)) return null;
  const out = isObj(map) ? { ...map } : {};
  if (typeof themeId === 'string' && themeId) out[type] = themeId;
  else delete out[type];
  return out;
}

/**
 * Where the user uses each theme, as `themeId -> target[]` (targets in the browser's select
 * format: 'default', 'die:d20', 'role:attack', 'actor:<id>', 'damage:fire'). The default is the
 * `theme` setting; the look flag's `global` slot mirrors it and is not listed again. Odd stored
 * values are skipped.
 * @param {{defaultId?: string, looks?: object, actors?: {id: string, theme?: string}[], damageOverrides?: object}} o
 */
export function themeAssignments({ defaultId, looks, actors = [], damageOverrides } = {}) {
  const out = new Map();
  const add = (id, target) => {
    if (typeof id !== 'string' || !id) return;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(target);
  };
  add(typeof defaultId === 'string' && defaultId ? defaultId : 'default', 'default');
  for (const [slot, ref] of isObj(looks) ? Object.entries(looks) : []) {
    const id = isObj(ref) ? ref.theme : null;
    if (DIE_TYPES.includes(slot)) add(id, `die:${slot}`);
    else if (slot.startsWith('role:') && ROLL_ROLES.includes(slot.slice(5))) add(id, slot);
  }
  for (const a of Array.isArray(actors) ? actors : []) if (a?.id) add(a.theme, `actor:${a.id}`);
  for (const [type, id] of isObj(damageOverrides) ? Object.entries(damageOverrides) : []) add(id, `damage:${type}`);
  return out;
}

// --- stored lists --------------------------------------------------------------------------
const stripSource = (theme) => {
  const { source, ...rest } = plain(theme);
  return rest;
};

/** Stored raw entries that do not validate (kept in storage; listed, never deleted by a save). */
export function unreadableOf(list, source) {
  if (!Array.isArray(list)) return [];
  return list.filter((raw) => normalizeTheme(raw, source, noop) === null);
}

/** What the gallery shows: built-in + world + the user's own, and the entries it cannot read. */
export function galleryEntries({ worldList, userList, warn = noop } = {}) {
  return {
    themes: [...BUILTIN_THEMES, ...readThemeList(worldList, 'world', warn), ...readThemeList(userList, 'user', warn)],
    unreadable: [
      ...unreadableOf(worldList, 'world').map((raw) => ({ source: 'world', raw })),
      ...unreadableOf(userList, 'user').map((raw) => ({ source: 'user', raw })),
    ],
  };
}

/** The list with this theme's entry replaced (same id) or appended; every other entry kept as is. */
export function upsertTheme(list, raw) {
  const out = Array.isArray(list) ? [...list] : [];
  const i = out.findIndex((t) => isObj(t) && t.id === raw.id);
  if (i >= 0) out[i] = raw;
  else out.push(raw);
  return out;
}

/** The list without the entry of that id; unreadable entries are never matched, so they stay. */
export function removeTheme(list, id) {
  const out = Array.isArray(list) ? list : [];
  return out.filter((t) => !(isObj(t) && t.id === id));
}

const storedIds = (list) => (Array.isArray(list) ? list.map((t) => (isObj(t) ? t.id : undefined)).filter(Boolean) : []);

/** A copy of any theme as a new user theme (no source field; plain data ready for storage). */
export function duplicateTheme(theme, userId, existing = [], copyLabel = 'copy') {
  const name = `${theme.name} (${copyLabel})`;
  return { ...stripSource(theme), id: userThemeId(userId, name, storedIds(existing)), name };
}

/** GM only: a copy of a theme as `world.<slug>`; a player gets `{ ok: false }` and nothing is written. */
export async function publishToWorld(theme, { isGM, worldList, setWorld }) {
  if (!isGM) return { ok: false, reason: 'gm-only' };
  const raw = { ...stripSource(theme), id: worldThemeId(theme.name, storedIds(worldList)) };
  await setWorld(upsertTheme(worldList, raw));
  return { ok: true, id: raw.id };
}

// --- files ---------------------------------------------------------------------------------
/** The export file's JSON text for these themes. */
export function exportJson(themes) {
  return JSON.stringify({ kind: FILE_KIND, version: 1, themes: themes.map(stripSource) }, null, 2);
}

/**
 * Themes from an exported file (JSON text or parsed; a bare array or a single theme also works),
 * as user themes: validated, ids re-namespaced to `user.<userId>.<slug>` with -2, -3... on a
 * collision with `existingIds` or with each other.
 * @returns {{themes: object[], warnings: string[]}}
 */
export function importThemes(json, userId, { existingIds = [] } = {}) {
  const warnings = [];
  let data = json;
  if (typeof json === 'string') {
    try {
      data = JSON.parse(json);
    } catch {
      return { themes: [], warnings: ['Dicer: the file is not valid JSON'] };
    }
  }
  const raws = Array.isArray(data)
    ? data
    : isObj(data) && Array.isArray(data.themes)
      ? data.themes
      : isObj(data)
        ? [data]
        : [];
  if (!raws.length) warnings.push('Dicer: the file holds no themes');
  const taken = new Set(existingIds);
  const themes = [];
  raws.forEach((raw, i) => {
    const theme = normalizeTheme(raw, 'user', (msg) => warnings.push(msg));
    if (!theme) return;
    const out = stripSource(theme);
    out.id = userThemeId(userId, out.name || `import-${i + 1}`, taken);
    taken.add(out.id);
    themes.push(out);
  });
  return { themes, warnings };
}

/** The edited theme laid over the stored raw entry: unknown fields of the stored entry survive. */
export function mergeEdited(storedRaw, edited) {
  const base = isObj(storedRaw) ? plain(storedRaw) : {};
  return { ...base, ...edited };
}

// --- the simple edit form ------------------------------------------------------------------
const lookIdOf = (appearance) => {
  const key = appearanceKey(appearance);
  return Object.keys(LOOKS).find((id) => appearanceKey(LOOKS[id].appearance) === key) ?? null;
};
/** The sound value meaning "the file in soundSrc". */
export const SOUND_FILE = 'file';
const NATS = [
  ['nat20', 'dicer.nat20', 20],
  ['nat1', 'dicer.nat1', 1],
];

/**
 * What a Sound and celebrations preview button throws: one local d20 in the theme's d20 look with
 * its impact sound; 'nat20' / 'nat1' land that face with the theme's rule (effect + sound).
 * @param {object} theme a raw theme (the editor's working theme)
 * @param {'impact'|'nat20'|'nat1'} key
 * @returns {{fx: object|null, options: object}} the arguments of `game.dice3d._preview`
 */
export function celebrationPreview(theme, key) {
  const nat = NATS.find(([k]) => k === key);
  const value = nat?.[2];
  const rule = nat ? (theme?.rules ?? []).find((r) => r?.id === nat[1]) : null;
  const effect = rule?.effect ?? null;
  const sound = rule?.sound ?? null;
  const fx =
    effect || sound
      ? { ruleId: rule.id, effect, sound, macro: null, slowMotion: false, value, type: 'd20' }
      : null;
  const appearance = theme?.perType?.d20 ?? theme?.appearance;
  return {
    fx,
    options: {
      type: 'd20',
      ...(value ? { value } : {}),
      ...(appearance ? { appearance } : {}),
      ...(theme?.soundMaterial ? { soundMaterial: theme.soundMaterial } : {}),
    },
  };
}

/** A theme as the form's string values. */
export function formFromTheme(theme) {
  const perType = {};
  for (const t of DIE_TYPES) perType[t] = theme.perType?.[t] ? (lookIdOf(theme.perType[t]) ?? KEEP) : '';
  const form = {
    name: theme.name ?? '',
    base: lookIdOf(theme.appearance) ?? KEEP,
    perType,
    soundMaterial: theme.soundMaterial ?? '',
  };
  for (const [key, id] of NATS) {
    const rule = (theme.rules ?? []).find((r) => r?.id === id);
    const src = typeof rule?.sound?.src === 'string' ? rule.sound.src : '';
    form[key] = {
      effect: rule?.effect ? (KNOWN_EFFECTS.includes(rule.effect.id) ? rule.effect.id : KEEP) : '',
      sound: src ? SOUND_FILE : rule?.sound ? (USER_SOUNDS.includes(rule.sound.builtin) ? rule.sound.builtin : KEEP) : '',
      soundSrc: src,
      jb2a: typeof rule?.effect?.jb2a === 'string' ? rule.effect.jb2a : '',
    };
  }
  return form;
}

/**
 * The form applied to `base` (the theme being edited) as a raw theme. A value the form cannot
 * name ('keep') leaves that part as `base` had it; rules other than nat 20 / nat 1 are kept.
 */
export function themeFromForm(form, base) {
  const src = stripSource(base);
  const f = isObj(form) ? form : {};
  const name = typeof f.name === 'string' && f.name.trim() ? f.name.trim() : src.name;
  const appearance =
    typeof f.base === 'string' && Object.hasOwn(LOOKS, f.base) ? plain(LOOKS[f.base].appearance) : src.appearance;
  const perType = {};
  // Looks of dice the form has no field for (d3, d5, d7, d14, d16, dF) pass through unchanged.
  if (isObj(src.perType)) for (const [t, look] of Object.entries(src.perType)) if (!DIE_TYPES.includes(t)) perType[t] = look;
  for (const t of DIE_TYPES) {
    const v = f.perType?.[t];
    if (typeof v === 'string' && Object.hasOwn(LOOKS, v)) perType[t] = plain(LOOKS[v].appearance);
    else if (v === KEEP && src.perType?.[t]) perType[t] = src.perType[t];
  }
  const soundMaterial = SOUND_MATERIALS.includes(f.soundMaterial)
    ? f.soundMaterial
    : f.soundMaterial === KEEP
      ? (src.soundMaterial ?? null)
      : null;
  const rules = (src.rules ?? []).filter((r) => !NATS.some(([, id]) => r?.id === id));
  for (const [key, id, value] of NATS) {
    const old = (src.rules ?? []).find((r) => r?.id === id);
    const want = f[key] ?? {};
    let effect = KNOWN_EFFECTS.includes(want.effect)
      ? old?.effect?.id === want.effect
        ? old.effect
        : { id: want.effect }
      : want.effect === KEEP
        ? (old?.effect ?? null)
        : null;
    // A chosen JB2A animation plays in place of the effect; with no effect, light burst is its stand-in.
    if (typeof want.jb2a === 'string') {
      const file = want.jb2a.trim();
      if (file) effect = { ...(effect ?? { id: 'light-burst' }), jb2a: file };
      else if (effect && 'jb2a' in effect) {
        effect = { ...effect };
        delete effect.jb2a;
      }
    }
    const file = typeof want.soundSrc === 'string' ? want.soundSrc.trim() : '';
    const sound = USER_SOUNDS.includes(want.sound)
      ? { builtin: want.sound }
      : want.sound === SOUND_FILE && file
        ? old?.sound?.src === file
          ? old.sound
          : { src: file }
        : want.sound === KEEP
          ? (old?.sound ?? null)
          : null;
    if (!effect && !sound) continue; // nothing to celebrate: no rule
    rules.push({
      ...(old ?? { name: value === 20 ? 'Natural 20' : 'Natural 1', die: 'd20', result: { kind: 'value', value } }),
      id,
      effect,
      sound,
    });
  }
  return { id: src.id, name, appearance, perType, soundMaterial, rules };
}

/**
 * Pure form <-> settings helpers of the damage map editor (no Foundry, no DOM). A form is
 * `{ rows: Row[] }`, one row per damage type: `{ type, world, user, soundSrc, soundVolume }`
 * (strings, what an HTML form submits). 'default' (or empty) means "no entry": the key is removed
 * so the built-in map and the DSN `addDamageTypeDefaults` apply again.
 */
import { DND5E_TYPES, PF2E_TYPES, KNOWN_DAMAGE_TYPES } from '../effects/roll-context.js';

export const DEFAULT_CHOICE = 'default';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const entries = (v) => (Array.isArray(v) ? v : isObj(v) ? Object.values(v) : []);
const own = (m) => (isObj(m) ? Object.entries(m) : []);
const stringMap = (m) => Object.fromEntries(own(m).filter(([, v]) => typeof v === 'string'));
/** A sound entry the form can represent exactly: a src, an optional numeric volume, nothing else. */
const readableSound = (s) =>
  isObj(s) &&
  typeof s.src === 'string' &&
  s.src !== '' &&
  (s.volume === undefined || Number.isFinite(s.volume)) &&
  Object.keys(s).every((k) => k === 'src' || k === 'volume');

/**
 * The editor's row order: the active system's types first, then the other known types
 * alphabetically, then DSN default / stored keys alphabetically.
 */
export function damageTypeList({ systemId, extra = [] } = {}) {
  const first = systemId === 'pf2e' ? PF2E_TYPES : systemId === 'dnd5e' ? DND5E_TYPES : [];
  const out = [...first];
  const seen = new Set(out);
  const rest = [...KNOWN_DAMAGE_TYPES, ...extra]
    .filter((t) => typeof t === 'string' && t && !seen.has(t))
    .sort((a, b) => a.localeCompare(b));
  for (const t of rest) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** The settings as a form; `types` fixes the order, stored keys not in it are appended. */
export function formFromMap({ worldMap, overrides, sounds } = {}, types = []) {
  const world = stringMap(worldMap);
  const user = stringMap(overrides);
  const snd = Object.fromEntries(own(sounds).filter(([, s]) => readableSound(s)));
  // Entries the form cannot represent are carried through untouched (`rest`), never dropped by a
  // save; a row the user edits for that type wins. `unreadable` names them for a warning.
  const rest = {
    worldMap: Object.fromEntries(own(worldMap).filter(([, v]) => typeof v !== 'string')),
    overrides: Object.fromEntries(own(overrides).filter(([, v]) => typeof v !== 'string')),
    sounds: Object.fromEntries(own(sounds).filter(([, s]) => !readableSound(s))),
  };
  const unreadable = [
    ...Object.keys(rest.worldMap).map((k) => `world:${k}`),
    ...Object.keys(rest.overrides).map((k) => `mine:${k}`),
    ...Object.keys(rest.sounds).map((k) => `sound:${k}`),
  ];
  const order = [...types];
  for (const k of [...Object.keys(world), ...Object.keys(user), ...Object.keys(snd)])
    if (!order.includes(k)) order.push(k);
  return {
    rows: order.map((type) => {
      const s = snd[type] ?? {};
      return {
        type,
        world: world[type] ?? DEFAULT_CHOICE,
        user: user[type] ?? DEFAULT_CHOICE,
        soundSrc: typeof s.src === 'string' ? s.src : '',
        soundVolume: Number.isFinite(s.volume) ? String(s.volume) : '',
      };
    }),
    rest,
    unreadable,
  };
}

/**
 * A form (rows as an array or an index-keyed object, plus the `rest` from formFromMap) as
 * `{ worldMap, overrides, sounds }`.
 */
export function mapFromForm(form) {
  const worldMap = {};
  const overrides = {};
  const sounds = {};
  for (const row of entries(form?.rows)) {
    if (!isObj(row)) continue;
    const type = str(row.type);
    if (!type) continue;
    const world = str(row.world);
    if (world && world !== DEFAULT_CHOICE) worldMap[type] = world;
    const user = str(row.user);
    if (user && user !== DEFAULT_CHOICE) overrides[type] = user;
    const src = str(row.soundSrc);
    if (src) {
      const sound = { src };
      const raw = str(String(row.soundVolume ?? ''));
      const volume = raw === '' ? NaN : Number(raw);
      if (Number.isFinite(volume)) sound.volume = Math.max(0, Math.min(1, volume));
      sounds[type] = sound;
    }
  }
  // Unreadable stored entries survive unless this form set that type itself.
  const rest = form?.rest;
  for (const [out, kept] of [
    [worldMap, rest?.worldMap],
    [overrides, rest?.overrides],
    [sounds, rest?.sounds],
  ])
    for (const [type, value] of own(kept)) if (!Object.hasOwn(out, type)) out[type] = value;
  return { worldMap, overrides, sounds };
}

/**
 * Saves a form. A player writes only their own overrides; the GM also writes the world map and
 * the custom landing sounds.
 */
export async function saveMaps(form, { isGM, setWorld, setSounds, setOverrides }) {
  const { worldMap, overrides, sounds } = mapFromForm(form);
  if (isGM) {
    await setWorld(worldMap);
    await setSounds(sounds);
  }
  await setOverrides(overrides);
  return { ok: true, wroteWorld: Boolean(isGM) };
}

/**
 * What the Preview button throws for a resolved theme: the die's own look and sound material
 * plus its landing fx (the custom sound replacing the built-in one). `fx` is null when the theme
 * has neither an effect nor a sound.
 */
export function previewSpec(type, theme, sound, die = 'd6', rules = []) {
  const landing = theme?.landing ?? null;
  const custom = sound?.src ? { src: sound.src, ...(Number.isFinite(sound.volume) ? { volume: sound.volume } : {}) } : null;
  const entry = (ruleId, effect, snd) =>
    effect || snd
      ? {
          ruleId,
          effect: effect ? { ...effect } : null,
          sound: snd ? { ...snd } : null,
          macro: null,
          slowMotion: false,
          value: 6,
          type: die,
        }
      : null;
  const own = entry(`damage:${theme?.id ?? type}`, landing?.effect, custom ?? landing?.sound);
  // a registered theme's landing rules; the custom sound stands in for theirs
  const extra = rules.map((r) => entry(r.id, r.effect, custom ? null : r.sound)).filter(Boolean);
  const fx = extra.length ? [own, ...extra].filter(Boolean) : own;
  return {
    fx,
    options: {
      type: die,
      ...(theme?.appearance ? { appearance: theme.appearance } : {}),
      ...(theme?.soundMaterial ? { soundMaterial: theme.soundMaterial } : {}),
    },
  };
}

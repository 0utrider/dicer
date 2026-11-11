import { PRESETS, normalizeAreaDef } from './area-model.js';

export const DEFAULT_AREA = Object.freeze({ preset: 'full' });
export const GM_PRIVATE_DEFAULT = Object.freeze({ preset: 'corner' });

export const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
/** Own-property set that is safe for any key, "__proto__" included. */
const put = (obj, key, value) =>
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });

/** A stored def is usable when normalizing keeps its preset (unknown or empty custom is not). */
export function isValidDef(raw) {
  if (!isPlainObject(raw)) return false;
  return (
    (Object.hasOwn(PRESETS, raw.preset) || raw.preset === 'custom') &&
    normalizeAreaDef(raw).preset === raw.preset
  );
}

/**
 * The stored def the dice use for a roller (the one rule shared by the resolver, `get` and the
 * change-hook snapshot): the roller's entry when per-player areas are on and the entry is
 * readable, else the stored default, else the full stage. `warn(key, detail)` reports unreadable
 * entries (the resolver warns once per key).
 */
export function storedDefFor(getSetting, rollerId, warn = () => {}) {
  const checked = (raw, key, fallback) => {
    if (isValidDef(raw)) return raw;
    warn(key, raw);
    return fallback;
  };
  const stored = getSetting('rollAreas');
  if (stored === undefined) return DEFAULT_AREA;
  if (!isPlainObject(stored)) {
    warn('rollAreas', stored);
    return DEFAULT_AREA;
  }
  const fallback =
    'default' in stored ? checked(stored.default, 'rollAreas.default', DEFAULT_AREA) : DEFAULT_AREA;
  if (getSetting('perPlayerAreas') === false || rollerId == null) return fallback;
  const { users } = stored;
  if (users === undefined) return fallback;
  if (!isPlainObject(users)) {
    warn('rollAreas.users', users);
    return fallback;
  }
  if (!Object.hasOwn(users, rollerId)) return fallback;
  return checked(users[rollerId], `rollAreas.users.${rollerId}`, fallback);
}

/** The stored GM private corner def, or the default corner when unreadable. */
export function gmPrivateDef(getSetting, warn = () => {}) {
  const raw = getSetting('gmPrivateArea');
  if (isValidDef(raw)) return raw;
  warn('gmPrivateArea', raw);
  return GM_PRIVATE_DEFAULT;
}

/** What the dice use for one roller, as a normalized copy. */
export const areaDefFor = (getSetting, userId) =>
  normalizeAreaDef(copy(storedDefFor(getSetting, userId ?? null)));

/**
 * A copy of the areas as the dice use them, for the change hook: `{default, users, gmPrivate}`.
 * Every def is what the resolver would pick (an unreadable user entry reads as the default, an
 * unreadable corner as the default corner; with perPlayerAreas off every user reads as the
 * default). Mutating it changes nothing stored.
 */
export function snapshotAreas(getSetting) {
  const stored = getSetting('rollAreas');
  const users = {};
  if (isPlainObject(stored) && isPlainObject(stored.users)) {
    for (const id of Object.keys(stored.users)) put(users, id, areaDefFor(getSetting, id));
  }
  return {
    default: areaDefFor(getSetting, null),
    users,
    gmPrivate: normalizeAreaDef(copy(gmPrivateDef(getSetting))),
  };
}

/**
 * The whole `rollAreas` object to write after setting one entry: every other stored entry is
 * kept as it is, readable or not. `def` null removes a user's entry. Returns null (write
 * nothing) when the stored value or its `users` container is unreadable, so a save never
 * overwrites data it cannot read, or when `userId` is "__proto__".
 */
export function withArea(stored, userId, def) {
  if (userId === '__proto__') return null;
  if (stored !== undefined && !isPlainObject(stored)) return null;
  const base = stored === undefined ? {} : { ...stored };
  if (base.users !== undefined && !isPlainObject(base.users)) return null;
  if (userId == null) {
    base.default = normalizeAreaDef(def);
    if (base.users === undefined) base.users = {};
    return base;
  }
  const users = { ...(base.users ?? {}) };
  if (def === null) delete users[userId];
  else users[userId] = normalizeAreaDef(def);
  base.users = users;
  if (!('default' in base)) base.default = { preset: 'full' };
  return base;
}

/** Fires the change hook with a snapshot; a throwing listener is contained. */
export function emitRollAreasChanged(hooks, getSetting) {
  try {
    hooks.callAll('dicerRollAreasChanged', snapshotAreas(getSetting));
  } catch (err) {
    console.error('dicer: a dicerRollAreasChanged listener failed', err);
  }
}

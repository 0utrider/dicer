import { normalizeAreaDef } from './area-model.js';

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * A copy of every stored area for the change hook and API readers:
 * `{default, users, gmPrivate}` (defs normalized; unreadable entries come out as the default
 * area, never thrown). Mutating it changes nothing stored.
 */
export function snapshotAreas(getSetting) {
  const stored = getSetting('rollAreas');
  const base = isPlainObject(stored) ? stored : {};
  const users = {};
  if (isPlainObject(base.users)) {
    for (const [id, def] of Object.entries(base.users)) users[id] = normalizeAreaDef(copy(def));
  }
  return {
    default: normalizeAreaDef(copy(base.default)),
    users,
    gmPrivate: normalizeAreaDef(copy(getSetting('gmPrivateArea') ?? { preset: 'corner' })),
  };
}

/**
 * The whole `rollAreas` object to write after setting one entry: every other stored entry is
 * kept as it is, readable or not. `def` null removes a user's entry (a null userId cannot be
 * removed: the default is always set).
 */
export function withArea(stored, userId, def) {
  const base = isPlainObject(stored) ? { ...stored } : {};
  if (userId == null) {
    base.default = normalizeAreaDef(def);
    if (!isPlainObject(base.users)) base.users = {};
    return base;
  }
  const users = isPlainObject(base.users) ? { ...base.users } : {};
  if (def === null) delete users[userId];
  else users[userId] = normalizeAreaDef(def);
  base.users = users;
  if (!('default' in base)) base.default = { preset: 'full' };
  return base;
}

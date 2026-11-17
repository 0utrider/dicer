/**
 * The GM's Dice So Nice migration report: what the migration (migration.js) copied, kept or
 * skipped, for the world and every user, derived fresh from current data. Read-only: nothing is
 * written. Uses the migration's own mapping, so its verdicts match what the migration does. DSN
 * flags are read raw from `_source` (the scope is inactive). A lazy chunk, like migration.js.
 */
import {
  DSN_SCOPE,
  MIGRATED_FLAG,
  WORLD_FLAG,
  SCOPE_KEY,
  WORLD_MAP,
  UNMAPPED,
  dsnAppearanceToLooks,
  isMirroredDefault,
  storedWorldValue,
} from './migration.js';
import { FLAG_SCOPE, FLAG_KEY, isPlainObject } from './user-looks.js';

const USER_ORDER = { pending: 0, migrated: 1, none: 2 };

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

const safe = (fn, fallback) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

function worldRows(world, getSetting, isCustomized, migrated) {
  const rows = [];
  for (const [dsnKey, [key, check]] of Object.entries(WORLD_MAP)) {
    const raw = safe(() => world.get(dsnKey), undefined);
    if (raw === undefined || raw === null) {
      rows.push({ dsnKey, key, status: 'absent', value: undefined });
      continue;
    }
    const value = check(raw);
    let status;
    if (value === undefined) status = 'invalid';
    else if (migrated) status = deepEqual(safe(() => getSetting(key), undefined), value) ? 'copied' : 'dicer';
    else status = safe(() => isCustomized(key), false) ? 'would-keep' : 'would-copy';
    rows.push({ dsnKey, key, status, value: value === undefined ? raw : value });
  }
  for (const dsnKey of UNMAPPED) {
    const raw = safe(() => world.get(dsnKey), undefined);
    if (raw !== undefined && raw !== null) rows.push({ dsnKey, key: null, status: 'no-counterpart', value: raw });
  }
  return rows;
}

function userRow(user) {
  const raw = user?._source?.flags?.[DSN_SCOPE];
  const flags = isPlainObject(raw) ? raw : {};
  const appearance = isPlainObject(flags.appearance) ? flags.appearance : {};
  const dsnScopes = Object.keys(appearance).filter((s) => SCOPE_KEY.test(s));
  const saves = isPlainObject(flags.saves) ? Object.keys(flags.saves).length : 0;
  const otherKeys = Object.keys(flags)
    .filter((k) => k !== 'appearance' && k !== 'saves')
    .sort();
  const base = { id: user?.id, name: String(user?.name ?? ''), saves, otherKeys };
  if (!dsnScopes.length) return { ...base, status: 'none', scopes: [] };

  const migrated = Boolean(safe(() => user.getFlag(FLAG_SCOPE, MIGRATED_FLAG), false));
  const ownFlag = safe(() => user.getFlag(FLAG_SCOPE, FLAG_KEY), null);
  const own = isPlainObject(ownFlag) ? ownFlag : {};
  const looks = dsnAppearanceToLooks(appearance);
  const scopes = dsnScopes.map((scope) => {
    const ref = looks[scope];
    if (!ref) return { scope, status: 'unusable' };
    const mine = own[scope];
    if (migrated) return { scope, status: deepEqual(mine, ref) ? 'copied' : 'dicer' };
    const chosen = isPlainObject(mine) && !isMirroredDefault(mine);
    return { scope, status: chosen ? 'would-keep' : 'would-copy' };
  });
  return { ...base, status: migrated ? 'migrated' : 'pending', scopes };
}

/**
 * The migration report. Never throws on bad data; never writes.
 * @param {object} deps
 * @param {Iterable<object>} deps.users every user (`game.users`)
 * @param {{ get(key: string): unknown }} deps.world DSN world setting by bare key (worldSettingsReader)
 * @param {(key: string) => unknown} deps.getSetting a Dicer world setting
 * @param {(key: string) => boolean} [deps.isCustomized] Dicer holds an explicit world value
 * @param {{ active?: boolean }} [deps.dsnModule] `game.modules.get('dice-so-nice')`
 */
export function buildReport({ users = [], world, getSetting, isCustomized = storedWorldValue, dsnModule }) {
  const worldMigrated = Boolean(safe(() => getSetting(WORLD_FLAG), false));
  const worldList = worldRows(world, getSetting, isCustomized, worldMigrated);
  const userList = [...(users ?? [])]
    .map(userRow)
    .sort((a, b) => USER_ORDER[a.status] - USER_ORDER[b.status] || a.name.localeCompare(b.name));
  return {
    enabled: safe(() => getSetting('migrateFromDsn'), true) !== false,
    worldMigrated,
    dsn: dsnModule ? (dsnModule.active ? 'active' : 'installed') : 'missing',
    hasData: worldList.some((w) => w.status !== 'absent') || userList.some((u) => u.status !== 'none'),
    world: worldList,
    users: userList,
  };
}

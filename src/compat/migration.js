/**
 * One-time migration from Dice So Nice. DSN keeps its data under the `dice-so-nice` scope, which
 * is not registered while DSN is inactive, so user flags are read raw from `_source` and world
 * settings from the world settings storage (never `getFlag`, which throws for an inactive
 * scope). Only data are mapped; no DSN code is involved. This file loads only through
 * `import()`: it is a lazy chunk, never part of the world-start bundle.
 */
import { colorsetToAppearance } from './colorset-map.js';
import { FLAG_SCOPE, FLAG_KEY, isPlainObject, lookRefToAppearance } from './user-looks.js';

export const DSN_SCOPE = 'dice-so-nice';
export const MIGRATED_FLAG = 'migratedFromDsn';
export const WORLD_FLAG = 'dsnWorldMigrated';
/** The user flag listing the Dice So Nice save profiles already imported as themes (by name). */
export const SAVES_FLAG = 'dsnSavesImported';

export const SCOPE_KEY = /^(global|d[a-z0-9]+)$/i;

/** DSN world setting -> Dicer world setting (with the value check that maps it). */
export const WORLD_MAP = {
  maxDiceNumber: ['maxDice', (v) => (Number.isFinite(v) ? Math.min(100, Math.max(1, Math.round(v))) : undefined)],
  immediatelyDisplayChatMessages: ['immediatelyDisplayChatMessages', (v) => (typeof v === 'boolean' ? v : undefined)],
  // Dice So Nice 4.2+ stores a choice: '0' none, '1' for all, '2' the roller, '3' players' rolls
  showGhostDice: ['showGhostDice', (v) => (typeof v === 'boolean' ? v : ['0', '1', '2', '3'].includes(String(v)) ? String(v) !== '0' : undefined)],
};
/** DSN settings Dicer has no counterpart for yet. */
export const UNMAPPED = ['hideNpcRolls', 'diceCanBeFlipped'];

const str = (v) => (typeof v === 'string' && v ? v : undefined);

/** One DSN appearance entry as a LookRef, or null when it carries nothing usable. */
function entryToLookRef(entry) {
  if (!isPlainObject(entry)) return null;
  const system = str(entry.system);
  const withSystem = (ref) => (system ? { ...ref, system } : ref);
  const colorset = str(entry.colorset);
  if (colorset && colorset.toLowerCase() !== 'custom') return withSystem({ colorset });
  const colors = {
    foreground: str(entry.labelColor),
    background: str(entry.diceColor),
    outline: str(entry.outlineColor),
    edge: str(entry.edgeColor),
  };
  if (!Object.values(colors).some(Boolean)) return null;
  const appearance = colorsetToAppearance({
    ...colors,
    material: str(entry.material),
    texture: str(entry.texture),
  });
  return appearance ? withSystem({ appearance }) : null;
}

/**
 * DSN's `{ global | dN: {...} }` appearance as `{ [scope]: LookRef }`. Garbage entries are
 * skipped; never throws.
 * @returns {Record<string, object>}
 */
export function dsnAppearanceToLooks(dsnAppearance) {
  const out = {};
  if (!isPlainObject(dsnAppearance)) return out;
  for (const [scope, entry] of Object.entries(dsnAppearance)) {
    if (!SCOPE_KEY.test(scope)) continue;
    try {
      const ref = entryToLookRef(entry);
      if (ref) out[scope] = ref;
    } catch {
      /* a malformed entry is skipped */
    }
  }
  return out;
}

/** The user's raw DSN flag data (never getFlag: the scope is inactive). */
const dsnFlags = (user) => {
  const flags = user?._source?.flags?.[DSN_SCOPE];
  return isPlainObject(flags) ? flags : null;
};

/** The bare `{theme:'default'}` (before Plan 5 `{look:'default'}`) the ready-time mirror writes: not a choice the user made. */
export const isMirroredDefault = (ref) =>
  Object.keys(ref).length === 1 && (ref.theme === 'default' || ref.look === 'default');

/** The user's own `dicer.appearance` entries; no default is invented. */
function ownLooks(user) {
  try {
    const flag = user.getFlag(FLAG_SCOPE, FLAG_KEY);
    return isPlainObject(flag) ? { ...flag } : {};
  } catch {
    return {};
  }
}

/**
 * Copies the user's DSN appearances into `dicer.appearance`, only for scopes Dicer has no entry
 * for (Dicer choices win), then sets `dicer.migratedFromDsn`. A user without DSN appearance data
 * is left alone and unflagged, so a later DSN install is not hidden. Idempotent.
 * @returns {Promise<boolean>} true if anything was written to `dicer.appearance`
 */
export async function migrateUser(user) {
  if (user.getFlag(FLAG_SCOPE, MIGRATED_FLAG)) return false;
  const looks = dsnAppearanceToLooks(dsnFlags(user)?.appearance);
  if (!Object.keys(looks).length) return false;
  const own = ownLooks(user);
  let wrote = false;
  for (const [scope, ref] of Object.entries(looks)) {
    if (isPlainObject(own[scope]) && !isMirroredDefault(own[scope])) continue;
    own[scope] = ref;
    wrote = true;
  }
  if (wrote) await user.setFlag(FLAG_SCOPE, FLAG_KEY, own);
  await user.setFlag(FLAG_SCOPE, MIGRATED_FLAG, 1);
  return wrote;
}

/** True when the world settings storage holds an explicit `dicer.<key>` value. */
export function storedWorldValue(key) {
  try {
    const storage = globalThis.game?.settings?.storage?.get('world');
    return (storage?.getItem?.(`${FLAG_SCOPE}.${key}`) ?? null) !== null;
  } catch {
    return false;
  }
}

/**
 * Maps DSN's world settings onto Dicer's. GM only. Does nothing once `dsnWorldMigrated` is set,
 * or when no DSN world setting exists (that is not flagged either).
 * @param {{ get(key: string): unknown }} worldSettings DSN setting by bare key (parsed value)
 * @param {{ isCustomized?: (key: string) => boolean }} [deps] isCustomized: Dicer already has an
 *   explicit stored world value for the key (default: reads the world settings storage)
 * @param {{ settings?: { get(scope: string, key: string): unknown, set(scope: string, key: string, value: unknown): Promise<unknown> } }} [deps]
 * @returns {Promise<Record<string, unknown>>} the Dicer settings written
 */
export async function migrateWorld(
  worldSettings,
  { settings = globalThis.game?.settings, isCustomized = storedWorldValue } = {},
) {
  if (settings.get(FLAG_SCOPE, WORLD_FLAG)) return {};
  const mapped = {};
  let found = false;
  for (const [dsnKey, [key, check]] of Object.entries(WORLD_MAP)) {
    const raw = worldSettings.get(dsnKey);
    if (raw === undefined || raw === null) continue;
    found = true;
    const value = check(raw);
    // A value the GM already set in Dicer is never overwritten.
    if (value !== undefined && !isCustomized(key)) mapped[key] = value;
  }
  for (const dsnKey of UNMAPPED) {
    if (worldSettings.get(dsnKey) === undefined) continue;
    found = true;
    console.info(`dicer: DSN world setting "${dsnKey}" has no Dicer counterpart yet; not migrated`);
  }
  if (!found) return {};
  for (const [key, value] of Object.entries(mapped)) await settings.set(FLAG_SCOPE, key, value);
  await settings.set(FLAG_SCOPE, WORLD_FLAG, 1);
  return mapped;
}

/** A `{ get(key) }` over the world settings storage: the parsed value of `dice-so-nice.<key>`. */
export function worldSettingsReader(storage) {
  return {
    get(key) {
      const raw = storage?.getItem?.(`${DSN_SCOPE}.${key}`);
      if (raw === null || raw === undefined) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * The ready-time run: this client's user, plus the world for a GM. Every step is isolated, so
 * a failure in one is warned and the other still runs.
 * @returns {Promise<boolean>} true if anything was migrated (the caller shows the notice)
 */
export async function runMigration({ user, isGM, worldSettings, settings, isCustomized }) {
  let migrated = false;
  try {
    migrated = (await migrateUser(user)) || migrated;
  } catch (err) {
    console.warn('dicer: cannot migrate the Dice So Nice appearance', err);
  }
  if (isGM) {
    try {
      const mapped = await migrateWorld(worldSettings, { settings, ...(isCustomized && { isCustomized }) });
      migrated = Object.keys(mapped).length > 0 || migrated;
    } catch (err) {
      console.warn('dicer: cannot migrate the Dice So Nice world settings', err);
    }
  }
  return migrated;
}

/**
 * game.dice3d.loadSaveFile: overwrites `dicer.appearance` with a DSN save profile. An explicit
 * user choice, so DSN data wins here.
 * @returns {Promise<boolean>} false (with a warning) when the profile is missing or empty
 */
export async function loadSaveFile(
  user,
  name,
  { replace = globalThis.foundry?.data?.operators?.ForcedReplacement?.create } = {},
) {
  const saves = dsnFlags(user)?.saves;
  const profile = isPlainObject(saves) && Object.hasOwn(saves, name) ? saves[name] : null;
  const looks = dsnAppearanceToLooks(profile?.appearance);
  if (!Object.keys(looks).length) {
    console.warn(`dicer: no Dice So Nice save profile "${name}" to load`);
    return false;
  }
  // A forced replacement, not setFlag (which merges and would keep scopes the save lacks).
  await user.update({ flags: { [FLAG_SCOPE]: { [FLAG_KEY]: replace(looks) } } });
  return true;
}

/**
 * A user theme id: theme-form.js userThemeId's rule, kept here so this chunk does not pull the
 * theme browser's modules in with it (tests/unit/migration.test.js checks they agree).
 */
export function userThemeId(userId, name, taken = []) {
  const slug = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'theme';
  const base = `user.${userId}.${slug}`;
  const set = new Set(taken);
  let id = base;
  for (let n = 2; set.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * One Dice So Nice save profile as a raw Dicer theme ({id, name, appearance, perType}), or null
 * when none of its entries can be drawn (a colorset no module has registered yet, or garbage).
 * Its global entry is the theme's look; die-type entries are its per-type looks (a save with only
 * die-type entries takes its first as the look). Marked with `dsnSave` (its profile name).
 */
export function saveToTheme(name, profile, { userId, taken = [], registry } = {}) {
  const looks = dsnAppearanceToLooks(profile?.appearance);
  const drawn = {};
  for (const [scope, ref] of Object.entries(looks)) {
    try {
      const look = lookRefToAppearance(ref, registry);
      if (look?.appearance) drawn[scope] = look.appearance;
    } catch {
      /* an entry that cannot be drawn is skipped */
    }
  }
  const { global, ...perType } = drawn;
  const appearance = global ?? Object.values(perType)[0];
  if (!appearance) return null;
  const label = String(name).trim() || 'Dice So Nice';
  return { id: userThemeId(userId, label, taken), name: label, appearance, perType, dsnSave: name };
}

/**
 * Adds the user's Dice So Nice save profiles to their own themes (`dicer.themes`, "My themes"):
 * each profile once (SAVES_FLAG lists the imported names, so a theme the user deletes is not
 * brought back), and one that cannot be drawn yet (its module's colorset not registered) is tried
 * again on a later load. Never throws for bad data; a write failure rejects.
 * @returns {Promise<number>} the themes added
 */
export async function migrateSaves(user, { registry } = {}) {
  const saves = dsnFlags(user)?.saves;
  if (!isPlainObject(saves)) return 0;
  const doneFlag = user.getFlag(FLAG_SCOPE, SAVES_FLAG);
  const done = new Set(Array.isArray(doneFlag) ? doneFlag : []);
  const ownFlag = user.getFlag(FLAG_SCOPE, 'themes');
  const list = Array.isArray(ownFlag) ? [...ownFlag] : [];
  const taken = list.map((t) => t?.id).filter(Boolean);
  let added = 0;
  for (const [name, profile] of Object.entries(saves)) {
    if (done.has(name)) continue;
    if (list.some((t) => t?.dsnSave === name)) {
      done.add(name);
      continue;
    }
    const theme = saveToTheme(name, profile, { userId: user.id, taken, registry });
    if (!theme) continue;
    list.push(theme);
    taken.push(theme.id);
    done.add(name);
    added++;
  }
  if (added) await user.setFlag(FLAG_SCOPE, 'themes', list);
  if (done.size !== (Array.isArray(doneFlag) ? doneFlag.length : 0)) await user.setFlag(FLAG_SCOPE, SAVES_FLAG, [...done]);
  return added;
}

/**
 * The GM's import for every user at once (the Dice So Nice report's button): each user's
 * appearance (migrateUser) and save profiles (migrateSaves), and the world's settings. A user that
 * fails is warned and skipped; the rest still run.
 * @returns {Promise<{users: number, themes: number, world: boolean}>} users whose looks were
 *   copied, themes added, whether world settings were copied
 */
export async function migrateAll({ users = [], registry, worldSettings, settings } = {}) {
  const out = { users: 0, themes: 0, world: false };
  for (const user of users) {
    try {
      if (await migrateUser(user)) out.users++;
      out.themes += await migrateSaves(user, { registry });
    } catch (err) {
      console.warn(`dicer: cannot import Dice So Nice data for ${user?.name}`, err);
    }
  }
  if (worldSettings) {
    try {
      out.world = Object.keys(await migrateWorld(worldSettings, { settings })).length > 0;
    } catch (err) {
      console.warn('dicer: cannot migrate the Dice So Nice world settings', err);
    }
  }
  return out;
}

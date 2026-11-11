/**
 * One-time migration from Dice So Nice. DSN keeps its data under the `dice-so-nice` scope, which
 * is not registered while DSN is inactive, so user flags are read raw from `_source` and world
 * settings from the world settings storage (never `getFlag`, which throws for an inactive
 * scope). Only data are mapped; no DSN code is involved. This file loads only through
 * `import()`: it is a lazy chunk, never part of the world-start bundle.
 */
import { colorsetToAppearance } from './colorset-map.js';
import { FLAG_SCOPE, FLAG_KEY, isPlainObject } from './user-looks.js';

export const DSN_SCOPE = 'dice-so-nice';
export const MIGRATED_FLAG = 'migratedFromDsn';
export const WORLD_FLAG = 'dsnWorldMigrated';

const SCOPE_KEY = /^(global|d[a-z0-9]+)$/i;

/** DSN world setting -> Dicer world setting (with the value check that maps it). */
const WORLD_MAP = {
  maxDiceNumber: ['maxDice', (v) => (Number.isFinite(v) ? Math.min(100, Math.max(1, Math.round(v))) : undefined)],
  immediatelyDisplayChatMessages: ['immediatelyDisplayChatMessages', (v) => (typeof v === 'boolean' ? v : undefined)],
  showGhostDice: ['showGhostDice', (v) => (typeof v === 'boolean' ? v : undefined)],
};
/** DSN settings Dicer has no counterpart for yet. */
const UNMAPPED = ['hideNpcRolls', 'diceCanBeFlipped'];

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
const isMirroredDefault = (ref) =>
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
function storedWorldValue(key) {
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

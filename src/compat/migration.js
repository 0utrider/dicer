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
/** The user flag listing the Dice So Nice library dice already imported as themes (by die id). */
export const LIBRARY_FLAG = 'dsnLibraryImported';
/**
 * The migrated flag's version: 2 also reads looks that point at a Dice So Nice library die. A user
 * migrated at 1 is looked at once more (their own Dicer choices still win).
 */
export const MIGRATION_VERSION = 2;

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

/**
 * One DSN appearance entry as a LookRef, or null when it carries nothing usable. An entry that
 * points at a library die (`libraryDieId`, Dice So Nice 5+) takes that die's base look, found by
 * `findDie(id, owner)`; the entry's own system, if any, wins.
 */
function entryToLookRef(entry, findDie) {
  if (!isPlainObject(entry)) return null;
  if (typeof entry.libraryDieId === 'string' && findDie) {
    const die = findDie(entry.libraryDieId, entry.libraryDieOwner);
    if (isPlainObject(die?.baseAppearance)) entry = { ...die.baseAppearance, ...(str(entry.system) && { system: entry.system }), colorset: str(die.baseAppearance.colorset) ?? 'custom' };
  }
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
 * skipped; never throws. `findDie(id, owner)` resolves entries that point at a library die.
 * @returns {Record<string, object>}
 */
export function dsnAppearanceToLooks(dsnAppearance, findDie = null) {
  const out = {};
  if (!isPlainObject(dsnAppearance)) return out;
  for (const [scope, entry] of Object.entries(dsnAppearance)) {
    if (!SCOPE_KEY.test(scope)) continue;
    try {
      const ref = entryToLookRef(entry, findDie);
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

/** A user's raw Dice So Nice library dice (`diceLibrary`), or []. */
export const libraryOf = (user) => {
  const list = dsnFlags(user)?.diceLibrary;
  return Array.isArray(list) ? list.filter(isPlainObject) : [];
};

/** The world's Dice So Nice library dice (the `worldDiceLibrary` world setting), or []. */
const worldLibrary = (worldSettings) => {
  try {
    const list = worldSettings?.get('worldDiceLibrary');
    return Array.isArray(list) ? list.filter(isPlainObject) : [];
  } catch {
    return [];
  }
};

/**
 * `findDie(id, owner)` for `user`'s looks: a die in their own library (no owner), another user's
 * (owner: a user id) or the world's (owner 'world').
 */
export function libraryLookup(user, { users = globalThis.game?.users, worldSettings } = {}) {
  const userById = (id) => users?.get?.(id) ?? [...(users ?? [])].find((u) => u?.id === id);
  return (id, owner) => {
    const ownerId = isPlainObject(owner) ? owner.id : owner;
    const list = !ownerId ? libraryOf(user) : ownerId === 'world' ? worldLibrary(worldSettings) : libraryOf(userById(ownerId));
    return list.find((d) => d.id === id) ?? null;
  };
}

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
export async function migrateUser(user, { findDie = libraryLookup(user) } = {}) {
  if ((Number(user.getFlag(FLAG_SCOPE, MIGRATED_FLAG)) || 0) >= MIGRATION_VERSION) return false;
  const looks = dsnAppearanceToLooks(dsnFlags(user)?.appearance, findDie);
  if (!Object.keys(looks).length) return false;
  const own = ownLooks(user);
  let wrote = false;
  for (const [scope, ref] of Object.entries(looks)) {
    if (isPlainObject(own[scope]) && !isMirroredDefault(own[scope])) continue;
    own[scope] = ref;
    wrote = true;
  }
  if (wrote) await user.setFlag(FLAG_SCOPE, FLAG_KEY, own);
  await user.setFlag(FLAG_SCOPE, MIGRATED_FLAG, MIGRATION_VERSION);
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
export async function runMigration({ user, isGM, worldSettings, settings, isCustomized, users }) {
  let migrated = false;
  try {
    migrated = (await migrateUser(user, { findDie: libraryLookup(user, { users, worldSettings }) })) || migrated;
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
export function saveToTheme(name, profile, { userId, taken = [], registry, findDie } = {}) {
  const looks = dsnAppearanceToLooks(profile?.appearance, findDie);
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
export async function migrateSaves(user, { registry, findDie = libraryLookup(user) } = {}) {
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
    const theme = saveToTheme(name, profile, { userId: user.id, taken, registry, findDie });
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
 * Library dice as raw themes: dice sharing a name (any case) make one theme, each die its type's
 * look (the first die's look is the theme's base). `idOf(name, taken)` names them. A die whose
 * look cannot be drawn is skipped. Each theme lists its dice in `dsnLibrary` (their ids).
 */
export function libraryToThemes(dice, { idOf, taken = [], registry } = {}) {
  const groups = new Map();
  for (const die of dice) {
    if (!isPlainObject(die?.baseAppearance) || typeof die.dieType !== 'string') continue;
    const ref = entryToLookRef({ ...die.baseAppearance, colorset: str(die.baseAppearance.colorset) ?? 'custom' });
    let look = null;
    try {
      look = ref && lookRefToAppearance(ref, registry);
    } catch {
      look = null;
    }
    if (!look?.appearance) continue;
    const name = String(die.name ?? '').trim() || die.dieType;
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name, perType: {}, ids: [] });
    const g = groups.get(key);
    g.perType[die.dieType] ??= look.appearance;
    if (die.id) g.ids.push(die.id);
  }
  const ids = [...taken];
  return [...groups.values()].map((g) => {
    const id = idOf(g.name, ids);
    ids.push(id);
    return { id, name: g.name, appearance: Object.values(g.perType)[0], perType: g.perType, dsnLibrary: g.ids };
  });
}

/**
 * Adds the user's Dice So Nice library dice to their own themes, once per die (LIBRARY_FLAG lists
 * the imported die ids; a theme the user deletes is not brought back).
 * @returns {Promise<number>} the themes added
 */
export async function migrateLibrary(user, { registry } = {}) {
  const doneFlag = user.getFlag(FLAG_SCOPE, LIBRARY_FLAG);
  const done = new Set(Array.isArray(doneFlag) ? doneFlag : []);
  const dice = libraryOf(user).filter((d) => !done.has(d.id));
  if (!dice.length) return 0;
  const ownFlag = user.getFlag(FLAG_SCOPE, 'themes');
  const list = Array.isArray(ownFlag) ? [...ownFlag] : [];
  const themes = libraryToThemes(dice, { idOf: (n, t) => userThemeId(user.id, n, t), taken: list.map((t) => t?.id).filter(Boolean), registry });
  for (const t of themes) for (const id of t.dsnLibrary) done.add(id);
  if (themes.length) await user.setFlag(FLAG_SCOPE, 'themes', [...list, ...themes]);
  await user.setFlag(FLAG_SCOPE, LIBRARY_FLAG, [...done]);
  return themes.length;
}

/**
 * The world's Dice So Nice library as world themes (GM): each die once (a world theme already
 * listing it in `dsnLibrary` holds it).
 * @returns {Promise<number>} the themes added
 */
export async function migrateWorldLibrary(worldSettings, { settings = globalThis.game?.settings, registry } = {}) {
  const current = settings.get(FLAG_SCOPE, 'worldThemes');
  const list = Array.isArray(current) ? [...current] : [];
  const held = new Set(list.flatMap((t) => (Array.isArray(t?.dsnLibrary) ? t.dsnLibrary : [])));
  const dice = worldLibrary(worldSettings).filter((d) => !held.has(d.id));
  if (!dice.length) return 0;
  const idOf = (name, taken) => {
    const base = `world.${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'theme'}`;
    let id = base;
    for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
    return id;
  };
  const themes = libraryToThemes(dice, { idOf, taken: list.map((t) => t?.id).filter(Boolean), registry });
  if (themes.length) await settings.set(FLAG_SCOPE, 'worldThemes', [...list, ...themes]);
  return themes.length;
}

/** A parsed Dice So Nice export file: a dice library export, or a whole settings export. */
export const isDsnFile = (data) =>
  isPlainObject(data) && !Array.isArray(data.themes) && typeof data.id !== 'string' && (data.dsnLibraryExport === true || isPlainObject(data.appearance) || isPlainObject(data.saves) || Array.isArray(data.diceLibrary));

/**
 * The themes a Dice So Nice export file holds, as raw user themes: its library dice (grouped by
 * name), its saved looks, and its current look (named "Dice So Nice"). For the theme browser's
 * Import; never throws for bad data.
 */
export function dsnFileThemes(data, { userId, taken = [], registry } = {}) {
  const ids = [...taken];
  const idOf = (n, t) => userThemeId(userId, n, t);
  const library = (Array.isArray(data?.dice) ? data.dice : Array.isArray(data?.diceLibrary) ? data.diceLibrary : []).filter(isPlainObject);
  const findDie = (id) => library.find((d) => d.id === id) ?? null;
  const out = libraryToThemes(library, { idOf, taken: ids, registry });
  for (const t of out) ids.push(t.id);
  const add = (name, profile) => {
    const t = saveToTheme(name, profile, { userId, taken: ids, registry, findDie });
    if (t) {
      out.push(t);
      ids.push(t.id);
    }
  };
  if (isPlainObject(data?.saves)) for (const [name, profile] of Object.entries(data.saves)) add(name, profile);
  if (isPlainObject(data?.appearance)) add('Dice So Nice', { appearance: data.appearance });
  return out;
}

/**
 * The load-time import (main.js, after diceSoNiceReady): `user`'s saved looks and library dice as
 * their themes, and for a GM the world's library as world themes. `storage` is the world settings
 * storage. Each item once, so a load with nothing new writes nothing.
 * @returns {Promise<number>} the themes added
 */
export async function importLooks({ user, users, registry, storage }) {
  const worldSettings = worldSettingsReader(storage);
  const findDie = libraryLookup(user, { users, worldSettings });
  let n = (await migrateSaves(user, { registry, findDie })) + (await migrateLibrary(user, { registry }));
  if (user.isGM) n += await migrateWorldLibrary(worldSettings, { registry });
  return n;
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
      const findDie = libraryLookup(user, { users, worldSettings });
      if (await migrateUser(user, { findDie })) out.users++;
      out.themes += await migrateSaves(user, { registry, findDie });
      out.themes += await migrateLibrary(user, { registry });
    } catch (err) {
      console.warn(`dicer: cannot import Dice So Nice data for ${user?.name}`, err);
    }
  }
  if (worldSettings) {
    try {
      out.themes += await migrateWorldLibrary(worldSettings, { settings, registry });
    } catch (err) {
      console.warn('dicer: cannot import the Dice So Nice world dice library', err);
    }
    try {
      out.world = Object.keys(await migrateWorld(worldSettings, { settings })).length > 0;
    } catch (err) {
      console.warn('dicer: cannot migrate the Dice So Nice world settings', err);
    }
  }
  return out;
}

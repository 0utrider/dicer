import { PRESETS, normalizeAreaDef, resolveArea } from './area-model.js';

const DEFAULT_AREA = Object.freeze({ preset: 'full' });
const GM_PRIVATE_DEFAULT = Object.freeze({ preset: 'corner' });

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** A stored def is usable when normalizing keeps its preset (unknown or empty custom is not). */
function isValidDef(raw) {
  if (!isPlainObject(raw)) return false;
  return (
    (Object.hasOwn(PRESETS, raw.preset) || raw.preset === 'custom') &&
    normalizeAreaDef(raw).preset === raw.preset
  );
}

const EPS = 0.5;
const sameRect = (a, b) =>
  Math.abs(a.left - b.left) < EPS &&
  Math.abs(a.top - b.top) < EPS &&
  Math.abs(a.width - b.width) < EPS &&
  Math.abs(a.height - b.height) < EPS;

/**
 * Which area a throw uses on this screen (P5-D1: the roller's area, on every viewer; P5-D2: this
 * client's areaScale; P5-D7: the GM private corner, opt-in, only on a GM's own client). Settings
 * are read per throw, so changing an area never rebuilds anything.
 *
 * @param {object} deps
 * @param {(key: string) => any} deps.getSetting
 * @param {() => {left, top, width, height}} deps.measureUsable the stage
 * @param {() => { isGM?: boolean } | undefined} deps.currentUser the viewing user
 */
export function createAreaResolver({ getSetting, measureUsable, currentUser }) {
  const warned = new Set();
  const warnOnce = (key, detail) => {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`dicer: the stored roll area ${key} is unreadable; using the default`, detail);
  };

  /** A stored def, or `fallback` (warning once under `key`) when it is malformed. */
  const checked = (raw, key, fallback) => {
    if (isValidDef(raw)) return raw;
    warnOnce(key, raw);
    return fallback;
  };

  function isGM() {
    try {
      return currentUser()?.isGM === true;
    } catch {
      return false;
    }
  }

  /** The stored def for this throw: GM corner, else the roller's own, else the default. */
  function defFor({ rollerId, gmPrivate }) {
    if (gmPrivate === true && isGM() && getSetting('gmPrivateCorner') === true) {
      return checked(getSetting('gmPrivateArea'), 'gmPrivateArea', GM_PRIVATE_DEFAULT);
    }
    const stored = getSetting('rollAreas');
    if (stored === undefined) return DEFAULT_AREA;
    if (!isPlainObject(stored)) {
      warnOnce('rollAreas', stored);
      return DEFAULT_AREA;
    }
    const fallback =
      'default' in stored
        ? checked(stored.default, 'rollAreas.default', DEFAULT_AREA)
        : DEFAULT_AREA;
    if (getSetting('perPlayerAreas') === false || rollerId == null) return fallback;
    const { users } = stored;
    if (users === undefined) return fallback;
    if (!isPlainObject(users)) {
      warnOnce('rollAreas.users', users);
      return fallback;
    }
    if (!Object.hasOwn(users, rollerId)) return fallback;
    return checked(users[rollerId], `rollAreas.users.${rollerId}`, fallback);
  }

  const stage = () => measureUsable();

  /** The px rect for the throw, or null when it is the whole stage (DiceBox throws as before). */
  function rectFor({ rollerId, gmPrivate = false } = {}) {
    try {
      const usable = stage();
      const def = defFor({ rollerId, gmPrivate });
      const scale = Number(getSetting('areaScale')) || 1;
      const rect = resolveArea(def, usable, { scale });
      return sameRect(rect, usable) ? null : rect;
    } catch (err) {
      warnOnce('lookup', err);
      return null;
    }
  }

  return { rectFor, stage };
}

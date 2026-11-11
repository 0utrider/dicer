/**
 * Trigger effects decided at plan time (P4-D2: the roller's rules decide, the viewer filters).
 *
 * Privacy (G1): this resolver is only ever reached through `decorateFor`, which the message gate
 * and showForRoll call for `real` views only (a ghost view uses the ghost decorator, a `none`
 * view is not planned). So nothing result-dependent (effect, result sound, slow motion, macro)
 * is ever computed for a die the current user may not see. Keep it that way: never call
 * `decorate` from anywhere a ghost or none view could reach.
 */
import { normalizeRules, matchRule, effectiveRules, dsnDefaultsToRules } from './rules.js';
import { outcomeOf, roleOf, damageTypesByTerm, KNOWN_DAMAGE_TYPES } from './roll-context.js';
import { getShape, dieTypeForFaces } from '../core/dice-shapes.js';

/**
 * @typedef {{ ruleId: string, effect: object|null, sound: object|null, macro: string|null,
 *   slowMotion: boolean, value: number, type: string }} Fx
 *   `macro` is set only on the roller's client with triggerMacros on; `value` / `type` are the
 *   matched result (a d100's full 1-100 result and 'd100') for the macro's arguments.
 */

/** Effect ids that slow the landing down (when the slowMotion setting is on). */
export const FX_SLOW_EFFECTS = ['celebrate', 'fumble'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The Dice So Nice type of a term: 'd' + a custom DENOMINATION, else 'd' + faces. */
function dsnTypeOf(term) {
  const denom = term?.constructor?.DENOMINATION;
  if (typeof denom === 'string' && denom && denom !== 'd') return `d${denom}`;
  return Number.isInteger(term?.faces) && term.faces > 0 ? `d${term.faces}` : null;
}

/** The face label text showing `value`: FaceSet labels are indexed like getShape(type).values. */
function labelOf(faces, baseType, value) {
  if (!Array.isArray(faces?.labels) || !baseType) return undefined;
  let values;
  try {
    values = getShape(baseType).values;
  } catch {
    return undefined;
  }
  const i = values.indexOf(value);
  const text = i >= 0 ? faces.labels[i]?.text : undefined;
  return typeof text === 'string' ? text : undefined;
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * @param {object} deps
 * @param {() => unknown} deps.getWorldRules the raw worldTriggers setting
 * @param {(userId: string) => unknown} deps.getUserRules the raw `dicer.triggers` flag of a user
 * @param {() => object[]} [deps.getModuleRules] already normalized module rules (DSN defaults)
 * @param {() => {id?: string}|undefined} deps.currentUser
 * @param {(key: string) => unknown} deps.getSetting
 * @param {(term) => string|null} [deps.shapeFor] base shape of a custom die type
 * @param {() => Set<string>} [deps.getKnownDamageTypes]
 */
export function createFxResolver({
  getWorldRules,
  getUserRules,
  getModuleRules = () => [],
  currentUser,
  getSetting,
  shapeFor = () => null,
  getKnownDamageTypes = () => KNOWN_DAMAGE_TYPES,
  warn = console.warn,
}) {
  /** cache key -> { raw, json, rules }: settings and flags are normalized once per value. */
  const cache = new Map();
  const warned = new Set();
  const warnOnce = (key, msg) => {
    if (warned.has(key)) return;
    warned.add(key);
    warn(msg);
  };

  function normalized(key, source, raw) {
    const hit = cache.get(key);
    if (hit && hit.raw === raw) return hit.rules;
    let json;
    try {
      json = JSON.stringify(raw ?? null);
    } catch {
      json = undefined;
    }
    if (hit && json !== undefined && hit.json === json) {
      hit.raw = raw;
      return hit.rules;
    }
    let rules = [];
    if (raw === undefined || raw === null) rules = [];
    else if (!Array.isArray(raw))
      warnOnce(`${key}:${json}`, `Dicer: ignoring malformed trigger rules (${key})`);
    else rules = normalizeRules(raw, source, warn);
    cache.set(key, { raw, json, rules });
    return rules;
  }

  const setting = (k) => safe(() => getSetting(k), undefined);

  function rulesFor(rollerId) {
    const world = normalized('world', 'world', safe(getWorldRules, null));
    const roller = rollerId
      ? normalized(
          `user:${rollerId}`,
          'user',
          safe(() => getUserRules(rollerId), null),
        )
      : [];
    const module = safe(getModuleRules, []);
    return effectiveRules({ world, roller, module: Array.isArray(module) ? module : [] });
  }

  return {
    /**
     * A decorator for planThrow: `(term, result, termIndex, look?) => {fx?, damageType?}`.
     * `look` is the look resolver's partial for the same die (its faces give label rules).
     * Returns undefined when effects are off, or the roll is another user's and
     * showOthersEffects is off.
     */
    decorate(message, roll, authorId) {
      if (setting('effects') === false) return undefined;
      const me = safe(currentUser, undefined)?.id ?? null;
      const rollerId = message?.author?.id ?? authorId ?? null;
      if (rollerId !== me && setting('showOthersEffects') === false) return undefined;

      const rules = rulesFor(rollerId);
      const outcome = safe(() => outcomeOf(roll, message), null);
      const role = safe(() => roleOf(message), null);
      const formula = safe(() => roll?.formula, undefined);
      const speakerActor = safe(() => message?.speaker?.actor, undefined);
      const damage = safe(() => damageTypesByTerm(roll, getKnownDamageTypes()), new WeakMap());
      const macros = rollerId !== null && rollerId === me && setting('triggerMacros') !== false;
      const slow = setting('slowMotion') !== false;

      return (term, result, termIndex, look) => {
        const out = {};
        const damageType = isObj(term) ? damage.get(term) : undefined;
        if (typeof damageType === 'string') out.damageType = damageType;
        if (!rules.length) return out;
        const value = result?.result;
        const faces = term?.faces;
        const dsnType = (typeof look?.dsnType === 'string' && look.dsnType) || dsnTypeOf(term);
        const base =
          faces === 100 ? null : (safe(() => shapeFor(term), null) ?? dieTypeForFaces(faces));
        const type = faces === 100 ? 'd100' : (base ?? dsnType);
        const actorId =
          (typeof speakerActor === 'string' && speakerActor) || term?.options?.dsnActorId;
        const die = {
          type,
          dsnType,
          value,
          faces,
          label: labelOf(look?.faces, base, value),
          formula,
          role,
          damageType,
          actorId: typeof actorId === 'string' ? actorId : undefined,
          userId: rollerId ?? undefined,
          outcome,
        };
        const fx = [];
        for (const rule of rules) {
          if (!safe(() => matchRule(rule, die), false)) continue;
          const effect = rule.effect ?? null;
          fx.push({
            ruleId: rule.id,
            effect,
            sound: rule.sound ?? null,
            macro: macros ? (rule.macro ?? null) : null,
            slowMotion:
              slow &&
              Boolean(
                effect && (FX_SLOW_EFFECTS.includes(effect.id) || effect.slowMotion === true),
              ),
            value,
            type: dsnType ?? type,
          });
        }
        if (fx.length) out.fx = fx;
        return out;
      };
    },
  };
}

/**
 * The module rules (Dice So Nice `addSFXDefaults`) of a registry, normalized once per change of
 * the defaults or triggers. Warnings are deduplicated across recomputations.
 */
export function moduleRulesOf(registry, warn = console.warn) {
  const warned = new Set();
  const warnOnce = (msg) => {
    if (warned.has(msg)) return;
    warned.add(msg);
    warn(msg);
  };
  let key;
  let rules = [];
  return () => {
    const defaults = safe(() => registry.getSFXDefaults(), []);
    const triggers = registry?.sfxTriggers;
    let next;
    try {
      next = JSON.stringify([defaults, triggers ? [...triggers.values()] : []]);
    } catch {
      next = undefined;
    }
    if (next !== undefined && next === key) return rules;
    key = next;
    rules = safe(() => dsnDefaultsToRules(defaults, triggers, warnOnce), []);
    return rules;
  };
}

/**
 * main.js's `decorateFor(message, roll, authorId, rollerId?)`: the look resolver's partial first,
 * the fx resolver's merged last without overriding any look field. `authorId` picks the look;
 * `rollerId` (the verified sender of a synchronized roll) picks the rules, else the author.
 * A throwing fx decorator warns once and leaves the look intact.
 */
export function composeDecorateFor({ looks, fx, warn = console.warn }) {
  let warned = false;
  return (message, roll, authorId, rollerId) => {
    const lookDec = looks?.decorate(message, roll, authorId);
    let fxDec;
    try {
      fxDec = fx?.decorate(message, roll, rollerId ?? authorId);
    } catch (err) {
      fxDec = undefined;
      if (!warned) {
        warned = true;
        warn('dicer: cannot resolve trigger effects', err);
      }
    }
    if (!fxDec) return lookDec;
    return (term, result, termIndex) => {
      const look = (lookDec ? lookDec(term, result, termIndex) : undefined) ?? {};
      let extra;
      try {
        extra = fxDec(term, result, termIndex, look);
      } catch (err) {
        if (!warned) {
          warned = true;
          warn('dicer: cannot resolve trigger effects', err);
        }
      }
      return extra ? { ...extra, ...look } : look;
    };
  };
}

/**
 * DiceBox's `onLandedFx(die, fx, rollKey)`: plays each fx sound (never awaited) and runs each
 * macro at most once per rule per `rollKey` (one object per DiceBox roll). The fx resolver only
 * leaves `macro` set on the roller's client with triggerMacros on. Failures warn once per
 * source and never throw.
 */
export function createLandedFx({ playSound, fromUuid, warn = console.warn }) {
  const ran = new WeakMap(); // rollKey -> Set<ruleId>
  const warned = new Set();
  const warnOnce = (key, ...args) => {
    if (warned.has(key)) return;
    warned.add(key);
    warn(...args);
  };

  function runMacro(f) {
    Promise.resolve()
      .then(() => fromUuid(f.macro))
      .then((macro) => {
        if (typeof macro?.execute !== 'function') throw new Error(`no macro ${f.macro}`);
        return macro.execute({ dicer: { value: f.value, type: f.type, ruleId: f.ruleId } });
      })
      .catch((err) => warnOnce(`macro:${f.macro}`, `Dicer: trigger macro ${f.macro} failed`, err));
  }

  return (die, fx, rollKey) => {
    if (!Array.isArray(fx)) return;
    for (const f of fx) {
      if (!isObj(f)) continue;
      if (f.sound) {
        try {
          const p = playSound(f.sound);
          if (p && typeof p.catch === 'function')
            p.catch((err) => warnOnce(`sound:${f.ruleId}`, 'Dicer: result sound failed', err));
        } catch (err) {
          warnOnce(`sound:${f.ruleId}`, 'Dicer: result sound failed', err);
        }
      }
      if (typeof f.macro === 'string' && f.macro) {
        const key = isObj(rollKey) ? rollKey : null;
        if (key) {
          if (!ran.has(key)) ran.set(key, new Set());
          const done = ran.get(key);
          if (done.has(f.ruleId)) continue;
          done.add(f.ruleId);
        }
        runMacro(f);
      }
    }
  };
}

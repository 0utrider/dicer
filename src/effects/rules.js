/**
 * Trigger rule engine: pure functions, no Foundry or DOM access.
 * A rule maps "a die showed this" to an effect, a sound and/or a macro.
 */

const OUTCOMES = ['any', 'critical-success', 'success', 'failure', 'critical-failure'];
const CONTEXT_KEYS = ['formula', 'role', 'damageType', 'actorId', 'userId'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

let autoId = 0;

/** Parse a `/pattern/flags` formula. Returns a RegExp, null (not regex form) or throws on a bad pattern. */
function parseRegex(text) {
  const m = /^\/(.+)\/([a-z]*)$/s.exec(text);
  return m ? new RegExp(m[1], m[2]) : null;
}

const regexCache = new Map();
function regexFor(text) {
  if (regexCache.has(text)) return regexCache.get(text);
  let re = null;
  try {
    re = parseRegex(text);
  } catch {
    re = null;
  }
  regexCache.set(text, re);
  return re;
}

class Reject extends Error {}
const reject = (msg) => {
  throw new Reject(msg);
};

function normalizeResult(raw, source) {
  if (raw === undefined || raw === null) return { kind: 'any' };
  if (!isObj(raw)) reject('result must be an object');
  const kind = raw.kind ?? 'any';
  if (kind === 'any' || kind === 'max' || kind === 'min') return { kind };
  if (kind === 'value') {
    if (!Number.isFinite(raw.value)) reject('result.value must be a finite number');
    return { kind, value: raw.value };
  }
  if (kind === 'range') {
    if (!Number.isFinite(raw.from) || !Number.isFinite(raw.to)) reject('result range must be finite');
    return { kind, from: Math.min(raw.from, raw.to), to: Math.max(raw.from, raw.to) };
  }
  if (kind === 'label' && source === 'module') {
    if (!isStr(raw.label)) reject('result.label must be a non-empty string');
    return { kind, label: raw.label };
  }
  return reject(`unknown result kind "${String(kind)}"`);
}

function normalizeContext(raw) {
  const out = {};
  if (raw === undefined || raw === null) return out;
  if (!isObj(raw)) reject('context must be an object');
  for (const k of CONTEXT_KEYS) {
    if (isStr(raw[k])) out[k] = raw[k];
  }
  if (out.formula) {
    try {
      parseRegex(out.formula);
    } catch {
      reject('invalid formula regex');
    }
  }
  return out;
}

/** Deep copy of JSON-safe data; functions, symbols, non-finite numbers and cycles/deep nesting become undefined. */
function jsonSafe(v, depth) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (depth > 8) return undefined;
  if (Array.isArray(v)) return v.map((x) => jsonSafe(x, depth + 1)).filter((x) => x !== undefined);
  if (isObj(v)) {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return undefined;
    const out = {};
    for (const k of Object.keys(v)) {
      if (k === '__proto__') continue;
      const x = jsonSafe(v[k], depth + 1);
      if (x !== undefined) out[k] = x;
    }
    return out;
  }
  return undefined;
}

function normalizeEffect(raw) {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw) || !isStr(raw.id)) return null;
  const out = {};
  for (const k of Object.keys(raw)) {
    if (k === '__proto__') continue;
    const v = jsonSafe(raw[k], 0);
    if (v !== undefined) out[k] = v;
  }
  delete out.color;
  delete out.intensity;
  delete out.duration;
  out.id = raw.id;
  if (isStr(raw.color)) out.color = raw.color;
  if (Number.isFinite(raw.intensity)) out.intensity = clamp(raw.intensity, 0, 2);
  if (Number.isFinite(raw.duration)) out.duration = clamp(raw.duration, 100, 5000);
  return out;
}

function normalizeSound(raw) {
  if (!isObj(raw)) return null;
  if (isStr(raw.builtin)) return { builtin: raw.builtin };
  if (isStr(raw.src)) {
    const out = { src: raw.src };
    if (Number.isFinite(raw.volume)) out.volume = clamp(raw.volume, 0, 1);
    return out;
  }
  return null;
}

/**
 * Validate and canonicalise a raw rule.
 * @returns {object|null} the rule, or null after exactly one warn() call.
 */
export function normalizeRule(raw, source, warn = console.warn) {
  try {
    if (!isObj(raw)) reject('rule is not an object');
    const effect = normalizeEffect(raw.effect);
    const sound = normalizeSound(raw.sound);
    const macro = isStr(raw.macro) ? raw.macro : null;
    if (!effect && !sound && !macro) reject('rule has no effect, sound or macro');
    const result = normalizeResult(raw.result, source);
    const context = normalizeContext(raw.context);
    const outcome = raw.outcome ?? 'any';
    if (!OUTCOMES.includes(outcome)) reject(`unknown outcome "${String(outcome)}"`);
    const id = isStr(raw.id) ? raw.id : `rule-${++autoId}`;
    return {
      id,
      name: isStr(raw.name) ? raw.name : id,
      enabled: raw.enabled !== false,
      source,
      die: isStr(raw.die) ? raw.die : 'any',
      result,
      context,
      outcome,
      effect,
      sound,
      macro,
    };
  } catch (err) {
    if (!(err instanceof Reject)) throw err;
    const id = isObj(raw) && raw.id !== undefined ? ` "${String(raw.id)}"` : '';
    warn(`Dicer: ignoring trigger rule${id}: ${err.message}`);
    return null;
  }
}

/** Normalize a list, dropping bad rules; one warning per rule id (or index when it has none). */
export function normalizeRules(list, source, warn = console.warn) {
  if (!Array.isArray(list)) return [];
  const warned = new Set();
  const dedupWarn = (index, raw) => (msg) => {
    const key = isObj(raw) && raw.id !== undefined ? `id:${String(raw.id)}` : `index:${index}`;
    if (warned.has(key)) return;
    warned.add(key);
    warn(msg);
  };
  const out = [];
  list.forEach((raw, i) => {
    const r = normalizeRule(raw, source, dedupWarn(i, raw));
    if (r) out.push(r);
  });
  return out;
}

function matchResult(result, die) {
  switch (result.kind) {
    case 'any':
      return true;
    case 'value':
      return die.value === result.value;
    case 'range':
      return die.value >= result.from && die.value <= result.to;
    case 'max':
      return die.value === die.faces;
    case 'min':
      return die.value === 1;
    case 'label':
      return typeof die.label === 'string' && die.label === result.label;
    default:
      return false;
  }
}

function matchFormula(text, formula) {
  if (typeof formula !== 'string') return false;
  const re = regexFor(text);
  if (re) {
    re.lastIndex = 0;
    return re.test(formula);
  }
  return formula.toLowerCase().includes(text.toLowerCase());
}

/** Does `rule` fire for this die? `die` is {type, dsnType, value, faces, label, formula, role, damageType, actorId, userId, outcome}. */
export function matchRule(rule, die) {
  if (rule.die !== 'any' && rule.die !== die.type && rule.die !== die.dsnType) return false;
  if (!matchResult(rule.result, die)) return false;
  if (rule.outcome !== 'any' && rule.outcome !== die.outcome) return false;
  const c = rule.context;
  if (c.formula && !matchFormula(c.formula, die.formula)) return false;
  for (const k of ['role', 'damageType', 'actorId', 'userId']) {
    if (c[k] && c[k] !== die[k]) return false;
  }
  return true;
}

export const DEFAULT_RULES = [
  normalizeRule(
    {
      id: 'dicer.nat20',
      name: 'Natural 20',
      die: 'd20',
      result: { kind: 'value', value: 20 },
      effect: { id: 'celebrate' },
      sound: { builtin: 'fanfare' },
    },
    'world',
    console.warn,
  ),
  normalizeRule(
    {
      id: 'dicer.nat1',
      name: 'Natural 1',
      die: 'd20',
      result: { kind: 'value', value: 1 },
      effect: { id: 'fumble' },
      sound: { builtin: 'fizzle' },
    },
    'world',
    console.warn,
  ),
];

const DSN_OUTCOMES = {
  critical: 'critical-success',
  success: 'success',
  failure: 'failure',
  fumble: 'critical-failure',
};

/**
 * Convert Dice So Nice `addSFXDefaults` style entries to module rules.
 * @param {Array<{diceType, onResult, specialEffect, options?}>} list
 * @param {Map<string,{results}>} triggers addSFXTrigger registrations, keyed by id
 */
export function dsnDefaultsToRules(list, triggers, warn = console.warn) {
  if (!Array.isArray(list)) return [];
  const warned = new Set();
  const out = [];
  list.forEach((entry, i) => {
    if (!isObj(entry) || !isStr(entry.diceType) || !isStr(entry.specialEffect) || !Array.isArray(entry.onResult)) {
      const key = `entry:${isObj(entry) && isStr(entry.diceType) ? entry.diceType : i}`;
      if (!warned.has(key)) {
        warned.add(key);
        warn(`Dicer: ignoring malformed Dice So Nice default at index ${i}`);
      }
      return;
    }
    const stored = triggers && typeof triggers.get === 'function' ? triggers.get(entry.diceType) : undefined;
    const labels = Array.isArray(stored?.results)
      ? stored.results.filter((r) => typeof r === 'string' || typeof r === 'number').map(String)
      : [];
    entry.onResult.forEach((on, j) => {
      const text = String(on);
      let result = { kind: 'any' };
      let outcome = 'any';
      if (text === 'max' || text === 'min') result = { kind: text };
      else if (DSN_OUTCOMES[text]) outcome = DSN_OUTCOMES[text];
      else if (text.trim() !== '' && Number.isFinite(Number(text))) result = { kind: 'value', value: Number(text) };
      else if (labels.includes(text)) result = { kind: 'label', label: text };
      else {
        if (!warned.has(text)) {
          warned.add(text);
          warn(`Dicer: ignoring unknown Dice So Nice onResult "${text}" for ${entry.diceType}`);
        }
        return;
      }
      const rule = normalizeRule(
        {
          id: `dsn:${entry.diceType}:${entry.specialEffect}:${j === 0 ? i : `${i}-${j}`}`,
          name: `${entry.specialEffect} (${entry.diceType})`,
          die: entry.diceType,
          result,
          outcome,
          effect: { ...(isObj(entry.options) ? entry.options : {}), id: `dsn:${entry.specialEffect}` },
        },
        'module',
        warn,
      );
      if (rule) out.push(rule);
    });
  });
  return out;
}

/** Enabled rules in firing order: world, then the roller's own, then module rules. */
export function effectiveRules({ world = [], roller = [], module = [] } = {}) {
  return [...world, ...roller, ...module].filter((r) => r.enabled);
}

/**
 * Roll context: outcome, role and per-die damage type, read defensively from PF2e 8.x, dnd5e 6.x
 * and generic Foundry rolls. Pure: no Foundry globals. Every property read is guarded because
 * system getters may throw on rolls that were not evaluated against a target.
 */

const MAX_DEPTH = 32;

const DND5E_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
];
const PF2E_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'electricity',
  'fire',
  'force',
  'mental',
  'piercing',
  'poison',
  'slashing',
  'sonic',
  'spirit',
  'vitality',
  'void',
  'bleed',
];

export const KNOWN_DAMAGE_TYPES = new Set([...DND5E_TYPES, ...PF2E_TYPES, 'healing']);

/** Read `obj[key]`, swallowing throwing getters. */
function get(obj, key) {
  if (obj === null || obj === undefined) return undefined;
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

const PF2E_DEGREE = ['critical-failure', 'failure', 'success', 'critical-success'];
const PF2E_OUTCOME = {
  criticalFailure: 'critical-failure',
  failure: 'failure',
  success: 'success',
  criticalSuccess: 'critical-success',
};

export function outcomeOf(roll, message) {
  const options = get(roll, 'options');
  const degree = get(options, 'degreeOfSuccess');
  if (Number.isInteger(degree) && degree >= 0 && degree <= 3) return PF2E_DEGREE[degree];

  const flagged = get(get(get(get(message, 'flags'), 'pf2e'), 'context'), 'outcome');
  if (typeof flagged === 'string' && Object.hasOwn(PF2E_OUTCOME, flagged)) return PF2E_OUTCOME[flagged];

  if (get(roll, 'isCritical') === true) return 'critical-success';
  if (get(roll, 'isFumble') === true) return 'critical-failure';
  if (get(roll, 'isSuccess') === true) return 'success';
  if (get(roll, 'isFailure') === true) return 'failure';
  if (get(options, 'isCritical') === true) return 'critical-success';
  return null;
}

const PF2E_ROLES = {
  'attack-roll': 'attack',
  'damage-roll': 'damage',
  'saving-throw': 'save',
  'skill-check': 'skill',
  'perception-check': 'perception',
  initiative: 'initiative',
  'flat-check': 'flat',
};

export function roleOf(message) {
  const flags = get(message, 'flags');
  const pf2e = get(get(get(flags, 'pf2e'), 'context'), 'type');
  if (typeof pf2e === 'string' && pf2e) return Object.hasOwn(PF2E_ROLES, pf2e) ? PF2E_ROLES[pf2e] : pf2e;
  const dnd5e = get(get(get(flags, 'dnd5e'), 'roll'), 'type');
  if (typeof dnd5e === 'string' && dnd5e) return dnd5e;
  return null;
}

function flavorType(flavor, known) {
  if (typeof flavor !== 'string') return null;
  for (const word of flavor.toLowerCase().split(/[,\s]+/)) if (known.has(word)) return word;
  return null;
}

/** The damage type this node itself names, or null. */
function ownType(node, known) {
  const terms = get(node, 'terms');
  const type = get(node, 'type');
  if (typeof type === 'string' && type !== 'untyped' && type && Array.isArray(terms)) return type;

  const options = get(node, 'options');
  const optType = get(options, 'type');
  if (typeof optType === 'string' && known.has(optType)) return optType;
  const optTypes = get(options, 'types');
  if (Array.isArray(optTypes) && optTypes.length === 1 && known.has(optTypes[0])) return optTypes[0];

  return flavorType(get(node, 'flavor'), known) ?? flavorType(get(options, 'flavor'), known);
}

const isDie = (node) => typeof get(node, 'faces') === 'number' || Array.isArray(get(node, 'results'));

function childrenOf(node) {
  const out = [];
  for (const key of ['terms', 'rolls', 'operands']) {
    const list = get(node, key);
    if (Array.isArray(list)) out.push(...list);
  }
  for (const key of ['roll', 'term']) {
    const child = get(node, key);
    if (child && typeof child === 'object') out.push(child);
  }
  return out;
}

/**
 * Map each dice term of `roll` to the damage type named by its nearest ancestor (or by the term
 * itself). Terms with no named type are absent from the map.
 */
export function damageTypesByTerm(roll, knownTypes = KNOWN_DAMAGE_TYPES) {
  const map = new WeakMap();
  const seen = new Set();
  const known = knownTypes instanceof Set ? knownTypes : new Set(knownTypes ?? []);

  const walk = (node, inherited, depth) => {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH || seen.has(node)) return;
    seen.add(node);
    const type = ownType(node, known) ?? inherited;
    if (type && isDie(node)) map.set(node, type);
    for (const child of childrenOf(node)) walk(child, type, depth + 1);
  };
  walk(roll, null, 0);
  return map;
}

/**
 * Pure form <-> rule helpers of the trigger editor (no Foundry, no DOM). A form is
 * `{ rules: Entry[] }` where an Entry is a flat object of strings / booleans / numbers (what an
 * HTML form submits); `rulesFromForm` runs every entry through `normalizeRule`.
 */
import { normalizeRule } from '../effects/rules.js';

const silent = () => {};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (v === undefined || v === null ? '' : String(v));
const bool = (v) => v === true || v === 'true' || v === 'on' || v === 1;

/** A fresh, empty entry for a new rule. */
export function blankEntry(id, source = 'user') {
  return {
    id,
    name: '',
    enabled: true,
    source,
    die: 'any',
    resultKind: 'any',
    resultValue: '',
    resultFrom: '',
    resultTo: '',
    resultLabel: '',
    formula: '',
    role: '',
    damageType: '',
    actorId: '',
    userId: '',
    outcome: 'any',
    effectId: '',
    effectColor: '',
    effectIntensity: '',
    effectDuration: '',
    effectExtra: '',
    soundKind: 'none',
    soundBuiltin: '',
    soundSrc: '',
    soundVolume: '',
    macro: '',
    momentKind: '',
    momentColour: '',
    rawJson: '',
  };
}

/** One normalized rule as a flat form entry. */
export function entryFromRule(rule) {
  const e = blankEntry(rule.id, rule.source);
  e.name = rule.name ?? '';
  e.enabled = rule.enabled !== false;
  e.die = rule.die ?? 'any';
  const r = rule.result ?? { kind: 'any' };
  e.resultKind = r.kind;
  if (r.kind === 'value') e.resultValue = r.value;
  if (r.kind === 'range') {
    e.resultFrom = r.from;
    e.resultTo = r.to;
  }
  if (r.kind === 'label') e.resultLabel = r.label;
  const c = rule.context ?? {};
  for (const k of ['formula', 'role', 'damageType', 'actorId', 'userId']) e[k] = c[k] ?? '';
  e.outcome = rule.outcome ?? 'any';
  if (rule.effect) {
    const { id, color, intensity, duration, ...extra } = rule.effect;
    e.effectId = id;
    e.effectColor = color ?? '';
    e.effectIntensity = intensity ?? '';
    e.effectDuration = duration ?? '';
    e.effectExtra = Object.keys(extra).length ? JSON.stringify(extra) : '';
  }
  if (rule.sound?.builtin !== undefined) {
    e.soundKind = 'builtin';
    e.soundBuiltin = rule.sound.builtin;
  } else if (rule.sound?.src !== undefined) {
    e.soundKind = 'file';
    e.soundSrc = rule.sound.src;
    e.soundVolume = rule.sound.volume ?? '';
  }
  e.macro = rule.macro ?? '';
  e.momentKind = rule.moment?.kind ?? '';
  e.momentColour = rule.moment?.colour ?? '';
  return e;
}

/** A stored rule that cannot be normalized, kept verbatim (source 'raw') so a save never drops it. */
export function rawEntry(raw, index) {
  const e = blankEntry(typeof raw?.id === 'string' && raw.id ? raw.id : `unreadable-${index}`, 'raw');
  e.name = typeof raw?.name === 'string' ? raw.name : '';
  let json = 'null';
  try {
    json = JSON.stringify(raw) ?? 'null';
  } catch {
    /* not JSON: kept as null */
  }
  e.rawJson = json;
  return e;
}

/**
 * Stored rules as form entries; any that fail normalization become raw entries.
 * @returns {{entries: object[], unreadable: number}}
 */
export function loadEntries(stored, source) {
  if (!Array.isArray(stored)) return { entries: [], unreadable: stored === undefined || stored === null ? 0 : 1 };
  let unreadable = 0;
  const entries = stored.map((raw, i) => {
    const rule = normalizeRule(raw, source, silent);
    if (rule) return entryFromRule(rule);
    unreadable += 1;
    return rawEntry(raw, i);
  });
  return { entries, unreadable };
}

/** @param {object[]} rules normalized rules @returns {{rules: object[]}} */
export function formFromRules(rules) {
  return { rules: (Array.isArray(rules) ? rules : []).map(entryFromRule) };
}

/** The entries of a form: an array, or an index-keyed object as a submitted form expands to. */
export function entriesOf(formData) {
  const list = formData?.rules;
  if (Array.isArray(list)) return list.filter(isObj);
  if (isObj(list)) {
    return Object.keys(list)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => list[k])
      .filter(isObj);
  }
  return [];
}

const num = (v) => {
  const s = str(v).trim();
  return s === '' ? NaN : Number(s);
};
const optNum = (v) => {
  const n = num(v);
  return Number.isFinite(n) ? n : undefined;
};

/** The raw (not yet normalized) rule an entry describes. */
export function rawRuleFromEntry(e) {
  const kind = str(e.resultKind) || 'any';
  const result = { kind };
  if (kind === 'value') result.value = num(e.resultValue);
  if (kind === 'range') {
    result.from = num(e.resultFrom);
    result.to = num(e.resultTo);
  }
  if (kind === 'label') result.label = str(e.resultLabel);

  const context = {};
  for (const k of ['formula', 'role', 'damageType', 'actorId', 'userId']) {
    const v = str(e[k]).trim();
    if (v) context[k] = v;
  }

  let effect = null;
  const effectId = str(e.effectId).trim();
  if (effectId) {
    let extra = {};
    const json = str(e.effectExtra).trim();
    if (json) {
      try {
        const parsed = JSON.parse(json);
        if (isObj(parsed)) extra = parsed;
      } catch {
        /* a mangled hidden field: the extras are dropped */
      }
    }
    effect = { ...extra, id: effectId };
    const color = str(e.effectColor).trim();
    if (color) effect.color = color;
    const intensity = optNum(e.effectIntensity);
    if (intensity !== undefined) effect.intensity = intensity;
    const duration = optNum(e.effectDuration);
    if (duration !== undefined) effect.duration = duration;
  }

  let sound = null;
  if (e.soundKind === 'builtin') {
    const builtin = str(e.soundBuiltin).trim();
    if (builtin) sound = { builtin };
  } else if (e.soundKind === 'file') {
    const src = str(e.soundSrc).trim();
    if (src) {
      sound = { src };
      const volume = optNum(e.soundVolume);
      if (volume !== undefined) sound.volume = volume;
    }
  }

  const macro = str(e.macro).trim();
  const momentKind = str(e.momentKind).trim();
  const momentColour = str(e.momentColour).trim();
  return {
    id: str(e.id) || undefined,
    name: str(e.name).trim() || undefined,
    enabled: bool(e.enabled),
    die: str(e.die).trim() || 'any',
    result,
    context,
    outcome: str(e.outcome) || 'any',
    effect,
    sound,
    macro: macro || null,
    ...(momentKind && { moment: { kind: momentKind, ...(momentColour && { colour: momentColour }) } }),
  };
}

/**
 * Validate a whole form. Module-source entries are looked up by id in `moduleRules` and only
 * their `enabled` is taken from the form. Invalid rules are left out and reported.
 * @param {object} formData
 * @param {{source?: 'world'|'user', moduleRules?: object[]}} [opts] source of the editable entries
 * @returns {{rules: object[], errors: {index: number, id: string, message: string}[]}}
 */
export function validateForm(formData, { source = 'world', moduleRules = [] } = {}) {
  const rules = [];
  const errors = [];
  const kept = [];
  entriesOf(formData).forEach((entry, index) => {
    if (entry.source === 'raw') {
      try {
        kept.push(JSON.parse(str(entry.rawJson)));
      } catch {
        /* unparseable: nothing to keep */
      }
      return;
    }
    if (entry.source === 'module') {
      const base = moduleRules.find((r) => r.id === entry.id);
      if (base) rules.push({ ...base, enabled: bool(entry.enabled) });
      return;
    }
    const raw = rawRuleFromEntry(entry);
    let message = null;
    const rule = normalizeRule(raw, source, (m) => (message = String(m).replace(/^Dicer: ignoring trigger rule[^:]*: /, '')));
    if (rule) rules.push(rule);
    else errors.push({ index, id: str(entry.id), message: message ?? 'invalid rule' });
  });
  return { rules, errors, kept };
}

/** The valid rules of a form (see validateForm for the errors). */
export function rulesFromForm(formData, opts) {
  return validateForm(formData, opts).rules;
}

/**
 * Save one tab. The World tab needs a GM (a player's save is refused); nothing is saved when
 * any rule is invalid. Writes normalized plain data: the fx resolver caches by value.
 * @param {'world'|'mine'} tab
 * @param {object} formData
 * @param {{isGM: boolean, moduleRules?: object[], setWorld: Function, setDisabled: Function, setMine: Function}} deps
 */
export async function saveTab(tab, formData, { isGM, moduleRules = [], setWorld, setDisabled, setMine }) {
  if (tab === 'world') {
    if (!isGM) return { ok: false, reason: 'not-gm', errors: [] };
    const { rules, errors, kept } = validateForm(formData, { source: 'world', moduleRules });
    if (errors.length) return { ok: false, reason: 'invalid', errors };
    const world = rules.filter((r) => r.source !== 'module');
    const disabled = rules.filter((r) => r.source === 'module' && !r.enabled).map((r) => r.id);
    await setWorld(structuredClone([...world, ...kept]));
    await setDisabled(disabled);
    return { ok: true, errors: [] };
  }
  const { rules, errors, kept } = validateForm(formData, { source: 'user' });
  if (errors.length) return { ok: false, reason: 'invalid', errors };
  await setMine(structuredClone([...rules, ...kept]));
  return { ok: true, errors: [] };
}

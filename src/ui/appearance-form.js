/**
 * Pure helpers of the appearance editor (no Foundry, no DOM): the layer stack's form <-> appearance
 * conversion, which sections show for a look, the look file / clipboard format, where a save goes
 * (and who may write there) and the debounced preview scheduler.
 *
 * The editor keeps the form, not the normalized appearance, as its state: normalizeAppearance
 * forces the inside to 'none' on a non-resin body, and switching resin -> metal -> resin must not
 * lose the nebula the user built.
 */
import { normalizeAppearance, EDGE_STEPS } from '../look/appearance.js';
import { DIE_TYPES } from '../themes/themes.js';
import { upsertTheme, userThemeId, worldThemeId, mergeEdited } from './theme-form.js';

export const BODY_TYPES = ['opaque', 'resin', 'metal', 'marble', 'pearl'];
export const FINISHES = ['polished', 'brushed', 'antique'];
export const INTERIOR_TYPES = ['none', 'liquid', 'glitter', 'swirl', 'nebula', 'shape'];
export const SHAPES = ['star', 'heart', 'skull', 'sphere'];
export const FILLS = ['paint', 'gold', 'silver', 'enamel'];
export const FONT_KINDS = ['serif', 'sans', 'css', 'file'];
export { EDGE_STEPS };
/** Fonts most computers have, offered as suggestions for "a font on this computer". */
export const FONT_SUGGESTIONS = ['Georgia', 'Impact', 'Palatino Linotype', 'Trebuchet MS', 'Verdana', 'Courier New', 'Times New Roman'];
export const LOOK_KIND = 'dicer-look';
/** Body types with a second colour (marble veins, pearl sheen, resin tint). */
const TWO_TONE = ['marble', 'pearl', 'resin'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const plain = (v) => JSON.parse(JSON.stringify(v));

function fontParts(font) {
  if (font === 'sans' || font === 'serif') return { fontKind: font, fontFamily: '', fontFile: '' };
  if (typeof font === 'string' && font.startsWith('css:')) return { fontKind: 'css', fontFamily: font.slice(4), fontFile: '' };
  if (typeof font === 'string' && font.startsWith('file:')) return { fontKind: 'file', fontFamily: '', fontFile: font.slice(5) };
  return { fontKind: 'serif', fontFamily: '', fontFile: '' };
}

/** The font id a form names ('serif' | 'sans' | 'css:<family>' | 'file:<path>'), not yet validated. */
export function fontIdOf(numbers = {}) {
  const kind = numbers.fontKind;
  if (kind === 'sans') return 'sans';
  if (kind === 'css') return `css:${String(numbers.fontFamily ?? '').trim()}`;
  if (kind === 'file') return `file:${String(numbers.fontFile ?? '').trim()}`;
  return 'serif';
}

/** A look (any shape: normalized on the way in) as the editor's form. */
export function formFromAppearance(raw) {
  const a = normalizeAppearance(raw);
  // The stored inside survives a non-resin body (normalizeAppearance hides it): read it raw.
  const rawInside = isObj(raw) && isObj(raw.interior) ? normalizeAppearance({ body: { type: 'resin' }, interior: raw.interior }).interior : a.interior;
  const inside = a.body.type === 'resin' ? a.interior : rawInside;
  return {
    body: { ...a.body },
    interior: { type: inside.type, color1: inside.colors[0], color2: inside.colors[1], density: inside.density, shape: inside.shape },
    numbers: { fill: a.numbers.fill, color: a.numbers.color, depth: a.numbers.depth, ...fontParts(a.numbers.font) },
    edges: { radius: a.edges.radius },
    glow: { ...a.glow },
  };
}

const n = (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);

/** The form as a normalized appearance (form values may be strings, as inputs give them). */
export function appearanceFromForm(form) {
  const f = isObj(form) ? form : {};
  const b = isObj(f.body) ? f.body : {};
  const i = isObj(f.interior) ? f.interior : {};
  const num = isObj(f.numbers) ? f.numbers : {};
  const e = isObj(f.edges) ? f.edges : {};
  const g = isObj(f.glow) ? f.glow : {};
  return normalizeAppearance({
    body: { type: b.type, color: b.color, color2: b.color2, finish: b.finish, roughness: n(b.roughness) },
    interior: { type: i.type, colors: [i.color1, i.color2], density: n(i.density), shape: i.shape },
    numbers: { fill: num.fill, color: num.color, depth: n(num.depth), font: fontIdOf(num) },
    edges: { radius: n(e.radius) },
    glow: { color: g.color, intensity: n(g.intensity) },
  });
}

/** True when the form names a computer font / font file that is not a usable id (it would fall back to the serif). */
export function fontInvalid(form) {
  const id = fontIdOf(form?.numbers);
  if (id === 'serif' || id === 'sans') return false;
  return appearanceFromForm(form).numbers.font !== id;
}

/** Which parts of the layer stack show for this look (an appearance or an editor form). */
export function visibleSections(look) {
  const body = look?.body?.type;
  const inside = look?.interior?.type;
  const fill = look?.numbers?.fill;
  const kind = look?.numbers?.fontKind ?? fontParts(look?.numbers?.font).fontKind;
  const resin = body === 'resin';
  return {
    inside: resin,
    insideDetails: resin && inside !== 'none' && INTERIOR_TYPES.includes(inside),
    insideShape: resin && inside === 'shape',
    color2: TWO_TONE.includes(body),
    finish: body === 'metal',
    numberColor: fill === 'paint' || fill === 'enamel',
    fontFamily: kind === 'css',
    fontFile: kind === 'file',
  };
}

/** Sets one dotted path ('body.color') of a form copy; numeric fields become numbers. */
export function setField(form, path, value) {
  const out = plain(form);
  const parts = String(path).split('.');
  const NUMERIC = ['roughness', 'density', 'depth', 'radius', 'intensity'];
  let o = out;
  for (const p of parts.slice(0, -1)) {
    if (!isObj(o[p])) o[p] = {};
    o = o[p];
  }
  const key = parts.at(-1);
  o[key] = NUMERIC.includes(key) && value !== '' && value !== null ? Number(value) : value;
  return out;
}

// --- per die type ------------------------------------------------------------------------------
/** The forms map with an override for `type` (a copy of the default when it has none). */
export function addOverride(forms, type) {
  if (!DIE_TYPES.includes(type) || forms[type]) return forms;
  return { ...forms, [type]: plain(forms.default) };
}
/** The forms map without the override for `type` ("Same as default"). */
export function removeOverride(forms, type) {
  if (type === 'default' || !forms[type]) return forms;
  const { [type]: _gone, ...rest } = forms;
  return rest;
}
/** forms -> { appearance, perType } of a theme. */
export function looksFromForms(forms) {
  const perType = {};
  for (const t of DIE_TYPES) if (forms[t]) perType[t] = appearanceFromForm(forms[t]);
  return { appearance: appearanceFromForm(forms.default), perType };
}
/** A theme's looks as the editor's forms map. */
export function formsFromTheme(theme) {
  const forms = { default: formFromAppearance(theme?.appearance) };
  for (const t of DIE_TYPES) if (isObj(theme?.perType?.[t])) forms[t] = formFromAppearance(theme.perType[t]);
  return forms;
}

// --- look file / clipboard ---------------------------------------------------------------------
/** One appearance as the look file's (and the clipboard's) JSON text. */
export function exportLook(appearance) {
  return JSON.stringify({ kind: LOOK_KIND, version: 1, appearance: normalizeAppearance(appearance) }, null, 2);
}

const LAYERS = ['body', 'interior', 'numbers', 'edges', 'glow'];
const looksLikeAppearance = (o) => isObj(o) && (typeof o.body === 'string' || LAYERS.some((k) => isObj(o[k])));

/**
 * A look from JSON text: a look file, a theme (its default look) or a bare appearance. Anything
 * else is rejected: { error } instead of { appearance }.
 */
export function parseLook(text) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return { error: 'json' };
  }
  const candidate = isObj(data) && isObj(data.appearance) ? data.appearance : data;
  if (!looksLikeAppearance(candidate)) return { error: 'shape' };
  return { appearance: normalizeAppearance(candidate) };
}

// --- saving ------------------------------------------------------------------------------------
const storedIds = (list) => list.map((t) => (isObj(t) ? t.id : undefined)).filter(Boolean);

/**
 * Where a save goes. mode 'mine' = a new theme in My themes, 'world' = a new world theme (GM only),
 * 'update' = the edited theme in place (own user theme, or a world theme for the GM). Lists of the
 * wrong shape (null) are never written. Unreadable entries are kept (upsert by id).
 * @returns {{ok: true, scope: 'user'|'world', id: string, list: object[]} | {ok: false, reason: string}}
 */
export function planSave({ mode, theme, originalId = null, isGM = false, userId, userList, worldList }) {
  const name = String(theme?.name ?? '').trim();
  if (!name) return { ok: false, reason: 'name' };
  const raw = { ...plain(theme), name };
  delete raw.source;
  if (mode === 'mine') {
    if (!Array.isArray(userList)) return { ok: false, reason: 'unreadable' };
    const id = userThemeId(userId, name, storedIds(userList));
    return { ok: true, scope: 'user', id, list: upsertTheme(userList, { ...raw, id }) };
  }
  if (mode === 'world') {
    if (!isGM) return { ok: false, reason: 'gm-only' };
    if (!Array.isArray(worldList)) return { ok: false, reason: 'unreadable' };
    const id = worldThemeId(name, storedIds(worldList));
    return { ok: true, scope: 'world', id, list: upsertTheme(worldList, { ...raw, id }) };
  }
  if (mode === 'update' && typeof originalId === 'string') {
    const world = originalId.startsWith('world.');
    const mine = originalId.startsWith(`user.${userId}.`);
    if (world && !isGM) return { ok: false, reason: 'gm-only' };
    if (!world && !mine) return { ok: false, reason: 'not-yours' };
    const list = world ? worldList : userList;
    if (!Array.isArray(list)) return { ok: false, reason: 'unreadable' };
    const stored = list.find((t) => isObj(t) && t.id === originalId);
    return { ok: true, scope: world ? 'world' : 'user', id: originalId, list: upsertTheme(list, mergeEdited(stored, { ...raw, id: originalId })) };
  }
  return { ok: false, reason: 'mode' };
}

/** Whether the user may update a theme of this id in place. */
export function canUpdate(themeId, { isGM = false, userId } = {}) {
  if (typeof themeId !== 'string') return false;
  if (themeId.startsWith('world.')) return isGM;
  return themeId.startsWith(`user.${userId}.`);
}

// --- preview scheduling ------------------------------------------------------------------------
/**
 * Debounces preview renders: the latest value is rendered `delay` ms after the last change, one
 * render is in flight at a time, and a change during a render queues exactly one more with the
 * latest value (latest wins).
 */
export function createPreviewScheduler(render, { delay = 80, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null;
  let latest;
  let dirty = false;
  let inflight = false;
  let closed = false;

  async function run() {
    if (closed || !dirty) return;
    if (inflight) return; // the running render picks the latest value up when it ends
    inflight = true;
    dirty = false;
    try {
      await render(latest);
    } catch {
      /* a failed preview frame never blocks the next */
    } finally {
      inflight = false;
      if (dirty && !timer) run();
    }
  }

  return {
    schedule(value) {
      if (closed) return;
      latest = value;
      dirty = true;
      if (timer) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        run();
      }, delay);
    },
    /** Renders the pending value now (no wait). */
    flush() {
      if (timer) clearTimer(timer);
      timer = null;
      return run();
    },
    cancel() {
      closed = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
    get pending() {
      return dirty;
    },
  };
}

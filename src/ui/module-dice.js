/**
 * Module dice sets in the theme browser (pure; no Foundry, no DOM): the colorsets and dice systems
 * other modules registered through the Dice So Nice API as gallery entries, the look flag patch
 * that uses one, and the user theme an import makes of one. Registry data is third-party: odd
 * entries are skipped, nothing here throws on them.
 */
import { LOOKS } from '../look/looks.js';
import { appearanceKey } from '../look/appearance.js';
import { BUILTIN_COLORSETS } from '../compat/colorset-map.js';
import { colorsetNameToAppearance, isNeverChose } from '../compat/user-looks.js';

export const COLORSET_PREFIX = 'dsn-colorset:';
export const SYSTEM_PREFIX = 'dsn-system:';
const STANDARD = 'standard';
// DSN's stock and damage palette: Dicer maps these itself, so they are not listed as module sets.
const BUILTIN_NAMES = new Set(Object.keys(BUILTIN_COLORSETS)); // lower case, as findColorset matches any case
// Textures the colorset mapping turns into a body (colorset-map.js textureBody); others are dropped.
const MAPPED_TEXTURE = /marble|stone|metal|bronze/i;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const str = (v) => (isStr(v) ? v : '');
const plain = (v) => JSON.parse(JSON.stringify(v));
const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * The registry as the lazy browser can reach it: game.dice3d's public DSN members
 * (`exports.COLORSETS`, `DiceFactory.systems`), so world start needs no new hook.
 */
export function registryView(api) {
  let colorsets = new Map();
  let systems = new Map();
  let textures = new Map();
  try {
    const t = api?.exports?.TEXTURELIST;
    if (t && typeof t === 'object') textures = new Map(Object.entries(t));
  } catch {
    /* no textures: texture art is not drawn */
  }
  try {
    const cs = api?.exports?.COLORSETS;
    if (cs && typeof cs === 'object') colorsets = new Map(Object.entries(cs));
  } catch {
    /* no colorsets */
  }
  try {
    const s = api?.DiceFactory?.systems;
    if (s instanceof Map) systems = s;
  } catch {
    /* no systems */
  }
  return { colorsets, systems, textures };
}

const textureId = (t) => (isStr(t) ? t : isObj(t) ? str(t.id) || str(t.name) : '');

function colorsetEntry(name, cs, registry) {
  const appearance = colorsetNameToAppearance(name, registry);
  if (!appearance) return null;
  const dropped = [];
  const tex = textureId(cs.texture);
  // A texture image becomes the body image and the font a page font: only what did not map is dropped.
  if (tex && tex !== 'none' && !MAPPED_TEXTURE.test(tex) && !appearance.bodyImage) dropped.push({ kind: 'texture', types: [] });
  if (isStr(cs.font) && !appearance.numbers.font.startsWith('css:')) dropped.push({ kind: 'font', types: [] });
  return { id: COLORSET_PREFIX + name, kind: 'colorset', key: name, name: str(cs.description) || name, category: str(cs.category), appearance, perType: {}, dropped };
}

const FATE = [['-', '−', '–'], ['', ' '], ['+']];
/** Face i's label is what Dicer draws there anyway: its number, a d100's tens (00 or 100 last), a Fate - blank +. */
function plainLabel(type, label, i, min) {
  const t = String(label ?? '').trim();
  if (t === String(min + i) || (type === 'd10' && min + i === 10 && t === '0')) return true;
  if (type === 'd100') return t === String((i + 1) * 10) || (i === 9 && (t === '00' || t === '0'));
  if (type === 'df') return FATE[i]?.includes(t) ?? false;
  return false;
}

/**
 * A preset whose labels are not the plain numbers Dicer draws anyway (images, symbols, words).
 * Bump and emissive maps are only relief and glow on those faces: Dicer leaves them out and keeps
 * the faces.
 */
function hasCustomFaces(type, preset) {
  const labels = Array.isArray(preset.labels) ? preset.labels : [];
  const min = Number.isFinite(preset.values?.min) ? preset.values.min : 1;
  return labels.some((l, i) => !plainLabel(type, l, i, min));
}

// Die types whose face images a theme holds (appearance.js faceImages), and what counts as one.
const IMAGE_TYPES = ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20', 'dc', 'df', 'd100'];
// A Dice So Nice atlas face: its sheet plus the frame's rectangle (registry.js atlasFrames).
const IMAGE = /^(?:https?:\/\/[^<>"#]+|[^:<>"#]+)\.(?:png|jpe?g|webp|svg|gif|avif)(?:\?[^<>"#]*)?(?:#xywh=\d{1,5},\d{1,5},\d{1,5},\d{1,5})?$/i;
/**
 * A theme's faces key for label i of a preset (compat/faces.js VARIANT_FACES): a coin's labels go
 * tails then heads (0, 1), a Fate die's -, blank, + (-1, 0, 1), a d100's 10 ... 00 (10 ... 100);
 * any other die's value, from the preset's lowest.
 */
const faceKey = (type, i, min) => (type === 'dc' ? (i ? 1 : 0) : type === 'df' ? i - 1 : type === 'd100' ? (i + 1) * 10 : min + i);
/**
 * A preset's faces as a theme's face images ({faces key: path}), when every custom face is an
 * image and the others are plain numbers (kept as numbers); else null (words or symbols: a theme
 * cannot hold them).
 */
function faceImagesOf(type, preset) {
  if (!IMAGE_TYPES.includes(type)) return null;
  const labels = Array.isArray(preset.labels) ? preset.labels : [];
  const min = Number.isFinite(preset.values?.min) ? preset.values.min : 1;
  const map = {};
  for (const [i, l] of labels.entries()) {
    if (plainLabel(type, l, i, min)) continue;
    const key = faceKey(type, i, min);
    if (typeof l !== 'string' || l.length >= 400 || !IMAGE.test(l) || !(key > -1000 && key < 1000)) return null;
    map[key] = l;
  }
  return Object.keys(map).length ? map : null;
}

function systemEntry(id, sys, registry) {
  const looks = new Map();
  const faces = []; // custom faces a theme cannot hold
  const faceImages = {}; // image faces it can (die type -> {value: path})
  const facePresets = {}; // die type -> preset with custom faces: the thumbnails draw them
  const models = [];
  const modelFiles = {}; // die type -> model url: the thumbnails draw the models
  const fonts = [];
  for (const [type, preset] of sys.dice) {
    if (!isStr(type) || !isObj(preset)) continue;
    const cs = Array.isArray(preset.colorset) ? preset.colorset[0] : preset.colorset;
    const look = colorsetNameToAppearance(cs, registry);
    if (look) looks.set(type, look);
    if (hasCustomFaces(type, preset)) {
      facePresets[type] = preset;
      const images = faceImagesOf(type, preset);
      if (images) faceImages[type] = images;
      else faces.push(type);
    }
    if (isStr(preset.modelFile)) {
      models.push(type);
      modelFiles[type] = isStr(preset.modelUrl) ? preset.modelUrl : preset.modelFile;
    }
    if (isStr(preset.font)) fonts.push(type);
  }
  const appearance = looks.get('d20') ?? looks.values().next().value ?? LOOKS.default.appearance;
  const baseKey = appearanceKey(appearance);
  const perType = {};
  for (const [type, look] of looks) if (appearanceKey(look) !== baseKey) perType[type] = look;
  const dropped = [
    ['faces', faces],
    ['models', models],
    ['font', fonts],
  ]
    .filter(([, types]) => types.length)
    .map(([kind, types]) => ({ kind, types }));
  return {
    id: SYSTEM_PREFIX + id,
    kind: 'system',
    key: id,
    name: str(sys.name) || id,
    category: str(sys.group),
    appearance,
    perType,
    dropped,
    ...(models.length ? { models: modelFiles } : {}),
    ...(Object.keys(faceImages).length ? { faceImages } : {}),
    ...(Object.keys(facePresets).length ? { facePresets } : {}),
    // all its look is in its models: an import takes its colours from them (themes/model-colours.js)
    ...(models.length && !looks.size ? { colourless: true } : {}),
  };
}

/**
 * Gallery entries for the registered module dice: colorsets (not hidden ones, not names of Dicer's
 * built-in palette), then systems that have presets (not `standard`), each sorted by name.
 * @param {{colorsets?: Map<string, object>, systems?: Map<string, object>}} registry
 */
export function moduleDiceEntries(registry) {
  const colorsets = [];
  const systems = [];
  try {
    for (const [name, cs] of registry?.colorsets ?? []) {
      if (!isStr(name) || !isObj(cs) || cs.visibility === 'hidden' || BUILTIN_NAMES.has(name.toLowerCase())) continue;
      const entry = colorsetEntry(name, cs, registry);
      if (entry) colorsets.push(entry);
    }
  } catch {
    /* a broken colorset map lists none */
  }
  try {
    for (const [id, sys] of registry?.systems ?? []) {
      if (!isStr(id) || id === STANDARD || !isObj(sys) || !(sys.dice instanceof Map) || !sys.dice.size) continue;
      systems.push(systemEntry(id, sys, registry));
    }
  } catch {
    /* a broken systems map lists none */
  }
  return [...colorsets.sort(byName), ...systems.sort(byName)].map((e) => ({ ...e, source: 'module' }));
}

const NAMED = ['theme', 'look', 'colorset', 'appearance'];

/**
 * The look flag patch that makes the entry this user's default. A colorset replaces the slot's
 * look (and leaves its system); a system is merged in, keeping the slot's look for dice whose
 * preset names no colorset (`fallbackTheme`, the client theme setting, when the slot names none).
 */
export function useModulePatch(entry, current, fallbackTheme = 'default') {
  if (entry?.kind === 'colorset') return { global: { colorset: entry.key, appearance: null, theme: null, look: null, chosen: true } };
  const ref = { system: entry.key, chosen: true };
  const names = isObj(current) && !isNeverChose(current) && NAMED.some((k) => current[k] !== undefined && current[k] !== null);
  if (!names) ref.theme = isStr(fallbackTheme) ? fallbackTheme : 'default';
  return { global: ref };
}

/** The patch "Stop using" writes for the current module system. */
export const stopSystemPatch = () => ({ global: { system: null } });

/**
 * The entry id the stored global slot makes "Your default" among the module entries, if any:
 * `{colorset, system}` (either may be null). A never-chose slot or an inline appearance names none.
 */
export function currentModuleIds(global, entries) {
  const out = { colorset: null, system: null };
  if (!isObj(global) || isNeverChose(global)) return out;
  const has = (id) => entries.some((e) => e.id === id);
  if (isStr(global.colorset) && !isObj(global.appearance) && has(COLORSET_PREFIX + global.colorset)) out.colorset = COLORSET_PREFIX + global.colorset;
  if (isStr(global.system) && has(SYSTEM_PREFIX + global.system)) out.system = SYSTEM_PREFIX + global.system;
  return out;
}

/**
 * A raw user theme from a module entry (ready for My themes, under `id`: theme-form's userThemeId)
 * and what a theme cannot hold (`dropped`: faces, models, texture, font, with die types where a
 * system has them).
 */
export function moduleThemeRaw(entry, id) {
  // The set's image faces ride along: on the look and on every per-type look (each is whole).
  const withFaces = (look) => (entry.faceImages ? { ...plain(look), faces: plain(entry.faceImages) } : plain(look));
  const raw = { id, name: entry.name, appearance: withFaces(entry.appearance) };
  if (Object.keys(entry.perType ?? {}).length)
    raw.perType = Object.fromEntries(Object.entries(entry.perType).map(([t, look]) => [t, withFaces(look)]));
  return { raw, dropped: entry.dropped ?? [] };
}

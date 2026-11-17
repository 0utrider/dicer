/**
 * Dice trays (pure: no Foundry, no DOM). A tray is a roll area with a look: every roll this screen
 * shows lands in it, whoever rolled (each screen runs its own physics, so each player may have
 * their own tray, in their own place). The look is a surface, a rim and its corners; the place is
 * a rectangle in fractions of the stage, as a custom roll area is.
 *
 * Settings: the world `tableTray` (the GM's table look, or null: no table tray), the client
 * `trayMode` ('table' | 'mine' | 'none'), `myTray` (the player's own look), `trayRect` (where it
 * sits) and `trayShow` ('always' | 'rolls': slides in while dice are on screen).
 */

export const TRAY_SURFACES = ['felt', 'wood', 'stone', 'leather', 'metal', 'image'];
export const TRAY_RIMS = ['plain', 'wood', 'leather', 'stone', 'metal'];
/** The tray's outline: a rectangle (its corners rounded by `radius`), an oval, a hexagon, an octagon. */
export const TRAY_SHAPES = ['rect', 'round', 'hex', 'octagon'];
/**
 * How far in (fractions of the floor, each side) dice keep in each shape: the largest rectangle
 * inside it, so a die never lands on the rim. The hexagon has its points left and right.
 */
export const SHAPE_INSET = Object.freeze({
  rect: Object.freeze({ x: 0, y: 0 }),
  round: Object.freeze({ x: 0.147, y: 0.147 }),
  hex: Object.freeze({ x: 0.18, y: 0.14 }),
  octagon: Object.freeze({ x: 0.125, y: 0.125 }),
});
/** Built-in floor designs (assets/trays/<id>.svg), drawn in the design colour; or any picture. */
export const TRAY_DESIGNS = ['sigil', 'moon', 'compass', 'skull'];
export const TRAY_MODES = ['table', 'mine', 'none'];
export const TRAY_SHOW = ['always', 'rolls'];
/** The table sound of each surface (synth.js SURFACES). */
const SURFACE_SOUND = {
  felt: 'felt',
  wood: 'wood',
  stone: 'stone',
  leather: 'felt',
  metal: 'metal',
  image: 'felt',
};

export const DEFAULT_TRAY = Object.freeze({
  surface: 'felt',
  shape: 'rect',
  color: '#1f4d36',
  image: '',
  rim: Object.freeze({ style: 'wood', color: '#4a2f1b', width: 16 }),
  radius: 10,
  design: Object.freeze({ src: '', color: '#d8b25a', size: 0.55, opacity: 0.7 }),
});
export const DEFAULT_TRAY_RECT = Object.freeze({ x: 0.25, y: 0.2, w: 0.5, h: 0.6 });
/** A tray is never smaller than this on screen (px), nor a dimension under this share of the stage. */
export const MIN_TRAY_PX = Object.freeze({ width: 240, height: 180 });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, lo, hi, fallback) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
const color = (v, fallback) =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : fallback;
// an image in the Foundry data folder or an http(s) url (it ends up in a CSS url())
const IMAGE = /^(?:https?:\/\/[^<>"'()\s\\]+|[^:<>"'()\s\\]+)\.(?:png|jpe?g|webp|svg|gif|avif)$/i;

/** A stored tray look, made safe: unknown fields dropped, the rest clamped; junk is the default. */
export function normalizeTray(raw) {
  const t = isObj(raw) ? raw : {};
  const rim = isObj(t.rim) ? t.rim : {};
  const image =
    typeof t.image === 'string' && t.image.length < 400 && IMAGE.test(t.image) ? t.image : '';
  const surface = TRAY_SURFACES.includes(t.surface) ? t.surface : DEFAULT_TRAY.surface;
  const d = isObj(t.design) ? t.design : {};
  const src =
    TRAY_DESIGNS.includes(d.src) ||
    (typeof d.src === 'string' && d.src.length < 400 && IMAGE.test(d.src))
      ? d.src
      : '';
  return {
    surface: surface === 'image' && !image ? DEFAULT_TRAY.surface : surface,
    shape: TRAY_SHAPES.includes(t.shape) ? t.shape : DEFAULT_TRAY.shape,
    color: color(t.color, DEFAULT_TRAY.color),
    image,
    rim: {
      style: TRAY_RIMS.includes(rim.style) ? rim.style : DEFAULT_TRAY.rim.style,
      color: color(rim.color, DEFAULT_TRAY.rim.color),
      width: Math.round(num(rim.width, 0, 40, DEFAULT_TRAY.rim.width)),
    },
    radius: Math.round(num(t.radius, 0, 80, DEFAULT_TRAY.radius)),
    design: {
      src,
      color: color(d.color, DEFAULT_TRAY.design.color),
      size: num(d.size, 0.15, 1, DEFAULT_TRAY.design.size),
      opacity: num(d.opacity, 0, 1, DEFAULT_TRAY.design.opacity),
    },
  };
}

/** At most this many saved trays (the world's trayPresets). */
export const MAX_TRAY_PRESETS = 24;

/**
 * The GM's saved trays (world `trayPresets`), made safe: {id, name, look} each (the look
 * normalised, a name of 40 characters at most), unique ids, MAX_TRAY_PRESETS at most.
 */
export function normalizeTrayPresets(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    if (!isObj(p) || typeof p.id !== 'string' || !p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 40) : p.id;
    out.push({ id: p.id, name, look: normalizeTray(p.look) });
    if (out.length >= MAX_TRAY_PRESETS) break;
  }
  return out;
}

/**
 * The look this screen's tray has, or null (no tray: dice land on the scene's roll area as they
 * always did). 'mine' falls back to the table's look, then the default; 'table' needs the GM's.
 */
export function trayLookFor({ mode, mine, table } = {}) {
  if (mode === 'none') return null;
  if (mode === 'mine')
    return normalizeTray(isObj(mine) ? mine : isObj(table) ? table : DEFAULT_TRAY);
  return isObj(table) ? normalizeTray(table) : null;
}

/**
 * The px rect dice land in for a tray at `px` with `look`: inside the rim (and `gap` more), then
 * inside the shape (SHAPE_INSET).
 */
export function trayArea(px, look, gap = 0) {
  const t = normalizeTray(look);
  const rim = t.rim.width + gap;
  const fw = Math.max(1, px.width - 2 * rim);
  const fh = Math.max(1, px.height - 2 * rim);
  const s = SHAPE_INSET[t.shape];
  return {
    left: px.left + rim + fw * s.x,
    top: px.top + rim + fh * s.y,
    width: Math.max(1, fw * (1 - 2 * s.x)),
    height: Math.max(1, fh * (1 - 2 * s.y)),
  };
}

/** The table sound of a tray look. */
export const traySound = (look) => SURFACE_SOUND[look?.surface] ?? 'felt';

/** A stored tray place, made safe: fractions inside the stage, at least 5% each way. */
export function normalizeTrayRect(raw) {
  const r = isObj(raw) ? raw : {};
  const w = num(r.w, 0.05, 1, DEFAULT_TRAY_RECT.w);
  const h = num(r.h, 0.05, 1, DEFAULT_TRAY_RECT.h);
  return {
    x: num(r.x, 0, 1 - w, Math.min(DEFAULT_TRAY_RECT.x, 1 - w)),
    y: num(r.y, 0, 1 - h, Math.min(DEFAULT_TRAY_RECT.y, 1 - h)),
    w,
    h,
  };
}

/**
 * The tray's px rect in `stage` ({left, top, width, height}): its fractions, grown to MIN_TRAY_PX
 * (never past the stage) and kept inside it.
 */
export function trayPixels(rect, stage) {
  const f = normalizeTrayRect(rect);
  const width = Math.min(stage.width, Math.max(MIN_TRAY_PX.width, f.w * stage.width));
  const height = Math.min(stage.height, Math.max(MIN_TRAY_PX.height, f.h * stage.height));
  const left = stage.left + clamp(f.x * stage.width, 0, stage.width - width);
  const top = stage.top + clamp(f.y * stage.height, 0, stage.height - height);
  return { left, top, width, height };
}

/** The fractions a px rect (after a drag or resize) stands for in `stage`. */
export function trayFractions(px, stage) {
  return normalizeTrayRect({
    x: (px.left - stage.left) / stage.width,
    y: (px.top - stage.top) / stage.height,
    w: px.width / stage.width,
    h: px.height / stage.height,
  });
}

/**
 * The CSS of a tray look (custom properties the stylesheet reads): the surface colour and its
 * pattern, the image, the rim, the corners and the floor design (a built-in one from
 * assets/trays). `route` turns a data path into a url.
 */
export function trayStyle(look, route = (p) => p) {
  const t = normalizeTray(look);
  const design = t.design.src
    ? TRAY_DESIGNS.includes(t.design.src)
      ? `modules/dicer/assets/trays/${t.design.src}.svg`
      : t.design.src
    : '';
  return {
    '--dicer-tt-design': design ? `url("${route(design)}")` : 'none',
    '--dicer-tt-design-color': t.design.color,
    '--dicer-tt-design-size': `${Math.round(t.design.size * 100)}%`,
    // no design: nothing to mask with, so the layer must not paint at all
    '--dicer-tt-design-opacity': design ? String(t.design.opacity) : '0',
    '--dicer-tt-color': t.color,
    '--dicer-tt-image': t.surface === 'image' ? `url("${route(t.image)}")` : 'none',
    '--dicer-tt-rim': t.rim.color,
    '--dicer-tt-rim-width': `${t.rim.width}px`,
    '--dicer-tt-radius': `${t.radius}px`,
  };
}

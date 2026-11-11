/** Pure roll-area model: presets, fraction defs, safe resolution to pixels, die units. */

export const PRESETS = Object.freeze({
  full: Object.freeze({ x: 0, y: 0, w: 1, h: 1 }),
  centre: Object.freeze({ x: 0.2, y: 0.15, w: 0.6, h: 0.7 }),
  bottom: Object.freeze({ x: 0, y: 0.62, w: 1, h: 0.38 }),
  corner: Object.freeze({ x: 0.62, y: 0.55, w: 0.38, h: 0.45 }),
});

/** An area is never smaller than this on screen (or the whole usable region if smaller). */
export const MIN_AREA_PX = Object.freeze({ width: 240, height: 180 });

const MIN_FRACTION = 0.05;
const SCALE_MIN = 0.5;
const SCALE_MAX = 1.5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Unknown or malformed input gives `{preset: 'full'}`; custom fractions are clamped inside [0,1]. */
export function normalizeAreaDef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { preset: 'full' };
  const { preset } = raw;
  if (typeof preset === 'string' && Object.hasOwn(PRESETS, preset)) return { preset };
  if (preset !== 'custom') return { preset: 'full' };
  if (!['x', 'y', 'w', 'h'].some((k) => k in raw)) return { preset: 'full' };
  const w = clamp(num(raw.w, 1), MIN_FRACTION, 1);
  const h = clamp(num(raw.h, 1), MIN_FRACTION, 1);
  const x = clamp(num(raw.x, 0), 0, 1 - w);
  const y = clamp(num(raw.y, 0), 0, 1 - h);
  return { preset: 'custom', x, y, w, h };
}

/**
 * Resolves a def to a pixel rect inside `usable`: fractions, scaled around the centre (scale
 * clamped 0.5-1.5), grown to MIN_AREA_PX around the centre (capped at the usable size), then
 * shifted fully inside.
 */
export function resolveArea(def, usable, { scale = 1 } = {}) {
  const d = normalizeAreaDef(def);
  const f = d.preset === 'custom' ? d : PRESETS[d.preset];
  const s = clamp(num(scale, 1), SCALE_MIN, SCALE_MAX);

  let w = f.w * usable.width;
  let h = f.h * usable.height;
  const cx = usable.left + (f.x + f.w / 2) * usable.width;
  const cy = usable.top + (f.y + f.h / 2) * usable.height;

  w *= s;
  h *= s;
  w = Math.min(usable.width, Math.max(w, MIN_AREA_PX.width));
  h = Math.min(usable.height, Math.max(h, MIN_AREA_PX.height));

  const left = clamp(cx - w / 2, usable.left, usable.left + usable.width - w);
  const top = clamp(cy - h / 2, usable.top, usable.top + usable.height - h);
  return { left, top, width: w, height: h };
}

/** Die units relative to the stage centre: x right, z down the screen (camera up = (0,0,-1)). */
export function toDieArea(rect, stage, diePx) {
  return {
    cx: (rect.left + rect.width / 2 - (stage.left + stage.width / 2)) / diePx,
    cz: (rect.top + rect.height / 2 - (stage.top + stage.height / 2)) / diePx,
    halfWidth: rect.width / 2 / diePx,
    halfDepth: rect.height / 2 / diePx,
  };
}

/** Floor area (die units squared) a throw's own area keeps per die (P5-R6, measured). */
export const CAPACITY_PER_DIE = 4;
/** Smallest half-extent of a throw's own area: always room for one die (circumradius 1). */
export const ONE_DIE_HALF = 1.5;

/**
 * Grows a die-unit area {cx, cz, halfWidth, halfDepth} around its centre (keeping its aspect
 * where possible) until it holds `n` dice (2hw x 2hd >= n x CAPACITY_PER_DIE, each half >=
 * ONE_DIE_HALF), then keeps it inside `stage` {halfWidth, halfDepth} (centred at 0).
 */
export function fitDieCapacity(a, n, stage, capacity = CAPACITY_PER_DIE) {
  const sw = stage.halfWidth;
  const sd = stage.halfDepth;
  let hw = Math.max(a.halfWidth, ONE_DIE_HALF);
  let hd = Math.max(a.halfDepth, ONE_DIE_HALF);
  const need = (Math.max(1, n) * capacity) / 4; // hw x hd
  if (hw * hd < need) {
    const k = Math.sqrt(need / (hw * hd));
    hw *= k;
    hd *= k;
  }
  if (hw > sw) {
    hw = sw;
    hd = Math.max(hd, need / hw);
  }
  if (hd > sd) {
    hd = sd;
    hw = Math.min(sw, Math.max(hw, need / hd));
  }
  hw = Math.min(hw, sw);
  const cx = Math.min(Math.max(a.cx, -(sw - hw)), sw - hw);
  const cz = Math.min(Math.max(a.cz, -(sd - hd)), sd - hd);
  return { cx, cz, halfWidth: hw, halfDepth: hd };
}

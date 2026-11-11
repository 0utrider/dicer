// Runtime digit atlases (P7-D3): a single-channel signed distance field per glyph, packed in the
// same BMFont JSON shape scripts/build-sdf.mjs writes, so parseAtlas / layoutLabel / the engrave
// shader read it unchanged. The shader decodes median(r, g, b); the caller stores this one field
// in all three channels, which gives the same value.
//
// Pure: no DOM, no three. Runs in the font worker, and on the main thread (in idle slices) when
// no worker can do it. Long loops are generators that yield between small units of work.

/** Atlas glyph size and distance range: the same values as the bundled MSDF atlases. */
export const FONT_SIZE = 64;
/** Distance range in atlas px: the field spans +-range/2 px around the edge (0.5 at the edge). */
export const DISTANCE_RANGE = 8;
/** Glyphs are rasterized this many times larger, then the distances are averaged down. */
export const SUPERSAMPLE = 4;
export const RASTER_PX = FONT_SIZE * SUPERSAMPLE;
/** 0-9 and the underline, which the atlas stores under '.' (the 6./9. mark). */
export const GLYPHS = '0123456789_';
const UNDERLINE_SRC = '_';
const UNDERLINE_KEY = '.';
/** Every glyph box carries half the distance range of margin (parseAtlas assumes it). */
const PAD = DISTANCE_RANGE / 2;
const TEXTURE_PADDING = 2;
const MIN_ATLAS_WIDTH = 256;
/** EDT lines processed between yields. */
const LINES_PER_STEP = 32;
const INF = 1e20;

export class FontError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Escapes a value for use inside a double-quoted CSS string (url("...") or a family name). */
export function cssString(s) {
  return String(s).replace(/["\\\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

/**
 * Crops one glyph out of a full-canvas alpha raster (row 0 at the top): its ink box, snapped to
 * the supersample grid around the pen and baseline, plus a PAD (atlas px) margin.
 * @param {Uint8Array|Uint8ClampedArray} alpha cw x ch coverage, 0..255
 * @param {{char: string, penX: number, baseY: number, advance: number}} at raster px
 * @returns {{char, w, h, alpha: Uint8Array, xoffset, top, xadvance} | null} w/h in atlas px;
 *   alpha is (w * SUPERSAMPLE) x (h * SUPERSAMPLE); null when the raster has no ink
 */
export function cropGlyph(alpha, cw, ch, { char, penX, baseY, advance }) {
  let x0 = cw;
  let y0 = ch;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < ch; y++) {
    const row = y * cw;
    for (let x = 0; x < cw; x++) {
      if (alpha[row + x] < 128) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const S = SUPERSAMPLE;
  const ax0 = penX + Math.floor((x0 - penX) / S) * S;
  const ax1 = penX + Math.ceil((x1 + 1 - penX) / S) * S;
  const ay0 = baseY + Math.floor((y0 - baseY) / S) * S;
  const ay1 = baseY + Math.ceil((y1 + 1 - baseY) / S) * S;
  const w = (ax1 - ax0) / S + 2 * PAD;
  const h = (ay1 - ay0) / S + 2 * PAD;
  const ox = ax0 - PAD * S;
  const oy = ay0 - PAD * S;
  const W = w * S;
  const H = h * S;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = oy + y;
    if (sy < 0 || sy >= ch) continue;
    for (let x = 0; x < W; x++) {
      const sx = ox + x;
      if (sx >= 0 && sx < cw) out[y * W + x] = alpha[sy * cw + sx];
    }
  }
  return {
    char,
    w,
    h,
    alpha: out,
    xoffset: (ox - penX) / S,
    top: (baseY - oy) / S,
    xadvance: advance / S,
  };
}

/** 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher), f -> d. */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** 2D squared EDT in place: a column pass then a row pass, yielding every few lines. */
function* edt(grid, W, H) {
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
    if (x % LINES_PER_STEP === LINES_PER_STEP - 1) yield;
  }
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) f[x] = grid[row + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) grid[row + x] = d[x];
    if (y % LINES_PER_STEP === LINES_PER_STEP - 1) yield;
  }
}

/**
 * The glyph's field, one 0..255 value per atlas px (row 0 at the top): 0.5 + d / range, d the
 * signed distance to the ink edge in atlas px (positive inside), averaged over each pixel's
 * supersample block.
 */
function* fieldSteps(glyph) {
  const S = SUPERSAMPLE;
  const W = glyph.w * S;
  const H = glyph.h * S;
  const toIn = new Float64Array(W * H); // squared distance to the nearest ink pixel
  const toOut = new Float64Array(W * H); // squared distance to the nearest blank pixel
  for (let i = 0; i < W * H; i++) {
    const inside = glyph.alpha[i] >= 128;
    toIn[i] = inside ? 0 : INF;
    toOut[i] = inside ? INF : 0;
  }
  yield* edt(toIn, W, H);
  yield* edt(toOut, W, H);
  const out = new Uint8Array(glyph.w * glyph.h);
  for (let cy = 0; cy < glyph.h; cy++) {
    for (let cx = 0; cx < glyph.w; cx++) {
      let sum = 0;
      for (let sy = 0; sy < S; sy++) {
        const row = (cy * S + sy) * W + cx * S;
        for (let sx = 0; sx < S; sx++) {
          const i = row + sx;
          // pixel centres: the edge lies half a pixel beyond the last inside / outside pixel
          sum += toOut[i] > 0 ? Math.sqrt(toOut[i]) - 0.5 : 0.5 - Math.sqrt(toIn[i]);
        }
      }
      const dist = sum / (S * S) / S; // raster px -> atlas px
      const value = 0.5 + dist / DISTANCE_RANGE;
      out[cy * glyph.w + cx] = Math.round(255 * Math.min(1, Math.max(0, value)));
    }
    if (cy % LINES_PER_STEP === LINES_PER_STEP - 1) yield;
  }
  return out;
}

const pot = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/**
 * Field + shelf packing for every glyph.
 * @param {ReturnType<typeof cropGlyph>[]} glyphs
 * @param {{face?: string}} [opts]
 * @returns {Generator<undefined, {json: object, width: number, height: number, field: Uint8Array}>}
 *   field is width x height, one channel, rows bottom-up (GL upload order, so a DataTexture
 *   with flipY false matches parseAtlas's v = 1 - y / scaleH)
 */
export function* buildAtlasSteps(glyphs, { face = 'font' } = {}) {
  const cells = [];
  for (const g of glyphs) {
    const values = yield* fieldSteps(g);
    cells.push({ g, values, x: 0, y: 0 });
    yield;
  }
  const width = pot(Math.max(MIN_ATLAS_WIDTH, ...cells.map((c) => c.g.w)));
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const c of cells) {
    if (x > 0 && x + c.g.w > width) {
      x = 0;
      y += rowH + TEXTURE_PADDING;
      rowH = 0;
    }
    c.x = x;
    c.y = y;
    x += c.g.w + TEXTURE_PADDING;
    rowH = Math.max(rowH, c.g.h);
  }
  const height = pot(y + rowH);
  const field = new Uint8Array(width * height);
  for (const c of cells) {
    for (let j = 0; j < c.g.h; j++) {
      const dst = (height - 1 - (c.y + j)) * width + c.x;
      field.set(c.values.subarray(j * c.g.w, (j + 1) * c.g.w), dst);
    }
  }
  const base = Math.max(0, ...glyphs.map((g) => g.top));
  const json = {
    info: { face, size: FONT_SIZE },
    common: { lineHeight: Math.round(FONT_SIZE * 1.25), base, scaleW: width, scaleH: height },
    distanceField: { fieldType: 'sdf', distanceRange: DISTANCE_RANGE },
    chars: cells.map(({ g, x: cx, y: cy }) => {
      const char = g.char === UNDERLINE_SRC ? UNDERLINE_KEY : g.char;
      return {
        id: char.charCodeAt(0),
        char,
        x: cx,
        y: cy,
        width: g.w,
        height: g.h,
        xoffset: g.xoffset,
        yoffset: base - g.top,
        xadvance: Math.round(g.xadvance * 100) / 100,
      };
    }),
  };
  return { json, width, height, field };
}

/** Runs a generator to completion. */
export function drain(gen) {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}

/** buildAtlasSteps, run to completion. */
export function buildAtlas(glyphs, opts) {
  return drain(buildAtlasSteps(glyphs, opts));
}

/**
 * Runs a generator in idle slices: each slice stops before a step that would take it past
 * budgetMs (judged by the slowest step so far), always doing at least one step.
 * @returns {Promise<*>} the generator's return value
 */
export function runSliced(gen, { idle, now, budgetMs = 8 }) {
  return new Promise((resolve, reject) => {
    let slowest = 0;
    const slice = (deadline) => {
      const left = deadline?.timeRemaining?.();
      const budget = typeof left === 'number' && left > 0 ? Math.min(budgetMs, left) : budgetMs;
      const t0 = now();
      try {
        for (;;) {
          const s = now();
          const r = gen.next();
          if (r.done) return resolve(r.value);
          const t = now();
          slowest = Math.max(slowest, t - s);
          if (t - t0 + slowest > budget) break;
        }
      } catch (err) {
        return reject(err);
      }
      idle(slice);
    };
    idle(slice);
  });
}

/** A short bar under the baseline, for a font without "_" (only its box size matters). */
function syntheticUnderline(cw, ch, penX, baseY) {
  const a = new Uint8Array(cw * ch);
  const x1 = penX + RASTER_PX / 2;
  const y0 = baseY + Math.round(RASTER_PX * 0.08);
  const y1 = y0 + Math.round(RASTER_PX * 0.08);
  for (let y = y0; y < y1; y++) a.fill(255, y * cw + penX, y * cw + x1);
  return cropGlyph(a, cw, ch, { char: UNDERLINE_SRC, penX, baseY, advance: RASTER_PX / 2 });
}

/** Ink margin (raster px) kept around the measured glyph box when reading pixels back. */
const BAND_MARGIN = 8;

/**
 * The canvas rect worth reading back for a glyph: its measured ink box (TextMetrics actual
 * bounding box) plus a margin, clamped to the canvas; the whole canvas without metrics.
 */
function bandOf(m, penX, baseY, cw, ch) {
  const l = m?.actualBoundingBoxLeft;
  const r = m?.actualBoundingBoxRight;
  const a = m?.actualBoundingBoxAscent;
  const d = m?.actualBoundingBoxDescent;
  if (![l, r, a, d].every(Number.isFinite)) return { x: 0, y: 0, w: cw, h: ch };
  const x0 = Math.max(0, Math.floor(penX - l) - BAND_MARGIN);
  const x1 = Math.min(cw, Math.ceil(penX + r) + BAND_MARGIN);
  const y0 = Math.max(0, Math.floor(baseY - a) - BAND_MARGIN);
  const y1 = Math.min(ch, Math.ceil(baseY + d) + BAND_MARGIN);
  if (x1 <= x0 || y1 <= y0) return { x: 0, y: 0, w: cw, h: ch };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Draws each glyph of GLYPHS with `family` on a 2D canvas and crops it. Each step is small (the
 * G2 8 ms rule for idle slices): canvas setup; then per glyph the coverage check, the draw and
 * read-back of only the band around the glyph, and the crop.
 * A glyph the family lacks is detected by measuring it with two different fallbacks: the
 * widths match only when the family itself draws it. A missing digit fails (code 'nodigits');
 * a missing "_" is replaced by a plain bar.
 * @param {{family: string, makeCanvas: (w: number, h: number) => {getContext: Function}}} o
 */
export function* rasterSteps({ family, makeCanvas }) {
  const px = RASTER_PX;
  const cw = Math.ceil(px * 1.6);
  const ch = Math.ceil(px * 1.6);
  const canvas = makeCanvas(cw, ch);
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new FontError('unsupported', 'no 2D canvas context');
  yield; // canvas creation in its own slice
  const name = `"${cssString(family)}"`;
  const width = (c, fallback) => {
    ctx.font = `${px}px ${name}, ${fallback}`;
    return ctx.measureText(c).width;
  };
  const penX = Math.round(px * 0.3);
  const baseY = Math.round(px * 1.2);
  const glyphs = [];
  for (const c of GLYPHS) {
    // the first measure resolves the font: its own step
    const own = width(c, 'monospace') === width(c, 'serif');
    yield;
    let g = null;
    if (own) {
      ctx.font = `${px}px ${name}, serif`;
      const metrics = ctx.measureText(c);
      const band = bandOf(metrics, penX, baseY, cw, ch);
      ctx.clearRect(band.x, band.y, band.w, band.h);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(c, penX, baseY);
      const rgba = ctx.getImageData(band.x, band.y, band.w, band.h).data;
      yield;
      const alpha = new Uint8Array(band.w * band.h);
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
      g = cropGlyph(alpha, band.w, band.h, {
        char: c,
        penX: penX - band.x,
        baseY: baseY - band.y,
        advance: metrics.width,
      });
    }
    if (!g && c === UNDERLINE_SRC) g = syntheticUnderline(cw, ch, penX, baseY);
    if (!g) throw new FontError('nodigits', `the font has no "${c}"`);
    glyphs.push(g);
    yield;
  }
  return glyphs;
}

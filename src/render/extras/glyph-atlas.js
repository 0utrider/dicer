import * as THREE from 'three';
import { cropGlyph, buildAtlasSteps, drain, SUPERSAMPLE, DISTANCE_RANGE } from '../../fonts/sdf-builder.js';

/**
 * Own-work glyphs (crit icons, pips, coin motifs) drawn into a copy of the label atlas below the
 * font's glyphs, so a face shows them through the ordinary label path with the number's fill,
 * depth and relief. Only the labels and the atlas change; the shader and the program key do not.
 *
 * Each glyph set gets its own composer (its own caches), so a look whose d20 shows icons, d6 pips
 * and d2 a coin motif builds one composed atlas per set and none evicts another's.
 *
 * World-start cost: parseAtlas (sdf-atlas.js) is not imported; glyphsOf mirrors its glyph rects
 * (tests/unit/icons.test.js checks it against the original).
 */

/** SVG path data of a full circle (two arcs), for the 0..100 glyph paths. */
export const circle = (cx, cy, r) => `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;

/** BMFont char boxes recovered from a parsed atlas (parseAtlas's inverse). */
export function atlasCharsOf(atlas) {
  const { scaleW, scaleH } = atlas;
  return [...atlas.glyphs].map(([char, g]) => ({
    id: char.charCodeAt(0),
    char,
    x: Math.round(g.u0 * scaleW),
    y: Math.round((1 - g.v1) * scaleH),
    width: g.w,
    height: g.h,
    xoffset: g.xoffset,
    yoffset: g.yoffset,
    xadvance: g.xadvance,
  }));
}

const pot = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
/** Rows between the font's glyphs and the added glyphs. */
const GAP = 2;

/**
 * One atlas holding the font (its pixels and char boxes where they were) and the glyphs below it.
 * @param {{chars: object[], base: number, width: number, height: number, rgba: Uint8Array,
 *   distanceRange: number}} font rgba rows bottom-up
 * @param {{json: object, width: number, height: number, field: Uint8Array}} glyphs
 *   buildAtlasSteps output (field rows bottom-up)
 * @returns {{json: object, width: number, height: number, rgba: Uint8Array}} rgba rows bottom-up
 */
export function composeAtlas(font, glyphs, face = 'dicer-icons') {
  const fw = font.width;
  const fh = font.height;
  const iw = glyphs.width;
  const ih = glyphs.height;
  const width = Math.max(fw, iw);
  const top = fh + GAP;
  const height = pot(top + ih);
  const rgba = new Uint8Array(width * height * 4);
  for (let r = 0; r < fh; r++) {
    const src = (fh - 1 - r) * fw * 4;
    rgba.set(font.rgba.subarray(src, src + fw * 4), (height - 1 - r) * width * 4);
  }
  for (let r = 0; r < ih; r++) {
    const src = (ih - 1 - r) * iw;
    const dst = (height - 1 - (top + r)) * width * 4;
    for (let c = 0; c < iw; c++) {
      const v = glyphs.field[src + c];
      const o = dst + c * 4;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  }
  const json = {
    info: { face },
    common: { base: font.base, scaleW: width, scaleH: height },
    distanceField: { fieldType: 'msdf', distanceRange: font.distanceRange },
    chars: [...font.chars, ...glyphs.json.chars.map((c) => ({ ...c, y: c.y + top }))],
  };
  return { json, width, height, rgba };
}

export function defaultMakeCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  return Object.assign(globalThis.document.createElement('canvas'), { width: w, height: h });
}

/**
 * Each glyph's SVG path (0..100 viewBox) drawn with Path2D at an ink height of
 * inkPx * SUPERSAMPLE raster px and cropped.
 * @param {Array<[string, string, (CanvasFillRule|'union')?]>} entries [char, path, fill rule
 *   (evenodd; 'union' fills every subpath on its own, so overlapping parts never cancel)]
 * @returns {ReturnType<typeof cropGlyph>[]}
 */
export function rasterGlyphs(entries, inkPx, makeCanvas = defaultMakeCanvas) {
  const size = inkPx * SUPERSAMPLE;
  const margin = 4 * SUPERSAMPLE;
  const side = size + 2 * margin;
  const canvas = makeCanvas(side, side);
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return entries.map(([char, path, rule = 'evenodd']) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, side, side);
    ctx.setTransform(size / 100, 0, 0, size / 100, margin, margin);
    ctx.fillStyle = '#fff';
    if (rule === 'union') for (const sub of path.split(/(?=M)/)) ctx.fill(new Path2D(sub));
    else ctx.fill(new Path2D(path), rule);
    const data = ctx.getImageData(0, 0, side, side).data;
    const alpha = new Uint8Array(side * side);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    return cropGlyph(alpha, side, side, { char, penX: margin, baseY: margin + size, advance: size });
  });
}

/**
 * The atlas texture's RGBA, rows bottom-up: a DataTexture's own data (already bottom-up), or a
 * 2D-canvas readback of its image (top-down, flipped). Null when there is nothing to read.
 */
function defaultReadPixels(texture, w, h, makeCanvas) {
  const img = texture?.image;
  if (!img) return null;
  if (texture.isDataTexture) return img.data?.length === w * h * 4 ? img.data : null;
  const canvas = makeCanvas(w, h);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const top = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) out.set(top.subarray(r * w * 4, (r + 1) * w * 4), (h - 1 - r) * w * 4);
  return out;
}

/** parseAtlas's glyph map for BMFont chars on a scaleW x scaleH atlas. */
function glyphsOf(chars, scaleW, scaleH) {
  return new Map(
    chars.map((c) => [
      c.char,
      {
        u0: c.x / scaleW,
        v0: 1 - (c.y + c.height) / scaleH,
        u1: (c.x + c.width) / scaleW,
        v1: 1 - c.y / scaleH,
        w: c.width,
        h: c.height,
        xoffset: c.xoffset,
        yoffset: c.yoffset,
        xadvance: c.xadvance,
      },
    ]),
  );
}

const LRU_SIZE = 4;

/**
 * A composer for one glyph set: (atlas, opts) -> the atlas with the set's glyphs added (ink height
 * `scale` x the font's digit height), or null (numbers drawn) for an atlas that is not an
 * 8-unit-range distance field or whose pixels cannot be read. Cached per source texture (LRU of
 * four, evicted textures disposed) and per ink height, separately for every composer.
 * @param {Array<[string, string, CanvasFillRule?]>} entries see rasterGlyphs
 */
export function glyphComposer(entries, scale, face) {
  const built = new Map(); // inkPx -> buildAtlasSteps output
  const composed = new Map(); // source texture (or atlas) -> composed atlas, LRU
  /**
   * @param {object} atlas parseAtlas output plus texture
   * @param {{makeCanvas?: Function, readPixels?: (texture, w, h) => Uint8Array|null}} [o]
   */
  return function withGlyphs(atlas, { makeCanvas = defaultMakeCanvas, readPixels } = {}) {
    if (atlas?.distanceRange !== DISTANCE_RANGE) return null;
    const key = atlas.texture ?? atlas;
    const hit = composed.get(key);
    if (hit) {
      composed.delete(key);
      composed.set(key, hit);
      return hit;
    }
    try {
      const { scaleW: w, scaleH: h } = atlas;
      const rgba = readPixels ? readPixels(atlas.texture, w, h) : defaultReadPixels(atlas.texture, w, h, makeCanvas);
      if (!rgba) return null;
      const inkPx = Math.round(scale * atlas.digitHeight);
      let glyphs = built.get(inkPx);
      if (!glyphs) {
        glyphs = drain(buildAtlasSteps(rasterGlyphs(entries, inkPx, makeCanvas), { face }));
        built.set(inkPx, glyphs);
      }
      const out = composeAtlas(
        { chars: atlasCharsOf(atlas), base: atlas.base, width: w, height: h, rgba, distanceRange: atlas.distanceRange },
        glyphs,
        face,
      );
      // RGBA, unsigned bytes and NoColorSpace are DataTexture's defaults (not imported: each import
      // from the world-start bundle costs it an export). Distances must not be gamma-decoded or
      // filtered across glyphs.
      const texture = new THREE.DataTexture(out.rgba, out.width, out.height);
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.flipY = false;
      texture.needsUpdate = true;
      // parseAtlas(out.json): base, pad, distance range and digit height are the source's
      const result = { ...atlas, glyphs: glyphsOf(out.json.chars, out.width, out.height), scaleW: out.width, scaleH: out.height, texture };
      composed.set(key, result);
      if (composed.size > LRU_SIZE) {
        const [oldKey, old] = composed.entries().next().value;
        composed.delete(oldKey);
        // a live material still binding it makes three upload it again
        old.texture.dispose();
      }
      return result;
    } catch {
      return null; // no 2D canvas / Path2D here: the die keeps its numbers
    }
  };
}

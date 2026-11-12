import * as THREE from 'three';
import { labelFor } from '../../core/dice-shapes.js';
import { cropGlyph, buildAtlasSteps, drain, SUPERSAMPLE, DISTANCE_RANGE } from '../../fonts/sdf-builder.js';

/**
 * Crit and fumble icons: own-work glyphs drawn into the label atlas next to the digits, so a
 * die's max face (crit) or its 1 (fumble) shows an icon through the ordinary label path. Only
 * the labels and the atlas change; the shader and the program key do not.
 *
 * World-start cost: every binding this chunk imports from the world-start bundle makes dicer.js
 * export it. So ICON_IDS (look/appearance.js) and parseAtlas (sdf-atlas.js) are not imported:
 * ICON_PATHS lists the icons in ICON_IDS order, and glyphsOf mirrors parseAtlas's glyph rects
 * (tests/unit/icons.test.js checks both against the originals).
 */

const circle = (cx, cy, r) => `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;

/**
 * SVG path data in a 0..100 viewBox, filled even-odd (subpaths never overlap, so a nested one is
 * a hole). No stroke, gap or hole is thinner than 8 units, so each survives a 64 px SDF. Keys are
 * in ICON_IDS order.
 */
export const ICON_PATHS = Object.freeze({
  // an eight-point burst
  starburst:
    'M 50 0 L 60.3 25.1 L 85.4 14.6 L 74.9 39.7 L 100 50 L 74.9 60.3 L 85.4 85.4 L 60.3 74.9 ' +
    'L 50 100 L 39.7 74.9 L 14.6 85.4 L 25.1 60.3 L 0 50 L 25.1 39.7 L 14.6 14.6 L 39.7 25.1 Z',
  // three-point crown with a jewel over each point and a band below
  crown:
    'M 8 36 L 30 58 L 50 28 L 70 58 L 92 36 L 84 76 L 16 76 Z M 16 84 L 84 84 L 84 100 L 16 100 Z ' +
    `${circle(8, 20, 8)} ${circle(50, 10, 9)} ${circle(92, 20, 8)}`,
  // cranium and jaw with two eye sockets, a nose hole and three teeth
  skull:
    'M 50 0 C 23 0 4 18 4 44 C 4 60 12 70 22 74 L 22 100 L 36 100 L 36 88 L 45 88 L 45 100 ' +
    'L 55 100 L 55 88 L 64 88 L 64 100 L 78 100 L 78 74 C 88 70 96 60 96 44 C 96 18 77 0 50 0 Z ' +
    `${circle(32, 41, 12)} ${circle(68, 41, 12)} M 50 62 L 58 76 L 42 76 Z`,
  // a heater shield split by a zigzag crack
  'broken-shield':
    'M 45 1.6 L 6 14 L 6 46 C 6 72 24 89 47 99 L 39 66 L 51 46 L 37 26 Z ' +
    'M 55 1.6 L 94 14 L 94 46 C 94 72 76 89 57 99 L 49 66 L 61 46 L 47 26 Z',
  heart:
    'M 50 100 C 22 80 0 60 0 32 C 0 13 13 0 29 0 C 39 0 46 6 50 14 C 54 6 61 0 71 0 ' +
    'C 87 0 100 13 100 32 C 100 60 78 80 50 100 Z',
  // a flame with a side lick and an inner flame cut out
  flame:
    'M 52 0 C 56 20 84 34 84 64 C 84 86 68 100 50 100 C 32 100 16 86 16 66 C 16 52 22 42 30 34 ' +
    'C 30 44 34 52 40 56 C 38 34 44 16 52 0 Z ' +
    'M 50 50 C 54 62 64 68 64 78 C 64 85 58 88 50 88 C 42 88 36 85 36 78 C 36 68 46 62 50 50 Z',
});

const IDS = Object.keys(ICON_PATHS); // ICON_IDS, in order

/** The atlas char of each icon: private-use code points, in ICON_IDS order. */
export const ICON_CHARS = Object.freeze(
  Object.fromEntries(IDS.map((id, i) => [id, String.fromCharCode(0xe000 + i)])),
);

/**
 * The face labels with the crit icon on the d20's 20 and the fumble icon on its 1. Only the d20
 * shows icons: every other die returns its labels unchanged (the d100 ones die is a plain d10,
 * and the d4 reads its result face-down). Only faces that carry their plain number change:
 * preset glyph / blank / layered faces and ghosts ('') keep their labels.
 */
export function iconLabels(labels, shape, icons) {
  const values = shape?.values;
  if (shape?.type !== 'd20' || !values?.length || !(icons?.crit || icons?.fumble)) return labels;
  return labels.map((label, i) => {
    const v = values[i];
    if (v === undefined || label !== labelFor(shape.type, v)) return label;
    if (icons.crit && v === 20) return ICON_CHARS[icons.crit];
    if (icons.fumble && v === 1) return ICON_CHARS[icons.fumble];
    return label;
  });
}

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
/** Rows between the font's glyphs and the icons. */
const GAP = 2;

/**
 * One atlas holding the font (its pixels and char boxes where they were) and the icons below it.
 * @param {{chars: object[], base: number, width: number, height: number, rgba: Uint8Array,
 *   distanceRange: number}} font rgba rows bottom-up
 * @param {{json: object, width: number, height: number, field: Uint8Array}} icons
 *   buildAtlasSteps output (field rows bottom-up)
 * @returns {{json: object, width: number, height: number, rgba: Uint8Array}} rgba rows bottom-up
 */
export function composeAtlas(font, icons) {
  const fw = font.width;
  const fh = font.height;
  const iw = icons.width;
  const ih = icons.height;
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
      const v = icons.field[src + c];
      const o = dst + c * 4;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  }
  const json = {
    info: { face: 'dicer-icons' },
    common: { base: font.base, scaleW: width, scaleH: height },
    distanceField: { fieldType: 'msdf', distanceRange: font.distanceRange },
    chars: [...font.chars, ...icons.json.chars.map((c) => ({ ...c, y: c.y + top }))],
  };
  return { json, width, height, rgba };
}

function defaultMakeCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  return Object.assign(globalThis.document.createElement('canvas'), { width: w, height: h });
}

/**
 * Each icon drawn with Path2D at an ink height of inkPx * SUPERSAMPLE raster px and cropped.
 * @returns {ReturnType<typeof cropGlyph>[]}
 */
export function iconRaster(inkPx, makeCanvas = defaultMakeCanvas) {
  const size = inkPx * SUPERSAMPLE;
  const margin = 4 * SUPERSAMPLE;
  const side = size + 2 * margin;
  const canvas = makeCanvas(side, side);
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const glyphs = [];
  for (const id of IDS) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, side, side);
    ctx.setTransform(size / 100, 0, 0, size / 100, margin, margin);
    ctx.fillStyle = '#fff';
    ctx.fill(new Path2D(ICON_PATHS[id]), 'evenodd');
    const data = ctx.getImageData(0, 0, side, side).data;
    const alpha = new Uint8Array(side * side);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    glyphs.push(cropGlyph(alpha, side, side, { char: ICON_CHARS[id], penX: margin, baseY: margin + size, advance: size }));
  }
  return glyphs;
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

const iconAtlases = new Map(); // inkPx -> buildAtlasSteps output
const composed = new Map(); // source texture (or atlas) -> composed atlas, LRU
const LRU_SIZE = 4;

/**
 * The atlas with the six icons added, or null (numbers drawn) for an atlas that is not an
 * 8-unit-range distance field or whose pixels cannot be read.
 * @param {object} atlas parseAtlas output plus texture
 * @param {{makeCanvas?: Function, readPixels?: (texture, w, h) => Uint8Array|null}} [o]
 */
export function withIcons(atlas, { makeCanvas = defaultMakeCanvas, readPixels } = {}) {
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
    const inkPx = Math.round(1.15 * atlas.digitHeight);
    let icons = iconAtlases.get(inkPx);
    if (!icons) {
      icons = drain(buildAtlasSteps(iconRaster(inkPx, makeCanvas), { face: 'dicer-icons' }));
      iconAtlases.set(inkPx, icons);
    }
    const out = composeAtlas(
      { chars: atlasCharsOf(atlas), base: atlas.base, width: w, height: h, rgba, distanceRange: atlas.distanceRange },
      icons,
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
}

/**
 * ExtrasPatch for the crit/fumble icons: new labels and the icon atlas, or {} when no icon is on,
 * the die is not a d20 (no label changes, so no composed atlas) or the atlas cannot take icons. `compose` is the test seam.
 */
export function iconPatch(a, ctx, compose = withIcons) {
  const icons = a.numbers.icons;
  if (!icons?.crit && !icons?.fumble) return {};
  const labels = ctx?.labels;
  if (!labels) return {};
  const next = iconLabels(labels, ctx.shape, icons);
  if (next.every((l, i) => l === labels[i])) return {};
  const atlas = compose(ctx.atlas);
  return atlas ? { labels: next, atlas } : {};
}

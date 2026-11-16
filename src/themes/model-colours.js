/**
 * A Dicer look from a die model's own colours, for importing a module dice set that brings 3D
 * models and no colours (The Rollsmith's sets): the model's material (its base colour texture,
 * tinted by its colour factor, or the factor alone) gives the body colour and an accent for the
 * numbers. Lazy: only the theme browser's import reaches it, through the model chunk.
 */
import { normalizeAppearance } from '../look/appearance.js';

const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sat = ([r, g, b]) => {
  const max = Math.max(r, g, b);
  return max ? (max - Math.min(r, g, b)) / max : 0;
};
const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * The two colours of an RGBA pixel list (`tint` [r, g, b] 0..1 multiplies each, as a material's
 * colour factor does): `body`, the most common colour, and `accent`, the common colour farthest
 * from it (weighted toward saturated ones: gold numbers on red). Hex; null with no opaque pixel.
 */
export function paletteOf(pixels, tint = [1, 1, 1]) {
  const buckets = new Map(); // 4 bits a channel -> [count, r, g, b]
  let total = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i] * tint[0];
    const g = pixels[i + 1] * tint[1];
    const b = pixels[i + 2] * tint[2];
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(k) ?? [0, 0, 0, 0];
    e[0] += 1;
    e[1] += r;
    e[2] += g;
    e[3] += b;
    buckets.set(k, e);
    total += 1;
  }
  if (!total) return null;
  const list = [...buckets.values()].map(([n, r, g, b]) => ({ n, c: [r / n, g / n, b / n] })).sort((a, b) => b.n - a.n);
  const body = list[0].c;
  let accent = null;
  let best = -1;
  for (const e of list) {
    if (e.n < total * 0.02) break; // a speck is not a colour of the die
    const score = dist(e.c, body) * (0.5 + sat(e.c));
    if (score > best) [best, accent] = [score, e.c];
  }
  // a one-colour die: numbers in black or white, whichever stands out
  if (!accent || dist(accent, body) < 40) accent = luma(body) > 128 ? [20, 20, 20] : [240, 240, 240];
  return { body: hex(...body), accent: hex(...accent) };
}

/** The palette of a three.js material: its base colour texture (drawn small) or its colour factor. */
export function materialPalette(material, doc = globalThis.document) {
  const c = material?.color;
  // three.js keeps colours linear; getHexString gives the sRGB a texture's pixels are in
  const factor = typeof c?.getHexString === 'function' ? `#${c.getHexString()}` : null;
  const tint = factor ? rgbOf(factor).map((v) => v / 255) : [1, 1, 1];
  const image = material?.map?.image;
  if (image && doc?.createElement) {
    try {
      const canvas = doc.createElement('canvas');
      canvas.width = canvas.height = 48;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, 48, 48);
      const p = paletteOf(ctx.getImageData(0, 0, 48, 48).data, tint);
      if (p) return p;
    } catch {
      /* an unreadable texture: the colour factor */
    }
  }
  if (!factor) return null;
  return { body: factor, accent: luma(rgbOf(factor)) > 128 ? '#141414' : '#f0f0f0' };
}

/**
 * A look in a model's colours: a plain body (metal when the material is metallic) in its main
 * colour, numbers in its accent, no inside. Null when the material gives no colour.
 */
export function modelLook(material, doc) {
  const p = materialPalette(material, doc);
  if (!p) return null;
  const metal = (material?.metalness ?? 0) >= 0.5;
  const [r, g, b] = rgbOf(p.body);
  return normalizeAppearance({
    body: {
      type: metal ? 'metal' : 'opaque',
      color: p.body,
      color2: hex(r * 0.45, g * 0.45, b * 0.45),
      // a roughness map holds the real value (the factor is then usually 1): a medium sheen
      roughness: material?.roughnessMap ? 0.35 : Math.max(0.05, Math.min(0.9, material?.roughness ?? 0.35)),
      ...(metal ? { finish: 'polished' } : {}),
    },
    interior: { type: 'none' },
    numbers: { fill: metal ? 'gold' : 'paint', color: p.accent },
    edges: { strip: { style: 'body', color: p.accent } },
  });
}

/**
 * The look of a module dice set from its models (`models`: die type -> url): the d20's, else the
 * first that loads. Null when none loads or gives a colour. Never throws.
 */
export async function lookFromModels(models, { load = (url) => import('../render/model-loader.js').then((m) => m.loadDieModel(url)), doc } = {}) {
  const urls = [models?.d20, ...Object.values(models ?? {})].filter((u, i, a) => typeof u === 'string' && u && a.indexOf(u) === i);
  for (const url of urls) {
    try {
      const look = modelLook((await load(url))?.material, doc);
      if (look) return look;
    } catch {
      /* the next model */
    }
  }
  return null;
}

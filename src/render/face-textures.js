import * as THREE from 'three';
import { splitCrop } from './image-crop.js';

/**
 * Rasterized die faces: one RGBA layer of a DataArrayTexture per image or text face of a
 * FaceSet (glyph and blank faces stay with the MSDF labels). Images are drawn fitted to the
 * square at their own colours; text is drawn white on transparent in DM Serif Display, so the
 * shader can tint it as a mask.
 * Results are cached and refcounted by faceSet.key. A face whose image fails or does not load
 * within timeoutMs gets layer -1 (the die shows its number there) and warns once per URL.
 */

export const FACE_FONT_FAMILY = 'DM Serif Display';
/**
 * Text ink size, as a share of the layer square: the layer spans 1.2 face units, so 0.55 is
 * about the 0.62 face-unit digit height. Longer text may run wider.
 */
const TEXT_HEIGHT = 0.55;
const TEXT_WIDTH = 0.9;
/**
 * Half the layer square's edge in face units: Dicer's own (shaders/engrave.js FACE_LAYER_HALF), or
 * a face set's `half` (a module set's Dice So Nice tile, compat/faces.js), then the uFaceHalf uniform.
 */
const LAYER_HALF = 0.6;

function defaultLoadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${url}`));
    img.src = url;
  });
}

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function newContext(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas context');
  return ctx;
}

/** `img` fitted to the square; `crop` ([x, y, w, h]): only that rectangle of it (an atlas frame). */
function drawImage(img, size, crop = null) {
  const ctx = newContext(size);
  const [x, y, w, h] = crop ?? [0, 0, img.naturalWidth || img.width || size, img.naturalHeight || img.height || size];
  const s = Math.min(size / w, size / h);
  const to = [(size - w * s) / 2, (size - h * s) / 2, w * s, h * s];
  if (crop) ctx.drawImage(img, x, y, w, h, ...to);
  else ctx.drawImage(img, ...to);
  return ctx.getImageData(0, 0, size, size).data;
}

/** Ink box of `text` at the context's font (falls back to the advance width without metrics). */
function inkBox(ctx, text, px) {
  const m = ctx.measureText(text);
  const num = (v) => (Number.isFinite(v) ? v : null);
  const left = num(m.actualBoundingBoxLeft);
  const right = num(m.actualBoundingBoxRight);
  const ascent = num(m.actualBoundingBoxAscent);
  const descent = num(m.actualBoundingBoxDescent);
  if (left === null || right === null || ascent === null || descent === null) {
    const w = m.width || px * 0.5;
    return { left: 0, ascent: px * 0.7, w, h: px * 0.7 };
  }
  return { left: -left, ascent, w: Math.max(1e-3, left + right), h: Math.max(1e-3, ascent + descent) };
}

/** `k`: the share of Dicer's own layer square this one is (a bigger square keeps the text's size). */
function drawText(text, size, family, k = 1) {
  const ctx = newContext(size);
  const font = (px) => `${px}px "${family}", serif`;
  // Fit the ink box: a single symbol by its larger side, longer text by height then width.
  const ref = size;
  ctx.font = font(ref);
  const box = inkBox(ctx, text, ref);
  const h = TEXT_HEIGHT * size * k;
  const w = [...text].length > 1 ? TEXT_WIDTH * size * k : h;
  const px = Math.max(1, ref * Math.min(h / box.h, w / box.w));
  ctx.font = font(px);
  const ink = inkBox(ctx, text, px);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, (size - ink.w) / 2 - ink.left, (size - ink.h) / 2 + ink.ascent);
  return ctx.getImageData(0, 0, size, size).data;
}

/**
 * @param {object} [opts]
 * @param {(url: string) => Promise<ImageBitmap|HTMLImageElement>} [opts.loadImage]
 * @param {() => Promise<unknown>} [opts.loadFont] makes DM Serif Display available to canvas
 *   text (main.js loads the bundled woff); without it the text uses whatever font is loaded
 * @param {number} [opts.size] layer edge in px
 * @param {number} [opts.timeoutMs] cap on each image (and the font) load
 * @param {(msg: string, err?: unknown) => void} [opts.warn]
 */
export function createFaceTextures({
  loadImage = defaultLoadImage,
  loadFont = null,
  size = 128,
  timeoutMs = 4000,
  warn = console.warn,
} = {}) {
  const cache = new Map(); // key -> { refs, promise, result }
  const warned = new Set();
  let fontReady = null;

  const warnOnce = (id, msg, err) => {
    if (warned.has(id)) return;
    warned.add(id);
    try {
      warn(msg, err);
    } catch {
      /* a throwing logger must not break the roll */
    }
  };

  function ensureFont() {
    if (!loadFont) return Promise.resolve();
    fontReady ??= withTimeout(Promise.resolve().then(loadFont), timeoutMs, 'face font').catch(
      (err) => warnOnce('font', 'dicer: cannot load the face font; text faces use a fallback', err),
    );
    return fontReady;
  }

  const sheets = new Map(); // atlas sheet url -> its load: every frame of a die shares one
  const load = (src, shared) => {
    if (!shared) return loadImage(src);
    let p = sheets.get(src);
    if (!p) {
      sheets.set(src, (p = Promise.resolve().then(() => loadImage(src))));
      p.catch(() => sheets.delete(src)); // a failed sheet is tried again next time
    }
    return p;
  };

  async function rasterize(label, half) {
    if (label.kind === 'image') {
      const url = String(label.url ?? '');
      const { src, crop } = splitCrop(url);
      try {
        const img = await withTimeout(Promise.resolve().then(() => load(src, !!crop)), timeoutMs, url);
        return drawImage(img, size, crop);
      } catch (err) {
        warnOnce(`url:${url}`, `dicer: cannot use face image ${url}; the die shows its number`, err);
        return null;
      }
    }
    try {
      await ensureFont();
      return drawText(String(label.text ?? ''), size, FACE_FONT_FAMILY, LAYER_HALF / half);
    } catch (err) {
      warnOnce(`text`, 'dicer: cannot draw a text face; the die shows its number', err);
      return null;
    }
  }

  async function build(faceSet) {
    const labels = Array.isArray(faceSet?.labels) ? faceSet.labels : [];
    const layers = new Int16Array(labels.length).fill(-1);
    const tint = new Uint8Array(labels.length);
    const half = faceSet?.half > 0 ? faceSet.half : LAYER_HALF;
    const raster = labels.map((l) =>
      l?.kind === 'image' || l?.kind === 'text' ? rasterize(l, half) : Promise.resolve(null),
    );
    const pixels = await Promise.all(raster);
    const used = [];
    pixels.forEach((px, i) => {
      if (!px) return;
      layers[i] = used.length;
      tint[i] = labels[i].kind === 'text' || labels[i].tint === true ? 1 : 0; // a tinted image: a mask too
      used.push(px);
    });
    if (!used.length) return { texture: null, layers, tint, half };
    const layerBytes = size * size * 4;
    const data = new Uint8Array(layerBytes * used.length);
    used.forEach((px, i) => data.set(px.subarray ? px.subarray(0, layerBytes) : px, i * layerBytes));
    const texture = new THREE.DataArrayTexture(data, size, size, used.length);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return { texture, layers, tint, half };
  }

  return {
    /** @returns {Promise<{texture: THREE.DataArrayTexture|null, layers: Int16Array, tint: Uint8Array}>} */
    acquire(faceSet) {
      const key = faceSet?.key ?? '';
      let entry = cache.get(key);
      if (!entry) {
        entry = { refs: 0, result: null };
        entry.promise = build(faceSet).then(
          (result) => {
            entry.result = result;
            // Released while building: nobody will use it.
            if (cache.get(key) !== entry) result.texture?.dispose();
            return result;
          },
          (err) => {
            warnOnce(`build:${key}`, 'dicer: cannot build face textures', err);
            const n = faceSet?.labels?.length ?? 0;
            return (entry.result = { texture: null, layers: new Int16Array(n).fill(-1), tint: new Uint8Array(n) });
          },
        );
        cache.set(key, entry);
      }
      entry.refs++;
      return entry.promise;
    },

    release(faceSet) {
      const key = faceSet?.key ?? '';
      const entry = cache.get(key);
      if (!entry) return;
      entry.refs--;
      if (entry.refs > 0) return;
      cache.delete(key);
      entry.result?.texture?.dispose();
    },

    /** Number of cached face sets (for tests and diagnostics). */
    get size() {
      return cache.size;
    },
  };
}

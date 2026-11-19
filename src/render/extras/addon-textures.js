/**
 * Dice So Nice add-on textures by image file (filled by compat/installed-dice.js as add-ons call
 * addTexture), so a body image showing one is drawn the way Dice So Nice draws it
 * (render/extras/body-image.js): on metal with Dice So Nice's stronger reflections, and with its
 * bump map as a normal map. Shared by two lazy chunks, never at world start.
 */
import * as THREE from 'three';

/** image file -> { bump: its bump map's file, or null } */
export const addonTextures = new Map();

/** bump file -> { texture: THREE.Texture | null (not ready or failed), promise } */
const normals = new Map();

/** Dice So Nice's normal map strength (DiceFactory.normalMapStrength) and blur passes. */
export const NORMAL_STRENGTH = 1.5;
const BLUR_PASSES = 3;
/** The normal map's size: Dice So Nice draws a texture once per face tile at about this size. */
const SIZE = 256;

/**
 * A tangent-space normal map from a height image (white high, dark low), as Dice So Nice makes
 * one (heightCanvasToNormalCanvas): three 1-2-1 blur passes, then Sobel slopes times the strength.
 * `flipY`: the image is drawn upside down in texture space (THREE.Texture's default), so the
 * vertical slope turns. Pure: heights in, RGBA bytes out (tests run it without a canvas).
 */
export function normalFromHeights(heights, w, h, { strength = NORMAL_STRENGTH, flipY = true } = {}) {
  let src = Float32Array.from(heights);
  let tmp = new Float32Array(w * h);
  for (let pass = 0; pass < BLUR_PASSES; pass++) {
    const mid = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        mid[i] = (src[x > 0 ? i - 1 : i] + 2 * src[i] + src[x < w - 1 ? i + 1 : i]) * 0.25;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        tmp[i] = (mid[y > 0 ? i - w : i] + 2 * mid[i] + mid[y < h - 1 ? i + w : i]) * 0.25;
      }
    [src, tmp] = [tmp, src];
  }
  const at = (x, y) => src[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -gx * strength;
      let ny = (flipY ? gy : -gy) * strength; // canvas y runs down; a flipped texture's v runs up
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (y * w + x) * 4;
      out[o] = (nx * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * 0.5 + 0.5) * 255;
      out[o + 2] = (nz * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  return out;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${url}`));
    img.src = url;
  });
}

/** Builds (once) the normal map of a bump image; the texture is set on the entry when ready. */
export function loadNormal(bump, { load = loadImage, doc = globalThis.document } = {}) {
  let entry = normals.get(bump);
  if (entry) return entry.promise;
  entry = { texture: null };
  entry.promise = Promise.resolve()
    .then(() => load(bump))
    .then((img) => {
      const canvas = doc.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
      const heights = new Float32Array(SIZE * SIZE);
      for (let i = 0; i < heights.length; i++) heights[i] = rgba[i * 4] / 255;
      ctx.putImageData(new ImageData(normalFromHeights(heights, SIZE, SIZE), SIZE, SIZE), 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      entry.texture = texture;
      return texture;
    })
    .catch(() => null); // no relief: the die keeps its flat body image
  normals.set(bump, entry);
  return entry.promise;
}

/** A body image file's normal map when its texture came with a bump map and it is built; else null. */
export function normalFor(src) {
  const bump = addonTextures.get(src)?.bump;
  if (!bump) return null;
  const entry = normals.get(bump);
  if (!entry) void loadNormal(bump);
  return entry?.texture ?? null;
}

/** Forgets every texture and normal map (tests). */
export function resetAddonTextures() {
  addonTextures.clear();
  for (const e of normals.values()) e.texture?.dispose();
  normals.clear();
}

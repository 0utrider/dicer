import * as THREE from 'three';

/**
 * Soft sprite masks generated in code (no image files). Each is an RGBA8 coverage mask with
 * R=G=B=A, so a shader can read any channel. Pixels come from deterministic hash noise (no
 * Math.random) and are built straight into a Uint8Array DataTexture, so no canvas/DOM is needed.
 * The CPU data stays on `texture.image.data`, which is what lets a WebGL context restore re-upload.
 * Textures are lazy and cached per kind; `disposeTextures()` frees them all (the particle pool calls
 * it on dispose).
 */
export const TEX = Object.freeze({
  GLOW: 'glow',
  PUFF: 'puff',
  SPARK: 'spark',
  FLAME: 'flame',
  SHARD: 'shard',
});

const SIZES = Object.freeze({
  [TEX.GLOW]: [64, 64],
  [TEX.PUFF]: [128, 128],
  [TEX.SPARK]: [64, 64],
  [TEX.FLAME]: [64, 128],
  [TEX.SHARD]: [64, 64],
});

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function hash(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, seed + o);
    norm += amp;
    x *= 2;
    y *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

// Coverage functions: u,v in -1..1 across the texture (+v up), result 0..1.
const GENERATORS = {
  [TEX.GLOW]: (u, v) => {
    const r2 = u * u + v * v;
    // Gaussian falloff, forced to exactly 0 at the quad edge so it never shows a seam.
    return r2 >= 1 ? 0 : Math.exp(-r2 * 6) * smooth(1, 0.8, Math.sqrt(r2));
  },
  [TEX.PUFF]: (u, v) => {
    const r = Math.hypot(u, v);
    const disc = 1 - smooth(0.25, 0.95, r);
    const n = fbm(u * 2.6 + 5, v * 2.6 + 5, 4, 11);
    // Billowy: noise erodes the soft disc, never a hard edge.
    return clamp01(disc * (0.35 + 1.1 * n));
  },
  [TEX.SPARK]: (u, v) => {
    const r = Math.hypot(u, v);
    const core = Math.exp(-r * r * 40);
    const ray = (a, b) => Math.exp(-(b * b) * 900) * (1 - smooth(0.0, 0.95, Math.abs(a)));
    const rays = Math.max(ray(u, v), ray(v, u));
    return clamp01(core + rays * (1 - smooth(0.2, 1, r)) * 1.2);
  },
  [TEX.FLAME]: (u, v) => {
    // v up; teardrop: wide near the bottom, narrowing to a noisy tip.
    const t = clamp01((v + 1) / 2);
    const half = 0.62 * Math.pow(1 - t, 0.8) * smooth(0.0, 0.18, t + 0.05) + 0.02;
    const wob = (fbm(u * 3 + 2, v * 3, 3, 23) - 0.5) * 0.45 * t;
    const d = Math.abs(u - wob) / half;
    const body = 1 - smooth(0.45, 1.0, d);
    return clamp01(body * (1 - smooth(0.9, 1.0, t)) * (0.75 + 0.5 * (1 - t)));
  },
  [TEX.SHARD]: (u, v) => {
    // Irregular triangle (distorted vertices) with a soft fill and one bright edge.
    const P = [[-0.15, 0.85], [0.8, -0.7], [-0.75, -0.45]];
    let inside = 1;
    let bright = 0;
    for (let i = 0; i < 3; i++) {
      const [ax, ay] = P[i];
      const [bx, by] = P[(i + 1) % 3];
      const ex = bx - ax;
      const ey = by - ay;
      const len = Math.hypot(ex, ey);
      const dist = -(ex * (v - ay) - ey * (u - ax)) / len; // signed, + inside (the winding is clockwise)
      inside = Math.min(inside, dist);
      if (i === 1) bright = dist;
    }
    const cover = smooth(0, 0.06, inside);
    const facet = 0.45 + 0.25 * fbm(u * 4, v * 4, 2, 37);
    const edge = Math.exp(-bright * bright * 120) * 0.9;
    return clamp01(cover * clamp01(facet + edge));
  },
};

function build(kind) {
  const size = SIZES[kind];
  if (!size) throw new Error(`Unknown texture kind: ${kind}`);
  const [w, h] = size;
  const gen = GENERATORS[kind];
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = ((x + 0.5) / w) * 2 - 1;
      const v = ((y + 0.5) / h) * 2 - 1;
      const a = Math.round(clamp01(gen(u, v)) * 255);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const cache = new Map();

export function getTexture(kind) {
  let t = cache.get(kind);
  if (!t) {
    t = build(kind);
    cache.set(kind, t);
  }
  return t;
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

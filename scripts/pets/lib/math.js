/**
 * Small maths for the pet builders: scalars, 3-vectors as plain arrays [x, y, z], colours and
 * deterministic value noise. No three.js, no DOM.
 */

export const DEG = Math.PI / 180;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
/** Smoothstep from a to b (a > b gives a falling edge). */
export const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mix = (a, b, t) => a + (b - a) * t;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => scl(a, 1 / (len(a) || 1));
export const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
/** v turned by angle a about the unit axis k (Rodrigues). */
export function rotateAbout(v, k, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(scl(v, c), scl(cross(k, v), s)), scl(k, dot(k, v) * (1 - c)));
}
/** An sRGB colour from 0..255 bytes, as 0..1 floats (still sRGB). */
export const srgb = (r, g, b) => [r / 255, g / 255, b / 255];
/** sRGB 0..1 -> linear 0..1 (vertex colours are linear in three.js and glTF). */
export const toLinear = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));

/** Integer hash -> 0..1. */
export function hash(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
/** Smooth 3D value noise, 0..1, one cell per unit. */
export function vnoise(x, y, z) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const fx = x - i;
  const fy = y - j;
  const fz = z - k;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash(i, j, k), hash(i + 1, j, k), u), l(hash(i, j + 1, k), hash(i + 1, j + 1, k), u), v),
    l(
      l(hash(i, j, k + 1), hash(i + 1, j, k + 1), u),
      l(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), u),
      v,
    ),
    w,
  );
}
/** Three octaves of value noise, 0..1. */
export const fbm = (x, y, z) =>
  0.55 * vnoise(x, y, z) + 0.3 * vnoise(x * 2.1, y * 2.1, z * 2.1) + 0.15 * vnoise(x * 4.3, y * 4.3, z * 4.3);
/** Periodic stripes: 1 in a stripe of width `duty` (0..1 of the period), soft edges. */
export function band(v, duty = 0.3, soft = 0.08) {
  const f = v - Math.floor(v);
  const d = Math.abs(f - 0.5) * 2;
  return sstep(duty + soft, duty - soft, d);
}

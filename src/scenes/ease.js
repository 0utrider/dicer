// Timing helpers for the crit scenes. Private copies (the pet chunk has its own): a module shared
// by two lazy chunks would be split into a chunk of its own, counted in the world-start download.

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** 0 before `a` ms, 1 after `b` ms, linear between. */
export const span = (t, a, b) => clamp01((t - a) / (b - a));
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) ** 3;
export const easeIn = (t) => t * t * t;
/** Overshoots a little past 1, then settles: a pop. */
export const outBack = (t, k = 1.7) => 1 + (k + 1) * (t - 1) ** 3 + k * (t - 1) ** 2;
/** 0 -> 1 -> 0 over [0, 1]. */
export const bump = (t) => Math.sin(Math.PI * clamp01(t));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Geometries and materials a scene made, freed together. */
export function createKit() {
  const items = [];
  return {
    add(x) {
      items.push(x);
      return x;
    },
    dispose() {
      for (const x of items) x?.dispose?.();
      items.length = 0;
    },
  };
}

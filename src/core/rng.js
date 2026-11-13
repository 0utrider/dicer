/**
 * The edge a seeded throw spawns from: 0 = +x, 1 = -x, 2 = +z, 3 = -z. It is the first draw of
 * the seed's stream, which the worker's sim takes for its spawn side.
 */
export function throwEdge(seed) {
  return Math.floor(mulberry32(seed)() * 4);
}

/** Deterministic 32-bit PRNG. Returns a function yielding floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

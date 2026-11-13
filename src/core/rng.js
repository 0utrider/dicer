/**
 * The edge a seeded throw spawns from: 0 = +x, 1 = -x, 2 = +z, 3 = -z. It is the first draw of
 * the seed's stream, which the worker's sim takes for its spawn side.
 */
export function throwEdge(seed) {
  return Math.floor(mulberry32(seed)() * 4);
}

/**
 * The edge of a hand throw (as throwEdge): the side of `area` whose wall the mean release point of
 * `launch` (entries with a pos) is nearest to. No release point: the area centre.
 */
export function handEdge(launch, { cx = 0, cz = 0, halfWidth, halfDepth }) {
  const ps = (launch ?? []).filter((l) => l?.pos);
  const mean = (k, c) => ps.reduce((s, l) => s + l.pos[k], 0) / ps.length - c || 0;
  const x = mean(0, cx);
  const z = mean(2, cz);
  const d = [halfWidth - x, halfWidth + x, halfDepth - z, halfDepth + z];
  return d.indexOf(Math.min(...d));
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

/**
 * The edge of a hand throw (as core/rng.js throwEdge: 0 = +x, 1 = -x, 2 = +z, 3 = -z): the side of
 * `area` whose wall the mean release point of `launch` (entries with a pos) is nearest to. No
 * release point: the area centre. Lazy hand chunk only.
 */
export function handEdge(launch, { cx = 0, cz = 0, halfWidth, halfDepth }) {
  const ps = (launch ?? []).filter((l) => l?.pos);
  const mean = (k, c) => ps.reduce((s, l) => s + l.pos[k], 0) / ps.length - c || 0;
  const x = mean(0, cx);
  const z = mean(2, cz);
  const d = [halfWidth - x, halfWidth + x, halfDepth - z, halfDepth + z];
  return d.indexOf(Math.min(...d));
}

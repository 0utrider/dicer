import { getShape } from '../core/dice-shapes.js';
import { buildDieGeometry } from '../core/chamfer.js';

export const HULL_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

/** Deduplicated vertex positions of a die's chamfered visual geometry (its exact visual hull). */
export function hullPointsFor(type) {
  const pos = buildDieGeometry(getShape(type)).getAttribute('position');
  const seen = new Set();
  const out = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x, y, z);
  }
  return new Float32Array(out);
}

/**
 * Main-thread helper: hull point arrays for every polyhedron type, sent to the worker with
 * `init` so the worker never needs three.js. The coin uses a cylinder and needs no hull.
 * @returns {Record<string, Float32Array>}
 */
export function computeHulls(types = HULL_TYPES) {
  return Object.fromEntries(types.map((t) => [t, hullPointsFor(t)]));
}

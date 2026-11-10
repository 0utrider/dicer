import { getShape } from '../core/dice-shapes.js';
import { minkowskiHull } from '../core/chamfer.js';

export const HULL_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

/**
 * Physics hull of a die (P2-R4): the exact Minkowski solid its rounded visual mesh
 * approximates, i.e. the shrunk polyhedron's vertices plus a border radius, for
 * `RAPIER.ColliderDesc.roundConvexHull(points, radius)`. Same defaults as the visual geometry.
 * @returns {{ points: Float32Array, radius: number }}
 */
export function hullPointsFor(type) {
  const { points, radius } = minkowskiHull(getShape(type));
  return { points: new Float32Array(points.flat()), radius };
}

/**
 * Main-thread helper: hulls for every polyhedron type, sent to the worker with `init` so the
 * worker never needs three.js. The coin uses a cylinder and needs no hull.
 * @returns {Record<string, { points: Float32Array, radius: number }>}
 */
export function computeHulls(types = HULL_TYPES) {
  return Object.fromEntries(types.map((t) => [t, hullPointsFor(t)]));
}

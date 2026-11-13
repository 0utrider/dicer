/** Pure spot logic for the pet layer: edge spots, resting spots, the hop off, obstacle footprints. */

/** The outward direction of each throw edge: +x, -x, +z, -z. */
export const OUT = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
export const INSET = 0.6; // of the creature's height, in from the area edge, for the edge spot
export const SLIDE = 1.5; // of the height, how far outside the edge a pet hops in from / out to
export const EDGE_GAP = 1.2; // of the height: a resting spot is at least this far from every edge
export const SPACING = 2; // of the height: a resting spot is at least this far from any other pet
export const INNER = 0.6; // the middle share of the area, where the dice aim, kept clear
export const TRIES = 24;
export const FOOTPRINT = 0.45; // of the height: an obstacle's radius
/** The standing height of every creature (creatures/*.js; a test keeps this in step). */
export const PET_HEIGHT = 1.5;
/** Each kind's `footprint` (creatures/*.js), for a pet not made yet; a test keeps these in step. */
export const KIND_FOOTPRINT = { mimic: 0.95, slime: 1.0, dragonling: 0.85 };

/** The spot a pet stands on at `edge` of `area`, its outward direction and the yaw facing in. */
export function edgeSpot(edge, area, height) {
  const out = OUT[edge] || OUT[0];
  const half = edge < 2 ? area.halfWidth : area.halfDepth;
  const d = half - INSET * height;
  return {
    out,
    base: { x: area.cx + out[0] * d, z: area.cz + out[1] * d },
    inward: Math.atan2(-out[0], -out[1]),
  };
}

/** The obstacle the physics sees for a pet of `height` standing at `at` (puddles are not obstacles). */
/** r is the creature's own `footprint` (scene units) or FOOTPRINT x height. */
export const obstacle = (at, height, id, footprint) => ({ x: at.x, z: at.z, r: footprint ?? FOOTPRINT * height, h: height, id });

/**
 * How well a spot honours the rules, as the smallest slack over them: >= 0 is valid (the inner
 * 60% needs > 0), negative is how far the worst rule is broken. Edges, the inner 60%, spacing.
 */
function slack(area, height, taken, x, z) {
  const dx = Math.abs(x - area.cx);
  const dz = Math.abs(z - area.cz);
  const m = EDGE_GAP * height;
  let s = Math.min(area.halfWidth - m - dx, area.halfDepth - m - dz);
  s = Math.min(s, Math.max(dx - INNER * area.halfWidth, dz - INNER * area.halfDepth) - 1e-9);
  for (const o of taken) s = Math.min(s, Math.hypot(x - o.x, z - o.z) - SPACING * height);
  return s;
}

/**
 * A random resting spot for a pet of `height` in `area` ({cx, cz, halfWidth, halfDepth}): at least
 * 1.2 x height from every edge, outside the inner 60% (|x - cx| > 0.6 halfWidth or
 * |z - cz| > 0.6 halfDepth), and at least 2 x height from each of `taken` ({x, z}: the other
 * pets and puddles). Seeded rejection sampling with `rand`: the first of 24 valid tries; if none
 * is valid (a crowded or tiny area), the candidate farthest from breaking a rule, never a throw.
 */
export function restSpot(area, height, taken, rand) {
  const ex = Math.max(0, area.halfWidth - EDGE_GAP * height);
  const ez = Math.max(0, area.halfDepth - EDGE_GAP * height);
  let best = null;
  let bestSlack = -Infinity;
  for (let i = 0; i < TRIES; i++) {
    const x = area.cx + (rand() * 2 - 1) * ex;
    const z = area.cz + (rand() * 2 - 1) * ez;
    const s = slack(area, height, taken, x, z);
    if (s >= 0) return { x, z };
    if (s > bestSlack) {
      bestSlack = s;
      best = { x, z };
    }
  }
  return best ?? { x: area.cx, z: area.cz }; // a NaN rand never yields null
}

/** Where a pet at `from` hops to leave: straight out through the area's edge, then SLIDE beyond. */
export function offPoint(area, from, height) {
  let dx = from.x - area.cx;
  let dz = from.z - area.cz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) [dx, dz] = OUT[0];
  else (dx /= len), (dz /= len);
  const reach = (half, d, p) => (Math.abs(d) < 1e-6 ? Infinity : (half - Math.abs(p)) / Math.abs(d));
  const t = Math.min(reach(area.halfWidth, dx, from.x - area.cx), reach(area.halfDepth, dz, from.z - area.cz));
  const go = Math.max(0, t) + SLIDE * height;
  return { x: from.x + dx * go, z: from.z + dz * go };
}

/**
 * `area` held inside `stage` (both {cx, cz, halfWidth, halfDepth}): shrunk to fit, then shifted in.
 * A pet's remembered roll area may no longer fit after a resize.
 */
export function fitArea(area, stage) {
  const halfWidth = Math.min(area.halfWidth, stage.halfWidth);
  const halfDepth = Math.min(area.halfDepth, stage.halfDepth);
  const pin = (c, h, sc, sh) => Math.max(sc - sh + h, Math.min(sc + sh - h, c));
  return {
    cx: pin(area.cx, halfWidth, stage.cx ?? 0, stage.halfWidth),
    cz: pin(area.cz, halfDepth, stage.cz ?? 0, stage.halfDepth),
    halfWidth,
    halfDepth,
  };
}

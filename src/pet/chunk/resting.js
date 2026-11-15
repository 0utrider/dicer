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
/**
 * A resting spot sits in this ring of the area: 0.35 <= max(|x - cx| / halfWidth, |z - cz| / halfDepth)
 * <= 0.6. Close enough to the middle that the dice (which aim there) can hit it, far enough that it
 * is not underfoot. Owner decision 2026-11-13.
 */
export const RING_IN = 0.35;
export const RING_OUT = 0.6;
export const TRIES = 24;
export const FOOTPRINT = 0.45; // of the height: an obstacle's radius
export const BODY = 0.65; // of the height: the drawn pet's half-width, kept off Foundry's UI
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
 * How well a spot honours the rules, as the smallest slack over them: >= 0 is valid, negative is
 * how far the worst rule is broken. Edges, the 35-60% ring, spacing, Foundry's UI.
 */
function slack(area, height, taken, x, z, avoid) {
  const dx = Math.abs(x - area.cx);
  const dz = Math.abs(z - area.cz);
  const m = EDGE_GAP * height;
  let s = Math.min(area.halfWidth - m - dx, area.halfDepth - m - dz);
  s = Math.min(s, Math.max(dx - RING_IN * area.halfWidth, dz - RING_IN * area.halfDepth)); // outside the inner part
  s = Math.min(s, Math.min(RING_OUT * area.halfWidth - dx, RING_OUT * area.halfDepth - dz)); // inside the outer
  for (const o of taken) s = Math.min(s, Math.hypot(x - o.x, z - o.z) - SPACING * height);
  for (const r of avoid) {
    // the signed distance from the spot to the rectangle (negative inside), less the pet's body
    const ox = Math.max(r.x0 - x, x - r.x1);
    const oz = Math.max(r.z0 - z, z - r.z1);
    const d = ox > 0 || oz > 0 ? Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) : Math.max(ox, oz);
    s = Math.min(s, d - BODY * height - 1e-9);
  }
  return s;
}

/**
 * A random resting spot for a pet of `height` in `area` ({cx, cz, halfWidth, halfDepth}): at least
 * 1.2 x height from every edge, in the 35-60% ring (RING_IN <= max(|x - cx| / halfWidth,
 * |z - cz| / halfDepth) <= RING_OUT), and at least 2 x height from each of `taken` ({x, z}: the other
 * pets and puddles), with the pet's body (BODY x height) off each of `avoid` ({x0, x1, z0, z1}:
 * Foundry's UI in die units), and, given `clear` ((p: {x, z}) => boolean: off a hand replay's die
 * paths, R7), where it is true. Seeded rejection sampling with `rand`: the first of 24 valid tries;
 * if none is, (a crowded or tiny area) the candidate farthest from breaking a rule (one `clear`
 * refuses counts as worse than any other), never a throw.
 */
export function restSpot(area, height, taken, rand, avoid = [], clear = null) {
  const ex = Math.max(0, Math.min(area.halfWidth - EDGE_GAP * height, RING_OUT * area.halfWidth));
  const ez = Math.max(0, Math.min(area.halfDepth - EDGE_GAP * height, RING_OUT * area.halfDepth));
  let best = null;
  let bestSlack = -Infinity;
  for (let i = 0; i < TRIES; i++) {
    const x = area.cx + (rand() * 2 - 1) * ex;
    const z = area.cz + (rand() * 2 - 1) * ez;
    let s = slack(area, height, taken, x, z, avoid);
    if (clear && !clear({ x, z })) s = Math.min(s, 0) - 1e6;
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

/** Whether a spot is still a valid resting place of `area`: clear of the edges and in the ring. */
export function inRestRing(area, height, at) {
  const dx = Math.abs(at.x - area.cx);
  const dz = Math.abs(at.z - area.cz);
  const m = EDGE_GAP * height;
  if (dx > area.halfWidth - m + 1e-9 || dz > area.halfDepth - m + 1e-9) return false;
  const r = Math.max(dx / area.halfWidth, dz / area.halfDepth);
  return r >= RING_IN - 1e-9 && r <= RING_OUT + 1e-9;
}

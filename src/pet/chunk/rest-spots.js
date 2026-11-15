/** Where resting pets sit on this screen (the client setting petRestSpot): pure spot logic. */
import { EDGE_GAP, SPACING, BODY } from './resting.js';

/** The setting's choices: 'dice' rests in the ring around the roll area (resting.js restSpot). */
export const REST_SPOTS = ['dice', 'bottomLeft', 'bottomRight', 'topLeft', 'topRight', 'bottomCentre'];
/** Each corner or edge choice's side of the table: x (-1 left, 0 centre, 1 right), z (-1 top, 1 bottom). */
const SIDE = {
  bottomLeft: [-1, 1],
  bottomRight: [1, 1],
  topLeft: [-1, -1],
  topRight: [1, -1],
  bottomCentre: [0, 1],
};
/** Whether `choice` is a corner or edge spot (not 'dice' or unknown): cheap, no search. */
export const atEdge = (choice) => Object.hasOwn(SIDE, choice);
const SLOTS = 3; // MAX_PETS: the whole row is kept clear, so every pet's slot is the same row
const STEP = 0.25; // of the height: how far a row is pushed per try, off Foundry's UI
/** A slot's place along the row, in spacings: from the corner inward, or centred (0, -1, +1). */
const along = (sx, k) => (sx ? -sx * k : [0, -1, 1][k]);

/**
 * The `slot`-th (0..2) resting spot of `choice` for a pet of `height` on `stage` ({cx, cz,
 * halfWidth, halfDepth}, die units): null for 'dice', an unknown choice or no stage (the layer then
 * uses restSpot's ring). Slots sit side by side in one row along the edge, SPACING x height apart,
 * starting EDGE_GAP x height in from the corner (bottomCentre: the first in the middle, then left
 * and right). The whole row keeps the pet's body (BODY x height) off each of `uiRects` ({x0, x1,
 * z0, z1}: Foundry's UI in die units) and EDGE_GAP x height inside the stage: pushed in from the
 * corner (bottomCentre: up only, so it stays centred) by the least distance that clears it. A table
 * too small for that gives the try nearest to clearing, held inside the stage. Never throws.
 */
export function spotFor(choice, slot, stage, height, uiRects = []) {
  const side = Object.hasOwn(SIDE, choice) ? SIDE[choice] : null;
  if (!side || !stage || !(stage.halfWidth > 0) || !(stage.halfDepth > 0)) return null;
  const [sx, sz] = side;
  const cx = stage.cx ?? 0;
  const cz = stage.cz ?? 0;
  const { halfWidth: hw, halfDepth: hd } = stage;
  const m = EDGE_GAP * height;
  const gap = SPACING * height;
  const body = BODY * height;
  const k = Math.max(0, Math.min(SLOTS - 1, Math.floor(slot) || 0));
  const ax = cx + sx * (hw - m); // the nominal first slot
  const az = cz + sz * (hd - m);
  const rects = Array.isArray(uiRects) ? uiRects : [];
  /** The smallest slack of the row pushed in by (dx, dz): >= 0 is clear of the edges and the UI. */
  const slack = (dx, dz) => {
    let s = Infinity;
    const z = az - sz * dz;
    for (let i = 0; i < SLOTS; i++) {
      const x = ax - sx * dx + along(sx, i) * gap;
      s = Math.min(s, hw - m - Math.abs(x - cx), hd - m - Math.abs(z - cz));
      for (const r of rects) {
        const ox = Math.max(r.x0 - x, x - r.x1);
        const oz = Math.max(r.z0 - z, z - r.z1);
        const d = ox > 0 || oz > 0 ? Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) : Math.max(ox, oz);
        s = Math.min(s, d - body);
      }
    }
    return s;
  };
  const step = STEP * height;
  const nx = sx ? Math.ceil((2 * hw) / step) : 0;
  const nz = Math.ceil((2 * hd) / step);
  let push = null;
  let pushD = Infinity;
  let near = [0, 0];
  let nearS = -Infinity;
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const d = Math.hypot(i, j);
      if (d >= pushD) continue;
      const s = slack(i * step, j * step);
      if (s >= -1e-9) {
        push = [i * step, j * step];
        pushD = d;
      } else if (s > nearS) {
        nearS = s;
        near = [i * step, j * step];
      }
    }
  const [dx, dz] = push ?? near;
  const pin = (v, c, h) => Math.max(c - h, Math.min(c + h, v));
  return {
    x: pin(ax - sx * dx + along(sx, k) * gap, cx, hw),
    z: pin(az - sz * dz, cz, hd),
  };
}

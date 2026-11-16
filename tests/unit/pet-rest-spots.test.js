import * as THREE from 'three';
import { buildScene, FOV_DEG } from '../../src/render/scene.js';
import { CREATURES } from '../../src/pet/chunk/creatures/index.js';
import { spotFor, REST_SPOTS, LEGACY_SPOTS, atEdge, placedSpot, toPlaced, validAt, TAN_HALF_FOV } from '../../src/pet/chunk/rest-spots.js';
import { SPACING, EDGE_GAP, BODY, PET_HEIGHT } from '../../src/pet/chunk/resting.js';

const H = PET_HEIGHT;
const PX = 48; // px per die unit
// A 1280 x 800 table area (the window less the sidebar), in die units from its centre.
const STAGE = { cx: 0, cz: 0, halfWidth: 640 / PX, halfDepth: 400 / PX };
/** A page px rectangle on that stage, in die units from its centre (as the layer's uiRects()). */
const rect = (left, top, width, height) => ({
  x0: (left - 640) / PX,
  x1: (left + width - 640) / PX,
  z0: (top - 400) / PX,
  z1: (top + height - 400) / PX,
});
// Foundry v14's UI over the board: scene controls, navigation, players list, macro bar.
const UI = [rect(0, 0, 60, 800), rect(70, 10, 520, 40), rect(10, 640, 230, 150), rect(380, 720, 520, 70)];
const CORNERS = ['bottomLeft', 'bottomRight', 'topLeft', 'topRight', 'bottomCentre'];

/** Signed distance from (x, z) to the rectangle: negative inside. */
const away = (p, r) => {
  const ox = Math.max(r.x0 - p.x, p.x - r.x1);
  const oz = Math.max(r.z0 - p.z, p.z - r.z1);
  return ox > 0 || oz > 0 ? Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) : Math.max(ox, oz);
};

test("the choices are the setting's, 'dice' first; the 0.2 corners are legacy, still placed", () => {
  expect(REST_SPOTS).toEqual(['dice', 'placed']);
  expect(LEGACY_SPOTS).toEqual(CORNERS);
  expect(LEGACY_SPOTS.filter(atEdge)).toEqual(CORNERS);
  expect(atEdge('placed')).toBe(false);
  expect(atEdge(undefined) || atEdge('toString')).toBe(false);
});

test("'dice' (and anything unknown) gives null: the layer uses the roll-area ring", () => {
  for (const slot of [0, 1, 2]) {
    expect(spotFor('dice', slot, STAGE, H, UI)).toBeNull();
    expect(spotFor('nowhere', slot, STAGE, H, UI)).toBeNull();
    expect(spotFor(undefined, slot, STAGE, H, UI)).toBeNull();
  }
  expect(spotFor('bottomLeft', 0, null, H, UI)).toBeNull(); // no stage yet
});

describe.each([[[]], [UI]])('with UI rects %#', (ui) => {
  test.each(CORNERS)('%s: three distinct slots inside the table, spaced, off the UI', (choice) => {
    const slots = [0, 1, 2].map((k) => spotFor(choice, k, STAGE, H, ui));
    const m = EDGE_GAP * H;
    for (const s of slots) {
      expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
      expect(Math.abs(s.x - STAGE.cx)).toBeLessThanOrEqual(STAGE.halfWidth - m + 1e-9);
      expect(Math.abs(s.z - STAGE.cz)).toBeLessThanOrEqual(STAGE.halfDepth - m + 1e-9);
      for (const r of ui) expect(away(s, r)).toBeGreaterThanOrEqual(BODY * H - 1e-9);
    }
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++)
        expect(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z)).toBeGreaterThanOrEqual(SPACING * H - 1e-9);
    // side by side along the edge: one row
    expect(slots[1].z).toBeCloseTo(slots[0].z, 9);
    expect(slots[2].z).toBeCloseTo(slots[0].z, 9);
  });
});

test('each spot is in its own part of the table; the first slot nearest the corner', () => {
  const s = (c, k = 0) => spotFor(c, k, STAGE, H, []);
  expect(s('bottomLeft').x).toBeLessThan(0);
  expect(s('bottomLeft').z).toBeGreaterThan(0);
  expect(s('bottomRight').x).toBeGreaterThan(0);
  expect(s('bottomRight').z).toBeGreaterThan(0);
  expect(s('topLeft').x).toBeLessThan(0);
  expect(s('topLeft').z).toBeLessThan(0);
  expect(s('topRight').x).toBeGreaterThan(0);
  expect(s('topRight').z).toBeLessThan(0);
  expect(s('bottomCentre').z).toBeGreaterThan(0);
  // the row goes in from the corner
  expect(s('bottomLeft', 1).x).toBeGreaterThan(s('bottomLeft', 0).x);
  expect(s('bottomRight', 1).x).toBeLessThan(s('bottomRight', 0).x);
  // with nothing in the way the corner slot sits EDGE_GAP x height in from both edges
  expect(s('topRight').x).toBeCloseTo(STAGE.halfWidth - EDGE_GAP * H, 9);
  expect(s('topRight').z).toBeCloseTo(-STAGE.halfDepth + EDGE_GAP * H, 9);
});

test('bottomCentre slots are centred on x: the first in the middle, the others either side', () => {
  for (const ui of [[], UI]) {
    const [a, b, c] = [0, 1, 2].map((k) => spotFor('bottomCentre', k, STAGE, H, ui));
    expect(a.x).toBeCloseTo(STAGE.cx, 9);
    expect(b.x + c.x).toBeCloseTo(2 * STAGE.cx, 9);
    expect(Math.abs(b.x - a.x)).toBeCloseTo(SPACING * H, 9);
  }
  // an off-centre stage: centred on its middle
  const off = { ...STAGE, cx: 3 };
  expect(spotFor('bottomCentre', 0, off, H, []).x).toBeCloseTo(3, 9);
});

test('the macro bar and players list push the bottom rows up or in, never under them', () => {
  const free = spotFor('bottomCentre', 0, STAGE, H, []);
  const ui = spotFor('bottomCentre', 0, STAGE, H, UI);
  expect(ui.z).toBeLessThan(free.z); // above the macro bar
  const bl = spotFor('bottomLeft', 0, STAGE, H, UI);
  const blFree = spotFor('bottomLeft', 0, STAGE, H, []);
  expect(bl.x !== blFree.x || bl.z !== blFree.z).toBe(true);
});

test('the same inputs give the same spot (no randomness)', () => {
  for (const c of CORNERS) expect(spotFor(c, 1, STAGE, H, UI)).toEqual(spotFor(c, 1, STAGE, H, UI));
});

test('a stage too small for the row still gives finite spots inside it, never a throw', () => {
  const tiny = { cx: 0, cz: 0, halfWidth: 2, halfDepth: 2 };
  for (const c of CORNERS)
    for (const k of [0, 1, 2]) {
      const s = spotFor(c, k, tiny, H, [{ x0: -5, x1: 5, z0: -5, z1: 5 }]);
      expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(2);
    }
});

// ---- fix round 1: the drawn pet, turned any way and seen through Dicer's camera, clears the UI ----
const UI_PX = [
  [0, 0, 60, 800],
  [70, 10, 520, 40],
  [10, 640, 230, 150],
  [380, 720, 520, 70],
];
test('every creature at every slot, turned any way, draws clear of the UI rects (real meshes, real camera)', () => {
  const { camera, fitArea } = buildScene();
  fitArea(STAGE);
  const v = new THREE.Vector3();
  const MARGIN = 2; // px
  let worst = Infinity;
  for (const make of Object.values(CREATURES)) {
    const c = make('#ffffff');
    try {
      c.pose('exit', 1, 'plain', { yaw: 0 }); // the resting pose
    } catch {
      /* a creature without poses keeps its build pose */
    }
    const group = new THREE.Group();
    group.add(c.root);
    for (const choice of CORNERS)
      for (const k of [0, 1, 2]) {
        const s = spotFor(choice, k, STAGE, H, UI);
        for (let a = 0; a < 8; a++) {
          group.position.set(s.x, 0, s.z);
          group.rotation.y = (a / 8) * Math.PI * 2;
          group.updateMatrixWorld(true);
          group.traverse((o) => {
            if (!o.isMesh || !o.visible) return;
            const p = o.geometry.attributes.position;
            for (let i = 0; i < p.count; i++) {
              v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).project(camera);
              const px = ((v.x + 1) / 2) * 1280;
              const py = ((1 - v.y) / 2) * 800;
              for (const [l, t, w, h] of UI_PX) {
                const out = Math.max(l - px, px - (l + w), t - py, py - (t + h));
                worst = Math.min(worst, out);
              }
            }
          });
        }
      }
    c.dispose();
  }
  expect(worst).toBeGreaterThanOrEqual(MARGIN);
});

test("TAN_HALF_FOV is in step with Dicer's camera", () => {
  expect(TAN_HALF_FOV).toBeCloseTo(Math.tan(((FOV_DEG / 2) * Math.PI) / 180), 12);
});

// ---- 'placed': where the player last dropped a pet ----
test('validAt takes {x, z} within -1..1 only', () => {
  expect(validAt({ x: 0.5, z: -1 })).toBe(true);
  for (const bad of [null, undefined, {}, { x: 2, z: 0 }, { x: 0, z: NaN }, { x: '0', z: 0 }]) expect(validAt(bad)).toBe(false);
});

test('toPlaced and placedSpot round-trip a point, slot 0 right there', () => {
  const p = { x: 3, z: -2 };
  const at = toPlaced(p, STAGE);
  expect(at.x).toBeCloseTo(3 / STAGE.halfWidth, 9);
  const s = placedSpot(at, 0, STAGE, H);
  expect(s.x).toBeCloseTo(3, 9);
  expect(s.z).toBeCloseTo(-2, 9);
  expect(toPlaced({ x: 1e6, z: -1e6 }, STAGE)).toEqual({ x: 1, z: -1 }); // held inside the stage
});

test('placedSpot: the other slots beside slot 0, SPACING x height apart, all inside the stage', () => {
  const at = { x: 0, z: 0.5 };
  const [a, b, c] = [0, 1, 2].map((k) => placedSpot(at, k, STAGE, H));
  expect(b.x).toBeCloseTo(a.x - SPACING * H, 9);
  expect(c.x).toBeCloseTo(a.x + SPACING * H, 9);
  expect(b.z).toBe(a.z);
  // at the right edge: held EDGE_GAP in, and the slot that would leave the stage goes the other way
  const edge = [0, 1, 2].map((k) => placedSpot({ x: 1, z: 1 }, k, STAGE, H));
  const m = EDGE_GAP * H;
  for (const s of edge) {
    expect(Math.abs(s.x)).toBeLessThanOrEqual(STAGE.halfWidth - m + 1e-9);
    expect(Math.abs(s.z)).toBeLessThanOrEqual(STAGE.halfDepth - m + 1e-9);
  }
  expect(new Set(edge.map((s) => s.x.toFixed(6))).size).toBe(2); // slots 0 and 2 meet at the edge: two places
  expect(placedSpot(null, 0, STAGE, H)).toBeNull();
  expect(placedSpot(at, 0, null, H)).toBeNull();
});

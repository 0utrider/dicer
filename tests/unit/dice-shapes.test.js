import { getShape, dieTypeForFaces, labelFor } from '../../src/core/dice-shapes.js';
import { faceNormals } from '../../src/core/face-reader.js';
import { computeHulls } from '../../src/physics/hulls.js';
// Today's shapes and hulls, frozen before dice designs plan 4 (G2: they must not change).
import FROZEN from './fixtures/shapes-before-plan4.json';

const TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd14', 'd16', 'd20'];
const SUMS = { d6: 7, d8: 9, d10: 11, d12: 13, d14: 15, d16: 17, d20: 21 };
test.each(TYPES)('%s has one value per face and all values 1..n', (t) => {
  const s = getShape(t);
  const n = Number(t.slice(1));
  expect(s.faces.length).toBe(n);
  expect([...s.values].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
});
test.each(Object.entries(SUMS))('%s opposite faces sum to %i', (t, sum) => {
  const s = getShape(t);
  const normals = faceNormals(s);
  normals.forEach((n, i) => {
    // The most opposite face(s): exactly antipodal on centrally symmetric dice; on the d16 (an
    // even trapezohedron has no parallel faces) -n lies midway between two bottom kites.
    const dots = normals.map((m) => n.x * m.x + n.y * m.y + n.z * m.z);
    const min = Math.min(...dots);
    const opp = dots.flatMap((d, j) => (d < min + 1e-9 ? [j] : []));
    expect(opp.some((j) => s.values[i] + s.values[j] === sum)).toBe(true);
  });
});
test.each([...TYPES, 'd4crystal'])(
  '%s vertices have unit circumradius and faces are CCW from outside',
  (t) => {
    const s = getShape(t);
    const radii = s.vertices.map((v) => Math.hypot(...v));
    expect(Math.max(...radii)).toBeCloseTo(1, 12);
    if (t !== 'd4crystal') radii.forEach((r) => expect(r).toBeCloseTo(1, 6));
    faceNormals(s).forEach((n, i) => {
      const c = [0, 0, 0];
      s.faces[i].forEach((vi) => s.vertices[vi].forEach((x, k) => (c[k] += x)));
      expect(n.x * c[0] + n.y * c[1] + n.z * c[2]).toBeGreaterThan(0);
    });
  },
);
test('d4 reads down, d2 is a coin', () => {
  expect(getShape('d4').readMode).toBe('down');
  expect(getShape('d6').readMode).toBe('up');
  expect(getShape('d2').kind).toBe('coin');
});
test('d10 labels and d100 tens labels', () => {
  expect(labelFor('d10', 10)).toBe('0');
  expect(labelFor('d10', 6)).toBe('6.');
  expect(labelFor('d10', 100, 'd100tens')).toBe('00');
  expect(labelFor('d10', 90, 'd100tens')).toBe('90');
});
test('dieTypeForFaces', () => {
  expect(dieTypeForFaces(20)).toBe('d20');
  expect(dieTypeForFaces(14)).toBe('d14');
  expect(dieTypeForFaces(16)).toBe('d16');
  expect(dieTypeForFaces(7)).toBeNull();
  expect(dieTypeForFaces(100)).toBeNull();
});

// ---- Dice designs plan 4: new shapes, fairness (spec) ----

const sub = (a, b) => a.map((x, k) => x - b[k]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.hypot(...a);
const normal = (s, i) => {
  const n = faceNormals(s)[i];
  return [n.x, n.y, n.z];
};
/** A face's measures: area, centre (plane) distance, sorted edge lengths and corner angles. */
function measure(s, i) {
  const p = s.faces[i].map((vi) => s.vertices[vi]);
  const k = p.length;
  const n = normal(s, i);
  let area = 0;
  for (let j = 1; j + 1 < k; j++) area += dot(cross(sub(p[j], p[0]), sub(p[j + 1], p[0])), n) / 2;
  const edges = p.map((a, j) => len(sub(p[(j + 1) % k], a))).sort((a, b) => a - b);
  const angles = p
    .map((a, j) => {
      const u = sub(p[(j + k - 1) % k], a);
      const w = sub(p[(j + 1) % k], a);
      return Math.acos(dot(u, w) / (len(u) * len(w)));
    })
    .sort((a, b) => a - b);
  return { area, dist: dot(n, p[0]), edges, angles, planar: p.map((q) => dot(n, q)) };
}
function expectCongruent(s, idx) {
  const ref = measure(s, idx[0]);
  for (const i of idx) {
    const m = measure(s, i);
    expect(m.area).toBeGreaterThan(0); // CCW from outside
    expect(m.area).toBeCloseTo(ref.area, 9);
    expect(m.dist).toBeCloseTo(ref.dist, 9);
    m.edges.forEach((e, j) => expect(e).toBeCloseTo(ref.edges[j], 9));
    m.angles.forEach((a, j) => expect(a).toBeCloseTo(ref.angles[j], 9));
    m.planar.forEach((d) => expect(d).toBeCloseTo(m.dist, 9));
  }
}
/** Is point x (on the plane of the convex CCW loop p with normal n) strictly inside it? */
const inside = (p, n, x) =>
  p.every((a, j) => dot(cross(sub(p[(j + 1) % p.length], a), sub(x, a)), n) > 1e-9);

test('d10 from the generalised builder deep-equals today’s d10', () => {
  expect(JSON.parse(JSON.stringify(getShape('d10')))).toEqual(FROZEN.shapes.d10);
});
test.each(['d2', 'd4', 'd6', 'd8', 'd12', 'd20'])('%s is unchanged by plan 4', (t) => {
  expect(JSON.parse(JSON.stringify(getShape(t)))).toEqual(FROZEN.shapes[t]);
});

test.each([
  ['d14', 7],
  ['d16', 8],
])(
  '%s: 2n congruent kites (equal area, equal centre distance), planar, CCW from outside, opposite faces sum to n+1, unit circumradius',
  (t, n) => {
    const s = getShape(t);
    expect(s).toMatchObject({ type: t, kind: 'polyhedron', readMode: 'up' });
    expect(s.readFaces).toBeUndefined();
    expect(s.vertices).toHaveLength(2 * n + 2);
    s.vertices.forEach((v) => expect(len(v)).toBeCloseTo(1, 12));
    expect(s.faces).toHaveLength(2 * n);
    s.faces.forEach((f) => expect(f).toHaveLength(4));
    expectCongruent(
      s,
      s.faces.map((_, i) => i),
    );
    // A kite: two pairs of equal adjacent edges.
    const { edges } = measure(s, 0);
    expect(edges[0]).toBeCloseTo(edges[1], 9);
    expect(edges[2]).toBeCloseTo(edges[3], 9);
    expect(edges[3] - edges[0]).toBeGreaterThan(0.01);
  },
);

test('d4crystal: 4 congruent long faces valued 1-4 with opposites summing to 5; 8 cap faces valued 0; readFaces = the long faces; every cap face unstable; every long face stable', () => {
  const s = getShape('d4crystal');
  expect(s).toMatchObject({ type: 'd4crystal', kind: 'polyhedron', readMode: 'up' });
  expect(s.vertices).toHaveLength(10);
  expect(s.faces).toHaveLength(12);
  const long = s.faces.flatMap((f, i) => (f.length === 4 ? [i] : []));
  const caps = s.faces.flatMap((f, i) => (f.length === 3 ? [i] : []));
  expect(long).toHaveLength(4);
  expect(caps).toHaveLength(8);
  expect(s.readFaces).toEqual(long);
  expect(long.map((i) => s.values[i]).sort()).toEqual([1, 2, 3, 4]);
  caps.forEach((i) => expect(s.values[i]).toBe(0));
  for (const i of long) {
    const j = long.find((k) => dot(normal(s, i), normal(s, k)) < -0.999999);
    expect(s.values[i] + s.values[j]).toBe(5);
  }
  expectCongruent(s, long);
  expectCongruent(s, caps);
  // Long faces are rectangles at least 2.2x as long as wide.
  const { edges, angles } = measure(s, long[0]);
  angles.forEach((a) => expect(a).toBeCloseTo(Math.PI / 2, 9));
  expect(edges[2] / edges[0]).toBeGreaterThanOrEqual(2.2);
  // Tips beyond the ring: the tips are the only vertices off the long faces.
  const onLong = new Set(long.flatMap((i) => s.faces[i]));
  const tips = s.vertices.filter((_, i) => !onLong.has(i));
  expect(tips).toHaveLength(2);
  const ringTop = Math.max(...[...onLong].map((i) => Math.abs(s.vertices[i][1])));
  tips.forEach((v) => expect(Math.abs(v[1])).toBeGreaterThan(ringTop));
  // Stability: the centre (of mass) projects inside a face it can rest on, outside one it cannot.
  const foot = (i) => normal(s, i).map((x) => x * measure(s, i).dist);
  const loop = (i) => s.faces[i].map((vi) => s.vertices[vi]);
  long.forEach((i) => expect(inside(loop(i), normal(s, i), foot(i))).toBe(true));
  caps.forEach((i) => expect(inside(loop(i), normal(s, i), foot(i))).toBe(false));
});

test('computeHulls includes d14, d16, d4crystal; today’s hulls unchanged', () => {
  const hulls = computeHulls();
  for (const t of ['d14', 'd16', 'd4crystal']) {
    expect(hulls[t].points.length).toBe(getShape(t).vertices.length * 3);
    expect(hulls[t].radius).toBeGreaterThan(0);
    expect([...hulls[t].points].every(Number.isFinite)).toBe(true);
  }
  for (const [t, h] of Object.entries(FROZEN.hulls)) {
    expect(Array.from(hulls[t].points)).toEqual(h.points);
    expect(hulls[t].radius).toBe(h.radius);
  }
});

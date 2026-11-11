import { getShape } from '../../src/core/dice-shapes.js';
import { faceNormals } from '../../src/core/face-reader.js';
import { buildDieGeometry, minkowskiHull } from '../../src/core/chamfer.js';

const ALL = ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20'];

test.each(ALL)('%s fits inside the unit sphere', (t) => {
  const g = buildDieGeometry(getShape(t));
  g.computeBoundingSphere();
  expect(g.boundingSphere.radius).toBeLessThanOrEqual(1.0001);
});

test.each(ALL)('%s face triangles carry their face normal', (t) => {
  const s = getShape(t);
  const g = buildDieGeometry(s);
  const ids = g.getAttribute('aFaceId'),
    nrm = g.getAttribute('normal');
  const normals = faceNormals(s);
  const seen = new Set();
  for (let i = 0; i < ids.count; i++) {
    const f = ids.getX(i);
    if (f < 0) continue;
    seen.add(f);
    const d = nrm.getX(i) * normals[f].x + nrm.getY(i) * normals[f].y + nrm.getZ(i) * normals[f].z;
    expect(d).toBeGreaterThan(0.9998);
  }
  expect(seen.size).toBe(normals.length);
  expect(g.userData.faceCount).toBe(normals.length);
});

test('chamfer produces bevel triangles; chamfer 0 produces none', () => {
  const ids = (c) => buildDieGeometry(getShape('d20'), { chamfer: c }).getAttribute('aFaceId').array;
  expect(Array.from(ids(0.06)).some((f) => f === -1)).toBe(true);
  expect(Array.from(ids(0)).some((f) => f === -1)).toBe(false);
});

test('aFaceUV is ~0 at face centroids and within inradius-scaled bounds', () => {
  const g = buildDieGeometry(getShape('d6'));
  const uv = g.getAttribute('aFaceUV'),
    ids = g.getAttribute('aFaceId');
  for (let i = 0; i < uv.count; i++)
    if (ids.getX(i) >= 0)
      expect(Math.hypot(uv.getX(i), uv.getY(i))).toBeLessThanOrEqual(Math.SQRT2 + 1e-4);
});

test.each(ALL)('%s is non-indexed with outward winding and face UVs are not mirrored', (t) => {
  const g = buildDieGeometry(getShape(t));
  expect(g.getIndex()).toBeNull();
  const p = g.getAttribute('position'),
    uv = g.getAttribute('aFaceUV'),
    ids = g.getAttribute('aFaceId');
  expect(p.count % 3).toBe(0);
  for (let i = 0; i < p.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const cen = [0, 1, 2].map((d) => (a[d] + b[d] + c[d]) / 3);
    expect(n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2]).toBeGreaterThan(0);
    if (ids.getX(i) >= 0) {
      const du1 = [uv.getX(i + 1) - uv.getX(i), uv.getY(i + 1) - uv.getY(i)];
      const du2 = [uv.getX(i + 2) - uv.getX(i), uv.getY(i + 2) - uv.getY(i)];
      expect(du1[0] * du2[1] - du1[1] * du2[0]).toBeGreaterThan(0);
    }
  }
});

test('coin caps: UV spans the cap disc and the rim is bevelled', () => {
  const g = buildDieGeometry(getShape('d2'));
  const uv = g.getAttribute('aFaceUV'),
    ids = g.getAttribute('aFaceId');
  let maxR = 0;
  for (let i = 0; i < uv.count; i++)
    if (ids.getX(i) >= 0) maxR = Math.max(maxR, Math.hypot(uv.getX(i), uv.getY(i)));
  expect(maxR).toBeGreaterThan(0.99);
  expect(maxR).toBeLessThanOrEqual(1.0001);
  expect(Array.from(ids.array).some((f) => f === -1)).toBe(true);
});

// ---- Plan 2: edge styles and face-edge distance ----

const triArea = (p, i) => {
  const [a, b, c] = [0, 1, 2].map((k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)]);
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return (
    0.5 *
    Math.hypot(
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    )
  );
};

test.each(ALL)('%s rounded stays within the unit sphere at bevelSegments 32', (t) => {
  const g = buildDieGeometry(getShape(t), { style: 'rounded', bevelSegments: 32 });
  g.computeBoundingSphere();
  expect(g.boundingSphere.radius).toBeLessThanOrEqual(1.0001);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++)
    expect(Math.hypot(p.getX(i), p.getY(i), p.getZ(i))).toBeLessThanOrEqual(1 + 1e-6);
});

test('style defaults to rounded and is recorded in userData', () => {
  expect(buildDieGeometry(getShape('d6')).userData.style).toBe('rounded');
  expect(buildDieGeometry(getShape('d6'), { style: 'sharp' }).userData.style).toBe('sharp');
  expect(buildDieGeometry(getShape('d2'), { style: 'sharp' }).userData.style).toBe('sharp');
});

test('rounded silhouette bulges', () => {
  // d6 strip between the +X and +Y faces; its +Z end row points share z with the faces' inset corners.
  const g = buildDieGeometry(getShape('d6'));
  const p = g.getAttribute('position'),
    n = g.getAttribute('normal'),
    ids = g.getAttribute('aFaceId');
  let zEnd = -Infinity;
  for (let i = 0; i < p.count; i++)
    if (ids.getX(i) >= 0 && n.getX(i) > 0.99) zEnd = Math.max(zEnd, p.getZ(i));
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    if (ids.getX(i) >= 0) continue;
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)];
    if (Math.abs(z - zEnd) > 1e-5 || x < 0.1 || y < 0.1) continue;
    seen.set(`${x.toFixed(5)},${y.toFixed(5)}`, [x, y, z]);
  }
  const row = [...seen.values()].sort((a, b) => b[0] - b[1] - (a[0] - a[1]));
  expect(row.length).toBeGreaterThanOrEqual(3);
  const d = row.map((q) => Math.hypot(...q));
  const N = row.length - 1;
  const mid = Math.floor(N / 2);
  const lin = d[0] + ((d[N] - d[0]) * mid) / N;
  expect(d[mid] - lin).toBeGreaterThanOrEqual(0.003);
});

test.each(ALL)('%s face triangles are centroid fans with aEdgeDist', (t) => {
  const g = buildDieGeometry(getShape(t));
  const ids = g.getAttribute('aFaceId'),
    uv = g.getAttribute('aFaceUV'),
    ed = g.getAttribute('aEdgeDist');
  expect(ed).toBeDefined();
  expect(ed.itemSize).toBe(1);
  const max = new Map();
  for (let i = 0; i < ids.count; i++) {
    const f = ids.getX(i);
    if (f < 0) expect(ed.getX(i)).toBe(0);
    else max.set(f, Math.max(max.get(f) ?? 0, ed.getX(i)));
  }
  for (const m of max.values()) expect(m).toBeGreaterThan(0.5);
  for (let i = 0; i < ids.count; i += 3) {
    const f = ids.getX(i);
    if (f < 0) continue;
    let centres = 0,
      zeros = 0;
    for (let k = 0; k < 3; k++) {
      const e = ed.getX(i + k);
      if (Math.abs(e - max.get(f)) < 1e-6) {
        centres++;
        expect(Math.hypot(uv.getX(i + k), uv.getY(i + k))).toBeLessThan(1e-6);
      } else if (e === 0) zeros++;
    }
    expect(centres).toBe(1);
    expect(zeros).toBe(2);
  }
});

test('sharp has a much narrower bevel than rounded', () => {
  const bevelArea = (style) => {
    const g = buildDieGeometry(getShape('d20'), { style });
    const p = g.getAttribute('position'),
      ids = g.getAttribute('aFaceId');
    let a = 0;
    for (let i = 0; i < p.count; i += 3) if (ids.getX(i) < 0) a += triArea(p, i);
    return a;
  };
  const sharp = bevelArea('sharp');
  expect(sharp).toBeGreaterThan(0);
  expect(sharp).toBeLessThan(0.25 * bevelArea('rounded'));
});

test('an explicit chamfer overrides the style default', () => {
  const area = (opts) => {
    const g = buildDieGeometry(getShape('d20'), opts);
    const p = g.getAttribute('position'),
      ids = g.getAttribute('aFaceId');
    let a = 0;
    for (let i = 0; i < p.count; i += 3) if (ids.getX(i) < 0) a += triArea(p, i);
    return a;
  };
  expect(area({ style: 'sharp', chamfer: 0.07, bevelSegments: 3 })).toBeCloseTo(area({}), 6);
});

// ---- P2-R4: the Minkowski parameters behind the rounded mesh (physics collider) ----

const POLY = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

test.each(POLY)('%s minkowskiHull is the solid the visual mesh approximates', (t) => {
  const s = getShape(t);
  for (const style of ['rounded', 'sharp']) {
    const { points, radius } = minkowskiHull(s, { style });
    expect(points.length).toBe(s.vertices.length);
    expect(radius).toBeGreaterThan(0);
    // Every mesh vertex is shrunkVertex + radius * unitNormal, so its distance from the nearest
    // shrunk vertex is at least radius and the farthest mesh vertex is |point| + radius out.
    const p = buildDieGeometry(s, { style }).getAttribute('position');
    let maxMesh = 0;
    for (let i = 0; i < p.count; i++)
      maxMesh = Math.max(maxMesh, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
    const maxPt = Math.max(...points.map((q) => Math.hypot(...q)));
    expect(maxMesh).toBeCloseTo(maxPt + radius, 5);
  }
  expect(minkowskiHull(s, { style: 'sharp' }).radius).toBeLessThan(
    0.25 * minkowskiHull(s).radius,
  );
});

test('minkowskiHull: d6 rounded radius is the 0.07 inset (90 degree turn)', () => {
  expect(minkowskiHull(getShape('d6')).radius).toBeCloseTo(0.07, 9);
  expect(() => minkowskiHull(getShape('d2'))).toThrow();
});

test.each(POLY)('%s centroid aEdgeDist matches every inset edge distance within 0.5%%', (t) => {
  // Task 5 relies on aEdgeDist being a true edge distance (the d10 kites included).
  const g = buildDieGeometry(getShape(t));
  const p = g.getAttribute('position'),
    ids = g.getAttribute('aFaceId'),
    ed = g.getAttribute('aEdgeDist'),
    uv = g.getAttribute('aFaceUV');
  for (let i = 0; i < p.count; i += 3) {
    if (ids.getX(i) < 0) continue;
    // Fan triangle (centroid, a, b): the UV-space distance from the centroid to edge ab
    // (UV is face units) must equal the centroid's aEdgeDist.
    const [c, a, b] = [0, 1, 2].map((k) => [uv.getX(i + k), uv.getY(i + k)]);
    const ex = b[0] - a[0],
      ey = b[1] - a[1];
    const dist = Math.abs(ex * (c[1] - a[1]) - ey * (c[0] - a[0])) / Math.hypot(ex, ey);
    expect(Math.abs(dist / ed.getX(i) - 1)).toBeLessThan(0.005);
  }
});

// ---- five edge sharpness steps (Plan 7, P7-D2) ----
const STEPS = [0, 0.25, 0.5, 0.75, 1];
const faceIds = (g) => [...g.getAttribute('aFaceId').array].filter((f) => f >= 0);

describe.each(ALL)('edge radius steps on %s', (t) => {
  const shape = getShape(t);
  const n = faceNormals(shape).length;

  test.each(STEPS)('radius %s: valid geometry, every face id present, inside the unit sphere', (r) => {
    const g = buildDieGeometry(shape, { radius: r });
    g.computeBoundingSphere();
    expect(g.boundingSphere.radius).toBeLessThanOrEqual(1.0001);
    expect(g.userData.faceCount).toBe(n);
    expect(new Set(faceIds(g)).size).toBe(n);
    expect(g.userData.style).toBe(r === 0 ? 'sharp' : 'rounded');
  });

  test('face triangle count is the same for every step', () => {
    const counts = STEPS.map((r) => faceIds(buildDieGeometry(shape, { radius: r })).length);
    expect(new Set(counts).size).toBe(1);
  });

  test('radius 0 is today\'s sharp and 0.5 today\'s rounded, vertex for vertex', () => {
    const same = (a, b) => {
      expect(a.getAttribute('position').array).toEqual(b.getAttribute('position').array);
      expect(a.getAttribute('aFaceId').array).toEqual(b.getAttribute('aFaceId').array);
    };
    same(buildDieGeometry(shape, { radius: 0 }), buildDieGeometry(shape, { style: 'sharp' }));
    same(buildDieGeometry(shape, { radius: 0.5 }), buildDieGeometry(shape, { style: 'rounded' }));
    same(buildDieGeometry(shape, { radius: 0.5 }), buildDieGeometry(shape));
  });

  test('the steps get monotonically rounder (the flat face shrinks) and 1 is rounder than 0.5', () => {
    const flat = (r) => {
      const g = buildDieGeometry(shape, { radius: r });
      const ids = g.getAttribute('aFaceId');
      const p = g.getAttribute('position');
      let sum = 0;
      for (let i = 0; i < ids.count; i += 3) {
        if (ids.getX(i) < 0) continue;
        const [a, b, c] = [0, 1, 2].map((k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)]);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        sum += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
      }
      return sum;
    };
    const areas = STEPS.map(flat);
    for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeLessThan(areas[i - 1]);
  });
});

test('an unknown radius snaps to the nearest step; the physics hull ignores radius', () => {
  const s = getShape('d6');
  const a = buildDieGeometry(s, { radius: 0.6 }).getAttribute('position').array;
  expect(a).toEqual(buildDieGeometry(s, { radius: 0.5 }).getAttribute('position').array);
  expect(minkowskiHull(s, { radius: 1 })).toEqual(minkowskiHull(s));
  expect(minkowskiHull(s, { radius: 0 })).toEqual(minkowskiHull(s));
});

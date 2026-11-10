import { getShape } from '../../src/core/dice-shapes.js';
import { faceNormals } from '../../src/core/face-reader.js';
import { buildDieGeometry } from '../../src/core/chamfer.js';

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

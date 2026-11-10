import { getShape, dieTypeForFaces, labelFor } from '../../src/core/dice-shapes.js';
import { faceNormals } from '../../src/core/face-reader.js';

const TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
const SUMS = { d6: 7, d8: 9, d10: 11, d12: 13, d20: 21 };
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
    const opp = normals.findIndex((m) => n.x * m.x + n.y * m.y + n.z * m.z < -0.999);
    expect(s.values[i] + s.values[opp]).toBe(sum);
  });
});
test.each(TYPES)('%s vertices have unit circumradius and faces are CCW from outside', (t) => {
  const s = getShape(t);
  s.vertices.forEach((v) => expect(Math.hypot(...v)).toBeCloseTo(1, 6));
  faceNormals(s).forEach((n, i) => {
    const c = [0, 0, 0];
    s.faces[i].forEach((vi) => s.vertices[vi].forEach((x, k) => (c[k] += x)));
    expect(n.x * c[0] + n.y * c[1] + n.z * c[2]).toBeGreaterThan(0);
  });
});
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
  expect(dieTypeForFaces(7)).toBeNull();
  expect(dieTypeForFaces(100)).toBeNull();
});

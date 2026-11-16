import * as THREE from 'three';
import { dsnModelRotation, dsnFaceNormal, DSN_LAYOUT_TYPES } from '../../src/compat/dsn-layouts.js';
import { getShape } from '../../src/core/dice-shapes.js';
import { faceNormals } from '../../src/core/face-reader.js';

const dicerNormal = (type, value) => {
  const shape = getShape(type);
  const n = faceNormals(shape)[shape.values.indexOf(value)];
  return new THREE.Vector3(n.x, n.y, n.z);
};

test('the layouts cover d4, d8, d10, d12 and d20', () => {
  expect([...DSN_LAYOUT_TYPES].sort()).toEqual(['d10', 'd12', 'd20', 'd4', 'd8']);
});

test.each(['d4', 'd8', 'd10', 'd12', 'd20'])('%s: every value puts the model face for it on Dicer’s, corners matched', (type) => {
  for (const value of getShape(type).values) {
    const r = dsnModelRotation(type, value);
    expect(r).not.toBeNull();
    const q = new THREE.Quaternion(...r.rotation);
    expect(Math.hypot(...r.rotation)).toBeCloseTo(1, 9);
    expect(dsnFaceNormal(type, value).applyQuaternion(q).distanceTo(dicerNormal(type, value))).toBeLessThan(1e-6);
    // the same solid: d8, d12, d20 are congruent; DsN's d10 is a hair flatter
    expect(r.misfit).toBeLessThan(type === 'd10' ? 0.1 : 1e-6);
  }
});

test('an unknown type or value is null; results are cached', () => {
  expect(dsnModelRotation('d6', 3)).toBeNull();
  expect(dsnModelRotation('d20', 21)).toBeNull();
  expect(dsnModelRotation('d20', 5)).toBe(dsnModelRotation('d20', 5));
  expect(dsnFaceNormal('d20', 99)).toBeNull();
});

test('d4: the observed model faces (docs/research/dsn-model-orientation.md), each value on the table', () => {
  const observed = { 1: [-1, -1, -1], 2: [-1, 1, 1], 3: [1, 1, -1], 4: [1, -1, 1] };
  for (const [v, n] of Object.entries(observed))
    expect(dsnFaceNormal('d4', Number(v)).distanceTo(new THREE.Vector3(...n).normalize())).toBeLessThan(1e-9);
  expect(getShape('d4').readMode).toBe('down'); // so the matched face is the one read on both
});

test('d100: the tens die uses the d10 layout (face k shows k x 10, 10 shows 00)', () => {
  // DiceBox asks rotationFor(shapeType 'd10', targetValue 1..10) for the tens die.
  for (const value of getShape('d10').values) expect(dsnModelRotation('d10', value)).not.toBeNull();
});

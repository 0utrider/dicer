import * as THREE from 'three';
import { dsnModelRotation, dsnFaceNormal, DSN_LAYOUT_TYPES } from '../../src/compat/dsn-layouts.js';
import { getShape } from '../../src/core/dice-shapes.js';
import { faceNormals } from '../../src/core/face-reader.js';

const dicerNormal = (type, value) => {
  const shape = getShape(type);
  const n = faceNormals(shape)[shape.values.indexOf(value)];
  return new THREE.Vector3(n.x, n.y, n.z);
};

test('the layouts cover d8, d10, d12 and d20', () => {
  expect([...DSN_LAYOUT_TYPES].sort()).toEqual(['d10', 'd12', 'd20', 'd8']);
});

test.each(['d8', 'd10', 'd12', 'd20'])('%s: every value puts the model face for it on Dicer’s, corners matched', (type) => {
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

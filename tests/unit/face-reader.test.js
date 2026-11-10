import * as THREE from 'three';
import { getShape } from '../../src/core/dice-shapes.js';
import {
  faceNormals,
  readTopFace,
  rotationToShow,
  faceForValue,
} from '../../src/core/face-reader.js';
import { mulberry32 } from '../../src/core/rng.js';

const ALL = ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20'];
test.each(ALL)('%s: rotationToShow maps every target face onto every landed face', (t) => {
  const s = getShape(t);
  const normals = faceNormals(s);
  for (let landed = 0; landed < normals.length; landed++)
    for (let target = 0; target < normals.length; target++) {
      const R = new THREE.Quaternion().copy(rotationToShow(s, landed, target));
      const v = new THREE.Vector3().copy(normals[target]).applyQuaternion(R);
      expect(v.dot(new THREE.Vector3().copy(normals[landed]))).toBeGreaterThan(0.9999);
    }
});
test.each(ALL)('%s: readTopFace finds the face rotated to point up', (t) => {
  const s = getShape(t);
  faceNormals(s).forEach((n, i) => {
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3().copy(n),
      new THREE.Vector3(0, s.readMode === 'down' ? -1 : 1, 0),
    );
    expect(readTopFace(s, q)).toBe(i);
  });
});
test.each(ALL)('%s: faceForValue inverts values', (t) => {
  const s = getShape(t);
  s.values.forEach((v, i) => expect(faceForValue(s, v)).toBe(i));
});
test('mulberry32 is deterministic', () => {
  const a = mulberry32(42),
    b = mulberry32(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});

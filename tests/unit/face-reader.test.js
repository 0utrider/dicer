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
// ---- Dice designs plan 4: new shapes read reliably ----

const NEW = ['d14', 'd16', 'd4crystal'];
const UP = new THREE.Vector3(0, 1, 0);
const labelled = (s) => s.values.flatMap((v, i) => (v ? [i] : []));
/** Rotation putting face i's normal straight up. */
const faceUp = (s, i) =>
  new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3().copy(faceNormals(s)[i]), UP);

const tilted = (q, deg, k) => {
  const a = (2 * Math.PI * k) / 24;
  const axis = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  return new THREE.Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180).multiply(q);
};
/** Half the smallest angle between two readable face normals: no reader can do better. */
const halfSep = (s) => {
  const N = faceNormals(s).map((n) => new THREE.Vector3().copy(n));
  const ids = s.readFaces ?? N.map((_, i) => i);
  let min = Math.PI;
  for (const i of ids) for (const j of ids) if (i !== j) min = Math.min(min, N[i].angleTo(N[j]));
  return (min * 90) / Math.PI;
};
// The spec asks for 20 degrees. The crystal clears it (45). A unit-circumradius trapezohedron
// cannot: its nearest kites are 36.7 (d14) / 32.0 (d16) degrees apart, so a 20-degree tilt
// towards a neighbour leaves that neighbour the more upward face (today's d20 is 41.8 apart).
// The d14 / d16 are held to the geometric bound instead: every tilt below half the separation.
const TILT = { d14: 18, d16: 15.5, d4crystal: 20 };
test.each(NEW)('%s: every labelled face reads back exactly and tilted 20° (d14/d16: to the geometric bound)', (t) => {
  const s = getShape(t);
  expect(TILT[t]).toBeLessThan(halfSep(s));
  expect(halfSep(s)).toBeGreaterThan(t === 'd4crystal' ? 20 : 15.5);
  for (const i of labelled(s)) {
    const q = faceUp(s, i);
    expect(readTopFace(s, q)).toBe(i);
    for (let k = 0; k < 24; k++) expect(readTopFace(s, tilted(q, TILT[t], k))).toBe(i);
  }
});
test.each(NEW)('%s: faceForValue and rotationToShow work for every labelled face', (t) => {
  const s = getShape(t);
  const normals = faceNormals(s);
  const faces = labelled(s);
  for (const target of faces) {
    expect(faceForValue(s, s.values[target])).toBe(target);
    for (const landed of faces) {
      const R = new THREE.Quaternion().copy(rotationToShow(s, landed, target));
      const v = new THREE.Vector3().copy(normals[target]).applyQuaternion(R);
      expect(v.dot(new THREE.Vector3().copy(normals[landed]))).toBeGreaterThan(0.9999);
    }
  }
});
test('the crystal never reads a cap', () => {
  const s = getShape('d4crystal');
  s.values.forEach((v, i) => {
    if (!v) expect(s.readFaces).toContain(readTopFace(s, faceUp(s, i)));
  });
  const rnd = mulberry32(7);
  for (let k = 0; k < 500; k++) {
    const q = new THREE.Quaternion(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    expect(s.readFaces).toContain(readTopFace(s, q));
  }
});
test('rotationToShow shows each long face of the crystal upright', () => {
  // Upright: the turn maps the crystal's long axis onto itself (same sense), so a number laid
  // along the long axis of the target face lies the same way on the landed face.
  const s = getShape('d4crystal');
  for (const landed of s.readFaces)
    for (const target of s.readFaces) {
      const R = new THREE.Quaternion().copy(rotationToShow(s, landed, target));
      expect(UP.clone().applyQuaternion(R).dot(UP)).toBeGreaterThan(0.9999);
    }
});
test('mulberry32 is deterministic', () => {
  const a = mulberry32(42),
    b = mulberry32(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});

import * as THREE from 'three';
import { getShape } from '../../src/core/dice-shapes.js';
import {
  faceNormals,
  readTopFace,
  rotationToShow,
  faceForValue,
  flatGap,
  topFaceClearance,
  isCocked,
  readFace,
  readResult,
  combineD100,
} from '../../src/core/face-reader.js';
import { restingQuaternion } from '../../src/core/resting.js';
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

// ---- Rolling by hand, Task 1: read every shape physically ----

const SHAPES = ['d2', 'd4', 'd4crystal', 'd6', 'd8', 'd10', 'd12', 'd14', 'd16', 'd20'];
const DOWN = new THREE.Vector3(0, -1, 0);
const FACE_DOWN = new Set(['d4', 'd4crystal', 'd16']); // pre-flight R4
const restable = (s) => s.readFaces ?? faceNormals(s).map((_, i) => i);
/** Rotation putting face i's normal at -Y (it lies on the table). */
const faceDown = (s, i) =>
  new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3().copy(faceNormals(s)[i]), DOWN);
/** Face f resting: face-down for d4 / crystal / d16 (R4), restingQuaternion's face-up otherwise. */
const restOn = (s, f) => (FACE_DOWN.has(s.type) ? faceDown(s, f) : restingQuaternion(s, f));
const sharedVerts = (a, b) => a.filter((v) => b.includes(v)).length;

test.each(SHAPES)('%s: every shape resting flat on every restable face is not cocked', (t) => {
  const s = getShape(t);
  expect(flatGap(s)).toBeGreaterThan(0.1);
  for (const f of restable(s)) {
    const q = restOn(s, f);
    expect(isCocked(s, q)).toBe(false);
    expect(topFaceClearance(s, q)).toBeGreaterThanOrEqual(flatGap(s) - 1e-6);
  }
});
test.each(SHAPES.filter((t) => t !== 'd2'))(
  '%s: every shape balanced on an edge (midpoint of two faces) is cocked',
  (t) => {
    const s = getShape(t);
    const N = faceNormals(s).map((n) => new THREE.Vector3().copy(n));
    const ids = restable(s);
    const read = t === 'd4' || t === 'd16' ? DOWN : UP;
    let edges = 0;
    for (const i of ids)
      for (const j of ids) {
        if (j <= i || sharedVerts(s.faces[i], s.faces[j]) < 2) continue;
        const mid = N[i].clone().add(N[j]).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(mid, read);
        expect(isCocked(s, q)).toBe(true);
        edges++;
      }
    expect(edges).toBeGreaterThan(0);
  },
);
test('a coin on its rim is cocked; flat is not', () => {
  const s = getShape('d2');
  const rim = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  expect(isCocked(s, rim)).toBe(true);
  expect(topFaceClearance(s, rim)).toBeCloseTo(0, 6);
  expect(isCocked(s, new THREE.Quaternion())).toBe(false);
  expect(topFaceClearance(s, new THREE.Quaternion())).toBeCloseTo(1, 6);
  const flipped = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  expect(isCocked(s, flipped)).toBe(false);
  expect(readResult(s, flipped)).toBe(2);
});
test('d16 resting on each face reads its paired top kite and the 16 faces map to 16 distinct values', () => {
  const s = getShape('d16');
  const N = faceNormals(s).map((n) => new THREE.Vector3().copy(n));
  const seen = new Set();
  for (let i = 0; i < 16; i++) {
    const q = faceDown(s, i);
    const f = readFace(s, q);
    // buildTrapezohedron's pairing: paired faces sum to 17 (R4).
    expect(s.values[f]).toBe(17 - s.values[i]);
    // The counted face is one of the two equally-up top kites.
    const ys = N.map((n) => n.clone().applyQuaternion(q).y);
    expect(ys[f]).toBeCloseTo(Math.max(...ys), 6);
    expect(readResult(s, q)).toBe(s.values[f]);
    seen.add(readResult(s, q));
    // The top read is ambiguous (gap 0); the down read is not.
    expect(isCocked(s, q)).toBe(false);
  }
  expect(seen.size).toBe(16);
  // Top kite k is paired with bottom kite (k + 3) mod 8 (H-1), and back.
  for (let k = 0; k < 8; k++) {
    expect(readFace(s, faceDown(s, 8 + ((k + 3) % 8)))).toBe(k);
    expect(readFace(s, faceDown(s, k))).toBe(8 + ((k + 3) % 8));
  }
});
test('the crystal never reads a cap, flat or cocked', () => {
  const s = getShape('d4crystal');
  for (let i = 0; i < s.faces.length; i++) {
    expect(s.readFaces).toContain(readFace(s, faceDown(s, i)));
    expect(s.readFaces).toContain(readFace(s, faceUp(s, i)));
    expect(readResult(s, faceUp(s, i))).toBeGreaterThan(0);
  }
  const rnd = mulberry32(11);
  let cocked = 0;
  for (let k = 0; k < 500; k++) {
    const q = new THREE.Quaternion(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    expect(s.readFaces).toContain(readFace(s, q));
    expect(readResult(s, q)).toBeGreaterThan(0);
    cocked += isCocked(s, q);
  }
  expect(cocked).toBeGreaterThan(0);
});
test('readResult maps relabels: d3 faces 1..6 -> 1,2,3,1,2,3; dF -> +1,+1,0,0,-1,-1; dc face 2 -> 0; d7 on d14', () => {
  const up = (t, v) => {
    const s = getShape(t);
    return [s, faceUp(s, faceForValue(s, v))];
  };
  const six = [1, 2, 3, 4, 5, 6];
  expect(six.map((v) => readResult(...up('d6', v), 'd3'))).toEqual([1, 2, 3, 1, 2, 3]);
  expect(six.map((v) => readResult(...up('d6', v), 'dF'))).toEqual([1, 1, 0, 0, -1, -1]);
  expect(readResult(...up('d2', 2), 'dc')).toBe(0);
  expect(readResult(...up('d2', 1), 'dc')).toBe(1);
  const d14 = Array.from({ length: 14 }, (_, i) => readResult(...up('d14', i + 1), 'd7'));
  expect(d14).toEqual([1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7]);
  expect(readResult(...up('d20', 17))).toBe(17);
});
test('d100: tens face 10 + ones face 10 -> 100; tens 3 + ones 7 -> 37', () => {
  const s = getShape('d10');
  const on = (v) => faceUp(s, faceForValue(s, v));
  const tens = (v) => readResult(s, on(v), 'd100tens');
  const ones = (v) => readResult(s, on(v));
  expect(tens(10)).toBe(0);
  expect(tens(3)).toBe(30);
  expect(combineD100(tens(10), ones(10))).toBe(100);
  expect(combineD100(tens(3), ones(7))).toBe(37);
  expect(combineD100(tens(10), ones(1))).toBe(1);
  expect(combineD100(tens(9), ones(10))).toBe(90);
});

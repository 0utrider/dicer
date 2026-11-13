import * as THREE from 'three';
import { resultOf } from './dice-shapes.js';
import { COCKED_FRACTION } from '../physics/protocol.js';

const _n = new THREE.Vector3();

/** Local unit normals per face ({x,y,z}); for a coin, the two cap normals. */
export function faceNormals(shape) {
  if (shape.kind === 'coin') {
    return [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
    ];
  }
  return shape.faces.map((f) => {
    const n = new THREE.Vector3();
    // Newell's method, robust for any planar loop.
    f.forEach((a, i) => {
      const p = shape.vertices[a];
      const q = shape.vertices[f[(i + 1) % f.length]];
      n.x += (p[1] - q[1]) * (p[2] + q[2]);
      n.y += (p[2] - q[2]) * (p[0] + q[0]);
      n.z += (p[0] - q[0]) * (p[1] + q[1]);
    });
    n.normalize();
    return { x: n.x, y: n.y, z: n.z };
  });
}

/**
 * [best face, its height, the runner-up's height] at pose q, heights being world normal Y times
 * `sign` (-1 reads the face on the table), among shape.readFaces when given.
 */
function rank(shape, q, sign) {
  const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  let best = 0;
  let b = -Infinity;
  let s = -Infinity;
  faceNormals(shape).forEach((n, i) => {
    if (!(shape.readFaces?.includes(i) ?? 1)) return;
    const y = sign * _n.set(n.x, n.y, n.z).applyQuaternion(quat).y;
    if (y > b) [s, b, best] = [b, y, i];
    else if (y > s) s = y;
  });
  return [best, b, s];
}

/**
 * Face index whose world normal points most up (most down for readMode 'down'), among
 * shape.readFaces when given (the crystal d4's caps are never a result).
 */
export const readTopFace = (shape, q) => rank(shape, q, shape.readMode === 'down' ? -1 : 1)[0];

/** H-2: a die is cocked below this fraction of its own flat gap (a coin: cap |y| below 0.5). */
export { COCKED_FRACTION };

// A resting d16 has two equally-up kites (gap 0), so it is read from below (H-1).
const isD16 = (shape) => shape.type === 'd16';
/** The read side: -1 (the face on the table) for the d4 and the d16, else +1. */
export const readSign = (shape) => (shape.readMode === 'down' || isD16(shape) ? -1 : 1);

/**
 * Gap between the best and second-best read normal at pose q, on the read side, among readFaces
 * when given. A coin: its cap normal's |y|.
 */
export function topFaceClearance(shape, q) {
  const [, b, s] = rank(shape, q, readSign(shape));
  return shape.kind === 'coin' ? b : b - s;
}

const gaps = new WeakMap();
/** Smallest clearance over the shape's restable faces, each lying on the table (cached). */
export function flatGap(shape) {
  if (!gaps.has(shape)) {
    const down = new THREE.Vector3(0, -1, 0);
    const N = faceNormals(shape);
    const ids = shape.readFaces ?? N.map((_, i) => i);
    const q = new THREE.Quaternion();
    gaps.set(
      shape,
      Math.min(...ids.map((i) => topFaceClearance(shape, q.setFromUnitVectors(_n.copy(N[i]), down)))),
    );
  }
  return gaps.get(shape);
}

export const isCocked = (shape, q) => topFaceClearance(shape, q) < COCKED_FRACTION * flatGap(shape);

/**
 * The face that counts: readTopFace, except the d16, whose face on the table is mapped to its
 * paired top kite (buildTrapezohedron pairs faces summing to 17: top k with bottom (k + 3) mod 8).
 */
export function readFace(shape, q) {
  if (!isD16(shape)) return readTopFace(shape, q);
  const v = shape.values;
  return v.indexOf(17 - v[rank(shape, q, -1)[0]]);
}

/** Foundry result of the die at pose q; 'd100tens' gives the tens part (face 10 shows 00 = 0). */
export function readResult(shape, q, variant) {
  const v = shape.values[readFace(shape, q)];
  return variant === 'd100tens' ? (v % 10) * 10 : resultOf(v, variant);
}

/** A d100 from its two d10 reads; 00 + 0 is 100. */
export const combineD100 = (tens, ones) => tens + (ones % 10) || 100;

/** Face index carrying the given result value. */
export function faceForValue(shape, value) {
  const i = shape.values.indexOf(value);
  if (i < 0) throw new Error(`dicer: ${shape.type} has no face with value ${value}`);
  return i;
}

/** Direction of a face's first edge (vertex 0 to vertex 1). */
function firstEdge(shape, face) {
  const f = shape.faces[face];
  const a = shape.vertices[f[0]];
  const b = shape.vertices[f[1]];
  return new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
}

const toPlain = (q) => ({ x: q.x, y: q.y, z: q.z, w: q.w });

/**
 * Local rotation R with R * n_target = n_landed. Applied to the inner mesh, the target
 * face occupies the landed face's world direction. After the minimal swing, a twist about
 * n_landed aligns the target's first-edge direction with the landed face's, so the
 * numbers stay upright relative to the face. A coin just flips (PI about X) if needed.
 */
export function rotationToShow(shape, landedFace, targetFace) {
  if (shape.kind === 'coin') {
    const q = new THREE.Quaternion();
    if (landedFace !== targetFace) q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    return toPlain(q);
  }
  const normals = faceNormals(shape);
  const nl = new THREE.Vector3().copy(normals[landedFace]);
  const nt = new THREE.Vector3().copy(normals[targetFace]);
  const swing = new THREE.Quaternion().setFromUnitVectors(nt, nl);
  const et = firstEdge(shape, targetFace).applyQuaternion(swing);
  const el = firstEdge(shape, landedFace);
  const angle = Math.atan2(nl.dot(new THREE.Vector3().crossVectors(et, el)), et.dot(el));
  const twist = new THREE.Quaternion().setFromAxisAngle(nl, angle);
  return toPlain(twist.multiply(swing));
}

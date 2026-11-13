/**
 * Reading a free die physically (rolling by hand): the face that landed counts. Only the lazy hand
 * chunk (and computeReaders, which it calls) uses this module, so none of it is in world start.
 */
import * as THREE from 'three';
import { resultOf } from './dice-shapes.js';
import { COCKED_FRACTION } from '../physics/protocol.js';
import { faceNormals, rank, readTopFace } from './face-reader.js';

const _n = new THREE.Vector3();

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

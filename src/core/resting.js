// Resting orientation of a die: face `f` up with its label upright, and the lowest point
// of a geometry under a rotation. Shared by the dev look gallery and the theme thumbnailer.
import * as THREE from 'three';
import { faceNormals } from './face-reader.js';

/** Rotation putting face `f` up with its label upright (face V axis towards screen-up, -Z). */
export function restingQuaternion(shape, f) {
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3().copy(faceNormals(shape)[f]);
  let v;
  if (shape.kind === 'coin') {
    v = new THREE.Vector3(0, 0, 1); // chamfer.js: V = +Z on both caps
  } else {
    const face = shape.faces[f];
    const c = new THREE.Vector3();
    for (const i of face) c.add(new THREE.Vector3(...shape.vertices[i]));
    c.divideScalar(face.length);
    v = new THREE.Vector3(...shape.vertices[face[0]]).sub(c);
    v.addScaledVector(n, -v.dot(n)).normalize();
  }
  const swing = new THREE.Quaternion().setFromUnitVectors(n, up);
  v.applyQuaternion(swing);
  const target = new THREE.Vector3(0, 0, -1);
  const angle = Math.atan2(up.dot(new THREE.Vector3().crossVectors(v, target)), v.dot(target));
  return new THREE.Quaternion().setFromAxisAngle(up, angle).multiply(swing);
}

/** Lowest point of a geometry under rotation q (so the die can rest on y = 0). */
export function minY(geo, q) {
  const p = geo.getAttribute('position');
  const v = new THREE.Vector3();
  let min = Infinity;
  for (let i = 0; i < p.count; i++)
    min = Math.min(min, v.fromBufferAttribute(p, i).applyQuaternion(q).y);
  return min;
}

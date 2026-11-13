import * as THREE from 'three';

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
 * Face index whose world normal points most up (most down for readMode 'down'), among
 * shape.readFaces when given (the crystal d4's caps are never a result).
 */
export function readTopFace(shape, q) {
  const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  const sign = shape.readMode === 'down' ? -1 : 1;
  let best = 0;
  let bestY = -Infinity;
  faceNormals(shape).forEach((n, i) => {
    const y = sign * _n.set(n.x, n.y, n.z).applyQuaternion(quat).y;
    if (y > bestY && (shape.readFaces?.includes(i) ?? 1)) {
      bestY = y;
      best = i;
    }
  });
  return best;
}

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

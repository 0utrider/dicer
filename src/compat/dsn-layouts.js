import * as THREE from 'three';
import { getShape } from '../core/dice-shapes.js';

/**
 * Dice So Nice's own die layouts (its DICE_SHAPE, version 6.4.5): the physics vertices v, the
 * faces f (vertex loops) and the value n[i] of face i. A model made for Dice So Nice sits in this
 * frame: its face carrying value n[i] faces where f[i] does (the d6 models observed in
 * docs/research/dsn-model-orientation.md agree). Only in the lazy model-loader chunk.
 */
const LAYOUTS = {
  d8: { v: [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]], f: [[0,2,4],[0,4,3],[0,3,5],[0,5,2],[1,3,4],[1,4,2],[1,2,5],[1,5,3]], n: [5,3,1,7,2,8,6,4] },
  d10: { v: [[1,0,-0.105],[0.809017,0.587785,0.105],[0.309017,0.951057,-0.105],[-0.309017,0.951057,0.105],[-0.809017,0.587785,-0.105],[-1,0.0,0.105],[-0.809017,-0.587785,-0.105],[-0.309017,-0.951057,0.105],[0.309017,-0.951057,-0.105],[0.809017,-0.587785,0.105],[0,0,-1],[0,0,1]], f: [[5,6,7,11],[4,3,2,10],[1,2,3,11],[0,9,8,10],[7,8,9,11],[8,7,6,10],[9,0,1,11],[2,1,0,10],[3,4,5,11],[6,5,4,10]], n: [1,2,5,10,7,4,3,8,9,6] },
  d12: { v: [[0,0.618034,1.618034],[0,0.618034,-1.618034],[0,-0.618034,1.618034],[0,-0.618034,-1.618034],[1.618034,0,0.618034],[1.618034,0,-0.618034],[-1.618034,0,0.618034],[-1.618034,0,-0.618034],[0.618034,1.618034,0],[0.618034,-1.618034,0],[-0.618034,1.618034,0],[-0.618034,-1.618034,0],[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1]], f: [[2,14,4,12,0],[15,9,11,19,3],[16,10,17,7,6],[6,7,19,11,18],[6,18,2,0,16],[18,11,9,14,2],[1,17,10,8,13],[1,13,5,15,3],[13,8,12,4,5],[5,4,14,9,15],[0,12,8,10,16],[3,19,7,17,1]], n: [7,5,3,11,12,9,4,1,2,10,8,6] },
  d20: { v: [[-1,1.618034,0],[1,1.618034,0],[-1,-1.618034,0],[1,-1.618034,0],[0,-1,1.618034],[0,1,1.618034],[0,-1,-1.618034],[0,1,-1.618034],[1.618034,0,-1],[1.618034,0,1],[-1.618034,0,-1],[-1.618034,0,1]], f: [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]], n: [10,17,3,16,8,7,12,20,6,19,5,18,4,11,13,15,2,14,9,1] },
};

const vec = (a) => new THREE.Vector3(...a);

/** Outward unit normals of the faces of vertices v (Newell), and the unit vertex directions. */
function frame(v, f) {
  const verts = v.map(vec);
  const normals = f.map((loop) => {
    const n = new THREE.Vector3();
    const c = new THREE.Vector3();
    loop.forEach((a, i) => {
      const p = verts[a];
      const q = verts[loop[(i + 1) % loop.length]];
      n.x += (p.y - q.y) * (p.z + q.z);
      n.y += (p.z - q.z) * (p.x + q.x);
      n.z += (p.x - q.x) * (p.y + q.y);
      c.add(p);
    });
    n.normalize();
    return n.dot(c) < 0 ? n.negate() : n; // outward, whatever the loop's winding
  });
  return { verts, dirs: verts.map((p) => p.clone().normalize()), normals };
}

const frames = new Map();
const frameOf = (key, make) => frames.get(key) ?? frames.set(key, make()).get(key);

/** Sum over a's directions of the angle to the nearest of b's (how far two vertex sets are apart). */
function misfit(a, b) {
  let sum = 0;
  for (const p of a) sum += Math.min(...b.map((q) => p.angleTo(q)));
  return sum;
}

const cache = new Map();

/**
 * The rotation [x, y, z, w] taking a Dice So Nice model of die type `type` onto Dicer's die so
 * that the model's face for `value` lies on Dicer's face for `value` (the face that ends up on
 * top), turned about it so the model's corners sit as close to Dicer's as they can; with how far
 * the corners stay apart (radians summed, 0 for congruent solids). Null for a type or value this
 * does not know. The other faces of the two layouts need not agree: only the top one is read.
 */
export function dsnModelRotation(type, value) {
  const key = `${type}|${value}`;
  if (cache.has(key)) return cache.get(key);
  let out = null;
  const L = LAYOUTS[type];
  let shape = null;
  try {
    shape = getShape(type);
  } catch {
    shape = null;
  }
  const mi = L ? L.n.indexOf(value) : -1;
  const di = shape ? shape.values.indexOf(value) : -1;
  if (mi >= 0 && di >= 0) {
    const m = frameOf(`dsn|${type}`, () => frame(L.v, L.f));
    const d = frameOf(`dicer|${type}`, () => frame(shape.vertices, shape.faces));
    const nd = d.normals[di];
    const q0 = new THREE.Quaternion().setFromUnitVectors(m.normals[mi], nd);
    const flat = (p) => p.clone().addScaledVector(nd, -p.dot(nd)).normalize();
    const from = flat(m.dirs[L.f[mi][0]].clone().applyQuaternion(q0));
    for (const vi of shape.faces[di]) {
      const to = flat(d.dirs[vi]);
      const angle = Math.atan2(from.clone().cross(to).dot(nd), from.dot(to));
      const q = new THREE.Quaternion().setFromAxisAngle(nd, angle).multiply(q0);
      const off = misfit(m.dirs.map((p) => p.clone().applyQuaternion(q)), d.dirs);
      if (!out || off < out.misfit) out = { rotation: [q.x, q.y, q.z, q.w], misfit: off };
    }
  }
  cache.set(key, out);
  return out;
}

/** The outward normal of the face carrying `value` on a Dice So Nice model of `type` (tests, checks), or null. */
export function dsnFaceNormal(type, value) {
  const L = LAYOUTS[type];
  const i = L ? L.n.indexOf(value) : -1;
  return i < 0 ? null : frameOf(`dsn|${type}`, () => frame(L.v, L.f)).normals[i].clone();
}

/** Die types this knows. */
export const DSN_LAYOUT_TYPES = Object.freeze(Object.keys(LAYOUTS));

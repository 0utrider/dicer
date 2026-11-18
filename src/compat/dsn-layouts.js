import * as THREE from 'three';
import { getShape } from '../core/dice-shapes.js';

/**
 * The die layouts of dice models made for Foundry's 3D dice modules (Dice So Nice's model
 * presets): the corner directions v, the faces f (corner loops) and the value n[i] printed on
 * face i (the d4: the value when face i rests on the table). A model's face carrying value n[i]
 * points where f[i] does. MEASURED from the model files of The Rollsmith's dice sets (Black
 * Marble, Gold Red Armored, Norse Boneyard: all three agree on every face): corners and faces from
 * the meshes in model-loader.js's frame, values read from renders of each face (the d10's "0" is
 * 10 here). Not taken from any other module's code. Only in the lazy model-loader chunk.
 */
const LAYOUTS = {
  d4: { v: [[-0.57735,0.57735,-0.57735],[0.57735,0.57735,0.57735],[0.57735,-0.57735,-0.57735],[-0.57735,-0.57735,0.57735]], f: [[2,0,1],[1,0,3],[3,0,2],[2,1,3]], n: [3,2,1,4] },
  d8: { v: [[1,0,0],[0,0,-1],[0,1,0],[0,-1,0],[0,0,1],[-1,0,0]], f: [[2,0,1],[3,0,4],[1,0,3],[4,0,2],[4,2,5],[5,1,3],[2,1,5],[5,3,4]], n: [7,3,1,5,8,4,6,2] },
  d10: { v: [[0,0,1],[0.307261,-0.945801,-0.105126],[0.804561,-0.584491,0.105125],[-0.307261,-0.945801,0.105126],[-0.994459,-0.000046,0.105126],[-0.804507,0.584565,-0.105125],[-0.307349,0.945772,0.105126],[0,0,-1],[0.994459,-0.000046,-0.105126],[0.307349,0.945772,-0.105126],[0.804507,0.584565,0.105126],[-0.804561,-0.584491,-0.105126]], f: [[2,0,3,1],[4,0,6,5],[8,2,1,7],[8,7,9,10],[3,0,4,11],[7,11,4,5],[6,0,10,9],[7,1,3,11],[7,5,6,9],[10,0,2,8]], n: [7,9,10,8,1,6,5,4,2,3] },
  d12: { v: [[0.934172,0,-0.356822],[0.934172,0,0.356822],[0.57735,-0.57735,-0.57735],[0.57735,-0.57735,0.57735],[0.356822,-0.934172,0],[0.57735,0.57735,-0.57735],[0.57735,0.57735,0.57735],[0.356822,0.934172,0],[-0.934172,0,0.356822],[-0.934172,0,-0.356822],[-0.57735,-0.57735,0.57735],[-0.57735,-0.57735,-0.57735],[-0.356822,-0.934172,0],[-0.57735,0.57735,0.57735],[-0.57735,0.57735,-0.57735],[-0.356822,0.934172,0],[0,0.356822,0.934172],[0,-0.356822,0.934172],[0,-0.356822,-0.934172],[0,0.356822,-0.934172]], f: [[4,2,0,1,3],[6,1,0,5,7],[12,10,8,9,11],[14,9,8,13,15],[16,13,8,10,17],[18,11,9,14,19],[19,5,0,2,18],[17,3,1,6,16],[13,16,6,7,15],[11,18,2,4,12],[15,7,5,19,14],[12,4,3,17,10]], n: [10,2,11,3,12,6,1,7,8,5,4,9] },
  d20: { v: [[0,0.525731,-0.850651],[-0.525731,0.850651,0],[-0.850651,0,-0.525731],[0,-0.525731,0.850651],[-0.850651,0,0.525731],[-0.525731,-0.850651,0],[0.850651,0,0.525731],[0.525731,0.850651,0],[0,0.525731,0.850651],[0.525731,-0.850651,0],[0.850651,0,-0.525731],[0,-0.525731,-0.850651]], f: [[1,0,2],[5,3,4],[8,6,7],[10,9,11],[6,3,9],[10,0,7],[8,1,4],[5,2,11],[7,0,1],[9,3,5],[9,5,11],[7,1,8],[7,6,10],[10,6,9],[4,1,2],[4,2,5],[11,0,10],[8,3,6],[4,3,8],[2,0,11]], n: [16,2,7,11,5,19,10,14,3,18,4,17,1,13,8,20,9,15,12,6] },
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

import * as THREE from 'three';
import { cross, dot, scl, sub } from './math.js';

/**
 * Mesh buffers, bones and the final scene.
 *
 *   const body = new MeshBuffer(KEYS);                    // shape key names of this mesh
 *   const shellTris = appendShell(body, shell, atlas, (i) => ({ weights, keys }));
 *   body.addVertex(p, n, uv, [[boneIndex, 1]], { blink_L: delta });   // extra parts
 *   const scene = assemble({ name: 'cat', bones: BONES, body, eyes, map, fit: fitScale(...) });
 *
 * Bones are given as a table [[name, parent | null, [x, y, z] model position]], root first.
 * Weights are [[boneIndex, weight]] (up to 4). Shape keys are per-vertex deltas (morph targets,
 * relative). Everything is built in "design" units and scaled once by `fit` at assembly so the
 * pet is 1.5 tall on y = 0 (positions, deltas and bones together).
 */

export class MeshBuffer {
  /** @param {string[]} keys the shape key names (in order) this mesh will have */
  constructor(keys = []) {
    this.keys = keys;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = null;
    this.si = [];
    this.sw = [];
    this.idx = [];
    this.morph = Object.fromEntries(keys.map((k) => [k, []]));
    this.src = []; // per vertex: a source id (for painting), if any
  }
  get count() {
    return this.pos.length / 3;
  }
  /**
   * @param {number[]} p position @param {number[]} n normal @param {number[]} uv
   * @param {number[][]} wts [[boneIndex, weight]] @param {Object<string, number[]>} [mo] deltas
   * @param {number[]} [col] linear vertex colour (then every vertex needs one)
   */
  addVertex(p, n, uv, wts, mo = {}, col = null) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    if (uv) this.uv.push(uv[0], uv[1]);
    if (col) (this.col ??= []).push(col[0], col[1], col[2]);
    const si = [0, 0, 0, 0];
    const sw = [0, 0, 0, 0];
    wts.forEach(([b, v], i) => {
      si[i] = b;
      sw[i] = v;
    });
    this.si.push(...si);
    this.sw.push(...sw);
    for (const k of this.keys) {
      const d = mo[k] ?? [0, 0, 0];
      this.morph[k].push(d[0], d[1], d[2]);
    }
    return this.count - 1;
  }
  P(i) {
    return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]];
  }
  /** A triangle wound so its normal points along `out` (any vector roughly outward). */
  tri(a, b, c, out) {
    const pa = this.P(a);
    const n = cross(sub(this.P(b), pa), sub(this.P(c), pa));
    if (dot(n, out) >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }
  /**
   * Triangles of a (rows+1) x (cols+1) vertex grid starting at `base` (row-major), each quad
   * wound outward: out(a) gives the outward vector at vertex a.
   */
  grid(base, rows, cols, out, wrap = false) {
    const w = cols + 1;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const a = base + j * w + i;
        const b = wrap && i === cols - 1 ? base + j * w : a + 1;
        const c = a + w;
        const d = b + w;
        const pa = this.P(a);
        const n = cross(sub(this.P(b), pa), sub(this.P(c), pa));
        if (dot(n, out(a)) >= 0) this.idx.push(a, b, c, b, d, c);
        else this.idx.push(a, c, b, b, c, d);
      }
  }
}

/**
 * Adds the shell to `buf`, one vertex per (shell vertex, UV chart) so charts get their own UVs.
 * @param {MeshBuffer} buf
 * @param {{pos:number[], tris:number[], nor:number[][]}} shell
 * @param {object} atlas createAtlas() with the shell added and laid out
 * @param {(i:number, p:number[]) => {weights:number[][], keys?:object}} perVertex
 * @returns {number[][]} the shell's triangles as buffer ids (for paintShell); buf.src[id] is the
 *   shell vertex
 */
export function appendShell(buf, shell, atlas, perVertex) {
  const { pos, tris, nor } = shell;
  const n = pos.length / 3;
  const per = [];
  for (let i = 0; i < n; i++) per.push(perVertex(i, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]));
  const split = new Map();
  const out = [];
  for (let t = 0; t < tris.length / 3; t++) {
    const ids = [];
    const c = atlas.chartOf(t);
    for (let k = 0; k < 3; k++) {
      const vi = tris[t * 3 + k];
      const key = vi * 65536 + c;
      let id = split.get(key);
      if (id === undefined) {
        const p = [pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]];
        id = buf.addVertex(p, nor[vi], atlas.shellUV(t, p), per[vi].weights, per[vi].keys ?? {});
        buf.src[id] = vi;
        split.set(key, id);
      }
      ids.push(id);
    }
    buf.idx.push(...ids);
    out.push(ids);
  }
  return out;
}

/** The scale that makes vertices [0, count) of `buf` `height` tall (their lowest is on y = 0). */
export function fitScale(buf, count = buf.count, height = 1.5) {
  let ymax = -Infinity;
  for (let i = 0; i < count; i++) ymax = Math.max(ymax, buf.pos[i * 3 + 1]);
  return height / ymax;
}

/** A BufferGeometry from a MeshBuffer, scaled by k (positions and shape keys). */
export function toGeometry(b, k = 1, name = '') {
  const g = new THREE.BufferGeometry();
  g.name = name;
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos.map((v) => v * k), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  if (b.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  if (b.col) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.sw, 4));
  g.setIndex(b.idx);
  if (b.keys.length) {
    g.morphAttributes.position = b.keys.map((name) => {
      const a = new THREE.Float32BufferAttribute(b.morph[name].map((v) => v * k), 3);
      a.name = name;
      return a;
    });
    g.morphTargetsRelative = true;
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Bone name -> index of a bone table. */
export const boneIndex = (table) => Object.fromEntries(table.map((b, i) => [b[0], i]));

/**
 * The pet's scene: a Group named `name` holding the bone tree (positions scaled by `fit`), the
 * `Body` SkinnedMesh (textured, opaque MeshStandardMaterial) and the `Eyes` SkinnedMesh (vertex
 * coloured), both bound to one skeleton. `extra` (optional MeshBuffer + material) becomes `Extra`.
 * @param {{name:string, bones:Array, body:MeshBuffer, eyes:MeshBuffer, map:THREE.Texture,
 *   fit:number, roughness?:number, eyeRoughness?:number, extra?:{buf:MeshBuffer, material:THREE.Material}}} o
 * @returns {THREE.Group}
 */
export function assemble({ name, bones: table, body, eyes, map, fit, roughness = 0.82, eyeRoughness = 0.18, extra = null }) {
  const scene = new THREE.Group();
  scene.name = name;
  const at = Object.fromEntries(table.map(([n, , p]) => [n, p]));
  const bones = table.map(([n]) => {
    const b = new THREE.Bone();
    b.name = n;
    return b;
  });
  const idx = boneIndex(table);
  table.forEach(([n, parent], i) => {
    const pp = parent ? at[parent] : [0, 0, 0];
    bones[i].position.set(...scl(sub(at[n], pp), fit));
    (parent ? bones[idx[parent]] : scene).add(bones[i]);
  });
  const meshes = [];
  const make = (buf, material, meshName) => {
    const m = new THREE.SkinnedMesh(toGeometry(buf, fit, meshName), material);
    m.name = meshName;
    m.updateMorphTargets();
    meshes.push(m);
    return m;
  };
  make(body, new THREE.MeshStandardMaterial({ name: `${name}_body`, map, roughness, metalness: 0 }), 'Body');
  make(eyes, new THREE.MeshStandardMaterial({ name: `${name}_eyes`, vertexColors: true, roughness: eyeRoughness, metalness: 0 }), 'Eyes');
  if (extra) make(extra.buf, extra.material, 'Extra');
  scene.add(...meshes);
  scene.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  for (const m of meshes) m.bind(skeleton);
  return scene;
}


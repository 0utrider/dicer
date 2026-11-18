import { add, clamp, cross, dot, len, scl, sub } from './math.js';
import { gradient, project } from './sdf.js';

/**
 * Meshing a field into a smooth shell:
 *   buildShell(f, { lo, hi, grid, triangles, importance }) -> { pos, tris, nor }
 * = surfaceNets (quads on a grid, split into triangles) -> every vertex projected onto f = 0 ->
 * decimate (edge collapses by importance x length^2 + curvature, the kept vertex re-projected) ->
 * relax (tangential smoothing) -> normals from the field's gradient. Also fieldAO for baked
 * occlusion. Positions are flat arrays [x0, y0, z0, x1, ...]; tris are index triples.
 */

/** Surface nets: a quad mesh of f's zero set on a grid of spacing h over [lo, hi]. */
export function surfaceNets(f, lo, hi, h) {
  const n = [0, 1, 2].map((i) => Math.ceil((hi[i] - lo[i]) / h) + 1);
  const [nx, ny, nz] = n;
  const val = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) val[i + nx * (j + ny * k)] = f(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  const cx = nx - 1;
  const cy = ny - 1;
  const cell = new Int32Array(cx * cy * (nz - 1)).fill(-1);
  const pos = [];
  const corner = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const edges = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, d] = corner[c];
          v[c] = val[i + a + nx * (j + b + ny * (k + d))];
          if (v[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let cnt = 0;
        for (const [a, b] of edges) {
          if (v[a] < 0 === v[b] < 0) continue;
          const t = v[a] / (v[a] - v[b]);
          const A = corner[a];
          const B = corner[b];
          sx += A[0] + (B[0] - A[0]) * t;
          sy += A[1] + (B[1] - A[1]) * t;
          sz += A[2] + (B[2] - A[2]) * t;
          cnt++;
        }
        cell[i + cx * (j + cy * k)] = pos.length / 3;
        pos.push(lo[0] + (i + sx / cnt) * h, lo[1] + (j + sy / cnt) * h, lo[2] + (k + sz / cnt) * h);
      }
  const tris = [];
  const C = (i, j, k) => cell[i + cx * (j + cy * k)];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const P = (q) => [pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]];
    // split along the shorter diagonal
    if (len(sub(P(a), P(c))) <= len(sub(P(b), P(d)))) tris.push(a, b, c, a, c, d);
    else tris.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const s0 = val[i + nx * (j + ny * k)] < 0;
        if (i + 1 < nx && j > 0 && k > 0 && j < ny - 1 && k < nz - 1 && s0 !== val[i + 1 + nx * (j + ny * k)] < 0) {
          if (s0) quad(C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j, k), C(i, j - 1, k));
          else quad(C(i, j - 1, k - 1), C(i, j - 1, k), C(i, j, k), C(i, j, k - 1));
        }
        if (j + 1 < ny && i > 0 && k > 0 && i < nx - 1 && k < nz - 1 && s0 !== val[i + nx * (j + 1 + ny * k)] < 0) {
          if (s0) quad(C(i - 1, j, k - 1), C(i - 1, j, k), C(i, j, k), C(i, j, k - 1));
          else quad(C(i - 1, j, k - 1), C(i, j, k - 1), C(i, j, k), C(i - 1, j, k));
        }
        if (k + 1 < nz && i > 0 && j > 0 && i < nx - 1 && j < ny - 1 && s0 !== val[i + nx * (j + ny * (k + 1))] < 0) {
          if (s0) quad(C(i - 1, j - 1, k), C(i, j - 1, k), C(i, j, k), C(i - 1, j, k));
          else quad(C(i - 1, j - 1, k), C(i - 1, j, k), C(i, j, k), C(i, j - 1, k));
        }
      }
  return { pos, tris };
}

/** Binary min-heap of edge collapses. */
class Heap {
  constructor() {
    this.c = [];
    this.d = [];
  }
  push(cost, data) {
    const c = this.c;
    const d = this.d;
    let i = c.length;
    c.push(cost);
    d.push(data);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= c[i]) break;
      [c[p], c[i]] = [c[i], c[p]];
      [d[p], d[i]] = [d[i], d[p]];
      i = p;
    }
  }
  pop() {
    const c = this.c;
    const d = this.d;
    const top = d[0];
    const lc = c.pop();
    const ld = d.pop();
    if (c.length) {
      c[0] = lc;
      d[0] = ld;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < c.length && c[l] < c[m]) m = l;
        if (r < c.length && c[r] < c[m]) m = r;
        if (m === i) break;
        [c[m], c[i]] = [c[i], c[m]];
        [d[m], d[i]] = [d[i], d[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.c.length;
  }
}

/**
 * Edge-collapse decimation to `target` triangles. Each collapse moves the kept vertex to the
 * edge's midpoint pulled onto the surface; cost = importance x length^2 + K x quadric error.
 */
export function decimate(f, pos0, tris0, target, importance) {
  const nv = pos0.length / 3;
  const nt = tris0.length / 3;
  const P = Float64Array.from(pos0);
  const T = Int32Array.from(tris0);
  const tAlive = new Uint8Array(nt).fill(1);
  const vAlive = new Uint8Array(nv).fill(1);
  const vt = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vt[T[t * 3 + k]].push(t);
  const Q = new Float64Array(nv * 10);
  const V = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  for (let t = 0; t < nt; t++) {
    const a = V(T[t * 3]);
    const b = V(T[t * 3 + 1]);
    const c = V(T[t * 3 + 2]);
    const n = cross(sub(b, a), sub(c, a));
    const A = len(n) / 2;
    if (A < 1e-12) continue;
    const [nx, ny, nz] = scl(n, 1 / (2 * A));
    const d = -dot([nx, ny, nz], a);
    const q = [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
    for (let k = 0; k < 3; k++) for (let m = 0; m < 10; m++) Q[T[t * 3 + k] * 10 + m] += q[m] * A;
  }
  const qerr = (u, v, p) => {
    const [x, y, z] = p;
    let e = 0;
    for (const w of [u, v]) {
      const q = w * 10;
      e +=
        Q[q] * x * x +
        2 * Q[q + 1] * x * y +
        2 * Q[q + 2] * x * z +
        2 * Q[q + 3] * x +
        Q[q + 4] * y * y +
        2 * Q[q + 5] * y * z +
        2 * Q[q + 6] * y +
        Q[q + 7] * z * z +
        2 * Q[q + 8] * z +
        Q[q + 9];
    }
    return Math.max(e, 0);
  };
  const ver = new Int32Array(nv);
  const heap = new Heap();
  const K = 300;
  const pushEdge = (u, v) => {
    const a = V(u);
    const b = V(v);
    const m = scl(add(a, b), 0.5);
    const l2 = dot(sub(a, b), sub(a, b));
    heap.push(importance(m) * l2 + K * qerr(u, v, m), [u, v, ver[u], ver[v]]);
  };
  const seen = new Set();
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const a = T[t * 3 + k];
      const b = T[t * 3 + ((k + 1) % 3)];
      const key = a < b ? a * nv + b : b * nv + a;
      if (seen.has(key)) continue;
      seen.add(key);
      pushEdge(a, b);
    }
  const neighbours = (u) => {
    const s = new Set();
    for (const t of vt[u]) if (tAlive[t]) for (let k = 0; k < 3; k++) s.add(T[t * 3 + k]);
    s.delete(u);
    return s;
  };
  const normal = (a, b, c) => cross(sub(b, a), sub(c, a));
  let live = nt;
  while (live > target && heap.size) {
    const [u, v, vu, vv] = heap.pop();
    if (!vAlive[u] || !vAlive[v] || ver[u] !== vu || ver[v] !== vv) continue;
    const nu = neighbours(u);
    if (!nu.has(v)) continue;
    const nvv = neighbours(v);
    let common = 0;
    for (const w of nu) if (nvv.has(w)) common++;
    if (common !== 2) continue;
    const p = project(f, scl(add(V(u), V(v)), 0.5));
    let ok = true;
    for (const w of [u, v]) {
      for (const t of vt[w]) {
        if (!tAlive[t]) continue;
        const ids = [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]];
        if (ids.includes(u) && ids.includes(v)) continue;
        const old = ids.map(V);
        const nw = ids.map((i) => (i === u || i === v ? p : V(i)));
        const n0 = normal(...old);
        const n1 = normal(...nw);
        const l1 = len(n1);
        if (l1 < 1e-10 || dot(n0, n1) / (len(n0) * l1) < 0.3) {
          ok = false;
          break;
        }
        const e2 = dot(sub(nw[0], nw[1]), sub(nw[0], nw[1])) + dot(sub(nw[1], nw[2]), sub(nw[1], nw[2])) + dot(sub(nw[2], nw[0]), sub(nw[2], nw[0]));
        if ((2 * Math.sqrt(3) * l1) / e2 < 0.18) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    for (const t of vt[v]) {
      if (!tAlive[t]) continue;
      const ids = [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]];
      if (ids.includes(u)) {
        tAlive[t] = 0;
        live--;
      } else {
        for (let k = 0; k < 3; k++) if (T[t * 3 + k] === v) T[t * 3 + k] = u;
        vt[u].push(t);
      }
    }
    vt[u] = vt[u].filter((t) => tAlive[t]);
    vAlive[v] = 0;
    P.set(p, u * 3);
    for (let m = 0; m < 10; m++) Q[u * 10 + m] += Q[v * 10 + m];
    ver[u]++;
    for (const w of neighbours(u)) pushEdge(u, w);
  }
  // compact
  const map = new Int32Array(nv).fill(-1);
  const pos = [];
  const tris = [];
  for (let t = 0; t < nt; t++) {
    if (!tAlive[t]) continue;
    for (let k = 0; k < 3; k++) {
      const i = T[t * 3 + k];
      if (map[i] < 0) {
        map[i] = pos.length / 3;
        pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      }
      tris.push(map[i]);
    }
  }
  return { pos, tris };
}

/** Tangential smoothing: each vertex toward its neighbours' centre, then back onto the surface. */
export function relax(f, pos, tris, iters = 3) {
  const n = pos.length / 3;
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      nb[tris[t + k]].add(tris[t + ((k + 1) % 3)]);
      nb[tris[t + k]].add(tris[t + ((k + 2) % 3)]);
    }
  for (let it = 0; it < iters; it++) {
    const next = pos.slice();
    for (let i = 0; i < n; i++) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const j of nb[i]) {
        cx += pos[j * 3];
        cy += pos[j * 3 + 1];
        cz += pos[j * 3 + 2];
      }
      const k = nb[i].size;
      const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      let d = sub([cx / k, cy / k, cz / k], p);
      const g = gradient(f, ...p);
      d = sub(d, scl(g, dot(d, g)));
      const q = project(f, add(p, scl(d, 0.5)));
      next[i * 3] = q[0];
      next[i * 3 + 1] = q[1];
      next[i * 3 + 2] = q[2];
    }
    for (let i = 0; i < pos.length; i++) pos[i] = next[i];
  }
}

/** Unit normals from the field's gradient, one per vertex (an array of [x, y, z]). */
export function fieldNormals(f, pos) {
  const out = [];
  for (let i = 0; i < pos.length / 3; i++) out.push(gradient(f, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  return out;
}

/**
 * Ambient occlusion per vertex from the field: samples along the normal (`count` steps of `step`)
 * and darkens where the field is closer than the step. Returns 0..1 factors (min `min`).
 * `fo` may be a field without carved details (sockets) so they do not darken their rims.
 */
export function fieldAO(fo, pos, nor, { step = 0.025, count = 5, strength = 2.2, min = 0.74 } = {}) {
  const ao = new Float32Array(pos.length / 3);
  for (let i = 0; i < ao.length; i++) {
    const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    let occ = 0;
    for (let s = 1; s <= count; s++) {
      const d = s * step;
      const q = add(p, scl(nor[i], d));
      occ += (d - fo(q[0], q[1], q[2])) / 2 ** s;
    }
    ao[i] = clamp(1 - occ * strength, min, 1);
  }
  return ao;
}

/**
 * The whole shell: polygonise f over the box [lo, hi] at spacing `grid`, decimate to about
 * `triangles` (importance(p) > 1 keeps a region denser: faces, ears, paws), relax.
 * @param {(x:number,y:number,z:number)=>number} f the field
 * @param {{lo:number[], hi:number[], grid?:number, triangles?:number, importance?:(p:number[])=>number, relax?:number}} o
 * @returns {{pos:number[], tris:number[], nor:number[][]}}
 */
export function buildShell(f, { lo, hi, grid = 0.02, triangles = 5600, importance = () => 1, relax: iters = 3 }) {
  const net = surfaceNets(f, lo, hi, grid);
  for (let i = 0; i < net.pos.length; i += 3) {
    const q = project(f, [net.pos[i], net.pos[i + 1], net.pos[i + 2]]);
    net.pos[i] = q[0];
    net.pos[i + 1] = q[1];
    net.pos[i + 2] = q[2];
  }
  const dec = decimate(f, net.pos, net.tris, triangles, importance);
  relax(f, dec.pos, dec.tris, iters);
  return { pos: dec.pos, tris: dec.tris, nor: fieldNormals(f, dec.pos) };
}

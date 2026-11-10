import * as THREE from 'three';
import { faceNormals } from './face-reader.js';

/**
 * Chamfered die geometry (non-indexed, CCW from outside).
 *
 * Attributes: position, normal, aFaceId (face index, -1 on bevel/corner/rim triangles) and
 * aFaceUV (face-local 2D coords: origin at the face centroid, scaled so the face inradius is 1).
 *
 * aFaceUV frame: V points from the centroid towards the face's first vertex, U = V x normal.
 * (U, V, normal) is right-handed, so seen from outside U runs right and V up: glyphs are not
 * mirrored. For the coin caps V = +Z on both caps; U = V x n (-X on the top cap, +X on the
 * bottom cap).
 */

const COIN_HALF_HEIGHT = 0.125;
const COIN_SEGMENTS = 48;

class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.fid = [];
    this.fuv = [];
  }
  /** Push one triangle. verts: [{p, n, uv?}] x3 (Vector3 p/n, uv [u, v]). */
  tri(a, b, c, id = -1) {
    for (const v of [a, b, c]) {
      this.pos.push(v.p.x, v.p.y, v.p.z);
      this.nrm.push(v.n.x, v.n.y, v.n.z);
      this.fid.push(id);
      this.fuv.push(v.uv ? v.uv[0] : 0, v.uv ? v.uv[1] : 0);
    }
  }
  finish(faceCount) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aFaceId', new THREE.Float32BufferAttribute(this.fid, 1));
    g.setAttribute('aFaceUV', new THREE.Float32BufferAttribute(this.fuv, 2));
    g.userData.faceCount = faceCount;
    return g;
  }
}

const slerpNormal = (a, b, t) => {
  const q = new THREE.Quaternion().setFromUnitVectors(a, b);
  const qt = new THREE.Quaternion().slerp(q, t);
  return a.clone().applyQuaternion(qt).normalize();
};

function buildPolyhedron(shape, chamfer, segs, b) {
  const V = shape.vertices.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
  const normals = faceNormals(shape).map((n) => new THREE.Vector3(n.x, n.y, n.z));

  // Per-face frame, inradius and inward in-plane edge normals.
  const info = shape.faces.map((f, i) => {
    const n = normals[i];
    const pts = f.map((vi) => V[vi]);
    const c = new THREE.Vector3();
    pts.forEach((p) => c.add(p));
    c.divideScalar(pts.length);
    const inward = pts.map((p, j) => {
      const e = pts[(j + 1) % pts.length].clone().sub(p).normalize();
      return new THREE.Vector3().crossVectors(n, e).normalize(); // left of CCW edge = inside
    });
    const r = Math.min(...pts.map((p, j) => c.clone().sub(p).dot(inward[j])));
    const vAxis = pts[0].clone().sub(c);
    vAxis.addScaledVector(n, -vAxis.dot(n)).normalize();
    const uAxis = new THREE.Vector3().crossVectors(vAxis, n); // right-handed (U, V, n)
    return { n, pts, c, inward, r, uAxis, vAxis };
  });

  const w = Math.min(chamfer, 0.45 * Math.min(...info.map((f) => f.r)));
  const depth = w * 0.5;

  // Inset (and sunk) face polygons.
  info.forEach((f) => {
    const k = f.pts.length;
    f.inset = f.pts.map((p, j) => {
      const m0 = f.inward[(j + k - 1) % k];
      const m1 = f.inward[j];
      const s = w / (1 + m0.dot(m1));
      return p.clone().addScaledVector(m0, s).addScaledVector(m1, s).addScaledVector(f.n, -depth);
    });
    f.verts = f.inset.map((p) => {
      const d = p.clone().sub(f.c);
      return { p, n: f.n, uv: [d.dot(f.uAxis) / f.r, d.dot(f.vAxis) / f.r] };
    });
  });

  // Face triangles.
  info.forEach((f, i) => {
    for (let j = 1; j < f.verts.length - 1; j++) b.tri(f.verts[0], f.verts[j], f.verts[j + 1], i);
  });
  if (w <= 0) return;

  // Directed edge lookup: "u,v" -> { face, idx } for the face that traverses u -> v at idx.
  const edges = new Map();
  shape.faces.forEach((f, i) =>
    f.forEach((u, j) => edges.set(`${u},${f[(j + 1) % f.length]}`, { face: i, idx: j })),
  );

  // Bevel strips: one per undirected edge, `segs` bands with slerped normals.
  shape.faces.forEach((f, i) => {
    const k = f.length;
    for (let j = 0; j < k; j++) {
      const u = f[j];
      const v = f[(j + 1) % k];
      const nb = edges.get(`${v},${u}`);
      if (!nb || nb.face < i) continue;
      const A = info[i];
      const B = info[nb.face];
      const au = A.inset[j];
      const av = A.inset[(j + 1) % k];
      const bk = B.pts.length;
      const bv = B.inset[nb.idx];
      const bu = B.inset[(nb.idx + 1) % bk];
      const row = (s) => {
        const t = s / segs;
        const n = slerpNormal(A.n, B.n, t);
        return [
          { p: au.clone().lerp(bu, t), n },
          { p: av.clone().lerp(bv, t), n },
        ];
      };
      let prev = row(0);
      for (let s = 1; s <= segs; s++) {
        const cur = row(s);
        b.tri(prev[0], cur[1], prev[1]);
        b.tri(prev[0], cur[0], cur[1]);
        prev = cur;
      }
    }
  });

  // Corner fans: one per original vertex, blended normals at the centre.
  V.forEach((vp, vi) => {
    const d = vp.clone().normalize();
    const ring = [];
    shape.faces.forEach((f, i) => {
      const j = f.indexOf(vi);
      if (j >= 0) ring.push({ p: info[i].inset[j], n: info[i].n });
    });
    const centre = new THREE.Vector3();
    const cn = new THREE.Vector3();
    ring.forEach((r) => {
      centre.add(r.p);
      cn.add(r.n);
    });
    centre.divideScalar(ring.length);
    cn.normalize();
    const ref = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const e1 = new THREE.Vector3().crossVectors(ref, d).normalize();
    const e2 = new THREE.Vector3().crossVectors(d, e1);
    const ang = (r) => {
      const q = r.p.clone().sub(centre);
      return Math.atan2(q.dot(e2), q.dot(e1));
    };
    ring.sort((a, c) => ang(a) - ang(c)); // ascending = CCW seen from outside
    const mid = { p: centre, n: cn };
    ring.forEach((r, k) => b.tri(mid, r, ring[(k + 1) % ring.length]));
  });
}

function buildCoin(chamfer, segs, b) {
  const hh = COIN_HALF_HEIGHT;
  const cc = Math.min(Math.max(chamfer, 0), hh * 0.8);
  // Side radius is as large as fits in the unit sphere with the rim corner on it.
  const R = Math.sqrt(1 - (hh - cc) * (hh - cc));
  const rc = R - cc; // flat cap radius

  // Profile (r, y, nr, ny) from the top cap edge, around the side, to the bottom cap edge.
  const prof = [];
  const arc = (sy, from, to) => {
    for (let s = 0; s <= segs; s++) {
      const th = from + ((to - from) * s) / segs;
      prof.push({
        r: rc + cc * Math.cos(th),
        y: sy * (hh - cc) + sy * cc * Math.sin(th),
        nr: Math.cos(th),
        ny: sy * Math.sin(th),
      });
    }
  };
  if (cc > 0) {
    arc(1, Math.PI / 2, 0);
    arc(-1, 0, Math.PI / 2);
  } else {
    prof.push({ r: R, y: hh, nr: 0, ny: 1 }, { r: R, y: hh, nr: 1, ny: 0 });
    prof.push({ r: R, y: -hh, nr: 1, ny: 0 }, { r: R, y: -hh, nr: 0, ny: -1 });
  }

  const N = COIN_SEGMENTS;
  const at = (pr, phi) => {
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    return {
      p: new THREE.Vector3(pr.r * c, pr.y, pr.r * s),
      n: new THREE.Vector3(pr.nr * c, pr.ny, pr.nr * s),
    };
  };
  for (let i = 0; i < N; i++) {
    const p0 = (2 * Math.PI * i) / N;
    const p1 = (2 * Math.PI * (i + 1)) / N;
    // Rim and side bands (top to bottom).
    for (let k = 0; k + 1 < prof.length; k++) {
      const A = prof[k];
      const B = prof[k + 1];
      if (Math.hypot(A.r - B.r, A.y - B.y) < 1e-9) continue;
      const ai = at(A, p0);
      const aj = at(A, p1);
      const bi = at(B, p0);
      const bj = at(B, p1);
      b.tri(ai, aj, bi);
      b.tri(aj, bj, bi);
    }
    // Caps: face 0 = +Y, face 1 = -Y; V = +Z, U = V x n.
    for (const [id, y, ny] of [
      [0, hh, 1],
      [1, -hh, -1],
    ]) {
      const uSign = -ny; // U = Z x (0, ny, 0) = (-ny, 0, 0)
      const cap = (phi) => {
        const x = rc * Math.cos(phi);
        const z = rc * Math.sin(phi);
        return {
          p: new THREE.Vector3(x, y, z),
          n: new THREE.Vector3(0, ny, 0),
          uv: [(uSign * x) / rc, z / rc],
        };
      };
      const centre = { p: new THREE.Vector3(0, y, 0), n: new THREE.Vector3(0, ny, 0), uv: [0, 0] };
      if (ny > 0) b.tri(centre, cap(p1), cap(p0), id);
      else b.tri(centre, cap(p0), cap(p1), id);
    }
  }
}

/**
 * @param {object} shape ShapeDef from getShape()
 * @param {{chamfer?: number, bevelSegments?: number}} [opts]
 * @returns {THREE.BufferGeometry}
 */
export function buildDieGeometry(shape, opts = {}) {
  const chamfer = Math.max(0, opts.chamfer ?? 0.06);
  const segs = Math.max(1, Math.floor(opts.bevelSegments ?? 2));
  const b = new Builder();
  if (shape.kind === 'coin') buildCoin(chamfer, segs, b);
  else buildPolyhedron(shape, chamfer, segs, b);
  return b.finish(faceNormals(shape).length);
}

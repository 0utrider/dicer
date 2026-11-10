import * as THREE from 'three';
import { faceNormals } from './face-reader.js';

/**
 * Edge-styled die geometry (non-indexed, CCW from outside).
 *
 * Attributes: position, normal, aFaceId (face index, -1 on bevel/corner/rim triangles),
 * aFaceUV (face-local 2D coords: origin at the face centroid, scaled so the face inradius is 1)
 * and aEdgeDist (face units, see below).
 *
 * aFaceUV frame: V points from the centroid towards the face's first vertex, U = V x normal.
 * (U, V, normal) is right-handed, so seen from outside U runs right and V up: glyphs are not
 * mirrored. For the coin caps V = +Z on both caps; U = V x n (-X on the top cap, +X on the
 * bottom cap).
 *
 * Faces are centroid fans: each face triangle is (centroid, v_i, v_i+1). aEdgeDist is linear
 * in each fan triangle: 0 at the polygon vertices (so 0 along the polygon edge v_i v_i+1) and,
 * at the centroid, the inset face's inradius in face units. On regular faces that is exactly
 * the distance to the triangle's polygon edge; on the d10 kites (whose centroid is not
 * equidistant from all four edges) it is that distance rescaled per triangle so every face has
 * one centroid value. Bevel, corner and rim triangles carry 0.
 *
 * Edge profile (polyhedra): the die is the Minkowski sum of the polyhedron shrunk about its
 * centre with a sphere of radius rho. Each face keeps its plane; its flat part is the face
 * scaled by s = (r_in - rho) / r_in about the insphere tangent point. Each edge becomes a
 * cylinder of radius rho whose axis is the shrunk edge, i.e. the intersection of the two face
 * planes offset inward by rho: a circular arc tangent to both faces at the inset edges A and B,
 * rho = w / tan(theta / 2) for an in-plane inset w and dihedral turn theta. Each corner is a
 * sphere patch of radius rho around the shrunk vertex (the corner's offset centre). Strip rows
 * sit at shrunkEdge + rho * slerp(nA, nB, t), so their normals are exact and the silhouette is
 * a true round, not a flat chamfer. This replaces Plan 1's flat chamfer and its sunk faces
 * (the unexplained `depth = w * 0.5`): faces now stay on their planes and no depth is needed.
 *
 * Non-uniform dihedral angles (the d10 has two edge classes): one rho per die keeps the
 * Minkowski construction exact (strips and corner patches meet without cracks), so rho is
 * taken from the largest dihedral turn, rho = w / tan(theta_max / 2). The widest inset is then
 * exactly w and edges with a smaller turn get a narrower inset rho * tan(theta / 2).
 *
 * Every vertex lies at |s * V + rho * n| <= s + rho = 1 - rho * (1 / r_in - 1) < 1, so the die
 * stays strictly inside the unit sphere for any bevelSegments; a uniform rescale in finish()
 * is only a safety net against rounding.
 */

/** Edge style defaults. An explicit `chamfer` or `bevelSegments` option overrides them. */
export const EDGE_STYLES = Object.freeze({
  rounded: Object.freeze({ chamfer: 0.07, bevelSegments: 3 }),
  sharp: Object.freeze({ chamfer: 0.012, bevelSegments: 1 }),
});

const COIN_HALF_HEIGHT = 0.125;
const COIN_SEGMENTS = 48;
/** The in-plane bevel inset is capped at this fraction of the smallest face inradius. */
const MAX_INSET_FRACTION = 0.45;

class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.fid = [];
    this.fuv = [];
    this.edge = [];
  }
  /** Push one triangle. verts: [{p, n, uv?, e?}] x3 (Vector3 p/n, uv [u, v], e edge distance). */
  tri(a, b, c, id = -1) {
    for (const v of [a, b, c]) {
      this.pos.push(v.p.x, v.p.y, v.p.z);
      this.nrm.push(v.n.x, v.n.y, v.n.z);
      this.fid.push(id);
      this.fuv.push(v.uv ? v.uv[0] : 0, v.uv ? v.uv[1] : 0);
      this.edge.push(id >= 0 && v.e ? v.e : 0);
    }
  }
  finish(faceCount, style) {
    let max = 0;
    for (let i = 0; i < this.pos.length; i += 3)
      max = Math.max(max, Math.hypot(this.pos[i], this.pos[i + 1], this.pos[i + 2]));
    if (max > 1) for (let i = 0; i < this.pos.length; i++) this.pos[i] /= max;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aFaceId', new THREE.Float32BufferAttribute(this.fid, 1));
    g.setAttribute('aFaceUV', new THREE.Float32BufferAttribute(this.fuv, 2));
    g.setAttribute('aEdgeDist', new THREE.Float32BufferAttribute(this.edge, 1));
    g.userData.faceCount = faceCount;
    g.userData.style = style;
    return g;
  }
}

/** Spherical interpolation of unit vectors; exact copies of a / b at t = 0 / 1. */
function slerpUnit(a, b, t) {
  if (t <= 0) return a.clone();
  if (t >= 1) return b.clone();
  const om = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  if (om < 1e-9) return a.clone().lerp(b, t).normalize();
  const so = Math.sin(om);
  return a
    .clone()
    .multiplyScalar(Math.sin((1 - t) * om) / so)
    .addScaledVector(b, Math.sin(t * om) / so)
    .normalize();
}

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

  // Directed edge lookup: "u,v" -> { face, idx } for the face that traverses u -> v at idx.
  const edges = new Map();
  shape.faces.forEach((f, i) =>
    f.forEach((u, j) => edges.set(`${u},${f[(j + 1) % f.length]}`, { face: i, idx: j })),
  );

  // Profile radius from the largest dihedral turn (see the header on non-uniform dihedrals).
  let maxTurn = 0;
  shape.faces.forEach((f, i) =>
    f.forEach((u, j) => {
      const nb = edges.get(`${f[(j + 1) % f.length]},${u}`);
      if (nb) maxTurn = Math.max(maxTurn, normals[i].angleTo(normals[nb.face]));
    }),
  );
  const w = Math.min(chamfer, MAX_INSET_FRACTION * Math.min(...info.map((f) => f.r)));
  // Insphere radius: every Dicer polyhedron is face-transitive, so all face planes share it.
  const rIn = Math.min(...info.map((f) => f.c.dot(f.n)));
  const rho = w > 0 && maxTurn > 0 ? w / Math.tan(maxTurn / 2) : 0;
  const s = (rIn - rho) / rIn;
  /** Surface point over vertex vi in direction dir: shrunk vertex + rho * dir. */
  const at = (vi, dir) => V[vi].clone().multiplyScalar(s).addScaledVector(dir, rho);

  // Face triangles: centroid fans over the inset polygon.
  info.forEach((f, i) => {
    const loop = shape.faces[i];
    const k = loop.length;
    const inset = loop.map((vi) => at(vi, f.n));
    const insetR = Math.min(...inset.map((p, j) => f.c.clone().sub(p).dot(f.inward[j])));
    const verts = inset.map((p) => {
      const d = p.clone().sub(f.c);
      return { p, n: f.n, uv: [d.dot(f.uAxis) / f.r, d.dot(f.vAxis) / f.r], e: 0 };
    });
    // The centroid, projected onto the inset plane (a no-op for face-transitive solids).
    const cp = f.c.clone().addScaledVector(f.n, inset[0].dot(f.n) - f.c.dot(f.n));
    const centre = { p: cp, n: f.n, uv: [0, 0], e: insetR / f.r };
    for (let j = 0; j < k; j++) b.tri(centre, verts[j], verts[(j + 1) % k], i);
  });
  if (rho <= 0) return;

  /**
   * Normal k/segs of the way from face fa to face fb. Computed in a canonical direction so a
   * strip row and the matching corner-patch boundary point are bit-identical (no cracks).
   */
  const arc = (fa, fb, k) =>
    fa < fb
      ? slerpUnit(normals[fa], normals[fb], k / segs)
      : slerpUnit(normals[fb], normals[fa], (segs - k) / segs);

  // Edge strips: one per undirected edge, rows on the rho-cylinder around the shrunk edge.
  shape.faces.forEach((f, i) => {
    const k = f.length;
    for (let j = 0; j < k; j++) {
      const u = f[j];
      const v = f[(j + 1) % k];
      const nb = edges.get(`${v},${u}`);
      if (!nb || nb.face < i) continue;
      const row = (t) => {
        const n = arc(i, nb.face, t);
        return [
          { p: at(u, n), n },
          { p: at(v, n), n },
        ];
      };
      let prev = row(0);
      for (let t = 1; t <= segs; t++) {
        const cur = row(t);
        b.tri(prev[0], cur[1], prev[1]);
        b.tri(prev[0], cur[0], cur[1]);
        prev = cur;
      }
    }
  });

  // Corner patches: the rho-sphere around each shrunk vertex, bounded by the adjacent faces'
  // normals. One fan per corner from the mean normal d to the boundary arcs, which are sampled
  // exactly like the strip rows (so they meet crack-free). Every vertex is on the sphere; the
  // patch interior is not subdivided further. Judgment call: interior rows would add
  // ~(segs - 1) * segs / 2 points per sector to the physics hull (P2-R3 uses this geometry), and
  // measured they doubled the per-step contact cost (30 x d20 first chunk 16 -> 32 ms) for a
  // silhouette sag of under 0.01 units at the default radius.
  V.forEach((vp, vi) => {
    const ring = [];
    shape.faces.forEach((f, i) => {
      if (f.includes(vi)) ring.push(i);
    });
    const d = new THREE.Vector3();
    ring.forEach((fi) => d.add(normals[fi]));
    d.normalize();
    const ref = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const e1 = new THREE.Vector3().crossVectors(ref, d).normalize();
    const e2 = new THREE.Vector3().crossVectors(d, e1);
    const ang = (fi) => Math.atan2(normals[fi].dot(e2), normals[fi].dot(e1));
    ring.sort((a, c) => ang(a) - ang(c)); // ascending = CCW seen from outside
    const vert = (n) => ({ p: at(vi, n), n });
    const mid = vert(d);
    ring.forEach((fa, r) => {
      const fb = ring[(r + 1) % ring.length];
      let prev = vert(arc(fa, fb, 0));
      for (let j = 1; j <= segs; j++) {
        const cur = vert(arc(fa, fb, j));
        b.tri(mid, prev, cur);
        prev = cur;
      }
    });
  });
}

function buildCoin(chamfer, segs, b) {
  const hh = COIN_HALF_HEIGHT;
  const cc = Math.min(Math.max(chamfer, 0), hh * 0.8);
  // Rim profile: a quarter arc of radius cc tangent to cap and side (the polyhedra's construction
  // with a 90 degree turn, rho = w). Its centre (rc, hh - cc) sits at distance 1 - cc from the
  // origin, so the arc touches the unit sphere at one point and never crosses it (Plan 1 put the
  // arc's end on the sphere instead, and the arc overshot to |p| = 1.00014).
  const rc = Math.sqrt((1 - cc) * (1 - cc) - (hh - cc) * (hh - cc)); // flat cap radius
  const R = rc + cc; // side radius

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
  // Cap centre edge distance: the centre-to-chord distance of the N-gon, in cap-radius units.
  const capEdge = Math.cos(Math.PI / N);
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
          e: 0,
        };
      };
      const centre = {
        p: new THREE.Vector3(0, y, 0),
        n: new THREE.Vector3(0, ny, 0),
        uv: [0, 0],
        e: capEdge,
      };
      if (ny > 0) b.tri(centre, cap(p1), cap(p0), id);
      else b.tri(centre, cap(p0), cap(p1), id);
    }
  }
}

/**
 * @param {object} shape ShapeDef from getShape()
 * @param {{chamfer?: number, bevelSegments?: number, style?: 'rounded'|'sharp'}} [opts]
 *   style 'rounded' (default): chamfer 0.07, bevelSegments 3. 'sharp': chamfer 0.012,
 *   bevelSegments 1 (a crisp highlight line). Explicit chamfer / bevelSegments override.
 * @returns {THREE.BufferGeometry}
 */
export function buildDieGeometry(shape, opts = {}) {
  const style = opts.style ?? 'rounded';
  const def = Object.hasOwn(EDGE_STYLES, style) ? EDGE_STYLES[style] : null;
  if (!def) throw new Error(`Dicer: unknown edge style "${style}"`);
  const chamfer = Math.max(0, opts.chamfer ?? def.chamfer);
  const segs = Math.max(1, Math.floor(opts.bevelSegments ?? def.bevelSegments));
  const b = new Builder();
  if (shape.kind === 'coin') buildCoin(chamfer, segs, b);
  else buildPolyhedron(shape, chamfer, segs, b);
  return b.finish(faceNormals(shape).length, style);
}

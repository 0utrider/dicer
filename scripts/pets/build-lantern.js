import {
  ALL_KEYS,
  DEG,
  MeshBuffer,
  add,
  appendShell,
  assemble,
  boneIndex,
  buildShell,
  carveSockets,
  clamp,
  createAtlas,
  createCanvas,
  cross,
  dilate,
  ellipsoid,
  eyeballs,
  eyelids,
  fbm,
  fieldAO,
  fitScale,
  gradient,
  len,
  lerp3,
  mix,
  norm,
  paintRect,
  paintShell,
  project,
  scl,
  smax,
  smin,
  srgb,
  sstep,
  sub,
  surfaceAt,
  tiltFrame,
  toTexture,
  torus,
  vnoise,
  write,
} from './lib/index.js';

/**
 * Dicer's lantern pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a chochin-obake, a paper-lantern yokai floating over the floor. A round paper body
 * pleated between bamboo ribs (tinted by Dicer, a neutral warm grey; the ribs painted bamboo),
 * a dark lacquer cap with a knob and a base ring, a wire handle loop on top, and a red tassel with a
 * gold knot hanging plumb from the base to the floor. One big eye high in the middle, a wide grin
 * along a rib with a long pink tongue lolling out over the lower lip and down the front. The whole
 * lantern hangs tipped back, its face up toward Dicer's top-down camera. The paper glows from inside
 * (an emissive map: a soft warm glow between the ribs, bright along the mouth and inside it).
 * Natural colour: amber #e8b04a.
 *
 * One fused `Body` shell (paper, cap, knob and base ring: a distance field, meshed) with the lids,
 * the mouth's inside, the tongue, the handle and the tassel in the same mesh; `Eyes` the one
 * eyeball. Bones: root, body, head (the lantern, pivot at its centre), eye_L/R and tail_1..3 (the
 * tassel, under body; its top ring on head, so it stays on the base and the cord swings below).
 *
 * One eye, two blink keys (as the floating eye): eye_L and eye_R share the eyeball's centre and the
 * eyeball is wholly on eye_L (eye_R is a bone with no geometry; the loader turns both alike). The
 * lids exist twice round the one eye, the "R" set a hair inside the "L" set: blink_L / squint_L
 * close the outer set, blink_R / squint_R the inner, so either blink alone shuts the eye and both
 * together (the loader's blink) shut it once. The expression keys move both sets alike (their
 * slanted lids mirror, so the one eye frowns or worries symmetrically).
 * The tongue is out at rest; the `tongue` key flicks it straight out (the throw: it flicks the dice
 * with it), and `mouthOpen` drops the lower lip, opens the glowing mouth and carries the tongue down.
 */

// ------------------------------------------------------------------------------- the design

const TILT = 0.8; // the lantern tipped back, its face up toward the top-down camera (as the code-built one)
const LANTERN = tiltFrame([0, 0.77, -0.05], TILT);
const { fw, fdir, wf } = LANTERN;
const R = 0.69; // the paper's widest radius
const H2 = 0.46; // its half height (lantern-local y), cut flat under the cap and over the base
const RY = H2 / Math.sqrt(0.75); // the paper's ellipsoid height radius (narrowing to half at the ends)
const RIBS = [-0.345, -0.23, -0.115, 0, 0.115, 0.23, 0.345];
const MY = -0.115; // the mouth, along a rib
const EYE_R = 0.215;
const EYE_Y = 0.2;
const R_SOCK = 1.24;
const EYE_AIM = 0.4; // the eye turned up from the face's forward (rad)
const EYE_SINK = 0.075; // its centre this far inside the paper
const EYE_OPEN = 50 * DEG; // the opening above and below its centre
const BASE_Y = -H2 - 0.06; // the base ring's underside (lantern-local), where the tassel hangs
const T_LEN = 0.52; // the tongue

const COL = {
  lacquer: srgb(44, 29, 24),
  lacquerHi: srgb(98, 70, 58),
  bamboo: srgb(128, 86, 46),
  wire: srgb(58, 52, 50),
  tassel: srgb(176, 34, 30),
  tasselDark: srgb(120, 20, 20),
  knot: srgb(222, 168, 60),
  mouth: srgb(255, 168, 70),
  mouthDeep: srgb(214, 84, 28),
  lip: srgb(92, 26, 18),
  tongue: srgb(240, 120, 140),
  tongueGroove: srgb(204, 88, 112),
};
const GLOW = srgb(255, 176, 90);

/** Paper radius at lantern-local height y. */
const paperR = (y) => R * Math.sqrt(Math.max(0.05, 1 - (y / RY) ** 2));
/** The grin's line (lantern-local y at x): along the rib, its corners turned up. */
const grinY = (x) => MY + 0.05 * (x / 0.32) ** 2;
const GRIN_W = 0.32;

/** A rounded capped cylinder about the lantern's axis (lantern-local), centre height cy. */
function cylinder(cy, r, h, round) {
  return (qx, qy, qz) => {
    const dr = Math.hypot(qx, qz) - r + round;
    const dy = Math.abs(qy - cy) - h + round;
    return Math.hypot(Math.max(dr, 0), Math.max(dy, 0)) + Math.min(Math.max(dr, dy), 0) - round;
  };
}

function makeShape() {
  const paper = ellipsoid([0, 0, 0], [R, RY, R]);
  const ribs = RIBS.map((y) => torus([0, y, 0], paperR(y) + 0.014, 0.024));
  const cap = cylinder(H2 + 0.025, paperR(H2) * 1.1, 0.045, 0.02);
  const knob = cylinder(H2 + 0.085, 0.085, 0.03, 0.015);
  const base = cylinder(-H2 - 0.02, paperR(H2) * 1.1, 0.04, 0.02);
  const shape = { eyes: [] };
  /** Distances to the parts (lantern-local evaluation of model point x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    let d = smax(paper(qx, qy, qz), Math.abs(qy) - H2, 0.02);
    // pleats: a soft valley at every rib
    for (const r of ribs) d = smax(d, -r(qx, qy, qz), 0.018);
    o.paper = d;
    o.cap = smin(cap(qx, qy, qz), knob(qx, qy, qz), 0.02);
    o.base = base(qx, qy, qz);
    return o;
  };
  const P = {};
  shape.solid = (x, y, z) => {
    shape.parts(x, y, z, P);
    const d = smin(smin(P.paper, P.cap, 0.012), P.base, 0.012);
    return smax(d, -y, 0.02);
  };
  // The one eye (placed by hand: on a round lantern the lib's placeEyes finds no opening): sunk a
  // little into the paper, aimed up past the face toward the camera; the same eye twice, the L and
  // R sides (see the header).
  const F = norm(fdir(0, Math.sin(EYE_AIM), Math.cos(EYE_AIM)));
  const U = norm(fdir(0, Math.cos(EYE_AIM), -Math.sin(EYE_AIM)));
  const E = fw(0, EYE_Y, paperR(EYE_Y) - EYE_SINK);
  shape.eyes = [1, -1].map((side) => ({ side, r: EYE_R, E, F, U, X: cross(U, F), top: EYE_OPEN, bottom: EYE_OPEN }));
  shape.sdf = (x, y, z) => carveSockets(shape.solid(x, y, z), x, y, z, [shape.eyes[0]], EYE_R * R_SOCK);
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const ATTACH = fw(0, BASE_Y, 0); // the tassel's top (model)
const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.45, 0]],
  ['head', 'body', LANTERN.center],
  ['eye_L', 'head', null], // the eye's centre (both)
  ['eye_R', 'head', null],
  ['tail_1', 'body', ATTACH],
  ['tail_2', 'tail_1', [ATTACH[0], ATTACH[1] * 0.55, ATTACH[2]]],
  ['tail_3', 'tail_2', [ATTACH[0], 0.17, ATTACH[2]]],
];
const BI = boneIndex(BONES);

// ------------------------------------------------------------------------------- the face keys

/** Shape keys on the shell: displacement fields in lantern-local space, slid along the surface. */
function faceKeysOf(f, p, n, eye) {
  const q = wf(...p);
  const gauss = (c, s) => Math.exp(-((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2) / (2 * s * s));
  const mirror = (c, s) => gauss(c, s) + gauss([-c[0], c[1]], s);
  const fr = sstep(0.1, 0.35, q[2]); // the front only
  const slide = (d) => (len(d) < 1e-6 ? d : sub(project(f, add(p, d)), p));
  const corner = mirror([GRIN_W, grinY(GRIN_W)], 0.06) * fr;
  // the lower lip: the paper under the grin's middle
  const lip = sstep(0.02, -0.01, q[1] - grinY(q[0])) * sstep(0.2, 0, Math.abs(q[1] - MY + 0.08)) * sstep(GRIN_W + 0.08, GRIN_W - 0.05, Math.abs(q[0])) * fr;
  const brow = gauss([0, EYE_Y + EYE_R * 1.25], 0.08) * fr;
  const out = {};
  out.happy = slide(fdir(0, 0.03 * corner, 0));
  out.sad = slide(fdir(0, -0.03 * corner + 0.012 * brow, 0));
  out.surprised = slide(fdir(0, 0.02 * brow - 0.02 * lip, 0));
  out.mouthOpen = slide(fdir(0, -0.06 * lip, 0));
  out.angry = slide(fdir(0, -0.02 * brow - 0.012 * corner, 0));
  out.tongue = slide(fdir(0, -0.02 * lip, 0));
  // puff: the paper breathes out between the ribs (not round the eye, the cap or the base)
  const d = shape0.parts(...p);
  const isPaper = sstep(0.01, -0.005, d.paper - Math.min(d.cap, d.base));
  const away = sstep(EYE_R * 1.3, EYE_R * 1.8, len(sub(p, eye.E)));
  const ribK = Math.min(...RIBS.map((y) => Math.abs(q[1] - y)));
  out.puff = scl(n, 0.035 * isPaper * away * (0.55 + 0.45 * sstep(0, 0.05, ribK)));
  return out;
}
let shape0 = null; // the shape, for faceKeysOf

// ------------------------------------------------------------------------------ the extra parts

/**
 * A tube along a path: rings of `sides` round each centre c[i] with radii (ra along a1, rb along a2),
 * appended to `buf` with per-ring weights and shape keys, wound outward, capped at the ends.
 * rings: [{c, a1, a2, ra, rb, v, wts, mo(k) -> {key: delta} for ring vertex angle}]
 */
function tube(buf, atlas, rect, rings, sides, cap = [true, true]) {
  const base = buf.count;
  for (const r of rings)
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const off = add(scl(r.a1, Math.cos(a) * r.ra), scl(r.a2, Math.sin(a) * r.rb));
      const nrm = norm(add(scl(r.a1, Math.cos(a) / Math.max(r.ra, 1e-4)), scl(r.a2, Math.sin(a) / Math.max(r.rb, 1e-4))));
      buf.addVertex(add(r.c, off), nrm, atlas.rectUV(rect, k / sides, r.v), r.wts, r.mo ? r.mo(a) : {});
    }
  buf.grid(base, rings.length - 1, sides, (i) => buf.nor.slice(i * 3, i * 3 + 3));
  for (const [end, on] of [[0, cap[0]], [rings.length - 1, cap[1]]]) {
    if (!on) continue;
    const r = rings[end];
    const t = norm(cross(r.a1, r.a2));
    const outward = end === 0 ? scl(t, -Math.sign(dotDir(rings, end, t))) : scl(t, Math.sign(dotDir(rings, end, t)));
    const c = buf.addVertex(r.c, outward, atlas.rectUV(rect, 0.5, r.v), r.wts, r.mo ? r.mo(0) : {});
    for (let k = 0; k < sides; k++) buf.tri(c, base + end * (sides + 1) + k, base + end * (sides + 1) + k + 1, outward);
  }
}
/** The sign of the path's direction at ring `i` along t. */
function dotDir(rings, i, t) {
  const j = i === 0 ? 1 : i - 1;
  const d = i === 0 ? sub(rings[1].c, rings[0].c) : sub(rings[i].c, rings[j].c);
  return d[0] * t[0] + d[1] * t[1] + d[2] * t[2] || 1;
}

/**
 * The tassel: a lathe straight down from the base ring to the floor: a cord, a gold knot and a
 * flared red brush, flat on the floor. On the tail chain.
 */
function tasselPart() {
  let rect = -1;
  const L = ATTACH[1];
  // [down from the top (model units), radius]
  const prof = [
    [0, 0.03],
    [0.03, 0.016],
    [L - 0.24, 0.016],
    [L - 0.225, 0.03],
    [L - 0.2, 0.045],
    [L - 0.175, 0.03],
    [L - 0.16, 0.034],
    [L - 0.08, 0.05],
    [L - 0.01, 0.068],
    [L, 0.066],
  ];
  const wOf = (y) => {
    const top = sstep(L - 0.04, L - 0.005, y); // its top ring stays on the base (head)
    const t2 = sstep(BONES[6][2][1] + 0.04, BONES[6][2][1] - 0.04, y);
    const t3 = sstep(0.21, 0.13, y);
    const out = [];
    const a = (1 - t2) * (1 - top);
    const b = t2 * (1 - t3);
    const c = t3;
    if (top > 1e-4) out.push([BI.head, top]);
    if (a > 1e-4) out.push([BI.tail_1, a]);
    if (b > 1e-4) out.push([BI.tail_2, b]);
    if (c > 1e-4) out.push([BI.tail_3, c]);
    const s = out.reduce((k, e) => k + e[1], 0);
    return out.map(([i, v]) => [i, v / s]);
  };
  return {
    reserve(atlas) {
      rect = atlas.addRect(0.42, 0.42);
    },
    build(buf, atlas) {
      const rings = prof.map(([d, r]) => {
        const y = L - d;
        return { c: [ATTACH[0], y, ATTACH[2]], a1: [1, 0, 0], a2: [0, 0, 1], ra: r, rb: r, v: d / L, wts: wOf(y) };
      });
      tube(buf, atlas, rect, rings, 10, [false, true]);
    },
    paint(canvas, atlas) {
      paintRect(canvas, atlas, rect, (u, v, out) => {
        const d = v * L;
        let c;
        if (d > L - 0.235 && d < L - 0.165) c = lerp3(COL.knot, srgb(150, 100, 30), 0.4 * sstep(0.3, 1, Math.abs(Math.sin(u * Math.PI * 6))));
        else if (d >= L - 0.165) c = lerp3(COL.tassel, COL.tasselDark, 0.55 * sstep(0.4, 1, Math.abs(Math.sin(u * Math.PI * 22))));
        else c = COL.tassel;
        write(out, c, 0);
      });
    },
  };
}

/** The handle: a wire half-loop over the cap (lantern-local x-y plane), on head. */
function handlePart() {
  let rect = -1;
  const C0 = [0, H2 + 0.1, 0];
  const RM = 0.24;
  const r = 0.022;
  return {
    reserve(atlas) {
      rect = atlas.addRect(0.3, 0.06);
    },
    build(buf, atlas, wts) {
      const rings = [];
      const n = 16;
      for (let i = 0; i <= n; i++) {
        const a = -0.12 + ((Math.PI + 0.24) * i) / n; // a little past the half, into the knob
        const radial = [Math.cos(a), Math.sin(a), 0];
        const c = fw(...add(C0, scl(radial, RM)));
        rings.push({ c, a1: fdir(...radial), a2: fdir(0, 0, 1), ra: r, rb: r, v: i / n, wts });
      }
      tube(buf, atlas, rect, rings, 6);
    },
    paint(canvas, atlas) {
      paintRect(canvas, atlas, rect, (u, v, out) => write(out, lerp3(COL.wire, srgb(120, 112, 106), 0.5 * sstep(0.6, 1, Math.cos((u - 0.3) * Math.PI * 2))), 0));
    },
  };
}

/**
 * The tongue: a long flat pink tongue out of the grin, over the lower lip and down the front of the
 * lantern, its tip curling off the paper. `tongue` flicks it straight out (and up a little);
 * `mouthOpen` and `surprised` carry it down with the lower lip.
 */
function tonguePart(face, f) {
  let rect = -1;
  const F = fdir(0, 0, 1);
  const U = fdir(0, 1, 0);
  const X = fdir(1, 0, 0);
  const nv = 12;
  const nu = 10;
  return {
    reserve(atlas) {
      rect = atlas.addRect(0.3, 0.55);
    },
    build(buf, atlas, wts) {
      const root = face(0, MY);
      // the path (model space): from inside the grin, out over the lower lip, hanging down in front
      // of the paper and curling forward at the tip; kept clear of the paper
      const P0 = sub(root.p, scl(root.n, 0.03));
      const P1 = add(add(root.p, scl(root.n, 0.13)), scl(U, -0.03));
      const P2 = add(P1, [0, -0.26, 0.02]);
      const P3 = add(P2, [0, -0.1, 0.1]);
      const bez = (t) => {
        const u = 1 - t;
        return add(add(scl(P0, u * u * u), scl(P1, 3 * u * u * t)), add(scl(P2, 3 * u * t * t), scl(P3, t * t * t)));
      };
      const clear = (p, t) => {
        let q = p;
        const want = t < 0.12 ? -1 : 0.03; // its root sinks into the mouth
        for (let k = 0; k < 3; k++) {
          const d = f(q[0], q[1], q[2]);
          if (d >= want) break;
          q = add(q, scl(gradient(f, q[0], q[1], q[2]), want - d));
        }
        return q;
      };
      const path = [];
      for (let j = 0; j <= nv; j++) path.push(clear(bez(j / nv), j / nv));
      const rings = [];
      for (let j = 0; j <= nv; j++) {
        const t = j / nv;
        const s = t * T_LEN;
        const c = path[j];
        const tan = norm(sub(path[Math.min(nv, j + 1)], path[Math.max(0, j - 1)]));
        const nrm = norm(cross(X, tan)); // its top: away from the paper
        const side = X;
        const w = 0.11 * (1 - 0.18 * t) * Math.sqrt(Math.max(0, 1 - t ** 6));
        const th = 0.028 * (1 - 0.3 * t) * Math.sqrt(Math.max(0, 1 - t ** 6)) + 0.002;
        // the flick: straight out of the mouth, forward and a little up
        const flick = add(add(root.p, scl(F, 0.02 + s * 1.05)), scl(U, 0.12 * s - 0.02));
        const flickD = sub(flick, c);
        const drop = fdir(0, -0.06, 0);
        rings.push({
          c,
          a1: side,
          a2: nrm,
          ra: Math.max(w, 0.004),
          rb: th,
          v: t,
          wts,
          mo: () => ({ tongue: flickD, mouthOpen: drop, surprised: scl(drop, 0.4) }),
        });
      }
      tube(buf, atlas, rect, rings, nu, [true, false]);
    },
    paint(canvas, atlas) {
      paintRect(canvas, atlas, rect, (u, v, out) => {
        // the groove down the middle of its top
        const g = sstep(0.05, 0, Math.abs(u - 0.25)) * sstep(0.95, 0.6, v) * 0.6;
        write(out, lerp3(COL.tongue, COL.tongueGroove, g), 0);
      });
    },
  };
}

/**
 * The mouth's inside: a disc collapsed behind the grin at rest; each key opens it into a wide oval
 * laid on the paper (lib/parts mouthInside, with a glowing inside and an emissive paint).
 */
function mouthPart(face) {
  let rect = -1;
  // key -> [dy below the line, half width, half height, top flattening, offset]
  const shapes = {
    mouthOpen: [-0.055, 0.25, 0.1, 0.35, 0.01],
    surprised: [-0.05, 0.15, 0.085, 0.8, 0.01],
    tongue: [-0.03, 0.17, 0.05, 0.4, 0.01],
    happy: [-0.012, 0.25, 0.022, 0.2, 0.01],
  };
  const rings = 4;
  const segs = 22;
  return {
    reserve(atlas) {
      rect = atlas.addRect(0.14, 0.14);
    },
    build(buf, atlas, wts) {
      const J = face(0, MY);
      const shapeAt = ([dy, ax, ay, flat, off]) => (rho, a) => {
        const s = Math.sin(a);
        const x = ax * rho * Math.cos(a);
        const pt = face(x, grinY(x) + dy * rho ** 0.5 + ay * rho * s * (s > 0 ? flat : 1));
        return add(pt.p, scl(pt.n, off));
      };
      const rest = (rho, a) => add(J.p, add(scl(fdir(Math.cos(a), 0, 0), 0.004 * rho), scl(J.n, -0.012)));
      const targets = Object.entries(shapes).map(([k, s]) => [k, shapeAt(s)]);
      const base = buf.count;
      for (let ri = 0; ri <= rings; ri++)
        for (let s = 0; s < (ri === 0 ? 1 : segs); s++) {
          const rho = ri / rings;
          const a = (s / segs) * Math.PI * 2;
          const p0 = rest(rho, a);
          const mo = Object.fromEntries(targets.map(([k, t]) => [k, sub(t(rho, a), p0)]));
          buf.addVertex(p0, J.n, atlas.rectUV(rect, 0.5 + 0.5 * rho * Math.cos(a), 0.5 + 0.5 * rho * Math.sin(a)), wts, mo);
        }
      const ring = (ri, s) => (ri === 0 ? base : base + 1 + (ri - 1) * segs + (s % segs));
      for (let ri = 0; ri < rings; ri++)
        for (let s = 0; s < segs; s++) {
          if (ri === 0) buf.idx.push(ring(0, 0), ring(1, s), ring(1, s + 1));
          else buf.idx.push(ring(ri, s), ring(ri + 1, s), ring(ri + 1, s + 1), ring(ri, s), ring(ri + 1, s + 1), ring(ri, s + 1));
        }
    },
    paint(canvas, atlas, glow) {
      // the light inside: bright in the middle, a dark red lip round the edge
      const rim = (u, v) => sstep(0.5, 0.95, Math.hypot(u - 0.5, v - 0.5) * 2);
      paintRect(canvas, atlas, rect, (u, v, out) => write(out, lerp3(COL.mouth, COL.lip, rim(u, v)), 0));
      paintRect(glow, atlas, rect, (u, v, out) => write(out, scl(lerp3(GLOW, COL.mouthDeep, 0.6 * rim(u, v)), 0.85 * (1 - rim(u, v))), 1));
    },
  };
}

// ---------------------------------------------------------------------------- the painting

/**
 * The shell's look at model point p: { c (sRGB), a (tint mask), g (emissive sRGB) }: warm grey
 * paper (tinted) glowing between the ribs, the bamboo ribs, dark lacquer cap and base, the grin.
 */
function makeShade(shape) {
  const eye = shape.eyes[0];
  const parts = {};
  return (p, n, ao) => {
    const [x, y, z] = p;
    const [qx, qy, qz] = wf(x, y, z);
    shape.parts(x, y, z, parts);
    const lacquer = sstep(0.006, -0.004, Math.min(parts.cap, parts.base) - parts.paper);
    // paper: fine fibres and blotches, lighter (lit through) between the ribs
    const ribD = Math.min(...RIBS.map((r) => Math.abs(qy - r)));
    const fib = vnoise(x * 120, y * 40, z * 120);
    let g = 0.84 + 0.05 * (fbm(x * 5 + 1, y * 5, z * 5) - 0.5) + 0.03 * (fib - 0.5);
    g *= 1 - 0.1 * sstep(0.03, 0.005, ribD);
    g *= 1 - 0.06 * sstep(-0.5, -0.9, n[1]); // underside a touch darker
    let c = [g, g * 0.985, g * 0.96];
    let a = 1;
    let glow = scl(GLOW, 0.2 * sstep(0.004, 0.035, ribD) * (1 - lacquer));
    // the bamboo ribs: a thin painted band in each valley
    const rib = sstep(0.0085, 0.0045, ribD) * (1 - lacquer);
    if (rib > 0) {
      c = lerp3(c, lerp3(COL.bamboo, srgb(160, 116, 70), 0.4 * vnoise(x * 60, y * 60, z * 60)), rib);
      a = 1 - rib;
    }
    // the grin: a dark lip line along the rib with a glowing core, on the front
    if (qz > 0 && Math.abs(qx) < GRIN_W + 0.03) {
      const d = Math.abs(qy - grinY(qx));
      const end = sstep(GRIN_W + 0.02, GRIN_W - 0.02, Math.abs(qx));
      const line = sstep(0.028, 0.02, d) * end;
      if (line > 0) {
        const core = sstep(0.012, 0.005, d) * end;
        c = lerp3(c, lerp3(COL.lip, COL.mouth, core), line);
        a = Math.min(a, 1 - line);
        glow = lerp3(glow, scl(GLOW, core * 0.9), line);
      }
    }
    // the socket wall: a darker crease round the eye
    const ke = sstep(EYE_R * R_SOCK + 0.006, EYE_R * R_SOCK - 0.002, len(sub(p, eye.E)));
    if (ke > 0) c = scl(c, 1 - 0.25 * ke);
    if (lacquer > 0) {
      // lacquer: dark, a soft sheen on top
      const sheen = sstep(0.4, 0.95, n[1]) * 0.5 + 0.3 * sstep(0.85, 1, fbm(x * 9, y * 9, z * 9));
      const lc = lerp3(COL.lacquer, COL.lacquerHi, sheen * 0.6);
      c = lerp3(c, lc, lacquer);
      a = a * (1 - lacquer);
      glow = scl(glow, 1 - lacquer);
    }
    return { c: scl(c, ao), a, g: glow };
  };
}

// ------------------------------------------------------------------------------- the build

/**
 * @param {{texture?: number, triangles?: number, grid?: number}} [o] texture size, target triangles
 *   for the fused shell, surface-nets grid spacing (design units)
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 6200, grid = 0.012 } = {}) {
  const shape = makeShape();
  shape0 = shape;
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  const shell = buildShell(f, {
    lo: [-0.8, -0.04, -0.8],
    hi: [0.8, 1.45, 0.8],
    grid,
    triangles,
    importance: (p) => {
      const [qx, qy, qz] = wf(...p);
      const e = len(sub(p, eyeL.E));
      if (e < EYE_R * 1.6) return 2.5; // round the eye
      if (qz > 0.2 && Math.abs(qx) < GRIN_W + 0.1 && Math.abs(qy - MY) < 0.1) return 2; // the grin
      if (Math.abs(qy) > H2 - 0.03) return 1.6; // the cap and base edges
      return 1;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor, { min: 0.8 });

  // the face parts
  const face = surfaceAt(f, LANTERN);
  const headOnly = [[BI.head, 1]];
  // the lids twice round the one eye (see the header): the R set a hair inside the L set
  const lidsL = eyelids([eyeL], { rUp: 1.175, rLo: 1.15 });
  const lidsR = eyelids([eyeR], { rUp: 1.16, rLo: 1.135 });
  const mouth = mouthPart(face);
  const parts = [lidsL, lidsR, mouth, tonguePart(face, f), handlePart(), tasselPart()];

  // UVs
  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  for (const part of parts) part.reserve(atlas);
  atlas.layout();

  // the Body: the shell wholly on head (a lantern is stiff paper)
  const body = new MeshBuffer(ALL_KEYS);
  const shellTris = appendShell(body, shell, atlas, (i, p) => ({ weights: headOnly, keys: faceKeysOf(f, p, shell.nor[i], eyeL) }));
  const shellCount = body.count;
  for (const part of parts) part.build(body, atlas, headOnly);

  // the textures: base colour (+ tint mask) and the glow, painted from the same shading
  const canvas = createCanvas(N);
  const glowCanvas = createCanvas(N);
  const shade = makeShade(shape);
  const src = { pos: (i) => body.P(i), nor: (i) => shell.nor[body.src[i]], ao: (i) => ao[body.src[i]] };
  paintShell(
    canvas,
    body,
    shellTris,
    (p, n, a, out) => {
      const s = shade(p, n, a);
      write(out, s.c, s.a);
    },
    src,
  );
  paintShell(glowCanvas, body, shellTris, (p, n, a, out) => write(out, shade(p, n, a).g, 1), src);
  for (const part of parts) part.paint(canvas, atlas, glowCanvas);
  dilate(canvas, 6);
  dilate(glowCanvas, 6);
  for (let i = 3; i < glowCanvas.data.length; i += 4) glowCanvas.data[i] = 255;

  // the one eyeball, on eye_L: a warm amber iris
  const eyes = eyeballs([eyeL], {
    bones: { L: BI.eye_L, R: BI.eye_R },
    irisColor: (t, lit) => [clamp(mix(0.98, 0.78, t) + 0.05 * lit, 0, 1), clamp(mix(0.62, 0.36, t) + 0.06 * lit, 0, 1), mix(0.14, 0.08, t)],
    rimColor: srgb(70, 36, 18),
  });
  const bones = BONES.map(([n, parent, p]) => [n, parent, p ?? { eye_L: eyeL.E, eye_R: eyeR.E }[n]]);
  const scene = assemble({ name: 'lantern', bones, body, eyes, map: toTexture(canvas, 'lantern_basecolor'), fit: fitScale(body, shellCount), roughness: 0.78, eyeRoughness: 0.15 });
  // the glow from inside: the emissive map
  const m = scene.getObjectByName('Body').material;
  m.emissiveMap = toTexture(glowCanvas, 'lantern_emissive');
  m.emissive.setRGB(1, 1, 1);
  m.emissiveIntensity = 1;
  return scene;
}

export const buildLantern = build;

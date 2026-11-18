import {
  ALL_KEYS,
  DEG,
  MeshBuffer,
  add,
  appendShell,
  assemble,
  band,
  boneIndex,
  buildShell,
  carveSockets,
  clamp,
  createAtlas,
  createCanvas,
  cross,
  dilate,
  dot,
  ellipsoid,
  eyeballs,
  eyelids,
  fbm,
  fieldAO,
  fitScale,
  hash,
  len,
  lerp3,
  mix,
  mouthInside,
  norm,
  paintRect,
  paintShell,
  placeEyes,
  project,
  roundCone,
  scl,
  smax,
  smin,
  soft,
  srgb,
  sstep,
  sub,
  surfaceAt,
  tiltFrame,
  toTexture,
  vnoise,
  weights,
  write,
} from './lib/index.js';

/**
 * Dicer's owl pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a plump round owlet, one fused egg of a body and head, a pale heart-shaped facial
 * disc with a raised ruff framing two huge round amber eyes, a small hooked beak, two feathered ear
 * tufts, folded wings snug against its sides (each its own shell, so it can spread), little taloned
 * feet and a short tail fan. Grey plumage (tinted by Dicer) with scalloped chest feathers, white
 * speckles and barred primaries; cream disc, amber beak and talons. Natural colour: brown #8a5a2b.
 *
 * One `Body` mesh: the fused shell, the two wing shells, eyelids and the beak's inside; `Eyes` the
 * eyeballs. Bones: root, body, head, eye_L/R, ear_L/R (the tufts), wing_L/R, arm_L/R (children of
 * the wings at the shoulder: "raise an arm" swings the wing forward, a wing-swat), tail_1.
 * Shape keys: the spec's ten (no tongue).
 */

// ------------------------------------------------------------------------------- the design

const HEAD = tiltFrame([0, 1.0, 0.07], 0.7); // the face tilted up toward the top-down camera
const { fw, fdir, wf } = HEAD;
const HC = HEAD.center;

const EYE_R = 0.165;
const EYE_X = 0.212;
const EYE_Y = 0.035;
const R_SOCK = 1.13;
const NECK_Y = 0.72; // the head/body blend plane (design units)
const SHOULDER = [0.58, 0.68, -0.03]; // the left wing's hinge (mirrored for the right)
const TAIL0 = [0, 0.25, -0.38];
const TAIL_DIR = norm([0, -0.42, -1]);
const KEYS = ALL_KEYS.filter((k) => k !== 'tongue');

const COL = {
  cream: srgb(246, 236, 216),
  creamDark: srgb(222, 204, 176),
  ring: srgb(196, 160, 118),
  lid: srgb(214, 186, 150),
  beak: srgb(236, 168, 62),
  beakDark: srgb(176, 108, 36),
  toe: srgb(232, 172, 78),
  claw: srgb(64, 50, 46),
  ink: srgb(52, 40, 36),
};

/** A tapered 2D capsule from (ax, ay) radius r1 to (bx, by) radius r2 (approximate distance). */
function cone2(x, y, ax, ay, bx, by, r1, r2) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(x - ax - dx * t, y - ay - dy * t) - mix(r1, r2, t);
}

/** The facial disc's outline in face-local (x, y): a heart, two round lobes round the eyes, a point at the chin. */
function heart2D(x, y) {
  const lob = Math.min(Math.hypot(x - EYE_X, y - EYE_Y), Math.hypot(x + EYE_X, y - EYE_Y)) - 0.265;
  return smin(lob, cone2(x, y, 0, -0.04, 0, -0.33, 0.21, 0.03), 0.08);
}

/** A feathered ear tuft: three flattened round cones fanning from one base, a jagged tip. */
function makeTuft(side) {
  const B = add(HC, [0.27 * side, 0.27, -0.07]);
  const Tp = add(HC, [0.4 * side, 0.55, -0.16]);
  const ax = norm(sub(Tp, B));
  let fn = norm([0.25 * side, 0.3, 1]);
  fn = norm(sub(fn, scl(ax, dot(fn, ax))));
  const sd = cross(ax, fn);
  const L = len(sub(Tp, B));
  const F = 0.42; // front-to-back flattening
  const feathers = [
    roundCone([0, 0, 0], [0, L, 0], 0.095, 0.014),
    roundCone([0.02 * side, 0, 0], [0.075 * side, L * 0.8, 0], 0.07, 0.012),
    roundCone([-0.02 * side, 0, 0], [-0.05 * side, L * 0.72, 0], 0.07, 0.012),
  ];
  const local = (x, y, z) => {
    const p = [x - B[0], y - B[1], z - B[2]];
    return [dot(p, sd), dot(p, ax), dot(p, fn)];
  };
  return {
    B,
    ax,
    L,
    local,
    d(x, y, z) {
      const [s, t, w] = local(x, y, z);
      const ww = w / F;
      return Math.min(feathers[0](s, t, ww), smin(feathers[1](s, t, ww), feathers[2](s, t, ww), 0.01)) * F;
    },
  };
}

/** The folded wing's outline in side view (z, y): a leaf of coverts, four primaries fanning to feathered tips. */
const W_S = [-0.02, 0.77];
const W_M = [-0.15, 0.42];
const W_TIPS = [
  [-0.29, 0.13],
  [-0.35, 0.17],
  [-0.395, 0.235],
  [-0.41, 0.31],
];
const W_FROM = [
  [-0.1, 0.4],
  [-0.14, 0.44],
  [-0.18, 0.48],
  [-0.21, 0.52],
];
function wingOutline(z, y) {
  const leaf = cone2(z, y, W_S[0], W_S[1], W_M[0], W_M[1], 0.1, 0.15);
  let pr = Infinity;
  for (let i = 0; i < W_TIPS.length; i++) pr = Math.min(pr, cone2(z, y, W_FROM[i][0], W_FROM[i][1], W_TIPS[i][0], W_TIPS[i][1], 0.075, 0.024));
  return smin(leaf, pr, 0.04);
}
/** Which primary (0..3) a side-view point is nearest, its distance and its arc parameter 0..1. */
function primaryAt(z, y) {
  let best = Infinity;
  let bi = 0;
  let bt = 0;
  for (let i = 0; i < W_TIPS.length; i++) {
    const [ax, ay] = W_FROM[i];
    const [bx, by] = W_TIPS[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = clamp(((z - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    const d = cone2(z, y, ax, ay, bx, by, 0.075, 0.024);
    if (d < best) {
      best = d;
      bi = i;
      bt = t;
    }
  }
  return { i: bi, d: best, t: bt };
}

function makeShape() {
  const skull = ellipsoid([0, 0, -0.04], [0.565, 0.43, 0.45]);
  const torso = ellipsoid([0, 0.47, -0.03], [0.64, 0.5, 0.54]);
  const belly = ellipsoid([0, 0.42, 0.09], [0.52, 0.39, 0.43]);
  const tuftL = makeTuft(1);
  const tuftR = makeTuft(-1);
  // toes: three forward per foot, each with a little claw curling down
  const toes = [];
  const claws = [];
  for (const s of [1, -1])
    for (const a of [-0.45, 0, 0.45]) {
      const P = [s * 0.18, 0.04, 0.28];
      const aa = a + s * 0.12;
      const D = norm([Math.sin(aa), -0.05, Math.cos(aa)]);
      const T = add(P, scl(D, a === 0 ? 0.13 : 0.11));
      toes.push(roundCone(P, T, 0.04, 0.022));
      claws.push(roundCone(T, add(add(T, scl(D, 0.035)), [0, -0.024, 0]), 0.018, 0.006));
    }
  // the tail fan: a flattened round cone widening toward its tip
  let tfn = [0, 1, 0];
  tfn = norm(sub(tfn, scl(TAIL_DIR, dot(tfn, TAIL_DIR))));
  const tsd = cross(TAIL_DIR, tfn);
  const fan = roundCone([0, 0, 0], [0, 0.2, 0], 0.07, 0.125);
  const tailLocal = (x, y, z) => {
    const p = [x - TAIL0[0], y - TAIL0[1], z - TAIL0[2]];
    return [dot(p, tsd), dot(p, TAIL_DIR), dot(p, tfn)];
  };

  /** The head (in face-local q) before the beak: the skull, its face flattened, the dished disc and its ruff. */
  const headQ = (qx, qy, qz) => {
    let h = skull(qx, qy, qz);
    h = smax(h, qz - 0.33, 0.14);
    const ht = heart2D(qx, qy);
    const front = sstep(0.04, 0.2, qz);
    h += 0.024 * sstep(0.01, -0.06, ht) * front; // the disc is a shallow dish
    h -= 0.022 * Math.exp(-((ht / 0.03) ** 2)) * front; // with a raised ruff round its rim
    return h;
  };
  // the beak sits on the disc's surface between the eyes
  let zs = 0.6;
  for (let i = 0; i < 200 && headQ(0, -0.06, zs) > 0; i++) zs -= 0.004;
  const flat = 0.7; // beak flattened side to side
  const beakA = roundCone([0, -0.012, zs - 0.035], [0, -0.095, zs + 0.05], 0.044, 0.026);
  const beakB = roundCone([0, -0.095, zs + 0.05], [0, -0.155, zs + 0.03], 0.026, 0.007);
  const jawC = roundCone([0, -0.075, zs - 0.03], [0, -0.13, zs + 0.012], 0.026, 0.011);
  const BEAK = {
    hingeUp: [0, -0.02, zs - 0.02],
    hingeLo: [0, -0.075, zs - 0.03],
    mouthY: -0.1,
    zs,
  };

  const shape = { tuftL, tuftR, eyes: [], tailLocal, BEAK, headQ };
  /** Distances to the parts at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    o.head = headQ(qx, qy, qz);
    const bx = qx / flat;
    o.beak = Math.min(beakA(bx, qy, qz), beakB(bx, qy, qz)) * flat;
    o.jaw = jawC(bx, qy, qz) * flat;
    o.tuftL = tuftL.d(x, y, z);
    o.tuftR = tuftR.d(x, y, z);
    o.torso = smin(torso(x, y, z), belly(x, y, z), 0.1);
    let t = Infinity;
    for (const f of toes) t = Math.min(t, f(x, y, z));
    o.toes = t;
    let c = Infinity;
    for (const f of claws) c = Math.min(c, f(x, y, z));
    o.claws = c;
    const [ts, tt, tw] = tailLocal(x, y, z);
    o.tail = fan(ts, tt, tw / 0.24) * 0.24;
    return o;
  };
  const P = {};
  const union = (x, y, z) => {
    shape.parts(x, y, z, P);
    let hd = smin(P.head, P.beak, 0.025);
    hd = smin(hd, P.jaw, 0.015);
    hd = smin(hd, P.tuftL, 0.05);
    hd = smin(hd, P.tuftR, 0.05);
    let d = smin(hd, P.torso, 0.24);
    d = smin(d, smin(P.toes, P.claws, 0.012), 0.035);
    return smin(d, P.tail, 0.06);
  };
  /** The owl without eye sockets (for placing the eyes, the wings, and occlusion). */
  shape.solid = (x, y, z) => smax(union(x, y, z), -y, 0.02);
  shape.eyes = placeEyes(shape.solid, HEAD, { r: EYE_R, x: EYE_X, y: EYE_Y, yaw: 0.2, open: 50 * DEG });
  shape.sdf = (x, y, z) => smax(carveSockets(union(x, y, z), x, y, z, shape.eyes, EYE_R * R_SOCK), -y, 0.02);
  /** The face without the beak (the beak's inside is laid on it). */
  shape.noBeak = (x, y, z) => {
    const [qx, qy, qz] = wf(x, y, z);
    return carveSockets(headQ(qx, qy, qz), x, y, z, shape.eyes, EYE_R * R_SOCK);
  };
  /** The left wing: a curved slab hugging the body's side, cut to the wing's outline. */
  shape.wing = (x, y, z) => {
    const o = wingOutline(z, y);
    if (o > 0.08 || x < 0.15) return Math.max(o, 0.2 - x, 0.02);
    const b = shape.solid(x, y, z);
    const s = clamp((W_S[1] - y) / (W_S[1] - 0.15), 0, 1);
    const th = (mix(0.018, 0.055, sstep(0.0, 0.4, s)) - 0.018 * sstep(0.5, 1, s)) * mix(0.45, 1, sstep(0.0, -0.07, o));
    const slab = Math.max(b - th, -(b + 0.025));
    return smax(smax(o, slab, 0.018), 0.2 - x, 0.01);
  };
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.42, 0]],
  ['head', 'body', [0, NECK_Y, 0.04]],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['ear_L', 'head', null], // from the tufts
  ['ear_R', 'head', null],
  ['wing_L', 'body', SHOULDER],
  ['wing_R', 'body', [-SHOULDER[0], SHOULDER[1], SHOULDER[2]]],
  ['arm_L', 'wing_L', SHOULDER],
  ['arm_R', 'wing_R', [-SHOULDER[0], SHOULDER[1], SHOULDER[2]]],
  ['tail_1', 'body', TAIL0],
];
const BI = boneIndex(BONES);

/** Skin weights of a body-shell point: head vs body by the neck plane, the tufts, the tail; the seat and feet on root. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  const core = Math.min(d.head, d.beak, d.jaw, d.torso, d.toes, d.claws);
  for (const [name, v] of soft([
    ['core', core, 0.03],
    ['tuftL', d.tuftL, 0.03],
    ['tuftR', d.tuftR, 0.03],
    ['tail', d.tail, 0.03],
  ])) {
    if (name === 'core') {
      const hv = sstep(-0.07, 0.07, y - NECK_Y + 0.15 * (z - 0.05));
      w.put('head', v * hv);
      const body = v * (1 - hv);
      const rootK = sstep(0.2, 0.05, y); // the seat and feet stay planted when the body leans
      w.put('root', body * rootK);
      w.put('body', body * (1 - rootK));
    } else if (name === 'tail') {
      const k = sstep(0.02, 0.1, shape.tailLocal(x, y, z)[1]);
      w.put('tail_1', v * k);
      w.put('body', v * (1 - k));
    } else {
      const tuft = name === 'tuftL' ? shape.tuftL : shape.tuftR;
      const k = sstep(0.0, 0.09, tuft.local(x, y, z)[1]);
      w.put(name === 'tuftL' ? 'ear_L' : 'ear_R', v * k);
      w.put('head', v * (1 - k));
    }
  }
  return w.done(BI);
}

/** A face-local rotation about the x axis through h, as a model-space delta of p. */
function beakTurn(p, h, a) {
  const q = wf(...p);
  const r = sub(q, h);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const q2 = [q[0], h[1] + r[1] * c - r[2] * s, h[2] + r[1] * s + r[2] * c];
  return sub(fw(...q2), p);
}

/** Face shape keys on the shell: displacement fields in face-local space. */
function faceKeysOf(shape, f, p, n, headW) {
  const gauss = (q, c, s) => Math.exp(-((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - (c[2] ?? q[2])) ** 2) / (2 * s * s));
  const mirror = (q, c, s) => gauss(q, c, s) + gauss(q, [-c[0], c[1], c[2]], s);
  const q = wf(...p);
  const out = {};
  const d = shape.parts(...p);
  const inDisc = sstep(0.02, -0.04, heart2D(q[0], q[1])) * sstep(0.05, 0.2, q[2]) * headW;
  // puff: the plumage fluffs out (the disc stays, so the eyes don't sink)
  out.puff = scl(n, 0.042 * (1 - inDisc) * sstep(0.02, 0.12, p[1]));
  if (headW < 0.01) return out;
  // the beak: upper tips up, the lower mandible drops
  const [, wBeak, wJaw] = softShares([Math.min(d.head, d.torso), d.beak, d.jaw], 0.012);
  if (wBeak + wJaw > 0.01) {
    const B = shape.BEAK;
    const open = add(scl(beakTurn(p, B.hingeUp, -12 * DEG), wBeak), scl(beakTurn(p, B.hingeLo, 42 * DEG), wJaw));
    out.mouthOpen = scl(open, headW);
    out.surprised = scl(add(scl(beakTurn(p, B.hingeUp, -4 * DEG), wBeak), scl(beakTurn(p, B.hingeLo, 12 * DEG), wJaw)), headW);
    out.happy = scl(beakTurn(p, B.hingeLo, 6 * DEG), wJaw * headW);
    return out;
  }
  const fr = sstep(0.05, 0.2, q[2]) * headW;
  const browIn = mirror(q, [0.085, 0.2], 0.06) * fr;
  const browOut = mirror(q, [0.3, 0.17], 0.065) * fr;
  const brow = mirror(q, [EYE_X, 0.22], 0.09) * fr;
  const cheek = mirror(q, [0.2, -0.16], 0.075) * fr;
  const notch = gauss(q, [0, 0.21], 0.07) * fr;
  const slide = (dd) => (len(dd) < 1e-6 ? dd : sub(project(f, add(p, dd)), p));
  out.happy = add(slide(fdir(0, 0.03 * cheek, 0)), scl(n, 0.008 * cheek));
  out.sad = slide(fdir(0, 0.03 * browIn - 0.018 * browOut - 0.01 * cheek, 0));
  out.surprised = slide(fdir(0, 0.026 * brow - 0.012 * cheek, 0));
  out.angry = add(fdir(0, -0.04 * browIn - 0.03 * notch + 0.012 * browOut, 0), scl(n, 0.018 * browIn + 0.012 * notch));
  return out;
}

/** Soft-min shares of distances (tau): exp(-(d - dmin) / tau), normalised. */
function softShares(ds, tau) {
  const m = Math.min(...ds);
  const e = ds.map((d) => Math.exp(-(d - m) / tau));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

// ---------------------------------------------------------------------------- the painting

/** Rows of scalloped feather tips on a 2D sheet (u across, v up): 0..1 the dark tip edges, and a soft shade. */
function scallops(u, v, size, seed) {
  const h = size * 0.8;
  const row = Math.floor(v / h);
  const off = (row & 1) * 0.5;
  const col = Math.floor(u / size + off);
  const j = hash(col, row, seed);
  const cu = (col + 0.5 - off) * size + (j - 0.5) * size * 0.15;
  const cv = (row + 0.6) * h;
  const du = u - cu;
  const dv = v - cv;
  const r = size * 0.5;
  const dd = Math.hypot(du, dv * 1.1);
  const edge = sstep(size * 0.11, size * 0.04, Math.abs(dd - r)) * sstep(size * 0.15, -size * 0.1, dv);
  const shade = sstep(-r, r, dv); // lighter toward the top of each feather
  return { edge, shade, shaft: sstep(size * 0.05, size * 0.015, Math.abs(du)) * sstep(r, -r, dv) * sstep(-r, 0, dv) };
}

/** White speckles: a dot in some cells of a 3D grid of `cell`. */
function speckles(x, y, z, cell, r, seed, density = 0.55) {
  const i = Math.floor(x / cell);
  const j = Math.floor(y / cell);
  const k = Math.floor(z / cell);
  const h = hash(i + seed, j, k);
  if (h > density) return 0;
  const c = [(i + 0.25 + 0.5 * hash(i, j + 7, k)) * cell, (j + 0.25 + 0.5 * hash(i, j, k + 9)) * cell, (k + 0.25 + 0.5 * hash(i + 3, j, k)) * cell];
  const rr = r * (0.7 + 0.6 * hash(j, k, i));
  return sstep(rr, rr * 0.55, Math.hypot(x - c[0], y - c[1], z - c[2]));
}

/** White spots on a 2D sheet: a dot in some cells of a grid of `cell`. */
function spots2(u, v, cell, r, seed, density) {
  const i = Math.floor(u / cell);
  const j = Math.floor(v / cell);
  if (hash(i, j, seed) > density) return 0;
  const cu = (i + 0.3 + 0.4 * hash(i, j, seed + 1)) * cell;
  const cv = (j + 0.3 + 0.4 * hash(i, j, seed + 2)) * cell;
  const rr = r * (0.75 + 0.5 * hash(j, i, seed));
  return sstep(rr, rr * 0.55, Math.hypot(u - cu, (v - cv) * 1.2));
}

/** The body shell's paint: grey plumage (tinted) and the painted face, beak and talons. */
function makeSkinPainter(shape) {
  const P = {};
  const [eyeL, eyeR] = shape.eyes;
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const [qx, qy, qz] = wf(x, y, z);
    shape.parts(x, y, z, P);
    const dm = Math.min(P.head, P.beak, P.jaw, P.tuftL, P.tuftR, P.torso, P.toes, P.claws, P.tail);
    const near = (dd) => dd - dm < 0.012;
    const grain = vnoise(x * 120, y * 120, z * 120);
    const wob = fbm(x * 6 + 2, y * 6, z * 6) - 0.5;
    let g = 0.8 + 0.07 * wob + 0.05 * (grain - 0.5);
    let c;
    let paint = 0;
    const headish = near(P.head) || (P.head < P.torso && y > NECK_Y);

    if (near(P.beak) || near(P.jaw)) {
      // the beak: amber, darker toward the hooked tip and on the lower mandible
      const tip = sstep(-0.06, -0.15, qy);
      c = lerp3(COL.beak, COL.beakDark, 0.7 * tip + (near(P.jaw) && !near(P.beak) ? 0.25 : 0));
      c = scl(c, 0.95 + 0.1 * grain);
      write(o, scl(c, ao), 0);
      return;
    }
    if (near(P.toes) || near(P.claws)) {
      const k = near(P.claws) && P.claws < P.toes ? 1 : 0;
      c = lerp3(COL.toe, COL.claw, k);
      // scaly rings on the toes
      if (!k) c = scl(c, 0.9 + 0.1 * band((x + z) * 60, 0.5));
      write(o, scl(c, ao), 0);
      return;
    }

    // plumage (tinted)
    let mark = 0; // darker marks
    let light = 0; // lighter flecks
    const plumage = () => {
      const pc = [g, g, g];
      return lerp3(lerp3(pc, scl(pc, 0.62), clamp(mark, 0, 1)), [0.97, 0.97, 0.97], clamp(light, 0, 1));
    };
    if (near(P.tuftL) || near(P.tuftR)) {
      const tf = near(P.tuftL) ? shape.tuftL : shape.tuftR;
      const [s, t] = tf.local(x, y, z);
      const u = t / tf.L;
      mark = 0.75 * sstep(0.03, 0.008, Math.abs(s + 0.01 * Math.sin(t * 40))) * sstep(0.1, 0.3, u) + 0.4 * sstep(0.55, 0.95, u);
      g *= 0.95;
    } else if (near(P.tail)) {
      const [, tt] = shape.tailLocal(x, y, z);
      mark = band(tt * 16 + wob * 0.5, 0.36) * sstep(0.04, 0.09, tt);
      light = sstep(0.27, 0.31, tt) * 0.6;
    } else {
      // the plumage: a pale chest of scalloped feathers, a back of fainter scallops and white
      // speckles, streaks on the forehead
      const front = sstep(-0.12, 0.12, z + 0.25 * Math.abs(x) - 0.12) * sstep(0.98, 0.78, y);
      const a = Math.atan2(x, z + 0.1);
      const u = a * 0.42;
      const size = mix(0.06, 0.085, sstep(0.75, 0.2, y));
      const sc = scallops(u + 0.02 * wob, y + 0.01 * wob, size, 3);
      const sb = scallops(u * 1.2 + 0.02 * wob, y + 0.01 * wob, 0.1, 8);
      g = mix(0.78 + 0.03 * sb.shade, 0.9 + 0.05 * sc.shade, front) + 0.06 * wob + 0.04 * (grain - 0.5);
      mark = front * (0.85 * sc.edge + 0.25 * sc.shaft) + (1 - front) * 0.3 * sb.edge * sstep(1.0, 0.85, y);
      light = (1 - front) * speckles(x, y, z, 0.055, 0.012, 5, 0.5);
      if (headish && qz > -0.1) mark = Math.max(mark, 0.45 * band(qx * 14 + wob, 0.25) * sstep(0.22, 0.32, qy) * (1 - light));
      if (y < 0.25 && front > 0) g = mix(g, 0.94, 0.5 * sstep(0.25, 0.08, y) * front);
    }
    if (headish && !near(P.tuftL) && !near(P.tuftR)) {
      const ht = heart2D(qx, qy);
      if (qz > 0.04 && ht < 0.035) {
        // the facial disc: cream (painted), a ruff of darker plumage round its rim
        const rim = sstep(0.035, 0.012, ht) * sstep(-0.035, -0.012, ht);
        const inside = sstep(-0.006, -0.02, ht) * sstep(0.04, 0.12, qz);
        // fine radial feathers from each eye
        const e = qx > 0 ? [EYE_X, EYE_Y] : [-EYE_X, EYE_Y];
        const ang = Math.atan2(qy - e[1], qx - e[0]);
        const rad = Math.hypot(qx - e[0], qy - e[1]);
        const streak = band(ang * 7 + 0.3 * wob, 0.3, 0.2) * sstep(EYE_R * 1.3, 0.24, rad) * 0.55;
        let cr = lerp3(COL.cream, COL.creamDark, streak + 0.3 * (grain - 0.5));
        // a warm ring round each eye
        const ring = sstep(EYE_R * 1.13 + 0.05, EYE_R * 1.13 + 0.012, rad);
        cr = lerp3(cr, COL.ring, 0.65 * ring);
        // white brows over the eyes, meeting in a V above the beak
        const brow = sstep(0.02, 0.006, Math.abs(rad - EYE_R * 1.13 - 0.03)) * sstep(0.0, 0.07, qy - e[1]) * sstep(0.3, 0.06, Math.abs(qx));
        cr = lerp3(cr, [0.99, 0.98, 0.95], 0.8 * brow);
        const ruffTick = band(Math.atan2(qy + 0.05, qx) * 18 + wob, 0.45, 0.2);
        const rimCol = [0.48 + 0.1 * ruffTick, 0.48 + 0.1 * ruffTick, 0.48 + 0.1 * ruffTick];
        paint = inside;
        c = lerp3(lerp3(plumage(), rimCol, rim), cr, inside);
      }
    }
    if (!c) c = plumage();
    for (const e of [eyeL, eyeR]) {
      // the socket wall: a soft crease
      const k = sstep(EYE_R * R_SOCK + 0.004, EYE_R * R_SOCK - 0.003, len(sub(p, e.E)));
      if (k > 0) c = scl(c, 1 - 0.18 * k);
    }
    if (n[1] < -0.3) c = lerp3(c, scl(c, 1.08), sstep(-0.3, -0.8, n[1]));
    write(o, scl(c, ao), 1 - paint);
  };
}

/** The wings' paint (both, in the left wing's side-view coordinates): coverts with spots, barred primaries. */
function makeWingPainter() {
  return (p, n, ao, o) => {
    const [x0, y, z] = p;
    const side = x0 >= 0 ? 1 : -1;
    const nx = n[0] * side; // > 0 the outer face
    const grain = vnoise(x0 * 120, y * 120, z * 120);
    const wob = fbm(x0 * 6, y * 6 + 4, z * 6) - 0.5;
    let g = 0.7 + 0.06 * wob + 0.05 * (grain - 0.5);
    let mark = 0;
    let light = 0;
    const leaf = cone2(z, y, W_S[0], W_S[1], W_M[0], W_M[1], 0.1, 0.15);
    const pr = primaryAt(z, y);
    if (pr.d < leaf - 0.01 || y < 0.3) {
      // primaries: dark bars across each feather, a dark edge between feathers, lighter tips
      const [ax, ay] = W_FROM[pr.i];
      const [bx, by] = W_TIPS[pr.i];
      const L = Math.hypot(bx - ax, by - ay);
      mark = 0.9 * band(pr.t * L * 15 + 0.2 * wob, 0.34) + 0.8 * sstep(-0.012, -0.002, pr.d);
      light = 0.5 * sstep(0.85, 0.97, pr.t);
      g *= 0.96;
    } else {
      // coverts: scalloped rows with a white spot on each feather (an owlet's wing)
      const u = -z * 0.9 + y * 0.25;
      const sc = scallops(u, y, 0.07, 11);
      mark = 0.75 * sc.edge;
      light = spots2(z, y, 0.065, 0.015, 2, 0.75) * sstep(0.0, -0.03, leaf);
      g = mix(g, g * 1.06, sc.shade);
      // the leading edge a shade lighter
      g = mix(g, 0.88, 0.5 * sstep(-0.03, 0.0, leaf + 0.04 - Math.max(0, z - W_M[0]) * 0.0) * sstep(0.0, 0.1, z));
    }
    // a dark edge round the folded wing, so it reads against the body
    mark = Math.max(mark, 0.7 * sstep(-0.03, -0.006, wingOutline(z, y)));
    if (nx < 0) {
      // the underside, seen when spread: pale with faint bars
      g = 0.9 + 0.04 * wob;
      mark = 0.35 * band(y * 18, 0.3);
      light = 0;
    }
    let c = [g, g, g];
    c = lerp3(c, scl(c, 0.6), clamp(mark, 0, 1));
    c = lerp3(c, [0.97, 0.97, 0.97], clamp(light, 0, 1));
    write(o, scl(c, ao), 1);
  };
}

// ------------------------------------------------------------------------------- the build

/** A shell mirrored to the right side (x negated, winding flipped). */
function mirrorShell(s) {
  const pos = s.pos.slice();
  for (let i = 0; i < pos.length; i += 3) pos[i] = -pos[i];
  const tris = [];
  for (let i = 0; i < s.tris.length; i += 3) tris.push(s.tris[i], s.tris[i + 2], s.tris[i + 1]);
  return { pos, tris, nor: s.nor.map(([a, b, c]) => [-a, b, c]) };
}
/** Shells joined into one (separate components). */
function joinShells(list) {
  const out = { pos: [], tris: [], nor: [] };
  for (const s of list) {
    const base = out.pos.length / 3;
    for (const v of s.pos) out.pos.push(v);
    for (const t of s.tris) out.tris.push(t + base);
    for (const v of s.nor) out.nor.push(v);
  }
  return out;
}

/**
 * @param {{texture?: number, triangles?: number, wingTriangles?: number, grid?: number}} [o]
 *   texture size, target triangles for the fused shell and for each wing, surface-nets grid spacing
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 5000, wingTriangles = 520, grid = 0.02 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  // the fused shell (face, beak, tufts and toes denser) and the two wings
  const bodyShell = buildShell(f, {
    lo: [-0.66, -0.04, -0.76],
    hi: [0.66, 1.62, 0.66],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      let k = heart2D(qx, qy) < 0.04 && qz > 0.05 && y > 0.6 ? 2.6 : 1;
      if (Math.abs(qx) < 0.07 && qy < 0 && qy > -0.2 && qz > 0.2) k = 4;
      if (y > 1.25) k = Math.max(k, 2);
      if (y < 0.1 && z > 0.18) k = Math.max(k, 2.2);
      return k;
    },
  });
  const wingL = buildShell(shape.wing, { lo: [0.2, 0.06, -0.5], hi: [0.72, 1.0, 0.24], grid: 0.012, triangles: wingTriangles });
  const nBody = bodyShell.pos.length / 3;
  const nWing = wingL.pos.length / 3;
  const shell = joinShells([bodyShell, wingL, mirrorShell(wingL)]);
  const wingSolid = (x, y, z) => Math.min(shape.solid(x, y, z), shape.wing(Math.abs(x), y, z));
  const ao = fieldAO(wingSolid, shell.pos, shell.nor);

  // the face parts
  const B = shape.BEAK;
  const faceNB = surfaceAt(shape.noBeak, HEAD);
  const lids = eyelids(shape.eyes, {
    rUp: 1.1,
    rLo: 1.075,
    motions: {
      blink: [{ close: 1 }, { close: 1 }],
      squint: [{ close: 0.5 }, { close: 0.34 }],
      happy: [4, { close: 0.92 }],
      sad: [{ deg: 22, roll: -0.6 }, 0],
      angry: [{ deg: 34, roll: 0.9 }, 10],
      surprised: [-8, -8],
    },
  });
  const mouth = mouthInside(faceNB, HEAD, {
    y: B.mouthY,
    shapes: { mouthOpen: [-0.02, 0.034, 0.05, 0.8, 0.03], surprised: [-0.01, 0.018, 0.02, 0.8, 0.03] },
    colors: { mouth: srgb(120, 44, 46), tongue: srgb(214, 110, 110) },
    fangs: false,
  });
  const parts = [lids, mouth];

  // UVs
  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  for (const part of parts) part.reserve(atlas);
  atlas.layout();

  // the Body
  const body = new MeshBuffer(KEYS);
  const shellTris = appendShell(body, shell, atlas, (i, p) => {
    if (i >= nBody) {
      // a wing: rigid on its arm bone (a child of the wing bone); puffs out with the body
      const left = i < nBody + nWing;
      return { weights: [[left ? BI.arm_L : BI.arm_R, 1]], keys: { puff: [left ? 0.04 : -0.04, 0.005, 0] } };
    }
    const w = skinOf(shape, p);
    const hw = w.reduce((s, [b, v]) => s + (b === BI.head ? v : 0), 0);
    return { weights: w, keys: faceKeysOf(shape, f, p, shell.nor[i], hw) };
  });
  const shellCount = body.count;
  for (const part of parts) part.build(body, atlas, [[BI.head, 1]]);

  // the texture
  const canvas = createCanvas(N);
  const src = { pos: (i) => body.P(i), nor: (i) => shell.nor[body.src[i]], ao: (i) => ao[body.src[i]] };
  const isWing = (t) => body.src[t[0]] >= nBody;
  paintShell(canvas, body, shellTris.filter((t) => !isWing(t)), makeSkinPainter(shape), src);
  paintShell(canvas, body, shellTris.filter(isWing), makeWingPainter(), src);
  for (const part of parts) part.paint(canvas, atlas);
  // the lids: plumage with a dark lash line
  for (const l of lids.lids)
    paintRect(canvas, atlas, l.rect, (u, v, out) => {
      // pale feathered lids (the disc's cream, fine streaks), a warm band and a dark lash line
      const streak = band(u * 14 + 0.3 * vnoise(u * 20, v * 9, l.upper ? 1 : 7), 0.3, 0.2) * 0.35;
      const fv = lerp3(COL.cream, COL.creamDark, streak + 0.3 * sstep(0.3, 0.9, v));
      const edge = lerp3(fv, COL.lid, 0.8 * sstep(0.16, 0.05, v));
      write(out, lerp3(edge, COL.ink, sstep(0.06, 0.025, v)), 0);
    });
  dilate(canvas, 6);

  // the eyeballs (amber), which also swell a little when surprised
  const eyes = eyeballs(shape.eyes, {
    bones: { L: BI.eye_L, R: BI.eye_R },
    irisColor: (t, lit) => [mix(1.0, 0.93, t) + 0.0 * lit, mix(0.8, 0.5, t) + 0.12 * lit, mix(0.2, 0.08, t)],
    rimColor: srgb(120, 64, 20),
  });
  for (let i = 0; i < eyes.count; i++) {
    const pv = eyes.P(i);
    const e = pv[0] >= 0 ? eyeL : eyeR;
    const dlt = scl(sub(pv, e.E), 0.05);
    for (let k = 0; k < 3; k++) eyes.morph.surprised[i * 3 + k] += dlt[k];
  }

  const bones = BONES.map(([nm, parent, pp]) => [
    nm,
    parent,
    pp ??
      {
        eye_L: eyeL.E,
        eye_R: eyeR.E,
        ear_L: add(shape.tuftL.B, scl(shape.tuftL.ax, 0.04)),
        ear_R: add(shape.tuftR.B, scl(shape.tuftR.ax, 0.04)),
      }[nm],
  ]);
  return assemble({ name: 'owl', bones, body, eyes, map: toTexture(canvas, 'owl_basecolor'), fit: fitScale(body, shellCount) });
}

export const buildOwl = build;

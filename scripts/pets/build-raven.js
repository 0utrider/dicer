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
  chain,
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
  tiltFrame,
  toTexture,
  vnoise,
  weights,
  write,
} from './lib/index.js';

/**
 * Dicer's raven pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a sleek, slim corvid standing upright on thin dark legs, peering up at the camera. A
 * flat-crowned head with a heavy brow, a long straight heavy beak (the lower mandible is its own
 * shell, so the beak really opens), a shaggy beard of throat hackles, long wings folded along the
 * body (each its own shell, so it can spread) in three layered tiers of glossy feathers, their
 * tips flanking a wedge tail, and clever pale-blue eyes in a dark ring. Grey plumage (tinted by
 * Dicer) with a sheen on every feather; charcoal beak, legs and eye ring. Natural colour: a
 * blue-black, #40456a.
 *
 * One `Body` mesh: the fused shell, the two wing shells, the lower mandible and the eyelids; `Eyes`
 * the eyeballs. Bones: root, body, head, eye_L/R, wing_L/R, arm_L/R (children of the wings at the
 * shoulder: "raise an arm" swings the wing forward), tail_1, tail_2. Shape keys: the spec's ten (no
 * tongue).
 */

// ------------------------------------------------------------------------------- the design

const HEAD = tiltFrame([0, 1.13, 0.12], 0.7); // the face tilted up toward the top-down camera
const { fw, fdir, wf } = HEAD;

const EYE_R = 0.122;
const EYE_X = 0.21;
const EYE_Y = 0.06;
const R_SOCK = 1.13;
const EYE_OPEN = 42 * DEG; // how much of each eyeball shows, from its centre line
const MOUND_R = 0.5; // the eye pads: how flat
const PAD_R = EYE_R * 1.6; // and how wide
const EYE_YAW = 0.56; // the sockets face out and up, square to the head there
const EYE_PITCH = 0.24;
const GAZE_YAW = 0.3; // but the irises look more forward
/** An eye's frame looking `yaw` out (to its own side) and EYE_PITCH up, in the face. */
function eyeFrame(side, yaw) {
  const F = norm(fdir(Math.sin(yaw) * Math.cos(EYE_PITCH) * side, Math.sin(EYE_PITCH), Math.cos(yaw) * Math.cos(EYE_PITCH)));
  const up = fdir(0, 1, 0);
  const U = norm(sub(up, scl(F, dot(up, F))));
  return { F, U, X: cross(U, F) };
}
const NECK_Y = 0.88; // the head/body blend plane (design units)
const SHOULDER = [0.33, 0.85, 0.02]; // the left wing's hinge (mirrored for the right)
const TAIL0 = [0, 0.48, -0.4];
const TAIL_DIR = norm([0, -0.42, -1]);
const TAIL_LEN = 0.42;
const KEYS = ALL_KEYS.filter((k) => k !== 'tongue');

// the beak, in face-local space: a long cone from B0 (inside the head) along BA, split by the gape
const BEAK_Y = -0.155;
const BEAK_LEN = 0.43;
const BEAK_R0 = 0.132;
const BEAK_R1 = 0.04;
const BEAK_DROOP = 0.04; // the culmen curves down toward the tip
const BEAK_FLAT = 0.74; // narrower than it is deep
const GAPE = -0.034; // the gape plane (beak-local up): the upper mandible is the heavier one
const BA = norm([0, -0.62, 1]);
const BU = norm([0, 1, 0.62]);

const COL = {
  beak: srgb(50, 50, 60),
  beakLight: srgb(112, 114, 132),
  beakDark: srgb(30, 30, 36),
  mouth: srgb(138, 50, 62),
  mouthDeep: srgb(70, 22, 30),
  tongue: srgb(214, 108, 120),
  leg: srgb(62, 60, 70),
  legDark: srgb(40, 38, 46),
  claw: srgb(22, 20, 24),
  ring: srgb(38, 38, 46),
  ink: srgb(20, 20, 26),
};

/** A tapered 2D capsule from (ax, ay) radius r1 to (bx, by) radius r2 (approximate distance). */
function cone2(x, y, ax, ay, bx, by, r1, r2) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(x - ax - dx * t, y - ay - dy * t) - mix(r1, r2, t);
}

/**
 * The folded wing in side view (z, y): a leaf of coverts from the shoulder, then long flight
 * feathers sweeping back and down to tips that lie beside the tail.
 */
const W_S = [0.07, 0.86];
const W_M = [-0.17, 0.6];
const W_TIPS = [
  [-0.47, 0.31],
  [-0.55, 0.34],
  [-0.61, 0.385],
  [-0.63, 0.44],
];
const W_FROM = [
  [-0.1, 0.5],
  [-0.15, 0.54],
  [-0.2, 0.6],
  [-0.24, 0.66],
];
// the wing's long axis (shoulder to tips) and across it
const W_AX = norm([W_TIPS[2][0] - W_S[0], W_TIPS[2][1] - W_S[1], 0]);
const W_LEN = Math.hypot(W_TIPS[2][0] - W_S[0], W_TIPS[2][1] - W_S[1]);
/** Along (0 at the shoulder .. 1 at the tips) and across (+ toward the back edge) the folded wing. */
const wingUV = (z, y) => [((z - W_S[0]) * W_AX[0] + (y - W_S[1]) * W_AX[1]) / W_LEN, (z - W_S[0]) * W_AX[1] - (y - W_S[1]) * W_AX[0]];
function wingOutline(z, y) {
  const leaf = cone2(z, y, W_S[0], W_S[1], W_M[0], W_M[1], 0.085, 0.16);
  let pr = Infinity;
  for (let i = 0; i < W_TIPS.length; i++) pr = Math.min(pr, cone2(z, y, W_FROM[i][0], W_FROM[i][1], W_TIPS[i][0], W_TIPS[i][1], 0.08, 0.024));
  return smin(leaf, pr, 0.05);
}
/** Which flight feather (0..3) a side-view point is nearest, its distance and its arc parameter 0..1. */
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
    const d = cone2(z, y, ax, ay, bx, by, 0.08, 0.024);
    if (d < best) {
      best = d;
      bi = i;
      bt = t;
    }
  }
  return { i: bi, d: best, t: bt };
}
/** The wing's three tiers along its length: 0..1 within the tier (1 at its trailing edge), and which. */
const TIERS = [0, 0.2, 0.42, 1.2];
function tierAt(a) {
  for (let i = 0; i + 1 < TIERS.length; i++) if (a < TIERS[i + 1]) return { i, k: clamp((a - TIERS[i]) / (TIERS[i + 1] - TIERS[i]), 0, 1) };
  return { i: 2, k: 1 };
}

function makeShape() {
  const skull = ellipsoid([0, 0, -0.04], [0.355, 0.285, 0.365]);
  const chest = ellipsoid([0, 0.69, 0.03], [0.34, 0.4, 0.335]);
  const rump = ellipsoid([0, 0.54, -0.2], [0.28, 0.26, 0.33]);
  // where the folded wing tips lie, out past the rump beside the tail (the wings hug this, not air)
  const wingRest = ellipsoid([0, 0.46, -0.4], [0.2, 0.18, 0.3]);
  // legs: feathered thighs, thin bare shanks, three toes forward and one back, a claw on each
  const thighs = [];
  const shanks = [];
  const toes = [];
  const claws = [];
  for (const s of [1, -1]) {
    thighs.push(roundCone([s * 0.15, 0.47, -0.04], [s * 0.158, 0.25, 0.0], 0.13, 0.052));
    const ankle = [s * 0.162, 0.04, 0.04];
    shanks.push(roundCone([s * 0.156, 0.32, -0.01], ankle, 0.036, 0.031));
    for (const a of [-0.5, 0, 0.5, Math.PI]) {
      const aa = a === Math.PI ? a : a + s * 0.14;
      const D = norm([Math.sin(aa), -0.04, Math.cos(aa)]);
      const T = add(ankle, scl(D, a === 0 ? 0.16 : a === Math.PI ? 0.085 : 0.135));
      toes.push(roundCone(ankle, [T[0], 0.026, T[2]], 0.031, 0.021));
      claws.push(roundCone([T[0], 0.026, T[2]], add(add(T, scl(D, 0.04)), [0, -0.03, 0]), 0.017, 0.006));
    }
  }
  // the wedge tail: a flat fan, widest two thirds along, narrowing to a blunt point
  let tfn = [0, 1, 0];
  tfn = norm(sub(tfn, scl(TAIL_DIR, dot(tfn, TAIL_DIR))));
  const tsd = cross(TAIL_DIR, tfn);
  const fanA = roundCone([0, 0, 0], [0, TAIL_LEN * 0.6, 0], 0.1, 0.155);
  const fanB = roundCone([0, TAIL_LEN * 0.6, 0], [0, TAIL_LEN, 0], 0.155, 0.06);
  const TAIL_FLAT = 0.24;
  const tailLocal = (x, y, z) => {
    const p = [x - TAIL0[0], y - TAIL0[1], z - TAIL0[2]];
    return [dot(p, tsd), dot(p, TAIL_DIR), dot(p, tfn)];
  };
  // the shaggy throat: a beard of pointed hackles hanging from under the beak
  const hackles = [];
  for (const [hx, y0, y1, out] of [
    // the upper row, then a longer lower row showing between and below it
    [0.05, 1.04, 0.925, 0.07],
    [-0.05, 1.04, 0.925, 0.07],
    [0.15, 1.04, 0.95, 0.06],
    [-0.15, 1.04, 0.95, 0.06],
    [0, 0.98, 0.82, 0.075],
    [0.1, 0.98, 0.845, 0.07],
    [-0.1, 0.98, 0.845, 0.07],
    [0.195, 0.98, 0.885, 0.055],
    [-0.195, 0.98, 0.885, 0.055],
  ]) {
    const ax = Math.abs(hx);
    const a = [hx * 0.9, y0, 0.3 - ax * 0.32];
    const b = [hx * 1.15, y1, 0.36 + out - ax * 0.6];
    hackles.push({ a, ab: sub(b, a), f: roundCone(a, b, 0.056, 0.013) });
  }
  /** The hackle nearest a point: its index and how far along it (0 the root .. 1 the tip). */
  const hackleAt = (x, y, z) => {
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < hackles.length; i++) {
      const d = hackles[i].f(x, y, z);
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    const { a, ab } = hackles[bi];
    return { i: bi, t: clamp(dot(sub([x, y, z], a), ab) / dot(ab, ab), 0, 1) };
  };

  /** The head in face-local q before the beak: a flat-crowned skull with a heavy brow over the eyes. */
  const headQ = (qx, qy, qz) => {
    let h = skull(qx, qy, qz);
    const front = sstep(0.05, 0.2, qz);
    h -= 0.02 * Math.exp(-(((qy - EYE_Y - 0.135) / 0.045) ** 2)) * front * sstep(0.36, 0.22, Math.abs(qx)); // the brow
    return h;
  };
  // the beak springs from the face below the eyes
  let zs = 0.6;
  for (let i = 0; i < 200 && headQ(0, BEAK_Y, zs) > 0; i++) zs -= 0.004;
  const B0 = [0, BEAK_Y, zs - 0.07];
  const cone = roundCone([0, 0, 0], [0, -BEAK_DROOP, BEAK_LEN], BEAK_R0, BEAK_R1);
  const hook = roundCone([0, -BEAK_DROOP + 0.012, BEAK_LEN - 0.03], [0, -BEAK_DROOP - 0.05, BEAK_LEN + 0.03], 0.034, 0.011);
  /** Face-local q -> beak-local [across, up, along]. */
  const beakLocal = (qx, qy, qz) => {
    const ry = qy - B0[1];
    const rz = qz - B0[2];
    return [qx, ry * BU[1] + rz * BU[2], ry * BA[1] + rz * BA[2]];
  };
  const beakCone = (b) => cone(b[0] / BEAK_FLAT, b[1], b[2]) * BEAK_FLAT;
  /** The upper mandible (with its small hooked tip), from beak-local b. */
  const upperB = (b) => smin(smax(beakCone(b), -(b[1] - GAPE + 0.03), 0.003), hook(b[0] / BEAK_FLAT, b[1], b[2]) * BEAK_FLAT, 0.014);
  /** The lower mandible, a little shorter. */
  const lowerB = (b) => smax(smax(beakCone(b), b[1] - GAPE, 0.003), b[2] - (BEAK_LEN - 0.02), 0.012);
  const BEAK = { hinge: add(B0, add(scl(BU, GAPE), scl(BA, 0.07))), zs, B0 };

  const shape = { eyes: [], tailLocal, BEAK, headQ, beakLocal, hackleAt };
  /** Distances to the parts at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    let hd = headQ(qx, qy, qz);
    // a shallow lens-shaped pad under each eye, square to it, so the eyeball and its lids show
    // evenly all round (a head this narrow curves away from the eye, which would bare its outer side)
    for (const e of shape.eyes) {
      const near = Math.hypot(x - e.E[0], y - e.E[1], z - e.E[2]) - PAD_R;
      if (near < 0.1) hd = smin(hd, smax(Math.hypot(x - e.M[0], y - e.M[1], z - e.M[2]) - MOUND_R, near, 0.07), 0.05);
    }
    o.head = hd;
    o.beak = upperB(beakLocal(qx, qy, qz));
    let h = Infinity;
    for (const k of hackles) h = smin(h, k.f(x, y, z), 0.012);
    o.hack = h;
    o.torso = smin(chest(x, y, z), rump(x, y, z), 0.14);
    o.thigh = Math.min(thighs[0](x, y, z), thighs[1](x, y, z));
    o.legs = Math.min(shanks[0](x, y, z), shanks[1](x, y, z));
    let t = Infinity;
    for (const f of toes) t = Math.min(t, f(x, y, z));
    o.toes = t;
    let c = Infinity;
    for (const f of claws) c = Math.min(c, f(x, y, z));
    o.claws = c;
    const [ts, tt, tw] = tailLocal(x, y, z);
    o.tail = smin(fanA(ts, tt, tw / TAIL_FLAT), fanB(ts, tt, tw / TAIL_FLAT), 0.02) * TAIL_FLAT;
    return o;
  };
  const P = {};
  const union = (x, y, z) => {
    shape.parts(x, y, z, P);
    let hd = smin(P.head, P.beak, 0.06);
    hd = smin(hd, P.hack, 0.04);
    let d = smin(hd, P.torso, 0.13);
    d = smin(d, P.thigh, 0.07);
    d = smin(d, smin(P.legs, smin(P.toes, P.claws, 0.012), 0.012), 0.03);
    return smin(d, P.tail, 0.06);
  };
  /** The raven without eye sockets (for placing the eyes and occlusion). */
  shape.solid = (x, y, z) => smax(union(x, y, z), -y, 0.02);
  const placed = placeEyes(shape.solid, HEAD, { r: EYE_R, x: EYE_X, y: EYE_Y, yaw: EYE_YAW, open: EYE_OPEN });
  // the mound's centre: its sphere crosses the eyeball EYE_OPEN round from the eye's forward
  const co = Math.cos(EYE_OPEN);
  const md = -EYE_R * co + Math.sqrt((EYE_R * co) ** 2 + MOUND_R ** 2 - EYE_R ** 2);
  shape.eyes = placed.map((e) => {
    const fr = eyeFrame(e.side, EYE_YAW);
    return { ...e, ...fr, top: EYE_OPEN, bottom: EYE_OPEN, M: sub(e.E, scl(fr.F, md)) };
  }); // from here the pads are in
  shape.sdf = (x, y, z) => smax(carveSockets(union(x, y, z), x, y, z, shape.eyes, EYE_R * R_SOCK), -y, 0.02);
  /** The lower mandible: its own shell. */
  shape.jaw = (x, y, z) => lowerB(beakLocal(...wf(x, y, z)));
  /** The upper mandible alone (the jaw's paint: where they touch is the mouth). */
  shape.upper = (x, y, z) => upperB(beakLocal(...wf(x, y, z)));
  /** What the folded wings lie on: the trunk and the rest beside the tail. */
  const guide = (x, y, z) => smin(smin(chest(x, y, z), rump(x, y, z), 0.14), wingRest(x, y, z), 0.12);
  /** The left wing: a curved slab hugging the body's side, cut to the wing's outline, in three stepped tiers. */
  shape.wing = (x, y, z) => {
    const o = wingOutline(z, y);
    if (o > 0.08 || x < 0.04) return Math.max(o, 0.1 - x, 0.02);
    const b = guide(x, y, z);
    const [a] = wingUV(z, y);
    const tier = tierAt(a);
    const th = (0.02 + 0.016 * tier.k * (tier.i < 2 ? 1 : 0.5) + 0.01 * (2 - tier.i)) * mix(0.5, 1, sstep(0.0, -0.06, o));
    const slab = Math.max(b - th, -(b + 0.03));
    return smax(smax(o, slab, 0.016), 0.1 - x, 0.012);
  };
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.5, -0.02]],
  ['head', 'body', [0, NECK_Y, 0.07]],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['wing_L', 'body', SHOULDER],
  ['wing_R', 'body', [-SHOULDER[0], SHOULDER[1], SHOULDER[2]]],
  ['arm_L', 'wing_L', SHOULDER],
  ['arm_R', 'wing_R', [-SHOULDER[0], SHOULDER[1], SHOULDER[2]]],
  ['tail_1', 'body', add(TAIL0, scl(TAIL_DIR, 0.06))],
  ['tail_2', 'tail_1', add(TAIL0, scl(TAIL_DIR, 0.24))],
];
const BI = boneIndex(BONES);

/** Skin weights of a body-shell point: head vs body by the neck plane, the tail chain; legs and feet on root. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  const headish = Math.min(d.beak, d.hack);
  const core = Math.min(d.head, d.torso, d.thigh, d.legs, d.toes, d.claws);
  for (const [name, v] of soft([
    ['core', core, 0.03],
    ['face', headish, 0.03],
    ['tail', d.tail, 0.03],
  ])) {
    if (name === 'face') w.put('head', v);
    else if (name === 'core') {
      const hv = sstep(-0.07, 0.07, y - NECK_Y + 0.15 * (z - 0.05));
      w.put('head', v * hv);
      const body = v * (1 - hv);
      const rootK = sstep(0.24, 0.07, y); // the feet stay planted when the body leans
      w.put('root', body * rootK);
      w.put('body', body * (1 - rootK));
    } else chain(w, v, shape.tailLocal(x, y, z)[1], ['body', 'tail_1', 'tail_2'], [0.06, 0.24], 0.05);
  }
  return w.done(BI);
}

/** A face-local rotation about the x axis through h, as a model-space delta of p (a > 0 drops what is ahead). */
function beakTurn(p, h, a) {
  const q = wf(...p);
  const r = sub(q, h);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const q2 = [q[0], h[1] + r[1] * c - r[2] * s, h[2] + r[1] * s + r[2] * c];
  return sub(fw(...q2), p);
}
// how far each mandible turns (degrees) per key: [upper (negative lifts), lower]
const BEAK_KEYS = { mouthOpen: [-9, 25], surprised: [-3, 9], happy: [-1.5, 5] };

/** Face shape keys on the shell: displacement fields in face-local space. */
function faceKeysOf(shape, f, p, n, headW) {
  const gauss = (q, c, s) => Math.exp(-((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2) / (2 * s * s));
  const mirror = (q, c, s) => gauss(q, c, s) + gauss(q, [-c[0], c[1]], s);
  const q = wf(...p);
  const out = {};
  const d = shape.parts(...p);
  const front = sstep(0.02, 0.2, q[2]) * headW;
  // puff: the plumage fluffs out (not the face, the beak or the bare legs)
  const bare = Math.min(d.beak, d.legs, d.toes, d.claws) - Math.min(d.head, d.torso, d.thigh, d.tail, d.hack);
  out.puff = scl(n, 0.04 * sstep(0.0, 0.04, bare) * (1 - 0.8 * front) * sstep(0.2, 0.32, p[1]));
  if (headW < 0.01) return out;
  // the upper mandible lifts as the beak opens (the lower one is its own shell)
  const b = shape.beakLocal(...q);
  const e = Math.exp(-(d.beak - Math.min(d.head, d.hack, d.torso)) / 0.012);
  const wBeak = (e / (1 + e)) * sstep(0.05, 0.14, b[2]);
  if (wBeak > 0.01) {
    for (const [k, [up]] of Object.entries(BEAK_KEYS)) out[k] = scl(beakTurn(p, shape.BEAK.hinge, up * DEG), wBeak * headW);
    if (wBeak > 0.5) return out;
  }
  const browIn = mirror(q, [0.1, EYE_Y + 0.135], 0.055) * front;
  const browOut = mirror(q, [0.3, EYE_Y + 0.1], 0.06) * front;
  const brow = mirror(q, [EYE_X, EYE_Y + 0.14], 0.085) * front;
  const cheek = mirror(q, [0.22, EYE_Y - 0.14], 0.07) * front;
  const slide = (dd) => (len(dd) < 1e-6 ? dd : sub(project(f, add(p, dd)), p));
  const sum = (k, v) => {
    out[k] = out[k] ? add(out[k], v) : v;
  };
  const k1 = 1 - wBeak;
  sum('happy', scl(add(slide(fdir(0, 0.026 * cheek, 0)), scl(n, 0.008 * cheek)), k1));
  out.sad = scl(slide(fdir(0, 0.028 * browIn - 0.02 * browOut, 0)), k1);
  sum('surprised', scl(slide(fdir(0, 0.026 * brow, 0)), k1));
  out.angry = scl(add(fdir(0, -0.04 * browIn + 0.012 * browOut, 0), scl(n, 0.02 * browIn)), k1);
  return out;
}

// ---------------------------------------------------------------------------- the painting

/**
 * Rows of overlapping feather tips on a 2D sheet (u across, v up; the tips point down): `edge` the
 * dark rim of each tip, `sheen` a gloss across its upper half, `shaft` the quill.
 */
function feathers(u, v, size, seed, long = 0.8) {
  const h = size * long;
  const row = Math.floor(v / h);
  const off = (row & 1) * 0.5;
  const col = Math.floor(u / size + off);
  const j = hash(col, row, seed);
  const cu = (col + 0.5 - off) * size + (j - 0.5) * size * 0.14;
  const cv = (row + 0.6) * h;
  const du = u - cu;
  const dv = v - cv;
  const r = size * 0.5;
  const dd = Math.hypot(du, (dv * 0.8) / long);
  const edge = sstep(size * 0.13, size * 0.04, Math.abs(dd - r)) * sstep(size * 0.15, -size * 0.1, dv);
  const sheen = sstep(-r * 0.2, r * 0.9, dv) * sstep(r * 0.95, r * 0.3, Math.abs(du)) * (0.75 + 0.5 * j);
  return { edge, sheen, shaft: sstep(size * 0.045, size * 0.012, Math.abs(du)) * sstep(r, -r * 0.6, dv) };
}

/** The beak's colour at beak-local b: charcoal, a pale gleam along the ridge, darker toward the tip and below. */
function beakColor(b, grain, lower) {
  const ridge = sstep(0.015, 0.075, b[1] + 0.02) * sstep(0.05, 0.0, Math.abs(b[0])) * sstep(BEAK_LEN + 0.02, 0.2, b[2]);
  let c = lerp3(COL.beak, COL.beakLight, lower ? 0 : 0.7 * ridge);
  c = lerp3(c, COL.beakDark, 0.6 * sstep(0.3, BEAK_LEN, b[2]) + (lower ? 0.25 : 0));
  // fine growth lines round the beak
  c = scl(c, 0.94 + 0.08 * band(b[2] * 26 + 0.4 * grain, 0.5, 0.3) + 0.06 * (grain - 0.5));
  return c;
}
/** The inside of the mouth: dark red, a paler tongue down the middle of the lower mandible. */
function mouthColor(b, lower) {
  let c = lerp3(COL.mouth, COL.mouthDeep, sstep(0.3, 0.08, b[2]));
  if (lower) c = lerp3(c, COL.tongue, sstep(0.03, 0.018, Math.abs(b[0])) * sstep(BEAK_LEN - 0.14, BEAK_LEN - 0.2, b[2]));
  return c;
}

/** The body shell's paint: grey plumage (tinted) with a sheen on every feather; the beak, the legs, the eye rings. */
function makeSkinPainter(shape) {
  const P = {};
  const [eyeL, eyeR] = shape.eyes;
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const q = wf(x, y, z);
    shape.parts(x, y, z, P);
    const dm = Math.min(P.head, P.beak, P.hack, P.torso, P.thigh, P.legs, P.toes, P.claws, P.tail);
    const near = (dd) => dd - dm < 0.01;
    const grain = vnoise(x * 120, y * 120, z * 120);
    const wob = fbm(x * 6 + 2, y * 6, z * 6) - 0.5;
    const b = shape.beakLocal(...q);

    // the beak: bare from where the nasal bristles end (a ragged feathered edge)
    const bristle = 0.085 + 0.02 * (vnoise(Math.atan2(b[1], b[0]) * 9, 3, 1) - 0.5) + 0.05 * sstep(0.0, 0.1, b[1]);
    if (P.beak - dm < 0.012 && b[2] > bristle - 0.012) {
      const inside = sstep(-0.008, -0.016, shape.jaw(x, y, z)); // hidden under the lower mandible: the mouth
      const c = lerp3(beakColor(b, grain, false), mouthColor(b, false), inside);
      const edge = sstep(bristle - 0.012, bristle + 0.006, b[2]);
      if (edge >= 1) {
        write(o, scl(c, mix(1, ao, 0.6)), 0);
        return;
      }
    }
    if (near(P.legs) || near(P.toes) || near(P.claws)) {
      const claw = P.claws < Math.min(P.toes, P.legs) - 0.002 ? 1 : 0;
      let c = lerp3(COL.leg, COL.claw, claw);
      // scaly rings: up the shank, along each toe
      if (!claw) c = lerp3(c, COL.legDark, 0.55 * band((near(P.legs) && y > 0.07 ? y : Math.hypot(x - Math.sign(x) * 0.162, z - 0.04)) * 42, 0.45, 0.2));
      const feathered = sstep(0.27, 0.31, y + 0.02 * wob); // the thigh's feathers hang over the shank
      if (feathered < 1) {
        write(o, scl(c, ao * (0.94 + 0.12 * grain)), feathered > 0.5 ? 1 : 0);
        return;
      }
    }

    // plumage (tinted): a mid grey, darker rims, a pale sheen
    let g = 0.76;
    let mark = 0;
    let light = 0;
    if (near(P.tail)) {
      // the tail: long feathers side by side, each with a quill and a gloss, dark between
      const [ts, tt] = shape.tailLocal(x, y, z);
      const fan = ts / (0.1 + 0.11 * clamp(tt / (TAIL_LEN * 0.6), 0, 1));
      const k = fan * 3.2 + 0.5;
      const fr = k - Math.floor(k);
      mark = 0.85 * sstep(0.12, 0.03, Math.min(fr, 1 - fr)) * sstep(0.02, 0.1, tt);
      light = 0.5 * sstep(0.2, 0.42, fr) * sstep(0.62, 0.45, fr) * sstep(0.05, 0.2, tt);
      mark = Math.max(mark, 0.5 * sstep(0.06, 0.02, Math.abs(fr - 0.5)));
      g = 0.66 + 0.05 * wob;
    } else if (near(P.hack) && P.hack < P.torso + 0.02 && P.hack < P.head + 0.015) {
      // the throat hackles: pointed feathers hanging down, each with a dark edge and a pale centre
      const hk = shape.hackleAt(x, y, z);
      mark = 0.6 * sstep(0.45, 0.0, hk.t) * (hk.i >= 4 ? 1 : 0.4) + 0.5 * sstep(0.86, 1.0, hk.t);
      light = 0.5 * sstep(0.35, 0.6, hk.t) * sstep(0.95, 0.75, hk.t) * sstep(-0.2, 0.5, n[2] + n[1]);
      g = 0.74;
    } else if (near(P.thigh) && P.thigh < P.torso) {
      // the thighs: shaggy "trousers" of streaks
      const a = Math.atan2(z, Math.abs(x) - 0.15);
      mark = 0.55 * band(a * 2.6 + wob * 0.8 + y * 3, 0.3, 0.2);
      light = 0.3 * band(a * 2.6 + wob * 0.8 + y * 3 + 0.5, 0.2, 0.2);
      mark = Math.max(mark, 0.5 * sstep(0.3, 0.25, y));
      g = 0.7;
    } else if (near(P.head) && (P.head < P.torso || y > NECK_Y + 0.05)) {
      // the head: small sleek feathers lying back from the beak, a gloss over the crown
      const r = Math.hypot(q[0], q[1] - BEAK_Y);
      const a = Math.atan2(q[0], q[1] - BEAK_Y);
      const back = r + 0.6 * Math.max(0, -q[2] + 0.2);
      const ft = feathers(a * 0.3 + 0.01 * wob, -back + 0.01 * wob, 0.05, 5, 1.2);
      mark = 0.16 * ft.edge * sstep(0.2, 0.32, back);
      light = 0.2 * ft.sheen * sstep(0.2, 0.32, back) + 0.2 * sstep(0.5, 0.95, n[1]);
      g = 0.78 + 0.04 * wob;
      // the nasal bristles: fine dark streaks running onto the beak
      const kb = Math.atan2(b[1], b[0]) * 8;
      mark = Math.max(mark, 0.4 * band(kb + wob, 0.35, 0.2) * sstep(0.05, 0.0, P.beak - dm));
    } else {
      // the trunk: rows of overlapping feathers, bigger and glossier down the chest and back
      const a = Math.atan2(x, z + 0.08);
      const size = mix(0.08, 0.11, sstep(1.0, 0.45, y));
      const ft = feathers(a * 0.34 + 0.02 * wob, y + 0.02 * wob, size, 3, 1.05);
      mark = (0.4 * ft.edge + 0.14 * ft.shaft) * sstep(1.0, 0.86, y);
      light = 0.42 * ft.sheen * sstep(1.0, 0.86, y);
      g = 0.75 + 0.05 * wob;
    }
    g += 0.05 * (grain - 0.5);
    let c = scl([1, 1, 1], g * (1 - 0.45 * clamp(mark, 0, 1)));
    c = lerp3(c, [0.99, 0.99, 0.99], clamp(light, 0, 1) * 0.75);
    // toward the bare beak and eye rings the feathers darken (a pale seam would show there under a dark tint)
    c = scl(c, 1 - 0.5 * sstep(0.05, 0.0, P.beak - dm) * sstep(bristle - 0.07, bristle - 0.015, b[2]));
    let tint = 1;
    for (const e of [eyeL, eyeR]) {
      // a ring of bare dark skin round each eye, and the socket wall
      const dist = len(sub(p, e.E));
      const ring = sstep(EYE_R * R_SOCK + 0.022, EYE_R * R_SOCK + 0.01, dist) * sstep(0.2, 0.5, dot(sub(p, e.E), e.F) / EYE_R);
      c = scl(c, 1 - 0.32 * sstep(EYE_R * R_SOCK + 0.04, EYE_R * R_SOCK + 0.02, dist));
      if (ring > 0) {
        c = lerp3(c, COL.ring, ring);
        tint = Math.min(tint, 1 - ring);
      }
    }
    // hidden under the lower mandible: the back of the mouth
    const inMouth = sstep(-0.006, -0.014, shape.jaw(x, y, z));
    if (inMouth > 0) {
      c = lerp3(c, COL.mouthDeep, inMouth);
      tint = Math.min(tint, 1 - inMouth);
    }
    if (n[1] < -0.3) c = lerp3(c, scl(c, 1.06), sstep(-0.3, -0.8, n[1]));
    write(o, scl(c, ao), tint > 0.5 ? 1 : 0);
  };
}

/** The lower mandible's paint: charcoal outside, the mouth where it meets the upper one. */
function makeJawPainter(shape) {
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const b = shape.beakLocal(...wf(x, y, z));
    const grain = vnoise(x * 120, y * 120, z * 120);
    const inside = sstep(-0.008, -0.016, shape.upper(x, y, z));
    write(o, scl(lerp3(beakColor(b, grain, true), mouthColor(b, true), inside), mix(1, ao, 0.5)), 0);
  };
}

/**
 * The wings' paint (both, in the left wing's side-view coordinates): three overlapping tiers, small
 * coverts at the shoulder, longer ones below, then the long flight feathers, each tier's feathers
 * rimmed dark with a gloss across them.
 */
function makeWingPainter() {
  return (p, n, ao, o) => {
    const [x0, y, z] = p;
    const side = x0 >= 0 ? 1 : -1;
    const nx = n[0] * side; // > 0 the outer face
    const grain = vnoise(x0 * 120, y * 120, z * 120);
    const wob = fbm(x0 * 6, y * 6 + 4, z * 6) - 0.5;
    const [a, c0] = wingUV(z, y);
    const tier = tierAt(a);
    let g = 0.7 - 0.035 * tier.i;
    let mark = 0;
    let light = 0;
    if (tier.i === 2) {
      // the flight feathers: long blades, a dark gap between each, a quill, a gloss along one side
      const pr = primaryAt(z, y);
      const rad = mix(0.08, 0.024, pr.t);
      mark = 0.9 * sstep(-0.3 * rad, -0.06 * rad, pr.d);
      light = 0.6 * sstep(-0.35 * rad, -0.6 * rad, pr.d) * sstep(0.05, 0.3, pr.t) * sstep(1.0, 0.8, pr.t);
      mark = Math.max(mark, 0.35 * sstep(0.9, 1.0, pr.t));
    } else {
      // coverts: rows of rounded tips pointing down the wing
      const size = tier.i === 0 ? 0.06 : 0.082;
      const ft = feathers(c0 + 0.01 * wob, -a * W_LEN + 0.01 * wob, size, 11 + tier.i, tier.i === 0 ? 0.75 : 1.15);
      mark = 0.65 * ft.edge + 0.2 * ft.shaft;
      light = 0.55 * ft.sheen;
    }
    // each tier lies over the next: a dark line under its trailing edge
    if (tier.i < 2) mark = Math.max(mark, 0.75 * sstep(0.82, 0.98, tier.k));
    else mark = Math.max(mark, 0.6 * sstep(0.1, 0.0, tier.k));
    // a dark edge round the folded wing, so it reads against the body
    mark = Math.max(mark, 0.75 * sstep(-0.03, -0.006, wingOutline(z, y)));
    if (nx < 0) {
      // the underside, seen when spread: paler, the feathers only faintly drawn
      g = 0.82 + 0.04 * wob;
      mark *= 0.4;
      light = 0;
    }
    g += 0.05 * (grain - 0.5);
    let c = scl([1, 1, 1], g * (1 - 0.5 * clamp(mark, 0, 1)));
    c = lerp3(c, [0.99, 0.99, 0.99], clamp(light, 0, 1) * 0.7);
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
 * @param {{texture?: number, triangles?: number, wingTriangles?: number, jawTriangles?: number, grid?: number}} [o]
 *   texture size, target triangles for the fused shell, each wing and the lower mandible, and the
 *   surface-nets grid spacing
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 5000, wingTriangles = 560, jawTriangles = 220, grid = 0.018 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  // the fused shell (face, beak, hackles and feet denser), the two wings and the lower mandible
  const bodyShell = buildShell(f, {
    lo: [-0.56, -0.04, -0.94],
    hi: [0.56, 1.56, 0.98],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, , qz] = wf(x, y, z);
      let k = 1;
      if (qz > 0.05 && y > NECK_Y) k = 2.2;
      for (const e of shape.eyes) if (Math.hypot(x - e.E[0], y - e.E[1], z - e.E[2]) < EYE_R * 1.7) k = 4.5;
      if (Math.abs(qx) < 0.12 && qz > 0.26) k = 3; // the beak
      if (y < 0.3) k = Math.max(k, 2.6); // legs and feet
      if (y < 1.0 && y > 0.72 && z > 0.22) k = Math.max(k, 2); // the hackles
      if (z < -0.5) k = Math.max(k, 1.5); // the tail's thin edge
      return k;
    },
  });
  const wingL = buildShell(shape.wing, { lo: [0.06, 0.2, -0.74], hi: [0.52, 1.0, 0.22], grid: 0.012, triangles: wingTriangles });
  const jaw = buildShell(shape.jaw, { lo: [-0.16, 0.9, 0.2], hi: [0.16, 1.46, 0.98], grid: 0.009, triangles: jawTriangles });
  const nBody = bodyShell.pos.length / 3;
  const nWing = wingL.pos.length / 3;
  const jaw0 = nBody + 2 * nWing;
  const shell = joinShells([bodyShell, wingL, mirrorShell(wingL), jaw]);
  const all = (x, y, z) => Math.min(shape.solid(x, y, z), shape.wing(Math.abs(x), y, z), shape.jaw(x, y, z));
  const ao = fieldAO(all, shell.pos, shell.nor);

  // the eyelids: feathered, closing to meet in the middle
  const lids = eyelids(shape.eyes, {
    rUp: 1.1,
    rLo: 1.075,
    margin: 8 * DEG,
    motions: {
      blink: [{ close: 1 }, { close: 1 }],
      squint: [{ close: 0.5 }, { close: 0.34 }],
      happy: [5, { close: 0.85 }],
      sad: [{ deg: 22, roll: -0.6 }, 0],
      angry: [{ deg: 34, roll: 0.9 }, 10],
      surprised: [-8, -8],
    },
  });
  const parts = [lids];

  // UVs
  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  for (const part of parts) part.reserve(atlas);
  atlas.layout();

  // the Body
  const body = new MeshBuffer(KEYS);
  const hinge = shape.BEAK.hinge;
  const shellTris = appendShell(body, shell, atlas, (i, p) => {
    if (i >= jaw0) {
      // the lower mandible: rigid on the head, dropping about the beak's hinge
      return { weights: [[BI.head, 1]], keys: Object.fromEntries(Object.entries(BEAK_KEYS).map(([k, [, lo]]) => [k, beakTurn(p, hinge, lo * DEG)])) };
    }
    if (i >= nBody) {
      // a wing: rigid on its arm bone (a child of the wing bone); puffs out with the body
      const left = i < nBody + nWing;
      return { weights: [[left ? BI.arm_L : BI.arm_R, 1]], keys: { puff: [left ? 0.035 : -0.035, 0.005, 0] } };
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
  const kindOf = (t) => (body.src[t[0]] >= jaw0 ? 2 : body.src[t[0]] >= nBody ? 1 : 0);
  paintShell(canvas, body, shellTris.filter((t) => kindOf(t) === 0), makeSkinPainter(shape), src);
  paintShell(canvas, body, shellTris.filter((t) => kindOf(t) === 1), makeWingPainter(), src);
  paintShell(canvas, body, shellTris.filter((t) => kindOf(t) === 2), makeJawPainter(shape), src);
  // the lids: plumage with a dark bare edge
  for (const l of lids.lids)
    paintRect(canvas, atlas, l.rect, (u, v, out) => {
      const fv = 0.72 + 0.06 * (vnoise(u * 30, v * 12, l.upper ? 1 : 7) - 0.5) - 0.1 * band(u * 9, 0.3, 0.2) * sstep(0.2, 0.6, v);
      const k = sstep(0.11, 0.05, v);
      write(out, lerp3([fv, fv, fv], COL.ink, k), k > 0.5 ? 0 : 1);
    });
  dilate(canvas, 6);

  // the eyeballs: a pale, clever ice blue with a big pupil; they swell a little when surprised
  const gazing = shape.eyes.map((e) => ({ ...e, ...eyeFrame(e.side, GAZE_YAW) }));
  const eyes = eyeballs(gazing, {
    bones: { L: BI.eye_L, R: BI.eye_R },
    pupil: 25 * DEG,
    iris: 50 * DEG,
    rings: [0, 8, 16, 23.5, 24.5, 26, 32, 39, 45, 48.5, 49.5, 51, 53, 58, 66, 80, 100, 125, 150, 180],
    irisColor: (t, lit) => [mix(0.72, 0.38, t) + 0.14 * lit, mix(0.88, 0.62, t) + 0.1 * lit, mix(1.0, 0.92, t)],
    rimColor: srgb(28, 40, 76),
    linerColor: COL.ink,
    white: srgb(58, 66, 96), // a bird's eye shows no white: dark round the iris
  });
  for (let i = 0; i < eyes.count; i++) {
    const pv = eyes.P(i);
    const e = pv[0] >= 0 ? eyeL : eyeR;
    const dlt = scl(sub(pv, e.E), 0.05);
    for (let k = 0; k < 3; k++) eyes.morph.surprised[i * 3 + k] += dlt[k];
  }

  const bones = BONES.map(([nm, parent, pp]) => [nm, parent, pp ?? { eye_L: eyeL.E, eye_R: eyeR.E }[nm]]);
  return assemble({ name: 'raven', bones, body, eyes, map: toTexture(canvas, 'raven_basecolor'), fit: fitScale(body, shellCount), roughness: 0.5 });
}

export const buildRaven = build;

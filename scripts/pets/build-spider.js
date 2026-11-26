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
  createAtlas,
  createCanvas,
  dilate,
  ellipsoid,
  eyeballs,
  eyelids,
  fbm,
  fieldAO,
  fitScale,
  len,
  lerp3,
  mix,
  mouthInside,
  norm,
  paintShell,
  placeEyes,
  polyline,
  project,
  roundCone,
  scl,
  smax,
  smin,
  soft,
  sphere,
  srgb,
  sstep,
  sub,
  surfaceAt,
  tiltFrame,
  toTexture,
  tongue,
  vnoise,
  weights,
  write,
} from './lib/index.js';

/**
 * Dicer's spider pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a cute fuzzy jumping spider, friendly not scary. A big round cephalothorax that is
 * mostly face (tilted up toward the top-down camera) with two very large glossy front eyes, two
 * pairs of little bead eyes beside and behind them, a small smile on a cream muzzle and two fuzzy pedipalps
 * beside it; a round fuzzy abdomen raised behind with a cream heart on top and dark chevrons round
 * it; eight short chunky legs arched out in a star, banded, with cream tips. Grey fur with darker
 * bands (tinted by Dicer); the heart, muzzle and leg tips are cream, the bead eyes
 * black (untinted). Natural colour: dusky violet #6b4f8a.
 *
 * One fused `Body` shell (a distance field, meshed) with the eyelids, the mouth's inside and the
 * tongue in the same mesh; `Eyes` the eyeballs. Bones: root, body, head, eye_L/R, tail_1 (the
 * abdomen: it wags and lifts as a tail does), arm_L/R (the front legs, hinged at their knees so
 * they wave and throw), leg_L1..3 and leg_R1..3 (the other legs, front to back, at their hips).
 * The legs hang from `body`, so the whole spider tips as one and the loader keeps it on the floor.
 * Shape keys: all eleven of the spec; `puff` fluffs the abdomen up.
 */

// ------------------------------------------------------------------------------- the design

const LIFT = 0.03; // how far the body is raised on its legs (design units)
const HEAD = tiltFrame([0, 0.56 + LIFT, 0.14], 0.64); // the face tilted up toward the top-down camera
const { fdir, wf } = HEAD;
const HEAD_R = [0.37, 0.345, 0.35];
const ABD_C = [0, 0.89 + LIFT, -0.22];
const ABD_R = [0.33, 0.31, 0.36];
const HEART = [0, ABD_C[2] - 0.02, 0.15]; // x, z of the heart's middle and its size

const EYE_R = 0.14;
const R_SOCK = 1.13;
const MOUTH_Y = -0.2;

const COL = {
  cream: srgb(250, 243, 230),
  ink: srgb(34, 28, 40),
  line: srgb(60, 42, 52),
  bead: srgb(18, 16, 24),
};

// The legs: [hip angle (deg from +Z), foot x, foot z, knee height]; hips on a ring under the body.
const HIP_C = [0, 0.32 + LIFT, 0.06];
const HIP_RING = 0.17;
const LEGS = [
  [30, 0.42, 0.59, 0.46],
  [68, 0.655, 0.2, 0.5],
  [108, 0.645, -0.25, 0.5],
  [145, 0.42, -0.6, 0.46],
];
const LEG_R = [0.1, 0.092, 0.08]; // hip, knee, foot
const FOOT_Y = 0.08;

/** A leg's joints on side s (+1 the spider's left): hip, knee, foot. */
function legJoints(i, s) {
  const [deg, fx, fz, ky] = LEGS[i];
  const a = deg * DEG;
  const hip = [HIP_C[0] + Math.sin(a) * HIP_RING * s, HIP_C[1], HIP_C[2] + Math.cos(a) * HIP_RING];
  const foot = [fx * s, FOOT_Y, fz];
  const knee = [mix(hip[0], foot[0], 0.6), ky + LIFT, mix(hip[2], foot[2], 0.6)];
  return [hip, knee, foot];
}

/** The point of the head's surface along face-local direction u, sunk in by `sink`. */
function onHead(u, sink) {
  const d = norm(u);
  const k = 1 / Math.hypot(d[0] / HEAD_R[0], d[1] / HEAD_R[1], d[2] / HEAD_R[2]);
  return scl(d, k - sink);
}

function makeShape() {
  const head = ellipsoid([0, 0, 0], HEAD_R);
  const cheeks = [1, -1].map((s) => ellipsoid([0.17 * s, -0.14, 0.09], [0.19, 0.16, 0.21]));
  const palps = [1, -1].map((s) => roundCone([0.125 * s, -0.2, 0.25], [0.142 * s, -0.315, 0.275], 0.066, 0.06));
  // the bead eyes (face-local): a pair beside the big eyes, a smaller pair up behind them
  const beads = [];
  for (const s of [1, -1]) {
    beads.push({ c: onHead([0.93 * s, 0.34, 0.24], 0.016), r: 0.046 });
    beads.push({ c: onHead([0.66 * s, 0.74, 0.02], 0.012), r: 0.034 });
  }
  const beadF = beads.map((b) => sphere(b.c, b.r));
  const abdomen = ellipsoid(ABD_C, ABD_R);
  // legs: 0..3 the left side front to back, 4..7 the right
  const legs = [];
  for (const s of [1, -1])
    for (let i = 0; i < LEGS.length; i++) {
      const [hip, knee, foot] = legJoints(i, s);
      const upper = roundCone(hip, knee, LEG_R[0], LEG_R[1]);
      const lower = roundCone(knee, foot, LEG_R[1], LEG_R[2]);
      legs.push({ i, side: s, hip, knee, foot, line: polyline([hip, knee, foot]), d: (x, y, z) => smin(upper(x, y, z), lower(x, y, z), 0.03) });
    }

  const shape = { eyes: [], legs, beads };
  /** Distances to the parts (the head and what is on it, the abdomen, each leg) at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    let c = smin(head(qx, qy, qz), cheeks[0](qx, qy, qz), 0.08);
    c = smin(c, cheeks[1](qx, qy, qz), 0.08);
    o.core = c;
    o.palp = Math.min(palps[0](qx, qy, qz), palps[1](qx, qy, qz));
    let b = Infinity;
    for (const f of beadF) b = Math.min(b, f(qx, qy, qz));
    o.bead = b;
    o.head = smin(smin(c, o.palp, 0.022), b, 0.01);
    o.abd = abdomen(x, y, z);
    o.legD ??= new Array(legs.length);
    let m = Infinity;
    let mi = 0;
    for (let i = 0; i < legs.length; i++) {
      const d = legs[i].d(x, y, z);
      o.legD[i] = d;
      if (d < m) {
        m = d;
        mi = i;
      }
    }
    o.leg = m;
    o.legI = mi;
    return o;
  };
  const P = {};
  const union = () => smin(smin(P.head, P.abd, 0.07), P.leg, 0.045);
  /** The spider without eye sockets (for placing the eyes and for occlusion). */
  shape.solid = (x, y, z) => {
    shape.parts(x, y, z, P);
    return smax(union(), -y, 0.012);
  };
  shape.eyes = placeEyes(shape.solid, HEAD, { r: EYE_R, x: 0.158, y: 0.055, yaw: 0.03, open: 46 * DEG });
  shape.sdf = (x, y, z) => {
    shape.parts(x, y, z, P);
    return smax(carveSockets(union(), x, y, z, shape.eyes, EYE_R * R_SOCK), -y, 0.012);
  };
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const LEG_BONES = ['arm_L', 'leg_L1', 'leg_L2', 'leg_L3', 'arm_R', 'leg_R1', 'leg_R2', 'leg_R3'];
const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.2, 0]],
  ['head', 'body', HEAD.center],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['tail_1', 'body', [0, 0.7 + LIFT, -0.02]], // the abdomen, at its waist
  // the front legs hinge at the knee (the loader raises arms: they wave); the others at the hip
  ...LEG_BONES.map((n, k) => [n, 'body', legJoints(k % 4, k < 4 ? 1 : -1)[k % 4 === 0 ? 1 : 0]]),
];
const BI = boneIndex(BONES);

/** Skin weights of a shell point: the face on head, the abdomen on tail_1, each leg on its bone. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  const groups = [
    ['head', d.head, 0.03],
    ['abd', d.abd, 0.04],
  ];
  for (let i = 0; i < shape.legs.length; i++) if (d.legD[i] < d.leg + 0.2) groups.push([i, d.legD[i], 0.03]);
  for (const [name, v] of soft(groups)) {
    if (name === 'head') {
      // the front of the ball turns as the head (about the ball's centre, so nothing shears); the
      // skin round the eyes wholly, so the lids never poke out
      const qz = wf(x, y, z)[2];
      const eyeD = Math.min(len(sub(p, shape.eyes[0].E)), len(sub(p, shape.eyes[1].E)));
      const hv = Math.max(sstep(-0.08, 0.13, qz), sstep(EYE_R * 2.0, EYE_R * 1.4, eyeD));
      w.put('head', v * hv);
      w.put('body', v * (1 - hv));
    } else if (name === 'abd') w.put('tail_1', v);
    else {
      const leg = shape.legs[name];
      if (leg.i === 0) {
        // a front leg: the thigh on the body, the shin on its bone at the knee
        const k = sstep(leg.line.lens[1] * 0.6, leg.line.lens[1] * 1.08, leg.line.param(x, y, z));
        w.put(LEG_BONES[name], v * k);
        w.put('body', v * (1 - k));
      } else w.put(LEG_BONES[name], v);
    }
  }
  return w.done(BI);
}

/** Face shape keys on the shell: displacement fields in face-local space. */
function faceKeysOf(shape, f, p, n, headW, abdW) {
  const gauss = (q, c, s) => Math.exp(-((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2) / (2 * s * s));
  const mirror = (q, c, s) => gauss(q, c, s) + gauss(q, [-c[0], c[1]], s);
  const out = {};
  // puff: the abdomen fluffs up
  if (abdW > 0.02) out.puff = scl(n, 0.035 * abdW * sstep(0.02, -0.12, p[2]));
  if (headW < 0.01) return out;
  const q = wf(...p);
  const d = shape.parts(...p);
  const fr = sstep(0.05, 0.2, q[2]) * headW;
  const corner = mirror(q, [0.052, MOUTH_Y + 0.004], 0.03) * fr;
  const cheek = mirror(q, [0.22, -0.13], 0.075) * fr;
  const chin = gauss(q, [0, MOUTH_Y - 0.075], 0.05) * fr;
  // the pedipalps: more toward their tips
  const palp = sstep(0.02, 0.0, d.palp) * sstep(-0.2, -0.31, q[1]) * headW;
  const sx = Math.sign(q[0]);
  // slid along the surface, so the skin never covers the mouth's inside
  const slide = (dd) => (len(dd) < 1e-6 ? dd : sub(project(f, add(p, dd)), p));
  out.happy = add(add(slide(fdir(0, 0.02 * corner + 0.014 * cheek, 0)), scl(n, 0.007 * cheek)), fdir(0.022 * sx * palp, 0.022 * palp, 0.012 * palp));
  out.sad = add(slide(fdir(0, -0.016 * corner, 0)), fdir(-0.012 * sx * palp, -0.012 * palp, -0.012 * palp));
  out.surprised = add(slide(fdir(0, -0.008 * chin, 0)), fdir(0.03 * sx * palp, -0.006 * palp, 0));
  out.mouthOpen = add(slide(fdir(0, -0.024 * chin, 0)), fdir(0.03 * sx * palp, -0.016 * palp, 0));
  out.angry = add(slide(fdir(0, -0.012 * corner, 0)), fdir(-0.014 * sx * palp, 0.012 * palp, 0.022 * palp));
  out.puff = add(out.puff ?? [0, 0, 0], scl(n, 0.022 * cheek));
  out.tongue = slide(fdir(0, -0.008 * chin, 0));
  return out;
}

// ---------------------------------------------------------------------------- the painting

/** A heart in the plane (u across, v toward its lobes; about -1..1 each way), 1 inside. */
function heart(u, v) {
  const x = Math.abs(u) * 0.55;
  const y = v * 0.55 + 0.55;
  let d;
  if (x + y > 1) d = Math.hypot(x - 0.25, y - 0.75) - Math.SQRT2 / 4;
  else {
    const m = 0.5 * Math.max(x + y, 0);
    d = Math.sqrt(Math.min(x * x + (y - 1) ** 2, (x - m) ** 2 + (y - m) ** 2)) * Math.sign(x - y);
  }
  return sstep(0.035, -0.035, d);
}

/** The shell's paint at design-space point p: grey fuzzy fur (tinted) and the painted parts. */
function makeSkinPainter(shape) {
  const parts = {};
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const [qx, qy, qz] = wf(x, y, z);
    shape.parts(x, y, z, parts);
    const dm = Math.min(parts.head, parts.abd, parts.leg);
    const near = (d) => d - dm < 0.014;
    // fuzz: a fine speckle over soft blotches
    const grain = vnoise(x * 110, y * 110, z * 110);
    const fine = vnoise(x * 46 + 7, y * 46, z * 46);
    let fur = 0.8 + 0.08 * (fbm(x * 7 + 3, y * 7, z * 7) - 0.5) + 0.07 * (grain - 0.5) + 0.05 * (fine - 0.5);
    const wob = 0.3 * (fbm(x * 6, y * 6 + 9, z * 6) - 0.5);
    let s = 0; // darker bands
    let paint = 0; // untinted cream
    const cream = lerp3(COL.cream, scl(COL.cream, 0.9), 1 - (grain * 0.5 + fine * 0.5));
    const edge = 0.5 * (fbm(x * 28, y * 28, z * 28) - 0.5);
    if (near(parts.leg) && !near(parts.head) && !near(parts.abd)) {
      // banded legs, cream tips
      const leg = shape.legs[parts.legI];
      const t = leg.line.param(x, y, z);
      const total = leg.line.total;
      s = band(t * 6.2 + wob * 0.5 + 0.25, 0.3) * sstep(total - 0.08, total - 0.13, t);
      paint = sstep(total - 0.12, total - 0.085, t + 0.04 * edge);
    } else if (near(parts.abd) && !near(parts.head)) {
      // a cream heart on top, dark chevrons round it
      const u = (x - HEART[0]) / HEART[2];
      const v = -(z - HEART[1]) / HEART[2]; // its point toward the head: upright seen from the front
      const top = sstep(0.1, 0.4, n[1]);
      paint = heart(u + 0.05 * edge, v + 0.05 * edge) * top;
      const away = sstep(1.35, 1.75, Math.hypot(u, v * 0.9));
      s = band((z - ABD_C[2]) * 5.2 - 2.6 * Math.abs(x) + wob, 0.26) * away * sstep(-0.45, 0.05, n[1]);
    } else if (near(parts.head)) {
      // the cream muzzle round the mouth, between the fuzzy pedipalps
      const muzzle = Math.hypot(qx / 0.125, (qy - MOUTH_Y + 0.012) / 0.075);
      paint = sstep(1.05, 0.85, muzzle + 0.25 * edge) * sstep(0.1, 0.2, qz);
      // a darker cap over the back of the head, a stripe down between the eyes
      s = 0.8 * sstep(-0.02, -0.14, qz + wob * 0.2) * sstep(0.0, 0.2, qy);
    }
    let col = lerp3([fur, fur, fur], [fur * 0.62, fur * 0.62, fur * 0.64], s);
    if (n[1] < -0.2) col = lerp3(col, [0.9, 0.9, 0.9], 0.25 * sstep(-0.2, -0.7, n[1])); // undersides lighter
    let c = lerp3(col, cream, paint);
    if (near(parts.head)) {
      if (qz > 0.15) {
        // the smile: a little curve, its corners turned up
        const ax = Math.abs(qx);
        let dl = Math.abs(qy - (MOUTH_Y - 0.01 + 3.4 * qx * qx));
        if (ax > 0.052) dl = Math.hypot(ax - 0.052, dl);
        const k = sstep(0.0065, 0.0035, dl);
        c = lerp3(c, COL.line, k);
        paint = Math.max(paint, k);
      }
      // the bead eyes: glossy black with a catch-light, a soft dark ring
      for (const b of shape.beads) {
        const dd = Math.hypot(qx - b.c[0], qy - b.c[1], qz - b.c[2]);
        if (dd > b.r * 1.6) continue;
        const ring = sstep(b.r * 1.45, b.r * 1.15, dd);
        c = scl(c, 1 - 0.25 * ring);
        const k = sstep(b.r * 1.06, b.r * 0.98, dd);
        c = lerp3(c, COL.bead, k);
        const g = Math.hypot(qx - b.c[0] + 0.3 * b.r, qy - b.c[1] - 0.45 * b.r, qz - b.c[2] - 0.8 * b.r);
        c = lerp3(c, [1, 1, 1], k * sstep(b.r * 0.42, b.r * 0.26, g));
        paint = Math.max(paint, k);
      }
      for (const e of shape.eyes) {
        // the socket wall: a darker crease (the eyeliner is on the eyeball's edge)
        const k = sstep(EYE_R * R_SOCK + 0.004, EYE_R * R_SOCK - 0.002, len(sub(p, e.E)));
        if (k > 0) c = scl(c, 1 - 0.22 * k);
      }
    }
    write(o, scl(c, ao), 1 - paint);
  };
}

// ------------------------------------------------------------------------------- the build

/**
 * @param {{texture?: number, triangles?: number, grid?: number}} [o] texture size, target triangles
 *   for the fused shell, surface-nets grid spacing (design units)
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 6400, grid = 0.016 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  // the fused shell; the face, pedipalps and feet kept denser
  const shell = buildShell(f, {
    lo: [-0.84, -0.03, -0.76],
    hi: [0.84, 1.32, 0.76],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      let k = Math.hypot(qx / 0.36, (qy + 0.1) / 0.32) < 1 && qz > 0.1 ? 2.6 : 1;
      for (const e of shape.eyes) if (len(sub([x, y, z], e.E)) < EYE_R * 1.5) k = 3.4;
      if (y < 0.14) k = Math.max(k, 1.5);
      return k;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor);

  // the face parts
  const face = surfaceAt(f, HEAD);
  const headOnly = [[BI.head, 1]];
  const parts = [
    eyelids(shape.eyes, { lash: COL.ink }),
    mouthInside(face, HEAD, {
      y: MOUTH_Y,
      shapes: { mouthOpen: [-0.032, 0.05, 0.042, 0.6, 0.009], surprised: [-0.03, 0.026, 0.028, 1, 0.009], tongue: [-0.018, 0.024, 0.018, 0.6, 0.008] },
      rect: [0.09, 0.09],
    }),
    tongue(face, HEAD, { y: MOUTH_Y, length: 0.04, width: 0.026, below: 0.042 }),
  ];

  // UVs
  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  for (const part of parts) part.reserve(atlas);
  atlas.layout();

  // the Body
  const body = new MeshBuffer(ALL_KEYS);
  const shellTris = appendShell(body, shell, atlas, (i, p) => {
    const w = skinOf(shape, p);
    const share = (b) => w.reduce((s, [bone, v]) => s + (bone === b ? v : 0), 0);
    return { weights: w, keys: faceKeysOf(shape, f, p, shell.nor[i], share(BI.head), share(BI.tail_1)) };
  });
  const shellCount = body.count;
  for (const part of parts) part.build(body, atlas, headOnly);

  // the texture
  const canvas = createCanvas(N);
  paintShell(canvas, body, shellTris, makeSkinPainter(shape), {
    pos: (i) => body.P(i),
    nor: (i) => shell.nor[body.src[i]],
    ao: (i) => ao[body.src[i]],
  });
  for (const part of parts) part.paint(canvas, atlas);
  dilate(canvas, 6);

  // the eyeballs: big, dark and glossy (the iris fills the opening), two catch-lights
  const eyes = eyeballs(shape.eyes, {
    bones: { L: BI.eye_L, R: BI.eye_R },
    pupil: 30 * DEG,
    iris: 50 * DEG,
    irisColor: (t, lit) => [mix(0.3, 0.13, t) + 0.3 * lit * lit, mix(0.17, 0.07, t) + 0.17 * lit * lit, mix(0.12, 0.06, t) + 0.05 * lit],
    pupilColor: srgb(10, 9, 14),
    rimColor: srgb(24, 18, 22),
    white: srgb(30, 24, 28), // the whole ball dark: a spider's eye
    linerColor: srgb(30, 24, 30),
    rings: [0, 8, 16, 24, 28.5, 29.5, 31, 36, 42, 46, 48.5, 49.5, 51, 53, 58, 66, 80, 100, 125, 150, 180],
    na: 24,
    glints: [
      [25 * DEG, 0.6, 0.042],
      [31 * DEG, 0.6 + Math.PI, 0.018],
    ],
  });

  const bones = BONES.map(([n, parent, p]) => [n, parent, p ?? { eye_L: eyeL.E, eye_R: eyeR.E }[n]]);
  return assemble({
    name: 'spider',
    bones,
    body,
    eyes,
    map: toTexture(canvas, 'spider_basecolor'),
    fit: fitScale(body, shellCount),
    eyeRoughness: 0.08,
  });
}

export const buildSpider = build;

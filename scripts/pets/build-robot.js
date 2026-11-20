import * as THREE from 'three';
import {
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
  eyelids,
  fbm,
  fieldAO,
  fitScale,
  len,
  lerp3,
  mix,
  norm,
  paintRect,
  paintShell,
  placeEyes,
  project,
  roundBox,
  roundCone,
  scl,
  smax,
  smin,
  soft,
  sphere,
  srgb,
  sstep,
  sub,
  tiltFrame,
  toLinear,
  toTexture,
  vnoise,
  weights,
  write,
} from './lib/index.js';

/**
 * Dicer's clockwork robot pet (docs/reference/pet-model-spec.md), built with the pet library (lib/,
 * see README.md): a little wind-up robot. A boxy, round-edged brass body with rivets and a dark
 * chest window with two brass gears in it, a short ribbed steel neck under a big wide
 * round-cornered head tilted back so its face looks up at Dicer's top-down camera: two round glass
 * lens eyes in raised steel bezels (glowing pale-blue irises, brass shutter lids), a grille mouth,
 * steel ear bolts with brass caps and a little antenna with a red bulb. Stubby arms on brass
 * shoulder balls end in steel clamp hands; short legs on flat feet. The big steel wind-up key in its
 * back is a separate rigid `Extra` mesh on the body bone.
 *
 * Brass is tinted by Dicer (neutral grey, panel seams, screws and brushed streaks darker, gears,
 * rivets, shoulders and feet lighter); steel, glass, the grille, the chest window and the bulb
 * keep their colours. The irises and the bulb glow through an emissive map (shared by Body and
 * Eyes). Natural colour: brass #b08d57.
 *
 * Bones: root, body, neck, head, eye_L/R, arm_L/R, leg_L/R (the legs hang on root, so the feet stay
 * planted when the body leans). Shape keys: blink_L/R, happy, sad, surprised, mouthOpen, angry,
 * squint_L/R, puff.
 */

// ------------------------------------------------------------------------------- the design

const HEAD = tiltFrame([0, 0.85, 0.04], 0.8); // the head box's frame, its face tilted up
const { fdir, wf } = HEAD;
const HEAD_H = [0.59, 0.27, 0.25]; // the head box's half sizes (face-local)
const HEAD_R = 0.11;
const EYE_R = 0.14;
const EYE_X = 0.27;
const EYE_Y = 0.04;
const R_SOCK = 1.13;
const BEZEL_R = 0.168; // the steel ring round each lens (face-local, on the face plane)
const BEZEL_T = 0.028;
const MOUTH_Y = -0.165; // the grille's centre line, face-local
const GRILLE = [0.13, 0.036]; // its half width and half height
const BARS = [-0.075, -0.025, 0.025, 0.075];
const KEY_AT = [0, 0.42, -0.23]; // where the wind-up key enters the back
const NECK_Y = 0.64;
const ARM_OUT = 0.5; // the arms' rest angle out from the body (rad)
const KEYS = ['blink_L', 'blink_R', 'happy', 'sad', 'surprised', 'mouthOpen', 'angry', 'squint_L', 'squint_R', 'puff'];

const COL = {
  steel: srgb(190, 196, 205),
  steelDark: srgb(118, 124, 134),
  soot: srgb(34, 29, 27),
  bulb: srgb(255, 82, 64),
  bulbHot: srgb(255, 190, 170),
  glow: srgb(150, 225, 255),
};

/** A cylinder along x (face-local), centre (cx, cy, cz), radius r, half length h, edges rounded by k. */
function cylX(c, r, h, k) {
  return (x, y, z) => {
    const dx = Math.abs(x - c[0]) - h + k;
    const dr = Math.hypot(y - c[1], z - c[2]) - r + k;
    return Math.min(Math.max(dx, dr), 0) + Math.hypot(Math.max(dx, 0), Math.max(dr, 0)) - k;
  };
}
/** A cylinder along z, centre c, radius r, half length h, edges rounded by k. */
function cylZ(c, r, h, k) {
  return (x, y, z) => {
    const dz = Math.abs(z - c[2]) - h + k;
    const dr = Math.hypot(x - c[0], y - c[1]) - r + k;
    return Math.min(Math.max(dz, dr), 0) + Math.hypot(Math.max(dz, 0), Math.max(dr, 0)) - k;
  };
}
/** A gear facing +z: radius R at the tooth tips, n teeth, from z0 to z1. */
function gear(cx, cy, R, n, z0, z1) {
  const zc = (z0 + z1) / 2;
  const hz = (z1 - z0) / 2;
  return (x, y, z) => {
    const a = Math.atan2(y - cy, x - cx);
    const tooth = sstep(-0.25, 0.25, Math.cos(n * a));
    const d2 = Math.hypot(x - cx, y - cy) - R * (0.8 + 0.2 * tooth);
    const dz = Math.abs(z - zc) - hz;
    return Math.min(Math.max(d2 * 0.8, dz), 0) + Math.hypot(Math.max(d2 * 0.8, 0), Math.max(dz, 0));
  };
}
const GEARS = [
  [0.065, 0.375, 0.085, 8],
  [-0.09, 0.45, 0.058, 6],
];

/** An arm's frame: its shoulder S, down-the-arm a and across p (in the arm's swing plane). */
function armFrame(side) {
  const S = [0.35 * side, 0.53, 0];
  const a = [Math.sin(ARM_OUT) * side, -Math.cos(ARM_OUT), 0];
  const p = [Math.cos(ARM_OUT), Math.sin(ARM_OUT) * side, 0];
  return { S, a, p, at: (t, u = 0) => add(add(S, scl(a, t)), scl(p, u)) };
}

function makeShape() {
  // the head (face-local): a round-edged box, ear bolts, the grille recess and bars
  const skull = roundBox([0, 0, 0], HEAD_H, HEAD_R);
  const bolts = [1, -1].map((s) => cylX([0.605 * s, 0, -0.02], 0.1, 0.028, 0.01));
  const caps = [1, -1].map((s) => cylX([0.64 * s, 0, -0.02], 0.045, 0.022, 0.008));
  const slot = roundBox([0, MOUTH_Y, HEAD_H[2] + 0.004], [GRILLE[0], GRILLE[1], 0.016], 0.012);
  const bars = BARS.map((bx) => roundBox([bx, MOUTH_Y, HEAD_H[2] - 0.004], [0.008, GRILLE[1] - 0.004, 0.012], 0.004));
  const bezelAt = (s) => (qx, qy, qz) => Math.hypot(Math.hypot(qx - EYE_X * s, qy - EYE_Y) - BEZEL_R, qz - HEAD_H[2] + 0.01) - BEZEL_T;
  const bezels = [bezelAt(1), bezelAt(-1)];
  // the antenna (model space): a stalk off the head's top and a bulb
  const antB = HEAD.fw(0, 0.22, -0.07);
  const antDir = norm([0, 1, -0.12]);
  const antT = add(antB, scl(antDir, 0.2));
  const stalk = roundCone(antB, antT, 0.026, 0.021);
  const bulbC = add(antT, scl(antDir, 0.03));
  const bulb = sphere(bulbC, 0.047);
  // the body: a round-edged box, the chest window with its gears, rivets, the key's collar
  const torso = roundBox([0, 0.39, 0], [0.32, 0.21, 0.23], 0.09);
  const windowBox = roundBox([0, 0.4, 0.245], [0.18, 0.12, 0.035], 0.02);
  const gears = GEARS.map(([cx, cy, R, n]) => gear(cx, cy, R, n, 0.2, 0.236));
  const hubs = GEARS.map(([cx, cy, R]) => sphere([cx, cy, 0.232], R * 0.3));
  const RIVETS = [];
  for (const sx of [1, -1]) RIVETS.push([0.27 * sx, 0.575, 0.17], [0.27 * sx, 0.575, -0.17], [0.27 * sx, 0.22, 0.226], [0.27 * sx, 0.22, -0.226]);
  const rivets = RIVETS.map((c) => sphere(c, 0.024));
  const collar = cylZ([KEY_AT[0], KEY_AT[1], KEY_AT[2] - 0.015], 0.06, 0.025, 0.01);
  const neck = roundCone([0, 0.54, 0], [0, 0.74, 0.02], 0.082, 0.076);
  // arms: a shoulder ball, a stubby arm, a wrist and two clamp prongs
  const arms = [1, -1].map((side) => {
    const A = armFrame(side);
    const sh = sphere(A.S, 0.078);
    const arm = roundCone(A.at(0.02), A.at(0.2), 0.05, 0.047);
    const wrist = roundCone(A.at(0.2), A.at(0.245), 0.057, 0.057);
    const prongs = [1, -1].map((u) => {
      const a = roundCone(A.at(0.245, 0.04 * u), A.at(0.305, 0.044 * u), 0.018, 0.016);
      const b = roundCone(A.at(0.305, 0.044 * u), A.at(0.335, 0.02 * u), 0.016, 0.013);
      return (x, y, z) => smin(a(x, y, z), b(x, y, z), 0.01);
    });
    return { A, sh, arm, wrist, prongs };
  });
  // legs on flat feet
  const legs = [1, -1].map((s) => roundCone([0.16 * s, 0.06, 0], [0.16 * s, 0.24, 0], 0.052, 0.05));
  const feet = [1, -1].map((s) => roundBox([0.17 * s, 0.036, 0.05], [0.095, 0.036, 0.14], 0.03));

  const shape = { arms, antB, antT, bulbC, RIVETS, eyes: [] };

  /** Distances to the parts at (x, y, z); `o.bezel` the bezels', `o.lens` false (set below). */
  shape.parts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    let h = skull(qx, qy, qz);
    h = smin(h, Math.min(bolts[0](qx, qy, qz), bolts[1](qx, qy, qz)), 0.02);
    h = smin(h, Math.min(caps[0](qx, qy, qz), caps[1](qx, qy, qz)), 0.006);
    h = smax(h, -slot(qx, qy, qz), 0.006);
    let bd = Infinity;
    for (const b of bars) bd = Math.min(bd, b(qx, qy, qz));
    o.bars = bd;
    h = smin(h, bd, 0.004);
    o.plainHead = h;
    o.bezel = Math.min(bezels[0](qx, qy, qz), bezels[1](qx, qy, qz));
    o.head = smin(h, o.bezel, 0.012);
    o.ant = smin(stalk(x, y, z), bulb(x, y, z), 0.02);
    o.bulb = bulb(x, y, z);
    let t = smax(torso(x, y, z), -windowBox(x, y, z), 0.01);
    let g = Infinity;
    for (let i = 0; i < gears.length; i++) g = Math.min(g, smin(gears[i](x, y, z), hubs[i](x, y, z), 0.006));
    o.gear = g;
    t = Math.min(t, g);
    let rv = Infinity;
    for (const r of rivets) rv = Math.min(rv, r(x, y, z));
    o.rivet = rv;
    t = smin(t, rv, 0.008);
    o.collar = collar(x, y, z);
    o.torso = smin(t, o.collar, 0.01);
    o.neck = neck(x, y, z);
    for (const [i, k] of [
      [0, 'armL'],
      [1, 'armR'],
    ]) {
      const a = arms[i];
      const sh = a.sh(x, y, z);
      let d = smin(sh, a.arm(x, y, z), 0.02);
      d = smin(d, a.wrist(x, y, z), 0.012);
      d = smin(d, Math.min(a.prongs[0](x, y, z), a.prongs[1](x, y, z)), 0.012);
      o[k] = d;
      o[`${k}Sh`] = sh;
    }
    o.legL = smin(legs[0](x, y, z), feet[0](x, y, z), 0.02);
    o.legR = smin(legs[1](x, y, z), feet[1](x, y, z), 0.02);
    o.footL = feet[0](x, y, z);
    o.footR = feet[1](x, y, z);
    return o;
  };
  const P = {};
  const fuse = (x, y, z, bezel) => {
    shape.parts(x, y, z, P);
    let d = smin(bezel ? P.head : P.plainHead, P.ant, 0.03);
    d = smin(d, P.neck, 0.03);
    d = smin(d, P.torso, 0.03);
    d = smin(d, P.armL, 0.025);
    d = smin(d, P.armR, 0.025);
    d = smin(d, P.legL, 0.03);
    d = smin(d, P.legR, 0.03);
    return d;
  };
  // the eyes are placed on the face without the bezels, which then rise round them
  shape.eyes = placeEyes((x, y, z) => smax(fuse(x, y, z, false), -y, 0.02), HEAD, { r: EYE_R, x: EYE_X, y: EYE_Y, yaw: 0, open: 54 * DEG, range: [0.0, 0.3] });
  /** The robot without eye sockets (for occlusion). */
  shape.solid = (x, y, z) => smax(fuse(x, y, z, true), -y, 0.02);
  shape.sdf = (x, y, z) => smax(carveSockets(fuse(x, y, z, true), x, y, z, shape.eyes, EYE_R * R_SOCK), -y, 0.02);
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.3, 0]],
  ['neck', 'body', [0, 0.58, 0]],
  ['head', 'neck', [0, NECK_Y + 0.06, 0.02]],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['arm_L', 'body', [0.35, 0.53, 0]],
  ['arm_R', 'body', [-0.35, 0.53, 0]],
  ['leg_L', 'root', [0.16, 0.24, 0]], // on root: the feet stay planted when the body leans
  ['leg_R', 'root', [-0.16, 0.24, 0]],
];
const BI = boneIndex(BONES);

/** Skin weights of a shell point: head (and antenna), neck, body (its seat on root), arms, legs. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  for (const [name, v] of soft([
    ['head', Math.min(d.head, d.ant), 0.03],
    ['neck', d.neck, 0.025],
    ['torso', d.torso, 0.03],
    ['armL', d.armL, 0.025],
    ['armR', d.armR, 0.025],
    ['legL', d.legL, 0.025],
    ['legR', d.legR, 0.025],
  ])) {
    if (name === 'head') w.put('head', v);
    else if (name === 'neck') {
      const up = sstep(NECK_Y - 0.03, NECK_Y + 0.07, y);
      w.put('neck', v * (1 - up));
      w.put('head', v * up);
    } else if (name === 'torso') {
      const rootK = sstep(0.24, 0.14, y); // the bottom stays planted when the body leans
      w.put('root', v * rootK);
      w.put('body', v * (1 - rootK));
    } else if (name === 'legL' || name === 'legR') w.put(name === 'legL' ? 'leg_L' : 'leg_R', v);
    else w.put(name === 'armL' ? 'arm_L' : 'arm_R', v);
  }
  return w.done(BI);
}

/** Face shape keys on the shell: the grille bends and stretches (face-local displacements). */
function faceKeysOf(f, p, n, headW) {
  const q = wf(...p);
  const out = {};
  if (headW < 0.02) {
    // the chest puffs out (proud, huffy)
    const g = sstep(0.12, 0.2, p[2]) * sstep(0.2, 0.32, p[1]) * sstep(0.62, 0.5, p[1]) * sstep(0.36, 0.2, Math.abs(p[0])) * (1 - headW);
    if (g > 0.01) out.puff = scl(n, 0.035 * g);
    return out;
  }
  const fr = sstep(0.1, 0.2, q[2]) * headW;
  const across = sstep(GRILLE[0] + 0.06, GRILLE[0] - 0.01, Math.abs(q[0])) * fr;
  if (across < 1e-3) return out;
  const corner = sstep(0.0, GRILLE[0], Math.abs(q[0])); // 0 at the middle .. 1 at the ends
  const near = Math.exp(-(((q[1] - MOUTH_Y) / 0.07) ** 2)) * across; // the grille's band
  const below = sstep(MOUTH_Y + 0.01, MOUTH_Y - 0.03, q[1]) * sstep(-0.33, -0.22, q[1]) * across; // its lower lip and under
  const above = sstep(MOUTH_Y - 0.01, MOUTH_Y + 0.03, q[1]) * sstep(MOUTH_Y + 0.12, MOUTH_Y + 0.05, q[1]) * across;
  // slid along the surface, so the skin stays on the face
  const slide = (dd) => (len(dd) < 1e-6 ? dd : sub(project(f, add(p, dd)), p));
  out.happy = slide(fdir(0, 0.03 * near * corner * corner - 0.006 * near * (1 - corner), 0));
  out.sad = slide(fdir(0, -0.026 * near * corner * corner, 0));
  out.surprised = slide(fdir(0, -0.024 * below + 0.01 * above, 0));
  out.mouthOpen = slide(fdir(0, -0.042 * below + 0.012 * above, 0));
  out.angry = slide(fdir(-Math.sign(q[0]) * 0.02 * near * corner, -0.014 * near * corner, 0));
  return out;
}

// ---------------------------------------------------------------------------- the painting

/**
 * The shell's look at design-space point p: { c (sRGB), a (tint mask), g (emissive sRGB) }.
 * Brass: light grey, faintly brushed, darker panel seams and screws; steel and the dark parts
 * untinted.
 */
function makeShade(shape) {
  const P = {};
  const [eyeL, eyeR] = shape.eyes;
  const steel = (x, y, z, k = 1) => {
    const s = 0.92 + 0.08 * (vnoise(x * 6, y * 70, z * 6) - 0.5) + 0.05 * (fbm(x * 9, y * 9, z * 9) - 0.5);
    return scl(k === 1 ? COL.steel : COL.steelDark, s);
  };
  return (p, n, ao) => {
    const [x, y, z] = p;
    shape.parts(x, y, z, P);
    const cand = [
      ['head', P.head],
      ['ant', P.ant],
      ['neck', P.neck],
      ['torso', P.torso],
      ['armL', P.armL],
      ['armR', P.armR],
      ['legL', P.legL],
      ['legR', P.legR],
    ];
    let near = 'torso';
    let dm = Infinity;
    for (const [k, d] of cand)
      if (d < dm) {
        dm = d;
        near = k;
      }
    // brushed brass (tinted grey)
    const brush = vnoise(x * 5, y * 90, z * 5);
    let g = 0.8 + 0.05 * (fbm(x * 4 + 3, y * 4, z * 4) - 0.5) + 0.04 * (brush - 0.5) + 0.02 * (vnoise(x * 120, y * 120, z * 120) - 0.5);
    let c = [g, g, g];
    let a = 1;
    let glow = [0, 0, 0];
    const dark = (k) => {
      c = scl(c, 1 - k);
    };
    const paintOver = (col, k) => {
      c = lerp3(c, col, k);
      a = Math.min(a, 1 - k);
    };

    if (near === 'head') {
      const [qx, qy, qz] = wf(x, y, z);
      if (Math.abs(qx) > HEAD_H[0] - 0.012 && Math.hypot(qy, qz + 0.02) < 0.106) {
        // the ear bolts: steel discs, brass caps (tinted, lighter), a dark ring between
        const r = Math.hypot(qy, qz + 0.02);
        if (r < 0.05 && Math.abs(qx) > 0.62) {
          g = 0.95;
          c = [g, g, g];
          dark(0.35 * sstep(0.03, 0.045, r));
        } else {
          paintOver(steel(x, y, z), 1);
          dark(0.3 * sstep(0.004, 0.0, Math.abs(r - 0.075)));
        }
      } else if (P.bezel < 0.01 && P.bezel <= P.plainHead + 0.006) {
        // the lens bezels: bright steel with a dark inner lip
        paintOver(steel(x, y, z), 1);
        for (const e of [eyeL, eyeR]) {
          const k = sstep(EYE_R * R_SOCK + 0.012, EYE_R * R_SOCK + 0.002, len(sub(p, e.E)));
          if (k > 0) c = scl(c, 1 - 0.55 * k);
        }
      } else {
        // the face panel's seam, screws on the crown
        const sx = Math.abs(qx) - 0.5;
        const sy = Math.abs(qy) - 0.19;
        const seam = Math.max(sx, sy);
        if (qz > 0.18 && seam > -0.08) dark(0.38 * sstep(0.006, 0.002, Math.abs(Math.hypot(Math.max(sx + 0.05, 0), Math.max(sy + 0.05, 0)) - 0.05)));
        if (qz < 0.24 && qy > 0.1) {
          for (const [cx, cz] of [
            [0.42, 0.1],
            [-0.42, 0.1],
            [0.42, -0.14],
            [-0.42, -0.14],
          ]) {
            const r = Math.hypot(qx - cx, qz - cz);
            if (r < 0.024) {
              dark(0.3 * sstep(0.024, 0.016, r));
              if (r < 0.014 && Math.abs(qx - cx - (qz - cz)) < 0.003) dark(0.5); // the screw slot
            }
          }
        }
        // the grille: a dark slot with steel bars
        if (qz > 0.12 && Math.abs(qy - MOUTH_Y) < GRILLE[1] + 0.012 && Math.abs(qx) < GRILLE[0] + 0.012) {
          const ex = Math.abs(qx) - GRILLE[0] + 0.012;
          const ey = Math.abs(qy - MOUTH_Y) - GRILLE[1] + 0.012;
          const inside = Math.hypot(Math.max(ex, 0), Math.max(ey, 0)) + Math.min(Math.max(ex, ey), 0) - 0.012;
          const k = sstep(0.003, -0.003, inside);
          if (k > 0) {
            let col = COL.soot;
            if (P.bars < 0.004) col = lerp3(steel(x, y, z), COL.steelDark, sstep(0.0, 0.004, P.bars));
            paintOver(col, k);
          }
          dark(0.35 * sstep(0.008, 0.0, Math.abs(inside)) * (1 - k));
        }
      }
      for (const e of [eyeL, eyeR]) {
        // the socket wall inside the bezel: dark
        const k = sstep(EYE_R * R_SOCK + 0.004, EYE_R * R_SOCK - 0.004, len(sub(p, e.E)));
        if (k > 0) paintOver(COL.soot, k);
      }
    } else if (near === 'ant') {
      if (P.bulb < 0.004) {
        const lit = sstep(-0.2, 0.9, dot3(n, norm([0.3, 1, 0.4])));
        paintOver(lerp3(COL.bulb, COL.bulbHot, 0.5 * lit), 1);
        glow = scl(COL.bulb, 0.45);
      } else paintOver(steel(x, y, z), 1);
    } else if (near === 'neck') {
      // ribbed steel
      paintOver(steel(x, y, z, 2), 1);
      c = scl(c, 1 - 0.3 * sstep(0.3, 0.5, Math.abs(Math.sin(y * 70))));
    } else if (near === 'torso') {
      if (P.gear < 0.004) {
        // the gears: lighter brass (tinted), teeth edges darker
        g = 0.96 + 0.03 * (brush - 0.5);
        c = [g, g, g];
        if (n[2] < 0.6) dark(0.25);
      } else if (z > 0.18 && Math.abs(x) < 0.185 && Math.abs(y - 0.4) < 0.125) {
        paintOver(COL.soot, sstep(0.18, 0.165, Math.abs(x)) * sstep(0.125, 0.11, Math.abs(y - 0.4)));
      } else if (P.rivet < 0.006) {
        g = 0.97;
        c = [g, g, g];
      } else if (P.collar < 0.006) {
        g = 0.92;
        c = [g, g, g];
        dark(0.3 * sstep(0.004, 0.0, Math.abs(Math.hypot(x - KEY_AT[0], y - KEY_AT[1]) - 0.04)));
      } else {
        // seams: a band round the waist, the back hatch round the key with four screws
        dark(0.3 * sstep(0.006, 0.002, Math.abs(y - 0.27)) * (Math.abs(n[1]) < 0.7 ? 1 : 0));
        if (z < -0.18) {
          const sx = Math.abs(x) - 0.2;
          const sy = Math.abs(y - 0.43) - 0.11;
          dark(0.35 * sstep(0.006, 0.002, Math.abs(Math.hypot(Math.max(sx + 0.03, 0), Math.max(sy + 0.03, 0)) + Math.min(Math.max(sx + 0.03, sy + 0.03), 0) - 0.03)));
          for (const [cx, cy] of [
            [0.16, 0.51],
            [-0.16, 0.51],
            [0.16, 0.35],
            [-0.16, 0.35],
          ])
            dark(0.35 * sstep(0.016, 0.01, Math.hypot(x - cx, y - cy)));
        }
        if (y > 0.57 && Math.abs(n[1]) > 0.7) {
          // the top: a round hatch behind the neck
          dark(0.3 * sstep(0.005, 0.0, Math.abs(Math.hypot(x, z + 0.12) - 0.08)));
        }
      }
    } else if (near === 'armL' || near === 'armR') {
      const A = shape.arms[near === 'armL' ? 0 : 1].A;
      const t = (x - A.S[0]) * A.a[0] + (y - A.S[1]) * A.a[1] + (z - A.S[2]) * A.a[2];
      if (t > 0.21) paintOver(steel(x, y, z, t < 0.25 ? 2 : 1), 1);
      else if ((near === 'armL' ? P.armLSh : P.armRSh) < 0.006) {
        g = 0.95 + 0.03 * (brush - 0.5);
        c = [g, g, g];
      } else dark(0.25 * sstep(0.006, 0.002, Math.abs(t - 0.1)));
    } else {
      // legs and feet: the feet lighter, a dark sole edge
      const foot = near === 'legL' ? P.footL : P.footR;
      if (foot < 0.006 && y < 0.08) {
        g = 0.9 + 0.03 * (brush - 0.5);
        c = [g, g, g];
        dark(0.4 * sstep(0.016, 0.006, y));
      } else dark(0.3 * sstep(0.005, 0.0, Math.abs(y - 0.16)));
    }
    return { c: scl(c, ao), a, g: glow };
  };
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ---------------------------------------------------------------------------- the lenses

const PUPIL = 9 * DEG; // the dark core
const IRIS = 34 * DEG; // the glowing iris
const RING = 37 * DEG; // a darker ring round it, then dark glass

/**
 * The `Eyes` mesh: one sphere per eye, poles on its forward axis, rings at the colour edges,
 * wholly on its bone, with UVs into the shared atlas (an emissive strip, u = polar angle / pi)
 * so the iris glows; two glints. A `surprised` key shrinks the iris.
 */
function lensEyes(eyes, atlas, rect, { bones }) {
  const b = new MeshBuffer(['surprised']);
  const ringDeg = [0, 4, 8, 9, 10, 16, 22, 28, 33, 34, 35.5, 37, 38.5, 44, 52, 62, 80, 100, 135, 180];
  const rings = ringDeg.map((d) => d * DEG);
  const na = 30;
  const shrink = (pol) => (pol <= RING ? pol * 0.72 : pol <= RING + 8 * DEG ? mix(RING * 0.72, RING + 8 * DEG, (pol - RING) / (8 * DEG)) : pol);
  const colorAt = (pol, lit) => {
    if (pol < PUPIL - 0.5 * DEG) return srgb(36, 84, 112);
    if (pol < IRIS - 0.5 * DEG) {
      const t = (pol - PUPIL) / (IRIS - PUPIL);
      return lerp3(srgb(232, 252, 255), srgb(120, 210, 250), sstep(0.2, 1, t)).map((v) => Math.min(1, v * (0.94 + 0.06 * lit)));
    }
    if (pol < RING) return srgb(52, 112, 150);
    // dark glass, a little lighter toward the bezel (a reflection)
    return lerp3(srgb(18, 28, 42), srgb(44, 60, 80), sstep(42 * DEG, 54 * DEG, pol) * lit);
  };
  for (const eye of eyes) {
    const R = eye.r;
    const wts = [[eye.side > 0 ? bones.L : bones.R, 1]];
    const base = b.count;
    const at = (pol, az) => add(scl(eye.F, Math.cos(pol)), add(scl(eye.X, Math.sin(pol) * Math.cos(az)), scl(eye.U, Math.sin(pol) * Math.sin(az))));
    for (let ri = 0; ri < rings.length; ri++)
      for (let a = 0; a < na; a++) {
        const pol = rings[ri];
        const az = (a / na) * Math.PI * 2;
        const nn = at(pol, az);
        const c = colorAt(pol, 0.5 - 0.5 * Math.sin(az) * Math.sin(pol));
        const uv = atlas.rectUV(rect, clamp(pol / Math.PI, 0.002, 0.998), 0.5);
        b.addVertex(add(eye.E, scl(nn, R)), nn, uv, wts, { surprised: scl(sub(at(shrink(pol), az), nn), R) }, toLinear(c));
      }
    for (let ri = 0; ri + 1 < rings.length; ri++)
      for (let a = 0; a < na; a++) {
        const i0 = base + ri * na + a;
        const i1 = base + ri * na + ((a + 1) % na);
        const j0 = i0 + na;
        const j1 = i1 + na;
        if (ri === 0) b.idx.push(i0, j0, j1);
        else b.idx.push(i0, j0, j1, i0, j1, i1);
      }
    for (const [pol, az, rad] of [
      [24 * DEG, 0.7, 0.024],
      [30 * DEG, 0.7 + Math.PI, 0.011],
    ]) {
      const n0 = at(pol, az);
      const c0 = add(eye.E, scl(n0, R + 0.002));
      const gb = b.count;
      const t1 = norm(cross(n0, [0, 1, 0]));
      const t2 = cross(t1, n0);
      const sg = 10;
      const white = [1.6, 1.6, 1.6];
      const uv = atlas.rectUV(rect, 0.999, 0.5);
      b.addVertex(add(c0, scl(n0, 0.004)), n0, uv, wts, {}, white);
      for (let s = 0; s < sg; s++) {
        const a = (s / sg) * Math.PI * 2;
        const pp = add(c0, add(scl(t1, Math.cos(a) * rad), scl(t2, Math.sin(a) * rad * 0.85)));
        b.addVertex(add(eye.E, scl(norm(sub(pp, eye.E)), R + 0.0015)), n0, uv, wts, {}, white);
      }
      for (let s = 0; s < sg; s++) b.idx.push(gb, gb + 1 + ((s + 1) % sg), gb + 1 + s);
    }
  }
  return b;
}

/** The lenses' emissive strip (u = polar angle / pi): a bright iris, a dim core, dark glass. */
function paintLensGlow(glowCanvas, canvas, atlas, rect) {
  paintRect(glowCanvas, atlas, rect, (u, v, out) => {
    const pol = u * Math.PI;
    let c;
    if (u > 0.99) c = [1, 1, 1];
    else if (pol < PUPIL) c = scl(COL.glow, 0.3);
    else if (pol < IRIS) c = lerp3(srgb(225, 250, 255), srgb(90, 190, 240), sstep(0.3, 1, (pol - PUPIL) / (IRIS - PUPIL)));
    else if (pol < RING) c = scl(COL.glow, 0.25);
    else c = [0, 0, 0];
    write(out, c, 1);
  });
  paintRect(canvas, atlas, rect, (u, v, out) => write(out, [0.6, 0.85, 1], 0)); // unused base colour
}

// ---------------------------------------------------------------------------- the wind-up key

/**
 * The wind-up key (the `Extra` mesh): a steel shaft out of the back and a two-lobed bow lying
 * flat (seen whole from above), rigid on the body bone. Built from three's shapes, untextured.
 */
function windKey(bone) {
  const parts = [new THREE.CylinderGeometry(0.024, 0.024, 0.26, 8, 1).rotateX(Math.PI / 2).translate(0, 0, -0.13)];
  for (const sx of [1, -1]) {
    const t = new THREE.TorusGeometry(0.08, 0.027, 6, 16);
    t.rotateX(Math.PI / 2);
    t.scale(1.15, 1, 0.85);
    t.translate(sx * 0.1, 0, -0.29);
    parts.push(t);
  }
  parts.push(new THREE.BoxGeometry(0.07, 0.05, 0.07).translate(0, 0, -0.27));
  const b = new MeshBuffer([]);
  for (const g0 of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const base = b.count;
    for (let i = 0; i < pos.count; i++)
      b.addVertex(add(KEY_AT, [pos.getX(i), pos.getY(i), pos.getZ(i) - 0.02]), [nor.getX(i), nor.getY(i), nor.getZ(i)], null, [[bone, 1]]);
    for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
    g.dispose();
    g0.dispose();
  }
  return b;
}

// ------------------------------------------------------------------------------- the build

/**
 * @param {{texture?: number, triangles?: number, grid?: number}} [o] texture size, target triangles
 *   for the fused shell, surface-nets grid spacing (design units)
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body, Eyes and Extra
 *   (the wind-up key) skinned meshes
 */
export function build({ texture: N = 1024, triangles = 6200, grid = 0.016 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  const shell = buildShell(f, {
    lo: [-0.74, -0.04, -0.4],
    hi: [0.74, 1.4, 0.56],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      let k = qz > 0.15 && Math.abs(qx) < 0.5 && Math.abs(qy) < 0.26 ? 2.4 : 1;
      if (y > 1.1 && Math.abs(x) < 0.1) k = Math.max(k, 2.5); // the antenna
      if (z > 0.18 && y < 0.56 && y > 0.26 && Math.abs(x) < 0.2) k = Math.max(k, 2); // the gears
      return k;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor, { min: 0.74 });

  // the shutter lids
  const lids = eyelids(shape.eyes, {
    rUp: 1.1,
    rLo: 1.065,
    meet: -4 * DEG,
    motions: {
      blink: [{ close: 1 }, { close: 1 }],
      squint: [{ close: 0.5 }, { close: 0.34 }],
      happy: [2, 24],
      sad: [{ deg: 22, roll: -0.55 }, 0],
      angry: [{ deg: 32, roll: 0.8 }, 6],
      surprised: [-6, -6],
    },
  });

  // UVs
  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  lids.reserve(atlas);
  const eyeRect = atlas.addRect(0.16, 0.02);
  atlas.layout();

  // the Body
  const body = new MeshBuffer(KEYS);
  const shellTris = appendShell(body, shell, atlas, (i, p) => {
    const w = skinOf(shape, p);
    const hw = w.reduce((s, [b, v]) => s + (b === BI.head ? v : 0), 0);
    return { weights: w, keys: faceKeysOf(f, p, shell.nor[i], hw) };
  });
  const shellCount = body.count;
  lids.build(body, atlas, [[BI.head, 1]]);

  // the textures: base colour (+ tint mask) and emissive, painted from the same shading
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
  for (const { upper, rect } of lids.lids)
    paintRect(canvas, atlas, rect, (u, v, out) => {
      // brass shutters (tinted), a darker leading edge and a seam line
      let g = 0.82 + 0.04 * (vnoise(u * 9, v * 40, upper ? 1 : 7) - 0.5);
      g *= mix(0.6, 1, sstep(0.02, 0.1, v));
      if (Math.abs(v - 0.35) < 0.02) g *= 0.8;
      write(out, [g, g, g], 1);
    });
  paintLensGlow(glowCanvas, canvas, atlas, eyeRect);
  dilate(canvas, 6);
  dilate(glowCanvas, 6);
  for (let i = 3; i < glowCanvas.data.length; i += 4) glowCanvas.data[i] = 255;

  const eyes = lensEyes(shape.eyes, atlas, eyeRect, { bones: { L: BI.eye_L, R: BI.eye_R } });
  const bones = BONES.map(([n, parent, p]) => [n, parent, p ?? { eye_L: eyeL.E, eye_R: eyeR.E }[n]]);
  const keyMat = new THREE.MeshStandardMaterial({ name: 'robot_key', color: 0xc6cbd2, metalness: 0.6, roughness: 0.32 });
  const scene = assemble({
    name: 'robot',
    bones,
    body,
    eyes,
    map: toTexture(canvas, 'robot_basecolor'),
    fit: fitScale(body, shellCount),
    roughness: 0.45,
    eyeRoughness: 0.12,
    extra: { buf: windKey(BI.body), material: keyMat },
  });
  const bodyMat = scene.getObjectByName('Body').material;
  bodyMat.metalness = 0.3;
  // the glow: one emissive map shared by the bulb (Body) and the lenses
  const emissive = toTexture(glowCanvas, 'robot_emissive');
  for (const name of ['Body', 'Eyes']) {
    const m = scene.getObjectByName(name).material;
    m.emissiveMap = emissive;
    m.emissive.setRGB(1, 1, 1);
    m.emissiveIntensity = 1;
  }
  return scene;
}

export const buildRobot = build;

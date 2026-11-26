import {
  DEG,
  MeshBuffer,
  REQUIRED_KEYS,
  add,
  appendShell,
  assemble,
  boneIndex,
  buildShell,
  carveSockets,
  chain,
  clamp,
  coneChain,
  createAtlas,
  createCanvas,
  cross,
  dilate,
  dot,
  ellipsoid,
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
  polyline,
  roundBox,
  roundCone,
  scl,
  smax,
  smin,
  soft,
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
 * Dicer's skull pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a floating skull familiar, a cartoon necromancer's sidekick. A big round cranium with
 * a couple of cracks and faint sutures, its face tilted up toward Dicer's top-down camera: deep
 * eye sockets holding glowing orbs (a small dark pupil in a bright core and a soft halo, on a dark
 * eyeball that reads as the hollow of the socket), a little upside-down-heart nose hole, cheekbones,
 * a short muzzle with a row of chunky upper teeth, and a separate chunky lower jaw (its own closed
 * shell, hung under the cheekbones) with its own teeth. Where a neck would be, a wisp of spectral
 * flame trails down and back to the floor, with two smaller licks.
 *
 * The bone is painted (ivory, untinted). Dicer's colour tints the flame, the orbs' glow and the
 * glow on the socket walls (neutral greys, tint mask 255). The orbs and, faintly, the flame and the
 * socket walls also glow through an emissive map (neutral, so the glow keeps the player's hue),
 * shared by Body and Eyes; Eyes also uses the base map (white there) for its tint mask, under its
 * vertex colours. Natural colour: ghostly green #6fd08c.
 *
 * Bones: root, body (the skull's base: a lean nods the skull on the flame), head, eye_L/R, jaw (the
 * hinge; the jaw's shell is rigid on it), tail_1..3 (down the flame; they hang on root, so the flame
 * stays put under a leaning skull). Shape keys: blink_L/R, happy, sad, surprised, mouthOpen (the
 * jaw swings open about its hinge), angry, squint_L/R, puff (the flame flares). The eyelids are
 * bony brow ridges hidden in the sockets.
 */

// ------------------------------------------------------------------------------- the design

const KEYS = [...REQUIRED_KEYS, 'squint_L', 'squint_R', 'puff'];
const TILT = 0.54; // the face tilted up toward the top-down camera
const HEAD = tiltFrame([0, 0.88, -0.01], TILT);
const { fdir, fw, wf } = HEAD;

// Face-local (x, y up the face, z out of it).
const CR_C = [0, 0.08, -0.06]; // the cranium
const CR_R = [0.47, 0.42, 0.48];
const EYE_R = 0.15;
const EYE_X = 0.205;
const EYE_Y = 0.035;
const R_SOCK = 1.13;
const NOSE = [0, -0.165, 0.35];
const ARCH = { A: 0.195, B: 0.29, zc: 0.03 }; // the dental arch (an ellipse in x, z)
const TOOTH_PITCH = 0.35; // rad of the arch's angle per tooth
const UPPER = { ...ARCH, y0: -0.447, y1: -0.33, half: 0.03, amax: 1.4, free: -1 };
const LOWER = { A: 0.192, B: 0.287, zc: 0.03, y0: -0.56, y1: -0.463, half: 0.032, amax: 1.4, free: 1 };
const HINGE = [0, -0.22, -0.05]; // the jaw's hinge axis (along x) passes here
const JAW_OPEN = 27 * DEG;

// The flame (model space): [x, y, z, radius] down from the skull's base, sweeping back to the floor.
const WISP = [
  [0, 0.6, -0.12, 0.2],
  [0, 0.43, -0.17, 0.19],
  [0, 0.28, -0.27, 0.14],
  [0.02, 0.16, -0.38, 0.09],
  [0.05, 0.075, -0.47, 0.05],
  [0.1, 0.03, -0.52, 0.018],
];
// Licks, each side: one flaring out behind the skull and curling up round it (seen from above
// round its back), a small one curling up under the cheek; and one up the middle of the back.
const LICKS = [
  ...[1, -1].flatMap((s) => [
    [
      [0.15 * s, 0.48, -0.2, 0.11],
      [0.36 * s, 0.46, -0.34, 0.085],
      [0.5 * s, 0.6, -0.42, 0.055],
      [0.545 * s, 0.8, -0.44, 0.03],
      [0.51 * s, 0.96, -0.42, 0.01],
    ],
    [
      [0.1 * s, 0.4, -0.14, 0.09],
      [0.27 * s, 0.3, -0.12, 0.06],
      [0.36 * s, 0.36, -0.1, 0.032],
      [0.385 * s, 0.48, -0.08, 0.01],
    ],
  ]),
  [
    [0, 0.5, -0.28, 0.1],
    [0, 0.49, -0.48, 0.07],
    [0, 0.61, -0.575, 0.04],
    [0, 0.78, -0.595, 0.012],
  ],
];

const COL = {
  bone: srgb(236, 227, 200),
  stain: srgb(196, 178, 142),
  shade: srgb(128, 108, 84),
  crack: srgb(58, 46, 40),
  hollow: srgb(34, 26, 30),
  tooth: srgb(247, 242, 226),
  gum: srgb(176, 154, 118),
  orbDark: srgb(22, 18, 24),
  pupil: srgb(16, 20, 18),
};

/** An arch slab's coordinates at face-local q: [radial distance from the arch line, angle]. */
function archAt(o, x, z) {
  const rr = Math.hypot(x / o.A, (z - o.zc) / o.B);
  return [(rr - 1) * Math.min(o.A, o.B), Math.atan2(x / o.A, (z - o.zc) / o.B)];
}
/** 0 in the middle of a tooth .. 1 at the gap between two (a gap on the midline). */
function toothGap(a) {
  const u = a / TOOTH_PITCH;
  return Math.abs(u - Math.floor(u) - 0.5) * 2;
}
/** A row of chunky teeth along an arch: a slab, notched and shortened between the teeth. */
function teethRow(o) {
  return (x, y, z) => {
    const [rad, a] = archAt(o, x, z);
    const gap = sstep(0.7, 1, toothGap(a));
    const dr = Math.abs(rad) - (o.half - 0.013 * gap);
    const dy = o.free > 0 ? Math.max(y - (o.y1 - 0.024 * gap), o.y0 - y) : Math.max(o.y0 + 0.024 * gap - y, y - o.y1);
    const da = (Math.abs(a) - o.amax) * 0.2;
    return smax(smax(dr, dy, 0.018), da, 0.018);
  };
}

function makeShape() {
  const cran = ellipsoid(CR_C, CR_R);
  const maxilla = roundBox([0, -0.25, 0.19], [0.19, 0.13, 0.15], 0.09);
  const cheek = ellipsoid([0.3, -0.13, 0.12], [0.12, 0.07, 0.16]);
  const noseA = ellipsoid([0.024, NOSE[1] - 0.012, NOSE[2]], [0.03, 0.045, 0.09]);
  const noseB = ellipsoid([0, NOSE[1] + 0.022, NOSE[2]], [0.024, 0.04, 0.09]);
  const upper = teethRow(UPPER);
  const lower = teethRow(LOWER);
  const flames = [WISP, ...LICKS].map((pts) => ({ cones: coneChain(pts), line: polyline(pts.map((p) => p.slice(0, 3))) }));
  const chinBump = ellipsoid([0, -0.59, 0.31], [0.1, 0.05, 0.05]);
  const ramus = roundCone([0.188, -0.555, -0.03], [0.262, -0.22, -0.05], 0.058, 0.036);
  const MAND = { A: 0.19, B: 0.288, zc: 0.03, y0: -0.608, y1: -0.535, half: 0.036, amax: 1.75 };

  const shape = { wispLine: polyline(WISP.map((p) => p.slice(0, 3))) };
  shape.nose = (qx, qy, qz) => Math.min(noseA(Math.abs(qx), qy, qz), noseB(qx, qy, qz));
  const flameD = (fl, x, y, z) => {
    let d = Infinity;
    for (const c of fl.cones) d = Math.min(d, c(x, y, z));
    return d;
  };
  shape.wisp = (x, y, z) => {
    let d = Infinity;
    for (const fl of flames) d = smin(d, flameD(fl, x, y, z), 0.05);
    return d;
  };
  /** How far along its tongue of flame a point is: 0 at the root .. 1 at the tip. */
  shape.flameTip = (x, y, z) => {
    let best = Infinity;
    let s = 0;
    flames.forEach((fl, i) => {
      const d = flameD(fl, x, y, z);
      if (d < best) {
        best = d;
        // the main flame's first stretch is its root; a lick starts part-way out
        s = i === 0 ? sstep(0.25, 1, fl.line.param(x, y, z) / fl.line.total) : sstep(0.15, 1, fl.line.param(x, y, z) / fl.line.total);
      }
    });
    return s;
  };
  /** The skull's shell: distances to the bare bone, the upper teeth, both and the flame. */
  shape.skullParts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    let d = smin(cran(qx, qy, qz), maxilla(qx, qy, qz), 0.12);
    d = smin(d, cheek(Math.abs(qx), qy, qz), 0.07);
    d = smax(d, -shape.nose(qx, qy, qz), 0.012);
    o.plain = d;
    o.teeth = upper(qx, qy, qz);
    o.bone = smin(d, o.teeth, 0.012);
    o.wisp = shape.wisp(x, y, z);
    o.all = smin(o.bone, o.wisp, 0.07);
    return o;
  };
  /** The lower jaw's shell: the mandible and its teeth. */
  shape.jawParts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    const [rad, a] = archAt(MAND, qx, qz);
    let d = smax(smax(Math.abs(rad) - MAND.half, Math.max(MAND.y0 - qy, qy - MAND.y1), 0.04), (Math.abs(a) - MAND.amax) * 0.2, 0.04);
    d = smin(d, chinBump(qx, qy, qz), 0.05);
    d = smin(d, ramus(Math.abs(qx), qy, qz), 0.04);
    o.plain = d;
    o.teeth = lower(qx, qy, qz);
    o.all = smin(d, o.teeth, 0.012);
    return o;
  };
  const P = {};
  const J = {};
  shape.solid = (x, y, z) => shape.skullParts(x, y, z, P).all;
  shape.jaw = (x, y, z) => shape.jawParts(x, y, z, J).all;
  shape.eyes = placeEyes(shape.solid, HEAD, { r: EYE_R, x: EYE_X, y: EYE_Y, yaw: 0.08, open: 41 * DEG, range: [0.05, 0.5] });
  shape.sdf = (x, y, z) => carveSockets(shape.solid(x, y, z), x, y, z, shape.eyes, EYE_R * R_SOCK, { k: 0.02 });
  shape.both = (x, y, z) => Math.min(shape.solid(x, y, z), shape.jaw(x, y, z));
  return shape;
}

/** Several shells as one (positions, triangles, normals appended). */
function joinShells(shells) {
  const out = { pos: [], tris: [], nor: [] };
  for (const s of shells) {
    const base = out.pos.length / 3;
    for (const v of s.pos) out.pos.push(v);
    for (const t of s.tris) out.tris.push(t + base);
    for (const n of s.nor) out.nor.push(n);
  }
  return out;
}

// ------------------------------------------------------------------------------- the rig

const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.52, -0.1]],
  ['head', 'body', [0, 0.63, -0.08]],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['jaw', 'head', fw(...HINGE)],
  ['tail_1', 'root', [0, 0.43, -0.17]],
  ['tail_2', 'tail_1', [0, 0.28, -0.27]],
  ['tail_3', 'tail_2', [0, 0.16, -0.38]],
];
const BI = boneIndex(BONES);

/** Skin weights of a point of the skull's shell: the bone on head, the flame down its chain. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.skullParts(x, y, z);
  const w = weights();
  let wisp = 0;
  for (const [name, v] of soft([
    ['bone', d.bone, 0.03],
    ['wisp', d.wisp, 0.03],
  ])) {
    if (name === 'bone') w.put('head', v);
    else {
      wisp = v;
      const s = shape.wispLine.param(x, y, z);
      const L = shape.wispLine.lens;
      chain(w, v, s, ['head', 'tail_1', 'tail_2', 'tail_3'], [L[1] * 0.75, L[2], L[3]], 0.07);
    }
  }
  return { w: w.done(BI), wisp };
}

/** The jaw swung open by angle a about its hinge: the shape key delta of a point. */
function jawSwing(p, a) {
  const [qx, qy, qz] = wf(...p);
  const ry = qy - HINGE[1];
  const rz = qz - HINGE[2];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return sub(fw(qx, HINGE[1] + ry * c - rz * s, HINGE[2] + ry * s + rz * c), p);
}

// ---------------------------------------------------------------------------- the painting

/** The cracks: jagged lines over the cranium, as model-space segments [a, b, width at a, at b]. */
function makeCracks() {
  const at = (u) => {
    const n = norm(u);
    return fw(CR_C[0] + CR_R[0] * n[0], CR_C[1] + CR_R[1] * n[1], CR_C[2] + CR_R[2] * n[2]);
  };
  const lines = [
    // from the crown down the forehead toward the left socket, with a fork
    [[0.2, 0.95, 0.15], [0.33, 0.85, 0.36], [0.22, 0.74, 0.55], [0.34, 0.62, 0.68], [0.3, 0.5, 0.8]],
    [[0.33, 0.85, 0.36], [0.5, 0.78, 0.36], [0.6, 0.66, 0.46]],
    // across the right back of the crown
    [[-0.3, 0.92, -0.1], [-0.5, 0.78, 0.0], [-0.46, 0.7, 0.22], [-0.62, 0.56, 0.3]],
    [[-0.5, 0.78, 0.0], [-0.68, 0.66, -0.14], [-0.72, 0.5, -0.3]],
    // a chip running up from the right cheek
    [[-0.86, 0.1, 0.42], [-0.8, 0.26, 0.5], [-0.86, 0.38, 0.36]],
  ];
  const segs = [];
  for (const line of lines) {
    const pts = line.map(at);
    for (let i = 0; i + 1 < pts.length; i++) {
      const t0 = i / (pts.length - 1);
      const t1 = (i + 1) / (pts.length - 1);
      segs.push([pts[i], pts[i + 1], mix(0.0095, 0.004, t0), mix(0.0095, 0.004, t1)]);
    }
  }
  return (p) => {
    // jagged: the point is jittered before measuring
    const j = [
      p[0] + 0.016 * (vnoise(p[0] * 38, p[1] * 38, p[2] * 38) - 0.5),
      p[1] + 0.016 * (vnoise(p[0] * 38 + 9, p[1] * 38, p[2] * 38) - 0.5),
      p[2] + 0.016 * (vnoise(p[0] * 38, p[1] * 38 + 9, p[2] * 38) - 0.5),
    ];
    let k = 0;
    for (const [a, b, w0, w1] of segs) {
      const ab = sub(b, a);
      const t = clamp(dot(sub(j, a), ab) / dot(ab, ab), 0, 1);
      const d = len(sub(j, add(a, scl(ab, t))));
      const w = mix(w0, w1, t);
      k = Math.max(k, sstep(w, w * 0.45, d));
    }
    return k;
  };
}

/** The bone's colour at a point: ivory, stained in soft patches, darker underneath, fine grain. */
function boneColor(p, n) {
  const [x, y, z] = p;
  let c = lerp3(COL.bone, COL.stain, 0.4 * sstep(0.45, 0.8, fbm(x * 3.6 + 1, y * 3.6, z * 3.6)));
  c = lerp3(c, COL.stain, 0.35 * sstep(0.1, -0.8, n[1]));
  return scl(c, 0.97 + 0.07 * (vnoise(x * 64, y * 64, z * 64) - 0.5));
}

/** Teeth: paler than the bone, dark between them, stained toward the root. `root` is 0..1. */
function toothColor(a, root) {
  let c = lerp3(COL.tooth, COL.gum, 0.55 * sstep(0.45, 1, root));
  c = lerp3(c, COL.crack, 0.75 * sstep(0.8, 0.97, toothGap(a)));
  return c;
}

/**
 * The skull shell's look at a model point: { c (sRGB), a (tint mask), g (emissive, sRGB) }.
 */
function makeSkullShade(shape) {
  const P = {};
  const cracks = makeCracks();
  return (p, n, ao) => {
    const [x, y, z] = p;
    shape.skullParts(x, y, z, P);
    const [qx, qy, qz] = wf(x, y, z);
    let c = boneColor(p, n);
    let a = 0;
    let g = 0;
    // sutures: faint wiggly seams over the crown
    const ux = (qx - CR_C[0]) / CR_R[0];
    const uy = (qy - CR_C[1]) / CR_R[1];
    const uz = (qz - CR_C[2]) / CR_R[2];
    if (uy > 0.15) {
      const cor = Math.abs(uz - 0.12 - 0.035 * Math.sin(ux * 24) - 0.02 * Math.sin(ux * 57 + 1)) * CR_R[2];
      const sag = uz < 0.12 ? Math.abs(ux - 0.03 * Math.sin(uz * 31) - 0.015 * Math.sin(uz * 70 + 2)) * CR_R[0] : 1;
      c = lerp3(c, COL.shade, 0.5 * sstep(0.009, 0.003, Math.min(cor, sag)) * sstep(0.15, 0.35, uy));
    }
    c = lerp3(c, COL.crack, cracks(p));
    // the temples and under the cheekbones: a soft shade
    c = lerp3(c, COL.shade, 0.3 * sstep(0.2, 0.0, Math.hypot((Math.abs(qx) - 0.4) / 1.2, qy + 0.27, (qz - 0.08) / 1.6)));
    // the upper teeth
    const tk = sstep(0.008, -0.008, P.teeth - P.plain);
    if (tk > 0) {
      const [, ang] = archAt(UPPER, qx, qz);
      c = lerp3(c, toothColor(ang, sstep(-0.42, -0.36, qy)), tk);
    }
    // the nose hole
    const nk = sstep(0.006, -0.004, shape.nose(qx, qy, qz));
    c = lerp3(c, COL.hollow, nk);
    c = scl(c, 1 - 0.25 * sstep(0.03, 0.0, shape.nose(qx, qy, qz)) * (1 - nk));
    c = scl(c, ao);
    // the sockets: a dark rim, and the wall inside lit by the orb (tinted, faintly glowing)
    for (const e of shape.eyes) {
      const d = len(sub(p, e.E)) - EYE_R * R_SOCK;
      c = lerp3(c, COL.shade, 0.5 * sstep(0.055, 0.0, d));
      const k = sstep(0.012, -0.004, d);
      if (k > 0) {
        c = lerp3(c, [0.42, 0.42, 0.42], k);
        a = Math.max(a, k);
        g = Math.max(g, 0.1 * k);
      }
    }
    // the flame: light, streaked along its flow, its tips pale and hot (less tinted, glowing more)
    const wk = sstep(0.03, -0.03, P.wisp - P.bone);
    if (wk > 0) {
      const s = shape.flameTip(x, y, z);
      const warp = 2.4 * fbm(x * 5, y * 3, z * 5);
      const streak = vnoise(x * 13 + warp, y * 3.2 + warp, z * 13);
      let f = 0.84 - 0.2 * sstep(0.42, 0.7, streak) + 0.08 * sstep(0.3, 0.1, streak);
      f *= 1 - 0.1 * sstep(0.35, 0.0, s) * mix(0.4, 1, sstep(0.3, 0.75, fbm(x * 9, y * 9, z * 9)));
      f = mix(f, 1, sstep(0.3, 0.95, s));
      f *= mix(1, ao, 0.5);
      c = lerp3(c, [f, f, f], wk);
      a = Math.max(a, wk * mix(1, 0.5, sstep(0.45, 1, s)));
      g = Math.max(g, (0.08 + 0.2 * sstep(0.3, 1, s)) * wk);
    }
    return { c, a, g: [g, g, g] };
  };
}

/** The jaw shell's look: bone and the lower teeth (all painted). */
function makeJawShade(shape) {
  const P = {};
  return (p, n, ao) => {
    const [x, y, z] = p;
    shape.jawParts(x, y, z, P);
    const [qx, qy, qz] = wf(x, y, z);
    let c = boneColor(p, n);
    c = lerp3(c, COL.shade, 0.25 * sstep(0.0, -0.9, n[1]));
    const tk = sstep(0.008, -0.008, P.teeth - P.plain);
    if (tk > 0) {
      const [, ang] = archAt(LOWER, qx, qz);
      c = lerp3(c, toothColor(ang, sstep(-0.5, -0.545, qy)), tk);
    }
    return { c: scl(c, ao), a: 0, g: [0, 0, 0] };
  };
}

// ---------------------------------------------------------------------------- the orbs

const PUPIL = 8 * DEG; // the dark pupil
const CORE = 17 * DEG; // the bright core round it
const IRIS = 29 * DEG; // the glow
const HALO = 41 * DEG; // fading into the dark of the socket
const STRIP = 62 * DEG; // the texture strip covers 0..STRIP (u = polar angle / STRIP)

/**
 * The `Eyes` mesh: one sphere per eye (poles on its forward axis, rings at the colour edges),
 * wholly on its bone. Vertex colours carry the shading; UVs run along a strip of the shared atlas
 * (u = polar angle) that holds the tint mask (base map, white) and the glow (emissive map). A
 * `surprised` key shrinks the orb to a startled point; one small glint.
 */
function orbEyes(eyes, atlas, rect, bones) {
  const b = new MeshBuffer(['surprised']);
  const ringDeg = [0, 4, 7.4, 8.6, 12.5, 16.4, 17.6, 23, 28.4, 29.6, 35, 40.5, 42, 48, 58, 74, 100, 135, 180];
  const rings = ringDeg.map((d) => d * DEG);
  const na = 24;
  const shrink = (pol) => (pol <= HALO ? pol * 0.62 : pol <= HALO + 12 * DEG ? mix(HALO * 0.62, HALO + 12 * DEG, (pol - HALO) / (12 * DEG)) : pol);
  const colorAt = (pol, lit) => {
    if (pol < PUPIL) return COL.pupil;
    if (pol < CORE) return [1, 1, 1];
    if (pol < IRIS) {
      const v = mix(0.96, 0.78, (pol - CORE) / (IRIS - CORE)) * (0.95 + 0.05 * lit);
      return [v, v, v];
    }
    if (pol < HALO) {
      const v = mix(0.52, 0.12, (pol - IRIS) / (HALO - IRIS));
      return [v, v, v];
    }
    return COL.orbDark;
  };
  for (const eye of eyes) {
    const R = eye.r;
    const wts = [[eye.side > 0 ? bones.L : bones.R, 1]];
    const base = b.count;
    const at = (pol, az) => add(scl(eye.F, Math.cos(pol)), add(scl(eye.X, Math.sin(pol) * Math.cos(az)), scl(eye.U, Math.sin(pol) * Math.sin(az))));
    for (let ri = 0; ri < rings.length; ri++)
      for (let k = 0; k < na; k++) {
        const pol = rings[ri];
        const az = (k / na) * Math.PI * 2;
        const nn = at(pol, az);
        const c = colorAt(pol, 0.5 - 0.5 * Math.sin(az) * Math.sin(pol));
        const uv = atlas.rectUV(rect, clamp(pol / STRIP, 0.004, 0.996), 0.5);
        b.addVertex(add(eye.E, scl(nn, R)), nn, uv, wts, { surprised: scl(sub(at(shrink(pol), az), nn), R) }, toLinear(c));
      }
    for (let ri = 0; ri + 1 < rings.length; ri++)
      for (let k = 0; k < na; k++) {
        const i0 = base + ri * na + k;
        const i1 = base + ri * na + ((k + 1) % na);
        const j0 = i0 + na;
        const j1 = i1 + na;
        if (ri === 0) b.idx.push(i0, j0, j1);
        else b.idx.push(i0, j0, j1, i0, j1, i1);
      }
    // a glint on the core, the same side on both eyes
    const n0 = at(13 * DEG, 2.3);
    const c0 = add(eye.E, scl(n0, R + 0.002));
    const gb = b.count;
    const t1 = norm(cross(n0, [0, 1, 0]));
    const t2 = cross(t1, n0);
    const sg = 8;
    const white = [1.6, 1.6, 1.6];
    const uv = atlas.rectUV(rect, 0.996, 0.5);
    b.addVertex(add(c0, scl(n0, 0.003)), n0, uv, wts, {}, white);
    for (let s = 0; s < sg; s++) {
      const ang = (s / sg) * Math.PI * 2;
      const pp = add(c0, add(scl(t1, Math.cos(ang) * 0.016), scl(t2, Math.sin(ang) * 0.014)));
      b.addVertex(add(eye.E, scl(norm(sub(pp, eye.E)), R + 0.0015)), n0, uv, wts, {}, white);
    }
    for (let s = 0; s < sg; s++) b.idx.push(gb, gb + 1 + ((s + 1) % sg), gb + 1 + s);
  }
  return b;
}

/** The orbs' strip: white with the tint mask in the base map, the glow in the emissive map. */
function paintOrbStrip(canvas, glowCanvas, atlas, rect) {
  paintRect(canvas, atlas, rect, (u, v, out) => {
    const pol = u * STRIP;
    const a = pol < PUPIL ? 0 : pol < CORE ? 0.55 : sstep(HALO + 3 * DEG, HALO + 1 * DEG, pol);
    write(out, [1, 1, 1], a);
  });
  paintRect(glowCanvas, atlas, rect, (u, v, out) => {
    const pol = u * STRIP;
    let g = 0;
    if (pol >= PUPIL && pol < CORE) g = 0.6;
    else if (pol >= CORE && pol < IRIS) g = mix(0.42, 0.26, (pol - CORE) / (IRIS - CORE));
    else if (pol >= IRIS && pol < HALO) g = mix(0.14, 0, (pol - IRIS) / (HALO - IRIS));
    write(out, [g, g, g], 1);
  });
}

// ------------------------------------------------------------------------------- the build

/**
 * @param {{texture?: number, triangles?: number, jawTriangles?: number, grid?: number}} [o] texture
 *   size, target triangles for the skull's and the jaw's shells, surface-nets grid spacing (design
 *   units)
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 5400, jawTriangles = 1500, grid = 0.014 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  // the two shells: the skull with its flame, and the lower jaw
  const skullShell = buildShell(f, {
    lo: [-0.66, -0.04, -0.74],
    hi: [0.64, 1.44, 0.62],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      let k = qz > 0.12 && qy < 0.3 ? 1.8 : 1;
      if (qy < -0.3 && qz > 0.02) k = 3.2; // the teeth
      if (Math.hypot(qx, qy - NOSE[1]) < 0.09 && qz > 0.2) k = 3; // the nose hole
      for (const e of shape.eyes) {
        const r = len(sub([x, y, z], e.E)) / (EYE_R * R_SOCK);
        if (r < 1.3) k = Math.max(k, r > 0.85 ? 5 : 0.6);
      }
      if (shape.wisp(x, y, z) < 0.02) k = Math.max(k, y < 0.3 ? 2.2 : 1.7); // the flame
      return k;
    },
  });
  const jawShell = buildShell(shape.jaw, {
    lo: [-0.38, 0.18, -0.08],
    hi: [0.38, 0.9, 0.76],
    grid: 0.011,
    triangles: jawTriangles,
    importance: ([x, y, z]) => (wf(x, y, z)[1] > -0.53 && wf(x, y, z)[2] > 0.02 ? 2.6 : 1),
  });
  const nSkull = skullShell.pos.length / 3;
  const shell = joinShells([skullShell, jawShell]);
  const ao = fieldAO(shape.both, shell.pos, shell.nor, { min: 0.7 });

  // the brow ridges (eyelids)
  const lids = eyelids(shape.eyes, {
    rUp: 1.1,
    rLo: 1.065,
    motions: {
      blink: [{ close: 1 }, { close: 1 }],
      squint: [{ close: 0.5 }, { close: 0.34 }],
      happy: [3, 26],
      sad: [{ deg: 22, roll: -0.65 }, 2],
      angry: [{ deg: 30, roll: 0.85 }, 9],
      surprised: [-7, -7],
    },
  });

  // UVs
  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  lids.reserve(atlas);
  const eyeRect = atlas.addRect(0.42, 0.02);
  atlas.layout();

  // the Body
  const body = new MeshBuffer(KEYS);
  const headOnly = [[BI.head, 1]];
  const shellTris = appendShell(body, shell, atlas, (i, p) => {
    if (i >= nSkull) {
      // the jaw: rigid on its bone; the keys swing it about the hinge
      const open = jawSwing(p, JAW_OPEN);
      return {
        weights: [[BI.jaw, 1]],
        keys: { mouthOpen: open, happy: jawSwing(p, 0.14 * JAW_OPEN), sad: jawSwing(p, 0.1 * JAW_OPEN), surprised: jawSwing(p, 0.3 * JAW_OPEN), angry: fdir(0, 0.004, 0.022) },
      };
    }
    const { w, wisp } = skinOf(shape, p);
    const keys = {};
    if (wisp > 0.02) {
      // the flame flares: it swells, more toward its tips
      const s = shape.wispLine.param(...p) / shape.wispLine.total;
      const n = shell.nor[i];
      keys.puff = scl([n[0], Math.max(0, n[1]) * 0.3, n[2]], 0.05 * wisp * (0.4 + 0.6 * s) * sstep(0.0, 0.08, p[1]));
    }
    return { weights: w, keys };
  });
  const shellCount = body.count;
  lids.build(body, atlas, headOnly);

  // the textures: base colour (+ tint mask) and emissive, painted from the same shading
  const canvas = createCanvas(N);
  const glowCanvas = createCanvas(N);
  const skullShade = makeSkullShade(shape);
  const jawShade = makeJawShade(shape);
  const shade = (p, n, a) => (shape.jaw(p[0], p[1], p[2]) < shape.solid(p[0], p[1], p[2]) ? jawShade(p, n, a) : skullShade(p, n, a));
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
      // bone, with a shaded leading edge (v = 0)
      const k = 0.94 + 0.06 * (vnoise(u * 12, v * 9, upper ? 1 : 7) - 0.5);
      write(out, lerp3(lerp3(scl(COL.bone, k), COL.shade, 0.5 * sstep(0.3, 0.06, v)), COL.hollow, 0.85 * sstep(0.09, 0.03, v)), 0);
    });
  paintOrbStrip(canvas, glowCanvas, atlas, eyeRect);
  dilate(canvas, 6);
  dilate(glowCanvas, 6);
  for (let i = 3; i < glowCanvas.data.length; i += 4) glowCanvas.data[i] = 255;

  const eyes = orbEyes(shape.eyes, atlas, eyeRect, { L: BI.eye_L, R: BI.eye_R });
  const bones = BONES.map(([n, parent, p]) => [n, parent, p ?? { eye_L: eyeL.E, eye_R: eyeR.E }[n]]);
  const map = toTexture(canvas, 'skull_basecolor');
  const scene = assemble({ name: 'skull', bones, body, eyes, map, fit: fitScale(body, shellCount), roughness: 0.7, eyeRoughness: 0.5 });
  // the glow: one emissive map shared by the flame and socket walls (Body) and the orbs (Eyes);
  // the orbs also take the base map (white on their strip) for its tint mask
  const emissive = toTexture(glowCanvas, 'skull_emissive');
  for (const name of ['Body', 'Eyes']) {
    const m = scene.getObjectByName(name).material;
    m.emissiveMap = emissive;
    m.emissive.setRGB(1, 1, 1);
    m.emissiveIntensity = 1;
  }
  scene.getObjectByName('Eyes').material.map = map;
  return scene;
}

export const buildSkull = build;

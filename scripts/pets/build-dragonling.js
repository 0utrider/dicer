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
  coneChain,
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
  polyline,
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
  tongue,
  trace,
  vnoise,
  weights,
  write,
} from './lib/index.js';

/**
 * Dicer's dragonling pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a chibi baby dragon sitting up on its haunches. A big round head with a rounded
 * snout, chubby cheeks, big amber eyes, a little brow ridge, two curved horns swept back and two
 * fin-like frills for ears; a chubby pear body with a cream belly of scale plates, stubby arms and
 * big hind feet with ivory claws, a row of little spikes down its back and tail, and a tail that
 * sweeps back and curls up to a spade tip. Two bat wings with real membranes (thin two-sided
 * sheets between finger bones) sit on its shoulders, skinned to wing_L / wing_R.
 *
 * Scales are painted neutral grey (tinted by Dicer); belly plates, horns, claws, spikes, mouth and
 * eyes stay painted; the wing and frill membranes are half tinted (a paler tone of the colour).
 * Natural colour: red #c0392b.
 *
 * One fused `Body` shell (head, body, legs, tail, horns, frills, spikes, claws) plus eyelids, the
 * mouth's inside, a tongue and the two wings in the same mesh; `Eyes` the eyeballs. Bones: root,
 * body, head, eye_L/R, ear_L/R (the frills), wing_L/R, tail_1..3, arm_L/R. Shape keys: all eleven
 * of the spec.
 */

// ------------------------------------------------------------------------------- the design

const HEAD = tiltFrame([0, 1.0, 0.08], 0.62); // the face tilted up toward the top-down camera
const { fdir, wf } = HEAD;
const HC = HEAD.center;

const EYE_R = 0.145;
const R_SOCK = 1.26; // room for the lid shells (rUp 1.2, see eyelids below)
const MOUTH_Y = -0.16; // the mouth line on the snout (face-local)
const NECK_Y = 0.74; // the head/body blend plane (design units)

// The tail: from the rump, back along the floor, then curling up to its pet's left; the spade
// sits on the end.
const TAIL = [
  [0, 0.22, -0.26, 0.115],
  [0, 0.15, -0.44, 0.088],
  [0.05, 0.16, -0.61, 0.068],
  [0.17, 0.21, -0.73, 0.052],
  [0.31, 0.29, -0.77, 0.04],
  [0.42, 0.37, -0.73, 0.03],
];

// The wings, drawn flat in wing-local 2D (u out from the shoulder, v back): the arm to the wrist,
// three fingers fanning from it, the membrane between them and back to the body.
const WING = {
  W: [0.33, -0.06],
  tips: [
    [0.8, 0.03],
    [0.71, 0.33],
    [0.47, 0.52],
  ],
  H: [0.02, 0.36],
  droop: -0.06, // rest pose: the wing tilted down (rad) ...
  sweep: 0.22, // ... and swept back
};

const COL = {
  cream: srgb(250, 236, 200),
  plate: srgb(214, 186, 140),
  ivory: srgb(250, 244, 226),
  hornBase: srgb(196, 170, 128),
  ink: srgb(70, 30, 34),
  nostril: srgb(60, 30, 32),
  blush: srgb(250, 150, 150),
  membrane: srgb(232, 200, 184),
};

/** A frame at `o` with axis `ax` and a facing `fn` (made orthogonal): local (side, along, out). */
function axisFrame(o, ax, fn) {
  const a = norm(ax);
  let f = norm(fn);
  f = norm(sub(f, scl(a, dot(f, a))));
  const s = cross(a, f);
  return {
    o,
    a,
    f,
    s,
    local(x, y, z) {
      const p = [x - o[0], y - o[1], z - o[2]];
      return [dot(p, s), dot(p, a), dot(p, f)];
    },
  };
}

/** A frill: a fin fanned out behind each eye, flat, its front face toward the camera. */
function makeFin(side) {
  const B = add(HC, [0.3 * side, 0.08, -0.04]);
  const T = add(HC, [0.62 * side, 0.25, -0.22]);
  const fr = axisFrame(B, sub(T, B), [0.35 * side, 0.55, 1]);
  const L = len(sub(T, B));
  const blade = roundCone([0, 0, 0], [0, L, 0], 0.115, 0.022);
  const F = 0.32;
  // two notches in its back edge make three spines
  const notch = [0.45, 0.72].map((t) => ({ c: [-0.105 + 0.03 * t, L * t, 0], r: 0.04 - 0.012 * t }));
  return {
    B,
    T,
    fr,
    L,
    d(x, y, z) {
      const [s, t, w] = fr.local(x, y, z);
      let d = blade(s, t, w / F) * F;
      for (const n of notch) d = smax(d, -(Math.hypot(s - n.c[0] * side, t - n.c[1], w) - n.r), 0.012);
      return d;
    },
  };
}

/** A horn: round cones from the crown, up and curving back. */
function makeHorn(side) {
  const pts = [
    [0.15, 0.25, -0.05, 0.068],
    [0.2, 0.42, -0.11, 0.05],
    [0.235, 0.53, -0.22, 0.032],
    [0.23, 0.57, -0.34, 0.012],
  ].map(([x, y, z, r]) => [HC[0] + x * side, HC[1] + y, HC[2] + z, r]);
  const cones = coneChain(pts);
  return {
    pts,
    line: polyline(pts.map((p) => p.slice(0, 3))),
    d(x, y, z) {
      let d = cones[0](x, y, z);
      for (let i = 1; i < cones.length; i++) d = Math.min(d, cones[i](x, y, z));
      return d;
    },
  };
}

/** A spade on the tail's tip: a flat teardrop with two lobes. */
function makeSpade() {
  const a = TAIL[TAIL.length - 2];
  const b = TAIL[TAIL.length - 1];
  const dir = norm(sub(b.slice(0, 3), a.slice(0, 3)));
  const fr = axisFrame(b.slice(0, 3), dir, [0, 1, 0]); // flat side up
  const F = 0.3;
  const blade = roundCone([0, -0.01, 0], [0, 0.17, 0], 0.075, 0.008);
  const lobeL = ellipsoid([0.055, 0.02, 0], [0.05, 0.055, 0.05]);
  const lobeR = ellipsoid([-0.055, 0.02, 0], [0.05, 0.055, 0.05]);
  return {
    fr,
    d(x, y, z) {
      const [s, t, w] = fr.local(x, y, z);
      const ww = w / F;
      return smin(blade(s, t, ww), Math.min(lobeL(s, t, ww), lobeR(s, t, ww)), 0.04) * F;
    },
  };
}

function makeShape() {
  // the head (face-local)
  const skull = ellipsoid([0, 0, 0], [0.42, 0.37, 0.37]);
  const snout = ellipsoid([0, -0.14, 0.25], [0.215, 0.135, 0.2]);
  const jaw = ellipsoid([0, -0.235, 0.2], [0.165, 0.075, 0.17]);
  const nosL = ellipsoid([0.06, -0.075, 0.4], [0.05, 0.04, 0.045]);
  const nosR = ellipsoid([-0.06, -0.075, 0.4], [0.05, 0.04, 0.045]);
  const cheekL = ellipsoid([0.23, -0.13, 0.1], [0.17, 0.14, 0.17]);
  const cheekR = ellipsoid([-0.23, -0.13, 0.1], [0.17, 0.14, 0.17]);
  const templeL = ellipsoid([0.3, 0.05, 0.1], [0.12, 0.15, 0.17]);
  const templeR = ellipsoid([-0.3, 0.05, 0.1], [0.12, 0.15, 0.17]);
  const hornL = makeHorn(1);
  const hornR = makeHorn(-1);
  const finL = makeFin(1);
  const finR = makeFin(-1);
  // the body
  const belly = ellipsoid([0, 0.36, -0.02], [0.32, 0.34, 0.31]);
  const chest = ellipsoid([0, 0.56, 0.05], [0.23, 0.22, 0.2]);
  const thighL = ellipsoid([0.205, 0.17, -0.03], [0.15, 0.16, 0.21]);
  const thighR = ellipsoid([-0.205, 0.17, -0.03], [0.15, 0.16, 0.21]);
  const footL = ellipsoid([0.215, 0.05, 0.17], [0.098, 0.056, 0.135]);
  const footR = ellipsoid([-0.215, 0.05, 0.17], [0.098, 0.056, 0.135]);
  const armL = roundCone([0.17, 0.57, 0.12], [0.215, 0.39, 0.27], 0.072, 0.058);
  const armR = roundCone([-0.17, 0.57, 0.12], [-0.215, 0.39, 0.27], 0.072, 0.058);
  const handL = ellipsoid([0.22, 0.37, 0.29], [0.068, 0.06, 0.068]);
  const handR = ellipsoid([-0.22, 0.37, 0.29], [0.068, 0.06, 0.068]);
  // claws: three on each foot, two on each hand
  const clawDefs = [];
  for (const side of [1, -1]) {
    for (const dx of [-0.05, 0, 0.05]) {
      const a = [side * 0.215 + dx, 0.04, 0.27 - Math.abs(dx) * 0.35];
      clawDefs.push({ part: 'torso', side, a, b: add(a, [dx * 0.25, -0.022, 0.05]), r1: 0.022, r2: 0.006 });
    }
    for (const dx of [-0.028, 0.028]) {
      const a = [side * 0.22 + dx, 0.34, 0.34];
      clawDefs.push({ part: side > 0 ? 'armL' : 'armR', side, a, b: add(a, [dx * 0.2, -0.045, 0.03]), r1: 0.018, r2: 0.005 });
    }
  }
  const claws = clawDefs.map((c) => ({ ...c, f: roundCone(c.a, c.b, c.r1, c.r2) }));
  const tail = coneChain(TAIL);
  const tailLine = polyline(TAIL.map((p) => p.slice(0, 3)));
  const spade = makeSpade();

  const shape = { hornL, hornR, finL, finR, tailLine, claws, spikes: [], eyes: [] };
  /** Distances to the parts at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    let h = smin(skull(qx, qy, qz), cheekL(qx, qy, qz), 0.08);
    h = smin(h, cheekR(qx, qy, qz), 0.08);
    h = smin(h, Math.min(templeL(qx, qy, qz), templeR(qx, qy, qz)), 0.08);
    h = smin(h, snout(qx, qy, qz), 0.09);
    h = smin(h, jaw(qx, qy, qz), 0.06);
    h = smin(h, Math.min(nosL(qx, qy, qz), nosR(qx, qy, qz)), 0.04);
    o.head = h;
    o.hornL = hornL.d(x, y, z);
    o.hornR = hornR.d(x, y, z);
    o.finL = finL.d(x, y, z);
    o.finR = finR.d(x, y, z);
    let t = smin(belly(x, y, z), chest(x, y, z), 0.12);
    t = smin(t, smin(thighL(x, y, z), thighR(x, y, z), 0.01), 0.06);
    o.torso = smin(t, Math.min(footL(x, y, z), footR(x, y, z)), 0.04);
    o.armL = smin(armL(x, y, z), handL(x, y, z), 0.04);
    o.armR = smin(armR(x, y, z), handR(x, y, z), 0.04);
    let cl = Infinity;
    for (const c of claws) {
      const d = c.f(x, y, z);
      cl = Math.min(cl, d);
      o[c.part] = smin(o[c.part], d, 0.012);
    }
    o.claw = cl;
    o.tailBase = tail[0](x, y, z);
    let tr = tail[1](x, y, z);
    for (let i = 2; i < tail.length; i++) tr = Math.min(tr, tail[i](x, y, z));
    o.spade = spade.d(x, y, z);
    o.tailRest = smin(tr, o.spade, 0.03);
    let sp = Infinity;
    let spT = Infinity;
    for (const s of shape.spikes) {
      const d = s.f(x, y, z);
      if (s.tail) spT = Math.min(spT, d);
      else sp = Math.min(sp, d);
    }
    o.spike = sp;
    o.spikeT = spT;
    o.tail = Math.min(o.tailBase, o.tailRest, spT);
    return o;
  };
  const P = {};
  const union = (withSpikes) => {
    let hd = smin(P.head, Math.min(P.hornL, P.hornR), 0.035);
    hd = smin(hd, Math.min(P.finL, P.finR), 0.04);
    let body = smin(P.torso, P.armL, 0.045);
    body = smin(body, P.armR, 0.045);
    let d = smin(hd, body, 0.1);
    d = smin(d, P.tailBase, 0.08);
    d = smin(d, P.tailRest, 0.02);
    if (withSpikes) d = smin(d, Math.min(P.spike, P.spikeT), 0.022);
    return d;
  };
  /** The dragonling without spikes or sockets (for placing the spikes). */
  shape.base = (x, y, z) => {
    shape.parts(x, y, z, P);
    return smax(union(false), -y, 0.02);
  };
  // the spikes down the back and along the tail, set on the surface
  const spikeAt = (from, dir, back, h, r, isTail) => {
    const hit = trace(shape.base, from, dir);
    const out = norm(add(hit.n, scl(back, 0.9)));
    const a = sub(hit.p, scl(hit.n, 0.025));
    const b = add(hit.p, scl(out, h));
    shape.spikes.push({ a, b, tail: isTail, f: roundCone(a, b, r, 0.004) });
  };
  for (const [ang, h, r] of [
    [1.0, 0.085, 0.034],
    [0.62, 0.1, 0.038],
    [0.25, 0.09, 0.036],
  ]) {
    const d = [0, Math.sin(ang), -Math.cos(ang)];
    spikeAt(add([0, 0.4, -0.02], scl(d, 0.7)), scl(d, -1), [0, -0.3, -1], h, r, false);
  }
  for (const [i, h, r] of [
    [1, 0.08, 0.033],
    [2, 0.07, 0.029],
    [3, 0.06, 0.024],
  ]) {
    const p = TAIL[i];
    const dir = norm(sub(TAIL[i + 1].slice(0, 3), TAIL[i - 1].slice(0, 3)));
    spikeAt(add(p.slice(0, 3), [0, 0.4, 0]), [0, -1, 0], dir, h, r, true);
  }
  /** The dragonling without eye sockets (for placing the eyes and for occlusion). */
  shape.solid = (x, y, z) => {
    shape.parts(x, y, z, P);
    return smax(union(true), -y, 0.02);
  };
  shape.eyes = placeEyes(shape.solid, HEAD, { r: EYE_R, x: 0.19, y: 0.065, yaw: 0.15, open: 56 * DEG });
  shape.sdf = (x, y, z) => {
    shape.parts(x, y, z, P);
    const d = carveSockets(union(true), x, y, z, shape.eyes, EYE_R * R_SOCK, { k: 0.02 });
    return smax(d, -y, 0.02);
  };
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const SHOULDER = (side) => [0.14 * side, 0.63, -0.16];

const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.34, -0.02]],
  ['head', 'body', [0, NECK_Y - 0.02, 0.05]],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['ear_L', 'head', null], // from the frills
  ['ear_R', 'head', null],
  ['wing_L', 'body', SHOULDER(1)],
  ['wing_R', 'body', SHOULDER(-1)],
  ['tail_1', 'body', TAIL[1].slice(0, 3)],
  ['tail_2', 'tail_1', TAIL[2].slice(0, 3)],
  ['tail_3', 'tail_2', TAIL[4].slice(0, 3)],
  ['arm_L', 'body', [0.17, 0.57, 0.12]],
  ['arm_R', 'body', [-0.17, 0.57, 0.12]],
];
const BI = boneIndex(BONES);

/** Skin weights of a shell point: head vs body by the neck plane, frills, arms, the tail chain. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  const core = Math.min(d.head, d.hornL, d.hornR, d.finL, d.finR, d.torso, d.spike);
  for (const [name, v] of soft([
    ['core', core, 0.03],
    ['armL', d.armL, 0.022],
    ['armR', d.armR, 0.022],
    ['tail', d.tail, 0.03],
  ])) {
    if (name === 'core') {
      const hv = sstep(-0.06, 0.06, y - NECK_Y + 0.18 * (z - 0.05)); // the chin sits above the nape
      let ear = 0;
      let earB = null;
      for (const [fin, df, b] of [
        [shape.finL, d.finL, 'ear_L'],
        [shape.finR, d.finR, 'ear_R'],
      ]) {
        const t = fin.fr.local(x, y, z)[1];
        const k = sstep(0.0, 0.07, t) * Math.exp(-Math.max(0, df - Math.min(d.head, df)) / 0.03);
        if (k > ear) {
          ear = k;
          earB = b;
        }
      }
      const head = v * hv;
      if (earB) w.put(earB, head * ear);
      w.put('head', head * (1 - ear));
      const body = v * (1 - hv);
      const rootK = sstep(0.2, 0.05, y); // the seat and feet stay planted when the body leans
      w.put('root', body * rootK);
      w.put('body', body * (1 - rootK));
    } else if (name === 'tail') {
      const L = shape.tailLine.lens;
      chain(w, v, shape.tailLine.param(x, y, z), ['body', 'tail_1', 'tail_2', 'tail_3'], [L[1], L[2], L[4]]);
    } else w.put(name === 'armL' ? 'arm_L' : 'arm_R', v);
  }
  return w.done(BI);
}

const gauss = (q, c, s) => Math.exp(-((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - (c[2] ?? q[2])) ** 2) / (2 * s * s));
const mirror = (q, c, s) => gauss(q, c, s) + gauss(q, [-c[0], c[1], c[2]], s);
/** The painted mouth line: a wide smile across the snout, the corners curled up (face-local y). */
const mouthLine = (qx) => MOUTH_Y + 1.5 * qx * qx;
const MOUTH_W = 0.135;

/** Face shape keys on the shell: displacement fields in face-local space. */
function faceKeysOf(f, p, n, headW) {
  const q = wf(...p);
  const out = {};
  if (headW < 0.01) {
    const g = gauss(p, [0, 0.5, 0.25], 0.15) * (1 - headW); // the chest puffs too
    if (g > 0.01) out.puff = scl(n, 0.035 * g);
    return out;
  }
  const fr = sstep(0.05, 0.2, q[2]) * headW;
  const corner = mirror(q, [MOUTH_W, mouthLine(MOUTH_W) - 0.004], 0.035) * fr;
  const cheek = mirror(q, [0.21, -0.1, 0.25], 0.07) * fr;
  const browIn = mirror(q, [0.1, 0.2, 0.3], 0.055) * fr;
  const browOut = mirror(q, [0.27, 0.17], 0.05) * fr;
  const brow = mirror(q, [0.175, 0.21], 0.08) * fr;
  const lip = gauss(q, [0, MOUTH_Y - 0.02], 0.04) * fr;
  // slid along the surface, so the skin never covers the mouth's inside
  const slide = (d) => (len(d) < 1e-6 ? d : sub(project(f, add(p, d)), p));
  // the lower jaw turns down about a hinge behind the mouth
  const jawW = sstep(mouthLine(q[0]) + 0.006, mouthLine(q[0]) - 0.025, q[1]) * sstep(0.17, 0.11, Math.abs(q[0])) * sstep(0.1, 0.24, q[2]) * headW;
  const jaw = (ang) => {
    if (jawW < 1e-3) return [0, 0, 0];
    const hy = MOUTH_Y + 0.01;
    const hz = 0.08;
    const dy = q[1] - hy;
    const dz = q[2] - hz;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return scl(fdir(0, dy * c - dz * s - dy, dy * s + dz * c - dz), jawW);
  };
  out.happy = add(slide(fdir(0, 0.022 * corner + 0.018 * cheek, 0)), scl(n, 0.008 * cheek));
  out.sad = slide(fdir(0, -0.018 * corner + 0.024 * browIn - 0.014 * browOut, 0));
  out.surprised = slide(add(fdir(0, 0.03 * brow, 0), jaw(0.07)));
  out.mouthOpen = add(slide(add(jaw(0.2), fdir(0, 0.006 * corner, 0))), scl(n, -0.004 * jawW));
  out.angry = add(fdir(0, -0.034 * browIn - 0.016 * brow - 0.012 * corner - 0.006 * lip, 0.016 * browIn + 0.01 * lip), scl(n, 0.006 * brow));
  out.puff = add(scl(n, 0.036 * mirror(q, [0.24, -0.12, 0.12], 0.09) * headW), scl(n, 0.012 * mirror(q, [0.06, -0.075, 0.4], 0.03) * headW));
  out.tongue = slide(jaw(0.06));
  return out;
}

// ---------------------------------------------------------------------------- the wings

/** A wing's 3D frame at rest: wing-local (u, v, h) -> model point. */
function wingFrame(side) {
  const S = SHOULDER(side);
  const { droop: dr, sweep: sw } = WING;
  const O = [side * Math.cos(dr) * Math.cos(sw), -Math.sin(dr), -Math.cos(dr) * Math.sin(sw)];
  let Bk = norm([0, -0.75, -1]);
  Bk = norm(sub(Bk, scl(O, dot(Bk, O))));
  let N = cross(O, Bk);
  if (N[1] < 0) N = scl(N, -1);
  return { S, O, Bk, N, at: (u, v, h = 0) => add(S, add(add(scl(O, u), scl(Bk, v)), scl(N, h))) };
}

/** The 2D outline of the membrane and its bounding box (for its UV rectangle). */
const WING_BOX = (() => {
  const pts = [[0, 0], WING.W, ...WING.tips, WING.H];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { u0: Math.min(...xs) - 0.02, v0: Math.min(...ys) - 0.02, u1: Math.max(...xs) + 0.02, v1: Math.max(...ys) + 0.02 };
})();

/** The membrane panels between the ribs (from the wrist): [rib a, rib b, scallop depth]. */
function wingPanels() {
  const { W, tips, H } = WING;
  return [
    [tips[0], tips[1], 0.2],
    [tips[1], tips[2], 0.22],
    [tips[2], H, 0.2],
    [H, [0, 0], 0],
  ].map(([a, b, depth]) => ({ a: sub([...a, 0], [...W, 0]), b: sub([...b, 0], [...W, 0]), depth }));
}

/** A point of a membrane panel: s from the wrist (0) to the edge (1), t across (0..1). */
function panelPoint(pn, s, t) {
  const r = s * (1 - pn.depth * Math.sin(Math.PI * t));
  const d = lerp3(pn.a, pn.b, t);
  return [WING.W[0] + d[0] * r, WING.W[1] + d[1] * r];
}

/**
 * Adds a tube along `pts` (radii per point, `sides` round) to buf, wound outward, its ends
 * closed by little cones. uvAt(s, k) its UV, wts(p) its weights.
 */
function addTube(buf, pts, radii, sides, uvAt, wts) {
  const n = pts.length;
  const rings = [];
  let X = null;
  const T = (i) => norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
  for (let i = 0; i < n; i++) {
    const t = T(i);
    if (!X) {
      X = norm(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    } else X = norm(sub(X, scl(t, dot(X, t))));
    const Y = cross(t, X);
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const off = add(scl(X, Math.cos(a)), scl(Y, Math.sin(a)));
      const p = add(pts[i], scl(off, radii[i]));
      ring.push(buf.addVertex(p, off, uvAt(i / (n - 1), k / sides), wts(p)));
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < n; i++)
    for (let k = 0; k < sides; k++) {
      const a = rings[i][k];
      const b = rings[i][(k + 1) % sides];
      const c = rings[i + 1][k];
      const d = rings[i + 1][(k + 1) % sides];
      const out = sub(buf.P(a), pts[i]);
      buf.tri(a, b, c, out);
      buf.tri(b, d, c, out);
    }
  for (const [i, sgn] of [
    [0, -1],
    [n - 1, 1],
  ]) {
    const t = T(i);
    const tipP = add(pts[i], scl(t, sgn * Math.max(radii[i] * 0.9, 0.002)));
    const apex = buf.addVertex(tipP, scl(t, sgn), uvAt(i / (n - 1), 0), wts(tipP));
    for (let k = 0; k < sides; k++) buf.tri(rings[i][k], rings[i][(k + 1) % sides], apex, scl(t, sgn));
  }
}

/**
 * The two wings: finger bones (tinted tubes), a thumb claw, and the membrane as two thin sheets
 * (top and bottom, so a single-sided material shows both), skinned to wing_L / wing_R.
 */
function makeWings() {
  const rect = { mem: -1, bone: -1, claw: -1 };
  const panels = wingPanels();
  const NS = 5; // rows from the wrist
  const NT = 5; // columns across a panel
  return {
    reserve(atlas) {
      rect.mem = atlas.addRect(WING_BOX.u1 - WING_BOX.u0, WING_BOX.v1 - WING_BOX.v0);
      rect.bone = atlas.addRect(0.12, 0.04);
      rect.claw = atlas.addRect(0.04, 0.03);
    },
    build(buf, atlas) {
      for (const side of [1, -1]) {
        const fr = wingFrame(side);
        const bone = BI[side > 0 ? 'wing_L' : 'wing_R'];
        const wingW = (u) => {
          const k = 0.55 * sstep(0.1, 0.0, u); // the edge along the body follows the body a little
          return k > 0.001 ? [[bone, 1 - k], [BI.body, k]] : [[bone, 1]];
        };
        const memUV = (u, v) => atlas.rectUV(rect.mem, (u - WING_BOX.u0) / (WING_BOX.u1 - WING_BOX.u0), (v - WING_BOX.v0) / (WING_BOX.v1 - WING_BOX.v0));
        // the membrane: a billow between the fingers, two sheets
        const TH = 0.0045;
        for (const pn of panels) {
          for (const sheet of [1, -1]) {
            const base = buf.count;
            const id = (j, i) => (j === 0 ? base : base + 1 + (j - 1) * (NT + 1) + i);
            for (let j = 0; j <= NS; j++)
              for (let i = 0; i <= (j === 0 ? 0 : NT); i++) {
                const s = j / NS;
                const t = j === 0 ? 0 : i / NT;
                const [u, v] = panelPoint(pn, s, t);
                const bil = pn.depth > 0 ? -0.03 * Math.sin(Math.PI * t) * Math.sin(Math.PI * s * 0.85) : 0;
                const p = fr.at(u, v, bil + sheet * TH);
                buf.addVertex(p, scl(fr.N, sheet), memUV(u, v), wingW(u));
              }
            const out = scl(fr.N, sheet);
            for (let j = 0; j < NS; j++)
              for (let i = 0; i < NT; i++) {
                if (j === 0) buf.tri(id(0, 0), id(1, i), id(1, i + 1), out);
                else {
                  buf.tri(id(j, i), id(j + 1, i), id(j + 1, i + 1), out);
                  buf.tri(id(j, i), id(j + 1, i + 1), id(j, i + 1), out);
                }
              }
          }
        }
        // the bones: the arm, a knuckle, three fingers; a thumb claw
        const boneUV = (s, k) => atlas.rectUV(rect.bone, s, k);
        const W3 = fr.at(...WING.W, 0.004);
        const arm = [fr.at(-0.06, 0.01, 0), fr.at(0.1, -0.035, 0.012), W3];
        addTube(buf, arm, [0.034, 0.028, 0.024], 6, boneUV, (p) => wingW(dot(sub(p, fr.S), fr.O)));
        addTube(buf, [add(W3, scl(fr.O, -0.02)), add(W3, scl(fr.O, 0.02))], [0.03, 0.03], 6, boneUV, () => [[bone, 1]]);
        for (const [tu, tv] of WING.tips) {
          const pts = [];
          const rad = [];
          for (let s = 0; s <= 3; s++) {
            const k = s / 3;
            const u = mix(WING.W[0], tu, k);
            const v = mix(WING.W[1], tv, k);
            pts.push(fr.at(u, v, 0.003 + 0.006 * Math.sin(Math.PI * k)));
            rad.push(mix(0.019, 0.006, k));
          }
          addTube(buf, pts, rad, 5, boneUV, () => [[bone, 1]]);
        }
        const cl = add(W3, add(scl(fr.N, 0.012), scl(fr.O, 0.01)));
        const clawDir = norm(add(add(scl(fr.Bk, -1), scl(fr.N, 0.6)), scl(fr.O, 0.3)));
        addTube(buf, [cl, add(cl, scl(clawDir, 0.035)), add(cl, add(scl(clawDir, 0.06), scl(fr.N, -0.012)))], [0.014, 0.009, 0.002], 5, (s, k) => atlas.rectUV(rect.claw, s, k), () => [[bone, 1]]);
      }
    },
    paint(canvas, atlas) {
      const { W, tips } = WING;
      const segD = (p, a, b) => {
        const ab = [b[0] - a[0], b[1] - a[1]];
        const t = clamp(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2), 0, 1);
        return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
      };
      // fine veins: from the wrist to the middle of each scallop, and a few side branches
      const veins = [];
      for (const pn of panels.slice(0, 3)) veins.push([W, panelPoint(pn, 0.96, 0.5)]);
      paintRect(canvas, atlas, rect.mem, (uu, vv, out) => {
        const u = mix(WING_BOX.u0, WING_BOX.u1, uu);
        const v = mix(WING_BOX.v0, WING_BOX.v1, vv);
        const p = [u, v];
        let vein = 0;
        for (const [a, b] of veins) vein = Math.max(vein, sstep(0.006, 0.002, segD(p, a, b)));
        let fing = 0;
        for (const t of tips) fing = Math.max(fing, sstep(0.03, 0.012, segD(p, W, t)));
        const rw = Math.hypot(u - W[0], v - W[1]);
        const g = 0.06 * (fbm(u * 18, v * 18, 3) - 0.5);
        // paler toward the scalloped edge (thinner skin), a soft shadow along the fingers
        let c = scl(COL.membrane, 0.9 + 0.1 * sstep(0.1, 0.35, rw) + g);
        c = scl(c, 1 - 0.12 * fing - 0.18 * vein);
        write(out, c, 0.84 + 0.12 * fing + 0.04 * vein);
      });
      paintRect(canvas, atlas, rect.bone, (s, k, out) => {
        const g = 0.7 + 0.04 * Math.sin(k * Math.PI * 2) + 0.03 * (vnoise(s * 40, k * 8, 5) - 0.5);
        write(out, [g, g, g], 1);
      });
      paintRect(canvas, atlas, rect.claw, (s, k, out) => write(out, lerp3(COL.hornBase, COL.ivory, sstep(0.1, 0.7, s)), 0));
    },
  };
}

// ---------------------------------------------------------------------------- the painting

/** Cellular noise: distances to the nearest two feature points and the nearest one's centre. */
function worley(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let f1 = 9;
  let f2 = 9;
  let c = null;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const i = xi + dx;
        const j = yi + dy;
        const k = zi + dz;
        const px = i + hash(i, j, k);
        const py = j + hash(j, k, i + 7);
        const pz = k + hash(k, i, j + 13);
        const d = Math.hypot(x - px, y - py, z - pz);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          c = [px, py, pz];
        } else if (d < f2) f2 = d;
      }
  return { f1, f2, c };
}

/** Scale shading at p: 1 inside a scale, lighter toward its top, dark in the gaps. */
function scales(p, size, flow, contrast = 1) {
  const k = 1 / size;
  const { f1, f2, c } = worley(p[0] * k, p[1] * k, p[2] * k);
  const rel = [p[0] * k - c[0], p[1] * k - c[1], p[2] * k - c[2]];
  const grad = clamp(dot(rel, flow) * 1.1, -1, 1); // + toward the scale's free (lower) edge
  const gap = sstep(0.1, 0.02, f2 - f1);
  return 1 - contrast * (0.06 * grad + 0.02 + 0.17 * gap) + contrast * 0.03 * (1 - f1);
}

/** The shell's paint at design-space point p: grey scales (tinted) and the painted parts. */
function makeSkinPainter(shape) {
  const parts = {};
  const flowBody = norm([0, -1, -0.5]);
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const [qx, qy, qz] = wf(x, y, z);
    shape.parts(x, y, z, parts);
    const dm = Math.min(parts.head, parts.hornL, parts.hornR, parts.finL, parts.finR, parts.torso, parts.armL, parts.armR, parts.tail, parts.claw, parts.spike);
    const near = (d) => (d - dm < 0.012 ? 1 : 0);
    const grain = vnoise(x * 80, y * 80, z * 80);
    const mott = fbm(x * 6 + 3, y * 6, z * 6) - 0.5;
    let base = 0.8 + 0.08 * mott + 0.03 * (grain - 0.5);
    // the back a touch darker (it reads from above), the undersides lighter
    const dorsal = sstep(0.1, 0.7, dot(n, norm([0, 0.6, -0.8]))) * (near(parts.torso) || near(parts.tail) ? 1 : 0.4);
    base *= 1 - 0.08 * dorsal;
    let sc;
    const isHead = near(parts.head);
    if (isHead) {
      // small, soft scales on the head; nearly none on the face
      const faceK = sstep(0.12, 0.3, qz) * sstep(-0.3, -0.05, qy);
      sc = scales(p, 0.034, norm(fdir(0, -0.2, -1)), 0.5 * (1 - 0.85 * faceK));
    } else if (near(parts.tail)) {
      const tl = shape.tailLine;
      sc = scales(p, 0.036, flowBody, 0.9);
      const ts = tl.param(x, y, z);
      if (ts > tl.total - 0.02 && near(parts.spade)) base *= 0.88;
    } else sc = scales(p, 0.045, flowBody, near(parts.armL) || near(parts.armR) ? 0.8 : 1);
    let col = [base * sc, base * sc, base * sc];
    if (n[1] < -0.2) col = lerp3(col, [0.88, 0.88, 0.88], 0.25 * sstep(-0.2, -0.7, n[1]));
    let c = col;
    let paint = 0;
    const cream = lerp3(COL.cream, scl(COL.cream, 0.9), 1 - (grain * 0.4 + (mott + 0.5) * 0.6));

    // the belly: cream plates from the throat down between the legs
    if (near(parts.torso) || (isHead && qy < mouthLine(qx) - 0.04)) {
      const w = 0.155 + 0.05 * sstep(0.62, 0.36, y) - 0.06 * sstep(0.2, 0.08, y);
      const ry = y > 0.42 ? 0.75 : 0.36;
      const bm = Math.hypot(x / w, (y - 0.42) / ry);
      const hw = isHead ? 0.125 : w * Math.sqrt(Math.max(0, 1 - ((y - 0.42) / ry) ** 2));
      const ax = isHead ? Math.abs(qx) : Math.abs(x);
      let k = sstep(0.01, -0.006, ax - hw) * sstep(-0.05, 0.1, z) * (y > 0.06 ? 1 : 0);
      if (isHead) k *= sstep(MOUTH_Y - 0.068 - 2.6 * qx * qx, MOUTH_Y - 0.08 - 2.6 * qx * qx, qy);
      if (k > 0) {
        const yy = y + 0.9 * x * x; // the plates curve up at the sides
        const groove = band(yy / 0.068 + 0.3, 0.13, 0.12);
        const plate = lerp3(cream, COL.plate, 0.75 * groove);
        const shade = 1 - 0.08 * sstep(0.6, 1, bm); // a rim toward the scales
        c = lerp3(c, scl(plate, shade), k);
        paint = Math.max(paint, k);
      }
    }
    if (isHead) {
      // the throat and the underside of the jaw: cream, with two plates
      const under = sstep(mouthLine(qx) - 0.035, mouthLine(qx) - 0.08, qy) * sstep(0.1, 0.45, dot(n, norm(fdir(0, -1, 0.15)))) * sstep(1, 0.8, Math.hypot(qx / 0.16, (qz - 0.12) / 0.32));
      if (under > 0) {
        const groove = band((qy - MOUTH_Y) / 0.05 + 0.1, 0.12, 0.12) * sstep(-0.12, -0.2, qy - MOUTH_Y);
        c = lerp3(c, lerp3(cream, COL.plate, 0.7 * groove), under);
        paint = Math.max(paint, under);
      }
    }
    if (near(parts.tail) && !near(parts.spade)) {
      // plates under the tail
      const k = sstep(-0.15, -0.55, n[1]);
      if (k > 0) {
        const groove = band(shape.tailLine.param(x, y, z) / 0.06, 0.14, 0.12);
        c = lerp3(c, lerp3(cream, COL.plate, 0.7 * groove), k);
        paint = Math.max(paint, k);
      }
    }
    // horns: ivory with rings, darker at the base
    for (const h of [shape.hornL, shape.hornR]) {
      const dh = h === shape.hornL ? parts.hornL : parts.hornR;
      if (dh - dm < 0.012) {
        const s = h.line.param(x, y, z) / h.line.total;
        const k = sstep(0.0, 0.004, dm - Math.min(parts.head, 1) + 0.012) * sstep(-0.02, 0.06, s);
        const ring = band(s * 5.5, 0.18, 0.1) * sstep(0.85, 0.6, s);
        const hc = scl(lerp3(COL.hornBase, COL.ivory, sstep(0.05, 0.8, s)), 1 - 0.1 * ring);
        c = lerp3(c, hc, Math.max(k, sstep(0.02, 0.08, s)));
        paint = Math.max(paint, Math.max(k, sstep(0.02, 0.08, s)));
      }
    }
    // claws and spikes: ivory
    if (near(parts.claw)) {
      c = lerp3(COL.hornBase, COL.ivory, 0.65 + 0.35 * grain);
      paint = 1;
    }
    for (const s of shape.spikes) {
      const ds = s.f(x, y, z);
      if (ds - dm < 0.01) {
        const ab = sub(s.b, s.a);
        const t = clamp(dot(sub(p, s.a), ab) / dot(ab, ab), 0, 1);
        const k = sstep(0.28, 0.42, t);
        c = lerp3(c, lerp3(COL.hornBase, COL.ivory, sstep(0.4, 0.9, t)), k);
        paint = Math.max(paint, k);
      }
    }
    // the frills: a paler, half-tinted membrane between three darker spines
    for (const fin of [shape.finL, shape.finR]) {
      const df = fin === shape.finL ? parts.finL : parts.finR;
      if (df - dm < 0.012) {
        const [s, t] = fin.fr.local(x, y, z);
        const side = fin === shape.finL ? 1 : -1;
        const ang = Math.atan2(s * side, Math.max(t, 1e-3));
        const k = sstep(0.04, 0.09, t);
        const spine = Math.max(sstep(0.016, 0.007, Math.abs(s * side - 0.01 - t * 0.04)), sstep(0.016, 0.007, Math.abs(s * side + 0.03 + t * 0.32)), sstep(0.016, 0.007, Math.abs(ang + 0.85) * t));
        const mem = scl(COL.membrane, 0.95 + 0.05 * grain);
        const fc = lerp3(mem, [0.7, 0.7, 0.7], spine);
        c = lerp3(c, fc, k);
        paint = Math.max(paint, k * (1 - spine) * 0.42);
      }
    }

    // the face
    if (isHead && qz > 0.2) {
      // nostrils: two little slits on the snout's tip
      for (const side of [1, -1]) {
        const dx = (qx - 0.058 * side) * Math.cos(0.5) - (qy + 0.07) * Math.sin(0.5) * side;
        const dy = (qx - 0.058 * side) * Math.sin(0.5) * side + (qy + 0.07) * Math.cos(0.5);
        const k = sstep(1.0, 0.75, Math.hypot(dx / 0.02, dy / 0.011));
        c = lerp3(c, COL.nostril, k);
        paint = Math.max(paint, k);
      }
      // the mouth: a wide smile, the corners curled up
      let d = Infinity;
      if (Math.abs(qx) < MOUTH_W) d = Math.abs(qy - mouthLine(qx)) * Math.cos(Math.atan(1.8 * qx));
      for (const side of [1, -1]) {
        const cx = MOUTH_W * side;
        const cy = mouthLine(MOUTH_W);
        const curl = Math.abs(Math.hypot(qx - (cx - 0.016 * side), qy - (cy + 0.004)) - 0.017);
        if (qx * side > MOUTH_W - 0.016 && qy > cy - 0.006) d = Math.min(d, curl);
      }
      const k = sstep(0.0065, 0.0035, d);
      c = lerp3(c, COL.ink, k);
      paint = Math.max(paint, k);
      // a soft blush on the cheeks
      const bl = mirror([qx, qy, qz], [0.24, -0.08], 0.045) * sstep(0.15, 0.25, qz);
      if (bl > 0.02) {
        c = lerp3(c, COL.blush, 0.55 * bl);
        paint = Math.max(paint, 0.55 * bl);
      }
    }
    for (const e of shape.eyes) {
      // the socket wall: a darker crease
      const k = sstep(EYE_R * R_SOCK + 0.004, EYE_R * R_SOCK - 0.002, len(sub(p, e.E)));
      if (k > 0) c = scl(c, 1 + 0.12 * k);
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
export function build({ texture: N = 1024, triangles = 5300, grid = 0.016 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  const shell = buildShell(f, {
    lo: [-0.7, -0.04, -0.95],
    hi: [0.75, 1.68, 0.72],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      let k = Math.hypot(qx / 0.38, (qy + 0.04) / 0.34) < 1 && qz > 0.1 ? 3.2 : 1;
      if (y > 1.2) k = Math.max(k, 1.8);
      if (y < 0.1 && z > 0.12) k = Math.max(k, 2);
      const d = shape.parts(x, y, z);
      if (d.claw < 0.02 || d.spike < 0.02 || d.spikeT < 0.02) k = Math.max(k, 2.2);
      if (Math.min(d.finL, d.finR, d.hornL, d.hornR) < 0.015) k = Math.max(k, 2);
      return k;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor);

  // the face parts and the wings
  const face = surfaceAt(f, HEAD);
  const headOnly = [[BI.head, 1]];
  const mouth = mouthInside(face, HEAD, {
    y: MOUTH_Y,
    shapes: {
      mouthOpen: [-0.038, 0.1, 0.062, 0.5, 0.01],
      surprised: [-0.03, 0.045, 0.036, 1, 0.009],
      tongue: [-0.02, 0.045, 0.022, 0.5, 0.008],
    },
  });
  // Lid shells well clear of the eyeball: its wide-open eyes (open 56 deg) turn the upper lid about 65
  // deg to shut, and a linear shape key cuts that arc's chord, so half shut (a blink's middle) the
  // default 1.1 radius sank to 0.93 of the eye's and the lid slid inside it (white tears over the iris).
  // 1.2 keeps the chord outside (1.2 cos 32.5 deg > 1); the socket (R_SOCK) widens to hold it.
  const parts = [eyelids(shape.eyes, { rUp: 1.2, rLo: 1.17 }), mouth, tongue(face, HEAD, { y: MOUTH_Y, width: 0.036, length: 0.05, depth: 0.1 })];
  const wings = makeWings();

  // UVs
  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  for (const part of parts) part.reserve(atlas);
  wings.reserve(atlas);
  atlas.layout();

  // the Body
  const body = new MeshBuffer(ALL_KEYS);
  const shellTris = appendShell(body, shell, atlas, (i, p) => {
    const w = skinOf(shape, p);
    const hw = w.reduce((s, [b, v]) => s + (b === BI.head || b === BI.ear_L || b === BI.ear_R ? v : 0), 0);
    return { weights: w, keys: faceKeysOf(f, p, shell.nor[i], hw) };
  });
  const shellCount = body.count;
  for (const part of parts) part.build(body, atlas, headOnly);
  wings.build(body, atlas);

  // the texture
  const canvas = createCanvas(N);
  paintShell(canvas, body, shellTris, makeSkinPainter(shape), {
    pos: (i) => body.P(i),
    nor: (i) => shell.nor[body.src[i]],
    ao: (i) => ao[body.src[i]],
  });
  for (const part of parts) part.paint(canvas, atlas);
  wings.paint(canvas, atlas);
  dilate(canvas, 6);

  // the eyeballs: big amber irises
  const eyes = eyeballs(shape.eyes, {
    bones: { L: BI.eye_L, R: BI.eye_R },
    pupil: 21 * DEG,
    iris: 45 * DEG,
    irisColor: (t, lit) => [mix(1.0, 0.88, t) + 0.0 * lit, mix(0.78, 0.46, t) + 0.12 * lit, mix(0.22, 0.08, t) + 0.05 * lit],
    rimColor: srgb(120, 56, 20),
  });
  const bones = BONES.map(([nm, parent, p]) => [
    nm,
    parent,
    p ??
      {
        eye_L: eyeL.E,
        eye_R: eyeR.E,
        ear_L: add(shape.finL.B, scl(shape.finL.fr.a, 0.04)),
        ear_R: add(shape.finR.B, scl(shape.finR.fr.a, 0.04)),
      }[nm],
  ]);
  return assemble({ name: 'dragonling', bones, body, eyes, map: toTexture(canvas, 'dragonling_basecolor'), fit: fitScale(body, shellCount), roughness: 0.62 });
}

export const buildDragonling = build;

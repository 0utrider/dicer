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
  toLinear,
  toTexture,
  tongue,
  vnoise,
  weights,
  write,
} from './lib/index.js';

/**
 * Dicer's imp pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a small chubby devil hovering on bat wings. A big round head tilted up toward the
 * camera with chubby cheeks, sly painted brows, yellow eyes with slit pupils, a wide grin with two
 * little fangs, pointed ears out to the sides and two small curved horns; a round body with a
 * lighter belly, short arms with clawed hands, stubby legs dangling, and a thin tail that hangs
 * from the rump and lays its spade tip on the floor (the only part that touches it: the imp
 * floats). Two bat wings (thin two-sided membranes between finger bones) on its back, skinned to
 * wing_L / wing_R.
 *
 * The skin is neutral grey (tinted by Dicer), the belly and inner ears lighter, the wing membranes
 * a lighter and the wing bones a darker tone of it; horns (dark at the root, bone at the tip),
 * claws, brows, mouth, fangs and eyes stay painted. Natural colour: devil red #b8322f.
 *
 * One fused `Body` shell (head, ears, horns, body, arms, legs, claws, tail, spade) plus eyelids,
 * the mouth's inside, a tongue and the two wings in the same mesh; `Eyes` the eyeballs (slit
 * pupils). Bones: root, body, head, eye_L/R, ear_L/R, wing_L/R, tail_1..3, arm_L/R. Shape keys:
 * all eleven of the spec.
 */

// ------------------------------------------------------------------------------- the design

const HEAD = tiltFrame([0, 1.02, 0.06], 0.55); // the face tilted up toward the top-down camera
const { fdir, wf, fw } = HEAD;

const EYE_R = 0.125;
const R_SOCK = 1.13;
const MOUTH_Y = -0.135; // the grin's middle (face-local)
const MOUTH_W = 0.155; // its half width
const NECK_Y = 0.78; // the head/body blend plane (design units)

// The tail: thin, back off the rump, hanging down, its tip laid back along the floor; the spade
// sits on the end.
const TAIL = [
  [0, 0.42, -0.19, 0.05],
  [0, 0.35, -0.32, 0.038],
  [0, 0.24, -0.39, 0.031],
  [0, 0.13, -0.41, 0.027],
  [0, 0.055, -0.45, 0.024],
  [0, 0.04, -0.55, 0.021],
];

// The wings, drawn flat in wing-local 2D (u out from the shoulder, v back): the arm to the wrist,
// three fingers fanning from it, the membrane between them and back to the body.
const WING = {
  W: [0.31, -0.06],
  tips: [
    [0.78, 0.04],
    [0.69, 0.32],
    [0.46, 0.5],
  ],
  H: [0.02, 0.34],
  droop: -0.55, // rest pose: the wing raised (rad, - up) ...
  sweep: 0.3, // ... and swept back
};
const SHOULDER = (side) => [0.12 * side, 0.71, -0.17];

const COL = {
  ink: srgb(48, 18, 22),
  brow: srgb(40, 18, 20),
  tooth: srgb(252, 248, 236),
  hornRoot: srgb(58, 42, 44),
  hornTip: srgb(238, 226, 196),
  claw: srgb(46, 34, 38),
  nostril: srgb(70, 28, 32),
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

/** A pointed ear sticking out to the side: a round cone flattened, its front (toward the camera) hollowed. */
function makeEar(side) {
  const B = fw(0.3 * side, 0.03, 0.02);
  const T = fw(0.62 * side, 0.16, -0.06);
  const fr = axisFrame(B, sub(T, B), fdir(0.15 * side, 0.45, 1));
  const L = len(sub(T, B));
  const outer = roundCone([0, 0, 0], [0, L, 0], 0.11, 0.012);
  const inner = roundCone([0, 0.05, 0], [0, L - 0.05, 0], 0.07, 0.006);
  const F = 0.42;
  return {
    B,
    fr,
    L,
    inner(x, y, z) {
      const [s, t, w] = fr.local(x, y, z);
      return inner(s, t, (w - 0.045) / F) * F;
    },
    d(x, y, z) {
      const [s, t, w] = fr.local(x, y, z);
      return smax(outer(s, t, w / F) * F, -inner(s, t, (w - 0.045) / F) * F, 0.012);
    },
  };
}

/** A small horn: round cones from the crown, up, curling out and back (face-local points). */
function makeHorn(side) {
  const pts = [
    [0.16, 0.31, 0.03, 0.056],
    [0.21, 0.41, 0.0, 0.043],
    [0.27, 0.48, -0.07, 0.029],
    [0.33, 0.5, -0.15, 0.011],
  ].map(([x, y, z, r]) => [...fw(x * side, y, z), r]);
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

/** The spade on the tail's tip: a flat arrowhead with two lobes, flat side up. */
function makeSpade() {
  const a = TAIL[TAIL.length - 2];
  const b = TAIL[TAIL.length - 1];
  const dir = norm(sub(b.slice(0, 3), a.slice(0, 3)));
  const fr = axisFrame(b.slice(0, 3), dir, [0, 1, 0]);
  const F = 0.3;
  const blade = roundCone([0, -0.01, 0], [0, 0.13, 0], 0.062, 0.006);
  const lobeL = ellipsoid([0.045, 0.012, 0], [0.042, 0.045, 0.045]);
  const lobeR = ellipsoid([-0.045, 0.012, 0], [0.042, 0.045, 0.045]);
  return {
    fr,
    d(x, y, z) {
      const [s, t, w] = fr.local(x, y, z);
      const ww = w / F;
      return smin(blade(s, t, ww), Math.min(lobeL(s, t, ww), lobeR(s, t, ww)), 0.035) * F;
    },
  };
}

function makeShape() {
  // the head (face-local)
  const skull = ellipsoid([0, 0, 0], [0.4, 0.35, 0.36]);
  const cheekL = ellipsoid([0.2, -0.12, 0.12], [0.17, 0.14, 0.17]);
  const cheekR = ellipsoid([-0.2, -0.12, 0.12], [0.17, 0.14, 0.17]);
  const chin = ellipsoid([0, -0.2, 0.15], [0.13, 0.08, 0.11]);
  const browL = ellipsoid([0.16, 0.2, 0.24], [0.11, 0.045, 0.07]);
  const browR = ellipsoid([-0.16, 0.2, 0.24], [0.11, 0.045, 0.07]);
  const nose = ellipsoid([0, -0.045, 0.335], [0.04, 0.028, 0.03]);
  const earL = makeEar(1);
  const earR = makeEar(-1);
  const hornL = makeHorn(1);
  const hornR = makeHorn(-1);
  // the body
  const torso = ellipsoid([0, 0.55, -0.02], [0.27, 0.27, 0.25]);
  const belly = ellipsoid([0, 0.52, 0.03], [0.245, 0.24, 0.235]);
  const legL = roundCone([0.12, 0.43, 0.02], [0.14, 0.31, 0.07], 0.06, 0.048);
  const legR = roundCone([-0.12, 0.43, 0.02], [-0.14, 0.31, 0.07], 0.06, 0.048);
  const footL = ellipsoid([0.145, 0.285, 0.11], [0.066, 0.046, 0.092]);
  const footR = ellipsoid([-0.145, 0.285, 0.11], [0.066, 0.046, 0.092]);
  const armL = roundCone([0.2, 0.67, 0.03], [0.26, 0.51, 0.12], 0.052, 0.042);
  const armR = roundCone([-0.2, 0.67, 0.03], [-0.26, 0.51, 0.12], 0.052, 0.042);
  const handL = ellipsoid([0.27, 0.49, 0.14], [0.058, 0.052, 0.058]);
  const handR = ellipsoid([-0.27, 0.49, 0.14], [0.058, 0.052, 0.058]);
  // claws: three on each foot (forward), three on each hand (down and forward)
  const clawDefs = [];
  for (const side of [1, -1]) {
    for (const dx of [-0.035, 0, 0.035]) {
      const a = [side * 0.145 + dx, 0.28, 0.185 - Math.abs(dx) * 0.4];
      clawDefs.push({ part: 'torso', a, b: add(a, [dx * 0.3, -0.018, 0.045]), r1: 0.017, r2: 0.004 });
    }
    for (const dx of [-0.026, 0, 0.026]) {
      const a = [side * 0.27 + dx, 0.455, 0.175];
      clawDefs.push({ part: side > 0 ? 'armL' : 'armR', a, b: add(a, [dx * 0.25, -0.035, 0.03]), r1: 0.014, r2: 0.003 });
    }
  }
  const claws = clawDefs.map((c) => ({ ...c, f: roundCone(c.a, c.b, c.r1, c.r2) }));
  const tail = coneChain(TAIL);
  const tailLine = polyline(TAIL.map((p) => p.slice(0, 3)));
  const spade = makeSpade();

  const shape = { earL, earR, hornL, hornR, tailLine, claws, eyes: [] };
  /** Distances to the parts at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    let h = smin(skull(qx, qy, qz), cheekL(qx, qy, qz), 0.08);
    h = smin(h, cheekR(qx, qy, qz), 0.08);
    h = smin(h, chin(qx, qy, qz), 0.07);
    h = smin(h, Math.min(browL(qx, qy, qz), browR(qx, qy, qz)), 0.06);
    o.head = smin(h, nose(qx, qy, qz), 0.03);
    o.earL = earL.d(x, y, z);
    o.earR = earR.d(x, y, z);
    o.hornL = hornL.d(x, y, z);
    o.hornR = hornR.d(x, y, z);
    let t = smin(torso(x, y, z), belly(x, y, z), 0.12);
    t = smin(t, Math.min(legL(x, y, z), legR(x, y, z)), 0.05);
    o.torso = smin(t, Math.min(footL(x, y, z), footR(x, y, z)), 0.035);
    o.armL = smin(armL(x, y, z), handL(x, y, z), 0.035);
    o.armR = smin(armR(x, y, z), handR(x, y, z), 0.035);
    let cl = Infinity;
    for (const c of claws) {
      const d = c.f(x, y, z);
      cl = Math.min(cl, d);
      o[c.part] = smin(o[c.part], d, 0.01);
    }
    o.claw = cl;
    o.tailBase = tail[0](x, y, z);
    let tr = tail[1](x, y, z);
    for (let i = 2; i < tail.length; i++) tr = Math.min(tr, tail[i](x, y, z));
    o.spade = spade.d(x, y, z);
    o.tailRest = smin(tr, o.spade, 0.025);
    o.tail = Math.min(o.tailBase, o.tailRest);
    return o;
  };
  const P = {};
  const union = () => {
    let hd = smin(P.head, Math.min(P.earL, P.earR), 0.035);
    hd = smin(hd, Math.min(P.hornL, P.hornR), 0.025);
    let body = smin(P.torso, P.armL, 0.04);
    body = smin(body, P.armR, 0.04);
    let d = smin(hd, body, 0.1);
    d = smin(d, P.tailBase, 0.06);
    return smin(d, P.tailRest, 0.02);
  };
  /** The imp without eye sockets (for placing the eyes and for occlusion). */
  shape.solid = (x, y, z) => {
    shape.parts(x, y, z, P);
    return smax(union(), -y, 0.02);
  };
  shape.eyes = placeEyes(shape.solid, HEAD, { r: EYE_R, x: 0.165, y: 0.045, yaw: 0.15, open: 45 * DEG });
  shape.sdf = (x, y, z) => {
    shape.parts(x, y, z, P);
    const d = carveSockets(union(), x, y, z, shape.eyes, EYE_R * R_SOCK, { k: 0.02 });
    return smax(d, -y, 0.02);
  };
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.52, -0.02]],
  ['head', 'body', [0, NECK_Y - 0.02, 0.03]],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['ear_L', 'head', null], // from the ears
  ['ear_R', 'head', null],
  ['wing_L', 'body', SHOULDER(1)],
  ['wing_R', 'body', SHOULDER(-1)],
  ['tail_1', 'body', TAIL[1].slice(0, 3)],
  ['tail_2', 'tail_1', TAIL[2].slice(0, 3)],
  ['tail_3', 'tail_2', TAIL[4].slice(0, 3)],
  ['arm_L', 'body', [0.2, 0.67, 0.03]],
  ['arm_R', 'body', [-0.2, 0.67, 0.03]],
];
const BI = boneIndex(BONES);

/** Skin weights of a shell point: head vs body by the neck plane, ears, arms, the tail chain. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  const core = Math.min(d.head, d.earL, d.earR, d.hornL, d.hornR, d.torso);
  for (const [name, v] of soft([
    ['core', core, 0.03],
    ['armL', d.armL, 0.022],
    ['armR', d.armR, 0.022],
    ['tail', d.tail, 0.025],
  ])) {
    if (name === 'core') {
      const hv = sstep(-0.06, 0.06, y - NECK_Y + 0.25 * (z - 0.05)); // the chin sits above the nape
      let ear = 0;
      let earB = null;
      for (const [e, de, b] of [
        [shape.earL, d.earL, 'ear_L'],
        [shape.earR, d.earR, 'ear_R'],
      ]) {
        const t = e.fr.local(x, y, z)[1];
        const k = sstep(0.02, 0.09, t) * Math.exp(-Math.max(0, de - Math.min(d.head, de)) / 0.03);
        if (k > ear) {
          ear = k;
          earB = b;
        }
      }
      const head = v * hv;
      if (earB) w.put(earB, head * ear);
      w.put('head', head * (1 - ear));
      w.put('body', v * (1 - hv));
    } else if (name === 'tail') {
      // the spade rests on the floor: on root, so a lean or a tail swing never pushes it through
      const rootK = sstep(0.17, 0.07, y);
      if (rootK > 0) w.put('root', v * rootK);
      const L = shape.tailLine.lens;
      chain(w, v * (1 - rootK), shape.tailLine.param(x, y, z), ['body', 'tail_1', 'tail_2', 'tail_3'], [L[1], L[2], L[4]]);
    } else w.put(name === 'armL' ? 'arm_L' : 'arm_R', v);
  }
  return w.done(BI);
}

const gauss = (q, c, s) => Math.exp(-((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - (c[2] ?? q[2])) ** 2) / (2 * s * s));
const mirror = (q, c, s) => gauss(q, c, s) + gauss(q, [-c[0], c[1], c[2]], s);
/** The painted grin: wide, the corners curled up (face-local y). */
const mouthLine = (qx) => MOUTH_Y + 1.7 * qx * qx;
/** The brow stroke over each eye: its centre line (face-local y) along |qx|, outer end raised. */
const browLine = (ax) => 0.218 + 0.3 * (ax - 0.09) * (ax - 0.09) + 0.13 * (ax - 0.09);

/** Face shape keys on the shell: displacement fields in face-local space. */
function faceKeysOf(f, p, n, headW) {
  const q = wf(...p);
  const out = {};
  if (headW < 0.01) {
    const g = gauss(p, [0, 0.5, 0.2], 0.15) * (1 - headW); // the belly puffs too
    if (g > 0.01) out.puff = scl(n, 0.035 * g);
    return out;
  }
  const fr = sstep(0.05, 0.2, q[2]) * headW;
  const corner = mirror(q, [MOUTH_W, mouthLine(MOUTH_W) - 0.004], 0.035) * fr;
  const cheek = mirror(q, [0.2, -0.1, 0.25], 0.07) * fr;
  const browIn = mirror(q, [0.09, 0.21, 0.3], 0.05) * fr;
  const browOut = mirror(q, [0.26, 0.2], 0.05) * fr;
  const brow = mirror(q, [0.165, 0.21], 0.08) * fr;
  const lip = gauss(q, [0, MOUTH_Y - 0.02], 0.04) * fr;
  // slid along the surface, so the skin never covers the mouth's inside
  const slide = (d) => (len(d) < 1e-6 ? d : sub(project(f, add(p, d)), p));
  // the lower jaw turns down about a hinge behind the mouth
  const jawW = sstep(mouthLine(q[0]) + 0.006, mouthLine(q[0]) - 0.025, q[1]) * sstep(0.19, 0.12, Math.abs(q[0])) * sstep(0.08, 0.22, q[2]) * headW;
  const jaw = (ang) => {
    if (jawW < 1e-3) return [0, 0, 0];
    const hy = MOUTH_Y + 0.01;
    const hz = 0.06;
    const dy = q[1] - hy;
    const dz = q[2] - hz;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return scl(fdir(0, dy * c - dz * s - dy, dy * s + dz * c - dz), jawW);
  };
  out.happy = add(slide(fdir(0, 0.024 * corner + 0.018 * cheek, 0)), scl(n, 0.008 * cheek));
  out.sad = slide(fdir(0, -0.02 * corner + 0.026 * browIn - 0.014 * browOut, 0));
  out.surprised = slide(add(fdir(0, 0.03 * brow, 0), jaw(0.08)));
  out.mouthOpen = add(slide(add(jaw(0.24), fdir(0, 0.006 * corner, 0))), scl(n, -0.004 * jawW));
  out.angry = add(fdir(0, -0.034 * browIn - 0.016 * brow - 0.012 * corner - 0.006 * lip, 0.016 * browIn + 0.01 * lip), scl(n, 0.006 * brow));
  out.puff = scl(n, 0.036 * mirror(q, [0.22, -0.12, 0.12], 0.09) * headW);
  out.tongue = slide(jaw(0.07));
  return out;
}

// ---------------------------------------------------------------------------- the wings

/** A wing's 3D frame at rest: wing-local (u, v, h) -> model point. */
function wingFrame(side) {
  const S = SHOULDER(side);
  const { droop: dr, sweep: sw } = WING;
  const O = [side * Math.cos(dr) * Math.cos(sw), -Math.sin(dr), -Math.cos(dr) * Math.sin(sw)];
  let Bk = norm([0, -0.3, -1]);
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
    [tips[0], tips[1], 0.22],
    [tips[1], tips[2], 0.24],
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
    if (!X) X = norm(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    else X = norm(sub(X, scl(t, dot(X, t))));
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
 * The two wings: finger bones (a darker tint), a dark thumb claw, and the membrane (a lighter
 * tint) as two thin sheets (top and bottom, so a single-sided material shows both), skinned to
 * wing_L / wing_R.
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
        addTube(buf, arm, [0.032, 0.026, 0.022], 6, boneUV, (p) => wingW(dot(sub(p, fr.S), fr.O)));
        addTube(buf, [add(W3, scl(fr.O, -0.02)), add(W3, scl(fr.O, 0.02))], [0.028, 0.028], 6, boneUV, () => [[bone, 1]]);
        for (const [tu, tv] of WING.tips) {
          const pts = [];
          const rad = [];
          for (let s = 0; s <= 3; s++) {
            const k = s / 3;
            const u = mix(WING.W[0], tu, k);
            const v = mix(WING.W[1], tv, k);
            pts.push(fr.at(u, v, 0.003 + 0.006 * Math.sin(Math.PI * k)));
            rad.push(mix(0.017, 0.005, k));
          }
          addTube(buf, pts, rad, 5, boneUV, () => [[bone, 1]]);
        }
        const cl = add(W3, add(scl(fr.N, 0.012), scl(fr.O, 0.01)));
        const clawDir = norm(add(add(scl(fr.Bk, -1), scl(fr.N, 0.6)), scl(fr.O, 0.3)));
        addTube(buf, [cl, add(cl, scl(clawDir, 0.035)), add(cl, add(scl(clawDir, 0.06), scl(fr.N, -0.012)))], [0.013, 0.008, 0.002], 5, (s, k) => atlas.rectUV(rect.claw, s, k), () => [[bone, 1]]);
      }
    },
    paint(canvas, atlas) {
      const { W, tips } = WING;
      const segD = (p, a, b) => {
        const ab = [b[0] - a[0], b[1] - a[1]];
        const t = clamp(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2), 0, 1);
        return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
      };
      // fine veins: from the wrist to the middle of each scallop
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
        const g = 0.05 * (fbm(u * 18, v * 18, 3) - 0.5);
        // a lighter tone of the skin, paler toward the scalloped edge, darker along the fingers
        const m = (0.9 + 0.08 * sstep(0.1, 0.4, rw) + g) * (1 - 0.18 * fing - 0.2 * vein);
        write(out, [m, m, m], 1);
      });
      paintRect(canvas, atlas, rect.bone, (s, k, out) => {
        const g = 0.5 + 0.04 * Math.sin(k * Math.PI * 2) + 0.03 * (vnoise(s * 40, k * 8, 5) - 0.5);
        write(out, [g, g, g], 1);
      });
      paintRect(canvas, atlas, rect.claw, (s, k, out) => write(out, lerp3(COL.claw, scl(COL.claw, 1.4), s), 0));
    },
  };
}

// ---------------------------------------------------------------------------- the eyes

/**
 * The `Eyes` mesh: yellow eyes with a vertical slit pupil. Like the library's eyeballs(), but its
 * front rings are ellipses in the eye's (X, U) plane that start as the thin slit and widen to the
 * round iris, so the slit's edge is a ring (crisp). Its `surprised` key widens the slits (a
 * startled cat-eye) instead of shrinking round pupils.
 * @returns {MeshBuffer}
 */
function slitEyeballs(eyes, { bones }) {
  const pupil = srgb(14, 10, 12);
  const iris = (t, lit) => [mix(1.0, 1.0, t), mix(0.6, 0.84, t) + 0.08 * lit, mix(0.06, 0.2, t) + 0.05 * lit];
  const rim = srgb(150, 70, 14);
  const liner = srgb(44, 18, 20);
  const white = srgb(255, 214, 92);
  // [ax, au, colour (t: -1 pupil, 0..1 iris, 'rim', 'liner', 'white'), surprised ax, au]
  const FRONT = [
    [0, 0.3, -1, 0, 0.26],
    [0.035, 0.42, -1, 0.2, 0.4],
    [0.06, 0.5, -1, 0.3, 0.47],
    [0.075, 0.535, 0, 0.33, 0.5],
    [0.2, 0.58, 0.3, 0.42, 0.57],
    [0.4, 0.64, 0.6, 0.54, 0.64],
    [0.6, 0.7, 0.85, 0.64, 0.7],
    [0.73, 0.75, 1, 0.73, 0.75],
    [0.745, 0.765, 'rim', 0.745, 0.765],
    [0.76, 0.78, 'liner', 0.76, 0.78],
    [0.82, 0.83, 'liner', 0.82, 0.83],
    [0.84, 0.85, 'white', 0.84, 0.85],
    [0.92, 0.92, 'white', 0.92, 0.92],
    [0.98, 0.98, 'white', 0.98, 0.98],
    [1, 1, 'white', 1, 1],
  ];
  const BACK = [110, 135, 160, 180].map((d) => d * DEG);
  const na = 32;
  const b = new MeshBuffer(['surprised']);
  for (const eye of eyes) {
    const R = eye.r;
    const wts = [[eye.side > 0 ? bones.L : bones.R, 1]];
    const base = b.count;
    const front = (ax, au, az) => {
      const px = ax * Math.cos(az);
      const pu = au * Math.sin(az);
      const pf = Math.sqrt(Math.max(0, 1 - px * px - pu * pu));
      return add(scl(eye.F, pf), add(scl(eye.X, px), scl(eye.U, pu)));
    };
    const back = (pol, az) => add(scl(eye.F, Math.cos(pol)), add(scl(eye.X, Math.sin(pol) * Math.cos(az)), scl(eye.U, Math.sin(pol) * Math.sin(az))));
    const nRings = FRONT.length + BACK.length;
    for (let r = 0; r < nRings; r++)
      for (let a = 0; a < na; a++) {
        const az = (a / na) * Math.PI * 2;
        let n;
        let c = white;
        let mo = {};
        if (r < FRONT.length) {
          const [ax, au, kind, sx, su] = FRONT[r];
          n = front(ax, au, az);
          const lit = 0.5 + 0.5 * -Math.sin(az) * Math.hypot(ax, au);
          if (kind === -1) c = pupil;
          else if (kind === 'rim') c = rim;
          else if (kind === 'liner') c = liner;
          else if (kind === 'white') c = white;
          else c = iris(kind, lit).map((v) => (kind >= 1 ? v * 0.75 : v));
          mo = { surprised: scl(sub(front(sx, su, az), n), R) };
        } else n = back(BACK[r - FRONT.length], az);
        b.addVertex(add(eye.E, scl(n, R)), n, null, wts, mo, toLinear(c));
      }
    for (let r = 0; r + 1 < nRings; r++)
      for (let a = 0; a < na; a++) {
        const i0 = base + r * na + a;
        const i1 = base + r * na + ((a + 1) % na);
        b.idx.push(i0, i0 + na, i1 + na, i0, i1 + na, i1);
      }
    // glints: the same direction for both eyes (one light)
    for (const [pol, az, rad] of [
      [26 * DEG, 0.55, 0.03],
      [29 * DEG, 0.55 + Math.PI, 0.013],
    ]) {
      const n0 = back(pol, az);
      const c0 = add(eye.E, scl(n0, R + 0.002));
      const gb = b.count;
      const t1 = norm(cross(n0, [0, 1, 0]));
      const t2 = cross(t1, n0);
      const seg = 10;
      const glow = [1.6, 1.6, 1.6];
      b.addVertex(add(c0, scl(n0, 0.004)), n0, null, wts, {}, glow);
      for (let s = 0; s < seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const p = add(c0, add(scl(t1, Math.cos(a) * rad), scl(t2, Math.sin(a) * rad * 0.85)));
        b.addVertex(add(eye.E, scl(norm(sub(p, eye.E)), R + 0.0015)), n0, null, wts, {}, glow);
      }
      for (let s = 0; s < seg; s++) b.idx.push(gb, gb + 1 + ((s + 1) % seg), gb + 1 + s);
    }
  }
  return b;
}

// ---------------------------------------------------------------------------- the painting

/** The shell's paint at design-space point p: grey skin (tinted) and the painted parts. */
function makeSkinPainter(shape) {
  const parts = {};
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const [qx, qy, qz] = wf(x, y, z);
    shape.parts(x, y, z, parts);
    const dm = Math.min(parts.head, parts.earL, parts.earR, parts.hornL, parts.hornR, parts.torso, parts.armL, parts.armR, parts.tail, parts.claw);
    const near = (d) => (d - dm < 0.012 ? 1 : 0);
    const grain = vnoise(x * 80, y * 80, z * 80);
    const mott = fbm(x * 6 + 3, y * 6, z * 6) - 0.5;
    let base = 0.8 + 0.07 * mott + 0.03 * (grain - 0.5);
    // the back a touch darker (it reads from above), the undersides lighter
    const dorsal = sstep(0.1, 0.7, dot(n, norm([0, 0.5, -0.85]))) * (near(parts.torso) || near(parts.tail) ? 1 : 0.4);
    base *= 1 - 0.1 * dorsal;
    let c = [base, base, base];
    if (n[1] < -0.2) c = lerp3(c, [0.88, 0.88, 0.88], 0.2 * sstep(-0.2, -0.7, n[1]));
    let paint = 0;

    // the belly: a lighter tint, a soft oval on the front of the body
    if (near(parts.torso) && z > -0.02) {
      const bm = Math.hypot(x / 0.17, (y - 0.5) / 0.19);
      const k = sstep(1.05, 0.85, bm + 0.08 * (fbm(x * 20, y * 20, z * 20) - 0.5)) * sstep(-0.02, 0.1, z);
      c = lerp3(c, [0.96, 0.96, 0.96], k);
    }
    // the inner ears: a lighter tint
    for (const e of [shape.earL, shape.earR]) {
      const di = e.inner(x, y, z);
      if (di < 0.02 && e.fr.local(x, y, z)[2] > 0) c = lerp3(c, [0.97, 0.97, 0.97], sstep(0.012, 0.0, di));
    }
    // the tail's spade a touch darker
    if (near(parts.tail) && parts.spade < parts.tail + 0.004) c = scl(c, 0.88);
    // horns: dark at the root, bone toward the tip, with faint rings
    for (const h of [shape.hornL, shape.hornR]) {
      const dh = h === shape.hornL ? parts.hornL : parts.hornR;
      if (dh - dm < 0.012) {
        const s = h.line.param(x, y, z) / h.line.total;
        const k = sstep(0.008, -0.004, dh - parts.head); // only where the horn rises out of the skull
        const ring = 0.5 + 0.5 * Math.cos(s * 30);
        const hc = scl(lerp3(COL.hornRoot, COL.hornTip, sstep(0.05, 0.85, s)), 1 - 0.07 * ring * sstep(0.85, 0.5, s));
        c = lerp3(c, hc, k);
        paint = Math.max(paint, k);
      }
    }
    // claws: dark
    if (near(parts.claw)) {
      c = lerp3(COL.claw, scl(COL.claw, 1.3), grain);
      paint = 1;
    }

    // the face
    const isHead = near(parts.head);
    if (isHead && qz > 0.15) {
      // the grin: wide, corners curled up into dimples
      let d = Infinity;
      if (Math.abs(qx) < MOUTH_W) d = Math.abs(qy - mouthLine(qx)) * Math.cos(Math.atan(3.4 * qx));
      for (const side of [1, -1]) {
        const cx = MOUTH_W * side;
        const cy = mouthLine(MOUTH_W);
        const curl = Math.abs(Math.hypot(qx - (cx - 0.016 * side), qy - (cy + 0.006)) - 0.018);
        if (qx * side > MOUTH_W - 0.016 && qy > cy - 0.004) d = Math.min(d, curl);
      }
      const k = sstep(0.0072, 0.004, d);
      // two little fangs hanging from the lip
      let fang = 0;
      let fangEdge = 0;
      for (const side of [1, -1]) {
        const fx = qx - 0.052 * side;
        const top = mouthLine(qx);
        const depth = top - qy; // > 0 below the line
        const hw = 0.017 * (1 - depth / 0.038);
        if (depth > -0.002 && depth < 0.038) {
          const e = hw - Math.abs(fx);
          fang = Math.max(fang, sstep(-0.001, 0.0015, e));
          fangEdge = Math.max(fangEdge, sstep(0.0035, 0.0, Math.abs(e)) * sstep(-0.002, 0.004, depth) * (depth < 0.036 ? 1 : 0));
        }
      }
      c = lerp3(c, COL.ink, Math.max(k, fangEdge * 0.85));
      c = lerp3(c, COL.tooth, fang * (1 - 0.6 * fangEdge));
      paint = Math.max(paint, k, fang, fangEdge);
      // two small nostrils
      for (const side of [1, -1]) {
        const kn = sstep(1.0, 0.7, Math.hypot((qx - 0.022 * side) / 0.011, (qy + 0.05) / 0.008));
        c = lerp3(c, COL.nostril, kn * 0.85);
        paint = Math.max(paint, kn * 0.85);
      }
      // the sly brows: dark strokes over the eyes, outer ends up
      const ax = Math.abs(qx);
      if (ax > 0.06 && ax < 0.3) {
        const t = (ax - 0.075) / 0.2;
        const half = 0.015 * Math.sin(Math.PI * clamp(t, 0, 1)) ** 0.6;
        const kb = sstep(half + 0.003, half - 0.002, Math.abs(qy - browLine(ax))) * (t > 0 && t < 1 ? 1 : 0);
        c = lerp3(c, COL.brow, kb);
        paint = Math.max(paint, kb);
      }
    }
    for (const e of shape.eyes) {
      // the socket wall: a darker crease
      const k = sstep(EYE_R * R_SOCK + 0.004, EYE_R * R_SOCK - 0.002, len(sub(p, e.E)));
      if (k > 0) c = scl(c, 1 - 0.12 * k);
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
export function build({ texture: N = 1024, triangles = 5200, grid = 0.016 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  const shell = buildShell(f, {
    lo: [-0.72, -0.04, -0.72],
    hi: [0.72, 1.56, 0.62],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      let k = Math.hypot(qx / 0.36, (qy + 0.02) / 0.32) < 1 && qz > 0.1 ? 3.2 : 1;
      const d = shape.parts(x, y, z);
      if (d.claw < 0.02) k = Math.max(k, 2.2);
      if (Math.min(d.earL, d.earR, d.hornL, d.hornR) < 0.015) k = Math.max(k, 2);
      if (Math.min(d.armL, d.armR) < 0.01 || d.spade < 0.01) k = Math.max(k, 1.6);
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
      mouthOpen: [-0.04, 0.11, 0.065, 0.5, 0.01],
      surprised: [-0.03, 0.05, 0.038, 1, 0.009],
      tongue: [-0.02, 0.05, 0.024, 0.5, 0.008],
    },
  });
  const parts = [eyelids(shape.eyes), mouth, tongue(face, HEAD, { y: MOUTH_Y, width: 0.036, length: 0.05, depth: 0.1 })];
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

  const eyes = slitEyeballs(shape.eyes, { bones: { L: BI.eye_L, R: BI.eye_R } });
  const bones = BONES.map(([nm, parent, p]) => [
    nm,
    parent,
    p ??
      {
        eye_L: eyeL.E,
        eye_R: eyeR.E,
        ear_L: add(shape.earL.B, scl(shape.earL.fr.a, 0.04)),
        ear_R: add(shape.earR.B, scl(shape.earR.fr.a, 0.04)),
      }[nm],
  ]);
  return assemble({ name: 'imp', bones, body, eyes, map: toTexture(canvas, 'imp_basecolor'), fit: fitScale(body, shellCount), roughness: 0.6 });
}

export const buildImp = build;

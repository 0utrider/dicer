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
  cross,
  dot,
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
  vnoise,
  weights,
  write,
} from './lib/index.js';

/**
 * Dicer's mushroom pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): an earnest little toadstool sprite. A domed cap (its head) tipped back on a sturdy
 * cream stem (its body) that runs on up into the cap through the gills underneath, a small ring
 * (annulus) round the stem, two stub arms and two round feet. The face sits on the cap's front
 * slope (big eyes, rosy cheeks, a smile) so the table's top-down camera sees it. The cap takes the
 * player's colour (grey, tinted), with round cream spots; stem, gills, cheeks and mouth stay
 * painted. Natural colour: red #c0392b.
 *
 * One fused `Body` shell (a distance field, meshed): stem, feet, arms, ring and the cap, joined to
 * the stem through its gill underside; eyelids, mouth inside and tongue in the same mesh; `Eyes`
 * the eyeballs. Bones: root, body (the stem), head (the cap), eye_L/R, arm_L/R. Shape keys: all
 * eleven of the spec (sad pulls the cap's brim down over the eyes like a hat; puff swells the cap).
 */

// ------------------------------------------------------------------------------- the design

const CAP_C = [0, 0.93, -0.03]; // the cap's centre: the middle of its rim plane
const CAP_TILT = 0.24; // tipped back, so its front slope (the face) looks up
const CAP = tiltFrame(CAP_C, CAP_TILT);
const CAP_R = 0.84; // the dome's radius
const CAP_H = 0.62; // ...and height above the rim plane
const CAP_DROP = 0.05; // the dome ellipsoid's centre below the rim plane (the rim curls in)

/** The underside's height (cap-local y) at radius rho: up toward the stem, down at the rim. */
const underY = (rho) => -0.07 + 0.12 * (1 - Math.min(1, (rho / CAP_R) ** 2));

// The face: a frame turned further up onto the dome's front slope, centred in the cap.
const FACE_TILT = CAP_TILT + 0.42;
const FACE = tiltFrame(CAP_C, FACE_TILT);
const { fdir, wf } = FACE;
const FROM = 1.3; // surfaceAt traces back from this far out along the face's forward

const EYE_R = 0.175;
const R_SOCK = 1.05;
const EYE_X = 0.22;
const EYE_Y = 0.07;
const MOUTH_Y = EYE_Y - 0.19;
const CHEEK = [0.31, EYE_Y - 0.15];
const SMILE = 5; // the painted smile's curve (y = MOUTH_Y + SMILE x^2)
const GILLS = 40;

/** The spots on the cap: [polar angle from the cap's top, azimuth (0 = front, + = the pet's left), radius (rad)]. */
const SPOTS = [
  [0.08, 2.2, 0.2],
  [0.62, 2.55, 0.17],
  [0.66, -2.45, 0.16],
  [0.95, 3.14, 0.15],
  [0.72, 1.55, 0.15],
  [0.72, -1.6, 0.15],
  [1.18, 2.05, 0.1],
  [1.18, -2.0, 0.11],
  [1.2, 1.05, 0.085],
  [1.2, -1.05, 0.085],
  [1.25, 2.7, 0.08],
  [1.24, -2.8, 0.08],
];
const SPOT_DIRS = SPOTS.map(([a, phi, r]) => [[Math.sin(a) * Math.sin(phi), Math.cos(a), Math.sin(a) * Math.cos(phi)], r]);

const COL = {
  cream: srgb(246, 236, 214),
  creamDark: srgb(226, 208, 176),
  spot: srgb(252, 246, 232),
  gill: srgb(196, 166, 122),
  ridge: srgb(236, 220, 186),
  skirt: srgb(240, 228, 200),
  shoe: srgb(228, 206, 164),
  cheek: srgb(255, 140, 160),
  ink: srgb(70, 36, 40),
};

/** A point in cap-local coordinates: rho (distance from the axis), y, its unit dome direction. */
function capLocal(x, y, z) {
  const [qx, qy, qz] = CAP.wf(x, y, z);
  return { qx, qy, qz, rho: Math.hypot(qx, qz) };
}

/** Distance (approximate) in the (rho, y) half plane to a segment a-b, radius r: a revolved capsule. */
function ringField(a, b, r) {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const l2 = bax * bax + bay * bay;
  return (rho, y) => {
    const t = Math.max(0, Math.min(1, ((rho - a[0]) * bax + (y - a[1]) * bay) / l2));
    return Math.hypot(rho - a[0] - bax * t, y - a[1] - bay * t) - r;
  };
}

/**
 * The eyes, as lib placeEyes but on a convex dome: placeEyes looks along the face frame's forward
 * and expects the surface to cover the eyeball's top (a brow); on the cap the slope falls away
 * above the eye. So each eye looks along the dome's own normal under its face-local spot (turned
 * out by `yaw`), its up toward the cap's top, sunk until `open` radians show above its centre.
 */
function placeEyesOnDome(f, { r, x, y, yaw, open }) {
  const at = surfaceAt(f, FACE, FROM);
  const eyes = [];
  for (const side of [1, -1]) {
    const s = at(x * side, y);
    const F = norm(add(scl(s.n, Math.cos(yaw)), [Math.sin(yaw) * side, 0, 0]));
    let U = CAP.fdir(0, 1, 0);
    U = norm(sub(U, scl(F, dot(U, F))));
    const X = cross(U, F);
    const opening = (E, dir) => {
      for (let a = 0; a < 89 * DEG; a += 0.25 * DEG) {
        const p = add(E, scl(add(scl(F, Math.cos(a)), scl(U, Math.sin(a) * dir)), r));
        if (f(p[0], p[1], p[2]) < 0) return a;
      }
      return 89 * DEG;
    };
    let lo = 0;
    let hi = r;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (opening(sub(s.p, scl(F, m)), 1) < open) hi = m;
      else lo = m;
    }
    const E = sub(s.p, scl(F, (lo + hi) / 2));
    eyes.push({ side, r, E, F, U, X, top: opening(E, 1), bottom: opening(E, -1) });
  }
  return eyes;
}

function makeShape() {
  const dome = ellipsoid([0, -CAP_DROP, 0], [CAP_R, CAP_H + CAP_DROP, CAP_R]);
  const stemLow = ellipsoid([0, 0.3, 0.0], [0.34, 0.34, 0.32]);
  const stemUp = roundCone([0, 0.32, 0], [0, 1.0, -0.03], 0.31, 0.21);
  const ring = ringField([0.19, 0.71], [0.32, 0.645], 0.034);
  const footL = ellipsoid([0.18, 0.065, 0.16], [0.125, 0.08, 0.16]);
  const footR = ellipsoid([-0.18, 0.065, 0.16], [0.125, 0.08, 0.16]);
  const armL = roundCone([0.26, 0.5, 0.03], [0.45, 0.39, 0.09], 0.082, 0.07);
  const armR = roundCone([-0.26, 0.5, 0.03], [-0.45, 0.39, 0.09], 0.082, 0.07);

  // The face's soft relief on the dome: a brow pad over each eye and a chubby cheek under it (so the
  // eyes sit in the cap the way they sit in a face, and the eyelids tuck under the brow and cheek).
  const bare = (x, y, z) => {
    const { qx, qy, qz, rho } = capLocal(x, y, z);
    return smax(dome(qx, qy, qz), underY(rho) - qy, 0.05);
  };
  const onDome = surfaceAt(bare, FACE, FROM);
  const pad = (fx, fy, r, sink) => {
    const z0 = wf(...onDome(fx, fy).p)[2];
    return ellipsoid([fx, fy, z0 - sink], r);
  };
  const pads = [];
  for (const side of [1, -1]) {
    pads.push(pad(side * (EYE_X - 0.01), EYE_Y + 0.15, [0.14, 0.07, 0.06], 0.045));
    pads.push(pad(side * (EYE_X + 0.03), EYE_Y - 0.15, [0.12, 0.075, 0.07], 0.045));
  }

  const shape = { eyes: [] };
  /** Distances to the parts (cap, stem, ring, feet, arms) at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const { qx, qy, qz, rho } = capLocal(x, y, z);
    const gill = 0.006 * Math.cos(Math.atan2(qx, qz) * GILLS) * sstep(0.3, 0.42, rho) * sstep(CAP_R - 0.12, CAP_R - 0.22, rho);
    let cap = dome(qx, qy, qz);
    const fq = wf(x, y, z);
    if (fq[2] > 0.3) for (const pd of pads) cap = smin(cap, pd(fq[0], fq[1], fq[2]), 0.06);
    o.cap = smax(cap, underY(rho) - qy + gill, 0.05);
    o.stem = smin(stemLow(x, y, z), stemUp(x, y, z), 0.12);
    o.ring = ring(Math.hypot(x, z + 0.015), y);
    o.feet = Math.min(footL(x, y, z), footR(x, y, z));
    o.armL = armL(x, y, z);
    o.armR = armR(x, y, z);
    return o;
  };
  const P = {};
  const union = () => {
    let d = smin(P.stem, P.feet, 0.05);
    d = smin(d, P.ring, 0.025);
    d = smin(d, P.armL, 0.04);
    d = smin(d, P.armR, 0.04);
    return smin(d, P.cap, 0.07);
  };
  /** The mushroom without eye sockets (for placing the eyes and for occlusion). */
  shape.solid = (x, y, z) => {
    shape.parts(x, y, z, P);
    return smax(union(), -y, 0.02);
  };
  shape.eyes = placeEyesOnDome(shape.solid, { r: EYE_R, x: EYE_X, y: EYE_Y, yaw: 0.1, open: 42 * DEG });
    shape.sdf = (x, y, z) => {
    shape.parts(x, y, z, P);
    const d = carveSockets(union(), x, y, z, shape.eyes, EYE_R * R_SOCK, { k: 0.022 });
    return smax(d, -y, 0.02);
  };
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const HEAD_P = [0, 0.88, -0.03];
const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.36, 0]],
  ['head', 'body', HEAD_P],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['arm_L', 'body', [0.26, 0.5, 0.03]],
  ['arm_R', 'body', [-0.26, 0.5, 0.03]],
];
const BI = boneIndex(BONES);

/** How much of the cap a point is (1 in the cap, 0 down the stem), across the gill underside. */
function capShare(p) {
  const { qy, rho } = capLocal(...p);
  return sstep(-0.1, 0.02, qy - underY(Math.max(rho, 0.2)) + 0.04);
}

/** Skin weights of a shell point: cap vs stem across the underside, arms, the feet on root. */
function skinOf(shape, p) {
  const [, y] = p;
  const d = shape.parts(...p);
  const w = weights();
  const core = Math.min(d.cap, d.stem, d.ring, d.feet);
  for (const [name, v] of soft([
    ['core', core, 0.03],
    ['armL', d.armL, 0.025],
    ['armR', d.armR, 0.025],
  ])) {
    if (name === 'core') {
      const hv = capShare(p);
      w.put('head', v * hv);
      const body = v * (1 - hv);
      const rootK = sstep(0.22, 0.06, y); // the feet and the stem's foot stay planted
      w.put('root', body * rootK);
      w.put('body', body * (1 - rootK));
    } else w.put(name === 'armL' ? 'arm_L' : 'arm_R', v);
  }
  return w.done(BI);
}

/** Face and cap shape keys on the shell: displacement fields in face-local space. */
function faceKeysOf(f, p, n, headW) {
  const out = {};
  if (headW < 0.01) return out;
  const gauss = (q, c, s) => Math.exp(-((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - (c[2] ?? q[2])) ** 2) / (2 * s * s));
  const mirror = (q, c, s) => gauss(q, c, s) + gauss(q, [-c[0], c[1], c[2]], s);
  const q = wf(...p);
  const cl = capLocal(...p);
  const top = sstep(-0.02, 0.1, cl.qy - underY(cl.rho)) * headW; // the dome (not the gills)
  const fr = sstep(0.35, 0.55, q[2]) * headW; // the face's side of the cap
  const corner = mirror(q, [0.072, MOUTH_Y + 0.024], 0.034) * fr;
  const inward = -Math.sign(q[0]) * corner; // toward the middle (a pucker)
  const cheek = mirror(q, [CHEEK[0], CHEEK[1]], 0.08) * fr;
  const browIn = mirror(q, [0.13, EYE_Y + 0.2], 0.06) * fr;
  const brow = mirror(q, [EYE_X, EYE_Y + 0.2], 0.1) * fr;
  const chin = gauss(q, [0, MOUTH_Y - 0.06], 0.06) * fr;
  const lip = gauss(q, [0, MOUTH_Y - 0.02], 0.04) * fr;
  // slid along the surface, so the skin never covers the mouth's inside
  const slide = (d) => (len(d) < 1e-6 ? d : sub(project(f, add(p, d)), p));
  out.happy = add(slide(fdir(0, 0.026 * corner + 0.02 * cheek, 0)), scl(n, 0.008 * cheek));
  // sad: a frown, and the cap's brim pulled down over the eyes like a hat: the band above the eyes
  // slides down, and the rim droops at the front and sides
  const az = Math.atan2(cl.qx, cl.qz); // 0 at the front
  const rim = sstep(CAP_R - 0.3, CAP_R - 0.02, cl.rho) * sstep(2.2, 0.6, Math.abs(az)) * headW;
  const hood = mirror(q, [EYE_X, EYE_Y + 0.2], 0.12) * fr;
  out.sad = add(slide(fdir(0.008 * inward, -0.05 * corner + 0.01 * lip - 0.045 * hood, 0)), add(scl(n, 0.012 * hood), [0, -0.1 * rim * (1 - 0.4 * Math.cos(az)), 0]));
  out.surprised = slide(fdir(0.028 * inward, 0.03 * brow - 0.012 * chin - 0.01 * corner, 0));
  out.mouthOpen = slide(fdir(0, -0.035 * chin, 0));
  out.angry = slide(fdir(0.012 * inward, -0.035 * browIn - 0.03 * corner + 0.006 * lip, 0.012 * browIn));
  // puff: the cap swells up and out
  out.puff = add(scl(n, 0.045 * top), [0, 0.03 * top * sstep(0, 0.5, cl.qy), 0]);
  out.tongue = slide(fdir(0, -0.01 * chin, 0));
  return out;
}

// ---------------------------------------------------------------------------- the painting

/** The shell's paint: the cap grey (tinted) with cream spots, a cream stem, beige gills, the face. */
function makeSkinPainter(shape) {
  const parts = {};
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    shape.parts(x, y, z, parts);
    const q = wf(x, y, z);
    const cl = capLocal(x, y, z);
    const nl = CAP.wf(x + n[0], y + n[1], z + n[2]);
    const nly = nl[1] - cl.qy; // the normal's cap-local y
    const grain = vnoise(x * 80, y * 80, z * 80);
    const dm = Math.min(parts.cap, parts.stem, parts.ring, parts.feet, parts.armL, parts.armR);
    const near = (d) => d - dm < 0.012;
    let c;
    let tint = 0;
    if (near(parts.cap) && cl.qy > underY(cl.rho) - 0.06) {
      // the dome: tinted grey, lighter on top, a little mottled; the spots cream
      const uy = underY(cl.rho);
      const domeK = sstep(uy + 0.012, uy + 0.035, cl.qy); // 1 on top, 0 on the gills (a crisp line round the rim)
      const u = norm([cl.qx / CAP_R, (cl.qy + CAP_DROP) / (CAP_H + CAP_DROP), cl.qz / CAP_R]);
      let g = 0.8 + 0.05 * sstep(0.3, 0.95, u[1]) - 0.07 * sstep(0.35, -0.1, u[1]);
      g += 0.06 * (fbm(x * 6, y * 6 + 4, z * 6) - 0.5) + 0.03 * (grain - 0.5);
      const fib = band(Math.atan2(cl.qx, cl.qz) * 26 + 2 * fbm(x * 4, y * 4, z * 4), 0.15, 0.3);
      g *= 1 - 0.03 * fib * sstep(0.6, 0.1, u[1]);
      const grey = [g, g, g];
      let spot = 0;
      for (const [s, r] of SPOT_DIRS) {
        const a = Math.acos(Math.max(-1, Math.min(1, u[0] * s[0] + u[1] * s[1] + u[2] * s[2])));
        const wob = 0.012 * (fbm(x * 18 + s[0] * 9, y * 18, z * 18 + s[2] * 9) - 0.5);
        spot = Math.max(spot, sstep(r + 0.008, r - 0.008, a + wob));
      }
      spot *= sstep(-0.1, 0.1, nly);
      const spotCol = lerp3(COL.spot, COL.creamDark, 0.15 * (1 - grain));
      // the gills: radial furrows, darker deep in toward the stem
      const th = Math.atan2(cl.qx, cl.qz);
      const fur = band((th / (2 * Math.PI)) * GILLS + 0.5, 0.35, 0.25);
      let gillCol = lerp3(COL.ridge, COL.gill, 0.75 * fur * sstep(CAP_R - 0.02, CAP_R - 0.12, cl.rho));
      gillCol = scl(gillCol, mix(0.8, 1, sstep(0.25, 0.6, cl.rho)));
      c = lerp3(gillCol, lerp3(grey, spotCol, spot), domeK);
      tint = domeK * (1 - spot);
    } else {
      // the stem, ring, arms and feet: cream with fine vertical fibres and a few freckles
      const fibre = fbm(Math.atan2(x, z) * 9, y * 1.5, 3) - 0.5;
      const streak = vnoise(Math.atan2(x, z) * 40, y * 2.5, 7) - 0.5; // fine vertical fibres
      let k = 0.5 + 0.8 * fibre + 0.5 * streak + 0.25 * (grain - 0.5) + 0.35 * sstep(0.35, 0.05, y);
      if (near(parts.feet)) k += 0.8 * sstep(0.18, 0.1, y);
      c = lerp3(COL.cream, COL.creamDark, Math.max(0, Math.min(1, k * 0.5)));
      if (near(parts.feet)) c = lerp3(c, COL.shoe, sstep(0.16, 0.08, y) * 0.7);
      if (near(parts.ring)) c = lerp3(COL.skirt, COL.creamDark, sstep(0.0, -0.6, n[1]) * 0.6);
      const freckle = sstep(0.82, 0.88, vnoise(x * 30, y * 30, z * 30)) * 0.25;
      c = lerp3(c, COL.creamDark, freckle);
      if (n[1] < -0.3) c = scl(c, 0.92);
    }
    // the face, on the cap's front slope
    if (q[2] > 0.3 && tint > 0) {
      let paint = 0;
      // rosy cheeks: soft ovals
      for (const side of [1, -1]) {
        const dc = Math.hypot((q[0] - CHEEK[0] * side) / 0.075, (q[1] - CHEEK[1]) / 0.05);
        const k = sstep(1.15, 0.55, dc) * 0.85;
        c = lerp3(c, COL.cheek, k);
        paint = Math.max(paint, k);
      }
      // the smile: a curved line, corners up, a dimple at each end
      const halfW = 0.075;
      const cy = MOUTH_Y + SMILE * q[0] * q[0];
      let dmo = Infinity;
      if (Math.abs(q[0]) < halfW) dmo = Math.abs(q[1] - cy);
      for (const side of [1, -1]) dmo = Math.min(dmo, Math.hypot(q[0] - halfW * side, q[1] - (MOUTH_Y + SMILE * halfW * halfW)) * 1.2);
      const km = sstep(0.0095, 0.006, dmo);
      c = lerp3(c, COL.ink, km);
      paint = Math.max(paint, km);
      tint *= 1 - paint;
    }
    for (const e of shape.eyes) {
      // the socket wall: a soft crease
      const k = sstep(EYE_R * R_SOCK + 0.004, EYE_R * R_SOCK - 0.002, len(sub(p, e.E)));
      if (k > 0) c = scl(c, 1 - 0.12 * k);
    }
    write(o, scl(c, ao), tint);
  };
}

// ------------------------------------------------------------------------------- the build

/**
 * @param {{texture?: number, triangles?: number, grid?: number}} [o] texture size, target triangles
 *   for the fused shell, surface-nets grid spacing (design units)
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 6900, grid = 0.014 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  const shell = buildShell(f, {
    lo: [-0.95, -0.04, -0.95],
    hi: [0.95, 1.65, 0.95],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const q = wf(x, y, z);
      let k = Math.hypot(q[0] / 0.44, (q[1] - EYE_Y + 0.07) / 0.3) < 1 && q[2] > 0.3 ? 3.5 : 1;
      const cl = capLocal(x, y, z);
      const uy = underY(cl.rho);
      if (y < 0.9 && cl.qy < uy - 0.05) k = Math.max(k, Math.abs(x) > 0.22 && y > 0.3 && y < 0.6 ? 2.2 : 1.2); // stem, arms
      if (y < 0.16 && z > 0.02) k = Math.max(k, 1.8); // the feet
      if (Math.abs(Math.hypot(x, z) - 0.28) < 0.1 && Math.abs(y - 0.68) < 0.07) k = Math.max(k, 2); // the ring
      if (cl.rho > CAP_R - 0.1 && Math.abs(cl.qy - uy) < 0.08) k = Math.max(k, 2.4); // the rim
      else if (cl.rho < CAP_R - 0.1 && cl.rho > 0.3 && cl.qy < uy + 0.02 && cl.qy > uy - 0.05) k = Math.min(k, 0.6); // the gills, rarely seen
      return k;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor, { min: 0.72 });

  const face = surfaceAt(f, FACE, FROM);
  const headOnly = [[BI.head, 1]];
  const lidMotions = {
    blink: [{ close: 1 }, { close: 1 }],
    squint: [{ close: 0.5 }, { close: 0.32 }],
    happy: [8, 24],
    sad: [{ deg: 22, roll: -0.6 }, 0],
    angry: [{ deg: 32, roll: 0.8 }, 10],
    surprised: [-8, -6],
  };
  const parts = [
    eyelids(shape.eyes, { motions: lidMotions, fur: 0.8, rUp: 1.11, rLo: 1.075, margin: 9 * DEG, meet: 0, lash: COL.ink }),
    mouthInside(face, FACE, {
      y: MOUTH_Y,
      shapes: { mouthOpen: [-0.05, 0.075, 0.07, 0.5, 0.009], surprised: [-0.04, 0.042, 0.044, 1, 0.009], tongue: [-0.024, 0.032, 0.024, 0.6, 0.008] },
      fangs: false,
    }),
    tongue(face, FACE, { y: MOUTH_Y, length: 0.05, width: 0.034 }),
  ];

  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  for (const part of parts) part.reserve(atlas);
  atlas.layout();

  const body = new MeshBuffer(ALL_KEYS);
  const shellTris = appendShell(body, shell, atlas, (i, p) => {
    const w = skinOf(shape, p);
    const hw = w.reduce((s, [b, v]) => s + (b === BI.head ? v : 0), 0);
    return { weights: w, keys: faceKeysOf(f, p, shell.nor[i], hw) };
  });
  const shellCount = body.count;
  for (const part of parts) part.build(body, atlas, headOnly);

  const canvas = createCanvas(N);
  paintShell(canvas, body, shellTris, makeSkinPainter(shape), {
    pos: (i) => body.P(i),
    nor: (i) => shell.nor[body.src[i]],
    ao: (i) => ao[body.src[i]],
  });
  for (const part of parts) part.paint(canvas, atlas);
  dilate(canvas, 6);

  const eyes = eyeballs(shape.eyes, {
    bones: { L: BI.eye_L, R: BI.eye_R },
    pupil: 24 * DEG,
    iris: 46 * DEG,
    irisColor: (t, lit) => [mix(0.36, 0.2, t) + 0.16 * lit, mix(0.24, 0.13, t) + 0.1 * lit, mix(0.16, 0.09, t) + 0.05 * lit],
    rimColor: srgb(30, 20, 16),
    na: 24,
  });
  const bones = BONES.map(([nm, parent, p]) => [nm, parent, p ?? { eye_L: eyeL.E, eye_R: eyeR.E }[nm]]);
  return assemble({ name: 'mushroom', bones, body, eyes, map: toTexture(canvas, 'mushroom_basecolor'), fit: fitScale(body, shellCount), roughness: 0.7 });
}

export const buildMushroom = build;

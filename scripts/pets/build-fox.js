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
  srgb,
  sstep,
  sub,
  surfaceAt,
  tiltFrame,
  toTexture,
  tongue,
  vnoise,
  weights,
  whiskers,
  write,
} from './lib/index.js';

/**
 * Dicer's fox pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a seated chibi fox, a head with a long pointed muzzle, a black nose, white cheek
 * ruffs, narrow sly eyes under slanted brows and big upright ears with dark tips, a slim seated
 * body with a cream bib, black socks on all four feet and a big bushy tail wrapped round its right
 * side to its front paws, with a cream tip. Orange fur (tinted by Dicer, painted a light grey),
 * cream muzzle, cheeks, chest, inner ears and tail tip, dark socks, ear tips and nose. Natural
 * colour: fox orange #d9682a.
 *
 * One fused `Body` shell (a distance field, meshed), eyelids, mouth inside, tongue and whiskers
 * in the same mesh; `Eyes` the eyeballs. Bones: root, body, head, eye_L/R, ear_L/R, tail_1..3,
 * arm_L/R. Shape keys: all eleven of the spec.
 */

// ------------------------------------------------------------------------------- the design

const HEAD = tiltFrame([0, 1.0, 0.04], 0.52); // the face tilted up toward the top-down camera
const { fdir, wf } = HEAD;
const HC = HEAD.center;

const EYE_R = 0.12;
const R_SOCK = 1.13;
const MOUTH_Y = -0.172;
const NECK_Y = 0.74; // the head/body blend plane (design units)

// The brush: round cones from inside the haunch, round the fox's right side (-X) to its front,
// full in the middle.
const TAIL = [
  [-0.02, 0.24, -0.3, 0.075],
  [-0.12, 0.16, -0.47, 0.105],
  [-0.32, 0.155, -0.56, 0.135],
  [-0.52, 0.16, -0.44, 0.155],
  [-0.6, 0.16, -0.19, 0.162],
  [-0.56, 0.15, 0.07, 0.152],
  [-0.43, 0.13, 0.27, 0.12],
  [-0.26, 0.1, 0.37, 0.06],
];

const COL = {
  cream: srgb(247, 240, 228),
  dark: srgb(46, 36, 34),
  nose: srgb(28, 22, 22),
  noseHi: srgb(70, 60, 60),
  innerEar: srgb(242, 228, 214),
  ink: srgb(48, 30, 30),
};

/** An ear: a tall round cone flattened front to back, its front hollowed. */
function makeEar(side) {
  const B = add(HC, [0.165 * side, 0.2, -0.06]);
  const Tp = add(HC, [0.33 * side, 0.63, -0.085]);
  const ax = norm(sub(Tp, B));
  let fn = norm([0.28 * side, 0, 1]);
  fn = norm(sub(fn, scl(ax, dot(fn, ax))));
  const sd = cross(ax, fn);
  const L = len(sub(Tp, B));
  const outer = roundCone([0, 0, 0], [0, L, 0], 0.15, 0.02);
  const inner = roundCone([0, 0.05, 0], [0, L - 0.05, 0], 0.1, 0.008);
  const F = 0.48;
  const local = (x, y, z) => {
    const p = [x - B[0], y - B[1], z - B[2]];
    return [dot(p, sd), dot(p, ax), dot(p, fn)];
  };
  return {
    B,
    ax,
    L,
    local,
    inner(x, y, z) {
      const [s, t, w] = local(x, y, z);
      return inner(s, t, (w - 0.05) / F) * F;
    },
    d(x, y, z) {
      const [s, t, w] = local(x, y, z);
      return smax(outer(s, t, w / F) * F, -inner(s, t, (w - 0.05) / F) * F, 0.015);
    },
  };
}

/** Slanted brows over the eyes (inner ends low: the sly look), from the placed eyes. */
function makeBrows(eyes) {
  return eyes.map((e) => {
    const c = add(e.E, add(scl(e.U, EYE_R * 0.86), scl(e.F, EYE_R * 0.42)));
    const inward = scl(e.X, -e.side); // X points to the pet's left; inward is toward the middle
    const a = add(add(c, scl(inward, 0.085)), scl(e.U, -0.03));
    const b = add(add(c, scl(inward, -0.09)), scl(e.U, 0.022));
    return roundCone(a, b, 0.04, 0.032);
  });
}

function makeShape() {
  const head = ellipsoid([0, 0.02, -0.02], [0.36, 0.33, 0.33]);
  const cheekL = ellipsoid([0.2, -0.12, 0.06], [0.2, 0.15, 0.19]);
  const cheekR = ellipsoid([-0.2, -0.12, 0.06], [0.2, 0.15, 0.19]);
  const ruffL = roundCone([0.27, -0.13, 0.02], [0.44, -0.25, -0.05], 0.09, 0.022);
  const ruffR = roundCone([-0.27, -0.13, 0.02], [-0.44, -0.25, -0.05], 0.09, 0.022);
  const muzzle = roundCone([0, -0.07, 0.15], [0, -0.12, 0.47], 0.14, 0.036);
  const jaw = ellipsoid([0, -0.168, 0.27], [0.08, 0.05, 0.15]);
  const nose = ellipsoid([0, -0.105, 0.5], [0.042, 0.032, 0.032]);
  const earL = makeEar(1);
  const earR = makeEar(-1);
  const haunch = ellipsoid([0, 0.29, -0.08], [0.31, 0.3, 0.32]);
  const chest = ellipsoid([0, 0.5, 0.04], [0.2, 0.26, 0.2]);
  const thighL = ellipsoid([0.2, 0.19, -0.04], [0.14, 0.17, 0.22]);
  const thighR = ellipsoid([-0.2, 0.19, -0.04], [0.14, 0.17, 0.22]);
  const footL = ellipsoid([0.22, 0.045, 0.17], [0.075, 0.05, 0.12]);
  const footR = ellipsoid([-0.22, 0.045, 0.17], [0.075, 0.05, 0.12]);
  const legL = roundCone([0.11, 0.52, 0.14], [0.11, 0.08, 0.24], 0.07, 0.056);
  const legR = roundCone([-0.11, 0.52, 0.14], [-0.11, 0.08, 0.24], 0.07, 0.056);
  const pawL = ellipsoid([0.11, 0.048, 0.28], [0.072, 0.05, 0.09]);
  const pawR = ellipsoid([-0.11, 0.048, 0.28], [0.072, 0.05, 0.09]);
  const tail = coneChain(TAIL);
  const tailLine = polyline(TAIL.map((p) => p.slice(0, 3)));

  const shape = { earL, earR, eyes: [], tailLine };
  /** Distances to the parts (head, ears, body, legs, tail) at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    let h = smin(head(qx, qy, qz), cheekL(qx, qy, qz), 0.07);
    h = smin(h, cheekR(qx, qy, qz), 0.07);
    h = smin(h, smin(ruffL(qx, qy, qz), ruffR(qx, qy, qz), 0.01), 0.05);
    // the muzzle a little flattened top to bottom
    h = smin(h, muzzle(qx, -0.09 + (qy + 0.09) / 0.84, qz) * 0.84, 0.06);
    h = smin(h, jaw(qx, qy, qz), 0.04);
    o.head = smin(h, nose(qx, qy, qz), 0.015);
    o.earL = earL.d(x, y, z);
    o.earR = earR.d(x, y, z);
    let t = smin(haunch(x, y, z), chest(x, y, z), 0.12);
    t = smin(t, smin(thighL(x, y, z), thighR(x, y, z), 0.01), 0.06);
    o.torso = smin(t, Math.min(footL(x, y, z), footR(x, y, z)), 0.04);
    o.armL = smin(legL(x, y, z), pawL(x, y, z), 0.035);
    o.armR = smin(legR(x, y, z), pawR(x, y, z), 0.035);
    o.tailBase = tail[0](x, y, z);
    let tr = tail[1](x, y, z);
    for (let i = 2; i < tail.length; i++) tr = smin(tr, tail[i](x, y, z), 0.03);
    o.tailRest = tr;
    o.tail = Math.min(o.tailBase, tr);
    o.brow = shape.brows.length ? Math.min(shape.brows[0](x, y, z), shape.brows[1](x, y, z)) : Infinity;
    return o;
  };
  shape.brows = [];
  const P = {};
  const union = () => {
    let hd = smin(P.head, P.earL, 0.04);
    hd = smin(hd, P.earR, 0.04);
    let body = smin(P.torso, P.armL, 0.05);
    body = smin(body, P.armR, 0.05);
    let d = smin(hd, body, 0.1);
    d = smin(d, P.tailBase, 0.07);
    return Math.min(d, P.tailRest);
  };
  /** The fox without eye sockets or brows (for placing the eyes). */
  const bare = (x, y, z) => {
    shape.parts(x, y, z, P);
    return smax(union(), -y, 0.02);
  };
  shape.eyes = placeEyes(bare, HEAD, { r: EYE_R, x: 0.155, y: 0.05, yaw: 0.2, open: 40 * DEG });
  shape.brows = makeBrows(shape.eyes);
  /** The fox without eye sockets, with brows (for occlusion). */
  shape.solid = (x, y, z) => {
    shape.parts(x, y, z, P);
    return smax(smin(union(), P.brow, 0.03), -y, 0.02);
  };
  // sockets carved before the brows go on (they shade the top of each eye) and the floor cut
  shape.sdf = (x, y, z) => {
    shape.parts(x, y, z, P);
    let d = carveSockets(union(), x, y, z, shape.eyes, EYE_R * R_SOCK);
    d = smin(d, P.brow, 0.02);
    return smax(d, -y, 0.02);
  };
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.32, -0.02]],
  ['head', 'body', [0, NECK_Y - 0.02, 0.04]],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['ear_L', 'head', null], // from the ears
  ['ear_R', 'head', null],
  ['tail_1', 'body', TAIL[1].slice(0, 3)],
  ['tail_2', 'tail_1', TAIL[3].slice(0, 3)],
  ['tail_3', 'tail_2', TAIL[5].slice(0, 3)],
  ['arm_L', 'body', [0.11, 0.5, 0.145]],
  ['arm_R', 'body', [-0.11, 0.5, 0.145]],
];
const BI = boneIndex(BONES);

/** Skin weights of a shell point: head vs body by the neck plane, ears, legs, the tail chain. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  const core = Math.min(d.head, d.earL, d.earR, d.torso, d.brow);
  for (const [name, v] of soft([
    ['core', core, 0.03],
    ['armL', d.armL, 0.025],
    ['armR', d.armR, 0.025],
    ['tail', d.tail, 0.025],
  ])) {
    if (name === 'core') {
      const hv = sstep(-0.06, 0.06, y - NECK_Y + 0.18 * (z - 0.05)); // the chin sits above the nape
      let ear = 0;
      let earB = null;
      for (const [e, de, b] of [
        [shape.earL, d.earL, 'ear_L'],
        [shape.earR, d.earR, 'ear_R'],
      ]) {
        const t = e.local(x, y, z)[1];
        const k = sstep(0.02, 0.1, t) * Math.exp(-Math.max(0, de - Math.min(d.head, de)) / 0.03);
        if (k > ear) {
          ear = k;
          earB = b;
        }
      }
      const head = v * hv;
      if (earB) w.put(earB, head * ear);
      w.put('head', head * (1 - ear));
      const body = v * (1 - hv);
      const rootK = sstep(0.2, 0.05, y); // the seat stays planted when the body leans
      w.put('root', body * rootK);
      w.put('body', body * (1 - rootK));
    } else if (name === 'tail') {
      const L = shape.tailLine.lens;
      chain(w, v, shape.tailLine.param(x, y, z), ['body', 'tail_1', 'tail_2', 'tail_3'], [L[1], L[3], L[5]]);
    } else w.put(name === 'armL' ? 'arm_L' : 'arm_R', v);
  }
  return w.done(BI);
}

/** Face shape keys on the shell: displacement fields in face-local space. */
function faceKeysOf(f, p, n, headW) {
  const gauss = (q, c, s) => Math.exp(-((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - (c[2] ?? q[2])) ** 2) / (2 * s * s));
  const mirror = (q, c, s) => gauss(q, c, s) + gauss(q, [-c[0], c[1], c[2]], s);
  const q = wf(...p);
  const out = {};
  if (headW < 0.01) {
    const g = gauss(p, [0, 0.5, 0.25], 0.14) * (1 - headW); // the chest puffs too
    if (g > 0.01) out.puff = scl(n, 0.035 * g);
    return out;
  }
  const fr = sstep(0.05, 0.2, q[2]) * headW;
  const corner = mirror(q, [0.05, MOUTH_Y + 0.004, 0.32], 0.035) * fr;
  const cheek = mirror(q, [0.18, -0.12, 0.2], 0.075) * fr;
  const browIn = mirror(q, [0.08, 0.15, 0.28], 0.05) * fr;
  const browOut = mirror(q, [0.24, 0.17], 0.05) * fr;
  const brow = mirror(q, [0.15, 0.18], 0.08) * fr;
  const chin = gauss(q, [0, -0.2, 0.26], 0.06) * fr;
  const lip = gauss(q, [0, MOUTH_Y - 0.015, 0.36], 0.035) * fr;
  // slid along the surface, so the skin never covers the mouth's inside
  const slide = (d) => (len(d) < 1e-6 ? d : sub(project(f, add(p, d)), p));
  out.happy = add(slide(fdir(0, 0.02 * corner + 0.016 * cheek, 0)), scl(n, 0.006 * cheek));
  out.sad = slide(fdir(0, -0.016 * corner + 0.02 * browIn - 0.012 * browOut, 0));
  out.surprised = slide(fdir(0, 0.026 * brow - 0.008 * chin, 0));
  out.mouthOpen = slide(fdir(0, -0.03 * chin, 0));
  out.angry = fdir(0, -0.026 * browIn - 0.012 * corner - 0.006 * lip, 0.012 * browIn + 0.012 * lip);
  out.puff = scl(n, 0.03 * mirror(q, [0.24, -0.12, 0.08], 0.1) * headW);
  out.tongue = slide(fdir(0, -0.008 * chin, 0));
  return out;
}

// ---------------------------------------------------------------------------- the painting

/** The shell's paint at design-space point p: orange fur (tinted grey) and the painted markings. */
function makeSkinPainter(shape) {
  const [eyeL, eyeR] = shape.eyes;
  const parts = {};
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const [qx, qy, qz] = wf(x, y, z);
    shape.parts(x, y, z, parts);
    const dm = Math.min(parts.head, parts.earL, parts.earR, parts.torso, parts.armL, parts.armR, parts.tail, parts.brow);
    const near = (d) => (d - dm < 0.015 ? 1 : 0);
    const grain = vnoise(x * 90, y * 90, z * 90);
    const wob = fbm(x * 9 + 3, y * 9, z * 9) - 0.5;
    let fur = 0.8 + 0.08 * wob + 0.05 * (grain - 0.5);
    let col = [fur, fur, fur];
    if (near(parts.tail)) {
      // the brush: long fur strokes along the tail, a touch darker toward the tip
      const ts = shape.tailLine.param(x, y, z);
      const strand = vnoise(ts * 40, Math.atan2(y - 0.15, x) * 6, 0) - 0.5;
      fur = 0.8 + 0.07 * strand + 0.05 * wob;
      col = [fur, fur, fur];
    } else if (near(parts.torso) || near(parts.head)) {
      // a slightly darker saddle along the back
      const back = sstep(-0.05, -0.25, z) * sstep(0.15, 0.4, y) * sstep(0.2, 0.05, Math.abs(x));
      col = scl(col, 1 - 0.1 * back);
    }
    if (n[1] < -0.2) col = lerp3(col, [0.9, 0.9, 0.9], 0.2 * sstep(-0.2, -0.7, n[1])); // undersides lighter

    // painted (untinted) regions
    let paint = 0;
    const creamTone = 1 - (grain * 0.4 + fbm(x * 7, y * 7, z * 7) * 0.6);
    const cream = lerp3(COL.cream, [COL.cream[0] * 0.9, COL.cream[1] * 0.9, COL.cream[2] * 0.88], creamTone);
    let c = col;
    const edge = 0.012 * (fbm(x * 30, y * 30, z * 30) - 0.5);
    if (near(parts.head) && !near(parts.earL) && !near(parts.earR) && qz > -0.08) {
      // the white lower face: under the muzzle, the cheeks and the ruffs; the top of the muzzle stays orange
      const line = -0.098 + 0.3 * Math.max(0, Math.abs(qx) - 0.07) - 0.05 * sstep(0.32, 0.48, qz);
      const k = sstep(line + 0.008, line - 0.008, qy + edge) * sstep(-0.08, 0.02, qz);
      paint = Math.max(paint, k);
    }
    if (near(parts.torso) || near(parts.head)) {
      // chest bib: from the chin down between the front legs
      const bib = Math.hypot(x / (0.12 + 0.07 * sstep(0.75, 0.4, y)), (y - 0.52) / 0.32);
      if (z > -0.02) paint = Math.max(paint, sstep(1.05, 0.9, bib + 0.12 * (fbm(x * 25, y * 25, z * 25) - 0.5)) * sstep(-0.02, 0.1, z));
    }
    if (near(parts.tail)) {
      const ts = shape.tailLine.param(x, y, z);
      const total = shape.tailLine.total;
      paint = Math.max(paint, sstep(total - 0.2, total - 0.15, ts + 0.03 * wob));
    }
    c = lerp3(c, cream, paint);
    // dark socks: the front legs from the wrist down and the hind feet
    let dark = 0;
    if (near(parts.armL) || near(parts.armR)) dark = sstep(0.27, 0.24, y + 0.02 * wob);
    if (near(parts.torso)) {
      const foot = Math.min(Math.hypot((x - 0.22) / 0.1, (y - 0.04) / 0.08, (z - 0.17) / 0.14), Math.hypot((x + 0.22) / 0.1, (y - 0.04) / 0.08, (z - 0.17) / 0.14));
      dark = Math.max(dark, sstep(1.05, 0.95, foot));
    }
    for (const e of [shape.earL, shape.earR]) {
      const [, t, w] = e.local(x, y, z);
      // dark ear tips (front and back), the backs darker further down
      if (near(e === shape.earL ? parts.earL : parts.earR)) dark = Math.max(dark, sstep(e.L * 0.6, e.L * 0.66, t + 0.02 * wob + (w < 0 ? 0.08 : 0)));
      // inner ears: cream fluff with a pale rim
      const di = e.inner(x, y, z);
      if (di < 0.03 && w > 0 && t < e.L * 0.6) {
        const k = sstep(0.014, 0.0, di);
        c = lerp3(c, COL.innerEar, k);
        paint = Math.max(paint, k);
      }
    }
    if (dark > 0) {
      const dk = lerp3(COL.dark, [COL.dark[0] * 1.3, COL.dark[1] * 1.3, COL.dark[2] * 1.3], grain);
      c = lerp3(c, dk, dark);
      paint = Math.max(paint, dark);
    }
    if (qz > 0.4) {
      // the nose: a rounded black button with a highlight
      const dn = Math.hypot(qx / 0.05, (qy + 0.105) / 0.04);
      const k = sstep(1.05, 0.9, dn);
      if (k > 0) {
        c = lerp3(c, lerp3(COL.nose, COL.noseHi, sstep(0.6, 0.1, Math.hypot(qx / 0.05, (qy + 0.09) / 0.02)) * 0.6), k);
        paint = Math.max(paint, k);
      }
    }
    if (qz > 0.22) {
      // mouth: a line down from the nose, then a little "w"
      let d = Infinity;
      if (qy < -0.135 && qy > MOUTH_Y) d = Math.abs(qx);
      for (const side of [1, -1])
        if (qy < MOUTH_Y + 0.004 && Math.abs(qx) < 0.056) d = Math.min(d, Math.abs(Math.hypot(qx - 0.024 * side, qy - MOUTH_Y) - 0.024));
      const k = sstep(0.006, 0.0032, d);
      c = lerp3(c, COL.ink, k);
      paint = Math.max(paint, k);
    }
    for (const e of [eyeL, eyeR]) {
      // the socket wall: a darker crease (the eyeliner is on the eyeball's edge)
      const k = sstep(EYE_R * R_SOCK + 0.004, EYE_R * R_SOCK - 0.002, len(sub(p, e.E)));
      if (k > 0) c = scl(c, 1 - 0.22 * k);
    }
    if ((near(parts.armL) || near(parts.armR)) && y < 0.1 && z > 0.3) {
      // toes: two little grooves on each front paw
      const cx = x > 0 ? 0.11 : -0.11;
      for (const dx of [-0.023, 0.023]) c = lerp3(c, [0.12, 0.1, 0.1], sstep(0.006, 0.003, Math.abs(x - cx - dx)) * sstep(0.1, 0.06, y) * 0.8);
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
export function build({ texture: N = 1024, triangles = 5800, grid = 0.02 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  // the fused shell; the face, ears and paws kept denser
  const shell = buildShell(f, {
    lo: [-0.84, -0.04, -0.72],
    hi: [0.66, 1.72, 0.66],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      let k = Math.hypot(qx / 0.34, (qy + 0.06) / 0.26) < 1 && qz > 0.12 ? 3 : 1;
      if (y > 1.2) k = Math.max(k, 2);
      if (y < 0.13 && z > 0.12) k = Math.max(k, 1.6);
      return k;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor);

  // the face parts
  const face = surfaceAt(f, HEAD);
  const headOnly = [[BI.head, 1]];
  const parts = [
    eyelids(shape.eyes),
    mouthInside(face, HEAD, {
      y: MOUTH_Y,
      shapes: { mouthOpen: [-0.032, 0.052, 0.045, 0.6, 0.009], surprised: [-0.032, 0.026, 0.028, 1, 0.009], tongue: [-0.018, 0.024, 0.018, 0.6, 0.008] },
    }),
    tongue(face, HEAD, { y: MOUTH_Y, below: 0.04, length: 0.04, width: 0.026 }),
    whiskers(face, HEAD, { y: MOUTH_Y + 0.035, x: 0.065, length: 0.18, color: srgb(52, 44, 44) }),
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
    const hw = w.reduce((s, [b, v]) => s + (b === BI.head ? v : 0), 0);
    return { weights: w, keys: faceKeysOf(f, p, shell.nor[i], hw) };
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

  // the eyeballs (amber irises) and the scene, 1.5 tall
  const eyes = eyeballs(shape.eyes, {
    bones: { L: BI.eye_L, R: BI.eye_R },
    irisColor: (t, lit) => [mix(0.96, 0.78, t) + 0.04 * lit, mix(0.66, 0.4, t) + 0.1 * lit, mix(0.16, 0.08, t)],
    rimColor: srgb(92, 46, 20),
  });
  const bones = BONES.map(([n, parent, p]) => [
    n,
    parent,
    p ??
      {
        eye_L: eyeL.E,
        eye_R: eyeR.E,
        ear_L: add(shape.earL.B, scl(shape.earL.ax, 0.06)),
        ear_R: add(shape.earR.B, scl(shape.earR.ax, 0.06)),
      }[n],
  ]);
  return assemble({ name: 'fox', bones, body, eyes, map: toTexture(canvas, 'fox_basecolor'), fit: fitScale(body, shellCount) });
}

export const buildFox = build;

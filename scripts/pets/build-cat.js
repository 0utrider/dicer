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
 * Dicer's cat pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a seated chibi cat, a big wide head with cheeks, whisker pads, a little nose and big
 * eyes, pointed ears with hollow insides, a pear-shaped body with thighs, hind feet and two front
 * legs, and a tail curled round its left side to its front paws. Grey tabby fur (tinted by Dicer),
 * cream muzzle, chest and socks, pink nose and inner ears. Natural colour: ginger #e08a2c.
 *
 * One fused `Body` shell (a distance field, meshed), eyelids, mouth inside, tongue and whiskers
 * in the same mesh; `Eyes` the eyeballs. Bones: root, body, head, eye_L/R, ear_L/R, tail_1..3,
 * arm_L/R. Shape keys: all eleven of the spec.
 */

// ------------------------------------------------------------------------------- the design

const HEAD = tiltFrame([0, 1.0, 0.06], 0.52); // the face tilted up toward the top-down camera
const { fdir, wf } = HEAD;
const HC = HEAD.center;

const EYE_R = 0.13;
const R_SOCK = 1.13;
const MOUTH_Y = -0.112;
const NECK_Y = 0.74; // the head/body blend plane (design units)

// The tail: round cones from inside the haunch, round the cat's left side to its front.
const TAIL = [
  [0, 0.2, -0.33, 0.075],
  [0.1, 0.1, -0.46, 0.07],
  [0.28, 0.068, -0.46, 0.066],
  [0.42, 0.066, -0.29, 0.064],
  [0.465, 0.066, -0.05, 0.062],
  [0.43, 0.072, 0.17, 0.058],
  [0.31, 0.095, 0.355, 0.052],
];

const COL = {
  cream: srgb(248, 241, 228),
  nose: srgb(232, 132, 146),
  noseDark: srgb(196, 92, 110),
  innerEar: srgb(240, 168, 176),
  ink: srgb(58, 40, 46),
};

/** An ear: a round cone flattened front to back, its front hollowed. */
function makeEar(side) {
  const B = add(HC, [0.2 * side, 0.235, -0.035]);
  const Tp = add(HC, [0.315 * side, 0.5, -0.04]);
  const ax = norm(sub(Tp, B));
  let fn = norm([0.32 * side, 0, 1]);
  fn = norm(sub(fn, scl(ax, dot(fn, ax))));
  const sd = cross(ax, fn);
  const L = len(sub(Tp, B));
  const outer = roundCone([0, 0, 0], [0, L, 0], 0.125, 0.024);
  const inner = roundCone([0, 0.045, 0], [0, L - 0.035, 0], 0.082, 0.008);
  const F = 0.5;
  const local = (x, y, z) => {
    const p = [x - B[0], y - B[1], z - B[2]];
    return [dot(p, sd), dot(p, ax), dot(p, fn)];
  };
  return {
    B,
    ax,
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

function makeShape() {
  const head = ellipsoid([0, 0, 0], [0.4, 0.35, 0.36]);
  const cheekL = ellipsoid([0.235, -0.11, 0.07], [0.225, 0.165, 0.215]);
  const cheekR = ellipsoid([-0.235, -0.11, 0.07], [0.225, 0.165, 0.215]);
  const padL = ellipsoid([0.06, -0.128, 0.3], [0.075, 0.06, 0.062]);
  const padR = ellipsoid([-0.06, -0.128, 0.3], [0.075, 0.06, 0.062]);
  const chin = ellipsoid([0, -0.198, 0.262], [0.064, 0.045, 0.05]);
  const nose = ellipsoid([0, -0.058, 0.345], [0.04, 0.028, 0.03]);
  const earL = makeEar(1);
  const earR = makeEar(-1);
  const haunch = ellipsoid([0, 0.29, -0.07], [0.33, 0.3, 0.33]);
  const chest = ellipsoid([0, 0.5, 0.05], [0.22, 0.25, 0.21]);
  const thighL = ellipsoid([0.21, 0.19, -0.03], [0.15, 0.17, 0.23]);
  const thighR = ellipsoid([-0.21, 0.19, -0.03], [0.15, 0.17, 0.23]);
  const footL = ellipsoid([0.235, 0.045, 0.19], [0.082, 0.052, 0.118]);
  const footR = ellipsoid([-0.235, 0.045, 0.19], [0.082, 0.052, 0.118]);
  const legL = roundCone([0.12, 0.52, 0.15], [0.12, 0.08, 0.25], 0.075, 0.062);
  const legR = roundCone([-0.12, 0.52, 0.15], [-0.12, 0.08, 0.25], 0.075, 0.062);
  const pawL = ellipsoid([0.12, 0.05, 0.285], [0.08, 0.055, 0.095]);
  const pawR = ellipsoid([-0.12, 0.05, 0.285], [0.08, 0.055, 0.095]);
  const tail = coneChain(TAIL);
  const tailLine = polyline(TAIL.map((p) => p.slice(0, 3)));

  const shape = { earL, earR, eyes: [], tailLine };
  /** Distances to the parts (head, ears, body, legs, tail) at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    let h = smin(head(qx, qy, qz), cheekL(qx, qy, qz), 0.07);
    h = smin(h, cheekR(qx, qy, qz), 0.07);
    h = smin(h, smin(padL(qx, qy, qz), padR(qx, qy, qz), 0.03), 0.04);
    h = smin(h, chin(qx, qy, qz), 0.04);
    o.head = smin(h, nose(qx, qy, qz), 0.02);
    o.earL = earL.d(x, y, z);
    o.earR = earR.d(x, y, z);
    let t = smin(haunch(x, y, z), chest(x, y, z), 0.12);
    t = smin(t, smin(thighL(x, y, z), thighR(x, y, z), 0.01), 0.06);
    o.torso = smin(t, Math.min(footL(x, y, z), footR(x, y, z)), 0.04);
    o.armL = smin(legL(x, y, z), pawL(x, y, z), 0.035);
    o.armR = smin(legR(x, y, z), pawR(x, y, z), 0.035);
    o.tailBase = tail[0](x, y, z);
    let tr = tail[1](x, y, z);
    for (let i = 2; i < tail.length; i++) tr = Math.min(tr, tail[i](x, y, z));
    o.tailRest = tr;
    o.tail = Math.min(o.tailBase, tr);
    return o;
  };
  const P = {};
  /** The cat without eye sockets (for placing the eyes and for occlusion). */
  shape.solid = (x, y, z) => {
    shape.parts(x, y, z, P);
    let hd = smin(P.head, P.earL, 0.04);
    hd = smin(hd, P.earR, 0.04);
    let body = smin(P.torso, P.armL, 0.05);
    body = smin(body, P.armR, 0.05);
    let d = smin(hd, body, 0.1);
    d = smin(d, P.tailBase, 0.07);
    d = Math.min(d, P.tailRest);
    return smax(d, -y, 0.02);
  };
  shape.eyes = placeEyes(shape.solid, HEAD, { r: EYE_R, x: 0.168, y: 0.04, yaw: 0.1, open: 42 * DEG });
  // sockets carved before the floor cut, as designed
  shape.sdf = (x, y, z) => {
    shape.parts(x, y, z, P);
    let hd = smin(P.head, P.earL, 0.04);
    hd = smin(hd, P.earR, 0.04);
    let body = smin(P.torso, P.armL, 0.05);
    body = smin(body, P.armR, 0.05);
    let d = smin(hd, body, 0.1);
    d = smin(d, P.tailBase, 0.07);
    d = Math.min(d, P.tailRest);
    d = carveSockets(d, x, y, z, shape.eyes, EYE_R * R_SOCK);
    return smax(d, -y, 0.02);
  };
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.32, -0.02]],
  ['head', 'body', [0, NECK_Y - 0.02, 0.05]],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['ear_L', 'head', null], // from the ears
  ['ear_R', 'head', null],
  ['tail_1', 'body', TAIL[1].slice(0, 3)],
  ['tail_2', 'tail_1', TAIL[3].slice(0, 3)],
  ['tail_3', 'tail_2', TAIL[5].slice(0, 3)],
  ['arm_L', 'body', [0.12, 0.5, 0.155]],
  ['arm_R', 'body', [-0.12, 0.5, 0.155]],
];
const BI = boneIndex(BONES);

/** Skin weights of a shell point: head vs body by the neck plane, ears, legs, the tail chain. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  const core = Math.min(d.head, d.earL, d.earR, d.torso);
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
        const k = sstep(0.02, 0.09, t) * Math.exp(-Math.max(0, de - Math.min(d.head, de)) / 0.03);
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
  const corner = mirror(q, [0.058, MOUTH_Y - 0.008], 0.03) * fr;
  const cheek = mirror(q, [0.17, -0.1, 0.25], 0.07) * fr;
  const browIn = mirror(q, [0.09, 0.17, 0.3], 0.05) * fr;
  const browOut = mirror(q, [0.25, 0.15], 0.05) * fr;
  const brow = mirror(q, [0.16, 0.18], 0.08) * fr;
  const chin = gauss(q, [0, -0.19], 0.055) * fr;
  const lip = gauss(q, [0, MOUTH_Y - 0.02], 0.035) * fr;
  // slid along the surface, so the skin never covers the mouth's inside
  const slide = (d) => (len(d) < 1e-6 ? d : sub(project(f, add(p, d)), p));
  out.happy = add(slide(fdir(0, 0.02 * corner + 0.016 * cheek, 0)), scl(n, 0.006 * cheek));
  out.sad = slide(fdir(0, -0.016 * corner + 0.02 * browIn - 0.012 * browOut, 0));
  out.surprised = slide(fdir(0, 0.026 * brow - 0.008 * chin, 0));
  out.mouthOpen = slide(fdir(0, -0.028 * chin, 0));
  out.angry = fdir(0, -0.026 * browIn - 0.012 * corner - 0.006 * lip, 0.012 * browIn + 0.012 * lip);
  out.puff = scl(n, 0.032 * mirror(q, [0.25, -0.1, 0.1], 0.1) * headW);
  out.tongue = slide(fdir(0, -0.008 * chin, 0));
  return out;
}

// ---------------------------------------------------------------------------- the painting

/** The shell's paint at design-space point p: grey tabby fur (tinted) and the painted markings. */
function makeSkinPainter(shape) {
  const [eyeL, eyeR] = shape.eyes;
  const parts = {};
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const [qx, qy, qz] = wf(x, y, z);
    shape.parts(x, y, z, parts);
    const dm = Math.min(parts.head, parts.earL, parts.earR, parts.torso, parts.armL, parts.armR, parts.tail);
    const near = (d) => (d - dm < 0.015 ? 1 : 0);
    const grain = vnoise(x * 90, y * 90, z * 90);
    let fur = 0.8 + 0.09 * (fbm(x * 7 + 3, y * 7, z * 7) - 0.5) + 0.05 * (grain - 0.5);
    // tabby stripes
    let s = 0;
    const wob = 0.25 * (fbm(x * 5, y * 5 + 9, z * 5) - 0.5);
    if (near(parts.head) && !near(parts.earL) && !near(parts.earR)) {
      const lon = Math.atan2(qx, qz);
      const lat = Math.atan2(qy, Math.hypot(qx, qz));
      for (const c of [0, 0.3, -0.3]) {
        // the forehead stripes over the crown
        const w = mix(0.045, 0.09, sstep(0.6, 1.4, lat)) * (c === 0 ? 1 : 0.9);
        s = Math.max(s, sstep(w, w * 0.55, Math.abs(lon - c + wob * 0.2) * Math.cos(lat)) * sstep(0.62, 0.78, lat) * sstep(-0.32, -0.15, -qz));
      }
      if (qz < -0.05) s = Math.max(s, band(lon / 0.38 + wob, 0.22) * sstep(-0.05, -0.2, qz) * sstep(-0.9, -0.2, lat + 0.3));
      for (const side of [1, -1]) {
        // cheeks: two strokes back from each eye
        if (qx * side < 0.27) continue;
        for (const yy of [-0.02, -0.1]) {
          const d = Math.abs(qy - yy - 0.25 * (Math.abs(qx) - 0.27) + wob * 0.05);
          s = Math.max(s, sstep(0.02, 0.009, d) * sstep(0.27, 0.32, qx * side) * sstep(-0.2, 0.05, qz));
        }
      }
    } else if (near(parts.torso)) {
      const a = Math.atan2(x, -(z + 0.05)); // 0 at the back
      s = Math.max(s, band(y * 6.5 + 0.22 * a * a + wob, 0.24) * sstep(1.9, 1.2, Math.abs(a)) * sstep(0.08, 0.18, y));
      if (Math.abs(a) < 0.12 && y > 0.25) s = Math.max(s, sstep(0.12, 0.06, Math.abs(a)));
    } else if (near(parts.armL) || near(parts.armR)) {
      s = band(y * 10 + wob, 0.32) * sstep(0.13, 0.2, y) * (Math.abs(x) > 0.1 || z > 0.2 ? 1 : 0.3);
    } else if (near(parts.tail)) {
      const ts = shape.tailLine.param(x, y, z);
      const total = shape.tailLine.total;
      s = band(ts * 7.5 + wob * 0.6, 0.36) * sstep(0.12, 0.22, ts);
      if (ts > total - 0.1) s = Math.max(s, sstep(total - 0.1, total - 0.05, ts));
    } else fur *= 0.93; // ear backs a touch darker
    let col = lerp3([fur, fur, fur], [fur * 0.64, fur * 0.64, fur * 0.66], s);
    if (n[1] < -0.2) col = lerp3(col, [0.9, 0.9, 0.9], 0.25 * sstep(-0.2, -0.7, n[1])); // undersides lighter

    // painted (untinted) regions
    let paint = 0;
    const cream = lerp3(COL.cream, [COL.cream[0] * 0.9, COL.cream[1] * 0.9, COL.cream[2] * 0.88], 1 - (grain * 0.4 + fbm(x * 7, y * 7, z * 7) * 0.6));
    if (near(parts.head) && qz > 0.12) {
      // muzzle, chin and the blaze up the nose
      const pads = Math.min(Math.hypot((qx - 0.06) / 0.1, (qy + 0.13) / 0.085), Math.hypot((qx + 0.06) / 0.1, (qy + 0.13) / 0.085));
      const chin = Math.hypot(qx / 0.085, (qy + 0.19) / 0.075);
      const bridge = Math.hypot(qx / (0.03 + 0.06 * sstep(0.1, -0.06, qy)), (qy + 0.01) / 0.12);
      const m = Math.min(pads, chin, bridge * 1.02);
      paint = Math.max(paint, sstep(1.04, 0.92, m + 0.1 * (fbm(x * 30, y * 30, z * 30) - 0.5)) * sstep(0.12, 0.2, qz));
    }
    if (near(parts.torso) || near(parts.head)) {
      // chest bib, hind feet
      const bib = Math.hypot(x / (0.13 + 0.06 * sstep(0.7, 0.35, y)), (y - 0.5) / 0.3);
      if (z > -0.02) paint = Math.max(paint, sstep(1.05, 0.9, bib + 0.12 * (fbm(x * 25, y * 25, z * 25) - 0.5)) * sstep(-0.02, 0.1, z));
      const foot = Math.min(Math.hypot((x - 0.235) / 0.1, (y - 0.04) / 0.075, (z - 0.2) / 0.13), Math.hypot((x + 0.235) / 0.1, (y - 0.04) / 0.075, (z - 0.2) / 0.13));
      paint = Math.max(paint, sstep(1.05, 0.95, foot));
    }
    if (near(parts.armL) || near(parts.armR)) paint = Math.max(paint, sstep(0.125, 0.105, y + 0.01 * (fbm(x * 40, y * 40, z * 40) - 0.5)));
    let c = lerp3(col, cream, paint);
    for (const e of [shape.earL, shape.earR]) {
      // inner ears: pink with a pale rim
      const di = e.inner(x, y, z);
      if (di < 0.03 && e.local(x, y, z)[2] > 0) {
        const k = sstep(0.012, 0.0, di);
        const tuft = sstep(0.02, 0.006, di) * (1 - k);
        c = lerp3(lerp3(c, COL.innerEar, k), COL.cream, tuft * 0.6);
        paint = Math.max(paint, k, tuft * 0.6);
      }
    }
    if (qz > 0.28) {
      // nose: an inverted rounded triangle
      const ny = qy + 0.058;
      const halfW = 0.042 * sstep(-0.05, 0.016, ny);
      const inside = ny < 0.02 && ny > -0.04 && Math.abs(qx) < halfW;
      const edge = Math.min(0.02 - ny, ny + 0.04, halfW - Math.abs(qx));
      if (inside || edge > -0.004) {
        const k = sstep(-0.003, 0.003, edge);
        c = lerp3(c, lerp3(COL.noseDark, COL.nose, sstep(0.0, 0.012, edge)), k);
        paint = Math.max(paint, k);
      }
    }
    if (qz > 0.2) {
      // mouth: a line down from the nose, then the "w"; whisker dots
      let d = Infinity;
      if (qy < -0.098 && qy > MOUTH_Y) d = Math.abs(qx);
      for (const side of [1, -1])
        if (qy < MOUTH_Y + 0.004 && Math.abs(qx) < 0.066) d = Math.min(d, Math.abs(Math.hypot(qx - 0.029 * side, qy - MOUTH_Y) - 0.029));
      const k = sstep(0.0065, 0.0035, d);
      c = lerp3(c, COL.ink, k);
      paint = Math.max(paint, k);
      for (const side of [1, -1])
        for (const [dx, dy] of [
          [0.045, -0.125],
          [0.07, -0.118],
          [0.06, -0.142],
          [0.085, -0.138],
        ])
          c = lerp3(c, [0.55, 0.47, 0.45], sstep(0.0075, 0.0045, Math.hypot(qx - dx * side, qy - dy)) * 0.8);
    }
    for (const e of [eyeL, eyeR]) {
      // the socket wall: a darker crease (the eyeliner is on the eyeball's edge)
      const k = sstep(EYE_R * R_SOCK + 0.004, EYE_R * R_SOCK - 0.002, len(sub(p, e.E)));
      if (k > 0) c = scl(c, 1 - 0.22 * k);
    }
    if ((near(parts.armL) || near(parts.armR)) && y < 0.1 && z > 0.3) {
      // toes: two little grooves on each front paw
      const cx = x > 0 ? 0.12 : -0.12;
      for (const dx of [-0.025, 0.025]) c = lerp3(c, [0.7, 0.62, 0.6], sstep(0.006, 0.003, Math.abs(x - cx - dx)) * sstep(0.1, 0.06, y) * 0.8);
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
export function build({ texture: N = 1024, triangles = 5600, grid = 0.02 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  // the fused shell; the face, ears and paws kept denser
  const shell = buildShell(f, {
    lo: [-0.62, -0.04, -0.62],
    hi: [0.64, 1.6, 0.6],
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
  const parts = [eyelids(shape.eyes), mouthInside(face, HEAD, { y: MOUTH_Y }), tongue(face, HEAD, { y: MOUTH_Y }), whiskers(face, HEAD, { y: MOUTH_Y })];

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

  // the eyeballs and the scene, 1.5 tall
  const eyes = eyeballs(shape.eyes, { bones: { L: BI.eye_L, R: BI.eye_R } });
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
  return assemble({ name: 'cat', bones, body, eyes, map: toTexture(canvas, 'cat_basecolor'), fit: fitScale(body, shellCount) });
}

export const buildCat = build;

import {
  DEG,
  MeshBuffer,
  REQUIRED_KEYS,
  add,
  appendShell,
  assemble,
  boneIndex,
  buildShell,
  createAtlas,
  createCanvas,
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
 * Dicer's ghost pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a friendly little sheet ghost. One continuous sheet: a round dome flowing into a
 * softly flared hem of eight rounded scallops whose tips just touch the floor, two stubby arm nubs
 * folded out of the sheet, big dark oval eyes with glints high on the front (read from above), a
 * small "o" mouth and blush cheeks. Light grey cloth (tinted by Dicer) with soft folds running down
 * into the scallop valleys and a faint glow toward the hem. Natural colour: #b9c4e8.
 *
 * One fused `Body` shell (a distance field, meshed), eyelids and the mouth in the same mesh; `Eyes`
 * the eyeballs (stretched into ovals). Bones: root, body, head, eye_L/R, arm_L/R, tail_1..3 (the
 * back of the hem). Shape keys: blink_L/R, happy, sad, surprised, mouthOpen, angry, squint_L/R,
 * puff.
 */

// ------------------------------------------------------------------------------- the design

const KEYS = [...REQUIRED_KEYS, 'squint_L', 'squint_R', 'puff'];

// One sheet: an ellipsoid dome down to HT (a little below its middle), then a hem that leaves it on
// its tangent and flares softly to the floor (a Hermite curve), so there is no step or seam.
const DOME_C = [0, 0.8, 0];
const DOME_R = [0.75, 0.7, 0.72]; // half width, half height, half depth
const HT = 0.74; // where the dome flows into the hem
const HEM = 0.9; // the hem's flare at the floor
const HEM_SLOPE = 0.5; // its outward slope at the floor (dr/dy, going down)
const SCALLOPS = 8;
const VALLEY = 0.17; // how high the valleys between the hem's tips ride

const HEAD = tiltFrame([0, 0.8, 0], 0.72); // the face tilted up toward the top-down camera
const { fdir, wf } = HEAD;

const EYE_R = 0.142;
const EYE_SU = 1.24; // eyeball stretch along its up: big ovals
const EYE_SX = 0.94;
const R_SOCK = 1.15;
const EYE_X = 0.235;
const EYE_Y = 0.0;
const MOUTH_Y = -0.24;
const CHEEK = [0.36, -0.22];

const COL = {
  blush: srgb(255, 138, 160),
  ink: srgb(34, 30, 52),
  lash: srgb(52, 48, 74),
};

// The arm nubs: soft folds of the sheet, out at the front sides and drooping.
const ARM = (side) => ({
  a: [0.52 * side, 0.73, 0.17],
  b: [0.83 * side, 0.5, 0.37],
  pivot: [0.63 * side, 0.67, 0.25],
});

/** 1 at a hem tip, 0 in a valley (round lobes, pinched valleys); the front is a tip. */
const lobe = (x, z) => Math.sqrt(0.5 + 0.5 * Math.cos(SCALLOPS * Math.atan2(x, z)));

/** The dome's radius (unit ellipse scale) at height y, and its slope there. */
const domeK = (y) => Math.sqrt(Math.max(0, 1 - ((y - DOME_C[1]) / DOME_R[1]) ** 2));
const K_J = domeK(HT);
const M_J = ((DOME_C[1] - HT) / DOME_R[1] ** 2) / K_J; // d(k)/dy at HT

/** The hem's radius scale (1 = the dome's half width) and its slope d/dy at height y <= HT. */
function hemK(y) {
  const t = Math.min(1, Math.max(0, (HT - y) / HT));
  const t2 = t * t;
  const t3 = t2 * t;
  const k1 = HEM / DOME_R[0];
  const m0 = -M_J * HT; // dk/dt at the seam (t grows downward)
  const m1 = (HEM_SLOPE * HT) / DOME_R[0];
  const k = (2 * t3 - 3 * t2 + 1) * K_J + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * k1 + (t3 - t2) * m1;
  const dk = (6 * t2 - 6 * t) * K_J + (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) * k1 + (3 * t2 - 2 * t) * m1;
  return [k, -dk / HT];
}

function makeShape() {
  const dome = ellipsoid(DOME_C, DOME_R);
  const arms = [1, -1].map((side) => {
    const A = ARM(side);
    return { side, ...A, d: roundCone(A.a, A.b, 0.12, 0.068) };
  });
  const shape = { arms, eyes: [] };

  /** Distances to the parts (sheet, arms) at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const rho = Math.hypot(x, z);
    const w = lobe(x, z);
    // the hem: radius scale k at y on an elliptic cross-section (the dome's width and depth)
    const [k, dk] = hemK(y);
    const bulge = 1 + 0.06 * w * sstep(0.22, 0, y); // the lobes flare out a touch at the floor
    const re = Math.hypot(x / DOME_R[0], z / DOME_R[2]);
    const hem = ((re - k * bulge) * DOME_R[0]) / Math.sqrt(1 + (dk * DOME_R[0]) ** 2);
    let d = mix(hem, dome(x, y, z), sstep(HT - 0.02, HT + 0.02, y));
    // the scalloped hem: the valleys ride up; underneath, a shallow hollow
    const cut = mix(0.13, VALLEY * (1 - w * w), sstep(0.38, 0.7, rho));
    o.sheet = smax(d, cut - y, 0.045);
    o.armL = arms[0].d(x, y, z);
    o.armR = arms[1].d(x, y, z);
    d = smin(o.sheet, smin(o.armL, o.armR, 0.01), 0.13);
    o.all = d;
    return o;
  };
  const P = {};
  /** The ghost without eye sockets (for placing the eyes and for occlusion). */
  shape.solid = (x, y, z) => shape.parts(x, y, z, P).all;
  shape.eyes = placeEyes(shape.solid, HEAD, { r: EYE_R, x: EYE_X, y: EYE_Y, yaw: 0.16, open: 45 * DEG, range: [0.3, 0.85] });
  shape.sdf = (x, y, z) => carveOvalSockets(shape.solid(x, y, z), x, y, z, shape.eyes, EYE_R * R_SOCK);
  return shape;
}

// ------------------------------------------------------------------------- the oval eyes

/** The eye's stretch (about its centre, in its own frame): oval eyeballs, sockets and lids. */
function stretch(eye) {
  const { E, X, U, F } = eye;
  const lin = (v, sx, su) => {
    const a = dot(v, X) * sx;
    const b = dot(v, U) * su;
    const c = dot(v, F);
    return add(add(scl(X, a), scl(U, b)), scl(F, c));
  };
  return {
    point: (p) => add(E, lin(sub(p, E), EYE_SX, EYE_SU)),
    vec: (v) => lin(v, EYE_SX, EYE_SU),
    normal: (n) => norm(lin(n, 1 / EYE_SX, 1 / EYE_SU)),
    inv: (p) => add(E, lin(sub(p, E), 1 / EYE_SX, 1 / EYE_SU)),
  };
}

/** carveSockets with each socket stretched like its eye (an ellipsoid). */
function carveOvalSockets(d, x, y, z, eyes, radius, back = 0.03, k = 0.05) {
  for (const e of eyes) {
    const v = [x - e.E[0], y - e.E[1], z - e.E[2]];
    const a = dot(v, e.X) / EYE_SX;
    const b = dot(v, e.U) / EYE_SU;
    const c = dot(v, e.F);
    const sph = (Math.hypot(a, b, c) - radius) * Math.min(EYE_SX, EYE_SU, 1);
    const pl = -(c + back);
    d = smax(d, -Math.max(sph, pl), k);
  }
  return d;
}

/** Stretches buffer vertices [from, to) (positions, normals, shape keys) by the eye's stretch. */
function stretchRange(buf, from, to, eye) {
  const s = stretch(eye);
  for (let i = from; i < to; i++) {
    const p = s.point(buf.P(i));
    const n = s.normal(buf.nor.slice(i * 3, i * 3 + 3));
    buf.pos.splice(i * 3, 3, ...p);
    buf.nor.splice(i * 3, 3, ...n);
    for (const k of buf.keys) {
      const m = buf.morph[k];
      const v = s.vec([m[i * 3], m[i * 3 + 1], m[i * 3 + 2]]);
      m.splice(i * 3, 3, ...v);
    }
  }
}

/** Eyelid motions: happy pushes the lower lid well up (the eyes become happy arcs). */
const LIDS = {
  blink: [{ close: 1 }, { close: 1 }],
  squint: [{ close: 0.5 }, { close: 0.35 }],
  happy: [6, { close: 0.6 }],
  sad: [{ deg: 18, roll: -0.7 }, 4],
  angry: [{ deg: 26, roll: 0.8 }, 10],
  surprised: [-7, -9],
};

/**
 * The eyelids of one eye: lib eyelids, then stretched with the eye. The upper lid hides further
 * back (the dome curves away above the eye, so its rim is wider there).
 */
function ovalLids(eye) {
  const o = { motions: LIDS, rUp: 1.11, rLo: 1.085, meet: 10 * DEG, fur: 0.84, lash: COL.lash, extra: 40 * DEG };
  const up = eyelids([eye], { ...o, margin: 16 * DEG });
  const lo = eyelids([eye], { ...o, margin: 8 * DEG });
  up.lids.splice(1, 1); // [upper, lower] each: keep one
  lo.lids.splice(0, 1);
  const lids = [up, lo];
  return {
    reserve: (atlas) => lids.forEach((l) => l.reserve(atlas)),
    build(buf, atlas, wts) {
      const from = buf.count;
      lids.forEach((l) => l.build(buf, atlas, wts));
      stretchRange(buf, from, buf.count, eye);
    },
    paint(canvas, atlas) {
      // tinted cloth, a little darker toward the edge, and a clear dark lash line (closed eyes
      // read as a curved line)
      for (const l of [...up.lids, ...lo.lids])
        paintRect(canvas, atlas, l.rect, (u, v, out) => {
          const g = 0.84 * (1 - 0.08 * sstep(0.4, 0.05, v)) + 0.02 * (vnoise(u * 30, v * 12, l.upper ? 1 : 7) - 0.5);
          const k = sstep(0.11, 0.06, v) * sstep(0.0, 0.08, Math.min(u, 1 - u));
          write(out, lerp3([g, g, g], COL.lash, k), 1 - k);
        });
    },
  };
}

/**
 * The Eyes: dark glossy beads with two glints, stretched into ovals; `surprised` widens them a
 * touch.
 */
function ovalEyes(eyes, bones) {
  const dark = (t, lit) => [mix(0.1, 0.17, t) + 0.12 * lit * t, mix(0.09, 0.15, t) + 0.1 * lit * t, mix(0.17, 0.3, t) + 0.16 * lit * t];
  const buf = eyeballs(eyes, {
    bones,
    pupil: 18 * DEG,
    iris: 52 * DEG,
    irisColor: dark,
    pupilColor: srgb(20, 18, 32),
    rimColor: srgb(26, 24, 40),
    linerColor: srgb(22, 20, 34),
    white: srgb(24, 22, 36),
    glints: [
      [27 * DEG, Math.PI - 0.75, 0.05],
      [30 * DEG, -0.7, 0.022],
    ],
  });
  for (let i = 0; i < buf.count; i++) {
    const eye = buf.si[i * 4] === bones.L ? eyes[0] : eyes[1];
    const p = buf.P(i);
    buf.morph.surprised.splice(i * 3, 3, ...scl(sub(p, eye.E), 0.05));
    stretchRange(buf, i, i + 1, eye);
  }
  return buf;
}

// ------------------------------------------------------------------------------- the mouth

/**
 * The "o" mouth: a small dark disc laid on the face (offset out a little); each key reshapes it
 * into another oval laid on the surface. shapes: key -> [dy, half width, half height, top
 * flattening, bottom flattening]. `follow(p)` adds the skin's own key deltas at p (so it rides the
 * puff and the cheeks).
 */
function mouthO(face, { y, shapes, rest, follow, skin, rect = [0.1, 0.1], rings = 4, segs = 20 }) {
  let r = -1;
  const OFF = 0.004;
  const at = ([dy, ax, ay, ft, fb]) => (rho, a) => {
    const s = Math.sin(a);
    const pt = face(ax * rho * Math.cos(a), y + dy + ay * rho * s * (s > 0 ? ft : fb));
    return { p: add(pt.p, scl(pt.n, OFF)), n: pt.n };
  };
  return {
    reserve(atlas) {
      r = atlas.addRect(rect[0], rect[1]);
    },
    build(buf, atlas) {
      const r0 = at(rest);
      const targets = Object.entries(shapes).map(([k, s]) => [k, at(s)]);
      const base = buf.count;
      for (let ri = 0; ri <= rings; ri++)
        for (let s = 0; s < (ri === 0 ? 1 : segs); s++) {
          const rho = ri / rings;
          const a = (s / segs) * Math.PI * 2;
          const { p, n } = r0(rho, a);
          const mo = follow(p, n);
          for (const [k, t] of targets) mo[k] = add(mo[k] ?? [0, 0, 0], sub(t(rho, a).p, p));
          buf.addVertex(p, n, atlas.rectUV(r, 0.5 + 0.5 * rho * Math.cos(a), 0.5 + 0.5 * rho * Math.sin(a)), skin(p), mo);
        }
      const ring = (ri, s) => (ri === 0 ? base : base + 1 + (ri - 1) * segs + (s % segs));
      for (let ri = 0; ri < rings; ri++)
        for (let s = 0; s < segs; s++) {
          if (ri === 0) buf.tri(ring(0, 0), ring(1, s), ring(1, s + 1), buf.nor.slice(base * 3, base * 3 + 3));
          else {
            const out = buf.nor.slice(ring(ri, s) * 3, ring(ri, s) * 3 + 3);
            buf.tri(ring(ri, s), ring(ri + 1, s), ring(ri + 1, s + 1), out);
            buf.tri(ring(ri, s), ring(ri + 1, s + 1), ring(ri, s + 1), out);
          }
        }
    },
    paint(canvas, atlas) {
      const deep = srgb(46, 22, 44);
      const mouth = srgb(92, 40, 70);
      const tongue = srgb(236, 120, 142);
      paintRect(canvas, atlas, r, (u, v, out) => {
        const x = u - 0.5;
        const yy = v - 0.5;
        const rr = Math.hypot(x, yy) * 2;
        let c = lerp3(deep, mouth, sstep(0.1, 0.75, rr) * 0.6);
        c = lerp3(c, tongue, sstep(1, 0.8, Math.hypot(x / 0.34, (yy + 0.36) / 0.24)) * 0.9);
        c = lerp3(c, COL.ink, sstep(0.82, 0.97, rr)); // a crisp dark rim
        write(out, c, 0);
      });
    },
  };
}

// ------------------------------------------------------------------------------- the rig

const TAIL = [
  [0, 0.46, -0.6],
  [0, 0.3, -0.76],
  [0, 0.14, -0.86],
];
const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.42, 0]],
  ['head', 'body', [0, 0.7, 0.02]],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['arm_L', 'body', ARM(1).pivot],
  ['arm_R', 'body', ARM(-1).pivot],
  ['tail_1', 'body', TAIL[0]],
  ['tail_2', 'tail_1', TAIL[1]],
  ['tail_3', 'tail_2', TAIL[2]],
];
const BI = boneIndex(BONES);

/**
 * Skin weights of a point: the upper dome on head (a wide soft band, so a head turn twists the
 * sheet), the hem's foot on root (planted), the back of the hem on the tail chain, the nubs on
 * their arms.
 */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  for (const [name, v] of soft([
    ['core', d.sheet, 0.03],
    ['armL', d.armL, 0.03],
    ['armR', d.armR, 0.03],
  ])) {
    if (name !== 'core') {
      w.put(name === 'armL' ? 'arm_L' : 'arm_R', v);
      continue;
    }
    const hv = sstep(0.5, 0.95, y);
    w.put('head', v * hv);
    const lower = v * (1 - hv);
    const rootK = sstep(0.38, 0.03, y); // the hem stays planted when the body leans
    w.put('root', lower * rootK);
    const rest = lower * (1 - rootK);
    const tk = sstep(-0.2, -0.55, z) * sstep(0.62, 0.36, y);
    // down the back of the hem: tail_1, then tail_2, tail_3 toward the floor
    const k2 = sstep(0.42, 0.3, y);
    const k3 = sstep(0.26, 0.14, y);
    w.put('tail_1', rest * tk * (1 - k2));
    w.put('tail_2', rest * tk * (k2 - k3));
    w.put('tail_3', rest * tk * k3);
    w.put('body', rest * (1 - tk));
  }
  return w.done(BI);
}

const gauss2 = (qx, qy, cx, cy, sx, sy) => Math.exp(-(((qx - cx) / sx) ** 2 + ((qy - cy) / sy) ** 2) / 2);

/** The face's own region (eyes, mouth, cheeks), where the puff must not push the skin. */
function faceMask(p) {
  const [qx, qy, qz] = wf(...p);
  return sstep(0.2, 0.45, qz) * sstep(0.62, 0.42, Math.hypot(qx / 1.1, qy + 0.02));
}

/** Skin shape keys at a point (also added to the mouth disc so it rides along). */
function skinKeysOf(f, p, n) {
  const [qx, qy, qz] = wf(...p);
  const out = {};
  const slide = (dd) => (len(dd) < 1e-6 ? dd : sub(project(f, add(p, dd)), p));
  const fr = sstep(0.25, 0.45, qz);
  if (fr > 0.01) {
    const cheek = (gauss2(qx, qy, CHEEK[0], CHEEK[1], 0.07, 0.06) + gauss2(qx, qy, -CHEEK[0], CHEEK[1], 0.07, 0.06)) * fr;
    const brow = (gauss2(qx, qy, 0.12, EYE_Y + 0.21, 0.06, 0.05) + gauss2(qx, qy, -0.12, EYE_Y + 0.21, 0.06, 0.05)) * fr;
    const browOut = (gauss2(qx, qy, 0.32, EYE_Y + 0.17, 0.06, 0.05) + gauss2(qx, qy, -0.32, EYE_Y + 0.17, 0.06, 0.05)) * fr;
    const chin = gauss2(qx, qy, 0, MOUTH_Y - 0.08, 0.07, 0.04) * fr;
    if (cheek > 0.01) {
      out.happy = add(slide(fdir(0, 0.026 * cheek, 0)), scl(n, 0.008 * cheek));
      out.sad = slide(fdir(0, -0.012 * cheek, 0));
    }
    if (brow > 0.01 || browOut > 0.01) {
      out.angry = add(slide(fdir(0, -0.02 * brow, 0)), scl(n, 0.012 * brow));
      out.sad = add(out.sad ?? [0, 0, 0], slide(fdir(0, 0.012 * brow - 0.008 * browOut, 0)));
      out.surprised = slide(fdir(0, 0.014 * (brow + browOut), 0));
    }
    if (chin > 0.01) out.mouthOpen = slide(fdir(0, -0.018 * chin, 0));
  }
  // the puff: the sheet billows out, most round the skirt, never on the face
  const pm = (1 - faceMask(p)) * (0.35 + 0.65 * sstep(1.25, 0.45, p[1])) * sstep(0.0, 0.12, p[1]);
  if (pm > 0.01) out.puff = scl([n[0], 0.3 * Math.max(0, n[1]), n[2]], 0.055 * pm);
  return out;
}

// ---------------------------------------------------------------------------- the painting

/** The shell's paint at design-space point p: light grey cloth (tinted), blush (painted). */
function makeSkinPainter(shape) {
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const w = lobe(x, z);
    const grain = vnoise(x * 70, y * 70, z * 70);
    let g = 0.84 + 0.035 * (fbm(x * 5 + 2, y * 5, z * 5) - 0.5) + 0.015 * (grain - 0.5);
    // folds: soft shadows running down from the waist into each valley, the lobes catching light
    const wob = 0.25 * (fbm(x * 3, y * 3 + 7, z * 3) - 0.5);
    const a = Math.atan2(x, z) * SCALLOPS + wob * 2;
    const valley = (0.5 - 0.5 * Math.cos(a)) ** 2;
    const down = sstep(0.75, 0.15, y);
    g *= 1 - 0.1 * valley * down;
    g *= 1 + 0.03 * (1 - valley) * down * sstep(0.35, 0.05, y);
    // a soft fold under each arm nub
    for (const arm of shape.arms) {
      const dx = (x - arm.pivot[0] * 0.95) / 0.12;
      const dy = (y - arm.pivot[1] + 0.13) / 0.06;
      const dz = (z - arm.pivot[2] - 0.02) / 0.16;
      g *= 1 - 0.03 * Math.exp(-(dx * dx + dy * dy + dz * dz));
    }
    // the dome a touch lighter on top
    g = mix(g, 0.9, 0.35 * sstep(1.1, 1.45, y));
    let c = [g, g, g];
    let alpha = 1;
    // the faint glow toward the hem (paler, a little less tinted at the very lip)
    const glow = sstep(0.24, 0.02, y - VALLEY * (1 - w) * 0.8);
    c = lerp3(c, [0.97, 0.98, 1.0], 0.45 * glow);
    alpha -= 0.1 * glow * glow;
    // underneath (the lining, glimpsed through the scallops): pale and glowing
    if (n[1] < -0.3 && y < 0.28) {
      const k = sstep(-0.3, -0.7, n[1]);
      c = lerp3(c, [0.96, 0.97, 1.0], k);
      alpha = mix(alpha, 0.85, k);
    }
    c = scl(c, mix(1, ao, 0.85));

    const [qx, qy, qz] = wf(x, y, z);
    if (qz > 0.25) {
      // blush: soft ovals below and outside the eyes
      for (const s of [1, -1]) {
        const e = Math.hypot((qx - CHEEK[0] * s) / 0.085, (qy - CHEEK[1]) / 0.05);
        const k = 0.8 * sstep(1.05, 0.25, e + 0.08 * (vnoise(x * 40, y * 40, z * 40) - 0.5));
        if (k > 0) {
          c = lerp3(c, scl(COL.blush, mix(1, ao, 0.5)), k);
          alpha = Math.min(alpha, 1 - k);
        }
      }
    }
    for (const e of shape.eyes) {
      // the soft eye pocket: a little shade down into it
      const q = stretch(e).inv(p);
      const k = sstep(EYE_R * R_SOCK + 0.035, EYE_R * R_SOCK - 0.005, len(sub(q, e.E)));
      if (k > 0) c = scl(c, 1 - 0.12 * k);
    }
    write(o, c, alpha);
  };
}

// ------------------------------------------------------------------------------- the build

/**
 * @param {{texture?: number, triangles?: number, grid?: number}} [o] texture size, target triangles
 *   for the fused shell, surface-nets grid spacing (design units)
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 6000, grid = 0.013 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  // the fused shell; the face, nubs and scallops kept denser
  const shell = buildShell(f, {
    lo: [-1.0, -0.04, -1.0],
    hi: [1.0, 1.56, 1.0],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      let k = Math.hypot(qx / 0.5, (qy + 0.07) / 0.36) < 1 && qz > 0.3 ? 2.5 : 1;
      for (const e of shape.eyes) {
        // the socket rim keeps the mesher's own density (a crease that decimation would saw up)
        const r = len(sub(stretch(e).inv([x, y, z]), e.E)) / (EYE_R * R_SOCK);
        if (r < 1.35) k = Math.max(k, r > 0.85 ? 16 : 4);
      }
      if (Math.abs(x) > 0.5 && y > 0.45 && y < 0.8 && z > 0) k = Math.max(k, 1.8);
      if (y < 0.26) k = Math.max(k, 2.5);
      return k;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor, { min: 0.8 });

  // the face parts
  const face = surfaceAt(f, HEAD, 1.2);
  const headOnly = [[BI.head, 1]];
  const mouth = mouthO(face, {
    y: MOUTH_Y,
    rest: [0, 0.044, 0.05, 1, 1],
    shapes: {
      mouthOpen: [-0.026, 0.07, 0.085, 1, 1],
      surprised: [-0.026, 0.058, 0.095, 1, 1],
      happy: [-0.004, 0.068, 0.05, 0.3, 1],
      sad: [0.006, 0.06, 0.038, 1, 0.3],
      angry: [0.0, 0.05, 0.026, 0.7, 0.7],
    },
    follow: (p, n) => {
      const k = skinKeysOf(f, project(f, p), n);
      return { puff: k.puff ?? [0, 0, 0] };
    },
    skin: (p) => skinOf(shape, project(f, p)),
  });
  const parts = [ovalLids(eyeL), ovalLids(eyeR), mouth];

  // UVs
  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  for (const part of parts) part.reserve(atlas);
  atlas.layout();

  // the Body
  const body = new MeshBuffer(KEYS);
  const shellTris = appendShell(body, shell, atlas, (i, p) => ({ weights: skinOf(shape, p), keys: skinKeysOf(f, p, shell.nor[i]) }));
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
  const eyes = ovalEyes(shape.eyes, { L: BI.eye_L, R: BI.eye_R });
  const bones = BONES.map(([n, parent, p]) => [n, parent, p ?? { eye_L: eyeL.E, eye_R: eyeR.E }[n]]);
  return assemble({
    name: 'ghost',
    bones,
    body,
    eyes,
    map: toTexture(canvas, 'ghost_basecolor'),
    fit: fitScale(body, shellCount),
    roughness: 0.72,
    eyeRoughness: 0.12,
  });
}

export const buildGhost = build;

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
  project,
  rotateAbout,
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
  trace,
  vnoise,
  weights,
  write,
} from './lib/index.js';

/**
 * Dicer's pebble golem pet (docs/reference/pet-model-spec.md), built with the pet library (lib/,
 * see README.md): a chunky little stone creature. A broad, heavy boulder body on a squat hip rock
 * and two stumpy rock feet, big rock shoulders with stone arms and big fists, and a smaller rock
 * head set forward on top with a heavy brow over two big glowing eyes (tilted up for Dicer's
 * top-down camera). Every rock is an ellipsoid chipped by a dozen planes (flat facets, each a
 * slightly different tone, lighter worn edges), all fused into one shell. Glowing amber runes are
 * cut into its back, chest and shoulders; moss grows on its crown and left shoulder, with a tiny
 * two-leaf sprout on its head. A carved smile line, a mouth crack that opens on an ember glow.
 *
 * Stone is tinted by Dicer (neutral grey, cracks, speckles and chips darker); runes, eyes, moss
 * and the sprout keep their colours. The runes, eyes and the mouth's inside glow through an
 * emissive map (shared by Body and Eyes). Natural colour: #7d7f86.
 *
 * Bones: root, body, head, eye_L/R, arm_L/R. Shape keys: blink_L/R, happy, sad, surprised,
 * mouthOpen, angry, squint_L/R, puff.
 */

// ------------------------------------------------------------------------------- the design

const HEAD = tiltFrame([0, 1.1, 0.27], 0.7); // the head rock's frame, its face tilted up
const EYEF = tiltFrame(HEAD.center, 0.95); // the eyes look further up (read from straight above)
const { fdir, wf } = HEAD;
const HC = HEAD.center;

const EYE_R = 0.14;
const R_SOCK = 1.13;
const MOUTH_Y = -0.15; // the mouth line, head-local
const KEYS = ['blink_L', 'blink_R', 'happy', 'sad', 'surprised', 'mouthOpen', 'angry', 'squint_L', 'squint_R', 'puff'];

const COL = {
  rune: srgb(255, 160, 50),
  runeHot: srgb(255, 226, 140),
  glow: srgb(255, 128, 24),
  moss: [srgb(86, 140, 58), srgb(120, 170, 70), srgb(60, 108, 46)],
  leaf: srgb(126, 196, 80),
  leafDark: srgb(70, 138, 52),
  stem: srgb(96, 150, 62),
  lid: srgb(60, 58, 62),
};

/** A seeded 0..1 random sequence (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A chipped rock: an ellipsoid (centre c, radii r) cut by `n` planes spread round it (a seeded
 * Fibonacci sphere, turned and jittered), each at `cut` of the ellipsoid's reach in its direction:
 * flat facets with slightly rounded edges. `.d` the distance, `.facet` the facet's tone and how
 * close a point is to a facet edge (for painting).
 */
function rock(c, r, seed, { n = 12, cut = 0.88, spread = 0.05, k = 0.016, skip = 0.09, mirror = false } = {}) {
  const R = rng(seed);
  const base = ellipsoid(c, r);
  const axis = norm([R() - 0.5, R() - 0.5, R() - 0.5]);
  const ang = R() * Math.PI * 2;
  const ga = Math.PI * (3 - Math.sqrt(5));
  const planes = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rad = Math.sqrt(1 - y * y);
    let d = rotateAbout([Math.cos(ga * i) * rad, y, Math.sin(ga * i) * rad], axis, ang);
    d = norm(add(d, scl([R() - 0.5, R() - 0.5, R() - 0.5], 0.45)));
    const h = Math.hypot(r[0] * d[0], r[1] * d[1], r[2] * d[2]);
    const pl = [d[0], d[1], d[2], h * (cut + spread * (R() * 2 - 1)), 0.93 + 0.14 * R()];
    planes.push(pl);
    if (mirror) {
      // a symmetric rock (the face): every cut mirrored in x
      if (Math.abs(d[0]) > 0.15) planes.push([-pl[0], pl[1], pl[2], pl[3], pl[4]]);
      else {
        const m = norm([0, d[1], d[2]]);
        pl[0] = 0;
        pl[1] = m[1];
        pl[2] = m[2];
        pl[3] = Math.hypot(r[1] * m[1], r[2] * m[2]) * (cut + spread * 0.5);
      }
    }
  }
  const d = (x, y, z) => {
    let v = base(x, y, z);
    if (v > skip) return v;
    const px = x - c[0];
    const py = y - c[1];
    const pz = z - c[2];
    for (const p of planes) v = smax(v, px * p[0] + py * p[1] + pz * p[2] - p[3], k);
    return v;
  };
  /** { tone, edge } at a point near this rock's surface. */
  const facet = (x, y, z) => {
    const px = x - c[0];
    const py = y - c[1];
    const pz = z - c[2];
    let b1 = base(x, y, z);
    let b2 = -Infinity;
    let tone = 1;
    for (const p of planes) {
      const v = px * p[0] + py * p[1] + pz * p[2] - p[3];
      if (v > b1) {
        b2 = b1;
        b1 = v;
        tone = p[4];
      } else if (v > b2) b2 = v;
    }
    return { tone, edge: sstep(0.016, 0.002, b1 - b2) };
  };
  return { d, facet, c, r };
}

function makeShape() {
  // the body: a broad boulder on a squat hip rock and two stumpy feet
  const torso = rock([0, 0.62, -0.01], [0.6, 0.5, 0.54], 11, { n: 16, cut: 0.9 });
  const hips = rock([0, 0.3, 0.03], [0.44, 0.26, 0.4], 12, { n: 10 });
  const feet = [1, -1].map((s, i) => rock([0.29 * s, 0.1, 0.16], [0.19, 0.13, 0.24], 13 + i, { n: 9, cut: 0.86 }));
  // shoulders, upper arms and fists
  const shoulders = [1, -1].map((s, i) => rock([0.64 * s, 0.94, -0.03], [0.28, 0.24, 0.28], 21 + i, { n: 11 }));
  const uppers = [1, -1].map((s, i) => rock([0.84 * s, 0.68, 0.02], [0.14, 0.21, 0.15], 31 + i, { n: 8, cut: 0.9 }));
  const fists = [1, -1].map((s, i) => rock([0.88 * s, 0.33, 0.08], [0.23, 0.21, 0.25], 41 + i, { n: 12, cut: 0.87 }));
  // the head (head-local): a rock, a heavy brow, a broad jaw
  const skull = rock([0, 0.02, -0.03], [0.43, 0.31, 0.36], 51, { n: 9, cut: 0.93, mirror: true });
  const brow = rock([0, 0.27, 0.0], [0.42, 0.09, 0.18], 52, { n: 5, cut: 0.86, k: 0.012, mirror: true });
  const jaw = rock([0, -0.12, 0.08], [0.31, 0.15, 0.25], 53, { n: 6, cut: 0.9, mirror: true });

  const shape = { torso, hips, feet, shoulders, uppers, fists, skull, brow, jaw, eyes: [] };

  /** Moss: a blobby mask (0..1) on the crown and the left shoulder. */
  shape.moss = (x, y, z) => {
    let m = 0;
    if (y > 1.15) {
      const [qx, qy, qz] = wf(x, y, z);
      const dd = Math.hypot((qx - 0.05) / 0.2, (qz + 0.1) / 0.17) + 0.6 * (fbm(x * 9, y * 9, z * 9) - 0.5);
      m = Math.max(m, sstep(1, 0.8, dd) * sstep(0.12, 0.2, qy));
    }
    if (x < -0.3 && y > 0.75) {
      const dd = Math.hypot((x + 0.58) / 0.26, (y - 1.08) / 0.2, (z + 0.12) / 0.26) + 0.7 * (fbm(x * 8 + 4, y * 8, z * 8) - 0.5);
      m = Math.max(m, sstep(1, 0.78, dd));
    }
    return m;
  };

  /** Distances to the parts at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    let h = smin(skull.d(qx, qy, qz), brow.d(qx, qy, qz), 0.05);
    o.head = smin(h, jaw.d(qx, qy, qz), 0.06);
    let t = smin(torso.d(x, y, z), hips.d(x, y, z), 0.08);
    t = smin(t, smin(shoulders[0].d(x, y, z), shoulders[1].d(x, y, z), 0.01), 0.07);
    o.torso = t;
    o.feet = Math.min(feet[0].d(x, y, z), feet[1].d(x, y, z));
    o.armL = smin(uppers[0].d(x, y, z), fists[0].d(x, y, z), 0.05);
    o.armR = smin(uppers[1].d(x, y, z), fists[1].d(x, y, z), 0.05);
    return o;
  };
  const P = {};
  const fuse = (x, y, z) => {
    shape.parts(x, y, z, P);
    let d = smin(P.torso, P.feet, 0.05);
    d = smin(d, P.head, 0.07);
    // the arms join at the shoulders only (a small blend: the fists stay clear of the body)
    d = smin(d, P.armL, 0.04);
    d = smin(d, P.armR, 0.04);
    if (y > 0.75) {
      const m = shape.moss(x, y, z);
      if (m > 0) d -= 0.012 * m * (0.6 + 0.8 * vnoise(x * 40, y * 40, z * 40));
    }
    return d;
  };
  /** The golem without eye sockets (for placing the eyes and for occlusion). */
  shape.solid = (x, y, z) => smax(fuse(x, y, z), -y, 0.02);
  shape.eyes = placeEyes(shape.solid, EYEF, { r: EYE_R, x: 0.178, y: 0.0, yaw: 0.12, open: 45 * DEG, range: [0.0, 0.45] });
  shape.sdf = (x, y, z) => smax(carveSockets(fuse(x, y, z), x, y, z, shape.eyes, EYE_R * R_SOCK), -y, 0.02);
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const NECK = [0, 0.96, 0.18];
const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.48, 0]],
  ['head', 'body', NECK],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['arm_L', 'body', [0.74, 0.9, 0.0]],
  ['arm_R', 'body', [-0.74, 0.9, 0.0]],
];
const BI = boneIndex(BONES);

/** Skin weights of a shell point: head, body (feet and seat on root), the arms. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  for (const [name, v] of soft([
    ['head', d.head, 0.03],
    ['torso', d.torso, 0.03],
    ['feet', d.feet, 0.03],
    ['armL', d.armL, 0.025],
    ['armR', d.armR, 0.025],
  ])) {
    if (name === 'head') w.put('head', v);
    else if (name === 'feet') w.put('root', v);
    else if (name === 'torso') {
      const rootK = sstep(0.24, 0.08, y); // the seat stays planted when the body leans
      w.put('root', v * rootK);
      w.put('body', v * (1 - rootK));
    } else w.put(name === 'armL' ? 'arm_L' : 'arm_R', v);
  }
  return w.done(BI);
}

/** Face shape keys on the shell: displacement fields in head-local space. */
function faceKeysOf(f, p, n, headW) {
  const gauss = (q, c, s) => Math.exp(-((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - (c[2] ?? q[2])) ** 2) / (2 * s * s));
  const mirror = (q, c, s) => gauss(q, c, s) + gauss(q, [-c[0], c[1], c[2]], s);
  const q = wf(...p);
  const out = {};
  if (headW < 0.02) {
    // the boulder puffs out (proud, huffy)
    const g = sstep(0.2, 0.5, p[1]) * sstep(1.15, 0.9, p[1]) * (1 - headW) * sstep(0.7, 0.5, Math.abs(p[0]));
    if (g > 0.01) out.puff = scl(n, 0.04 * g);
    return out;
  }
  const fr = sstep(0.02, 0.18, q[2]) * headW;
  const corner = mirror(q, [0.1, MOUTH_Y], 0.045) * fr;
  const cheek = mirror(q, [0.2, -0.08, 0.25], 0.07) * fr;
  const browIn = mirror(q, [0.08, 0.22, 0.25], 0.06) * fr;
  const browOut = mirror(q, [0.25, 0.2], 0.07) * fr;
  const brow = mirror(q, [0.15, 0.22], 0.1) * fr;
  const chin = gauss(q, [0, -0.25], 0.08) * fr;
  const lip = gauss(q, [0, MOUTH_Y - 0.03], 0.05) * fr;
  const slide = (d) => (len(d) < 1e-6 ? d : sub(project(f, add(p, d)), p));
  out.happy = add(slide(fdir(0, 0.04 * corner + 0.024 * cheek, 0)), scl(n, 0.008 * cheek));
  out.sad = slide(fdir(0, -0.022 * corner + 0.016 * browIn - 0.03 * browOut, 0));
  out.surprised = add(slide(fdir(0, 0.032 * brow - 0.012 * chin, 0)), [0, 0, 0]);
  out.mouthOpen = slide(fdir(0, -0.04 * chin - 0.01 * lip, 0));
  out.angry = fdir(0, -0.08 * browIn - 0.02 * browOut - 0.03 * corner, 0.035 * browIn + 0.008 * lip);
  out.puff = scl(n, 0.03 * mirror(q, [0.22, -0.1, 0.12], 0.1) * headW);
  return out;
}

// ---------------------------------------------------------------------------- the runes

/** Segments [[u0, v0], [u1, v1]] of a glyph. */
const seg = (a, b) => [a, b];
const ring = (cx, cy, r, n, a0 = 0) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const b = a0 + ((i + 1) / n) * Math.PI * 2;
    out.push(seg([cx + r * Math.cos(a), cy + r * Math.sin(a)], [cx + r * Math.cos(b), cy + r * Math.sin(b)]));
  }
  return out;
};
// the back sigil, (x, z) seen from above: a ring, a stave through it to the head, an arrowhead,
// a crossbar and four ticks round it
const BACK = [
  ...ring(0, -0.33, 0.12, 14),
  seg([0, -0.52], [0, -0.13]),
  seg([0, -0.13], [-0.06, -0.19]),
  seg([0, -0.13], [0.06, -0.19]),
  seg([-0.08, -0.36], [0.08, -0.36]),
  seg([-0.2, -0.2], [-0.25, -0.15]),
  seg([0.2, -0.2], [0.25, -0.15]),
  seg([-0.2, -0.46], [-0.25, -0.51]),
  seg([0.2, -0.46], [0.25, -0.51]),
];
// the chest stave, (x, y) seen from the front: a diamond on a stave with two arms
const CHEST = [
  seg([0, 0.24], [0, 0.6]),
  seg([0, 0.62], [0.07, 0.52]),
  seg([0.07, 0.52], [0, 0.42]),
  seg([0, 0.42], [-0.07, 0.52]),
  seg([-0.07, 0.52], [0, 0.62]),
  seg([0, 0.36], [0.13, 0.3]),
  seg([0, 0.36], [-0.13, 0.3]),
];
// shoulder ticks, (x, z) seen from above: three bars on each shoulder
const TICKS = [];
for (const s of [1, -1]) for (const dz of [-0.12, 0, 0.12]) TICKS.push(seg([0.58 * s, dz - 0.04], [0.72 * s, dz - 0.06]));

/** Distance (2D) to the nearest of the segments. */
function segDist(u, v, segs) {
  let best = Infinity;
  for (const [[ax, ay], [bx, by]] of segs) {
    const dx = bx - ax;
    const dy = by - ay;
    const t = clamp(((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    best = Math.min(best, Math.hypot(u - ax - dx * t, v - ay - dy * t));
  }
  return best;
}

// ---------------------------------------------------------------------------- the painting

/**
 * The shell's look at design-space point p: { c (sRGB), a (tint mask), g (emissive sRGB) }.
 * Stone: light grey, mottled, speckled, cracked, each facet its own tone, worn lighter edges.
 */
function makeShade(shape) {
  const parts = {};
  const rocksOf = (name, x, y, z) => {
    if (name === 'head') {
      const q = wf(x, y, z);
      return [[shape.skull, q], [shape.brow, q], [shape.jaw, q]];
    }
    const p = [x, y, z];
    if (name === 'torso') return [[shape.torso, p], [shape.hips, p], [shape.shoulders[0], p], [shape.shoulders[1], p]];
    if (name === 'feet') return shape.feet.map((r) => [r, p]);
    if (name === 'armL') return [[shape.uppers[0], p], [shape.fists[0], p]];
    return [[shape.uppers[1], p], [shape.fists[1], p]];
  };
  return (p, n, ao) => {
    const [x, y, z] = p;
    shape.parts(x, y, z, parts);
    let near = 'torso';
    let dm = Infinity;
    for (const k of ['head', 'torso', 'feet', 'armL', 'armR'])
      if (parts[k] < dm) {
        dm = parts[k];
        near = k;
      }
    // the nearest rock of that part: its facet tone and edges
    let best = Infinity;
    let fc = { tone: 1, edge: 0 };
    for (const [r, q] of rocksOf(near, x, y, z)) {
      const dd = Math.abs(r.d(...q));
      if (dd < best) {
        best = dd;
        fc = r.facet(...q);
      }
    }
    const mott = fbm(x * 3.2 + 7, y * 3.2, z * 3.2);
    const grain = vnoise(x * 70, y * 70, z * 70);
    let g = 0.8 + 0.12 * (mott - 0.5) + 0.06 * (grain - 0.5);
    g *= mix(1, fc.tone, 0.9);
    // speckles: dark and light flecks
    const sp = vnoise(x * 160 + 3, y * 160, z * 160);
    if (sp > 0.82) g *= 1 - 0.35 * sstep(0.82, 0.9, sp);
    const sp2 = vnoise(x * 140, y * 140 + 11, z * 140);
    if (sp2 > 0.86) g = mix(g, 0.95, 0.6 * sstep(0.86, 0.93, sp2));
    // lichen-like darker blotches low down, lighter worn edges
    g *= 1 - 0.1 * sstep(0.3, 0.05, y);
    g = mix(g, Math.min(1, g * 1.14), fc.edge);
    // cracks: thin ridged-noise lines, only here and there
    const cn = vnoise(x * 2.6 + 1.3, y * 2.6 - 2, z * 2.6 + 5) + 0.04 * (vnoise(x * 20, y * 20, z * 20) - 0.5);
    const crack = sstep(0.011, 0.003, Math.abs(cn - 0.5)) * sstep(0.58, 0.7, fbm(x * 1.7 + 9, y * 1.7, z * 1.7 + 2));
    g *= 1 - 0.5 * crack;
    let c = [g, g * 0.995, g * 1.01];
    let a = 1;
    let glow = [0, 0, 0];
    const q = wf(x, y, z);

    if (near === 'head' && q[2] > 0.12) {
      // the carved smile line (darker, still stone) and the socket creases
      const mu = q[0];
      const mv = q[1] - MOUTH_Y - 0.9 * mu * mu;
      if (Math.abs(mu) < 0.13) {
        const k = sstep(0.009, 0.004, Math.abs(mv)) * sstep(0.13, 0.11, Math.abs(mu));
        c = scl(c, 1 - 0.62 * k);
      }
    }
    for (const e of shape.eyes) {
      const k = sstep(EYE_R * R_SOCK + 0.006, EYE_R * R_SOCK - 0.002, len(sub(p, e.E)));
      if (k > 0) c = scl(c, 1 - 0.3 * k);
    }

    // runes: a dark groove round a glowing core
    let rd = Infinity;
    if (near === 'torso' || near === 'head') {
      if (n[1] > 0.25 && z < 0.05 && y > 0.8 && near === 'torso') rd = Math.min(rd, segDist(x, z, BACK));
      if (n[2] > 0.35 && y < 0.9 && y > 0.18) rd = Math.min(rd, segDist(x, y, CHEST));
      if (n[1] > 0.2 && Math.abs(x) > 0.5 && y > 0.95) rd = Math.min(rd, segDist(x, z, TICKS));
    }
    if (rd < 0.04) {
      const groove = sstep(0.032, 0.02, rd);
      const core = sstep(0.018, 0.012, rd);
      c = scl(c, 1 - 0.6 * groove * (1 - core));
      c = lerp3(c, lerp3(COL.rune, COL.runeHot, sstep(0.012, 0.003, rd)), core);
      a = 1 - core;
      glow = scl(lerp3(COL.glow, COL.runeHot, sstep(0.012, 0.0, rd)), core);
    }

    // moss
    const m = y > 0.75 ? shape.moss(x, y, z) : 0;
    if (m > 0) {
      const t = fbm(x * 14, y * 14, z * 14);
      let mc = t < 0.45 ? lerp3(COL.moss[2], COL.moss[0], t / 0.45) : lerp3(COL.moss[0], COL.moss[1], (t - 0.45) / 0.55);
      mc = scl(mc, 0.85 + 0.3 * vnoise(x * 90, y * 90, z * 90));
      const k = sstep(0.05, 0.45, m);
      c = lerp3(c, mc, k);
      a = Math.min(a, 1 - k);
    }
    return { c: scl(c, ao), a, g: glow };
  };
}

// ---------------------------------------------------------------------------- extra parts

/**
 * The mouth's inside (lib mouthInside, reshaped as a crack): a disc collapsed behind the smile
 * line; mouthOpen and surprised open it into a wide, low oval laid on the face. Dark stone inside
 * with an ember glow deep in it (painted, and in the emissive map).
 */
function crackMouth(face, head, { y = MOUTH_Y, shapes, rings = 4, segs = 18 } = {}) {
  let r = -1;
  return {
    reserve(atlas) {
      r = atlas.addRect(0.1, 0.1);
    },
    build(buf, atlas, wts) {
      const J = face(0, y);
      const shapeAt = ([dy, ax, ay, flat, off]) => (rho, a) => {
        const s = Math.sin(a);
        const pt = face(ax * rho * Math.cos(a), y + dy + ay * rho * s * (s > 0 ? flat : 1));
        return add(pt.p, scl(pt.n, off));
      };
      const rest = (rho, a) => add(J.p, add(scl(head.fdir(Math.cos(a), 0, 0), 0.006 * rho), scl(J.n, -0.008)));
      const targets = Object.entries(shapes).map(([k, s]) => [k, shapeAt(s)]);
      const base = buf.count;
      for (let ri = 0; ri <= rings; ri++)
        for (let s = 0; s < (ri === 0 ? 1 : segs); s++) {
          const rho = ri / rings;
          const a = (s / segs) * Math.PI * 2;
          const p0 = rest(rho, a);
          const mo = Object.fromEntries(targets.map(([k, t]) => [k, sub(t(rho, a), p0)]));
          buf.addVertex(p0, J.n, atlas.rectUV(r, 0.5 + 0.5 * rho * Math.cos(a), 0.5 + 0.5 * rho * Math.sin(a)), wts, mo);
        }
      const at = (ri, s) => (ri === 0 ? base : base + 1 + (ri - 1) * segs + (s % segs));
      for (let ri = 0; ri < rings; ri++)
        for (let s = 0; s < segs; s++) {
          if (ri === 0) buf.idx.push(at(0, 0), at(1, s), at(1, s + 1));
          else buf.idx.push(at(ri, s), at(ri + 1, s), at(ri + 1, s + 1), at(ri, s), at(ri + 1, s + 1), at(ri, s + 1));
        }
    },
    paint(canvas, atlas, glowCanvas) {
      paintRect(canvas, atlas, r, (u, v, out) => {
        const rr = Math.hypot(u - 0.5, v - 0.5) * 2;
        write(out, lerp3([0.42, 0.2, 0.1], [0.08, 0.06, 0.06], sstep(0.1, 0.9, rr)), 0);
      });
      paintRect(glowCanvas, atlas, r, (u, v, out) => {
        const rr = Math.hypot(u - 0.5, (v - 0.5) * 1.3) * 2;
        write(out, scl(COL.glow, 0.55 * sstep(0.85, 0.1, rr)), 1);
      });
    },
  };
}

/**
 * A tiny sprout on the crown: a curved stem (a 6-sided tapered tube) and two leaves (flattened,
 * closed ellipsoids), on the head bone, painted green.
 */
function sprout(f, at) {
  let r = -1;
  return {
    reserve(atlas) {
      r = atlas.addRect(0.06, 0.06);
    },
    build(buf, atlas, wts) {
      const hit = trace(f, [at[0], 2, at[1]], [0, -1, 0]);
      const root = sub(hit.p, scl(hit.n, 0.015));
      const H = 0.13;
      const bend = norm([0.35, 0, 0.5]);
      const stemAt = (t) => add(add(root, scl([0, 1, 0], H * t)), scl(bend, 0.03 * t * t));
      const uvStem = atlas.rectUV(r, 0.25, 0.5);
      const segs = 4;
      const sides = 6;
      const base = buf.count;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const c = stemAt(t);
        const rad = mix(0.016, 0.009, t);
        for (let k = 0; k <= sides; k++) {
          const a = (k / sides) * Math.PI * 2;
          const o = [Math.cos(a), 0, Math.sin(a)];
          buf.addVertex(add(c, scl(o, rad)), o, uvStem, wts);
        }
      }
      buf.grid(base, segs, sides, (a) => {
        const pp = buf.P(a);
        return sub(pp, [root[0], pp[1], root[2]]);
      });
      const top = stemAt(1);
      // the leaves: flattened ellipsoids from the stem top, out to each side and up
      for (const side of [1, -1]) {
        const dir = norm([0.9 * side, 0.55, 0.25 * side + 0.15]);
        const L = 0.075;
        const W = 0.035;
        const T = 0.008;
        const c0 = add(top, scl(dir, L * 0.95));
        const ax = dir;
        const flatN = norm(cross(ax, [0, 0, 1]));
        const up = norm(cross(flatN, ax)); // the leaf's width axis
        const nu = 10;
        const nv = 6;
        const lb = buf.count;
        for (let j = 0; j <= nv; j++)
          for (let i = 0; i <= nu; i++) {
            const v = (j / nv) * Math.PI;
            const u = (i / nu) * Math.PI * 2;
            const lx = Math.cos(v);
            const taper = Math.sin(v) * (1 - 0.35 * lx); // fuller near the stem
            const loc = add(add(scl(ax, L * lx), scl(up, W * taper * Math.cos(u))), scl(flatN, T * taper * Math.sin(u)));
            const nn = norm(add(add(scl(ax, lx / L), scl(up, (taper * Math.cos(u)) / W)), scl(flatN, (taper * Math.sin(u)) / T)));
            buf.addVertex(add(c0, loc), nn, atlas.rectUV(r, 0.55 + 0.4 * (i / nu), 0.1 + 0.8 * (j / nv)), wts);
          }
        buf.grid(lb, nv, nu, (a) => sub(buf.P(a), c0));
      }
    },
    paint(canvas, atlas) {
      paintRect(canvas, atlas, r, (u, v, out) => {
        if (u < 0.5) write(out, COL.stem, 0);
        else write(out, lerp3(COL.leafDark, COL.leaf, Math.sin(v * Math.PI) * (0.6 + 0.4 * Math.abs(Math.cos(u * 12)))), 0);
      });
    },
  };
}

/**
 * The `Eyes` mesh (lib eyeballs, with UVs into the shared atlas so the emissive map makes them
 * glow): one sphere per eye, poles on its forward axis, rings at the colour edges, wholly on its
 * bone; two glints. A `surprised` key shrinks the pupils.
 */
function glowEyes(eyes, atlas, rect, { bones, pupil = 17 * DEG, iris = 46 * DEG } = {}) {
  const b = new MeshBuffer(['surprised']);
  const ringDeg = [0, 7, 12, 16, 17, 18.5, 24, 30, 36, 41, 45, 46, 47.5, 48.5, 55, 62, 78, 100, 135, 180];
  const rings = ringDeg.map((d) => d * DEG);
  const na = 30;
  const shrink = (pol) => {
    if (pol <= pupil + 1.2 * DEG) return pol * 0.55;
    if (pol <= iris) return mix(pupil * 0.55 + 0.6 * DEG, iris, (pol - pupil - 1.2 * DEG) / (iris - pupil - 1.2 * DEG));
    return pol;
  };
  const colorAt = (pol, lit) => {
    if (pol < pupil - 0.5 * DEG) return srgb(40, 20, 12);
    if (pol < iris - 0.5 * DEG) {
      const t = (pol - pupil) / (iris - pupil);
      return lerp3(lerp3(srgb(255, 250, 220), srgb(255, 214, 110), sstep(0, 0.55, t)), srgb(255, 150, 40), sstep(0.55, 1, t)).map((v) => Math.min(1, v * (0.92 + 0.08 * lit)));
    }
    if (pol < iris + 2.5 * DEG) return srgb(190, 76, 18); // an orange ring round the iris
    if (pol < iris + 9 * DEG) return srgb(255, 176, 70);
    return srgb(236, 138, 52); // the rest of the orb
  };
  // the emissive strip: u = polar angle / pi
  for (const eye of eyes) {
    const R = eye.r;
    const wts = [[eye.side > 0 ? bones.L : bones.R, 1]];
    const base = b.count;
    const at = (pol, az) => add(scl(eye.F, Math.cos(pol)), add(scl(eye.X, Math.sin(pol) * Math.cos(az)), scl(eye.U, Math.sin(pol) * Math.sin(az))));
    for (let ri = 0; ri < rings.length; ri++)
      for (let a = 0; a < na; a++) {
        const pol = rings[ri];
        const az = (a / na) * Math.PI * 2;
        const n = at(pol, az);
        const c = colorAt(pol, 0.5 - 0.5 * Math.sin(az) * Math.sin(pol));
        const uv = atlas.rectUV(rect, clamp(pol / Math.PI, 0.002, 0.998), 0.5);
        b.addVertex(add(eye.E, scl(n, R)), n, uv, wts, { surprised: scl(sub(at(shrink(pol), az), n), R) }, toLinear(c));
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
      [26 * DEG, 0.6, 0.026],
      [30 * DEG, 0.6 + Math.PI, 0.012],
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

/** The eyes' emissive strip (u = polar angle / pi): a bright core, a dark pupil, a dim rim. */
function paintEyeGlow(glowCanvas, canvas, atlas, rect, { pupil = 17 * DEG, iris = 46 * DEG } = {}) {
  paintRect(glowCanvas, atlas, rect, (u, v, out) => {
    const pol = u * Math.PI;
    let c;
    if (u > 0.99) c = [1, 1, 1];
    else if (pol < pupil) c = scl(COL.glow, 0.12);
    else if (pol < iris) {
      const t = (pol - pupil) / (iris - pupil);
      c = lerp3(srgb(255, 236, 170), srgb(255, 140, 30), sstep(0.25, 1, t));
    } else if (pol < iris + 2.5 * DEG) c = scl(COL.glow, 0.25);
    else if (pol < iris + 9 * DEG) c = scl(COL.glow, 0.7);
    else c = scl(COL.glow, 0.4);
    write(out, c, 1);
  });
  paintRect(canvas, atlas, rect, (u, v, out) => write(out, [1, 0.7, 0.3], 0)); // unused base colour
}

// ------------------------------------------------------------------------------- the build

/**
 * @param {{texture?: number, triangles?: number, grid?: number}} [o] texture size, target triangles
 *   for the fused shell, surface-nets grid spacing (design units)
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 5700, grid = 0.02 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  const shell = buildShell(f, {
    lo: [-1.16, -0.04, -0.66],
    hi: [1.16, 1.56, 0.82],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      let k = Math.hypot(qx / 0.36, (qy + 0.02) / 0.3) < 1 && qz > 0.1 ? 3 : 1;
      if (y > 1.25) k = Math.max(k, 1.6);
      return k;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor, { min: 0.72 });

  // the face parts, the sprout
  const face = surfaceAt(f, HEAD);
  const headOnly = [[BI.head, 1]];
  const lids = eyelids(shape.eyes, {
    rUp: 1.12,
    meet: -10 * DEG, // the eyes look up, so more of each shows below its centre
    motions: {
      blink: [{ close: 1.05 }, { close: 1.05 }],
      squint: [{ close: 0.5 }, { close: 0.34 }],
      happy: [6, 20],
      sad: [{ deg: 24, roll: -0.6 }, 0],
      angry: [{ deg: 44, roll: 0.9 }, 10],
      surprised: [-8, -8],
    },
  });
  const mouth = crackMouth(face, HEAD, {
    shapes: { mouthOpen: [-0.03, 0.12, 0.07, 0.38, 0.009], surprised: [-0.04, 0.062, 0.052, 0.8, 0.009] },
  });
  const sprig = sprout(f, [0.06, HC[2] - 0.08]);
  const parts = [lids, mouth, sprig];

  // UVs
  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  for (const part of parts) part.reserve(atlas);
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
  for (const part of parts) part.build(body, atlas, headOnly);

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
      // stone lids: speckled grey (tinted), a darker rim on the leading edge
      let g = 0.8 + 0.06 * (vnoise(u * 9, v * 5, upper ? 1 : 7) - 0.5);
      if (vnoise(u * 60, v * 26, upper ? 3 : 9) > 0.8) g *= 0.75;
      g *= mix(0.55, 1, sstep(0.02, 0.12, v));
      write(out, [g, g * 0.995, g * 1.01], 1);
    });
  mouth.paint(canvas, atlas, glowCanvas);
  sprig.paint(canvas, atlas);
  paintEyeGlow(glowCanvas, canvas, atlas, eyeRect);
  dilate(canvas, 6);
  dilate(glowCanvas, 6);
  for (let i = 3; i < glowCanvas.data.length; i += 4) glowCanvas.data[i] = 255;

  const eyes = glowEyes(shape.eyes, atlas, eyeRect, { bones: { L: BI.eye_L, R: BI.eye_R } });
  const bones = BONES.map(([n, parent, p]) => [n, parent, p ?? { eye_L: eyeL.E, eye_R: eyeR.E }[n]]);
  const scene = assemble({
    name: 'golem',
    bones,
    body,
    eyes,
    map: toTexture(canvas, 'golem_basecolor'),
    fit: fitScale(body, shellCount),
    roughness: 0.92,
    eyeRoughness: 0.3,
  });
  // the glow: one emissive map shared by the runes (Body) and the eyes
  const emissive = toTexture(glowCanvas, 'golem_emissive');
  for (const name of ['Body', 'Eyes']) {
    const m = scene.getObjectByName(name).material;
    m.emissiveMap = emissive;
    m.emissive.setRGB(1, 1, 1);
    m.emissiveIntensity = 1;
  }
  return scene;
}

export const buildGolem = build;

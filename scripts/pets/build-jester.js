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
 * Dicer's jester pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a little jester doll. A big round porcelain face (painted, untinted) tilted up toward
 * the top-down camera, with rosy cheeks, a painted red smile, big doll eyes and a small diamond
 * painted under its left eye; a floppy three-pointed hat (left, right and back points, a gold bell
 * on each tip) on a crown with a gold band; a cream ruff; a harlequin body (tinted, with gold
 * diamonds), one gold leg and one gold sleeve; cream mitten hands; curled-toe shoes with bells.
 * Natural colour: purple #8e44ad.
 *
 * One fused `Body` shell (a distance field, meshed), with eyelids, the mouth's inside and a tongue
 * in the same mesh; `Eyes` the eyeballs. Bones: root, body, head, eye_L/R, ear_L/R (the left and
 * right hat points), tail_1..3 (the back hat point, hung on the head), arm_L/R, leg_L/R. Shape
 * keys: all eleven of the spec.
 */

// ------------------------------------------------------------------------------- the design

const HEAD = tiltFrame([0, 1.0, 0.04], 0.62); // the face tilted up toward the top-down camera
const { fdir, wf } = HEAD;
const HR = [0.36, 0.34, 0.33]; // the head's radii in face space

const EYE_R = 0.12;
const R_SOCK = 1.13;
const MOUTH_Y = -0.16;
const NECK_Y = 0.72; // the head/body blend plane (design units)

// The hat's brim: a plane in face space (normal tipped back), the crown above it.
const BRIM_B = 0.5;
const BRIM_N = [0, Math.cos(BRIM_B), -Math.sin(BRIM_B)];
const BRIM_T = [0, Math.sin(BRIM_B), Math.cos(BRIM_B)];
const BRIM_C = 0.035;
const brimS = (q) => q[1] * BRIM_N[1] + q[2] * BRIM_N[2] - BRIM_C;

// The hat points: round cones from inside the crown, out and drooping, a bell on each tip.
const POINT_L = [
  [0.1, 1.27, -0.08, 0.1],
  [0.32, 1.39, -0.13, 0.078],
  [0.55, 1.35, -0.16, 0.055],
  [0.71, 1.2, -0.16, 0.036],
  [0.755, 1.08, -0.15, 0.026],
];
const POINT_R = POINT_L.map(([x, y, z, r]) => [-x, y, z, r]);
const POINT_B = [
  [0, 1.26, -0.16, 0.1],
  [0, 1.37, -0.38, 0.078],
  [0, 1.3, -0.6, 0.055],
  [0, 1.13, -0.72, 0.036],
  [0, 1.01, -0.745, 0.026],
];
const BELL_R = 0.052;
const bellAt = (pts) => {
  const [x, y, z] = pts[pts.length - 1];
  return [x * 1.01, y - 0.05, z];
};

const COL = {
  porcelain: srgb(250, 244, 236),
  shade: srgb(232, 220, 214),
  rose: srgb(244, 150, 162),
  lip: srgb(204, 38, 60),
  gold: srgb(228, 178, 62),
  goldDark: srgb(170, 118, 34),
  bell: srgb(255, 210, 80),
  cream: srgb(248, 238, 214),
  ink: srgb(48, 30, 44),
};

function makeShape() {
  const head = ellipsoid([0, 0, 0], HR);
  const crownE = ellipsoid([0, 0.005, -0.005], [HR[0] + 0.026, HR[1] + 0.026, HR[2] + 0.026]);
  const nose = ellipsoid([0, -0.07, 0.325], [0.028, 0.022, 0.02]);
  const torso = ellipsoid([0, 0.5, 0], [0.22, 0.25, 0.195]);
  const belly = ellipsoid([0, 0.4, 0.01], [0.235, 0.16, 0.205]);
  const armL = roundCone([0.19, 0.64, 0.0], [0.3, 0.43, 0.05], 0.062, 0.05);
  const armR = roundCone([-0.19, 0.64, 0.0], [-0.3, 0.43, 0.05], 0.062, 0.05);
  const mitL = ellipsoid([0.315, 0.375, 0.065], [0.066, 0.076, 0.062]);
  const mitR = ellipsoid([-0.315, 0.375, 0.065], [0.066, 0.076, 0.062]);
  const thumbL = sphere([0.275, 0.395, 0.11], 0.028);
  const thumbR = sphere([-0.275, 0.395, 0.11], 0.028);
  const legL = roundCone([0.1, 0.33, 0], [0.112, 0.1, 0.01], 0.066, 0.055);
  const legR = roundCone([-0.1, 0.33, 0], [-0.112, 0.1, 0.01], 0.066, 0.055);
  const shoeL = ellipsoid([0.115, 0.056, 0.05], [0.072, 0.056, 0.12]);
  const shoeR = ellipsoid([-0.115, 0.056, 0.05], [0.072, 0.056, 0.12]);
  const toeL = roundCone([0.115, 0.07, 0.14], [0.115, 0.135, 0.215], 0.04, 0.025);
  const toeR = roundCone([-0.115, 0.07, 0.14], [-0.115, 0.135, 0.215], 0.04, 0.025);
  const tbL = sphere([0.115, 0.165, 0.222], 0.032);
  const tbR = sphere([-0.115, 0.165, 0.222], 0.032);
  const ptL = coneChain(POINT_L);
  const ptR = coneChain(POINT_R);
  const ptB = coneChain(POINT_B);
  const bellL = sphere(bellAt(POINT_L), BELL_R);
  const bellR = sphere(bellAt(POINT_R), BELL_R);
  const bellB = sphere(bellAt(POINT_B), BELL_R);
  const chainD = (c, x, y, z) => {
    let d = c[0](x, y, z);
    for (let i = 1; i < c.length; i++) d = Math.min(d, c[i](x, y, z));
    return d;
  };

  const shape = {
    lineL: polyline([...POINT_L.map((p) => p.slice(0, 3)), bellAt(POINT_L)]),
    lineR: polyline([...POINT_R.map((p) => p.slice(0, 3)), bellAt(POINT_R)]),
    lineB: polyline([...POINT_B.map((p) => p.slice(0, 3)), bellAt(POINT_B)]),
    eyes: [],
  };
  /** Distances to the parts at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const q = wf(x, y, z);
    const [qx, qy, qz] = q;
    o.head = smin(head(qx, qy, qz), nose(qx, qy, qz), 0.02);
    // the crown: a shell over the head above the brim, with a rolled band along the brim
    const s = brimS(q);
    o.crown = smax(crownE(qx, qy, qz), -s, 0.008);
    const w = (qy - BRIM_N[1] * BRIM_C) * BRIM_T[1] + (qz - BRIM_N[2] * BRIM_C) * BRIM_T[2];
    const rho = Math.hypot(qx / (HR[0] + 0.012), w / (HR[2] + 0.004));
    o.band = Math.hypot((rho - 1) * 0.35, s) - 0.026;
    o.torso = smin(torso(x, y, z), belly(x, y, z), 0.08);
    // the ruff: a scalloped disc round the neck
    const a = Math.atan2(x, z);
    const rr = 1 + 0.07 * Math.cos(a * 12);
    const ruffE = Math.hypot(x / (0.255 * rr), (y - 0.735) / 0.05, z / (0.235 * rr));
    o.ruff = (ruffE - 1) * 0.05;
    o.armL = smin(smin(armL(x, y, z), mitL(x, y, z), 0.03), thumbL(x, y, z), 0.015);
    o.armR = smin(smin(armR(x, y, z), mitR(x, y, z), 0.03), thumbR(x, y, z), 0.015);
    o.legL = smin(legL(x, y, z), smin(smin(shoeL(x, y, z), toeL(x, y, z), 0.03), tbL(x, y, z), 0.01), 0.04);
    o.legR = smin(legR(x, y, z), smin(smin(shoeR(x, y, z), toeR(x, y, z), 0.03), tbR(x, y, z), 0.01), 0.04);
    o.ptL = smin(chainD(ptL, x, y, z), bellL(x, y, z), 0.012);
    o.ptR = smin(chainD(ptR, x, y, z), bellR(x, y, z), 0.012);
    o.ptB = smin(chainD(ptB, x, y, z), bellB(x, y, z), 0.012);
    return o;
  };
  const P = {};
  const union = (x, y, z) => {
    shape.parts(x, y, z, P);
    let hd = Math.min(P.head, P.crown);
    hd = smin(hd, P.band, 0.012);
    hd = smin(hd, Math.min(P.ptL, P.ptR, P.ptB), 0.03);
    let bd = smin(P.torso, P.ruff, 0.03);
    bd = smin(bd, Math.min(P.armL, P.armR), 0.04);
    bd = smin(bd, Math.min(P.legL, P.legR), 0.04);
    return smin(hd, bd, 0.05);
  };
  /** The jester without eye sockets (for placing the eyes and for occlusion). */
  shape.solid = (x, y, z) => smax(union(x, y, z), -y, 0.02);
  shape.eyes = placeEyes(shape.solid, HEAD, { r: EYE_R, x: 0.145, y: 0.03, yaw: 0.14, open: 44 * DEG });
  shape.sdf = (x, y, z) => smax(carveSockets(union(x, y, z), x, y, z, shape.eyes, EYE_R * R_SOCK), -y, 0.02);
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const lerpP = (a, b, k) => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.42, 0]],
  ['head', 'body', [0, NECK_Y, 0.02]],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['ear_L', 'head', lerpP(POINT_L[0], POINT_L[1], 0.45).slice(0, 3)],
  ['ear_R', 'head', lerpP(POINT_R[0], POINT_R[1], 0.45).slice(0, 3)],
  ['tail_1', 'head', lerpP(POINT_B[0], POINT_B[1], 0.45).slice(0, 3)],
  ['tail_2', 'tail_1', POINT_B[2].slice(0, 3)],
  ['tail_3', 'tail_2', POINT_B[3].slice(0, 3)],
  ['arm_L', 'body', [0.19, 0.63, 0]],
  ['arm_R', 'body', [-0.19, 0.63, 0]],
  ['leg_L', 'body', [0.1, 0.32, 0]],
  ['leg_R', 'body', [-0.1, 0.32, 0]],
];
const BI = boneIndex(BONES);

/** Skin weights of a shell point: head vs body by the neck plane, the hat points, arms, legs. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  const core = Math.min(d.head, d.crown, d.band, d.torso, d.ruff);
  for (const [name, v] of soft([
    ['core', core, 0.03],
    ['armL', d.armL, 0.025],
    ['armR', d.armR, 0.025],
    ['legL', d.legL, 0.025],
    ['legR', d.legR, 0.025],
    ['ptL', d.ptL, 0.025],
    ['ptR', d.ptR, 0.025],
    ['ptB', d.ptB, 0.025],
  ])) {
    if (name === 'core') {
      const hv = sstep(-0.05, 0.05, y - NECK_Y + 0.15 * (z - 0.05)); // the chin sits above the nape
      w.put('head', v * hv);
      w.put('body', v * (1 - hv));
    } else if (name === 'ptL' || name === 'ptR') {
      const line = name === 'ptL' ? shape.lineL : shape.lineR;
      const L = line.lens;
      chain(w, v, line.param(x, y, z), ['head', name === 'ptL' ? 'ear_L' : 'ear_R'], [L[1] * 0.45], 0.06);
    } else if (name === 'ptB') {
      const L = shape.lineB.lens;
      chain(w, v, shape.lineB.param(x, y, z), ['head', 'tail_1', 'tail_2', 'tail_3'], [L[1] * 0.45, L[2], L[3]], 0.06);
    } else if (name === 'legL' || name === 'legR') {
      const rootK = sstep(0.17, 0.09, y); // the shoes stay planted when the body leans
      w.put('root', v * rootK);
      w.put(name === 'legL' ? 'leg_L' : 'leg_R', v * (1 - rootK));
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
    const g = gauss(p, [0, 0.5, 0.2], 0.14) * (1 - headW); // the tummy puffs too
    if (g > 0.01) out.puff = scl(n, 0.03 * g);
    return out;
  }
  if (brimS(q) > -0.03) return out; // the hat stays put
  const fr = sstep(0.05, 0.2, q[2]) * headW;
  const corner = mirror(q, [0.07, MOUTH_Y + 0.012], 0.032) * fr;
  const cheek = mirror(q, [0.2, -0.11, 0.25], 0.07) * fr;
  const browIn = mirror(q, [0.08, 0.17, 0.3], 0.05) * fr;
  const browOut = mirror(q, [0.24, 0.15], 0.05) * fr;
  const brow = mirror(q, [0.15, 0.18], 0.08) * fr;
  const chin = gauss(q, [0, -0.25], 0.06) * fr;
  const lip = gauss(q, [0, MOUTH_Y - 0.02], 0.035) * fr;
  // slid along the surface, so the skin never covers the mouth's inside
  const slide = (dv) => (len(dv) < 1e-6 ? dv : sub(project(f, add(p, dv)), p));
  out.happy = add(slide(fdir(0, 0.022 * corner + 0.016 * cheek, 0)), scl(n, 0.008 * cheek));
  out.sad = slide(fdir(0, -0.02 * corner + 0.02 * browIn - 0.012 * browOut, 0));
  out.surprised = slide(fdir(0, 0.024 * brow - 0.01 * chin, 0));
  out.mouthOpen = slide(fdir(0, -0.03 * chin, 0));
  out.angry = fdir(0, -0.024 * browIn - 0.014 * corner - 0.006 * lip, 0.012 * browIn + 0.012 * lip);
  out.puff = scl(n, 0.03 * mirror(q, [0.22, -0.11, 0.1], 0.1) * headW);
  out.tongue = slide(fdir(0, -0.008 * chin, 0));
  return out;
}

// ---------------------------------------------------------------------------- the painting

/** The shell's paint at design-space point p: the tinted costume and the painted doll details. */
function makeSkinPainter(shape) {
  const parts = {};
  const [eyeL, eyeR] = shape.eyes;
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const q = wf(x, y, z);
    const [qx, qy, qz] = q;
    shape.parts(x, y, z, parts);
    const dm = Math.min(...['head', 'crown', 'band', 'torso', 'ruff', 'armL', 'armR', 'legL', 'legR', 'ptL', 'ptR', 'ptB'].map((k) => parts[k]));
    const near = (dd) => (dd - dm < 0.012 ? 1 : 0);
    const grain = vnoise(x * 80, y * 80, z * 80);
    const cloth = 0.8 + 0.06 * (fbm(x * 9 + 3, y * 9, z * 9) - 0.5) + 0.03 * (grain - 0.5);
    let col = [cloth, cloth, cloth];
    let paint = 0; // 1 = painted (untinted)
    const gold = lerp3(COL.gold, COL.goldDark, 0.35 * (1 - grain) + 0.25 * sstep(0.2, -0.6, n[1]));
    const cream = lerp3(COL.cream, scl(COL.cream, 0.9), 1 - (grain * 0.4 + fbm(x * 8, y * 8, z * 8) * 0.6));
    const bellP = (c) => {
      // a bell: bright gold with a dark slot across its bottom
      const dv = sub(p, c);
      const slot = sstep(0.012, 0.006, Math.abs(dv[0] * (Math.abs(c[0]) > 0.3 ? 0 : 1) + dv[2] * (Math.abs(c[0]) > 0.3 ? 1 : 0))) * sstep(-0.01, -0.03, dv[1]);
      return lerp3(lerp3(COL.bell, COL.goldDark, 0.4 * sstep(0.3, -0.8, n[1])), COL.ink, slot * 0.9);
    };

    if (near(parts.ptL) || near(parts.ptR) || near(parts.ptB)) {
      const which = near(parts.ptL) ? 'L' : near(parts.ptR) ? 'R' : 'B';
      const pts = { L: POINT_L, R: POINT_R, B: POINT_B }[which];
      const bc = bellAt(pts);
      if (len(sub(p, bc)) < BELL_R + 0.006) {
        col = bellP(bc);
        paint = 1;
      } else {
        // the right point lighter, as the code-built one's accent
        const k = which === 'R' ? 1.2 : 1;
        col = scl(col, k);
        // a seam of stitches along the top of each point
        const line = { L: shape.lineL, R: shape.lineR, B: shape.lineB }[which];
        const s = line.param(x, y, z);
        if (s < 0.08) col = scl(col, 0.92);
      }
    } else if (near(parts.band)) {
      col = gold;
      paint = 1;
    } else if (near(parts.crown) && brimS(q) > -0.004) {
      // the crown: tinted, darker toward the band
      col = scl(col, 0.96 - 0.08 * sstep(0.06, 0.0, brimS(q)));
    } else if (near(parts.head)) {
      // the porcelain face: rosy cheeks, the painted smile, a nose dot, the diamond under its left eye
      col = lerp3(COL.porcelain, COL.shade, 0.5 * sstep(0.0, -0.3, qz) + 0.2 * (1 - grain) * 0.3);
      paint = 1;
      if (qz > 0.05) {
        const ch = Math.min(Math.hypot((qx - 0.205) / 0.07, (qy + 0.11) / 0.05), Math.hypot((qx + 0.205) / 0.07, (qy + 0.11) / 0.05));
        col = lerp3(col, COL.rose, 0.85 * sstep(1.25, 0.2, ch));
        const nd = Math.hypot(qx / 0.024, (qy + 0.07) / 0.02);
        col = lerp3(col, COL.rose, sstep(1.1, 0.8, nd));
        // the smile: a crescent, thick in the middle, thin at the corners
        const cy = MOUTH_Y + 0.055;
        const r = Math.hypot(qx, qy - cy);
        const thick = mix(0.012, 0.004, sstep(0.0, 0.07, Math.abs(qx)));
        if (qy < cy - 0.02 && Math.abs(qx) < 0.075) {
          const k = sstep(thick + 0.002, thick - 0.002, Math.abs(r - 0.062));
          col = lerp3(col, COL.lip, k);
        }
        // the diamond under the left (+X) eye, in the body colour (tinted)
        const dia = Math.abs(qx - 0.15) / 0.034 + Math.abs(qy + 0.135) / 0.055;
        const kd = sstep(1.05, 0.92, dia);
        if (kd > 0) {
          col = lerp3(col, [0.62, 0.62, 0.62], kd);
          paint = 1 - kd;
        }
      }
      for (const e of [eyeL, eyeR]) {
        // the socket wall: a soft crease
        const k = sstep(EYE_R * R_SOCK + 0.004, EYE_R * R_SOCK - 0.002, len(sub(p, e.E)));
        if (k > 0) col = scl(col, 1 - 0.18 * k);
      }
    } else if (near(parts.ruff)) {
      const a = Math.atan2(x, z);
      col = scl(cream, 0.88 + 0.12 * Math.abs(Math.cos(a * 6)));
      paint = 1;
    } else if (near(parts.torso)) {
      // the harlequin diamonds: a checker of diamonds, gold on the tint
      const a = Math.atan2(x, z);
      const u = (a * 8) / (2 * Math.PI) + 0.5;
      const v = (y - 0.5) / 0.19;
      const pa = u + v;
      const pb = u - v;
      const fa = pa - Math.floor(pa);
      const fb = pb - Math.floor(pb);
      const odd = (Math.floor(pa) + Math.floor(pb)) & 1;
      const edge = Math.min(fa, 1 - fa, fb, 1 - fb);
      const k = odd ? sstep(0.0, 0.04, edge) : 0;
      col = lerp3(col, gold, k);
      paint = k;
    } else if (near(parts.armL) || near(parts.armR)) {
      const mitten = Math.min(len(sub(p, [0.315, 0.375, 0.065])), len(sub(p, [-0.315, 0.375, 0.065])), len(sub(p, [0.275, 0.395, 0.11])) + 0.03, len(sub(p, [-0.275, 0.395, 0.11])) + 0.03);
      const km = sstep(0.095, 0.08, mitten);
      if (x > 0) col = gold; // the gold sleeve on its left
      col = lerp3(col, cream, km);
      paint = x > 0 ? 1 : km;
      // a cuff
      if (km < 0.5 && mitten < 0.11) col = scl(col, 0.9);
    } else if (near(parts.legL) || near(parts.legR)) {
      const toeBell = Math.min(len(sub(p, [0.115, 0.165, 0.222])), len(sub(p, [-0.115, 0.165, 0.222])));
      if (toeBell < 0.038) {
        col = lerp3(COL.bell, COL.goldDark, 0.4 * sstep(0.3, -0.8, n[1]));
        paint = 1;
      } else if (y < 0.115 || z > 0.12) {
        col = scl(col, 1.18); // the shoes, lighter (the code-built one's accent)
      } else if (x < 0) {
        col = gold; // the gold leg on its right
        paint = 1;
      }
    }
    write(o, scl(col, ao), 1 - paint);
  };
}

// ------------------------------------------------------------------------------- the build

/**
 * @param {{texture?: number, triangles?: number, grid?: number}} [o] texture size, target triangles
 *   for the fused shell, surface-nets grid spacing (design units)
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 6000, grid = 0.018 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  // the fused shell; the face, hat points, hands and shoes kept denser
  const shell = buildShell(f, {
    lo: [-0.86, -0.04, -0.84],
    hi: [0.86, 1.56, 0.4],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      let k = Math.hypot(qx / 0.3, (qy + 0.06) / 0.25) < 1 && qz > 0.1 ? 3 : 1;
      if (y > 0.95 && (Math.abs(x) > 0.3 || z < -0.35)) k = Math.max(k, 2);
      if (y < 0.2) k = Math.max(k, 1.6);
      return k;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor, { min: 0.74 });

  // the face parts: porcelain eyelids with a painted lash line, the mouth's inside, a tongue
  const face = surfaceAt(f, HEAD);
  const headOnly = [[BI.head, 1]];
  const lids = eyelids(shape.eyes, { rUp: 1.1, rLo: 1.07, margin: 6 * DEG });
  lids.paint = (canvas, atlas) => {
    for (const { upper, rect } of lids.lids)
      paintRect(canvas, atlas, rect, (u, v, out) => {
        const k = sstep(upper ? 0.1 : 0.06, upper ? 0.04 : 0.02, v);
        write(out, lerp3(COL.porcelain, COL.ink, k), 0);
      });
  };
  const parts = [
    lids,
    mouthInside(face, HEAD, {
      y: MOUTH_Y,
      shapes: { mouthOpen: [-0.03, 0.06, 0.055, 0.5, 0.009], surprised: [-0.03, 0.032, 0.036, 1, 0.009], tongue: [-0.018, 0.028, 0.022, 0.6, 0.008] },
      fangs: false,
    }),
    tongue(face, HEAD, { y: MOUTH_Y, length: 0.04, width: 0.028 }),
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

  // the eyeballs (big glossy doll eyes, deep blue) and the scene, 1.5 tall
  const eyes = eyeballs(shape.eyes, {
    bones: { L: BI.eye_L, R: BI.eye_R },
    pupil: 24 * DEG,
    iris: 48 * DEG,
    irisColor: (t, lit) => [mix(0.2, 0.12, t) + 0.12 * lit, mix(0.36, 0.2, t) + 0.14 * lit, mix(0.7, 0.46, t) + 0.12 * lit],
    rimColor: srgb(24, 22, 40),
    na: 24,
  });
  const bones = BONES.map(([nm, parent, p]) => [nm, parent, p ?? { eye_L: eyeL.E, eye_R: eyeR.E }[nm]]);
  return assemble({ name: 'jester', bones, body, eyes, map: toTexture(canvas, 'jester_basecolor'), fit: fitScale(body, shellCount), roughness: 0.6 });
}

export const buildJester = build;

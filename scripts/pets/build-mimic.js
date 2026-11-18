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
  cross,
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
  hash,
  len,
  lerp3,
  mix,
  norm,
  paintRect,
  paintShell,
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
  toTexture,
  vnoise,
  weights,
  write,
} from './lib/index.js';

/**
 * Dicer's mimic pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a treasure-chest monster on four stubby feet. A plank chest with rounded edges, iron
 * straps and bands, brass corner brackets, hinges, a lock plate and a hasp; its barrel LID is the
 * upper jaw, hinged at the back and open at rest on a dark mouth, with teeth on the lid's edge and
 * the chest's rim and a big pink tongue lolling over the front. Two big cartoon eyes sit in wooden
 * mounds on top of the lid, facing up and forward so they read from the top-down camera.
 *
 * Tint: the wood (and the eyelids and feet) is painted neutral grey with darker grain, knots and
 * plank seams (alpha 255); iron, brass, teeth, mouth, tongue and claws keep their paint (alpha 0).
 * Natural colour: #9a6a32.
 *
 * One fused `Body` shell (chest, lid, eye mounds, teeth, metalwork, feet: a distance field,
 * meshed), with the eyelids and the tongue in the same mesh; `Eyes` the eyeballs. The whole chest
 * is on `head` (pivot low over the front feet, so a look turns the chest and a nod tips it forward
 * onto them), the front feet on arm_L/R (under head, so they turn with the chest, and kick), the
 * back feet rigid and planted on root. No jaw bone: the lid opens and shuts with shape keys (rigid
 * turns about the hinge stored as morphs; Dicer drives `mouthOpen`, and a jaw only without it):
 * mouthOpen and surprised open it wider, happy a little, sad droops it nearly shut, angry lowers
 * it. The eyeballs, their lids and mounds ride along with the lid but turn only EYE_FOLLOW of its
 * angle, so the eyes keep facing the camera. Shape keys: all eleven of the spec (tongue: a blep).
 */

// ------------------------------------------------------------------------------- the design

const W2 = 0.7; // chest half width (x)
const D2 = 0.52; // chest half depth (z)
const Y0 = 0.13; // chest bottom
const Y1 = 0.62; // chest rim (top)
const WALL = 0.07;
const FLOOR = 0.42; // the mouth's floor
const HINGE = [0, Y1, -0.5]; // the lid's hinge axis (along x) passes through here
const L0 = 0.84; // the lid's opening at rest, rad
const LID = tiltFrame(HINGE, L0); // lid-local (closed) <-> model: fw, fdir, wf
const LD = 1.02; // lid depth from the hinge
const LH = 0.34; // lid height at the crown
const RC = 0.95; // barrel radius of the lid's top
const BARREL = [LH - RC, LD / 2 - 0.01]; // barrel axis (ly, lz)
const PAL_H = 0.1; // the palate's depth into the lid

const EYE_R = 0.205;
const R_SOCK = 1.08;
const EYE_LOCAL = [0.36, 0.33, 0.86]; // eye centre, lid-local (x mirrored)
const EYE_ELEV = 60 * DEG; // the eyes' facing above horizontal, in the model at rest
const CUP_BACK = 0.04; // the mound's centre behind the eye's
const CUP_R = [0.27, 0.295, 0.27]; // the mound's radii (eye's X, U, F)
const CUP_OPEN = 58 * DEG; // the eyeball shows this far round from its front
const EYE_YAW = 0.12;
const EYE_FOLLOW = 0.45; // share of the lid's turns the eyes follow (they ride along regardless)

// Lid turns per shape key (rad, + opens).
const LID_KEYS = { mouthOpen: 0.36, surprised: 0.4, happy: 0.1, sad: -0.68, angry: -0.3 };

const FEET = [
  [0.6, 0.4],
  [-0.6, 0.4],
  [0.6, -0.4],
  [-0.6, -0.4],
];

const COL = {
  iron: srgb(74, 72, 78),
  ironHi: srgb(150, 148, 152),
  brass: srgb(200, 152, 64),
  brassHi: srgb(246, 214, 130),
  brassLo: srgb(132, 92, 34),
  tooth: srgb(246, 240, 222),
  toothRoot: srgb(214, 196, 160),
  gum: srgb(178, 72, 92),
  mouth: srgb(108, 30, 44),
  deep: srgb(42, 10, 18),
  tongue: srgb(240, 112, 136),
  tongueDark: srgb(198, 74, 102),
  tongueTip: srgb(250, 150, 166),
  claw: srgb(236, 226, 206),
  ink: srgb(24, 20, 24),
};

/** Rotates model point p about the hinge axis by theta (+ opens the lid: its front goes up). */
function lidTurn(p, th) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const y = p[1] - HINGE[1];
  const z = p[2] - HINGE[2];
  return [p[0], HINGE[1] + y * c + z * s, HINGE[2] - y * s + z * c];
}

/**
 * Where point q of an eye's group (eyeball, eyelids, mound) goes when the lid turns by th: carried
 * with the eye's centre E, but turned about it by only EYE_FOLLOW x th (the eyes keep looking up
 * at the camera). frac = 1 turns it as rigidly as the lid.
 */
function eyeTurn(q, E, th, frac = EYE_FOLLOW) {
  const a = th * frac;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const C = lidTurn(E, th);
  const y = q[1] - E[1];
  const z = q[2] - E[2];
  return sub([C[0] + q[0] - E[0], C[1] + y * c + z * s, C[2] - y * s + z * c], q);
}

/** The eyes on the lid: model-space frames (E centre, F forward, U up, X), as lib/parts.js's. */
function makeEyes() {
  return [1, -1].map((side) => {
    const E = LID.fw(EYE_LOCAL[0] * side, EYE_LOCAL[1], EYE_LOCAL[2]);
    const F = norm([Math.sin(EYE_YAW) * side, Math.sin(EYE_ELEV), Math.cos(EYE_ELEV) * Math.cos(EYE_YAW)]);
    let U = LID.fdir(0, 1, 0);
    U = norm(sub(U, scl(F, dot(U, F))));
    const X = cross(U, F);
    const El = [EYE_LOCAL[0] * side, EYE_LOCAL[1], EYE_LOCAL[2]];
    const Fl = norm(LID.wf(...add(E, F)).map((v, i) => v - El[i])); // F in lid-local
    return { side, r: EYE_R, E, F, U, X, El, Fl, top: 0, bottom: 0 };
  });
}

function makeShape() {
  const eyes = makeEyes();
  // the chest
  const baseBox = roundBox([0, (Y0 + Y1) / 2, 0], [W2, (Y1 - Y0) / 2, D2], 0.075);
  const cavTop = Y1 + 0.2;
  const baseCav = roundBox([0, (FLOOR + cavTop) / 2, 0], [W2 - WALL, (cavTop - FLOOR) / 2, D2 - WALL], 0.05);
  const lock = roundBox([0, 0.33, D2 + 0.004], [0.088, 0.085, 0.032], 0.022);
  // the lid, in lid-local coordinates
  const lidBox = roundBox([0, LH / 2, LD / 2 - 0.01], [W2 + 0.012, LH / 2, LD / 2 + 0.01], 0.06);
  const palate = roundBox([0, 0, LD / 2 - 0.01], [W2 - WALL + 0.012, PAL_H, LD / 2 - WALL + 0.01], 0.05);
  const hasp = roundBox([0, -0.01, LD + 0.006], [0.052, 0.1, 0.02], 0.016);
  // the mounds: an ellipsoid hugging each eyeball from behind, cut off in front so the eyeball
  // shows over a cap of CUP_OPEN (in the eye's own axes, lid-local)
  const cupShape = ellipsoid([0, 0, -CUP_BACK], CUP_R);
  const cutAt = EYE_R * Math.cos(CUP_OPEN);
  const domes = eyes.map((e) => {
    const Ul = norm(sub(LID.wf(...add(e.E, e.U)), e.El));
    const Xl = cross(Ul, e.Fl);
    return (lx, ly, lz) => {
      const q = [lx - e.El[0], ly - e.El[1], lz - e.El[2]];
      const qf = dot(q, e.Fl);
      return smax(cupShape(dot(q, Xl), dot(q, Ul), qf), qf - cutAt, 0.03);
    };
  });
  const spine = roundCone([-0.6, Y1 + 0.008, -0.49], [0.6, Y1 + 0.008, -0.49], 0.05, 0.05); // fills the throat
  const hinges = [1, -1].map((s) => roundCone([s * 0.3, Y1 + 0.005, -0.535], [s * 0.48, Y1 + 0.005, -0.535], 0.042, 0.042));
  // teeth: up from the rim, down from the lid's edge
  const teethB = [];
  for (const x of [0.25, 0.45, 0.61]) for (const s of [1, -1]) teethB.push(roundCone([s * x, Y1 - 0.04, D2 - WALL / 2], [s * x * 0.98, Y1 + 0.105, D2 - WALL / 2 - 0.012], 0.045, 0.009));
  for (const z of [0.2, -0.08]) for (const s of [1, -1]) teethB.push(roundCone([s * (W2 - WALL / 2), Y1 - 0.04, z], [s * (W2 - WALL / 2 - 0.012), Y1 + 0.095, z], 0.042, 0.009));
  const teethL = [];
  const fz = LD - 0.01 - WALL / 2;
  for (const x of [0.12, 0.35, 0.56]) for (const s of [1, -1]) teethL.push(roundCone([s * x, 0.04, fz], [s * x, -0.105, fz - 0.012], 0.045, 0.009));
  for (const z of [0.68, 0.38]) for (const s of [1, -1]) teethL.push(roundCone([s * (W2 - WALL / 2 + 0.012), 0.04, z], [s * (W2 - WALL / 2), -0.095, z], 0.042, 0.009));
  const feet = FEET.map(([x, z]) => ellipsoid([x, 0.088, z], [0.145, 0.1, 0.162]));

  const shape = { eyes };
  /** Distances to the parts at model point (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    // chest
    const bOut = baseBox(x, y, z);
    const cav = baseCav(x, y, z);
    o.base = smax(bOut, -cav, 0.015);
    const strap = Math.max(bOut - 0.014, Math.abs(x) - 0.056);
    const corner = Math.max(bOut - 0.012, W2 - 0.1 - Math.abs(x), D2 - 0.1 - Math.abs(z));
    o.iron = smax(strap, -cav, 0.01);
    o.brass = Math.min(smax(corner, -cav, 0.01), lock(x, y, z));
    // lid
    const [lx, ly, lz] = LID.wf(x, y, z);
    const barrel = Math.hypot(ly - BARREL[0], lz - BARREL[1]) - RC;
    const lOut = smax(lidBox(lx, ly, lz), barrel, 0.06);
    const pal = palate(lx, ly, lz);
    const dome = Math.min(domes[0](lx, ly, lz), domes[1](lx, ly, lz));
    o.dome = dome;
    o.lidWood = smax(lOut, -pal, 0.015);
    o.lid = smax(smin(lOut, dome, 0.07), -pal, 0.015);
    const lStrap = Math.max(lOut - 0.014, Math.abs(lx) - 0.056);
    const lCorner = Math.max(lOut - 0.012, W2 - 0.1 - Math.abs(lx), LD / 2 - 0.11 - Math.abs(lz - LD / 2 + 0.01));
    o.lidIron = Math.min(smax(lStrap, -pal, 0.01), spine(x, y, z));
    o.lidBrass = Math.min(smax(lCorner, -pal, 0.01), hasp(lx, ly, lz), hinges[0](x, y, z), hinges[1](x, y, z));
    let tb = Infinity;
    for (const t of teethB) tb = Math.min(tb, t(x, y, z));
    o.teethB = tb;
    let tl = Infinity;
    for (const t of teethL) tl = Math.min(tl, t(lx, ly, lz));
    o.teethL = tl;
    let fd = Infinity;
    let fi = 0;
    for (let i = 0; i < feet.length; i++) {
      const d = feet[i](x, y, z);
      if (d < fd) {
        fd = d;
        fi = i;
      }
    }
    o.feet = fd;
    o.foot = fi;
    o.local = [lx, ly, lz];
    return o;
  };
  const P = {};
  const union = () => {
    let chest = Math.min(P.base, P.iron, P.brass);
    chest = smin(chest, P.feet, 0.05);
    chest = smin(chest, P.teethB, 0.012);
    let lid = Math.min(P.lid, P.lidIron, P.lidBrass);
    lid = smin(lid, P.teethL, 0.012);
    return Math.min(chest, lid);
  };
  /** The mimic without eye sockets (for the eyes' openings and for occlusion). */
  shape.solid = (x, y, z) => {
    shape.parts(x, y, z, P);
    return smax(union(), -y, 0.02);
  };
  shape.sdf = (x, y, z) => {
    shape.parts(x, y, z, P);
    return smax(carveSockets(union(), x, y, z, eyes, EYE_R * R_SOCK, { k: 0.025 }), -y, 0.02);
  };
  // the eyes' openings through the mounds (as placeEyes measures them)
  for (const e of eyes) {
    const opening = (dir) => {
      for (let a = 0; a < 89 * DEG; a += 0.25 * DEG) {
        const p = add(e.E, scl(add(scl(e.F, Math.cos(a)), scl(e.U, Math.sin(a) * dir)), e.r));
        if (shape.solid(p[0], p[1], p[2]) < 0) return a;
      }
      return 89 * DEG;
    };
    e.top = opening(1);
    e.bottom = opening(-1);
  }
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.16, 0]],
  ['head', 'body', [0, 0.16, 0.33]], // the whole chest, pivoting over its front feet
  ['eye_L', 'head', null],
  ['eye_R', 'head', null],
  ['arm_L', 'head', [0.6, 0.17, 0.36]], // the front feet: they turn with the chest, and kick
  ['arm_R', 'head', [-0.6, 0.17, 0.36]],
];
const BI = boneIndex(BONES);

/** Skin weights: the chest rigid on head, front feet on the arms, back feet planted on root. */
function skinOf(d) {
  const w = weights();
  const core = Math.min(d.base, d.iron, d.brass, d.teethB, d.lid, d.lidIron, d.lidBrass, d.teethL);
  for (const [name, v] of soft([
    ['core', core, 0.025],
    ['foot', d.feet, 0.025],
  ])) {
    if (name === 'core') w.put('head', v);
    else w.put(d.foot === 0 ? 'arm_L' : d.foot === 1 ? 'arm_R' : 'root', v); // rigid feet: the chest turns over them
  }
  return w.done(BI);
}

/** The lid's (and the eye mounds') keys at a lid point p: rigid turns, the mounds translated. */
function lidKeys(p, eyes, isLid) {
  const out = {};
  if (!isLid) return out;
  const e = len(sub(p, eyes[0].E)) < len(sub(p, eyes[1].E)) ? eyes[0] : eyes[1];
  const wd = sstep(0.37, 0.28, len(sub(p, e.E)));
  for (const [k, th] of Object.entries(LID_KEYS)) out[k] = eyeTurn(p, e.E, th, mix(1, EYE_FOLLOW, wd));
  return out;
}

// ------------------------------------------------------------------------------ the tongue

const T_REST = [
  [0, 0.44, -0.24],
  [0, 0.455, 0.06],
  [0, 0.5, 0.33],
  [0, 0.656, 0.5],
  [0, 0.575, 0.588],
  [0, 0.42, 0.596],
];
const T_KEYS = {
  happy: [
    [0, 0.445, -0.2],
    [0, 0.46, 0.1],
    [0.0, 0.51, 0.37],
    [0.03, 0.655, 0.51],
    [0.08, 0.54, 0.598],
    [0.15, 0.37, 0.6],
  ],
  tongue: [
    [0, 0.45, -0.14],
    [0, 0.47, 0.15],
    [0, 0.54, 0.41],
    [0, 0.668, 0.56],
    [0, 0.655, 0.71],
    [0, 0.6, 0.83],
  ],
  sad: [
    [0, 0.44, -0.36],
    [0, 0.44, -0.16],
    [0, 0.445, 0.04],
    [0, 0.45, 0.2],
    [0, 0.455, 0.3],
    [0, 0.458, 0.36],
  ],
};
T_KEYS.angry = T_REST.map((p, i) => lerp3(p, T_KEYS.sad[i], 0.55));
T_KEYS.mouthOpen = T_REST.map((p, i) => add(p, [0, 0.03 * sstep(2, 5, i), 0.012 * sstep(2, 5, i)]));

/** A Catmull-Rom curve through pts, s in 0..1: { p, T }. */
function curveAt(pts, s) {
  const n = pts.length - 1;
  const f = Math.min(n - 1e-6, Math.max(0, s * n));
  const i = Math.floor(f);
  const t = f - i;
  const P0 = pts[Math.max(0, i - 1)];
  const P1 = pts[i];
  const P2 = pts[i + 1];
  const P3 = pts[Math.min(n, i + 2)];
  const p = [0, 1, 2].map((k) => {
    const a = P1[k];
    const b = 0.5 * (P2[k] - P0[k]);
    const c = P0[k] - 2.5 * P1[k] + 2 * P2[k] - 0.5 * P3[k];
    const d = -0.5 * P0[k] + 1.5 * P1[k] - 1.5 * P2[k] + 0.5 * P3[k];
    return a + t * (b + t * (c + t * d));
  });
  const T = norm(
    [0, 1, 2].map((k) => {
      const b = 0.5 * (P2[k] - P0[k]);
      const c = P0[k] - 2.5 * P1[k] + 2 * P2[k] - 0.5 * P3[k];
      const d = -0.5 * P0[k] + 1.5 * P1[k] - 1.5 * P2[k] + 0.5 * P3[k];
      return b + 2 * c * t + 3 * d * t * t;
    }),
  );
  return { p, T };
}

/** The big tongue: a flattened, grooved tube along a curve, lolling over the front rim. */
function bigTongue({ NV = 18, NU = 16, width = 0.2, thick = 0.044 } = {}) {
  let r = -1;
  const prof = (s) => Math.sqrt(Math.max(0, 1 - ((s - 0.6) / (s < 0.6 ? 0.6 : 0.4)) ** 2));
  const at = (pts, s, u) => {
    const { p, T } = curveAt(pts, s);
    const Wv = norm(sub([1, 0, 0], scl(T, T[0])));
    const N = cross(T, Wv);
    const k = prof(s);
    const w = width * Math.max(k, 0) * (0.82 + 0.18 * s);
    const th = thick * k ** 0.6;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const groove = su > 0 ? 0.35 * th * Math.exp(-((cu / 0.22) ** 2)) * su : 0;
    const pos = add(add(p, scl(Wv, w * cu)), scl(N, th * su - groove));
    const nrm = k < 1e-3 ? (s < 0.5 ? scl(T, -1) : T) : norm(add(scl(Wv, cu / Math.max(w, 1e-4)), scl(N, su / Math.max(th, 1e-4))));
    return { pos, nrm };
  };
  return {
    reserve(atlas) {
      r = atlas.addRect(0.36, 0.5);
    },
    build(buf, atlas, wts) {
      const base = buf.count;
      for (let j = 0; j <= NV; j++)
        for (let i = 0; i <= NU; i++) {
          const s = (1 - Math.cos((Math.PI * j) / NV)) / 2;
          const u = (i / NU) * Math.PI * 2 - Math.PI / 2; // the seam underneath
          const rest = at(T_REST, s, u);
          const mo = {};
          for (const [k, pts] of Object.entries(T_KEYS)) mo[k] = sub(at(pts, s, u).pos, rest.pos);
          buf.addVertex(rest.pos, rest.nrm, atlas.rectUV(r, i / NU, j / NV), wts, mo);
        }
      buf.grid(base, NV, NU, (a) => buf.nor.slice(a * 3, a * 3 + 3));
    },
    paint(canvas, atlas) {
      paintRect(canvas, atlas, r, (u, v, out) => {
        const ang = u * Math.PI * 2 - Math.PI / 2;
        const top = Math.sin(ang);
        let c = lerp3(COL.tongue, COL.tongueTip, sstep(0.55, 0.95, v) * 0.7);
        c = lerp3(c, COL.tongueDark, sstep(0.25, 0.05, Math.abs(Math.cos(ang))) * sstep(0, 0.5, top) * sstep(0.05, 0.3, v) * sstep(0.95, 0.75, v) * 0.75);
        c = lerp3(c, COL.tongueDark, sstep(0, -0.8, top) * 0.5); // underside darker
        c = scl(c, 0.94 + 0.08 * vnoise(u * 40, v * 60, 3));
        write(out, c, 0);
      });
    },
  };
}

// ---------------------------------------------------------------------------- the painting

/** Wood: neutral grey planks with grain, knots and dark seams (tinted). s: across the planks, a: along. */
function wood(a, s, pw, seed, edge = 1) {
  const idx = Math.floor(s / pw);
  const f = s / pw - idx;
  const h = hash(idx + 31 * seed, seed, 7);
  let g = 0.8 + 0.07 * (h - 0.5);
  // grain lines, wandering along the plank
  const t = (s - idx * pw) * 34 + 4.5 * fbm(a * 1.6 + idx * 13.1, (s - idx * pw) * 5, seed + idx * 3.7);
  g *= 1 - 0.09 * band(t, 0.22, 0.12);
  g *= 0.97 + 0.06 * (vnoise(a * 30 + idx * 5, s * 120, seed) - 0.5);
  // a knot or two
  const kx = (hash(idx, seed, 3) - 0.5) * 1.2;
  const kd = Math.hypot((a - kx) / 0.055, (f - 0.5) / (0.028 / pw));
  if (h > 0.35 && kd < 2.4) {
    g *= 1 - 0.22 * sstep(1, 0.4, kd);
    g *= 1 - 0.08 * band(kd * 1.6, 0.3) * sstep(2.4, 1, kd);
  }
  // seams
  const ds = Math.min(f, 1 - f) * pw;
  g *= 1 - 0.36 * sstep(0.008, 0.002, ds) * edge;
  g *= 1 - 0.08 * sstep(0.02, 0.008, ds) * edge;
  return g;
}

/** Rivet shading at offset (u, v) from its centre: 1 lit dome, -1 its rim shadow, 0 none. */
function rivet(du, dv, r = 0.013) {
  const d = Math.hypot(du, dv);
  if (d < r) return 1 - 0.4 * sstep(0, r, Math.hypot(du + r * 0.4, dv - r * 0.4));
  return d < r * 1.5 ? -1 : 0;
}

function makeSkinPainter(shape) {
  const parts = {};
  const [eyeL, eyeR] = shape.eyes;
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const d = shape.parts(x, y, z, parts);
    const [lx, ly, lz] = d.local;
    const dm = Math.min(d.base, d.iron, d.brass, d.lid, d.lidIron, d.lidBrass, d.teethB, d.teethL, d.feet);
    const near = (v, m = 0.008) => v - dm < m;
    const nl = LID.wf(...add(p, n)).map((v, i) => v - d.local[i]); // the normal, lid-local
    const onLid = Math.min(d.lid, d.lidIron, d.lidBrass, d.teethL) < Math.min(d.base, d.iron, d.brass, d.teethB, d.feet);
    let c;
    let paint = 1; // 1: painted (alpha 0)

    if (near(d.teethB, 0.004) || near(d.teethL, 0.004)) {
      // teeth: ivory, yellowing to the root
      const root = onLid ? sstep(-0.04, 0.03, ly) : sstep(Y1 + 0.02, Y1 - 0.03, y);
      c = lerp3(COL.tooth, COL.toothRoot, root);
      c = scl(c, 0.96 + 0.06 * vnoise(x * 60, y * 60, z * 60));
    } else if (Math.abs(x) < W2 - WALL + 0.006 && Math.abs(z) < D2 - WALL + 0.006 && y < Y1 + 0.07 && z < -0.3) {
      // the throat, where the lid's back meets the chest's
      c = scl(COL.deep, 0.9 + 0.2 * fbm(x * 9, y * 9, z * 9));
    } else if (!onLid && Math.abs(x) < W2 - WALL + 0.006 && Math.abs(z) < D2 - WALL + 0.006 && y < Y1 - 0.003 && y > FLOOR - 0.03 && !near(d.feet)) {
      // the mouth: gums at the rim, darkening down into the throat
      const depth = sstep(Y1 - 0.01, FLOOR + 0.04, y);
      c = lerp3(COL.gum, COL.mouth, sstep(0, 0.35, depth));
      c = lerp3(c, COL.deep, sstep(0.4, 1, depth) * 0.55 + 0.35 * sstep(0.1, -0.35, z) * sstep(0.5, 1, depth));
      if (y < FLOOR + 0.01) c = lerp3(COL.mouth, COL.deep, sstep(0.25, -0.4, z) * 0.8); // the floor
      c = scl(c, 0.9 + 0.15 * fbm(x * 9, y * 9, z * 9));
    } else if (Math.abs(lx) < W2 - WALL + 0.018 && Math.abs(lz - LD / 2 + 0.01) < LD / 2 - WALL + 0.016 && ly > -0.008 && ly < PAL_H + 0.02 && !near(d.teethL, 0.01)) {
      // the palate: ridged, gums at the edge
      const edge = sstep(0.005, 0.06, ly);
      c = lerp3(COL.gum, COL.mouth, edge);
      c = lerp3(c, COL.deep, sstep(0.6, 0.0, lz) * edge * 0.6);
      c = scl(c, 1 - 0.18 * band(lz * 9, 0.3) * sstep(PAL_H - 0.03, PAL_H, ly) * sstep(0.62, 0.3, Math.abs(lx)));
      c = scl(c, 0.9 + 0.15 * fbm(lx * 9, ly * 9, lz * 9));
    } else if (near(d.feet, 0.01) && d.feet < Math.min(d.base, d.iron, d.brass) + 0.03 && y < 0.2) {
      // feet: darker, plain (tinted), with three claws in front
      const [fx, fz] = FEET[d.foot];
      let g = 0.66 + 0.06 * (fbm(x * 12, y * 12, z * 12) - 0.5);
      g *= 1 - 0.2 * sstep(0.12, 0.17, y);
      c = [g, g, g];
      paint = 0;
      const dz = z - fz - 0.12;
      if (dz > 0 && y < 0.11)
        for (const cx of [-0.07, 0, 0.07]) {
          const k = sstep(1, 0.75, Math.hypot((x - fx - cx) / 0.032, (y - 0.035) / 0.05));
          if (k > 0) {
            c = lerp3(c, COL.claw, k);
            paint = Math.max(paint, k);
          }
        }
    } else if (!onLid && (near(d.iron) || near(d.brass))) {
      // chest metalwork: the iron strap, brass corners and the lock
      const brass = near(d.brass) && !near(d.iron, 0.002);
      const isLock = Math.abs(x) < 0.11 && z > D2 - 0.01 && y > 0.22 && y < 0.44;
      c = brass ? COL.brass : COL.iron;
      c = scl(c, 0.9 + 0.2 * fbm(x * 14, y * 14, z * 14));
      let rv = 0;
      if (isLock) {
        // the keyhole
        const kh = Math.min(Math.hypot(x, y - 0.345) - 0.019, Math.max(Math.abs(x) - 0.009, Math.abs(y - 0.31) - 0.035));
        if (z > D2 + 0.02) c = lerp3(c, COL.ink, sstep(0.003, -0.002, kh));
        c = lerp3(c, COL.brassHi, sstep(0.006, 0.0, 0.088 - Math.max(Math.abs(x), Math.abs(y - 0.33))) * 0.4 * (z > D2 + 0.02 ? 1 : 0));
        for (const [rx, ry] of [
          [0.058, 0.39],
          [-0.058, 0.39],
          [0.058, 0.27],
          [-0.058, 0.27],
        ])
          rv = rv || rivet(x - rx, y - ry, 0.011);
      } else if (!brass) {
        const along = Math.abs(n[1]) > 0.6 ? z : y;
        rv = rivet(x, (((along + 0.06) % 0.12) + 0.12) % 0.12 - 0.06);
      } else if (Math.abs(n[1]) < 0.6) {
        const across = Math.abs(n[2]) > Math.abs(n[0]) ? Math.abs(x) - (W2 - 0.045) : Math.abs(z) - (D2 - 0.045);
        rv = rivet(across, y < 0.375 ? y - 0.2 : y - 0.54);
      }
      if (rv > 0) c = lerp3(c, brass || isLock ? COL.brassHi : COL.ironHi, 0.8 * rv);
      else if (rv < 0) c = scl(c, 0.6);
    } else if (onLid && (near(d.lidIron) || near(d.lidBrass))) {
      // lid metalwork: the strap, brass corners, the hasp and the hinges
      const brass = near(d.lidBrass) && !near(d.lidIron, 0.002);
      c = brass ? COL.brass : COL.iron;
      c = scl(c, 0.9 + 0.2 * fbm(lx * 14, ly * 14, lz * 14));
      const hinge = z < -0.45 && y < Y1 + 0.08 && Math.abs(x) > 0.25;
      let rv = 0;
      if (hinge) c = scl(c, 0.85 + 0.3 * band(x * 25, 0.15));
      else if (z < -0.43 && y < Y1 + 0.07 && Math.abs(lx) > 0.06) c = scl(COL.iron, 0.75 + 0.2 * band(x * 12, 0.2));
      else if (!brass) {
        const arc = Math.atan2(lz - BARREL[1], ly - BARREL[0]) * RC;
        rv = rivet(lx, (((arc + 0.06) % 0.12) + 0.12) % 0.12 - 0.06);
      } else if (lz > LD - 0.02 && Math.abs(lx) < 0.07) {
        // the hasp: a dark slot near its foot
        c = lerp3(c, COL.ink, sstep(0.004, 0.0, Math.max(Math.abs(lx) - 0.022, Math.abs(ly + 0.07) - 0.012)));
        rv = rivet(lx, ly - 0.05, 0.011);
      } else if (Math.abs(nl[0]) > 0.6) rv = rivet(Math.abs(lz - LD / 2 + 0.01) - (LD / 2 - 0.045), ly - 0.1);
      if (rv > 0) c = lerp3(c, brass ? COL.brassHi : COL.ironHi, 0.8 * rv);
      else if (rv < 0) c = scl(c, 0.6);
    } else if (onLid) {
      // lid wood: planks across the barrel; the mounds unseamed; an iron band round its edge
      const arc = Math.atan2(lz - BARREL[1], ly - BARREL[0]) * RC;
      const mound = d.dome < d.lidWood - 0.004 ? sstep(0, -0.03, d.dome - d.lidWood) : 0;
      let g = wood(lx, arc + 0.03, 0.155, 5, 1 - mound);
      if (Math.abs(nl[1]) < 0.5 && Math.abs(nl[0]) > 0.6) g *= 0.95; // end grain
      c = [g, g, g];
      paint = 0;
      if (ly < 0.012 && nl[1] < -0.55) {
        // the jaw's edge: gums
        c = scl(COL.gum, 0.92 + 0.12 * fbm(lx * 12, ly * 12, lz * 12));
        paint = 1;
      }
      const outer = ly > 0.003 && ly < 0.062 && nl[1] > -0.5;
      if (outer) {
        // the band
        c = scl(COL.iron, 0.9 + 0.2 * fbm(lx * 14, ly * 14, lz * 14));
        const along = Math.abs(nl[0]) > 0.6 ? lz : lx;
        const rv = rivet((((along + 0.08) % 0.16) + 0.16) % 0.16 - 0.08, ly - 0.032, 0.011);
        if (rv > 0) c = lerp3(c, COL.ironHi, 0.8 * rv);
        else if (rv < 0) c = scl(c, 0.6);
        paint = 1;
      }
      for (const e of [eyeL, eyeR]) {
        // the socket's rim: a darker crease
        const k = sstep(EYE_R * R_SOCK + 0.008, EYE_R * R_SOCK - 0.002, len(sub(p, e.E))) * sstep(0.0, 0.06, dot(sub(p, e.E), e.F));
        if (k > 0) c = scl(c, 1 - 0.3 * k);
      }
    } else {
      // chest wood: horizontal planks; the rim's top end grain; an iron band round the top
      const side = Math.abs(n[0]) > Math.abs(n[2]);
      let g;
      if (n[1] > 0.6 && y > Y1 - 0.03) g = -1; // the rim's top: gums
      else if (n[1] > 0.6) g = 0.74 * (0.95 + 0.1 * fbm(x * 20, z * 20, 3));
      else if (n[1] < -0.6) g = wood(z, x + 2, 0.16, 9) * 0.92;
      else g = wood(side ? z : x, y - Y0 + 0.02, 0.122, side ? 3 : 1);
      c = [g, g, g];
      paint = 0;
      if (g < 0) {
        c = scl(COL.gum, 0.92 + 0.12 * fbm(x * 12, y * 12, z * 12));
        paint = 1;
      }
      if (n[1] < 0.6 && y > Y1 - 0.062 && y < Y1 - 0.004) {
        c = scl(COL.iron, 0.9 + 0.2 * fbm(x * 14, y * 14, z * 14));
        const along = side ? z : x;
        const rv = rivet((((along + 0.08) % 0.16) + 0.16) % 0.16 - 0.08, y - (Y1 - 0.033), 0.011);
        if (rv > 0) c = lerp3(c, COL.ironHi, 0.8 * rv);
        else if (rv < 0) c = scl(c, 0.6);
        paint = 1;
      }
      // the base's bottom edge in shadow
      c = scl(c, 1 - 0.12 * sstep(Y0 + 0.08, Y0, y));
    }
    write(o, scl(c, ao), 1 - paint);
  };
}

// ------------------------------------------------------------------------------- the build

const EYE_KEYS = ['surprised', 'mouthOpen', 'sad', 'angry', 'happy'];
const LID_MOTIONS = {
  blink: [{ close: 1 }, { close: 1 }],
  squint: [{ close: 0.5 }, { close: 0.34 }],
  happy: [14, 30],
  sad: [{ deg: 32, roll: -0.5 }, 5],
  angry: [{ deg: 34, roll: 0.8 }, 12],
  surprised: [-8, -6],
};

/**
 * @param {{texture?: number, triangles?: number, grid?: number}} [o] texture size, target triangles
 *   for the fused shell, surface-nets grid spacing (design units)
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 6100, grid = 0.018 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const { eyes } = shape;

  const shell = buildShell(f, {
    lo: [-0.84, -0.04, -0.8],
    hi: [0.84, 1.86, 0.84],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const d = shape.parts(x, y, z);
      if (Math.min(d.teethB, d.teethL) < 0.02) return 3;
      if (Math.min(len(sub([x, y, z], eyes[0].E)), len(sub([x, y, z], eyes[1].E))) < 0.34) return 3.2;
      if (d.feet < 0.02) return 1.8;
      if (Math.min(d.iron, d.brass, d.lidIron, d.lidBrass) < 0.01) return 1.6;
      return 1;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor, { min: 0.7 });

  const headOnly = [[BI.head, 1]];
  const lids = eyelids(eyes, { motions: LID_MOTIONS, fur: 0.78, margin: 6 * DEG, extra: 22 * DEG, rUp: 1.06, rLo: 1.04 });
  const tongue = bigTongue();
  const extras = [lids, tongue];

  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  for (const part of extras) part.reserve(atlas);
  atlas.layout();

  // the Body
  const body = new MeshBuffer(ALL_KEYS);
  const shellTris = appendShell(body, shell, atlas, (i, p) => {
    const d = shape.parts(...p);
    const isLid = Math.min(d.lid, d.lidIron, d.lidBrass, d.teethL) < Math.min(d.base, d.iron, d.brass, d.teethB, d.feet);
    const keys = lidKeys(p, eyes, isLid);
    const wood = Math.min(d.base, d.lid) < Math.min(d.teethB, d.teethL, d.feet) + 0.01;
    if (wood) keys.puff = scl(shell.nor[i], 0.03 * sstep(0.12, 0.3, p[1]));
    return { weights: skinOf(d), keys };
  });
  const shellCount = body.count;
  const lidStart = body.count;
  lids.build(body, atlas, headOnly);
  // the eyelids follow their eye (translated with the lid)
  for (let i = lidStart; i < body.count; i++) {
    const p = body.P(i);
    const e = len(sub(p, eyes[0].E)) < len(sub(p, eyes[1].E)) ? eyes[0] : eyes[1];
    for (const [k, th] of Object.entries(LID_KEYS)) {
      const tr = eyeTurn(p, e.E, th);
      for (let j = 0; j < 3; j++) body.morph[k][i * 3 + j] += tr[j];
    }
  }
  tongue.build(body, atlas, headOnly);

  // the texture
  const canvas = createCanvas(N);
  paintShell(canvas, body, shellTris, makeSkinPainter(shape), {
    pos: (i) => body.P(i),
    nor: (i) => shell.nor[body.src[i]],
    ao: (i) => ao[body.src[i]],
  });
  for (const part of extras) part.paint(canvas, atlas);
  dilate(canvas, 6);

  // the eyeballs: gold irises, big pupils; they ride the lid's keys by translation
  const eyeBuf = eyeballs(eyes, {
    bones: { L: BI.eye_L, R: BI.eye_R },
    pupil: 24 * DEG,
    iris: 45 * DEG,
    rings: [0, 7, 14, 22.5, 23.5, 25, 30, 35, 40, 43.5, 44.5, 46, 48, 53, 62, 78, 100, 125, 150, 180],
    irisColor: (t, lit) => [mix(0.98, 0.86, t) + 0.02 * lit, mix(0.78, 0.48, t) + 0.12 * lit, mix(0.22, 0.08, t)],
    rimColor: srgb(92, 50, 14),
    keys: EYE_KEYS,
  });
  for (let i = 0; i < eyeBuf.count; i++) {
    const p = eyeBuf.P(i);
    const e = len(sub(p, eyes[0].E)) < len(sub(p, eyes[1].E)) ? eyes[0] : eyes[1];
    for (const [k, th] of Object.entries(LID_KEYS)) {
      const tr = eyeTurn(p, e.E, th);
      for (let j = 0; j < 3; j++) eyeBuf.morph[k][i * 3 + j] += tr[j];
    }
  }

  const bones = BONES.map(([n, parent, p]) => [n, parent, p ?? (n === 'eye_L' ? eyes[0].E : eyes[1].E)]);
  return assemble({ name: 'mimic', bones, body, eyes: eyeBuf, map: toTexture(canvas, 'mimic_basecolor'), fit: fitScale(body, shellCount), roughness: 0.74 });
}

export const buildMimic = build;

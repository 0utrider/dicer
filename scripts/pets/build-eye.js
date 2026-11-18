import * as THREE from 'three';
import {
  DEG,
  MeshBuffer,
  REQUIRED_KEYS,
  add,
  appendShell,
  assemble,
  boneIndex,
  buildShell,
  chain,
  clamp,
  coneChain,
  createAtlas,
  createCanvas,
  cross,
  dilate,
  dot,
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
  polyline,
  rotateAbout,
  scl,
  smax,
  smin,
  soft,
  sphere,
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
 * Dicer's floating eye pet (docs/reference/pet-model-spec.md), built with the pet library (lib/,
 * see README.md): one big cute eyeball, its gaze tipped up toward Dicer's top-down camera, set in
 * a smooth round shell that wraps its back. Body-coloured upper and lower lids (with a few long
 * curling lashes on the upper one) frame it; four soft tapering tendrils curl out from underneath
 * and rest on the floor, their tips curling up, little suckers along their undersides. The shell,
 * lids and tendrils are tinted by Dicer (neutral grey with soft spots); the lashes, lash lines and
 * suckers are painted. Natural colour: violet #7b3fa8. The iris is amber with radial streaks.
 *
 * One fused `Body` shell (the ball and the tendrils, a distance field, meshed), the lids and lashes
 * in the same mesh; `Eyes` the one eyeball, on `eye_L`. `eye_R` is a bone at the same centre with
 * no geometry (the loader turns both the same way). Bones: root, body, head (the ball, pivot at
 * its centre), eye_L/R, arm_L/R (the front tendrils), tail_1..3 (the two back tendrils, pivots on
 * the midline above their floor contact so a raise or droop swings them rather than pushing them
 * through the floor).
 *
 * One eye, two blink keys: the lids exist twice, identical (same place, same texture), set "L"
 * moved by blink_L / squint_L and set "R" by blink_R / squint_R, both by every other key. So either
 * blink key alone closes the eye fully, and both together (as the loader blinks) close it once,
 * never twice as far. The lids carry morph normals (they are seen open and shut).
 */

// ------------------------------------------------------------------------------- the design

const CB = [0, 0.88, -0.02]; // the ball's centre (the head pivot)
const SHELL_R = 0.5;
const EYE_R = 0.4;
const EYE_FWD = 0.02; // the eye's centre this far in front of the ball's
const TILT = 55 * DEG; // the eye's opening turned up toward the top-down camera
const IRIS_UP = 8 * DEG; // the iris a little higher still in the opening: it looks up at you
const OPEN = 59 * DEG; // the eye's opening (its lids' edges at +3 deg), from the eye's forward
const LIP = 1.025; // the lids' rounded inner lip, just over the eyeball
const GROOVE = 1.03; // the shell under the lids (x the eyeball)
const RIM = 90 * DEG; // the shell's rim round the lids, from the eye's forward
const HEAD = tiltFrame(CB, TILT);

// A tendril, in its own (outward, up, sideways swirl) coordinates: [out, y, swirl, radius].
const TEND = [
  [0.12, 0.53, 0, 0.105],
  [0.3, 0.34, 0.012, 0.09],
  [0.45, 0.155, 0.03, 0.075],
  [0.6, 0.064, 0.05, 0.062],
  [0.75, 0.053, 0.072, 0.052],
  [0.86, 0.085, 0.09, 0.044],
  [0.895, 0.155, 0.1, 0.037],
  [0.86, 0.212, 0.098, 0.031],
];
const TEND_AZ = [0.8, -0.8, 2.35, -2.35]; // front-left (+X), front-right, back-left, back-right

const COL = {
  lash: srgb(24, 14, 28),
  lashLine: srgb(22, 13, 26),
  sucker: srgb(242, 212, 226),
  suckerIn: srgb(214, 160, 190),
};

/** Lid motions per key: [upper, lower], degrees (+ closes) at the middle (c) and corners (e). */
const MOTIONS = {
  happy: [{ c: 5, e: 3 }, { c: 48, e: 14 }], // the lower lid rises into a smiling crescent
  sad: [{ c: 20, e: 36 }, { c: 7, e: 7 }], // a heavy lid, drooping at the corners
  angry: [{ c: 42, e: 8 }, { c: 12, e: 12 }], // a scowling V
  surprised: [{ c: -5, e: 0 }, { c: -3, e: 0 }], // wide (0 at the corners: no gap opens there)
  mouthOpen: [{ c: -7, e: 0 }, { c: 0, e: 0 }], // a gasp: the eye goes extra wide at the top
  squint: [{ close: 0.5 }, { c: 22, e: 12 }], // (per side: squint_L / squint_R)
};
const KEYS = [...REQUIRED_KEYS, 'squint_L', 'squint_R', 'puff'];

function makeShape() {
  const ball = sphere(CB, SHELL_R);
  const tends = TEND_AZ.map((a) => {
    const side = Math.sign(Math.sin(a));
    const d = [Math.sin(a), 0, Math.cos(a)];
    const pp = [Math.cos(a) * side, 0, -Math.sin(a) * side];
    const pts = TEND.map(([o, y, sw, r]) => [d[0] * o + pp[0] * sw, y, d[2] * o + pp[2] * sw, r]);
    const line = polyline(pts.map((p) => p.slice(0, 3)));
    const cones = coneChain(pts);
    const mid = scl(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
    const bound = Math.max(...pts.map((p) => len(sub(p, mid)) + p[3]));
    const dist = (x, y, z) => {
      const b = Math.hypot(x - mid[0], y - mid[1], z - mid[2]) - bound;
      if (b > 0.15) return b; // far: the bound is enough (no blend reaches)
      let m = Infinity;
      for (const c of cones) m = Math.min(m, c(x, y, z));
      return m;
    };
    const radiusAt = (s) => {
      const L = line.lens;
      for (let i = 0; i + 1 < L.length; i++) if (s <= L[i + 1]) return mix(pts[i][3], pts[i + 1][3], (s - L[i]) / (L[i + 1] - L[i]));
      return pts[pts.length - 1][3];
    };
    return { a, d, pts, line, dist, radiusAt };
  });
  const shape = { tends };
  /** Distances to the ball and each tendril. */
  shape.parts = (x, y, z, o = {}) => {
    o.ball = ball(x, y, z);
    o.t = tends.map((t) => t.dist(x, y, z));
    return o;
  };
  const P = {};
  shape.solid = (x, y, z) => {
    shape.parts(x, y, z, P);
    let d = P.ball;
    for (const t of P.t) d = smin(d, t, 0.09);
    return smax(d, -y, 0.02);
  };
  // the eye: nearly concentric with the ball, so the lids lie flush with the shell
  const F = HEAD.fdir(0, 0, 1);
  const U = HEAD.fdir(0, 1, 0);
  const E = add(CB, scl(F, EYE_FWD));
  shape.eye = { side: 1, r: EYE_R, E, F, U, X: cross(U, F), top: OPEN, bottom: OPEN };
  // the opening and the recess the lids lie in: in front of the rim cone the shell is cut down
  // inside the eyeball (the opening) and under the lids round it; behind the rim the shell stands
  // proud of the lids, so they slide under its edge
  shape.sdf = (x, y, z) => {
    const d = shape.solid(x, y, z);
    const q = [x - E[0], y - E[1], z - E[2]];
    const l = len(q) || 1e-9;
    const along = dot(q, F);
    const th = Math.acos(clamp(along / l, -1, 1));
    const cutR = EYE_R * mix(0.97, GROOVE, sstep(OPEN + 17 * DEG, OPEN + 21 * DEG, th));
    const g = Math.max(cutR - l, (th - RIM) * Math.min(l, 0.5));
    return smax(d, -g, 0.045);
  };
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.5, 0]],
  ['head', 'body', CB],
  ['eye_L', 'head', null], // the eye's centre
  ['eye_R', 'head', null],
  ['arm_L', 'body', null], // the front tendrils' roots
  ['arm_R', 'body', null],
  ['tail_1', 'body', [0, 0.46, -0.24]], // over the back tendrils, on the midline
  ['tail_2', 'tail_1', [0, 0.38, -0.42]],
  ['tail_3', 'tail_2', [0, 0.3, -0.6]],
];
const BI = boneIndex(BONES);

/** Skin weights of a shell point: the ball on head (its underside on body), the tendrils' chains. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  const groups = [['ball', d.ball, 0.03], ...d.t.map((v, i) => [i, v, 0.03])];
  let headW = 0;
  for (const [g, share] of soft(groups)) {
    if (g === 'ball') {
      const hv = sstep(CB[1] - 0.36, CB[1] - 0.17, y);
      headW = share * hv;
      w.put('head', headW);
      w.put('body', share * (1 - hv));
    } else {
      const T = shape.tends[g];
      const s = T.line.param(x, y, z);
      if (g < 2) chain(w, share, s, ['body', g === 0 ? 'arm_L' : 'arm_R'], [0.1], 0.08);
      else chain(w, share, s, ['body', 'tail_1', 'tail_2', 'tail_3'], [0.13, 0.42, 0.72], 0.08);
    }
  }
  return { w: w.done(BI), headW };
}

// ------------------------------------------------------------------------------- the lids

/**
 * The lids: bands of spheres round the eye in polar coordinates about the eye's forward F: the
 * leading edge is the round opening (theta = OPEN + margin), an upper lid on the U half, a lower on
 * the other, meeting at the corners; each has a rounded lip down to just over the eyeball and runs
 * far back under the shell's rim. They turn about the eye's X to close (upper and lower overlap at
 * the corners as they do).
 *
 * Linear morphs add their chords, so two big turns of one shell balloon it outward. So no layer
 * sums big turns: the upper lid (two copies, L and R, see the header) carries every key (its
 * expressions are small); the lower lid's expressions (the happy crescent) are on an outer layer
 * and its blinks on inner copies (L, R) tucked just behind it, which rise out from under it. A
 * petted, happy, shut eye is then the blink layers closed under the raised crescent.
 * Lashes on the upper lid L. Morph normals go into `nd`.
 */
const EXPR = ['happy', 'sad', 'angry', 'surprised', 'mouthOpen'];
const LID_LAYERS = [
  // radius (x the eyeball) in the middle and at the corners; blink and squint set; expressions
  { upper: true, rm: 1.2, rc: 1.19, blink: 'L', squint: ['L'], expr: EXPR, lash: true },
  { upper: true, rm: 1.193, rc: 1.184, blink: 'R', squint: ['R'], expr: EXPR },
  { upper: false, rm: 1.18, rc: 1.178, blink: null, squint: ['L', 'R'], expr: EXPR },
  // the lower blink layers sit inside, clear of the crescent's chord when it is half raised
  { upper: false, rm: 1.11, rc: 1.11, blink: 'L', squint: [], expr: [], shift: 1.5 * DEG },
  { upper: false, rm: 1.104, rc: 1.104, blink: 'R', squint: [], expr: [], shift: 1.5 * DEG },
];
function lidParts(eye, nd) {
  const { E, F, U, X, r } = eye;
  const margin = 3 * DEG;
  const thE = OPEN + margin; // the leading edge
  const ext = 110 * DEG; // back from it, well under the rim even when shut
  const na = 24;
  const nth = 7;
  const rect = { up: -1, lo: -1, lash: -1 };
  const dirAt = (th, al) => add(scl(F, Math.cos(th)), scl(add(scl(X, Math.cos(al)), scl(U, Math.sin(al))), Math.sin(th)));
  const backAt = (th, al) => add(scl(F, -Math.sin(th)), scl(add(scl(X, Math.cos(al)), scl(U, Math.sin(al))), Math.cos(th)));
  /**
   * [key, closing turn (rad), bulge] for a point of `layer` at azimuth `al`. The bulge scales the
   * shut lid out from the eye's centre over the opening, so the straight (linear morph) path of a
   * big turn stays clear of the eyeball half way.
   */
  const turnsAt = (layer, al) => {
    const out = [];
    const sa = Math.abs(Math.sin(al));
    for (const key of layer.expr) {
      const o = MOTIONS[key][layer.upper ? 0 : 1];
      if (o.c || o.e) out.push([key, mix(o.e, o.c, sa) * DEG, key === 'happy' && !layer.upper ? 1.1 : 1]);
    }
    const close = thE + (layer.shift ?? 0);
    if (layer.blink) out.push([`blink_${layer.blink}`, close, layer.upper ? 1.05 : 1.13]);
    const sq = MOTIONS.squint[layer.upper ? 0 : 1];
    for (const side of layer.squint) out.push([`squint_${side}`, sq.close !== undefined ? close * sq.close : mix(sq.e, sq.c, sa) * DEG, 1]);
    return out;
  };
  const rot = (v, upper, a) => rotateAbout(v, X, upper ? a : -a);
  /** Adds a vertex of a lid (or lash) with its shape keys and morph normals. */
  const addV = (buf, p, n, uv, wts, layer, al) => {
    const mo = {};
    const nm = {};
    for (const [key, a, bulge] of turnsAt(layer, al)) {
      let q = rot(sub(p, E), layer.upper, a);
      if (bulge !== 1) {
        const th = Math.acos(clamp(dot(q, F) / (len(q) || 1), -1, 1));
        q = scl(q, mix(1, bulge, sstep(thE - 2 * DEG, thE - 24 * DEG, th)));
      }
      mo[key] = sub(add(E, q), p);
      nm[key] = sub(rot(n, layer.upper, a), n);
    }
    const i = buf.addVertex(p, n, uv, wts, mo);
    for (const [k, v] of Object.entries(nm)) nd.set(k, i, v);
    return i;
  };
  return {
    reserve(atlas) {
      rect.up = atlas.addRect(1.1, 0.42);
      rect.lo = atlas.addRect(1.1, 0.36);
      rect.lash = atlas.addRect(0.04, 0.04);
    },
    build(buf, atlas, wts) {
      for (const layer of LID_LAYERS) {
        const { upper } = layer;
        const Rat = (al) => r * mix(layer.rc, layer.rm, Math.abs(Math.sin(al)) ** 0.6);
        const rIn = r * LIP;
        const lip = 2 * DEG;
        // the profile: [back offset (rad), lip-to-lid blend, v, normal (radial, back)]
        const rows = [
          // (normals turned outward: seen edge-on, a true wall would mirror the sky)
          [lip, 0, 0, [0.62, -0.78]],
          [0.35 * DEG, 0.3, 0.022, [0.76, -0.65]],
          [0.35 * DEG, 0.72, 0.044, [0.88, -0.47]],
          [lip, 1, 0.065, [0.97, -0.24]],
        ];
        for (let j = 1; j <= nth; j++) {
          const t = j / nth;
          rows.push([lip + (ext - lip) * t ** 1.6, 1, 0.065 + 0.935 * t, [1, 0]]);
        }
        const base = buf.count;
        for (const [off, kb, v, [nr, nb]] of rows)
          for (let i = 0; i <= na; i++) {
            const u = i / na;
            const al = (upper ? 0 : Math.PI) + Math.PI * u;
            const th = thE + (layer.shift ?? 0) + off;
            const rad = mix(rIn, Rat(al), kb);
            const dir = dirAt(th, al);
            const n = norm(add(scl(dir, nr), scl(backAt(th, al), nb)));
            addV(buf, add(E, scl(dir, rad)), n, atlas.rectUV(upper ? rect.up : rect.lo, u, v), wts, layer, al);
          }
        buf.grid(base, rows.length - 1, na, (a) => [buf.nor[a * 3], buf.nor[a * 3 + 1], buf.nor[a * 3 + 2]]);
      }
      // lashes on the upper lid L: long, curling back over the shell
      const layer = LID_LAYERS[0];
      const uv = atlas.rectUV(rect.lash, 0.5, 0.5);
      const R = r * layer.rm;
      const seg = 6;
      const sides = 4;
      for (const [ald, L0, flare] of [
        [52, 0.17, -0.6],
        [71, 0.21, -0.3],
        [90, 0.23, 0],
        [109, 0.21, 0.3],
        [128, 0.17, 0.6],
      ]) {
        const al = ald * DEG;
        const dir = dirAt(thE, al);
        const T = norm(backAt(thE, al));
        const side = norm(cross(dir, T)); // along the lid edge
        const root = add(E, scl(dir, mix(r * LIP, R, 0.6)));
        const d0 = norm(add(add(scl(dir, 1), scl(T, -0.15)), scl(side, flare * 0.35)));
        const d1 = norm(add(add(scl(dir, 0.45), scl(T, 1)), scl(side, flare * 0.6)));
        const P1 = add(root, scl(d0, L0 * 0.5));
        const P2 = add(P1, scl(d1, L0 * 0.62));
        const ring = [];
        for (let s = 0; s <= seg; s++) {
          const t = s / seg;
          const c = add(add(scl(root, (1 - t) ** 2), scl(P1, 2 * t * (1 - t))), scl(P2, t * t));
          const tan = norm(add(scl(sub(P1, root), 2 * (1 - t)), scl(sub(P2, P1), 2 * t)));
          const a1 = norm(cross(tan, side));
          const a2 = cross(a1, tan);
          const rad = mix(0.016, 0.0025, t ** 0.9);
          const pts = [];
          for (let k = 0; k < sides; k++) {
            const ang = (k / sides) * Math.PI * 2;
            const off = add(scl(a1, Math.cos(ang)), scl(a2, Math.sin(ang) * 0.6));
            pts.push(addV(buf, add(c, scl(off, rad)), norm(off), uv, wts, layer, al));
          }
          ring.push(pts);
        }
        for (let s = 0; s < seg; s++)
          for (let k = 0; k < sides; k++) {
            const a = ring[s][k];
            const bb = ring[s][(k + 1) % sides];
            const c = ring[s + 1][k];
            const dd = ring[s + 1][(k + 1) % sides];
            const out = [buf.nor[a * 3] + buf.nor[bb * 3], buf.nor[a * 3 + 1] + buf.nor[bb * 3 + 1], buf.nor[a * 3 + 2] + buf.nor[bb * 3 + 2]];
            buf.tri(a, bb, c, out);
            buf.tri(bb, dd, c, out);
          }
      }
    },
    paint(canvas, atlas) {
      for (const upper of [true, false])
        paintRect(canvas, atlas, upper ? rect.up : rect.lo, (u, v, out) => {
          // v = 0 the inner lip: the dark lash line, then the lid (tinted)
          let g = 0.82 + 0.05 * (vnoise(u * 34, v * 14, upper ? 1 : 7) - 0.5) + 0.04 * (fbm(u * 6, v * 4, upper ? 3 : 9) - 0.5);
          g += 0.05 * sstep(0.065, 0.1, v) * sstep(0.18, 0.1, v); // a soft sheen along the rim
          if (upper) g *= 1 - 0.12 * sstep(0.05, 0, Math.abs(v - 0.24)); // the lid's fold
          g *= 1 - 0.1 * sstep(0.55, 1, v); // darker toward the back (under the shell)
          // the margin (v < 0.065, the lip's wall): a darker shade of the skin against the eyeball
          g *= 1 - 0.4 * sstep(0.066, 0.058, v);
          if (!upper) {
            write(out, [g, g, g], 1);
            return;
          }
          // the upper lid's margin: a dark lash line (eyeliner), where the lashes root
          const k = sstep(0.066, 0.059, v);
          write(out, lerp3([g, g, g], COL.lashLine, k), 1 - k);
        });
      paintRect(canvas, atlas, rect.lash, (u, v, out) => write(out, COL.lash, 0));
    },
  };
}

// ---------------------------------------------------------------------------- the eyeball

/**
 * The `Eyes` mesh: one vertex-coloured UV sphere (poles on the iris axis, rings at the colour
 * edges), all on eye_L: a black pupil, an amber iris with radial streaks, a collarette and a dark
 * limbal ring, a white that shades toward the back, and two glints. Its `surprised` key shrinks
 * the pupil.
 */
function eyeball(eye, bone) {
  const { E, r } = eye;
  const Fi = norm(add(scl(eye.F, Math.cos(IRIS_UP)), scl(eye.U, Math.sin(IRIS_UP))));
  const Ui = cross(Fi, eye.X);
  const X = eye.X;
  const pupil = 16.5 * DEG;
  const iris = 39 * DEG;
  const ringDeg = [0, 6, 11, 15.5, 16.5, 17.5, 20, 23, 26, 29, 32, 35, 37, 38.3, 39.7, 41.5, 45, 51, 59, 70, 88, 112, 140, 180];
  const rings = ringDeg.map((d) => d * DEG);
  const na = 40;
  const b = new MeshBuffer(['surprised', 'mouthOpen']);
  const at = (pol, az) => add(scl(Fi, Math.cos(pol)), add(scl(X, Math.sin(pol) * Math.cos(az)), scl(Ui, Math.sin(pol) * Math.sin(az))));
  /** The pupil scaled by k (the iris's rim stays). */
  const scalePupil = (k) => (pol) => {
    if (pol <= pupil + 1 * DEG) return pol * k;
    if (pol <= iris) return mix(pupil * k + 1 * DEG * k, iris, (pol - pupil - 1 * DEG) / (iris - pupil - 1 * DEG));
    return pol;
  };
  const shrink = scalePupil(0.55);
  const widen = scalePupil(1.3);
  const wts = [[bone, 1]];
  const streak = (a) => 0.82 + 0.36 * hash(a, 3, 11) * (0.6 + 0.4 * hash(a, 5, 2));
  for (let ri = 0; ri < rings.length; ri++)
    for (let a = 0; a < na; a++) {
      const pol = rings[ri];
      const az = (a / na) * Math.PI * 2;
      const n = at(pol, az);
      let c;
      if (pol < pupil - 0.5 * DEG) c = srgb(12, 10, 18);
      else if (pol < iris - 1.5 * DEG) {
        const t = (pol - pupil) / (iris - pupil);
        const lit = 0.5 + 0.5 * -Math.sin(az) * Math.sin(pol); // lighter below (light through it)
        let ci = t < 0.35 ? lerp3(srgb(255, 214, 96), srgb(250, 168, 46), t / 0.35) : lerp3(srgb(250, 168, 46), srgb(196, 92, 30), (t - 0.35) / 0.65);
        ci = lerp3(ci, srgb(255, 232, 150), 0.55 * sstep(0.2, 0.12, Math.abs(t - 0.2))); // the collarette
        const s = streak(a) * (1 + 0.08 * (hash(a, ri, 1) - 0.5));
        ci = ci.map((v) => Math.min(1, v * s * (0.86 + 0.24 * lit)));
        if (t < 0.06) ci = lerp3(ci, srgb(120, 54, 20), 0.6); // the pupil's rim
        c = ci;
      } else if (pol < iris + 1.2 * DEG) c = srgb(70, 34, 20); // the limbal ring
      else {
        const k = sstep(45 * DEG, 75 * DEG, pol);
        c = lerp3(srgb(248, 246, 242), srgb(214, 208, 222), k);
        if (pol < iris + 5 * DEG) c = lerp3(srgb(150, 120, 120), c, (pol - iris - 1.2 * DEG) / (3.8 * DEG)); // soft limbal fade
      }
      b.addVertex(add(E, scl(n, r)), n, null, wts, { surprised: scl(sub(at(shrink(pol), az), n), r), mouthOpen: scl(sub(at(widen(pol), az), n), r) }, toLinear(c));
    }
  for (let ri = 0; ri + 1 < rings.length; ri++)
    for (let a = 0; a < na; a++) {
      const i0 = ri * na + a;
      const i1 = ri * na + ((a + 1) % na);
      const j0 = i0 + na;
      const j1 = i1 + na;
      if (ri === 0) b.idx.push(i0, j0, j1);
      else b.idx.push(i0, j0, j1, i0, j1, i1);
    }
  for (const [pol, az, rad] of [
    [21 * DEG, 2.25, 0.058],
    [25 * DEG, 2.25 + Math.PI, 0.024],
  ]) {
    const n0 = at(pol, az);
    const c0 = add(E, scl(n0, r + 0.002));
    const gb = b.count;
    const t1 = norm(cross(n0, Ui));
    const t2 = cross(t1, n0);
    const seg = 12;
    const glow = [1.6, 1.6, 1.6];
    b.addVertex(add(c0, scl(n0, 0.004)), n0, null, wts, {}, glow);
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const p = add(c0, add(scl(t1, Math.cos(a) * rad), scl(t2, Math.sin(a) * rad * 0.8)));
      b.addVertex(add(E, scl(norm(sub(p, E)), r + 0.0018)), n0, null, wts, {}, glow);
    }
    for (let s = 0; s < seg; s++) b.idx.push(gb, gb + 1 + ((s + 1) % seg), gb + 1 + s);
  }
  return b;
}

// ---------------------------------------------------------------------------- the painting

function makeSkinPainter(shape) {
  const { eye, tends } = shape;
  const parts = {};
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    shape.parts(x, y, z, parts);
    const dt = Math.min(...parts.t);
    const grain = vnoise(x * 70, y * 70, z * 70);
    let g = 0.8 + 0.08 * (fbm(x * 6 + 2, y * 6, z * 6) - 0.5) + 0.035 * (grain - 0.5);
    let c;
    let paint = 0;
    let painted = [0, 0, 0];
    if (parts.ball < dt + 0.02) {
      // soft mottling over the shell (low contrast, irregular), fine pale speckles
      const q = norm(sub(p, CB));
      const m = fbm(q[0] * 3.2 + 5, q[1] * 3.2, q[2] * 3.2 + 1);
      const away = sstep(-0.05, -0.35, dot(q, eye.F)); // fading out toward the eye
      g *= 1 - 0.09 * sstep(0.5, 0.68, m) * away;
      g = mix(g, 0.92, sstep(0.86, 0.93, vnoise(q[0] * 34, q[1] * 34, q[2] * 34)) * 0.6 * away);
      g *= 1 - 0.06 * sstep(0.2, 0.9, q[1]) * away; // a touch darker over the top
      // the rim round the lids: a soft contact shadow on its wall and just behind it
      const qe = sub(p, eye.E);
      const th = Math.acos(clamp(dot(qe, eye.F) / (len(qe) || 1), -1, 1));
      g *= 1 - 0.13 * sstep(RIM + 14 * DEG, RIM + 3 * DEG, th) - 0.08 * sstep(RIM - 4 * DEG, RIM - 10 * DEG, th);
    } else {
      // a tendril: lighter underneath and toward the tip, suckers along the underside
      const i = parts.t.indexOf(dt);
      const T = tends[i];
      const s = T.line.param(x, y, z);
      const L = T.line.lens;
      const total = T.line.total;
      g = mix(g, 0.9, sstep(-0.1, -0.6, n[1]) * 0.7);
      g = mix(g, 0.95, sstep(total - 0.16, total - 0.04, s));
      const S = norm(lerp3([0, -1, 0], T.d, sstep(L[4], L[6], s)));
      const rt = T.radiusAt(s);
      const sp = 0.052;
      if (s > 0.3 && s < total - 0.03) {
        const along = s - Math.round(s / sp) * sp;
        const across = Math.acos(clamp(dot(n, S), -1, 1)) * rt;
        const ra = 0.017 * sstep(total + 0.05, 0.4, s) + 0.006;
        const dd = Math.hypot(along, across);
        const k = sstep(ra, ra * 0.72, dd);
        if (k > 0) {
          paint = k;
          painted = lerp3(COL.sucker, COL.suckerIn, sstep(ra * 0.55, ra * 0.3, dd));
        }
      }
    }
    if (n[1] < -0.2 && parts.ball < dt) g = mix(g, 0.88, 0.5 * sstep(-0.2, -0.8, n[1])); // the ball's underside lighter
    c = [g, g, g];
    c = lerp3(c, painted, paint);
    write(o, scl(c, ao), 1 - paint);
  };
}

// ------------------------------------------------------------------------------- the build

/** Per-key normal deltas for a MeshBuffer, filled sparsely, then morphAttributes.normal. */
function normalDeltas(keys) {
  const m = new Map(keys.map((k) => [k, []]));
  return {
    set(k, i, v) {
      const a = m.get(k);
      if (!a) return;
      a[i * 3] = v[0];
      a[i * 3 + 1] = v[1];
      a[i * 3 + 2] = v[2];
    },
    attach(geometry, count) {
      geometry.morphAttributes.normal = keys.map((k) => {
        const src = m.get(k);
        const arr = new Float32Array(count * 3);
        for (let i = 0; i < count * 3; i++) arr[i] = src[i] ?? 0;
        const at = new THREE.Float32BufferAttribute(arr, 3);
        at.name = k;
        return at;
      });
    },
  };
}

/**
 * @param {{texture?: number, triangles?: number, grid?: number}} [o] texture size, target triangles
 *   for the fused shell, surface-nets grid spacing (design units)
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 4500, grid = 0.014 } = {}) {
  const shape = makeShape();
  const { eye } = shape;
  const f = shape.sdf;

  const shell = buildShell(f, {
    lo: [-1.02, -0.04, -1.02],
    hi: [1.02, 1.4, 1.02],
    grid,
    triangles,
    importance: (p) => {
      const q = sub(p, eye.E);
      const l = len(q);
      const th = Math.acos(clamp(dot(q, eye.F) / (l || 1), -1, 1));
      if (th < OPEN - 6 * DEG && l < eye.r * 1.05) return 0.15; // inside the eyeball
      if (th < OPEN + 8 * DEG) return 1; // where the eyeball meets the shell
      if (th < RIM - 9 * DEG && l < eye.r * 1.1) return 0.35; // the groove under the lids
      if (th < RIM + 12 * DEG) return 3.2; // the rim
      if (p[1] < 0.26) return 1.7; // the tendrils' floor runs and curled tips
      return 1;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor);

  const nd = normalDeltas(KEYS);
  const lids = lidParts(eye, nd);
  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  lids.reserve(atlas);
  atlas.layout();

  const body = new MeshBuffer(KEYS);
  const shellTris = appendShell(body, shell, atlas, (i, p) => {
    const { w, headW } = skinOf(shape, p);
    const keys = {};
    // puff: the shell swells behind the rim (in front of it, it would cover the lids and eye)
    const q = sub(p, eye.E);
    const behind = sstep(RIM + 6 * DEG, RIM + 22 * DEG, Math.acos(clamp(dot(q, eye.F) / (len(q) || 1), -1, 1)));
    if (headW * behind > 0.01) keys.puff = scl(shell.nor[i], 0.04 * headW * behind);
    return { weights: w, keys };
  });
  const shellCount = body.count;
  lids.build(body, atlas, [[BI.head, 1]]);

  const canvas = createCanvas(N);
  paintShell(canvas, body, shellTris, makeSkinPainter(shape), {
    pos: (i) => body.P(i),
    nor: (i) => shell.nor[body.src[i]],
    ao: (i) => ao[body.src[i]],
  });
  lids.paint(canvas, atlas);
  dilate(canvas, 6);

  const eyes = eyeball(eye, BI.eye_L);
  const [front0, front1] = shape.tends;
  const bones = BONES.map(([n, parent, p]) => [n, parent, p ?? { eye_L: eye.E, eye_R: eye.E, arm_L: front0.pts[0].slice(0, 3), arm_R: front1.pts[0].slice(0, 3) }[n]]);
  const scene = assemble({ name: 'eye', bones, body, eyes, map: toTexture(canvas, 'eye_basecolor'), fit: fitScale(body, shellCount), roughness: 0.62, eyeRoughness: 0.12 });
  const mesh = scene.getObjectByName('Body');
  nd.attach(mesh.geometry, body.count);
  return scene;
}

export const buildEye = build;

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
  createAtlas,
  createCanvas,
  cross,
  dilate,
  dot,
  ellipsoid,
  eyeballs,
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
  project,
  rotateAbout,
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
  vnoise,
  weights,
  write,
} from './lib/index.js';

/**
 * Dicer's frog pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a squat, wide, smug frog. A flattened rounded body, a broad head with two big
 * bulging eyes sitting on top in smooth rounded turrets (they read from straight above), a wide
 * smiling mouth line round the front, folded hind legs with big webbed feet and little front legs
 * with round toe pads. Grey skin with darker blotches and leg bars (tinted by Dicer), a cream
 * throat and belly, pale toe pads, a pink mouth and a long pink tongue. Natural colour: green
 * #3f9b3a.
 *
 * One fused `Body` shell (a distance field, meshed) with the eyelids, the mouth's inside and the
 * tongue in the same mesh; `Eyes` the eyeballs. Bones: root, body, head, eye_L/R, arm_L/R (front
 * legs), leg_L/R (hind legs). Shape keys: all eleven of the spec; `tongue` flicks a long tongue
 * straight out ahead, `puff` swells the throat a little under the chin.
 */

// ------------------------------------------------------------------------------- the design

const HEAD = tiltFrame([0, 0.34, 0.14], 0.32); // the face tilted up a little toward the camera
const { fdir, wf } = HEAD;

const EYE_R = 0.16;
const MOUTH_Y = -0.1; // the mouth line at the front (face-local y)
const MOUTH_W = 0.35; // half width of the smile (face-local x)

const COL = {
  cream: srgb(244, 238, 210),
  pad: srgb(240, 232, 206),
  ink: srgb(30, 30, 30),
  mouth: srgb(210, 98, 112),
  deep: srgb(120, 40, 54),
  tongue: srgb(238, 124, 140),
  tongueDark: srgb(198, 86, 104),
  lid: srgb(70, 66, 58),
};

/** The mouth line's height at face-local x: a wide smile, its corners turned up (smug). */
const mouthLine = (qx) => MOUTH_Y - 0.008 + 0.07 * Math.min(1.3, Math.abs(qx) / MOUTH_W) ** 2.2;

/** A unit direction at elevation `el` above the horizon, turned out by `yaw` (+x for yaw > 0). */
const dirAt = (el, yaw) => [Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)];

/** Flattens a field toward the ground (y scaled by k < 1): flat feet. */
const flatY = (fn, k) => (x, y, z) => fn(x, y / k, z) * k;

/** A webbed foot (or a front hand): a palm, toes fanned from `P`, round pads at the tips. */
function makeFoot(side, A, P, toes, { palm = [0.042, 0.036], toeR = [0.022, 0.016], padR = 0.026, web = 0.04, flat = 0.6 }) {
  const pal = roundCone(A, P, palm[0], palm[1]);
  const tips = toes.map(([yaw, L]) => add(P, scl(norm([Math.sin(yaw) * side, -0.04, Math.cos(yaw)]), L)));
  const toeF = tips.map((t) => roundCone(P, t, toeR[0], toeR[1]));
  const padF = tips.map((t) => sphere(add(t, [0, 0.004, 0]), padR));
  const toesD = (x, y, z) => {
    let d = Infinity;
    for (const t of toeF) d = smin(d, t(x, y, z), web);
    return d;
  };
  const pads = (x, y, z) => {
    let d = Infinity;
    for (const p of padF) d = Math.min(d, p(x, y, z));
    return d;
  };
  const whole = (x, y, z) => smin(smin(pal(x, y, z), toesD(x, y, z), 0.03), pads(x, y, z), 0.012);
  return {
    tips,
    d: flatY(whole, flat),
    pads: flatY(pads, flat),
  };
}

/** The eye's window: the turret cut flat across its window direction G (cos of the half angle). */
const WINDOW = Math.cos(50 * DEG);

/**
 * Cuts each eye's turret open: a plane across G at WINDOW x the eye radius out from the centre,
 * inside a sphere round it, so the eyeball shows through a round rim and the lids rest just under
 * the rim (the lib's carveSockets hollows a socket round the eye instead).
 */
function cutSockets(d, x, y, z, eyes, k = 0.014) {
  for (const e of eyes) {
    const px = x - e.E[0];
    const py = y - e.E[1];
    const pz = z - e.E[2];
    const sph = Math.sqrt(px * px + py * py + pz * pz) - 1.6 * e.r;
    const pl = WINDOW * e.r - (px * e.G[0] + py * e.G[1] + pz * e.G[2]);
    d = smax(d, -Math.max(sph, pl), k);
  }
  return d;
}

function makeShape() {
  // the head (face-local): broad and flat, a jaw under it (the crease between is the mouth)
  const head = ellipsoid([0, 0, 0], [0.43, 0.2, 0.36]);
  const jaw = ellipsoid([0, -0.1, -0.05], [0.38, 0.14, 0.3]);
  // the eyes: centres, iris direction F, and the window G the skin turret opens toward
  const eyes = [1, -1].map((side) => {
    const E = [0.222 * side, 0.6, 0.11];
    const F = norm(dirAt(34 * DEG, 0.2 * side));
    let U = [0, 1, 0];
    U = norm(sub(U, scl(F, dot(U, F))));
    const X = cross(U, F);
    const G = norm(dirAt(60 * DEG, 0.32 * side));
    return { side, r: EYE_R, E, F, U, X, G };
  });
  const turrets = eyes.map((e) => sphere(sub(e.E, scl(e.G, 0.04 * EYE_R)), 1.21 * EYE_R));
  // the body
  const torso = ellipsoid([0, 0.24, -0.1], [0.41, 0.25, 0.42]);
  const chest = ellipsoid([0, 0.16, 0.12], [0.3, 0.16, 0.25]);
  // hind legs: a big haunch, the shin folded under it, a webbed foot forward along the side
  const haunch = [1, -1].map((s) => ellipsoid([0.33 * s, 0.16, -0.14], [0.15, 0.15, 0.27]));
  const shin = [1, -1].map((s) => roundCone([0.45 * s, 0.075, 0.08], [0.42 * s, 0.05, -0.2], 0.062, 0.046));
  const feet = [1, -1].map((s) =>
    makeFoot(s, [0.43 * s, 0.04, -0.2], [0.52 * s, 0.034, 0.05], [
      [-0.16, 0.16],
      [0.2, 0.2],
      [0.56, 0.19],
      [0.92, 0.15],
    ], { palm: [0.048, 0.042], toeR: [0.027, 0.019], padR: 0.033, web: 0.05 }),
  );
  // front legs: short, straight down and a little forward, three round-tipped fingers
  const arm = [1, -1].map((s) => roundCone([0.22 * s, 0.18, 0.2], [0.25 * s, 0.045, 0.345], 0.068, 0.05));
  const hands = [1, -1].map((s) =>
    makeFoot(s, [0.25 * s, 0.04, 0.335], [0.258 * s, 0.036, 0.38], [
      [-0.45, 0.07],
      [0.05, 0.08],
      [0.55, 0.07],
    ], { palm: [0.044, 0.04], toeR: [0.019, 0.016], padR: 0.025, web: 0.02 }),
  );

  const shape = { eyes, feet, hands };
  /** Distances to the parts at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    const hd = head(qx, qy, qz);
    const jw = jaw(qx, qy, qz);
    let h = smin(hd, jw, 0.03);
    o.turret = Math.min(turrets[0](x, y, z), turrets[1](x, y, z));
    h = smin(h, o.turret, 0.075);
    o.head = h;
    o.jaw = jw;
    o.upper = hd;
    o.torso = smin(torso(x, y, z), chest(x, y, z), 0.08);
    for (let i = 0; i < 2; i++) {
      const L = i === 0 ? 'L' : 'R';
      o[`haunch${L}`] = haunch[i](x, y, z);
      o[`shin${L}`] = shin[i](x, y, z);
      o[`leg${L}`] = smin(o[`haunch${L}`], o[`shin${L}`], 0.04);
      o[`foot${L}`] = feet[i].d(x, y, z);
      o[`arm${L}`] = smin(arm[i](x, y, z), hands[i].d(x, y, z), 0.035);
    }
    return o;
  };
  const P = {};
  const union = () => {
    let d = smin(P.head, P.torso, 0.12);
    d = smin(d, smin(P.legL, P.legR, 0.01), 0.06);
    d = smin(d, smin(P.footL, P.footR, 0.01), 0.035);
    d = smin(d, smin(P.armL, P.armR, 0.01), 0.04);
    return d;
  };
  /** The frog without eye sockets (for placing the eyes and for occlusion). */
  shape.solid = (x, y, z) => {
    shape.parts(x, y, z, P);
    return smax(union(), -y, 0.012);
  };
  shape.sdf = (x, y, z) => {
    shape.parts(x, y, z, P);
    return smax(cutSockets(union(), x, y, z, eyes), -y, 0.012);
  };
  // the opening of each eye through the cut, above and below F (as placeEyes measures it)
  for (const e of eyes) {
    const opening = (dir) => {
      for (let a = 0; a < 89 * DEG; a += 0.25 * DEG) {
        const p = add(e.E, scl(add(scl(e.F, Math.cos(a)), scl(e.U, Math.sin(a) * dir)), e.r));
        if (shape.sdf(p[0], p[1], p[2]) < 0) return a;
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
  ['body', 'root', [0, 0.18, -0.02]],
  ['head', 'body', [0, 0.32, 0.02]],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  // the front legs hang from root, not body: they stay planted when the body leans (the throw's
  // forward lean would push them through the floor)
  ['arm_L', 'root', [0.22, 0.18, 0.2]],
  ['arm_R', 'root', [-0.22, 0.18, 0.2]],
  ['leg_L', 'body', [0.3, 0.2, -0.24]],
  ['leg_R', 'body', [-0.3, 0.2, -0.24]],
];
const BI = boneIndex(BONES);

/** The head's share of a core point: the front and top (face, eyes), fading out near the floor. */
const headShare = (y, z) => sstep(-0.1, 0.1, z + 0.55 * (y - 0.42)) * sstep(0.1, 0.3, y);

/** Skin weights of a shell point: head vs body by a soft plane, legs, arms, the feet planted. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  const rootK = sstep(0.14, 0.03, y); // what touches the floor stays planted when the body leans
  for (const [name, v] of soft([
    ['core', Math.min(d.head, d.torso), 0.03],
    ['armL', d.armL, 0.022],
    ['armR', d.armR, 0.022],
    ['legL', d.legL, 0.03],
    ['legR', d.legR, 0.03],
    ['foot', Math.min(d.footL, d.footR), 0.02],
  ])) {
    if (name === 'core') {
      // the eye turrets wholly on the head, so the lids inside them never poke out when it turns
      const eyeD = Math.min(len(sub(p, shape.eyes[0].E)), len(sub(p, shape.eyes[1].E)));
      const hv = Math.max(headShare(y, z), sstep(EYE_R * 2.1, EYE_R * 1.5, eyeD));
      w.put('head', v * hv);
      w.put('root', v * (1 - hv) * rootK);
      w.put('body', v * (1 - hv) * (1 - rootK));
    } else if (name === 'foot') w.put('root', v);
    else if (name === 'legL' || name === 'legR') {
      w.put('root', v * rootK);
      w.put(name === 'legL' ? 'leg_L' : 'leg_R', v * (1 - rootK));
    } else w.put(name === 'armL' ? 'arm_L' : 'arm_R', v);
  }
  return w.done(BI);
}

/** Face shape keys on the shell: displacement fields in face-local space. */
function faceKeysOf(shape, f, p, n, headW) {
  const gauss2 = (dx, dy, sx, sy) => Math.exp(-((dx / sx) ** 2 + (dy / sy) ** 2) / 2);
  const q = wf(...p);
  const [qx, qy, qz] = q;
  const out = {};
  // the throat swell (puff): small, under the chin, never up over the face
  const throat = gauss2(qx, qy + 0.2, 0.17, 0.08) * sstep(MOUTH_Y - 0.03, MOUTH_Y - 0.09, qy) * sstep(0.0, 0.12, qz);
  if (throat > 0.01) out.puff = scl(n, 0.038 * throat);
  // surprised: the eye turrets follow the eyeballs as they pop
  for (const e of shape.eyes) {
    const k = sstep(EYE_R * 1.75, EYE_R * 1.12, len(sub(p, e.E)));
    if (k > 0) out.surprised = add(out.surprised ?? [0, 0, 0], scl(popDelta(e, p), k * 0.85));
  }
  if (headW < 0.01) return out;
  const fr = sstep(-0.02, 0.12, qz) * headW;
  const ax = Math.abs(qx);
  const lineY = mouthLine(qx);
  const corner = gauss2(ax - MOUTH_W * 0.93, qy - lineY, 0.06, 0.045) * fr;
  const cheek = gauss2(ax - 0.27, qy - 0.0, 0.09, 0.07) * fr;
  // the lower lip and jaw under the mouth line (they drop when it opens)
  const below = sstep(lineY + 0.004, lineY - 0.02, qy);
  const jaw = gauss2(qx, qy - (MOUTH_Y - 0.06), 0.3, 0.09) * below * fr;
  const lip = gauss2(qx, qy - (MOUTH_Y - 0.03), 0.14, 0.03) * below * fr;
  // slid along the surface, so the skin never covers the mouth's inside
  const slide = (dd) => (len(dd) < 1e-6 ? dd : sub(project(f, add(p, dd)), p));
  out.happy = add(slide(fdir(0, 0.045 * corner + 0.018 * cheek, 0)), scl(n, 0.01 * cheek));
  out.sad = slide(fdir(0, -0.03 * corner + 0.008 * lip, 0));
  out.surprised = add(out.surprised ?? [0, 0, 0], slide(fdir(0, -0.04 * jaw, 0)));
  out.mouthOpen = slide(fdir(0, -0.085 * jaw - 0.01 * corner, 0));
  out.angry = add(slide(fdir(0, -0.02 * corner + 0.012 * lip, 0)), scl(n, 0.008 * lip));
  out.tongue = slide(fdir(0, -0.02 * jaw, 0));
  return out;
}

/** An eye popping (surprised): out from its centre and up its window. */
function popDelta(e, p) {
  return add(scl(sub(p, e.E), 0.09), scl(e.G, 0.014));
}

// ---------------------------------------------------------------------------- face parts

const LIDS = {
  blink: [{ close: 1 }, { close: 1 }],
  squint: [{ close: 0.5 }, { close: 0.42 }],
  happy: [4, 18],
  sad: [{ deg: 18, roll: -0.55 }, 0],
  angry: [{ deg: 26, roll: 0.7 }, 10],
  surprised: [-6, -6],
};

/**
 * Eyelid shells round each eyeball (upper and lower), hidden under the turret's rim at rest; shape
 * keys turn them about the eye's X. A copy of the lib's eyelids() whose lids each reach just past
 * their own travel (the lib's single `extra` made the frog's upper lids wrap round to poke out of
 * the back of the turrets).
 */
function frogLids(eyes, o = {}) {
  const { rUp = 1.14, rLo = 1.12, margin = 4 * DEG, meet = 0, spare = 14 * DEG, nphi = 14, nth = 6, phi0 = 12 * DEG, motions = LIDS, rect = [0.36, 0.17], fur = 0.8, lash = COL.lid } = o;
  const lids = [];
  for (const eye of eyes) for (const upper of [true, false]) lids.push({ eye, upper, rect: -1 });
  return {
    reserve(atlas) {
      for (const l of lids) l.rect = atlas.addRect(rect[0], rect[1]);
    },
    build(buf, atlas, wts) {
      for (const lid of lids) {
        const { eye, upper } = lid;
        const R = eye.r * (upper ? rUp : rLo);
        const edge = upper ? eye.top + margin : -(eye.bottom + margin);
        const close = upper ? edge - meet : meet - edge;
        const ext = close + spare;
        const sgn = upper ? -1 : 1;
        const at3 = (th, ph) =>
          add(eye.E, scl(add(scl(eye.X, Math.cos(ph)), scl(add(scl(eye.F, Math.cos(th)), scl(eye.U, Math.sin(th))), Math.sin(ph))), R));
        const turn = (p, dth, roll = 0) => {
          const k = norm(add(scl(eye.X, Math.cos(roll)), scl(eye.F, Math.sin(roll) * eye.side * -sgn)));
          return sub(add(eye.E, rotateAbout(sub(p, eye.E), k, -sgn * dth)), p);
        };
        const L = eye.side > 0 ? 'L' : 'R';
        const base = buf.count;
        for (let j = 0; j <= nth; j++)
          for (let i = 0; i <= nphi; i++) {
            const u = i / nphi;
            const v = j / nth;
            const ph = phi0 + (Math.PI - 2 * phi0) * u;
            const th = edge - sgn * ext * v;
            const p = at3(th, ph);
            const nClosed = norm(sub(at3(th + sgn * close, ph), eye.E));
            const mo = {};
            for (const [key, spec] of Object.entries(motions)) {
              const m = spec[upper ? 0 : 1];
              const name = key === 'blink' || key === 'squint' ? `${key}_${L}` : key;
              if (typeof m === 'number') mo[name] = m ? turn(p, m * DEG) : [0, 0, 0];
              else if (m.close !== undefined) mo[name] = turn(p, close * m.close);
              else mo[name] = turn(p, m.deg * DEG, m.roll ?? 0);
            }
            buf.addVertex(p, nClosed, atlas.rectUV(lid.rect, u, v), wts, mo);
          }
        buf.grid(base, nth, nphi, (a) => sub(buf.P(a), eye.E));
      }
    },
    paint(canvas, atlas) {
      for (const { upper, rect: r } of lids)
        paintRect(canvas, atlas, r, (u, v, out) => {
          // v = 0 the leading edge (a dark rim, untinted), tinted skin beyond
          const fv = fur + 0.04 * (vnoise(u * 30, v * 12, upper ? 1 : 7) - 0.5);
          const k = sstep(0.07, 0.025, v);
          write(out, lerp3([fv, fv, fv], lash, k), 1 - k);
        });
    },
  };
}

/**
 * The frog's mouth inside: a crescent along the smile line, collapsed behind the line at rest;
 * each key opens it on the face surface below the line (offset out a little). shapes: key ->
 * [half width, depth below the line, rise of the top edge above it]. Painted pink, deeper in the
 * middle, a pale pink tongue bump at the bottom.
 */
function frogMouth(face, o = {}) {
  const {
    shapes = { mouthOpen: [0.26, 0.11, 0], surprised: [0.068, 0.07, 0.035], tongue: [0.095, 0.045, 0] },
    nu = 16,
    nv = 4,
    rect = [0.24, 0.08],
    off = 0.009,
  } = o;
  let r = -1;
  return {
    reserve(atlas) {
      r = atlas.addRect(rect[0], rect[1]);
    },
    build(buf, atlas, wts) {
      const base = buf.count;
      const open = [];
      const onFace = (x, y, out) => {
        const pt = face(x, y);
        return add(pt.p, scl(pt.n, out));
      };
      for (let j = 0; j <= nv; j++)
        for (let i = 0; i <= nu; i++) {
          const u = (i / nu) * 2 - 1;
          const v = j / nv; // 0 the top edge .. 1 the bottom
          const xr = u * 0.2;
          const p0 = onFace(xr, mouthLine(xr) - 0.002, -0.007);
          const mo = {};
          for (const [k, [ax, hh, rise]] of Object.entries(shapes)) {
            const x = u * ax;
            const c = Math.sqrt(Math.max(0, 1 - u * u));
            const top = mouthLine(x) - 0.001 + rise * c;
            const bot = mouthLine(x) - hh * c ** 0.8;
            mo[k] = sub(onFace(x, mix(top, bot, v), off), p0);
          }
          buf.addVertex(p0, face(xr, mouthLine(xr)).n, atlas.rectUV(r, (u + 1) / 2, v), wts, mo);
          open.push(add(p0, mo.mouthOpen));
        }
      // wound by the open shape (at rest the rows all collapse onto the line)
      const fwd = fdir(0, 0, 1);
      const w = nu + 1;
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          const a = j * w + i;
          const n = cross(sub(open[a + 1], open[a]), sub(open[a + w], open[a]));
          const [A, B, C, D] = [a, a + 1, a + w, a + w + 1].map((k) => base + k);
          if (dot(n, fwd) >= 0) buf.idx.push(A, B, C, B, D, C);
          else buf.idx.push(A, C, B, B, C, D);
        }
    },
    paint(canvas, atlas) {
      paintRect(canvas, atlas, r, (u, v, out) => {
        const x = u * 2 - 1;
        let c = lerp3(COL.mouth, COL.deep, sstep(0.0, 0.8, (1 - Math.abs(x)) * Math.sin(v * Math.PI) * 1.4));
        c = lerp3(c, COL.tongue, sstep(1, 0.8, Math.hypot(x / 0.45, (v - 1) / 0.45)));
        c = lerp3(c, COL.deep, 0.5 * sstep(0.25, 0.0, v)); // shadow under the upper lip
        write(out, c, 0);
      });
    },
  };
}

/**
 * The frog's long tongue: hidden in the head as a tiny blob at rest; its key stretches it out of
 * the mouth straight ahead, a flat pink ribbon ending in a wider sticky pad.
 */
function frogTongue(face, o = {}) {
  const { y = MOUTH_Y - 0.015, length = 0.64, width = 0.046, thick = 0.02, nu = 12, nv = 20, rect = [0.3, 0.09] } = o;
  let r = -1;
  return {
    reserve(atlas) {
      r = atlas.addRect(rect[0], rect[1]);
    },
    build(buf, atlas, wts) {
      const J = face(0, y);
      const A = norm([0, 0.3, 1]); // a little up: the throw leans the frog forward
      const W = [1, 0, 0];
      const T = norm(cross(A, W));
      const start = add(J.p, scl(A, -0.07));
      const hidden = add(J.p, add(scl(A, -0.15), [0, -0.02, 0]));
      const base = buf.count;
      for (let j = 0; j <= nv; j++) {
        const v = (j / nv) * Math.PI;
        const c = Math.cos(v);
        const s = Math.sin(v);
        const ax = Math.sign(c) * Math.abs(c) ** 0.4; // 1 the tip .. -1 the root
        const sr = Math.abs(s) ** 0.45;
        const a01 = (1 + ax) / 2;
        const wk = 0.78 + 0.5 * sstep(0.62, 0.92, a01);
        for (let i = 0; i <= nu; i++) {
          const u = (i / nu) * Math.PI * 2;
          const local = add(add(scl(A, a01 * length), scl(W, width * wk * sr * Math.cos(u))), scl(T, thick * sr * Math.sin(u)));
          const ext = add(start, local);
          const rest = add(hidden, scl(sub(local, scl(A, length * 0.5)), 0.12));
          const nrm = norm(add(add(scl(A, (Math.sign(c) * Math.abs(c) ** 0.3) / (length * 0.12)), scl(W, (sr * Math.cos(u)) / (width * wk))), scl(T, (sr * Math.sin(u)) / thick)));
          buf.addVertex(rest, nrm, atlas.rectUV(r, j / nv, i / nu), wts, { tongue: sub(ext, rest) });
        }
      }
      buf.grid(base, nv, nu, (a) => sub(buf.P(a), hidden));
    },
    paint(canvas, atlas) {
      paintRect(canvas, atlas, r, (u, v, out) => {
        // u along (0 the tip .. 1 the root), v round: a groove down the top, darker underneath
        const top = Math.sin(v * Math.PI * 2);
        let c = lerp3(COL.tongue, COL.tongueDark, 0.35 * sstep(0, -0.8, top));
        c = lerp3(c, COL.tongueDark, 0.5 * sstep(0.12, 0.0, Math.abs(v - 0.25)) * sstep(0.08, 0.2, u));
        c = lerp3(c, [0.97, 0.66, 0.72], 0.35 * sstep(0.2, 0.05, u) * sstep(0, 0.6, top)); // a glossy pad
        write(out, c, 0);
      });
    },
  };
}

// ---------------------------------------------------------------------------- the painting

/** Dark blotches: a jittered cell pattern; returns the nearest spot's normalised distance (< 1 in). */
function blotch(x, y, z, cell, keep, seed) {
  const gx = x / cell;
  const gy = y / cell;
  const gz = z / cell;
  const i0 = Math.floor(gx);
  const j0 = Math.floor(gy);
  const k0 = Math.floor(gz);
  let best = 9;
  for (let i = i0 - 1; i <= i0 + 1; i++)
    for (let j = j0 - 1; j <= j0 + 1; j++)
      for (let k = k0 - 1; k <= k0 + 1; k++) {
        if (hash(i, j, k + seed) > keep) continue;
        const cx = i + 0.2 + 0.6 * hash(i + 17, j, k + seed);
        const cy = j + 0.2 + 0.6 * hash(i, j + 31, k + seed);
        const cz = k + 0.2 + 0.6 * hash(i, j, k + 53 + seed);
        const rad = 0.24 + 0.16 * hash(i + 7, j + 3, k + 11 + seed);
        best = Math.min(best, Math.hypot(gx - cx, gy - cy, gz - cz) / rad);
      }
  return best;
}

/** The shell's paint at design-space point p: grey spotted skin (tinted) and the painted parts. */
function makeSkinPainter(shape) {
  const parts = {};
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const [qx, qy, qz] = wf(x, y, z);
    shape.parts(x, y, z, parts);
    const dm = Math.min(parts.head, parts.torso, parts.legL, parts.legR, parts.footL, parts.footR, parts.armL, parts.armR);
    const near = (d) => d - dm < 0.012;
    const grain = vnoise(x * 70, y * 70, z * 70);
    // skin: a touch darker on the back, lighter down the flanks
    let skin = 0.8 + 0.07 * (fbm(x * 6 + 3, y * 6, z * 6) - 0.5) + 0.04 * (grain - 0.5);
    skin *= mix(1.04, 0.96, sstep(-0.1, 0.8, n[1]));
    const onFoot = near(parts.footL) || near(parts.footR);
    const onArm = near(parts.armL) || near(parts.armR);
    const onLeg = near(parts.legL) || near(parts.legR);
    const eyeD = Math.min(len(sub(p, shape.eyes[0].E)), len(sub(p, shape.eyes[1].E)));
    // blotches over the back, head and legs (not by the eyes, the mouth or on the toes)
    let s = 0;
    const wob = 0.45 * (fbm(x * 9, y * 9 + 5, z * 9) - 0.5);
    if (!onFoot && n[1] > -0.25 && eyeD > EYE_R * 1.3) {
      const big = blotch(x, y, z, 0.13, 0.62, 0) + wob;
      const small = blotch(x + 0.5, y, z, 0.07, 0.4, 9) + wob * 0.6;
      s = Math.max(sstep(1.0, 0.88, big), 0.85 * sstep(1.0, 0.88, small));
      s *= sstep(-0.25, 0.1, n[1]);
      if (qz > 0.05 && Math.abs(qy - mouthLine(qx)) < 0.07) s *= sstep(0.03, 0.07, Math.abs(qy - mouthLine(qx)));
    }
    if (onLeg && !onFoot) {
      // dark bars across the thighs and shins
      s = Math.max(s, band(z * 8.5 + wob * 0.8 + 0.3, 0.3) * sstep(-0.2, 0.2, n[1]) * sstep(0.06, 0.1, y));
    }
    if (onFoot || onArm) s = Math.max(s, 0.6 * band(Math.hypot(x, z) * 14 + wob, 0.25) * sstep(-0.1, 0.4, n[1]) * (onArm && y > 0.07 ? 1 : 0));
    let col = lerp3([skin, skin, skin], [skin * 0.6, skin * 0.61, skin * 0.6], s);
    if (n[1] < -0.2) col = lerp3(col, [0.9, 0.9, 0.9], 0.3 * sstep(-0.2, -0.7, n[1]));

    // painted (untinted) regions: the cream throat and belly
    let paint = 0;
    const cream = lerp3(COL.cream, scl(COL.cream, 0.92), 1 - (grain * 0.4 + fbm(x * 8, y * 8, z * 8) * 0.6));
    const edge = 0.012 * (fbm(x * 25, y * 25, z * 25) - 0.5);
    if (near(parts.head) || near(parts.torso)) {
      // the throat: under the mouth line, round the front of the jaw
      const lineY = mouthLine(qx);
      const th = sstep(lineY - 0.018, lineY - 0.04, qy + edge) * sstep(1.03, 0.92, Math.hypot(qx / 0.31, (qy - MOUTH_Y + 0.1) / 0.17) + edge * 3) * sstep(-0.02, 0.1, qz);
      // the chest and belly down the front, between the front legs
      const ch = sstep(1.04, 0.92, Math.hypot(x / 0.22, (y - 0.08) / 0.17) + edge * 4) * sstep(0.08, 0.2, z);
      const belly = sstep(-0.75, -0.9, n[1]);
      paint = Math.max(paint, th, ch, belly);
    }
    let c = lerp3(col, cream, paint);
    // pale toe pads
    for (const fset of [shape.feet, shape.hands])
      for (const ft of fset) {
        const k = sstep(0.008, 0.0, ft.pads(x, y, z) - 0.002);
        if (k > 0) {
          c = lerp3(c, COL.pad, k);
          paint = Math.max(paint, k);
        }
      }
    if (qz > 0.02 && (near(parts.head) || near(parts.torso))) {
      // the smile: a dark line round the front, the corners turned up and a little hooked
      const lineY = mouthLine(qx);
      const ax = Math.abs(qx);
      const w = mix(0.0075, 0.0045, sstep(0.0, MOUTH_W, ax));
      let dl = Math.abs(qy - lineY) * Math.min(1, 1 / Math.max(0.35, Math.abs(n[2] * 1.2 + 0.2)));
      if (ax > MOUTH_W * 1.06) dl = Infinity;
      if (ax > MOUTH_W * 0.98) dl = Math.max(dl, (ax - MOUTH_W * 1.03) * 0.6);
      // dark marks stay tinted (no pale fringe round them): a near-black the tint barely moves
      const k = sstep(w + 0.0025, w - 0.001, dl);
      c = lerp3(c, COL.ink, k);
      paint *= 1 - k;
      // nostrils: two little dots up on the snout
      for (const side of [1, -1]) {
        const kn = sstep(0.011, 0.007, Math.hypot(qx - 0.062 * side, (qy - 0.085) * 0.9));
        c = lerp3(c, COL.ink, kn * 0.9);
        paint *= 1 - kn;
      }
    }
    for (const e of shape.eyes) {
      // the rim round each eye: a soft darker crease where the turret is cut open
      const v = sub(p, e.E);
      const k = sstep(0.022, 0.004, Math.abs(dot(v, e.G) - WINDOW * EYE_R)) * sstep(1.45 * EYE_R, 1.15 * EYE_R, len(v));
      if (k > 0) c = scl(c, 1 - 0.2 * k);
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
export function build({ texture: N = 1024, triangles = 6000, grid = 0.0135 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  // the fused shell; the face, eyes, feet and hands kept denser
  const shell = buildShell(f, {
    lo: [-0.72, -0.03, -0.6],
    hi: [0.72, 0.86, 0.66],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      let k = 1;
      if (qz > 0.05 && Math.abs(qy - mouthLine(qx)) < 0.1 && Math.abs(qx) < 0.42) k = 2.6;
      for (const e of shape.eyes) if (len(sub([x, y, z], e.E)) < EYE_R * 1.7) k = Math.max(k, 2.6);
      if (y < 0.07 && (Math.abs(x) > 0.38 || z > 0.34)) k = Math.max(k, 2.2);
      return k;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor);

  // the face parts
  const face = surfaceAt(f, HEAD);
  const headOnly = [[BI.head, 1]];
  const lids = frogLids(shape.eyes, {
    rUp: 1.145,
    rLo: 1.12,
    meet: (eyeL.top - eyeL.bottom) / 2,
    motions: LIDS,
    fur: 0.8,
    lash: COL.lid,
  });
  const mouth = frogMouth(face);
  const tng = frogTongue(face);
  const parts = [lids, mouth, tng];

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
    return { weights: w, keys: faceKeysOf(shape, f, p, shell.nor[i], hw) };
  });
  const shellCount = body.count;
  lids.build(body, atlas, headOnly);
  const lidEnd = body.count;
  mouth.build(body, atlas, headOnly);
  tng.build(body, atlas, headOnly);
  // the lids pop with the eyeballs (surprised)
  const nearestEye = (p) => (len(sub(p, eyeL.E)) < len(sub(p, eyeR.E)) ? eyeL : eyeR);
  const bump = (buf, i) => {
    const p = buf.P(i);
    const d = popDelta(nearestEye(p), p);
    for (let k = 0; k < 3; k++) buf.morph.surprised[i * 3 + k] += d[k];
  };
  for (let i = shellCount; i < lidEnd; i++) bump(body, i);

  // the texture
  const canvas = createCanvas(N);
  paintShell(canvas, body, shellTris, makeSkinPainter(shape), {
    pos: (i) => body.P(i),
    nor: (i) => shell.nor[body.src[i]],
    ao: (i) => ao[body.src[i]],
  });
  for (const part of parts) part.paint(canvas, atlas);
  dilate(canvas, 6);

  // the eyeballs: golden irises, big round pupils; they pop when surprised
  const eyes = eyeballs(shape.eyes, {
    bones: { L: BI.eye_L, R: BI.eye_R },
    pupil: 23 * DEG,
    iris: 41 * DEG,
    irisColor: (t, lit) => [mix(0.98, 0.8, t) + 0.02 * lit, mix(0.8, 0.52, t) + 0.1 * lit, mix(0.3, 0.14, t)],
    rimColor: srgb(92, 58, 24),
    linerColor: srgb(40, 36, 32),
    rings: [0, 7, 14, 21.5, 22.5, 24, 28, 33, 37, 39.5, 40.5, 42, 44, 48, 58, 74, 96, 125, 150, 180],
  });
  for (let i = 0; i < eyes.count; i++) bump(eyes, i);

  const bones = BONES.map(([n, parent, p]) => [n, parent, p ?? { eye_L: eyeL.E, eye_R: eyeR.E }[n]]);
  return assemble({
    name: 'frog',
    bones,
    body,
    eyes,
    map: toTexture(canvas, 'frog_basecolor'),
    fit: fitScale(body, shellCount),
    roughness: 0.55,
  });
}

export const buildFrog = build;

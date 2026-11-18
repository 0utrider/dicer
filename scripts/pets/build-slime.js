import {
  ALL_KEYS,
  DEG,
  MeshBuffer,
  add,
  appendShell,
  assemble,
  boneIndex,
  buildShell,
  chain,
  coneChain,
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
  mouthInside,
  norm,
  paintShell,
  placeEyes,
  polyline,
  project,
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
  trace,
  paintRect,
  vnoise,
  weights,
  write,
} from './lib/index.js';

/**
 * Dicer's slime pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a glossy jelly gumdrop with a soft curl on top that hooks back, a rounded skirt
 * bulging where it meets the floor, two big eyes high on the front of the dome (readable from
 * straight above) and a small smile. The jelly is painted grey (tinted by Dicer) with an inner
 * gradient, a glowing lip at the floor, suspended bubbles and a soft highlight stroke, so it reads
 * as translucent jelly although the material is opaque; low roughness makes it shine.
 * Natural colour: teal #2bb3a3.
 *
 * One fused `Body` shell (a distance field, meshed), eyelids, the mouth's inside and a tongue in
 * the same mesh; `Eyes` the eyeballs. Bones: root, body, head (the upper dome), eye_L/R and
 * tail_1..3 along the curl. Shape keys: all eleven of the spec (puff swells the whole jelly).
 */

// ------------------------------------------------------------------------------- the design

const HEAD = tiltFrame([0, 0.5, 0.0], 0.62); // the face tilted well up: it sits high on the dome
const { fdir, wf } = HEAD;
const EYE_FRAME = tiltFrame([0, 0.5, 0.0], 0.8); // the eyes turned further up, square to the dome

const EYE_R = 0.172;
const R_SOCK = 1.22;
const EYE_X = 0.22;
const EYE_Y = -0.01;
const MOUTH_Y = -0.2; // face-local height of the mouth line (its lowest point)
const SMILE_R = 0.056; // radius of the painted smile arc

// The curl: round cones rising from the crown, hooking back.
const CURL = [
  [0, 0.9, -0.03, 0.125],
  [0, 1.02, -0.035, 0.088],
  [0.025, 1.115, -0.02, 0.064],
  [0.075, 1.17, 0.01, 0.049],
  [0.14, 1.175, 0.03, 0.039],
  [0.185, 1.13, 0.035, 0.033],
];

// Lid motions per key [upper, lower] (lib eyelids): the eyes open wide (52 degrees above the
// centre), so the expressions move the lids further than the cat's.
const LIDS = {
  blink: [{ close: 1 }, { close: 1 }],
  squint: [{ close: 0.62 }, { close: 0.42 }],
  happy: [18, 26],
  sad: [{ deg: 46, roll: -0.5 }, 0],
  angry: [{ deg: 55, roll: 0.6 }, 12],
  surprised: [-6, -6],
};

const COL = {
  ink: srgb(52, 36, 48),
  blush: srgb(255, 150, 160),
  white: [1, 1, 1],
};

/**
 * Eye sockets carved only round the top of each eye (lib carveSockets, cut by a plane a little
 * below the eye's centre): the jelly under the eye stays full, hugging the eyeball like a cheek,
 * and hides the lower lid at rest. Only the upper lid needs the socket's room.
 */
function carveUpperSockets(d, x, y, z, eyes, radius, { back = 0.03, below = 0.35, k = 0.045 } = {}) {
  for (const e of eyes) {
    const p = [x - e.E[0], y - e.E[1], z - e.E[2]];
    const sph = len(p) - radius;
    const pl = -(dot(p, e.F) + back);
    const lo = -(dot(p, e.U) + below * e.r);
    d = smax(d, -Math.max(sph, pl, lo), k);
  }
  return d;
}

function makeShape() {
  const dome = ellipsoid([0, 0.3, 0], [0.69, 0.7, 0.67]);
  const skirt = ellipsoid([0, 0.13, 0], [0.75, 0.17, 0.73]);
  const curl = coneChain(CURL);
  const curlLine = polyline(CURL.map((p) => p.slice(0, 3)));

  const shape = { eyes: [], curlLine };
  /** Distances to the parts (the jelly, the curl) at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    o.jelly = smin(dome(x, y, z), skirt(x, y, z), 0.16);
    o.curlBase = curl[0](x, y, z);
    let c = curl[1](x, y, z);
    for (let i = 2; i < curl.length; i++) c = Math.min(c, curl[i](x, y, z));
    o.curlRest = c;
    o.curl = Math.min(o.curlBase, c);
    return o;
  };
  const P = {};
  const union = (x, y, z) => {
    shape.parts(x, y, z, P);
    let d = smin(P.jelly, P.curlBase, 0.1);
    d = smin(d, P.curlRest, 0.03);
    return d;
  };
  /** The slime without eye sockets (for placing the eyes and for occlusion). */
  shape.solid = (x, y, z) => smax(union(x, y, z), -y, 0.02);
  shape.eyes = placeEyes(shape.solid, EYE_FRAME, { r: EYE_R, x: EYE_X, y: -0.035, yaw: 0.16, open: 52 * DEG });
  shape.sdf = (x, y, z) => smax(carveUpperSockets(union(x, y, z), x, y, z, shape.eyes, EYE_R * R_SOCK), -y, 0.02);
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.3, 0]],
  ['head', 'body', [0, 0.46, 0.02]],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['tail_1', 'head', CURL[1].slice(0, 3)],
  ['tail_2', 'tail_1', CURL[2].slice(0, 3)],
  ['tail_3', 'tail_2', CURL[3].slice(0, 3)],
];
const BI = boneIndex(BONES);

/** Skin weights of a shell point: the floor on root, the jelly body, the upper dome on head, the curl chain. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  for (const [name, v] of soft([
    ['jelly', d.jelly, 0.03],
    ['curl', d.curl, 0.03],
  ])) {
    if (name === 'jelly') {
      const hv = sstep(0.3, 0.56, y + 0.08 * z); // the upper dome, the face wholly on it
      w.put('head', v * hv);
      const rootK = sstep(0.16, 0.03, y); // the lip stays planted when the body leans
      w.put('root', v * (1 - hv) * rootK);
      w.put('body', v * (1 - hv) * (1 - rootK));
    } else {
      const L = shape.curlLine.lens;
      chain(w, v, shape.curlLine.param(x, y, z), ['head', 'tail_1', 'tail_2', 'tail_3'], [L[1], L[2], L[3]], 0.035);
    }
  }
  return w.done(BI);
}

/** Face shape keys on the shell: displacement fields in face-local space; puff swells the jelly. */
function faceKeysOf(f, shape, p, n) {
  const gauss = (q, c, s) => Math.exp(-((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - (c[2] ?? q[2])) ** 2) / (2 * s * s));
  const mirror = (q, c, s) => gauss(q, c, s) + gauss(q, [-c[0], c[1], c[2]], s);
  const q = wf(...p);
  const out = {};
  // puff: the whole jelly swells (less at the floor and round the eyes, which do not move)
  let nearEye = 0;
  for (const e of shape.eyes) nearEye = Math.max(nearEye, sstep(EYE_R * 2.1, EYE_R * 1.2, len(sub(p, e.E))));
  out.puff = scl(n, 0.05 * sstep(0.01, 0.16, p[1]) * (1 - 0.75 * nearEye));
  const fr = sstep(0.1, 0.25, q[2]);
  if (fr < 0.001) return out;
  const cy = MOUTH_Y + SMILE_R * 0.5; // the smile's corners
  const corner = mirror(q, [SMILE_R * 0.87, cy], 0.022) * fr;
  const cheek = mirror(q, [0.15, MOUTH_Y + 0.02], 0.06) * fr;
  const browIn = mirror(q, [0.12, EYE_Y + 0.19], 0.05) * fr;
  const brow = mirror(q, [EYE_X, EYE_Y + 0.2], 0.08) * fr;
  const chin = gauss(q, [0, MOUTH_Y - 0.06], 0.05) * fr;
  const lip = gauss(q, [0, MOUTH_Y - 0.01], 0.03) * fr;
  // slid along the surface, so the skin never covers the mouth's inside
  const slide = (d) => (len(d) < 1e-6 ? d : sub(project(f, add(p, d)), p));
  out.happy = add(slide(fdir(0, 0.022 * corner + 0.018 * cheek, 0)), scl(n, 0.012 * cheek));
  out.sad = slide(fdir(0, -0.036 * corner + 0.012 * browIn, 0));
  out.surprised = slide(fdir(-Math.sign(q[0]) * 0.016 * corner, 0.026 * brow - 0.01 * chin, 0));
  out.mouthOpen = slide(fdir(0, -0.03 * chin, 0));
  out.angry = add(slide(fdir(0, -0.024 * browIn - 0.014 * corner, 0)), scl(n, 0.014 * lip - 0.01 * browIn));
  out.tongue = slide(fdir(0, -0.01 * chin, 0));
  out.puff = add(out.puff, scl(n, 0.012 * mirror(q, [0.15, MOUTH_Y + 0.02, 0.3], 0.07)));
  return out;
}

// ---------------------------------------------------------------------------- the painting

/** Bubbles suspended in the jelly: [longitude (0 = front, + toward the pet's left), height, radius]. */
const BUBBLES = [
  [1.25, 0.62, 0.042],
  [1.55, 0.48, 0.022],
  [1.05, 0.3, 0.03],
  [2.2, 0.75, 0.034],
  [2.6, 0.4, 0.045],
  [-2.9, 0.68, 0.026],
  [-2.35, 0.3, 0.036],
  [-1.7, 0.66, 0.03],
  [-1.3, 0.4, 0.044],
  [-1.15, 0.22, 0.02],
  [0.45, 0.17, 0.024],
  [-0.5, 0.15, 0.03],
  [2.0, 0.92, 0.026],
  [-2.1, 0.9, 0.022],
  [0.15, 0.97, 0.02],
  [1.9, 0.5, 0.06],
  [-2.0, 0.56, 0.055],
  [3.05, 0.55, 0.05],
  [0.95, 0.78, 0.034],
  [-0.95, 0.3, 0.05],
];

/** The shell's paint at design-space point p: grey jelly (tinted) with its painted details. */
function makeSkinPainter(shape, f) {
  const [eyeL, eyeR] = shape.eyes;
  const parts = {};
  // bubble centres on the surface (traced in from outside toward the axis)
  const bubbles = BUBBLES.map(([lon, y, r]) => {
    const dir = [Math.sin(lon), 0, Math.cos(lon)];
    const hit = trace(f, [dir[0] * 1.2, y, dir[2] * 1.2], scl(dir, -1));
    return { c: hit.p, n: hit.n, r: r * 1.35 };
  });
  const L = norm([-0.55, 0.75, 0.38]); // the key light (up, to the viewer's left)
  const V = norm([0, 0.75, 0.66]); // the usual view: from above and in front
  return (p, n, ao, o) => {
    const [x, y, z] = p;
    const [qx, qy, qz] = wf(x, y, z);
    shape.parts(x, y, z, parts);
    const onCurl = parts.curl < parts.jelly - 0.01;
    const grain = vnoise(x * 40, y * 40, z * 40);
    const cloud = fbm(x * 4 + 7, y * 4, z * 4);
    // the inner gradient: deeper (darker) low down and toward the core, lighter dome
    let g = mix(0.6, 0.93, sstep(0.0, 0.95, y) ** 0.7);
    g += 0.06 * (cloud - 0.5) + 0.012 * (grain - 0.5);
    // light through the jelly: faces turned to the usual (high) view glow, the turned-away edges deepen
    g *= mix(0.86, 1.05, sstep(0.0, 0.85, dot(n, V)));
    // faint swirls deep inside
    const sw = fbm(x * 2.6 + 1.7, y * 2.6 + 3.1, z * 2.6);
    g += 0.05 * sstep(0.035, 0.0, Math.abs(sw - 0.5)) * sstep(0.1, 0.4, y);
    // the lip: light gathered at the floor edge, a darker band just above it
    const r = Math.hypot(x, z);
    g += 0.2 * Math.exp(-(((y - 0.07) / 0.05) ** 2)) * sstep(0.45, 0.65, r);
    g -= 0.06 * Math.exp(-(((y - 0.22) / 0.06) ** 2));
    // facing down: darker; the crown a touch lighter
    if (n[1] < 0) g *= 1 - 0.25 * sstep(0, -0.8, n[1]);
    if (onCurl) {
      const s = shape.curlLine.param(x, y, z);
      g = mix(0.84, 0.92, sstep(0.05, shape.curlLine.total, s)) + 0.02 * (grain - 0.5);
    }
    let c = [g, g, g];
    let paint = 0; // 1 = untinted (stays as painted)

    // suspended bubbles: a pale fill, a darker rim, a little white glint
    for (const b of bubbles) {
      const d = len(sub(p, b.c));
      if (d > b.r * 1.3) continue;
      const t = d / b.r;
      const fill = sstep(1.0, 0.85, t);
      const side = dot(norm(sub(p, b.c)), L); // > 0 toward the light
      c = lerp3(c, scl(c, 1.12), fill * 0.8);
      // refracted light pooling on the far side, a faint shadow on the near side
      const ring = sstep(0.6, 0.88, t) * sstep(1.05, 0.9, t);
      c = lerp3(c, scl(c, 1.28), ring * sstep(0.1, -0.6, side));
      c = lerp3(c, scl(c, 0.86), ring * sstep(0.0, 0.6, side) * 0.7);
      // glint up and to the light
      const off = sub(p, add(b.c, scl(L, b.r * 0.4)));
      const gk = sstep(b.r * 0.32, b.r * 0.18, len(off));
      c = lerp3(c, COL.white, gk);
      paint = Math.max(paint, gk);
    }

    // the highlight: a soft stroke round the upper dome toward the light, and a smaller dot
    if (!onCurl && y > 0.4) {
      const lon = Math.atan2(x, z);
      const lat = Math.atan2(y - 0.36, r);
      const stroke = Math.hypot((lon + 1.0) / 0.5, (lat - 0.95) / 0.09);
      const dot2 = Math.hypot((lon + 1.62) / 0.11, (lat - 0.62) / 0.08);
      const k = Math.max(sstep(1, 0.35, stroke) * 0.85, sstep(1, 0.5, dot2) * 0.75);
      // a broad sheen under it
      const sheen = sstep(0.6, 0.95, dot(n, L)) * 0.35;
      c = lerp3(c, COL.white, Math.max(k, sheen * 0.5));
      paint = Math.max(paint, k * 0.9);
    }
    if (onCurl) {
      // a highlight along the curl
      const k = sstep(0.55, 0.85, dot(n, L)) * 0.6;
      c = lerp3(c, COL.white, k);
      paint = Math.max(paint, k * 0.8);
    }

    // the face
    if (qz > 0.15 && !onCurl) {
      // blush under each eye
      for (const s of [1, -1]) {
        const bd = Math.hypot((qx - 0.24 * s) / 0.07, (qy - MOUTH_Y - 0.035) / 0.04);
        const k = sstep(1, 0.2, bd) * 0.55;
        c = lerp3(c, COL.blush, k);
        paint = Math.max(paint, k * 0.8);
      }
      // the smile: an arc, its lowest point on the mouth line
      const cy = MOUTH_Y + SMILE_R;
      let dm = Infinity;
      if (qy < cy - SMILE_R * 0.5) dm = Math.abs(Math.hypot(qx, qy - cy) - SMILE_R);
      const k = sstep(0.0095, 0.0055, dm);
      c = lerp3(c, COL.ink, k);
      paint = Math.max(paint, k);
    }
    for (const e of [eyeL, eyeR]) {
      // the socket wall: a gentle crease (the eyeliner is on the eyeball's edge)
      const k = sstep(EYE_R * R_SOCK + 0.004, EYE_R * R_SOCK - 0.003, len(sub(p, e.E)));
      if (k > 0) c = scl(c, 1 - 0.1 * k);
    }
    write(o, scl(c, mix(1, ao, 0.7)), 1 - paint);
  };
}

/**
 * The eyelids repainted as jelly: tinted grey, a lash line on the upper lid's edge only (a closed
 * eye reads as a dark curve), the lower lid's edge just a little deeper.
 */
function jellyLids(part) {
  part.paint = (canvas, atlas) => {
    for (const { upper, rect } of part.lids)
      paintRect(canvas, atlas, rect, (u, v, out) => {
        const g = 0.84 + 0.04 * (vnoise(u * 20, v * 8, upper ? 1 : 7) - 0.5);
        if (upper) {
          const k = sstep(0.09, 0.04, v) * sstep(0, 0.12, Math.min(u, 1 - u) + 0.04);
          write(out, lerp3([g, g, g], COL.ink, k), 1 - k);
        } else {
          const k = sstep(0.08, 0.0, v) * 0.18;
          write(out, [g * (1 - k), g * (1 - k), g * (1 - k)], 1);
        }
      });
  };
  return part;
}

// ------------------------------------------------------------------------------- the build

/**
 * @param {{texture?: number, triangles?: number, grid?: number}} [o] texture size, target triangles
 *   for the fused shell, surface-nets grid spacing (design units)
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 5800, grid = 0.015 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;
  const [eyeL, eyeR] = shape.eyes;

  // the fused shell; the face and the curl kept denser
  const shell = buildShell(f, {
    lo: [-0.8, -0.04, -0.8],
    hi: [0.8, 1.22, 0.8],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      let k = Math.hypot(qx / 0.42, (qy + 0.08) / 0.3) < 1 && qz > 0.15 ? 3 : 1;
      if (y > 0.95) k = Math.max(k, 2);
      for (const e of shape.eyes) {
        const de = len(sub([x, y, z], e.E)) / (EYE_R * R_SOCK);
        if (de < 1.4 && de > 0.8) k = Math.max(k, 8);
      }
      return k;
    },
  });
  const ao = fieldAO(shape.solid, shell.pos, shell.nor, { min: 0.8 });

  // the face parts
  const face = surfaceAt(f, HEAD);
  const headOnly = [[BI.head, 1]];
  const parts = [
    jellyLids(eyelids(shape.eyes, { rUp: 1.15, rLo: 1.1, motions: LIDS })),
    mouthInside(face, HEAD, {
      y: MOUTH_Y,
      fangs: false,
      shapes: {
        mouthOpen: [0.014, 0.07, 0.06, 0.35, 0.009],
        surprised: [0.008, 0.04, 0.036, 1, 0.009],
        tongue: [-0.006, 0.03, 0.024, 0.6, 0.008],
      },
    }),
    tongue(face, HEAD, { y: MOUTH_Y, length: 0.04, width: 0.028, below: 0.045 }),
  ];

  // UVs
  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  for (const part of parts) part.reserve(atlas);
  atlas.layout();

  // the Body
  const body = new MeshBuffer(ALL_KEYS);
  const shellTris = appendShell(body, shell, atlas, (i, p) => ({ weights: skinOf(shape, p), keys: faceKeysOf(f, shape, p, shell.nor[i]) }));
  const shellCount = body.count;
  for (const part of parts) part.build(body, atlas, headOnly);

  // the texture
  const canvas = createCanvas(N);
  paintShell(canvas, body, shellTris, makeSkinPainter(shape, shape.solid), {
    pos: (i) => body.P(i),
    nor: (i) => shell.nor[body.src[i]],
    ao: (i) => ao[body.src[i]],
  });
  for (const part of parts) part.paint(canvas, atlas);
  dilate(canvas, 6);

  // the eyeballs: big glossy dark eyes with large glints
  const eyes = eyeballs(shape.eyes, {
    bones: { L: BI.eye_L, R: BI.eye_R },
    pupil: 26 * DEG,
    iris: 50 * DEG,
    irisColor: (t, lit) => [mix(0.1, 0.16, t) + 0.12 * lit * t, mix(0.12, 0.3, t) + 0.16 * lit * t, mix(0.16, 0.34, t) + 0.14 * lit * t],
    pupilColor: srgb(12, 14, 20),
    rimColor: srgb(20, 26, 34),
    rings: [0, 8, 16, 24.5, 25.5, 27, 32, 38, 44, 48.5, 49.5, 51, 53, 58, 66, 80, 100, 125, 150, 180],
    glints: [
      [26 * DEG, 0.6, 0.042],
      [30 * DEG, 0.6 + Math.PI, 0.018],
    ],
  });
  const bones = BONES.map(([n, parent, p]) => [n, parent, p ?? { eye_L: eyeL.E, eye_R: eyeR.E }[n]]);
  return assemble({
    name: 'slime',
    bones,
    body,
    eyes,
    map: toTexture(canvas, 'slime_basecolor'),
    fit: fitScale(body, shellCount),
    roughness: 0.16,
    eyeRoughness: 0.08,
  });
}

export const buildSlime = build;

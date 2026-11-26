import * as THREE from 'three';
import {
  MeshBuffer,
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
  fbm,
  fieldAO,
  fitScale,
  lerp3,
  mix,
  norm,
  paintRect,
  paintShell,
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
  toLinear,
  toTexture,
  torus,
  weights,
  write,
} from './lib/index.js';

/**
 * Dicer's drone pet (docs/reference/pet-model-spec.md), built with the pet library (lib/, see
 * README.md): a small friendly companion drone hovering over the floor, the science-fiction pet.
 * A smooth rounded white pod tipped back so its face looks up at Dicer's top-down camera: a dark
 * glass visor in a coloured bezel with two glowing digital eyes (tall rounded pills of light with
 * scan lines) and a little light-line mouth. A coloured stripe runs over its crown and down its
 * back, a coloured belt round its underside, three status lights by the visor and vent slots on the
 * other side. Two small engine pods on stub axles at its sides, two stubby manipulator arms with
 * two-prong grippers under its chin, a thin antenna with an amber tip light leaning back off its
 * crown, and under it a thruster collar with a glowing anti-gravity ring and a jet of light down to
 * the floor (the only part that touches it: the drone floats).
 *
 * The coloured panels are tinted by Dicer (neutral grey, seams darker); the white shell, the
 * visor, the dark metal, the lights and the jet keep their colours. The eyes, the mouth, the
 * lights, the ring and the jet glow through one emissive map shared by Body and Eyes.
 * Natural colour: teal #2fa8c9.
 *
 * The face is a screen, so its parts are flat patches laid on the visor, not eyeballs in sockets:
 * `Eyes` is the two pills of light (each wholly on its eye bone, whose pivot sits behind the
 * visor, so a glance slides the pill across the glass); its own `happy` key bends each pill into
 * an arch and `surprised` grows it. In `Body`, dark shutters (collapsed out of sight above and
 * below each pill, on the eye bones too) slide over the pills: blink_L/R close them to a line of
 * light, squint_L/R half way, `sad` and `angry` cut the tops off on a slant. The mouth is a patch
 * of light that every expression key reshapes. Flat patches mix linearly, so the keys add up.
 *
 * Bones: root, body, head (the whole craft, pivot at the pod's centre: it turns and nods in the
 * air), eye_L/R, arm_L/R, ear_L/R (the engine pods, tilting about their axles) and tail_1 (the
 * antenna). The jet runs from head down to root, so its tip stays on the floor.
 */

// ------------------------------------------------------------------------------- the design

const TILT = 0.7; // the pod tipped back, its face up toward the top-down camera
const POD = tiltFrame([0, 0.78, 0], TILT);
const { fw, wf } = POD;
const RAD = [0.5, 0.4, 0.44]; // the pod's radii (pod-local)
const VISOR = { y: 0.025, hx: 0.36, hy: 0.225, r: 0.17 }; // the glass, on the pod's front
const BEZEL = 0.036; // the coloured band round the visor
const EYE_X = 0.165;
const EYE_Y = 0.075;
const PILL = [0.056, 0.094, 0.05]; // a pill of light: half width, half height, corner radius
const PATCH = [0.092, 0.122]; // the eye patch's half sizes (the pill and its halo)
const SHUT = [0.095, 0.126]; // a shutter's half width, and its rest edge above / below the eye's centre
const EYE_DEPTH = 0.2; // the eye bones' pivots this far behind the glass
const LIFT = { eye: 0.007, mouth: 0.008, shutter: 0.014 }; // the patches' heights over the glass
const MOUTH_Y = -0.115;
const KEYS = ['blink_L', 'blink_R', 'happy', 'sad', 'surprised', 'mouthOpen', 'angry', 'squint_L', 'squint_R'];

const THRUST = [0, -0.02]; // the thruster's axis (x, z): straight down under the pod
const ARM_S = [0.35, 0.53, 0.2]; // the left shoulder
const EAR = [0.63, 0.76, -0.04]; // the left engine pod's centre (and its axle)
const ANT_DIR = norm([0, 1, -0.42]);
const ANT_0 = fw(0, 0.3, -0.12); // the antenna's root, inside the crown
const ANT_TIP = add(ANT_0, scl(ANT_DIR, (1.33 - ANT_0[1]) / ANT_DIR[1]));
const ANT_PIVOT = add(ANT_0, scl(ANT_DIR, 0.1));
// the status lights (pod-local x, y on the front): an arc round the visor's corner on the pet's right
const LIGHTS = [
  [-0.402, 0.2, srgb(70, 240, 120)],
  [-0.347, 0.266, srgb(255, 160, 40)],
  [-0.274, 0.308, srgb(70, 200, 255)],
];

const COL = {
  white: srgb(236, 238, 241),
  seam: srgb(112, 120, 132),
  glass: srgb(15, 20, 32),
  glassHi: srgb(34, 46, 68),
  metal: srgb(60, 66, 78),
  metalLight: srgb(150, 157, 168),
  glow: srgb(84, 214, 255),
  hot: srgb(206, 246, 255),
  amber: srgb(255, 176, 64),
};

/** A rounded rectangle's distance in 2D: half sizes (hx, hy), corner radius r. */
function rrect(x, y, hx, hy, r) {
  const ax = Math.abs(x) - hx + r;
  const ay = Math.abs(y) - hy + r;
  return Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0) - r;
}
/** The visor's outline at pod-local (qx, qy): < 0 on the glass. */
const visorD = (qx, qy) => rrect(qx, qy - VISOR.y, VISOR.hx, VISOR.hy, VISOR.r);

/** A rounded upright cylinder: centre c, radius r, half height h. */
function cylY(c, r, h, round) {
  return (x, y, z) => {
    const dr = Math.hypot(x - c[0], z - c[2]) - r + round;
    const dy = Math.abs(y - c[1]) - h + round;
    return Math.hypot(Math.max(dr, 0), Math.max(dy, 0)) + Math.min(Math.max(dr, dy), 0) - round;
  };
}

/** An arm's frame: its shoulder S, down-the-arm a and across p (the gripper opens along p). */
function armFrame(side) {
  const S = [ARM_S[0] * side, ARM_S[1], ARM_S[2]];
  const a = norm([0.55 * side, -1, 0.55]);
  const p = norm(sub([side, 0, 0], scl(a, a[0] * side))); // sideways, square to the arm
  return { S, a, p, at: (t, u = 0) => add(add(S, scl(a, t)), scl(p, u)) };
}

function makeShape() {
  const pod = ellipsoid([0, 0, 0], RAD);
  // the thruster: a collar under the pod, a ring round its mouth, a bowl inside, the jet to the floor
  const collar = cylY([THRUST[0], 0.345, THRUST[1]], 0.185, 0.09, 0.02);
  const ring = torus([THRUST[0], 0.265, THRUST[1]], 0.205, 0.042);
  const bowl = cylY([THRUST[0], 0.22, THRUST[1]], 0.135, 0.055, 0.015);
  const jet = roundCone([THRUST[0], 0.27, THRUST[1]], [THRUST[0], 0.004, THRUST[1]], 0.092, 0.016);
  // the engine pods on stub axles
  const ears = [1, -1].map((s) => {
    const x = EAR[0] * s;
    const pod1 = roundCone([x, EAR[1] + 0.085, EAR[2]], [x, EAR[1] - 0.09, EAR[2]], 0.084, 0.07);
    const axle = roundCone([0.42 * s, EAR[1], EAR[2]], [0.58 * s, EAR[1], EAR[2]], 0.045, 0.04);
    return { pod: (px, py, pz) => smax(pod1(px, py, pz), EAR[1] - 0.125 - py, 0.012), axle };
  });
  // the arms: a shoulder ball, a stubby arm, a cuff and a two-prong gripper
  const arms = [1, -1].map((side) => {
    const A = armFrame(side);
    const sh = sphere(A.S, 0.072);
    const arm = roundCone(A.at(0.03), A.at(0.2), 0.046, 0.04);
    const cuff = roundCone(A.at(0.175), A.at(0.215), 0.052, 0.05);
    const prongs = [1, -1].map((u) => {
      const a = roundCone(A.at(0.22, 0.03 * u), A.at(0.3, 0.05 * u), 0.021, 0.017);
      const b = roundCone(A.at(0.3, 0.05 * u), A.at(0.34, 0.024 * u), 0.017, 0.013);
      return (x, y, z) => smin(a(x, y, z), b(x, y, z), 0.01);
    });
    return { A, sh, arm, cuff, prongs };
  });
  // the antenna: a thin stalk leaning back off the crown, a tip light
  const stalk = roundCone(ANT_0, ANT_TIP, 0.025, 0.019);
  const foot = sphere(ANT_PIVOT, 0.042);
  const bulb = sphere(ANT_TIP, 0.04);

  const shape = { arms };
  /** Distances to the parts at (x, y, z). */
  shape.parts = (x, y, z, o = {}) => {
    const [qx, qy, qz] = wf(x, y, z);
    const d = pod(qx, qy, qz);
    o.pod = smin(d, Math.min(ears[0].axle(x, y, z), ears[1].axle(x, y, z)), 0.02);
    let nz = smin(collar(x, y, z), ring(x, y, z), 0.02);
    nz = smax(nz, -bowl(x, y, z), 0.015);
    o.nozzle = nz;
    o.jet = jet(x, y, z);
    o.earL = ears[0].pod(x, y, z);
    o.earR = ears[1].pod(x, y, z);
    for (const [i, k] of [
      [0, 'armL'],
      [1, 'armR'],
    ]) {
      const a = arms[i];
      const sh = a.sh(x, y, z);
      let v = smin(sh, a.arm(x, y, z), 0.015);
      v = smin(v, a.cuff(x, y, z), 0.008);
      v = smin(v, Math.min(a.prongs[0](x, y, z), a.prongs[1](x, y, z)), 0.012);
      o[k] = v;
      o[`${k}Sh`] = sh;
    }
    o.bulb = bulb(x, y, z);
    o.ant = smin(smin(stalk(x, y, z), foot(x, y, z), 0.02), o.bulb, 0.015);
    return o;
  };
  const P = {};
  /** The whole drone (the fused shell's field). */
  shape.sdf = (x, y, z) => {
    shape.parts(x, y, z, P);
    let d = smin(P.pod, P.nozzle, 0.03);
    d = smin(d, P.jet, 0.012);
    d = smin(d, Math.min(P.earL, P.earR), 0.012);
    d = smin(d, Math.min(P.armL, P.armR), 0.015);
    d = smin(d, P.ant, 0.015);
    return smax(d, -y, 0.015);
  };
  return shape;
}

// ------------------------------------------------------------------------------- the rig

const BONES = [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.5, 0]],
  ['head', 'body', POD.center],
  ['eye_L', 'head', null], // filled from the eyes
  ['eye_R', 'head', null],
  ['arm_L', 'head', ARM_S],
  ['arm_R', 'head', [-ARM_S[0], ARM_S[1], ARM_S[2]]],
  ['ear_L', 'head', EAR],
  ['ear_R', 'head', [-EAR[0], EAR[1], EAR[2]]],
  ['tail_1', 'head', ANT_PIVOT],
];
const BI = boneIndex(BONES);

/** Skin weights of a shell point: hard parts, each on its bone; the jet from head down to root. */
function skinOf(shape, p) {
  const [x, y, z] = p;
  const d = shape.parts(x, y, z);
  const w = weights();
  for (const [name, v] of soft([
    ['head', Math.min(d.pod, d.nozzle), 0.012],
    ['jet', d.jet, 0.012],
    ['arm_L', d.armL, 0.012],
    ['arm_R', d.armR, 0.012],
    ['ear_L', d.earL, 0.01],
    ['ear_R', d.earR, 0.01],
    ['tail_1', d.ant, 0.012],
  ])) {
    if (name === 'jet') {
      const rootK = sstep(0.24, 0.05, y);
      w.put('root', v * rootK);
      w.put('head', v * (1 - rootK));
    } else w.put(name, v);
  }
  return w.done(BI);
}

// ------------------------------------------------------------------------------- the face

/** A point `lift` over the glass at pod-local (qx, qy), and the glass's normal there. */
function onGlass(face, qx, qy, lift) {
  const s = face(qx, qy);
  return { p: add(s.p, scl(s.n, lift)), n: s.n };
}

/**
 * Per-key normal deltas of a MeshBuffer's patches (a patch that slides over the curved glass takes
 * the glass's normal where it is, so it shades as the glass under it): set(key, vertex, delta),
 * then attach(geometry) makes them its morphAttributes.normal.
 */
function normalDeltas(keys) {
  const m = new Map(keys.map((k) => [k, []]));
  return {
    set(k, i, v) {
      const a = m.get(k);
      a[i * 3] = v[0];
      a[i * 3 + 1] = v[1];
      a[i * 3 + 2] = v[2];
    },
    attach(geometry) {
      const n = geometry.attributes.position.count * 3;
      geometry.morphAttributes.normal = keys.map((k) => {
        const src = m.get(k);
        const arr = new Float32Array(n);
        for (let i = 0; i < n; i++) arr[i] = src[i] ?? 0;
        const at = new THREE.Float32BufferAttribute(arr, 3);
        at.name = k;
        return at;
      });
    },
  };
}

/** Adds a (rows + 1) x (cols + 1) grid's triangles facing `out(a)`, judged at the positions `pos(a)`. */
function gridFacing(buf, base, rows, cols, pos, out) {
  const w = cols + 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = base + j * w + i;
      const b = a + 1;
      const c = a + w;
      const d = b + w;
      const pa = pos(a);
      const ab = sub(pos(b), pa);
      const ac = sub(pos(c), pa);
      const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      if (dot(n, out(a)) >= 0) buf.idx.push(a, b, c, b, d, c);
      else buf.idx.push(a, c, b, b, c, d);
    }
}

/**
 * The `Eyes` mesh: one patch of light per eye, laid on the glass, wholly on its eye bone, with UVs
 * into the shared atlas (the pill is in the emissive map). `happy` squashes and bends it into an
 * arch; `surprised` grows it.
 */
function eyePatches(face, atlas, rect, eyes) {
  const b = new MeshBuffer(['happy', 'surprised']);
  const nd = normalDeltas(b.keys);
  const nx = 14;
  const ny = 12;
  const col = toLinear(COL.glass);
  for (const eye of eyes) {
    const base = b.count;
    const at = (lx, ly) => onGlass(face, eye.x + lx, EYE_Y + ly, LIFT.eye);
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const v = j / ny;
        const lx = (2 * u - 1) * PATCH[0];
        const ly = (2 * v - 1) * PATCH[1];
        const s = at(lx, ly);
        const arch = ly * 0.3 + 0.06 * (1 - (lx / 0.07) ** 2) - 0.03; // squashed, its middle up
        const happy = at(lx, arch);
        const wide = at(lx * 1.2, ly * 1.14);
        const id = b.addVertex(s.p, s.n, atlas.rectUV(rect, u, v), [[eye.bone, 1]], { happy: sub(happy.p, s.p), surprised: sub(wide.p, s.p) }, col);
        nd.set('happy', id, sub(happy.n, s.n));
        nd.set('surprised', id, sub(wide.n, s.n));
      }
    gridFacing(
      b,
      base,
      ny,
      nx,
      (a) => b.P(a),
      (a) => b.nor.slice(a * 3, a * 3 + 3),
    );
  }
  return { buf: b, normals: nd };
}

/** The pill of light in the eyes' rectangle of the emissive map: scan lines, a soft halo. */
function paintPill(glowCanvas, canvas, atlas, rect) {
  paintRect(glowCanvas, atlas, rect, (u, v, out) => {
    const x = (2 * u - 1) * PATCH[0];
    const y = (2 * v - 1) * PATCH[1];
    const d = rrect(x, y, PILL[0], PILL[1], PILL[2]);
    const core = sstep(0.004, -0.004, d);
    const edge = sstep(0, 0.018, Math.min(PATCH[0] - Math.abs(x), PATCH[1] - Math.abs(y)));
    const halo = 0.4 * Math.exp(-Math.max(d, 0) / 0.011) * (1 - core) * edge;
    const scan = 0.84 + 0.16 * Math.cos((y * Math.PI * 2) / 0.024);
    const c = lerp3(COL.glow, COL.hot, sstep(-0.004, -0.034, d));
    write(out, scl(c, core * scan + halo), 1);
  });
  paintRect(canvas, atlas, rect, (u, v, out) => write(out, COL.glass, 0)); // the Eyes have no base map
}

/**
 * The shutters (in Body): per eye an upper and a lower dark strip over the glass, collapsed to
 * nothing at rest above and below the pill; the keys slide their leading edges over it.
 */
function shutterPart(face, eyes) {
  let rect = -1;
  const nx = 8;
  const rows = 2;
  return {
    reserve(atlas) {
      rect = atlas.addRect(0.05, 0.05);
    },
    build(buf, atlas, wts, nd) {
      const uv = atlas.rectUV(rect, 0.5, 0.5);
      for (const eye of eyes)
        for (const upper of [true, false]) {
          const sg = upper ? 1 : -1;
          const L = eye.side > 0 ? 'L' : 'R';
          const at = (lx, ly) => onGlass(face, eye.x + lx, EYE_Y + ly, LIFT.shutter);
          const base = buf.count;
          const shut = []; // the vertices' positions with the shutter closed (for the winding)
          for (let j = 0; j <= rows; j++)
            for (let i = 0; i <= nx; i++) {
              const lx = (2 * (i / nx) - 1) * SHUT[0];
              const outer = 0.5 + (0.5 * lx * eye.side) / SHUT[0]; // 0 at the nose side .. 1 at the outer end
              const rest = at(lx, sg * SHUT[1]);
              // each key's leading edge (ly), the strip stretching from it back to the rest edge
              const edges = upper
                ? { blink: 0.012, squint: 0.046, sad: SHUT[1] - 0.05 - 0.075 * outer, angry: SHUT[1] - 0.05 - 0.095 * (1 - outer) }
                : { blink: -0.012, squint: -0.052, angry: -SHUT[1] + 0.03 };
              const mo = {};
              const nm = {};
              for (const [key, e] of Object.entries(edges)) {
                const name = key === 'blink' || key === 'squint' ? `${key}_${L}` : key;
                const to = at(lx, mix(e, sg * SHUT[1], j / rows));
                mo[name] = sub(to.p, rest.p);
                nm[name] = sub(to.n, rest.n);
              }
              shut.push(at(lx, mix(0, sg * SHUT[1], j / rows)).p);
              const id = buf.addVertex(rest.p, rest.n, uv, [[eye.bone, 1]], mo);
              for (const [k, v] of Object.entries(nm)) nd.set(k, id, v);
            }
          gridFacing(
            buf,
            base,
            rows,
            nx,
            (a) => shut[a - base],
            (a) => buf.nor.slice(a * 3, a * 3 + 3),
          );
        }
    },
    paint(canvas, atlas) {
      paintRect(canvas, atlas, rect, (u, v, out) => write(out, COL.glass, 0));
    },
  };
}

/**
 * The mouth (in Body): a patch of light on the glass, a short line with a hint of a smile at
 * rest; each key reshapes it. A shape is [half width, half height, bend (corners up), dy].
 */
function mouthPart(face) {
  let rect = -1;
  const REST = [0.052, 0.009, 0.008, 0];
  const shapes = {
    happy: [0.084, 0.022, 0.042, -0.014],
    sad: [0.058, 0.009, -0.03, 0.008],
    surprised: [0.03, 0.034, 0, -0.012],
    mouthOpen: [0.058, 0.044, 0.004, -0.02],
    angry: [0.044, 0.01, -0.02, 0],
  };
  const rings = 3;
  const segs = 20;
  return {
    reserve(atlas) {
      rect = atlas.addRect(0.14, 0.14);
    },
    build(buf, atlas, wts, nd) {
      const shapeAt = ([ax, ay, bend, dy]) => (rho, a) => {
        const c = rho * Math.cos(a);
        return onGlass(face, ax * c, MOUTH_Y + dy + ay * rho * Math.sin(a) + bend * c * c, LIFT.mouth);
      };
      const rest = shapeAt(REST);
      const targets = Object.entries(shapes).map(([k, s]) => [k, shapeAt(s)]);
      const base = buf.count;
      for (let ri = 0; ri <= rings; ri++)
        for (let s = 0; s < (ri === 0 ? 1 : segs); s++) {
          const rho = ri / rings;
          const a = (s / segs) * Math.PI * 2;
          const p0 = rest(rho, a);
          const to = targets.map(([k, t]) => [k, t(rho, a)]);
          const mo = Object.fromEntries(to.map(([k, t]) => [k, sub(t.p, p0.p)]));
          const id = buf.addVertex(p0.p, p0.n, atlas.rectUV(rect, 0.5 + 0.5 * rho * Math.cos(a), 0.5 + 0.5 * rho * Math.sin(a)), wts, mo);
          for (const [k, t] of to) nd.set(k, id, sub(t.n, p0.n));
        }
      const ring = (ri, s) => (ri === 0 ? base : base + 1 + (ri - 1) * segs + (s % segs));
      const n0 = rest(0, 0).n;
      for (let ri = 0; ri < rings; ri++)
        for (let s = 0; s < segs; s++) {
          if (ri === 0) buf.tri(ring(0, 0), ring(1, s), ring(1, s + 1), n0);
          else {
            buf.tri(ring(ri, s), ring(ri + 1, s), ring(ri + 1, s + 1), n0);
            buf.tri(ring(ri, s), ring(ri + 1, s + 1), ring(ri, s + 1), n0);
          }
        }
    },
    paint(canvas, atlas, glow) {
      const lit = (u, v) => lerp3(COL.hot, COL.glow, sstep(0.2, 0.9, Math.hypot(u - 0.5, v - 0.5) * 2));
      paintRect(canvas, atlas, rect, (u, v, out) => write(out, lit(u, v), 0));
      paintRect(glow, atlas, rect, (u, v, out) => write(out, scl(lit(u, v), 0.95), 1));
    },
  };
}

// ---------------------------------------------------------------------------- the painting

/** 1 on a thin line where v crosses 0 (half width w). */
const line = (v, w = 0.006) => sstep(w, w * 0.4, Math.abs(v));

/**
 * The shell's look at design-space point p: { c (sRGB), a (tint mask), g (emissive sRGB) }.
 * White shell, coloured panels (tinted: light grey, seams darker), dark glass and metal, lights.
 */
function makeShade(shape) {
  const P = {};
  const PARTS = ['nozzle', 'jet', 'armL', 'armR', 'earL', 'earR', 'ant'];
  return (p, n, ao) => {
    const [x, y, z] = p;
    shape.parts(x, y, z, P);
    let near = 'pod';
    let dm = P.pod;
    for (const k of PARTS)
      if (P[k] < dm) {
        dm = P[k];
        near = k;
      }
    const grain = 0.025 * (fbm(x * 5, y * 5, z * 5) - 0.5);
    let c = COL.white.map((v) => v + grain);
    let a = 0;
    let g = [0, 0, 0];
    let lit = false;
    const tint = (k = 1) => {
      const v = (0.8 + grain) * k;
      c = [v, v, v];
      a = 1;
    };
    const seam = (k) => {
      if (k > 0) c = a ? scl(c, 1 - 0.42 * k) : lerp3(c, COL.seam, 0.8 * k);
    };
    const plain = (col) => {
      c = col.map((v) => v + grain);
      a = 0;
    };
    const glow = (col, k = 1) => {
      c = col;
      a = 0;
      g = scl(col, k);
      lit = true;
    };

    if (near === 'pod') {
      const [qx, qy, qz] = wf(x, y, z);
      const ax = Math.abs(qx);
      const front = qz > 0.04;
      const vd = front ? visorD(qx, qy) : 1;
      if (vd < 0) {
        // the glass: dark, a touch lighter toward its rim
        plain(lerp3(COL.glass, COL.glassHi, 0.6 * sstep(-0.02, 0, vd)));
      } else if (vd < BEZEL) {
        tint(1.04);
        seam(line(vd - 0.003));
        seam(line(vd - BEZEL + 0.003));
      } else if (Math.abs(x) > 0.44 && Math.hypot(y - EAR[1], z - EAR[2]) < 0.06) {
        plain(COL.metal); // the engine pods' axles
      } else {
        const chin = front && qy < VISOR.y;
        const stripe = ax < 0.17 && !chin;
        const belt = qy < -0.262 && qy > -0.316;
        if (stripe || belt) {
          tint(1);
          if (stripe) {
            c = scl(c, 1 - 0.2 * line(ax - 0.118, 0.007)); // pinstripes
            if (qz < -0.1) seam(line(qy - 0.04)); // a hatch seam across the back
            if (qz < -0.1) seam(line(qy + 0.13));
          }
        }
        if (!chin) seam(line(ax - 0.17));
        seam(line(qy + 0.262));
        seam(line(qy + 0.316));
        if (!stripe && !belt) {
          // the axles' sockets, the status lights (the pet's right) and vent slots (its left)
          seam(line(Math.hypot(y - EAR[1], z - EAR[2]) - 0.085) * sstep(0.3, 0.4, Math.abs(x)));
          if (front) {
            for (const [lx, ly, col] of LIGHTS) {
              const lz = RAD[2] * Math.sqrt(1 - (lx / RAD[0]) ** 2 - (ly / RAD[1]) ** 2);
              const r = Math.hypot(qx - lx, qy - ly, qz - lz);
              if (r < 0.031) plain(COL.metal);
              if (r < 0.021) glow(lerp3(col, [1, 1, 1], 0.25 * sstep(0.014, 0.0, r)), 0.6);
              const rv = Math.hypot(qx + lx, qy - ly);
              if (rv < 0.034) {
                // a slot along the visor's corner arc
                const tx = -(ly - 0.08);
                const ty = -lx - 0.19;
                const tl = Math.hypot(tx, ty) || 1;
                const along = ((qx + lx) * tx + (qy - ly) * ty) / tl;
                const across = ((qx + lx) * ty - (qy - ly) * tx) / tl;
                if (Math.abs(across) < 0.03 && Math.abs(along) < 0.0075) plain(lerp3(COL.metal, COL.glass, 0.6));
              }
            }
          }
        }
      }
    } else if (near === 'nozzle') {
      const r = Math.hypot(x - THRUST[0], z - THRUST[1]);
      if (y < 0.27 && n[1] < -0.2) {
        // under the ring and inside the bowl: the anti-gravity glow
        glow(lerp3(COL.glow, COL.hot, sstep(0.2, 0.08, r)), 0.95);
      } else if (y > 0.315) {
        tint(0.94); // the collar
        seam(line(y - 0.32));
        seam(line(y - 0.39));
      } else plain(COL.metal);
    } else if (near === 'jet') {
      glow(lerp3(COL.hot, COL.glow, sstep(0.24, 0.04, y)), mix(0.8, 1, sstep(0.02, 0.2, y)));
    } else if (near === 'armL' || near === 'armR') {
      const i = near === 'armL' ? 0 : 1;
      const A = shape.arms[i].A;
      const t = dot(sub(p, A.S), A.a);
      if (t > 0.222) plain(COL.metalLight);
      else if (t > 0.165) {
        tint(1);
        seam(line(t - 0.168));
      } else if ((i === 0 ? P.armLSh : P.armRSh) < 0.004) plain(COL.metal);
    } else if (near === 'earL' || near === 'earR') {
      const dy = y - EAR[1];
      if (dy < -0.09) {
        if (n[1] < -0.5) glow(lerp3(COL.glow, COL.hot, 0.4), 0.9); // its little thruster
        else plain(COL.metal);
      } else if (dy > 0.028) {
        tint(1);
        seam(line(dy - 0.031));
      } else seam(line(dy + 0.04, 0.0035));
    } else if (P.bulb < 0.005) glow(COL.amber, 0.85);
    else plain(dot(sub(p, ANT_PIVOT), ANT_DIR) < 0.03 ? COL.metal : COL.metalLight);
    return { c: lit ? c : scl(c, ao), a, g };
  };
}

// ------------------------------------------------------------------------------- the build

/**
 * @param {{texture?: number, triangles?: number, grid?: number}} [o] texture size, target triangles
 *   for the fused shell, surface-nets grid spacing (design units)
 * @returns {import('three').Group} the scene: the bone tree (root) and the Body and Eyes skinned meshes
 */
export function build({ texture: N = 1024, triangles = 7000, grid = 0.016 } = {}) {
  const shape = makeShape();
  const f = shape.sdf;

  const shell = buildShell(f, {
    lo: [-0.8, -0.04, -0.7],
    hi: [0.8, 1.42, 0.7],
    grid,
    triangles,
    importance: ([x, y, z]) => {
      const [qx, qy, qz] = wf(x, y, z);
      if (qz > 0.05 && Math.abs(visorD(qx, qy)) < 0.05) return 2.2; // the visor's rim
      if (y > 1.15 && Math.abs(x) < 0.1) return 3; // the antenna
      if (y < 0.48 || Math.abs(x) > 0.52) return 2; // thruster, arms, engine pods, antenna
      return 1;
    },
  });
  const ao = fieldAO(f, shell.pos, shell.nor, { min: 0.78 });

  // the face: patches on the glass, each eye's on its bone
  const face = surfaceAt(f, POD);
  const eyes = [1, -1].map((side) => {
    const s = face(EYE_X * side, EYE_Y);
    return { side, x: EYE_X * side, bone: side > 0 ? BI.eye_L : BI.eye_R, E: sub(s.p, scl(s.n, EYE_DEPTH)) };
  });
  const parts = [shutterPart(face, eyes), mouthPart(face)];

  // UVs
  const atlas = createAtlas({ size: N, pad: 3 });
  atlas.addShell(shell.pos, shell.tris);
  for (const part of parts) part.reserve(atlas);
  const eyeRect = atlas.addRect(PATCH[0] * 4, PATCH[1] * 4);
  atlas.layout();

  // the Body: a rigid shell (no shape keys on it), then the shutters and the mouth
  const body = new MeshBuffer(KEYS);
  const shellTris = appendShell(body, shell, atlas, (i, p) => ({ weights: skinOf(shape, p) }));
  const shellCount = body.count;
  const bodyNormals = normalDeltas(KEYS);
  for (const part of parts) part.build(body, atlas, [[BI.head, 1]], bodyNormals);

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
  for (const part of parts) part.paint(canvas, atlas, glowCanvas);
  paintPill(glowCanvas, canvas, atlas, eyeRect);
  dilate(canvas, 6);
  dilate(glowCanvas, 6);
  for (let i = 3; i < glowCanvas.data.length; i += 4) glowCanvas.data[i] = 255;

  const eyeMesh = eyePatches(face, atlas, eyeRect, eyes);
  const bones = BONES.map(([n, parent, p]) => [n, parent, p ?? { eye_L: eyes[0].E, eye_R: eyes[1].E }[n]]);
  const scene = assemble({
    name: 'drone',
    bones,
    body,
    eyes: eyeMesh.buf,
    map: toTexture(canvas, 'drone_basecolor'),
    fit: fitScale(body, shellCount),
    roughness: 0.34,
    eyeRoughness: 0.34, // as the glass round them, so the patches do not show
  });
  bodyNormals.attach(scene.getObjectByName('Body').geometry);
  eyeMesh.normals.attach(scene.getObjectByName('Eyes').geometry);
  // the glow: one emissive map shared by the lights, ring and jet (Body) and the eyes
  const emissive = toTexture(glowCanvas, 'drone_emissive');
  for (const name of ['Body', 'Eyes']) {
    const m = scene.getObjectByName(name).material;
    m.emissiveMap = emissive;
    m.emissive.setRGB(1, 1, 1);
    m.emissiveIntensity = 1;
  }
  return scene;
}

export const buildDrone = build;

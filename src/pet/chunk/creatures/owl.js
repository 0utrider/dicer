import * as THREE from 'three';
import {
  TAU,
  bump,
  keys,
  lerp,
  outBack,
  plateau,
  smooth,
  span,
  nowMs,
  paint,
  palette,
  poseKit,
  createKit,
  createEye,
  detailMaterial,
  mergeFlat,
} from './parts.js';

/**
 * The owl: a round, plump ball of feathers with a lighter heart-shaped facial disc around two huge
 * eyes, a little hooked beak, two ear tufts, short wings folded at its sides and tiny talons.
 * Wise, and easily flustered. Its big head and face are tipped up toward the top-down camera, so
 * from above it reads as a pale heart-shaped face with two huge eyes, ear tufts and wing bulges.
 * Crit: wings flung wide, a hop and a full 360 head swivel; fumble: it puffs up, then droops, its
 * head tilted far over in confusion, eyes half shut; mixed: one wing raised, head cocked; plain:
 * a pleased little bob.
 */

const HEIGHT = 1.5;
const FOOT = 0.71; // top-down body radius in scene units, wings excluded (measured)
const EYE_R = 0.18;
const GAZE0 = 0.05; // resting gaze: up at the camera
const FACE_TILT = -0.85; // the face turns up toward the top-down camera
const UP0 = 0; // resting lids: wide open, big round owl eyes
const LO0 = 0;
const WING0 = 0.2; // the resting wing value: folded snug against the body

const BEAK = new THREE.Color('#f0b347');
const TALON = new THREE.Color('#3b2f2a');

const REST = {
  lift: 0,
  squash: 0, // > 0 flatter, < 0 taller
  puff: 0, // feathers fluffed: the body swells
  pitch: 0,
  roll: 0,
  spin: 0,
  yaw: 0,
  headPitch: 0, // + nods down
  headRoll: 0,
  headYaw: 0,
  wing: 0.2, // spread, rad (0 folded flat to the body, ~1.6 straight out, more raised)
  wingL: 0, // extra spread on the left wing
  sweep: 0, // + swings the wings forward
  tuft: 0, // + flattens the ear tufts back, - pricks them up
  upper: UP0,
  lower: LO0,
  upperR: 0,
  sad: 0,
  sadL: 0,
  gazeYaw: 0,
  gazePitch: GAZE0,
  tuck: 0, // talons pulled up (flying)
};
const PK = poseKit(REST);
const FLY_BEATS = 6; // wing beats in one dodge flight: a hard, fast flap

// Keyframes, hoisted so a pose allocates nothing.
// Throw: leans back with both wings up, then swats forward and down.
const T_PITCH = [0, 0, 0.3, -0.18, 0.55, 0.22, 1, 0];
const T_HEAD = [0, 0, 0.3, -0.2, 0.55, 0.15, 1, 0];
const T_WING = [0, 0.2, 0.3, 1.5, 0.55, 0.45, 0.85, 0.3, 1, 0.2];
const T_SWEEP = [0, 0, 0.3, -0.3, 0.55, 0.6, 1, 0];
const T_SQUASH = [0, 0, 0.3, -0.08, 0.55, 0.1, 0.8, -0.02, 1, 0];
const T_UPPER = [0, 0, 0.3, 0.45, 0.55, 0, 1, 0];
// Crit: crouch, spring, land, settle.
const C_SQUASH = [0, 0, 0.12, 0.2, 0.2, -0.14, 0.5, -0.04, 0.6, 0.16, 0.7, -0.04, 0.8, 0];
// Mixed: the eyes dart one way, then the other.
const M_GAZE = [0.2, 0, 0.32, -1, 0.5, -1, 0.6, 1, 0.78, 1, 0.9, 0];

/** The ellipsoid surface z (front) of centre c, semi-axes a at (x, y): for feather marks. */
const surfZ = (c, a, x, y) =>
  c[2] + a[2] * Math.sqrt(Math.max(0, 1 - (x / a[0]) ** 2 - ((y - c[1]) / a[1]) ** 2));

// The torso ellipsoid (in the fluff group): centre and semi-axes. The wings are shaped onto it.
const TC = [0, 0, -0.02];
const TA = [0.82, 0.528, 0.648];
/** The torso surface x (side) at (y, z), in the fluff group. */
const surfX = (y, z) =>
  TA[0] * Math.sqrt(Math.max(0, 1 - ((y - TC[1]) / TA[1]) ** 2 - ((z - TC[2]) / TA[2]) ** 2));

// The skull ellipsoid (in the head group) and the face frame on it, turned up by FACE_TILT.
const SKULL_C = [0, 0.1, -0.07];
const SKULL_A = [0.557, 0.49, 0.53];
const FACE_P = [0, 0.08, 0.02];
/** How far out along the face's +Z the skull surface lies at face (x, y): seats the face parts. */
function skullZ(x, y) {
  const c = Math.cos(FACE_TILT);
  const s = Math.sin(FACE_TILT);
  const o = [
    x / SKULL_A[0],
    (y * c + FACE_P[1] - SKULL_C[1]) / SKULL_A[1],
    (y * s + FACE_P[2] - SKULL_C[2]) / SKULL_A[2],
  ];
  const d = [0, -s / SKULL_A[1], c / SKULL_A[2]];
  const qa = d[1] ** 2 + d[2] ** 2;
  const qb = 2 * (o[1] * d[1] + o[2] * d[2]);
  const qc = o[0] ** 2 + o[1] ** 2 + o[2] ** 2 - 1;
  return (-qb + Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa);
}

/**
 * The facial disc (in the face group): one smooth heart, a notch between two round upper lobes
 * and a soft point at the chin, laid onto the skull and following the head's curve: a shallow dish
 * whose raised ruff of a rim rings both eyes, then rolls down to sit flush on the head.
 */
function heartDisc() {
  const g = new THREE.SphereGeometry(1, 24, 7, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2); // a cap on +Z
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(x, y); // 0 up, +-PI at the chin
    const d = Math.PI - Math.abs(a);
    const r = (1 - 0.22 * Math.exp(-((a / 0.4) ** 2))) * (1 + 0.14 * Math.exp(-((d / 0.6) ** 2)));
    const X = x * r * 0.5;
    const Y = y * r * 0.4 + 0.03;
    const base = skullZ(X, Y);
    const rho2 = 1 - z * z; // 0 at the centre, 1 at the rim
    const ruff = 0.012 + 0.24 * rho2 ** 1.5 * z - 0.03 * rho2 ** 8; // thin in the middle, a ridge near the rim
    p.setXYZ(i, X, Y, base + ruff); // (its open edge tucks just under the skull surface)
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A folded feather shape hugging the torso (in the fluff group, +X side): an outline from the
 * top (y0) down `len`, `w` wide at the top tapering toward the tip, swept back toward the tip,
 * `t` thick, its inner face on the torso surface (never closer in than xMin), the tip lifting
 * `lift` off it.
 */
function featherShape({
  y0,
  len,
  z0,
  w,
  taper,
  back,
  t,
  lift = 0,
  xMin = 0.5,
  sink = 0.03,
  seg = 6,
}) {
  const g = new THREE.SphereGeometry(1, seg, seg - 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const sx = p.getX(i);
    const sy = p.getY(i);
    const sz = p.getZ(i);
    const v = (1 - sy) / 2; // 0 at the top, 1 at the tip
    const Y = y0 - v * len;
    const Z = z0 - back * v * v + sz * w * (1 - taper * v);
    const X = Math.max(xMin, surfX(Y, Z)) - sink + t * (1 + sx) + lift * v * v;
    p.setXYZ(i, X, Y, Z);
  }
  g.computeVertexNormals();
  return g;
}

export function owl(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.7, metalness: 0 }),
  );
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.65, metalness: 0 }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'owl';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const squash = new THREE.Group();
  rig.add(squash);
  // The body puffs about its middle (fluffed feathers), not about the floor.
  const fluff = new THREE.Group();
  fluff.position.y = 0.6;
  squash.add(fluff);

  // Body: a plump egg, a soft pale oval belly with rows of little rounded feather scallops.
  const torso = kit.mesh(new THREE.SphereGeometry(1, 14, 10), body, fluff, ...TC);
  torso.scale.set(...TA);
  const BC = [0, -0.12, 0.2]; // belly centre (in fluff) and semi-axes
  const BA = [0.46, 0.36, 0.45];
  const belly = kit.mesh(new THREE.SphereGeometry(1, 12, 7), accent, fluff, ...BC);
  belly.scale.set(...BA);
  // Scallops: small flattened crescents of body colour, a staggered chevron pattern.
  const markGeo = kit.geo(new THREE.SphereGeometry(0.04, 6, 2, 0, TAU, 0, Math.PI / 2));
  for (const [x, y] of [
    [-0.1, 0.04],
    [0.1, 0.04],
    [0, -0.08],
    [-0.2, -0.1],
    [0.2, -0.1],
    [-0.1, -0.22],
    [0.1, -0.22],
  ]) {
    const m = new THREE.Mesh(markGeo, body);
    m.position.set(x, y, surfZ(BC, BA, x, y) - 0.008);
    m.rotation.set(Math.PI, x * 1.5, 0, 'YXZ'); // the dome opens upward: a U-shaped scallop
    m.scale.set(1.25, 0.9, 0.35);
    fluff.add(m);
  }

  // Talons: a little foot each side, three dark claws curling forward.
  const padGeo = kit.geo(paint(new THREE.SphereGeometry(0.075, 7, 4), BEAK));
  const clawGeo = kit.geo(paint(new THREE.ConeGeometry(0.026, 0.1, 4), TALON));
  const feet = [];
  for (const sx of [1, -1]) {
    const f = new THREE.Group();
    f.position.set(sx * 0.2, 0.035, 0.32);
    squash.add(f);
    const pad = new THREE.Mesh(padGeo, detail);
    pad.scale.set(1.1, 0.5, 1);
    f.add(pad);
    for (const a of [-0.45, 0, 0.45]) {
      const c = new THREE.Mesh(clawGeo, detail);
      c.position.set(Math.sin(a) * 0.075, -0.005, Math.cos(a) * 0.075);
      c.rotation.set(Math.PI / 2 + 0.25, a, 0, 'YXZ');
      f.add(c);
    }
    feet.push(f);
  }

  // Head: a big round head sunk into the body (no neck). The face is turned up toward the
  // (top-down) camera: one pale heart-shaped facial disc laid onto the skull, framing two big
  // round open eyes, a small hooked beak between them, and two ear tufts behind.
  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  head.position.set(0, 0.84, 0.06);
  head.scale.setScalar(1.2); // a big head: from above it is most of the owl
  squash.add(head);
  const skull = kit.mesh(new THREE.SphereGeometry(1, 14, 10), body, head, ...SKULL_C);
  skull.scale.set(...SKULL_A);
  const face = new THREE.Group();
  face.position.set(...FACE_P);
  face.rotation.x = FACE_TILT;
  head.add(face);
  // One smooth heart-shaped disc, seated on the skull and framing both eyes.
  kit.mesh(heartDisc(), accent, face);
  const beak = kit.mesh(
    paint(new THREE.ConeGeometry(0.06, 0.17, 6), BEAK),
    detail,
    face,
    0,
    -0.08,
    skullZ(0, -0.08) + 0.08,
  );
  beak.rotation.x = Math.PI * 0.72; // the tip hooks down and forward
  beak.scale.set(1, 1, 0.7);
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lid: accent });
    e.socket.position.set(side * 0.18, 0.05, skullZ(0.18, 0.05) + 0.025);
    e.socket.rotation.order = 'YXZ';
    e.socket.rotation.set(-0.05, side * 0.3, 0); // ~50 deg up: round from above and in front
    face.add(e.socket);
    return e;
  });
  const tuftGeo = kit.geo(new THREE.ConeGeometry(0.09, 0.24, 6).translate(0, 0.12, 0));
  const tufts = [1, -1].map((side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.32, 0.46, -0.16);
    head.add(g);
    const m = new THREE.Mesh(tuftGeo, body);
    m.scale.set(1, 1, 0.55);
    g.add(m);
    return g;
  });

  // Wings: folded wings lying snug along the body sides, each one shape that follows the torso's
  // curve from under the head down to a swept-back tip, with three primaries fanning out beneath
  // it into a feathered fringe. Each hinges at its shoulder; spreading swings the tip out and up.
  // They live in the fluff group, so a puffed body carries them out with it.
  const SHOULDER = [0.6, 0.3, 0];
  const wingGeo = kit.geo(
    mergeFlat([
      featherShape({
        y0: 0.34,
        seg: 9,
        len: 0.6,
        z0: -0.02,
        w: 0.26,
        taper: 0.5,
        back: 0.2,
        t: 0.055,
        lift: 0.05,
        sink: 0.02,
      }),
      ...[
        [-0.08, 0.33],
        [-0.15, 0.37],
        [-0.22, 0.34],
      ].map(([z0, len]) =>
        featherShape({ y0: -0.05, len, z0, w: 0.07, taper: 0.6, back: 0.16, t: 0.03, lift: 0.03 }),
      ),
    ]).translate(-SHOULDER[0], -SHOULDER[1], -SHOULDER[2]),
  );
  const wings = [1, -1].map((side) => {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.position.set(side * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
    fluff.add(g);
    const w = new THREE.Mesh(wingGeo, body);
    w.scale.x = side; // the left wing mirrors the right
    g.add(w);
    return g;
  });

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // Wings flung wide, a hop, and the head swivels all the way round.
      o.squash = keys(t, C_SQUASH);
      o.lift = Math.sin(Math.PI * span(t, 0.18, 0.6)) * 0.55;
      const wide = plateau(t, 0.08, 0.9, 0.1);
      o.wing = lerp(0.2, 2.2 + 0.25 * Math.sin(t * TAU * 6), wide);
      o.sweep = -0.15 * wide;
      o.tuck = bump(t, 0.18, 0.6);
      o.headYaw = TAU * smooth(span(t, 0.22, 0.68));
      o.headPitch = -0.2 * wide + 0.12 * bump(t, 0.7, 0.85);
      o.tuft = -0.35 * wide;
      o.upper = lerp(UP0, 0, wide);
      o.lower = lerp(LO0, 0.3, wide);
      o.gazePitch = lerp(GAZE0, 0.25, wide);
    } else if (reaction === 'fumble') {
      // A startled puff of feathers that deflates into a droop, head tilted far over, eyes
      // half shut, tufts flat: utterly baffled.
      const droop = smooth(span(t, 0.2, 0.6));
      o.puff = 0.18 * bump(t, 0.02, 0.4) - 0.04 * droop;
      o.squash = 0.1 * droop;
      o.headRoll = 0.75 * outBack(span(t, 0.25, 0.6), 1.6);
      o.headPitch = 0.12 * droop;
      o.roll = 0.05 * droop;
      o.wing = lerp(0.2 + 0.5 * bump(t, 0.02, 0.4), -0.05, droop);
      o.sweep = -0.2 * droop;
      o.tuft = 0.9 * droop - 0.4 * bump(t, 0.02, 0.35);
      o.upper = lerp(UP0, 0.55, droop);
      o.lower = lerp(LO0, 0.25, droop);
      o.sad = 0.45 * droop;
      o.gazePitch = lerp(GAZE0, -0.55, droop);
    } else if (reaction === 'mixed') {
      // Head cocked, one wing raised in a shrug, one eye narrowed, the eyes darting.
      const tilt = outBack(span(t, 0.04, 0.32), 2.2) * (1 - smooth(span(t, 0.82, 1)));
      o.headRoll = -0.45 * tilt;
      o.headYaw = 0.15 * tilt;
      o.roll = -0.05 * tilt;
      o.wingL = 1.1 * tilt;
      o.tuft = 0.3 * tilt;
      o.upperR = 0.4 * tilt;
      o.sadL = 0.4 * tilt;
      o.upper = lerp(UP0, 0.05, tilt);
      o.gazeYaw = 0.45 * keys(t, M_GAZE);
    } else {
      // A pleased little bob, eyes squeezed into contented arcs, wings giving a tiny flick.
      o.squash = 0.1 * bump(t, 0.08, 0.3) + 0.08 * bump(t, 0.32, 0.52);
      o.headPitch = 0.22 * bump(t, 0.1, 0.34) + 0.16 * bump(t, 0.34, 0.56);
      o.wing = 0.2 + 0.25 * bump(t, 0.15, 0.6);
      const content = plateau(t, 0.08, 0.92, 0.12);
      o.upper = lerp(UP0, 0.55, content);
      o.lower = lerp(LO0, 0.4, content);
      o.puff = 0.04 * content;
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  function idle(o, ms, amount = 1) {
    const s = Math.sin((ms / 2400) * TAU);
    o.squash += 0.015 * s * amount; // slow breathing
    o.puff += 0.012 * s * amount;
    o.wing += 0.03 * Math.sin((ms / 2400) * TAU + 1.3) * amount; // wings settling
    // Every ~7 s, a curious tilt of the head, alternating sides.
    const cycle = ms / 7000;
    const q = cycle - Math.floor(cycle);
    const side = Math.floor(cycle) % 2 ? 1 : -1;
    const tilt = plateau(q, 0.55, 0.85, 0.07) * amount;
    o.headRoll += 0.32 * side * tilt;
    o.headYaw += 0.12 * side * tilt;
    // Big round eyes, open; an occasional slow, wise blink.
    const sq = ((ms + 1300) % 6800) / 6800;
    const b = bump(sq, 0.92, 0.975);
    o.upper += (1 - o.upper) * b;
    o.lower += (0.5 - o.lower) * b;
  }

  function pose(phase, t, reaction, look) {
    const ms = look?.now ?? nowMs();
    const yaw = look?.yaw || 0;
    if (phase === 'react') react(p, reaction, t, ms);
    else if (phase === 'exit') {
      react(end, reaction, 1);
      PK.reset(tmp);
      tmp.squash = 0.12 * bump(t, 0, 0.25) - 0.08 * bump(t, 0.2, 0.85) + 0.12 * bump(t, 0.85, 1);
      tmp.wing = 0.2 + 0.9 * bump(t, 0.15, 0.95) * (0.5 + 0.5 * Math.sin(t * TAU * 3));
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      // It flutters in and lands with a little squash.
      PK.reset(p);
      p.squash = -0.08 * bump(t, 0.05, 0.75) + 0.16 * bump(t, 0.75, 1);
      p.wing = 0.2 + 1.2 * bump(t, 0, 0.85) * (0.5 + 0.5 * Math.sin(t * TAU * 3));
      p.tuck = bump(t, 0, 0.8);
      p.upper = lerp(0.05, UP0, t);
    } else if (phase === 'move') {
      // A dodge: it flies (the layer lifts it in an arc). A crouch, then wings beating hard and
      // fast, body level, talons tucked, tufts streaming back, eyes wide; a soft landing. It
      // starts and ends on the standing pose (exit at t 1).
      PK.reset(p);
      const fly = plateau(t, 0.04, 0.96, 0.14);
      const beat = Math.sin(t * TAU * FLY_BEATS);
      p.squash = 0.14 * bump(t, 0, 0.14) - 0.05 * fly + 0.14 * bump(t, 0.84, 1);
      p.lift = (0.28 + 0.06 * Math.sin(t * TAU * FLY_BEATS + 1.4)) * fly; // bobs with each beat
      p.pitch = 0.08 * fly;
      p.wing = lerp(0.2, 1.55 + 0.85 * beat, fly);
      p.sweep = lerp(0, -0.1 + 0.2 * beat, fly);
      p.tuck = fly;
      p.tuft = 0.45 * fly;
      p.upper = lerp(UP0, 0, fly);
      p.lower = lerp(LO0, 0, fly);
      p.gazePitch = lerp(GAZE0, 0, fly);
    } else if (phase === 'pet') {
      // Petted: feathers fluff, eyes shut in bliss, head nuzzling side to side, a wing flutter
      // (look.calm, reduced motion: a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.headRoll = 0.35 * k * Math.sin(t * TAU * 2) * on;
      p.roll = 0.06 * k * Math.sin(t * TAU * 2 + 0.6) * on;
      p.puff = 0.08 * on;
      p.wing = lerp(0.2, 0.35 + 0.2 * k * Math.sin(t * TAU * 4), on);
      p.squash = 0.04 * k * Math.sin(t * TAU * 4) * on;
      p.upper = lerp(UP0, 0.8, on);
      p.lower = lerp(LO0, 0.5, on);
    } else if (phase === 'huff') {
      // Huffed: it puffs up big and swivels its head right away, eyes narrowed, tufts pricked.
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.puff = 0.14 * mad + 0.05 * k * bump(t, 0.3, 0.6);
      p.squash = -0.06 * mad;
      p.headYaw = 1.0 * mad;
      p.headPitch = -0.12 * mad;
      p.wing = lerp(0.2, 0.55, mad);
      p.tuft = -0.4 * mad;
      p.upper = lerp(UP0, 0.55, mad);
      p.gazeYaw = 0.4 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop back, then it fans itself furiously with both wings, head
      // back, eyes squinting (look.calm: slower, smaller beats).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.25 * k * bump(t, 0.02, 0.28);
      p.wing = lerp(0.2, 1.0 + 0.45 * k * Math.sin(t * TAU * (look?.calm ? 3 : 6)), on);
      p.sweep = lerp(0, 0.5, on);
      p.headPitch = -0.2 * on;
      p.tuft = 0.3 * on;
      p.upper = lerp(UP0, 0.6, on);
    } else if (phase === 'shiver') {
      // Frozen (frost): fluffed into a ball, wings wrapped round its front, head sunk, shivering,
      // eyes squeezed (look.calm: a slower, smaller shiver).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.puff = 0.12 * on;
      p.roll = 0.06 * k * Math.sin(t * TAU * f) * on;
      p.wing = lerp(0.2, 0.05, on) + 0.04 * k * Math.sin(t * TAU * f * 1.3) * on;
      p.sweep = lerp(0, 0.7, on);
      p.headPitch = 0.15 * on;
      p.squash = 0.06 * on;
      p.tuft = 0.6 * on;
      p.upper = lerp(UP0, 0.7, on);
    } else if (phase === 'bristle') {
      // Zapped (storm): standing tall and thin, tufts straight up, wings half out, eyes huge,
      // trembling (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.12 * on;
      p.puff = -0.05 * on;
      p.wing = lerp(0.2, 0.9, on);
      p.tuft = -0.5 * on;
      p.roll = 0.04 * k * Math.sin(t * TAU * 10) * on;
      p.headPitch = -0.1 * on;
      p.upper = lerp(UP0, 0, on);
      p.lower = lerp(LO0, 0, on);
    } else if (phase === 'startle') {
      // Startled (any other element): a crouch, a jump with wings flung out and talons tucked,
      // eyes wide, and a landing (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      const air = span(t, 0.1, 0.5);
      p.lift = 0.55 * k * Math.sin(Math.PI * air);
      p.squash =
        0.14 * bump(t, 0, 0.12) - 0.1 * k * bump(t, 0.1, 0.5) + 0.14 * k * bump(t, 0.48, 0.66);
      p.tuck = bump(t, 0.12, 0.5);
      p.puff = 0.1 * bump(t, 0.08, 0.7);
      p.wing = 0.2 + 1.4 * bump(t, 0.08, 0.6);
      p.tuft = -0.4 * wide;
      p.upper = lerp(UP0, 0, wide);
      p.lower = lerp(LO0, 0, wide);
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy hops with wings flapping, head bobbing,
      // smiling eyes (look.calm: one small hop, gentle wingbeats). From and back to standing.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      const air1 = bump(t, 0.12, 0.42);
      const air2 = two * bump(t, 0.52, 0.82);
      p.lift =
        0.35 *
        k *
        (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash =
        k * (0.12 * bump(t, 0.02, 0.14) - 0.08 * air1 + 0.12 * bump(t, 0.42, 0.54)) +
        two * (0.1 * bump(t, 0.82, 0.95) - 0.08 * air2);
      p.tuck = k * (air1 + air2);
      p.wing = 0.2 + joy * (0.5 + (calm ? 0.15 : 0.7) * Math.sin(t * TAU * (calm ? 3 : 7)));
      p.headRoll = (calm ? 0.1 : 0.25) * Math.sin(t * TAU * 3) * joy;
      p.tuft = -0.3 * joy;
      p.upper = lerp(UP0, 0.5, joy);
      p.lower = lerp(LO0, 0.45, joy);
      p.gazePitch = lerp(GAZE0, 0.2, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: chest puffed out, standing tall, chin up, tufts pricked,
      // wise half-lidded eyes. Sulk: hunched, head hung, tufts flat, wings drooping.
      PK.reset(end);
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.pitch = -0.1;
        tmp.squash = -0.08;
        tmp.puff = 0.08;
        tmp.headPitch = -0.22;
        tmp.tuft = -0.4;
        tmp.wing = 0.12;
        tmp.sweep = -0.2;
        tmp.upper = 0.5;
        tmp.lower = 0.3;
        tmp.gazePitch = 0;
      } else {
        tmp.headPitch = 0.5;
        tmp.pitch = 0.08;
        tmp.squash = 0.17;
        tmp.puff = -0.03;
        tmp.wing = 0;
        tmp.sweep = -0.25;
        tmp.tuft = 1.0;
        tmp.upper = 0.6;
        tmp.sad = 0.5;
        tmp.gazePitch = -0.7;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.puff += 0.05 * bump(t, 0.2, 0.8); // a puff on the way
    } else if (phase === 'throw') {
      PK.reset(p);
      p.pitch = keys(t, T_PITCH);
      p.headPitch = keys(t, T_HEAD);
      p.wing = keys(t, T_WING);
      p.sweep = keys(t, T_SWEEP);
      p.squash = keys(t, T_SQUASH);
      p.upper = keys(t, T_UPPER);
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.headYaw += yaw * 0.6; // an owl turns its head, not its body
      p.gazeYaw += yaw * 0.7;
      p.yaw += yaw * 0.1;
    }
    apply(p);
  }

  function apply(o) {
    rig.position.y = o.lift;
    rig.rotation.set(o.pitch, o.spin + o.yaw, o.roll);
    const sy = 1 - o.squash;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    squash.scale.set(sxz, sy, sxz);
    const pf = Math.max(0.5, 1 + o.puff);
    fluff.scale.set(pf, pf, pf);
    head.rotation.set(o.headPitch, o.headYaw, o.headRoll);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const f = feet[i];
      f.position.y = 0.035 + 0.14 * o.tuck;
      f.position.z = 0.32 - 0.08 * o.tuck;
      const w = wings[i];
      // (never folded in past snug: that would push the wing into the body)
      const spread = Math.max(-0.03, o.wing - WING0 + (side < 0 ? o.wingL : 0));
      w.rotation.set(0, -side * o.sweep, side * spread);
      const tf = tufts[i];
      tf.rotation.set(-0.25 - o.tuft, 0, -side * (0.3 + 0.25 * o.tuft));
      eyes[i].set(
        o.gazeYaw,
        o.gazePitch,
        o.upper + (side === 1 ? o.upperR : 0),
        o.lower,
        o.sad + (side === -1 ? o.sadL : 0),
      );
    }
  }

  PK.reset(p);
  apply(p);
  root.updateMatrixWorld(true);
  const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
  scaler.scale.setScalar(HEIGHT / h);

  return { root, height: HEIGHT, footprint: FOOT, pose, dispose: () => kit.dispose() };
}

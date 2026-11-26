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
 * The raven: a sleek, slim black bird standing upright on thin dark legs, peering up at the
 * camera. A flat head with a long, straight, heavy beak that opens when it caws, a shaggy beard of
 * throat hackles, long wings folded back along its body, a wedge tail and bright, clever eyes set
 * high on the sides of its head, so from above it reads as a head with two eyes and a long beak
 * ahead of it, wings and a tail fan behind. Clever, and a bit of a show-off.
 * Crit: it takes off, wings beating hard, hanging in the air and cawing; fumble: it tucks its head
 * under a raised wing and hides, one eye peeking out; mixed: a quizzical head tilt one way, then
 * the other; plain: a pleased bob and a soft caw.
 */

const HEIGHT = 1.5;
const FOOT = 0.51; // top-down body radius in scene units, beak, wings and tail excluded (measured)
const EYE_R = 0.115;
const GAZE0 = 0.1; // resting gaze: up at the camera
const FACE_TILT = -0.7; // the face turns up toward the top-down camera
const UP0 = 0.1; // resting lids: a little hooded, a knowing look
const LO0 = 0;
const WING0 = 0.2; // the resting wing value: folded snug against the body
const TAIL0 = -0.42; // the tail's resting droop (rad)

const BEAK = new THREE.Color('#32323c');
const BEAK_LOW = new THREE.Color('#26262e');
const LEG = new THREE.Color('#3e3c46');
const CLAW = new THREE.Color('#16141a');

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
  headYaw: 0, // + toward its left (+X)
  wing: 0.2, // spread, rad (0 folded flat to the body, ~1.6 straight out, more raised)
  wingL: 0, // extra spread on the left wing
  sweep: 0, // + swings the wings forward
  sweepL: 0, // extra forward swing on the left wing
  tail: 0, // + raises the tail
  fan: 0, // the tail feathers spread
  jaw: 0, // the beak open, 0..1
  upper: UP0,
  lower: LO0,
  upperR: 0,
  sad: 0,
  sadL: 0,
  gazeYaw: 0,
  gazePitch: GAZE0,
  tuck: 0, // legs pulled up (flying)
};
const PK = poseKit(REST);
const FLY_BEATS = 5; // wing beats in one dodge flight

// Keyframes, hoisted so a pose allocates nothing.
// Throw: rears back with a wing up, then flicks it forward and down, beak open.
const T_PITCH = [0, 0, 0.3, -0.2, 0.55, 0.24, 1, 0];
const T_HEAD = [0, 0, 0.3, -0.22, 0.55, 0.2, 1, 0];
const T_WING = [0, 0.2, 0.3, 1.5, 0.55, 0.4, 0.85, 0.28, 1, 0.2];
const T_SWEEP = [0, 0, 0.3, -0.3, 0.55, 0.7, 1, 0];
const T_SQUASH = [0, 0, 0.3, -0.08, 0.55, 0.1, 0.8, -0.02, 1, 0];
const T_JAW = [0, 0, 0.4, 0, 0.58, 0.8, 0.85, 0, 1, 0];
// Crit: crouch, spring, hang in the air, land, settle.
const C_SQUASH = [0, 0, 0.1, 0.2, 0.18, -0.14, 0.78, -0.06, 0.88, 0.16, 0.95, -0.03, 1, 0];
const C_LIFT = [0, 0, 0.1, 0, 0.32, 0.62, 0.7, 0.58, 0.88, 0, 1, 0];
// Mixed: the head tilts one way, then the other.
const M_TILT = [0, 0, 0.18, 1, 0.42, 1, 0.58, -1, 0.82, -1, 1, 0];

// The trunk ellipsoid (in the fluff group): its semi-axes. The wings are shaped onto it.
const TA = [0.36, 0.42, 0.36];
/** The trunk surface x (side) at (y, z), in the fluff group. */
const surfX = (y, z) => TA[0] * Math.sqrt(Math.max(0, 1 - (y / TA[1]) ** 2 - (z / TA[2]) ** 2));

// The skull ellipsoid (in the face group, which is tilted up): centre and semi-axes.
const SKULL_C = [0, 0, -0.04];
const SKULL_A = [0.355, 0.285, 0.365];
/** The skull surface z (the face's forward) at face (x, y): seats the eyes and the beak. */
const skullZ = (x, y) =>
  SKULL_C[2] + SKULL_A[2] * Math.sqrt(Math.max(0, 1 - (x / SKULL_A[0]) ** 2 - (y / SKULL_A[1]) ** 2));

/**
 * A folded feather shape hugging the trunk (in the fluff group, +X side): an outline from the top
 * (y0) down `len`, `w` wide at the top tapering toward the tip, swept back toward the tip, `t`
 * thick, its inner face on the trunk surface (never closer in than xMin), the tip lifting `lift`
 * off it.
 */
function featherShape({ y0, len, z0, w, taper, back, t, lift = 0, xMin = 0.16, sink = 0.02, seg = 6 }) {
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

/** The wedge tail: a flat fan along -Z, widest two thirds along, narrowing to a blunt point. */
function tailFan() {
  const g = new THREE.SphereGeometry(1, 8, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = (1 - p.getY(i)) / 2; // 0 at the root, 1 at the tip
    const w = v < 0.62 ? lerp(0.09, 0.17, v / 0.62) : lerp(0.17, 0.07, (v - 0.62) / 0.38);
    p.setXYZ(i, p.getX(i) * w, p.getZ(i) * 0.03, -0.46 * v);
  }
  g.computeVertexNormals();
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
/** A cone from `a` (its base, radius r) to its point at `b`. */
function spike(a, b, r, sides = 5) {
  const from = new THREE.Vector3(...a);
  const dir = new THREE.Vector3(...b).sub(from);
  const len = dir.length();
  const g = new THREE.ConeGeometry(r, len, sides).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  return g.translate(from.x, from.y, from.z);
}

export function raven(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.5, metalness: 0 }));
  // the accent (the body colour lightened): the gloss on its breast
  const accent = kit.mat(new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.45, metalness: 0 }));
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'raven';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const squash = new THREE.Group();
  rig.add(squash);
  // The body puffs about its middle (fluffed feathers), not about the floor.
  const fluff = new THREE.Group();
  fluff.position.y = 0.67;
  squash.add(fluff);

  // Body: a slim upright egg, a smaller rump behind it, feathered thighs.
  const torso = kit.mesh(new THREE.SphereGeometry(1, 14, 10), body, fluff, 0, 0, 0, 'torso');
  torso.scale.set(...TA);
  const rump = kit.mesh(new THREE.SphereGeometry(1, 10, 6), body, fluff, 0, -0.13, -0.2, 'rump');
  rump.scale.set(0.29, 0.26, 0.33);
  const breast = kit.mesh(new THREE.SphereGeometry(1, 8, 5), accent, fluff, 0, -0.03, 0.17, 'breast');
  breast.scale.set(0.25, 0.3, 0.21);
  const thighGeo = kit.geo(new THREE.SphereGeometry(1, 8, 6));
  for (const sx of [1, -1]) {
    const m = new THREE.Mesh(thighGeo, body);
    m.position.set(sx * 0.15, -0.28, -0.02);
    m.scale.set(0.12, 0.17, 0.13);
    fluff.add(m);
  }

  // Legs: thin dark shanks, three toes forward and one back, a claw on each.
  const legGeo = kit.geo(
    paint(
      mergeFlat([
        new THREE.CylinderGeometry(0.03, 0.034, 0.32, 6).translate(0, 0.19, -0.03),
        ...[-0.5, 0, 0.5, Math.PI].map((a) => {
          const len = a === 0 ? 0.17 : a === Math.PI ? 0.09 : 0.145;
          return spike([0, 0.03, 0], [Math.sin(a) * len, 0.016, Math.cos(a) * len], 0.03, 5);
        }),
      ]),
      LEG,
    ),
  );
  const clawGeo = kit.geo(
    paint(
      mergeFlat(
        [-0.5, 0, 0.5, Math.PI].map((a) => {
          const len = a === 0 ? 0.17 : a === Math.PI ? 0.09 : 0.145;
          const s = Math.sin(a);
          const c = Math.cos(a);
          return spike([s * (len - 0.03), 0.02, c * (len - 0.03)], [s * (len + 0.035), 0.004, c * (len + 0.035)], 0.014, 4);
        }),
      ),
      CLAW,
    ),
  );
  const feet = [1, -1].map((sx) => {
    const f = new THREE.Group();
    f.position.set(sx * 0.16, 0, 0.05);
    f.rotation.order = 'ZXY'; // undoes the rig's lean exactly, so the toes stay flat on the floor
    f.rotation.y = sx * 0.14;
    squash.add(f);
    f.add(new THREE.Mesh(legGeo, detail), new THREE.Mesh(clawGeo, detail));
    return f;
  });

  // Head: flat and sleek on a short neck. The face is turned up toward the (top-down) camera: two
  // bright eyes high on the sides of the head, the long heavy beak between and below them, and a
  // shaggy beard of hackles hanging from the throat.
  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  head.position.set(0, 0.9, 0.07);
  squash.add(head);
  const face = new THREE.Group();
  face.position.set(0, 0.23, 0.05);
  face.rotation.x = FACE_TILT;
  head.add(face);
  const skull = kit.mesh(new THREE.SphereGeometry(1, 14, 10), body, face, ...SKULL_C, 'skull');
  skull.scale.set(...SKULL_A);
  // The beak, along the face's forward tipped down a little (so it points just above level): the
  // heavy upper mandible, and a slimmer lower one that drops about a hinge at its root.
  const beakDir = Math.atan2(1, -0.62); // the turn about X that takes +Y onto the beak's axis
  const beakAt = [0, -0.155, skullZ(0, -0.155) - 0.07];
  const upperBeak = kit.mesh(
    paint(new THREE.ConeGeometry(0.115, 0.48, 8).translate(0, 0.24, 0), BEAK),
    detail,
    face,
    beakAt[0],
    beakAt[1] + 0.02,
    beakAt[2],
  );
  upperBeak.rotation.x = beakDir;
  upperBeak.scale.set(0.74, 1, 0.9);
  const jaw = new THREE.Group();
  jaw.position.set(beakAt[0], beakAt[1] - 0.03, beakAt[2] + 0.04);
  face.add(jaw);
  const lowerBeak = kit.mesh(
    paint(new THREE.ConeGeometry(0.085, 0.4, 8).translate(0, 0.2, 0), BEAK_LOW),
    detail,
    jaw,
    0,
    -0.012,
    -0.04,
  );
  lowerBeak.rotation.x = beakDir + 0.05;
  lowerBeak.scale.set(0.8, 1, 0.75);
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lid: body });
    e.socket.position.set(side * 0.215, 0.07, skullZ(0.215, 0.07) - 0.075);
    e.socket.rotation.order = 'YXZ';
    e.socket.rotation.set(-0.24, side * 0.56, 0); // out and up: round from above and in front
    face.add(e.socket);
    return e;
  });
  // The hackles (head-local): a short upper row and a longer lower one, hanging down and out.
  kit.mesh(
    mergeFlat(
      [
        [0.05, 0.14, 0.03, 0.3],
        [-0.05, 0.14, 0.03, 0.3],
        [0.15, 0.14, 0.05, 0.24],
        [-0.15, 0.14, 0.05, 0.24],
        [0, 0.08, -0.09, 0.36],
        [0.1, 0.08, -0.06, 0.32],
        [-0.1, 0.08, -0.06, 0.32],
        [0.195, 0.08, -0.02, 0.24],
        [-0.195, 0.08, -0.02, 0.24],
      ].map(([x, y0, y1, out]) => {
        const ax = Math.abs(x);
        return spike([x * 0.9, y0, 0.2 - ax * 0.3], [x * 1.15, y1, out - ax * 0.25], 0.075, 6);
      }),
    ),
    body,
    head,
  );

  // Wings: long wings folded back along the body, each one leaf of coverts from the shoulder with
  // three long flight feathers fanning out behind it to tips that lie beside the tail. Each hinges
  // at its shoulder; spreading swings the tips out and up. They live in the fluff group, so a
  // puffed body carries them out with it.
  const SHOULDER = [0.3, 0.2, 0.02];
  const wingGeo = kit.geo(
    mergeFlat([
      featherShape({ y0: 0.25, seg: 9, len: 0.5, z0: -0.02, w: 0.19, taper: 0.45, back: 0.3, t: 0.04, lift: 0.03 }),
      ...[
        [-0.1, 0.36, 0.34],
        [-0.17, 0.4, 0.42],
        [-0.24, 0.38, 0.5],
      ].map(([z0, len, back]) =>
        featherShape({ y0: -0.05, len, z0, w: 0.085, taper: 0.5, back, t: 0.03, lift: 0.02 }),
      ),
    ]).translate(-SHOULDER[0], -SHOULDER[1], -SHOULDER[2]),
  );
  const wings = [1, -1].map((side) => {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.position.set(side * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
    fluff.add(g);
    const w = new THREE.Mesh(wingGeo, body);
    w.scale.x = side; // the right wing mirrors the left
    g.add(w);
    return g;
  });

  // Tail: a wedge of long feathers from the rump, drooping back; it lifts and fans.
  const tail = new THREE.Group();
  tail.position.set(0, -0.18, -0.4);
  fluff.add(tail);
  kit.mesh(tailFan(), body, tail);

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // It takes off: wings beating hard, hanging in the air, cawing, tail fanned; then lands.
      const air = plateau(t, 0.1, 0.9, 0.14);
      const beat = Math.sin(t * TAU * 9);
      o.squash = keys(t, C_SQUASH);
      o.lift = keys(t, C_LIFT) + 0.05 * beat * air; // bobbing on each beat
      o.wing = lerp(0.2, 1.5 + 0.85 * beat, air);
      o.sweep = lerp(0, -0.1 + 0.2 * beat, air);
      o.pitch = -0.12 * air;
      o.tuck = air;
      o.tail = 0.5 * air;
      o.fan = air;
      o.headPitch = -0.25 * air;
      o.jaw = air * Math.max(0, Math.sin(t * TAU * 3.5)); // caw, caw, caw
      o.upper = lerp(UP0, 0, air);
      o.gazePitch = lerp(GAZE0, 0.25, air);
    } else if (reaction === 'fumble') {
      // It hides: the left wing comes up and over, the head turns and tucks under it, the body
      // sinks and the tail droops. One eye peeks out, then shuts again. It holds there.
      const hide = smooth(span(t, 0.12, 0.5));
      const peek = bump(t, 0.68, 0.86);
      o.squash = 0.14 * hide;
      o.puff = 0.06 * hide;
      o.roll = 0.08 * hide;
      o.headYaw = 1.2 * outBack(span(t, 0.16, 0.5), 1.2);
      o.headPitch = 0.5 * hide;
      o.headRoll = -0.25 * hide;
      o.wingL = 0.95 * smooth(span(t, 0.04, 0.38));
      o.sweepL = 0.95 * smooth(span(t, 0.1, 0.45));
      o.wing = lerp(0.2, 0.1, hide);
      o.tail = -0.3 * hide;
      o.upper = lerp(UP0, 0.95, hide) - 0.55 * peek;
      o.lower = lerp(LO0, 0.5, hide) - 0.3 * peek;
      o.sad = 0.4 * hide;
      o.gazeYaw = -0.5 * peek;
      o.gazePitch = lerp(GAZE0, -0.3, hide);
    } else if (reaction === 'mixed') {
      // Quizzical: the head cocks sharply one way, a beat, then the other; one eye narrowed, the
      // tail giving a flick.
      const tilt = keys(t, M_TILT);
      o.headRoll = 0.5 * tilt;
      o.headYaw = -0.2 * tilt;
      o.roll = 0.05 * tilt;
      o.upperR = 0.4 * Math.abs(tilt);
      o.sadL = 0.3 * Math.abs(tilt);
      o.tail = 0.3 * bump(t, 0.42, 0.6);
      o.jaw = 0.25 * bump(t, 0.2, 0.4);
    } else {
      // Pleased: a little bob, a soft caw, eyes half shut, the wings giving a shrug.
      o.squash = 0.1 * bump(t, 0.08, 0.3) + 0.08 * bump(t, 0.32, 0.52);
      o.headPitch = 0.22 * bump(t, 0.1, 0.34) - 0.15 * bump(t, 0.36, 0.62);
      o.jaw = 0.6 * bump(t, 0.38, 0.62);
      o.wing = 0.2 + 0.3 * bump(t, 0.15, 0.6);
      o.tail = 0.3 * bump(t, 0.3, 0.7);
      const content = plateau(t, 0.08, 0.92, 0.12);
      o.upper = lerp(UP0, 0.5, content);
      o.lower = lerp(LO0, 0.4, content);
      o.puff = 0.04 * content;
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  function idle(o, ms, amount = 1) {
    const s = Math.sin((ms / 2600) * TAU);
    o.squash += 0.014 * s * amount; // slow breathing
    o.puff += 0.01 * s * amount;
    o.wing += 0.03 * Math.sin((ms / 2600) * TAU + 1.3) * amount; // wings settling
    o.tail += 0.05 * Math.sin((ms / 1900) * TAU) * amount;
    // Every ~5 s, a quick, sharp cock of the head, alternating sides: a bird sizing things up.
    const cycle = ms / 5200;
    const q = cycle - Math.floor(cycle);
    const side = Math.floor(cycle) % 2 ? 1 : -1;
    const tilt = plateau(q, 0.6, 0.86, 0.04) * amount;
    o.headRoll += 0.36 * side * tilt;
    o.headYaw += 0.14 * side * tilt;
    // A quick blink now and then.
    const sq = ((ms + 900) % 4300) / 4300;
    const b = bump(sq, 0.94, 0.985);
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
      // It flaps in and lands with a little squash, tail fanned to brake.
      PK.reset(p);
      p.squash = -0.08 * bump(t, 0.05, 0.75) + 0.16 * bump(t, 0.75, 1);
      p.wing = 0.2 + 1.3 * bump(t, 0, 0.85) * (0.5 + 0.5 * Math.sin(t * TAU * 3));
      p.tuck = bump(t, 0, 0.8);
      p.fan = bump(t, 0.3, 0.95);
      p.tail = 0.3 * bump(t, 0.3, 0.95);
    } else if (phase === 'move') {
      // A dodge: it flies (the layer lifts it in an arc). A crouch, then wings beating, body
      // tipped forward, legs tucked, tail fanned; a soft landing. It starts and ends on the
      // standing pose (exit at t 1).
      PK.reset(p);
      const fly = plateau(t, 0.04, 0.96, 0.14);
      const beat = Math.sin(t * TAU * FLY_BEATS);
      p.squash = 0.14 * bump(t, 0, 0.14) - 0.05 * fly + 0.14 * bump(t, 0.84, 1);
      p.lift = (0.26 + 0.06 * Math.sin(t * TAU * FLY_BEATS + 1.4)) * fly; // bobs with each beat
      p.pitch = 0.16 * fly;
      p.headPitch = -0.12 * fly;
      p.wing = lerp(0.2, 1.5 + 0.85 * beat, fly);
      p.sweep = lerp(0, -0.1 + 0.2 * beat, fly);
      p.tuck = fly;
      p.tail = 0.35 * fly;
      p.fan = fly;
      p.upper = lerp(UP0, 0, fly);
      p.gazePitch = lerp(GAZE0, 0, fly);
    } else if (phase === 'pet') {
      // Petted: feathers fluff, eyes shut in bliss, the head pushing up and rolling side to side
      // under the hand (look.calm, reduced motion: a smaller wiggle). From and back to standing.
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.headRoll = 0.35 * k * Math.sin(t * TAU * 2) * on;
      p.headPitch = -0.15 * on;
      p.roll = 0.06 * k * Math.sin(t * TAU * 2 + 0.6) * on;
      p.puff = 0.08 * on;
      p.wing = lerp(0.2, 0.32 + 0.12 * k * Math.sin(t * TAU * 4), on);
      p.tail = 0.25 * k * Math.sin(t * TAU * 4) * on;
      p.squash = 0.04 * k * Math.sin(t * TAU * 4) * on;
      p.upper = lerp(UP0, 0.8, on);
      p.lower = lerp(LO0, 0.5, on);
    } else if (phase === 'huff') {
      // Huffed: hackles and feathers bristle, it turns its head sharply away, eyes narrowed, and
      // gives one curt caw.
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.puff = 0.12 * mad + 0.05 * k * bump(t, 0.3, 0.6);
      p.squash = -0.05 * mad;
      p.headYaw = -0.95 * mad;
      p.headPitch = -0.14 * mad;
      p.wing = lerp(0.2, 0.5, mad);
      p.tail = 0.35 * mad;
      p.jaw = 0.7 * k * bump(t, 0.3, 0.5);
      p.upper = lerp(UP0, 0.55, mad);
      p.sad = -0.3 * mad;
      p.gazeYaw = -0.4 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop back, then it fans itself furiously with both wings, beak
      // open, panting (look.calm: slower, smaller beats).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.25 * k * bump(t, 0.02, 0.28);
      p.wing = lerp(0.2, 1.0 + 0.45 * k * Math.sin(t * TAU * (look?.calm ? 3 : 6)), on);
      p.sweep = lerp(0, 0.5, on);
      p.headPitch = -0.2 * on;
      p.jaw = (0.5 + 0.2 * Math.sin(t * TAU * 8)) * on;
      p.tail = 0.3 * on;
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
      p.sweep = lerp(0, 0.6, on);
      p.headPitch = 0.18 * on;
      p.squash = 0.08 * on;
      p.tail = -0.2 * on;
      p.jaw = 0.15 * k * Math.max(0, Math.sin(t * TAU * f * 0.7)) * on; // the beak chattering
      p.upper = lerp(UP0, 0.7, on);
      p.lower = lerp(LO0, 0.3, on);
    } else if (phase === 'bristle') {
      // Zapped (storm): standing tall and thin, wings half out, tail fanned straight up, eyes
      // huge, beak agape, trembling (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.12 * on;
      p.puff = -0.04 * on;
      p.wing = lerp(0.2, 0.9, on);
      p.tail = 0.8 * on;
      p.fan = on;
      p.jaw = 0.5 * on;
      p.roll = 0.04 * k * Math.sin(t * TAU * 10) * on;
      p.headPitch = -0.1 * on;
      p.upper = lerp(UP0, 0, on);
    } else if (phase === 'startle') {
      // Startled (any other element): a crouch, a jump with wings flung out and legs tucked, a
      // squawk, eyes wide, and a landing (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      const air = span(t, 0.1, 0.5);
      p.lift = 0.55 * k * Math.sin(Math.PI * air);
      p.squash = 0.14 * bump(t, 0, 0.12) - 0.1 * k * bump(t, 0.1, 0.5) + 0.14 * k * bump(t, 0.48, 0.66);
      p.tuck = bump(t, 0.12, 0.5);
      p.puff = 0.08 * bump(t, 0.08, 0.7);
      p.wing = 0.2 + 1.4 * bump(t, 0.08, 0.6);
      p.tail = 0.5 * bump(t, 0.05, 0.6);
      p.fan = bump(t, 0.05, 0.7);
      p.jaw = 0.9 * bump(t, 0.04, 0.45);
      p.upper = lerp(UP0, 0, wide);
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy hops with wings flapping and a caw on each
      // (look.calm: one small hop, gentle wingbeats). From and back to standing.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      const air1 = bump(t, 0.12, 0.42);
      const air2 = two * bump(t, 0.52, 0.82);
      p.lift = 0.35 * k * (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash =
        k * (0.12 * bump(t, 0.02, 0.14) - 0.08 * air1 + 0.12 * bump(t, 0.42, 0.54)) +
        two * (0.1 * bump(t, 0.82, 0.95) - 0.08 * air2);
      p.tuck = k * (air1 + air2);
      p.wing = 0.2 + joy * (0.5 + (calm ? 0.15 : 0.7) * Math.sin(t * TAU * (calm ? 3 : 7)));
      p.headRoll = (calm ? 0.1 : 0.25) * Math.sin(t * TAU * 3) * joy;
      p.jaw = 0.8 * (air1 + air2);
      p.tail = 0.4 * joy;
      p.fan = joy;
      p.upper = lerp(UP0, 0.45, joy);
      p.lower = lerp(LO0, 0.45, joy);
      p.gazePitch = lerp(GAZE0, 0.2, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: standing tall, chest out, beak in the air, tail cocked,
      // knowing half-lidded eyes. Sulk: hunched, beak on its chest, wings and tail drooping.
      PK.reset(end);
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.pitch = -0.1;
        tmp.squash = -0.08;
        tmp.puff = 0.06;
        tmp.headPitch = -0.26;
        tmp.tail = 0.4;
        tmp.wing = 0.12;
        tmp.sweep = -0.2;
        tmp.upper = 0.45;
        tmp.lower = 0.25;
        tmp.gazePitch = 0;
      } else {
        tmp.headPitch = 0.55;
        tmp.pitch = 0.08;
        tmp.squash = 0.18;
        tmp.puff = -0.03;
        tmp.wing = 0;
        tmp.sweep = -0.2;
        tmp.tail = -0.35;
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
      p.jaw = keys(t, T_JAW);
      p.tail = 0.4 * bump(t, 0.25, 0.8);
      p.upper = lerp(UP0, 0.4, bump(t, 0.1, 0.5));
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.headYaw += yaw * 0.7; // a bird turns its head, hardly its eyes
      p.gazeYaw += yaw * 0.4;
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
    jaw.rotation.x = 0.5 * Math.max(0, o.jaw);
    upperBeak.rotation.x = beakDir - 0.14 * Math.max(0, o.jaw);
    tail.rotation.x = TAIL0 + o.tail;
    tail.scale.x = 1 + 0.6 * o.fan;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const f = feet[i];
      f.position.y = 0.2 * o.tuck; // the legs pull up into the belly feathers
      f.rotation.x = -o.pitch * (1 - o.tuck);
      f.rotation.z = -o.roll * (1 - o.tuck);
      const w = wings[i];
      // (never folded in past snug: that would push the wing into the body)
      const spread = Math.max(-0.03, o.wing - WING0 + (side > 0 ? o.wingL : 0));
      w.rotation.set(0, -side * (o.sweep + (side > 0 ? o.sweepL : 0)), side * spread);
      eyes[i].set(
        o.gazeYaw,
        o.gazePitch,
        o.upper + (side === -1 ? o.upperR : 0),
        o.lower,
        o.sad + (side === 1 ? o.sadL : 0),
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

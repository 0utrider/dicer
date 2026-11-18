import * as THREE from 'three';
import {
  TAU,
  INK,
  bump,
  keys,
  lerp,
  outBack,
  plateau,
  smooth,
  span,
  wobble,
  nowMs,
  paint,
  palette,
  poseKit,
  createKit,
  createEye,
  detailMaterial,
} from './parts.js';

/**
 * The frog: a squat, wide frog with a light belly and throat, two big bulging eyes on top of its
 * head, a wide smug smile, a throat pouch that puffs, folded hind legs and little front feet with
 * round toe pads. From above: a rounded wedge with two eye bumps, three light spots on its back
 * and its toes peeking out. Bouncy and smug.
 * Crit: a big croak (the pouch balloons), a high leap with its legs kicked out and a tongue flick;
 * fumble: it flattens like a pancake, eyes sinking and drooping, the pouch sagging; mixed: one eye
 * squints and the head shrugs sideways; plain: a contented croak.
 */

const HEIGHT = 1.5;
const FOOT = 0.96; // top-down body radius in scene units, legs excluded (measured from the built geometry)
const EYE_R = 0.18;
// The body (design units, scaled to HEIGHT at build).
const RX = 0.52; // half width
const RZ = 0.46; // half depth
const SKIRT = 0.14; // height of the rounded skirt below the dome
const TOPY = 0.58; // top of the back
const PIVOT = new THREE.Vector3(0, 0.3, 0.05); // the face turns about this (head shrug, nod)
const POUCH_R = 0.15;

/** A frog body: flat base with a rounded skirt, a broad low dome, wider toward the front. */
function frogBody(geo) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); // unit sphere
    const s = Math.max(-1, Math.min(1, v.y));
    const c = Math.sqrt(1 - s * s);
    const len = Math.hypot(v.x, v.z) || 1;
    const dx = v.x / len;
    const dz = v.z / len;
    let rr;
    let y;
    if (s < 0) {
      rr = c ** 0.3;
      y = SKIRT * (1 + s) ** 1.6;
    } else {
      rr = c ** 0.7 * (1 - 0.1 * s);
      y = SKIRT + (TOPY - SKIRT) * s ** 0.8 - 0.05 * Math.max(0, dz) * s; // the snout dips a little
    }
    p.setXYZ(i, dx * rr * RX * (1 + 0.08 * dz), y, dz * rr * RZ);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Bends a flat face piece (in its local XY, facing +Z) around the snout: z drops with x^2. */
function wrap(geo, k) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - k * p.getX(i) ** 2);
  geo.computeVertexNormals();
  return geo;
}

const REST = {
  lift: 0,
  squash: 0, // > 0 flatter, < 0 taller
  pitch: 0, // + nose down
  roll: 0,
  spin: 0,
  yaw: 0,
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  kick: 0, // hind legs kicked out behind 0..1
  reach: 0, // front feet reaching forward 0..1
  pouch: 0, // throat pouch: -1 sagging .. 0 .. 1 ballooned
  tongue: 0, // tongue out 0..1
  eyeUp: 0, // eyes rise (+) out of / sink (-) into the head
  upper: 0.22,
  lower: 0.1,
  upperR: 0,
  sad: 0,
  sadL: 0,
  gazeYaw: 0,
  gazePitch: -0.3,
  smile: 0.7, // -1 frown .. 0 flat .. 1 grin
  open: 0, // mouth open 0..1
};
const PK = poseKit(REST);
const STAND_UPPER = 0.12; // the standing pose's lids (exit at t 1)

// Keyframes, hoisted so a pose allocates nothing.
// The dodge: two hops, airborne over t 0.1-0.4 and 0.6-0.9 (the layer moves it across then). A
// crouch, a stretch on the spring, legs kicked out behind in the air and folding for the landing,
// which is the next crouch; the last landing rings out.
const MOVE_SQUASH = [
  0, 0, 0.06, 0.28, 0.11, -0.2, 0.25, -0.05, 0.38, 0, 0.45, 0.3, 0.55, 0.26, 0.61, -0.2, 0.75,
  -0.05, 0.88, 0, 0.94, 0.28, 0.985, -0.04, 1, 0,
];
const MOVE_KICK = [0, 0, 0.07, 0, 0.13, 1, 0.28, 0.75, 0.39, 0, 0.57, 0, 0.63, 1, 0.78, 0.75, 0.89, 0, 1, 0];
const MOVE_PITCH = [
  0, 0, 0.06, 0.08, 0.13, -0.28, 0.28, 0.05, 0.4, 0.14, 0.5, 0.06, 0.63, -0.24, 0.78, 0.05, 0.9,
  0.12, 1, 0,
];
const CRIT_POUCH = [0, 0, 0.09, 1.1, 0.17, 0.75, 0.26, 1.1, 0.36, 0];
const CRIT_SQUASH = [
  0, 0, 0.1, -0.06, 0.26, -0.06, 0.37, 0.3, 0.42, -0.26, 0.6, -0.08, 0.73, 0, 0.78, 0.32, 0.86, -0.08,
  0.93, 0.04, 1, 0,
];
const CRIT_KICK = [0, 0, 0.38, 0, 0.43, 1, 0.62, 0.85, 0.74, 0];
const CRIT_TONGUE = [0, 0, 0.46, 0, 0.51, 1, 0.56, 1, 0.62, 0];
const PLAIN_POUCH = [0, 0, 0.1, 0, 0.24, 0.7, 0.36, 0.15, 0.5, 0.65, 0.66, 0];
const PLAIN_SQUASH = [0, 0, 0.1, 0.12, 0.2, -0.1, 0.32, 0.04, 0.45, -0.02, 0.6, 0];
const MIXED_GAZE = [0.2, 0, 0.32, -1, 0.5, -1, 0.6, 1, 0.78, 1, 0.9, 0];
const THROW_PITCH = [0, 0, 0.3, -0.22, 0.5, 0.2, 0.75, 0.05, 1, 0];
const THROW_SQUASH = [0, 0, 0.3, 0.2, 0.5, -0.12, 0.75, 0.05, 1, 0];
const THROW_TONGUE = [0, 0, 0.38, 0, 0.48, 1, 0.58, 1, 0.72, 0];
const THROW_REACH = [0, 0, 0.3, 0.1, 0.5, 0.8, 0.8, 0.2, 1, 0];

/** A slow blink: a gentle shut every ~4.6 s (longer than the shared quick one). */
const slowBlink = (ms) => bump(((ms + 1700) % 4600) / 4600, 0.86, 0.97);

export function frog(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.35, metalness: 0 }),
  );
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4, metalness: 0 }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'frog';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const squash = new THREE.Group(); // squash/stretch about the floor
  rig.add(squash);

  const blob = kit.mesh(frogBody(new THREE.SphereGeometry(1, 20, 12)), body, squash);
  const belly = kit.mesh(new THREE.SphereGeometry(1, 10, 6), accent, squash, 0, 0.16, 0.13);
  belly.scale.set(0.4, 0.15, 0.36);

  // Surface probes (build time only): where the face, spots and nostrils sit on the body.
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const back = new THREE.Vector3(0, 0, -1);
  const hit = (origin, dir) => {
    ray.set(origin, dir);
    return ray.intersectObject(blob, false)[0];
  };
  const topAt = (x, z) => hit(new THREE.Vector3(x, 2, z), down);
  const frontAt = (x, y) => hit(new THREE.Vector3(x, y, 2), back).point.z;

  // Three light spots on the back, flat on the skin.
  const spotGeo = kit.geo(new THREE.SphereGeometry(0.07, 7, 3));
  const up = new THREE.Vector3(0, 1, 0);
  for (const [x, z, s] of [
    [0.13, -0.2, 1],
    [-0.17, -0.1, 0.8],
    [0.02, -0.02, 0.65],
  ]) {
    const h = topAt(x, z);
    const spot = new THREE.Mesh(spotGeo, accent);
    spot.position.copy(h.point);
    spot.quaternion.setFromUnitVectors(up, h.face.normal);
    spot.scale.set(s, 0.28, s * 0.9);
    squash.add(spot);
  }

  // Hind legs: a fat folded thigh at each side and a long webbed foot pointing forward, toes on
  // round pads. kick swings the foot out behind (a jump).
  const thighGeo = kit.geo(new THREE.SphereGeometry(1, 8, 6));
  const footGeo = kit.geo(new THREE.SphereGeometry(1, 7, 4));
  const padGeo = kit.geo(new THREE.SphereGeometry(0.035, 5, 3));
  const hinds = []; // flat, per leg: thigh, foot group, side
  for (const sx of [1, -1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.4, 0.16, -0.14);
    squash.add(hip);
    const thigh = new THREE.Mesh(thighGeo, body);
    thigh.scale.set(0.16, 0.15, 0.26);
    thigh.rotation.y = sx * 0.35;
    hip.add(thigh);
    const foot = new THREE.Group();
    hip.add(foot);
    const sole = new THREE.Mesh(footGeo, body);
    sole.scale.set(0.09, 0.03, 0.17);
    sole.rotation.y = sx * 0.3;
    foot.add(sole);
    for (const a of [-0.45, 0, 0.45]) {
      const pad = new THREE.Mesh(padGeo, accent);
      pad.position.set(Math.sin(a + sx * 0.3) * 0.17, -0.004, Math.cos(a + sx * 0.3) * 0.17);
      pad.scale.set(1, 0.6, 1);
      foot.add(pad);
    }
    hinds.push(thigh, foot, sx);
  }
  // Front legs: short arms with a little foot and three round toe pads peeking out in front.
  const armGeo = kit.geo(
    new THREE.CylinderGeometry(0.045, 0.05, 0.13, 6, 1).translate(0, -0.065, 0).rotateX(-0.25),
  );
  const arms = [];
  for (const sx of [1, -1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.26, 0.15, 0.3);
    squash.add(arm);
    arm.add(new THREE.Mesh(armGeo, body));
    const sole = new THREE.Mesh(footGeo, body);
    sole.position.set(0, -0.125, 0.06);
    sole.scale.set(0.07, 0.025, 0.08);
    arm.add(sole);
    for (const a of [-0.6, 0, 0.6]) {
      const pad = new THREE.Mesh(padGeo, accent);
      pad.position.set(Math.sin(a + sx * 0.15) * 0.085, -0.126, 0.06 + Math.cos(a + sx * 0.15) * 0.085);
      pad.scale.set(0.85, 0.55, 0.85);
      arm.add(pad);
    }
    arms.push(arm);
  }

  // The face rides the body but is not squashed itself: placed from the squash each frame, about
  // a pivot inside the head (so the head can shrug and nod).
  const face = new THREE.Group();
  face.rotation.order = 'YXZ';
  rig.add(face);
  const homes = []; // flat: object, home x, y, z (relative to the pivot)
  const place = (o, x, y, z) => {
    face.add(o);
    homes.push(o, x - PIVOT.x, y - PIVOT.y, z - PIVOT.z);
    return o;
  };
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lid: body, ring: false });
    e.socket.rotation.order = 'YXZ';
    e.socket.rotation.set(-0.6, side * 0.4, 0);
    // The bulge the eye sits in: a body-coloured mound behind and below the ball.
    const mound = kit.mesh(new THREE.SphereGeometry(EYE_R * 1.08, 9, 5), body, e.socket, 0, -0.07, -0.07);
    mound.scale.set(1, 0.95, 1);
    const top = topAt(side * 0.23, 0.15).point.y;
    place(e.socket, side * 0.23, top + 0.09, 0.15);
    return e;
  });
  // Nostrils: two dots on top of the snout.
  const nostrilGeo = kit.geo(paint(new THREE.SphereGeometry(0.02, 5, 3), INK.pupil));
  for (const sx of [1, -1]) {
    const h = topAt(sx * 0.07, 0.36).point;
    const n = new THREE.Mesh(nostrilGeo, detail);
    n.scale.set(1, 0.5, 1);
    place(n, h.x, h.y, h.z);
  }
  // Mouth: a wide smile arc wrapped round the snout, an open mouth (a dark half-disc) with a long
  // pink tongue that flicks out.
  const mouthG = new THREE.Group();
  mouthG.rotation.x = -0.35;
  place(mouthG, 0, 0.33, frontAt(0, 0.33) + 0.004);
  const smile = kit.mesh(
    wrap(paint(new THREE.TorusGeometry(0.24, 0.02, 5, 12, Math.PI), INK.mouth), 1.0),
    detail,
    mouthG,
  );
  const mouth = kit.mesh(
    wrap(paint(new THREE.CircleGeometry(0.17, 14, Math.PI, Math.PI), INK.mouth), 1.0),
    detail,
    mouthG,
  );
  mouth.position.z = 0.002;
  const tongueG = new THREE.Group();
  tongueG.position.set(0, -0.04, 0.008);
  tongueG.rotation.x = 0.3; // straight out forward
  mouthG.add(tongueG);
  const tongue = kit.mesh(
    paint(new THREE.CylinderGeometry(0.035, 0.04, 1, 6, 1).translate(0, 0.5, 0).rotateX(Math.PI / 2), INK.tongue),
    detail,
    tongueG,
  );
  const tip = kit.mesh(paint(new THREE.SphereGeometry(0.06, 6, 4), INK.tongue), detail, tongueG);
  tip.scale.set(1.2, 0.7, 1);
  // The throat pouch: a light bubble under the chin.
  const pouch = place(
    kit.mesh(new THREE.SphereGeometry(POUCH_R, 10, 7), accent, face),
    0,
    0.15,
    frontAt(0, 0.15) - 0.075,
  );

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // A big croak (the pouch balloons twice), a crouch and a high leap, legs kicked out, a
      // tongue flick at the top, and a squashy landing.
      o.pouch = keys(t, CRIT_POUCH);
      o.squash = keys(t, CRIT_SQUASH);
      o.lift = Math.sin(Math.PI * span(t, 0.41, 0.76)) * 1.0;
      o.kick = keys(t, CRIT_KICK);
      o.reach = 0.6 * bump(t, 0.6, 0.82);
      o.pitch = -0.3 * bump(t, 0.37, 0.56) + 0.12 * bump(t, 0.6, 0.8);
      o.tongue = keys(t, CRIT_TONGUE);
      o.open = o.tongue;
      const joy = plateau(t, 0.06, 0.95, 0.08);
      o.headPitch = -0.15 * joy;
      o.upper = lerp(0.22, 0, joy);
      o.lower = lerp(0.1, 0.45, joy);
      o.gazePitch = lerp(-0.3, 0.3, joy);
      o.smile = lerp(0.7, 1, joy);
      o.eyeUp = 0.04 * joy;
    } else if (reaction === 'fumble') {
      // A pancake: it flattens out, eyes sinking and drooping, the pouch sagging; a sad wobble.
      const flat = smooth(span(t, 0.04, 0.5));
      o.squash = 0.55 * flat + 0.03 * wobble(span(t, 0.5, 1), 1.5, 3) * flat;
      o.eyeUp = -0.04 * flat;
      o.pouch = -0.9 * flat;
      o.reach = -0.4 * flat; // the front feet splay out back
      o.headPitch = 0.12 * flat;
      o.upper = lerp(0.22, 0.62, flat);
      o.lower = lerp(0.1, 0.02, flat);
      o.sad = 0.5 * flat;
      o.gazePitch = lerp(-0.3, -0.8, flat);
      o.smile = lerp(0.7, -1, smooth(span(t, 0.02, 0.3)));
    } else if (reaction === 'mixed') {
      // One eye squints and the head shrugs to one side and back, the gaze darting.
      const tilt = outBack(span(t, 0.04, 0.3), 2.2) * (1 - smooth(span(t, 0.82, 1)));
      o.headRoll = 0.38 * tilt + 0.06 * Math.sin(t * TAU * 2.5) * tilt;
      o.headYaw = -0.12 * tilt;
      o.roll = 0.07 * tilt;
      o.reach = 0.25 * tilt; // a little shrug of the front feet
      o.upperR = 0.45 * tilt;
      o.sadL = 0.45 * tilt;
      o.upper = lerp(0.22, 0.06, tilt);
      o.gazeYaw = 0.45 * keys(t, MIXED_GAZE);
      o.smile = lerp(0.7, 0, tilt);
    } else {
      // plain: a contented croak, eyes smugly half shut.
      o.pouch = keys(t, PLAIN_POUCH);
      o.squash = keys(t, PLAIN_SQUASH);
      o.headPitch = -0.1 * bump(t, 0.15, 0.7);
      const content = plateau(t, 0.08, 0.92, 0.12);
      o.upper = lerp(0.22, 0.5, content);
      o.lower = lerp(0.1, 0.34, content);
      o.smile = lerp(0.7, 1, content);
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  function idle(o, ms, amount = 1) {
    // The throat pulses (a quick swell, a slow ebb), the body breathes, slow blinks.
    const th = 0.5 + 0.5 * Math.sin((ms / 1100) * TAU);
    o.pouch += 0.28 * th * th * amount;
    o.squash += 0.02 * Math.sin((ms / 2200) * TAU) * amount;
    o.headPitch += 0.02 * Math.sin((ms / 2200) * TAU + 1) * amount;
    const b = slowBlink(ms);
    o.upper += (1 - o.upper) * b;
    o.lower += (0.5 - o.lower) * b;
  }

  function pose(phase, t, reaction, look) {
    const ms = look?.now ?? nowMs();
    const yaw = look?.yaw || 0;
    if (phase === 'react') react(p, reaction, t, ms);
    else if (phase === 'exit') {
      // A hop away: crouch, spring with the legs kicked out, land.
      react(end, reaction, 1);
      PK.reset(tmp);
      tmp.squash = 0.25 * bump(t, 0, 0.22) - 0.15 * bump(t, 0.2, 0.8) + 0.25 * bump(t, 0.82, 1);
      tmp.kick = bump(t, 0.18, 0.78);
      tmp.upper = STAND_UPPER;
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      PK.reset(p);
      p.squash = -0.15 * bump(t, 0.05, 0.72) + 0.3 * bump(t, 0.7, 1);
      p.kick = bump(t, 0.05, 0.7);
      p.reach = 0.5 * bump(t, 0.5, 0.85);
      p.upper = 0.05;
      p.lower = 0.05;
      p.smile = 1;
    } else if (phase === 'move') {
      // A dodge: hop, hop. A crouch and a spring, legs kicked out behind and folding back for the
      // landing, front feet reaching for the ground; a smug grin and bright eyes. It starts and
      // ends on the standing pose (exit at t 1).
      PK.reset(p);
      p.upper = STAND_UPPER;
      const joy = plateau(t, 0.03, 0.97, 0.1);
      p.squash = keys(t, MOVE_SQUASH);
      p.kick = keys(t, MOVE_KICK);
      p.pitch = keys(t, MOVE_PITCH);
      p.reach = 0.6 * bump(t, 0.24, 0.44) + 0.6 * bump(t, 0.74, 0.94);
      p.lift = 0.6 * Math.sin(Math.PI * span(t, 0.1, 0.4)) + 0.5 * Math.sin(Math.PI * span(t, 0.6, 0.9));
      p.upper = lerp(STAND_UPPER, 0.02, joy);
      p.lower = lerp(0.1, 0.3, joy);
      p.gazePitch = lerp(-0.3, -0.05, joy);
      p.smile = lerp(0.7, 1, joy);
    } else if (phase === 'pet') {
      // Petted: a happy wiggle, eyes squeezed shut, a smug grin and a pleased puff of the throat
      // (look.calm, reduced motion: a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      p.upper = STAND_UPPER;
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.roll = 0.14 * k * Math.sin(t * TAU * 2) * on;
      p.headRoll = 0.18 * k * Math.sin(t * TAU * 2 - 0.8) * on;
      p.squash = 0.08 * k * Math.sin(t * TAU * 3) * on;
      p.pouch = 0.6 * on;
      p.upper = lerp(STAND_UPPER, 0.72, on);
      p.lower = lerp(0.1, 0.45, on);
      p.smile = lerp(0.7, 1, on);
    } else if (phase === 'huff') {
      // Huffed: the pouch balloons up, then it blows out, frowning, eyes narrowed and away.
      PK.reset(p);
      p.upper = STAND_UPPER;
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.pouch = 1.1 * k * bump(t, 0.05, 0.55);
      p.squash = (-0.12 * bump(t, 0.05, 0.5) + 0.12 * bump(t, 0.45, 0.75)) * k;
      p.headYaw = 0.4 * mad;
      p.upper = lerp(STAND_UPPER, 0.55, mad);
      p.smile = lerp(0.7, -0.6, mad);
      p.gazeYaw = 0.6 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop back off the heat, then it pants, mouth open and tongue
      // lolling, fanning itself with its front feet, eyes squinting (look.calm: gentler).
      PK.reset(p);
      p.upper = STAND_UPPER;
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.3 * k * bump(t, 0.02, 0.28);
      p.kick = 0.8 * k * bump(t, 0.02, 0.28);
      p.reach = on * (0.5 + 0.4 * k * Math.sin(t * TAU * 5));
      p.squash = 0.05 * k * Math.sin(t * TAU * 6) * on;
      p.pouch = on * (0.3 + 0.3 * Math.sin(t * TAU * 6));
      p.upper = lerp(STAND_UPPER, 0.6, on);
      p.lower = lerp(0.1, 0.3, on);
      p.smile = lerp(0.7, -0.3, on);
      p.open = on * (0.65 + 0.3 * Math.sin(t * TAU * 6));
      p.tongue = 0.25 * on;
    } else if (phase === 'shiver') {
      // Frozen (frost): it hunches low, eyes pulled in and squeezed, shivering side to side
      // (look.calm: a slower, smaller shiver).
      PK.reset(p);
      p.upper = STAND_UPPER;
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.squash = 0.14 * on;
      p.eyeUp = -0.04 * on;
      p.roll = 0.08 * k * Math.sin(t * TAU * f) * on;
      p.headRoll = 0.05 * k * Math.sin(t * TAU * f + 1) * on;
      p.pouch = -0.3 * on;
      p.upper = lerp(STAND_UPPER, 0.55, on);
      p.lower = lerp(0.1, 0.3, on);
      p.smile = lerp(0.7, -0.5, on);
    } else if (phase === 'bristle') {
      // Zapped (storm): it shoots up tall on its feet and trembles, eyes popping, pouch puffed
      // (look.calm: no tremble).
      PK.reset(p);
      p.upper = STAND_UPPER;
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.25 * on + 0.05 * k * Math.sin(t * TAU * 10) * on;
      p.eyeUp = 0.06 * on;
      p.pouch = 0.5 * on;
      p.upper = lerp(STAND_UPPER, 0, on);
      p.lower = lerp(0.1, 0, on);
      p.gazePitch = lerp(-0.3, 0, on);
      p.smile = lerp(0.7, 0, on);
      p.open = 0.55 * on;
    } else if (phase === 'startle') {
      // Startled (any other element): a crouch, a jump straight up with its legs kicked out, eyes
      // wide, and a squashy landing (look.calm: a smaller jump).
      PK.reset(p);
      p.upper = STAND_UPPER;
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      p.lift = 0.7 * k * Math.sin(Math.PI * span(t, 0.1, 0.5));
      p.kick = k * bump(t, 0.1, 0.5);
      p.squash = 0.22 * bump(t, 0, 0.12) - 0.2 * k * bump(t, 0.1, 0.5) + 0.22 * k * bump(t, 0.48, 0.66);
      p.eyeUp = 0.05 * wide;
      p.upper = lerp(STAND_UPPER, 0, wide);
      p.lower = lerp(0.1, 0, wide);
      p.gazePitch = lerp(-0.3, 0.1, wide);
      p.smile = lerp(0.7, 0, wide);
      p.open = 0.5 * wide;
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy hops, legs kicking, a croak on each landing,
      // a big grin and smiling eyes looking up (look.calm: one small hop). From and back to the
      // standing pose.
      PK.reset(p);
      p.upper = STAND_UPPER;
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      const air1 = bump(t, 0.12, 0.42);
      const air2 = two * bump(t, 0.52, 0.82);
      p.lift = 0.45 * k * (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash =
        k * (0.18 * bump(t, 0.02, 0.14) - 0.15 * air1 + 0.18 * bump(t, 0.42, 0.54)) +
        two * (0.15 * bump(t, 0.82, 0.95) - 0.15 * air2);
      p.kick = k * (air1 + air2);
      p.pouch = 0.8 * (bump(t, 0.4, 0.58) + two * bump(t, 0.8, 0.98));
      p.upper = lerp(STAND_UPPER, 0, joy);
      p.lower = lerp(p.lower, 0.45, joy);
      p.gazePitch = lerp(p.gazePitch, 0.3, joy);
      p.smile = lerp(p.smile, 1, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: chest out, chin up, throat puffed, a smug grin under
      // half-lidded eyes. Sulk: flattened low, eyes sunk and looking down, pouch sagging, frowning.
      PK.reset(end);
      end.upper = STAND_UPPER;
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.pitch = -0.12;
        tmp.squash = -0.08;
        tmp.headPitch = -0.15;
        tmp.pouch = 0.55;
        tmp.smile = 1;
        tmp.upper = 0.45;
        tmp.lower = 0.3;
        tmp.gazePitch = 0.1;
      } else {
        tmp.squash = 0.35;
        tmp.headPitch = 0.12;
        tmp.eyeUp = -0.05;
        tmp.pouch = -0.6;
        tmp.smile = -0.8;
        tmp.upper = 0.6;
        tmp.lower = 0.02;
        tmp.sad = 0.5;
        tmp.gazePitch = -0.8;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.pouch += 0.4 * bump(t, 0.2, 0.8); // a croak on the way
    } else if (phase === 'throw') {
      // It rears back, then lunges with its front feet and flicks the die off with its tongue.
      PK.reset(p);
      p.pitch = keys(t, THROW_PITCH);
      p.squash = keys(t, THROW_SQUASH);
      p.reach = keys(t, THROW_REACH);
      p.tongue = keys(t, THROW_TONGUE);
      p.open = p.tongue;
      p.upper = 0.12;
      p.gazePitch = -0.15;
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.gazeYaw += yaw * 0.9;
      p.headYaw += yaw * 0.3;
      p.yaw += yaw * 0.3;
    }
    apply(p);
  }

  function apply(o) {
    // Tipping pivots on an edge (front, back or side), not through the floor.
    rig.position.y = o.lift + 0.5 * Math.abs(Math.sin(o.pitch)) + 0.7 * Math.abs(Math.sin(o.roll));
    // + 0 turns a -0 (a negative weight times a zero bump) into 0: the standing pose compares equal.
    rig.rotation.set(o.pitch + 0, o.spin + o.yaw, o.roll + 0);
    const sy = Math.max(0.3, 1 - o.squash);
    const sxz = 1 / Math.sqrt(sy);
    squash.scale.set(sxz, sy, sxz);
    face.position.set(PIVOT.x, PIVOT.y * sy, PIVOT.z * sxz);
    face.rotation.set(o.headPitch + 0, o.headYaw + 0, o.headRoll + 0);
    for (let i = 0; i < homes.length; i += 4)
      homes[i].position.set(homes[i + 1] * sxz, homes[i + 2] * sy, homes[i + 3] * sxz);
    // The face sits on the squashed skin: the eyes ride a little higher than the squash puts them.
    for (const e of eyes) e.socket.position.y += (1 - sy) * 0.2 + o.eyeUp;
    // Hind legs: thigh and foot swing out behind on a kick.
    for (let i = 0; i < hinds.length; i += 3) {
      const thigh = hinds[i];
      const foot = hinds[i + 1];
      const sx = hinds[i + 2];
      const k = o.kick;
      thigh.position.set(0, 0.03 * k, -0.06 * k);
      // the foot swings out and round until its toes point back: stretched out behind
      foot.position.set(sx * lerp(0.14, 0.16, k), lerp(-0.13, -0.1, k), lerp(0.17, -0.34, k));
      foot.rotation.y = sx * 2.6 * k;
    }
    for (const a of arms) a.rotation.x = -1.1 * o.reach;
    // The pouch balloons (wider than tall, forward and up) or sags (longer, lower).
    const pb = Math.max(0, o.pouch);
    const ps = Math.min(0, o.pouch);
    const g = 1 + 0.95 * pb;
    const psy = g * 0.9 * (1 - 0.3 * ps);
    pouch.scale.set(g * 1.12 * (1 + 0.1 * ps), psy, g * (1 + 0.25 * ps));
    pouch.position.z += 0.08 * pb;
    pouch.position.y += 0.07 * pb + 0.05 * ps;
    // never through the floor (face space is the rig's, offset by the pivot)
    const drop = pouch.position.z * Math.sin(o.headPitch); // a nod lowers it
    pouch.position.y = Math.max(pouch.position.y, POUCH_R * psy + 0.02 + drop - face.position.y);
    const sm = o.smile;
    smile.visible = o.open < 0.5;
    mouth.visible = !smile.visible;
    smile.position.y = sm < 0 ? -0.04 : 0.03;
    // Torus arc 0..PI is the upper half: flip it for a grin, scale y for a flat line.
    smile.rotation.z = sm >= 0 ? Math.PI : 0;
    smile.scale.set(1 + 0.15 * Math.abs(sm), Math.max(0.08, 0.45 * Math.abs(sm)), 1); // wide and shallow
    mouth.scale.set(1.25, 0.35 + 0.8 * o.open, 1);
    const tl = 0.95 * o.tongue;
    tongueG.visible = tl > 0.01;
    tongue.scale.set(1, 1, Math.max(0.01, tl));
    tip.position.z = tl;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
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

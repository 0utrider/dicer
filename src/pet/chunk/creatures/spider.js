import * as THREE from 'three';
import {
  TAU,
  INK,
  blink,
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
  detailMaterial,
} from './parts.js';

/**
 * The spider: a cute fuzzy jumping spider, friendly not scary. A big round head that is mostly
 * face, tilted up, with two very large dark glossy eyes, little bead eyes beside them, a small
 * smile on a cream muzzle and two fuzzy pedipalps that wiggle; a round abdomen raised behind with
 * a cream heart on top and two dark stripes (it wags and lifts like a tail); eight short chunky
 * legs in a star, banded, with cream tips. From above: the heart, the eight-leg star and two big
 * eyes looking up.
 * Crit: a crouch and one huge jump, front legs thrown up, the others spread, a happy wiggle on
 * landing; fumble: it tips over onto its back with its legs curled in, and twitches; mixed: a head
 * tilt, one front leg scratching, the gaze darting; plain: a pleased bob, pedipalps and abdomen
 * wagging. It dodges with two hops.
 */

const HEIGHT = 1.5;
const FOOT = 0.81; // top-down radius in scene units, the leg tips included (measured from the built geometry)
// Design units (scaled to HEIGHT at build).
const TILT = 0.64; // the face looks up toward the top-down camera
const HEAD_C = new THREE.Vector3(0, 0.59, 0.14);
const HEAD_R = [0.37, 0.345, 0.35];
const ABD_C = new THREE.Vector3(0, 0.92, -0.22);
const ABD_R = [0.33, 0.31, 0.36];
const WAIST = new THREE.Vector3(0, 0.73, -0.02); // the abdomen turns about this
const TOP = ABD_C.y + ABD_R[1]; // the top of the abdomen: what it lies on, on its back
const EYE_R = 0.14;
// Legs: a thigh up and out from the hip, a shin down to the floor. Angles from the horizontal.
const LEG_YAW = [0.61, 1.26, 1.88, 2.53]; // from +Z, front to back
const HIP_RING = 0.22;
const HIP_Z = 0.03;
const LT = 0.27; // thigh length
const LS = 0.54; // shin length
const A0 = 0.8; // thigh, above the horizontal
const B0 = 1.15; // shin, below it
const TIP_R = 0.09;
const HIP_Y = 0.9 * TIP_R + LS * Math.sin(B0) - LT * Math.sin(A0);

const EYE_DARK = new THREE.Color('#1a1216');
const EYE_IRIS = new THREE.Color('#6a3a1c');
const CREAM = new THREE.Color('#f7f0e2');
const FORWARD = new THREE.Vector3(0, 0, 1);

/** A capsule of radius r along +Z from 0 to len. */
const limb = (r, len) => new THREE.CapsuleGeometry(r, len, 1, 6).rotateX(Math.PI / 2).translate(0, 0, len / 2);

/** A heart laid on the top of the abdomen (abdomen space), its point toward the head. */
function heartGeo(size) {
  const geo = new THREE.RingGeometry(0.02, 1, 16, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const rho = Math.hypot(p.getX(i), p.getY(i));
    const t = Math.atan2(p.getX(i), p.getY(i));
    const hx = (16 * Math.sin(t) ** 3 * size * rho) / 16;
    const hy = ((13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2) * size * rho) / 16;
    const z = -hy - 0.02; // the lobes toward the back
    const y = ABD_R[1] * Math.sqrt(Math.max(0, 1 - (hx / ABD_R[0]) ** 2 - (z / ABD_R[2]) ** 2)) + 0.008;
    p.setXYZ(i, hx, y, z);
  }
  // facing up, whichever way the ring wound
  const ix = geo.index;
  const a = new THREE.Vector3().fromBufferAttribute(p, ix.getX(0));
  const b = new THREE.Vector3().fromBufferAttribute(p, ix.getY(0)).sub(a);
  const c = new THREE.Vector3().fromBufferAttribute(p, ix.getZ(0)).sub(a);
  if (b.cross(c).y < 0) for (let i = 0; i < ix.count; i += 3) { const k = ix.getY(i); ix.setY(i, ix.getZ(i)); ix.setZ(i, k); }
  geo.computeVertexNormals();
  return paint(geo, CREAM);
}

const REST = {
  lift: 0,
  squash: 0, // > 0 flatter, < 0 taller
  pitch: 0, // + nose down
  roll: 0, // PI: on its back
  spin: 0,
  yaw: 0,
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  abdUp: 0, // the abdomen lifts (+) or droops (-)
  abdWag: 0, // and wags side to side
  front: 0, // front legs thrown up 0..1
  wave: 0, // one front leg up: the left (+) or the right (-)
  curl: 0, // every leg curled in 0..1
  splay: 0, // every leg stretched out flat 0..1
  palp: 0, // pedipalps wiggling, one up one down (-1..1)
  palpUp: 0, // both lifted
  upper: 0.14,
  lower: 0.06,
  sad: 0,
  gazeYaw: 0,
  gazePitch: 0,
  smile: 0.7, // -1 frown .. 0 flat .. 1 grin
  open: 0, // mouth open 0..1
};
const PK = poseKit(REST);

// Keyframes, hoisted so a pose allocates nothing.
// The dodge: two hops, airborne over t 0.1-0.4 and 0.6-0.9 (the layer moves it across then).
const MOVE_SQUASH = [0, 0, 0.06, 0.26, 0.11, -0.16, 0.25, -0.04, 0.38, 0, 0.45, 0.28, 0.55, 0.24, 0.61, -0.16, 0.75, -0.04, 0.88, 0, 0.94, 0.26, 0.985, -0.03, 1, 0];
const MOVE_SPLAY = [0, 0, 0.07, 0, 0.14, 0.7, 0.3, 0.5, 0.39, 0, 0.57, 0, 0.64, 0.7, 0.8, 0.5, 0.89, 0, 1, 0];
const MOVE_PITCH = [0, 0, 0.06, 0.06, 0.13, -0.2, 0.28, 0.04, 0.4, 0.1, 0.5, 0.04, 0.63, -0.18, 0.78, 0.04, 0.9, 0.08, 1, 0];
const CRIT_SQUASH = [0, 0, 0.1, 0.1, 0.24, 0.34, 0.3, -0.24, 0.5, -0.08, 0.64, 0, 0.69, 0.32, 0.78, -0.08, 0.86, 0.04, 1, 0];
const CRIT_FRONT = [0, 0, 0.22, 0, 0.32, 1, 0.6, 1, 0.7, 0.2, 0.78, 0.7, 0.92, 0.5, 1, 0];
const CRIT_SPLAY = [0, 0, 0.26, 0, 0.34, 0.8, 0.56, 0.6, 0.66, 0, 1, 0];
const THROW_PITCH = [0, 0, 0.32, -0.26, 0.52, 0.2, 0.78, 0.04, 1, 0];
const THROW_FRONT = [0, 0, 0.32, 1, 0.5, 0.05, 0.62, 0.3, 1, 0];
const THROW_SQUASH = [0, 0, 0.3, 0.14, 0.5, -0.1, 0.75, 0.04, 1, 0];
const MIXED_GAZE = [0.2, 0, 0.32, -1, 0.5, -1, 0.6, 1, 0.78, 1, 0.9, 0];
const FLIP_LIFT = [0, 0, 0.08, 0, 0.2, 0.3, 0.36, 0, 1, 0];

export function spider(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  // double-sided: looking into an eyelid shell past the ball shows its fur inside, not a gap
  const fur = kit.mat(new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
  const darkColor = bodyColor.clone().multiplyScalar(0.55); // the bands: painted into the detail material
  const belly = kit.mat(new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.8, metalness: 0 }));
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'spider';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group(); // tips, turns and lifts the whole spider
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const squash = new THREE.Group(); // squash/stretch about the floor
  rig.add(squash);

  // The head (the cephalothorax) and a lighter belly under it that the legs grow from.
  const ball = kit.geo(new THREE.SphereGeometry(1, 12, 8));
  const lowBall = new THREE.SphereGeometry(1, 8, 5);
  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  head.position.copy(HEAD_C);
  squash.add(head);
  const skull = new THREE.Mesh(ball, fur);
  skull.scale.set(...HEAD_R);
  head.add(skull);
  const under = new THREE.Mesh(kit.geo(lowBall), belly);
  under.position.set(0, 0.43, -0.02);
  under.scale.set(0.27, 0.2, 0.31);
  squash.add(under);

  // The abdomen: a round ball on its waist, two dark stripes round it and a cream heart on top.
  const abd = new THREE.Group();
  abd.rotation.order = 'YXZ';
  abd.position.copy(WAIST);
  squash.add(abd);
  const bulb = new THREE.Group();
  bulb.position.copy(ABD_C).sub(WAIST);
  abd.add(bulb);
  const bulbMesh = new THREE.Mesh(ball, fur);
  bulbMesh.scale.set(...ABD_R);
  bulb.add(bulbMesh);
  const stripeGeo = kit.geo(paint(new THREE.TorusGeometry(1, 0.07, 3, 14), darkColor));
  for (const z of [-0.1, -0.23]) {
    const k = Math.sqrt(1 - (z / ABD_R[2]) ** 2);
    const stripe = new THREE.Mesh(stripeGeo, detail);
    stripe.position.z = z;
    stripe.scale.set(ABD_R[0] * k * 0.965, ABD_R[1] * k * 0.965, 0.3);
    bulb.add(stripe);
  }
  kit.mesh(heartGeo(0.14), detail, bulb);

  // The face, in the head's tilted frame (x across, y up the face, z out of it).
  const face = new THREE.Group();
  face.rotation.x = -TILT;
  head.add(face);
  const eyeBall = kit.geo(paint(new THREE.SphereGeometry(EYE_R, 10, 6), EYE_DARK));
  const irisGeo = kit.geo(paint(new THREE.SphereGeometry(EYE_R * 1.02, 10, 2, 0, TAU, 0, 0.95).rotateX(Math.PI / 2), EYE_IRIS));
  const pupilGeo = kit.geo(paint(new THREE.SphereGeometry(EYE_R * 1.04, 10, 2, 0, TAU, 0, 0.62).rotateX(Math.PI / 2), INK.pupil));
  const glintGeo = kit.geo(paint(new THREE.SphereGeometry(EYE_R * 0.25, 5, 2), INK.glint));
  const upLidGeo = kit.geo(new THREE.SphereGeometry(EYE_R * 1.09, 10, 2, 0, TAU, 0, Math.PI / 2));
  const loLidGeo = kit.geo(new THREE.SphereGeometry(EYE_R * 1.07, 10, 2, 0, TAU, Math.PI / 2, Math.PI / 2));
  const glintDir = new THREE.Vector3(-0.3, 0.36, 0.88).normalize();
  const eyes = [1, -1].map((side) => {
    const socket = new THREE.Group();
    socket.position.set(side * 0.158, 0.055, 0.245);
    socket.rotation.y = side * 0.06;
    face.add(socket);
    const eye = new THREE.Group();
    eye.rotation.order = 'YXZ';
    socket.add(eye);
    eye.add(new THREE.Mesh(eyeBall, detail), new THREE.Mesh(irisGeo, detail));
    const pupil = new THREE.Mesh(pupilGeo, detail);
    pupil.name = 'pupil';
    eye.add(pupil);
    for (const [k, s] of [
      [1, 1],
      [-0.75, 0.45],
    ]) {
      const glint = new THREE.Mesh(glintGeo, detail);
      glint.position.set(glintDir.x * k, glintDir.y * k, glintDir.z).normalize().multiplyScalar(EYE_R * 0.97);
      glint.quaternion.setFromUnitVectors(FORWARD, glint.position.clone().normalize());
      glint.scale.set(s, s, 0.3 * s);
      eye.add(glint);
    }
    const upPivot = new THREE.Group();
    const loPivot = new THREE.Group();
    socket.add(upPivot, loPivot);
    const upLid = new THREE.Mesh(upLidGeo, fur);
    const loLid = new THREE.Mesh(loLidGeo, fur);
    upPivot.add(upLid);
    loPivot.add(loLid);
    return {
      /** yaw/pitch turn the eye (pitch > 0 looks up); upper/lower 0 open .. 1 shut; sad slants the lid. */
      set(yaw, pitch, upper, lower, sad) {
        eye.rotation.y = yaw;
        eye.rotation.x = -pitch;
        upLid.rotation.x = -Math.PI / 2 + Math.min(1, Math.max(0, upper)) * Math.PI;
        loLid.rotation.x = Math.PI / 2 - Math.min(1, Math.max(0, lower)) * Math.PI * 0.98;
        upPivot.rotation.z = -side * sad;
        loPivot.rotation.z = side * sad * 0.3;
      },
    };
  });
  // The bead eyes: a pair beside the big ones, a smaller pair up behind them.
  const beadGeo = kit.geo(paint(new THREE.SphereGeometry(1, 5, 3), INK.pupil));
  for (const side of [1, -1])
    for (const [x, y, z, r] of [
      [0.93, 0.34, 0.24, 0.046],
      [0.66, 0.74, 0.02, 0.034],
    ]) {
      const k = 1 / Math.hypot(x / HEAD_R[0], y / HEAD_R[1], z / HEAD_R[2]) - 0.3 * r;
      const n = Math.hypot(x, y, z);
      const bead = new THREE.Mesh(beadGeo, detail);
      bead.position.set((side * x * k) / n, (y * k) / n, (z * k) / n);
      bead.scale.setScalar(r);
      face.add(bead);
    }
  // The muzzle and the mouth on it: a smile arc, an open mouth with a little tongue.
  const muzzle = new THREE.Group();
  muzzle.position.set(0, -0.2, 0.275);
  muzzle.rotation.x = 0.62;
  face.add(muzzle);
  const pad = new THREE.Mesh(kit.geo(paint(lowBall.clone(), CREAM)), detail);
  pad.scale.set(0.12, 0.075, 0.04);
  muzzle.add(pad);
  const smile = kit.mesh(paint(new THREE.TorusGeometry(0.042, 0.008, 3, 6, Math.PI), INK.mouth), detail, muzzle, 0, 0, 0.04);
  const mouth = kit.mesh(paint(new THREE.CircleGeometry(0.045, 8, Math.PI, Math.PI), INK.mouth), detail, muzzle, 0, 0.018, 0.042);
  kit.mesh(paint(new THREE.CircleGeometry(0.02, 6), INK.tongue), detail, mouth, 0, -0.026, 0.002);
  // The pedipalps: two fuzzy stubs beside the mouth, hinged at the top.
  const palpGeo = kit.geo(new THREE.CapsuleGeometry(0.062, 0.1, 2, 6).translate(0, -0.05, 0));
  const palps = [1, -1].map((side) => {
    const palp = new THREE.Mesh(palpGeo, fur);
    palp.position.set(side * 0.128, -0.2, 0.25);
    palp.rotation.z = side * 0.14;
    face.add(palp);
    return palp;
  });

  // The legs: flat, per leg: thigh group, knee group, row (0 the front pair), side.
  const thighGeo = kit.geo(limb(0.088, LT));
  const shinGeo = kit.geo(limb(0.08, LS));
  const bandGeo = kit.geo(paint(new THREE.CylinderGeometry(0.097, 0.097, 0.06, 6, 1, true).rotateX(Math.PI / 2), darkColor));
  const tipGeo = kit.geo(paint(new THREE.SphereGeometry(TIP_R, 6, 3), CREAM));
  const legs = [];
  for (const side of [1, -1])
    for (let i = 0; i < LEG_YAW.length; i++) {
      const hip = new THREE.Group();
      hip.position.set(side * Math.sin(LEG_YAW[i]) * HIP_RING, HIP_Y, HIP_Z + Math.cos(LEG_YAW[i]) * HIP_RING);
      hip.rotation.y = side * LEG_YAW[i]; // its +Z points out along the leg
      squash.add(hip);
      const thigh = new THREE.Group();
      hip.add(thigh);
      thigh.add(new THREE.Mesh(thighGeo, fur));
      const knee = new THREE.Group();
      knee.position.z = LT;
      thigh.add(knee);
      knee.add(new THREE.Mesh(shinGeo, fur));
      for (const z of [0.15, 0.31]) {
        const band = new THREE.Mesh(bandGeo, detail);
        band.position.z = z;
        knee.add(band);
      }
      const tip = new THREE.Mesh(tipGeo, detail);
      tip.position.z = LS - 0.04;
      tip.scale.set(1.25, 1.25, 1.25); // its facets clear the shin's
      knee.add(tip);
      legs.push(thigh, knee, i, side);
    }

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // A crouch, one huge jump with the front legs thrown up and the others spread, a squashy
      // landing and a happy wiggle, front legs waving.
      const joy = plateau(t, 0.05, 0.95, 0.08);
      o.squash = keys(t, CRIT_SQUASH);
      o.lift = 1.25 * Math.sin(Math.PI * span(t, 0.28, 0.66));
      o.front = keys(t, CRIT_FRONT);
      o.splay = keys(t, CRIT_SPLAY);
      o.pitch = -0.22 * bump(t, 0.26, 0.5) + 0.1 * bump(t, 0.5, 0.68);
      o.wave = 0.35 * Math.sin(t * TAU * 6) * plateau(t, 0.7, 0.98, 0.06);
      o.abdUp = 0.9 * joy;
      o.abdWag = Math.sin(t * TAU * 7) * plateau(t, 0.68, 0.98, 0.06);
      o.palpUp = joy;
      o.headPitch = -0.12 * joy;
      o.upper = lerp(REST.upper, 0, joy);
      o.lower = lerp(REST.lower, 0.4, plateau(t, 0.66, 0.95, 0.08));
      o.gazePitch = 0.25 * joy;
      o.smile = lerp(REST.smile, 1, joy);
      o.open = 0.9 * plateau(t, 0.26, 0.9, 0.08);
    } else if (reaction === 'fumble') {
      // It tips over onto its back, legs curling in, and lies there twitching.
      const over = smooth(span(t, 0.08, 0.36));
      const lying = smooth(span(t, 0.3, 0.5));
      o.roll = Math.PI * over;
      o.lift = keys(t, FLIP_LIFT);
      o.squash = 0.15 * bump(t, 0, 0.1) + 0.05 * wobble(span(t, 0.36, 0.7), 2, 4) * over;
      o.curl = lying * (0.92 + 0.08 * Math.sin(t * TAU * 5) * span(t, 0.5, 0.6) * (1 - span(t, 0.9, 1)));
      o.splay = 0.6 * bump(t, 0.06, 0.34);
      o.wave = 0.12 * bump(t, 0.72, 0.8) - 0.12 * bump(t, 0.84, 0.92); // a last twitch
      o.abdUp = -0.5 * lying;
      o.palp = 0.5 * Math.sin(t * TAU * 4) * lying * (1 - span(t, 0.7, 0.95));
      o.upper = lerp(REST.upper, 0.7, over);
      o.lower = lerp(REST.lower, 0.25, over);
      o.sad = 0.45 * over;
      o.gazePitch = -0.4 * over;
      o.smile = lerp(REST.smile, -0.9, smooth(span(t, 0.02, 0.25)));
      o.open = 0.5 * bump(t, 0.04, 0.4);
    } else if (reaction === 'mixed') {
      // A head tilt, one front leg scratching, the gaze darting, a slow doubtful wag.
      const tilt = outBack(span(t, 0.04, 0.3), 2.2) * (1 - smooth(span(t, 0.82, 1)));
      o.headRoll = 0.3 * tilt;
      o.headYaw = -0.12 * tilt;
      o.roll = 0.06 * tilt;
      o.wave = tilt * (0.45 + 0.2 * Math.sin(t * TAU * 5));
      o.abdWag = 0.4 * Math.sin(t * TAU * 1.5) * tilt;
      o.palp = 0.6 * Math.sin(t * TAU * 3) * tilt;
      o.upper = lerp(REST.upper, 0.3, tilt);
      o.sad = 0.2 * tilt;
      o.gazeYaw = 0.4 * keys(t, MIXED_GAZE);
      o.smile = lerp(REST.smile, 0, tilt);
    } else {
      // plain: a pleased bob, pedipalps drumming, the abdomen wagging.
      const glad = plateau(t, 0.08, 0.92, 0.12);
      o.squash = 0.1 * bump(t, 0.06, 0.2) - 0.07 * bump(t, 0.18, 0.4) + 0.06 * bump(t, 0.4, 0.55);
      o.lift = 0.08 * bump(t, 0.18, 0.4);
      o.abdUp = 0.4 * glad;
      o.abdWag = 0.7 * Math.sin(t * TAU * 4) * glad;
      o.palp = 0.8 * Math.sin(t * TAU * 6) * glad;
      o.headPitch = -0.08 * glad;
      o.upper = lerp(REST.upper, 0.3, glad);
      o.lower = lerp(REST.lower, 0.34, glad);
      o.smile = lerp(REST.smile, 1, glad);
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  function idle(o, ms, amount = 1) {
    // Breathing, the abdomen bobbing, now and then the pedipalps drum and a front leg taps; blinks.
    const s = ms / 1000;
    o.squash += 0.02 * Math.sin(s * TAU * 0.4) * amount;
    o.abdUp += 0.1 * Math.sin(s * TAU * 0.4 + 1) * amount;
    o.abdWag += 0.5 * Math.sin(s * TAU * 3) * bump((s % 6.1) / 6.1, 0.62, 0.8) * amount;
    o.palp += 0.7 * Math.sin(s * TAU * 4) * bump((s % 3.7) / 3.7, 0.1, 0.42) * amount;
    o.wave += 0.14 * Math.max(0, Math.sin(s * TAU * 2.5)) * bump((s % 7.9) / 7.9, 0.4, 0.62) * amount;
    o.headRoll += 0.04 * Math.sin(s * TAU * 0.21) * amount;
    const b = blink(ms, 900);
    o.upper += (1 - o.upper) * b;
    o.lower += (0.5 - o.lower) * b;
  }

  function pose(phase, t, reaction, look) {
    const ms = look?.now ?? nowMs();
    const yaw = look?.yaw || 0;
    const calm = !!look?.calm;
    if (phase === 'react') react(p, reaction, t, ms);
    else if (phase === 'exit') {
      // Back onto its feet (a fumble rolls upright again) and a little hop away.
      react(end, reaction, 1);
      PK.reset(tmp);
      tmp.squash = 0.2 * bump(t, 0.28, 0.42) - 0.12 * bump(t, 0.4, 0.8) + 0.2 * bump(t, 0.82, 1);
      tmp.splay = 0.5 * bump(t, 0.4, 0.8);
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
      if (reaction === 'fumble') p.lift += 0.25 * bump(t, 0, 0.3); // room to roll over
    } else if (phase === 'enter') {
      // It drops in on its thread: legs spread, a squashy landing.
      PK.reset(p);
      p.squash = -0.12 * bump(t, 0.05, 0.72) + 0.28 * bump(t, 0.7, 1);
      p.splay = 0.7 * bump(t, 0, 0.74);
      p.front = 0.4 * bump(t, 0.1, 0.7);
      p.abdUp = 0.6 * bump(t, 0, 0.8);
      p.upper = lerp(0.04, REST.upper, span(t, 0.8, 1));
      p.smile = lerp(1, REST.smile, span(t, 0.8, 1));
    } else if (phase === 'move') {
      // A dodge: hop, hop. A crouch and a spring, legs spread in the air and gathered for the
      // landing; bright eyes. It starts and ends on the standing pose (exit at t 1).
      PK.reset(p);
      const joy = plateau(t, 0.03, 0.97, 0.1);
      p.squash = keys(t, MOVE_SQUASH);
      p.splay = keys(t, MOVE_SPLAY);
      p.pitch = keys(t, MOVE_PITCH);
      p.lift = 0.6 * Math.sin(Math.PI * span(t, 0.1, 0.4)) + 0.5 * Math.sin(Math.PI * span(t, 0.6, 0.9));
      p.front = 0.35 * (bump(t, 0.12, 0.36) + bump(t, 0.62, 0.86));
      p.abdUp = 0.5 * joy;
      p.upper = lerp(REST.upper, 0.02, joy);
      p.smile = lerp(REST.smile, 1, joy);
    } else if (phase === 'pet') {
      // Petted: a happy wiggle, eyes squeezed shut, the abdomen wagging like a puppy's tail
      // (look.calm, reduced motion: a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      const k = calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.roll = 0.1 * k * Math.sin(t * TAU * 2) * on;
      p.headRoll = 0.16 * k * Math.sin(t * TAU * 2 - 0.8) * on;
      p.squash = 0.06 * k * Math.sin(t * TAU * 3) * on + 0.06 * on;
      p.abdUp = 0.5 * on;
      p.abdWag = k * Math.sin(t * TAU * 5) * on;
      p.palp = 0.6 * k * Math.sin(t * TAU * 4) * on;
      p.upper = lerp(REST.upper, 0.74, on);
      p.lower = lerp(REST.lower, 0.45, on);
      p.smile = lerp(REST.smile, 1, on);
    } else if (phase === 'huff') {
      // Huffed: it stamps a front leg, turns its face away, frowning, eyes narrowed, abdomen stiff.
      PK.reset(p);
      const k = calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.wave = -0.5 * k * bump(t, 0.05, 0.22) - 0.4 * k * bump(t, 0.24, 0.4);
      p.squash = (-0.08 * bump(t, 0.05, 0.4) + 0.08 * bump(t, 0.4, 0.7)) * k;
      p.headYaw = 0.4 * mad;
      p.yaw = 0.12 * mad;
      p.abdUp = 0.7 * mad;
      p.upper = lerp(REST.upper, 0.5, mad);
      p.sad = -0.4 * mad;
      p.smile = lerp(REST.smile, -0.7, mad);
      p.gazeYaw = 0.5 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop back off the heat, then it pants and fans itself with its
      // front legs, eyes squinting (look.calm: gentler).
      PK.reset(p);
      const k = calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.3 * k * bump(t, 0.02, 0.28);
      p.splay = 0.5 * k * bump(t, 0.02, 0.28);
      p.pitch = -0.12 * on;
      p.front = 0.45 * on;
      p.wave = 0.4 * k * Math.sin(t * TAU * 5) * on;
      p.squash = 0.04 * k * Math.sin(t * TAU * 6) * on;
      p.abdUp = -0.3 * on;
      p.upper = lerp(REST.upper, 0.55, on);
      p.lower = lerp(REST.lower, 0.3, on);
      p.smile = lerp(REST.smile, -0.3, on);
      p.open = on * (0.65 + 0.3 * Math.sin(t * TAU * 6));
    } else if (phase === 'shiver') {
      // Frozen (frost): hunched low with its legs pulled in, eyes squeezed, shivering side to side
      // (look.calm: a slower, smaller shiver).
      PK.reset(p);
      const k = calm ? 0.3 : 1;
      const f = calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.squash = 0.16 * on;
      p.curl = 0.16 * on;
      p.roll = 0.06 * k * Math.sin(t * TAU * f) * on;
      p.headRoll = 0.05 * k * Math.sin(t * TAU * f + 1) * on;
      p.abdUp = -0.4 * on;
      p.abdWag = 0.25 * k * Math.sin(t * TAU * f * 1.3) * on;
      p.palpUp = -0.5 * on;
      p.upper = lerp(REST.upper, 0.55, on);
      p.lower = lerp(REST.lower, 0.3, on);
      p.sad = 0.3 * on;
      p.smile = lerp(REST.smile, -0.5, on);
    } else if (phase === 'bristle') {
      // Zapped (storm): it shoots up tall on stiff legs, abdomen straight up, eyes popping, and
      // trembles (look.calm: no tremble).
      PK.reset(p);
      const k = calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.22 * on + 0.04 * k * Math.sin(t * TAU * 10) * on;
      p.front = 0.3 * on;
      p.wave = 0.08 * k * Math.sin(t * TAU * 13) * on;
      p.abdUp = 1.3 * on;
      p.palpUp = on;
      p.upper = lerp(REST.upper, 0, on);
      p.lower = lerp(REST.lower, 0, on);
      p.smile = lerp(REST.smile, 0, on);
      p.open = 0.55 * on;
    } else if (phase === 'startle') {
      // Startled (any other element): a jump straight up, legs spread and front legs thrown up,
      // eyes wide, and a squashy landing (look.calm: a smaller jump).
      PK.reset(p);
      const k = calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      p.lift = 0.7 * k * Math.sin(Math.PI * span(t, 0.1, 0.5));
      p.splay = 0.7 * k * bump(t, 0.1, 0.5);
      p.front = 0.8 * bump(t, 0.06, 0.6);
      p.pitch = -0.15 * bump(t, 0.06, 0.6);
      p.squash = 0.2 * bump(t, 0, 0.12) - 0.16 * k * bump(t, 0.1, 0.5) + 0.2 * k * bump(t, 0.48, 0.66);
      p.abdUp = 0.8 * wide;
      p.upper = lerp(REST.upper, 0, wide);
      p.lower = lerp(REST.lower, 0, wide);
      p.smile = lerp(REST.smile, 0, wide);
      p.open = 0.5 * wide;
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy hops, front legs waving in the air, a big
      // grin (look.calm: one small hop). From and back to the standing pose.
      PK.reset(p);
      const k = calm ? 0.3 : 1;
      const two = calm ? 0 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const air1 = bump(t, 0.12, 0.42);
      const air2 = two * bump(t, 0.52, 0.82);
      p.lift = 0.45 * k * (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash = k * (0.18 * bump(t, 0.02, 0.14) - 0.14 * air1 + 0.18 * bump(t, 0.42, 0.54)) + two * (0.15 * bump(t, 0.82, 0.95) - 0.14 * air2);
      p.splay = 0.5 * k * (air1 + air2);
      p.front = 0.8 * joy;
      p.wave = 0.3 * k * Math.sin(t * TAU * 4) * joy;
      p.abdUp = 0.7 * joy;
      p.abdWag = 0.6 * k * Math.sin(t * TAU * 5) * joy;
      p.upper = lerp(REST.upper, 0, joy);
      p.lower = lerp(REST.lower, 0.42, joy);
      p.gazePitch = 0.25 * joy;
      p.smile = lerp(REST.smile, 1, joy);
      p.open = 0.7 * joy;
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: reared up a little, abdomen high, chin up, a smug grin.
      // Sulk: sunk low with its legs drawn in, abdomen drooping, eyes down, frowning.
      PK.reset(end);
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.pitch = -0.1;
        tmp.squash = -0.08;
        tmp.headPitch = -0.12;
        tmp.abdUp = 0.9;
        tmp.palpUp = 0.6;
        tmp.smile = 1;
        tmp.upper = 0.36;
        tmp.lower = 0.3;
        tmp.gazePitch = 0.1;
      } else {
        tmp.squash = 0.3;
        tmp.curl = 0.12;
        tmp.headPitch = 0.14;
        tmp.abdUp = -0.6;
        tmp.palpUp = -0.6;
        tmp.smile = -0.8;
        tmp.upper = 0.55;
        tmp.lower = 0.02;
        tmp.sad = 0.5;
        tmp.gazePitch = -0.6;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !calm) p.abdWag += 0.5 * Math.sin(t * TAU * 3) * bump(t, 0.2, 0.8); // a wag on the way
    } else if (phase === 'throw') {
      // It rears back with its front legs up, then flings them down and forward: the die is off.
      PK.reset(p);
      p.pitch = keys(t, THROW_PITCH);
      p.squash = keys(t, THROW_SQUASH);
      p.front = keys(t, THROW_FRONT);
      p.abdUp = 0.6 * bump(t, 0.3, 0.9);
      p.palpUp = bump(t, 0.2, 0.7);
      p.upper = 0.06;
      p.open = 0.7 * bump(t, 0.36, 0.75);
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.gazeYaw += yaw * 0.6;
      p.headYaw += yaw * 0.5;
      p.yaw += yaw * 0.2;
    }
    apply(p);
  }

  function apply(o) {
    // Tipping pivots on its feet (or, rolled over, on its back): never through the floor.
    const sy = Math.max(0.3, 1 - o.squash);
    const sxz = 1 / Math.sqrt(sy);
    // (a roll turns it about its own middle, so on its back it lies where it stood)
    const mid = 0.5 * TOP * sy;
    rig.position.set(mid * Math.sin(o.roll), o.lift + 0.55 * Math.abs(Math.sin(o.pitch)) + mid * (1 - Math.cos(o.roll)) + 0.75 * Math.abs(Math.sin(o.roll)) * Math.max(0, Math.cos(o.roll)), 0);
    // + 0 turns a -0 (a negative weight times a zero bump) into 0: the standing pose compares equal.
    rig.rotation.set(o.pitch + 0, o.spin + o.yaw, o.roll + 0);
    squash.scale.set(sxz, sy, sxz);
    head.rotation.set(o.headPitch + 0, o.headYaw + 0, o.headRoll + 0);
    abd.rotation.set(0.45 * o.abdUp, 0.4 * o.abdWag, 0);
    for (let i = 0; i < legs.length; i += 4) {
      const row = legs[i + 2];
      const side = legs[i + 3];
      const up = row === 0 ? Math.max(0, Math.min(1.2, o.front + side * o.wave)) : 0;
      const a = A0 + 0.55 * o.curl - 0.45 * o.splay + 0.9 * up;
      const b = B0 + 0.9 * o.curl - 0.75 * o.splay - 1.7 * up;
      legs[i].rotation.x = -a;
      legs[i + 1].rotation.x = a + b;
    }
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      eyes[i].set(o.gazeYaw, o.gazePitch, o.upper, o.lower, o.sad);
      palps[i].rotation.x = -0.5 * o.palpUp - 0.45 * side * o.palp;
    }
    const sm = o.smile;
    smile.visible = o.open < 0.3;
    mouth.visible = !smile.visible;
    // Torus arc 0..PI is the upper half: flip it for a grin, scale y for a flat line.
    smile.rotation.z = sm >= 0 ? Math.PI : 0;
    smile.position.y = sm >= 0 ? 0.012 : -0.02;
    smile.scale.set(1 + 0.15 * Math.abs(sm), Math.max(0.1, 0.6 * Math.abs(sm)), 1);
    mouth.scale.set(0.9 + 0.2 * o.open, 0.5 + 0.7 * o.open, 1);
  }

  PK.reset(p);
  apply(p);
  root.updateMatrixWorld(true);
  const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
  scaler.scale.setScalar(HEIGHT / h);

  return { root, height: HEIGHT, footprint: FOOT, pose, dispose: () => kit.dispose() };
}

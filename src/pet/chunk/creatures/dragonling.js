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
  blink,
  nowMs,
  paint,
  palette,
  poseKit,
  createKit,
  createEye,
  detailMaterial,
  bend,
} from './parts.js';

/**
 * The dragonling: a chubby baby dragon with a big head, swept-back horns, bat wings spread wide
 * and a curled tail with a spade tip. Its top-down signature is the wing silhouette.
 * Crit: wings beat, it jumps and spins 360 degrees; fumble: wings, head and tail droop;
 * mixed: a head tilt and a one-wing shrug; plain: a little double nod and a flutter.
 */

const HEIGHT = 1.5;
const FOOT = 0.85; // top-down body radius in scene units, wings and tail tips excluded (measured)
const EYE_R = 0.17;
const TAIL_N = 6;

const REST = {
  lift: 0,
  squash: 0,
  pitch: 0,
  roll: 0,
  spin: 0,
  yaw: 0,
  headPitch: 0, // + nods down
  headRoll: 0,
  headYaw: 0,
  wing: 0.24, // raise, rad (0 flat out, + up, - down)
  wingL: 0, // extra raise on the left wing
  sweep: 0.12, // + folds the wings back
  curl: 0.42, // tail curl per joint
  sway: 0,
  tailLift: 0, // + raises the tail
  upper: 0.18,
  lower: 0.08,
  upperR: 0,
  sad: 0,
  sadL: 0,
  gazeYaw: 0,
  gazePitch: -0.3,
  tuck: 0, // legs pulled up under the body (flying)
};
const PK = poseKit(REST);
const FLY_BEATS = 5; // wing beats in one dodge flight (600 ms): a fast flutter

// More keyframes, hoisted so a pose allocates nothing.
const K0 = [0, 0, 0.12, 0.2, 0.2, -0.12, 0.5, -0.04, 0.6, 0.18, 0.7, -0.04, 0.8, 0];
const K1 = [0.2, 0, 0.32, -1, 0.5, -1, 0.6, 1, 0.78, 1, 0.9, 0];
const K2 = [0, 0, 0.3, -0.16, 0.55, 0.2, 1, 0];
const K3 = [0, 0, 0.3, -0.25, 0.55, 0.15, 1, 0];
const K4 = [0, 0.32, 0.3, 1.0, 0.55, -0.3, 0.85, 0.45, 1, 0.32];
const K5 = [0, 0.12, 0.3, 0.3, 0.55, -0.25, 1, 0.12];
const K6 = [0, 0.1, 0.3, 0.12, 0.55, -0.1, 0.8, 0.03, 1, 0];
const K7 = [0, 0.18, 0.3, 0.45, 0.55, 0, 1, 0.18];
const K8 = [0, 0, 0.3, -0.4, 0.6, 0.5, 1, 0];

/** A cylinder strut from a to b (design units, in the wing's plane y = 0). */
function strut(ax, az, bx, bz, r0, r1) {
  const len = Math.hypot(bx - ax, bz - az);
  const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(bx - ax, 0, bz - az).normalize(),
    ),
  );
  g.translate(ax, 0, az);
  return g;
}

export function dragonling(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.5, metalness: 0.05 }),
  );
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.45,
      metalness: 0.05,
      side: THREE.DoubleSide,
    }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'dragonling';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const squash = new THREE.Group();
  rig.add(squash);

  // Body, belly, legs.
  const torso = kit.mesh(new THREE.SphereGeometry(0.32, 14, 10), body, squash, 0, 0.38, -0.1);
  torso.scale.set(1, 0.88, 1.15);
  const belly = kit.mesh(new THREE.SphereGeometry(0.26, 10, 6), accent, squash, 0, 0.34, 0.03);
  belly.scale.set(0.9, 0.95, 0.9);
  const legGeo = kit.geo(new THREE.SphereGeometry(0.11, 8, 6));
  const legs = []; // flat, per leg: mesh, home y, home z, tucked y, tucked z
  for (const sx of [1, -1]) {
    const front = new THREE.Mesh(legGeo, body);
    front.position.set(sx * 0.17, 0.1, 0.17);
    front.scale.set(0.95, 1, 1.2);
    squash.add(front);
    legs.push(front, 0.1, 0.17, 0.24, 0.1);
    const hind = new THREE.Mesh(legGeo, body);
    hind.position.set(sx * 0.26, 0.15, -0.2);
    hind.scale.set(1.25, 1.35, 1.5);
    squash.add(hind);
    legs.push(hind, 0.15, -0.2, 0.25, -0.3);
  }
  // Dorsal spikes down the back: a row of light triangles from above.
  const spikeGeo = kit.geo(new THREE.ConeGeometry(0.07, 0.15, 4));
  for (const [z, y, s] of [
    [0.02, 0.66, 0.85],
    [-0.14, 0.66, 1],
    [-0.3, 0.6, 0.85],
    [-0.43, 0.49, 0.65],
  ]) {
    const sp = new THREE.Mesh(spikeGeo, accent);
    sp.position.set(0, y, z);
    sp.rotation.x = -0.5;
    sp.scale.set(s * 0.55, s, s);
    squash.add(sp);
  }

  // Head: big and round, with a blunt snout, nostrils, eyes and horns.
  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  head.position.set(0, 0.56, 0.12);
  squash.add(head);
  const skull = kit.mesh(new THREE.SphereGeometry(0.34, 14, 10), body, head, 0, 0.24, 0.08);
  skull.scale.set(1.05, 0.92, 1);
  // A long rounded muzzle (not a pig's disc), tipped slightly up.
  const snout = kit.mesh(new THREE.SphereGeometry(0.17, 10, 7), body, head, 0, 0.15, 0.4);
  snout.scale.set(0.95, 0.7, 1.4);
  snout.rotation.x = -0.12;
  const nostrilGeo = kit.geo(paint(new THREE.SphereGeometry(0.022, 5, 3), INK.pupil));
  for (const sx of [1, -1]) {
    const n = new THREE.Mesh(nostrilGeo, detail);
    n.position.set(sx * 0.06, 0.255, 0.5); // small slits on top of the muzzle
    n.scale.set(0.8, 0.4, 1.6);
    n.rotation.y = sx * 0.4;
    head.add(n);
  }
  const hornGeo = kit.geo(
    bend(new THREE.ConeGeometry(0.08, 0.42, 6, 3, true).translate(0, 0.21, 0), 0.42, -0.8),
  );
  for (const sx of [1, -1]) {
    const h = new THREE.Mesh(hornGeo, accent);
    h.position.set(sx * 0.17, 0.44, -0.02);
    h.rotation.order = 'YXZ';
    h.rotation.set(-0.85, sx * 0.25, -sx * 0.35);
    head.add(h);
  }
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lid: body });
    e.socket.position.set(side * 0.17, 0.35, 0.3);
    e.socket.rotation.order = 'YXZ';
    e.socket.rotation.set(-0.8, side * 0.32, 0);
    head.add(e.socket);
    return e;
  });

  // Wings: a scalloped bat membrane (accent, both sides) on body-colour bones.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.1);
  wingShape.quadraticCurveTo(0.18, 0.2, 0.36, 0.2);
  wingShape.lineTo(0.76, 0.04);
  wingShape.quadraticCurveTo(0.56, -0.04, 0.62, -0.3);
  wingShape.quadraticCurveTo(0.42, -0.2, 0.32, -0.42);
  wingShape.quadraticCurveTo(0.14, -0.22, 0, -0.2);
  wingShape.lineTo(0, 0.1);
  const wings = [1, -1].map((side) => {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.position.set(side * 0.16, 0.6, -0.08);
    squash.add(g);
    const mem = new THREE.ShapeGeometry(wingShape, 6).rotateX(Math.PI / 2);
    if (side < 0) mem.scale(-1, 1, 1);
    kit.mesh(mem, accent, g);
    for (const [ax, az, bx, bz, r0, r1] of [
      [0, 0.1, 0.36, 0.2, 0.035, 0.03],
      [0.36, 0.2, 0.76, 0.04, 0.03, 0.012],
      [0.36, 0.2, 0.62, -0.3, 0.026, 0.01],
      [0.36, 0.2, 0.32, -0.42, 0.024, 0.01],
    ]) {
      const s = strut(ax, az, bx, bz, r0, r1);
      if (side < 0) s.scale(-1, 1, 1);
      kit.mesh(s, body, g, 0, 0.004, 0);
    }
    return g;
  });

  // Tail: a tapering chain curling to one side, ending in a spade.
  const tail = [];
  let parent = squash;
  const segGeo = kit.geo(new THREE.SphereGeometry(1, 7, 5));
  for (let i = 0; i < TAIL_N; i++) {
    const j = new THREE.Group();
    j.position.set(0, i === 0 ? 0.26 : 0, i === 0 ? -0.4 : -0.13);
    parent.add(j);
    const r = 0.11 * (1 - i * 0.12);
    const seg = new THREE.Mesh(segGeo, body);
    seg.scale.set(r, r * 0.85, r * 1.5);
    seg.position.z = -0.07;
    j.add(seg);
    tail.push(j);
    parent = j;
  }
  const spade = kit.mesh(new THREE.ConeGeometry(0.13, 0.22, 4), accent, parent, 0, 0, -0.2);
  spade.rotation.set(-Math.PI / 2, Math.PI / 4, 0);
  spade.scale.set(1, 1, 0.35);

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      o.squash = keys(t, K0);
      const jump = span(t, 0.18, 0.6);
      o.lift = Math.sin(Math.PI * jump) * 0.7;
      o.spin = TAU * smooth(span(t, 0.2, 0.58));
      const beat = plateau(t, 0.1, 0.8, 0.06);
      o.wing = lerp(0.32, 0.55 + 0.75 * Math.sin(t * TAU * 8), beat);
      o.sweep = lerp(0.12, -0.1, beat);
      const joy = plateau(t, 0.06, 0.95, 0.08);
      o.headPitch = -0.3 * joy;
      o.upper = lerp(0.18, 0, joy);
      o.lower = lerp(0.08, 0.45, joy);
      o.gazePitch = lerp(-0.3, 0.3, joy);
      o.sway = 0.5 * Math.sin(t * TAU * 4) * joy;
      o.tailLift = 0.4 * joy;
    } else if (reaction === 'fumble') {
      const droop = smooth(span(t, 0.05, 0.55));
      const sigh = bump(t, 0.62, 0.88);
      o.wing = lerp(0.32, -0.85, droop) + 0.08 * sigh;
      o.sweep = lerp(0.12, 0.55, droop);
      o.headPitch = 0.55 * droop - 0.08 * sigh;
      o.pitch = 0.06 * droop;
      o.squash = 0.1 * droop;
      o.curl = lerp(0.42, 0.12, droop);
      o.tailLift = -0.25 * droop;
      o.upper = lerp(0.18, 0.6, droop);
      o.sad = 0.5 * droop;
      o.gazePitch = lerp(-0.3, -0.8, droop);
    } else if (reaction === 'mixed') {
      const tilt = outBack(span(t, 0.04, 0.32), 2.2) * (1 - smooth(span(t, 0.82, 1)));
      o.headRoll = 0.55 * tilt;
      o.headPitch = -0.05 * tilt;
      o.roll = 0.06 * tilt;
      o.wingL = 0.9 * tilt; // a one-wing shrug
      o.wing = lerp(0.32, 0.12, tilt);
      o.curl = lerp(0.42, 0.62, tilt); // the tail curls into a question mark
      o.upperR = 0.4 * tilt;
      o.sadL = 0.45 * tilt;
      o.upper = lerp(0.18, 0.04, tilt);
      o.gazeYaw = 0.45 * keys(t, K1);
    } else {
      o.headPitch = 0.28 * bump(t, 0.1, 0.36) + 0.22 * bump(t, 0.36, 0.62);
      o.wing = 0.32 + 0.25 * bump(t, 0.2, 0.7) * Math.sin(t * TAU * 6);
      const content = plateau(t, 0.08, 0.92, 0.12);
      o.upper = lerp(0.18, 0.48, content);
      o.lower = lerp(0.08, 0.34, content);
      o.sway = 0.35 * Math.sin(t * TAU * 2) * content;
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  function idle(o, ms, amount = 1) {
    const s = Math.sin((ms / 1800) * TAU);
    o.squash += 0.02 * s * amount;
    o.wing += 0.06 * s * amount;
    o.headPitch += 0.03 * Math.sin((ms / 1800) * TAU + 1) * amount;
    o.sway += 0.18 * Math.sin((ms / 1300) * TAU) * amount;
    const b = blink(ms, 3050);
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
      tmp.squash = 0.15 * bump(t, 0, 0.25) - 0.1 * bump(t, 0.2, 0.85) + 0.15 * bump(t, 0.85, 1);
      tmp.wing = 0.4 + 0.7 * Math.sin(t * TAU * 3) * bump(t, 0.15, 0.95);
      tmp.upper = 0.1;
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      PK.reset(p);
      p.squash = -0.1 * bump(t, 0.05, 0.75) + 0.18 * bump(t, 0.75, 1);
      p.wing = 0.4 + 0.7 * Math.sin(t * TAU * 2.5) * bump(t, 0, 0.85);
      p.upper = 0.05;
      p.tailLift = 0.3 * bump(t, 0, 0.9);
    } else if (phase === 'move') {
      // A dodge: a crouch and a spring, then it flies (the layer lifts it in an arc): wings a fast
      // blur, body tilted into the flight, legs tucked, tail streaming and swishing, eyes bright;
      // then it drops onto its feet. It starts and ends on the standing pose (exit at t 1).
      PK.reset(p);
      const fly = plateau(t, 0.04, 0.96, 0.14);
      const beat = Math.sin(t * TAU * FLY_BEATS);
      p.squash = 0.16 * bump(t, 0, 0.14) - 0.06 * fly + 0.18 * bump(t, 0.84, 1);
      p.lift = (0.3 + 0.05 * Math.sin(t * TAU * FLY_BEATS + 1.2)) * fly; // bobs with each beat
      p.pitch = 0.4 * fly;
      p.headPitch = -0.34 * fly; // the head stays up, looking where it goes
      p.wing = lerp(0.4, 0.3 + 0.9 * beat, fly);
      p.sweep = lerp(0.12, 0.02 - 0.14 * beat, fly); // forward on the downstroke
      p.tuck = fly;
      p.curl = lerp(0.42, 0.08, fly);
      p.tailLift = 0.35 * fly;
      p.sway = 0.3 * Math.sin(t * TAU * 2.5) * fly;
      p.upper = lerp(0.1, 0, fly);
      p.lower = lerp(0.08, 0.22, fly);
      p.gazePitch = lerp(-0.3, 0.05, fly);
    } else if (phase === 'throw') {
      PK.reset(p);
      // Rears back with wings up, then lunges: head thrust, wings sweeping forward and down.
      p.pitch = keys(t, K2);
      p.headPitch = keys(t, K3);
      p.wing = keys(t, K4);
      p.sweep = keys(t, K5);
      p.squash = keys(t, K6);
      p.upper = keys(t, K7);
      p.sway = keys(t, K8);
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (phase === 'watch' || phase === 'react') {
      p.headYaw += yaw * 0.55;
      p.gazeYaw += yaw * 0.7;
      p.yaw += yaw * 0.15;
    }
    apply(p);
  }

  function apply(o) {
    rig.position.y = o.lift;
    rig.rotation.set(o.pitch, o.spin + o.yaw, o.roll);
    const sy = 1 - o.squash;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    squash.scale.set(sxz, sy, sxz);
    head.rotation.set(o.headPitch, o.headYaw, o.headRoll);
    for (let i = 0; i < legs.length; i += 5)
      legs[i].position.set(legs[i].position.x, lerp(legs[i + 1], legs[i + 3], o.tuck), lerp(legs[i + 2], legs[i + 4], o.tuck));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const w = wings[i];
      w.rotation.set(0, side * o.sweep, side * (o.wing + (side < 0 ? o.wingL : 0)));
      eyes[i].set(
        o.gazeYaw,
        o.gazePitch,
        o.upper + (side === 1 ? o.upperR : 0),
        o.lower,
        o.sad + (side === -1 ? o.sadL : 0),
      );
    }
    for (let i = 0; i < TAIL_N; i++) {
      const j = tail[i];
      j.rotation.y = o.curl * (0.6 + i * 0.16) + o.sway * (0.4 + i * 0.12);
      j.rotation.x = i === 0 ? 0.55 - o.tailLift : i === 1 ? 0.15 - o.tailLift * 0.5 : -0.12;
    }
  }

  PK.reset(p);
  apply(p);
  root.updateMatrixWorld(true);
  const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
  scaler.scale.setScalar(HEIGHT / h);

  return { root, height: HEIGHT, footprint: FOOT, pose, dispose: () => kit.dispose() };
}

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
  blink,
  nowMs,
  paint,
  palette,
  poseKit,
  createKit,
  createEye,
  detailMaterial,
} from './parts.js';

/**
 * The slime: a glossy jelly gumdrop with a little curl on top. Squash and stretch carry all its
 * emotion. From above: a round glossy dome, a bold shine, two big eyes and a smile.
 * Crit: a deep squash and a high spring with a twirl; fumble: it melts into a puddle (scale.y 0.4)
 * with sad eyes; mixed: it leans and wobbles, one eye squinting; plain: a happy bounce.
 */

const HEIGHT = 1.5;
const R = 0.72; // footprint radius (design units)
const FOOT = 1.0; // top-down body radius in scene units (measured from the built geometry)
const TOPY = 1.0; // dome height
const EYE_R = 0.2;
const SKIRT = 0.22; // height of the rounded skirt below the dome

/** A gumdrop: flat base with a rounded skirt, a full dome and a soft tip leaning back. */
function gumdrop(geo) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); // unit sphere
    const s = Math.max(-1, Math.min(1, v.y));
    const c = Math.sqrt(1 - s * s);
    const len = Math.hypot(v.x, v.z) || 1;
    let rr;
    let y;
    if (s < 0) {
      // a fat, nearly flat bottom with a rounded skirt
      rr = R * c ** 0.3;
      y = SKIRT * (1 + s) ** 1.6;
    } else {
      // the dome, a little narrower toward the top, with a soft tip
      rr = R * c ** 0.85 * (1 - 0.12 * s);
      y = SKIRT + (TOPY - SKIRT) * s ** 0.9;
    }
    const lean = s > 0.75 ? ((s - 0.75) / 0.25) ** 2 * -0.1 : 0;
    p.setXYZ(i, (v.x / len) * rr, y, (v.z / len) * rr + lean);
  }
  geo.computeVertexNormals();
  return geo;
}

const REST = {
  lift: 0,
  squash: 0, // > 0 flatter, < 0 taller
  pitch: 0,
  roll: 0,
  spin: 0,
  yaw: 0,
  shear: 0, // jelly lag: top leans forward (+) / back (-)
  upper: 0.18,
  lower: 0.08,
  upperR: 0,
  sad: 0,
  sadL: 0,
  gazeYaw: 0,
  gazePitch: -0.3,
  smile: 0.6, // -1 frown .. 0 flat .. 1 grin
  open: 0, // mouth open 0..1
};
const PK = poseKit(REST);

// More keyframes, hoisted so a pose allocates nothing.
const K0 = [0.2, 0, 0.32, -1, 0.5, -1, 0.6, 1, 0.78, 1, 0.9, 0];
const K1 = [0, 0, 0.12, 0.22, 0.24, -0.16, 0.38, 0.12, 0.5, -0.04, 0.62, 0.03, 0.75, 0];
const K2 = [0, 0.18, 0.32, 0.5, 0.52, 0, 1, 0.18];
const THROW_SQUASH = [0, 0.1, 0.32, 0.28, 0.52, -0.3, 0.75, 0.08, 1, 0];
const THROW_SHEAR = [0, 0, 0.32, -0.25, 0.52, 0.45, 0.75, -0.12, 1, 0];
const CRIT_SQUASH = [
  0, 0, 0.14, 0.42, 0.22, -0.38, 0.4, -0.1, 0.56, -0.05, 0.62, 0.38, 0.7, -0.1, 0.8, 0.08, 0.9, 0,
];

export function slime(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.12,
      metalness: 0,
      transparent: true,
      opacity: 0.85,
    }),
  );
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.15, metalness: 0 }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'slime';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const jelly = new THREE.Group(); // squash/stretch about the floor
  rig.add(jelly);

  const blob = kit.mesh(gumdrop(new THREE.SphereGeometry(1, 24, 16)), body, jelly);
  blob.renderOrder = 1;
  // An opaque lighter core inside the jelly: depth and a glow through the 0.85 shell.
  const core = kit.mesh(gumdrop(new THREE.SphereGeometry(1, 12, 8)), accent, jelly);
  core.scale.set(0.8, 0.82, 0.8);
  core.position.y = 0.02;
  // The cartoon shine: a bold crescent on the dome, toward the key light (up-left, front).
  const shine = kit.mesh(paint(new THREE.SphereGeometry(0.1, 8, 5), INK.white), detail, jelly);
  shine.scale.set(1.5, 0.35, 0.8);
  shine.position.set(-0.3, 0.86, -0.06);
  shine.rotation.set(0.35, 0.6, 0.55);
  const shine2 = kit.mesh(paint(new THREE.SphereGeometry(0.05, 6, 4), INK.white), detail, jelly);
  shine2.scale.set(1, 0.4, 1);
  shine2.position.set(-0.47, 0.71, 0.08);
  shine2.rotation.set(0.3, 0, 0.75);

  // The face rides the jelly but is not squashed itself: placed from the squash each frame.
  const face = new THREE.Group();
  rig.add(face);
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lidColor: bodyColor });
    e.socket.rotation.order = 'YXZ';
    e.socket.rotation.set(-1.0, side * 0.25, 0);
    e.socket.userData.home = new THREE.Vector3(side * 0.25, 0.79, 0.31);
    face.add(e.socket);
    return e;
  });
  // Mouth: a dark smile arc (a torus segment) and an open mouth (a dark half-disc) for joy.
  const smile = kit.mesh(
    paint(new THREE.TorusGeometry(0.12, 0.032, 5, 12, Math.PI), INK.mouth),
    detail,
    face,
  );
  smile.userData.home = new THREE.Vector3(0, 0.56, 0.58);
  const mouth = kit.mesh(
    paint(new THREE.CircleGeometry(0.13, 16, Math.PI, Math.PI), INK.mouth),
    detail,
    face,
  );
  mouth.userData.home = new THREE.Vector3(0, 0.58, 0.585);
  const tongue = kit.mesh(
    paint(new THREE.CircleGeometry(0.065, 12, Math.PI, Math.PI), INK.tongue),
    detail,
    mouth,
  );
  tongue.position.set(0, -0.06, 0.003);

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      o.squash = keys(t, CRIT_SQUASH);
      const jump = span(t, 0.22, 0.6);
      o.lift = Math.sin(Math.PI * jump) * 1.0;
      o.spin = TAU * smooth(span(t, 0.24, 0.58));
      o.shear = -0.25 * bump(t, 0.2, 0.4) + 0.2 * bump(t, 0.58, 0.72);
      const joy = plateau(t, 0.1, 0.95, 0.08);
      o.upper = lerp(0.18, 0, joy);
      o.lower = lerp(0.08, 0.45, joy);
      o.gazePitch = lerp(-0.3, 0.3, joy);
      o.smile = lerp(0.6, 1, joy);
      o.open = joy;
    } else if (reaction === 'fumble') {
      // A slow melt into a puddle, eyes drooping; a last sad wobble.
      const melt = smooth(span(t, 0.04, 0.55));
      o.squash = 0.6 * melt + 0.03 * wobble(span(t, 0.55, 1), 1.5, 3) * melt;
      o.pitch = 0.05 * melt;
      o.upper = lerp(0.18, 0.6, melt);
      o.lower = lerp(0.08, 0.02, melt);
      o.sad = 0.5 * melt;
      o.gazePitch = lerp(-0.3, -0.8, melt);
      o.smile = lerp(0.6, -1, smooth(span(t, 0.02, 0.3)));
    } else if (reaction === 'mixed') {
      const tilt = outBack(span(t, 0.04, 0.32), 2) * (1 - smooth(span(t, 0.82, 1)));
      o.roll = 0.4 * tilt;
      o.shear = 0.08 * Math.sin(t * TAU * 2.5) * tilt;
      o.squash = 0.06 * tilt;
      o.upperR = 0.4 * tilt;
      o.sadL = 0.45 * tilt;
      o.upper = lerp(0.18, 0.04, tilt);
      o.gazeYaw = 0.45 * keys(t, K0);
      o.smile = lerp(0.6, 0, tilt);
    } else {
      // plain: a pleased little bounce.
      o.squash = keys(t, K1);
      o.lift = 0.14 * bump(t, 0.15, 0.36);
      const content = plateau(t, 0.08, 0.92, 0.12);
      o.upper = lerp(0.18, 0.48, content);
      o.lower = lerp(0.08, 0.34, content);
      o.smile = lerp(0.6, 1, content);
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  function idle(o, ms, amount = 1) {
    const s = Math.sin((ms / 1500) * TAU);
    o.squash += 0.035 * s * amount;
    o.shear += 0.03 * Math.sin((ms / 1500) * TAU - 1.2) * amount;
    const b = blink(ms, 2950);
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
      tmp.squash = 0.3 * bump(t, 0, 0.25) - 0.3 * bump(t, 0.2, 0.85) + 0.3 * bump(t, 0.85, 1);
      tmp.shear = -0.2 * bump(t, 0.2, 0.7);
      tmp.upper = 0.08;
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      PK.reset(p);
      p.squash = -0.3 * bump(t, 0.05, 0.72) + 0.4 * bump(t, 0.7, 1);
      p.shear = 0.2 * bump(t, 0.1, 0.7);
      p.upper = 0.05;
      p.lower = 0.05;
      p.open = 0.6 * bump(t, 0.1, 0.8);
    } else if (phase === 'throw') {
      PK.reset(p);
      // A fling: it rears back, then lunges its whole jelly forward and wobbles.
      p.squash = keys(t, THROW_SQUASH);
      p.shear = keys(t, THROW_SHEAR);
      p.upper = keys(t, K2);
      p.open = bump(t, 0.4, 0.85);
      p.gazePitch = -0.15;
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (phase === 'watch' || phase === 'react') {
      p.gazeYaw += yaw * 1.1;
      p.yaw += yaw * 0.45;
    }
    apply(p);
  }

  function apply(o) {
    rig.position.y = o.lift;
    rig.rotation.set(o.pitch, o.spin + o.yaw, o.roll);
    const sy = Math.max(0.3, 1 - o.squash);
    const sxz = sy ** -0.36; // a melt spreads, but less than volume would
    jelly.scale.set(sxz, sy, sxz);
    // Shear: lean the jelly's top forward/back (a matrix would allocate nothing either, but a
    // small rotation about the base reads the same).
    jelly.rotation.x = o.shear * 0.6;
    face.rotation.x = o.shear * 0.6;
    for (const e of eyes) {
      const h = e.socket.userData.home;
      e.socket.position.set(
        h.x * sxz,
        h.y * sy + (1 - sy) * 0.06,
        h.z * sxz * (1 + 0.1 * (sxz - 1)),
      );
    }
    const sm = o.smile;
    smile.visible = o.open < 0.5;
    mouth.visible = !smile.visible;
    const sh = smile.userData.home;
    smile.position.set(sh.x, sh.y * sy + (sm < 0 ? -0.04 : 0.02), sh.z * sxz);
    // Torus arc 0..PI is the upper half: flip it for a grin, scale y for a flat line.
    smile.rotation.set(-0.5, 0, sm >= 0 ? Math.PI : 0);
    smile.scale.set(1 + 0.2 * Math.abs(sm), Math.max(0.15, Math.abs(sm)), 1);
    const mh = mouth.userData.home;
    mouth.position.set(mh.x, mh.y * sy, mh.z * sxz);
    mouth.rotation.set(-0.5, 0, 0);
    mouth.scale.set(1, 0.4 + 0.8 * o.open, 1);
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

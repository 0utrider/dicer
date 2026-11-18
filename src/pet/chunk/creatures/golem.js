import * as THREE from 'three';
import {
  mergeFlat,
  TAU,
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
} from './parts.js';

/**
 * The pebble golem: a chunky little stone golem of faceted boulders. A broad, heavy boulder body
 * with glowing runes cut into its back and chest and a moss patch on one shoulder, a rock head set
 * forward and up on it with two big glowing eyes facing up under a heavy brow, big rock fists on
 * stone shoulders and two stumpy feet. From above: the boulder filling its footprint, the rune
 * sigil and moss on its back, the glowing eyes and the fists out to the sides. Slow, sturdy, proud.
 * Crit: a stomp-hop, both fists thrust overhead, pumping, runes blazing; fumble: the head rock
 * slides askew, a shoulder sags and the arms hang (a crumbling slump that holds together);
 * mixed: a head tilt while one fist scratches it; plain: arms crossed and a slow satisfied nod.
 */

const HEIGHT = 1.5;
const FOOT = 1.0; // top-down body radius in scene units, the fists at rest included (measured)
const EYE_R = 0.17;
const STOMP_STEPS = 2.5; // step cycles in one dodge: heavy, but quick enough to get out of the way

const MOSS = [new THREE.Color('#4f8f3c'), new THREE.Color('#6fae4f'), new THREE.Color('#3f7a33')];

const REST = {
  lift: 0,
  squash: 0, // > 0 squashes, < 0 stretches
  pitch: 0, // + leans forward
  roll: 0,
  spin: 0,
  yaw: 0,
  headPitch: 0, // + nods down
  headRoll: 0,
  headYaw: 0,
  headSlide: 0, // the head rock sliding off to +x
  headDrop: 0, // the head sinking into the shoulders
  sag: 0, // the right shoulder rock sagging
  // arms, per side (R is the +x arm): out to the side, forward, twist inward, elbow bend
  outR: 0.24,
  outL: 0.24,
  fwdR: 0.08,
  fwdL: 0.08,
  twR: 0,
  twL: 0,
  elbR: 0.22,
  elbL: 0.22,
  stride: 0, // 0..1: the feet stomp in turn, by gait
  gait: 0,
  glow: 0.5, // rune glow 0..1
  upper: 0.14, // heavy stone lids: a calm, proud look
  lower: 0.08,
  upperR: 0,
  sad: 0,
  sadL: 0,
  gazeYaw: 0,
  gazePitch: -0.3,
  eyeScale: 1,
};
const PK = poseKit(REST);

// Arms crossed over the chest (the plain nod, the huff, the shiver and the proud mood).
const CROSS_OUT = -0.6; // the arms are short: the fists meet in front of the chest
const CROSS_FWD = 1.4;
const CROSS_TW = 0.2;
const CROSS_ELB = 0.2;

// More keyframes, hoisted so a pose allocates nothing.
const K_LOOK = [0.2, 0, 0.32, -1, 0.5, -1, 0.6, 1, 0.78, 1, 0.9, 0];
const THROW_FWD = [0, 0.08, 0.3, -0.7, 0.5, 1.9, 0.75, 1.2, 1, 0.08];
const THROW_ELB = [0, 0.22, 0.3, 0.9, 0.5, 0.1, 1, 0.22];
const THROW_PITCH = [0, 0, 0.3, -0.14, 0.5, 0.2, 1, 0];
const THROW_SQUASH = [0, 0, 0.3, 0.1, 0.5, -0.06, 0.75, 0.04, 1, 0];
const CRIT_SQUASH = [0, 0, 0.1, 0.16, 0.16, -0.08, 0.34, -0.04, 0.4, 0.14, 0.48, 0, 0.66, 0, 0.72, 0.1, 0.8, 0];

/** A pseudo-random 0..1 from a point (rounded, so a vertex's every copy gets the same). */
const hash = (x, y, z, seed) => {
  const r = (v) => Math.round(v * 1000) / 1000;
  const s = Math.sin(r(x) * 12.9898 + r(y) * 78.233 + r(z) * 37.719 + seed * 4.1414) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * A faceted boulder: a coarse sphere with its vertices pushed in at random and turned a random
 * way (so no two rocks share their poles). The material's flat shading cuts the facets.
 */
function rock(r, ws, hs, seed, amt = 0.16) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 - amt * hash(x / r, y / r, z / r, seed);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.rotateY(seed * 2.39);
  g.rotateX(seed * 0.71);
  g.computeVertexNormals();
  return g;
}

// The torso boulder: centre, radius, per-axis scale and its jitter (the runes and moss sit on it).
const TORSO_Y = 0.62;
const TORSO_R = 0.6;
const TORSO_S = new THREE.Vector3(1.3, 0.9, 1.2);
const TORSO_AMT = 0.08;
const SH_X = 0.68; // the shoulders
const SH_Y = 0.98;
const HEAD_Y = 1.04; // the head, forward and up on the boulder's front shoulder
const HEAD_Z = 0.34;

const _u = new THREE.Vector3();
const _n = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * The torso's surface toward the point (x, y, z) (squash space), found analytically on its
 * ellipsoid: sets _pt (the surface point, lifted along the normal by `lift`) and _n (the normal).
 */
function onTorso(x, y, z, lift = 0) {
  _u.set(x / TORSO_S.x, (y - TORSO_Y) / TORSO_S.y, z / TORSO_S.z).normalize();
  _n.set(_u.x / TORSO_S.x, _u.y / TORSO_S.y, _u.z / TORSO_S.z).normalize();
  _pt
    .copy(_u)
    .multiplyScalar(TORSO_R * (1 - 0.5 * TORSO_AMT))
    .multiply(TORSO_S)
    .addScaledVector(_n, lift);
  _pt.y += TORSO_Y;
}

export function golem(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.88,
      metalness: 0.02,
      flatShading: true,
    }),
  );
  // The runes glow: the accent with an emissive of its own (pulsed by the pose).
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 0.55,
      roughness: 0.4,
      metalness: 0.05,
    }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'golem';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group(); // lift, lean, spin: pivots on the floor
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const squash = new THREE.Group();
  rig.add(squash);

  // Feet: two stumpy rocks, on the floor under the rig (not squashed), stomping in turn.
  const feet = [1, -1].map((side, i) => {
    const f = kit.mesh(rock(0.21, 6, 4, 11 + i, 0.12), body, rig, side * 0.32, 0.11, 0.08);
    f.scale.set(1.1, 0.6, 1.3);
    f.userData.home = new THREE.Vector3(side * 0.32, 0.11, 0.08);
    f.userData.pair = i === 0 ? 0 : Math.PI;
    return f;
  });

  // The torso: a broad, heavy boulder on a squat hip rock, filling the footprint.
  const torso = kit.mesh(rock(TORSO_R, 11, 8, 3, TORSO_AMT), body, squash, 0, TORSO_Y, 0);
  torso.scale.copy(TORSO_S);
  const hips = kit.mesh(rock(0.34, 7, 5, 5, 0.12), body, squash, 0, 0.26, 0.02);
  hips.scale.set(1.35, 0.7, 1.15);

  // Runes cut into the boulder, laid on its surface analytically and merged: a big sigil on its
  // back (what the top camera sees, behind the head), ticks on its shoulders, a stave on its chest.
  const runes = new THREE.Group();
  squash.add(runes);
  {
    const segs = [];
    // [x, y, z, length, angle]: a point the segment is laid toward, its length and its turn
    for (const [x, y, z, len, ang] of [
      // the back sigil: a stave pointing at the head, an arrowhead, a crossbar and a ring of ticks
      [0.12, 2, -0.42, 0.5, 0],
      [0.03, 2, -0.18, 0.2, -0.8],
      [0.21, 2, -0.18, 0.2, 0.8],
      [0.12, 2, -0.5, 0.32, Math.PI / 2],
      [-0.06, 2, -0.7, 0.16, 0.7],
      [0.3, 2, -0.7, 0.16, -0.7],
      // the shoulder ticks
      [0.62, 1.4, -0.2, 0.2, -0.35],
      [0.68, 1.4, 0.05, 0.14, -0.35],
      // the chest stave
      [0, 0.3, 1, 0.24, 0],
      [-0.06, 0.39, 1, 0.13, 0.75],
      [0.06, 0.39, 1, 0.13, -0.75],
      [-0.3, 0.36, 1, 0.13, 0.25],
      [0.3, 0.36, 1, 0.13, -0.25],
    ]) {
      onTorso(x, y, z, 0.005);
      const g = new THREE.BoxGeometry(0.07, len, 0.08);
      g.rotateZ(ang);
      g.applyQuaternion(_q.setFromUnitVectors(Z_AXIS, _n));
      g.translate(_pt.x, _pt.y, _pt.z);
      segs.push(g);
    }
    kit.mesh(mergeFlat(segs), accent, runes);
    for (const g of segs) g.dispose();
  }

  // Moss: tufts on the head's crown and a patch over one back shoulder of the boulder.
  const mossOf = (spots, toTorso) => {
    const tufts = [];
    for (const [x, y, z, r, c] of spots) {
      const g = new THREE.SphereGeometry(r, 6, 4);
      g.scale(1, 0.6, 1);
      if (toTorso) {
        onTorso(x, y, z, r * 0.15);
        g.applyQuaternion(_q.setFromUnitVectors(_u.set(0, 1, 0), _n));
        g.translate(_pt.x, _pt.y, _pt.z);
      } else g.translate(x, y, z);
      tufts.push(paint(g, MOSS[c]));
    }
    const m = mergeFlat(tufts);
    for (const g of tufts) g.dispose();
    return m;
  };
  kit.mesh(
    mossOf(
      [
        [-0.5, 1.4, -0.36, 0.14, 0],
        [-0.34, 1.4, -0.52, 0.11, 1],
        [-0.64, 1.2, -0.2, 0.1, 2],
        [-0.46, 1.5, -0.16, 0.09, 1],
        [-0.22, 1.5, -0.62, 0.08, 2],
      ],
      true,
    ),
    detail,
    squash,
  );

  // Shoulders and arms: a stone shoulder, an upper-arm rock, an elbow and a big rock fist.
  const arms = [1, -1].map((side, i) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * SH_X, SH_Y, -0.02);
    squash.add(shoulder);
    const sh = kit.mesh(rock(0.27, 7, 5, 21 + i), body, shoulder, 0, 0.04, -0.02);
    sh.scale.set(1.1, 0.85, 1.1);
    const arm = new THREE.Group();
    arm.position.y = -0.04;
    shoulder.add(arm);
    const up = kit.mesh(rock(0.15, 6, 4, 31 + i, 0.12), body, arm, 0, -0.13, 0);
    up.scale.set(1, 1.25, 1);
    const elbow = new THREE.Group();
    elbow.position.y = -0.27;
    arm.add(elbow);
    const fore = kit.mesh(rock(0.16, 6, 4, 41 + i, 0.12), body, elbow, 0, -0.08, 0);
    fore.scale.set(1, 1.15, 1);
    const fist = kit.mesh(rock(0.27, 8, 6, 51 + i, 0.14), body, elbow, 0, -0.27, 0.02);
    fist.scale.set(1.08, 0.92, 1.12);
    return { side, shoulder, arm, elbow };
  });

  // The head: a rock set forward and up on the boulder, its big glowing eyes on its brow facing
  // up (where the top camera sees them), a moss tuft on its crown behind them.
  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  head.position.set(0, HEAD_Y, HEAD_Z);
  squash.add(head);
  const skull = kit.mesh(rock(0.36, 9, 6, 7, 0.1), body, head, 0, 0.14, 0.02);
  skull.scale.set(1.22, 0.8, 1.02);
  const jaw = kit.mesh(rock(0.18, 6, 4, 9, 0.1), body, head, 0, 0.0, 0.14);
  jaw.scale.set(1.5, 0.6, 1);
  // A heavy brow ridge just behind the eyes: a golem's scowl from the side, out of their way above.
  const brow = kit.mesh(rock(0.13, 6, 4, 13, 0.08), body, head, 0, 0.46, -0.02);
  brow.scale.set(2.5, 0.6, 1.05);
  brow.rotation.x = 0.25;
  kit.mesh(
    mossOf(
      [
        [0.06, 0.52, -0.06, 0.08, 0],
        [-0.05, 0.51, -0.1, 0.065, 1],
        [0.15, 0.5, -0.1, 0.06, 2],
        [0.09, 0.54, -0.02, 0.05, 1],
      ],
      false,
    ),
    detail,
    head,
  );
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lid: body });
    e.ball.children[0].material = accent; // a glowing eye (the runes' glow), the pupil still dark
    e.socket.position.set(side * 0.2, 0.28, 0.21);
    e.socket.rotation.order = 'YXZ';
    e.socket.rotation.set(-1.15, side * 0.32, 0);
    head.add(e.socket);
    return e;
  });

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  /** Folds both arms over the chest by k (0..1). */
  function cross(o, k) {
    o.outR = lerp(o.outR, CROSS_OUT, k);
    o.outL = lerp(o.outL, CROSS_OUT, k);
    o.fwdR = lerp(o.fwdR, CROSS_FWD, k);
    o.fwdL = lerp(o.fwdL, CROSS_FWD + 0.1, k); // one a little over the other
    o.twR = lerp(o.twR, CROSS_TW, k);
    o.twL = lerp(o.twL, CROSS_TW, k);
    o.elbR = lerp(o.elbR, CROSS_ELB, k);
    o.elbL = lerp(o.elbL, CROSS_ELB, k);
  }

  /** Both fists up overhead by k (0..1). */
  function fistsUp(o, k) {
    o.outR = lerp(o.outR, 2.8, k);
    o.outL = lerp(o.outL, 2.8, k);
    o.fwdR = lerp(o.fwdR, -0.15, k);
    o.fwdL = lerp(o.fwdL, -0.15, k);
    o.elbR = lerp(o.elbR, 0.2, k);
    o.elbL = lerp(o.elbL, 0.2, k);
  }

  /** The reaction's pose at `t` into `o` (rest + reaction). */
  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // A crouch, a stomp-hop with both fists thrust overhead, then they pump in triumph and it
      // stomps once more; the runes blaze.
      o.squash = keys(t, CRIT_SQUASH);
      o.lift = 0.3 * Math.sin(Math.PI * span(t, 0.14, 0.38)) + 0.12 * bump(t, 0.6, 0.72);
      const up = plateau(t, 0.1, 0.94, 0.12);
      fistsUp(o, up);
      const pump = Math.sin(t * TAU * 5) * plateau(t, 0.38, 0.9, 0.06);
      o.outR += 0.28 * pump;
      o.outL += 0.28 * pump;
      o.elbR += 0.45 * Math.max(0, pump);
      o.elbL += 0.45 * Math.max(0, pump);
      const joy = plateau(t, 0.06, 0.95, 0.08);
      o.pitch = -0.12 * joy;
      o.headPitch = 0.08 * joy; // the eyes already face up: keep the face toward the table
      o.glow = lerp(0.5, 1, joy);
      o.upper = lerp(REST.upper, 0, joy);
      o.lower = lerp(0.08, 0.26, joy); // smiling eyes
      o.gazePitch = lerp(-0.3, 0.3, joy);
      o.eyeScale = 1 + 0.12 * joy;
    } else if (reaction === 'fumble') {
      // A crumbling slump that holds together: a shudder, the head rock slides askew, the right
      // shoulder sags, the arms hang limp and the runes dim.
      const droop = smooth(span(t, 0.05, 0.5));
      const shudder = Math.sin(t * TAU * 9) * bump(t, 0.02, 0.32);
      const sigh = bump(t, 0.62, 0.88);
      o.roll = -0.07 * droop + 0.04 * shudder;
      o.pitch = 0.08 * droop + 0.03 * sigh;
      o.squash = 0.1 * droop - 0.03 * sigh;
      o.headSlide = 0.09 * outBack(span(t, 0.12, 0.5), 2);
      o.headRoll = -0.38 * droop;
      o.headPitch = 0.3 * droop;
      o.headDrop = 0.04 * droop;
      o.sag = 0.13 * droop;
      o.outR = lerp(REST.outR, 0.1, droop);
      o.outL = lerp(REST.outR, 0.14, droop);
      o.fwdR = lerp(0.08, -0.05, droop);
      o.fwdL = lerp(0.08, 0.02, droop);
      o.elbR = lerp(0.22, 0.02, droop);
      o.elbL = lerp(0.22, 0.05, droop);
      o.glow = lerp(0.5, 0.05, droop);
      o.upper = lerp(REST.upper, 0.6, droop);
      o.lower = lerp(0.08, 0, droop);
      o.sad = 0.5 * droop;
      o.gazePitch = lerp(-0.3, -0.8, droop);
    } else if (reaction === 'mixed') {
      // Hm: the head tilts, the right fist comes up to scratch it, eyes from one die to the other.
      const tilt = outBack(span(t, 0.04, 0.32), 2) * (1 - smooth(span(t, 0.82, 1)));
      o.headRoll = 0.4 * tilt;
      o.headPitch = -0.05 * tilt;
      o.roll = 0.05 * tilt;
      o.outR = lerp(REST.outR, -0.5, tilt);
      o.fwdR = lerp(0.08, 2.7, tilt) + 0.12 * Math.sin(t * TAU * 6) * plateau(t, 0.3, 0.8, 0.06);
      o.twR = lerp(0, -0.9, tilt);
      o.elbR = lerp(0.22, 0.05, tilt) + 0.25 * Math.abs(Math.sin(t * TAU * 6)) * plateau(t, 0.3, 0.8, 0.06);
      o.upperR = 0.35 * tilt; // one eye squints
      o.sadL = 0.4 * tilt; // the other brow goes up
      o.upper = lerp(REST.upper, 0.1, tilt);
      o.gazeYaw = 0.45 * keys(t, K_LOOK);
      o.gazePitch = -0.3;
    } else {
      // Plain: arms folded, a slow, satisfied double nod.
      cross(o, plateau(t, 0.04, 0.94, 0.2));
      o.headPitch = 0.26 * bump(t, 0.16, 0.48) + 0.2 * bump(t, 0.48, 0.78);
      o.pitch = -0.05 * plateau(t, 0.1, 0.9, 0.2);
      const content = plateau(t, 0.08, 0.92, 0.12);
      o.upper = lerp(REST.upper, 0.52, content);
      o.lower = lerp(0.08, 0.32, content);
      o.glow = lerp(0.5, 0.75, content);
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  /** Slow breathing, the runes pulsing and a slow blink: layered on any grounded pose. */
  function idle(o, ms, amount = 1) {
    const s = Math.sin((ms / 2600) * TAU);
    o.squash += 0.018 * s * amount;
    o.outR += 0.03 * s * amount;
    o.outL += 0.03 * s * amount;
    o.headPitch += 0.025 * Math.sin((ms / 2600) * TAU + 1.2) * amount;
    o.roll += 0.015 * Math.sin((ms / 4100) * TAU) * amount; // a slow weight shift
    o.glow += 0.3 * Math.sin((ms / 1900) * TAU) * amount;
    const b = blink(ms * 0.8, 1700); // a slower blink
    o.upper += (1 - o.upper) * b;
    o.lower += (0.5 - o.lower) * b;
  }

  function pose(phase, t, reaction, look) {
    const ms = look?.now ?? nowMs();
    const yaw = look?.yaw || 0;
    if (phase === 'react') react(p, reaction, t, ms);
    else if (phase === 'exit') {
      // A heavy crouch and a hop out (the layer hops it), fists swinging up a little.
      if (t >= 1) PK.reset(p);
      else {
        react(end, reaction, 1);
        PK.reset(tmp);
        tmp.squash += 0.16 * bump(t, 0, 0.25) - 0.08 * bump(t, 0.2, 0.85) + 0.14 * bump(t, 0.85, 1);
        tmp.outR += 0.5 * bump(t, 0.15, 0.9);
        tmp.outL += 0.5 * bump(t, 0.15, 0.9);
        tmp.upper += -0.15 * bump(t, 0.1, 0.9);
        PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
      }
    } else if (phase === 'enter') {
      PK.reset(p);
      p.squash = -0.08 * bump(t, 0.05, 0.75) + 0.2 * bump(t, 0.72, 1);
      p.outR += 0.5 * bump(t, 0, 0.85);
      p.outL += 0.5 * bump(t, 0, 0.85);
      p.glow = 0.5 + 0.5 * bump(t, 0.7, 1);
      p.upper = 0.12;
    } else if (phase === 'move') {
      // A dodge: it stomps off in heavy alternating steps, rocking side to side over the planted
      // foot, fists swinging against the feet, leaning in. From and back to the standing pose.
      PK.reset(p);
      const run = plateau(t, 0.03, 0.97, 0.12);
      const g = t * TAU * STOMP_STEPS;
      const s = Math.sin(g);
      p.gait = g;
      p.stride = run;
      p.roll = -0.13 * s * run; // over the planted foot
      p.lift = 0.03 * Math.abs(s) * run;
      p.squash = 0.06 * (1 - Math.abs(s)) * run; // a thud on each footfall
      p.pitch = 0.1 * run;
      p.headRoll = 0.08 * s * run;
      p.fwdR = 0.08 - 0.4 * s * run;
      p.fwdL = 0.08 + 0.4 * s * run;
      p.outR = REST.outR + 0.1 * run;
      p.outL = REST.outR + 0.1 * run;
      p.upper = lerp(REST.upper, 0.4, run); // determined
      p.gazePitch = lerp(-0.3, -0.15, run);
    } else if (phase === 'pet') {
      // Petted: it rocks happily side to side, eyes shut with pleasure, fists rubbing its belly,
      // runes glowing warm (look.calm: smaller).
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.roll = 0.09 * k * Math.sin(t * TAU * 2) * on;
      p.headRoll = 0.18 * k * Math.sin(t * TAU * 2 + 0.6) * on;
      p.squash = 0.04 * k * Math.sin(t * TAU * 4) * on;
      p.fwdR += 0.9 * on;
      p.fwdL += 0.9 * on;
      p.outR += (-0.86 + 0.1 * k * Math.sin(t * TAU * 4)) * on;
      p.outL += (-0.86 - 0.1 * k * Math.sin(t * TAU * 4)) * on;
      p.elbR += -0.12 * on;
      p.elbL += -0.12 * on;
      p.glow = lerp(0.5, 0.9, on);
      p.upper = lerp(REST.upper, 0.75, on);
      p.lower = lerp(0.08, 0.5, on);
    } else if (phase === 'huff') {
      // Huffed: it folds its arms, puffs up and turns its head away, eyes narrowed.
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      cross(p, mad);
      p.squash = (-0.08 * bump(t, 0.05, 0.45) + 0.08 * bump(t, 0.4, 0.75)) * k;
      p.headYaw = 0.45 * mad;
      p.headPitch = -0.12 * mad;
      p.upper = lerp(REST.upper, 0.58, mad);
      p.gazeYaw = 0.5 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a heavy hop back off the heat, then it fans itself with one fist,
      // head back, eyes squinting (look.calm: slower, smaller).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.2 * k * bump(t, 0.02, 0.28);
      p.pitch = -0.1 * k * bump(t, 0.02, 0.3);
      p.outR = lerp(REST.outR, -0.6, on);
      p.fwdR = lerp(0.08, 1.7, on);
      p.twR = lerp(0, -1.4, on);
      p.elbR = lerp(0.22, 0.3 + 0.3 * k * Math.sin(t * TAU * (look?.calm ? 3 : 5)), on);
      p.headPitch = -0.18 * on;
      p.upper = lerp(REST.upper, 0.62, on);
    } else if (phase === 'shiver') {
      // Frozen (frost): arms hugged tight, hunched, shivering side to side, runes dim
      // (look.calm: a slower, smaller shiver).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      cross(p, on);
      p.roll = 0.06 * k * Math.sin(t * TAU * f) * on;
      p.headRoll = 0.05 * k * Math.sin(t * TAU * f * 1.3) * on;
      p.squash = 0.06 * on;
      p.headDrop = 0.05 * on;
      p.glow = lerp(0.5, 0.15, on);
      p.upper = lerp(REST.upper, 0.6, on);
    } else if (phase === 'bristle') {
      // Zapped (storm): stands tall, arms flung out stiff, eyes wide, runes crackling bright,
      // trembling (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.08 * on;
      p.outR = lerp(REST.outR, 1.1, on);
      p.outL = lerp(REST.outR, 1.1, on);
      p.elbR = lerp(0.22, 0, on);
      p.elbL = lerp(0.22, 0, on);
      p.roll = 0.035 * k * Math.sin(t * TAU * 10) * on;
      p.glow = lerp(0.5, 1, on) + 0.2 * k * Math.sin(t * TAU * 13) * on;
      p.eyeScale = 1 + 0.25 * on;
      p.upper = lerp(REST.upper, 0, on);
      p.lower = lerp(0.08, 0, on);
    } else if (phase === 'startle') {
      // Startled (any other element): a crouch, a heavy jump with its fists flung up, and a thud
      // of a landing (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      const air = span(t, 0.1, 0.5);
      p.lift = 0.45 * k * Math.sin(Math.PI * air);
      p.squash =
        0.14 * bump(t, 0, 0.12) - 0.08 * k * bump(t, 0.1, 0.5) + 0.16 * k * bump(t, 0.48, 0.66);
      p.outR += 1.1 * k * bump(t, 0.08, 0.6);
      p.outL += 1.1 * k * bump(t, 0.08, 0.6);
      p.eyeScale = 1 + 0.2 * wide;
      p.upper = lerp(REST.upper, 0, wide);
      p.lower = lerp(0.08, 0, wide);
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two heavy happy hops with both fists pumping overhead,
      // smiling eyes, runes bright (look.calm: one small hop, fists only half up). From and back
      // to the standing pose.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const two = calm ? 0 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const air1 = bump(t, 0.12, 0.42);
      const air2 = two * bump(t, 0.52, 0.82);
      p.lift +=
        0.32 * k * (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash +=
        k * (0.12 * bump(t, 0.02, 0.14) - 0.06 * air1 + 0.12 * bump(t, 0.42, 0.54)) +
        two * (0.1 * bump(t, 0.82, 0.95) - 0.06 * air2);
      fistsUp(p, (calm ? 0.45 : 1) * joy);
      p.outR += two * 0.25 * Math.sin(t * TAU * 4) * joy;
      p.outL += two * 0.25 * Math.sin(t * TAU * 4) * joy;
      p.headPitch += -0.25 * joy;
      p.glow = lerp(p.glow, 1, joy);
      p.upper = lerp(p.upper, 0, joy);
      p.lower = lerp(p.lower, 0.26, joy);
      p.gazePitch = lerp(p.gazePitch, 0.3, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: drawn up tall, arms folded, chest out, chin up, runes
      // aglow, a smug half-lidded look. Sulk: sunk low, head hung, arms hanging, runes dim.
      PK.reset(end); // the standing pose (exit at t 1)
      PK.reset(tmp);
      if (phase === 'proud') {
        cross(tmp, 1);
        tmp.squash = -0.1;
        tmp.pitch = -0.12;
        tmp.headPitch = -0.22;
        tmp.glow = 0.9;
        tmp.upper = 0.48;
        tmp.lower = 0.3;
        tmp.gazePitch = 0.05;
      } else {
        tmp.squash = 0.13;
        tmp.pitch = 0.1;
        tmp.headPitch = 0.55;
        tmp.headDrop = 0.1;
        tmp.sag = 0.06;
        tmp.outR = 0.12;
        tmp.outL = 0.12;
        tmp.elbR = 0.05;
        tmp.elbL = 0.05;
        tmp.glow = 0.1;
        tmp.upper = 0.62;
        tmp.sad = 0.5;
        tmp.gazePitch = -0.8;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.squash -= 0.05 * bump(t, 0.2, 0.8); // a puff on the way
    } else if (phase === 'throw') {
      PK.reset(p);
      // A two-handed lob: both fists swing back, then heave forward and up.
      p.fwdR = p.fwdL = keys(t, THROW_FWD);
      p.elbR = p.elbL = keys(t, THROW_ELB);
      p.outR = p.outL = REST.outR - 0.18 * bump(t, 0.25, 0.75);
      p.pitch = keys(t, THROW_PITCH);
      p.squash = keys(t, THROW_SQUASH);
      p.headPitch = -0.6 * p.pitch;
      p.upper = REST.upper - 0.12 * bump(t, 0.3, 0.8);
      p.gazePitch = -0.2;
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.headYaw += yaw * 0.5;
      p.gazeYaw += yaw * 0.8;
      p.yaw += yaw * 0.15;
    }
    apply(p);
  }

  function apply(o) {
    rig.position.y = o.lift; // design units: the scaler scales it
    rig.rotation.set(o.pitch, o.spin + o.yaw, o.roll);
    const sy = 1 - o.squash;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    squash.scale.set(sxz, sy, sxz);
    head.position.set(o.headSlide, HEAD_Y - o.headDrop, HEAD_Z);
    head.rotation.set(o.headPitch, o.headYaw, o.headRoll);
    const gl = Math.min(1.3, Math.max(0, o.glow));
    accent.emissiveIntensity = 0.2 + 0.7 * gl;
    runes.scale.setScalar(0.96 + 0.08 * gl);
    for (const a of arms) {
      const right = a.side > 0;
      a.shoulder.position.y = SH_Y - (right ? o.sag : 0);
      a.shoulder.rotation.z = right ? -1.2 * o.sag : 0;
      a.arm.rotation.set(
        -(right ? o.fwdR : o.fwdL),
        -a.side * (right ? o.twR : o.twL),
        a.side * (right ? o.outR : o.outL),
      );
      a.elbow.rotation.x = -(right ? o.elbR : o.elbL);
    }
    for (const f of feet) {
      const h = f.userData.home;
      const ph = o.gait + f.userData.pair;
      const s = Math.sin(ph);
      f.position.set(h.x, h.y + 0.16 * o.stride * Math.max(0, s), h.z + 0.14 * o.stride * Math.cos(ph));
    }
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      eyes[i].socket.scale.setScalar(o.eyeScale);
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

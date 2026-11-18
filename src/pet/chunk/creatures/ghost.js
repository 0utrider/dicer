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
 * The ghost: a friendly little sheet ghost, a round dome on a wavy scalloped hem whose tips just
 * touch the floor, two big oval eyes, a small "o" mouth, stubby arm nubs and rosy cheeks, with a
 * lighter lining glowing under the hem. Shy but mischievous. From above: a round dome ringed by
 * the scallops, the eyes and the cheeks.
 * Crit: it spins up with its arms raised and a wide "ooOO", the hem flaring; fumble: it deflates
 * into a droopy heap, eyes downcast, the hem collapsing; mixed: a shrug and a tilt, one eye
 * squinting; plain: a happy sway.
 */

const HEIGHT = 1.5;
const FOOT = 0.98; // top-down body radius in scene units (the hem, measured from the built geometry)
const R = 0.555; // body radius (design units)
const BODY_Y = 0.55; // where the dome starts
const TOPY = 1.05; // top of the dome
const HT = 0.44; // top of the hem band: its pivot (the hem hangs from here)
const SCALLOPS = 8;
const SCALLOP = 0.13; // how high the valleys between the hem's tips ride
const EYE_R = 0.15;
const REST_ARM = -0.2;

/** The body: a dome on slightly flared sides, tucked in at the bottom (inside the hem). */
function bodyGeometry() {
  const pts = [
    new THREE.Vector2(0.001, 0.2),
    new THREE.Vector2(0.42, 0.22),
    new THREE.Vector2(0.53, 0.27),
    new THREE.Vector2(0.575, 0.36),
    new THREE.Vector2(0.57, 0.46),
  ];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.001, R * Math.cos(a)), BODY_Y + (TOPY - BODY_Y) * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, 24);
}

/** The hem: a flared band with a thin inner lip, its edge cut into scallops (tips on y = 0). */
function hemGeometry() {
  const pts = [
    new THREE.Vector2(0.6, 0.07),
    new THREE.Vector2(0.66, 0),
    new THREE.Vector2(0.645, 0.14),
    new THREE.Vector2(0.605, 0.28),
    new THREE.Vector2(0.53, HT),
  ];
  const geo = new THREE.LatheGeometry(pts, SCALLOPS * 5);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const w = 0.5 + 0.5 * Math.cos(SCALLOPS * Math.atan2(x, z)); // 1 at a tip, 0 in a valley
    const f = 1 - smooth(Math.min(1, y / 0.26)); // the edge only
    const out = 1 + 0.05 * w * f;
    p.setXYZ(i, x * out, y + SCALLOP * (1 - w) * f, z * out);
  }
  geo.computeVertexNormals();
  return geo;
}

const REST = {
  lift: 0,
  squash: 0, // > 0 flatter, < 0 taller (the upper body, about its base)
  bob: 0, // the upper body floating up off the hem
  pitch: 0,
  roll: 0,
  spin: 0,
  yaw: 0,
  hemY: 1, // < 1 the hem collapses (its tips stay on the floor)
  hemXZ: 1, // > 1 the hem flares
  trail: 0, // + the hem's tips trail back
  twist: 0, // the scallops rippling round
  arm: REST_ARM, // both nubs: + raised
  armR: 0, // extra on the right nub
  upper: 0.15,
  lower: 0.06,
  upperR: 0,
  sad: 0,
  gazeYaw: 0,
  gazePitch: -0.25,
  open: 0.3, // the "o": 0 a dot .. 1 a wide "ooOO"
};
const PK = poseKit(REST);

// Keyframes, hoisted so a pose allocates nothing.
const K_GLANCE = [0.2, 0, 0.32, -1, 0.5, -1, 0.6, 1, 0.78, 1, 0.9, 0];
const THROW_PITCH = [0, 0, 0.32, -0.2, 0.52, 0.28, 0.75, -0.05, 1, 0];
const THROW_ARM = [0, 0, 0.32, 1.1, 0.5, -0.5, 0.75, 0.1, 1, 0];
const THROW_SQUASH = [0, 0, 0.32, -0.1, 0.52, 0.14, 0.75, -0.03, 1, 0];
const CRIT_SQUASH = [0, 0, 0.12, 0.22, 0.22, -0.16, 0.62, -0.08, 0.76, 0.16, 0.88, -0.03, 1, 0];

export function ghost(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.45, metalness: 0 }),
  );
  // The lining under the hem and the cheeks: seen from inside through the scallops too.
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.5,
      metalness: 0,
      side: THREE.DoubleSide,
      emissive: accentColor,
      emissiveIntensity: 0.25,
    }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'ghost';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  scaler.add(rig);

  // The hem hangs from its top ring: it twists (ripples), trails, flares and collapses there.
  const hem = new THREE.Group();
  rig.add(hem);
  const hemGeo = hemGeometry();
  kit.mesh(hemGeo, body, hem, 0, -HT, 0);
  const lining = kit.mesh(hemGeo, accent, hem, 0, -HT * 0.99, 0);
  lining.scale.set(0.95, 0.99, 0.95);

  // The upper body, squashed and stretched about its base, floats on the hem.
  const upper = new THREE.Group();
  rig.add(upper);
  kit.mesh(bodyGeometry(), body, upper, 0, -HT, 0);
  // The cartoon shine on the dome, toward the key light (up-left, front).
  const shine = kit.mesh(paint(new THREE.SphereGeometry(0.09, 8, 5), INK.white), detail, upper);
  shine.scale.set(1.5, 0.35, 0.8);
  shine.position.set(-0.27, 0.92 - HT, 0.12);
  shine.rotation.set(0.45, 0.6, 0.6);
  // Rosy cheeks under the eyes.
  for (const side of [1, -1]) {
    const cheek = kit.mesh(new THREE.SphereGeometry(0.075, 10, 6), accent, upper);
    cheek.position.set(side * 0.31, 0.6 - HT, 0.45);
    cheek.rotation.set(-0.2, side * 0.6, 0);
    cheek.scale.set(1, 0.6, 0.45);
  }

  const face = new THREE.Group();
  face.position.y = -HT;
  upper.add(face);
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lid: body, ring: false });
    e.socket.rotation.order = 'YXZ';
    e.socket.rotation.set(-0.5, side * 0.32, 0);
    e.socket.position.set(side * 0.19, 0.75, 0.41);
    e.socket.scale.set(0.9, 1.22, 1); // big ovals
    face.add(e.socket);
    return e;
  });
  // The "o": a dark oval that opens wide.
  const mouth = kit.mesh(paint(new THREE.CircleGeometry(0.06, 14), INK.mouth), detail, face);
  mouth.position.set(0, 0.57, 0.558);
  mouth.rotation.x = -0.15;

  // Stubby arm nubs, pivoting at the shoulder.
  const arms = [1, -1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.5, 0.5 - HT, 0.04);
    upper.add(pivot);
    const nub = kit.mesh(new THREE.SphereGeometry(0.12, 10, 6), body, pivot, side * 0.1, -0.03, 0);
    nub.scale.set(1.05, 0.75, 0.85);
    return pivot;
  });

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  /** The standing pose (exit at t 1). */
  function stand(o) {
    PK.reset(o);
    o.upper = 0.08;
    return o;
  }

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // It winds down, then spins up into the air, arms raised, hem flaring, "ooOO".
      const joy = plateau(t, 0.08, 0.95, 0.1);
      const flare = plateau(t, 0.16, 0.86, 0.14);
      o.squash = keys(t, CRIT_SQUASH);
      o.lift = 0.7 * Math.sin(Math.PI * span(t, 0.2, 0.74));
      o.spin = TAU * smooth(span(t, 0.2, 0.66));
      o.hemXZ = 1 + 0.2 * flare;
      o.hemY = 1 - 0.14 * flare;
      o.twist = -0.6 * bump(t, 0.2, 0.75);
      o.arm = lerp(REST_ARM, 1.35, joy);
      o.upper = lerp(0.15, 0, joy);
      o.lower = lerp(0.06, 0.35, joy);
      o.gazePitch = lerp(-0.25, 0.3, joy);
      o.open = lerp(0.3, 1, joy);
    } else if (reaction === 'fumble') {
      // A slow deflate into a droopy heap: the hem collapses, the arms droop, eyes downcast.
      const melt = smooth(span(t, 0.05, 0.6));
      const sigh = 0.03 * wobble(span(t, 0.6, 1), 1.2, 3) * melt;
      o.squash = 0.4 * melt + sigh;
      o.hemY = lerp(1, 0.52, melt);
      o.hemXZ = lerp(1, 1.12, melt);
      o.arm = lerp(REST_ARM, -0.75, melt);
      o.upper = lerp(0.15, 0.6, melt);
      o.lower = lerp(0.06, 0.02, melt);
      o.sad = 0.5 * melt;
      o.gazePitch = lerp(-0.25, -0.85, melt);
      o.open = lerp(0.3, 0.1, melt);
    } else if (reaction === 'mixed') {
      // A shrug and a tilt, one eye squinting, a sidelong glance.
      const tilt = outBack(span(t, 0.04, 0.3), 2) * (1 - smooth(span(t, 0.82, 1)));
      const shrug = bump(t, 0.14, 0.56);
      o.roll = 0.3 * tilt;
      o.squash = 0.05 * tilt;
      o.bob = 0.05 * shrug;
      o.arm = lerp(REST_ARM, 0.75, shrug);
      o.twist = 0.15 * tilt;
      o.upperR = 0.45 * tilt;
      o.upper = lerp(0.15, 0.05, tilt);
      o.gazeYaw = 0.45 * keys(t, K_GLANCE);
      o.open = lerp(0.3, 0.15, tilt);
    } else {
      // plain: a happy sway, the hem swishing a beat behind, smiling eyes.
      const content = plateau(t, 0.08, 0.92, 0.12);
      o.roll = 0.15 * Math.sin(t * TAU * 1.5) * content;
      o.twist = 0.3 * Math.sin(t * TAU * 1.5 - 0.9) * content;
      o.bob = 0.05 * bump(t, 0.1, 0.4);
      o.arm = lerp(REST_ARM, 0.15 + 0.2 * Math.sin(t * TAU * 3), content);
      o.upper = lerp(0.15, 0.45, content);
      o.lower = lerp(0.06, 0.35, content);
      o.open = lerp(0.3, 0.5, content);
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  function idle(o, ms, amount = 1) {
    const s = Math.sin((ms / 1700) * TAU);
    o.bob += 0.025 * (s + 1) * amount; // floats up off the hem, never below it
    o.squash -= 0.02 * s * amount;
    o.twist += 0.14 * Math.sin((ms / 2300) * TAU) * amount;
    o.hemY += 0.025 * Math.sin((ms / 1700) * TAU - 1.3) * amount;
    o.arm += 0.1 * Math.sin((ms / 1700) * TAU - 0.6) * amount;
    const b = blink(ms, 1730);
    o.upper += (1 - o.upper) * b;
    o.lower += (0.5 - o.lower) * b;
  }

  function pose(phase, t, reaction, look) {
    const ms = look?.now ?? nowMs();
    const yaw = look?.yaw || 0;
    if (phase === 'react') react(p, reaction, t, ms);
    else if (phase === 'exit') {
      react(end, reaction, 1);
      stand(tmp);
      tmp.bob = 0.08 * bump(t, 0.15, 0.85);
      tmp.twist = 0.3 * bump(t, 0.1, 0.9);
      const k = smooth(span(t, 0, 0.3));
      if (k >= 1) PK.blend(p, tmp, tmp, 0);
      else PK.blend(p, end, tmp, k);
    } else if (phase === 'enter') {
      // It fades up out of the floor: the hem first, then a pop of the dome, a shy peek.
      PK.reset(p);
      p.squash = 0.35 * (1 - smooth(span(t, 0, 0.6))) - 0.12 * bump(t, 0.55, 0.85);
      p.hemY = lerp(0.55, 1, smooth(span(t, 0, 0.55)));
      p.twist = 0.8 * (1 - smooth(span(t, 0, 0.9)));
      p.upper = 0.05;
      p.open = 0.3 + 0.5 * bump(t, 0.5, 0.9);
    } else if (phase === 'move') {
      // A dodge: it floats over (the layer lifts it in an arc), leaning into the flight, the hem
      // streaming behind and rippling, arms swept back, eyes bright. From and back to standing.
      PK.reset(p);
      const fly = plateau(t, 0.04, 0.96, 0.16);
      p.lift = (0.22 + 0.04 * Math.sin(t * TAU * 3)) * fly;
      p.pitch = 0.35 * fly;
      p.trail = 0.55 * fly;
      p.hemY = 1 - 0.08 * fly;
      p.twist = 0.25 * Math.sin(t * TAU * 3.5) * fly;
      p.squash = -0.06 * fly;
      p.arm = lerp(REST_ARM, -0.55, fly);
      p.upper = lerp(0.08, 0, fly);
      p.lower = lerp(0.06, 0.25, fly);
      p.gazePitch = lerp(-0.25, 0.05, fly);
      p.open = lerp(0.3, 0.55, fly);
    } else if (phase === 'pet') {
      // Petted: a shy, happy wiggle, eyes squeezed shut, cheeks up, the hem swishing (look.calm:
      // a smaller wiggle). From and back to the standing pose.
      stand(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.roll = 0.16 * k * Math.sin(t * TAU * 2) * on;
      p.twist = 0.35 * k * Math.sin(t * TAU * 2 - 1) * on;
      p.squash = 0.08 * k * Math.sin(t * TAU * 3) * on;
      p.arm = lerp(p.arm, 0.4, on);
      p.upper = lerp(0.08, 0.72, on);
      p.lower = lerp(0.06, 0.45, on);
      p.open = lerp(0.3, 0.6, on);
    } else if (phase === 'huff') {
      // Huffed: it puffs up tall, then blows out, eyes narrowed and looking away, arms down.
      stand(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.squash = (-0.16 * bump(t, 0.05, 0.45) + 0.14 * bump(t, 0.4, 0.75)) * k;
      p.hemXZ = 1 + 0.08 * k * bump(t, 0.05, 0.45);
      p.arm = lerp(REST_ARM, -0.55, mad);
      p.upper = lerp(0.08, 0.55, mad);
      p.gazeYaw = 0.7 * mad;
      p.open = lerp(0.3, 0.05, mad);
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a float back off the heat, then it fans itself with an arm, the hem
      // fluttering, eyes squinting, panting (look.calm: gentler).
      stand(p);
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.3 * k * bump(t, 0.02, 0.3);
      p.armR = (0.9 + 0.35 * k * Math.sin(t * TAU * 6)) * on;
      p.twist = 0.25 * k * Math.sin(t * TAU * 5) * on;
      p.hemXZ = 1 + 0.05 * k * Math.sin(t * TAU * 7) * on;
      p.upper = lerp(0.08, 0.6, on);
      p.lower = lerp(0.06, 0.3, on);
      p.open = lerp(0.3, 0.55 + 0.25 * Math.sin(t * TAU * 6), on);
    } else if (phase === 'shiver') {
      // Frozen (frost): it hunches low, arms hugged in, and shivers side to side (look.calm: a
      // slower, smaller shiver).
      stand(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.squash = 0.14 * on;
      p.hemY = 1 - 0.1 * on;
      p.roll = 0.08 * k * Math.sin(t * TAU * f) * on;
      p.twist = 0.12 * k * Math.sin(t * TAU * f + 1) * on;
      p.arm = lerp(REST_ARM, -0.6, on);
      p.upper = lerp(0.08, 0.55, on);
      p.lower = lerp(0.06, 0.3, on);
      p.open = lerp(0.3, 0.1, on);
    } else if (phase === 'bristle') {
      // Zapped (storm): it shoots up tall, hem flared stiff, arms out, eyes wide, mouth agape and
      // trembling (look.calm: no tremble).
      stand(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.22 * on + 0.04 * k * Math.sin(t * TAU * 10) * on;
      p.hemXZ = 1 + 0.15 * on;
      p.arm = lerp(REST_ARM, 0.9, on);
      p.upper = lerp(0.08, 0, on);
      p.lower = lerp(0.06, 0, on);
      p.gazePitch = lerp(-0.25, 0, on);
      p.open = lerp(0.3, 0.8, on);
    } else if (phase === 'startle') {
      // Startled (any other element): "eep!" a jump straight up, arms up, eyes wide, and a soft
      // landing (look.calm: a smaller jump).
      stand(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      p.lift = 0.65 * k * Math.sin(Math.PI * span(t, 0.1, 0.5));
      p.squash = 0.18 * bump(t, 0, 0.12) - 0.2 * k * bump(t, 0.1, 0.5) + 0.16 * k * bump(t, 0.48, 0.66);
      p.hemXZ = 1 + 0.12 * k * bump(t, 0.1, 0.5);
      p.arm = lerp(REST_ARM, 1.0, bump(t, 0.05, 0.6));
      p.upper = lerp(0.08, 0, wide);
      p.lower = lerp(0.06, 0, wide);
      p.gazePitch = lerp(-0.25, 0.1, wide);
      p.open = lerp(0.3, 0.7, wide);
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy floaty hops, arms waving, the hem flaring,
      // "ooo!" (look.calm: one small hop). From and back to the standing pose.
      stand(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      const air1 = Math.sin(Math.PI * span(t, 0.12, 0.42));
      const air2 = two * Math.sin(Math.PI * span(t, 0.52, 0.82));
      p.lift = 0.45 * k * (air1 + air2);
      p.squash = k * (0.14 * bump(t, 0.02, 0.14) - 0.1 * air1 + 0.12 * bump(t, 0.42, 0.54)) +
        two * (0.12 * bump(t, 0.82, 0.95) - 0.1 * air2);
      p.hemXZ += 0.12 * k * (air1 + air2);
      p.twist += 0.3 * k * Math.sin(t * TAU * 2) * joy;
      p.arm = lerp(p.arm, 1.1 + 0.3 * k * Math.sin(t * TAU * 4), joy);
      p.upper = lerp(p.upper, 0, joy);
      p.lower = lerp(p.lower, 0.4, joy);
      p.gazePitch = lerp(p.gazePitch, 0.3, joy);
      p.open = lerp(p.open, 0.8, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: drawn up tall, leaning back, arms on its sides, a smug
      // look. Sulk: deflated low, hem slumped, arms drooping, eyes down.
      stand(end);
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.squash = -0.14;
        tmp.bob = 0.04;
        tmp.arm = -0.45;
        tmp.upper = 0.42;
        tmp.lower = 0.32;
        tmp.gazePitch = 0.15;
        tmp.open = 0.15;
      } else {
        tmp.squash = 0.32;
        tmp.hemY = 0.72;
        tmp.hemXZ = 1.06;
        tmp.arm = -0.7;
        tmp.upper = 0.6;
        tmp.lower = 0.02;
        tmp.sad = 0.5;
        tmp.gazePitch = -0.8;
        tmp.open = 0.1;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.squash -= 0.06 * bump(t, 0.2, 0.8); // a puff on the way
    } else if (phase === 'throw') {
      // A fling: it rears back with its right nub wound up, then lunges and lets go, "o!".
      PK.reset(p);
      p.pitch = keys(t, THROW_PITCH);
      p.armR = keys(t, THROW_ARM);
      p.squash = keys(t, THROW_SQUASH);
      p.trail = -0.6 * keys(t, THROW_PITCH);
      p.open = 0.3 + 0.5 * bump(t, 0.4, 0.85);
      p.gazePitch = -0.15;
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.gazeYaw += yaw * 1.1;
      p.yaw += yaw * 0.45;
    }
    apply(p);
  }

  function apply(o) {
    rig.position.y = o.lift;
    rig.rotation.set(o.pitch, o.spin + o.yaw, o.roll);
    const hy = Math.max(0.2, o.hemY);
    const hxz = Math.max(0.2, o.hemXZ);
    // The hem hangs from its top ring, which rides at HT * hemY so its tips stay on the floor.
    hem.position.y = HT * hy;
    hem.scale.set(hxz, hy, hxz);
    hem.rotation.set(o.trail, o.twist, 0);
    const sy = Math.max(0.3, 1 - o.squash);
    const sxz = sy ** -0.4;
    upper.position.y = HT * hy + o.bob;
    upper.scale.set(sxz, sy, sxz);
    arms[0].rotation.z = o.arm + o.armR;
    arms[1].rotation.z = -o.arm;
    mouth.scale.set(0.7 + 0.9 * o.open, 0.6 + 1.4 * o.open, 1);
    for (let i = 0; i < 2; i++) {
      eyes[i].set(o.gazeYaw, o.gazePitch, o.upper + (i === 0 ? o.upperR : 0), o.lower, o.sad);
    }
  }

  PK.reset(p);
  apply(p);
  root.updateMatrixWorld(true);
  const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
  scaler.scale.setScalar(HEIGHT / h);

  return { root, height: HEIGHT, footprint: FOOT, pose, dispose: () => kit.dispose() };
}

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
  clamp01,
  blink,
  nowMs,
  paint,
  palette,
  poseKit,
  createKit,
  detailMaterial,
  bend,
  mergeFlat,
} from './parts.js';

/**
 * The skull: a floating skull familiar, grim but charming. A big round bone cranium tipped up
 * toward the camera, two dark sockets each holding a glowing orb (the lighter accent of the user
 * colour) with a dark pupil that looks around, bony brow lids, a little nose hole, a row of chunky
 * upper teeth and a separate hinged lower jaw with its own. Where a neck would be, a wisp of
 * spectral flame (the user colour) trails down and back to the floor, with three licks curling up
 * behind the skull. The bone stays bone-coloured.
 * It hovers: the flame stretches and shrinks so its tip stays on the floor under a bobbing skull.
 * Crit: it chatters its jaw with glee on little bobs and spins once, eyes blazing; fumble: the jaw
 * drops open and hangs, swinging, the glow dims and it sinks; mixed: a tilt, one brow down, the jaw
 * ajar, then a doubtful clack; plain: a content nod and one clack.
 */

const HEIGHT = 1.5;
const FOOT = 0.66; // top-down radius of the skull in scene units, the flame excluded (measured)
// Design units (scaled to HEIGHT at build).
const CY = 0.9; // the skull's centre
const BASE_PITCH = -0.5; // the face tipped up toward the top-down camera
const CR = 0.46; // the cranium
const SOCKET_R = 0.17;
const EYE = [0.21, 0.04, 0.24]; // a socket's centre (the left one; x mirrored)
const ORB_R = 0.085;
const HINGE = [0, -0.24, -0.03]; // the jaw's hinge, in the skull
const JAW_MAX = 0.55; // rad at jaw = 1
const JAW_REST = 0.05;
const BONE = new THREE.Color('#e9dfc4');
const TOOTH = new THREE.Color('#f6f1e2');
const HOLLOW = new THREE.Color('#1c151a');
// The flame's tail: joints from under the skull down, each segment SEG long, tapering.
const HZ = -0.04; // the skull sits a little back, so its jutting jaw and its crown balance over the origin
const FA = [0, CY - 0.38, -0.14]; // where it leaves the skull (in the rig)
const SEG = 0.2;
const TAIL_R = [0.2, 0.16, 0.1, 0.025];
const TAIL_A = [0.2, 0.45, 0.5]; // joint bends (rad, + sweeps back)
const TAIL_TRAIL = [0.5, 0.3, 0.1]; // more, streaming behind in flight
const FLAME_MIN = 0.3; // the tail's vertical stretch, to keep its tip on the floor
const FLAME_MAX = 1.4;
const FLOOR = 0.03; // the jaw stays this far over the floor
// Jaw probes for that (jaw-local): the chin and the two back corners.
const PROBES = [new THREE.Vector3(0, -0.4, 0.38), new THREE.Vector3(0.2, -0.39, 0.05), new THREE.Vector3(-0.2, -0.39, 0.05)];

const REST = {
  lift: 0,
  squash: 0, // > 0 flatter, < 0 taller (the skull only)
  pitch: 0, // + nods forward (the skull only: the flame stays upright)
  roll: 0,
  spin: 0,
  yaw: 0,
  headYaw: 0,
  jaw: JAW_REST, // 0 shut .. 1 open
  upper: 0.1, // brow lids: 0 open .. 1 shut (0.55 meets the lower)
  lower: 0.05,
  brow: 0, // > 0 sad (inner ends up), < 0 cross
  cock: 0, // one brow up, the other down (doubt)
  gazeYaw: 0,
  gazePitch: 0,
  glow: 1, // the orbs' glow (0 dark .. 1 .. brighter)
  orb: 1, // the orbs' size
  flame: 1, // the licks' size
  flare: 0, // the licks spread out
  wave: 0, // flame flicker amplitude, rad
  wt: 0, // its phase
  sway: 0, // the tail's sideways sway, rad
  st: 0,
  trail: 0, // 0..1 the tail streaming behind (flight)
};
const PK = poseKit(REST);

// Keyframes, hoisted so a pose allocates nothing.
const K_LOOK = [0.2, 0, 0.32, -1, 0.5, -1, 0.6, 1, 0.78, 1, 0.9, 0];
const K_MIXED_JAW = [0, JAW_REST, 0.2, 0.3, 0.72, 0.3, 0.8, 0, 0.9, 0.12, 1, JAW_REST];
const K_PLAIN_JAW = [0, JAW_REST, 0.3, 0.3, 0.42, 0, 0.55, 0.1, 1, JAW_REST];
const THROW_PITCH = [0, 0, 0.3, -0.32, 0.5, 0.3, 0.8, 0.05, 1, 0];
const THROW_JAW = [0, JAW_REST, 0.3, 1, 0.46, 1, 0.54, 0, 0.75, 0.2, 1, JAW_REST];
const THROW_LIFT = [0, 0, 0.3, 0.1, 0.5, -0.04, 1, 0];

/** A row of chunky teeth along an arch (x = A sin a, z = zc + B cos a), a gap on the midline. */
function teeth(A, B, zc, y, h, n) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const a = (i - (n - 1) / 2) * 0.36;
    const g = new THREE.BoxGeometry(0.064, h, 0.05);
    g.rotateY(a);
    g.translate(A * Math.sin(a), y, zc + B * Math.cos(a));
    list.push(paint(g, TOOTH));
  }
  const out = mergeFlat(list);
  for (const g of list) g.dispose();
  return out;
}

export function skull(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const flameMat = kit.mat(
    new THREE.MeshStandardMaterial({ color: bodyColor, emissive: bodyColor, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0 }),
  );
  const orbMat = kit.mat(
    new THREE.MeshStandardMaterial({ color: accentColor, emissive: bodyColor, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0 }),
  );
  // one shared detail material, told apart by vertex colour: the bone, the teeth, the dark hollows
  const detail = detailMaterial(kit);
  detail.roughness = 0.5;
  const bone = detail;
  const B = (g) => paint(g, BONE);

  const root = new THREE.Group();
  root.name = 'skull';
  const scaler = new THREE.Group();
  root.add(scaler);
  const base = new THREE.Group(); // lifts it so the flame's tip stands on y = 0
  scaler.add(base);
  const rig = new THREE.Group(); // the hover, and turns about the vertical
  base.add(rig);

  // The skull: nods, rolls and squashes about its own centre.
  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  head.position.set(0, CY, HZ);
  rig.add(head);
  // the cranium and the muzzle have the face's tilt baked in (their boxes stay tight); the rest
  // of the face hangs in a tilted group
  kit.mesh(B(new THREE.SphereGeometry(CR, 18, 12).scale(1, 0.93, 1.03).translate(0, 0.06, -0.05).rotateX(BASE_PITCH)), bone, head);
  kit.mesh(B(new THREE.SphereGeometry(1, 10, 6).scale(0.21, 0.16, 0.17).translate(0, -0.27, 0.2).rotateX(BASE_PITCH)), bone, head);
  const face = new THREE.Group();
  face.rotation.x = BASE_PITCH;
  face.updateMatrix();
  head.add(face);
  const cheekGeo = kit.geo(B(new THREE.SphereGeometry(1, 8, 5).scale(0.1, 0.06, 0.1)));
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(cheekGeo, bone);
    m.position.set(0.28 * s, -0.14, 0.2);
    face.add(m);
  }
  // the nose hole: an upside-down heart of three dark dots
  const noseGeo = kit.geo(paint(new THREE.SphereGeometry(0.034, 6, 4).scale(1, 1.2, 0.45), HOLLOW));
  for (const [x, y] of [
    [0.022, -0.178],
    [-0.022, -0.178],
    [0, -0.148],
  ]) {
    const m = new THREE.Mesh(noseGeo, detail);
    m.position.set(x, y, 0.352);
    face.add(m);
  }
  kit.mesh(teeth(0.19, 0.29, 0.04, -0.4, 0.085, 6), detail, face);

  // The eyes: a dark socket, a glowing orb with its pupil on a ball that turns with the gaze, and
  // bony brow lids (an upper and a lower shell round the socket).
  const socketGeo = kit.geo(paint(new THREE.SphereGeometry(SOCKET_R, 10, 6).scale(1, 1, 0.8), HOLLOW));
  const orbGeo = kit.geo(new THREE.SphereGeometry(ORB_R, 10, 6));
  const pupilGeo = kit.geo(paint(new THREE.SphereGeometry(ORB_R * 0.42, 6, 4).scale(1, 1, 0.4), INK.pupil));
  const upGeo = kit.geo(B(new THREE.SphereGeometry(SOCKET_R * 1.09, 10, 3, 0, TAU, 0, Math.PI / 2)));
  const loGeo = kit.geo(B(new THREE.SphereGeometry(SOCKET_R * 1.07, 10, 3, 0, TAU, Math.PI / 2, Math.PI / 2)));
  const eyes = [1, -1].map((side) => {
    const socket = new THREE.Group();
    socket.position.set(EYE[0] * side, EYE[1], EYE[2]);
    face.add(socket);
    socket.add(new THREE.Mesh(socketGeo, detail));
    const ball = new THREE.Group();
    ball.rotation.order = 'YXZ';
    socket.add(ball);
    const orb = new THREE.Group();
    orb.position.z = SOCKET_R - ORB_R + 0.01;
    ball.add(orb);
    orb.add(new THREE.Mesh(orbGeo, orbMat));
    const pupil = new THREE.Mesh(pupilGeo, detail);
    pupil.name = 'pupil';
    pupil.position.z = ORB_R * 0.93;
    orb.add(pupil);
    const upPivot = new THREE.Group();
    socket.add(upPivot);
    const up = new THREE.Mesh(upGeo, bone);
    upPivot.add(up);
    const lo = new THREE.Mesh(loGeo, bone);
    socket.add(lo);
    return { side, ball, orb, upPivot, up, lo };
  });

  // The lower jaw, on its hinge: an arch, two uprights to the hinge, a chin and its teeth.
  const jaw = new THREE.Group();
  jaw.position.set(HINGE[0], HINGE[1], HINGE[2]);
  face.add(jaw);
  const JY = -0.575 - HINGE[1]; // the arch's height, jaw-local
  const JZ = 0.04 - HINGE[2];
  kit.mesh(B(new THREE.TorusGeometry(0.19, 0.046, 5, 10, Math.PI).rotateX(Math.PI / 2).scale(1, 1, 1.5)), bone, jaw, 0, JY, JZ);
  kit.mesh(B(new THREE.SphereGeometry(1, 6, 4).scale(0.1, 0.05, 0.05)), bone, jaw, 0, JY - 0.01, JZ + 0.285);
  const up3 = new THREE.Vector3(0, 1, 0);
  for (const s of [1, -1]) {
    const from = new THREE.Vector3(0.19 * s, JY, JZ);
    const to = new THREE.Vector3(0.25 * s, 0, 0);
    const len = from.distanceTo(to);
    const g = new THREE.CylinderGeometry(0.036, 0.05, len, 6, 1).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up3, to.clone().sub(from).normalize()));
    kit.mesh(B(g), bone, jaw, from.x, from.y, from.z);
  }
  kit.mesh(teeth(0.185, 0.282, JZ, -0.497 - HINGE[1], 0.08, 6), detail, jaw);

  // The flame. Its tail: tapered segments, each ending in a ball the next starts from, in a group
  // stretched vertically so the tip stays on the floor. Its licks: three bent cones curling up
  // behind the skull.
  const tailRoot = new THREE.Group();
  tailRoot.position.set(FA[0], FA[1], FA[2]);
  rig.add(tailRoot);
  const tail = [];
  let parent = tailRoot;
  let bent = 0; // the rest bend so far: baked into each segment's geometry, so its box stays tight
  for (let j = 0; j < TAIL_A.length; j++) {
    const jt = new THREE.Group();
    if (j > 0) jt.position.set(0, -SEG * Math.cos(bent), -SEG * Math.sin(bent));
    bent += TAIL_A[j];
    parent.add(jt);
    const tube = new THREE.CylinderGeometry(TAIL_R[j], TAIL_R[j + 1], SEG, 7, 1, true).translate(0, -SEG / 2, 0);
    const knob = new THREE.SphereGeometry(TAIL_R[j + 1], 7, 4).translate(0, -SEG, 0);
    const cap = j === 0 ? new THREE.SphereGeometry(TAIL_R[0], 7, 4) : null;
    const parts = cap ? [tube, knob, cap] : [tube, knob];
    jt.add(new THREE.Mesh(kit.geo(mergeFlat(parts).rotateX(bent)), flameMat));
    for (const g of parts) g.dispose();
    tail.push(jt);
    parent = jt;
  }
  const lickGeo = bend(new THREE.ConeGeometry(0.115, 0.6, 7, 4).translate(0, 0.3, 0), 0.6, 1.0);
  // each lick: its root (in the rig), the way it leaves (the cone's axis) and the way it curls
  const licks = [
    [[0.24, FA[1] + 0.02, -0.3], [0.85, 0.15, -0.5], [0, 1, 0]],
    [[-0.24, FA[1] + 0.02, -0.3], [-0.85, 0.15, -0.5], [0, 1, 0]],
    [[0, FA[1], -0.34], [0, 0.1, -1], [0, 1, 0]],
  ].map(([at, dir, curl]) => {
    const pivot = new THREE.Group();
    pivot.position.set(at[0], at[1], at[2]);
    rig.add(pivot);
    const a = new THREE.Vector3(...dir).normalize();
    const b = new THREE.Vector3(...curl);
    b.addScaledVector(a, -b.dot(a)).normalize();
    // (its direction baked into its geometry, so its box stays tight)
    const g = lickGeo.clone().applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(a, b), a, b));
    pivot.add(new THREE.Mesh(kit.geo(g), flameMat));
    return pivot;
  });
  lickGeo.dispose();

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();
  const M = new THREE.Matrix4();
  const V = new THREE.Vector3();
  let fitted = false; // the floor is known once it is built

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // Glee: the jaw chatters on little bobs, one spin, the eyes blaze and the flame flares.
      const joy = plateau(t, 0.05, 0.95, 0.08);
      const chat = 0.5 - 0.5 * Math.cos(t * TAU * 10);
      o.jaw = lerp(JAW_REST, 0.12 + 0.78 * chat, joy);
      o.lift = (0.08 + 0.16 * Math.abs(Math.sin(t * TAU * 3))) * joy;
      o.spin = t < 0.7 ? TAU * smooth(span(t, 0.28, 0.7)) : 0; // a whole turn: it lands where it began
      o.pitch = -0.14 * joy;
      o.roll = 0.1 * Math.sin(t * TAU * 3) * joy;
      o.upper = lerp(0.1, 0, joy);
      o.lower = lerp(0.05, 0.22, joy);
      o.glow = lerp(1, 1.7, joy);
      o.orb = lerp(1, 1.18, outBack(span(t, 0.05, 0.25), 2.5) * joy);
      o.flame = lerp(1, 1.35, joy);
      o.flare = joy;
      o.wave = 0.3 * joy;
      o.wt = t * TAU * 5;
    } else if (reaction === 'fumble') {
      // The jaw drops open and hangs, swinging; the glow dims and it sinks.
      const drop = outBack(span(t, 0.04, 0.26), 2.2);
      const sink = smooth(span(t, 0.12, 0.6));
      o.jaw = lerp(JAW_REST, 1.12, drop) + 0.07 * Math.sin(t * TAU * 2.5) * (1 - 0.6 * sink) * smooth(span(t, 0.26, 0.4));
      o.glow = lerp(1, 0.18, sink);
      o.orb = lerp(1, 0.78, sink);
      o.lift = -0.2 * sink;
      o.pitch = 0.16 * sink;
      o.upper = lerp(0.1, 0.33, sink);
      o.brow = 0.3 * sink;
      o.gazePitch = -0.3 * sink;
      o.flame = lerp(1, 0.55, sink);
      o.roll = 0.04 * Math.sin(t * TAU * 1.5) * sink;
      o.sway = 0.05 * sink;
    } else if (reaction === 'mixed') {
      // Doubt: a tilt, one brow down, the jaw ajar and a sideways look; then one dry clack.
      const tilt = outBack(span(t, 0.04, 0.3), 2) * (1 - smooth(span(t, 0.82, 1)));
      o.roll = 0.24 * tilt;
      o.cock = tilt;
      o.upper = lerp(0.1, 0.2, tilt);
      o.jaw = keys(t, K_MIXED_JAW);
      o.gazeYaw = 0.4 * keys(t, K_LOOK);
      o.orb = lerp(1, 0.9, tilt);
      o.sway = 0.12 * tilt;
      o.st = t * TAU * 2;
    } else {
      // plain: a content nod, one clack, a warmer glow.
      const content = plateau(t, 0.08, 0.92, 0.12);
      o.pitch = 0.16 * bump(t, 0.12, 0.5);
      o.jaw = keys(t, K_PLAIN_JAW);
      o.lift = 0.08 * bump(t, 0.1, 0.6);
      o.lower = lerp(0.05, 0.2, content);
      o.glow = lerp(1, 1.25, content);
      o.sway = 0.08 * content;
      o.st = t * TAU;
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  function idle(o, ms, amount = 1) {
    // A slow hover (the flame stretches under it), a flickering flame, a drifting gaze, a blink
    // and now and then a small idle clack of the jaw.
    o.lift += 0.035 * (1 - Math.cos((ms / 1900) * TAU)) * amount;
    o.roll += 0.025 * Math.sin((ms / 3100) * TAU) * amount;
    o.sway += 0.1 * amount;
    o.st += (ms / 2300) * TAU;
    o.wave += 0.14 * amount;
    o.wt += (ms / 700) * TAU;
    o.gazeYaw += 0.12 * Math.sin((ms / 4100) * TAU) * amount;
    o.gazePitch += 0.06 * Math.sin((ms / 3300) * TAU) * amount;
    o.glow += 0.08 * Math.sin((ms / 1300) * TAU) * amount;
    o.jaw += 0.3 * bump(((ms + 900) % 5200) / 5200, 0.9, 0.96) * amount;
    const b = blink(ms, 2300);
    o.upper += (0.56 - o.upper) * b;
    o.lower += (0.46 - o.lower) * b;
  }

  function pose(phase, t, reaction, look) {
    const ms = look?.now ?? nowMs();
    const yaw = look?.yaw || 0;
    if (phase === 'react') react(p, reaction, t, ms);
    else if (phase === 'exit') {
      react(end, reaction, 1);
      PK.reset(tmp);
      tmp.lift = 0.1 * bump(t, 0.2, 0.85);
      tmp.jaw = JAW_REST + 0.3 * bump(t, 0.55, 0.75); // a clack as it settles
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      // Rises out of its flame, eyes kindling, and clacks its jaw twice in greeting.
      PK.reset(p);
      const on = bump(t, 0, 0.9);
      p.lift = 0.24 * bump(t, 0.05, 0.8) - 0.04 * bump(t, 0.8, 1);
      p.glow = lerp(0.2, 1, smooth(span(t, 0, 0.4))) + 0.4 * on;
      p.jaw = JAW_REST + 0.7 * (bump(t, 0.35, 0.5) + bump(t, 0.55, 0.7));
      p.flame = 1 + 0.3 * on;
      p.flare = on;
      p.wave = 0.3 * on;
      p.wt = t * TAU * 3;
      p.upper = lerp(0.1, 0.02, on);
    } else if (phase === 'move') {
      // A dodge: it floats across, leaning into the flight, jaw a little open, the flame
      // streaming behind; then settles back over it. Starts and ends on the standing pose.
      PK.reset(p);
      const fly = plateau(t, 0.04, 0.96, 0.14);
      p.lift = 0.2 * fly;
      p.squash = 0.06 * bump(t, 0, 0.14) - 0.05 * fly + 0.06 * bump(t, 0.86, 1);
      p.pitch = 0.22 * fly;
      p.jaw = lerp(JAW_REST, 0.3, fly);
      p.upper = lerp(0.1, 0.02, fly);
      p.orb = lerp(1, 1.1, fly);
      p.trail = fly;
      p.flare = 0.6 * fly;
      p.wave = 0.35 * fly;
      p.wt = t * TAU * 3;
    } else if (phase === 'pet') {
      // Petted: a happy wiggle, eyes squeezed into crescents, a soft purring chatter, a warm glow
      // (look.calm, reduced motion: a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.roll = 0.18 * k * Math.sin(t * TAU * 2) * on;
      p.squash = 0.05 * k * Math.sin(t * TAU * 3) * on;
      p.lift = 0.06 * k * on;
      p.upper = lerp(0.1, 0.3, on);
      p.lower = lerp(0.05, 0.42, on);
      p.jaw = JAW_REST + 0.2 * k * (0.5 - 0.5 * Math.cos(t * TAU * 8)) * on;
      p.glow = lerp(1, 1.4, on);
      p.wave = 0.25 * k * on;
      p.wt = t * TAU * 3;
      p.flare = 0.4 * on;
    } else if (phase === 'huff') {
      // Huffed: brows down, jaw clenched, it turns away with a puff of flame.
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.squash = (-0.1 * bump(t, 0.05, 0.45) + 0.06 * bump(t, 0.4, 0.75)) * k;
      p.upper = lerp(0.1, 0.36, mad);
      p.lower = lerp(0.05, 0.22, mad);
      p.brow = -0.45 * mad;
      p.jaw = lerp(JAW_REST, 0, mad);
      p.headYaw = 0.45 * mad;
      p.gazeYaw = 0.3 * mad;
      p.pitch = -0.08 * mad;
      p.flame = 1 + 0.4 * k * bump(t, 0.05, 0.5);
      p.flare = bump(t, 0.05, 0.5);
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop up off the heat, then it pants, jaw flapping to fan itself,
      // squinting (look.calm: slower, smaller).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.3 * k * bump(t, 0.02, 0.28) + 0.06 * on;
      p.upper = lerp(0.1, 0.4, on);
      p.lower = lerp(0.05, 0.3, on);
      p.jaw = lerp(JAW_REST, 0.5 + 0.4 * k * Math.sin(t * TAU * (look?.calm ? 3 : 6)), on);
      p.pitch = -0.12 * on;
      p.flame = lerp(1, 0.7, on);
      p.wave = 0.25 * k * on;
      p.wt = t * TAU * 4;
    } else if (phase === 'shiver') {
      // Frozen (frost): it hunches low over a guttering flame and its teeth chatter (look.calm: a
      // slower, smaller chatter).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = -0.08 * on;
      p.squash = 0.05 * on;
      p.roll = 0.06 * k * Math.sin(t * TAU * f) * on;
      p.jaw = JAW_REST + 0.22 * k * (0.5 - 0.5 * Math.cos(t * TAU * f * 1.5)) * on;
      p.upper = lerp(0.1, 0.4, on);
      p.lower = lerp(0.05, 0.34, on);
      p.glow = lerp(1, 0.6, on);
      p.orb = lerp(1, 0.85, on);
      p.flame = lerp(1, 0.5, on);
    } else if (phase === 'bristle') {
      // Zapped (storm): it shoots up, the flame spiking out, eyes wide with pinpoint orbs, jaw
      // clenched and trembling (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.lift = 0.14 * on;
      p.squash = -0.08 * on;
      p.roll = 0.05 * k * Math.sin(t * TAU * 10) * on;
      p.upper = lerp(0.1, -0.02, on);
      p.lower = lerp(0.05, 0, on);
      p.orb = lerp(1, 0.6, on);
      p.glow = lerp(1, 1.6, on);
      p.jaw = lerp(JAW_REST, 0.1 + 0.08 * k * Math.sin(t * TAU * 16), on);
      p.flame = lerp(1, 1.5, on);
      p.flare = 1.4 * on;
    } else if (phase === 'startle') {
      // Startled (any other element): a jump straight up, jaw dropped, orbs shrunk, the flame
      // flaring, and it floats back down (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      p.lift = 0.5 * k * Math.sin(Math.PI * span(t, 0.08, 0.6));
      p.squash = 0.08 * bump(t, 0, 0.1) - 0.08 * k * bump(t, 0.08, 0.5);
      p.upper = lerp(0.1, -0.02, wide);
      p.lower = lerp(0.05, 0, wide);
      p.orb = lerp(1, 0.65, wide);
      p.jaw = lerp(JAW_REST, 1, bump(t, 0, 0.85));
      p.pitch = -0.15 * bump(t, 0.02, 0.6);
      p.flare = bump(t, 0.05, 0.7);
      p.flame = 1 + 0.3 * bump(t, 0.05, 0.7);
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy bobs up, a clack on each, eyes bright
      // (look.calm: one small bob). From and back to the standing pose.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      p.lift = 0.36 * k * (Math.sin(Math.PI * span(t, 0.1, 0.45)) + two * Math.sin(Math.PI * span(t, 0.52, 0.88)));
      p.squash = 0.05 * k * (bump(t, 0, 0.12) + two * bump(t, 0.45, 0.55));
      p.jaw = JAW_REST + 0.8 * (bump(t, 0.12, 0.42) + two * bump(t, 0.54, 0.84));
      p.lower = lerp(0.05, 0.24, joy);
      p.glow = lerp(1, 1.5, joy);
      p.orb = lerp(1, 1.12, joy);
      p.pitch = 0 - 0.14 * joy; // never -0: the pose at t 0 is the standing pose exactly
      p.flame = lerp(1, 1.25, joy);
      p.flare = 0.8 * joy;
      p.wave = (calm ? 0.12 : 0.35) * joy;
      p.wt = t * TAU * (calm ? 2 : 4);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: floating higher, chin up, a smug half-lidded grin over a
      // tall flame. Sulk: sunk low, face down under heavy brows, the glow and the flame low.
      PK.reset(end); // the standing pose (exit at t 1)
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.lift = 0.14;
        tmp.pitch = -0.16;
        tmp.upper = 0.3;
        tmp.lower = 0.2;
        tmp.jaw = 0;
        tmp.glow = 1.3;
        tmp.gazePitch = 0.12;
        tmp.flame = 1.3;
        tmp.flare = 0.5;
      } else {
        tmp.lift = -0.24;
        tmp.squash = 0.1;
        tmp.pitch = 0.2;
        tmp.upper = 0.36;
        tmp.lower = 0.12;
        tmp.brow = 0.3;
        tmp.jaw = 0.14;
        tmp.glow = 0.45;
        tmp.orb = 0.85;
        tmp.gazePitch = -0.25;
        tmp.flame = 0.55;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.squash -= 0.05 * bump(t, 0.2, 0.8); // a puff on the way
    } else if (phase === 'throw') {
      // Rears back with its jaw wide, then lunges and snaps it shut: it spits the dice out.
      PK.reset(p);
      p.pitch = keys(t, THROW_PITCH);
      p.jaw = keys(t, THROW_JAW);
      p.lift = keys(t, THROW_LIFT);
      p.upper = lerp(0.1, 0.24, bump(t, 0.1, 0.5));
      p.brow = -0.2 * bump(t, 0.1, 0.6);
      p.flare = bump(t, 0.4, 0.8);
      p.gazePitch = -0.1;
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.gazeYaw += yaw * 0.55;
      p.headYaw += yaw * 0.5;
      p.yaw += yaw * 0.1;
    }
    apply(p);
  }

  function apply(o) {
    rig.position.y = o.lift;
    rig.rotation.y = o.spin + o.yaw;
    head.rotation.set(o.pitch, o.headYaw, o.roll);
    const sy = Math.max(0.5, 1 - o.squash);
    const sxz = 1 / Math.sqrt(sy);
    head.scale.set(sxz, sy, sxz);
    jaw.rotation.x = Math.min(1.3, Math.max(0, o.jaw)) * JAW_MAX;
    const glow = Math.max(0, o.glow);
    orbMat.emissiveIntensity = 0.6 * glow;
    orbMat.color.copy(accentColor).multiplyScalar(Math.min(1, 0.3 + 0.7 * glow));
    const orb = Math.max(0.3, o.orb);
    for (const e of eyes) {
      e.ball.rotation.set(-o.gazePitch, o.gazeYaw, 0);
      e.orb.scale.setScalar(orb);
      // the cocked brow: the left one up, the right one down
      const upper = Math.min(1, Math.max(-0.05, o.upper + o.cock * (e.side > 0 ? -0.08 : 0.22)));
      e.up.rotation.x = -Math.PI / 2 + upper * Math.PI;
      e.upPivot.rotation.z = -e.side * (o.brow + o.cock * (e.side > 0 ? 0 : -0.3));
      e.lo.rotation.x = Math.PI / 2 - clamp01(o.lower) * Math.PI * 0.98;
    }
    // The jaw stays over the floor: a sunk, nodding, gaping skull is lifted just enough.
    if (fitted) {
      head.updateMatrix();
      jaw.updateMatrix();
      M.multiplyMatrices(head.matrix, face.matrix).multiply(jaw.matrix);
      let low = Infinity;
      for (const q of PROBES) low = Math.min(low, V.copy(q).applyMatrix4(M).y);
      low += rig.position.y + base.position.y;
      if (low < FLOOR) rig.position.y += FLOOR - low;
    }
    // The tail: swept back, swaying, and stretched so its tip rests on the floor.
    let cum = 0;
    let depth = 0;
    let drop = TAIL_R[0];
    for (let j = 0; j < tail.length; j++) {
      const a = TAIL_TRAIL[j] * o.trail + 0.5 * o.wave * Math.sin(o.wt - j * 0.9); // on top of the rest bend
      tail[j].rotation.set(a, 0, o.sway * Math.sin(o.st + j * 1.1));
      cum += TAIL_A[j] + a;
      depth += SEG * Math.cos(cum);
      drop = Math.max(drop, depth + TAIL_R[j + 1]); // the lowest of the joints' balls
    }
    const over = rig.position.y + base.position.y + FA[1]; // the tail's root over the floor
    tailRoot.scale.y = Math.min(FLAME_MAX, Math.max(FLAME_MIN, over / drop));
    // The licks: flickering, bigger and wider when it flares.
    const size = Math.max(0.2, o.flame);
    for (let i = 0; i < licks.length; i++) {
      const f = Math.sin(o.wt + i * 2.1);
      licks[i].scale.set(size, size * (1 + 0.25 * o.wave * f), size);
      licks[i].rotation.set(o.wave * 0.6 * f - 0.25 * o.flare, 0, (i === 0 ? -1 : i === 1 ? 1 : 0) * 0.3 * o.flare + o.wave * 0.4 * Math.cos(o.wt + i * 1.3));
    }
  }

  // Fit: the tail's tip on y = 0 at rest (the tail unstretched), the crown at HEIGHT.
  PK.reset(p);
  apply(p);
  let drop = TAIL_R[0];
  let depth = 0;
  let cum = 0;
  for (let j = 0; j < TAIL_A.length; j++) {
    cum += TAIL_A[j];
    depth += SEG * Math.cos(cum);
    drop = Math.max(drop, depth + TAIL_R[j + 1]);
  }
  base.position.y = drop - FA[1];
  fitted = true;
  apply(p);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  scaler.scale.setScalar(HEIGHT / box.max.y);

  return { root, height: HEIGHT, footprint: FOOT, pose, dispose: () => kit.dispose() };
}

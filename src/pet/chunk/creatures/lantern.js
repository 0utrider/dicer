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
  mergeFlat,
} from './parts.js';

/**
 * The lantern: a chochin-obake, a paper-lantern yokai floating a little above the floor. A round
 * ribbed paper body (the user colour, lit from inside with a gently pulsing glow) between a dark
 * lacquer cap and base ring, a wire handle loop on top and a red tassel hanging from the base whose
 * tips brush the floor. One big eye high in the middle and a wide mouth split along a rib, a long
 * pink tongue lolling out of it; the glowing inside shows when the mouth opens. The whole lantern
 * hangs tipped back, its face up toward the top-down camera. From above: the handle loop over the
 * dark cap, the ribs as rings, the big eye and the tongue. Mischievous and a bit spooky.
 * Crit: it flares bright and spins round once, mouth wide, tongue flapping; fumble: the glow dims,
 * the paper sags and crumples, the tongue droops; mixed: a tilt and a squint of its one eye; plain:
 * a happy bob and a tongue wag. Throw: it flicks the dice with its tongue.
 */

const HEIGHT = 1.5;
const FOOT = 0.73; // top-down body radius in scene units (the paper), tongue and tassel excluded (measured)
// Design units (scaled to HEIGHT at build).
const R = 0.69; // the paper's widest radius
const H2 = 0.46; // the paper's half height
const K_END = 0.75; // how much the paper narrows toward the cap and base (r = R * sqrt(1 - K y^2))
const CY = 0.66; // the body's centre over the rig's origin
const TILT = 0.8; // the body tipped back (rad), its face up toward the camera
const MY = -0.115; // the mouth's split (body-local y), on a rib
const LIP = 0.004; // the gap either side of the split
// Bamboo ribs (body-local y): the paper bulges a little between them (the cap and base hide the ends).
const RIBS_UP = [MY + LIP, 0, 0.115, 0.23, 0.345];
const RIBS_LO = [-0.345, -0.23];
const EDGES_UP = [...RIBS_UP, H2];
const EDGES_LO = [-H2, ...RIBS_LO, MY - LIP];
const SEGS = 16;
const EYE_R = 0.22;
const EYE_Y = 0.2;
const JAW0 = 0.06; // the mouth a little open at rest (the tongue lolls out)
// The tongue's rest bend at each joint (+ down, rad, in the tipped-back body): out over the lip,
// then lolling down at the tip.
const T_BEND = [1.0, 0.22, 0.55];
const T_DROOP = [0.4, 0.5, 0.6]; // share of a droop per joint
const T_SEG = 0.2;
const CORD = 0.24; // the tassel's cord, down to its knot
const V = new THREE.Vector3(); // scratch (poses allocate nothing)
const W = new THREE.Vector3();

const LACQUER = new THREE.Color('#2a1c17');
const BAMBOO = new THREE.Color('#8a5a2e');
const WIRE = new THREE.Color('#3b3532');
const TASSEL = new THREE.Color('#a8231f');
const TASSEL_KNOT = new THREE.Color('#d9a53a');
const IRIS = new THREE.Color('#f0a02a');

/** The paper's radius at body-local y: a round lantern with a soft bulge between each pair of ribs. */
function paperR(y, edges) {
  let bulge = 0;
  for (let i = 0; i + 1 < edges.length; i++) {
    const a = edges[i];
    const b = edges[i + 1];
    if (y >= a && y <= b) bulge = Math.sin((Math.PI * (y - a)) / (b - a));
  }
  return R * Math.sqrt(Math.max(0.05, 1 - K_END * (y / H2) ** 2)) * (1 + 0.05 * bulge);
}
/** A lathe of the paper between edges[0] and edges[n-1], 3 rows per gap. */
function paperGeometry(edges) {
  const pts = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    for (let k = 0; k < 3; k++) {
      const y = edges[i] + ((edges[i + 1] - edges[i]) * k) / 3;
      pts.push(new THREE.Vector2(paperR(y, edges), y));
    }
  }
  const yl = edges[edges.length - 1];
  pts.push(new THREE.Vector2(paperR(yl, edges), yl));
  return new THREE.LatheGeometry(pts, SEGS);
}
/** The bamboo ribs at the given heights, one merged geometry. */
function ribGeometry(ys) {
  const list = ys.map((y) =>
    paint(
      new THREE.TorusGeometry(R * Math.sqrt(1 - K_END * (y / H2) ** 2) + 0.001, 0.008, 3, SEGS)
        .rotateX(Math.PI / 2)
        .translate(0, y, 0),
      BAMBOO,
    ),
  );
  const g = mergeFlat(list);
  for (const x of list) x.dispose();
  return g;
}

const REST = {
  lift: 0,
  squash: 0, // > 0 flatter (the paper sagging), < 0 taller (stretched)
  crumple: 0, // 0..1 the paper crumpling lopsided
  pitch: 0,
  roll: 0,
  spin: 0,
  yaw: 0,
  jaw: JAW0, // the mouth's opening (rad)
  tongue: 1, // tongue length (x)
  droop: 0, // + the tongue hangs lower, - curls up
  wag: 0, // the tongue swinging side to side (rad)
  tassel: 0, // the tassel's swing (rad)
  glow: 0.1, // the light inside
  upper: 0.14,
  lower: 0.05,
  sad: 0,
  gazeYaw: 0,
  gazePitch: -0.1,
};
const PK = poseKit(REST);

// Keyframes, hoisted so a pose allocates nothing.
const CRIT_SQUASH = [0, 0, 0.12, 0.2, 0.22, -0.16, 0.62, -0.08, 0.76, 0.14, 0.88, -0.03, 1, 0];
const THROW_DROOP = [0, 0, 0.3, -1.1, 0.48, 0.9, 0.7, 0.2, 1, 0];
const THROW_TONGUE = [0, 1, 0.3, 1.2, 0.48, 1.7, 0.7, 1.3, 1, 1];
const THROW_PITCH = [0, 0, 0.3, -0.12, 0.48, 0.22, 0.75, 0.04, 1, 0];
const THROW_JAW = [0, JAW0, 0.25, 0.28, 0.6, 0.24, 1, JAW0];

export function lantern(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  // The paper, lit from inside (its glow pulses with the pose).
  const body = kit.mat(
    new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.7,
      metalness: 0,
      emissive: bodyColor,
      emissiveIntensity: REST.glow,
    }),
  );
  // The glowing inside, seen when the mouth opens.
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.6,
      metalness: 0,
      emissive: accentColor,
      emissiveIntensity: 1,
      side: THREE.DoubleSide,
    }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'lantern';
  const scaler = new THREE.Group();
  root.add(scaler);
  const base = new THREE.Group(); // lifts it so the tassel's tips touch y = 0 (fitted below)
  scaler.add(base);
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  base.add(rig);
  // The paper breathes, sags and stretches (squash) upright from just under its low bulge, so a
  // stretch never pushes it through the floor and a sag sinks it; inside, the lantern's body is
  // tipped back toward the camera (frame).
  const squash = new THREE.Group();
  squash.position.y = CY - 0.58;
  rig.add(squash);
  const frame = new THREE.Group();
  frame.position.y = 0.58;
  frame.rotation.x = -TILT;
  squash.add(frame);

  // The upper half: paper, ribs, the cap with its knob and the handle loop, the eye.
  kit.mesh(paperGeometry(EDGES_UP), body, frame);
  kit.mesh(ribGeometry(RIBS_UP), detail, frame);
  const rTop = paperR(H2, EDGES_UP);
  const cap = kit.mesh(paint(new THREE.CylinderGeometry(rTop * 0.92, rTop * 1.08, 0.08, 16), LACQUER), detail, frame, 0, H2 + 0.03, 0);
  cap.name = 'cap';
  kit.mesh(paint(new THREE.CylinderGeometry(0.07, 0.09, 0.05, 8), LACQUER), detail, frame, 0, H2 + 0.09, 0);
  const handle = kit.mesh(paint(new THREE.TorusGeometry(0.24, 0.022, 4, 12, Math.PI), WIRE), detail, frame, 0, H2 + 0.08, 0);
  handle.name = 'handle';
  // the glowing inside of the upper half (its underside at the mouth)
  // (an open cone up into the body: the mouth shows a hollow, not a lid)
  const rIn = paperR(MY + LIP, EDGES_UP) * 0.97;
  kit.mesh(new THREE.ConeGeometry(rIn, 0.3, SEGS, 1, true).translate(0, 0.15, 0), accent, frame, 0, MY + LIP, 0);

  const eye = createEye(kit, { r: EYE_R, side: 1, detail, lid: body });
  eye.socket.rotation.order = 'YXZ';
  eye.socket.rotation.set(-0.5, 0, 0);
  eye.socket.position.set(0, EYE_Y, paperR(EYE_Y, EDGES_UP) - 0.08);
  frame.add(eye.socket);
  // an amber iris round the pupil (as the model's)
  const iris = kit.mesh(paint(new THREE.SphereGeometry(EYE_R * 1.004, 12, 4, 0, TAU, 0, 0.95), IRIS), detail, eye.ball, 0, 0, 0, 'iris');
  iris.rotation.x = Math.PI / 2;
  eye.ball.children.find((m) => m.name === 'pupil').scale.setScalar(1.025); // over the iris

  // The lower half on the jaw, hinged at the back of the split: paper, ribs, the base ring, the
  // glowing inside, the tongue and the tassel.
  const jaw = new THREE.Group();
  const rLip = paperR(MY - LIP, EDGES_LO);
  jaw.position.set(0, MY, -rLip);
  frame.add(jaw);
  const lower = new THREE.Group();
  lower.position.set(0, -MY, rLip);
  jaw.add(lower);
  kit.mesh(paperGeometry(EDGES_LO), body, lower);
  kit.mesh(ribGeometry(RIBS_LO), detail, lower);
  const rBot = paperR(-H2, EDGES_LO);
  kit.mesh(paint(new THREE.CylinderGeometry(rBot * 1.08, rBot * 0.92, 0.07, 16), LACQUER), detail, lower, 0, -H2 - 0.025, 0);
  kit.mesh(new THREE.ConeGeometry(rLip * 0.97, 0.22, SEGS, 1, true).rotateX(Math.PI).translate(0, -0.11, 0), accent, lower, 0, MY - LIP, 0);

  // The tongue: two flat pink segments from the floor of the mouth, out over the lip and down.
  const tongueRoot = new THREE.Group();
  const T_Z = rLip * 0.93;
  tongueRoot.position.set(0, MY - LIP + 0.01, T_Z);
  lower.add(tongueRoot);
  const tongueGeo = kit.geo(paint(new THREE.SphereGeometry(1, 8, 5), INK.tongue));
  const tongueJ = [];
  let parent = tongueRoot;
  for (let i = 0; i < 3; i++) {
    const j = new THREE.Group();
    j.rotation.order = 'YXZ';
    if (i > 0) j.position.z = T_SEG;
    parent.add(j);
    const m = new THREE.Mesh(tongueGeo, detail);
    m.userData.noFoot = true;
    m.position.z = T_SEG * 0.55;
    m.scale.set(0.125 - i * 0.012, 0.034 - i * 0.003, T_SEG * 0.78);
    j.add(m);
    tongueJ.push(j);
    parent = j;
  }

  // The tassel hangs straight down from the base (its pivot undoes the body's tip): a cord, a
  // gold knot and a red brush whose tips brush the floor.
  const tassel = new THREE.Group();
  tassel.position.set(0, -H2 - 0.06, 0);
  lower.add(tassel);
  const hang = new THREE.Group();
  tassel.add(hang);
  hang.userData.noFoot = true;
  kit.mesh(paint(new THREE.CylinderGeometry(0.012, 0.012, CORD, 5).translate(0, -CORD / 2, 0), TASSEL), detail, hang);
  kit.mesh(paint(new THREE.SphereGeometry(0.035, 6, 4), TASSEL_KNOT), detail, hang, 0, -CORD - 0.01, 0);
  kit.mesh(paint(new THREE.CylinderGeometry(0.03, 0.065, 0.14, 8).translate(0, -0.07, 0), TASSEL), detail, hang, 0, -CORD - 0.03, 0);
  const tip = new THREE.Group(); // the brush's tips: kept on or over the floor (apply)
  tip.position.y = -CORD - 0.17;
  hang.add(tip);

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // It flares bright and spins up round once, mouth wide, the tongue flapping, eye wide.
      const joy = plateau(t, 0.06, 0.95, 0.1);
      o.glow = lerp(REST.glow, 1.6, joy);
      o.squash = keys(t, CRIT_SQUASH);
      o.lift = 0.45 * Math.sin(Math.PI * span(t, 0.18, 0.78));
      o.spin = TAU * smooth(span(t, 0.2, 0.7));
      o.jaw = lerp(JAW0, 0.32, joy);
      o.tongue = lerp(1, 1.25, joy);
      o.droop = 0.7 * Math.sin(t * TAU * 5) * joy;
      o.wag = 0.3 * Math.sin(t * TAU * 3) * joy;
      o.tassel = 0.5 * Math.sin(t * TAU * 2.5) * joy;
      o.upper = lerp(0.14, 0, joy);
      o.lower = lerp(0.05, 0.3, joy);
      o.gazePitch = lerp(-0.1, 0.25, joy);
    } else if (reaction === 'fumble') {
      // The light gutters and dims, the paper sags and crumples lopsided, the tongue droops.
      const sag = smooth(span(t, 0.05, 0.55));
      const gutter = 0.12 * Math.sin(t * TAU * 6) * bump(t, 0.05, 0.4);
      o.glow = Math.max(0.03, lerp(REST.glow, 0.06, sag) + gutter);
      o.squash = 0.28 * sag;
      o.crumple = sag;
      o.roll = 0.14 * sag;
      o.pitch = 0.1 * sag;
      o.jaw = lerp(JAW0, 0.14, sag);
      o.tongue = lerp(1, 1.2, sag);
      o.droop = 0.85 * sag;
      o.upper = lerp(0.14, 0.55, sag);
      o.lower = lerp(0.05, 0.1, sag);
      o.sad = 0.45 * sag;
      o.gazePitch = lerp(-0.1, -0.6, sag);
      o.tassel = 0.15 * Math.sin(t * TAU * 1.2) * sag;
    } else if (reaction === 'mixed') {
      // A tilt and a squint of its one eye, a sideways look, the tongue tucked in a little.
      const tilt = outBack(span(t, 0.04, 0.3), 2.2) * (1 - smooth(span(t, 0.84, 1)));
      o.roll = 0.32 * tilt;
      o.yaw = 0.12 * tilt;
      o.upper = lerp(0.14, 0.52, tilt);
      o.lower = lerp(0.05, 0.36, tilt);
      o.sad = -0.3 * tilt;
      o.gazeYaw = 0.35 * tilt;
      o.tongue = lerp(1, 0.7, tilt);
      o.droop = -0.2 * tilt;
      o.tassel = -0.2 * tilt;
    } else {
      // plain: a happy bob and a wag of the tongue, a smiling eye, a warm glow.
      const content = plateau(t, 0.08, 0.92, 0.12);
      o.lift = 0.14 * bump(t, 0.1, 0.45) + 0.08 * bump(t, 0.5, 0.85);
      o.squash = 0.06 * bump(t, 0.4, 0.55) - 0.04 * bump(t, 0.1, 0.4);
      o.wag = 0.45 * Math.sin(t * TAU * 3) * content;
      o.jaw = lerp(JAW0, 0.14, content);
      o.glow = lerp(REST.glow, 0.75, content);
      o.upper = lerp(0.14, 0.45, content);
      o.lower = lerp(0.05, 0.42, content);
      o.tassel = 0.25 * Math.sin(t * TAU * 1.5) * content;
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  /** A slow float up and down, the paper breathing, a sway, a pulse of the glow, a lazy tongue. */
  function idle(o, ms, amount = 1) {
    const s = Math.sin((ms / 2100) * TAU);
    o.lift += 0.018 * (s + 1) * amount; // floats up, never below its rest
    o.squash += 0.03 * Math.sin((ms / 2100) * TAU + 1.2) * amount; // the ribs breathing
    o.roll += 0.05 * Math.sin((ms / 3300) * TAU) * amount;
    o.pitch += 0.03 * Math.sin((ms / 2700) * TAU + 0.5) * amount;
    o.tassel += 0.2 * Math.sin((ms / 3300) * TAU - 0.9) * amount;
    o.wag += 0.12 * Math.sin((ms / 2500) * TAU) * amount;
    o.glow += 0.12 * Math.sin((ms / 1900) * TAU) * amount;
    const b = blink(ms, 2100);
    o.upper += (1 - o.upper) * b;
    o.lower += (0.45 - o.lower) * b;
  }

  function pose(phase, t, reaction, look) {
    const ms = look?.now ?? nowMs();
    const yaw = look?.yaw || 0;
    if (phase === 'react') react(p, reaction, t, ms);
    else if (phase === 'exit') {
      react(end, reaction, 1);
      PK.reset(tmp);
      tmp.lift = 0.1 * bump(t, 0.15, 0.85);
      tmp.tassel = 0.3 * bump(t, 0.1, 0.9);
      const k = smooth(span(t, 0, 0.3));
      if (k >= 1) PK.blend(p, tmp, tmp, 0);
      else PK.blend(p, end, tmp, k);
    } else if (phase === 'enter') {
      // It drifts down into place, its light coming up, unfolding from a squashed fold.
      PK.reset(p);
      p.squash = 0.35 * (1 - smooth(span(t, 0, 0.6))) - 0.1 * bump(t, 0.55, 0.85);
      p.lift = 0.3 * (1 - smooth(span(t, 0, 0.7)));
      p.glow = lerp(0.05, REST.glow, smooth(span(t, 0.1, 0.8))) + 0.3 * bump(t, 0.6, 0.95);
      p.tassel = 0.4 * Math.sin(t * TAU * 1.5) * (1 - t);
      p.upper = 0.05;
      p.tongue = lerp(0.4, 1, smooth(span(t, 0.5, 1)));
    } else if (phase === 'move') {
      // A dodge: it floats over (the layer arcs it across), leaning into the flight, the tassel and
      // the tongue streaming behind, the glow brightening. From and back to standing.
      PK.reset(p);
      const fly = plateau(t, 0.04, 0.96, 0.16);
      p.lift = (0.12 + 0.03 * Math.sin(t * TAU * 3)) * fly;
      p.pitch = 0.3 * fly;
      p.roll = 0.06 * Math.sin(t * TAU * 2) * fly;
      p.squash = -0.06 * fly;
      p.tassel = -0.6 * fly;
      p.droop = lerp(0, -0.35, fly);
      p.wag = 0.2 * Math.sin(t * TAU * 4) * fly;
      p.glow = lerp(REST.glow, 0.8, fly);
      p.upper = lerp(0.14, 0.02, fly);
      p.gazePitch = lerp(-0.1, 0.1, fly);
    } else if (phase === 'pet') {
      // Petted: a happy glow, a swaying wiggle, eye squeezed into a smile, a big tongue wag (look.calm:
      // a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.roll = 0.15 * k * Math.sin(t * TAU * 2) * on;
      p.squash = 0.06 * k * Math.sin(t * TAU * 3) * on;
      p.wag = 0.5 * k * Math.sin(t * TAU * 3) * on;
      p.jaw = lerp(JAW0, 0.14, on);
      p.glow = lerp(REST.glow, 0.9, on);
      p.upper = lerp(0.14, 0.75, on);
      p.lower = lerp(0.05, 0.45, on);
      p.tassel = 0.3 * k * Math.sin(t * TAU * 2 + 1) * on;
    } else if (phase === 'huff') {
      // Huffed: it puffs up, flares hot, then blows out, eye narrowed and looking away, tongue in.
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.squash = (-0.16 * bump(t, 0.05, 0.45) + 0.12 * bump(t, 0.4, 0.75)) * k;
      p.glow = REST.glow + 0.6 * k * bump(t, 0.05, 0.5);
      p.yaw = 0.35 * mad;
      p.gazeYaw = 0.6 * mad;
      p.upper = lerp(0.14, 0.5, mad);
      p.sad = -0.35 * mad;
      p.jaw = lerp(JAW0, 0.02, mad);
      p.tongue = lerp(1, 0.25, mad);
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): it floats up off the heat, flaring, the tongue panting out and
      // flapping, eye squinting (look.calm: gentler).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.25 * k * bump(t, 0.02, 0.3);
      p.glow = lerp(REST.glow, 1.1, on);
      p.jaw = lerp(JAW0, 0.22, on);
      p.tongue = lerp(1, 1.3, on);
      p.droop = 0.4 * k * Math.sin(t * TAU * 6) * on;
      p.roll = 0.06 * k * Math.sin(t * TAU * 3) * on;
      p.upper = lerp(0.14, 0.55, on);
      p.lower = lerp(0.05, 0.3, on);
    } else if (phase === 'shiver') {
      // Frozen (frost): its light dims, the paper drawn in tight, shivering side to side (look.calm:
      // a slower, smaller shiver).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.squash = 0.12 * on;
      p.roll = 0.07 * k * Math.sin(t * TAU * f) * on;
      p.glow = lerp(REST.glow, 0.15, on);
      p.jaw = lerp(JAW0, 0.02, on);
      p.tongue = lerp(1, 0.3, on);
      p.upper = lerp(0.14, 0.5, on);
      p.lower = lerp(0.05, 0.3, on);
      p.tassel = 0.1 * k * Math.sin(t * TAU * f + 1) * on;
    } else if (phase === 'bristle') {
      // Zapped (storm): it stretches tall, flickering bright, eye wide, mouth agape, trembling
      // (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.2 * on + 0.04 * k * Math.sin(t * TAU * 10) * on;
      p.glow = lerp(REST.glow, 1.2 + 0.4 * k * Math.sin(t * TAU * 9), on);
      p.jaw = lerp(JAW0, 0.26, on);
      p.droop = -0.3 * on;
      p.upper = lerp(0.14, 0, on);
      p.lower = lerp(0.05, 0, on);
      p.gazePitch = lerp(-0.1, 0.1, on);
      p.tassel = 0.5 * on;
    } else if (phase === 'startle') {
      // Startled (any other element): a jump straight up, a flash, eye wide, the tongue snapping
      // in, and a soft landing (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      p.lift = 0.55 * k * Math.sin(Math.PI * span(t, 0.1, 0.5));
      p.squash = 0.16 * bump(t, 0, 0.12) - 0.18 * k * bump(t, 0.1, 0.5) + 0.14 * k * bump(t, 0.48, 0.66);
      p.glow = REST.glow + 0.8 * bump(t, 0.05, 0.45);
      p.jaw = lerp(JAW0, 0.24, bump(t, 0.05, 0.6));
      p.tongue = lerp(1, 0.4, bump(t, 0.05, 0.7));
      p.tassel = 0.5 * k * bump(t, 0.1, 0.6);
      p.upper = lerp(0.14, 0, wide);
      p.lower = lerp(0.05, 0, wide);
      p.gazePitch = lerp(-0.1, 0.15, wide);
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy floaty hops, glowing bright, tongue wagging
      // (look.calm: one small hop). From and back to the standing pose.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      const air1 = Math.sin(Math.PI * span(t, 0.12, 0.42));
      const air2 = two * Math.sin(Math.PI * span(t, 0.52, 0.82));
      p.lift = 0.4 * k * (air1 + air2);
      p.squash = k * (0.14 * bump(t, 0.02, 0.14) - 0.1 * air1 + 0.12 * bump(t, 0.42, 0.54)) + two * (0.12 * bump(t, 0.82, 0.95) - 0.1 * air2);
      p.glow = lerp(REST.glow, 1.1, joy);
      p.jaw = lerp(JAW0, 0.26, joy);
      p.wag = (calm ? 0.15 : 0.45) * Math.sin(t * TAU * 4) * joy;
      p.tassel = 0.4 * k * Math.sin(t * TAU * 2) * joy;
      p.upper = lerp(0.14, 0.4, joy);
      p.lower = lerp(0.05, 0.42, joy);
      p.gazePitch = lerp(-0.1, 0.25, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: drawn up tall, glowing bright, a smug half-lidded eye, the
      // tongue tucked neatly. Sulk: sagged low, its light dim, eye down, the tongue hanging limp.
      PK.reset(end);
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.squash = -0.08;
        tmp.lift = 0.04;
        tmp.pitch = -0.08;
        tmp.glow = 0.95;
        tmp.tongue = 0.7;
        tmp.upper = 0.45;
        tmp.lower = 0.32;
        tmp.gazePitch = 0.1;
      } else {
        tmp.squash = 0.3;
        tmp.crumple = 0.5;
        tmp.glow = 0.1;
        tmp.droop = 0.8;
        tmp.tongue = 1.15;
        tmp.upper = 0.6;
        tmp.lower = 0.1;
        tmp.sad = 0.5;
        tmp.gazePitch = -0.6;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.squash -= 0.06 * bump(t, 0.2, 0.8); // a puff on the way
    } else if (phase === 'throw') {
      // It flicks the dice with its tongue: the tongue curls up, then lashes out and down, the
      // lantern leaning into it, mouth open.
      PK.reset(p);
      p.droop = keys(t, THROW_DROOP);
      p.tongue = keys(t, THROW_TONGUE);
      p.pitch = keys(t, THROW_PITCH);
      p.jaw = keys(t, THROW_JAW);
      p.glow = REST.glow + 0.3 * bump(t, 0.3, 0.8);
      p.upper = 0.05;
      p.gazePitch = -0.2;
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.gazeYaw += yaw * 1.1;
      p.yaw += yaw * 0.4;
    }
    apply(p);
  }

  function apply(o) {
    // a lean or a tilt lifts it a little, so the low rim of its base never dips through the floor
    // (an open jaw swings the base's front down, a sag widens its low bulge: lifted too)
    const jawA = Math.max(0, o.jaw);
    rig.position.y = Math.max(0, o.lift) + 0.45 * Math.max(0, o.pitch) + 0.15 * Math.abs(o.roll) + 0.5 * Math.max(0, jawA - JAW0) + 0.15 * Math.max(0, o.squash);
    rig.rotation.set(o.pitch, o.spin + o.yaw, o.roll);
    const sy = Math.max(0.3, 1 - o.squash);
    const sxz = sy ** -0.3; // (less than volume-keeping: a sag sinks it rather than spreads it)
    squash.scale.set(sxz * (1 + 0.08 * o.crumple), sy, sxz * (1 - 0.05 * o.crumple));
    squash.rotation.z = 0.12 * o.crumple; // lopsided
    jaw.rotation.x = jawA;
    // a shorter tongue slides back into the mouth, a longer one stretches
    const tk = Math.min(1, Math.max(0.05, o.tongue));
    tongueRoot.position.z = T_Z - 0.3 * (1 - tk);
    tongueRoot.scale.set(tk, tk, Math.max(tk, o.tongue));
    for (let i = 0; i < 3; i++) {
      tongueJ[i].rotation.set(T_BEND[i] + T_DROOP[i] * o.droop - (i === 0 ? jawA * 0.5 : 0), o.wag * (0.8 + 0.4 * i), 0);
    }
    // the tassel hangs plumb: undo the body's tip, the jaw and the lean, then its own swing
    hang.rotation.set(TILT - o.pitch - jawA, 0, -o.roll - 0.12 * o.crumple + o.tassel);
    eye.set(o.gazeYaw, o.gazePitch, o.upper, o.lower, o.sad);
    // the tassel brushes the floor: a lean or a sag that would push it through squashes it instead
    hang.scale.y = 1;
    root.updateMatrixWorld(true);
    tassel.getWorldPosition(W);
    root.worldToLocal(W);
    tip.getWorldPosition(V);
    root.worldToLocal(V);
    const rim = 0.07 * Math.abs(Math.sin(hang.rotation.z)) + 0.4 * Math.abs(o.squash); // a swung or sheared brush's low edge
    if (V.y < rim && W.y > V.y) hang.scale.y = Math.max(0.15, (W.y - rim) / (W.y - V.y));
    const g = Math.max(0, o.glow);
    body.emissiveIntensity = g;
    accent.emissiveIntensity = 0.2 + 0.6 * g;
  }

  PK.reset(p);
  apply(p);
  root.updateMatrixWorld(true);
  // Each mesh's rest turn (the body's tip, the jaw, the eye's aim) is baked into its geometry and
  // the mesh turned back square, so its bounding box stays tight (a tipped box would reach far
  // below the floor and above the top). The eyelids keep theirs: their own turn is animated.
  const lids = new Set();
  for (const g of eye.socket.children) if (g !== eye.ball && g.isGroup) for (const m of g.children) lids.add(m);
  const meshes = [];
  root.traverse((o) => o.isMesh && !lids.has(o) && meshes.push(o));
  const q = new THREE.Quaternion();
  const bake = new THREE.Matrix4();
  for (const m of meshes) {
    m.parent.getWorldQuaternion(q);
    const turn = q.clone().multiply(m.quaternion);
    m.geometry = kit.geo(m.geometry.clone().applyMatrix4(bake.compose(new THREE.Vector3(), turn, m.scale)));
    m.quaternion.copy(q.invert());
    m.scale.setScalar(1);
  }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  base.position.y = -box.min.y;
  scaler.scale.setScalar(HEIGHT / (box.max.y - box.min.y));

  return { root, height: HEIGHT, footprint: FOOT, pose, dispose: () => kit.dispose() };
}

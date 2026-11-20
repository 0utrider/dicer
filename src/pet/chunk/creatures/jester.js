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
} from './parts.js';

/**
 * The jester: a little jester doll on a spring. A big round porcelain face (untinted) tilted up
 * toward the top-down camera, rosy cheeks, a painted smile, big ringed eyes and a small diamond
 * painted under its left eye; a floppy three-pointed hat (left, right and back points) with gold
 * bells on the tips; a cream ruff; a harlequin body (the player's colour with gold diamonds), one
 * gold leg and one gold sleeve; little curled-toe shoes with bells and cream mitten hands. From
 * above: a round face under a three-pointed star of a hat with a bell on each point. It hops.
 * Idle: a springy bob, the hat points swaying a beat behind. Crit: a back-flip, arms out, the hat
 * flying; fumble: it flops down like a rag doll (limbs limp, head lolled, the hat drooping); mixed:
 * a shrug with a head tilt; plain: a little bow. Throw: it juggles once and tosses.
 */

const HEIGHT = 1.5;
const FOOT = 0.85; // top-down radius in scene units (face, ruff, hat and its three points with their bells; measured)
const EYE_R = 0.1;
const HR = 0.34; // head radius (design units)
const HIP = 0.3; // hip height: the upper body rides a spring above it
const LEG = 0.22; // leg length (hip to the top of the shoe)
const PIV = 0.75; // the flip's pivot height (the doll's middle)
const TILT = 0.9; // the head's built-in tilt back (rad): its face up toward the camera
const NECK_Y = 0.46; // neck above the hips
const CROWN = 0.95; // the hat crown's reach down the head from its top (rad)
const SEG_N = 3; // segments per hat point
const SEG_L = [0.28, 0.27, 0.22];
const SEG_R = [0.085, 0.06, 0.035, 0.012]; // radius at each joint (the last: the tip)
// A hat point's rest curl per joint (rad from straight up, outward): up and out, then drooping.
const CURL = [1.1, 0.65, 0.75];
const GOLD = new THREE.Color('#e3b23c');
const BELL = new THREE.Color('#ffd34d');
const CREAM = new THREE.Color('#f6ecd6');
const PORCELAIN = new THREE.Color('#fbf5ee');
const ROSE = new THREE.Color('#f49aa6');
const LIP = new THREE.Color('#c8283c');

const REST = {
  lift: 0,
  squash: 0,
  pitch: 0,
  roll: 0,
  yaw: 0,
  flip: 0, // a somersault about the doll's middle (rad, - backward)
  bob: 0, // the spring: the upper body up (+) or down (-) over the hips (design units)
  sit: 0, // 0 standing .. 1 sat down, legs out in front
  lean: 0, // the upper body's bow (+ forward)
  twist: 0, // the upper body's sideways slump (+ toward +X)
  shrug: 0, // shoulders up
  headPitch: 0, // + nods down
  headRoll: 0,
  headYaw: 0,
  armLUp: 0, // forward raise, rad
  armRUp: 0,
  armLOut: 0.25, // sideways raise, rad
  armROut: 0.25,
  limp: 0, // arms and head dangling
  hatUp: 0, // the hat points lifted (+) or flopped (-)
  hatSway: 0, // the points' swing (each a beat behind the other)
  hatBack: 0, // the points blown back (a flip, a jump)
  upper: 0.12,
  lower: 0.04,
  sad: 0,
  gazeYaw: 0,
  gazePitch: -0.1,
  smile: 0.85, // -1 frown .. 1 grin
  open: 0, // mouth open 0..1
};
const PK = poseKit(REST);

// Keyframes, hoisted so a pose allocates nothing.
const CRIT_SQUASH = [0, 0, 0.14, 0.24, 0.22, -0.16, 0.66, -0.06, 0.74, 0.22, 0.86, -0.04, 1, 0];
const MOVE_SQUASH = [
  0, 0, 0.07, 0.22, 0.12, -0.18, 0.25, -0.04, 0.38, 0, 0.45, 0.24, 0.55, 0.2, 0.62, -0.18, 0.75,
  -0.04, 0.88, 0, 0.94, 0.22, 0.985, -0.03, 1, 0,
];
const MOVE_HAT = [0, 0, 0.1, -0.3, 0.2, 0.5, 0.36, -0.2, 0.46, -0.5, 0.56, -0.2, 0.66, 0.5, 0.86, -0.2, 0.95, -0.45, 1, 0];
const THROW_L = [0, 0, 0.12, 1.5, 0.28, 0.6, 0.44, 1.5, 0.6, 0.5, 1, 0];
const THROW_R = [0, 0, 0.12, 0.6, 0.28, 1.5, 0.44, 0.6, 0.56, -0.3, 0.7, 1.9, 0.82, 1.2, 1, 0];
const THROW_GAZE = [0, -0.1, 0.1, 0.5, 0.55, 0.5, 0.7, 0, 1, -0.1];

export function jester(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55, metalness: 0 }),
  );
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.55, metalness: 0 }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'jester';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const flip = new THREE.Group(); // a somersault turns about the doll's middle
  flip.position.y = PIV;
  rig.add(flip);
  const base = new THREE.Group();
  base.position.y = -PIV;
  flip.add(base);
  const squash = new THREE.Group();
  base.add(squash);

  // Legs: a pivot at each hip, a leg (one tinted, one gold) and a curled-toe shoe with a bell.
  const legGeo = kit.geo(new THREE.CylinderGeometry(0.055, 0.062, 1, 7, 1, true).translate(0, -0.5, 0));
  const goldLegGeo = kit.geo(paint(legGeo.clone(), GOLD));
  const shoeGeo = kit.geo(new THREE.SphereGeometry(0.075, 7, 5));
  const toeGeo = kit.geo(new THREE.ConeGeometry(0.04, 0.13, 6).translate(0, 0.065, 0));
  const bellGeo = kit.geo(paint(new THREE.SphereGeometry(1, 6, 4), BELL));
  const legs = [1, -1].map((sx) => {
    const g = new THREE.Group();
    g.position.set(sx * 0.105, HIP, 0);
    squash.add(g);
    const leg = sx > 0 ? new THREE.Mesh(legGeo, body) : new THREE.Mesh(goldLegGeo, detail);
    g.add(leg);
    const shoe = new THREE.Group();
    g.add(shoe);
    const s = new THREE.Mesh(shoeGeo, accent);
    s.position.set(sx * 0.01, -0.02, 0.04);
    s.scale.set(0.95, 0.75, 1.55);
    shoe.add(s);
    const toe = new THREE.Mesh(toeGeo, accent);
    toe.position.set(sx * 0.01, 0.0, 0.14);
    toe.rotation.x = 0.95; // curling up and forward
    shoe.add(toe);
    const bell = new THREE.Mesh(bellGeo, detail);
    bell.position.set(sx * 0.01, 0.085, 0.215);
    bell.scale.setScalar(0.03);
    shoe.add(bell);
    return { g, leg, shoe };
  });

  // The upper body rides the spring: a harlequin torso, the ruff, arms and the head.
  const upperG = new THREE.Group();
  upperG.position.y = HIP;
  squash.add(upperG);
  const torsoG = new THREE.Group();
  torsoG.rotation.order = 'YXZ';
  upperG.add(torsoG);
  const TR = [0.24, 0.27, 0.215];
  const torso = kit.mesh(new THREE.SphereGeometry(1, 10, 8), body, torsoG, 0, 0.19, 0);
  torso.scale.set(TR[0], TR[1], TR[2]);
  // Gold diamonds on the torso: flat octahedra laid on its surface, two staggered rows.
  const diaGeo = kit.geo(paint(new THREE.OctahedronGeometry(1, 0), GOLD));
  for (const [row, n0] of [
    [-0.32, 0],
    [0.3, 0.5],
  ]) {
    for (let i = 0; i < 6; i++) {
      const a = ((i + n0) / 6) * TAU;
      const c = Math.sqrt(1 - row * row);
      const d = new THREE.Mesh(diaGeo, detail);
      d.position.set(Math.sin(a) * c * TR[0], 0.19 + row * TR[1], Math.cos(a) * c * TR[2]);
      d.rotation.set(-row * 0.9, a, 0, 'YXZ');
      d.scale.set(0.075, 0.105, 0.03);
      torsoG.add(d);
    }
  }
  // The ruff: a ring of cream frills round the neck.
  const frillGeo = kit.geo(paint(new THREE.SphereGeometry(1, 6, 3), CREAM));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const fr = new THREE.Mesh(frillGeo, detail);
    fr.position.set(Math.sin(a) * 0.19, 0.42, Math.cos(a) * 0.17);
    fr.rotation.set(0, a, 0);
    fr.scale.set(0.095, 0.045, 0.08);
    torsoG.add(fr);
  }
  // Arms: a pivot at each shoulder, a sleeve (one gold, one tinted) and a cream mitten.
  const sleeveGeo = kit.geo(new THREE.CylinderGeometry(0.05, 0.062, 0.22, 7, 1, true).translate(0, -0.11, 0));
  const goldSleeveGeo = kit.geo(paint(sleeveGeo.clone(), GOLD));
  const mittenGeo = kit.geo(paint(new THREE.SphereGeometry(1, 6, 4), CREAM));
  const arms = [1, -1].map((sx) => {
    const g = new THREE.Group();
    g.rotation.order = 'ZXY';
    g.position.set(sx * 0.22, 0.33, 0.01);
    torsoG.add(g);
    g.add(sx > 0 ? new THREE.Mesh(goldSleeveGeo, detail) : new THREE.Mesh(sleeveGeo, body));
    const hand = new THREE.Mesh(mittenGeo, detail);
    hand.position.set(0, -0.27, 0.01);
    hand.scale.set(0.065, 0.075, 0.06);
    g.add(hand);
    return g;
  });

  // The head: a big porcelain ball tilted back so its face looks up at the camera, its features
  // laid on the sphere. The neck pivot sits below its centre, so a nod swings the face.
  const neck = new THREE.Group();
  neck.rotation.order = 'YXZ';
  neck.position.set(0, NECK_Y, 0.01);
  torsoG.add(neck);
  const head = new THREE.Group();
  head.position.set(0, HR * 0.9, 0.02);
  head.rotation.x = -TILT;
  neck.add(head);
  kit.mesh(paint(new THREE.SphereGeometry(HR, 14, 10), PORCELAIN), detail, head);
  /** A point on the face sphere at face-local (x, y), and its yaw/pitch to lie on it. */
  const onFace = (m, x, y, out = 0) => {
    const z = Math.sqrt(Math.max(0, HR * HR - x * x - y * y)) + out;
    m.position.set(x, y, z);
    m.rotation.set(-Math.asin(y / HR), Math.asin(x / HR), 0, 'YXZ');
    return m;
  };
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lidColor: PORCELAIN });
    onFace(e.socket, side * 0.125, 0.05, -EYE_R * 0.55);
    e.socket.rotation.order = 'YXZ';
    e.socket.rotation.set(-0.05, side * 0.32, 0);
    head.add(e.socket);
    return e;
  });
  const cheekGeo = kit.geo(paint(new THREE.SphereGeometry(1, 5, 3), ROSE));
  for (const sx of [1, -1]) {
    const ch = onFace(new THREE.Mesh(cheekGeo, detail), sx * 0.215, -0.1, -0.012);
    ch.scale.set(0.058, 0.04, 0.02);
    head.add(ch);
  }
  // The painted diamond under its left eye (+X), in the body colour.
  const tear = onFace(kit.mesh(new THREE.OctahedronGeometry(1, 0), body, head), 0.135, -0.105, -0.004);
  tear.scale.set(0.03, 0.052, 0.008);
  const nose = onFace(kit.mesh(paint(new THREE.SphereGeometry(0.02, 5, 3), ROSE), detail, head), 0, -0.05, -0.006);
  nose.scale.set(1.2, 0.9, 0.7);
  // Mouth: a painted red smile arc, and an open mouth (dark, a tongue) for the big moments.
  const smileG = onFace(new THREE.Group(), 0, -0.155, 0.002);
  head.add(smileG);
  const smile = kit.mesh(paint(new THREE.TorusGeometry(0.075, 0.014, 4, 12, Math.PI), LIP), detail, smileG);
  const mouth = kit.mesh(paint(new THREE.CircleGeometry(0.075, 14, Math.PI, Math.PI), INK.mouth), detail, smileG);
  const tongue = kit.mesh(paint(new THREE.CircleGeometry(0.038, 10, Math.PI, Math.PI), INK.tongue), detail, mouth);
  tongue.position.set(0, -0.035, 0.002);

  // The hat: a crown over the top and back of the head with a gold band, and three floppy points
  // (left, right, back), each a chain of tapering segments with a bell on its tip. A point's
  // chain bends outward (+X of its own base, turned by its heading) and droops.
  const hat = new THREE.Group();
  hat.rotation.x = TILT - 0.55; // set back on the head, the face showing from above
  head.add(hat);
  const crown = kit.mesh(new THREE.SphereGeometry(HR * 1.05, 12, 4, 0, TAU, 0, CROWN), body, hat);
  crown.position.y = 0.005;
  const band = kit.mesh(paint(new THREE.TorusGeometry(HR * 1.05 * Math.sin(CROWN), 0.028, 3, 14), GOLD), detail, hat);
  band.position.y = HR * 1.05 * Math.cos(CROWN);
  band.rotation.x = Math.PI / 2;
  const segGeos = SEG_L.map((l, i) =>
    kit.geo(new THREE.CylinderGeometry(SEG_R[i + 1], SEG_R[i], l + 0.02, 7, 1, true).translate(0, l / 2, 0)),
  );
  const points = [
    [0, body, 0.0], // left (+X)
    [Math.PI, accent, 1.9], // right
    [Math.PI / 2, body, 3.8], // back (-Z)
  ].map(([heading, mat, phase]) => {
    const b = new THREE.Group();
    b.rotation.y = heading;
    // on the crown, a little way down from the top toward its heading
    b.position.set(Math.cos(heading) * 0.17, HR * 0.84, -Math.sin(heading) * 0.17);
    hat.add(b);
    const joints = [];
    let parent = b;
    for (let i = 0; i < SEG_N; i++) {
      const j = new THREE.Group();
      if (i > 0) j.position.y = SEG_L[i - 1];
      parent.add(j);
      j.add(new THREE.Mesh(segGeos[i], mat));
      joints.push(j);
      parent = j;
    }
    const bell = new THREE.Mesh(bellGeo, detail);
    bell.position.y = SEG_L[SEG_N - 1] + 0.035;
    bell.scale.setScalar(0.05);
    parent.add(bell);
    return { joints, phase };
  });

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // A crouch on the spring, a leap into a back-flip with its arms flung out and the hat
      // flying, a squashy landing and a bounce, beaming.
      o.squash = keys(t, CRIT_SQUASH);
      const air = span(t, 0.2, 0.7);
      o.lift = Math.sin(Math.PI * air) * 0.95;
      o.flip = -TAU * smooth(span(t, 0.24, 0.66));
      const out = plateau(t, 0.16, 0.76, 0.08);
      o.armLOut = lerp(0.25, 1.9, out);
      o.armROut = lerp(0.25, 1.9, out);
      o.hatBack = bump(t, 0.2, 0.75);
      o.hatUp = 0.7 * bump(t, 0.2, 0.7) - 0.5 * bump(t, 0.7, 0.85) + 0.25 * bump(t, 0.85, 1);
      o.bob = -0.06 * bump(t, 0.04, 0.22) + 0.04 * bump(t, 0.7, 0.9) * Math.sin(t * TAU * 4);
      const joy = plateau(t, 0.06, 0.95, 0.1);
      o.upper = lerp(0.12, 0, joy);
      o.lower = lerp(0.04, 0.4, joy);
      o.smile = lerp(0.85, 1, joy);
      o.open = joy;
      o.gazePitch = lerp(-0.1, 0.25, joy);
    } else if (reaction === 'fumble') {
      // It flops down like a rag doll: sat in a heap, slumped to one side, the head lolled, the
      // arms limp, the hat points drooping; a last floppy bounce.
      const flop = smooth(span(t, 0.04, 0.32));
      const bounce = 0.06 * Math.exp(-6 * span(t, 0.3, 1)) * Math.sin(span(t, 0.3, 1) * TAU * 2) * flop;
      o.sit = flop;
      o.squash = 0.04 * flop + bounce;
      o.twist = 0.32 * flop;
      o.lean = -0.18 * flop;
      o.limp = flop;
      o.headRoll = 0.55 * flop;
      o.headPitch = 0.15 * flop;
      o.armLOut = lerp(0.25, 0.55, flop);
      o.armROut = lerp(0.25, 0.1, flop);
      o.hatUp = -0.75 * flop - 2 * bounce;
      o.hatSway = 0.3 * flop;
      o.upper = lerp(0.12, 0.62, flop);
      o.lower = lerp(0.04, 0.12, flop);
      o.sad = 0.4 * flop;
      o.gazePitch = lerp(-0.1, -0.5, flop);
      o.smile = lerp(0.85, -0.6, smooth(span(t, 0.02, 0.3)));
    } else if (reaction === 'mixed') {
      // A shrug: shoulders up, both mittens out palms-up, the head tilted, a lopsided look.
      const k = outBack(span(t, 0.04, 0.3), 2.2) * (1 - smooth(span(t, 0.82, 1)));
      o.shrug = k;
      o.armLOut = lerp(0.25, 0.85, k);
      o.armROut = lerp(0.25, 0.85, k);
      o.armLUp = 0.7 * k;
      o.armRUp = 0.7 * k;
      o.headRoll = 0.35 * k;
      o.headPitch = -0.05 * k;
      o.bob = 0.03 * k;
      o.hatSway = 0.35 * Math.sin(t * TAU * 2) * k;
      o.hatUp = 0.15 * k;
      o.upper = lerp(0.12, 0.3, k);
      o.gazeYaw = 0.3 * k;
      o.smile = lerp(0.85, 0.15, k);
    } else {
      // A little bow: a dip on the spring, the upper body bowing, one mitten to its tummy and the
      // other swept out, the hat points swinging forward; then up, smiling.
      const bow = plateau(t, 0.08, 0.8, 0.2);
      o.lean = 0.55 * bow;
      o.headPitch = 0.15 * bow;
      o.bob = -0.04 * bow;
      o.armRUp = 0.9 * bow;
      o.armROut = lerp(0.25, -0.15, bow);
      o.armLOut = lerp(0.25, 1.2, bow);
      o.hatUp = -0.25 * bow + 0.2 * bump(t, 0.75, 0.95);
      o.hatSway = 0.15 * bump(t, 0.7, 1);
      o.upper = lerp(0.12, 0.6, bump(t, 0.1, 0.8));
      o.lower = lerp(0.04, 0.35, bow);
      o.smile = 1;
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  /** The spring bob with the hat swaying a beat behind, a head sway and blinks. */
  function idle(o, ms, amount = 1) {
    const s = (ms / 900) * TAU;
    o.bob += 0.02 * Math.sin(s) * amount;
    o.squash += 0.012 * Math.sin(s) * amount;
    o.hatUp += 0.12 * Math.sin(s - 1.3) * amount; // the points lag the bob
    o.hatSway += 0.12 * Math.sin((ms / 2300) * TAU) * amount;
    o.headRoll += 0.05 * Math.sin((ms / 3100) * TAU) * amount;
    const b = blink(ms, 700);
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
      // A crouch on the spring, a hop off (the layer moves it), the hat flying, a landing.
      tmp.squash = 0.16 * bump(t, 0, 0.25) - 0.08 * bump(t, 0.2, 0.85) + 0.14 * bump(t, 0.85, 1);
      tmp.hatUp = 0.4 * bump(t, 0.15, 0.6) - 0.4 * bump(t, 0.6, 1);
      tmp.armLOut = 0.25 + 0.4 * bump(t, 0.1, 0.9);
      tmp.armROut = tmp.armLOut;
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      // It bounces in: stretched in the air, a squash on landing, the hat flopping after it.
      PK.reset(p);
      p.squash = -0.1 * bump(t, 0.05, 0.75) + 0.18 * bump(t, 0.75, 1);
      p.hatUp = 0.5 * bump(t, 0, 0.7) - 0.5 * bump(t, 0.72, 1);
      p.armLOut = 0.25 + 0.6 * bump(t, 0, 0.9);
      p.armROut = p.armLOut;
      p.upper = 0.04;
      p.open = 0.6 * bump(t, 0.1, 0.8);
    } else if (phase === 'move') {
      // A dodge: boing, boing on its spring (the layer moves it across while it is in the air),
      // arms out for balance, the hat points flying up and flopping a beat behind. It starts and
      // ends on the standing pose (exit at t 1).
      PK.reset(p);
      const joy = plateau(t, 0.03, 0.97, 0.1);
      p.squash = keys(t, MOVE_SQUASH);
      p.lift = 0.55 * Math.sin(Math.PI * span(t, 0.1, 0.4)) + 0.45 * Math.sin(Math.PI * span(t, 0.6, 0.9));
      p.hatUp = keys(t, MOVE_HAT);
      p.armLOut = lerp(0.25, 0.9, joy);
      p.armROut = p.armLOut;
      p.upper = lerp(0.12, 0.02, joy);
      p.lower = lerp(0.04, 0.3, joy);
      p.smile = lerp(0.85, 1, joy);
      p.open = 0.7 * joy;
    } else if (phase === 'pet') {
      // Petted: a happy wiggle on its spring, eyes squeezed shut, a big grin, the hat jingling
      // (look.calm: a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.roll = 0.08 * k * Math.sin(t * TAU * 2) * on;
      p.headRoll = 0.22 * k * Math.sin(t * TAU * 2 - 0.8) * on;
      p.bob = 0.03 * k * Math.sin(t * TAU * 4) * on;
      p.hatSway = 0.4 * k * Math.sin(t * TAU * 2 - 1.6) * on;
      p.hatUp = 0.2 * k * Math.sin(t * TAU * 4 - 1.2) * on;
      p.armLUp = 0.5 * on;
      p.armRUp = 0.5 * on;
      p.upper = lerp(0.12, 0.75, on);
      p.lower = lerp(0.04, 0.45, on);
      p.smile = lerp(0.85, 1, on);
      p.open = 0.6 * on;
    } else if (phase === 'huff') {
      // Huffed: it stamps on its spring, arms folded in, the head turned away, frowning.
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.squash = (-0.08 * bump(t, 0.05, 0.45) + 0.08 * bump(t, 0.4, 0.75)) * k;
      p.headYaw = 0.6 * mad;
      p.headPitch = -0.15 * mad;
      p.yaw = 0.2 * mad;
      p.armLUp = 1.1 * mad;
      p.armRUp = 1.1 * mad;
      p.armLOut = lerp(0.25, -0.5, mad);
      p.armROut = lerp(0.25, -0.5, mad);
      p.hatSway = 0.3 * k * Math.sin(t * TAU * 2) * mad;
      p.gazeYaw = 0.5 * mad;
      p.upper = lerp(0.12, 0.55, mad);
      p.sad = -0.3 * mad;
      p.smile = lerp(0.85, -0.6, mad);
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop back off the heat, then it fans its face with a mitten,
      // squinting, mouth open (look.calm: slower, smaller strokes).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const f = look?.calm ? 3 : 5;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.25 * k * bump(t, 0.02, 0.28);
      p.armRUp = on * (1.9 + 0.3 * k * Math.sin(t * TAU * f));
      p.armROut = lerp(0.25, 0.2 + 0.4 * k * Math.sin(t * TAU * f), on);
      p.hatSway = 0.3 * k * Math.sin(t * TAU * 2.5) * on;
      p.upper = lerp(0.12, 0.6, on);
      p.lower = lerp(0.04, 0.3, on);
      p.smile = lerp(0.85, -0.2, on);
      p.open = 0.6 * on;
    } else if (phase === 'shiver') {
      // Frozen (frost): hunched down on its spring, arms hugged in, shivering, the bells
      // chattering (look.calm: a slower, smaller shiver).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.bob = -0.05 * on;
      p.roll = 0.06 * k * Math.sin(t * TAU * f) * on;
      p.hatSway = 0.25 * k * Math.sin(t * TAU * f + 1) * on;
      p.hatUp = -0.3 * on;
      p.headPitch = 0.15 * on;
      p.armLUp = 1.0 * on;
      p.armRUp = 1.0 * on;
      p.armLOut = lerp(0.25, -0.45, on);
      p.armROut = lerp(0.25, -0.45, on);
      p.upper = lerp(0.12, 0.6, on);
      p.lower = lerp(0.04, 0.3, on);
      p.smile = lerp(0.85, -0.5, on);
    } else if (phase === 'bristle') {
      // Zapped (storm): sprung up tall, arms and the hat points stuck straight out, eyes wide,
      // trembling (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.1 * on + 0.03 * k * Math.sin(t * TAU * 10) * on;
      p.bob = 0.05 * on;
      p.hatUp = 0.9 * on;
      p.armLOut = lerp(0.25, 1.5, on);
      p.armROut = lerp(0.25, 1.5, on);
      p.upper = lerp(0.12, 0, on);
      p.lower = lerp(0.04, 0, on);
      p.smile = lerp(0.85, 0, on);
      p.open = 0.5 * on;
    } else if (phase === 'startle') {
      // Startled (any other element): a crouch and a jump straight up off the spring, arms up,
      // the hat flying, eyes wide, and a squashy landing (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      p.lift = 0.6 * k * Math.sin(Math.PI * span(t, 0.1, 0.5));
      p.squash = 0.18 * bump(t, 0, 0.12) - 0.12 * k * bump(t, 0.1, 0.5) + 0.16 * k * bump(t, 0.48, 0.66);
      p.hatUp = 0.6 * k * bump(t, 0.12, 0.5) - 0.4 * k * bump(t, 0.5, 0.75);
      p.armLUp = 1.6 * bump(t, 0.1, 0.6);
      p.armRUp = 1.6 * bump(t, 0.1, 0.6);
      p.upper = lerp(0.12, 0, wide);
      p.lower = lerp(0.04, 0, wide);
      p.smile = lerp(0.85, 0, wide);
      p.open = 0.6 * wide;
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy boings, mittens up, the hat jingling, a big
      // grin (look.calm: one small hop). From and back to the standing pose.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const two = calm ? 0 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const air1 = bump(t, 0.12, 0.42);
      const air2 = two * bump(t, 0.52, 0.82);
      p.lift = 0.4 * k * (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash =
        k * (0.14 * bump(t, 0.02, 0.14) - 0.1 * air1 + 0.14 * bump(t, 0.42, 0.54)) +
        two * (0.12 * bump(t, 0.82, 0.95) - 0.1 * air2);
      p.hatUp = k * (0.5 * air1 - 0.4 * bump(t, 0.42, 0.56)) + two * (0.5 * air2 - 0.4 * bump(t, 0.82, 0.96));
      p.armLUp = lerp(0, 2.3, joy);
      p.armRUp = lerp(0, 2.3, joy);
      p.armLOut = lerp(0.25, 0.5, joy);
      p.armROut = lerp(0.25, 0.5, joy);
      p.hatSway = (calm ? 0.1 : 0.3) * Math.sin(t * TAU * 3) * joy;
      p.headPitch = lerp(0, -0.15, joy);
      p.upper = lerp(0.12, 0.5, joy);
      p.lower = lerp(0.04, 0.45, joy);
      p.smile = lerp(0.85, 1, joy);
      p.open = lerp(0, 0.8, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: sprung up tall, chin up, hands on hips, the hat points
      // perked, a smug look. Sulk: sat down in a heap, head hung, the hat points drooping.
      PK.reset(end);
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.squash = -0.08;
        tmp.bob = 0.05;
        tmp.lean = -0.08;
        tmp.headPitch = -0.2;
        tmp.armLOut = 0.75;
        tmp.armROut = 0.75;
        tmp.armLUp = -0.3;
        tmp.armRUp = -0.3;
        tmp.hatUp = 0.35;
        tmp.upper = 0.45;
        tmp.lower = 0.3;
        tmp.smile = 1;
      } else {
        tmp.sit = 1;
        tmp.lean = 0.2;
        tmp.headPitch = 0.45;
        tmp.limp = 0.6;
        tmp.armLOut = 0.1;
        tmp.armROut = 0.1;
        tmp.hatUp = -0.85;
        tmp.upper = 0.6;
        tmp.sad = 0.45;
        tmp.gazePitch = -0.5;
        tmp.smile = -0.7;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.squash -= 0.04 * bump(t, 0.2, 0.8); // a puff on the way
    } else if (phase === 'throw') {
      // Juggles: the mittens toss in turn while it watches the dice go up, then the right arm
      // flings them forward.
      PK.reset(p);
      p.armLUp = keys(t, THROW_L);
      p.armRUp = keys(t, THROW_R);
      p.armLOut = 0.15;
      p.armROut = 0.15;
      p.bob = 0.03 * Math.sin(t * TAU * 3) * (1 - smooth(span(t, 0.6, 1)));
      p.hatUp = 0.15 * Math.sin(t * TAU * 3 - 1.2) * (1 - smooth(span(t, 0.7, 1)));
      p.lean = 0.2 * bump(t, 0.58, 0.9);
      p.headPitch = -0.15 * bump(t, 0.05, 0.6);
      p.gazePitch = keys(t, THROW_GAZE);
      p.upper = 0.04;
      p.open = 0.5 * bump(t, 0.6, 0.9);
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.headYaw += yaw * 0.6;
      p.gazeYaw += yaw * 0.7;
      p.yaw += yaw * 0.12;
    }
    apply(p);
  }

  function apply(o) {
    rig.position.y = o.lift;
    rig.rotation.set(o.pitch, o.yaw, o.roll);
    flip.rotation.x = o.flip;
    const sy = 1 - o.squash;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    squash.scale.set(sxz, sy, sxz);
    // The spring and the sit: the hips drop toward the floor as the legs swing out in front.
    const sit = o.sit;
    const hip = HIP + o.bob * (1 - sit) - sit * 0.17;
    upperG.position.set(0, hip, -0.04 * sit);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const L = legs[i];
      L.g.position.set(side * (0.105 + 0.04 * sit), hip, -0.04 * sit);
      L.g.rotation.set(-1.35 * sit, 0, side * 0.2 * sit);
      const len = sit > 0 ? LEG : Math.max(0.05, hip - (HIP - LEG));
      L.leg.scale.y = len;
      L.shoe.position.y = -len;
      L.shoe.rotation.x = 1.0 * sit;
    }
    torsoG.position.y = 0;
    torsoG.rotation.set(o.lean, 0, -o.twist);
    // Arms: raised forward (up) and out (sideways); limp ones hang straight down.
    const lim = o.limp;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const up = (side > 0 ? o.armLUp : o.armRUp) * (1 - lim);
      const out = (side > 0 ? o.armLOut : o.armROut) + 0.35 * o.shrug;
      arms[i].position.y = 0.33 + 0.04 * o.shrug;
      arms[i].rotation.set(-up - o.lean * lim, 0, side * out);
      eyes[i].set(o.gazeYaw, o.gazePitch, o.upper, o.lower, o.sad);
    }
    neck.rotation.set(o.headPitch, o.headYaw, o.headRoll + 0.25 * o.twist * lim);
    // The hat points: each joint bends out by its curl, lifted or flopped and swung, each point a
    // beat behind the last; blown back in a flip or a jump.
    for (const pt of points) {
      const sw = o.hatSway * Math.cos(pt.phase);
      for (let i = 0; i < SEG_N; i++) {
        const c = CURL[i] * (1 - 0.55 * o.hatUp) + (i === 0 ? 0 : -0.35 * o.hatBack);
        pt.joints[i].rotation.set(sw * (0.5 + 0.3 * i), 0, -c);
      }
    }
    const sm = o.smile;
    smile.visible = o.open < 0.35;
    mouth.visible = !smile.visible;
    smile.rotation.set(0, 0, sm >= 0 ? Math.PI : 0);
    smile.position.y = sm >= 0 ? 0.02 : -0.03;
    smile.scale.set(1 + 0.15 * Math.abs(sm), Math.max(0.2, Math.abs(sm)), 1);
    mouth.scale.set(1, 0.35 + 0.75 * o.open, 1);
  }

  PK.reset(p);
  apply(p);
  root.updateMatrixWorld(true);
  const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
  scaler.scale.setScalar(HEIGHT / h);

  return { root, height: HEIGHT, footprint: FOOT, pose, dispose: () => kit.dispose() };
}

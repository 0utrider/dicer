import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
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
 * The mimic: a treasure-chest die on four nubby feet. Its lid is the upper jaw, so from the
 * top-down camera you see two big eyes on the lid above an open mouth with a pink tongue lolling
 * over the teeth. Crit: it springs, spins and chomps for joy; fumble: the lid shuts and it sinks
 * into a sulk; mixed: a tilt and one squinting eye; plain: a contented double chomp.
 */

// The standing height of the CLOSED chest (feet to lid top, eyes included), fitted at build. The
// open jaw rises above it (about 2.3 in watch): the mimic's footprint then matches the slime's
// and a d20's width from the top-down camera, and the layer's inset, hop and shadow (all scaled
// by height) follow the chest, not the lid.
const HEIGHT = 1.5;
// Design units (scaled to HEIGHT at build).
const W = 1.45; // base width (x)
const D = 1.1; // base depth (z)
const FOOT = 0.15;
const BASE_H = 0.45;
const TOP = FOOT + BASE_H;
const LID_H = 0.3;
const EYE_R = 0.24;
const LID = 0.72; // resting jaw opening, rad: wide enough that the mouth shows from above

const REST = {
  lift: 0,
  squash: 0, // > 0 squashes, < 0 stretches
  pitch: 0, // + leans forward
  roll: 0,
  spin: 0,
  yaw: 0, // body turn toward the dice
  lid: LID, // open angle, rad
  tongue: 1, // 0 in .. 1 out over the lip
  wag: 0,
  tuck: 0, // feet pulled in (in the air)
  upper: 0.2,
  lower: 0.1,
  upperR: 0, // extra upper lid on the right eye (squint)
  sad: 0,
  sadL: 0, // extra on the left eye only
  gazeYaw: 0,
  gazePitch: -0.35,
  tiltUp: 0, // extra upward roll of the eyes on the lid, so a shut jaw still shows them from above
  eyeScale: 1,
  crook: 0, // the lid shut askew (roll about its hinge axis)
  stride: 0, // 0..1: the feet scuttle in diagonal pairs (a trot), by gait
  gait: 0, // the step cycle's phase, rad
};
const SCUTTLE_STEPS = 5; // step cycles in one dodge (450 ms): little legs going like the clappers
const PK = poseKit(REST);

// More keyframes, hoisted so a pose allocates nothing.
const K0 = [0.2, 0, 0.32, -1, 0.5, -1, 0.6, 1, 0.78, 1, 0.9, 0];
const K1 = [0, 1, 0.3, 0, 0.55, 1.3, 1, 1];
const K2 = [0, 0.2, 0.3, 0.55, 0.5, 0, 1, 0.2];

// Keyframes (t, value).
const THROW_LID = [0, LID, 0.3, 0.08, 0.5, 1.35, 0.75, 1.0, 1, LID];
const THROW_PITCH = [0, 0, 0.3, -0.2, 0.5, 0.26, 1, 0];
const THROW_SQUASH = [0, 0, 0.3, 0.14, 0.5, -0.12, 0.8, 0.03, 1, 0];
const CRIT_SQUASH = [
  0, 0, 0.1, 0.2, 0.17, -0.16, 0.45, -0.05, 0.56, 0.22, 0.64, -0.06, 0.74, 0.04, 0.85, 0,
];
const PLAIN_LID = [0, LID, 0.12, LID, 0.24, 0.06, 0.36, 0.85, 0.48, 0.06, 0.62, 0.85, 1, LID];

export function mimic(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.42, metalness: 0.05 }),
  );
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.3, metalness: 0.35 }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'mimic';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group(); // lift, lean, spin: pivots on the floor
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const squash = new THREE.Group();
  rig.add(squash);

  // Feet: nubs at the corners that poke out past the chest, so it reads as a creature from above.
  const feet = [];
  const footGeo = new THREE.SphereGeometry(0.15, 8, 6);
  kit.geo(footGeo);
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const f = new THREE.Mesh(footGeo, accent);
    f.scale.set(1, 0.62, 1.2);
    f.userData.home = new THREE.Vector3(sx * 0.62, 0.09, sz * 0.44);
    f.userData.dir = sx;
    f.userData.pair = sx * sz > 0 ? 0 : Math.PI; // diagonal pairs step together, half a cycle apart
    f.position.copy(f.userData.home);
    rig.add(f);
    feet.push(f);
  }

  // The chest: base box, a lighter rim at its lip, the mouth inside, teeth and tongue.
  kit.mesh(new RoundedBoxGeometry(W, BASE_H, D, 2, 0.13), body, squash, 0, FOOT + BASE_H / 2, 0);
  kit.mesh(
    new RoundedBoxGeometry(W + 0.05, 0.09, D + 0.05, 1, 0.045),
    accent,
    squash,
    0,
    TOP - 0.06,
    0,
  );
  const mouthShape = new THREE.Shape();
  {
    const hw = W / 2 - 0.1;
    const hd = D / 2 - 0.1;
    const rr = 0.1;
    mouthShape.moveTo(-hw + rr, -hd);
    mouthShape.lineTo(hw - rr, -hd);
    mouthShape.quadraticCurveTo(hw, -hd, hw, -hd + rr);
    mouthShape.lineTo(hw, hd - rr);
    mouthShape.quadraticCurveTo(hw, hd, hw - rr, hd);
    mouthShape.lineTo(-hw + rr, hd);
    mouthShape.quadraticCurveTo(-hw, hd, -hw, hd - rr);
    mouthShape.lineTo(-hw, -hd + rr);
    mouthShape.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
  }
  const mouthGeo = paint(new THREE.ShapeGeometry(mouthShape, 3).rotateX(-Math.PI / 2), INK.mouth);
  kit.mesh(mouthGeo, detail, squash, 0, TOP + 0.004, 0);
  const toothGeo = paint(new THREE.ConeGeometry(0.06, 0.13, 6), INK.tooth);
  kit.geo(toothGeo);
  for (const x of [-0.52, -0.33, 0.33, 0.52]) {
    const t = new THREE.Mesh(toothGeo, detail);
    t.position.set(x, TOP + 0.05, D / 2 - 0.09);
    squash.add(t);
  }
  const tonguePivot = new THREE.Group();
  tonguePivot.position.set(0, TOP + 0.06, -0.2);
  squash.add(tonguePivot);
  const tongue = kit.mesh(
    paint(new THREE.SphereGeometry(0.2, 10, 6), INK.tongue),
    detail,
    tonguePivot,
    0,
    0,
    0.32,
  );
  tongue.scale.set(1.0, 0.28, 1.6);

  // The lid (upper jaw), hinged at the back of the lip.
  const lid = new THREE.Group();
  lid.position.set(0, TOP, -D / 2);
  squash.add(lid);
  kit.mesh(
    new RoundedBoxGeometry(W + 0.04, LID_H, D + 0.04, 2, 0.13),
    body,
    lid,
    0,
    LID_H / 2 + 0.01,
    D / 2,
  );
  kit.mesh(new RoundedBoxGeometry(W + 0.09, 0.09, D + 0.09, 1, 0.045), accent, lid, 0, 0.05, D / 2);
  // The palate: the inside of the lid is mouth too, so a wide-open jaw reads dark from above.
  kit.mesh(mouthGeo.clone().rotateX(Math.PI), detail, lid, 0, -0.004, D / 2);
  // A lighter strap over the lid between the eyes: the chest's banding, read from above.
  kit.mesh(
    new RoundedBoxGeometry(0.16, 0.06, D + 0.07, 1, 0.03),
    accent,
    lid,
    0,
    LID_H + 0.005,
    D / 2,
  );
  for (const x of [-0.3, 0, 0.3]) {
    const t = new THREE.Mesh(toothGeo, detail);
    t.rotation.x = Math.PI;
    t.position.set(x, -0.04, D - 0.07);
    lid.add(t);
  }
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lid: body });
    // on the lid edge: seen from the front and from above
    e.socket.position.set(side * 0.34, LID_H - 0.02, D * 0.9);
    e.socket.rotation.order = 'YXZ';
    e.socket.rotation.set(-0.55, side * 0.18, 0);
    lid.add(e.socket);
    return e;
  });

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();
  let scale = 1;

  /** The reaction's pose at `t` into `o` (rest + reaction). */
  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      o.squash = keys(t, CRIT_SQUASH);
      // One big spring with a spin, then a little extra hop of pure glee.
      const jump = span(t, 0.17, 0.56);
      o.lift = Math.sin(Math.PI * jump) * 0.75 + bump(t, 0.64, 0.78) * 0.16;
      o.spin = TAU * smooth(span(t, 0.2, 0.55));
      o.tuck = Math.max(bump(t, 0.15, 0.58), bump(t, 0.63, 0.79));
      const flap = plateau(t, 0.17, 0.85, 0.06);
      o.lid = lerp(LID, 1.05 + 0.35 * Math.sin(t * TAU * 7), flap);
      o.tongue = 1 + 0.25 * flap;
      o.wag = flap * Math.sin(t * TAU * 5) * 0.5;
      const joy = plateau(t, 0.08, 0.95, 0.08);
      o.upper = lerp(0.2, 0, joy);
      o.lower = lerp(0.1, 0.42, joy); // smiling eyes
      o.gazePitch = lerp(-0.35, 0.25, joy); // up at the world
      o.pitch = -0.12 * joy;
    } else if (reaction === 'fumble') {
      const droop = smooth(span(t, 0.05, 0.5));
      const sigh = bump(t, 0.6, 0.85);
      // The jaw slams shut askew, the chest sags to one side, and two big droopy eyes peek over
      // the lid's front edge, looking down: a sulk that reads from straight above.
      o.lid = lerp(LID, 0.12, smooth(span(t, 0.03, 0.22))) + 0.12 * bump(t, 0.8, 0.97); // a sulky peek
      o.crook = 0.16 * droop;
      o.roll = -0.12 * droop;
      o.tongue = lerp(1, 0, smooth(span(t, 0, 0.18)));
      o.squash = 0.18 * droop - 0.05 * sigh;
      o.lift = -0.04 * droop;
      o.pitch = 0.04 * droop + 0.03 * sigh;
      o.tuck = -0.6 * droop; // feet splay out as it sinks
      o.tiltUp = 1.05 * droop; // the sad eyes still turn up to the camera
      o.eyeScale = 1 + 0.32 * droop;
      o.upper = lerp(0.2, 0.56, droop); // heavy half-moon lids over pupils that look down
      o.lower = lerp(0.1, 0.0, droop);
      o.sad = 0.5 * droop;
      o.gazePitch = lerp(-0.35, -0.75, droop);
      o.gazeYaw = 0.15 * Math.sin(t * TAU * 0.8) * droop;
    } else if (reaction === 'mixed') {
      const tilt = outBack(span(t, 0.04, 0.32), 2.2) * (1 - smooth(span(t, 0.82, 1)));
      o.roll = 0.38 * tilt;
      o.pitch = -0.06 * tilt;
      o.lid = lerp(LID, 0.5, tilt);
      o.upperR = 0.38 * tilt; // one eye squints
      o.sadL = 0.4 * tilt; // the other brow goes up
      o.upper = lerp(0.2, 0.05, tilt);
      // looks from one die to the other
      o.gazeYaw = 0.45 * keys(t, K0);
      o.gazePitch = -0.3;
      o.tongue = lerp(1, 0.55, tilt);
      o.wag = 0.35 * tilt;
    } else {
      // plain: a contented double chomp and a slow happy blink.
      o.lid = keys(t, PLAIN_LID);
      o.pitch = 0.12 * bump(t, 0.12, 0.42) + 0.1 * bump(t, 0.4, 0.66);
      o.squash = 0.06 * bump(t, 0.18, 0.34) + 0.05 * bump(t, 0.44, 0.6);
      const content = plateau(t, 0.1, 0.92, 0.12);
      o.upper = lerp(0.2, 0.36, content);
      o.lower = lerp(0.1, 0.3, content);
      o.tongue = lerp(1, 0.5, bump(t, 0.15, 0.7));
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  /** Breathing, a blink and a lazy tongue: layered on any grounded pose (amount 0..1). */
  function idle(o, ms, amount = 1) {
    const s = Math.sin((ms / 1700) * TAU);
    o.squash += 0.025 * s * amount;
    o.lid += 0.05 * s * amount;
    o.tongue += 0.06 * Math.sin((ms / 900) * TAU) * amount;
    const b = blink(ms, 3000);
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
      // A crouch, then airborne (the layer hops it out): stretched, feet tucked, lid flapping.
      tmp.squash = 0.18 * bump(t, 0, 0.25) - 0.12 * bump(t, 0.2, 0.85) + 0.15 * bump(t, 0.85, 1);
      tmp.tuck = bump(t, 0.18, 0.92);
      tmp.lid = LID + 0.3 * bump(t, 0.2, 0.8);
      tmp.upper = 0.1;
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      PK.reset(p);
      p.squash = -0.14 * bump(t, 0.05, 0.75) + 0.22 * bump(t, 0.72, 1);
      p.tuck = bump(t, 0.02, 0.8);
      p.lid = LID + 0.4 * bump(t, 0.1, 0.8);
      p.upper = 0.05;
      p.lower = 0.05;
      p.gazePitch = -0.1;
    } else if (phase === 'move') {
      // A dodge: it hunkers down and scuttles off on fast little legs in a trot, leaning in,
      // waddling, its lid clacking with each step and the tongue flapping, eyes wide. It starts
      // and ends on the standing pose (exit at t 1).
      PK.reset(p);
      const run = plateau(t, 0.03, 0.97, 0.12);
      const g = t * TAU * SCUTTLE_STEPS;
      p.gait = g;
      p.stride = run;
      p.squash = (0.14 + 0.04 * Math.sin(2 * g)) * run;
      p.lift = 0.035 * Math.abs(Math.sin(g)) * run; // a bob on each step
      p.pitch = 0.14 * run;
      p.roll = 0.08 * Math.sin(g) * run;
      // the jaw clacks open and shut once a step (about 5 frames at 60 fps), so the mouth still
      // shows from above
      p.lid = lerp(LID, 0.62 + 0.26 * Math.sin(g + 1), run);
      p.tongue = lerp(1, 0.8, run);
      p.wag = 0.45 * Math.sin(g) * run;
      p.upper = lerp(0.1, 0, run);
      p.lower = lerp(0.1, 0, run);
      p.eyeScale = 1 + 0.12 * run;
      p.tiltUp = 0.25 * run;
      p.gazePitch = lerp(-0.35, -0.1, run);
    } else if (phase === 'pet') {
      // Petted: a happy wiggle, the lid fluttering, tongue wagging, eyes squeezed shut with joy
      // (look.calm, reduced motion: a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.roll = 0.14 * k * Math.sin(t * TAU * 2.5) * on;
      p.squash = 0.06 * k * Math.sin(t * TAU * 5) * on;
      p.lid = LID + 0.12 * k * Math.sin(t * TAU * 5) * on;
      p.wag = 0.5 * k * Math.sin(t * TAU * 3) * on;
      p.upper = lerp(0.1, 0.75, on);
      p.lower = lerp(0.1, 0.5, on);
      p.tiltUp = 0.2 * on;
    } else if (phase === 'huff') {
      // Huffed: it puffs up and snaps its lid shut, eyes narrowed, glancing away (the layer turns it).
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.squash = (-0.12 * bump(t, 0.05, 0.45) + 0.1 * bump(t, 0.4, 0.75)) * k;
      p.lid = lerp(LID, 0.05, mad);
      p.tongue = lerp(1, 0, mad);
      p.crook = 0.12 * mad;
      p.upper = lerp(0.1, 0.55, mad);
      p.tiltUp = 0.3 * mad;
      p.gazeYaw = 0.7 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop back off the heat, then it fans itself with its lid, flapping
      // it fast, tongue out panting, eyes squinting (look.calm: slower, smaller flaps).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.25 * k * bump(t, 0.02, 0.28);
      p.pitch = -0.12 * k * bump(t, 0.02, 0.3);
      p.lid = LID + 0.35 * k * Math.sin(t * TAU * (look?.calm ? 3 : 5)) * on;
      p.wag = 0.6 * k * Math.sin(t * TAU * 6) * on;
      p.upper = lerp(0.1, 0.6, on);
      p.tiltUp = 0.25 * on;
    } else if (phase === 'shiver') {
      // Frozen (frost): feet tucked in, it shivers side to side, its lid chattering nearly shut,
      // tongue in, eyes squeezed (look.calm: a slower, smaller shiver).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.roll = 0.07 * k * Math.sin(t * TAU * f) * on;
      p.lid = lerp(LID, 0.2, on) + 0.08 * k * Math.sin(t * TAU * f * 1.3) * on;
      p.tongue = lerp(1, 0, on);
      p.tuck = 0.5 * on;
      p.upper = lerp(0.1, 0.55, on);
      p.tiltUp = 0.35 * on;
    } else if (phase === 'bristle') {
      // Zapped (storm): its lid snaps wide, it stands tall on its toes, eyes huge, trembling
      // (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.12 * on;
      p.lid = lerp(LID, LID + 0.45, on);
      p.tongue = lerp(1, 0.3, on);
      p.tuck = -0.4 * on;
      p.roll = 0.04 * k * Math.sin(t * TAU * 10) * on;
      p.eyeScale = 1 + 0.25 * on;
      p.upper = lerp(0.1, 0, on);
      p.lower = lerp(0.1, 0, on);
    } else if (phase === 'startle') {
      // Startled (any other element): a crouch, a jump with its feet tucked and its lid flung open,
      // eyes wide, and a thud of a landing (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      const air = span(t, 0.1, 0.5);
      p.lift = 0.6 * k * Math.sin(Math.PI * air);
      p.squash = 0.15 * bump(t, 0, 0.12) - 0.12 * k * bump(t, 0.1, 0.5) + 0.15 * k * bump(t, 0.48, 0.66);
      p.tuck = bump(t, 0.12, 0.5);
      p.lid = LID + 0.3 * wide;
      p.eyeScale = 1 + 0.2 * wide;
      p.upper = lerp(0.1, 0, wide);
      p.lower = lerp(0.1, 0, wide);
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy hops with its feet tucked, the lid flapping
      // open, tongue out and wagging, smiling eyes looking up (look.calm: one small hop, no flapping).
      // From and back to the standing pose.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      const air1 = bump(t, 0.12, 0.42);
      const air2 = two * bump(t, 0.52, 0.82);
      p.lift = 0.35 * k * (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash =
        k * (0.12 * bump(t, 0.02, 0.14) - 0.1 * air1 + 0.12 * bump(t, 0.42, 0.54)) +
        two * (0.1 * bump(t, 0.82, 0.95) - 0.1 * air2);
      p.tuck = k * (air1 + air2);
      p.lid = lerp(p.lid, LID + 0.3 + two * 0.2 * Math.sin(t * TAU * 6), joy);
      p.tongue = lerp(p.tongue, 1.2, joy);
      p.wag = (calm ? 0.15 : 0.5) * Math.sin(t * TAU * 4) * joy;
      p.upper = lerp(0.1, 0, joy);
      p.lower = lerp(p.lower, 0.42, joy);
      p.gazePitch = lerp(p.gazePitch, 0.25, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: up on its toes, chest out and leaning back, lid up, a smug
      // half-lidded look up at the world. Sulk: lid shut tight, sunk low, leaning forward, feet splayed.
      PK.reset(end);
      end.upper = 0.1; // the standing pose (exit at t 1)
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.squash = -0.1;
        tmp.pitch = -0.16;
        tmp.tuck = -0.45;
        tmp.lid = LID + 0.08;
        tmp.tongue = 0.35;
        tmp.upper = 0.42;
        tmp.lower = 0.32;
        tmp.gazePitch = 0.1;
      } else {
        tmp.lid = 0;
        tmp.tongue = 0;
        tmp.squash = 0.16;
        tmp.lift = -0.03;
        tmp.pitch = 0.08;
        tmp.roll = -0.06;
        tmp.tuck = -0.5;
        tmp.upper = 0.6;
        tmp.sad = 0.5;
        tmp.gazePitch = -0.75;
      }
      PK.blend(p, end, tmp, smooth(t));
      // proud: a little puff of the chest on the way (look.calm: none)
      if (phase === 'proud' && !look?.calm) p.squash -= 0.06 * bump(t, 0.2, 0.8);
    } else if (phase === 'throw') {
      PK.reset(p);
      // It spits the dice: leans back with the lid shut, then lunges with the jaw wide open.
      p.lid = keys(t, THROW_LID);
      p.pitch = keys(t, THROW_PITCH);
      p.squash =
        keys(t, THROW_SQUASH) + 0.06 * wobble(span(t, 0, 0.3), 2, 4) * (1 - span(t, 0, 0.3)); // landing settle
      p.tongue = keys(t, K1);
      p.upper = keys(t, K2);
      p.gazePitch = -0.2;
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (phase === 'watch' || phase === 'react') {
      p.gazeYaw += yaw * 1.1;
      p.yaw += yaw * 0.3;
    }
    apply(p);
  }

  function apply(o) {
    rig.position.y = o.lift; // design units: the scaler scales it
    rig.rotation.set(o.pitch, o.spin + o.yaw, o.roll);
    const sy = 1 - o.squash;
    const sxz = 1 / Math.sqrt(Math.max(0.2, sy));
    squash.scale.set(sxz, sy, sxz);
    lid.rotation.set(-Math.max(-0.02, o.lid), 0, o.crook);
    const out = Math.min(1.3, Math.max(0, o.tongue));
    tonguePivot.position.z = -0.24 + 0.2 * out;
    tonguePivot.rotation.set(0.09 * out, o.wag, 0);
    tonguePivot.scale.set(0.8 + 0.2 * out, 1, 0.55 + 0.45 * out);
    tonguePivot.visible = o.tongue > 0.02;
    for (const f of feet) {
      const h = f.userData.home;
      const ph = o.gait + f.userData.pair;
      // scuttling, the feet splay out from under the chest (so they read from above) and swing
      f.position.set(
        h.x * (1 - 0.18 * o.tuck + 0.22 * o.stride),
        h.y + 0.05 * Math.max(0, o.tuck) + 0.12 * o.stride * Math.max(0, Math.cos(ph)),
        h.z * (1 - 0.15 * o.tuck) + 0.3 * o.stride * Math.sin(ph),
      );
    }
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      // the eyes roll against the jaw, so a wide-open lid still looks up at the camera
      eyes[i].socket.rotation.x = -0.55 - o.tiltUp + 0.85 * Math.max(0, o.lid - LID);
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

  // Fit the closed chest to HEIGHT.
  PK.reset(p);
  p.lid = 0;
  apply(p);
  root.updateMatrixWorld(true);
  const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
  scale = HEIGHT / h;
  scaler.scale.setScalar(scale);

  return {
    root,
    footprint: 0.95, // the chest half-width, measured from the built geometry in XZ
    height: HEIGHT,
    pose,
    dispose: () => kit.dispose(),
  };
}

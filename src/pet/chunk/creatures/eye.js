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
 * The floating eye: one big white eyeball hovering over four short soft tendrils whose curled tips
 * rest on the floor. Its upper and lower lids (and the shell round its back) are the user colour,
 * the big iris the lighter accent, with one dark pupil, a glint and long lashes on the upper lid.
 * The ball is tipped up toward the camera, so from above it reads as one big curious eye.
 * Curious and dramatic. Crit: the eye opens wide, the pupil swells, sparkles, it bobs up and the
 * tendrils wave; fumble: heavy teary lids, it sinks and the tendrils go limp; mixed: a skeptical
 * squint (the lid lowered on one side) and a tilt; plain: a slow, satisfied blink.
 */

const HEIGHT = 1.5;
const FOOT = 0.6; // top-down body radius in scene units, tendrils excluded (measured)
// Design units (scaled to HEIGHT at build).
const R = 0.5; // the eyeball
const CY = 0.82; // its centre over the tendrils' roots
const BASE_PITCH = -1.05; // the ball tipped up toward the top-down camera
// Lids are lunes (slices between two half-great-circles through the eye's corners at +-X) that turn
// about X. Each is full-size at its front edge (a soft half-round rim hugging the ball) and eases
// down at its back edge to tuck under the fixed back shell, so from behind it all reads as one
// smooth shell with no seam ring.
const UP_R = R * 1.065; // upper lid at its front edge
const LO_R = R * 1.05; // lower lid at its front edge
const TUCK_R = R * 1.008; // both lids at their back edge (inside the shell)
const SHELL_R = R * 1.035; // the back shell, a fixed lune behind the widest eye opening
const SHELL_A = [1.78, 4.68]; // its span, rad round X from the front (+Z) toward the top (+Y)
const LID_L = 2.62; // each lid's span (rad): its back edge stays under the shell in every pose
const RIM_T = 0.026; // the lids' rim tube radius
const TEND_N = 4;
const TEND_AZ = [1.0, -1.0, 2.15, -2.15]; // front-right, front-left, back-right, back-left (rad from +Z)
const TEND_BACK = [2.15, -2.15, 1.0, -1.0]; // the turn that points each one behind
const SEG_N = 4;
const SEG = 0.27;
const SEG_R = [0.1, 0.084, 0.07, 0.058, 0.058]; // radius at each joint (the last: the round tip)
// Joint bends (rad, + down): steeply out of the ball, levelling on the floor, the tip curling up.
const J0 = 1.0;
const JA = [0, -0.3, -0.45, -0.75];
const LO0 = 0.08; // the lower lid at rest: low, so the tipped-up eye shows from the side too
const TEAR = new THREE.Color('#9fd8ff');

const REST = {
  lift: 0,
  squash: 0, // > 0 flatter, < 0 taller (the ball only)
  pitch: 0, // + leans forward
  roll: 0,
  spin: 0,
  yaw: 0,
  orbPitch: 0, // + the eye looks down
  orbYaw: 0,
  orbRoll: 0,
  upper: 0.15, // 0 open .. 1 shut (0.55 meets the lower at the middle)
  lower: LO0,
  tiltLid: 0, // the upper lid lowered on one side (a skeptical squint)
  gazeYaw: 0,
  gazePitch: 0,
  pupil: 1, // pupil size
  glint: 1, // sparkle size
  tear: 0, // 0..1 tears welling and rolling down
  curl: 1, // tendril tips curled (0 limp, straight)
  spread: 0, // + lifts the tendrils out toward level
  reach: 0, // the front-right tendril raised and flung forward (throws)
  trail: 0, // 0..1 tendrils streaming behind (flight)
  wave: 0, // tendril wave amplitude, rad
  wt: 0, // its phase, rad
  sway: 0, // tendril sway about the vertical, rad
  st: 0, // its phase
};
const PK = poseKit(REST);
const FLY_WAVES = 3; // tendril waves in one dodge flight

// More keyframes, hoisted so a pose allocates nothing.
const K_LOOK = [0.2, 0, 0.32, -1, 0.5, -1, 0.6, 1, 0.78, 1, 0.9, 0];
const K_BLINK = [0, 0, 0.18, 0, 0.32, 1, 0.48, 1, 0.66, 0.45, 1, 0.45]; // plain: slow blink, then content
const THROW_PITCH = [0, 0, 0.3, -0.18, 0.52, 0.22, 0.8, 0.04, 1, 0];
const THROW_REACH = [0, 0, 0.28, 0.75, 0.5, 1, 0.62, 0.3, 1, 0];
const THROW_UPPER = [0, 0.15, 0.3, 0.32, 0.5, 0.02, 1, 0.15];

/**
 * A lune of the sphere: half-great-circles through the corners at -X..+X, swept round X from
 * angle a0 to a1 (from +Z toward +Y), radius rad(f) at fraction f of the sweep. Outward normals.
 */
function lune(rad, a0, a1, aSeg, bSeg) {
  const w = bSeg + 1;
  const pos = new Float32Array((aSeg + 1) * w * 3);
  const nor = new Float32Array(pos.length);
  let k = 0;
  for (let i = 0; i <= aSeg; i++) {
    const f = i / aSeg;
    const a = a0 + (a1 - a0) * f;
    const r = rad(f);
    for (let j = 0; j <= bSeg; j++) {
      const b = (j / bSeg) * Math.PI;
      const dx = -Math.cos(b);
      const dy = Math.sin(b) * Math.sin(a);
      const dz = Math.sin(b) * Math.cos(a);
      nor[k] = dx;
      nor[k + 1] = dy;
      nor[k + 2] = dz;
      pos[k++] = dx * r;
      pos[k++] = dy * r;
      pos[k++] = dz * r;
    }
  }
  const idx = [];
  const flip = a1 < a0;
  for (let i = 0; i < aSeg; i++) {
    for (let j = 0; j < bSeg; j++) {
      const v = i * w + j;
      if (flip) idx.push(v, v + w, v + 1, v + 1, v + w, v + w + 1);
      else idx.push(v, v + 1, v + w, v + 1, v + w + 1, v + w);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** A lid's radius along its sweep: full at the front edge, easing down to tuck under the shell. */
const lidRadius = (front) => (f) => front - (front - TUCK_R) * smooth(span(f, 0.45, 1));

export function eye(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.42, metalness: 0.05 }),
  );
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.25, metalness: 0.05 }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'eye';
  const scaler = new THREE.Group();
  root.add(scaler);
  const base = new THREE.Group(); // lifts it so the tendril tips stand on y = 0 (fitted below)
  scaler.add(base);
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  base.add(rig);

  // The orb: the ball, its shell and lids.
  const orb = new THREE.Group();
  orb.rotation.order = 'YXZ';
  orb.position.y = CY;
  rig.add(orb);
  kit.mesh(lune(() => SHELL_R, SHELL_A[0], SHELL_A[1], 9, 12), body, orb);

  // The eyeball turns with the gaze: white, the accent iris, the pupil and its glints.
  const ball = new THREE.Group();
  ball.rotation.order = 'YXZ';
  orb.add(ball);
  kit.mesh(paint(new THREE.SphereGeometry(R, 20, 12), INK.white), detail, ball);
  kit.mesh(new THREE.SphereGeometry(R * 1.006, 20, 3, 0, TAU, 0, 0.56).rotateX(Math.PI / 2), accent, ball);
  // The pupil: a cap on the iris, its origin on the front of the ball (so it follows the gaze).
  const pupil = kit.mesh(
    paint(
      new THREE.SphereGeometry(R * 1.016, 16, 2, 0, TAU, 0, 0.3).rotateX(Math.PI / 2).translate(0, 0, -R),
      INK.pupil,
    ),
    detail,
    ball,
    0,
    0,
    R,
    'pupil',
  );
  const glint = kit.mesh(paint(new THREE.SphereGeometry(R * 0.12, 6, 4), INK.glint), detail, ball);
  glint.position.set(-0.23 * R, 0.23 * R, 0.94 * R); // on the surface (flattened in apply)
  const glint2 = kit.mesh(paint(new THREE.SphereGeometry(R * 0.06, 6, 4), INK.glint), detail, ball);
  glint2.position.set(0.19 * R, -0.15 * R, 0.96 * R);

  // Lids: lunes of the body colour, their front edge at local +Z (the upper sweeping back over +Y,
  // the lower over -Y), each with a soft half-round rim along that edge only; long lashes on the
  // upper one.
  const rim = (r) => new THREE.TorusGeometry(r - RIM_T * 0.45, RIM_T, 5, 12, Math.PI).rotateX(Math.PI / 2);
  const upPivot = new THREE.Group();
  orb.add(upPivot);
  const upLid = kit.mesh(lune(lidRadius(UP_R), 0, LID_L, 10, 12), body, upPivot);
  kit.mesh(rim(UP_R), body, upLid);
  const loLid = kit.mesh(lune(lidRadius(LO_R), 0, -LID_L, 10, 12), body, orb);
  kit.mesh(rim(LO_R), body, loLid);
  const up = new THREE.Vector3(0, 1, 0);
  for (const [phi, len] of [
    [-1.0, 0.17],
    [-0.5, 0.22],
    [0, 0.25],
    [0.5, 0.22],
    [1.0, 0.17],
  ]) {
    const radial = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
    const d = radial.clone().multiplyScalar(0.8).addScaledVector(up, -0.5).normalize(); // out over the eye
    const z = up.clone().addScaledVector(d, -up.dot(d)).normalize();
    const x = new THREE.Vector3().crossVectors(d, z);
    const g = bend(new THREE.ConeGeometry(0.028, len, 4, 3).translate(0, len / 2, 0), len, 0.7);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(x, d, z));
    g.translate(radial.x * (UP_R - RIM_T * 0.3), 0, radial.z * (UP_R - RIM_T * 0.3));
    kit.mesh(paint(g, INK.pupil), detail, upLid);
  }
  // Tears: two drops below the lower lid (fumble).
  const tearGeo = kit.geo(paint(new THREE.SphereGeometry(0.06, 6, 4), TEAR));
  const tears = [1, -1].map(() => {
    const m = new THREE.Mesh(tearGeo, detail);
    m.scale.set(1, 1.35, 0.8);
    orb.add(m);
    return m;
  });

  // Tendrils: tapering chains out of the underside, curling at the tips; the tips accent. Each
  // segment is a tapered tube ending in a ball of its end radius, which the next tube starts from,
  // so a bent chain stays one smooth tapering tendril (no beads).
  // The last tube tapers to the joint radius and ends in the accent tip pad (its own mesh).
  const tubeGeo = (j) => {
    const r1 = Math.min(SEG_R[j + 1], SEG_R[j]);
    return new THREE.CylinderGeometry(r1, SEG_R[j], SEG, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, SEG / 2);
  };
  const segGeos = SEG_R.slice(0, SEG_N).map((r0, j) => {
    if (j === SEG_N - 1) return kit.geo(tubeGeo(j));
    const tube = tubeGeo(j);
    const knob = new THREE.SphereGeometry(SEG_R[j + 1], 6, 3).translate(0, 0, SEG);
    const g = mergeFlat([tube, knob]);
    tube.dispose();
    knob.dispose();
    return kit.geo(g);
  });
  const tipGeo = kit.geo(new THREE.SphereGeometry(SEG_R[SEG_N], 6, 4).translate(0, 0, SEG));
  const tend = []; // flat: TEND_N x SEG_N joints
  for (let i = 0; i < TEND_N; i++) {
    const a = TEND_AZ[i];
    let parent = rig;
    for (let j = 0; j < SEG_N; j++) {
      const jt = new THREE.Group();
      jt.rotation.order = 'YXZ';
      if (j === 0) jt.position.set(Math.sin(a) * 0.18, CY - 0.3, Math.cos(a) * 0.18);
      else jt.position.z = SEG;
      parent.add(jt);
      jt.add(new THREE.Mesh(segGeos[j], body));
      if (j === SEG_N - 1) jt.add(new THREE.Mesh(tipGeo, accent));
      tend.push(jt);
      parent = jt;
    }
  }

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // Wide open, the pupil swelling, sparkling; it bobs up high and the tendrils wave.
      const joy = plateau(t, 0.06, 0.95, 0.08);
      o.upper = lerp(0.15, -0.02, joy);
      o.lower = lerp(LO0, 0.04, joy);
      o.pupil = lerp(1, 1.32, outBack(span(t, 0.05, 0.3), 2.5)) * joy + (1 - joy);
      o.glint = lerp(1, 1.9 + 0.3 * Math.sin(t * TAU * 6), joy);
      o.lift = 0.38 * Math.sin(Math.PI * span(t, 0.12, 0.85)) + 0.04 * Math.sin(t * TAU * 4) * joy;
      o.squash = -0.1 * bump(t, 0.08, 0.3) + 0.08 * bump(t, 0.8, 0.95);
      o.orbPitch = 0.05 * joy;
      o.gazePitch = 0.05 * joy;
      o.roll = 0.12 * Math.sin(t * TAU * 2) * joy;
      o.spread = 0.5 * joy;
      o.curl = lerp(1, 0.6, joy);
      o.wave = 0.45 * joy;
      o.wt = t * TAU * 4;
    } else if (reaction === 'fumble') {
      // Heavy lids droop to a teary squint; it sinks and the tendrils go limp.
      const droop = smooth(span(t, 0.04, 0.5));
      const sob = bump(t, 0.55, 0.75) + bump(t, 0.75, 0.95);
      o.upper = lerp(0.15, 0.41, droop);
      o.lower = lerp(LO0, 0.24, droop);
      o.tiltLid = 0.04 * sob;
      o.pupil = lerp(1, 0.85, droop);
      o.glint = lerp(1, 1.3, droop); // wet and shiny
      o.gazePitch = -0.28 * droop;
      o.orbPitch = 0.2 * droop + 0.04 * sob;
      o.lift = -0.12 * droop;
      o.squash = 0.08 * droop - 0.03 * sob;
      o.tear = smooth(span(t, 0.25, 0.95));
      o.spread = 0.65 * droop;
      o.curl = lerp(1, 0.15, droop);
      o.sway = 0.08 * droop;
    } else if (reaction === 'mixed') {
      // A skeptical squint, the lid lowered on one side, a tilt, a sideways look.
      const tilt = outBack(span(t, 0.04, 0.32), 2) * (1 - smooth(span(t, 0.82, 1)));
      o.roll = 0.28 * tilt;
      o.orbRoll = 0.1 * tilt;
      o.upper = lerp(0.15, 0.36, tilt);
      o.lower = lerp(LO0, 0.3, tilt);
      o.tiltLid = 0.42 * tilt;
      o.pupil = lerp(1, 0.9, tilt);
      o.gazeYaw = 0.45 * keys(t, K_LOOK);
      o.curl = lerp(1, 1.3, tilt); // the tendrils curl up, puzzled
      o.sway = 0.15 * tilt;
      o.st = t * TAU * 2;
    } else {
      // plain: a slow, satisfied blink, a little bob up.
      const b = keys(t, K_BLINK);
      const content = plateau(t, 0.08, 0.92, 0.12);
      o.upper = lerp(0.15, 0.56, b) * content + 0.15 * (1 - content);
      o.lower = lerp(LO0, 0.46, b) * content + LO0 * (1 - content);
      o.lift = 0.1 * bump(t, 0.1, 0.6);
      o.orbPitch = -0.08 * content;
      o.sway = 0.1 * content;
      o.st = t * TAU;
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  function idle(o, ms, amount = 1) {
    // A gentle hover bob (small: the tendril tips stay on the floor), swaying tendrils, a drifting
    // gaze and a slow blink.
    o.lift += 0.025 * Math.sin((ms / 1700) * TAU) * amount;
    o.squash += 0.02 * Math.sin((ms / 1700) * TAU + 1.4) * amount;
    o.sway += 0.12 * amount;
    o.st += (ms / 2300) * TAU;
    o.gazeYaw += 0.12 * Math.sin((ms / 4100) * TAU) * amount;
    o.gazePitch += 0.06 * Math.sin((ms / 3300) * TAU) * amount;
    const b = blink(ms, 1700);
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
      tmp.lift = 0.12 * bump(t, 0.2, 0.85);
      tmp.squash = 0.08 * bump(t, 0, 0.25) + 0.08 * bump(t, 0.85, 1);
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      // Floats in, eye wide, tendrils rippling, and settles.
      PK.reset(p);
      const on = bump(t, 0, 0.9);
      p.lift = 0.25 * bump(t, 0.05, 0.8) - 0.05 * bump(t, 0.8, 1);
      p.upper = lerp(0.15, 0.02, on);
      p.pupil = lerp(1, 1.15, on);
      p.wave = 0.3 * on;
      p.wt = t * TAU * 2.5;
      p.spread = 0.25 * on;
    } else if (phase === 'move') {
      // A dodge: it flies (the layer lifts it in an arc), leaning into the flight, the eye still
      // on where it goes, wide and bright, the tendrils streaming behind and rippling; then it
      // settles back onto them. It starts and ends on the standing pose (exit at t 1).
      PK.reset(p);
      const fly = plateau(t, 0.04, 0.96, 0.14);
      p.lift = 0.14 * fly;
      p.squash = 0.06 * bump(t, 0, 0.14) - 0.06 * fly + 0.06 * bump(t, 0.86, 1);
      p.pitch = 0.35 * fly;
      p.orbPitch = -0.3 * fly;
      p.upper = lerp(0.15, 0.02, fly);
      p.lower = lerp(LO0, 0.1, fly);
      p.pupil = lerp(1, 1.12, fly);
      p.trail = fly;
      p.spread = 0.35 * fly;
      p.curl = lerp(1, 0.35, fly);
      p.wave = 0.35 * fly;
      p.wt = t * TAU * FLY_WAVES;
    } else if (phase === 'pet') {
      // Petted: a happy wiggle, the eye squeezed into a smiling crescent, tendrils rippling
      // (look.calm, reduced motion: a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.roll = 0.18 * k * Math.sin(t * TAU * 2) * on;
      p.squash = 0.07 * k * Math.sin(t * TAU * 3) * on;
      p.lift = 0.06 * k * on;
      p.upper = lerp(0.15, 0.42, on);
      p.lower = lerp(LO0, 0.44, on);
      p.glint = lerp(1, 1.3, on);
      p.wave = 0.3 * k * on;
      p.wt = t * TAU * 3;
      p.spread = 0.2 * on;
    } else if (phase === 'huff') {
      // Huffed: the ball puffs up, the eye narrows to a glare and turns away, tendrils tucked.
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.squash = (-0.12 * bump(t, 0.05, 0.45) + 0.08 * bump(t, 0.4, 0.75)) * k;
      p.upper = lerp(0.15, 0.44, mad);
      p.lower = lerp(LO0, 0.34, mad);
      p.tiltLid = -0.15 * mad;
      p.orbYaw = 0.4 * mad;
      p.gazeYaw = 0.5 * mad;
      p.orbPitch = -0.1 * mad;
      p.curl = lerp(1, 1.4, mad);
      p.spread = -0.15 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop up off the heat, then the two front tendrils fan the eye,
      // which squints against the heat (look.calm: slower, smaller fanning).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.3 * k * bump(t, 0.02, 0.28) + 0.05 * on;
      p.upper = lerp(0.15, 0.48, on);
      p.lower = lerp(LO0, 0.36, on);
      p.reach = on * (0.55 + 0.35 * k * Math.sin(t * TAU * (look?.calm ? 3 : 6)));
      p.wave = 0.25 * k * on;
      p.wt = t * TAU * (look?.calm ? 3 : 6);
      p.orbPitch = -0.15 * on;
      p.curl = lerp(1, 0.6, on);
    } else if (phase === 'shiver') {
      // Frozen (frost): it hunches low with its tendrils curled tight under it and shivers side to
      // side, eye squeezed (look.calm: a slower, smaller shiver).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = -0.05 * on;
      p.squash = 0.06 * on;
      p.roll = 0.08 * k * Math.sin(t * TAU * f) * on;
      p.upper = lerp(0.15, 0.48, on);
      p.lower = lerp(LO0, 0.4, on);
      p.curl = lerp(1, 1.6, on);
      p.spread = -0.2 * on;
      p.pupil = lerp(1, 0.8, on);
    } else if (phase === 'bristle') {
      // Zapped (storm): it shoots up, tendrils splayed out stiff, eye wide with a pinpoint pupil,
      // trembling (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.lift = 0.12 * on;
      p.squash = -0.1 * on;
      p.roll = 0.05 * k * Math.sin(t * TAU * 10) * on;
      p.upper = lerp(0.15, -0.02, on);
      p.lower = lerp(LO0, 0.02, on);
      p.pupil = lerp(1, 0.5, on);
      p.spread = 0.7 * on;
      p.curl = lerp(1, 0.2, on);
    } else if (phase === 'startle') {
      // Startled (any other element): a jump straight up, eye wide and pupil shrunk, tendrils
      // flung out, and it floats back down (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      p.lift = 0.6 * k * Math.sin(Math.PI * span(t, 0.08, 0.6));
      p.squash = 0.1 * bump(t, 0, 0.1) - 0.1 * k * bump(t, 0.08, 0.5);
      p.upper = lerp(0.15, -0.02, wide);
      p.lower = lerp(LO0, 0.02, wide);
      p.pupil = lerp(1, 0.6, wide);
      p.spread = 0.6 * k * bump(t, 0.05, 0.7);
      p.curl = lerp(1, 0.4, wide);
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy bobs up, the tendrils waving high, a smiling
      // eye with a big bright pupil (look.calm: one small bob). From and back to the standing pose.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      p.lift = 0.4 * k * (Math.sin(Math.PI * span(t, 0.1, 0.45)) + two * Math.sin(Math.PI * span(t, 0.52, 0.88)));
      p.squash = 0.06 * k * (bump(t, 0, 0.12) + two * bump(t, 0.45, 0.55));
      p.upper = lerp(0.15, 0.3, joy);
      p.lower = lerp(LO0, 0.42, joy);
      p.pupil = lerp(1, 1.2, joy);
      p.glint = lerp(1, 1.5, joy);
      p.orbPitch = -0.2 * joy;
      p.spread = 0.55 * joy;
      p.wave = (calm ? 0.15 : 0.5) * joy;
      p.wt = t * TAU * (calm ? 2 : 4);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: floating a little higher, leaning back, the eye looking up
      // under a smug half-lid. Sulk: sunk low on limp tendrils, the eye down under heavy lids.
      PK.reset(end); // the standing pose (exit at t 1)
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.lift = 0.16;
        tmp.pitch = -0.1;
        tmp.orbPitch = -0.2;
        tmp.upper = 0.32;
        tmp.lower = 0.3;
        tmp.gazePitch = 0.15;
        tmp.spread = 0.15;
        tmp.curl = 1.2;
      } else {
        tmp.lift = -0.2;
        tmp.squash = 0.1;
        tmp.orbPitch = 0.2;
        tmp.upper = 0.43;
        tmp.lower = 0.28;
        tmp.gazePitch = -0.25;
        tmp.pupil = 0.88;
        tmp.spread = 0.75;
        tmp.curl = 0.1;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.squash -= 0.06 * bump(t, 0.2, 0.8); // a puff on the way
    } else if (phase === 'throw') {
      // Rears back, then lunges, its front tendril flung up and forward; the eye narrows to aim.
      PK.reset(p);
      p.pitch = keys(t, THROW_PITCH);
      p.reach = keys(t, THROW_REACH);
      p.upper = keys(t, THROW_UPPER);
      p.lift = 0.08 * bump(t, 0.2, 0.7);
      p.gazePitch = -0.1;
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.gazeYaw += yaw * 0.85;
      p.orbYaw += yaw * 0.35;
      p.yaw += yaw * 0.1;
    }
    apply(p);
  }

  function apply(o) {
    rig.position.y = o.lift;
    rig.rotation.set(o.pitch, o.spin + o.yaw, o.roll);
    orb.rotation.set(BASE_PITCH + o.orbPitch, o.orbYaw, o.orbRoll);
    const sy = Math.max(0.5, 1 - o.squash);
    const sxz = 1 / Math.sqrt(sy);
    orb.scale.set(sxz, sy, sxz);
    ball.rotation.set(-o.gazePitch, o.gazeYaw, 0);
    const pu = Math.max(0.3, o.pupil);
    pupil.scale.set(pu, pu, 1);
    pupil.position.z = R + (pu < 1 ? R * 0.08 * (1 - pu) : 0); // keep a shrunk cap above the iris
    const gl = Math.max(0.1, o.glint);
    glint.scale.set(gl, gl, 0.25 * gl); // flat highlights: never poke through the shut lids
    glint2.scale.set(gl, gl, 0.25 * gl);
    // Lid rotations as createEye's: the upper lid's front edge at 90 deg .. -90 deg over 0..1.
    const upper = Math.min(1, Math.max(-0.05, o.upper));
    upLid.rotation.x = -Math.PI / 2 + upper * Math.PI;
    upPivot.rotation.z = o.tiltLid;
    const lower = clamp01(o.lower);
    const loA = Math.PI / 2 - lower * Math.PI * 0.98;
    loLid.rotation.x = loA;
    // Tears: from under the lower lid's front edge, rolling down the ball.
    const tear = clamp01(o.tear);
    for (let i = 0; i < 2; i++) {
      const m = tears[i];
      m.visible = tear > 0.01;
      const e = -loA - 0.12 - 0.7 * tear; // elevation on the ball
      m.position.set((i === 0 ? 0.38 : -0.38) * R, Math.sin(e) * LO_R * 1.02, Math.cos(e) * LO_R * 1.02);
      m.scale.set(0.4 + 0.6 * tear, (0.4 + 0.6 * tear) * 1.35, 0.8);
    }
    // Tendrils.
    const curl = Math.max(0, o.curl);
    for (let i = 0; i < TEND_N; i++) {
      const reach = i === 0 ? clamp01(o.reach) : 0;
      const ph = o.wt + i * 1.7;
      for (let j = 0; j < SEG_N; j++) {
        const jt = tend[i * SEG_N + j];
        const w = o.wave * Math.sin(ph - j * 0.9);
        if (j === 0) {
          jt.rotation.y =
            TEND_AZ[i] + TEND_BACK[i] * 0.75 * o.trail + o.sway * Math.sin(o.st + i * 1.7) - reach * TEND_AZ[i] * 0.8;
          jt.rotation.x = J0 - o.spread - reach * 1.9 + 0.3 * w;
          jt.rotation.z = 0;
        } else {
          jt.rotation.x = JA[j] * curl * (1 - reach) + w;
          jt.rotation.z = 0.3 * w * (o.trail > 0 ? 1 : 0.4);
        }
      }
    }
  }

  PK.reset(p);
  apply(p);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  base.position.y = -box.min.y;
  scaler.scale.setScalar(HEIGHT / box.getSize(new THREE.Vector3()).y);

  return { root, height: HEIGHT, footprint: FOOT, pose, dispose: () => kit.dispose() };
}

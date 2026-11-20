import * as THREE from 'three';
import {
  TAU,
  INK,
  bump,
  keys,
  lerp,
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
 * The imp: a small chubby red devil hovering on flapping bat wings. A round body with stubby
 * dangling legs and little clawed hands, a big round head tilted back toward the top-down camera
 * with chubby cheeks, small curved horns (dark at the root, bone at the tip), pointed ears sticking
 * out to the sides, yellow eyes with slit pupils under sly little brows and a wide mischievous grin
 * with two fangs. A thin tail hangs down from its rump and lays its spade tip on the floor (the
 * only part that touches it). From above: a round impish face between pointed ears, two horns,
 * and the wings beating at its back.
 * Crit: it cackles and loops a full flip in the air, arms up; fumble: it drops to the floor flat on
 * its belly and pouts, wings drooping; mixed: a scheming rub of its hands under a sly squint;
 * plain: a smug grin and a flick of the tail. Throw: it lobs the dice overhand.
 */

const HEIGHT = 1.5;
const FOOT = 0.59; // top-down body radius in scene units (head, ears, cheeks), wings and tail excluded (measured)
const EYE_R = 0.12;
const CY = 0.56; // the body's centre (design units): it turns, flips and lies down about here
const TILT = 0.55; // the head's built-in tilt back (rad), its face up toward the camera
const TAIL_N = 6;
const SEG = 0.095;
// The tail's rest bends per joint (rad, + up): back off the rump, hanging down, the tip laid back
// along the floor.
const TAIL_BEND = [-0.7, -0.35, -0.3, -0.2, 0.65, 0.8];
const FLAP_MS = 420; // one wing beat while it hovers
const DROP = 0.24; // how far it sinks to lie on its belly (design units)
const YELLOW = new THREE.Color('#ffc62e');
const BROW_INK = new THREE.Color('#2a1416');
const CLAW_INK = new THREE.Color('#2e2226');
const HORN_ROOT = new THREE.Color('#3a2a2c');
const HORN_TIP = new THREE.Color('#efe3c4');

const REST = {
  lift: 0,
  squash: 0,
  pitch: 0, // + leans forward (about its centre)
  roll: 0,
  yaw: 0,
  flip: 0, // a forward loop about its centre (rad)
  spin: 0,
  headPitch: 0, // + nods down
  headRoll: 0,
  headYaw: 0,
  ear: 0, // + perks the ears up, - droops them
  wing: 0.28, // raise (rad): 0 flat out, + up, - down
  wingL: 0, // extra raise on the +X wing
  sweep: 0.32, // + folds the wings back
  armL: 0.35, // forward raise (rad) of the +X arm, and of the other
  armR: 0.35,
  armOut: 0, // spreads the arms out to the sides
  armIn: 0, // brings the hands together in front (a steeple, a rub, crossed arms)
  rub: 0, // the hands rubbing (+-)
  leg: 0, // + swings the dangling legs forward, - tucks them back
  sway: 0, // tail side swing
  flick: 0, // the spade's flick
  tailLift: 0, // + bends the tail back and up
  upper: 0.12,
  lower: 0.05,
  upperL: 0, // extra on the +X eye's upper lid
  sad: 0, // + worried brows, - scheming / cross
  gazeYaw: 0,
  gazePitch: -0.1,
  grin: 1, // 1 the wide grin, > 1 wider, < 0 a pout
  open: 0, // mouth open (a cackle)
  dilate: 0, // 0 slit pupils .. 1 round
};
const PK = poseKit(REST);

// Keyframes, hoisted so a pose allocates nothing.
const CRIT_SQUASH = [0, 0, 0.12, 0.18, 0.22, -0.12, 0.62, -0.06, 0.74, 0.12, 0.86, 0];
const CRIT_LIFT = [0, 0, 0.12, -0.02, 0.32, 0.72, 0.62, 0.72, 0.8, 0];
const THROW_ARM = [0, 0.35, 0.28, 2.75, 0.44, 2.9, 0.6, 1.0, 1, 0.35];
const THROW_PITCH = [0, 0, 0.28, -0.12, 0.55, 0.22, 1, 0];
const THROW_HEAD = [0, 0, 0.28, -0.2, 0.55, 0.12, 1, 0];
const THROW_ROLL = [0, 0, 0.3, 0.1, 0.55, -0.08, 1, 0];
const THROW_WING = [0, 0.28, 0.28, 0.9, 0.55, -0.1, 0.8, 0.55, 1, 0.28];
const FLICK = [0, 0, 0.35, 0.9, 0.5, -0.7, 0.62, 0.5, 0.74, -0.2, 0.86, 0];

/** A cylinder strut from a to b (design units, in the wing's plane y = 0). */
function strut(ax, az, bx, bz, r0, r1) {
  const len = Math.hypot(bx - ax, bz - az);
  const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(bx - ax, 0, bz - az).normalize()),
  );
  g.translate(ax, 0, az);
  return g;
}

/** Vertex colours from c0 at y0 to c1 at y1 (a horn dark at the root, bone at the tip). */
function paintY(geo, c0, c1, y0, y1) {
  paint(geo, c0);
  const p = geo.attributes.position;
  const c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const k = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)));
    const s = k * k * (3 - 2 * k);
    c.setXYZ(i, lerp(c0.r, c1.r, s), lerp(c0.g, c1.g, s), lerp(c0.b, c1.b, s));
  }
  return geo;
}

export function imp(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55, metalness: 0 }));
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5, metalness: 0, side: THREE.DoubleSide }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'imp';
  const scaler = new THREE.Group();
  root.add(scaler);
  const base = new THREE.Group(); // lifts it so its lowest point (the spade) is on the floor
  scaler.add(base);
  const rig = new THREE.Group(); // the hover lift
  base.add(rig);
  const pivot = new THREE.Group(); // turns, leans and flips about the body's centre
  pivot.rotation.order = 'YXZ';
  pivot.position.y = CY;
  rig.add(pivot);
  const squash = new THREE.Group();
  squash.position.y = -CY;
  pivot.add(squash);

  // The round body with a lighter belly.
  const torso = kit.mesh(new THREE.SphereGeometry(0.28, 12, 8), body, squash, 0, CY, -0.02);
  torso.scale.set(1.02, 0.96, 0.94);
  const belly = kit.mesh(new THREE.SphereGeometry(0.2, 9, 5), accent, squash, 0, CY - 0.05, 0.11);
  belly.scale.set(0.95, 1.05, 0.55);

  // Claws: small dark cones, pointing down their local -Y.
  const clawGeo = kit.geo(paint(new THREE.ConeGeometry(0.014, 0.04, 4).rotateX(Math.PI), CLAW_INK));

  // Stubby legs dangling from the hips: a short leg, a foot pointing forward with three claws.
  const legGeo = kit.geo(new THREE.CylinderGeometry(0.048, 0.055, 0.12, 6, 1, true).translate(0, -0.06, 0));
  const footGeo = kit.geo(new THREE.SphereGeometry(0.065, 6, 4));
  const legs = [1, -1].map((sx) => {
    const g = new THREE.Group();
    g.position.set(sx * 0.12, CY - 0.16, 0.03);
    squash.add(g);
    g.add(new THREE.Mesh(legGeo, body));
    const foot = new THREE.Mesh(footGeo, body);
    foot.position.set(0, -0.13, 0.03);
    foot.scale.set(0.9, 0.72, 1.35);
    g.add(foot);
    for (const dx of [-0.03, 0, 0.03]) {
      const c = new THREE.Mesh(clawGeo, detail);
      c.position.set(dx, -0.14, 0.12);
      c.rotation.x = -Math.PI / 2 - 0.3; // forward and a little down
      g.add(c);
    }
    return g;
  });

  // Arms from the shoulders: a short arm and a little hand with three claws.
  const armGeo = kit.geo(new THREE.CylinderGeometry(0.042, 0.05, 0.2, 6, 1, true).translate(0, -0.1, 0));
  const handGeo = kit.geo(new THREE.SphereGeometry(0.058, 6, 4));
  const arms = [1, -1].map((sx) => {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.position.set(sx * 0.22, CY + 0.1, 0.05);
    squash.add(g);
    g.add(new THREE.Mesh(armGeo, body));
    kit.mesh(handGeo, body, g, 0, -0.22, 0);
    for (const dx of [-0.026, 0, 0.026]) {
      const c = new THREE.Mesh(clawGeo, detail);
      c.position.set(dx, -0.27, 0.02);
      c.rotation.x = 0.25;
      g.add(c);
    }
    return g;
  });

  // Head: big and round, tilted back so the face looks up at the camera. The neck pivot sits
  // under the back of the skull, so a head turn swings the face round.
  const neck = new THREE.Group();
  neck.rotation.order = 'YXZ';
  neck.position.set(0, CY + 0.2, -0.04);
  squash.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.3, 0.07);
  head.rotation.x = -TILT;
  neck.add(head);
  // The skull's squash and tilt baked into its geometry, the mesh turned back upright, so its
  // bounding box stays tight.
  const skull = kit.mesh(new THREE.SphereGeometry(0.36, 14, 10).scale(1.1, 0.94, 0.95).rotateX(-TILT), body, head);
  skull.rotation.x = TILT;
  const cheekGeo = kit.geo(new THREE.SphereGeometry(0.15, 8, 5));
  for (const sx of [1, -1]) {
    const ch = new THREE.Mesh(cheekGeo, body);
    ch.position.set(sx * 0.2, -0.11, 0.13);
    ch.scale.set(0.95, 0.8, 0.85);
    head.add(ch);
  }
  const chin = kit.mesh(new THREE.SphereGeometry(0.12, 8, 5), body, head, 0, -0.2, 0.14);
  chin.scale.set(1.2, 0.65, 0.85);

  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lid: body });
    paint(e.ball.children[0].geometry, YELLOW); // yellow eyes
    e.socket.position.set(side * 0.155, 0.05, 0.27);
    e.socket.rotation.order = 'YXZ';
    e.socket.rotation.set(-0.12, side * 0.3, 0);
    head.add(e.socket);
    return e;
  });
  const pupils = eyes.map((e) => e.ball.children.find((m) => m.name === 'pupil'));
  // Sly little brows over the eyes.
  const browGeo = kit.geo(paint(new THREE.BoxGeometry(0.13, 0.026, 0.03), BROW_INK));
  const brows = [1, -1].map((side) => {
    const b = new THREE.Mesh(browGeo, detail);
    b.rotation.order = 'YXZ';
    b.position.set(side * 0.165, 0.19, 0.255);
    head.add(b);
    return b;
  });

  // The mouth: a wide grin (an arc whose middle is the pivot, so flipping it makes a pout), a dark
  // open mouth under it for a cackle, and two fangs that hang from the lip.
  const MR = 0.12;
  const ARC = 2.3;
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.115, 0.34);
  mouth.rotation.x = 0.42;
  head.add(mouth);
  const grin = kit.mesh(
    paint(new THREE.TorusGeometry(MR, 0.016, 3, 12, ARC).rotateZ(-Math.PI / 2 - ARC / 2).translate(0, MR, 0), INK.mouth),
    detail,
    mouth,
  );
  const gape = kit.mesh(
    paint(new THREE.SphereGeometry(0.085, 12, 4, 0, TAU, Math.PI / 2, Math.PI / 2), INK.mouth),
    detail,
    mouth,
    0,
    0.01,
    -0.004,
  );
  const fangGeo = kit.geo(paint(new THREE.ConeGeometry(0.017, 0.048, 5).rotateX(Math.PI), INK.tooth));
  for (const sx of [1, -1]) kit.mesh(fangGeo, detail, mouth, sx * 0.047, -0.012, 0.006);

  // Pointed ears out to the sides, a lighter inside.
  const earGeo = kit.geo(new THREE.ConeGeometry(0.085, 0.3, 6).translate(0, 0.15, 0));
  const earInGeo = kit.geo(new THREE.ConeGeometry(0.052, 0.2, 6).translate(0, 0.1, 0));
  const ears = [1, -1].map((side) => {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.position.set(side * 0.34, 0.03, -0.02);
    head.add(g);
    const outer = new THREE.Mesh(earGeo, body);
    outer.scale.set(1, 1, 0.42);
    g.add(outer);
    const inner = new THREE.Mesh(earInGeo, accent);
    inner.position.set(0, 0.03, 0.022);
    inner.scale.set(1, 1, 0.35);
    g.add(inner);
    return g;
  });

  // Small curved horns: dark at the root, bone toward the tip, curling out and back.
  const hornGeo = kit.geo(
    paintY(bend(new THREE.ConeGeometry(0.052, 0.21, 6, 3).translate(0, 0.105, 0), 0.21, -0.95), HORN_ROOT, HORN_TIP, 0.0, 0.17),
  );
  for (const sx of [1, -1]) {
    const h = new THREE.Mesh(hornGeo, detail);
    h.position.set(sx * 0.15, 0.27, 0.1);
    h.rotation.order = 'YXZ';
    h.rotation.set(0.25, sx * 0.3, -sx * 0.5);
    head.add(h);
  }

  // Bat wings on its back: a scalloped membrane (the lighter colour, both sides) on bones.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.08);
  wingShape.quadraticCurveTo(0.16, 0.17, 0.3, 0.17);
  wingShape.lineTo(0.64, 0.04);
  wingShape.quadraticCurveTo(0.47, -0.03, 0.52, -0.26);
  wingShape.quadraticCurveTo(0.35, -0.17, 0.27, -0.36);
  wingShape.quadraticCurveTo(0.12, -0.19, 0, -0.17);
  wingShape.lineTo(0, 0.08);
  const wings = [1, -1].map((side) => {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.userData.noFoot = true;
    g.position.set(side * 0.13, CY + 0.15, -0.2);
    g.scale.setScalar(1.25);
    squash.add(g);
    const mem = new THREE.ShapeGeometry(wingShape, 4).rotateX(Math.PI / 2);
    if (side < 0) mem.scale(-1, 1, 1);
    kit.mesh(mem, accent, g);
    for (const [ax, az, bx, bz, r0, r1] of [
      [0, 0.08, 0.3, 0.17, 0.03, 0.026],
      [0.3, 0.17, 0.64, 0.04, 0.026, 0.01],
      [0.3, 0.17, 0.52, -0.26, 0.022, 0.009],
      [0.3, 0.17, 0.27, -0.36, 0.02, 0.008],
    ]) {
      const s = strut(ax, az, bx, bz, r0, r1);
      if (side < 0) s.scale(-1, 1, 1);
      kit.mesh(s, body, g, 0, 0.004, 0);
    }
    const thumb = new THREE.Mesh(clawGeo, detail);
    thumb.position.set(side * 0.3, 0.02, 0.19);
    thumb.rotation.x = -Math.PI / 2;
    g.add(thumb);
    return g;
  });

  // The tail: a thin chain hanging from the rump, the spade at its tip laid on the floor.
  const tail = [];
  let parent = squash;
  const segGeo = kit.geo(new THREE.SphereGeometry(1, 6, 4));
  for (let i = 0; i < TAIL_N; i++) {
    const j = new THREE.Group();
    j.userData.noFoot = true;
    j.rotation.order = 'YXZ';
    if (i === 0) j.position.set(0, CY - 0.13, -0.24);
    else j.position.z = -SEG;
    parent.add(j);
    const r = 0.036 - i * 0.003;
    const seg = new THREE.Mesh(segGeo, body);
    seg.scale.set(r, r, SEG * 0.68);
    seg.position.z = -SEG / 2;
    j.add(seg);
    tail.push(j);
    parent = j;
  }
  const spade = kit.mesh(new THREE.ConeGeometry(0.085, 0.15, 4), body, parent, 0, 0, -SEG - 0.04);
  spade.rotation.set(-Math.PI / 2, Math.PI / 4, 0);
  spade.scale.set(1, 1, 0.32);

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // A crouch, up into the air and a full loop, arms flung up, cackling; it lands with a bounce.
      o.squash = keys(t, CRIT_SQUASH);
      o.lift = keys(t, CRIT_LIFT);
      o.flip = -TAU * smooth(span(t, 0.3, 0.64)); // a back flip
      const joy = plateau(t, 0.06, 0.96, 0.08);
      o.armL = lerp(0.35, 2.75, joy);
      o.armR = o.armL;
      o.armOut = 0.35 * joy;
      o.wing = lerp(0.28, 0.5 + 0.7 * Math.sin(t * TAU * 9), plateau(t, 0.08, 0.86, 0.06));
      o.sweep = lerp(0.32, 0.05, joy);
      o.leg = -0.6 * bump(t, 0.25, 0.7);
      o.tailLift = 0.5 * bump(t, 0.25, 0.75);
      o.grin = lerp(1, 1.35, joy);
      o.open = joy * (0.65 + 0.35 * Math.sin(t * TAU * 7)); // ha-ha-ha
      o.headPitch = -0.25 * joy + 0.08 * joy * Math.sin(t * TAU * 7);
      o.upper = lerp(0.12, 0.6, joy);
      o.lower = lerp(0.05, 0.45, joy);
      o.ear = 0.5 * joy;
      o.sway = 0.4 * Math.sin(t * TAU * 3) * joy;
    } else if (reaction === 'fumble') {
      // Down it drops, flat on its belly on the floor, chin up, pouting; wings and ears droop.
      const fall = smooth(span(t, 0.05, 0.32));
      const thud = bump(t, 0.28, 0.42);
      o.lift = -DROP * fall;
      o.flip = 1.38 * fall;
      o.squash = 0.12 * thud;
      o.headPitch = -1.75 * fall; // relative to the body: chin up, the face still looks up
      o.wing = lerp(0.28, -0.55, fall) + 0.1 * bump(t, 0.6, 0.85);
      o.sweep = lerp(0.32, 0.75, fall);
      o.armL = lerp(0.35, 2.7, fall); // along the floor, under its chin
      o.armR = o.armL;
      o.armIn = 0.45 * fall;
      o.leg = -0.4 * fall;
      o.tailLift = -0.3 * fall;
      o.ear = -0.8 * fall;
      o.grin = lerp(1, -0.7, smooth(span(t, 0.3, 0.5)));
      o.sad = 0.55 * fall;
      o.upper = lerp(0.12, 0.42, fall);
      o.gazePitch = lerp(-0.1, 0.15, fall);
      o.flick = 0.3 * Math.sin(t * TAU * 2.5) * span(t, 0.5, 1);
    } else if (reaction === 'mixed') {
      // Scheming: it rubs its hands together under a sly squint, a sideways glance.
      const on = plateau(t, 0.04, 0.95, 0.12);
      o.armL = lerp(0.35, 1.8, on);
      o.armR = o.armL;
      o.armIn = on;
      o.rub = 0.18 * Math.sin(t * TAU * 5) * plateau(t, 0.15, 0.9, 0.08);
      o.headPitch = 0.04 * on;
      o.headRoll = -0.14 * on;
      o.gazeYaw = 0.35 * on;
      o.gazePitch = lerp(-0.1, 0.12, on);
      o.upper = lerp(0.12, 0.55, on);
      o.lower = lerp(0.05, 0.32, on);
      o.upperL = -0.15 * on;
      o.sad = -0.45 * on;
      o.grin = lerp(1, 1.2, on);
      o.ear = 0.2 * on;
      o.sway = 0.2 * Math.sin(t * TAU * 2) * on;
    } else {
      // Smug: a wide grin under half-lidded eyes, chin up, and a flick of the tail.
      const on = plateau(t, 0.06, 0.94, 0.15);
      o.grin = lerp(1, 1.3, on);
      o.upper = lerp(0.12, 0.45, on);
      o.lower = lerp(0.05, 0.26, on);
      o.headPitch = -0.12 * on;
      o.headRoll = 0.14 * on;
      o.pitch = -0.04 * on;
      o.ear = 0.25 * on;
      o.sad = -0.15 * on;
      o.flick = keys(t, FLICK);
      o.sway = 0.35 * bump(t, 0.3, 0.8);
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  /** Hovering: the wings beat, it bobs, the tail sways, an ear twitch and blinks. */
  function idle(o, ms, amount = 1) {
    const beat = Math.sin((ms / FLAP_MS) * TAU);
    o.wing += 0.45 * beat * amount;
    o.sweep += 0.06 * beat * amount;
    o.lift += 0.018 * (1 - Math.cos((ms / FLAP_MS) * TAU * 0.5)) * amount; // a bob on every other beat
    o.leg += 0.12 * Math.sin((ms / 2100) * TAU) * amount;
    o.sway += 0.25 * Math.sin((ms / 2600) * TAU) * amount;
    o.headRoll += 0.04 * Math.sin((ms / 3300) * TAU) * amount;
    const f = ((ms + 700) % 3700) / 3700;
    o.flick += 0.5 * bump(f, 0.55, 0.75) * Math.sin(f * TAU * 8) * amount;
    const e = ((ms + 1500) % 4300) / 4300;
    o.ear += 0.4 * bump(e, 0.86, 0.91) * amount;
    const b = blink(ms, 2200);
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
      // A crouch, a flutter up and away (the layer moves it), and a settle.
      tmp.squash = 0.12 * bump(t, 0, 0.25) - 0.06 * bump(t, 0.2, 0.85) + 0.1 * bump(t, 0.85, 1);
      tmp.wing = 0.28 + 0.6 * Math.sin(t * TAU * 4) * bump(t, 0.1, 0.95);
      tmp.leg = -0.3 * bump(t, 0.15, 0.9);
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      PK.reset(p);
      p.squash = -0.08 * bump(t, 0.05, 0.75) + 0.12 * bump(t, 0.75, 1);
      p.wing = 0.28 + 0.65 * Math.sin(t * TAU * 4) * bump(t, 0, 0.9);
      p.leg = -0.35 * bump(t, 0, 0.85);
      p.tailLift = 0.3 * bump(t, 0, 0.85);
      p.grin = 1.2;
      p.upper = 0.05;
    } else if (phase === 'move') {
      // A dodge: it flies over (the layer lifts it in an arc), wings a fast blur, leaning into the
      // flight, legs and tail streaming back, eyes on where it goes. From and back to standing.
      PK.reset(p);
      const fly = plateau(t, 0.04, 0.96, 0.14);
      const beat = Math.sin(t * TAU * 6);
      p.squash = 0.12 * bump(t, 0, 0.14) - 0.04 * fly + 0.12 * bump(t, 0.84, 1);
      p.lift = (0.12 + 0.04 * Math.sin(t * TAU * 6 + 1.2)) * fly;
      p.pitch = 0.42 * fly;
      p.headPitch = -0.38 * fly;
      p.wing = lerp(0.28, 0.35 + 0.85 * beat, fly);
      p.sweep = lerp(0.32, 0.12 - 0.15 * beat, fly);
      p.leg = -0.7 * fly;
      p.armL = lerp(0.35, -0.3, fly);
      p.armR = p.armL;
      p.tailLift = 0.55 * fly;
      p.sway = 0.3 * Math.sin(t * TAU * 2.5) * fly;
      p.grin = lerp(1, 1.25, fly);
      p.upper = lerp(0.12, 0.02, fly);
      p.gazePitch = lerp(-0.1, 0.1, fly);
    } else if (phase === 'pet') {
      // Petted: eyes squeezed happy, a wiggle side to side, wings fluttering, tail swishing
      // (look.calm: a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.headRoll = 0.3 * k * Math.sin(t * TAU * 2) * on;
      p.roll = 0.08 * k * Math.sin(t * TAU * 2 + 0.6) * on;
      p.wing = lerp(0.28, 0.45 + 0.3 * k * Math.sin(t * TAU * 5), on);
      p.sway = 0.45 * k * Math.sin(t * TAU * 2.5) * on;
      p.squash = 0.04 * k * Math.sin(t * TAU * 4) * on;
      p.grin = lerp(1, 1.35, on);
      p.ear = -0.3 * on;
      p.armIn = 0.4 * on;
      p.upper = lerp(0.12, 0.72, on);
      p.lower = lerp(0.05, 0.48, on);
    } else if (phase === 'huff') {
      // Huffed: arms crossed, a puff, the head turned away, cross brows, a pout, the tail lashing.
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.squash = (-0.08 * bump(t, 0.05, 0.45) + 0.06 * bump(t, 0.4, 0.75)) * k;
      p.armL = lerp(0.35, 1.0, mad);
      p.armR = p.armL;
      p.armIn = 1.25 * mad;
      p.headYaw = 0.6 * mad;
      p.headPitch = -0.15 * mad;
      p.gazeYaw = 0.45 * mad;
      p.upper = lerp(0.12, 0.5, mad);
      p.sad = -0.5 * mad;
      p.grin = lerp(1, -0.45, mad);
      p.ear = -0.4 * mad;
      p.wing = lerp(0.28, 0.75, mad);
      p.sway = 0.5 * k * Math.sin(t * TAU * 3) * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop up off the heat, then it fans its face with a hand, squinting
      // (look.calm: slower, smaller strokes).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const f = look?.calm ? 3 : 5;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.25 * k * bump(t, 0.02, 0.28);
      p.armR = lerp(0.35, 1.7 + 0.35 * k * Math.sin(t * TAU * f), on);
      p.armIn = 0.5 * on + 0.3 * k * Math.sin(t * TAU * f) * on;
      p.wing = lerp(0.28, 0.6 + 0.35 * k * Math.sin(t * TAU * f), on);
      p.headPitch = -0.15 * on;
      p.ear = -0.4 * on;
      p.sway = 0.35 * k * Math.sin(t * TAU * 2.5) * on;
      p.upper = lerp(0.12, 0.6, on);
      p.grin = lerp(1, 0.4, on);
      p.open = 0.3 * on;
    } else if (phase === 'shiver') {
      // Frozen (frost): hunched, wings wrapped round itself, arms hugged in, shivering side to side
      // (look.calm: a slower, smaller shiver).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.roll = 0.07 * k * Math.sin(t * TAU * f) * on;
      p.wing = lerp(0.28, -0.3, on) + 0.05 * k * Math.sin(t * TAU * f * 1.3) * on;
      p.sweep = lerp(0.32, -0.25, on);
      p.armL = lerp(0.35, 0.9, on);
      p.armR = p.armL;
      p.armIn = 1.1 * on;
      p.leg = -0.3 * on;
      p.headPitch = 0.2 * on;
      p.squash = 0.06 * on;
      p.ear = -0.5 * on;
      p.upper = lerp(0.12, 0.55, on);
      p.grin = lerp(1, -0.2, on);
      p.sad = 0.35 * on;
    } else if (phase === 'bristle') {
      // Zapped (storm): standing tall, wings flared high, tail up, eyes wide, pupils round,
      // trembling (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.1 * on;
      p.wing = lerp(0.28, 0.95, on);
      p.sweep = lerp(0.32, -0.1, on);
      p.tailLift = 0.6 * on;
      p.armOut = 0.5 * on;
      p.roll = 0.04 * k * Math.sin(t * TAU * 10) * on;
      p.headPitch = -0.12 * on;
      p.ear = 0.6 * on;
      p.upper = lerp(0.12, 0, on);
      p.lower = lerp(0.05, 0, on);
      p.dilate = on;
      p.grin = lerp(1, 0.5, on);
      p.open = 0.35 * on;
    } else if (phase === 'startle') {
      // Startled (any other element): a flinch and a jolt up with its arms flung up and a wing
      // flap, eyes wide (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      const air = span(t, 0.1, 0.5);
      p.lift = 0.5 * k * Math.sin(Math.PI * air);
      p.squash = 0.14 * bump(t, 0, 0.12) - 0.1 * k * bump(t, 0.1, 0.5) + 0.12 * k * bump(t, 0.48, 0.66);
      p.armL = lerp(0.35, 2.2, bump(t, 0.08, 0.6));
      p.armR = p.armL;
      p.armOut = 0.5 * bump(t, 0.08, 0.6);
      p.wing = 0.28 + 0.6 * bump(t, 0.08, 0.6);
      p.leg = -0.5 * bump(t, 0.1, 0.55);
      p.tailLift = 0.4 * wide;
      p.upper = lerp(0.12, 0, wide);
      p.lower = lerp(0.05, 0, wide);
      p.dilate = wide;
      p.grin = lerp(1, 0.3, wide);
      p.open = 0.5 * wide;
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy bounces up in the air with its arms up,
      // wings beating, a big grin (look.calm: one small bounce). From and back to standing.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      const air1 = bump(t, 0.12, 0.42);
      const air2 = two * bump(t, 0.52, 0.82);
      p.lift = 0.35 * k * (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash =
        k * (0.1 * bump(t, 0.02, 0.14) - 0.06 * air1 + 0.1 * bump(t, 0.42, 0.54)) + two * (0.08 * bump(t, 0.82, 0.95) - 0.06 * air2);
      p.armL = lerp(0.35, 2.5, k * (air1 + air2));
      p.armR = p.armL;
      p.armOut = 0.35 * k * (air1 + air2);
      p.leg = -0.4 * k * (air1 + air2);
      p.wing = 0.28 + joy * (0.2 + (calm ? 0.1 : 0.6) * Math.sin(t * TAU * (calm ? 3 : 7)));
      p.headPitch = lerp(0, -0.2, joy); // lerp: exactly +0 at rest, as the standing pose
      p.sway = (calm ? 0.12 : 0.4) * Math.sin(t * TAU * 3) * joy;
      p.grin = lerp(1, 1.35, joy);
      p.open = 0.5 * joy;
      p.upper = lerp(0.12, 0.5, joy);
      p.lower = lerp(0.05, 0.42, joy);
      p.gazePitch = lerp(-0.1, 0.2, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: hovering higher, chest out, chin up, arms crossed, wings
      // high, a smug half-lidded grin. Sulk: sunk low, head hung, wings and ears drooping, a pout.
      PK.reset(end);
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.lift = 0.1;
        tmp.pitch = -0.08;
        tmp.headPitch = -0.25;
        tmp.armL = 1.0;
        tmp.armR = 1.0;
        tmp.armIn = 1.25;
        tmp.wing = 0.62;
        tmp.sweep = 0.4;
        tmp.tailLift = 0.25;
        tmp.ear = 0.35;
        tmp.grin = 1.3;
        tmp.upper = 0.45;
        tmp.lower = 0.3;
        tmp.sad = -0.2;
        tmp.gazePitch = 0.05;
      } else {
        tmp.lift = -0.17;
        tmp.squash = 0.08;
        tmp.headPitch = 0.5;
        tmp.wing = -0.55;
        tmp.sweep = 0.65;
        tmp.armL = 0.1;
        tmp.armR = 0.1;
        tmp.leg = 0.3;
        tmp.tailLift = 0.85;
        tmp.ear = -0.9;
        tmp.grin = -0.7;
        tmp.upper = 0.55;
        tmp.sad = 0.5;
        tmp.gazePitch = -0.45;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.squash -= 0.04 * bump(t, 0.2, 0.8); // a puff on the way
    } else if (phase === 'throw') {
      // Lobs the dice overhand: the right arm winds up over its head and swings forward; it leans
      // back, then into the throw.
      PK.reset(p);
      p.armR = keys(t, THROW_ARM);
      p.armL = lerp(0.35, 0.7, bump(t, 0.2, 0.8));
      p.pitch = keys(t, THROW_PITCH);
      p.headPitch = keys(t, THROW_HEAD);
      p.roll = keys(t, THROW_ROLL);
      p.wing = keys(t, THROW_WING);
      p.grin = lerp(1, 1.3, bump(t, 0.1, 0.9));
      p.sad = -0.3 * bump(t, 0.1, 0.9);
      p.upper = 0.05;
      p.flick = 0.6 * bump(t, 0.4, 0.8);
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
    // leaning back, rolling (the spade tips on its edge) or stretching tall lowers the tail: lift it by as much
    rig.position.y = o.lift + 0.45 * Math.max(0, -o.pitch) + 0.3 * Math.abs(o.roll) + 0.2 * Math.max(0, -o.squash) + 0.04 * Math.abs(o.sway);
    pivot.rotation.set(o.pitch + o.flip, o.yaw + o.spin, o.roll);
    const sy = 1 - o.squash;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    squash.scale.set(sxz, sy, sxz);
    neck.rotation.set(o.headPitch, o.headYaw, o.headRoll);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const raise = side > 0 ? o.armL : o.armR;
      // rub: the hands slide past each other (+X hand up, the other down)
      arms[i].rotation.set(-raise - side * o.rub, -side * 0.55 * o.armIn, side * (0.28 + o.armOut - 0.22 * o.armIn));
      legs[i].rotation.set(0.25 + o.leg, 0, side * 0.08);
      wings[i].rotation.set(0, side * o.sweep, side * (o.wing + (side > 0 ? o.wingL : 0)));
      ears[i].rotation.set(-0.15 - 0.2 * o.ear, 0, -side * (1.2 - 0.35 * o.ear));
      eyes[i].set(o.gazeYaw, o.gazePitch, o.upper + (side > 0 ? o.upperL : 0), o.lower, o.sad);
      pupils[i].scale.set(0.38 + 0.57 * o.dilate, 1.12, 1);
      brows[i].rotation.set(-0.45, side * 0.2, side * (0.32 - 0.7 * o.sad));
      brows[i].position.y = 0.19 + 0.03 * o.sad + 0.025 * o.dilate;
    }
    grin.scale.set(Math.min(1.25, Math.max(0.7, Math.abs(o.grin))), o.grin, 1);
    gape.visible = o.open > 0.02;
    gape.scale.set(0.9 + 0.2 * o.open, Math.max(0.01, o.open), 0.35);
    for (let i = 0; i < TAIL_N; i++) {
      const j = tail[i];
      // the flick whips the spade sideways and up off the floor, never down into it
      j.rotation.x = TAIL_BEND[i] + (i < 4 ? o.tailLift * 0.3 : 0) + (i >= TAIL_N - 2 ? Math.abs(o.flick) * 0.4 : 0);
      j.rotation.y = i === 0 ? o.sway * 0.5 : i >= TAIL_N - 2 ? o.flick * 0.5 : 0;
      j.rotation.z = i === 1 ? o.sway * 0.6 : 0;
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

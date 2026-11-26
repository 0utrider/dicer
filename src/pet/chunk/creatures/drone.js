import * as THREE from 'three';
import { TAU, bump, keys, lerp, outBack, plateau, smooth, span, blink, nowMs, paint, palette, poseKit, createKit, detailMaterial } from './parts.js';

/**
 * The drone: a small friendly companion drone hovering over the floor, the science-fiction pet. A
 * smooth rounded white pod tipped back so its face looks up at the top-down camera: a dark glass
 * visor in a coloured bezel with two glowing digital eyes (tall pills of light) and a little
 * light-line mouth, a coloured stripe over its crown and down its back, a coloured belt, three
 * status lights by the visor. Two small engine pods on stub axles at its sides (they tilt, like
 * ears), two stubby manipulator arms with two-prong grippers, a thin antenna with an amber tip
 * leaning back off its crown, and under it a thruster collar with a glowing ring and a jet of light
 * down to the floor (the only part that touches it). From above: the round white pod with its
 * stripe, the visor's two eyes looking up at you, an engine pod either side.
 * It floats: it bobs, banks and turns in the air, and dodges by flying across (leaning into it,
 * engine pods tipped forward, the jet flaring). Crit: a fast spin up into the air, lights
 * flashing, arms up, happy arched eyes; fumble: it powers down (the jet sputters out, the eyes
 * flicker and shrink to nothing), sinks to the floor and tips over, one last flicker; mixed: a tilt
 * of the head, one eye narrowed, the lights chasing while it works it out; plain: two glad nods.
 * Throw: an overarm toss with one gripper, the craft kicking back a little.
 */

const HEIGHT = 1.5;
const FOOT = 0.84; // top-down radius in scene units (the pod and its engine pods), the antenna excluded (measured: 0.842)
const TILT = 0.7; // the pod's built-in tilt back (rad): its face up toward the camera
const POD_Y = 0.78; // the pod's centre over the floor at rest (design units), and the lean's pivot
const RAD = [0.5, 0.4, 0.44]; // the pod's radii (pod-local)
const NOZZLE = 0.23; // the thruster's mouth over the floor at rest
const ANT_X = 0.3; // the antenna's lean forward in the pod's frame (it leans back a little in the world)
const EYE = [0.165, 0.075];
const LIGHTS = [
  [-0.402, 0.2, '#46f078'],
  [-0.347, 0.266, '#ffa028'],
  [-0.274, 0.308, '#46c8ff'],
];

const WHITE = new THREE.Color('#eceef1');
const GLASS = new THREE.Color('#0f1420');
const METAL = new THREE.Color('#3c424e');
const METAL_LIGHT = new THREE.Color('#969da8');
// lights: brighter than white, so they read as lit under the scene's lamps
const GLOW = new THREE.Color('#54d6ff').multiplyScalar(1.3);
const HOT = new THREE.Color('#cef6ff').multiplyScalar(1.6);
const AMBER = new THREE.Color('#ffb040').multiplyScalar(1.6);

const REST = {
  lift: 0, // up from its hover height (< 0 sinks toward the floor)
  squash: 0, // > 0 squashes, < 0 stretches
  pitch: 0, // + leans forward (about the pod's centre)
  roll: 0,
  yaw: 0,
  spin: 0, // a turn of the whole craft (rad)
  headPitch: 0, // the craft's own nod (+ down), turn and tilt
  headRoll: 0,
  headYaw: 0,
  fwdL: 0.45, // arm raise forward (rad), L is the +X arm
  fwdR: 0.45,
  outL: 0.5, // arm out to the side
  outR: 0.5,
  gripL: 0.25, // gripper open 0..1
  gripR: 0.25,
  podL: 0, // engine pod tilt (+ tips its top forward)
  podR: 0,
  ant: 0, // antenna sway (side)
  antF: 0, // antenna nod (forward)
  open: 1, // the eyes' height (0 a line .. 1)
  glow: 1, // their size
  slant: 0, // > 0 sad (outer ends down), < 0 cross
  happy: 0, // the pills become arches
  gazeYaw: 0,
  gazePitch: 0,
  mouth: 0, // open
  smile: 1, // the mouth line's size
  frown: 0, // the line turned down
  lights: 1, // the status lights' size
  chase: -1, // which light is lit up big (0..3, < 0 none)
  jet: 1, // thruster power (0 out .. 1 .. boosted)
};
const PK = poseKit(REST);

// Keyframes, hoisted so a pose allocates nothing.
const CRIT_LIFT = [0, 0, 0.1, -0.06, 0.32, 0.6, 0.7, 0.62, 0.9, -0.03, 1, 0];
const THROW_FWD = [0, 0.45, 0.28, 3.2, 0.42, 3.4, 0.56, 1.3, 0.75, 0.9, 1, 0.45];
const THROW_OUT = [0, 0.5, 0.28, 0.2, 0.56, 0.2, 1, 0.5];
const THROW_PITCH = [0, 0, 0.28, -0.16, 0.5, 0.2, 0.75, 0.05, 1, 0];
const THROW_GRIP = [0, 0.25, 0.42, 0.1, 0.52, 1, 0.8, 0.8, 1, 0.25];
const FLICKER = [0, 1, 0.14, 1, 0.18, 0.15, 0.24, 1, 0.3, 0.2, 0.34, 0.9, 0.4, 0.1, 0.46, 0.7, 0.52, 0.05, 0.58, 0.4, 0.64, 0, 1, 0];
const SPUTTER = [0, 1, 0.12, 1.2, 0.2, 0.4, 0.28, 0.9, 0.36, 0.3, 0.44, 0.6, 0.55, 0, 1, 0];
const MIX_LOOK = [0.25, 0, 0.32, -1, 0.5, -1, 0.56, 1, 0.76, 1, 0.84, 0];

/** An angle less a whole number of turns (a spin that ends facing forward ends on 0). */
const wrapT = (a) => a - Math.round(a / TAU) * TAU;

/** A rounded rectangle outline (a pill), centred. */
function pillShape(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.absarc(w - r, -h + r, r, -Math.PI / 2, 0, false);
  s.lineTo(w, h - r);
  s.absarc(w - r, h - r, r, 0, Math.PI / 2, false);
  s.lineTo(-w + r, h);
  s.absarc(-w + r, h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w, -h + r);
  s.absarc(-w + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

const N = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
/** Places `o` on the pod's front at pod-local (x, y), `lift` over the shell, facing out of it. */
function onPod(o, x, y, lift) {
  const z = RAD[2] * Math.sqrt(Math.max(0, 1 - (x / RAD[0]) ** 2 - (y / RAD[1]) ** 2));
  N.set(x / RAD[0] ** 2, y / RAD[1] ** 2, z / RAD[2] ** 2).normalize();
  o.position.set(x + N.x * lift, y + N.y * lift, z + N.z * lift);
  o.quaternion.setFromUnitVectors(Z, N);
  return o;
}

export function drone(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.36, metalness: 0.05 }));
  const accent = kit.mat(new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.34, metalness: 0.05 }));
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'drone';
  const scaler = new THREE.Group();
  root.add(scaler);
  // base: the hover (lift) and the turn; the jet hangs from it to the floor
  const base = new THREE.Group();
  scaler.add(base);
  // rig: the lean, about the pod's centre
  const rig = new THREE.Group();
  rig.position.y = POD_Y;
  base.add(rig);
  const squash = new THREE.Group();
  rig.add(squash);
  // craft: the whole drone's own nod, turn and tilt (it looks round by turning in the air)
  const craft = new THREE.Group();
  craft.rotation.order = 'YXZ';
  squash.add(craft);

  // The jet: a cone of light from the thruster's mouth down to the floor (its tip at the origin).
  const jet = kit.mesh(paint(new THREE.ConeGeometry(0.09, 1, 8, 1, true).rotateX(Math.PI).translate(0, 0.5, 0), HOT), detail, base, 0, 0, -0.02);

  // The thruster under the pod: a coloured collar, a dark ring round its mouth, the glow inside.
  kit.mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.18, 12, 1, true), body, craft, 0, -0.435, -0.02);
  kit.mesh(paint(new THREE.TorusGeometry(0.205, 0.042, 5, 14).rotateX(Math.PI / 2), METAL), detail, craft, 0, -0.515, -0.02);
  kit.mesh(paint(new THREE.CircleGeometry(0.19, 12).rotateX(Math.PI / 2), GLOW), detail, craft, 0, -0.55, -0.02);

  // The pod, in its own frame tipped back by TILT: the white shell, the stripe over crown and back
  // (a band round the pod's x axis), the belt, the visor's bezel and the dark glass over it.
  const pod = new THREE.Group();
  pod.rotation.x = -TILT;
  craft.add(pod);
  const shell = (geo, mat, k) => {
    const m = kit.mesh(geo, mat, pod);
    m.scale.set(RAD[0] * k, RAD[1] * k, RAD[2] * k);
    return m;
  };
  shell(paint(new THREE.SphereGeometry(1, 24, 14), WHITE), detail, 1);
  shell(new THREE.SphereGeometry(1, 24, 3, 2.2, 3.78, Math.PI / 2 - 0.347, 0.694).rotateZ(Math.PI / 2), body, 1.03);
  shell(new THREE.SphereGeometry(1, 24, 1, 0, TAU, 2.285, 0.2), body, 1.025);
  shell(new THREE.SphereGeometry(1, 12, 6, Math.PI / 2 - 0.9, 1.8, 0.8, 1.4), body, 1.035);
  shell(paint(new THREE.SphereGeometry(1, 12, 6, Math.PI / 2 - 0.8, 1.6, 0.9, 1.19), GLASS), detail, 1.05);

  // The eyes: a pill of light each (the pupil), sliding on the glass with the gaze; an arch for the
  // happy eye. The mouth: a smile line, the same turned down, and an open oval.
  const pillGeo = kit.geo(paint(new THREE.ShapeGeometry(pillShape(0.056, 0.094, 0.05), 5), GLOW));
  const archGeo = kit.geo(paint(new THREE.RingGeometry(0.036, 0.078, 10, 1, 0, Math.PI).translate(0, -0.03, 0), GLOW));
  const eyes = [1, -1].map((side) => {
    const g = onPod(new THREE.Group(), EYE[0] * side, EYE[1], 0.036);
    pod.add(g);
    const pupil = new THREE.Mesh(pillGeo, detail);
    pupil.name = 'pupil';
    g.add(pupil);
    const arch = new THREE.Mesh(archGeo, detail);
    g.add(arch);
    return { side, pupil, arch };
  });
  const mouth = onPod(new THREE.Group(), 0, -0.115, 0.034);
  pod.add(mouth);
  const smile = kit.mesh(paint(new THREE.RingGeometry(0.05, 0.066, 8, 1, Math.PI * 1.2, Math.PI * 0.6).translate(0, 0.056, 0), HOT), detail, mouth);
  const frown = kit.mesh(paint(new THREE.RingGeometry(0.05, 0.066, 8, 1, Math.PI * 0.2, Math.PI * 0.6).translate(0, -0.062, 0), HOT), detail, mouth);
  const gape = kit.mesh(paint(new THREE.CircleGeometry(0.05, 12), HOT), detail, mouth, 0, -0.012, 0);

  // The status lights, in an arc round the visor's corner on its right.
  const lights = LIGHTS.map(([x, y, hex]) => {
    const m = kit.mesh(paint(new THREE.CircleGeometry(0.024, 8), new THREE.Color(hex).multiplyScalar(1.5)), detail, pod);
    return onPod(m, x, y, 0.016);
  });

  // The antenna: a thin stalk with an amber tip light, on a springy pivot on the crown.
  const antenna = new THREE.Group();
  antenna.position.set(0, 0.385, -0.1);
  antenna.userData.noFoot = true;
  pod.add(antenna);
  kit.mesh(paint(new THREE.CylinderGeometry(0.014, 0.02, 0.3, 5, 1, true).translate(0, 0.15, 0), METAL_LIGHT), detail, antenna);
  kit.mesh(paint(new THREE.SphereGeometry(0.04, 6, 4), AMBER), detail, antenna, 0, 0.3, 0);

  // The engine pods on stub axles: a white barrel, a lighter coloured cap, a glowing mouth; each
  // tilts about its axle.
  const axleGeo = kit.geo(paint(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 6, 1, true).rotateZ(Math.PI / 2), METAL));
  const barrelGeo = kit.geo(paint(new THREE.CylinderGeometry(0.082, 0.07, 0.17, 10, 1, true), WHITE));
  const capGeo = kit.geo(new THREE.SphereGeometry(0.082, 10, 3, 0, TAU, 0, Math.PI / 2));
  const mouthGeo = kit.geo(paint(new THREE.CircleGeometry(0.07, 10).rotateX(Math.PI / 2), GLOW));
  const pods = [1, -1].map((side) => {
    const ax = new THREE.Mesh(axleGeo, detail);
    ax.position.set(side * 0.52, -0.02, -0.04);
    craft.add(ax);
    const g = new THREE.Group();
    g.position.set(side * 0.66, -0.02, -0.04);
    craft.add(g);
    g.add(new THREE.Mesh(barrelGeo, detail));
    const cap = new THREE.Mesh(capGeo, accent);
    cap.position.y = 0.085;
    g.add(cap);
    const m = new THREE.Mesh(mouthGeo, detail);
    m.position.y = -0.085;
    g.add(m);
    return g;
  });

  // The arms: a dark shoulder ball, a stubby white arm, a coloured cuff and a two-prong gripper.
  const shGeo = kit.geo(paint(new THREE.SphereGeometry(0.07, 6, 4), METAL));
  const armGeo = kit.geo(paint(new THREE.CylinderGeometry(0.04, 0.046, 0.19, 8, 1, true).translate(0, -0.1, 0), WHITE));
  const cuffGeo = kit.geo(new THREE.CylinderGeometry(0.052, 0.052, 0.05, 8, 1));
  const prongGeo = kit.geo(paint(new THREE.BoxGeometry(0.026, 0.12, 0.034).translate(0, -0.06, 0), METAL_LIGHT));
  const arms = [1, -1].map((side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.35, -0.25, 0.2);
    craft.add(g);
    g.add(new THREE.Mesh(shGeo, detail));
    g.add(new THREE.Mesh(armGeo, detail));
    const cuff = new THREE.Mesh(cuffGeo, body);
    cuff.position.y = -0.2;
    g.add(cuff);
    const prongs = [1, -1].map((s) => {
      const f = new THREE.Mesh(prongGeo, detail);
      f.position.set(s * 0.03, -0.22, 0);
      g.add(f);
      return f;
    });
    return { side, g, prongs };
  });

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // A fast spin up into the air (three turns), lights flashing, arms up, arched happy eyes.
      const joy = plateau(t, 0.06, 0.95, 0.1);
      o.lift = keys(t, CRIT_LIFT);
      o.spin = wrapT(3 * TAU * smooth(span(t, 0.12, 0.82)));
      o.squash = 0.1 * bump(t, 0.02, 0.14) - 0.08 * bump(t, 0.14, 0.4) + 0.1 * bump(t, 0.84, 0.98);
      o.fwdL = o.fwdR = lerp(0.45, 2.7, joy);
      o.outL = o.outR = lerp(0.5, 0.35, joy);
      o.gripL = o.gripR = lerp(0.25, 1, joy);
      o.podL = o.podR = 0.7 * joy;
      o.headPitch = -0.18 * joy;
      o.happy = joy;
      o.glow = lerp(1, 1.15, joy);
      o.mouth = 0.9 * joy;
      o.lights = lerp(1, 1.7, joy);
      o.chase = joy > 0.2 ? (t * 30) % 3 : -1;
      o.jet = lerp(1, 1.6, bump(t, 0.1, 0.6));
      o.ant = 0.4 * Math.sin(t * TAU * 6) * joy;
      o.antF = -0.3 * joy;
    } else if (reaction === 'fumble') {
      // It powers down: the jet sputters out, the eyes flicker and shrink to nothing, it sinks to
      // the floor and tips over on its side, arms limp; one last flicker of its eyes.
      const dn = smooth(span(t, 0.3, 0.62)); // sinking
      const tip = smooth(span(t, 0.58, 0.8)); // tipping over
      const last = bump(t, 0.86, 0.93);
      o.jet = keys(t, SPUTTER);
      o.lift = -0.135 * dn + 0.03 * bump(t, 0.12, 0.2);
      o.roll = 0.36 * tip + 0.03 * Math.sin(t * TAU * 14) * (1 - dn);
      o.pitch = 0.1 * tip;
      o.squash = 0.05 * bump(t, 0.56, 0.7);
      const lit = keys(t, FLICKER) + 0.6 * last;
      o.glow = Math.min(1, lit * 1.5);
      o.open = Math.min(1, 0.3 + lit);
      o.slant = 0.35 * smooth(span(t, 0.05, 0.4));
      o.smile = 1 - smooth(span(t, 0.3, 0.6));
      o.frown = smooth(span(t, 0.05, 0.25));
      o.lights = Math.max(0, 1 - smooth(span(t, 0.2, 0.55))) + 0.5 * last;
      o.fwdL = o.fwdR = lerp(0.45, 0.1, dn);
      o.outL = lerp(0.5, 0.2, dn);
      o.outR = lerp(0.5, 0.2, dn) + 1.15 * smooth(span(t, 0.46, 0.66)); // the arm it lands on splays out along the floor
      o.gripL = o.gripR = lerp(0.25, 0.7, dn);
      o.podL = o.podR = -0.7 * dn;
      o.antF = 0.9 * dn;
      o.ant = -0.3 * tip + 0.3 * last;
      o.headPitch = 0.15 * dn;
    } else if (reaction === 'mixed') {
      // Working it out: a tilt of the head, one eye narrowed, the lights chasing, the eyes darting
      // from one die to the other, the engine pods tipping opposite ways.
      const think = plateau(t, 0.06, 0.9, 0.12);
      const tilt = outBack(span(t, 0.04, 0.3), 2.2) * (1 - smooth(span(t, 0.85, 1)));
      o.headRoll = 0.32 * tilt;
      o.headPitch = -0.06 * tilt;
      o.open = lerp(1, 0.6, think);
      o.slant = -0.2 * think;
      o.gazeYaw = 0.35 * keys(t, MIX_LOOK);
      o.chase = think > 0.2 ? (t * 18) % 3 : -1;
      o.lights = lerp(1, 1.4, think);
      o.podL = 0.5 * Math.sin(t * TAU * 2) * think;
      o.podR = -0.5 * Math.sin(t * TAU * 2) * think;
      o.ant = 0.25 * Math.sin(t * TAU * 9) * think;
      o.smile = lerp(1, 0.6, think);
      o.fwdR = lerp(0.45, 1.5, tilt);
      o.outR = lerp(0.5, 0.1, tilt);
      o.gripR = 0.25 + 0.5 * Math.abs(Math.sin(t * TAU * 4)) * think;
    } else {
      // Two glad nods, happy eyes, a bob, the engine pods perked.
      const glad = plateau(t, 0.08, 0.92, 0.15);
      o.headPitch = 0.26 * bump(t, 0.14, 0.4) + 0.2 * bump(t, 0.46, 0.72);
      o.lift = 0.06 * bump(t, 0.1, 0.4) + 0.04 * bump(t, 0.44, 0.72);
      o.happy = glad;
      o.podL = o.podR = 0.35 * glad;
      o.outL = o.outR = 0.5 + 0.2 * glad;
      o.ant = 0.18 * Math.sin(t * TAU * 3) * glad;
      o.lights = lerp(1, 1.3, glad);
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  /** A hover bob, a slow bank and look round, the antenna swaying, a light winking, blinks. */
  function idle(o, ms, amount = 1) {
    const s = ms / 1000;
    o.lift += 0.022 * (1 - Math.cos(s * TAU * 0.6)) * amount;
    o.roll += 0.03 * Math.sin(s * TAU * 0.27) * amount;
    o.pitch += 0.02 * Math.sin(s * TAU * 0.19) * amount;
    o.headYaw += (0.12 * Math.sin(s * TAU * 0.13) + 0.05 * Math.sin(s * TAU * 0.31)) * amount;
    o.podL += 0.12 * Math.sin(s * TAU * 0.6) * amount;
    o.podR += 0.12 * Math.sin(s * TAU * 0.6 + 1.2) * amount;
    o.ant += 0.1 * Math.sin(s * TAU * 0.45) * amount;
    o.fwdL += 0.06 * Math.sin(s * TAU * 0.35) * amount;
    o.fwdR -= 0.06 * Math.sin(s * TAU * 0.35) * amount;
    o.jet += 0.08 * Math.sin(s * TAU * 3.1) * amount;
    if (amount >= 1 && o.chase < 0) o.chase = Math.floor(s / 0.9) % 4; // each light in turn, then a pause
    o.open *= 1 - 0.9 * blink(ms, 700);
  }

  function pose(phase, t, reaction, look) {
    const ms = look?.now ?? nowMs();
    const yaw = look?.yaw || 0;
    if (phase === 'react') react(p, reaction, t, ms);
    else if (phase === 'exit') {
      react(end, reaction, 1);
      PK.reset(tmp);
      // It powers up (after a fumble), rises and flies off (the layer moves it), leaning into it.
      tmp.lift = 0.14 * bump(t, 0.15, 0.95);
      tmp.pitch = 0.16 * bump(t, 0.2, 0.9);
      tmp.podL = tmp.podR = 0.6 * bump(t, 0.15, 0.9);
      tmp.jet = 1 + 0.4 * bump(t, 0.1, 0.8);
      tmp.antF = -0.3 * bump(t, 0.15, 0.9);
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      // It flies down in: dropping from above, leaning forward, the jet flaring, and bobs to a stop.
      PK.reset(p);
      const go = 1 - smooth(span(t, 0, 0.78));
      p.lift = 0.5 * go - 0.05 * bump(t, 0.74, 0.92);
      p.pitch = 0.22 * go;
      p.podL = p.podR = 0.7 * go;
      p.jet = 1 + 0.5 * bump(t, 0.5, 0.95);
      p.fwdL = p.fwdR = lerp(0.45, -0.2, go);
      p.antF = -0.4 * go;
      p.glow = 1 + 0.1 * go;
    } else if (phase === 'move') {
      // A dodge: it flies across (the layer slides it), rising a little, leaning into the flight,
      // engine pods tipped forward, arms swept back, banking, the jet flaring behind it.
      PK.reset(p);
      const go = plateau(t, 0.03, 0.97, 0.16);
      p.lift = 0.22 * go + 0.03 * Math.sin(t * TAU * 3) * go;
      p.pitch = 0.3 * go - 0.12 * bump(t, 0.82, 1);
      p.roll = 0.1 * Math.sin(t * TAU * 1.5) * go;
      p.podL = p.podR = 0.85 * go;
      p.fwdL = p.fwdR = lerp(0.45, -0.5, go);
      p.outL = p.outR = lerp(0.5, 0.25, go);
      p.jet = 1 + 0.5 * go;
      p.antF = -0.5 * go;
      p.headPitch = -0.12 * go;
      p.glow = 1 + 0.08 * go;
      p.chase = go > 0.2 ? (t * 12) % 3 : -1;
    } else if (phase === 'pet') {
      // Petted: arched happy eyes, a wiggle, the engine pods waggling in turn, the antenna wagging,
      // lights twinkling (look.calm: a smaller wiggle).
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.roll = 0.14 * k * Math.sin(t * TAU * 3) * on;
      p.headRoll = 0.12 * k * Math.sin(t * TAU * 3 + 0.8) * on;
      p.lift = 0.04 * on + 0.02 * k * Math.sin(t * TAU * 6) * on;
      p.happy = on;
      p.podL = 0.5 * k * Math.sin(t * TAU * 4) * on;
      p.podR = -0.5 * k * Math.sin(t * TAU * 4) * on;
      p.ant = 0.4 * k * Math.sin(t * TAU * 4) * on;
      p.outL = p.outR = 0.5 + 0.25 * on;
      p.gripL = p.gripR = 0.25 + 0.5 * Math.abs(Math.sin(t * TAU * 3)) * on;
      p.lights = lerp(1, 1.4, on);
      p.chase = on > 0.2 ? (t * 14) % 3 : -1;
    } else if (phase === 'huff') {
      // Huffed: a blast from the jet and a jolt up, then it turns away, eyes slanted cross, arms
      // folded in, engine pods laid back.
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.lift = 0.1 * k * bump(t, 0.04, 0.4);
      p.jet = 1 + 0.6 * k * bump(t, 0.02, 0.3);
      p.headYaw = 0.55 * mad;
      p.headPitch = -0.1 * mad;
      p.gazeYaw = 0.3 * mad;
      p.slant = -0.4 * mad;
      p.open = lerp(1, 0.7, mad);
      p.frown = mad;
      p.fwdL = p.fwdR = lerp(0.45, 1.1, mad);
      p.outL = p.outR = lerp(0.5, -0.25, mad);
      p.gripL = p.gripR = lerp(0.25, 0, mad);
      p.podL = p.podR = -0.6 * mad;
      p.antF = 0.3 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): it shoots up off the heat, lights flashing an alarm, fanning its
      // visor with one gripper, eyes squeezed, engine pods flapping (look.calm: slower, smaller).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const f = look?.calm ? 3 : 5;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.28 * k * bump(t, 0.02, 0.4) + 0.1 * on;
      p.jet = 1 + 0.5 * on;
      p.roll = 0.035 * k * Math.sin(t * TAU * 16) * on;
      p.fwdR = lerp(0.45, 2.3 + 0.35 * k * Math.sin(t * TAU * f), on);
      p.outR = lerp(0.5, 0.05, on);
      p.gripR = 0.25 + 0.6 * on;
      p.headPitch = -0.14 * on;
      p.open = lerp(1, 0.4, on);
      p.slant = 0.25 * on;
      p.mouth = 0.7 * on;
      p.lights = lerp(1, 1.6, on);
      p.chase = on > 0.2 ? (t * 40 * k) % 3 : -1;
      p.podL = 0.5 * k * Math.sin(t * TAU * f) * on;
      p.podR = 0.5 * k * Math.sin(t * TAU * f + 2) * on;
      p.ant = 0.2 * k * Math.sin(t * TAU * 11) * on;
    } else if (phase === 'shiver') {
      // Frozen (frost): it sinks low, arms hugged in, engine pods drooped, rattling, the jet
      // sputtering, its eyes narrow and dim (look.calm: a slower, smaller rattle).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = -0.07 * on;
      p.roll = 0.06 * k * Math.sin(t * TAU * f) * on;
      p.headRoll = 0.04 * k * Math.sin(t * TAU * f * 1.3) * on;
      p.fwdL = p.fwdR = lerp(0.45, 1.2, on);
      p.outL = p.outR = lerp(0.5, -0.3, on);
      p.gripL = p.gripR = 0.25 + 0.3 * k * Math.abs(Math.sin(t * TAU * f * 0.5)) * on;
      p.podL = p.podR = -0.5 * on;
      p.jet = 1 - (0.3 + 0.2 * Math.sin(t * TAU * f * 0.7)) * on;
      p.open = lerp(1, 0.5, on);
      p.glow = lerp(1, 0.85, on);
      p.slant = 0.3 * on;
      p.frown = on;
      p.antF = 0.4 * on;
      p.ant = 0.1 * k * Math.sin(t * TAU * f) * on;
      p.lights = lerp(1, 0.6, on);
    } else if (phase === 'bristle') {
      // Zapped (storm): it jolts up tall and stiff, arms flung out, grippers wide, eyes blazing
      // wide, every light on, the antenna straight up and buzzing (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.lift = 0.12 * on;
      p.squash = -0.08 * on;
      p.outL = p.outR = lerp(0.5, 1.4, on);
      p.fwdL = p.fwdR = lerp(0.45, 0.2, on);
      p.gripL = p.gripR = lerp(0.25, 1, on);
      p.podL = 0.9 * on;
      p.podR = -0.9 * on;
      p.roll = 0.03 * k * Math.sin(t * TAU * 10) * on;
      p.ant = 0.12 * k * Math.sin(t * TAU * 15) * on;
      p.antF = -0.3 * on;
      p.glow = lerp(1, 1.3, on);
      p.mouth = 0.6 * on;
      p.lights = lerp(1, 1.8, on);
      p.jet = 1 + 0.3 * on;
    } else if (phase === 'startle') {
      // Startled (any other element): it shoots up and tips back, arms flung up, eyes wide, the
      // antenna boinging, and bobs back down (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      p.lift = 0.42 * k * Math.sin(Math.PI * span(t, 0.04, 0.6)) - 0.04 * k * bump(t, 0.6, 0.8);
      p.pitch = -0.22 * k * bump(t, 0.02, 0.6);
      p.jet = 1 + 0.6 * bump(t, 0, 0.3);
      p.fwdL = p.fwdR = lerp(0.45, 2.3, k * bump(t, 0.05, 0.65));
      p.outL = p.outR = 0.5 + 0.4 * bump(t, 0.05, 0.65);
      p.gripL = p.gripR = 0.25 + 0.75 * bump(t, 0.05, 0.65);
      p.podL = p.podR = -0.6 * bump(t, 0.02, 0.5);
      p.ant = 0.4 * Math.exp(-6 * span(t, 0.1, 1)) * Math.sin(t * TAU * 7) * wide;
      p.glow = lerp(1, 1.3, wide);
      p.mouth = 0.8 * wide;
      p.lights = lerp(1, 1.5, wide);
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two bobs up, a twirl on the first, arms up, arched
      // happy eyes, lights chasing (look.calm: one small bob, no twirl). From and back to rest.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const two = calm ? 0 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      p.lift = 0.3 * k * (Math.sin(Math.PI * span(t, 0.1, 0.45)) + two * Math.sin(Math.PI * span(t, 0.52, 0.86)));
      p.spin = wrapT(two * TAU * smooth(span(t, 0.1, 0.48)));
      p.fwdL = p.fwdR = lerp(0.45, calm ? 1.4 : 2.6, joy);
      p.gripL = p.gripR = lerp(0.25, 0.9, joy);
      p.podL = p.podR = 0.5 * joy;
      p.headPitch = 0 - 0.16 * joy; // never -0: the pose at t 0 is the standing pose exactly
      p.happy = joy;
      p.mouth = 0.8 * joy;
      p.lights = lerp(1, 1.5, joy);
      p.chase = joy > 0.2 ? (t * 20) % 3 : -1;
      p.jet = 1 + 0.3 * joy;
      p.ant = 0.3 * Math.sin(t * TAU * 4) * joy;
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the hover into it and is
      // static from t 1. Proud: hovering high, chin up, grippers on its hips, engine pods perked,
      // eyes and lights bright. Sulk: sunk low, nose down, arms limp, pods drooped, the antenna flopped back, dim.
      PK.reset(end);
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.lift = 0.14;
        tmp.pitch = -0.06;
        tmp.headPitch = -0.2;
        tmp.fwdL = tmp.fwdR = 0.1;
        tmp.outL = tmp.outR = 1.0;
        tmp.gripL = tmp.gripR = 0;
        tmp.podL = tmp.podR = 0.4;
        tmp.antF = -0.25;
        tmp.open = 0.8;
        tmp.glow = 1.12;
        tmp.lights = 1.4;
        tmp.jet = 1.2;
      } else {
        tmp.lift = -0.12;
        tmp.pitch = 0.1;
        tmp.headPitch = 0.4;
        tmp.fwdL = tmp.fwdR = 0.15;
        tmp.outL = tmp.outR = 0.5;
        tmp.gripL = tmp.gripR = 0.5;
        tmp.podL = tmp.podR = -0.7;
        tmp.antF = -1.3; // flopped back along its crown
        tmp.squash = 0.06;
        tmp.open = 0.6;
        tmp.glow = 0.85;
        tmp.slant = 0.4;
        tmp.frown = 1;
        tmp.lights = 0.5;
        tmp.jet = 0.75;
        tmp.gazePitch = -0.4;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.lift += 0.05 * bump(t, 0.2, 0.8); // a little surge on the way
    } else if (phase === 'throw') {
      // An overarm toss: the right arm swings up and back over the pod, then whips forward, the
      // gripper letting go at the top; the craft tips back and kicks forward with it.
      PK.reset(p);
      p.fwdR = keys(t, THROW_FWD);
      p.outR = keys(t, THROW_OUT);
      p.gripR = keys(t, THROW_GRIP);
      p.pitch = keys(t, THROW_PITCH);
      p.lift = 0.08 * bump(t, 0.2, 0.6);
      p.roll = 0.06 * bump(t, 0.2, 0.7);
      p.podL = p.podR = 2 * p.pitch;
      p.antF = 0.5 * p.pitch;
      p.mouth = 0.6 * bump(t, 0.4, 0.8);
      p.glow = 1 + 0.1 * bump(t, 0.3, 0.7);
      p.jet = 1 + 0.4 * bump(t, 0.35, 0.65);
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.headYaw += yaw * 0.5;
      p.gazeYaw += yaw * 0.75;
      p.yaw += yaw * 0.12;
    }
    apply(p);
  }

  function apply(o) {
    base.position.y = o.lift;
    base.rotation.y = o.yaw + o.spin;
    rig.rotation.set(o.pitch, 0, o.roll);
    const sy = 1 - o.squash;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    squash.scale.set(sxz, sy, sxz);
    craft.rotation.set(o.headPitch, o.headYaw, o.headRoll);
    // the jet: from the thruster's mouth down to the floor, shorter and thinner as the power drops
    const power = Math.max(0, Math.min(1.6, o.jet));
    const len = Math.max(0.001, Math.min(NOZZLE + o.lift, 0.3 + 0.1 * power) * Math.min(1, power)); // it leaves the floor on a high hop
    const wide = Math.max(0.001, power);
    jet.position.y = NOZZLE - len;
    jet.scale.set(wide, len, wide);
    const lit = o.chase >= 0 ? Math.floor(o.chase) : -1;
    for (let i = 0; i < 3; i++) lights[i].scale.setScalar(Math.max(0.001, o.lights * (i === lit ? 1.5 : 1)));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const a = arms[i];
      a.g.rotation.set(-(side > 0 ? o.fwdL : o.fwdR), 0, side * (side > 0 ? o.outL : o.outR));
      const c = 0.1 + 0.5 * (side > 0 ? o.gripL : o.gripR);
      a.prongs[0].rotation.z = c;
      a.prongs[1].rotation.z = -c;
      pods[i].rotation.x = side > 0 ? o.podL : o.podR;
      const e = eyes[i];
      const size = Math.max(0, o.glow);
      const pill = size * (1 - Math.min(1, Math.max(0, o.happy)));
      e.pupil.position.set(0.12 * o.gazeYaw, 0.1 * o.gazePitch, 0);
      e.pupil.rotation.z = -side * o.slant;
      e.pupil.scale.set(Math.max(0.001, pill), Math.max(0.001, pill * Math.max(0.06, o.open)), 1);
      e.arch.position.copy(e.pupil.position);
      e.arch.scale.setScalar(Math.max(0.001, size * Math.min(1, Math.max(0, o.happy))));
    }
    const gap = Math.min(1, Math.max(0, o.mouth));
    const line = Math.max(0, o.smile) * (1 - gap);
    const down = Math.min(1, Math.max(0, o.frown));
    smile.scale.setScalar(Math.max(0.001, line * (1 - down)));
    frown.scale.setScalar(Math.max(0.001, line * down));
    gape.scale.set(Math.max(0.001, gap), Math.max(0.001, gap * 0.85), 1);
    antenna.rotation.set(ANT_X + o.antF, 0, o.ant);
  }

  PK.reset(p);
  apply(p);
  root.updateMatrixWorld(true);
  const h = new THREE.Box3().setFromObject(root, true).getSize(new THREE.Vector3()).y; // precise: the antenna leans
  scaler.scale.setScalar(HEIGHT / h);

  return { root, height: HEIGHT, footprint: FOOT, pose, dispose: () => kit.dispose() };
}

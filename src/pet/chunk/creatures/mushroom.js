import * as THREE from 'three';
import {
  mergeFlat,
  TAU,
  INK,
  bump,
  keys,
  lerp,
  outBack,
  outCubic,
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
 * The mushroom: an earnest little toadstool sprite. A wide domed cap in the user colour with round
 * lighter spots, tipped back on a stubby cream stem that is its body, two stub arms and two round
 * feet. The cap is its head: two big eyes, rosy cheeks and a smile sit on the cap's front slope,
 * facing up, so the table's top-down camera sees a face and not just a spotted disc. Crit: it hops
 * and puffs a burst of spores from its bouncing cap; fumble: the cap slumps down onto the stem like
 * a hat pulled low and it wilts, leaning, sad eyes peeking up; mixed: the cap tips to one side, one
 * eye squinting; plain: a happy cap wiggle. Its dodge is a quick waddle.
 */

const HEIGHT = 1.5;
const FOOT = 0.86; // top-down body radius in scene units (the cap, measured from the built geometry)
// Design units (scaled to HEIGHT at build).
const CAP_Y = 1.0; // the cap's pivot (its rim), up on the stem
const CAP_Z = -0.02; // ...set back a hair: tipped back, the cap stays centred over the feet
const CAP_R = 0.92; // cap radius
const CAP_H = 0.46; // cap dome height above its rim
const RIM_IN = 0.84; // the curled rim's inner edge, where the gills meet it (fraction of CAP_R)
const GILLS = 32; // gill ridges (lathe segments) under the cap
const TILT = -0.22; // the cap's rest tilt: back, so the face on it looks up
const EYE_R = 0.2;
const EYE_A = 0.74; // the eyes' polar angle on the dome (0 the top)
const EYE_PHI = 0.4; // ...and azimuth either side of the front
const STEPS = 4; // waddle cycles (two steps each) in one dodge
const SPORES = 5;
const MIN_SCALE = 1e-3;

const CREAM = new THREE.Color('#f3e6c8');
const GILL = new THREE.Color('#c9ad80'); // the gills' furrows
const RIDGE = new THREE.Color('#ead9b4'); // ...and their ridges
const SKIRT = new THREE.Color('#ecdcb8');
const SHOE = new THREE.Color('#e4cfa4');
const CHEEK = new THREE.Color('#ff8fa3');

/** The stem's profile (radius, y), bottom to top: a sturdy barrel, wider low down, tapering a little
 * up to the cap and running on up inside it (its top is hidden in the flare and the dome). */
const STEM = [
  [0.001, 0.05],
  [0.28, 0.07],
  [0.37, 0.18],
  [0.37, 0.34],
  [0.32, 0.56],
  [0.28, 0.76],
  [0.26, 0.94],
  [0.001, 1.04],
];
/** The stem's flare into the cap underside (cap space, radius, y), bottom to top: its narrow end is
 * tucked inside the stem, so the stem reads as widening up into the cap whatever the cap does. */
const FLARE = [
  [0.14, -0.3],
  [0.19, -0.17],
  [0.28, -0.08],
  [0.42, -0.02],
];
/** The ring (annulus) hanging round the stem just under the flare (relative to the cap's height):
 * the top tucked into the stem where the flare comes out of it, a lip skirting out and down, its
 * underside back in to the stem. */
const ANNULUS = [
  [0.16, -0.22],
  [0.33, -0.285],
  [0.36, -0.27],
  [0.18, -0.12],
];

/** A point on the cap dome (an ellipsoid) at polar angle a (0 the top) and azimuth phi (0 = +Z). */
function capPoint(a, phi, out, normal) {
  const r = CAP_R * Math.sin(a);
  out.set(r * Math.sin(phi), CAP_H * Math.cos(a), r * Math.cos(phi));
  const nr = CAP_H * Math.sin(a);
  const ny = CAP_R * Math.cos(a);
  normal.set(nr * Math.sin(phi), ny, nr * Math.cos(phi)).normalize();
}

/** The cap: a dome whose rim curls under a little (a lathe, bottom to top so it faces out). */
function capGeometry() {
  const pts = [new THREE.Vector2(CAP_R * RIM_IN, -0.075), new THREE.Vector2(CAP_R * 0.97, -0.05)];
  const N = 7;
  for (let i = 0; i <= N; i++) {
    const a = (Math.PI / 2) * (1 - i / N);
    pts.push(new THREE.Vector2(Math.max(0.001, CAP_R * Math.sin(a)), CAP_H * Math.cos(a)));
  }
  return new THREE.LatheGeometry(pts, 20);
}

/** The cap underside: a shallow cone from the stem's flare out to the rim, ridged with radial gills
 * (alternate lathe columns pushed down / up at build) in two creams. Inner to outer, so it faces down. */
function gillsGeometry() {
  const pts = [
    new THREE.Vector2(0.4, -0.02),
    new THREE.Vector2(0.6, -0.05),
    new THREE.Vector2(CAP_R * RIM_IN - 0.005, -0.072),
  ];
  const g = new THREE.LatheGeometry(pts, GILLS);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const np = pts.length;
  for (let i = 0; i <= GILLS; i++) {
    const ridge = i % 2 === 0;
    for (let j = 0; j < np; j++) {
      const k = i * np + j;
      if (j === 1) pos.setY(k, pos.getY(k) + (ridge ? -0.025 : 0.02));
      const c = ridge || j === 0 ? RIDGE : GILL;
      col.set([c.r, c.g, c.b], k * 3);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A lathe from a [radius, y] profile, painted. */
function lathe(profile, segments, color) {
  return paint(
    new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      segments,
    ),
    color,
  );
}

/** The spots: flattened discs sat on the dome, merged into one geometry. */
function spotsGeometry() {
  const parts = [];
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  // [polar angle, azimuth, radius]
  for (const [a, phi, r] of [
    [0.05, 0, 0.17],
    [0.62, 2.6, 0.15],
    [0.78, 1.9, 0.13],
    [0.7, 3.2, 0.16],
    [0.8, 4.5, 0.13],
    [0.78, 5.15, 0.12],
    [1.22, 1.45, 0.09],
    [1.2, 3.9, 0.1],
  ]) {
    capPoint(a, phi, pos, nrm);
    pos.addScaledVector(nrm, -0.012);
    q.setFromUnitVectors(UP, nrm);
    m.compose(pos, q, s.set(r, r * 0.3, r));
    parts.push(new THREE.SphereGeometry(1, 6, 4).applyMatrix4(m));
  }
  const g = mergeFlat(parts);
  for (const p of parts) p.dispose();
  return g;
}

const REST = {
  lift: 0,
  squash: 0, // > 0 flatter, < 0 taller (the stem)
  pitch: 0, // + leans forward
  roll: 0,
  yaw: 0,
  capTilt: TILT, // + tips the cap (and the face on it) forward; at rest back, the face up
  capRoll: 0, // + tips the cap's top toward -X
  capSpin: 0,
  capDrop: 0, // the cap pulled down onto the stem
  capSlide: 0, // the cap pulled forward (+Z)
  capSquash: 0, // the cap's own squash (its bounce)
  armR: 0, // raise of each stub arm, rad
  armL: 0,
  fwdR: 0, // fore-aft swing of each arm, rad (+ forward)
  fwdL: 0,
  stride: 0, // 0..1: the feet step, by gait
  gait: 0, // the step cycle's phase, rad
  spore: 0, // 0..1: the crit's burst of spores (0 and 1 hidden)
  eyeScale: 1,
  upper: 0.16,
  lower: 0.08,
  upperR: 0, // extra upper lid on the right (+X) eye (squint)
  sad: 0,
  sadL: 0,
  gazeYaw: 0,
  gazePitch: -0.2,
  smile: 0.7, // -1 frown .. 0 flat .. 1 grin
  open: 0, // mouth open 0..1
};
const PK = poseKit(REST);

// Keyframes, hoisted so a pose allocates nothing.
const K0 = [0.2, 0, 0.32, -1, 0.5, -1, 0.6, 1, 0.78, 1, 0.9, 0];
const PLAIN_SQUASH = [0, 0, 0.12, 0.1, 0.24, -0.08, 0.38, 0.05, 0.5, -0.02, 0.62, 0];
const THROW_PITCH = [0, 0, 0.3, -0.22, 0.5, 0.24, 0.75, 0.05, 1, 0];
const THROW_SQUASH = [0, 0, 0.3, 0.12, 0.5, -0.12, 0.75, 0.04, 1, 0];
const THROW_ARM = [0, 0, 0.3, -0.6, 0.5, 1.1, 0.75, 0.3, 1, 0];
const THROW_CAP = [0, 0, 0.3, -0.2, 0.5, 0.25, 0.7, -0.08, 0.85, 0.04, 1, 0];
const CRIT_SQUASH = [0, 0, 0.12, 0.2, 0.2, -0.22, 0.4, -0.06, 0.55, 0.22, 0.64, -0.05, 0.74, 0.04, 0.85, 0];
const CRIT_CAP = [0, 0, 0.14, -0.12, 0.22, 0.1, 0.38, -0.06, 0.55, 0.24, 0.63, -0.14, 0.72, 0.08, 0.82, -0.03, 0.9, 0];
const SPORE_DIR = [
  [0, 1],
  [0.95, 0.31],
  [0.59, -0.81],
  [-0.59, -0.81],
  [-0.95, 0.31],
];

export function mushroom(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.38, metalness: 0 }),
  );
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.42, metalness: 0 }),
  );
  const detail = detailMaterial(kit); // eyes and mouth, and the cream stem, gills, arms and feet

  const root = new THREE.Group();
  root.name = 'mushroom';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group(); // lift, lean, turn: pivots on the floor
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const squash = new THREE.Group(); // the stem's squash and stretch, about the floor
  rig.add(squash);

  // Feet: two little round shoes poking out in front.
  const feet = [];
  const footGeo = kit.geo(paint(new THREE.SphereGeometry(0.13, 8, 6), SHOE));
  for (const side of [1, -1]) {
    const f = new THREE.Mesh(footGeo, detail);
    f.scale.set(1, 0.58, 1.3);
    f.userData.home = new THREE.Vector3(side * 0.2, 0.075, 0.06);
    f.userData.pair = side === 1 ? 0 : Math.PI; // they step half a cycle apart
    f.position.copy(f.userData.home);
    rig.add(f);
    feet.push(f);
  }

  // The stem: the body, cream.
  kit.mesh(lathe(STEM, 14, CREAM), detail, squash);

  // Stub arms, hinged at the shoulder, hanging a little down at rest.
  const armGeo = kit.geo(paint(new THREE.SphereGeometry(0.085, 6, 4), CREAM));
  const arms = [1, -1].map((side) => {
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    pivot.position.set(side * 0.33, 0.44, 0.04);
    const a = new THREE.Mesh(armGeo, detail);
    a.scale.set(1.5, 0.8, 0.85);
    a.position.x = side * 0.09;
    pivot.add(a);
    squash.add(pivot);
    pivot.userData.side = side;
    return pivot;
  });

  // The cap, on its own pivot up on the stem: dome, spots, the gills underneath and the stem's flare
  // up into them (in a shape group that takes the cap's squash), and the face on its
  // front slope.
  const cap = new THREE.Group();
  cap.rotation.order = 'YXZ';
  rig.add(cap);
  const capShape = new THREE.Group();
  cap.add(capShape);
  kit.mesh(capGeometry(), body, capShape);
  kit.mesh(spotsGeometry(), accent, capShape);
  kit.mesh(gillsGeometry(), detail, capShape);
  kit.mesh(lathe(FLARE, 14, CREAM), detail, capShape);
  // The ring rides the cap's height (so it stays just under the flare as the cap bobs and drops)
  // but stays upright round the stem when the cap tips.
  const ring = new THREE.Group();
  rig.add(ring);
  kit.mesh(lathe(ANNULUS, 14, SKIRT), detail, ring);

  // The face sits on the cap's front slope, facing out along the dome (so up at the table camera,
  // the cap tipped back): it rides the cap but keeps its own shape, placed from the cap's squash.
  const at = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  /** Seat `o` on the dome at polar angle a, azimuth phi, sunk `inset` along the normal. */
  function seat(o, a, phi, inset) {
    capPoint(a, phi, at, nrm);
    o.userData.home = at.clone().addScaledVector(nrm, -inset);
    o.rotation.order = 'YXZ';
    o.rotation.set(-Math.atan2(nrm.y, Math.hypot(nrm.x, nrm.z)), phi, 0);
    cap.add(o);
  }
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lidColor: bodyColor });
    seat(e.socket, EYE_A, side * EYE_PHI, EYE_R * 0.35);
    return e;
  });
  const cheekGeo = kit.geo(paint(new THREE.CircleGeometry(0.065, 10), CHEEK));
  const cheeks = [1, -1].map((side) => {
    const c = new THREE.Group();
    const m = new THREE.Mesh(cheekGeo, detail);
    m.scale.set(1.35, 0.8, 1);
    c.add(m);
    seat(c, 1.08, side * 0.72, -0.006);
    return c;
  });
  const mouthMount = new THREE.Group();
  seat(mouthMount, 1.16, 0, -0.008);
  const smile = kit.mesh(
    paint(new THREE.TorusGeometry(0.1, 0.026, 5, 12, Math.PI), INK.mouth),
    detail,
    mouthMount,
  );
  const mouth = kit.mesh(
    paint(new THREE.CircleGeometry(0.11, 14, Math.PI, Math.PI), INK.mouth),
    detail,
    mouthMount,
  );
  const tongue = kit.mesh(
    paint(new THREE.CircleGeometry(0.05, 10, Math.PI, Math.PI), INK.tongue),
    detail,
    mouth,
  );
  tongue.position.set(0, -0.045, 0.003);

  // The crit's spores: little accent puffs that pop up off the cap, hidden (tiny, inside the cap)
  // otherwise.
  const sporeGeo = kit.geo(new THREE.SphereGeometry(0.065, 6, 4));
  const spores = [];
  for (let i = 0; i < SPORES; i++) {
    const s = new THREE.Mesh(sporeGeo, accent);
    s.visible = false;
    s.scale.setScalar(MIN_SCALE);
    s.position.set(0, CAP_Y + 0.2, 0);
    rig.add(s);
    spores.push(s);
  }

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  /** The reaction's pose at `t` into `o` (rest + reaction). */
  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // A crouch, a hop with its arms flung up, a puff of spores off the top of its bouncing cap,
      // and a squashy landing with a little extra cap boing.
      o.squash = keys(t, CRIT_SQUASH);
      o.lift = 0.6 * Math.sin(Math.PI * span(t, 0.2, 0.55));
      o.capSquash = keys(t, CRIT_CAP);
      o.capDrop = -0.08 * bump(t, 0.22, 0.5);
      o.spore = span(t, 0.28, 1);
      const joy = plateau(t, 0.08, 0.95, 0.08);
      o.armR = o.armL = 1.5 * joy + 0.25 * Math.sin(t * TAU * 4) * joy;
      o.capRoll = 0.08 * Math.sin(t * TAU * 3) * joy;
      o.upper = lerp(0.16, 0, joy);
      o.lower = lerp(0.08, 0.3, joy);
      o.gazePitch = lerp(-0.2, 0.35, joy);
      o.smile = lerp(0.7, 1, joy);
      o.open = joy;
      o.pitch = -0.08 * joy;
    } else if (reaction === 'fumble') {
      // The cap slumps down onto the stem like a hat pulled low, tipping forward a little and
      // leaning; the stem wilts, arms hanging. Its sad, heavy-lidded eyes still peek up from the
      // cap's front, glancing down; a last sad sigh.
      const wilt = smooth(span(t, 0.04, 0.5));
      const sigh = bump(t, 0.6, 0.85);
      const pull = smooth(span(t, 0.02, 0.32));
      o.capSlide = 0.1 * pull;
      o.capTilt = lerp(TILT, -0.04, pull) + 0.03 * wobble(span(t, 0.32, 1), 1.5, 3);
      o.capDrop = 0.14 * wilt;
      o.capRoll = 0.1 * wilt;
      o.squash = 0.14 * wilt - 0.04 * sigh;
      o.roll = -0.14 * wilt;
      o.pitch = 0.04 * wilt + 0.04 * sigh;
      o.armR = o.armL = -0.35 * wilt;
      o.upper = lerp(0.16, 0.46, wilt) + 0.08 * sigh;
      o.lower = lerp(0.08, 0.02, wilt);
      o.sad = 0.6 * wilt;
      o.gazePitch = lerp(-0.2, -0.45, wilt);
      o.smile = lerp(0.7, -0.9, smooth(span(t, 0.02, 0.3)));
    } else if (reaction === 'mixed') {
      // The cap tips over to one side, the eye under it squinting, the other brow up; it looks
      // from one die to the other with a wry flat mouth.
      const tilt = outBack(span(t, 0.04, 0.32), 2) * (1 - smooth(span(t, 0.82, 1)));
      o.capRoll = -0.34 * tilt;
      o.capTilt = lerp(TILT, TILT + 0.12, tilt);
      o.roll = 0.1 * tilt;
      o.squash = 0.04 * tilt;
      o.armL = 0.5 * tilt; // a little shrug on one side
      o.upperR = 0.42 * tilt;
      o.sadL = 0.45 * tilt;
      o.upper = lerp(0.16, 0.04, tilt);
      o.gazeYaw = 0.45 * keys(t, K0);
      o.smile = lerp(0.7, 0, tilt);
    } else {
      // plain: a happy wiggle of the cap and a pleased little bounce.
      const content = plateau(t, 0.08, 0.92, 0.12);
      o.squash = keys(t, PLAIN_SQUASH);
      o.lift = 0.1 * bump(t, 0.15, 0.36);
      o.capRoll = 0.16 * Math.sin(t * TAU * 3) * content;
      o.capSpin = 0.1 * Math.sin(t * TAU * 3 - 0.8) * content;
      o.roll = -0.04 * Math.sin(t * TAU * 3) * content;
      o.armR = o.armL = 0.3 * content;
      o.upper = lerp(0.16, 0.48, content);
      o.lower = lerp(0.08, 0.34, content);
      o.smile = lerp(0.7, 1, content);
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  /** Breathing, a slight cap sway, a blink and now and then a tiny bounce (amount 0..1). */
  function idle(o, ms, amount = 1) {
    const s = Math.sin((ms / 1700) * TAU);
    o.squash += 0.025 * s * amount;
    o.capRoll += 0.045 * Math.sin((ms / 2300) * TAU) * amount;
    o.capTilt += 0.025 * Math.sin((ms / 1700) * TAU - 1) * amount;
    const hop = ((ms + 900) % 5200) / 5200;
    o.lift += 0.05 * bump(hop, 0.9, 0.95) * amount;
    o.squash += (0.06 * bump(hop, 0.86, 0.9) - 0.05 * bump(hop, 0.9, 0.95) + 0.05 * bump(hop, 0.95, 0.99)) * amount;
    o.capSquash += 0.06 * bump(hop, 0.94, 0.99) * amount;
    const b = blink(ms, 2800);
    o.upper += (1 - o.upper) * b;
    o.lower += (0.5 - o.lower) * b;
  }

  function pose(phase, t, reaction, look) {
    const ms = look?.now ?? nowMs();
    const yaw = look?.yaw || 0;
    if (phase === 'react') react(p, reaction, t, ms);
    else if (phase === 'exit') {
      react(end, reaction, 1);
      end.spore = 0; // never re-puff on the way out
      PK.reset(tmp);
      // A crouch, then airborne (the layer hops it out): stretched, cap bobbing, arms out.
      tmp.squash = 0.18 * bump(t, 0, 0.25) - 0.12 * bump(t, 0.2, 0.85) + 0.15 * bump(t, 0.85, 1);
      tmp.capSquash = -0.08 * bump(t, 0.2, 0.6) + 0.08 * bump(t, 0.6, 0.95);
      tmp.armR = tmp.armL = 0.6 * bump(t, 0.15, 0.9);
      const k = smooth(span(t, 0, 0.3));
      // at k 1 take tmp exactly, so exit at t 1 is the standing pose to the last bit
      if (k >= 1) PK.blend(p, tmp, tmp, 0);
      else PK.blend(p, end, tmp, k);
    } else if (phase === 'enter') {
      PK.reset(p);
      p.squash = -0.14 * bump(t, 0.05, 0.75) + 0.22 * bump(t, 0.72, 1);
      p.capSquash = 0.1 * bump(t, 0.05, 0.6) - 0.1 * bump(t, 0.75, 1);
      p.armR = p.armL = 0.8 * bump(t, 0.05, 0.85);
      p.upper = 0.05;
      p.lower = 0.05;
      p.open = 0.5 * bump(t, 0.1, 0.8);
    } else if (phase === 'move') {
      // A dodge: it waddles off in quick little alternating steps, swaying from foot to foot, the
      // cap lagging the sway, arms swinging against the feet, an earnest wide-eyed look. It starts
      // and ends on the standing pose (exit at t 1).
      PK.reset(p);
      const run = plateau(t, 0.03, 0.97, 0.12);
      const g = t * TAU * STEPS;
      p.gait = g;
      p.stride = run;
      p.roll = 0.13 * Math.sin(g) * run;
      p.lift = 0.04 * Math.abs(Math.sin(g)) * run;
      p.pitch = 0.1 * run;
      p.squash = (0.06 + 0.04 * Math.cos(2 * g)) * run;
      p.capRoll = -0.1 * Math.sin(g - 0.7) * run;
      p.capTilt = TILT - 0.08 * run; // tipped back a little by the hurry
      p.fwdR = 0.5 * Math.sin(g + Math.PI / 2) * run;
      p.fwdL = -p.fwdR;
      p.armR = p.armL = 0.25 * run;
      p.upper = lerp(0.16, 0, run);
      p.lower = lerp(0.08, 0, run);
      p.eyeScale = 1 + 0.1 * run;
      p.gazePitch = lerp(-0.2, -0.05, run);
      p.smile = lerp(0.7, 0.4, run);
      p.open = 0.35 * run;
    } else if (phase === 'pet') {
      // Petted: a happy wiggle, the cap jiggling, eyes squeezed shut, a big open grin (look.calm,
      // reduced motion: a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.roll = 0.12 * k * Math.sin(t * TAU * 2.5) * on;
      p.squash = 0.07 * k * Math.sin(t * TAU * 5) * on;
      p.capRoll = -0.14 * k * Math.sin(t * TAU * 2.5 - 0.8) * on;
      p.capSquash = 0.06 * k * Math.sin(t * TAU * 5 + 1) * on;
      p.armR = p.armL = 0.7 * on;
      p.upper = lerp(0.16, 0.75, on);
      p.lower = lerp(0.08, 0.5, on);
      p.smile = lerp(0.7, 1, on);
      p.open = 0.7 * on;
    } else if (phase === 'huff') {
      // Huffed: it puffs up, then tugs its cap down low and frowns, eyes narrowed, glancing away.
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.squash = (-0.14 * bump(t, 0.05, 0.45) + 0.1 * bump(t, 0.4, 0.75)) * k;
      p.capTilt = lerp(TILT, TILT + 0.24, mad);
      p.capSlide = 0.08 * mad;
      p.capDrop = 0.04 * mad;
      p.armR = p.armL = -0.25 * mad;
      p.upper = lerp(0.16, 0.55, mad);
      p.sad = -0.3 * mad;
      p.smile = lerp(0.7, -0.6, mad);
      p.gazeYaw = 0.7 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop back off the heat, then it fans itself with both stub arms,
      // mouth open panting, eyes squinting, the cap twitching (look.calm: gentler).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.25 * k * bump(t, 0.02, 0.28);
      p.pitch = -0.1 * k * bump(t, 0.02, 0.3);
      p.armR = (0.9 + 0.5 * k * Math.sin(t * TAU * 6)) * on;
      p.armL = (0.9 + 0.5 * k * Math.sin(t * TAU * 6 + Math.PI)) * on;
      p.fwdR = p.fwdL = 0.5 * on;
      p.capRoll = 0.05 * k * Math.sin(t * TAU * 6) * on;
      p.upper = lerp(0.16, 0.6, on);
      p.lower = lerp(0.08, 0.3, on);
      p.smile = lerp(0.7, -0.3, on);
      p.open = on * (0.65 + 0.3 * Math.sin(t * TAU * 6));
    } else if (phase === 'shiver') {
      // Frozen (frost): it hunches, cap pulled down snug, hugging itself, shivering side to side,
      // eyes squeezed (look.calm: a slower, smaller shiver).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.squash = 0.1 * on;
      p.capDrop = 0.06 * on;
      p.capTilt = lerp(TILT, TILT + 0.2, on);
      p.capSlide = 0.06 * on;
      p.roll = 0.07 * k * Math.sin(t * TAU * f) * on;
      p.capRoll = 0.05 * k * Math.sin(t * TAU * f + 1) * on;
      p.armR = p.armL = 0.2 * on;
      p.fwdR = p.fwdL = 0.9 * on;
      p.upper = lerp(0.16, 0.55, on);
      p.lower = lerp(0.08, 0.3, on);
      p.smile = lerp(0.7, -0.5, on);
    } else if (phase === 'bristle') {
      // Zapped (storm): it shoots up tall, cap popping up off the stem, arms out stiff, eyes
      // wide, mouth agape, trembling (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.2 * on + 0.04 * k * Math.sin(t * TAU * 10) * on;
      p.capDrop = -0.08 * on;
      p.capRoll = 0.04 * k * Math.sin(t * TAU * 12) * on;
      p.armR = p.armL = 0.9 * on;
      p.eyeScale = 1 + 0.22 * on;
      p.upper = lerp(0.16, 0, on);
      p.lower = lerp(0.08, 0, on);
      p.gazePitch = lerp(-0.2, 0, on);
      p.smile = lerp(0.7, 0, on);
      p.open = 0.55 * on;
    } else if (phase === 'startle') {
      // Startled (any other element): a crouch, a jump with its cap lifting off a bit, eyes wide,
      // and a squashy landing (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      const air = span(t, 0.1, 0.5);
      p.lift = 0.6 * k * Math.sin(Math.PI * air);
      p.squash = 0.15 * bump(t, 0, 0.12) - 0.15 * k * bump(t, 0.1, 0.5) + 0.15 * k * bump(t, 0.48, 0.66);
      p.capDrop = -0.1 * k * bump(t, 0.12, 0.55);
      p.capSquash = 0.12 * k * bump(t, 0.48, 0.66);
      p.armR = p.armL = 1.1 * bump(t, 0.08, 0.6);
      p.eyeScale = 1 + 0.2 * wide;
      p.upper = lerp(0.16, 0, wide);
      p.lower = lerp(0.08, 0, wide);
      p.smile = lerp(0.7, 0, wide);
      p.open = 0.5 * wide;
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy hops with its arms up, the cap boinging on
      // each landing, a big grin, smiling eyes looking up (look.calm: one small hop). From and back
      // to the standing pose.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      p.lift = 0.42 * k * (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash =
        k * (0.14 * bump(t, 0.02, 0.14) - 0.12 * bump(t, 0.12, 0.42) + 0.14 * bump(t, 0.42, 0.54)) +
        two * (0.12 * bump(t, 0.82, 0.95) - 0.12 * bump(t, 0.52, 0.82));
      p.capSquash = k * (0.12 * bump(t, 0.42, 0.54) + two * 0.12 * bump(t, 0.82, 0.95));
      p.armR = p.armL = lerp(0, calm ? 0.8 : 1.5, joy);
      p.upper = lerp(0.16, 0, joy);
      p.lower = lerp(p.lower, 0.45, joy);
      p.gazePitch = lerp(p.gazePitch, 0.3, joy);
      p.smile = lerp(p.smile, 1, joy);
      p.open = lerp(p.open, 0.8, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: drawn up tall, leaning back, cap tipped back jauntily, hands
      // on hips, a smug grin. Sulk: wilted low, cap pulled down over its eyes, frowning, eyes down.
      PK.reset(end); // the standing pose (exit at t 1)
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.squash = -0.1;
        tmp.pitch = -0.08;
        tmp.capTilt = TILT - 0.14;
        tmp.armR = tmp.armL = -0.2;
        tmp.fwdR = tmp.fwdL = -0.6;
        tmp.smile = 1;
        tmp.upper = 0.42;
        tmp.lower = 0.32;
        tmp.gazePitch = 0.15;
      } else {
        // (the cap droops down onto the stem more than it tips: a tipped cap's corners stand high)
        tmp.squash = 0.22;
        tmp.capDrop = 0.15;
        tmp.capTilt = TILT + 0.3;
        tmp.capSlide = 0.12;
        tmp.pitch = 0.08;
        tmp.roll = -0.06;
        tmp.armR = tmp.armL = -0.35;
        tmp.smile = -0.8;
        tmp.upper = 0.6;
        tmp.lower = 0.02;
        tmp.sad = 0.5;
        tmp.gazePitch = -0.75;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.squash -= 0.06 * bump(t, 0.2, 0.8); // a puff on the way
    } else if (phase === 'throw') {
      PK.reset(p);
      // A fling: it rears back with its arms wound up, then lunges and pushes with both stubs,
      // the cap flopping after it.
      p.pitch = keys(t, THROW_PITCH);
      p.squash = keys(t, THROW_SQUASH);
      p.fwdR = p.fwdL = keys(t, THROW_ARM);
      p.armR = p.armL = 0.4 * bump(t, 0.2, 0.8);
      p.capTilt = TILT + keys(t, THROW_CAP);
      p.upper = 0.16 + 0.3 * bump(t, 0.2, 0.42);
      p.open = bump(t, 0.4, 0.85);
      p.gazePitch = -0.1;
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.gazeYaw += yaw * 1.1;
      p.yaw += yaw * 0.35;
    }
    apply(p);
  }

  function apply(o) {
    rig.position.y = o.lift; // design units: the scaler scales it
    rig.rotation.set(o.pitch, o.yaw, o.roll);
    const sy = Math.max(0.3, 1 - o.squash);
    const sxz = sy ** -0.4;
    squash.scale.set(sxz, sy, sxz);
    // The cap sits on the stem's top: it follows the squash but keeps its own shape.
    cap.position.set(0, CAP_Y * sy - o.capDrop, CAP_Z + o.capSlide);
    cap.rotation.set(o.capTilt, o.capSpin, o.capRoll);
    ring.position.set(0, cap.position.y, CAP_Z);
    const cs = Math.max(0.4, 1 - o.capSquash);
    const cxz = cs ** -0.5;
    capShape.scale.set(cxz, cs, cxz);
    for (const f of feet) {
      const h = f.userData.home;
      const ph = o.gait + f.userData.pair;
      // each foot lifts and swings forward in turn (a waddle in place: the layer slides it)
      f.position.set(
        h.x * (1 + 0.15 * o.stride),
        h.y + 0.1 * o.stride * Math.max(0, Math.sin(ph)),
        h.z - 0.1 * o.stride * Math.cos(ph),
      );
    }
    for (const a of arms) {
      const side = a.userData.side;
      const up = side === 1 ? o.armR : o.armL;
      const fwd = side === 1 ? o.fwdR : o.fwdL;
      a.rotation.set(0, -side * fwd, side * (up - 0.55));
    }
    const sm = o.smile;
    const face = (obj) => {
      const h = obj.userData.home;
      obj.position.set(h.x * cxz, h.y * cs, h.z * cxz);
    };
    for (const e of eyes) {
      face(e.socket);
      e.socket.scale.setScalar(o.eyeScale);
    }
    for (const c of cheeks) face(c);
    face(mouthMount);
    smile.visible = o.open < 0.5;
    mouth.visible = !smile.visible;
    smile.position.y = sm < 0 ? -0.025 : 0.015;
    // Torus arc 0..PI is the upper half: flip it for a grin, scale y for a flat line.
    smile.rotation.set(0, 0, sm >= 0 ? Math.PI : 0);
    smile.scale.set(1 + 0.2 * Math.abs(sm), Math.max(0.15, Math.abs(sm)), 1);
    mouth.position.y = 0.015;
    mouth.scale.set(1, 0.4 + 0.8 * o.open, 1);
    // Spores: each pops off the cap top in its own direction, rising, swelling and shrinking away.
    const top = cap.position.y + CAP_H * cs;
    for (let i = 0; i < SPORES; i++) {
      const s = spores[i];
      const k = span(o.spore, i * 0.08, i * 0.08 + 0.6);
      const size = k > 0 && k < 1 ? Math.sin(Math.PI * k) ** 0.6 * (0.8 + 0.3 * (i % 2)) : 0;
      if (size < MIN_SCALE) {
        s.visible = false;
        s.scale.setScalar(MIN_SCALE);
        s.position.set(0, CAP_Y + 0.2, 0);
        continue;
      }
      const rise = outCubic(k);
      const [dx, dz] = SPORE_DIR[i];
      s.visible = true;
      s.scale.setScalar(size);
      s.position.set(dx * 0.5 * rise, top + 0.05 + 0.6 * rise, cap.position.z + dz * 0.5 * rise);
    }
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

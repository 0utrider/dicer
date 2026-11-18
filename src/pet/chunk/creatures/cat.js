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
 * The cat: a little seated chibi cat, a round loaf of a body under a big wide head tilted back so
 * it looks up at the top-down camera: pointed ears with light insides, cheek tufts, light whisker
 * pads and chest, big eyes with slit pupils high on the face, long whiskers, white-socked front
 * paws together and the tail wrapped round its side to its feet. From above: a wide cat face
 * looking up at you, ear triangles, whiskers and cheek fluff. Aloof and playful.
 * Crit: it springs up into a pounce, paws out, tail straight up, ears forward, pupils wide;
 * fumble: ears flat, head turned away in disdain, tail lashing low ("this never happened");
 * mixed: an ear flick, a head tilt and a slow judging blink; plain: a content slow blink and a
 * little tail curl. Throw: it bats the dice with one paw.
 */

const HEIGHT = 1.5;
const FOOT = 0.91; // top-down radius in scene units (head, ears, tufts), tail and whiskers excluded (measured)
const EYE_R = 0.2;
const HEAD_Y = 0.56;
const TILT = 0.9; // the head's built-in tilt back (rad), its face up toward the camera
const TAIL_N = 8;
const SEG = 0.17; // tail segment length (design units)
// The tail's resting curl, per joint (rad): back, out to the cat's left and hooking forward.
const CURL = [1.25, 0.42, 0.36, 0.34, 0.34, 0.36, 0.4, 0.45];
// Tail pitch per joint: lying on the floor (down off the haunch, then level) ...
const TAIL_DOWN = [-0.25, 0.25, 0, 0, 0, 0, 0, 0];
// ... and straight up with the tip hooked back (the pounce, the trot, a bristle).
const TAIL_UP = [1.85, -0.12, -0.06, -0.04, -0.04, -0.08, -0.14, -0.22];
const WHISKER_INK = new THREE.Color('#2b2630');

const REST = {
  lift: 0,
  squash: 0,
  pitch: 0,
  roll: 0,
  yaw: 0,
  headPitch: 0, // + nods down
  headRoll: 0,
  headYaw: 0,
  earFwd: 0.1, // + pricks the ears forward, - back
  earFlat: 0, // 0 up .. 1 flattened out and back
  earL: 0, // a flick of one ear (+X), and of the other
  earR: 0,
  pawL: 0, // front leg raise, rad (forward)
  pawR: 0,
  swipe: 0, // the right paw's sideways sweep (+ inward, across the body)
  curl: 1, // tail curl (x CURL)
  sway: 0, // tail side-swish
  flick: 0, // tail tip flick
  tailUp: 0, // 0 lying curled .. 1 straight up
  puff: 0, // fluffed-up tail
  upper: 0.16,
  lower: 0.06,
  upperL: 0, // extra on the +X eye's upper lid
  sad: 0,
  gazeYaw: 0,
  gazePitch: -0.15,
  dilate: 0, // 0 slit pupils .. 1 wide round ones
};
const PK = poseKit(REST);

// Keyframes, hoisted so a pose allocates nothing.
const CRIT_SQUASH = [0, 0, 0.14, 0.22, 0.22, -0.14, 0.58, -0.08, 0.68, 0.16, 0.8, 0];
const MIX_EAR = [0, 0, 0.08, 0.7, 0.14, 0, 0.42, 0, 0.48, 0.6, 0.54, 0];
const THROW_PAW = [0, 0, 0.25, 1.55, 0.42, 1.45, 0.6, 0.75, 1, 0];
const THROW_SWIPE = [0, 0, 0.25, -0.55, 0.38, -0.55, 0.52, 0.7, 0.7, 0.4, 1, 0];
const THROW_ROLL = [0, 0, 0.3, -0.07, 0.52, 0.09, 1, 0];
const THROW_HEAD = [0, 0, 0.3, 0.16, 0.6, 0.1, 1, 0];
const THROW_EAR = [0, 0.1, 0.3, 0.45, 0.7, 0.3, 1, 0.1];
const THROW_FLICK = [0, 0, 0.35, 0.5, 0.55, -0.4, 0.8, 0.2, 1, 0];

export function cat(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.62, metalness: 0 }),
  );
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.6, metalness: 0 }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'cat';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const squash = new THREE.Group();
  rig.add(squash);

  // The seated body: a round loaf of a haunch with thigh bumps on the sides, a chest under the
  // chin with a light bib, and light hind feet poking out in front.
  const haunch = kit.mesh(new THREE.SphereGeometry(0.46, 12, 8), body, squash, 0, 0.38, -0.06);
  haunch.scale.set(1.12, 0.82, 1.06);
  const thighGeo = kit.geo(new THREE.SphereGeometry(0.2, 7, 5));
  const footGeo = kit.geo(new THREE.SphereGeometry(0.085, 6, 4));
  for (const sx of [1, -1]) {
    const th = new THREE.Mesh(thighGeo, body);
    th.position.set(sx * 0.34, 0.2, 0.05);
    th.scale.set(0.8, 0.9, 1.25);
    squash.add(th);
    const ft = new THREE.Mesh(footGeo, accent);
    ft.position.set(sx * 0.36, 0.05, 0.3);
    ft.scale.set(0.95, 0.65, 1.3);
    squash.add(ft);
  }
  const chest = kit.mesh(new THREE.SphereGeometry(0.27, 9, 6), body, squash, 0, 0.47, 0.12);
  chest.scale.set(1, 1.05, 0.95);
  const bib = kit.mesh(new THREE.SphereGeometry(0.19, 8, 6), accent, squash, 0, 0.42, 0.26);
  bib.scale.set(0.95, 1.2, 0.6);

  // Front legs: pivots at the shoulders, a leg down to a white-socked paw on the floor.
  const legGeo = kit.geo(new THREE.CylinderGeometry(0.065, 0.075, 0.34, 6, 1, true).translate(0, -0.17, 0));
  const legs = [1, -1].map((sx) => {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.position.set(sx * 0.15, 0.4, 0.33);
    squash.add(g);
    g.add(new THREE.Mesh(legGeo, body));
    const paw = new THREE.Mesh(footGeo, accent);
    paw.position.set(0, -0.35, 0.04);
    paw.scale.set(1.05, 0.75, 1.3);
    g.add(paw);
    return g;
  });

  // Head: a big wide chibi head, tilted back so its face looks up at the top-down camera (TILT),
  // with whisker pads, a nose, a "w" mouth, whiskers, cheek tufts, big eyes and ears.
  // The neck pivot sits behind the face, so a head turn swings the face (and its eyes) round.
  const neck = new THREE.Group();
  neck.rotation.order = 'YXZ';
  neck.position.set(0, HEAD_Y, -0.2);
  squash.add(neck);
  const head = new THREE.Group();
  head.position.z = 0.3;
  head.rotation.x = -TILT;
  head.scale.setScalar(1.1);
  neck.add(head);
  // The skull's squash and tilt are baked into its geometry and the mesh turned back upright, so
  // its bounding box stays tight to the floor (a tilted ellipsoid's box would dip below it).
  const skullGeo = new THREE.SphereGeometry(0.58, 14, 10).scale(1.3, 0.82, 0.98).rotateX(-TILT);
  const skull = kit.mesh(skullGeo, body, head, 0, 0.3, 0);
  skull.rotation.x = TILT;
  const padGeo = kit.geo(new THREE.SphereGeometry(0.1, 8, 6));
  for (const sx of [1, -1]) {
    const pad = new THREE.Mesh(padGeo, accent);
    pad.position.set(sx * 0.085, 0.17, 0.51);
    pad.scale.set(1.05, 0.85, 0.8);
    head.add(pad);
  }
  const chin = kit.mesh(padGeo, accent, head, 0, 0.1, 0.47);
  chin.scale.set(0.8, 0.6, 0.7);
  const nose = kit.mesh(paint(new THREE.SphereGeometry(0.045, 6, 3), INK.tongue), detail, head, 0, 0.245, 0.58);
  nose.scale.set(1.35, 0.7, 0.8);
  const mouthGeo = kit.geo(paint(new THREE.TorusGeometry(0.03, 0.009, 3, 6, Math.PI), INK.mouth));
  const whiskerGeo = kit.geo(paint(new THREE.BoxGeometry(0.56, 0.012, 0.012).translate(0.28, 0, 0), WHISKER_INK));
  const tuftGeo = kit.geo(new THREE.ConeGeometry(0.085, 0.15, 5).translate(0, 0.075, 0));
  for (const sx of [1, -1]) {
    const m = new THREE.Mesh(mouthGeo, detail);
    m.position.set(sx * 0.03, 0.17, 0.585);
    m.rotation.set(-0.3, 0, Math.PI); // a little cup; two side by side make the "w"
    head.add(m);
    for (const k of [-1, 0, 1]) {
      const w = new THREE.Mesh(whiskerGeo, detail);
      w.userData.noFoot = true;
      w.position.set(sx * 0.17, 0.19 + k * 0.03, 0.52);
      w.rotation.set(0, sx > 0 ? 0.3 : Math.PI - 0.3, -k * 0.18 + 0.1);
      head.add(w);
    }
    // Fur tufts at the cheeks: the wide chibi-cat face from above.
    for (const k of [0, 1]) {
      const t = new THREE.Mesh(tuftGeo, body);
      t.position.set(sx * 0.7, 0.16 + k * 0.1, 0.2 - k * 0.04);
      t.rotation.set(0, 0, -sx * (1.9 - k * 0.45));
      t.scale.set(1, 1, 0.6);
      head.add(t);
    }
  }
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lid: body });
    e.socket.position.set(side * 0.27, 0.42, 0.42);
    e.socket.rotation.order = 'YXZ';
    e.socket.rotation.set(-0.38, side * 0.2, 0);
    head.add(e.socket);
    return e;
  });
  const pupils = eyes.map((e) => e.ball.children.find((m) => m.name === 'pupil'));
  // Ears: a flat body-colour triangle with a light inside, on a pivot at the base.
  const earGeo = kit.geo(new THREE.ConeGeometry(0.2, 0.36, 6).translate(0, 0.17, 0));
  const innerGeo = kit.geo(new THREE.ConeGeometry(0.13, 0.25, 6).translate(0, 0.12, 0));
  const ears = [1, -1].map((side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.4, 0.64, -0.06);
    head.add(g);
    const outer = new THREE.Mesh(earGeo, body);
    outer.scale.set(1, 1, 0.5);
    g.add(outer);
    const inner = new THREE.Mesh(innerGeo, accent);
    inner.position.set(0, 0.02, 0.055);
    inner.scale.set(1, 1, 0.4);
    g.add(inner);
    return g;
  });

  // Tail: a tapering chain that leaves the back, wraps around the cat's right side on the floor
  // and curls in front of its paws; a light tip.
  const tail = [];
  const tailSegs = [];
  let parent = squash;
  const segGeo = kit.geo(new THREE.SphereGeometry(1, 6, 4));
  for (let i = 0; i < TAIL_N; i++) {
    const j = new THREE.Group();
    j.userData.noFoot = true;
    j.rotation.order = 'YXZ'; // heading first, then the pitch along it
    if (i === 0) j.position.set(-0.12, 0.16, -0.42);
    else j.position.z = -SEG;
    parent.add(j);
    const seg = new THREE.Mesh(segGeo, i === TAIL_N - 1 ? accent : body);
    seg.position.z = -SEG / 2;
    j.add(seg);
    tail.push(j);
    tailSegs.push(seg);
    parent = j;
  }

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // Crouch, spring into a pounce (paws out, tail straight up, ears forward), land, swish.
      o.squash = keys(t, CRIT_SQUASH);
      const jump = span(t, 0.2, 0.62);
      o.lift = Math.sin(Math.PI * jump) * 0.6;
      o.pitch = 0.28 * Math.sin(Math.PI * jump) - 0.1 * bump(t, 0.04, 0.22);
      const reach = plateau(t, 0.18, 0.7, 0.08);
      o.pawL = 1.5 * reach;
      o.pawR = 1.5 * reach;
      const joy = plateau(t, 0.06, 0.95, 0.1);
      o.tailUp = joy;
      o.puff = 0.3 * joy;
      o.earFwd = lerp(0.1, 0.55, joy);
      o.dilate = joy;
      o.upper = lerp(0.16, 0, joy);
      o.lower = lerp(0.06, 0, joy);
      o.headPitch = -0.25 * joy;
      o.gazePitch = lerp(-0.15, 0.15, joy);
      o.sway = 0.35 * Math.sin(t * TAU * 3) * bump(t, 0.62, 1);
    } else if (reaction === 'fumble') {
      // Ears flat, nose up and turned away, eyes half shut, the tail lashing low.
      const dis = smooth(span(t, 0.05, 0.4));
      o.earFlat = dis;
      o.headYaw = 0.75 * dis;
      o.headPitch = -0.14 * dis;
      o.yaw = 0.22 * dis;
      o.gazeYaw = 0.5 * dis;
      o.upper = lerp(0.16, 0.6, dis);
      o.sad = -0.25 * dis;
      o.squash = 0.04 * dis;
      o.curl = lerp(1, 0.6, dis);
      o.sway = 0.6 * Math.sin(t * TAU * 3.5) * plateau(t, 0.1, 1, 0.1);
      o.flick = 0.4 * Math.sin(t * TAU * 7) * plateau(t, 0.1, 1, 0.1);
    } else if (reaction === 'mixed') {
      // One ear flicks (twice), the head tilts, a slow judging blink, the tail in a question.
      const tilt = outBack(span(t, 0.04, 0.3), 2.2) * (1 - smooth(span(t, 0.85, 1)));
      o.headRoll = 0.4 * tilt;
      o.headPitch = -0.06 * tilt;
      o.earL = keys(t, MIX_EAR);
      o.earFwd = lerp(0.1, -0.1, tilt);
      const judge = bump(t, 0.3, 0.8);
      o.upper = lerp(0.16, 0.92, judge);
      o.lower = lerp(0.06, 0.3, judge);
      o.upperL = -0.1 * tilt;
      o.gazeYaw = 0.2 * tilt;
      o.curl = lerp(1, 1.3, tilt);
      o.flick = 0.5 * bump(t, 0.5, 0.9);
    } else {
      // Content: a slow blink, a little nod and a curl of the tail.
      const content = plateau(t, 0.08, 0.92, 0.15);
      o.upper = lerp(0.16, 0.86, bump(t, 0.12, 0.72));
      o.lower = lerp(0.06, 0.3, content);
      o.headRoll = -0.12 * content;
      o.headPitch = 0.1 * bump(t, 0.15, 0.6);
      o.curl = lerp(1, 1.45, content);
      o.flick = 0.4 * bump(t, 0.3, 0.9) * Math.sin(t * TAU * 2);
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  /** Breathing, a tail sway with a tip flick, an ear twitch and blinks, some of them slow. */
  function idle(o, ms, amount = 1) {
    o.squash += 0.015 * Math.sin((ms / 2200) * TAU) * amount;
    o.sway += 0.12 * Math.sin((ms / 2600) * TAU) * amount;
    o.headRoll += 0.04 * Math.sin((ms / 3100) * TAU) * amount;
    const f = ((ms + 900) % 2900) / 2900;
    o.flick += 0.6 * bump(f, 0.6, 0.8) * Math.sin(f * TAU * 10) * amount;
    const e = ((ms + 1700) % 4100) / 4100;
    o.earR += 0.55 * bump(e, 0.86, 0.9) * amount;
    o.earL += 0.4 * bump(e, 0.42, 0.45) * amount;
    const slow = ((ms + 2300) % 5300) / 5300;
    const b = Math.max(blink(ms, 1200), bump(slow, 0.78, 0.96));
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
      // A crouch, a light hop off (the layer moves it), tail up, and a landing.
      tmp.squash = 0.14 * bump(t, 0, 0.25) - 0.08 * bump(t, 0.2, 0.85) + 0.12 * bump(t, 0.85, 1);
      tmp.tailUp = 0.7 * bump(t, 0.1, 1);
      tmp.earFwd = 0.1 + 0.25 * bump(t, 0.1, 1);
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      PK.reset(p);
      p.squash = -0.08 * bump(t, 0.05, 0.75) + 0.14 * bump(t, 0.75, 1);
      p.tailUp = 0.75 * bump(t, 0, 0.95);
      p.earFwd = 0.1 + 0.3 * bump(t, 0, 0.9);
      p.pawL = 0.4 * bump(t, 0.1, 0.4);
      p.pawR = 0.4 * bump(t, 0.35, 0.65);
      p.upper = 0.05;
    } else if (phase === 'move') {
      // A dodge: a quick light trot (the layer slides it across): paws stepping in turn, a bob
      // on every step, leaning in, ears pricked and the tail held up with its tip hooked. It
      // starts and ends on the standing pose (exit at t 1).
      PK.reset(p);
      const go = plateau(t, 0.04, 0.96, 0.14);
      const s = Math.sin(t * TAU * 4);
      p.lift = 0.07 * Math.abs(s) * go;
      p.squash = -0.03 * Math.abs(s) * go + 0.06 * bump(t, 0, 0.1) + 0.06 * bump(t, 0.9, 1);
      p.pitch = 0.14 * go;
      p.roll = 0.04 * s * go;
      p.pawL = 0.75 * Math.max(0, s) * go;
      p.pawR = 0.75 * Math.max(0, -s) * go;
      p.headPitch = -0.12 * go;
      p.earFwd = lerp(0.1, 0.4, go);
      p.tailUp = 0.85 * go;
      p.curl = lerp(1, 0.2, go);
      p.sway = 0.2 * Math.sin(t * TAU * 2) * go;
      p.upper = lerp(0.16, 0.04, go);
    } else if (phase === 'pet') {
      // Petted: eyes squeezed happy, it leans into the hand with a nuzzle, ears relaxed, the tail
      // curling and swishing (look.calm: a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.headRoll = 0.3 * k * Math.sin(t * TAU * 2) * on;
      p.headPitch = -0.12 * on;
      p.roll = 0.06 * k * Math.sin(t * TAU * 2 + 0.6) * on;
      p.earFlat = 0.25 * on;
      p.curl = lerp(1, 1.4, on);
      p.sway = 0.35 * k * Math.sin(t * TAU * 2.5) * on;
      p.squash = 0.04 * k * Math.sin(t * TAU * 4) * on;
      p.upper = lerp(0.16, 0.75, on);
      p.lower = lerp(0.06, 0.45, on);
    } else if (phase === 'huff') {
      // Huffed: ears back, a puff, the head turned away, eyes narrowed, the tail lashing.
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.squash = (-0.08 * bump(t, 0.05, 0.45) + 0.06 * bump(t, 0.4, 0.75)) * k;
      p.earFlat = 0.85 * mad;
      p.headYaw = 0.6 * mad;
      p.headPitch = -0.12 * mad;
      p.gazeYaw = 0.5 * mad;
      p.upper = lerp(0.16, 0.55, mad);
      p.sad = -0.25 * mad;
      p.sway = 0.5 * k * Math.sin(t * TAU * 3) * mad;
      p.puff = 0.3 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop back off the heat, then it fans its face with a paw, ears
      // back, squinting, tail swishing (look.calm: slower, smaller strokes).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.25 * k * bump(t, 0.02, 0.28);
      p.pawR = on * (1.25 + 0.3 * k * Math.sin(t * TAU * (look?.calm ? 3 : 5)));
      p.swipe = 0.45 * k * Math.sin(t * TAU * (look?.calm ? 3 : 5)) * on;
      p.earFlat = 0.6 * on;
      p.headPitch = -0.15 * on;
      p.sway = 0.35 * k * Math.sin(t * TAU * 2.5) * on;
      p.upper = lerp(0.16, 0.6, on);
    } else if (phase === 'shiver') {
      // Frozen (frost): hunched, ears flat, the tail wrapped tight, shivering side to side, eyes
      // squeezed (look.calm: a slower, smaller shiver).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.roll = 0.07 * k * Math.sin(t * TAU * f) * on;
      p.earFlat = 0.7 * on;
      p.headPitch = 0.2 * on;
      p.curl = lerp(1, 1.5, on);
      p.squash = 0.07 * on;
      p.upper = lerp(0.16, 0.6, on);
      p.puff = 0.15 * on;
    } else if (phase === 'bristle') {
      // Zapped (storm): standing tall, tail straight up and puffed out, eyes wide, pupils round,
      // trembling (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.1 * on;
      p.tailUp = on;
      p.puff = 0.7 * on;
      p.earFwd = lerp(0.1, -0.25, on);
      p.roll = 0.04 * k * Math.sin(t * TAU * 10) * on;
      p.headPitch = -0.12 * on;
      p.upper = lerp(0.16, 0, on);
      p.lower = lerp(0.06, 0, on);
      p.dilate = on;
    } else if (phase === 'startle') {
      // Startled (any other element): a crouch, a jump with its paws up and its tail puffed, eyes
      // wide, and a landing (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      const air = span(t, 0.1, 0.5);
      p.lift = 0.55 * k * Math.sin(Math.PI * air);
      p.squash = 0.15 * bump(t, 0, 0.12) - 0.1 * k * bump(t, 0.1, 0.5) + 0.14 * k * bump(t, 0.48, 0.66);
      p.pawL = 0.9 * bump(t, 0.1, 0.55);
      p.pawR = 0.9 * bump(t, 0.1, 0.55);
      p.tailUp = 0.9 * wide;
      p.puff = 0.45 * wide;
      p.earFwd = lerp(0.1, 0.4, wide);
      p.upper = lerp(0.16, 0, wide);
      p.lower = lerp(0.06, 0, wide);
      p.dilate = wide;
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy hops with its paws up, ears pricked, tail
      // up and swishing, smiling eyes (look.calm: one small hop). From and back to standing.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      const air1 = bump(t, 0.12, 0.42);
      const air2 = two * bump(t, 0.52, 0.82);
      p.lift = 0.35 * k * (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash =
        k * (0.12 * bump(t, 0.02, 0.14) - 0.08 * air1 + 0.12 * bump(t, 0.42, 0.54)) +
        two * (0.1 * bump(t, 0.82, 0.95) - 0.08 * air2);
      p.pawL = 0.9 * k * (air1 + air2);
      p.pawR = 0.9 * k * (air1 + air2);
      p.earFwd = lerp(0.1, 0.4, joy);
      p.tailUp = 0.8 * joy;
      p.sway = (calm ? 0.12 : 0.35) * Math.sin(t * TAU * 3) * joy;
      p.headPitch = lerp(0, -0.2, joy); // lerp: exactly +0 at rest, as the standing pose
      p.upper = lerp(0.16, 0.55, joy);
      p.lower = lerp(0.06, 0.45, joy);
      p.gazePitch = lerp(-0.15, 0.2, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: sitting up tall, chin up, ears pricked, tail wrapped neat,
      // a smug half-lidded look. Sulk: head hung, ears flat, the tail limp.
      PK.reset(end);
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.squash = -0.09;
        tmp.pitch = -0.06;
        tmp.headPitch = -0.28;
        tmp.earFwd = 0.3;
        tmp.curl = 1.35;
        tmp.flick = 0.3;
        tmp.upper = 0.5;
        tmp.lower = 0.32;
        tmp.gazePitch = 0;
      } else {
        tmp.squash = 0.17;
        tmp.pitch = 0.06;
        tmp.headPitch = 0.6;
        tmp.earFlat = 1;
        tmp.curl = 0.5;
        tmp.upper = 0.62;
        tmp.sad = 0.45;
        tmp.gazePitch = -0.6;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.squash -= 0.04 * bump(t, 0.2, 0.8); // a puff on the way
    } else if (phase === 'throw') {
      // Bats the dice: the right paw winds up high and out, then swipes across; ears forward.
      PK.reset(p);
      p.pawR = keys(t, THROW_PAW);
      p.swipe = keys(t, THROW_SWIPE);
      p.roll = keys(t, THROW_ROLL);
      p.headPitch = keys(t, THROW_HEAD);
      p.earFwd = keys(t, THROW_EAR);
      p.flick = keys(t, THROW_FLICK);
      p.dilate = 0.7 * bump(t, 0.1, 0.8);
      p.upper = 0.05;
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
    const sy = 1 - o.squash;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    squash.scale.set(sxz, sy, sxz);
    neck.rotation.set(o.headPitch, o.headYaw, o.headRoll);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const flick = side > 0 ? o.earL : o.earR;
      ears[i].rotation.set(0.25 + o.earFwd - 0.7 * o.earFlat - 0.3 * flick, 0, -side * (0.42 + 0.95 * o.earFlat + 0.35 * flick));
      legs[i].rotation.set(-(side > 0 ? o.pawL : o.pawR), side > 0 ? 0 : o.swipe, 0);
      eyes[i].set(o.gazeYaw, o.gazePitch, o.upper + (side > 0 ? o.upperL : 0), o.lower, o.sad);
      pupils[i].scale.set(0.55 + 0.4 * o.dilate, 1.15, 1);
    }
    const up = o.tailUp;
    for (let i = 0; i < TAIL_N; i++) {
      const j = tail[i];
      j.rotation.x = lerp(TAIL_DOWN[i], TAIL_UP[i], up);
      const c = i === 0 ? 1 : 1 + (o.curl - 1) * 0.4;
      j.rotation.y =
        (1 - up) * c * CURL[i] + o.sway * (0.15 + i * 0.06) + (i >= TAIL_N - 3 ? o.flick * 0.5 : 0);
      const r = (0.088 - i * 0.004) * (1 + o.puff);
      tailSegs[i].scale.set(r, r, SEG * 0.72);
    }
  }

  PK.reset(p);
  apply(p);
  root.updateMatrixWorld(true);
  const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
  scaler.scale.setScalar(HEIGHT / h);

  return { root, height: HEIGHT, footprint: FOOT, pose, dispose: () => kit.dispose() };
}

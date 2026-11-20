import * as THREE from 'three';
import {
  TAU,
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
} from './parts.js';

/**
 * The fox: a little seated chibi fox, a slim loaf of a body under a head tilted back so it looks
 * up at the top-down camera: a long pointed muzzle (orange on top, cream below) with a black nose,
 * white cheek ruffs, big upright pointed ears with dark tips, narrow sly eyes, a cream bib, black
 * socks and a big bushy tail with a cream tip wrapped round its side to its paws. From above: a
 * pointed face looking up at you between two tall ears, and the brush of a tail. Sly and bouncy.
 * Crit: a high mousing pounce (up, then nose down, tail up, front paws first); fumble: it curls up
 * and hides its face behind its tail; mixed: a head tilt with one ear cocked; plain: a pleased tail
 * swish. Throw: it noses the dice and pats them with a paw.
 */

const HEIGHT = 1.5;
const FOOT = 0.8; // top-down radius in scene units (head, ears, ruffs), tail excluded (measured)
const EYE_R = 0.155;
const HEAD_Y = 0.6;
const TILT = 0.9; // the head's built-in tilt back (rad), its face up toward the camera
const TAIL_N = 8;
const SEG = 0.17; // tail segment length (design units)
// The tail's resting curl, per joint (rad): back, out to the fox's right and hooking forward.
const CURL = [1.3, 0.44, 0.4, 0.38, 0.4, 0.48, 0.62, 0.8];
// Tail pitch per joint: lying on the floor (down off the haunch, then level) ...
const TAIL_DOWN = [-0.1, 0.1, 0, 0, 0, 0, 0, 0];
// ... and up in a brush with the tip hooked back (the pounce, the trot, a bristle).
const TAIL_UP = [1.5, -0.1, -0.08, -0.06, -0.06, -0.08, -0.12, -0.18];
// The brush: thin at the root, full in the middle, a soft point at the tip.
// ... and the fumble: the tip end lifted up over the paws to hide the face behind.
const TAIL_R = [0.09, 0.15, 0.19, 0.215, 0.22, 0.205, 0.17, 0.115];
// The cheek ruffs: [x, y, z] base in the head, [dx, dy, dz] the way it points, radius, length.
const RUFFS = [
  [0.34, 0.06, 0.22, 1, -0.7, -0.1, 0.13, 0.28],
];
const CREAM = new THREE.Color('#f3e8d6');
const SOCK = new THREE.Color('#2b2120');
const INK_NOSE = new THREE.Color('#16110f');
const INK_MOUTH = new THREE.Color('#3a1a14');

const REST = {
  lift: 0,
  squash: 0,
  pitch: 0,
  roll: 0,
  yaw: 0,
  headPitch: 0, // + nods down
  headRoll: 0,
  headYaw: 0,
  earFwd: 0.05, // + pricks the ears forward, - back
  earFlat: 0, // 0 up .. 1 flattened out and back
  earL: 0, // a twitch of one ear (+X), and of the other
  earR: 0,
  cockL: 0, // one ear cocked up and forward (the head tilt), the other drooped
  pawL: 0, // front leg raise, rad (forward)
  pawR: 0,
  swipe: 0, // the right paw's sideways sweep (+ inward, across the body)
  curl: 1, // tail curl (x CURL)
  sway: 0, // tail side-swish
  flick: 0, // tail tip flick
  tailUp: 0, // 0 lying curled .. 1 raised
  tailLift: 0, // the curled tail lifted off the floor (to hide the face behind it)
  puff: 0, // fluffed-up tail
  upper: 0.42, // narrow, sly eyes
  lower: 0.2,
  upperL: 0, // extra on the +X eye's upper lid
  sad: -0.14, // a sly slant: the inner ends of the lids low
  gazeYaw: 0,
  gazePitch: -0.12,
  dilate: 0, // 0 slit pupils .. 1 wide round ones
};
const PK = poseKit(REST);

// Keyframes, hoisted so a pose allocates nothing.
const CRIT_SQUASH = [0, 0, 0.14, 0.26, 0.2, -0.16, 0.6, -0.1, 0.7, 0.2, 0.82, 0];
// The mousing pounce: nose up on the way up, then tipped nose down over the top, level to land.
const CRIT_PITCH = [0, 0, 0.14, 0.08, 0.24, -0.3, 0.38, 0.05, 0.5, 0.62, 0.58, 0.45, 0.66, 0];
const CRIT_PAW = [0, 0, 0.2, 0.9, 0.36, 0.5, 0.5, 1.6, 0.66, 1.1, 0.76, 0];
const THROW_HEAD = [0, 0, 0.22, -0.12, 0.42, 0.55, 0.56, 0.5, 0.75, 0.1, 1, 0];
const THROW_PAW = [0, 0, 0.3, 0.2, 0.52, 1.25, 0.66, 0.6, 0.8, 1.0, 1, 0];
const THROW_SWIPE = [0, 0, 0.5, 0.25, 0.66, 0.55, 0.8, 0.3, 1, 0];
const THROW_PITCH = [0, 0, 0.42, 0.14, 0.6, 0.12, 1, 0];
const THROW_EAR = [0, 0.05, 0.3, 0.5, 0.7, 0.35, 1, 0.05];

export function fox(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.66, metalness: 0 }));
  const accent = kit.mat(new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.66, metalness: 0 }));
  // The untinted colours, told apart by vertex colour: cream (muzzle, ruffs, bib, tail tip), the
  // dark socks and ear tips, and the eyes and nose (a satin finish between fur and gloss).
  const detail = kit.mat(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0 }));
  const fur = detail;
  const cream = (g) => kit.geo(paint(g, CREAM));
  const dark = (g) => kit.geo(paint(g, SOCK));

  const root = new THREE.Group();
  root.name = 'fox';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const squash = new THREE.Group();
  rig.add(squash);

  // The seated body: a slim haunch with thigh bumps, a chest with a cream bib down to the paws,
  // and black hind feet poking out in front.
  const haunch = kit.mesh(new THREE.SphereGeometry(0.44, 11, 7), body, squash, 0, 0.38, -0.08);
  haunch.scale.set(1.02, 0.86, 1.08);
  const thighGeo = kit.geo(new THREE.SphereGeometry(0.2, 7, 5));
  const footGeo = dark(new THREE.SphereGeometry(0.08, 6, 4));
  for (const sx of [1, -1]) {
    const th = new THREE.Mesh(thighGeo, body);
    th.position.set(sx * 0.31, 0.2, 0.03);
    th.scale.set(0.78, 0.9, 1.25);
    squash.add(th);
    const ft = new THREE.Mesh(footGeo, fur);
    ft.position.set(sx * 0.33, 0.05, 0.28);
    ft.scale.set(0.95, 0.65, 1.4);
    squash.add(ft);
  }
  const chest = kit.mesh(new THREE.SphereGeometry(0.25, 9, 6), body, squash, 0, 0.5, 0.1);
  chest.scale.set(1, 1.1, 0.95);
  const bib = kit.mesh(cream(new THREE.SphereGeometry(0.2, 8, 6)), fur, squash, 0, 0.46, 0.2);
  bib.scale.set(1.0, 1.6, 0.72);

  // Front legs: pivots at the shoulders, an orange upper leg into a black sock and paw.
  const legGeo = kit.geo(new THREE.CylinderGeometry(0.06, 0.066, 0.16, 6, 1, true).translate(0, -0.08, 0));
  const sockGeo = dark(new THREE.CylinderGeometry(0.066, 0.07, 0.2, 6, 1, true).translate(0, -0.25, 0));
  const legs = [1, -1].map((sx) => {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.position.set(sx * 0.14, 0.4, 0.3);
    squash.add(g);
    g.add(new THREE.Mesh(legGeo, body));
    g.add(new THREE.Mesh(sockGeo, fur));
    const paw = new THREE.Mesh(footGeo, fur);
    paw.position.set(0, -0.35, 0.04);
    paw.scale.set(1.0, 0.75, 1.3);
    g.add(paw);
    return g;
  });

  // Head: a chibi head tilted back so its face looks up at the top-down camera (TILT), with a long
  // pointed muzzle, a black nose, white cheek ruffs, narrow eyes and tall ears. The neck pivot sits
  // behind the face, so a head turn swings the face (and its eyes) round.
  const neck = new THREE.Group();
  neck.rotation.order = 'YXZ';
  neck.position.set(0, HEAD_Y, -0.18);
  squash.add(neck);
  const head = new THREE.Group();
  head.position.z = 0.28;
  head.rotation.x = -TILT;
  head.scale.setScalar(1.05);
  neck.add(head);
  // The skull's squash and tilt are baked into its geometry and the mesh turned back upright, so
  // its bounding box stays tight to the floor (a tilted ellipsoid's box would dip below it).
  const skullGeo = new THREE.SphereGeometry(0.5, 12, 8).scale(1.18, 0.86, 0.96).rotateX(-TILT);
  const skull = kit.mesh(skullGeo, body, head, 0, 0.3, 0);
  skull.rotation.x = TILT;
  // The muzzle: an orange bridge over a cream jaw, both tapering to a point at the nose.
  const snoutGeo = (r, len, flat) => {
    const g = new THREE.SphereGeometry(r, 8, 6).scale(1, flat, len / r);
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const k = 1 - 0.62 * Math.max(0, a.getZ(i) / len) ** 1.3; // narrows toward the tip
      a.setX(i, a.getX(i) * k);
      a.setY(i, a.getY(i) * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const bridge = kit.mesh(snoutGeo(0.15, 0.36, 0.72), body, head, 0, 0.2, 0.42);
  bridge.rotation.x = -0.12;
  const jaw = kit.mesh(cream(snoutGeo(0.16, 0.33, 0.7)), fur, head, 0, 0.12, 0.42);
  jaw.rotation.x = -0.04;
  const nose = kit.mesh(paint(new THREE.SphereGeometry(0.05, 7, 4), INK_NOSE), detail, head, 0, 0.255, 0.77);
  nose.scale.set(1.15, 0.85, 0.9);
  const mouthGeo = kit.geo(paint(new THREE.TorusGeometry(0.035, 0.009, 3, 6, Math.PI), INK_MOUTH));
  for (const sx of [1, -1]) {
    const m = new THREE.Mesh(mouthGeo, detail);
    m.position.set(sx * 0.03, 0.09, 0.66);
    m.rotation.set(-0.5, 0, Math.PI);
    head.add(m);
  }
  // White cheek ruffs: soft points of fluff down and out below the eyes, the fox's pointed face
  // from above.
  const cheekGeo = cream(new THREE.SphereGeometry(0.17, 6, 4));
  for (const sx of [1, -1]) {
    for (const [x, y, z, dx, dy, dz, r, len] of RUFFS) {
      const g = cream(snoutGeo(r, len, 0.6));
      g.lookAt(new THREE.Vector3(sx * dx, dy, dz));
      kit.mesh(g, fur, head, sx * x, y, z);
    }
    const cheek = new THREE.Mesh(cheekGeo, fur);
    cheek.position.set(sx * 0.29, 0.12, 0.27);
    cheek.scale.set(1.15, 0.8, 0.85);
    head.add(cheek);
  }
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lid: body });
    e.socket.position.set(side * 0.24, 0.38, 0.38);
    e.socket.rotation.order = 'YXZ';
    e.socket.rotation.set(-0.3, side * 0.28, side * 0.12);
    head.add(e.socket);
    return e;
  });
  const pupils = eyes.map((e) => e.ball.children.find((m) => m.name === 'pupil'));
  // Ears: tall body-colour triangles with a cream inside and a dark tip, on a pivot at the base.
  const earGeo = kit.geo(new THREE.ConeGeometry(0.22, 0.5, 6).translate(0, 0.25, 0));
  const innerGeo = kit.geo(new THREE.ConeGeometry(0.14, 0.32, 6).translate(0, 0.16, 0));
  const tipGeo = dark(new THREE.ConeGeometry(0.1, 0.22, 6).translate(0, 0.11, 0));
  const ears = [1, -1].map((side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.3, 0.62, -0.06);
    head.add(g);
    const outer = new THREE.Mesh(earGeo, body);
    outer.scale.set(1, 1, 0.5);
    g.add(outer);
    const inner = new THREE.Mesh(innerGeo, accent); // a lighter inside
    inner.position.set(0, 0.03, 0.05);
    inner.scale.set(1, 1, 0.4);
    g.add(inner);
    const tip = new THREE.Mesh(tipGeo, fur);
    tip.position.y = 0.29;
    tip.scale.set(1.02, 1, 0.55);
    g.add(tip);
    return g;
  });

  // Tail: a full brush of a chain that leaves the back, wraps around the fox's right side on the
  // floor and curls in front of its paws; a cream tip.
  const tail = [];
  const tailSegs = [];
  // the tail's root pivot at its base, turned in body space to lift the whole brush (fumble)
  const tailRoot = new THREE.Group();
  tailRoot.position.set(-0.14, 0.26, -0.4);
  squash.add(tailRoot);
  let parent = tailRoot;
  const segGeo = kit.geo(new THREE.SphereGeometry(1, 7, 4));
  const tipSegGeo = cream(new THREE.SphereGeometry(1, 7, 4));
  for (let i = 0; i < TAIL_N; i++) {
    const j = new THREE.Group();
    j.userData.noFoot = true;
    j.rotation.order = 'YXZ'; // heading first, then the pitch along it
    if (i > 0) j.position.z = -SEG;
    parent.add(j);
    const seg = i >= TAIL_N - 2 ? new THREE.Mesh(tipSegGeo, fur) : new THREE.Mesh(segGeo, body);
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
      // A high mousing pounce: a crouch, a spring straight up, then nose down over the top with
      // the tail up behind, front paws first into the landing, and a swish.
      o.squash = keys(t, CRIT_SQUASH);
      const jump = span(t, 0.18, 0.66);
      o.lift = Math.sin(Math.PI * jump) * 0.82;
      o.pitch = keys(t, CRIT_PITCH);
      o.pawL = keys(t, CRIT_PAW);
      o.pawR = o.pawL;
      const joy = plateau(t, 0.06, 0.95, 0.1);
      o.tailUp = joy;
      o.puff = 0.25 * joy;
      o.earFwd = lerp(0.05, 0.6, joy);
      o.dilate = joy;
      o.upper = lerp(0.42, 0, joy);
      o.lower = lerp(0.2, 0, joy);
      o.sad = lerp(-0.14, 0, joy);
      o.headPitch = 0.25 * bump(t, 0.4, 0.7) - 0.15 * bump(t, 0.1, 0.35);
      o.gazePitch = lerp(-0.12, -0.3, bump(t, 0.35, 0.75));
      o.sway = 0.4 * Math.sin(t * TAU * 3) * bump(t, 0.66, 1);
    } else if (reaction === 'fumble') {
      // Curls up small and hides its face behind its tail: the brush swept up round in front,
      // the head ducked into it, ears flat, eyes shut.
      const hide = smooth(span(t, 0.05, 0.35)) * (1 - smooth(span(t, 0.9, 1)));
      o.squash = 0.2 * hide;
      o.pitch = 0.12 * hide;
      o.headPitch = 0.95 * hide;
      o.headYaw = -0.4 * hide;
      o.yaw = -0.1 * hide;
      o.earFlat = 0.8 * hide;
      o.upper = lerp(0.42, 1, hide);
      o.lower = lerp(0.2, 0.5, hide);
      o.sad = lerp(-0.14, 0.3, hide);
      o.curl = 1;
      o.tailLift = hide;
      o.puff = 0.15 * hide;
      // a peek out over the brush, then back in
      const peek = bump(t, 0.55, 0.78);
      o.headPitch -= 0.25 * peek;
      o.upper -= 0.5 * peek;
      o.flick = 0.25 * Math.sin(t * TAU * 2) * hide;
    } else if (reaction === 'mixed') {
      // A head tilt with one ear cocked up and forward, the other drooped; a curious look.
      const tilt = outBack(span(t, 0.04, 0.3), 2.2) * (1 - smooth(span(t, 0.85, 1)));
      o.headRoll = 0.42 * tilt;
      o.headPitch = -0.06 * tilt;
      o.cockL = tilt;
      o.earR = 0.25 * bump(t, 0.5, 0.62);
      o.upper = lerp(0.42, 0.12, tilt);
      o.sad = lerp(-0.14, 0.12, tilt);
      o.gazeYaw = 0.2 * tilt;
      o.dilate = 0.4 * tilt;
      o.curl = lerp(1, 1.2, tilt);
      o.flick = 0.4 * bump(t, 0.45, 0.85);
    } else {
      // Pleased: a big swish of the brush, a smug narrowing of the eyes and a little nod.
      const content = plateau(t, 0.08, 0.92, 0.15);
      o.upper = lerp(0.42, 0.66, content);
      o.lower = lerp(0.2, 0.36, content);
      o.headRoll = -0.1 * content;
      o.headPitch = 0.08 * bump(t, 0.15, 0.6);
      o.earFwd = lerp(0.05, 0.2, content);
      o.sway = 0.6 * Math.sin(t * TAU * 1.5) * content;
      o.curl = lerp(1, 1.25, content);
      o.flick = 0.4 * bump(t, 0.3, 0.9) * Math.sin(t * TAU * 2);
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  /** Breathing, a tail swish with a tip flick, ear twitches and blinks. */
  function idle(o, ms, amount = 1) {
    o.squash += 0.015 * Math.sin((ms / 2200) * TAU) * amount;
    o.sway += 0.2 * Math.sin((ms / 2400) * TAU) * amount;
    o.headRoll += 0.04 * Math.sin((ms / 3300) * TAU) * amount;
    const f = ((ms + 900) % 3100) / 3100;
    o.flick += 0.5 * bump(f, 0.6, 0.8) * Math.sin(f * TAU * 10) * amount;
    const e = ((ms + 1700) % 3700) / 3700;
    o.earR += 0.6 * bump(e, 0.84, 0.88) * amount;
    o.earL += 0.5 * bump(e, 0.4, 0.43) * amount;
    o.earL += 0.4 * bump(e, 0.47, 0.5) * amount;
    const b = blink(ms, 1500);
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
      // A crouch, a light spring off (the layer moves it), tail up, and a landing.
      tmp.squash = 0.14 * bump(t, 0, 0.25) - 0.08 * bump(t, 0.2, 0.85) + 0.12 * bump(t, 0.85, 1);
      tmp.tailUp = 0.7 * bump(t, 0.1, 1);
      tmp.earFwd = 0.05 + 0.3 * bump(t, 0.1, 1);
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      PK.reset(p);
      p.squash = -0.08 * bump(t, 0.05, 0.75) + 0.14 * bump(t, 0.75, 1);
      p.tailUp = 0.75 * bump(t, 0, 0.95);
      p.earFwd = 0.05 + 0.35 * bump(t, 0, 0.9);
      p.pawL = 0.4 * bump(t, 0.1, 0.4);
      p.pawR = 0.4 * bump(t, 0.35, 0.65);
      p.upper = 0.12;
    } else if (phase === 'move') {
      // A dodge: a quick trot (the layer slides it across): paws stepping fast in turn, a bob on
      // every step, leaning in, ears pricked and the brush held out behind. It starts and ends on
      // the standing pose (exit at t 1).
      PK.reset(p);
      const go = plateau(t, 0.04, 0.96, 0.14);
      const s = Math.sin(t * TAU * 5);
      p.lift = 0.06 * Math.abs(s) * go;
      p.squash = -0.03 * Math.abs(s) * go + 0.06 * bump(t, 0, 0.1) + 0.06 * bump(t, 0.9, 1);
      p.pitch = 0.16 * go;
      p.roll = 0.03 * s * go;
      p.pawL = 0.7 * Math.max(0, s) * go;
      p.pawR = 0.7 * Math.max(0, -s) * go;
      p.headPitch = -0.12 * go;
      p.earFwd = lerp(0.05, 0.45, go);
      p.tailUp = 0.55 * go;
      p.curl = lerp(1, 0.15, go);
      p.sway = 0.15 * Math.sin(t * TAU * 2.5) * go;
      p.upper = lerp(0.42, 0.14, go);
    } else if (phase === 'pet') {
      // Petted: eyes squeezed happy, it leans into the hand with a nuzzle, ears back, the brush
      // swishing (look.calm: a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.headRoll = 0.3 * k * Math.sin(t * TAU * 2) * on;
      p.headPitch = -0.12 * on;
      p.roll = 0.06 * k * Math.sin(t * TAU * 2 + 0.6) * on;
      p.earFlat = 0.35 * on;
      p.curl = lerp(1, 1.3, on);
      p.sway = 0.45 * k * Math.sin(t * TAU * 2.5) * on;
      p.squash = 0.04 * k * Math.sin(t * TAU * 4) * on;
      p.upper = lerp(0.42, 0.8, on);
      p.lower = lerp(0.2, 0.5, on);
      p.sad = lerp(-0.14, 0.1, on);
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
      p.upper = lerp(0.42, 0.6, mad);
      p.sad = lerp(-0.14, -0.35, mad);
      p.sway = 0.5 * k * Math.sin(t * TAU * 3) * mad;
      p.puff = 0.3 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop back off the heat, then it fans its face with a paw, ears
      // back, squinting, the brush swishing (look.calm: slower, smaller strokes).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.25 * k * bump(t, 0.02, 0.28);
      p.pawR = on * (1.25 + 0.3 * k * Math.sin(t * TAU * (look?.calm ? 3 : 5)));
      p.swipe = 0.45 * k * Math.sin(t * TAU * (look?.calm ? 3 : 5)) * on;
      p.earFlat = 0.6 * on;
      p.headPitch = -0.15 * on;
      p.sway = 0.35 * k * Math.sin(t * TAU * 2.5) * on;
      p.upper = lerp(0.42, 0.65, on);
    } else if (phase === 'shiver') {
      // Frozen (frost): hunched, ears flat, the brush wrapped tight round it, shivering side to
      // side, eyes squeezed (look.calm: a slower, smaller shiver).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.roll = 0.07 * k * Math.sin(t * TAU * f) * on;
      p.earFlat = 0.7 * on;
      p.headPitch = 0.2 * on;
      p.curl = lerp(1, 1.45, on);
      p.squash = 0.07 * on;
      p.upper = lerp(0.42, 0.7, on);
      p.puff = 0.2 * on;
    } else if (phase === 'bristle') {
      // Zapped (storm): standing tall, the brush up and puffed out, eyes wide, pupils round,
      // trembling (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.1 * on;
      p.tailUp = on;
      p.puff = 0.5 * on;
      p.earFwd = lerp(0.05, -0.25, on);
      p.roll = 0.04 * k * Math.sin(t * TAU * 10) * on;
      p.headPitch = -0.12 * on;
      p.upper = lerp(0.42, 0, on);
      p.lower = lerp(0.2, 0, on);
      p.sad = lerp(-0.14, 0.15, on);
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
      p.puff = 0.35 * wide;
      p.earFwd = lerp(0.05, 0.45, wide);
      p.upper = lerp(0.42, 0, wide);
      p.lower = lerp(0.2, 0, wide);
      p.sad = lerp(-0.14, 0.1, wide);
      p.dilate = wide;
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two bouncy hops with its paws up, ears pricked, the
      // brush up and swishing, smiling eyes (look.calm: one small hop). From and back to standing.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      const air1 = bump(t, 0.12, 0.42);
      const air2 = two * bump(t, 0.52, 0.82);
      p.lift = 0.38 * k * (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash =
        k * (0.12 * bump(t, 0.02, 0.14) - 0.08 * air1 + 0.12 * bump(t, 0.42, 0.54)) +
        two * (0.1 * bump(t, 0.82, 0.95) - 0.08 * air2);
      p.pawL = 0.9 * k * (air1 + air2);
      p.pawR = 0.9 * k * (air1 + air2);
      p.earFwd = lerp(0.05, 0.45, joy);
      p.tailUp = 0.8 * joy;
      p.sway = (calm ? 0.15 : 0.4) * Math.sin(t * TAU * 3) * joy;
      p.headPitch = lerp(0, -0.2, joy); // lerp: exactly +0 at rest, as the standing pose
      p.upper = lerp(0.42, 0.6, joy);
      p.lower = lerp(0.2, 0.48, joy);
      p.sad = lerp(-0.14, 0.1, joy);
      p.gazePitch = lerp(-0.12, 0.2, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: sitting up tall, chin up, ears pricked, the brush wrapped
      // neat, a smug half-lidded look. Sulk: head hung, ears flat, the tail limp.
      PK.reset(end);
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.squash = -0.09;
        tmp.pitch = -0.06;
        tmp.headPitch = -0.28;
        tmp.earFwd = 0.3;
        tmp.curl = 1.3;
        tmp.flick = 0.3;
        tmp.upper = 0.55;
        tmp.lower = 0.34;
        tmp.sad = -0.25;
        tmp.gazePitch = 0;
      } else {
        tmp.squash = 0.2;
        tmp.pitch = 0.06;
        tmp.headPitch = 0.75;
        tmp.earFlat = 1;
        tmp.curl = 0.5;
        tmp.upper = 0.62;
        tmp.sad = 0.45;
        tmp.gazePitch = -0.6;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.squash -= 0.04 * bump(t, 0.2, 0.8); // a puff on the way
    } else if (phase === 'throw') {
      // Noses the dice: leans in, a push of the nose, then a pat with the right paw; ears forward.
      PK.reset(p);
      p.headPitch = keys(t, THROW_HEAD);
      p.pitch = keys(t, THROW_PITCH);
      p.pawR = keys(t, THROW_PAW);
      p.swipe = keys(t, THROW_SWIPE);
      p.earFwd = keys(t, THROW_EAR);
      p.flick = 0.4 * bump(t, 0.3, 0.9);
      p.dilate = 0.7 * bump(t, 0.1, 0.8);
      p.upper = lerp(0.42, 0.22, bump(t, 0, 1));
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
      const cock = side > 0 ? o.cockL : -0.6 * o.cockL; // one up and forward, the other drooped
      ears[i].rotation.set(
        0.15 + o.earFwd + 0.35 * cock - 0.7 * o.earFlat - 0.3 * flick,
        0,
        -side * (0.22 + 0.95 * o.earFlat + 0.35 * flick - 0.15 * cock),
      );
      legs[i].rotation.set(-(side > 0 ? o.pawL : o.pawR), side > 0 ? 0 : o.swipe, 0);
      eyes[i].set(o.gazeYaw, o.gazePitch, o.upper + (side > 0 ? o.upperL : 0), o.lower, o.sad);
      pupils[i].scale.set(0.5 + 0.45 * o.dilate, 1.15, 1);
    }
    const up = o.tailUp;
    const lift = o.tailLift;
    tailRoot.rotation.set(0, 0.45 * lift, -0.12 * lift); // swung round to the front
    for (let i = 0; i < TAIL_N; i++) {
      const j = tail[i];
      j.rotation.x = lerp(TAIL_DOWN[i], TAIL_UP[i], up);
      const c = i === 0 ? 1 : 1 + (o.curl - 1) * 0.4;
      j.rotation.y =
        (1 - up) * c * CURL[i] + o.sway * (0.15 + i * 0.06) + (i >= TAIL_N - 3 ? o.flick * 0.5 : 0);
      const r = TAIL_R[i] * (1 + o.puff);
      tailSegs[i].scale.set(r, r * 0.92, SEG * 1.05);
    }
  }

  PK.reset(p);
  apply(p);
  root.updateMatrixWorld(true);
  const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
  scaler.scale.setScalar(HEIGHT / h);

  return { root, height: HEIGHT, footprint: FOOT, pose, dispose: () => kit.dispose() };
}


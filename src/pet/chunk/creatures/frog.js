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
  wobble,
  nowMs,
  paint,
  palette,
  poseKit,
  createKit,
  detailMaterial,
} from './parts.js';

/**
 * The frog: a squat, wide frog with a light belly and throat, two big bulging eyes on top of its
 * head, a wide smug smile, a throat pouch that puffs, folded hind legs and little front feet with
 * round toe pads. From above: a rounded wedge with two eye bumps, three light spots on its back
 * and its toes peeking out. Bouncy and smug.
 * Crit: a big croak (the pouch balloons), a high leap with its legs kicked out and a tongue flick;
 * fumble: it flattens like a pancake, eyes sinking and drooping, the pouch sagging; mixed: one eye
 * squints and the head shrugs sideways; plain: a contented croak.
 */

const HEIGHT = 1.5;
const FOOT = 0.96; // top-down body radius in scene units, legs excluded (measured from the built geometry)
const EYE_R = 0.18;
// The body (design units, scaled to HEIGHT at build).
const RX = 0.52; // half width
const RZ = 0.46; // half depth
const SKIRT = 0.14; // height of the rounded skirt below the dome
const TOPY = 0.58; // top of the back
const PIVOT = new THREE.Vector3(0, 0.3, 0.05); // the face turns about this (head shrug, nod)
const POUCH_R = 0.15;

/**
 * A point on the frog body (design units): direction a about the y axis (atan2 of z, x) and height
 * s on the unit sphere it is shaped from (-1 the flat base .. 0 the rim of the dome .. 1 the top of
 * the back). The body is a flat base with a rounded skirt and a broad low dome, wider toward the
 * front, the snout dipping a little; details are placed on it analytically.
 */
function surf(a, s, out) {
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  const c = Math.sqrt(Math.max(0, 1 - s * s));
  let rr;
  let y;
  if (s < 0) {
    rr = c ** 0.3;
    y = SKIRT * (1 + s) ** 1.6;
  } else {
    rr = c ** 0.7 * (1 - 0.1 * s);
    y = SKIRT + (TOPY - SKIRT) * s ** 0.8 - 0.05 * Math.max(0, dz) * s;
  }
  return out.set(dx * rr * RX * (1 + 0.08 * dz), y, dz * rr * RZ);
}

/** The outward normal of the body at (a, s) (finite differences). */
function surfNormal(a, s, out) {
  const e = 1e-3;
  const s0 = Math.max(-0.999, Math.min(0.999, s));
  const pa = surf(a + e, s0, new THREE.Vector3()).sub(surf(a - e, s0, new THREE.Vector3()));
  const ps = surf(a, s0 + e, new THREE.Vector3()).sub(surf(a, s0 - e, new THREE.Vector3()));
  return out.crossVectors(ps, pa).normalize();
}

/** The top of the body above (x, z): its (a, s) on the dome. */
function domeAt(x, z) {
  let a = Math.atan2(z / RZ, x / RX);
  for (let i = 0; i < 6; i++) a = Math.atan2(z / RZ, x / (RX * (1 + 0.08 * Math.sin(a))));
  const rr = Math.hypot(x / (RX * (1 + 0.08 * Math.sin(a))), z / RZ);
  let lo = 0; // rr falls from 1 at s 0 to 0 at s 1
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (Math.sqrt(1 - m * m) ** 0.7 * (1 - 0.1 * m) > rr) lo = m;
    else hi = m;
  }
  return [a, (lo + hi) / 2];
}

/** The front of the body (x 0) at height y >= SKIRT: its z. */
function frontZ(y) {
  let lo = 0;
  let hi = 1;
  const v = new THREE.Vector3();
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (surf(Math.PI / 2, m, v).y < y) lo = m;
    else hi = m;
  }
  return surf(Math.PI / 2, (lo + hi) / 2, v).z;
}

/** Shapes a unit sphere into the frog body. */
function frogBody(geo) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const s = Math.max(-1, Math.min(1, v.y));
    surf(Math.atan2(v.z, v.x), s, v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Bends a flat face piece (in its local XY, facing +Z) around the snout: z drops with x^2. */
function wrap(geo, k) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - k * p.getX(i) ** 2);
  geo.computeVertexNormals();
  return geo;
}

const EYE_X = 0.23; // where the eyes sit on the head (design units)
const EYE_Z = 0.15;
const EYE_UP = 0.09; // eye centre above the head
// The socket's rings, from in under the ball out to the crest, down the flare and into the head:
// -1 is inside the ball, 0..1 the crest to where it meets the head, 2 a skirt reaching down under
// that, inside the body.
const SOCKET_RINGS = [-1, 0, 0.35, 0.7, 1, 2];
const SOCKET_W = 0.075; // how far the flare reaches out past the crest
const SOCKET_F = 0.045; // how high above the head the crest sits on the ball

/**
 * The bump an eye sits in, in head space about the eye centre `home`: a fillet between the ball
 * and the head. All round, its crest rides the ball (tucked under the lids) a little above where
 * the ball meets the head, and a smooth concave flare runs from there down into the head at a
 * shallow angle, so the eye rises out of a soft rounded swelling. Built on the analytic body
 * surface `topY`, so it hugs the dome however steeply it falls away.
 */
function socketGeo(home, topY) {
  const n = SOCKET_RINGS.length;
  const geo = new THREE.LatheGeometry(
    SOCKET_RINGS.map((_, j) => new THREE.Vector2(1, j)),
    12,
  );
  const p = geo.attributes.position;
  const head = (cx, cz, d) => topY(home.x + cx * d, home.z + cz * d) - home.y;
  for (let i = 0; i < p.count; i++) {
    const j = Math.round(p.getY(i));
    const len = Math.hypot(p.getX(i), p.getZ(i)) || 1;
    const cx = p.getX(i) / len;
    const cz = p.getZ(i) / len;
    // the crest: the point on the ball (polar angle b from the top) SOCKET_F above the head
    let lo = Math.PI / 3;
    let hi = Math.PI;
    for (let it = 0; it < 20; it++) {
      const b = (lo + hi) / 2;
      if (EYE_R * Math.cos(b) - head(cx, cz, EYE_R * Math.sin(b)) > SOCKET_F) lo = b;
      else hi = b;
    }
    const b = (lo + hi) / 2;
    const cd = EYE_R * Math.sin(b) * 0.985;
    const cy = EYE_R * Math.cos(b) * 0.985;
    const fy = head(cx, cz, cd + SOCKET_W) - 0.07; // the foot, inside the skin
    const k = SOCKET_RINGS[j];
    let d;
    let y;
    if (k < 0) {
      d = cd * 0.7;
      y = cy;
    } else if (k > 1) {
      d = cd * 0.85; // deep enough to stay in the head when it shrugs
      y = fy - 0.13;
    } else {
      d = cd + SOCKET_W * k;
      y = head(cx, cz, d) - 0.07 * k + (cy - head(cx, cz, cd)) * (1 - k) ** 1.3;
    }
    p.setXYZ(i, cx * d, y, cz * d);
  }
  geo.computeVertexNormals();
  // weld the lathe seam's normals
  const nr = geo.attributes.normal;
  const last = p.count - n;
  const v = new THREE.Vector3();
  for (let j = 0; j < n; j++) {
    v.fromBufferAttribute(nr, j)
      .add(new THREE.Vector3().fromBufferAttribute(nr, last + j))
      .normalize();
    nr.setXYZ(j, v.x, v.y, v.z);
    nr.setXYZ(last + j, v.x, v.y, v.z);
  }
  return geo;
}

/** Sinks the ball a little under the pupil cap (around +Z), so no white pokes through its facets. */
function underPupil(geo) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (v.z > EYE_R * Math.cos(0.72)) p.setXYZ(i, v.x * 0.95, v.y * 0.95, v.z * 0.95);
  }
  return geo;
}

const REST = {
  lift: 0,
  squash: 0, // > 0 flatter, < 0 taller
  pitch: 0, // + nose down
  roll: 0,
  spin: 0,
  yaw: 0,
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  kick: 0, // hind legs kicked out behind 0..1
  reach: 0, // front feet reaching forward 0..1
  pouch: 0, // throat pouch: -1 sagging .. 0 .. 1 ballooned
  tongue: 0, // tongue out 0..1
  eyeUp: 0, // eyes rise (+) out of / sink (-) into the head
  upper: 0.22,
  lower: 0.1,
  upperR: 0,
  sad: 0,
  sadL: 0,
  gazeYaw: 0,
  gazePitch: -0.3,
  smile: 0.7, // -1 frown .. 0 flat .. 1 grin
  open: 0, // mouth open 0..1
};
const PK = poseKit(REST);
const STAND_UPPER = 0.12; // the standing pose's lids (exit at t 1)

// Keyframes, hoisted so a pose allocates nothing.
// The dodge: two hops, airborne over t 0.1-0.4 and 0.6-0.9 (the layer moves it across then). A
// crouch, a stretch on the spring, legs kicked out behind in the air and folding for the landing,
// which is the next crouch; the last landing rings out.
const MOVE_SQUASH = [
  0, 0, 0.06, 0.28, 0.11, -0.2, 0.25, -0.05, 0.38, 0, 0.45, 0.3, 0.55, 0.26, 0.61, -0.2, 0.75,
  -0.05, 0.88, 0, 0.94, 0.28, 0.985, -0.04, 1, 0,
];
const MOVE_KICK = [
  0, 0, 0.07, 0, 0.13, 1, 0.28, 0.75, 0.39, 0, 0.57, 0, 0.63, 1, 0.78, 0.75, 0.89, 0, 1, 0,
];
const MOVE_PITCH = [
  0, 0, 0.06, 0.08, 0.13, -0.28, 0.28, 0.05, 0.4, 0.14, 0.5, 0.06, 0.63, -0.24, 0.78, 0.05, 0.9,
  0.12, 1, 0,
];
const CRIT_POUCH = [0, 0, 0.09, 1.1, 0.17, 0.75, 0.26, 1.1, 0.36, 0];
const CRIT_SQUASH = [
  0, 0, 0.1, -0.06, 0.26, -0.06, 0.37, 0.3, 0.42, -0.26, 0.6, -0.08, 0.73, 0, 0.78, 0.32, 0.86,
  -0.08, 0.93, 0.04, 1, 0,
];
const CRIT_KICK = [0, 0, 0.38, 0, 0.43, 1, 0.62, 0.85, 0.74, 0];
const CRIT_TONGUE = [0, 0, 0.46, 0, 0.51, 1, 0.56, 1, 0.62, 0];
const PLAIN_POUCH = [0, 0, 0.1, 0, 0.24, 0.7, 0.36, 0.15, 0.5, 0.65, 0.66, 0];
const PLAIN_SQUASH = [0, 0, 0.1, 0.12, 0.2, -0.1, 0.32, 0.04, 0.45, -0.02, 0.6, 0];
const MIXED_GAZE = [0.2, 0, 0.32, -1, 0.5, -1, 0.6, 1, 0.78, 1, 0.9, 0];
const THROW_PITCH = [0, 0, 0.3, -0.22, 0.5, 0.2, 0.75, 0.05, 1, 0];
const THROW_SQUASH = [0, 0, 0.3, 0.2, 0.5, -0.12, 0.75, 0.05, 1, 0];
const THROW_TONGUE = [0, 0, 0.38, 0, 0.48, 1, 0.58, 1, 0.72, 0];
const THROW_REACH = [0, 0, 0.3, 0.1, 0.5, 0.8, 0.8, 0.2, 1, 0];

/** A slow blink: a gentle shut every ~4.6 s (longer than the shared quick one). */
const slowBlink = (ms) => bump(((ms + 1700) % 4600) / 4600, 0.86, 0.97);

export function frog(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    // double-sided: looking into an eyelid shell past the ball shows its green inside, not a gap
    new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.35,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4, metalness: 0 }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'frog';
  const scaler = new THREE.Group();
  root.add(scaler);
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  scaler.add(rig);
  const squash = new THREE.Group(); // squash/stretch about the floor
  rig.add(squash);

  kit.mesh(frogBody(new THREE.SphereGeometry(1, 20, 11)), body, squash);

  // The light belly: a patch hugging the front of the skirt, a hair off the skin (a disc mapped
  // onto the body surface, so it follows the curve with no edge poking out).
  const bellyGeo = new THREE.RingGeometry(0.001, 1, 16, 2);
  {
    const bp = bellyGeo.attributes.position;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < bp.count; i++) {
      const a = Math.PI / 2 - 0.45 * bp.getX(i); // (mirrored: the ring's face turns outward)
      const s = -0.24 + 0.32 * bp.getY(i);
      surf(a, s, v).addScaledVector(surfNormal(a, s, n), 0.009);
      bp.setXYZ(i, v.x, v.y, v.z);
    }
    bellyGeo.computeVertexNormals();
  }
  kit.mesh(bellyGeo, accent, squash);

  // Three light spots on the back, flat on the skin.
  const spotGeo = kit.geo(new THREE.SphereGeometry(0.07, 12, 2));
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3();
  for (const [x, z, s] of [
    [0.13, -0.2, 1],
    [-0.17, -0.1, 0.8],
    [0.02, -0.02, 0.65],
  ]) {
    const [a, h] = domeAt(x, z);
    const spot = new THREE.Mesh(spotGeo, accent);
    surf(a, h, spot.position);
    spot.quaternion.setFromUnitVectors(up, surfNormal(a, h, n));
    spot.scale.set(s, 0.28, s * 0.9);
    squash.add(spot);
  }
  const topY = (x, z) => surf(...domeAt(x, z), new THREE.Vector3()).y;

  // Hind legs: a fat folded thigh at each side and a long webbed foot pointing forward, toes on
  // round pads. kick swings the foot out behind (a jump).
  const thighGeo = kit.geo(new THREE.SphereGeometry(1, 10, 7).rotateX(Math.PI / 2));
  const footGeo = kit.geo(new THREE.SphereGeometry(1, 10, 2));
  const handGeo = kit.geo(new THREE.SphereGeometry(1, 7, 2));
  const padGeo = kit.geo(new THREE.SphereGeometry(0.035, 6, 2));
  const hinds = []; // flat, per leg: thigh, foot group, side
  for (const sx of [1, -1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.4, 0.16, -0.14);
    squash.add(hip);
    const thigh = new THREE.Mesh(thighGeo, body);
    thigh.scale.set(0.16, 0.15, 0.26);
    thigh.rotation.y = sx * 0.35;
    hip.add(thigh);
    const foot = new THREE.Group();
    hip.add(foot);
    const sole = new THREE.Mesh(footGeo, body);
    sole.scale.set(0.09, 0.03, 0.17);
    sole.rotation.y = sx * 0.3;
    foot.add(sole);
    for (const a of [-0.45, 0, 0.45]) {
      const pad = new THREE.Mesh(padGeo, accent);
      pad.position.set(Math.sin(a + sx * 0.3) * 0.17, -0.006, Math.cos(a + sx * 0.3) * 0.17);
      pad.scale.set(1, 0.6, 1);
      foot.add(pad);
    }
    hinds.push(thigh, foot, sx);
  }
  // Front legs: short arms with a little foot and three round toe pads peeking out in front.
  const armGeo = kit.geo(
    new THREE.CylinderGeometry(0.045, 0.05, 0.13, 6, 1, true)
      .translate(0, -0.065, 0)
      .rotateX(-0.25),
  );
  const arms = [];
  for (const sx of [1, -1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.26, 0.15, 0.3);
    squash.add(arm);
    arm.add(new THREE.Mesh(armGeo, body));
    const sole = new THREE.Mesh(handGeo, body);
    sole.position.set(0, -0.125, 0.06);
    sole.scale.set(0.07, 0.025, 0.08);
    arm.add(sole);
    for (const a of [-0.6, 0, 0.6]) {
      const pad = new THREE.Mesh(padGeo, accent);
      pad.position.set(
        Math.sin(a + sx * 0.15) * 0.085,
        -0.128,
        0.06 + Math.cos(a + sx * 0.15) * 0.085,
      );
      pad.scale.set(0.85, 0.55, 0.85);
      arm.add(pad);
    }
    arms.push(arm);
  }

  // The face rides the body but is not squashed itself: placed from the squash each frame, about
  // a pivot inside the head (so the head can shrug and nod).
  const face = new THREE.Group();
  face.rotation.order = 'YXZ';
  rig.add(face);
  const homes = []; // flat: object, home x, y, z (relative to the pivot)
  const place = (o, x, y, z) => {
    face.add(o);
    homes.push(o, x - PIVOT.x, y - PIVOT.y, z - PIVOT.z);
    return o;
  };
  // The eyes: a white ball with a big pupil and a glint, two lid shells a hair outside it, and the
  // socket: a smooth body-coloured swelling the ball rises out of, built in head space (it undoes
  // the socket's tilt) on the analytic head.
  const ballGeo = kit.geo(paint(underPupil(new THREE.SphereGeometry(EYE_R, 14, 8)), INK.white));
  const pupilGeo = kit.geo(
    paint(
      new THREE.SphereGeometry(EYE_R * 1.015, 14, 2, 0, TAU, 0, 0.66).rotateX(Math.PI / 2),
      INK.pupil,
    ),
  );
  const glintGeo = kit.geo(paint(new THREE.SphereGeometry(EYE_R * 0.22, 8, 2), INK.glint));
  const upLidGeo = kit.geo(new THREE.SphereGeometry(EYE_R * 1.065, 14, 4, 0, TAU, 0, Math.PI / 2));
  const loLidGeo = kit.geo(
    new THREE.SphereGeometry(EYE_R * 1.045, 14, 4, 0, TAU, Math.PI / 2, Math.PI / 2),
  );
  const glintDir = new THREE.Vector3(-0.3, 0.32, 0.9).normalize();
  const eyes = [1, -1].map((side) => {
    const socket = new THREE.Group();
    socket.rotation.order = 'YXZ';
    socket.rotation.set(-0.6, side * 0.4, 0);
    const ball = new THREE.Group();
    ball.rotation.order = 'YXZ';
    socket.add(ball);
    ball.add(new THREE.Mesh(ballGeo, detail));
    const pupil = new THREE.Mesh(pupilGeo, detail);
    pupil.name = 'pupil';
    ball.add(pupil);
    const glint = new THREE.Mesh(glintGeo, detail);
    glint.position.copy(glintDir).multiplyScalar(EYE_R * 0.955);
    glint.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), glintDir);
    glint.scale.set(1, 1, 0.35);
    ball.add(glint);
    const upPivot = new THREE.Group();
    const loPivot = new THREE.Group();
    socket.add(upPivot, loPivot);
    const upLid = new THREE.Mesh(upLidGeo, body);
    const loLid = new THREE.Mesh(loLidGeo, body);
    upPivot.add(upLid);
    loPivot.add(loLid);
    const level = new THREE.Group(); // undoes the socket's tilt: head space
    level.quaternion.copy(socket.quaternion).invert();
    socket.add(level);
    const home = new THREE.Vector3(side * EYE_X, topY(side * EYE_X, EYE_Z) + EYE_UP, EYE_Z);
    level.add(new THREE.Mesh(kit.geo(socketGeo(home, topY)), body));
    place(socket, home.x, home.y, home.z);
    return {
      socket,
      set(yaw, pitch, upper, lower, sad) {
        ball.rotation.y = yaw;
        ball.rotation.x = -pitch;
        upLid.rotation.x = -Math.PI / 2 + Math.min(1, Math.max(0, upper)) * Math.PI;
        loLid.rotation.x = Math.PI / 2 - Math.min(1, Math.max(0, lower)) * Math.PI * 0.98;
        upPivot.rotation.z = -side * sad;
        loPivot.rotation.z = side * sad * 0.3;
      },
    };
  });
  // Nostrils: two dots on top of the snout.
  const nostrilGeo = kit.geo(paint(new THREE.SphereGeometry(0.02, 4, 2), INK.pupil));
  for (const sx of [1, -1]) {
    const h = surf(...domeAt(sx * 0.07, 0.36), new THREE.Vector3());
    const nostril = new THREE.Mesh(nostrilGeo, detail);
    nostril.scale.set(1, 0.5, 1);
    place(nostril, h.x, h.y, h.z);
  }
  // Mouth: a wide smile arc wrapped round the snout, an open mouth (a dark half-disc) with a long
  // pink tongue that flicks out.
  const mouthG = new THREE.Group();
  mouthG.rotation.x = -0.35;
  place(mouthG, 0, 0.33, frontZ(0.33) + 0.004);
  const smile = kit.mesh(
    wrap(paint(new THREE.TorusGeometry(0.24, 0.02, 3, 12, Math.PI), INK.mouth), 1.0),
    detail,
    mouthG,
  );
  const mouth = kit.mesh(
    wrap(paint(new THREE.CircleGeometry(0.17, 14, Math.PI, Math.PI), INK.mouth), 1.0),
    detail,
    mouthG,
  );
  mouth.position.z = 0.002;
  const tongueG = new THREE.Group();
  tongueG.position.set(0, -0.04, 0.008);
  tongueG.rotation.x = 0.3; // straight out forward
  mouthG.add(tongueG);
  const tongue = kit.mesh(
    paint(
      new THREE.CylinderGeometry(0.035, 0.04, 1, 6, 1, true)
        .translate(0, 0.5, 0)
        .rotateX(Math.PI / 2),
      INK.tongue,
    ),
    detail,
    tongueG,
  );
  const tip = kit.mesh(paint(new THREE.SphereGeometry(0.06, 6, 3), INK.tongue), detail, tongueG);
  tip.scale.set(1.2, 0.7, 1);
  // The throat pouch: a light bubble under the chin.
  const pouch = place(
    kit.mesh(new THREE.SphereGeometry(POUCH_R, 13, 8), accent, face),
    0,
    0.15,
    frontZ(0.15) - 0.075,
  );

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // A big croak (the pouch balloons twice), a crouch and a high leap, legs kicked out, a
      // tongue flick at the top, and a squashy landing.
      o.pouch = keys(t, CRIT_POUCH);
      o.squash = keys(t, CRIT_SQUASH);
      o.lift = Math.sin(Math.PI * span(t, 0.41, 0.76)) * 1.0;
      o.kick = keys(t, CRIT_KICK);
      o.reach = 0.6 * bump(t, 0.6, 0.82);
      o.pitch = -0.3 * bump(t, 0.37, 0.56) + 0.12 * bump(t, 0.6, 0.8);
      o.tongue = keys(t, CRIT_TONGUE);
      o.open = o.tongue;
      const joy = plateau(t, 0.06, 0.95, 0.08);
      o.headPitch = -0.15 * joy;
      o.upper = lerp(0.22, 0, joy);
      o.lower = lerp(0.1, 0.45, joy);
      o.gazePitch = lerp(-0.3, 0.3, joy);
      o.smile = lerp(0.7, 1, joy);
      o.eyeUp = 0.04 * joy;
    } else if (reaction === 'fumble') {
      // A pancake: it flattens out, eyes sinking and drooping, the pouch sagging; a sad wobble.
      const flat = smooth(span(t, 0.04, 0.5));
      o.squash = 0.55 * flat + 0.03 * wobble(span(t, 0.5, 1), 1.5, 3) * flat;
      o.eyeUp = -0.04 * flat;
      o.pouch = -0.9 * flat;
      o.reach = -0.4 * flat; // the front feet splay out back
      o.headPitch = 0.12 * flat;
      o.upper = lerp(0.22, 0.62, flat);
      o.lower = lerp(0.1, 0.02, flat);
      o.sad = 0.5 * flat;
      o.gazePitch = lerp(-0.3, -0.8, flat);
      o.smile = lerp(0.7, -1, smooth(span(t, 0.02, 0.3)));
    } else if (reaction === 'mixed') {
      // One eye squints and the head shrugs to one side and back, the gaze darting.
      const tilt = outBack(span(t, 0.04, 0.3), 2.2) * (1 - smooth(span(t, 0.82, 1)));
      o.headRoll = 0.38 * tilt + 0.06 * Math.sin(t * TAU * 2.5) * tilt;
      o.headYaw = -0.12 * tilt;
      o.roll = 0.07 * tilt;
      o.reach = 0.25 * tilt; // a little shrug of the front feet
      o.upperR = 0.45 * tilt;
      o.sadL = 0.45 * tilt;
      o.upper = lerp(0.22, 0.06, tilt);
      o.gazeYaw = 0.45 * keys(t, MIXED_GAZE);
      o.smile = lerp(0.7, 0, tilt);
    } else {
      // plain: a contented croak, eyes smugly half shut.
      o.pouch = keys(t, PLAIN_POUCH);
      o.squash = keys(t, PLAIN_SQUASH);
      o.headPitch = -0.1 * bump(t, 0.15, 0.7);
      const content = plateau(t, 0.08, 0.92, 0.12);
      o.upper = lerp(0.22, 0.5, content);
      o.lower = lerp(0.1, 0.34, content);
      o.smile = lerp(0.7, 1, content);
    }
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  function idle(o, ms, amount = 1) {
    // The throat pulses (a quick swell, a slow ebb), the body breathes, slow blinks.
    const th = 0.5 + 0.5 * Math.sin((ms / 1100) * TAU);
    o.pouch += 0.28 * th * th * amount;
    o.squash += 0.02 * Math.sin((ms / 2200) * TAU) * amount;
    o.headPitch += 0.02 * Math.sin((ms / 2200) * TAU + 1) * amount;
    const b = slowBlink(ms);
    o.upper += (1 - o.upper) * b;
    o.lower += (0.5 - o.lower) * b;
  }

  function pose(phase, t, reaction, look) {
    const ms = look?.now ?? nowMs();
    const yaw = look?.yaw || 0;
    if (phase === 'react') react(p, reaction, t, ms);
    else if (phase === 'exit') {
      // A hop away: crouch, spring with the legs kicked out, land.
      react(end, reaction, 1);
      PK.reset(tmp);
      tmp.squash = 0.25 * bump(t, 0, 0.22) - 0.15 * bump(t, 0.2, 0.8) + 0.25 * bump(t, 0.82, 1);
      tmp.kick = bump(t, 0.18, 0.78);
      tmp.upper = STAND_UPPER;
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      PK.reset(p);
      p.squash = -0.15 * bump(t, 0.05, 0.72) + 0.3 * bump(t, 0.7, 1);
      p.kick = bump(t, 0.05, 0.7);
      p.reach = 0.5 * bump(t, 0.5, 0.85);
      p.upper = 0.05;
      p.lower = 0.05;
      p.smile = 1;
    } else if (phase === 'move') {
      // A dodge: hop, hop. A crouch and a spring, legs kicked out behind and folding back for the
      // landing, front feet reaching for the ground; a smug grin and bright eyes. It starts and
      // ends on the standing pose (exit at t 1).
      PK.reset(p);
      p.upper = STAND_UPPER;
      const joy = plateau(t, 0.03, 0.97, 0.1);
      p.squash = keys(t, MOVE_SQUASH);
      p.kick = keys(t, MOVE_KICK);
      p.pitch = keys(t, MOVE_PITCH);
      p.reach = 0.6 * bump(t, 0.24, 0.44) + 0.6 * bump(t, 0.74, 0.94);
      p.lift =
        0.6 * Math.sin(Math.PI * span(t, 0.1, 0.4)) + 0.5 * Math.sin(Math.PI * span(t, 0.6, 0.9));
      p.upper = lerp(STAND_UPPER, 0.02, joy);
      p.lower = lerp(0.1, 0.3, joy);
      p.gazePitch = lerp(-0.3, -0.05, joy);
      p.smile = lerp(0.7, 1, joy);
    } else if (phase === 'pet') {
      // Petted: a happy wiggle, eyes squeezed shut, a smug grin and a pleased puff of the throat
      // (look.calm, reduced motion: a smaller wiggle). From and back to the standing pose.
      PK.reset(p);
      p.upper = STAND_UPPER;
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.roll = 0.14 * k * Math.sin(t * TAU * 2) * on;
      p.headRoll = 0.18 * k * Math.sin(t * TAU * 2 - 0.8) * on;
      p.squash = 0.08 * k * Math.sin(t * TAU * 3) * on;
      p.pouch = 0.6 * on;
      p.upper = lerp(STAND_UPPER, 0.72, on);
      p.lower = lerp(0.1, 0.45, on);
      p.smile = lerp(0.7, 1, on);
    } else if (phase === 'huff') {
      // Huffed: the pouch balloons up, then it blows out, frowning, eyes narrowed and away.
      PK.reset(p);
      p.upper = STAND_UPPER;
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.pouch = 1.1 * k * bump(t, 0.05, 0.55);
      p.squash = (-0.12 * bump(t, 0.05, 0.5) + 0.12 * bump(t, 0.45, 0.75)) * k;
      p.headYaw = 0.4 * mad;
      p.upper = lerp(STAND_UPPER, 0.55, mad);
      p.smile = lerp(0.7, -0.6, mad);
      p.gazeYaw = 0.6 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop back off the heat, then it pants, mouth open and tongue
      // lolling, fanning itself with its front feet, eyes squinting (look.calm: gentler).
      PK.reset(p);
      p.upper = STAND_UPPER;
      const k = look?.calm ? 0.4 : 1;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.3 * k * bump(t, 0.02, 0.28);
      p.kick = 0.8 * k * bump(t, 0.02, 0.28);
      p.reach = on * (0.5 + 0.4 * k * Math.sin(t * TAU * 5));
      p.squash = 0.05 * k * Math.sin(t * TAU * 6) * on;
      p.pouch = on * (0.3 + 0.3 * Math.sin(t * TAU * 6));
      p.upper = lerp(STAND_UPPER, 0.6, on);
      p.lower = lerp(0.1, 0.3, on);
      p.smile = lerp(0.7, -0.3, on);
      p.open = on * (0.65 + 0.3 * Math.sin(t * TAU * 6));
      p.tongue = 0.25 * on;
    } else if (phase === 'shiver') {
      // Frozen (frost): it hunches low, eyes pulled in and squeezed, shivering side to side
      // (look.calm: a slower, smaller shiver).
      PK.reset(p);
      p.upper = STAND_UPPER;
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.squash = 0.14 * on;
      p.eyeUp = -0.04 * on;
      p.roll = 0.08 * k * Math.sin(t * TAU * f) * on;
      p.headRoll = 0.05 * k * Math.sin(t * TAU * f + 1) * on;
      p.pouch = -0.3 * on;
      p.upper = lerp(STAND_UPPER, 0.55, on);
      p.lower = lerp(0.1, 0.3, on);
      p.smile = lerp(0.7, -0.5, on);
    } else if (phase === 'bristle') {
      // Zapped (storm): it shoots up tall on its feet and trembles, eyes popping, pouch puffed
      // (look.calm: no tremble).
      PK.reset(p);
      p.upper = STAND_UPPER;
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.25 * on + 0.05 * k * Math.sin(t * TAU * 10) * on;
      p.eyeUp = 0.06 * on;
      p.pouch = 0.5 * on;
      p.upper = lerp(STAND_UPPER, 0, on);
      p.lower = lerp(0.1, 0, on);
      p.gazePitch = lerp(-0.3, 0, on);
      p.smile = lerp(0.7, 0, on);
      p.open = 0.55 * on;
    } else if (phase === 'startle') {
      // Startled (any other element): a crouch, a jump straight up with its legs kicked out, eyes
      // wide, and a squashy landing (look.calm: a smaller jump).
      PK.reset(p);
      p.upper = STAND_UPPER;
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      p.lift = 0.7 * k * Math.sin(Math.PI * span(t, 0.1, 0.5));
      p.kick = k * bump(t, 0.1, 0.5);
      p.squash =
        0.22 * bump(t, 0, 0.12) - 0.2 * k * bump(t, 0.1, 0.5) + 0.22 * k * bump(t, 0.48, 0.66);
      p.eyeUp = 0.05 * wide;
      p.upper = lerp(STAND_UPPER, 0, wide);
      p.lower = lerp(0.1, 0, wide);
      p.gazePitch = lerp(-0.3, 0.1, wide);
      p.smile = lerp(0.7, 0, wide);
      p.open = 0.5 * wide;
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two happy hops, legs kicking, a croak on each landing,
      // a big grin and smiling eyes looking up (look.calm: one small hop). From and back to the
      // standing pose.
      PK.reset(p);
      p.upper = STAND_UPPER;
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const two = calm ? 0 : 1;
      const air1 = bump(t, 0.12, 0.42);
      const air2 = two * bump(t, 0.52, 0.82);
      p.lift =
        0.45 *
        k *
        (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash =
        k * (0.18 * bump(t, 0.02, 0.14) - 0.15 * air1 + 0.18 * bump(t, 0.42, 0.54)) +
        two * (0.15 * bump(t, 0.82, 0.95) - 0.15 * air2);
      p.kick = k * (air1 + air2);
      p.pouch = 0.8 * (bump(t, 0.4, 0.58) + two * bump(t, 0.8, 0.98));
      p.upper = lerp(STAND_UPPER, 0, joy);
      p.lower = lerp(p.lower, 0.45, joy);
      p.gazePitch = lerp(p.gazePitch, 0.3, joy);
      p.smile = lerp(p.smile, 1, joy);
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: chest out, chin up, throat puffed, a smug grin under
      // half-lidded eyes. Sulk: flattened low, eyes sunk and looking down, pouch sagging, frowning.
      PK.reset(end);
      end.upper = STAND_UPPER;
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.pitch = -0.12;
        tmp.squash = -0.08;
        tmp.headPitch = -0.15;
        tmp.pouch = 0.55;
        tmp.smile = 1;
        tmp.upper = 0.45;
        tmp.lower = 0.3;
        tmp.gazePitch = 0.1;
      } else {
        tmp.squash = 0.35;
        tmp.headPitch = 0.12;
        tmp.eyeUp = -0.05;
        tmp.pouch = -0.6;
        tmp.smile = -0.8;
        tmp.upper = 0.6;
        tmp.lower = 0.02;
        tmp.sad = 0.5;
        tmp.gazePitch = -0.8;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.pouch += 0.4 * bump(t, 0.2, 0.8); // a croak on the way
    } else if (phase === 'throw') {
      // It rears back, then lunges with its front feet and flicks the die off with its tongue.
      PK.reset(p);
      p.pitch = keys(t, THROW_PITCH);
      p.squash = keys(t, THROW_SQUASH);
      p.reach = keys(t, THROW_REACH);
      p.tongue = keys(t, THROW_TONGUE);
      p.open = p.tongue;
      p.upper = 0.12;
      p.gazePitch = -0.15;
    } else {
      PK.reset(p);
      idle(p, ms);
    }
    if (yaw) {
      p.gazeYaw += yaw * 0.9;
      p.headYaw += yaw * 0.3;
      p.yaw += yaw * 0.3;
    }
    apply(p);
  }

  function apply(o) {
    // Tipping pivots on an edge (front, back or side), not through the floor.
    rig.position.y = o.lift + 0.5 * Math.abs(Math.sin(o.pitch)) + 0.7 * Math.abs(Math.sin(o.roll));
    // + 0 turns a -0 (a negative weight times a zero bump) into 0: the standing pose compares equal.
    rig.rotation.set(o.pitch + 0, o.spin + o.yaw, o.roll + 0);
    const sy = Math.max(0.3, 1 - o.squash);
    const sxz = 1 / Math.sqrt(sy);
    squash.scale.set(sxz, sy, sxz);
    face.position.set(PIVOT.x, PIVOT.y * sy, PIVOT.z * sxz);
    face.rotation.set(o.headPitch + 0, o.headYaw + 0, o.headRoll + 0);
    for (let i = 0; i < homes.length; i += 4)
      homes[i].position.set(homes[i + 1] * sxz, homes[i + 2] * sy, homes[i + 3] * sxz);
    // The face sits on the squashed skin: the eyes ride a little higher than the squash puts them.
    for (const e of eyes) e.socket.position.y += (1 - sy) * 0.2 + o.eyeUp;
    // Hind legs: thigh and foot swing out behind on a kick.
    for (let i = 0; i < hinds.length; i += 3) {
      const thigh = hinds[i];
      const foot = hinds[i + 1];
      const sx = hinds[i + 2];
      const k = o.kick;
      thigh.position.set(0, 0.03 * k, -0.06 * k);
      // the foot swings out and round until its toes point back: stretched out behind
      foot.position.set(sx * lerp(0.14, 0.16, k), lerp(-0.13, -0.1, k), lerp(0.17, -0.34, k));
      foot.rotation.y = sx * 2.6 * k;
    }
    for (const a of arms) a.rotation.x = -1.1 * o.reach;
    // The pouch swells under the chin (a modest croak bubble, wider than tall, tucked in so it
    // never covers the face) or sags (longer, lower).
    const pb = Math.max(0, o.pouch);
    const ps = Math.min(0, o.pouch);
    const g = 1 + 0.42 * pb;
    const psy = g * 0.78 * (1 - 0.3 * ps);
    pouch.scale.set(g * 1.08 * (1 + 0.1 * ps), psy, g * 0.9 * (1 + 0.25 * ps));
    pouch.position.z += 0.025 * pb;
    pouch.position.y += -0.03 * pb + 0.05 * ps;
    // never through the floor (face space is the rig's, offset by the pivot)
    const drop = pouch.position.z * Math.sin(o.headPitch); // a nod lowers it
    pouch.position.y = Math.max(pouch.position.y, POUCH_R * psy + 0.02 + drop - face.position.y);
    const sm = o.smile;
    smile.visible = o.open < 0.5;
    mouth.visible = !smile.visible;
    smile.position.y = sm < 0 ? -0.04 : 0.03;
    // Torus arc 0..PI is the upper half: flip it for a grin, scale y for a flat line.
    smile.rotation.z = sm >= 0 ? Math.PI : 0;
    smile.scale.set(1 + 0.15 * Math.abs(sm), Math.max(0.08, 0.45 * Math.abs(sm)), 1); // wide and shallow
    mouth.scale.set(1.25, 0.35 + 0.8 * o.open, 1);
    const tl = 0.95 * o.tongue;
    tongueG.visible = tl > 0.01;
    tongue.scale.set(1, 1, Math.max(0.01, tl));
    tip.position.z = tl;
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

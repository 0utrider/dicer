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
  detailMaterial,
  mergeFlat,
} from './parts.js';

/**
 * The robot: a little clockwork wind-up robot. A boxy, round-edged brass body with rivets and two
 * exposed gears on its chest, a short steel neck under a big wide round-cornered head tilted back
 * so its face looks up at the top-down camera: two round glass lens eyes in steel bezels with
 * glowing pale-blue irises, a grille mouth, steel ear bolts and a little antenna with a red bulb.
 * Stubby arms with steel clamp hands, short legs on flat feet, and a big steel wind-up key in its
 * back that turns. From above: the wide head with its two lenses looking up at you, the riveted
 * shoulders and the key's bow behind. It moves in little steps, its head snapping between angles.
 * Crit: it spins its key fast, whirs, pumps its arms and jumps; fumble: it winds down (the key
 * slows and stops), slumps forward, its eyes dim, and one last twitch; mixed: a head tilt and a
 * "processing" double blink with flickering lenses; plain: a cheerful nod while the key ticks.
 * Throw: a stiff overarm toss.
 */

const HEIGHT = 1.5;
const FOOT = 0.82; // top-down radius in scene units (head and ear bolts), the key excluded (measured: 0.815)
const TILT = 0.8; // the head's built-in tilt back (rad): its face up toward the camera
const HIP = 0.2; // leg pivots, and the body's lean pivot (design units)
const EYE_R = 0.155;
const PUPIL = 0.95; // the glowing iris's rest size (x the pupil cap)
const ANT_X = 0.62; // the antenna's lean forward from the head's top (it stands about upright)

const STEEL = new THREE.Color('#b9bfc8');
const STEEL_DARK = new THREE.Color('#6e747d');
const GLASS = new THREE.Color('#16212e');
const GLOW = new THREE.Color('#9fe9ff');
const IRIS_CORE = new THREE.Color('#2a5d78');
const SOOT = new THREE.Color('#231d1a');
const BULB = new THREE.Color('#ff4f3f');

const REST = {
  lift: 0,
  squash: 0, // > 0 squashes, < 0 stretches
  pitch: 0, // + leans forward (about the hips)
  roll: 0,
  yaw: 0,
  headPitch: 0, // + nods down
  headRoll: 0,
  headYaw: 0,
  fwdL: 0, // arm raise forward (rad), L is the +X arm
  fwdR: 0,
  outL: 0.5, // arm out to the side
  outR: 0.5,
  clampL: 0.2, // clamp hand open 0..1
  clampR: 0.2,
  stepL: 0, // foot lifted 0..1
  stepR: 0,
  key: 0, // the wind-up key's turn (rad; it looks the same every half turn)
  ant: 0, // antenna sway (side)
  antF: 0, // antenna nod (forward)
  glow: 1, // lens glow: the iris size (0 dark .. 1.3 wide)
  upper: 0.12, // shutter lids
  lower: 0.04,
  sad: 0,
  gazeYaw: 0,
  gazePitch: 0,
  mouth: 0, // grille opens (taller)
  heat: 0, // overheating glow
};
const PK = poseKit(REST);

// Keyframes, hoisted so a pose allocates nothing.
const CRIT_SQUASH = [0, 0, 0.14, 0.16, 0.22, -0.1, 0.46, -0.04, 0.54, 0.14, 0.64, 0];
const THROW_FWD = [0, 0, 0.28, 3.3, 0.42, 3.45, 0.56, 1.25, 0.72, 1.1, 1, 0];
const THROW_OUT = [0, 0.5, 0.28, 0.15, 0.56, 0.15, 1, 0.5];
const THROW_PITCH = [0, 0, 0.28, -0.1, 0.5, 0.16, 0.75, 0.05, 1, 0];
const THROW_CLAMP = [0, 0.2, 0.42, 0.2, 0.52, 1, 0.8, 0.8, 1, 0.2];
const MIX_LOOK = [0.25, 0, 0.32, -1, 0.5, -1, 0.56, 1, 0.76, 1, 0.84, 0];
// The idle head scan: it snaps between these yaws in turn.
const SCAN = [0, 1, 1, 0, -1, -1, 0, 0];

/** v snapped most of the way to a grid of step s: stepped, slightly jerky motion. */
const quant = (v, s) => v + (Math.round(v / s) * s - v) * 0.7;
/** An angle less a whole number of half turns (the key and gears look the same every half turn). */
const wrapK = (a) => a - Math.round(a / Math.PI) * Math.PI;
/** The idle key: a tick of a twelfth of a turn every 0.6 s, each a quick snap. */
const tickKey = (ms) => {
  const k = ms / 600;
  const n = Math.floor(k);
  return ((n % 12) + smooth(Math.min(1, (k - n) / 0.22))) * (TAU / 12);
};

/**
 * A box with rounded edges and corners: a 3x3x3-segment box whose outer segments are squeezed into
 * the rounding band, every vertex then pushed onto the rounded surface (normals from the rounding).
 */
function roundBox(w, h, d, r, ys = 3) {
  const g = new THREE.BoxGeometry(w, h, d, 3, ys, 3);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const half = [w / 2, h / 2, d / 2];
  const v = [0, 0, 0];
  const c = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    v[0] = p.getX(i);
    v[1] = p.getY(i);
    v[2] = p.getZ(i);
    let l = 0;
    for (let a = 0; a < 3; a++) {
      const t = v[a] / half[a];
      const at = Math.abs(t);
      const inner = half[a] - r;
      const m = a === 1 && ys === 1 ? at * half[a] : at <= 1 / 3 + 1e-6 ? at * 3 * inner : inner + (at - 1 / 3) * 1.5 * r;
      v[a] = Math.sign(t) * m;
      c[a] = Math.max(-inner, Math.min(inner, v[a]));
      l += (v[a] - c[a]) ** 2;
    }
    l = Math.sqrt(l) || 1;
    const nx = (v[0] - c[0]) / l;
    const ny = (v[1] - c[1]) / l;
    const nz = (v[2] - c[2]) / l;
    p.setXYZ(i, c[0] + nx * r, c[1] + ny * r, c[2] + nz * r);
    n.setXYZ(i, nx, ny, nz);
  }
  return g;
}

/** A gear facing +Z: a disc with `teeth` square-ish teeth round its rim and a hub. */
function gearGeo(r, teeth, thick) {
  const segs = teeth * 3;
  const g = new THREE.CylinderGeometry(r, r, thick, segs, 1).rotateX(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const rr = Math.hypot(x, y);
    if (rr < r * 0.5) continue;
    const k = ((Math.round((Math.atan2(y, x) / TAU) * segs) % segs) + segs) % segs;
    const s = k % 3 === 2 ? 0.78 : 1;
    p.setXY(i, x * s, y * s);
  }
  g.computeVertexNormals();
  const hub = new THREE.CylinderGeometry(r * 0.32, r * 0.32, thick * 1.8, 6, 1).rotateX(Math.PI / 2);
  const out = mergeFlat([g, hub]);
  g.dispose();
  hub.dispose();
  return out;
}

export function robot(color) {
  const { body: bodyColor, accent: accentColor } = palette(color);
  const kit = createKit();
  const body = kit.mat(
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.42, metalness: 0.3 }),
  );
  const accent = kit.mat(
    new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.36, metalness: 0.3 }),
  );
  const detail = detailMaterial(kit);

  const root = new THREE.Group();
  root.name = 'robot';
  const scaler = new THREE.Group();
  root.add(scaler);
  // base: the lift and the turn (the legs ride on it, never pitched through the floor)
  const base = new THREE.Group();
  scaler.add(base);
  // rig: the lean, about the hips
  const rig = new THREE.Group();
  rig.position.y = HIP;
  base.add(rig);
  const squash = new THREE.Group();
  squash.position.y = -HIP; // squashes from the floor
  rig.add(squash);

  // Legs: short brass legs on flat feet, pivots at the hips, stepping by lifting.
  const legGeo = kit.geo(new THREE.CylinderGeometry(0.05, 0.055, 0.16, 8, 1, true).translate(0, -0.08, 0));
  const footGeo = kit.geo(roundBox(0.19, 0.07, 0.28, 0.03, 1));
  const legs = [1, -1].map((side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.16, HIP, 0.0);
    base.add(g);
    g.add(new THREE.Mesh(legGeo, body));
    const f = new THREE.Mesh(footGeo, accent);
    f.position.set(side * 0.01, -HIP + 0.035, 0.05);
    g.add(f);
    return g;
  });

  // The body: a round-edged brass box, rivets at its corners, a dark window on its chest with two
  // brass gears turning in it.
  kit.mesh(roundBox(0.64, 0.42, 0.46, 0.09), body, squash, 0, 0.39, 0);
  {
    const rivets = [];
    for (const sx of [1, -1])
      for (const [y, z] of [
        [0.57, 0.17],
        [0.57, -0.17],
        [0.22, 0.2],
      ]) {
        const s = new THREE.SphereGeometry(0.022, 5, 3);
        s.translate(sx * 0.27, y, z + (y > 0.5 ? 0 : 0.03));
        rivets.push(s);
      }
    kit.mesh(mergeFlat(rivets), accent, squash);
    for (const s of rivets) s.dispose();
  }
  const plateGeo = paint(new THREE.BoxGeometry(0.36, 0.24, 0.02), SOOT);
  kit.mesh(plateGeo, detail, squash, 0, 0.4, 0.228);
  const gearA = kit.mesh(gearGeo(0.085, 8, 0.03), accent, squash, 0.065, 0.375, 0.245);
  const gearB = kit.mesh(gearGeo(0.058, 6, 0.03), accent, squash, -0.09, 0.45, 0.245);

  // The wind-up key in its back: a steel shaft out of a brass collar and a two-lobed bow, turning
  // about the shaft (the bow lies flat at rest, seen whole from above).
  kit.mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.04, 10, 1).rotateX(Math.PI / 2), accent, squash, 0, 0.42, -0.24);
  const key = new THREE.Group();
  key.position.set(0, 0.42, -0.25);
  key.userData.noFoot = true;
  squash.add(key);
  kit.mesh(paint(new THREE.CylinderGeometry(0.024, 0.024, 0.24, 6, 1).rotateX(Math.PI / 2).translate(0, 0, -0.12), STEEL), detail, key);
  {
    const lobes = [];
    for (const sx of [1, -1]) {
      const t = new THREE.TorusGeometry(0.08, 0.026, 3, 10);
      t.rotateX(Math.PI / 2);
      t.scale(1.15, 1, 0.85);
      t.translate(sx * 0.1, 0, -0.27);
      lobes.push(paint(t, STEEL));
    }
    const nub = paint(new THREE.BoxGeometry(0.06, 0.045, 0.06).translate(0, 0, -0.25), STEEL_DARK);
    lobes.push(nub);
    kit.mesh(mergeFlat(lobes), detail, key);
    for (const g of lobes) g.dispose();
  }

  // Arms: a brass shoulder ball, a stubby arm and a steel clamp hand, pivots at the shoulders.
  const shGeo = kit.geo(new THREE.SphereGeometry(0.075, 6, 4));
  const armGeo = kit.geo(new THREE.CylinderGeometry(0.045, 0.05, 0.2, 8, 1, true).translate(0, -0.11, 0));
  const wristGeo = kit.geo(paint(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 6, 1), STEEL_DARK));
  const fingerGeo = kit.geo(
    paint(
      mergeFlat([
        new THREE.BoxGeometry(0.028, 0.08, 0.06).translate(0, -0.04, 0),
        new THREE.BoxGeometry(0.03, 0.028, 0.06).translate(-0.012, -0.08, 0),
      ]),
      STEEL,
    ),
  );
  const arms = [1, -1].map((side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.35, 0.53, 0.0);
    squash.add(g);
    g.add(new THREE.Mesh(shGeo, accent));
    g.add(new THREE.Mesh(armGeo, body));
    const w = new THREE.Mesh(wristGeo, detail);
    w.position.y = -0.23;
    g.add(w);
    const fingers = [1, -1].map((s) => {
      const f = new THREE.Group();
      f.position.set(s * 0.032, -0.25, 0);
      g.add(f);
      const m = new THREE.Mesh(fingerGeo, detail);
      m.scale.x = s; // the tips hook inward
      f.add(m);
      return f;
    });
    return { side, g, fingers };
  });

  // Neck and head: a short steel neck, the head a big wide round-cornered box tilted back so its
  // face looks up (TILT). The pivot sits at the neck, so a nod swings the face round.
  kit.mesh(paint(new THREE.CylinderGeometry(0.075, 0.085, 0.12, 10, 1, true), STEEL_DARK), detail, squash, 0, 0.62, 0);
  const neck = new THREE.Group();
  neck.rotation.order = 'YXZ';
  neck.position.set(0, 0.6, 0);
  squash.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.25, 0.04);
  head.rotation.x = -TILT;
  neck.add(head);
  // the box's tilt baked into its geometry and the mesh turned back, so its bounding box stays tight
  const skull = kit.mesh(roundBox(1.18, 0.48, 0.5, 0.13).rotateX(-TILT), body, head);
  skull.rotation.x = TILT;
  // ear bolts: steel discs on the sides with a brass cap
  const earGeo = kit.geo(paint(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10, 1).rotateZ(Math.PI / 2), STEEL));
  const capGeo = kit.geo(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 8, 1).rotateZ(Math.PI / 2));
  for (const sx of [1, -1]) {
    kit.mesh(earGeo, detail, head, sx * 0.605, 0.0, -0.02);
    kit.mesh(capGeo, accent, head, sx * 0.64, 0.0, -0.02);
  }
  // the grille mouth: a dark slot with steel bars
  const grilleParts = [paint(new THREE.BoxGeometry(0.26, 0.075, 0.02), SOOT)];
  for (const bx of [-0.075, -0.025, 0.025, 0.075])
    grilleParts.push(paint(new THREE.BoxGeometry(0.014, 0.075, 0.03).translate(bx, 0, 0.004), STEEL));
  const grille = kit.mesh(mergeFlat(grilleParts), detail, head, 0, -0.165, 0.248);
  for (const g of grilleParts) g.dispose();
  // the lens eyes: a dark glass ball, a glowing iris (the pupil cap) with a dark core, a glint, a
  // dark rim and a steel bezel; brass shutter lids
  const bezelGeo = kit.geo(paint(new THREE.TorusGeometry(EYE_R * 1.1, 0.026, 3, 14), STEEL));
  const coreGeo = kit.geo(paint(new THREE.SphereGeometry(EYE_R * 1.03, 8, 1, 0, TAU, 0, 0.2), IRIS_CORE));
  const eyes = [1, -1].map((side) => {
    const e = createEye(kit, { r: EYE_R, side, detail, lid: body });
    e.socket.position.set(side * 0.27, 0.045, 0.16);
    head.add(e.socket);
    const bez = new THREE.Mesh(bezelGeo, detail);
    bez.position.z = EYE_R * 0.55;
    e.socket.add(bez);
    paint(e.ball.children[0].geometry, GLASS);
    const pupil = e.ball.children.find((m) => m.name === 'pupil');
    paint(pupil.geometry, GLOW);
    const core = new THREE.Mesh(coreGeo, detail);
    core.rotation.x = Math.PI / 2;
    e.ball.add(core);
    return { e, pupil };
  });
  // the antenna: a steel stalk with a red bulb, on a springy pivot on the head's top
  const antenna = new THREE.Group();
  antenna.position.set(0, 0.23, -0.06);
  head.add(antenna);
  kit.mesh(paint(new THREE.CylinderGeometry(0.014, 0.018, 0.14, 5, 1, true).translate(0, 0.07, 0), STEEL), detail, antenna);
  kit.mesh(paint(new THREE.SphereGeometry(0.04, 6, 4), BULB), detail, antenna, 0, 0.16, 0);

  const p = PK.make();
  const end = PK.make();
  const tmp = PK.make();

  function react(o, reaction, t, ms) {
    PK.reset(o);
    if (reaction === 'crit') {
      // Its key spins up fast (five turns), a whir (a rattle), arms pumping overhead, a little jump.
      o.key = 5 * TAU * smooth(span(t, 0.02, 0.9));
      o.squash = keys(t, CRIT_SQUASH);
      o.lift = 0.22 * Math.sin(Math.PI * span(t, 0.22, 0.5));
      const joy = plateau(t, 0.06, 0.95, 0.1);
      const pump = Math.sin(t * TAU * 5) * plateau(t, 0.2, 0.92, 0.08);
      o.fwdL = 2.5 * joy + 0.45 * pump;
      o.fwdR = 2.5 * joy - 0.45 * pump;
      o.outL = lerp(0.5, 0.3, joy);
      o.outR = lerp(0.5, 0.3, joy);
      o.clampL = o.clampR = lerp(0.2, 0.9, joy);
      o.roll = 0.025 * Math.sin(t * TAU * 22) * joy;
      o.headPitch = -0.15 * joy;
      o.glow = lerp(1, 1.3, joy);
      o.upper = lerp(0.12, 0, joy);
      o.lower = lerp(0.04, 0.3, joy);
      o.gazePitch = 0.2 * joy;
      o.mouth = joy;
      o.ant = 0.35 * Math.sin(t * TAU * 6) * joy;
      o.antF = -0.2 * joy;
    } else if (reaction === 'fumble') {
      // It winds down: the key slows and stops, then it slumps forward, its eyes dim, its arms
      // hang; one last twitch.
      const s = span(t, 0, 0.55);
      o.key = TAU * (1 - (1 - s) * (1 - s));
      const dn = smooth(span(t, 0.4, 0.7));
      o.roll = 0.02 * Math.sin(t * TAU * 16) * (1 - s);
      o.pitch = 0.2 * dn;
      o.squash = 0.07 * dn;
      o.headPitch = 0.45 * dn;
      o.headRoll = -0.14 * dn;
      o.fwdL = o.fwdR = -0.15 * dn;
      o.outL = o.outR = lerp(0.5, 0.15, dn);
      o.clampL = o.clampR = lerp(0.2, 0.55, dn);
      o.glow = lerp(1, 0.3, dn);
      o.upper = lerp(0.12, 0.5, dn);
      o.sad = 0.3 * dn;
      o.gazePitch = -0.4 * dn;
      o.antF = 0.5 * dn;
      o.ant = -0.15 * dn;
      const tw = bump(t, 0.8, 0.85);
      o.headRoll += 0.16 * tw;
      o.fwdR += 0.6 * tw;
      o.glow += 0.7 * tw;
      o.ant += 0.4 * tw;
    } else if (reaction === 'mixed') {
      // Processing: the head tilts (in steps), a quick double blink, the lenses flicker, the eyes
      // dart from one die to the other, the antenna twitches.
      const tilt = outBack(span(t, 0.04, 0.3), 2.2) * (1 - smooth(span(t, 0.85, 1)));
      o.headRoll = 0.36 * tilt;
      o.headPitch = -0.06 * tilt;
      const shut = bump(t, 0.34, 0.42) + bump(t, 0.47, 0.55);
      o.upper += (1 - o.upper) * shut;
      o.lower += (0.6 - o.lower) * shut;
      o.glow = 1 + 0.25 * Math.sin(t * TAU * 14) * plateau(t, 0.3, 0.75, 0.05);
      o.gazeYaw = 0.35 * keys(t, MIX_LOOK);
      o.ant = 0.25 * Math.sin(t * TAU * 9) * plateau(t, 0.25, 0.8, 0.05);
      o.clampR = 0.2 + 0.5 * Math.abs(Math.sin(t * TAU * 4)) * plateau(t, 0.3, 0.8, 0.05);
      o.fwdR = 0.4 * tilt;
    } else {
      // A cheerful nod (two), happy eyes, the key ticking round half a turn.
      const content = plateau(t, 0.08, 0.92, 0.15);
      o.headPitch = 0.28 * bump(t, 0.14, 0.4) + 0.22 * bump(t, 0.46, 0.72);
      o.lower = lerp(0.04, 0.35, content);
      o.key = (Math.PI / 2) * (smooth(span(t, 0.18, 0.28)) + smooth(span(t, 0.5, 0.6)));
      o.squash = 0.04 * bump(t, 0.14, 0.4) + 0.03 * bump(t, 0.46, 0.72);
      o.outL = o.outR = 0.5 + 0.15 * content;
      o.ant = 0.15 * Math.sin(t * TAU * 3) * content;
    }
    o.key = wrapK(o.key);
    if (ms !== undefined) idle(o, ms, 0.4);
    return o;
  }

  /** A tick-bob with every tick of the key, a stepped head scan, an antenna sway and blinks. */
  function idle(o, ms, amount = 1) {
    if (amount >= 1) o.key += tickKey(ms);
    const f = (ms / 600) % 1;
    o.squash += 0.015 * bump(f, 0, 0.3) * amount;
    const si = Math.floor(ms / 1500);
    const prev = SCAN[(si + SCAN.length - 1) % SCAN.length];
    const cur = SCAN[si % SCAN.length];
    o.headYaw += 0.16 * lerp(prev, cur, smooth(Math.min(1, (ms % 1500) / 160))) * amount;
    o.ant += 0.1 * Math.sin((ms / 1700) * TAU) * amount;
    o.antF += 0.06 * bump(f, 0, 0.4) * amount;
    const b = blink(ms, 900);
    o.upper += (1 - o.upper) * b;
    o.lower += (0.6 - o.lower) * b;
  }

  function pose(phase, t, reaction, look) {
    const ms = look?.now ?? nowMs();
    const yaw = look?.yaw || 0;
    if (phase === 'react') react(p, reaction, t, ms);
    else if (phase === 'exit') {
      react(end, reaction, 1);
      PK.reset(tmp);
      // A crouch, a stiff hop off (the layer moves it), arms up, and a landing.
      tmp.squash = 0.14 * bump(t, 0, 0.25) - 0.06 * bump(t, 0.2, 0.85) + 0.12 * bump(t, 0.85, 1);
      tmp.fwdL = tmp.fwdR = 0.6 * bump(t, 0.1, 0.95);
      tmp.stepL = tmp.stepR = 0.4 * bump(t, 0.25, 0.8);
      tmp.antF = -0.3 * bump(t, 0.15, 0.9);
      PK.blend(p, end, tmp, smooth(span(t, 0, 0.3)));
    } else if (phase === 'enter') {
      // It marches in: stepping, arms swinging, the key turning, and a clunk of a landing.
      PK.reset(p);
      const go = plateau(t, 0, 0.82, 0.1);
      const s = Math.sin(t * TAU * 3);
      p.stepL = Math.max(0, s) * go;
      p.stepR = Math.max(0, -s) * go;
      p.fwdL = -0.5 * s * go;
      p.fwdR = 0.5 * s * go;
      p.lift = 0.03 * Math.abs(s) * go;
      p.squash = 0.12 * bump(t, 0.82, 1);
      p.key = wrapK(TAU * t);
      p.upper = 0.04;
    } else if (phase === 'move') {
      // A dodge: a quick clockwork march (the layer slides it across), feet stepping in turn, arms
      // swinging stiffly against them, a tick-bob on every step, the key whirring round.
      PK.reset(p);
      const go = plateau(t, 0.04, 0.96, 0.14);
      const s = Math.sin(t * TAU * 4);
      p.stepL = Math.max(0, s) * go;
      p.stepR = Math.max(0, -s) * go;
      p.fwdL = -0.6 * s * go;
      p.fwdR = 0.6 * s * go;
      p.lift = 0.04 * Math.abs(s) * go;
      p.squash = 0.04 * (1 - Math.abs(s)) * go + 0.06 * bump(t, 0, 0.1) + 0.06 * bump(t, 0.9, 1);
      p.roll = 0.05 * s * go;
      p.pitch = 0.1 * go;
      p.headPitch = -0.1 * go;
      p.ant = -0.25 * s * go;
      p.key = wrapK(2 * TAU * smooth(t));
      p.upper = lerp(0.12, 0.04, go);
    } else if (phase === 'pet') {
      // Petted: happy eyes, its head rocking in little steps, the key spinning gladly, the antenna
      // waggling, the clamps clapping (look.calm: a smaller wiggle).
      PK.reset(p);
      const k = look?.calm ? 0.35 : 1;
      const on = plateau(t, 0, 1, 0.15);
      p.headRoll = 0.28 * k * Math.sin(t * TAU * 2) * on;
      p.headPitch = -0.1 * on;
      p.roll = 0.05 * k * Math.sin(t * TAU * 2 + 0.6) * on;
      p.key = wrapK(2 * TAU * t);
      p.ant = 0.35 * k * Math.sin(t * TAU * 3) * on;
      p.outL = p.outR = 0.5 + 0.25 * k * Math.sin(t * TAU * 3) * on;
      p.clampL = p.clampR = 0.2 + 0.5 * Math.abs(Math.sin(t * TAU * 3)) * on;
      p.squash = 0.03 * k * Math.sin(t * TAU * 4) * on;
      p.upper = lerp(0.12, 0.3, on);
      p.lower = lerp(0.04, 0.55, on);
      p.glow = lerp(1, 1.15, on);
    } else if (phase === 'huff') {
      // Huffed: hands on hips, puffed up and steaming a little, the head turned away, eyes narrow,
      // the key cranking backwards.
      PK.reset(p);
      const k = look?.calm ? 0.5 : 1;
      const mad = plateau(t, 0, 1, 0.12);
      p.squash = (-0.08 * bump(t, 0.05, 0.45) + 0.06 * bump(t, 0.4, 0.75)) * k;
      p.fwdL = p.fwdR = -0.35 * mad;
      p.outL = p.outR = lerp(0.5, 1.0, mad);
      p.clampL = p.clampR = lerp(0.2, 0, mad);
      p.headYaw = 0.55 * mad;
      p.headPitch = -0.12 * mad;
      p.gazeYaw = 0.4 * mad;
      p.upper = lerp(0.12, 0.5, mad);
      p.sad = -0.35 * mad;
      p.key = wrapK(-Math.PI * smooth(t));
      p.heat = 0.25 * mad * k;
      p.antF = 0.3 * mad;
    } else if (phase === 'scorch') {
      // Scorched (fire, lava): a hop back off the heat, then it overheats: glowing, rattling, the
      // key racing, fanning its face with one clamp, eyes squeezed (look.calm: slower, smaller).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const f = look?.calm ? 3 : 5;
      const on = plateau(t, 0, 1, 0.12);
      p.lift = 0.22 * k * bump(t, 0.02, 0.28);
      p.heat = on;
      p.roll = 0.035 * k * Math.sin(t * TAU * 18) * on;
      p.fwdR = on * (2.0 + 0.35 * k * Math.sin(t * TAU * f));
      p.outR = lerp(0.5, 0.1, on);
      p.clampR = 0.2 + 0.6 * on;
      p.headPitch = -0.15 * on;
      p.upper = lerp(0.12, 0.55, on);
      p.lower = lerp(0.04, 0.3, on);
      p.key = wrapK(4 * TAU * t);
      p.ant = 0.2 * k * Math.sin(t * TAU * 11) * on;
      p.mouth = 0.6 * on;
    } else if (phase === 'shiver') {
      // Frozen (frost): arms hugged in, the key stuck, rattling in place, the clamps chattering,
      // lenses dimmed (look.calm: a slower, smaller rattle).
      PK.reset(p);
      const k = look?.calm ? 0.3 : 1;
      const f = look?.calm ? 5 : 14;
      const on = plateau(t, 0, 1, 0.12);
      p.roll = 0.06 * k * Math.sin(t * TAU * f) * on;
      p.headRoll = 0.04 * k * Math.sin(t * TAU * f * 1.3) * on;
      p.fwdL = p.fwdR = 0.7 * on;
      p.outL = p.outR = lerp(0.5, -0.15, on);
      p.clampL = p.clampR = 0.2 + 0.35 * k * Math.abs(Math.sin(t * TAU * f * 0.5)) * on;
      p.squash = 0.06 * on;
      p.headPitch = 0.2 * on;
      p.upper = lerp(0.12, 0.5, on);
      p.glow = lerp(1, 0.7, on);
      p.ant = 0.1 * k * Math.sin(t * TAU * f) * on;
    } else if (phase === 'bristle') {
      // Zapped (storm): stands tall and stiff, arms flung out, clamps wide, lenses blazing, the
      // antenna straight up and buzzing (look.calm: no tremble).
      PK.reset(p);
      const k = look?.calm ? 0 : 1;
      const on = plateau(t, 0, 1, 0.1);
      p.squash = -0.1 * on;
      p.outL = p.outR = lerp(0.5, 1.35, on);
      p.clampL = p.clampR = lerp(0.2, 1, on);
      p.roll = 0.03 * k * Math.sin(t * TAU * 10) * on;
      p.ant = 0.12 * k * Math.sin(t * TAU * 15) * on;
      p.antF = -0.3 * on;
      p.headPitch = -0.12 * on;
      p.upper = lerp(0.12, 0, on);
      p.lower = lerp(0.04, 0, on);
      p.glow = lerp(1, 1.3, on);
      p.mouth = 0.5 * on;
    } else if (phase === 'startle') {
      // Startled (any other element): a crouch, a jump with its arms flung up, the antenna boinging,
      // lenses wide, a clunk of a landing (look.calm: a smaller jump).
      PK.reset(p);
      const k = look?.calm ? 0.4 : 1;
      const wide = plateau(t, 0, 1, 0.1);
      const air = span(t, 0.1, 0.5);
      p.lift = 0.5 * k * Math.sin(Math.PI * air);
      p.squash = 0.15 * bump(t, 0, 0.12) - 0.08 * k * bump(t, 0.1, 0.5) + 0.14 * k * bump(t, 0.48, 0.66);
      p.fwdL = p.fwdR = 2.2 * k * bump(t, 0.08, 0.6);
      p.outL = p.outR = 0.5 + 0.4 * bump(t, 0.08, 0.6);
      p.clampL = p.clampR = 0.2 + 0.8 * bump(t, 0.08, 0.6);
      p.ant = 0.4 * Math.exp(-6 * span(t, 0.1, 1)) * Math.sin(t * TAU * 7) * wide;
      p.upper = lerp(0.12, 0, wide);
      p.lower = lerp(0.04, 0, wide);
      p.glow = lerp(1, 1.3, wide);
      p.mouth = 0.7 * wide;
    } else if (phase === 'cheer') {
      // Cheering someone else's natural 20: two hops with its arms pumping overhead, the key
      // spinning, happy eyes (look.calm: one small hop). From and back to the standing pose.
      PK.reset(p);
      const calm = !!look?.calm;
      const k = calm ? 0.3 : 1;
      const two = calm ? 0 : 1;
      const joy = plateau(t, 0, 1, 0.15);
      const air1 = bump(t, 0.12, 0.42);
      const air2 = two * bump(t, 0.52, 0.82);
      p.lift = 0.3 * k * (Math.sin(Math.PI * span(t, 0.12, 0.42)) + two * Math.sin(Math.PI * span(t, 0.52, 0.82)));
      p.squash =
        k * (0.12 * bump(t, 0.02, 0.14) - 0.06 * air1 + 0.12 * bump(t, 0.42, 0.54)) +
        two * (0.1 * bump(t, 0.82, 0.95) - 0.06 * air2);
      const pump = two * 0.35 * Math.sin(t * TAU * 4);
      p.fwdL = (calm ? 1.2 : 2.5) * joy + pump * joy;
      p.fwdR = (calm ? 1.2 : 2.5) * joy - pump * joy;
      p.clampL = p.clampR = lerp(0.2, 0.9, joy);
      p.key = wrapK(3 * TAU * t);
      p.headPitch = lerp(0, -0.18, joy);
      p.upper = lerp(0.12, 0.2, joy);
      p.lower = lerp(0.04, 0.45, joy);
      p.glow = lerp(1, 1.2, joy);
      p.mouth = 0.8 * joy;
      p.ant = 0.3 * Math.sin(t * TAU * 4) * joy;
    } else if (phase === 'proud' || phase === 'sulk') {
      // A mood (its owner's recent rolls), held at rest: it settles from the standing pose into it
      // and is static from t 1. Proud: drawn up tall, hands on hips, chin up, lenses bright, a smug
      // half-shuttered look. Sulk: wound down low, head hung, arms limp, lenses dim.
      PK.reset(end);
      PK.reset(tmp);
      if (phase === 'proud') {
        tmp.squash = -0.1;
        tmp.pitch = -0.05;
        tmp.headPitch = -0.26;
        tmp.fwdL = tmp.fwdR = -0.35;
        tmp.outL = tmp.outR = 1.0;
        tmp.clampL = tmp.clampR = 0;
        tmp.upper = 0.45;
        tmp.lower = 0.3;
        tmp.glow = 1.15;
        tmp.antF = -0.25;
      } else {
        tmp.squash = 0.16;
        tmp.pitch = 0.12;
        tmp.headPitch = 0.55;
        tmp.outL = tmp.outR = 0.15;
        tmp.clampL = tmp.clampR = 0.5;
        tmp.upper = 0.55;
        tmp.sad = 0.4;
        tmp.glow = 0.4;
        tmp.gazePitch = -0.5;
        tmp.antF = 0.7;
      }
      PK.blend(p, end, tmp, smooth(t));
      if (phase === 'proud' && !look?.calm) p.squash -= 0.04 * bump(t, 0.2, 0.8); // a puff on the way
    } else if (phase === 'throw') {
      // A stiff overarm toss: the right arm swings up and back over its head, then chops forward,
      // the clamp letting go at the top of the swing.
      PK.reset(p);
      p.fwdR = keys(t, THROW_FWD);
      p.outR = keys(t, THROW_OUT);
      p.clampR = keys(t, THROW_CLAMP);
      p.pitch = keys(t, THROW_PITCH);
      p.headPitch = -0.5 * p.pitch;
      p.roll = 0.06 * bump(t, 0.2, 0.7);
      p.antF = 0.5 * p.pitch;
      p.upper = 0.04;
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
    base.rotation.y = o.yaw;
    rig.rotation.set(o.pitch, 0, o.roll);
    const sy = 1 - o.squash;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    squash.scale.set(sxz, sy, sxz);
    // the head snaps between angles (a little quantised)
    neck.rotation.set(quant(o.headPitch, 0.1), quant(o.headYaw, 0.14), quant(o.headRoll, 0.1));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const a = arms[i];
      const fwd = side > 0 ? o.fwdL : o.fwdR;
      a.g.rotation.set(-fwd, 0, side * (side > 0 ? o.outL : o.outR));
      const c = 0.15 + 0.6 * (side > 0 ? o.clampL : o.clampR);
      a.fingers[0].rotation.z = -c;
      a.fingers[1].rotation.z = c;
      const st = side > 0 ? o.stepL : o.stepR;
      legs[i].position.y = HIP + 0.08 * st;
      legs[i].position.z = 0.05 * st;
      legs[i].rotation.x = -0.25 * st;
      const ey = eyes[i];
      ey.e.set(o.gazeYaw, o.gazePitch, o.upper, o.lower, o.sad);
      const g = PUPIL * Math.max(0.15, Math.min(1.3, o.glow));
      ey.pupil.scale.set(g, 1, g);
    }
    const k = wrapK(o.key);
    key.rotation.z = k;
    gearA.rotation.z = -1.5 * k;
    gearB.rotation.z = 2 * k;
    grille.scale.y = 1 + 0.9 * o.mouth;
    antenna.rotation.set(ANT_X + o.antF, 0, o.ant);
    const h = Math.max(0, o.heat);
    body.emissive.setRGB(0.55 * h, 0.13 * h, 0.02 * h);
    accent.emissive.setRGB(0.6 * h, 0.18 * h, 0.03 * h);
  }

  PK.reset(p);
  apply(p);
  root.updateMatrixWorld(true);
  const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
  scaler.scale.setScalar(HEIGHT / h);

  return { root, height: HEIGHT, footprint: FOOT, pose, dispose: () => kit.dispose() };
}

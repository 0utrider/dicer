import * as THREE from 'three';
import { TAU, bump, keys, smooth, span, blink, nowMs, plateau } from './creatures/parts.js';

/**
 * A pet made from an artist's model (docs/reference/pet-model-spec.md): a skinned glTF scene with
 * named bones (root, body, head, eye_L/R and optional neck, jaw, ears, tail, wings, arms, legs) and
 * named shape keys (blink_L/R, happy, sad, surprised, mouthOpen, angry and optional squint_L/R,
 * puff, tongue). It is a Creature like the code-built ones (creatures/index.js): the same
 * pose(phase, t, reaction, look) contract, so every layer behaviour works unchanged.
 *
 * Dicer animates it in code: each phase sets a few numbers (hop, squash, lean, head turn, ear and
 * tail sway, the face's shape keys) and they drive the bones. A bone turns in the MODEL's space
 * (x: nod forward, y: turn, z: roll), converted to its own, so the artist's bone axes do not
 * matter. A missing optional bone or shape key is simply skipped.
 *
 * Tint: the base colour's alpha is the tint mask; where it is white the colour is multiplied by
 * the player's colour. With no colour (natural colours) the model shows as painted.
 */

const HEIGHT = 1.5; // the standing height every pet has (creatures/index.js)
const LOOK_HEAD = 0.75; // share of look.yaw the head turns (the eyes do the rest)
const SHAPE_KEYS = ['blink_L', 'blink_R', 'happy', 'sad', 'surprised', 'mouthOpen', 'angry', 'squint_L', 'squint_R', 'puff', 'tongue'];

/** Every number a pose sets; 0 is the standing pose. */
const REST = {
  hop: 0, // lift, x height
  squash: 0, // > 0 flatter, < 0 taller
  pitch: 0, // body lean forward (rad)
  roll: 0,
  turn: 0,
  flip: 0, // a somersault about the body (rad, + forward), on top of pitch
  spin: 0, // a pirouette (rad), on top of turn
  headYaw: 0,
  headPitch: 0, // > 0 nods down
  headRoll: 0,
  gazeYaw: 0,
  gazePitch: 0,
  ear: 0, // > 0 perked forward, < 0 flattened back
  tail: 0, // sway (rad)
  tailUp: 0, // > 0 raised
  wing: 0, // > 0 spread out
  armL: 0, // > 0 raised
  armR: 0,
  blinkL: 0,
  blinkR: 0,
  happy: 0,
  sad: 0,
  surprised: 0,
  mouth: 0,
  angry: 0,
  squintL: 0,
  squintR: 0,
  puff: 0,
  tongue: 0,
};

// Keyframes ([t, v, ...]), module-level so posing allocates nothing.
const CRIT_HOP = [0, 0, 0.12, -0.06, 0.3, 0.55, 0.48, 0, 0.56, -0.05, 0.7, 0.3, 0.84, 0, 1, 0];
const CRIT_SQUASH = [0, 0, 0.12, 0.2, 0.22, -0.18, 0.46, 0.12, 0.56, 0, 0.84, 0.08, 1, 0];
const THROW_PITCH = [0, 0, 0.35, -0.3, 0.55, 0.4, 0.8, 0.05, 1, 0];
const THROW_ARM = [0, 0, 0.35, 0.9, 0.55, -0.2, 1, 0];
const MOVE_HOP = [0, 0, 0.1, 0, 0.3, 0.22, 0.48, 0, 0.6, 0, 0.8, 0.22, 0.97, 0, 1, 0];
const CHEER_HOP = [0, 0, 0.15, 0.3, 0.35, 0, 0.55, 0.3, 0.75, 0, 1, 0];

/**
 * Each kind's idle on top of the shared one (breathing, a look round, tail, ears, arms, blinks), as
 * its code-built creature idles: `flap` beats the wings (ms per beat: a hoverer on bat wings),
 * `settle` lets folded wings breathe, `hover` bobs it up (x height, never below its rest) and
 * `steps` turns the head in snaps (a clockwork robot).
 */
const IDLE_KINDS = {
  imp: { flap: 420, hover: 0.012 },
  dragonling: { settle: 0.08 },
  owl: { settle: 0.05 },
  ghost: { hover: 0.017 },
  eye: { hover: 0.017 },
  lantern: { hover: 0.015 },
  robot: { steps: 10 },
};
const NO_IDLE = {};

/**
 * Each kind's own natural 20 and natural 1, as its code-built creature does them (a kind not listed
 * does the shared hop and sag). crit: 'pounce' (a crouch and a long leap, paws out), 'flip' (a
 * back-flip high in the air), 'spin' (a pirouette up off the floor), 'whir' (arms pumping, little
 * hops, a spin), 'boing' (squashed flat, then a tall stretched bounce), 'leap' (one huge jump),
 * 'flap' (wings beating fast up into the air), 'chomp' (snapping its mouth on little hops), 'stomp'
 * (fists up, stamping). fumble: 'hide' (curled up, face down, tail round), 'flop' (keels over on its
 * side, limp), 'sag' (drooping down, deflated), 'puddle' (spreading out flat), 'winddown' (twitches
 * slower and slumps forward, eyes shut).
 */
const REACT_KINDS = {
  mimic: { crit: 'chomp' },
  slime: { crit: 'boing', fumble: 'puddle' },
  dragonling: { crit: 'flap' },
  owl: { crit: 'flap', fumble: 'hide' },
  frog: { crit: 'leap', fumble: 'flop' },
  ghost: { crit: 'spin', fumble: 'sag' },
  mushroom: { crit: 'spin', fumble: 'sag' },
  eye: { crit: 'spin', fumble: 'sag' },
  golem: { crit: 'stomp', fumble: 'winddown' },
  cat: { crit: 'pounce', fumble: 'hide' },
  fox: { crit: 'pounce', fumble: 'hide' },
  lantern: { crit: 'spin', fumble: 'sag' },
  imp: { crit: 'flip', fumble: 'flop' },
  robot: { crit: 'whir', fumble: 'winddown' },
  jester: { crit: 'flip', fumble: 'flop' },
};
const NO_REACT = {};
// Their keyframes ([t, v, ...]).
const POUNCE_HOP = [0, 0, 0.18, -0.04, 0.42, 0.5, 0.62, 0, 0.7, -0.03, 0.8, 0, 1, 0];
const POUNCE_SQUASH = [0, 0, 0.18, 0.24, 0.28, -0.16, 0.6, 0.18, 0.72, 0, 1, 0];
const POUNCE_PITCH = [0, 0, 0.18, -0.15, 0.32, -0.25, 0.5, 0.45, 0.62, 0.3, 0.8, 0, 1, 0];
const FLIP_HOP = [0, 0, 0.12, -0.05, 0.3, 0.7, 0.55, 0.72, 0.72, 0, 0.8, -0.04, 0.9, 0, 1, 0];
const FLIP_SQUASH = [0, 0, 0.12, 0.22, 0.22, -0.12, 0.66, -0.06, 0.74, 0.18, 0.88, 0, 1, 0];
const SPIN_HOP = [0, 0, 0.1, -0.03, 0.3, 0.35, 0.62, 0.35, 0.8, 0, 1, 0];
const BOING_SQUASH = [0, 0, 0.18, 0.4, 0.3, -0.3, 0.52, -0.12, 0.62, 0.32, 0.74, -0.1, 0.86, 0.06, 1, 0];
const BOING_HOP = [0, 0, 0.2, 0, 0.38, 0.55, 0.58, 0, 0.66, 0, 0.74, 0.12, 0.86, 0, 1, 0];
const LEAP_HOP = [0, 0, 0.2, -0.05, 0.45, 0.9, 0.7, 0, 0.78, -0.04, 0.88, 0, 1, 0];
const LEAP_SQUASH = [0, 0, 0.2, 0.28, 0.3, -0.25, 0.6, -0.1, 0.72, 0.22, 0.86, 0, 1, 0];
const FLAP_HOP = [0, 0, 0.12, -0.03, 0.4, 0.6, 0.7, 0.55, 0.88, 0, 1, 0];
const STOMP_HOP = [0, 0, 0.15, 0.12, 0.25, 0, 0.4, 0.12, 0.5, 0, 0.65, 0.12, 0.75, 0, 1, 0];
const STOMP_SQUASH = [0, 0, 0.15, -0.06, 0.27, 0.16, 0.4, -0.06, 0.52, 0.16, 0.65, -0.06, 0.77, 0.16, 0.9, 0, 1, 0];
// The elements' shared reactions.
const STARTLE_HOP = [0, 0, 0.06, 0.05, 0.22, 0.3, 0.42, 0, 0.5, -0.03, 0.6, 0, 1, 0];
const STARTLE_PITCH = [0, 0, 0.08, -0.1, 0.25, -0.4, 0.5, -0.25, 0.75, -0.1, 1, 0];
const SCORCH_HOP = [0, 0, 0.05, 0.2, 0.18, 0, 1, 0];

/**
 * A copy of a skinned scene with its own bones: Object3D.clone() copies the bones but leaves each
 * skinned mesh bound to the template's skeleton, so each is bound again to the copied bones (by
 * name, with the template's inverse bind matrices). Not three's SkeletonUtils: it would pull its
 * animation classes into the world-start bundle.
 */
function cloneSkinned(src) {
  const dst = src.clone(true);
  const bones = new Map();
  dst.traverse((o) => o.isBone && bones.set(o.name, o));
  const from = [];
  const to = [];
  src.traverse((o) => o.isSkinnedMesh && from.push(o));
  dst.traverse((o) => o.isSkinnedMesh && to.push(o));
  to.forEach((m, i) => {
    const sk = from[i].skeleton;
    m.bind(new THREE.Skeleton(sk.bones.map((b) => bones.get(b.name) ?? b), sk.boneInverses), from[i].bindMatrix);
  });
  return dst;
}

/** The world (model-space) rotation of `o` relative to `root`, at rest. */
function restWorldQ(o, root) {
  const q = new THREE.Quaternion();
  for (let p = o; p && p !== root; p = p.parent) q.premultiply(p.quaternion);
  return q;
}

/**
 * Textured materials of `root`'s meshes, each replaced by a tinted copy of its own (the map's alpha
 * is the mask); untextured ones (plain eyes, teeth) keep their colour. Returns the copies.
 */
function tintMaterials(root, tint) {
  const made = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => {
      if (!m?.map) return m;
      if (!made.has(m)) {
        const c = m.clone();
        const map = true;
        c.onBeforeCompile = (sh) => {
          sh.uniforms.uDicerTint = tint;
          sh.fragmentShader = `uniform vec3 uDicerTint;\n${sh.fragmentShader.replace(
            '#include <map_fragment>',
            map
              ? '#include <map_fragment>\n\tdiffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * uDicerTint, sampledDiffuseColor.a );'
              : '#include <map_fragment>\n\tdiffuseColor.rgb *= uDicerTint;',
          )}`;
        };
        c.customProgramCacheKey = () => `dicer-pet-tint${map ? '-map' : ''}`;
        made.set(m, c);
      }
      return made.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  return [...made.values()];
}

/**
 * @param {THREE.Object3D} template the parsed glTF scene (render/model-loader.js loadPetModel)
 * @param {string|null} color the player's colour, or null for the painted (natural) colours
 * @param {{kind?: string, clock?: () => number}} [o]
 * @returns {{root: THREE.Group, height: number, footprint: number, pose: Function, dispose: Function}}
 */
export function createModelCreature(template, color, { kind = 'pet', clock = nowMs, drawHeight = HEIGHT } = {}) {
  const model = cloneSkinned(template);
  const root = new THREE.Group();
  root.name = kind;
  // turns the whole model for a flip or a spin, about its middle (HEIGHT / 2 up), feet and all
  const whirl = new THREE.Group();
  whirl.rotation.order = 'YXZ';
  root.add(whirl);
  const fit = new THREE.Group(); // scales the model to HEIGHT, its feet on y = 0
  whirl.add(fit);
  fit.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  // drawHeight: the height it is drawn at (a mimic's open lid stands above the 1.5 the layer measures by)
  const k = size.y > 1e-6 ? drawHeight / size.y : 1;
  fit.scale.setScalar(k);
  fit.position.y = -box.min.y * k;
  const footprint = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) * k;

  const tint = { value: new THREE.Color(1, 1, 1) };
  if (color) {
    try {
      tint.value.set(color);
    } catch {
      /* a bad colour: painted */
    }
  }
  const materials = tintMaterials(model, tint);

  // Bones by name (the first object of that name), with their rest pose.
  const bone = (name) => {
    const o = model.getObjectByName(name);
    if (!o) return null;
    return { o, q: o.quaternion.clone(), p: o.position.clone(), s: o.scale.clone(), w: restWorldQ(o, model) };
  };
  const B = {
    root: bone('root'),
    body: bone('body'),
    head: bone('head'),
    neck: bone('neck'),
    jaw: bone('jaw'),
    eyeL: bone('eye_L'),
    eyeR: bone('eye_R'),
    earL: bone('ear_L'),
    earR: bone('ear_R'),
    wingL: bone('wing_L'),
    wingR: bone('wing_R'),
    armL: bone('arm_L'),
    armR: bone('arm_R'),
    tail: ['tail_1', 'tail_2', 'tail_3'].map(bone).filter(Boolean),
  };
  // "Raise the tail" lifts its tip: +x lifts a tail that points back (-Z), a tail curled round to
  // the front (its tip ahead of tail_1, as the cat's) needs -x.
  const tailSign = (() => {
    const t = B.tail;
    if (t.length < 2) return 1;
    const a1 = t[0].o.getWorldPosition(new THREE.Vector3());
    const tip = t[t.length - 1].o.getWorldPosition(new THREE.Vector3());
    model.worldToLocal(a1);
    model.worldToLocal(tip);
    return tip.z > a1.z ? -1 : 1;
  })();
  // Shape keys by name on every mesh that has them.
  const morphs = [];
  model.traverse((o) => {
    if (o.isMesh && o.morphTargetDictionary && o.morphTargetInfluences) morphs.push(o);
  });
  const hasKey = (name) => morphs.some((m) => name in m.morphTargetDictionary);
  const mouthByJaw = !!B.jaw && !hasKey('mouthOpen');

  const Q = new THREE.Quaternion();
  const D = new THREE.Quaternion();
  const E = new THREE.Euler(0, 0, 0, 'YXZ');
  const MID = new THREE.Vector3();
  /** Turns bone `b` by (x, y, z) in the model's space, about its own pivot. */
  const turn = (b, x, y, z) => {
    if (!b) return;
    E.set(x, y, z);
    Q.setFromEuler(E);
    D.copy(b.w).invert().multiply(Q).multiply(b.w); // into the bone's own axes
    b.o.quaternion.copy(b.q).multiply(D);
  };
  const setKey = (name, v) => {
    for (const m of morphs) {
      const i = m.morphTargetDictionary[name];
      if (i !== undefined) m.morphTargetInfluences[i] = v > 0 ? (v < 1 ? v : 1) : 0;
    }
  };

  const p = { ...REST };
  const reset = () => Object.assign(p, REST);

  // Keeping it on the table: a sample of Body's vertices (its lowest at rest and a spread of the
  // rest) skinned on the CPU each posed frame, so a lean, flop, flip or crouch that would push any
  // part through the floor lifts the whole pet just enough instead. Allocation-free per frame.
  let skin = null;
  model.traverse((o) => {
    if (o.isSkinnedMesh && o.geometry.attributes.skinIndex && (!skin || o.geometry.attributes.position.count > skin.geometry.attributes.position.count)) skin = o;
  });
  const floor = (() => {
    if (!skin) return null;
    const pos = skin.geometry.attributes.position;
    const si = skin.geometry.attributes.skinIndex;
    const sw = skin.geometry.attributes.skinWeight;
    const n = pos.count;
    const byY = Array.from({ length: n }, (_, i) => i).sort((a, b) => pos.getY(a) - pos.getY(b));
    const pick = new Set(byY.slice(0, 128));
    const stride = Math.max(1, Math.floor(n / 640));
    for (let i = 0; i < n; i += stride) pick.add(i);
    const ids = [...pick];
    const m = ids.length;
    const base = new Float32Array(m * 3);
    const bi = new Uint16Array(m * 4);
    const bw = new Float32Array(m * 4);
    const v = new THREE.Vector3();
    ids.forEach((id, j) => {
      v.fromBufferAttribute(pos, id).applyMatrix4(skin.bindMatrix);
      base.set([v.x, v.y, v.z], j * 3);
      for (let c = 0; c < 4; c++) {
        bi[j * 4 + c] = si.getComponent(id, c);
        bw[j * 4 + c] = sw.getComponent(id, c);
      }
    });
    const bones = skin.skeleton.bones;
    return { m, base, bi, bw, bones, inv: skin.skeleton.boneInverses, bm: bones.map(() => new THREE.Matrix4()), c: new THREE.Matrix4(), rest: 0 };
  })();
  /** The lowest sampled point of the posed Body, in the creature's own space (root's). */
  function lowest() {
    const f = floor;
    root.updateMatrixWorld(true);
    for (let b = 0; b < f.bones.length; b++) f.bm[b].multiplyMatrices(f.bones[b].matrixWorld, f.inv[b]);
    f.c.copy(root.matrixWorld).invert().multiply(skin.matrixWorld).multiply(skin.bindMatrixInverse);
    const ce = f.c.elements;
    let lo = Infinity;
    for (let j = 0; j < f.m; j++) {
      const x0 = f.base[j * 3];
      const y0 = f.base[j * 3 + 1];
      const z0 = f.base[j * 3 + 2];
      let x = 0;
      let y = 0;
      let z = 0;
      for (let c = 0; c < 4; c++) {
        const w = f.bw[j * 4 + c];
        if (!w) continue;
        const e = f.bm[f.bi[j * 4 + c]].elements;
        x += w * (e[0] * x0 + e[4] * y0 + e[8] * z0 + e[12]);
        y += w * (e[1] * x0 + e[5] * y0 + e[9] * z0 + e[13]);
        z += w * (e[2] * x0 + e[6] * y0 + e[10] * z0 + e[14]);
      }
      const ly = ce[1] * x + ce[5] * y + ce[9] * z + ce[13];
      if (ly < lo) lo = ly;
    }
    return lo;
  }

  const own = IDLE_KINDS[kind] ?? NO_IDLE;
  /**
   * Breathing, a slow look round with a head tilt, a body sway, a tail sway, an ear twitch, arms
   * swinging a little and blinks, on the creature's own clock; plus the kind's own (IDLE_KINDS).
   */
  function idle(ms, k1 = 1) {
    const s = ms / 1000;
    p.squash += 0.02 * Math.sin(s * TAU * 0.35) * k1;
    p.tail += 0.25 * Math.sin(s * TAU * 0.5) * k1;
    p.ear += 0.25 * bump((s % 4.3) / 4.3, 0.9, 0.97) * k1;
    // every term below is 0 at ms 0, so that moment is the standing pose plus breathing
    let look = 0.14 * Math.sin(s * TAU * 0.13) + 0.06 * Math.sin(s * TAU * 0.31);
    if (own.steps) look = Math.round(look * own.steps) / own.steps;
    p.headYaw += look * k1;
    p.headRoll += 0.05 * Math.sin(s * TAU * 0.21) * k1;
    p.roll += 0.02 * Math.sin(s * TAU * 0.27) * k1;
    p.armL += 0.06 * Math.sin(s * TAU * 0.35) * k1;
    p.armR -= 0.06 * Math.sin(s * TAU * 0.35) * k1;
    if (own.flap) p.wing += 0.4 * Math.sin((ms / own.flap) * TAU) * k1;
    if (own.settle) p.wing += own.settle * Math.sin(s * TAU * 0.4) * k1;
    if (own.hover) p.hop += own.hover * (1 - Math.cos(s * TAU * 0.6)) * k1;
    const b = blink(ms);
    p.blinkL = Math.max(p.blinkL, b);
    p.blinkR = Math.max(p.blinkR, b);
  }

  const moves = REACT_KINDS[kind] ?? NO_REACT;
  /** A kind's own natural 20 (REACT_KINDS), t 0..1: starts and ends on the standing pose. */
  function crit(style, t) {
    const joy = plateau(t, 0.08, 0.95, 0.12);
    p.happy = joy;
    p.surprised = 0.6 * bump(t, 0, 0.25);
    p.ear = 0.6 * joy;
    p.tailUp = joy;
    if (style === 'pounce') {
      p.hop = keys(t, POUNCE_HOP);
      p.squash = keys(t, POUNCE_SQUASH);
      p.pitch = keys(t, POUNCE_PITCH);
      p.armL = p.armR = 1.3 * plateau(t, 0.28, 0.7, 0.08);
      p.headPitch = 0.3 * bump(t, 0.4, 0.7) - 0.15 * bump(t, 0.1, 0.35);
      p.mouth = 0.5 * bump(t, 0.6, 0.95);
    } else if (style === 'flip') {
      p.hop = keys(t, FLIP_HOP);
      p.squash = keys(t, FLIP_SQUASH);
      p.flip = -TAU * smooth(span(t, 0.26, 0.7)); // backwards, all the way round
      p.armL = p.armR = 1.3 * plateau(t, 0.2, 0.8, 0.1);
      p.wing = plateau(t, 0.2, 0.8, 0.1);
      p.mouth = bump(t, 0.2, 0.95);
    } else if (style === 'spin') {
      p.hop = keys(t, SPIN_HOP);
      p.squash = -0.1 * plateau(t, 0.2, 0.75, 0.1) + 0.12 * bump(t, 0.78, 0.92);
      p.spin = TAU * smooth(span(t, 0.18, 0.75));
      p.headRoll = 0.25 * bump(t, 0.2, 0.75);
      p.armL = p.armR = 1.0 * plateau(t, 0.15, 0.8, 0.1);
      p.mouth = 0.8 * bump(t, 0.15, 0.9);
      p.tongue = bump(t, 0.25, 0.75);
    } else if (style === 'whir') {
      p.hop = 0.08 * Math.abs(Math.sin(t * TAU * 5)) * plateau(t, 0.1, 0.9, 0.08);
      p.spin = TAU * smooth(span(t, 0.35, 0.8));
      p.armL = (0.7 + 0.6 * Math.sin(t * TAU * 6)) * joy;
      p.armR = (0.7 - 0.6 * Math.sin(t * TAU * 6)) * joy;
      p.headYaw = 0.25 * Math.round(Math.sin(t * TAU * 3) * 3) / 3 * joy; // in snaps
      p.surprised = 0.7 * joy;
      p.mouth = 0.6 * joy;
    } else if (style === 'boing') {
      p.squash = keys(t, BOING_SQUASH);
      p.hop = keys(t, BOING_HOP);
      p.mouth = bump(t, 0.25, 0.7);
      p.armL = p.armR = 1.0 * bump(t, 0.25, 0.65);
    } else if (style === 'leap') {
      p.hop = keys(t, LEAP_HOP);
      p.squash = keys(t, LEAP_SQUASH);
      p.pitch = -0.2 * bump(t, 0.25, 0.65);
      p.armL = p.armR = 1.2 * bump(t, 0.25, 0.7);
      p.mouth = bump(t, 0.3, 0.9);
      p.puff = 0.6 * bump(t, 0.7, 1);
    } else if (style === 'flap') {
      p.hop = keys(t, FLAP_HOP);
      p.wing = (0.7 + 0.5 * Math.sin(t * TAU * 9)) * plateau(t, 0.08, 0.92, 0.08);
      p.pitch = -0.1 * plateau(t, 0.2, 0.8, 0.1);
      p.squash = 0.12 * bump(t, 0.02, 0.14) + 0.1 * bump(t, 0.86, 1);
      p.mouth = bump(t, 0.15, 0.85);
      p.puff = 0.4 * joy;
    } else if (style === 'chomp') {
      const snap = Math.max(0, Math.sin(t * TAU * 4));
      p.hop = 0.12 * snap * plateau(t, 0.1, 0.9, 0.1);
      p.mouth = (0.3 + 0.7 * snap) * joy;
      p.tongue = 0.6 * bump(t, 0.6, 0.95);
      p.pitch = -0.15 * snap * joy;
      p.squash = 0.08 * (1 - snap) * joy;
    } else {
      // stomp: fists up, stamping left, right, left
      p.hop = keys(t, STOMP_HOP);
      p.squash = keys(t, STOMP_SQUASH);
      p.roll = 0.12 * Math.sin(t * TAU * 1.5) * plateau(t, 0.1, 0.9, 0.1);
      p.armL = p.armR = 1.4 * plateau(t, 0.08, 0.9, 0.1);
      p.mouth = 0.8 * joy;
      p.headPitch = -0.2 * joy;
    }
  }
  /** A kind's own natural 1 (REACT_KINDS), t 0..1: settles and holds (the pet rests after it). */
  function fumble(style, t) {
    const down = smooth(span(t, 0, 0.35));
    p.sad = down;
    p.ear = -0.8 * down;
    p.tailUp = -0.6 * down;
    if (style === 'hide') {
      // curled up, face down into its paws, the tail round in front; one peek out
      p.squash = 0.3 * down;
      p.pitch = 0.25 * down;
      p.headPitch = 0.75 * down - 0.35 * bump(t, 0.55, 0.8);
      p.tail = 1.0 * down;
      p.armL = p.armR = 0.3 * down;
      p.wing = -0.3 * down;
      const peek = bump(t, 0.55, 0.8);
      p.blinkL = p.blinkR = down * (1 - peek);
    } else if (style === 'flop') {
      // keels over onto its side, limp, then lies there with a little twitch
      const fall = smooth(span(t, 0.1, 0.4));
      p.roll = 1.15 * fall;
      p.hop = 0.12 * bump(t, 0, 0.15);
      p.squash = 0.15 * fall;
      p.headRoll = 0.4 * fall;
      p.headPitch = 0.3 * fall;
      p.armL = p.armR = -0.2 * fall;
      p.wing = -0.5 * fall;
      p.blinkL = p.blinkR = 0.85 * fall;
      p.mouth = 0.3 * fall;
      p.tongue = 0.7 * fall;
      p.armR += 0.25 * bump(t, 0.75, 0.85);
    } else if (style === 'sag') {
      // drooping, deflated: sinking down, leaning forward, the tongue out
      p.squash = 0.35 * down;
      p.pitch = 0.18 * down;
      p.headPitch = 0.4 * down;
      p.squintL = p.squintR = 0.6 * down;
      p.tongue = 0.8 * down;
      p.mouth = 0.25 * down;
      p.roll = 0.05 * Math.sin(t * TAU * 1.2) * span(t, 0.4, 1);
    } else if (style === 'puddle') {
      // spreading out flat in a sad puddle, a slow wobble
      p.squash = 0.48 * down;
      p.squash += 0.04 * Math.sin(t * TAU * 2) * span(t, 0.35, 1);
      p.blinkL = p.blinkR = 0.4 * down;
    } else {
      // winddown: jerky nods that slow down, then slumping forward with its eyes shut
      const slow = 1 - span(t, 0, 0.6);
      p.headPitch = 0.25 * Math.round(Math.max(0, Math.sin(t * t * TAU * 6)) * 2) / 2 * slow + 0.55 * span(t, 0.55, 0.8);
      p.pitch = 0.3 * smooth(span(t, 0.55, 0.8));
      p.squash = 0.12 * smooth(span(t, 0.55, 0.8));
      p.armL = p.armR = -0.3 * smooth(span(t, 0.5, 0.8));
      p.blinkL = p.blinkR = smooth(span(t, 0.6, 0.85));
      p.roll = 0.04 * bump(t, 0.85, 0.95);
    }
  }

  function setPose(phase, t, reaction, look) {
    reset();
    const ms = look?.now ?? clock();
    const calm = look?.calm ? 0.5 : 1;
    switch (phase) {
      case 'enter':
        p.hop = 0.25 * bump(t, 0, 0.7);
        p.wing = 0.5 * bump(t, 0, 0.7);
        p.squash = 0.12 * bump(t, 0.7, 1);
        break;
      case 'throw':
        p.pitch = keys(t, THROW_PITCH);
        p.armR = keys(t, THROW_ARM);
        p.mouth = bump(t, 0.4, 0.8) * 0.6;
        p.tongue = bump(t, 0.45, 0.75);
        p.surprised = bump(t, 0.3, 0.6) * 0.4;
        break;
      case 'watch':
        idle(ms);
        break;
      case 'react':
        if (reaction === 'crit' && moves.crit) crit(moves.crit, t);
        else if (reaction === 'fumble' && moves.fumble) fumble(moves.fumble, t);
        else if (reaction === 'crit') {
          p.hop = keys(t, CRIT_HOP);
          p.squash = keys(t, CRIT_SQUASH);
          p.happy = smooth(span(t, 0.15, 0.3));
          p.surprised = bump(t, 0, 0.3);
          p.mouth = bump(t, 0.2, 0.9);
          p.armL = p.armR = bump(t, 0.2, 0.9) * 1.2;
          p.wing = bump(t, 0.2, 0.9);
          p.ear = 0.6 * bump(t, 0.1, 0.95);
          p.tailUp = bump(t, 0.1, 0.95);
          p.tail = 0.4 * Math.sin(t * TAU * 3) * bump(t, 0.3, 1);
        } else if (reaction === 'fumble') {
          const sag = smooth(span(t, 0, 0.35));
          p.squash = 0.3 * sag;
          p.sad = sag;
          p.headPitch = 0.45 * sag;
          p.ear = -0.8 * sag;
          p.tailUp = -0.6 * sag;
          p.squintL = p.squintR = 0.4 * sag;
          p.roll = 0.06 * Math.sin(t * TAU * 1.5) * span(t, 0.4, 1);
        } else if (reaction === 'mixed') {
          p.headRoll = 0.35 * plateau(t, 0.1, 0.9, 0.2);
          p.headYaw = 0.25 * Math.sin(t * TAU * 2) * bump(t, 0.1, 0.9);
          p.squintL = 0.7 * plateau(t, 0.15, 0.85, 0.2);
          p.ear = 0.3 * Math.sin(t * TAU * 4) * bump(t, 0.2, 0.8);
        } else {
          // Pleased: a little bounce, two nods with a head tilt, a smile, the tail wagging.
          const glad = plateau(t, 0.1, 0.95, 0.2);
          p.hop = 0.06 * bump(t, 0.12, 0.32) + 0.04 * bump(t, 0.45, 0.62);
          p.squash = 0.08 * bump(t, 0.05, 0.15) - 0.04 * bump(t, 0.12, 0.32) + 0.06 * bump(t, 0.3, 0.42);
          p.headPitch = 0.25 * bump(t, 0.15, 0.45) + 0.2 * bump(t, 0.5, 0.8);
          p.headRoll = 0.18 * glad;
          p.happy = 0.85 * glad;
          p.ear = 0.3 * glad;
          p.tail = 0.45 * Math.sin(t * TAU * 3) * glad;
          p.wing = 0.25 * bump(t, 0.1, 0.4);
          p.blinkL = p.blinkR = 0.55 * bump(t, 0.35, 0.75); // a contented slow blink
        }
        break;
      case 'exit':
        p.hop = 0.2 * bump(t, 0.2, 0.9);
        break;
      case 'move':
        p.hop = keys(t, MOVE_HOP);
        p.wing = (0.55 + 0.45 * Math.sin(t * TAU * 5)) * bump(t, 0, 1); // a flier flaps across
        p.pitch = 0.2 * bump(t, 0, 1);
        p.tailUp = 0.4 * bump(t, 0, 1);
        p.ear = 0.3 * bump(t, 0, 1);
        break;
      case 'pet':
        p.roll = 0.15 * Math.sin(t * TAU * 3) * bump(t, 0, 1) * calm;
        p.happy = bump(t, 0, 1);
        p.blinkL = p.blinkR = plateau(t, 0.05, 0.9, 0.15);
        p.puff = 0.3 * bump(t, 0.1, 0.8);
        p.tail = 0.5 * Math.sin(t * TAU * 4) * bump(t, 0, 1) * calm;
        break;
      case 'huff':
        p.angry = plateau(t, 0.05, 0.95, 0.15);
        p.puff = 0.8 * bump(t, 0.05, 0.55);
        p.turn = -0.4 * plateau(t, 0.3, 1, 0.2); // turns away: the body, the head a little more
        p.headYaw = -0.25 * plateau(t, 0.3, 1, 0.2);
        p.ear = -0.5 * plateau(t, 0.05, 0.95, 0.15);
        break;
      case 'scorch': {
        // Hot! A hop back off the heat, then leaning away, panting with its mouth open and cheeks
        // puffed, squinting, fanning itself (an arm, its wings) and the tail lashing.
        const hot = plateau(t, 0.12, 0.95, 0.1);
        const fan = Math.sin(t * TAU * (look?.calm ? 3 : 6));
        p.hop = keys(t, SCORCH_HOP) * calm;
        p.pitch = -0.28 * bump(t, 0, 0.3) - 0.12 * hot;
        p.headPitch = -0.15 * hot;
        p.mouth = (0.45 + 0.25 * Math.sin(t * TAU * 8)) * hot;
        p.puff = 0.5 * hot;
        p.squintL = p.squintR = 0.6 * hot;
        p.armR = (0.9 + 0.35 * fan) * hot;
        p.armL = 0.3 * hot;
        p.wing = (0.5 + 0.4 * fan) * hot;
        p.tail = 0.5 * Math.sin(t * TAU * 5) * hot * calm;
        p.ear = -0.4 * hot;
        break;
      }
      case 'shiver': {
        // Frozen: hunched small with its head tucked, arms and wings hugged in, ears flat, teeth
        // chattering (the mouth) and a fast tremble that rattles it side to side.
        const cold = plateau(t, 0, 1, 0.12);
        const f = look?.calm ? 6 : 16;
        p.squash = 0.14 * cold;
        p.pitch = 0.12 * cold;
        p.headPitch = 0.35 * cold;
        p.roll = 0.07 * Math.sin(t * TAU * f) * cold * calm;
        p.turn = 0.05 * Math.sin(t * TAU * f * 1.3 + 1) * cold * calm;
        p.armL = p.armR = -0.35 * cold;
        p.wing = -0.35 * cold;
        p.ear = -0.8 * cold;
        p.tailUp = -0.5 * cold;
        p.sad = 0.7 * cold;
        p.squintL = p.squintR = 0.5 * cold;
        p.mouth = 0.12 * Math.max(0, Math.sin(t * TAU * f * 0.7)) * cold;
        break;
      }
      case 'bristle': {
        // Zapped: stretched tall and stiff, everything sticking out (ears, tail, wings, arms), eyes
        // and mouth wide, buzzing with a jitter.
        const zap = plateau(t, 0, 1, 0.08);
        const jit = look?.calm ? 0 : 1;
        p.squash = -0.2 * zap;
        p.hop = (0.03 + 0.015 * Math.abs(Math.sin(t * TAU * 11)) * jit) * zap;
        p.surprised = zap;
        p.mouth = 0.5 * zap;
        p.ear = 0.9 * zap;
        p.tailUp = zap;
        p.wing = 1.1 * zap;
        p.armL = p.armR = 0.55 * zap;
        p.headRoll = 0.08 * Math.sin(t * TAU * 13) * zap * jit;
        p.roll = 0.03 * Math.sin(t * TAU * 17) * zap * jit;
        break;
      }
      case 'startle':
        // Startled: a quick jump BACK, leaning away with a gasp (eyes wide, mouth open), arms
        // up in front of it, then a wary settle; no smile (the natural 20 is a happy jump).
        p.hop = keys(t, STARTLE_HOP) * calm;
        p.pitch = keys(t, STARTLE_PITCH);
        p.squash = 0.12 * bump(t, 0, 0.08) + 0.1 * bump(t, 0.4, 0.55);
        p.surprised = bump(t, 0, 0.9);
        p.mouth = 0.8 * bump(t, 0.03, 0.5);
        p.headPitch = -0.2 * bump(t, 0.05, 0.6);
        p.armL = p.armR = 0.9 * bump(t, 0.04, 0.55);
        p.ear = 0.7 * bump(t, 0, 0.7);
        p.tailUp = 0.6 * bump(t, 0, 0.6);
        p.wing = 0.8 * bump(t, 0.02, 0.4);
        break;
      case 'proud': {
        const k1 = smooth(span(t, 0, 1));
        p.squash = -0.08 * k1;
        p.headPitch = -0.2 * k1;
        p.happy = 0.6 * k1;
        p.puff = 0.5 * k1;
        p.squintL = p.squintR = 0.3 * k1;
        break;
      }
      case 'sulk': {
        const k1 = smooth(span(t, 0, 1));
        p.squash = 0.26 * k1;
        p.headPitch = 0.4 * k1;
        p.sad = 0.8 * k1;
        p.ear = -0.8 * k1;
        p.tailUp = -0.6 * k1;
        break;
      }
      case 'cheer':
        p.hop = keys(t, CHEER_HOP) * calm;
        p.happy = bump(t, 0, 1);
        p.mouth = bump(t, 0.1, 0.9);
        p.armL = p.armR = 1.1 * bump(t, 0.05, 0.95);
        p.wing = bump(t, 0.05, 0.95);
        break;
      default:
        break; // wobble and reform are the wrapper's (creatures/index.js), on the standing pose
    }
    apply(look?.yaw ?? 0);
    // watch only breathes and bobs up: nothing there can reach the floor, so it skips the check
    if (floor && phase !== 'watch') {
      const lo = lowest();
      if (lo < floor.rest) whirl.position.y += floor.rest - lo;
    }
  }

  function apply(lookYaw) {
    const ly = Number.isFinite(lookYaw) ? lookYaw : 0;
    if (B.root) {
      B.root.o.position.copy(B.root.p);
      B.root.o.position.y += (p.hop * HEIGHT) / k;
      const sy = 1 - p.squash;
      const sxz = 1 + p.squash * 0.5;
      B.root.o.scale.set(B.root.s.x * sxz, B.root.s.y * sy, B.root.s.z * sxz);
    } else {
      model.position.y = (p.hop * HEIGHT) / k;
      model.scale.set(1 + p.squash * 0.5, 1 - p.squash, 1 + p.squash * 0.5);
    }
    turn(B.body, p.pitch, p.turn, p.roll);
    // flip and spin: whirl turns about the model's middle where the hop has lifted it,
    // M = (0, HEIGHT * (1/2 + hop), 0), so its origin moves by M - R*M
    whirl.rotation.set(p.flip, p.spin, 0);
    MID.set(0, HEIGHT * (0.5 + p.hop), 0);
    whirl.position.copy(MID).sub(MID.applyEuler(whirl.rotation));
    turn(B.neck, p.headPitch * 0.4, (p.headYaw + ly * LOOK_HEAD) * 0.4, p.headRoll * 0.4);
    const hk = B.neck ? 0.6 : 1;
    turn(B.head, p.headPitch * hk, (p.headYaw + ly * LOOK_HEAD) * hk, p.headRoll * hk);
    const gy = p.gazeYaw + ly * (1 - LOOK_HEAD);
    turn(B.eyeL, p.gazePitch, gy, 0);
    turn(B.eyeR, p.gazePitch, gy, 0);
    // +x tips an upright ear's top toward +Z: perked forward; < 0 flattens it back
    turn(B.earL, p.ear * 0.5, 0, 0);
    turn(B.earR, p.ear * 0.5, 0, 0);
    turn(B.wingL, 0, 0, p.wing * 0.9);
    turn(B.wingR, 0, 0, -p.wing * 0.9);
    // front legs hung on the body keep their feet up when it leans forward (not through the floor)
    const keep = B.body && p.pitch > 0 ? p.pitch : 0;
    turn(B.armL, -p.armL * 1.2 - (B.armL?.o.parent === B.body?.o ? keep : 0), 0, p.armL * 0.3);
    turn(B.armR, -p.armR * 1.2 - (B.armR?.o.parent === B.body?.o ? keep : 0), 0, -p.armR * 0.3);
    turn(B.jaw, mouthByJaw ? p.mouth * 0.35 : 0, 0, 0);
    B.tail.forEach((b, i) => turn(b, tailSign * p.tailUp * 0.3, p.tail * (0.5 + 0.35 * i), 0));
    setKey('blink_L', p.blinkL);
    setKey('blink_R', p.blinkR);
    setKey('happy', p.happy);
    setKey('sad', p.sad);
    setKey('surprised', p.surprised);
    setKey('mouthOpen', p.mouth);
    setKey('angry', p.angry);
    setKey('squint_L', p.squintL);
    setKey('squint_R', p.squintR);
    setKey('puff', p.puff);
    setKey('tongue', p.tongue);
  }

  setPose('exit', 1, 'plain', { yaw: 0 });
  // the floor it keeps above: the table, or where a hoverer's lowest point rests if that is lower
  if (floor) floor.rest = Math.min(0, lowest());
  return {
    root,
    height: HEIGHT,
    footprint,
    /** The shape keys this model has, of the spec's (for a model check). */
    shapeKeys: SHAPE_KEYS.filter(hasKey),
    pose: setPose,
    dispose() {
      for (const m of materials) m.dispose();
    },
  };
}

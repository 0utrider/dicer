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
  const fit = new THREE.Group(); // scales the model to HEIGHT, its feet on y = 0
  root.add(fit);
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

  /** Breathing, a tail sway, an ear twitch and blinks, on the creature's own clock. */
  function idle(ms, k1 = 1) {
    const s = ms / 1000;
    p.squash += 0.02 * Math.sin(s * TAU * 0.35) * k1;
    p.tail += 0.25 * Math.sin(s * TAU * 0.5) * k1;
    p.ear += 0.25 * bump((s % 4.3) / 4.3, 0.9, 0.97) * k1;
    const b = blink(ms);
    p.blinkL = Math.max(p.blinkL, b);
    p.blinkR = Math.max(p.blinkR, b);
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
        if (reaction === 'crit') {
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
          p.headPitch = 0.25 * bump(t, 0.15, 0.45) + 0.2 * bump(t, 0.5, 0.8);
          p.happy = 0.6 * plateau(t, 0.1, 0.95, 0.2);
          p.squash = 0.05 * bump(t, 0.1, 0.3);
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
      case 'scorch':
        p.hop = 0.2 * bump(t, 0, 0.25);
        p.mouth = 0.6 * plateau(t, 0.2, 0.95, 0.1);
        p.squintL = p.squintR = 0.5 * plateau(t, 0.2, 0.95, 0.1);
        p.armR = (0.6 + 0.3 * Math.sin(t * TAU * 6)) * plateau(t, 0.25, 0.95, 0.1);
        break;
      case 'shiver':
        p.roll = 0.06 * Math.sin(t * TAU * (look?.calm ? 6 : 14)) * bump(t, 0, 1) * calm;
        p.squash = 0.08 * bump(t, 0, 1);
        p.sad = 0.5 * bump(t, 0, 1);
        p.ear = -0.6 * bump(t, 0, 1);
        break;
      case 'bristle':
        p.squash = -0.15 * bump(t, 0, 1);
        p.surprised = bump(t, 0, 1);
        p.ear = 0.8 * bump(t, 0, 1);
        p.tailUp = bump(t, 0, 1);
        break;
      case 'startle':
        p.hop = 0.35 * bump(t, 0, 0.45) * calm;
        p.surprised = bump(t, 0, 0.9);
        p.armL = p.armR = 0.8 * bump(t, 0, 0.6);
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
        p.squash = 0.2 * k1;
        p.headPitch = 0.5 * k1;
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

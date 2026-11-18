import * as THREE from 'three';

/**
 * A stand-in pet model in the format of docs/reference/pet-model-spec.md, built in code: a little
 * round creature with ears, arms, feet and a three-bone tail, all ONE skinned mesh ("Body"), plus
 * the eyeballs ("Eyes"). Bones: root, body, head, eye_L/R, ear_L/R, arm_L/R, tail_1..3. Shape
 * keys: blink_L/R, happy, sad, surprised, mouthOpen, angry. The body texture is light grey with
 * darker stripes, its alpha the tint mask (the mouth samples a dark, untinted corner).
 * Used by the model-pet tests and, exported as a .glb, to check the whole load path.
 */

const BONES = [
  // name, parent, model-space position
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, 0.5, 0]],
  ['head', 'body', [0, 0.95, 0.04]],
  ['eye_L', 'head', [0.15, 1.17, 0.33]],
  ['eye_R', 'head', [-0.15, 1.17, 0.33]],
  ['ear_L', 'head', [0.2, 1.38, 0]],
  ['ear_R', 'head', [-0.2, 1.38, 0]],
  ['arm_L', 'body', [0.36, 0.62, 0.12]],
  ['arm_R', 'body', [-0.36, 0.62, 0.12]],
  ['tail_1', 'body', [0, 0.32, -0.38]],
  ['tail_2', 'tail_1', [0, 0.36, -0.62]],
  ['tail_3', 'tail_2', [0, 0.46, -0.82]],
];
const KEYS = ['blink_L', 'blink_R', 'happy', 'sad', 'surprised', 'mouthOpen', 'angry'];
const MOUTH = [0, 1.02, 0.36];

const part = (geo, bone, { uv = null, morph = null } = {}) => ({ geo: geo.index ? geo.toNonIndexed() : geo, bone, uv, morph });

function texture() {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const stripe = Math.floor(y / 6) % 3 === 0 ? 150 : 205; // darker stripes: fur detail
      const corner = x < 4 && y < 4; // the mouth's dark, untinted corner
      data.set(corner ? [40, 20, 25, 0] : [stripe, stripe, stripe, 255], i);
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** @returns {THREE.Group} a scene with the armature and the Body and Eyes skinned meshes */
export function buildStandinPet() {
  const scene = new THREE.Group();
  scene.name = 'standin';
  const bones = new Map();
  const index = new Map();
  for (const [name, parent, at] of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    const pp = parent ? BONES.find((x) => x[0] === parent)[2] : [0, 0, 0];
    b.position.set(at[0] - pp[0], at[1] - pp[1], at[2] - pp[2]);
    (parent ? bones.get(parent) : scene).add(b);
    index.set(name, bones.size);
    bones.set(name, b);
  }

  const parts = [];
  const sphere = (r, [x, y, z], s = [1, 1, 1], ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs).scale(...s).translate(x, y, z);
  parts.push(part(sphere(0.42, [0, 0.5, 0], [1, 0.95, 0.95], 18, 12), 'body'));
  parts.push(part(sphere(0.36, [0, 1.1, 0.04], [1.08, 0.95, 1], 18, 12), 'head'));
  for (const s of [1, -1]) {
    parts.push(part(new THREE.ConeGeometry(0.11, 0.26, 10).translate(0.2 * s, 1.47, 0), s > 0 ? 'ear_L' : 'ear_R'));
    parts.push(part(sphere(0.1, [0.4 * s, 0.5, 0.16], [0.9, 1.3, 0.9]), s > 0 ? 'arm_L' : 'arm_R'));
    parts.push(part(sphere(0.12, [0.2 * s, 0.06, 0.12], [1, 0.55, 1.3]), 'root'));
  }
  const seg = (a, b) => {
    const pa = new THREE.Vector3(...a);
    const pb = new THREE.Vector3(...b);
    const len = pa.distanceTo(pb);
    const g = new THREE.CylinderGeometry(0.06, 0.075, len, 10, 1).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pb.clone().sub(pa).normalize()));
    return g.translate(...a);
  };
  parts.push(part(seg([0, 0.32, -0.38], [0, 0.36, -0.62]), 'tail_1'));
  parts.push(part(seg([0, 0.36, -0.62], [0, 0.46, -0.82]), 'tail_2'));
  parts.push(part(sphere(0.08, [0, 0.5, -0.86]), 'tail_3'));

  // Eyelids: upper caps over each eye; blink swings them down over the eyeball.
  for (const [s, key] of [
    [1, 'blink_L'],
    [-1, 'blink_R'],
  ]) {
    const c = new THREE.Vector3(0.15 * s, 1.17, 0.33);
    const lid = new THREE.SphereGeometry(0.115, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42).rotateX(-0.35).translate(c.x, c.y, c.z);
    parts.push(
      part(lid, 'head', {
        morph: {
          [key]: (v) => {
            const d = v.clone().sub(c).applyAxisAngle(new THREE.Vector3(1, 0, 0), 1.25);
            return d.add(c).sub(v);
          },
        },
      }),
    );
  }
  // The mouth: a thin arc; the face keys bend it.
  const mouth = new THREE.TorusGeometry(0.09, 0.018, 6, 14, Math.PI).rotateZ(Math.PI).translate(...MOUTH);
  const m0 = new THREE.Vector3(...MOUTH);
  parts.push(
    part(mouth, 'head', {
      uv: [0.02, 0.02],
      morph: {
        happy: (v) => new THREE.Vector3(0, 0.6 * (v.x - m0.x) ** 2 * 10 * 0.05 + 0.02, 0),
        sad: (v) => new THREE.Vector3(0, -0.6 * (v.x - m0.x) ** 2 * 10 * 0.05 - 0.01, 0),
        surprised: (v) => v.clone().sub(m0).multiplyScalar(0.5),
        mouthOpen: (v) => new THREE.Vector3(0, v.y < m0.y - 0.04 ? -0.06 : 0, 0.01),
        angry: (v) => new THREE.Vector3(0, -0.02, 0).add(new THREE.Vector3(0, -0.5 * (v.x - m0.x) ** 2, 0)),
      },
    }),
  );

  const body = mergeSkinned(parts, index);
  const bodyMat = new THREE.MeshStandardMaterial({ map: texture(), roughness: 0.7 });
  const bodyMesh = new THREE.SkinnedMesh(body, bodyMat);
  bodyMesh.name = 'Body';
  bodyMesh.morphTargetDictionary = Object.fromEntries(KEYS.map((k, i) => [k, i]));
  bodyMesh.morphTargetInfluences = KEYS.map(() => 0);

  const eyeParts = [];
  for (const s of [1, -1]) {
    const name = s > 0 ? 'eye_L' : 'eye_R';
    eyeParts.push(part(sphere(0.1, [0.15 * s, 1.17, 0.33], [1, 1, 1], 14, 10), name));
    eyeParts.push(part(sphere(0.045, [0.15 * s, 1.18, 0.42], [1, 1, 0.5], 10, 6), name));
  }
  const eyes = mergeSkinned(eyeParts, index, true);
  const eyeMesh = new THREE.SkinnedMesh(eyes, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3 }));
  eyeMesh.name = 'Eyes';

  const skeleton = new THREE.Skeleton([...bones.values()]);
  scene.add(bodyMesh, eyeMesh);
  scene.updateMatrixWorld(true);
  bodyMesh.bind(skeleton);
  eyeMesh.bind(skeleton);
  return scene;
}

/** One skinned geometry from rigid parts (each wholly on its bone), with the shape keys. */
function mergeSkinned(parts, index, colours = false) {
  const n = parts.reduce((k, p) => k + p.geo.attributes.position.count, 0);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = colours ? new Float32Array(n * 3) : null;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const morph = Object.fromEntries(KEYS.map((k) => [k, new Float32Array(n * 3)]));
  let o = 0;
  const v = new THREE.Vector3();
  parts.forEach((p, pi) => {
    const g = p.geo;
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < c; i++) {
      const u = p.uv ?? [g.attributes.uv.getX(i), g.attributes.uv.getY(i)];
      uv[(o + i) * 2] = u[0];
      uv[(o + i) * 2 + 1] = u[1];
      si[(o + i) * 4] = index.get(p.bone);
      sw[(o + i) * 4] = 1;
      if (col) col.set(pi % 2 ? [0.05, 0.05, 0.08] : [1, 1, 1], (o + i) * 3); // pupils dark
      if (p.morph)
        for (const [key, f] of Object.entries(p.morph)) {
          v.fromBufferAttribute(g.attributes.position, i);
          const d = f(v);
          morph[key].set([d.x, d.y, d.z], (o + i) * 3);
        }
    }
    o += c;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  if (!colours) {
    geo.morphAttributes.position = KEYS.map((k) => new THREE.BufferAttribute(morph[k], 3));
    geo.morphTargetsRelative = true;
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

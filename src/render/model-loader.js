import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dsnModelRotation } from '../compat/dsn-layouts.js';
import { readTopFace } from '../core/face-reader.js';

// Reached only through import('./model-loader.js'): GLTFLoader stays out of the world-start
// bundle (R10) and loads the first time a roll shows a model preset.

/**
 * Where the build puts three's Draco decoder (build/draco-plugin.js), next to this chunk. A
 * variable, not a literal: Vite must not try to resolve it as an asset. The decoder is fetched
 * only when a model actually uses KHR_draco_mesh_compression.
 */
const DRACO_DIR = 'draco/';

const parsed = new Map(); // url -> Promise<{ geometry (radius 1), material }>
const sized = new Map(); // `${radius}|${url}` -> Promise<{ geometry, material }>
let defaultLoader = null;

function createLoader(decoderPath) {
  const draco = new DRACOLoader();
  draco.setDecoderPath(decoderPath ?? new URL(DRACO_DIR, import.meta.url).href);
  draco.setDecoderConfig({ type: 'wasm' });
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

/**
 * A split model's materials (one per geometry group) as the one material DiceBox handles: three
 * draws a list of materials group by group, and DiceBox fades a die on a clone of its material
 * (clone(), then transparent, depthWrite and opacity), keeps a die with a `mixer` drawing, and
 * disposes the clone. All of that reaches every material of the list here, so DiceBox needs to
 * know nothing of lists.
 */
class MaterialList extends Array {
  static get [Symbol.species]() {
    return Array; // map(), filter() and flat() give plain arrays
  }
  /** A list of clones that draw as their materials do (their shader callback, program key and userData). */
  clone() {
    return MaterialList.from(this, (m) => {
      const userData = m.userData;
      m.userData = {}; // three copies userData through JSON, which textures and callbacks do not survive
      let copy;
      try {
        copy = m.clone();
      } finally {
        m.userData = userData;
      }
      copy.userData = userData;
      copy.onBeforeCompile = m.onBeforeCompile;
      copy.customProgramCacheKey = m.customProgramCacheKey;
      return copy;
    });
  }
  get transparent() {
    return this.some((m) => m.transparent);
  }
  set transparent(v) {
    for (const m of this) m.transparent = v;
  }
  set depthWrite(v) {
    for (const m of this) m.depthWrite = v;
  }
  get opacity() {
    return this[0]?.opacity;
  }
  set opacity(v) {
    for (const m of this) m.opacity = v;
  }
  get mixer() {
    return this.find((m) => m.mixer)?.mixer;
  }
  dispose() {
    for (const m of this) m.dispose();
  }
}

/** Materials as a MaterialList (a split model's "material"). */
export const materialList = (materials) => MaterialList.from(materials);

/** Every mesh in a parsed glTF scene, depth first. */
function meshesOf(root) {
  const found = [];
  root?.traverse?.((o) => {
    if (o.isMesh) found.push(o);
  });
  return found;
}

/**
 * The die's meshes. A die may be split over several (a body, its labels, a ring around it: glTF
 * primitives, which GLTFLoader turns into sibling meshes, or separate nodes), each with its own
 * material; parse() joins them. Only meshes that each carry several materials are refused.
 */
function dieMeshes(root, url) {
  const meshes = meshesOf(root).filter((m) => m.geometry?.attributes?.position);
  if (!meshes.length) throw new Error(`dicer: no mesh in ${url}`);
  if (meshes.length > 1 && meshes.some((m) => Array.isArray(m.material))) {
    throw new Error(`dicer: the die in ${url} is split over meshes with several materials each`);
  }
  return meshes;
}

/**
 * Several geometries as one, a material group each (in order). They are brought to a common form
 * first: the attributes all of them have, and indexed only when all are.
 */
function join(geometries, url) {
  const names = Object.keys(geometries[0].attributes).filter((n) => geometries.every((g) => g.attributes[n]));
  const indexed = geometries.every((g) => g.index);
  const list = geometries.map((g) => {
    const out = indexed || !g.index ? g : g.toNonIndexed();
    for (const n of Object.keys(out.attributes)) if (!names.includes(n)) out.deleteAttribute(n);
    out.morphAttributes = {};
    return out;
  });
  const joined = mergeGeometries(list, true);
  if (!joined) throw new Error(`dicer: the parts of the die in ${url} cannot be joined`);
  return joined;
}

/** Caches `make()`'s promise under `key`; a rejected promise is dropped so a later call retries. */
function cached(map, key, make) {
  let pending = map.get(key);
  if (pending) return pending;
  pending = make();
  map.set(key, pending);
  pending.catch(() => {
    if (map.get(key) === pending) map.delete(key);
  });
  return pending;
}

/**
 * Parses `url` once: the die's mesh (its meshes joined: one geometry with a material group each,
 * and the list of their materials), world transform baked in, recentred, at radius 1. A split die
 * is centred and sized by its die-sized part (the lower median by size: of a body, its labels and a
 * ring, the body), so what stands out from the die (Ember Lunar Dice's Cora ring) stays outside it.
 */
function parse(url, loader, decoderPath) {
  return cached(parsed, url, async () => {
    if (typeof url !== 'string' || !url) throw new Error('dicer: a die model needs a url');
    const gltf = await (loader ?? (defaultLoader ??= createLoader(decoderPath))).loadAsync(url);
    const meshes = dieMeshes(gltf?.scene, url);
    const parts = meshes.map((mesh) => {
      mesh.updateWorldMatrix(true, false);
      const g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      g.computeBoundingSphere(); // around its bounding-box centre
      return { g, centre: g.boundingSphere.center.clone(), r: g.boundingSphere.radius };
    });
    const { centre, r } = [...parts].sort((a, b) => a.r - b.r)[Math.floor((parts.length - 1) / 2)];
    if (!(r > 0)) throw new Error(`dicer: the model in ${url} is empty`);
    const geometry = parts.length > 1 ? join(parts.map((p) => p.g), url) : parts[0].g;
    geometry.translate(-centre.x, -centre.y, -centre.z);
    scaleTo(geometry, 1 / r);
    const [only] = meshes;
    const several = Array.isArray(only.material) && only.material.length > 1 && only.geometry.groups.length > 1;
    const material =
      meshes.length > 1
        ? materialList(meshes.map((m) => m.material))
        : several
          ? materialList(only.material)
          : Array.isArray(only.material) ? (only.material[0] ?? null) : (only.material ?? null);
    return { geometry, material };
  });
}

function scaleTo(geometry, k) {
  geometry.scale(k, k, k);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Loads a die model: the one mesh of the glTF at `url` (a die split over several meshes or
 * material groups rejects, so it falls back to Dicer's die), its world transform baked in,
 * recentred on its bounding-box centre and scaled so its bounding radius is `radius` (the
 * radius of Dicer's die of that shape). Each url is fetched and parsed once; each size is
 * cached too. Results are shared: callers must not dispose them. A failed load is not
 * cached, so a later roll retries.
 * @param {string} url
 * @param {{ radius?: number, loader?: { loadAsync(url: string): Promise<object> },
 *   decoderPath?: string }} [options] decoderPath: the Draco decoder folder (dev pages)
 * @returns {Promise<{ geometry: THREE.BufferGeometry, material: THREE.Material | null }>}
 */
export function loadDieModel(url, { radius = 1, loader, decoderPath } = {}) {
  const base = parse(url, loader, decoderPath);
  if (radius === 1) return base;
  return cached(sized, `${radius}|${url}`, async () => {
    const { geometry, material } = await base;
    return { geometry: scaleTo(geometry.clone(), radius), material };
  });
}

const dressed = new WeakSet(); // model materials that have their dice system's shader callback

/**
 * Gives a model's materials their dice system's shader callback (a DiceSystem's
 * beforeShaderCompile: Ember Lunar Dice draw their moving surfaces and their full-moon looks
 * there), as Dice So Nice does for a model: the material carries the die type, system and
 * appearance in its userData (Dice So Nice's DiceSystem reads them there), and its program is
 * keyed apart from a plain glTF material's. Once per material (a model is shared by every die of
 * its url). A callback that throws leaves the shader as it was and warns once. A shader bound to
 * the clock (`uniforms.time`) marks its material with a `mixer` (a MaterialList shows it too):
 * DiceBox keeps such dice drawing while they rest. Nothing is done without such a system.
 * @param {{ material: object | object[] }} model
 * @param {{ systemInstance: object | null, system: string, dsnType?: string, type: string, appearance?: object }} die
 *   the die it is for (DiceBox's die, or its fields)
 * @param {Function} [warn]
 */
export function dressModel(model, die, warn = (...a) => console.warn(...a)) {
  const instance = die?.systemInstance;
  if (typeof instance?.beforeShaderCompile !== 'function') return;
  const id = die.system;
  const type = die.dsnType ?? die.type;
  const appearance = die.appearance;
  let warned = false;
  for (const mat of [model?.material].flat()) {
    if (!mat?.isMaterial || dressed.has(mat)) continue;
    dressed.add(mat);
    Object.assign(mat.userData, { diceType: type, system: id, appearance: appearance ?? {} });
    const key = `dicer-model|${id}|${type}|${mat.uuid}`;
    const before = mat.onBeforeCompile;
    mat.customProgramCacheKey = () => key;
    mat.onBeforeCompile = function (shader, renderer) {
      const self = this?.isMaterial ? this : mat; // a fade clone compiles as itself
      before?.call(self, shader, renderer);
      const { vertexShader, fragmentShader } = shader;
      const uniforms = { ...shader.uniforms };
      try {
        instance.beforeShaderCompile(shader, self, type, mat.userData.appearance);
      } catch (err) {
        shader.vertexShader = vertexShader;
        shader.fragmentShader = fragmentShader;
        for (const k of Object.keys(shader.uniforms ?? {})) if (!(k in uniforms)) delete shader.uniforms[k];
        Object.assign(shader.uniforms ?? {}, uniforms);
        if (!warned) warn(`dicer: dice system "${id}": its shader callback failed on a model; the model draws without it`, err);
        warned = true;
        return;
      }
      if (shader.uniforms?.time) {
        self.mixer ??= { animated: true };
        mat.mixer ??= self.mixer;
      }
    };
    mat.needsUpdate = true;
  }
}

// Per-value rotations for Dice So Nice models with no one rotation (compat/dsn-orientation.js).
export { dsnModelRotation };

/** A die model as DiceBox takes it: with its rotations, the free-die follower and dressModel. */
export const loadForBox = (url, options) =>
  loadDieModel(url, options).then((model) => model && { ...model, rotationFor: dsnModelRotation, followFor, dress: dressModel });

/**
 * A free die (rolling by hand: physics decides its face) on a per-value model: {rotation, follow}.
 * `rotation` is the model rotation for the face the die shows now; Playback hands `follow` each
 * pose, and as the shown face changes the model turns (die.modelQuat and the inner mesh, whose
 * own rotation a free die never has) so its own face for that value is the one shown. The die
 * rests on it, so the model shows the value read. Null when the type has no layout.
 */
export function followFor(die) {
  const shownBy = (q) => die.shape.values[readTopFace(die.shape, q)];
  const turn = (v) => dsnModelRotation(die.shapeType, v)?.rotation;
  let shown = shownBy(die.outer.quaternion);
  const rotation = turn(shown);
  if (!rotation) return null;
  const follow = (q) => {
    const v = shownBy(q);
    const r = v !== shown && turn(v);
    if (!r) return;
    shown = v;
    die.modelQuat.set(...r);
    die.inner.quaternion.copy(die.modelQuat);
  };
  return { rotation, follow };
}

const pets = new Map(); // url -> Promise<THREE.Object3D> (the parsed scene: a template, never shown)

/**
 * Loads a pet model (docs/reference/pet-model-spec.md): the glTF scene at `url`, parsed once and
 * kept as a template; each pet shows its own skinned copy (src/pet/chunk/model-pet.js clones it).
 * A failed load is not cached, so a later pet retries.
 * @param {string} url
 * @param {{ loader?: { loadAsync(url: string): Promise<object> }, decoderPath?: string }} [options]
 * @returns {Promise<THREE.Object3D>}
 */
export function loadPetModel(url, { loader, decoderPath } = {}) {
  return cached(pets, url, async () => {
    if (typeof url !== 'string' || !url) throw new Error('dicer: a pet model needs a url');
    const gltf = await (loader ?? (defaultLoader ??= createLoader(decoderPath))).loadAsync(url);
    if (!gltf?.scene || !meshesOf(gltf.scene).length) throw new Error(`dicer: no mesh in ${url}`);
    return gltf.scene;
  });
}

/** Test seam: forgets every cached model (does not dispose them). */
export function clearModelCache() {
  parsed.clear();
  sized.clear();
  pets.clear();
}

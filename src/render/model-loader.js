import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

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

/** Every mesh in a parsed glTF scene, depth first. */
function meshesOf(root) {
  const found = [];
  root?.traverse?.((o) => {
    if (o.isMesh) found.push(o);
  });
  return found;
}

/**
 * The die's one mesh. A die split over several meshes (or several glTF primitives, which
 * GLTFLoader turns into sibling meshes) or over several material groups is refused: Dicer
 * shows one mesh with one material, so the rest of its surface would be missing.
 */
function dieMesh(root, url) {
  const meshes = meshesOf(root);
  if (!meshes.length || !meshes[0].geometry?.attributes?.position) {
    throw new Error(`dicer: no mesh in ${url}`);
  }
  if (meshes.length > 1) throw new Error(`dicer: the die in ${url} is split over ${meshes.length} meshes`);
  const [mesh] = meshes;
  const materials = Array.isArray(mesh.material) ? mesh.material.length : 1;
  if (materials > 1 || mesh.geometry.groups.length > 1) {
    throw new Error(`dicer: the die in ${url} has several material groups`);
  }
  return mesh;
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

/** Parses `url` once: the die's mesh, world transform baked in, recentred, at radius 1. */
function parse(url, loader, decoderPath) {
  return cached(parsed, url, async () => {
    if (typeof url !== 'string' || !url) throw new Error('dicer: a die model needs a url');
    const gltf = await (loader ?? (defaultLoader ??= createLoader(decoderPath))).loadAsync(url);
    const mesh = dieMesh(gltf?.scene, url);
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    const centre = geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x, -centre.y, -centre.z);
    geometry.computeBoundingSphere();
    const r = geometry.boundingSphere.radius;
    if (!(r > 0)) throw new Error(`dicer: the model in ${url} is empty`);
    scaleTo(geometry, 1 / r);
    const material = Array.isArray(mesh.material) ? (mesh.material[0] ?? null) : (mesh.material ?? null);
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

/** Test seam: forgets every cached model (does not dispose them). */
export function clearModelCache() {
  parsed.clear();
  sized.clear();
}

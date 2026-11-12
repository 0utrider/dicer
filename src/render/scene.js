import * as THREE from 'three';
import { createStudioScene, disposeStudioScene } from './studio-env.js';

export const DEFAULT_ENV_RESOLUTION = 256;

export const FOV_DEG = 20;
const SHADOW_Y = 0.01;

/** Radial-gradient blob texture, built once and shared by every shadow instance. */
function makeShadowTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const a = Math.max(0, 1 - d);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
      data[i + 3] = Math.round(255 * a * a * 0.55);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Camera height so a floor rect of halfWidth x halfDepth exactly fills a view of aspect
 * halfWidth/halfDepth at vertical fov FOV_DEG, looking straight down at y = 0.
 */
export function cameraHeightFor(halfDepth, fovDeg = FOV_DEG) {
  return halfDepth / Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
}

/**
 * Builds the scene graph. Everything here is GPU-free, so it is unit-testable in jsdom.
 * The one GPU-dependent step (the PMREM environment) is `setEnvironment(renderer)`:
 * DiceRenderer calls it lazily on the first loop start with a real WebGLRenderer; it
 * generates the map once and reuses it.
 */
export function buildScene({ PMREMGenerator = THREE.PMREMGenerator } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
  camera.up.set(0, 0, -1); // screen-up is -Z, so +X is right and +Z is down-screen

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-3, 8, 4);
  key.castShadow = false;
  scene.add(key);

  function fitArea({ halfWidth, halfDepth }) {
    const h = cameraHeightFor(halfDepth);
    camera.aspect = halfWidth / halfDepth;
    camera.near = h * 0.05;
    camera.far = h * 3;
    camera.position.set(0, h, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
  fitArea({ halfWidth: 1, halfDepth: 1 });

  let envTarget = null;
  let envResolution = 0;
  /**
   * Bakes the procedural studio into a PMREM. Same resolution is a no-op; a different one
   * disposes the old target and regenerates. r184: fromScene(scene, sigma, near, far, { size }).
   */
  function setEnvironment(renderer, { resolution = DEFAULT_ENV_RESOLUTION } = {}) {
    if (envTarget && resolution === envResolution) return;
    // Forget the old target before regenerating: if fromScene throws (e.g. a lost context),
    // neither the no-op guard nor scene.environment may keep pointing at a disposed texture.
    envTarget?.dispose();
    envTarget = null;
    envResolution = 0;
    scene.environment = null;
    const studio = createStudioScene();
    const pmrem = new PMREMGenerator(renderer);
    try {
      envTarget = pmrem.fromScene(studio, 0.02, 0.1, 100, { size: resolution });
    } finally {
      pmrem.dispose();
      disposeStudioScene(studio);
    }
    envResolution = resolution;
    scene.environment = envTarget.texture;
  }

  /** Drops the PMREM target (a GPU resource three does not re-upload after context restore). */
  function resetEnvironment() {
    envTarget?.dispose();
    envTarget = null;
    envResolution = 0;
    scene.environment = null;
  }

  // P9-R16: every blob shadow is one quad of a single mesh, so all of them cost one draw call
  // (30 dice used to draw 30 extra planes, about half of the pool's draw calls). The quads'
  // corners are rewritten each frame; an InstancedMesh would do the same but adds ~3.6 KB of
  // three.js to the world-start bundle. A shadow handle is {follow, index}; releasing one moves
  // the last live shadow into its slot.
  let shadowTex = null;
  let shadowMat = null;
  let shadowMesh = null;
  let shadowCap = 0;
  const live = [];

  function shadowCapacity(n) {
    if (shadowCap >= n) return;
    shadowCap = Math.max(32, 2 * shadowCap);
    const geo = new THREE.BufferGeometry();
    const uv = new Float32Array(shadowCap * 8);
    const index = new Uint32Array(shadowCap * 6);
    for (let q = 0; q < shadowCap; q++) {
      uv.set([0, 1, 1, 1, 1, 0, 0, 0], q * 8);
      const v = q * 4; // corners x-z-, x+z-, x+z+, x-z+, wound to face up
      index.set([v, v + 3, v + 2, v, v + 2, v + 1], q * 6);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(shadowCap * 12), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    if (shadowMesh) {
      scene.remove(shadowMesh);
      shadowMesh.geometry.dispose();
      shadowMesh.geometry = geo;
    } else {
      shadowMesh = new THREE.Mesh(geo, shadowMat);
      shadowMesh.renderOrder = -1;
      shadowMesh.frustumCulled = false; // the quads spread over the floor
      shadowMesh.userData.dicerShadows = true;
    }
  }

  function updateShadows() {
    if (!shadowMesh) return;
    const pos = shadowMesh.geometry.attributes.position;
    const a = pos.array;
    for (let i = 0; i < live.length; i++) {
      const m = live[i].follow;
      const h = (m.geometry?.boundingSphere?.radius ?? 1) * 1.3; // half of the old plane's r * 2.6
      const x = m.position.x;
      const z = m.position.z;
      a.set([x - h, SHADOW_Y, z - h, x + h, SHADOW_Y, z - h, x + h, SHADOW_Y, z + h, x - h, SHADOW_Y, z + h], i * 12);
    }
    pos.needsUpdate = true;
    shadowMesh.geometry.setDrawRange(0, live.length * 6);
    // In the scene only while a shadow is live, like the planes it replaces.
    if (live.length && !shadowMesh.parent) scene.add(shadowMesh);
    else if (!live.length) scene.remove(shadowMesh);
  }

  function shadowFor(mesh) {
    if (!shadowTex) {
      shadowTex = makeShadowTexture();
      shadowMat = new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
      });
    }
    shadowCapacity(live.length + 1);
    const handle = { follow: mesh, index: live.length };
    live.push(handle);
    updateShadows();
    return handle;
  }

  function releaseShadow(handle) {
    const i = handle?.index ?? -1;
    if (live[i] !== handle) return;
    const last = live.pop();
    if (last !== handle) {
      live[i] = last;
      last.index = i;
    }
    handle.index = -1;
    handle.follow = null;
    updateShadows();
  }

  function dispose() {
    live.length = 0;
    if (shadowMesh) {
      scene.remove(shadowMesh);
      shadowMesh.geometry.dispose();
    }
    resetEnvironment();
    shadowTex?.dispose();
    shadowMat?.dispose();
    shadowTex = shadowMat = shadowMesh = null;
    shadowCap = 0;
  }

  return {
    scene,
    camera,
    fitArea,
    setEnvironment,
    resetEnvironment,
    shadowFor,
    releaseShadow,
    updateShadows,
    dispose,
  };
}

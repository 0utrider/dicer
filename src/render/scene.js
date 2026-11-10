import * as THREE from 'three';
import { createStudioScene, disposeStudioScene } from './studio-env.js';

export const DEFAULT_ENV_RESOLUTION = 256;

export const FOV_DEG = 20;
const SHADOW_Y = 0.01;

/** Radial-gradient blob texture, built once and shared by every shadow plane. */
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
    envTarget?.dispose();
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

  // Shadow pool: one shared texture, material and geometry; planes reused after release.
  let shadowTex = null;
  let shadowMat = null;
  let shadowGeo = null;
  const free = [];
  const active = new Set();

  function updateShadows() {
    for (const plane of active) {
      const m = plane.userData.follow;
      if (!m) continue;
      const r = m.geometry?.boundingSphere?.radius ?? 1;
      plane.position.set(m.position.x, SHADOW_Y, m.position.z);
      plane.scale.setScalar(r * 2.6);
    }
  }

  function shadowFor(mesh) {
    if (!shadowTex) {
      shadowTex = makeShadowTexture();
      shadowMat = new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
      });
      shadowGeo = new THREE.PlaneGeometry(1, 1);
      shadowGeo.rotateX(-Math.PI / 2);
    }
    let plane = free.pop();
    if (!plane) {
      plane = new THREE.Mesh(shadowGeo, shadowMat);
      plane.renderOrder = -1;
    }
    plane.userData.follow = mesh;
    plane.visible = true;
    active.add(plane);
    scene.add(plane);
    updateShadows();
    return plane;
  }

  function releaseShadow(plane) {
    if (!active.delete(plane)) return;
    plane.userData.follow = null;
    plane.visible = false;
    scene.remove(plane);
    free.push(plane);
  }

  function dispose() {
    for (const plane of [...active]) releaseShadow(plane);
    for (const plane of free) scene.remove(plane);
    resetEnvironment();
    shadowTex?.dispose();
    shadowMat?.dispose();
    shadowGeo?.dispose();
    shadowTex = shadowMat = shadowGeo = null;
    free.length = 0;
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

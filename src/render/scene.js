import * as THREE from 'three';
import { createStudioScene, disposeStudioScene } from './studio-env.js';

export const DEFAULT_ENV_RESOLUTION = 256;

export const FOV_DEG = 20;
const SHADOW_Y = 0.01;

/**
 * Radial-gradient blob texture, built once and shared by every shadow instance. `rgb` 255: the
 * light pool's white blob (its colour comes from the quad's vertex colour). `peak`: its opacity at
 * the centre (the shadow reads clearly on a busy map; the pool takes its strength from POOL.light).
 */
function makeShadowTexture(rgb = 0, peak = 0.7) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const a = Math.max(0, 1 - d);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = rgb;
      data[i + 3] = Math.round(255 * a ** 1.6 * peak);
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
  // Scene and sun lighting (setLighting): a tinted fill over the studio, off by default.
  const fill = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
  scene.add(fill);

  /**
   * The light the dice are lit by. studio (default): the product-photo studio as baked.
   * Otherwise `intensity` scales the studio (scene.environmentIntensity) and the key light,
   * `tint` ([r, g, b], 0..1) colours the key light and a fill, and `sun` drops the key to a low
   * warm angle with a stronger beam.
   * @param {{tint?: number[], intensity?: number, sun?: boolean}} [light]
   */
  function setLighting({ tint = null, intensity = 1, sun = false } = {}) {
    const k = Math.max(0.05, Math.min(1.5, Number.isFinite(intensity) ? intensity : 1));
    scene.environmentIntensity = k;
    key.position.set(...(sun ? [-7, 5, 3] : [-3, 8, 4]));
    key.color.setRGB(...(tint ?? [1, 1, 1]));
    key.intensity = (sun ? 3.4 : 2.2) * k;
    fill.color.setRGB(...(tint ?? [1, 1, 1]));
    fill.intensity = tint ? 0.6 * k : 0;
  }

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
  // Light pools: a clear die passes coloured light, so the table beside its (lighter) shadow takes
  // its colour. One additive quad per pooled die, in its own mesh (vertex colours), drawn only
  // while one is live; the pool lies away from the key light, a little larger than the shadow.
  let poolTex = null;
  let poolMat = null;
  let poolMesh = null;
  let poolCap = 0;
  const pools = [];
  // light: how bright the pool is by the table (it is added over the map, so it must be strong to show)
  const POOL = { scale: 1.5, dx: 0.35, dz: -0.45, light: 0.75 };

  function poolCapacity(n) {
    if (poolCap >= n) return;
    poolCap = Math.max(16, 2 * poolCap);
    const geo = new THREE.BufferGeometry();
    const uv = new Float32Array(poolCap * 8);
    const index = new Uint32Array(poolCap * 6);
    for (let q = 0; q < poolCap; q++) {
      uv.set([0, 1, 1, 1, 1, 0, 0, 0], q * 8);
      const v = q * 4;
      index.set([v, v + 3, v + 2, v, v + 2, v + 1], q * 6);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(poolCap * 12), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(poolCap * 12), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    if (poolMesh) {
      scene.remove(poolMesh);
      poolMesh.geometry.dispose();
      poolMesh.geometry = geo;
    } else {
      poolTex = makeShadowTexture(255, 1);
      poolMat = new THREE.MeshBasicMaterial({ map: poolTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      poolMesh = new THREE.Mesh(geo, poolMat);
      poolMesh.renderOrder = -1;
      poolMesh.frustumCulled = false;
      poolMesh.userData.dicerPools = true;
    }
  }

  function updatePools() {
    if (!poolMesh) return;
    const pos = poolMesh.geometry.attributes.position;
    const col = poolMesh.geometry.attributes.color;
    for (let i = 0; i < pools.length; i++) {
      const { follow: m, color: c } = pools[i];
      const r = m.geometry?.boundingSphere?.radius ?? 1;
      const h = r * 1.3 * POOL.scale;
      const x = m.position.x + POOL.dx * r;
      const z = m.position.z + POOL.dz * r;
      // brighter the nearer the table: a die in the air casts a fainter pool
      const k = POOL.light * Math.max(0, 1 - Math.max(0, m.position.y - r) / (4 * r));
      pos.array.set([x - h, SHADOW_Y * 1.5, z - h, x + h, SHADOW_Y * 1.5, z - h, x + h, SHADOW_Y * 1.5, z + h, x - h, SHADOW_Y * 1.5, z + h], i * 12);
      for (let v = 0; v < 4; v++) col.array.set([c.r * k, c.g * k, c.b * k], i * 12 + v * 3);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    poolMesh.geometry.setDrawRange(0, pools.length * 6);
    if (pools.length && !poolMesh.parent) scene.add(poolMesh);
    else if (!pools.length) scene.remove(poolMesh);
  }

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
    updatePools();
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

  /**
   * A blob shadow following `mesh` ({position, geometry}). `pool` (a THREE.Color): the die is
   * clear: a light pool in that colour lies beside its shadow.
   */
  function shadowFor(mesh, { pool = null } = {}) {
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
    if (pool) {
      poolCapacity(pools.length + 1);
      handle.pool = { follow: mesh, color: pool, index: pools.length };
      pools.push(handle.pool);
    }
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
    const p = handle.pool;
    if (p && pools[p.index] === p) {
      const lastPool = pools.pop();
      if (lastPool !== p) {
        pools[p.index] = lastPool;
        lastPool.index = p.index;
      }
    }
    handle.pool = null;
    updateShadows();
  }

  function dispose() {
    live.length = 0;
    pools.length = 0;
    if (shadowMesh) {
      scene.remove(shadowMesh);
      shadowMesh.geometry.dispose();
    }
    if (poolMesh) {
      scene.remove(poolMesh);
      poolMesh.geometry.dispose();
    }
    poolTex?.dispose();
    poolMat?.dispose();
    poolTex = poolMat = poolMesh = null;
    poolCap = 0;
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
    setLighting,
    setEnvironment,
    resetEnvironment,
    shadowFor,
    releaseShadow,
    updateShadows,
    dispose,
  };
}

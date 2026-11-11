// Offscreen theme thumbnails (P5-D5, P5-D6): one small WebGLRenderer renders one die per theme,
// one at a time, each in its own idle slice, and the result is cached for the session as an
// object URL. Lazy: lives in the theme-browser chunk. It never touches the live dice canvas.
import * as THREE from 'three';
import { buildScene } from '../render/scene.js';
import { configureRenderer } from '../render/renderer.js';
import { createDiceMaterial } from '../render/dice-material.js';
import { TIERS, flagsFor } from '../render/quality.js';
import { buildDieGeometry } from '../core/chamfer.js';
import { getShape, labelFor } from '../core/dice-shapes.js';
import { restingQuaternion, minY } from '../core/resting.js';
import { appearanceKey } from '../look/appearance.js';

const ENV_RESOLUTION = 128;
/** The face shown on top per type (6 and 9 show the underline mark). */
const SHOWN = { d4: 4, d6: 6, d8: 8, d10: 9, d12: 12, d20: 20, d2: 2 };
const FOV = 26;
const VIEW_DISTANCE = 4.6;
const VIEW_ANGLE = THREE.MathUtils.degToRad(52);

const defaultIdle = (cb) =>
  typeof globalThis.requestIdleCallback === 'function'
    ? globalThis.requestIdleCallback(cb, { timeout: 1000 })
    : setTimeout(cb, 0);

function defaultCreateRenderer(size) {
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size });
  return new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
}

function canvasToBlob(canvas) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob gave no image'))), 'image/png'),
  );
}

/**
 * @param {object} o
 * @param {object} o.atlas the digit atlas (loadDigitAtlas)
 * @param {(size:number)=>THREE.WebGLRenderer} [o.createRenderer]
 * @param {number} [o.size]
 * @param {(cb:Function)=>void} [o.idle]
 * @param {(msg:string)=>void} [o.warn]
 * @param {()=>object} [o.createScene] test seam (headless PMREM)
 */
export function createThumbnailer({
  atlas,
  createRenderer,
  size = 256,
  idle = defaultIdle,
  warn = console.warn,
  createScene = () => buildScene(),
} = {}) {
  const make = createRenderer ?? (() => defaultCreateRenderer(size));
  const cache = new Map(); // key -> object URL
  const inflight = new Map(); // key -> Promise
  let chain = Promise.resolve();
  let renderer = null;
  let sceneApi = null;
  let camera = null;
  let canvas = null;
  let onLost = null;
  let broken = false;
  let disposed = false;
  let flags = null;

  const fail = (message) => {
    if (broken) return;
    broken = true;
    warn(`dicer: theme thumbnails unavailable (${message})`);
  };

  function init() {
    try {
      renderer = configureRenderer(make());
      canvas = renderer.domElement;
      onLost = (e) => {
        e?.preventDefault?.();
        fail('WebGL context lost');
      };
      canvas.addEventListener?.('webglcontextlost', onLost);
      renderer.setPixelRatio(1);
      renderer.setSize(size, size, false);
      renderer.setClearColor(0x000000, 0);
      sceneApi = createScene();
      sceneApi.setEnvironment(renderer, { resolution: ENV_RESOLUTION });
      camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 20);
      flags = flagsFor(TIERS.medium, { interiors: true, engraving: true, glow: true });
    } catch (err) {
      fail(err?.message ?? String(err));
      teardown();
    }
  }

  function teardown() {
    try {
      if (canvas && onLost) canvas.removeEventListener?.('webglcontextlost', onLost);
      sceneApi?.dispose();
      renderer?.dispose();
    } catch {
      /* already gone */
    }
    sceneApi = renderer = camera = canvas = onLost = null;
  }

  async function renderOne(theme, dieType) {
    const appearance = theme.perType?.[dieType] ?? theme.appearance;
    const shapeType = dieType === 'd100' ? 'd10' : dieType;
    const shape = getShape(shapeType);
    const geometry = buildDieGeometry(shape, { style: appearance.edges?.style });
    geometry.computeBoundingSphere();
    const labels = shape.values.map((v) => labelFor(shapeType, v));
    const material = createDiceMaterial(appearance, atlas, shape, labels, flags);
    const mesh = new THREE.Mesh(geometry, material);
    const face = shape.values.indexOf(SHOWN[shapeType] ?? shape.values[shape.values.length - 1]);
    mesh.quaternion.copy(restingQuaternion(shape, Math.max(0, face)));
    mesh.position.y = -minY(geometry, mesh.quaternion);
    const shadow = sceneApi.shadowFor({ position: mesh.position, geometry });
    sceneApi.scene.add(mesh);
    try {
      const target = new THREE.Vector3(0, mesh.position.y * 0.85, 0);
      const dir = new THREE.Vector3(0, Math.sin(VIEW_ANGLE), Math.cos(VIEW_ANGLE));
      camera.position.copy(target).addScaledVector(dir, VIEW_DISTANCE);
      camera.lookAt(target);
      renderer.render(sceneApi.scene, camera);
      return await canvasToBlob(canvas);
    } finally {
      sceneApi.scene.remove(mesh);
      sceneApi.releaseShadow(shadow);
      material.userData?.uniforms?.uLabels?.value?.dispose();
      material.dispose();
      geometry.dispose();
    }
  }

  async function job(theme, dieType, key) {
    await new Promise((resolve) => idle(resolve));
    if (disposed || broken) return null;
    if (!renderer) init();
    if (!renderer || broken) return null;
    try {
      const blob = await renderOne(theme, dieType);
      if (disposed) return null;
      if (broken) return null; // context lost mid-render: the image is not trustworthy
      const url = URL.createObjectURL(blob);
      cache.set(key, url);
      return url;
    } catch (err) {
      warn(`dicer: theme thumbnail failed (${err?.message ?? err})`);
      return null;
    }
  }

  function thumbnail(theme, dieType = 'd20') {
    if (disposed || broken) return Promise.resolve(null);
    const appearance = theme?.perType?.[dieType] ?? theme?.appearance;
    if (!appearance) return Promise.resolve(null);
    const key = `${appearanceKey(appearance)}|${dieType}|${size}`;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (inflight.has(key)) return inflight.get(key);
    const p = chain.then(() => job(theme, dieType, key));
    chain = p.catch(() => null);
    inflight.set(key, p);
    p.finally(() => inflight.delete(key));
    return p;
  }

  function dispose() {
    disposed = true;
    for (const url of cache.values()) URL.revokeObjectURL(url);
    cache.clear();
    teardown();
  }

  return { thumbnail, dispose };
}

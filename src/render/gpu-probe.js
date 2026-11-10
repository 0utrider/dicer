import * as THREE from 'three';
import { createDiceMaterial } from './dice-material.js';
import { buildDieGeometry } from '../core/chamfer.js';
import { getShape, labelFor } from '../core/dice-shapes.js';
import { LOOKS } from '../look/looks.js';
import { TIERS } from './quality.js';

const CACHE_KEY = 'dicer.probe.v1';
const SIZE = 512;
const FALLBACK = Object.freeze({ msPerFrame: 16, gpu: 'unknown' });
const TIMER_WAIT_MS = 1500;

function readCache(gpu) {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) ?? 'null');
    const hit = all?.[gpu];
    return typeof hit?.msPerFrame === 'number' ? hit.msPerFrame : null;
  } catch {
    return null;
  }
}

function writeCache(gpu, msPerFrame) {
  try {
    let all = {};
    try {
      all = JSON.parse(globalThis.localStorage.getItem(CACHE_KEY) ?? '{}') ?? {};
    } catch {
      all = {};
    }
    all[gpu] = { msPerFrame };
    globalThis.localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: the probe just runs again next time
  }
}

/** Mean GPU ms per frame from EXT_disjoint_timer_query_webgl2, or null if unusable. */
async function collectTimers(gl, ext, queries) {
  const deadline = performance.now() + TIMER_WAIT_MS;
  const times = [];
  for (const q of queries) {
    while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
      if (performance.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, 4));
    }
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) return null;
    times.push(Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6);
  }
  return times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
}

/**
 * Measures per-pixel interior cost: 3 resin dice with the nebula interior and the High-tier
 * program (32 steps) fill a 512x512 target, so ray-march cost dominates over draw calls.
 * Never throws; on any error resolves to { msPerFrame: 16, gpu: 'unknown' } (medium).
 * The result is cached in localStorage under dicer.probe.v1, keyed by the GPU string.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {{frames?: number, atlas: object}} opts atlas from loadDigitAtlas()
 */
export async function runProbe(renderer, { frames = 20, atlas } = {}) {
  let target = null;
  let material = null;
  let geometry = null;
  let prevTarget = null;
  try {
    prevTarget = renderer.getRenderTarget?.() ?? null;
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = (info && String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))) || 'unknown';
    const cached = readCache(gpu);
    if (cached !== null) return { msPerFrame: cached, gpu };

    const shape = getShape('d20');
    const labels = shape.values.map((v) => labelFor('d20', v));
    material = createDiceMaterial(LOOKS['galaxy-nebula'].appearance, atlas, shape, labels, {
      interiors: true,
      engraving: true,
      glow: true,
      interiorSteps: TIERS.high.interiorSteps,
    });
    geometry = buildDieGeometry(shape);
    const scene = new THREE.Scene();
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(-3, 8, 4);
    scene.add(light);
    for (const x of [-1.15, 0, 1.15]) {
      const m = new THREE.Mesh(geometry, material);
      m.position.set(x, 0, 0);
      m.rotation.set(0.4 + x * 0.2, 0.7, 0.2);
      scene.add(m);
    }
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);

    target = new THREE.WebGLRenderTarget(SIZE, SIZE);
    renderer.setRenderTarget(target);
    await renderer.compileAsync?.(scene, camera);
    renderer.render(scene, camera); // warm-up frame (program link, uploads)
    gl.finish();

    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const queries = [];
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      let q = null;
      if (ext) {
        q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      }
      renderer.render(scene, camera);
      if (q) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        queries.push(q);
      }
    }
    gl.finish();
    let msPerFrame = (performance.now() - t0) / frames;
    if (ext) {
      try {
        const timed = await collectTimers(gl, ext, queries);
        if (timed !== null && Number.isFinite(timed) && timed > 0) msPerFrame = timed;
      } catch {
        // keep the wall-clock figure
      } finally {
        queries.forEach((q) => gl.deleteQuery(q));
      }
    }
    if (!Number.isFinite(msPerFrame) || msPerFrame <= 0) return { ...FALLBACK, gpu };
    writeCache(gpu, msPerFrame);
    return { msPerFrame, gpu };
  } catch {
    return { ...FALLBACK };
  } finally {
    try {
      renderer.setRenderTarget?.(prevTarget);
    } catch {
      // ignore
    }
    try {
      target?.dispose();
      material?.userData?.uniforms?.uLabels?.value?.dispose?.();
      material?.dispose();
      geometry?.dispose();
    } catch {
      // ignore
    }
  }
}

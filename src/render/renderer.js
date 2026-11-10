import * as THREE from 'three';
import { buildScene, DEFAULT_ENV_RESOLUTION } from './scene.js';
import { cloneForFade } from '../throw/dice-box.js';

const CANVAS_ID = 'dicer-canvas';

/** Product-photo tone mapping; split out so it is testable without WebGL. */
export function configureRenderer(renderer) {
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  return renderer;
}

/**
 * One overlay canvas, created once. Idle = canvas display:none and no rAF pending.
 * Resizing only calls renderer.setSize. Context loss stops the loop and notifies the owner.
 */
export class DiceRenderer {
  #renderer;
  #canvas;
  #raf;
  #caf;
  #cap;
  #tick = null;
  #handle = null;
  #lost = [];
  #restored = [];
  #sceneApi;
  #envResolution = DEFAULT_ENV_RESOLUTION;
  #tierRatio = Infinity;
  #frameTime = [];
  #lastFrameAt = null;
  #onLost;
  #onRestored;

  constructor({
    container,
    createRenderer,
    raf = (cb) => globalThis.requestAnimationFrame(cb),
    caf = (h) => globalThis.cancelAnimationFrame(h),
    pixelRatioCap = 1.5,
  }) {
    this.#raf = raf;
    this.#caf = caf;
    this.#cap = pixelRatioCap;
    const canvas = document.createElement('canvas');
    canvas.id = CANVAS_ID;
    canvas.style.display = 'none';
    container.appendChild(canvas);
    this.#canvas = canvas;
    const make =
      createRenderer ??
      ((c) =>
        new THREE.WebGLRenderer({
          canvas: c,
          antialias: true,
          alpha: true,
          logarithmicDepthBuffer: false,
          powerPreference: 'high-performance',
        }));
    this.#renderer = configureRenderer(make(canvas));
    this.#sceneApi = buildScene();

    this.#onLost = (e) => {
      e.preventDefault();
      this.#stop();
      this.#lost.forEach((cb) => cb());
    };
    this.#onRestored = () => {
      // PMREM targets are not re-uploaded by three after a restore: rebuild on next startLoop.
      this.#sceneApi.resetEnvironment();
      this.#restored.forEach((cb) => cb());
    };
    canvas.addEventListener('webglcontextlost', this.#onLost);
    canvas.addEventListener('webglcontextrestored', this.#onRestored);
  }

  get scene() {
    return this.#sceneApi.scene;
  }
  get camera() {
    return this.#sceneApi.camera;
  }
  /** Scene helpers: fitArea, shadowFor, releaseShadow, updateShadows. */
  get sceneApi() {
    return this.#sceneApi;
  }
  get canvas() {
    return this.#canvas;
  }
  /** Cube resolution for the next environment build (Task 7 sets it per tier). */
  set environmentResolution(n) {
    this.#envResolution = n;
  }
  get isLooping() {
    return this.#tick !== null;
  }
  /** The underlying THREE.WebGLRenderer (for the GPU probe). */
  get glRenderer() {
    return this.#renderer;
  }

  #pixelRatio() {
    return Math.min(globalThis.devicePixelRatio || 1, this.#tierRatio, this.#cap);
  }

  /** Applies a quality tier (see quality.js TIERS); pixelRatioCap stays the upper bound. */
  applyTier(tier) {
    this.#tierRatio = tier.pixelRatio;
    this.#envResolution = tier.envResolution;
    if ('transmissionResolutionScale' in this.#renderer) {
      this.#renderer.transmissionResolutionScale = tier.transmissionScale;
    }
    this.#renderer.setPixelRatio(this.#pixelRatio());
  }

  /** cb(info) when a shader fails to compile or link; info = { gl, program, vertexShader, fragmentShader, log }. */
  onShaderError(cb) {
    const debug = this.#renderer.debug;
    if (!debug) return;
    debug.checkShaderErrors = true;
    debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
      let log = '';
      try {
        log = [
          gl.getProgramInfoLog?.(program),
          gl.getShaderInfoLog?.(vertexShader),
          gl.getShaderInfoLog?.(fragmentShader),
        ]
          .filter(Boolean)
          .join(' | ');
      } catch {
        // ignore: the callback still fires
      }
      cb({ gl, program, vertexShader, fragmentShader, log });
    };
  }

  /** cb(ms) with each rendered frame's tick + render wall time. */
  onFrameTime(cb) {
    this.#frameTime.push(cb);
  }

  /**
   * Compiles the given dice materials and their fade variants ahead of the first roll, via
   * compileAsync. The meshes live in a private scene that is never rendered; the real scene is
   * passed as compileAsync's targetScene so lights and environment match what rolls use.
   * No loop starts.
   */
  async warmup(materials, geometry) {
    if (!this.#renderer.compileAsync) return;
    if (this.#renderer.isWebGLRenderer) {
      this.#sceneApi.setEnvironment(this.#renderer, { resolution: this.#envResolution });
    }
    const fades = materials.map((m) => cloneForFade(m));
    const tmp = new THREE.Scene();
    for (const m of [...materials, ...fades]) {
      const mesh = new THREE.Mesh(geometry, m);
      mesh.frustumCulled = false;
      tmp.add(mesh);
    }
    try {
      await this.#renderer.compileAsync(tmp, this.camera, this.scene);
    } finally {
      tmp.clear();
      // dispose() on a clone only drops its own program refs; userData is shared and untouched.
      for (const f of fades) f.dispose();
    }
  }

  setArea({ left, top, width, height }) {
    const s = this.#canvas.style;
    s.left = `${left}px`;
    s.top = `${top}px`;
    s.width = `${width}px`;
    s.height = `${height}px`;
    this.#renderer.setPixelRatio(this.#pixelRatio());
    this.#renderer.setSize(width, height, false);
  }

  /** Runs rAF while tick(nowMs) returns true. Calling while looping just swaps the tick. */
  startLoop(tick) {
    this.#tick = tick;
    if (this.#handle !== null) return;
    // Lazy GPU-only step; the fake renderer used in tests is not a real WebGLRenderer.
    if (this.#renderer.isWebGLRenderer) this.#sceneApi.setEnvironment(this.#renderer, { resolution: this.#envResolution });
    this.#canvas.style.display = '';
    this.#handle = this.#raf((now) => this.#frame(now));
  }

  #frame(now) {
    this.#handle = null;
    const tick = this.#tick;
    if (!tick) return;
    let again = false;
    const t0 = performance.now();
    const prev = this.#lastFrameAt;
    this.#lastFrameAt = now;
    try {
      again = tick(now);
    } finally {
      // Render the final frame too, then go idle when tick is done (or threw).
      try {
        this.#sceneApi.updateShadows();
        this.#renderer.render(this.scene, this.camera);
        // CPU submit time alone misses GPU-bound frames: also take the rAF interval (capped).
        let ms = performance.now() - t0;
        if (prev !== null && Number.isFinite(now - prev)) ms = Math.max(ms, Math.min(now - prev, 100));
        for (const cb of this.#frameTime) cb(ms);
      } finally {
        if (again && this.#tick) this.#handle = this.#raf((t) => this.#frame(t));
        else this.hide();
      }
    }
  }

  #stop() {
    if (this.#handle !== null) this.#caf(this.#handle);
    this.#handle = null;
    this.#tick = null;
    this.#lastFrameAt = null;
  }

  hide() {
    this.#stop();
    this.#canvas.style.display = 'none';
  }

  onContextLost(cb) {
    this.#lost.push(cb);
  }
  onContextRestored(cb) {
    this.#restored.push(cb);
  }

  dispose() {
    this.hide();
    this.#canvas.removeEventListener('webglcontextlost', this.#onLost);
    this.#canvas.removeEventListener('webglcontextrestored', this.#onRestored);
    this.#sceneApi.dispose();
    this.#renderer.dispose();
    this.#canvas.remove();
  }
}

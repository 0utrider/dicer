import * as THREE from 'three';
import { buildScene, DEFAULT_ENV_RESOLUTION } from './scene.js';
import { cloneForFade } from '../throw/dice-box.js';
import { compileGuarded, COMPILE_TIMEOUT_MS } from './compile-guard.js';

const CANVAS_ID = 'dicer-canvas';
/** Unresolved GPU timer queries kept at most; the next frames go unmeasured past it. */
const MAX_PENDING_QUERIES = 8;

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
  #gpu = undefined; // { gl, ext } | null (no timer) | undefined (not looked up yet)
  #queries = [];
  #gpuMs = null;
  #compileTimeoutMs;
  #frameCount = 0;
  #generation = 0;

  constructor({
    container,
    createRenderer,
    raf = (cb) => globalThis.requestAnimationFrame(cb),
    caf = (h) => globalThis.cancelAnimationFrame(h),
    pixelRatioCap = 1.5,
    compileTimeoutMs = COMPILE_TIMEOUT_MS,
  }) {
    this.#raf = raf;
    this.#caf = caf;
    this.#cap = pixelRatioCap;
    this.#compileTimeoutMs = compileTimeoutMs;
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
      this.#gpu = undefined; // extensions must be fetched again on the restored context
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
  /** Rendered frames since construction (benchmark probe; one integer add per frame). */
  get frameCount() {
    return this.#frameCount;
  }
  /**
   * Bumped only when the WebGLRenderer or the canvas is replaced. Nothing replaces them today (a
   * restored context reuses both, a resize only calls setSize), so it stays 0: a benchmark that
   * sees it change has caught a rebuild.
   */
  get generation() {
    return this.#generation;
  }
  /** GPU resources three holds right now: { geometries, textures, programs }. */
  resourceCounts() {
    const info = this.#renderer.info;
    return {
      geometries: info?.memory?.geometries ?? 0,
      textures: info?.memory?.textures ?? 0,
      programs: info?.programs?.length ?? 0,
    };
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

  /**
   * cb(ms, { interval, cpu, gpu }) per rendered frame: ms = max(tick + render wall time, rAF
   * interval capped at 100 ms); interval is undefined on a loop's first frame; gpu is the
   * latest resolved GPU timer query in ms (a few frames behind), or null without the timer.
   */
  onFrameTime(cb) {
    this.#frameTime.push(cb);
  }

  /**
   * Compiles the given dice materials and their fade variants ahead of the first roll, via
   * compileAsync. The meshes live in a private scene that is never rendered; the real scene is
   * passed as compileAsync's targetScene so lights and environment match what rolls use.
   * No loop starts. Rejects (CompileAbortedError) when the context is lost mid-compile or the
   * compile outlasts compileTimeoutMs (10 s), so the caller's cleanup always runs.
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
      await compileGuarded(this.#renderer, tmp, this.camera, this.scene, {
        canvas: this.#canvas,
        timeoutMs: this.#compileTimeoutMs,
      });
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
        this.#timedRender();
        this.#frameCount += 1;
        // CPU submit time alone misses GPU-bound frames: also take the rAF interval (capped).
        const cpu = performance.now() - t0;
        const interval = prev !== null && Number.isFinite(now - prev) ? Math.min(now - prev, 100) : undefined;
        const ms = interval === undefined ? cpu : Math.max(cpu, interval);
        const sample = { interval, cpu, gpu: this.#pollGpuTime() };
        for (const cb of this.#frameTime) cb(ms, sample);
      } finally {
        if (again && this.#tick) this.#handle = this.#raf((t) => this.#frame(t));
        else this.hide();
      }
    }
  }

  /** The GPU timer (EXT_disjoint_timer_query_webgl2), looked up once; null when unavailable. */
  #timer() {
    if (this.#gpu === undefined) {
      try {
        const gl = this.#renderer.getContext?.();
        const ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2');
        this.#gpu = ext ? { gl, ext } : null;
      } catch {
        this.#gpu = null;
      }
    }
    return this.#gpu;
  }

  /** Renders the frame, inside a GPU timer query when the extension exists (P2-R13). */
  #timedRender() {
    const t = this.#queries.length < MAX_PENDING_QUERIES ? this.#timer() : null;
    let q = null;
    if (t) {
      try {
        q = t.gl.createQuery();
        t.gl.beginQuery(t.ext.TIME_ELAPSED_EXT, q);
      } catch {
        q = null;
      }
    }
    try {
      this.#renderer.render(this.scene, this.camera);
    } finally {
      if (q) {
        try {
          t.gl.endQuery(t.ext.TIME_ELAPSED_EXT);
          this.#queries.push(q);
        } catch {
          // a failed query is simply not measured
        }
      }
    }
  }

  /**
   * Latest resolved GPU ms (a few frames behind; non-blocking), or null. A disjoint event
   * (e.g. a GPU clock change) invalidates every pending result.
   */
  #pollGpuTime() {
    const t = this.#gpu;
    if (!t || !this.#queries.length) return this.#gpuMs;
    const { gl, ext } = t;
    try {
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        this.#dropQueries();
        return null;
      }
      while (this.#queries.length && gl.getQueryParameter(this.#queries[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = this.#queries.shift();
        this.#gpuMs = Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6;
        gl.deleteQuery(q);
      }
    } catch {
      this.#dropQueries();
    }
    return this.#gpuMs;
  }

  #dropQueries() {
    const gl = this.#gpu?.gl;
    for (const q of this.#queries.splice(0)) {
      try {
        gl?.deleteQuery(q);
      } catch {
        // context lost: nothing to free
      }
    }
    this.#gpuMs = null;
  }

  #stop() {
    if (this.#handle !== null) this.#caf(this.#handle);
    this.#handle = null;
    this.#tick = null;
    this.#lastFrameAt = null;
    this.#dropQueries(); // idle: no query left pending, and no stale GPU time for the next roll
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

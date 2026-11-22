import * as THREE from 'three';
import { buildScene, DEFAULT_ENV_RESOLUTION } from './scene.js';
import { cloneForFade } from '../throw/dice-box.js';
import { compileGuarded, COMPILE_TIMEOUT_MS } from './compile-guard.js';

const CANVAS_ID = 'dicer-canvas';
/** Unresolved GPU timer queries kept at most; the next frames go unmeasured past it. */
const MAX_PENDING_QUERIES = 8;
/** After a context loss, how long to wait before asking the browser to give it back. */
const RESTORE_DELAY_MS = 250;

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
  // P9-R18: the tick answered 'hold': the last frame stays on screen, no frame is pending.
  #holding = false;
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
      this.hide(); // a lost canvas shows as a white sheet with the browser's crash icon
      this.#lost.forEach((cb) => cb());
      // The browser restores a context lost to a GPU reset by itself, but not one it evicted for
      // having too many (Chrome keeps 16): that one comes back only on request.
      this.#restoreSoon();
    };
    this.#onRestored = () => {
      this.#gpu = undefined; // extensions must be fetched again on the restored context
      // PMREM targets are not re-uploaded by three after a restore: rebuild on next startLoop.
      this.#sceneApi.resetEnvironment();
      this.#restored.forEach((cb) => cb());
      this.requestFrame(); // a held frame was lost with the context
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
  /** P9-R18: dice at rest on screen, the loop paused until startLoop or requestFrame. */
  get isHolding() {
    return this.#holding;
  }

  /**
   * P9-R18: while held, draw one more frame (the tick runs and may hold again); nothing while
   * looping (the loop draws anyway) or idle (nothing is shown). For changes to resting dice: a
   * resize, a tier or material change, a restored context.
   */
  requestFrame() {
    if (!this.#holding || this.#handle !== null || !this.#tick) return;
    this.#holding = false;
    this.#handle = this.#raf((now) => this.#frame(now));
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
  /** False when shaders compile on the main thread (no KHR_parallel_shader_compile), else true. */
  get parallelCompile() {
    try {
      return this.#renderer.extensions?.has?.('KHR_parallel_shader_compile') !== false;
    } catch {
      return true;
    }
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
    this.requestFrame();
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
  async warmup(materials, geometry, keptFades = null) {
    if (!this.#renderer.compileAsync) return;
    if (this.#renderer.isWebGLRenderer) {
      this.#sceneApi.setEnvironment(this.#renderer, { resolution: this.#envResolution });
    }
    // The DiceBox's kept fade clones stay alive (and so their programs); clones made here would
    // drop the fade programs again when disposed.
    const fades = keptFades ?? materials.map((m) => cloneForFade(m));
    try {
      await this.#compileApart([...materials, ...fades].map((m) => new THREE.Mesh(geometry, m)));
    } finally {
      // dispose() on a clone only drops its own program refs; userData is shared and untouched.
      if (!keptFades) for (const f of fades) f.dispose();
    }
  }

  /**
   * Compiles the programs of objects that already live in the scene (the effect layer's
   * particle meshes), off the hot path and without starting a loop. Shallow clones (sharing
   * geometry and material, so the same programs) go in a private scene targeting the real one;
   * the originals are not moved. Rejects like warmup() on a context loss or a timeout.
   * @param {THREE.Object3D[]} objects
   */
  async warmObjects(objects) {
    return this.#compileApart(objects.map((o) => o.clone(false)));
  }

  /**
   * Compiles meshes from a private scene that is never rendered, targeting the real one, then
   * uses each program once (getUniforms: three's first use, which asks the link status). Without
   * KHR_parallel_shader_compile three counts a program ready at once, and Firefox only compiles
   * it at that first use: a warmed fade program froze the page as the dice faded.
   */
  async #compileApart(meshes) {
    if (!this.#renderer.compileAsync || !meshes.length) return;
    const tmp = new THREE.Scene();
    for (const m of meshes) {
      m.frustumCulled = false;
      tmp.add(m);
    }
    try {
      await compileGuarded(this.#renderer, tmp, this.camera, this.scene, {
        canvas: this.#canvas,
        timeoutMs: this.#compileTimeoutMs,
      });
      for (const m of meshes) this.#renderer.properties?.get(m.material)?.currentProgram?.getUniforms?.();
    } finally {
      tmp.clear();
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
    this.requestFrame(); // setSize cleared the drawing buffer
  }

  /**
   * Runs rAF while tick(nowMs) returns true; 'hold' draws that frame and pauses with the dice
   * shown (P9-R18), anything falsy draws it and hides. Calling while looping just swaps the
   * tick; calling while held resumes.
   */
  startLoop(tick) {
    if (this.isContextLost) {
      // Never show a lost canvas; ask for it back (onRestored wakes the box).
      this.#restoreSoon();
      return;
    }
    this.#tick = tick;
    if (this.#handle !== null) return;
    this.#holding = false;
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
        const { gpu, pending } = this.#pollGpuTime();
        const sample = { interval, cpu, gpu, ...(pending ? { gpuPending: true } : {}) };
        for (const cb of this.#frameTime) cb(ms, sample);
      } finally {
        if (again === 'hold' && this.#tick) {
          this.#holding = true;
          this.#lastFrameAt = null; // the pause is not a slow frame for the adaptive quality
        } else if (again && this.#tick) this.#handle = this.#raf((t) => this.#frame(t));
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
   * {gpu, pending}: the GPU ms of a query that resolved now (a few frames behind; non-blocking),
   * else pending; gpu null without a timer. A disjoint event (e.g. a GPU clock change)
   * invalidates every pending result.
   */
  #pollGpuTime() {
    // P9-R19: a GPU time is reported once, on the frame its query resolves. The latest result
    // used to be repeated on every frame until the next one arrived (a few frames later), so one
    // slow GPU frame counted several times in the quality window and could drop a tier.
    const t = this.#gpu;
    if (!t) return { gpu: null, pending: false }; // no timer: the EMA path judges
    let fresh;
    if (this.#queries.length) {
      const { gl, ext } = t;
      try {
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
          this.#dropQueries();
        } else {
          while (this.#queries.length && gl.getQueryParameter(this.#queries[0], gl.QUERY_RESULT_AVAILABLE)) {
            const q = this.#queries.shift();
            fresh = Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6;
            gl.deleteQuery(q);
          }
        }
      } catch {
        this.#dropQueries();
      }
    }
    return Number.isFinite(fresh) ? { gpu: fresh, pending: false } : { gpu: undefined, pending: true };
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
  }

  #stop() {
    if (this.#handle !== null) this.#caf(this.#handle);
    this.#handle = null;
    this.#tick = null;
    this.#holding = false;
    this.#lastFrameAt = null;
    this.#dropQueries(); // idle: no query left pending, and no stale GPU time for the next roll
  }

  hide() {
    this.#stop();
    this.#canvas.style.display = 'none';
  }

  /** True while the WebGL context is lost (false for a renderer without a context, as in tests). */
  get isContextLost() {
    try {
      return !!this.#renderer.getContext?.()?.isContextLost?.();
    } catch {
      return false;
    }
  }

  #restoreTimer = null;
  #restoreSoon() {
    if (this.#restoreTimer !== null) return;
    this.#restoreTimer = setTimeout(() => {
      this.#restoreTimer = null;
      // three keeps WEBGL_lose_context from before the loss (a lost context hands out no
      // extensions); restoring a context that is not lost, or one the browser will not give
      // back, is a no-op or a GL error, never a throw we need.
      if (this.isContextLost) {
        try {
          this.#renderer.forceContextRestore?.();
        } catch {
          /* the browser keeps it lost; the next roll asks again */
        }
      }
    }, RESTORE_DELAY_MS);
  }

  onContextLost(cb) {
    this.#lost.push(cb);
  }
  onContextRestored(cb) {
    this.#restored.push(cb);
  }

  dispose() {
    clearTimeout(this.#restoreTimer);
    this.#restoreTimer = null;
    this.hide();
    this.#canvas.removeEventListener('webglcontextlost', this.#onLost);
    this.#canvas.removeEventListener('webglcontextrestored', this.#onRestored);
    this.#sceneApi.dispose();
    this.#renderer.dispose();
    this.#canvas.remove();
  }
}

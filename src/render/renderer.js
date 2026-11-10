import * as THREE from 'three';
import { buildScene } from './scene.js';

const CANVAS_ID = 'dicer-canvas';

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
    this.#renderer = make(canvas);
    this.#sceneApi = buildScene();

    this.#onLost = (e) => {
      e.preventDefault();
      this.#stop();
      this.#lost.forEach((cb) => cb());
    };
    this.#onRestored = () => this.#restored.forEach((cb) => cb());
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
  get isLooping() {
    return this.#tick !== null;
  }

  setArea({ left, top, width, height }) {
    const s = this.#canvas.style;
    s.left = `${left}px`;
    s.top = `${top}px`;
    s.width = `${width}px`;
    s.height = `${height}px`;
    this.#renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, this.#cap));
    this.#renderer.setSize(width, height, false);
  }

  /** Runs rAF while tick(nowMs) returns true. Calling while looping just swaps the tick. */
  startLoop(tick) {
    this.#tick = tick;
    if (this.#handle !== null) return;
    // Lazy GPU-only step; the fake renderer used in tests is not a real WebGLRenderer.
    if (this.#renderer.isWebGLRenderer) this.#sceneApi.setEnvironment(this.#renderer);
    this.#canvas.style.display = '';
    this.#handle = this.#raf((now) => this.#frame(now));
  }

  #frame(now) {
    this.#handle = null;
    const tick = this.#tick;
    if (!tick) return;
    let again = false;
    try {
      again = tick(now);
    } finally {
      // Render the final frame too, then go idle when tick is done (or threw).
      try {
        this.#sceneApi.updateShadows();
        this.#renderer.render(this.scene, this.camera);
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

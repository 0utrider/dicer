import * as THREE from 'three';
import { getShape, labelFor } from '../core/dice-shapes.js';
import { buildDieGeometry } from '../core/chamfer.js';
import { createDiceMaterial } from '../render/dice-material.js';
import { normalizeAppearance } from '../look/appearance.js';
import { Playback } from './playback.js';
import { MAX_STEPS, STEP_SECONDS } from '../physics/protocol.js';

/** Die edge size on screen, in CSS px, at diceScale 1. One world unit is one die size. */
export const DIE_SIZE_PX = 48;
export const FADE_MS = 400;
const DEFAULT_LINGER_MS = 2000;
/** R12 stall timeouts, measured from roll(). */
export const FIRST_CHUNK_TIMEOUT_MS = 5000;
export const DONE_TIMEOUT_MS = 15000;
/** After done: a roll that has not landed by its playback duration plus this fails. */
export const LANDING_GRACE_MS = 3000;

/**
 * Clone a cached die material for the fade. Material.clone() deep-copies userData through
 * JSON, which would serialise the label and atlas textures, so userData is shared instead
 * (the clone never writes to it). The original is left exactly as it was.
 */
export function cloneForFade(material) {
  const userData = material.userData;
  material.userData = {};
  let clone;
  try {
    clone = material.clone();
  } finally {
    material.userData = userData;
  }
  clone.userData = userData;
  clone.onBeforeCompile = material.onBeforeCompile;
  clone.customProgramCacheKey = material.customProgramCacheKey;
  clone.defines = { ...material.defines }; // clone() resets them to three's own
  clone.transparent = true;
  clone.depthWrite = false;
  return clone;
}

/**
 * Orchestrates rolls: physics stream -> Playback -> scene, on one shared render loop.
 * Each roll resolves `landed` once its dice come to rest and `finished` after the linger
 * (timeBeforeHide) and a 400 ms fade. When no roll remains the tick returns false, so the
 * renderer stops and hides its canvas.
 */
export class DiceBox {
  constructor({
    renderer,
    physics,
    atlas,
    appearance,
    getArea,
    diceScale = () => 1,
    timeBeforeHide = () => DEFAULT_LINGER_MS,
    visibility = globalThis.document,
  }) {
    this._renderer = renderer;
    this._physics = physics;
    this._atlas = atlas;
    this._appearance = appearance; // createDiceMaterial normalizes it
    this._edgeStyle = normalizeAppearance(appearance).edges.style;
    this._getArea = getArea;
    this._diceScale = diceScale;
    this._timeBeforeHide = timeBeforeHide;
    this._geometries = new Map(); // type|edge style -> BufferGeometry (P2-R5)
    this._materials = new Map(); // body|type|variant -> material
    this._rolls = new Set();
    this._area = null;
    this._tick = (now) => this.#frame(now);
    this.onResize();
    renderer.onContextLost?.(() => this.clear());
    // A hidden tab gets no animation frames, so nothing could land: drop every roll.
    this._visibility = visibility ?? null;
    this._onVisibility = () => {
      if (this._visibility?.hidden) this.clear();
    };
    this._visibility?.addEventListener?.('visibilitychange', this._onVisibility);
  }

  get activeRolls() {
    return this._rolls.size;
  }

  /** Refit the camera, physics walls and canvas to getArea(), in die units. */
  onResize() {
    const rect = this._getArea();
    const px = DIE_SIZE_PX * this._diceScale();
    this._area = { halfWidth: rect.width / 2 / px, halfDepth: rect.height / 2 / px };
    this._renderer.sceneApi.fitArea(this._area);
    this._physics.resize(this._area);
    this._renderer.setArea(rect);
  }

  /** @param {import('./throw-planner.js').DieSpec[]} specs */
  roll(specs) {
    const roll = { dice: [], shadows: [], fades: null, phase: 'playing', removed: false };
    roll.landed = new Promise((r) => (roll.resolveLanded = r));
    roll.finished = new Promise((r) => (roll.resolveFinished = r));
    const result = { landed: roll.landed, finished: roll.finished };
    // Empty, or a hidden tab (no animation frames would ever land it): resolve at once.
    if (!specs?.length || this._visibility?.hidden === true) {
      roll.resolveLanded();
      roll.resolveFinished();
      return result;
    }
    this._rolls.add(roll);
    try {
      for (const spec of specs) roll.dice.push(this.#makeDie(spec));
      for (const die of roll.dice) this._renderer.scene.add(die.outer);
      roll.playback = new Playback({ dice: roll.dice, area: this._area });
      roll.received = 0;
      const seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
      const stream = this._physics.throw({ dice: specs.map((s) => ({ type: s.type })), seed });
      // Stall guards (R12): a worker that never answers must not keep a roll alive.
      roll.firstChunkTimer = setTimeout(
        () => this.#fail(roll, new Error(`no physics chunk within ${FIRST_CHUNK_TIMEOUT_MS} ms`)),
        FIRST_CHUNK_TIMEOUT_MS,
      );
      roll.doneTimer = setTimeout(
        () => this.#fail(roll, new Error(`physics not done within ${DONE_TIMEOUT_MS} ms`)),
        DONE_TIMEOUT_MS,
      );
      stream.onChunk((chunk) => {
        if (roll.removed) {
          this._physics.recycle(chunk.data);
          return;
        }
        let pushed = false;
        try {
          roll.playback.push(chunk);
          pushed = true;
          roll.received += 1;
          if (chunk.done) clearTimeout(roll.doneTimer);
          if (roll.received === 1) {
            clearTimeout(roll.firstChunkTimer);
            // The loop starts only once there is a frame to draw (zero idle GPU work).
            this._renderer.startLoop(this._tick);
          }
        } catch (err) {
          if (!pushed) this._physics.recycle(chunk.data);
          this.#fail(roll, err);
        }
      });
      stream.done.then(
        (res) => this.#armLandingTimer(roll, res?.settledStep),
        (err) => this.#fail(roll, err),
      );
    } catch (err) {
      this.#fail(roll, err);
    }
    return result;
  }

  /** Remove every die now and resolve every pending promise. */
  clear() {
    for (const roll of [...this._rolls]) this.#finish(roll);
    this._renderer.hide?.();
  }

  /** Clear, stop listening, then free the cached geometries and materials. */
  dispose() {
    this._visibility?.removeEventListener?.('visibilitychange', this._onVisibility);
    this.clear();
    for (const g of this._geometries.values()) g.dispose();
    for (const m of this._materials.values()) {
      m.userData.uniforms?.uLabels.value.dispose();
      m.dispose();
    }
    this._geometries.clear();
    this._materials.clear();
  }

  #geometry(type) {
    const style = this._edgeStyle;
    const key = `${type}|${style}`;
    let geo = this._geometries.get(key);
    if (!geo) {
      geo = buildDieGeometry(getShape(type), { style });
      geo.computeBoundingSphere(); // the blob shadow scales by it
      this._geometries.set(key, geo);
    }
    return geo;
  }

  #material(type, variant) {
    const key = `${this._appearance.body}|${type}|${variant ?? ''}`;
    let mat = this._materials.get(key);
    if (!mat) {
      const shape = getShape(type);
      const labels = shape.values.map((v) =>
        variant === 'd100tens' ? labelFor(type, v * 10, variant) : labelFor(type, v),
      );
      mat = createDiceMaterial(this._appearance, this._atlas, shape, labels);
      this._materials.set(key, mat);
    }
    return mat;
  }

  #makeDie(spec) {
    const shape = getShape(spec.type);
    const geometry = this.#geometry(spec.type);
    const inner = new THREE.Mesh(geometry, this.#material(spec.type, spec.variant));
    const outer = new THREE.Group();
    outer.userData.dicerDie = true;
    outer.visible = false; // at the origin until Playback places it
    outer.add(inner);
    const targetValue = spec.variant === 'd100tens' ? spec.value / 10 || 10 : spec.value;
    return { outer, inner, shape, targetValue, geometry };
  }

  /** Shows a roll's dice (and their shadows) once Playback has placed them. */
  #reveal(roll) {
    for (const die of roll.dice) {
      die.outer.visible = true;
      // The shadow follows the outer group's position and scales by the geometry's sphere.
      const follow = { position: die.outer.position, geometry: die.geometry };
      roll.shadows.push(this._renderer.sceneApi.shadowFor(follow));
    }
    roll.revealed = true;
  }

  /**
   * Landing guard that needs no animation frames: once physics is done, the roll must land
   * within its playback duration (settledStep steps at the playback speed) plus a grace.
   */
  #armLandingTimer(roll, settledStep) {
    if (roll.removed || roll.phase !== 'playing') return;
    const steps = Number.isFinite(settledStep) ? settledStep : MAX_STEPS;
    const speed = roll.playback?.speed || 1;
    const ms = Math.ceil((steps * STEP_SECONDS * 1000) / speed) + LANDING_GRACE_MS;
    roll.landingTimer = setTimeout(
      () => this.#fail(roll, new Error(`dice did not land within ${ms} ms of physics done`)),
      ms,
    );
  }

  #land(roll) {
    clearTimeout(roll.landingTimer);
    roll.phase = 'lingering';
    roll.resolveLanded();
    roll.timer = setTimeout(() => {
      if (roll.removed) return;
      roll.phase = 'fading';
      roll.fadeStart = null;
      roll.fades = roll.dice.map((die) => {
        const original = die.inner.material;
        die.inner.material = cloneForFade(original);
        return die.inner.material;
      });
      this._renderer.startLoop(this._tick); // restarts the loop if it was stopped meanwhile
    }, this._timeBeforeHide() ?? DEFAULT_LINGER_MS);
  }

  #frame(now) {
    for (const roll of [...this._rolls]) {
      try {
        if (roll.phase === 'playing') {
          const hadFrames = roll.received > 0;
          const state = roll.playback.update(now);
          if (hadFrames && !roll.revealed) this.#reveal(roll);
          if (state === 'landed') this.#land(roll);
        } else if (roll.phase === 'fading') {
          roll.fadeStart ??= now;
          const t = Math.min(1, (now - roll.fadeStart) / FADE_MS);
          for (const m of roll.fades) m.opacity = 1 - t;
          if (t >= 1) this.#finish(roll);
        }
      } catch (err) {
        this.#fail(roll, err);
      }
    }
    return this._rolls.size > 0;
  }

  #fail(roll, err) {
    if (roll.removed) return;
    console.error('dicer: roll failed', err);
    this.#finish(roll);
  }

  /** Removes a roll's dice and shadows, recycles its buffers, resolves both promises. */
  #finish(roll) {
    if (roll.removed) return;
    roll.removed = true;
    this._rolls.delete(roll);
    clearTimeout(roll.timer);
    clearTimeout(roll.firstChunkTimer);
    clearTimeout(roll.doneTimer);
    clearTimeout(roll.landingTimer);
    const scene = this._renderer.scene;
    for (const die of roll.dice) scene.remove(die.outer);
    for (const plane of roll.shadows) this._renderer.sceneApi.releaseShadow(plane);
    for (const m of roll.fades ?? []) m.dispose();
    if (roll.playback) {
      for (const data of roll.playback.release()) this._physics.recycle(data);
      roll.playback = null;
    }
    roll.resolveLanded();
    roll.resolveFinished();
  }
}

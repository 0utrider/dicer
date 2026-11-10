import * as THREE from 'three';
import { getShape, labelFor } from '../core/dice-shapes.js';
import { buildDieGeometry } from '../core/chamfer.js';
import { createDiceMaterial, DEFAULT_FLAGS } from '../render/dice-material.js';
import {
  DEFAULT_APPEARANCE,
  appearanceKey,
  normalizeAppearance,
  programKey,
} from '../look/appearance.js';
import { GHOST_APPEARANCE } from '../compat/colorset-map.js';
import { modelRotationFor } from '../compat/dsn-orientation.js';
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
 * Longest wait for a roll's face layers and models (face-textures caps each image at 4000 ms;
 * the margin lets that cap win). Past it the roll plays with whatever has arrived and the rest
 * falls back, even if a loader never settles.
 */
export const ASSET_WAIT_MS = 4250;
/** Dice So Nice's built-in system id: its presets share Dicer's plain material cache. */
const STANDARD_SYSTEM = 'standard';
/** Die types whose materials acquireWarmup() builds by default. */
export const WARMUP_TYPES = Object.freeze(['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);

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

/** GLTF loading lives in its own chunk, fetched the first time a roll shows a model. */
const importModel = (url, options) =>
  import('../render/model-loader.js').then((m) => m.loadDieModel(url, options));

/** True when a face set has image or text faces (drawn from face layers). */
function needsLayers(faces) {
  return Array.isArray(faces?.labels) && faces.labels.some((l) => l?.kind === 'image' || l?.kind === 'text');
}

/** An id per face-texture result: a layered material is keyed to the texture it samples. */
const faceTexIds = new WeakMap();
let nextFaceTexId = 1;
function faceTexId(faceTex) {
  if (!faceTexIds.has(faceTex)) faceTexIds.set(faceTex, nextFaceTexId++);
  return faceTexIds.get(faceTex);
}

/**
 * Orchestrates rolls: physics stream -> Playback -> scene, on one shared render loop.
 * Each roll resolves `landed` once its dice come to rest and `finished` after the linger
 * (timeBeforeHide) and a 400 ms fade. When no roll remains the tick returns false, so the
 * renderer stops and hides its canvas.
 *
 * Each roll snapshots the look (getAppearance) and feature flags (getFlags) when it starts.
 * Materials are cached by appearanceKey|programKey|type|variant|faces.key|ghost and refcounted per roll:
 * invalidateMaterials() drops them from the cache and marks them stale, and a stale material
 * is disposed when the last roll (or warm-up) holding it lets go.
 */
export class DiceBox {
  constructor({
    renderer,
    physics,
    atlas,
    appearance,
    getAppearance,
    getFlags = () => DEFAULT_FLAGS,
    shadows = () => true,
    getArea,
    diceScale = () => 1,
    timeBeforeHide = () => DEFAULT_LINGER_MS,
    visibility = globalThis.document,
    faceTextures = null,
    faceLayers = () => true,
    loadModel = importModel,
    modelPresets = () => true,
    onModelLoaded = () => {},
    presetFor = () => null,
    onMaterial = () => {},
  }) {
    this._renderer = renderer;
    this._physics = physics;
    this._atlas = atlas;
    // The fixed `appearance` option (Plan 1) is kept as a constant getter.
    this._getAppearance = getAppearance ?? (() => appearance ?? DEFAULT_APPEARANCE);
    this._getFlags = getFlags;
    this._shadows = shadows;
    this._getArea = getArea;
    this._diceScale = diceScale;
    this._timeBeforeHide = timeBeforeHide;
    this._faceTextures = faceTextures; // face-textures.js; null: text/image faces show numbers
    this._faceLayers = faceLayers; // the presetFaces setting
    this._loadModel = loadModel; // (url, { radius }) -> Promise<{ geometry, material }>
    this._modelPresets = modelPresets; // the presetModels setting
    this._onModelLoaded = onModelLoaded; // (url) after a successful load: registry.noteModelLoaded
    this._presetFor = presetFor; // (system, dsnType) -> registry preset or null
    // (material, dsnType, appearance, preset) once per material built for a die with a preset
    // (main.js: diceSoNiceOnMaterialReady for non-standard systems, P3-R3)
    this._onMaterial = onMaterial;
    this._geometries = new Map(); // type|edge style -> BufferGeometry (P2-R5)
    this._materials = new Map(); // appearanceKey|programKey|type|variant|faces.key|ghost -> material
    this._refs = new Map(); // material -> { refs, stale }, cached and stale materials alike
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
    const roll = {
      dice: [],
      shadows: [],
      fades: null,
      materials: new Set(),
      phase: 'playing',
      removed: false,
    };
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
      const rollLook = normalizeAppearance(this._getAppearance());
      const flags = this.#flags();
      roll.flags = flags;
      for (const spec of specs) roll.dice.push(this.#makeDie(spec, roll, flags, rollLook));
      this.#acquireAssets(roll);
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
            if (!roll.assetsPending) this._renderer.startLoop(this._tick);
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

  /** Clear, stop listening, then free the cached geometries and every live material. */
  dispose() {
    this._visibility?.removeEventListener?.('visibilitychange', this._onVisibility);
    this.clear();
    for (const g of this._geometries.values()) g.dispose();
    for (const m of [...this._refs.keys()]) this.#disposeMaterial(m);
    this._geometries.clear();
    this._materials.clear();
  }

  /**
   * Drops every cached material and marks it stale; the next roll builds fresh ones for the
   * current look and flags. Rolls in flight keep theirs, and each stale material is disposed
   * when its last holder finishes (now, if nothing holds it).
   * With replaceInFlight (a shader failure), rolling and fading dice are moved onto rebuilt
   * materials right away (their own look, the current flags), so they never go invisible.
   */
  invalidateMaterials({ replaceInFlight = false } = {}) {
    for (const m of this._materials.values()) this._refs.get(m).stale = true;
    this._materials.clear();
    if (replaceInFlight) {
      const flags = this.#flags();
      for (const roll of this._rolls) this.#rematerialize(roll, flags);
    }
    for (const [m, entry] of [...this._refs])
      if (entry.stale && entry.refs <= 0) this.#disposeMaterial(m);
  }

  /**
   * Materials of the current look and flags for `types`, held until release() so an
   * invalidation during the async compile cannot dispose them. The geometry is the d20 of the
   * look's edge style: every die type shares one program per programKey, and the program does
   * not depend on the geometry (all dice have the same attributes).
   */
  acquireWarmup(types = WARMUP_TYPES) {
    const appearance = normalizeAppearance(this._getAppearance());
    const flags = this.#flags();
    const materials = [...new Set(types.map((t) => this.#material(appearance, flags, t)))];
    for (const m of materials) this.#retain(m);
    let released = false;
    return {
      materials,
      geometry: this.#geometry('d20', appearance.edges.style),
      release: () => {
        if (released) return;
        released = true;
        for (const m of materials) this.#release(m);
      },
    };
  }

  #flags() {
    return { ...DEFAULT_FLAGS, ...this._getFlags() };
  }

  #retain(material) {
    this._refs.get(material).refs++;
  }

  #release(material) {
    const entry = this._refs.get(material);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;
    if (entry.transient && !entry.stale) {
      for (const [k, m] of this._materials) if (m === material) this._materials.delete(k);
      entry.stale = true;
    }
    if (entry.stale) this.#disposeMaterial(material);
  }

  #disposeMaterial(material) {
    this._refs.delete(material);
    material.userData.uniforms?.uLabels.value.dispose();
    material.dispose();
  }

  /** Moves a roll's dice (and fade clones) onto materials built with `flags`. */
  #rematerialize(roll, flags) {
    roll.flags = flags;
    const old = roll.materials;
    roll.materials = new Set();
    roll.dice.forEach((die, i) => {
      if (die.model) return; // keeps the model's own material (and its fade clone)
      const mat = this.#material(
        die.appearance,
        flags,
        die.type,
        die.variant,
        die.faces,
        die.ghost,
        die.faceTex,
        die,
      );
      if (!roll.materials.has(mat)) {
        roll.materials.add(mat);
        this.#retain(mat);
      }
      if (roll.fades) {
        const prev = roll.fades[i];
        const fade = cloneForFade(mat);
        fade.opacity = prev.opacity;
        roll.fades[i] = fade;
        die.inner.material = fade;
        prev.dispose();
      } else {
        die.inner.material = mat;
      }
    });
    for (const m of old) this.#release(m);
  }

  #geometry(type, style) {
    const key = `${type}|${style}`;
    let geo = this._geometries.get(key);
    if (!geo) {
      geo = buildDieGeometry(getShape(type), { style });
      geo.computeBoundingSphere(); // the blob shadow scales by it
      this._geometries.set(key, geo);
    }
    return geo;
  }

  /**
   * @param {object} appearance normalized
   * @param {{system?: string, dsnType?: string} | null} [source] the die it is built for: a
   *   newly built material is announced through onMaterial when the die has a preset. A preset
   *   of a non-standard system keys its own materials, so a standard die can neither suppress
   *   the announcement nor share a material a listener may change.
   */
  #material(appearance, flags, type, variant, faces, ghost = false, faceTex = null, source = null) {
    const layered = !ghost && faceTex?.texture ? faceTex : null;
    const layerKey = layered ? `|fl${faceTexId(layered)}` : '';
    const found = ghost ? null : this.#presetOf(source, type);
    const systemKey = found && found.preset.system !== STANDARD_SYSTEM ? `|sys:${found.preset.system}` : '';
    const key = `${appearanceKey(appearance)}|${programKey(appearance, flags)}|${type}|${variant ?? ''}|${faces?.key ?? ''}|${ghost ? 1 : 0}${layerKey}${systemKey}`;
    let mat = this._materials.get(key);
    if (!mat) {
      const shape = getShape(type);
      const labels = shape.values.map((v, i) => {
        const dflt = () =>
          variant === 'd100tens' ? labelFor(type, v * 10, variant) : labelFor(type, v);
        if (ghost) return '';
        const face = faces?.labels?.[i];
        if (!face) return dflt();
        if (face.kind === 'glyph') return String(face.text ?? '');
        if (face.kind === 'blank') return '';
        if (layered?.layers?.[i] >= 0) return ''; // drawn from its face layer
        return dflt(); // a text / image face without a layer shows its number
      });
      mat = layered
        ? createDiceMaterial(appearance, this._atlas, shape, labels, flags, layered)
        : createDiceMaterial(appearance, this._atlas, shape, labels, flags);
      this._materials.set(key, mat);
      // A layered material lives only while rolls hold it: its texture is theirs.
      this._refs.set(mat, { refs: 0, stale: false, transient: !!layered });
      if (found) {
        try {
          this._onMaterial(mat, found.dsnType, appearance, found.preset);
        } catch (err) {
          console.warn('dicer: a material-ready listener threw; the die keeps its look', err);
        }
      }
    }
    return mat;
  }

  /** The registered preset of the die `source` describes, as { preset, dsnType }, or null. */
  #presetOf(source, type) {
    if (typeof source?.system !== 'string') return null;
    try {
      const dsnType = source.dsnType ?? type;
      const preset = this._presetFor(source.system, dsnType);
      return preset && typeof preset === 'object' ? { preset, dsnType } : null;
    } catch (err) {
      console.warn('dicer: cannot look up a die preset; the die keeps its look', err);
      return null;
    }
  }

  #makeDie(spec, roll, flags, rollLook) {
    const shape = getShape(spec.type);
    const ghost = spec.ghost === true;
    const appearance = ghost
      ? GHOST_APPEARANCE
      : spec.appearance
        ? normalizeAppearance(spec.appearance)
        : rollLook;
    const faces = ghost ? undefined : spec.faces;
    const geometry = this.#geometry(spec.type, appearance.edges.style);
    // A ghost has no preset: nothing about its real look is announced.
    const system = ghost || typeof spec.system !== 'string' ? null : spec.system;
    const dsnType = typeof spec.dsnType === 'string' ? spec.dsnType : null;
    const source = system ? { system, dsnType } : null;
    const material = this.#material(appearance, flags, spec.type, spec.variant, faces, ghost, null, source);
    if (!roll.materials.has(material)) {
      roll.materials.add(material);
      this.#retain(material);
    }
    const inner = new THREE.Mesh(geometry, material);
    const outer = new THREE.Group();
    outer.userData.dicerDie = true;
    outer.visible = false; // at the origin until Playback places it
    outer.add(inner);
    // A ghost is thrown as a 1: its real value must never reach the die object or the mesh.
    const targetValue = ghost
      ? 1
      : spec.variant === 'd100tens'
        ? spec.value / 10 || 10
        : spec.value;
    return {
      outer,
      inner,
      shape,
      targetValue,
      geometry,
      type: spec.type,
      variant: spec.variant,
      appearance,
      faces,
      ghost,
      system,
      dsnType,
      faceTex: null,
      // A ghost never shows a model: its numbers would show through.
      modelUrl: !ghost && typeof spec.model === 'string' && spec.model ? spec.model : null,
      modelRotation: ghost ? null : modelRotationFor(spec),
      model: null,
      modelQuat: null, // set once the model is in: Playback premultiplies it
    };
  }

  /**
   * Starts loading the roll's pending assets: the face layers of every die whose face set has
   * image or text faces, and the model of every die whose model has a verified rotation (never
   * a ghost's). Until they are in, or ASSET_WAIT_MS passes, the roll draws nothing and its
   * playback does not start; the physics throw runs meanwhile. Each asset is applied as it
   * arrives; one that fails, or arrives after the wait, leaves its die as it is (numbers for
   * a face, Dicer's own die for a model).
   */
  #acquireAssets(roll) {
    const loads = [...this.#faceLoads(roll), ...this.#modelLoads(roll)];
    if (!loads.length) return;
    roll.assetsPending = true;
    const deadline = new Promise((resolve) => {
      roll.assetTimer = setTimeout(() => {
        console.warn(`dicer: dice assets not ready within ${ASSET_WAIT_MS} ms; showing the rest`);
        resolve();
      }, ASSET_WAIT_MS);
    });
    const applied = loads.map((load) =>
      load.then((apply) => {
        if (roll.removed || !roll.assetsPending) return; // late: swaps nothing
        try {
          apply?.();
        } catch (err) {
          console.warn('dicer: cannot apply a die asset; the die keeps its look', err);
        }
      }),
    );
    Promise.race([Promise.all(applied), deadline]).then(() => {
      clearTimeout(roll.assetTimer);
      if (roll.removed || !roll.assetsPending) return;
      roll.assetsPending = false;
      if (roll.received > 0) this._renderer.startLoop(this._tick);
      if (roll.settled) this.#armLandingTimer(roll, roll.settled.step);
    });
  }

  /** Face-layer loads, each resolving to a function that applies it (or null). Never rejects. */
  #faceLoads(roll) {
    const ft = this._faceTextures;
    if (!ft || this._faceLayers() === false) return [];
    const sets = new Map();
    for (const die of roll.dice) {
      if (!die.ghost && needsLayers(die.faces)) sets.set(die.faces.key, die.faces);
    }
    if (!sets.size) return [];
    roll.faceSets = [...sets.values()]; // released when the roll finishes, however it ends
    const failed = (err) => {
      console.warn('dicer: cannot load face textures; the dice show numbers', err);
      return null;
    };
    return roll.faceSets.map((faces) => {
      let load;
      try {
        load = Promise.resolve(ft.acquire(faces)).catch(failed);
      } catch (err) {
        load = Promise.resolve(failed(err));
      }
      return load.then((tex) => (tex?.texture ? () => this.#applyFaces(roll, faces, tex) : null));
    });
  }

  #applyFaces(roll, faces, tex) {
    for (const die of roll.dice) {
      if (die.ghost || die.model || die.faces?.key !== faces.key) continue;
      die.faceTex = tex;
      const { appearance, type, variant } = die;
      const mat = this.#material(appearance, roll.flags, type, variant, die.faces, false, tex, die);
      this.#swapMaterial(roll, die, mat);
    }
  }

  /** Model loads (one per url), each resolving to a function that applies it. Never rejects. */
  #modelLoads(roll) {
    if (this._modelPresets() === false) return [];
    const byUrl = new Map();
    for (const die of roll.dice) {
      if (!die.modelUrl || !die.modelRotation) continue;
      if (!byUrl.has(die.modelUrl)) byUrl.set(die.modelUrl, []);
      byUrl.get(die.modelUrl).push(die);
    }
    return [...byUrl].map(([url, dice]) => {
      const radius = dice[0].geometry.boundingSphere.radius;
      let load;
      try {
        load = Promise.resolve(this._loadModel(url, { radius }));
      } catch (err) {
        load = Promise.reject(err);
      }
      return load.then(
        (model) => {
          if (!model?.geometry || !model.material) return null;
          try {
            this._onModelLoaded(url); // the preset is loaded, whether or not this roll waits
          } catch (err) {
            console.warn('dicer: a model-loaded listener threw', err);
          }
          return () => this.#applyModel(roll, dice, model);
        },
        (err) => {
          console.warn(`dicer: cannot load the die model ${url}; showing Dicer's die`, err);
          return null;
        },
      );
    });
  }

  /**
   * Moves (not yet shown) dice onto a model: its geometry and its own material on the inner
   * mesh, the model rotation premultiplied before the face-forcing one. The collider and the
   * shadow keep Dicer's shape.
   */
  #applyModel(roll, dice, model) {
    for (const die of dice) {
      const old = die.inner.material;
      die.model = model;
      die.modelQuat = new THREE.Quaternion(...die.modelRotation);
      die.inner.geometry = model.geometry;
      die.inner.material = model.material;
      if (roll.playback?.resultsApplied) die.inner.quaternion.multiply(die.modelQuat);
      if (!roll.dice.some((d) => d.inner.material === old)) {
        roll.materials.delete(old);
        this.#release(old);
      }
    }
  }

  /** Moves a (not yet shown) die onto `mat`, releasing a material no die of the roll uses. */
  #swapMaterial(roll, die, mat) {
    const old = die.inner.material;
    if (old === mat) return;
    if (!roll.materials.has(mat)) {
      roll.materials.add(mat);
      this.#retain(mat);
    }
    die.inner.material = mat;
    if (!roll.dice.some((d) => d.inner.material === old)) {
      roll.materials.delete(old);
      this.#release(old);
    }
  }

  /** Shows a roll's dice (and their shadows) once Playback has placed them. */
  #reveal(roll) {
    const shadows = this._shadows() !== false;
    for (const die of roll.dice) {
      die.outer.visible = true;
      if (!shadows) continue;
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
    if (roll.assetsPending) {
      roll.settled = { step: settledStep }; // playback has not started: armed once it can
      return;
    }
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
          if (roll.assetsPending) continue; // hidden, playback not started, until assets are in
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
    // A roll still waiting for its assets draws nothing: it restarts the loop when they are in.
    for (const roll of this._rolls) if (!roll.assetsPending) return true;
    return false;
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
    clearTimeout(roll.assetTimer);
    const scene = this._renderer.scene;
    for (const die of roll.dice) scene.remove(die.outer);
    for (const plane of roll.shadows) this._renderer.sceneApi.releaseShadow(plane);
    for (const m of roll.fades ?? []) m.dispose();
    roll.fades = null;
    for (const m of roll.materials) this.#release(m);
    roll.materials.clear();
    for (const faces of roll.faceSets ?? []) {
      try {
        this._faceTextures.release(faces);
      } catch (err) {
        console.warn('dicer: cannot release face textures', err);
      }
    }
    roll.faceSets = null;
    if (roll.playback) {
      for (const data of roll.playback.release()) this._physics.recycle(data);
      roll.playback = null;
    }
    roll.resolveLanded();
    roll.resolveFinished();
  }
}

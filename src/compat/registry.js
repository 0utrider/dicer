/**
 * DSN registry: the plain-data model behind game.dice3d's registration methods.
 * Pure data, no three.js. Third-party input is untrusted: a malformed call warns once
 * per member name and returns normally (resolved Promise for async members).
 */
import { dieTypeForFaces } from '../core/dice-shapes.js';
import { cssToHex } from './colors.js';

const MODES = ['default', 'preferred', 'exclusive'];
/** A `dN` type with more faces than this is not a die Dicer can label: warned and skipped. */
export const MAX_FACES = 1000;
const BUILTIN_TYPES = [2, 4, 6, 8, 10, 12, 14, 16, 20].map(dieTypeForFaces);
const STANDARD = 'standard';
const APPEARANCE_COLORS = ['foreground', 'background', 'outline', 'edge'];
const APPEARANCE_STRINGS = ['colorset', 'system', 'texture', 'material', 'font'];

const isObj = (v) => v !== null && typeof v === 'object';
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isMapLike = (v) => isObj(v) && typeof v.forEach === 'function';

/**
 * Number of faces implied by a `dN` die type, else null. A d100 preset is its tens die, as in
 * Dice So Nice: ten labels (10 ... 90, 00); the ones die takes the system's d10.
 */
function facesOfType(type) {
  if (type === 'd100') return 10;
  const m = /^d(\d+)$/.exec(type);
  return m ? Number(m[1]) : null;
}

/** Default model loader: the GLTF chunk loads only when a preset's model is first asked for. */
const importModel = (url) => import('../render/model-loader.js').then((m) => m.loadDieModel(url));
const SAFE_PATH = /^[^:<>"#?\\]+$/;
// The atlas reader is its own chunk: only sets that use Dice So Nice's `atlas` load it.
const importAtlas = () => import('./atlas.js');

/**
 * @param {object} [deps]
 * @param {(message: string) => void} [deps.warn]
 * @param {{ callAll(hook: string, ...args: unknown[]): unknown }} [deps.hooks] Foundry's Hooks
 *   (P3-R2); PresetEntry.loadModel() fires diceSoNiceModelLoaded through it
 * @param {(url: string) => Promise<unknown>} [deps.loadModel]
 * @param {(url: string) => string} [deps.routeUrl] turns a preset's modelFile into the url
 *   Dicer loads (main.js: the same routeOf as face images)
 * @param {(url: string) => Promise<unknown>} [deps.loadJson] reads a preset's or texture's atlas
 */
export function createRegistry({
  warn = console.warn,
  hooks = { callAll() {} },
  loadModel = importModel,
  routeUrl = (url) => url,
  loadJson = null,
} = {}) {
  const systems = new Map();
  const colorsets = new Map();
  const colorsetModes = new Map();
  const textures = new Map();
  const roles = new Map();
  const shapes = new Map(); // custom shape name -> def
  const aliases = new Map(); // die type -> base shape
  const damageTypeDefaults = {};
  const sfxTriggers = new Map();
  const sfxModes = new Map();
  let sfxDefaults = [];
  const listeners = new Set();
  const warned = new Set();

  const bad = (member, detail) => {
    if (warned.has(member)) return;
    warned.add(member);
    try {
      warn(`dicer | game.dice3d.${member}: ${detail}`);
    } catch {
      /* a throwing logger must not reach the caller */
    }
  };
  const changed = () => {
    for (const cb of [...listeners]) {
      try {
        cb();
      } catch (err) {
        bad('onChange', `listener threw: ${err?.message ?? err}`);
      }
    }
  };

  function baseShape(type) {
    if (typeof type !== 'string') return null;
    if (aliases.has(type)) return aliases.get(type);
    return BUILTIN_TYPES.includes(type) ? type : null;
  }

  function ensureSystem(id, name = id) {
    let sys = systems.get(id);
    if (!sys) {
      sys = { id, name, mode: 'default', group: undefined, dice: new Map(), instance: null };
      systems.set(id, sys);
    }
    return sys;
  }
  ensureSystem(STANDARD, 'Standard');

  /** The url Dicer loads a modelFile from; a throwing router leaves it as given. */
  const routed = (file) => {
    try {
      const url = routeUrl(file);
      return isStr(url) ? url : file;
    } catch {
      return file;
    }
  };

  const atlases = new Map(); // atlas path -> Promise<frame map>, read once
  /**
   * Once the atlas at `path` is read, `apply(frames)` points labels or a texture at its frames
   * (true: something changed, listeners hear it). Null without a usable path.
   */
  function fromAtlas(member, path, apply) {
    if (!isStr(path) || !SAFE_PATH.test(path)) return null;
    let read = atlases.get(path);
    if (!read) {
      read = importAtlas()
        .then((m) =>
          Promise.resolve((loadJson ?? m.fetchJson)(routed(path))).then((json) =>
            m.atlasFrames(json, path),
          ),
        )
        .catch((err) => {
          bad(member, `cannot read the atlas ${path}: ${err?.message ?? err}`);
          return new Map();
        });
      atlases.set(path, read);
    }
    return read.then((frames) => {
      if (frames.size && apply(frames)) changed();
    });
  }

  /** Marks a model preset loaded and fires diceSoNiceModelLoaded, once per preset. */
  function markModelLoaded(entry) {
    if (entry.modelLoaded) return;
    entry.modelLoaded = true;
    try {
      hooks.callAll('diceSoNiceModelLoaded', entry);
    } catch (err) {
      bad('loadModel', `a diceSoNiceModelLoaded listener threw: ${err?.message ?? err}`);
    }
  }

  /**
   * Aliases `type` to the built-in `shape`. Only a built-in shape may be targeted, and a
   * built-in type name is never re-aliased (it would reshape every standard die of that type).
   */
  function setAlias(member, type, shape) {
    if (BUILTIN_TYPES.includes(type)) {
      bad(member, `"${type}" is a built-in die type and keeps its own shape`);
      return false;
    }
    if (!BUILTIN_TYPES.includes(shape)) {
      bad(member, `"${type}": shape "${shape}" is not a built-in die shape`);
      return false;
    }
    aliases.set(type, shape);
    return true;
  }

  /** Store one preset; returns false when it is unusable. Never throws. */
  function storePreset(preset, shape, defaultSystem = STANDARD) {
    try {
      return storePresetUnsafe(preset, shape, defaultSystem);
    } catch (err) {
      bad('addDicePreset', `unusable preset: ${err?.message ?? err}`);
      return false;
    }
  }

  function storePresetUnsafe(preset, shape, defaultSystem) {
    if (!isObj(preset) || !isStr(preset.type)) {
      bad('addDicePreset', 'expected a preset object with a string `type`');
      return false;
    }
    const type = preset.type;
    if ((facesOfType(type) ?? 0) > MAX_FACES) {
      bad('addDicePreset', `"${type}": more than ${MAX_FACES} faces; skipped`);
      return false;
    }
    const systemId = isStr(preset.system) ? preset.system : defaultSystem;
    const hasModel = isStr(preset.modelFile);
    const given = Array.isArray(preset.labels) ? preset.labels : [];
    if (given.length > MAX_FACES) {
      bad('addDicePreset', `"${type}": more than ${MAX_FACES} labels; skipped`);
      return false;
    }
    if (isStr(shape)) setAlias('addDicePreset', type, shape);
    const base = baseShape(type);
    // Model-backed presets (e.g. labels: "") carry their faces in the model.
    if (!Array.isArray(preset.labels) && !hasModel) {
      bad('addDicePreset', `"${type}": \`labels\` should be an array`);
    }
    const faces = facesOfType(type) ?? facesOfType(base ?? '') ?? (given.length || null);
    const v = preset.values;
    const values =
      isObj(v) && Number.isFinite(v.min) && Number.isFinite(v.max)
        ? { min: v.min, max: v.max }
        : { min: 1, max: faces ?? given.length };
    let labels = given.map(String);
    if (faces && given.length !== faces && !(hasModel && given.length === 0)) {
      bad('addDicePreset', `"${type}": expected ${faces} labels, got ${given.length}; padding`);
    }
    if (faces && !(hasModel && given.length === 0)) {
      labels = Array.from({ length: faces }, (_, i) =>
        i < given.length ? String(given[i]) : String(values.min + i),
      );
    }
    const sys = ensureSystem(systemId);
    const entry = {
      ...preset,
      type,
      shape: base,
      system: systemId,
      labels,
      values,
      colorset: preset.colorset,
      font: preset.font,
      fontScale: preset.fontScale,
      modelFile: hasModel ? preset.modelFile : undefined,
      modelUrl: hasModel ? routed(preset.modelFile) : undefined,
      emissiveMaps: preset.emissiveMaps,
      modelLoaded: false,
    };
    let modelLoad = null;
    // Loads once (nothing if a roll already loaded it); never rejects into a third-party
    // caller. A failed load can be retried.
    entry.loadModel = () => {
      if (!hasModel || entry.modelLoaded) return Promise.resolve();
      modelLoad ??= Promise.resolve()
        .then(() => loadModel(entry.modelUrl))
        .then(
          () => markModelLoaded(entry),
          (err) => {
            modelLoad = null;
            bad('loadModel', `"${type}": cannot load ${entry.modelUrl}: ${err?.message ?? err}`);
          },
        );
      return modelLoad;
    };
    // A model preset's textures live in its model.
    entry.loadTextures = () => entry.loadModel();
    sys.dice.set(type, entry);
    // Atlas labels name frames of one sheet (Dice So Nice's `atlas`): until it is read they are
    // not found and the die shows numbers. Its bump maps are relief Dicer leaves out.
    entry.atlasReady = fromAtlas('addDicePreset', preset.atlas, (frames) => {
      let hit = false;
      entry.labels = entry.labels.map((l) => (frames.has(l) ? ((hit = true), frames.get(l)) : l));
      return hit;
    });
    return entry;
  }

  function addSystem(system, mode = 'default') {
    if (!isObj(system) || !isStr(system.id) || !isStr(system.name)) {
      bad('addSystem', 'expected {id, name} or a DiceSystem instance');
      return;
    }
    const sys = ensureSystem(system.id, system.name);
    sys.name = system.name;
    sys.mode = MODES.includes(mode) ? mode : 'default';
    sys.group = system.group;
    if (isMapLike(system.dice)) {
      sys.instance = system;
      try {
        system.dice.forEach((preset) => storePreset(preset, undefined, system.id));
      } catch (err) {
        bad('addSystem', `"${system.id}": cannot read its dice: ${err?.message ?? err}`);
      }
    } else {
      sys.instance = null;
    }
    changed();
  }

  async function addDicePreset(preset, shape) {
    const entry = storePreset(preset, shape);
    if (!entry) return;
    changed();
    await entry.atlasReady;
  }

  async function addColorset(colorset, mode = 'default') {
    if (!isObj(colorset) || !isStr(colorset.name)) {
      bad('addColorset', 'expected an object with a string `name`');
      return;
    }
    colorsets.set(colorset.name, { ...colorset });
    colorsetModes.set(colorset.name, MODES.includes(mode) ? mode : 'default');
    changed();
  }

  async function addTexture(id, texture) {
    if (!isStr(id) || !isObj(texture)) {
      bad('addTexture', 'expected (id: string, texture: object)');
      return;
    }
    const entry = { ...texture, id, name: isStr(texture.name) ? texture.name : id };
    textures.set(id, entry);
    changed();
    // An atlas texture's source names a frame of its sheet.
    await fromAtlas(
      'addTexture',
      texture.atlas,
      (frames) => frames.has(entry.source) && ((entry.source = frames.get(entry.source)), true),
    );
  }

  function addDiceShape(def) {
    if (!isObj(def) || !isStr(def.name)) {
      bad('addDiceShape', 'expected an object with a string `name`');
      return;
    }
    const named = [def.baseShape, def.shape].find((s) => BUILTIN_TYPES.includes(s));
    const alias = named ?? (Array.isArray(def.faces) ? dieTypeForFaces(def.faces.length) : null);
    if (!alias) {
      bad('addDiceShape', `"${def.name}": no usable \`faces\` or \`baseShape\``);
      return;
    }
    if (!setAlias('addDiceShape', def.name, alias)) return;
    shapes.set(def.name, def);
    changed();
  }

  function addRole(role, { package: pkg } = {}) {
    if (!isObj(role) || !isStr(role.id)) {
      bad('addRole', 'expected an object with a string `id`');
      return;
    }
    roles.set(role.id, { ...role, package: pkg });
    changed();
  }

  function addDamageTypeDefaults(map) {
    if (!isObj(map)) {
      bad('addDamageTypeDefaults', 'expected a {damageType: colorset} object');
      return;
    }
    for (const [k, v] of Object.entries(map)) {
      if (isStr(v)) damageTypeDefaults[k] = v;
    }
    changed();
  }

  function addSFXTrigger(id, name, results) {
    if (!isStr(id)) {
      bad('addSFXTrigger', 'expected (id: string, name, results)');
      return;
    }
    sfxTriggers.set(id, { id, name, results });
    changed();
  }

  function addSFXMode(sfxClass) {
    const id = sfxClass?.id;
    if (typeof sfxClass !== 'function' || !isStr(id)) {
      bad('addSFXMode', 'expected an SFX class with a static string `id`');
      return;
    }
    const label = isStr(sfxClass.specialEffectName) ? sfxClass.specialEffectName : id;
    sfxModes.set(id, { id, name: label, sfxClass });
    changed();
  }

  function addSFXDefaults(list) {
    if (!Array.isArray(list)) {
      bad('addSFXDefaults', 'expected an array');
      return;
    }
    sfxDefaults = [...list];
    changed();
  }

  const presetFor = (systemId, type) => systems.get(systemId)?.dice.get(type) ?? null;

  const diceFactory = {
    systems,
    loaderGLTF: null,
    get(type) {
      const shape = baseShape(type);
      return shape ? { type, shape } : null;
    },
  };

  const names = (map, pick) => Object.fromEntries([...map].map(([k, v]) => [k, pick(k, v)]));
  const luminance = (hex) => {
    const n = parseInt(cssToHex(hex, '#000000').slice(1), 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  };

  const Utils = {
    // Flat {id: name} maps. Grouped output (swade's dialog) could not be confirmed offline.
    prepareSystemList: () => names(systems, (k, s) => s.name),
    prepareColorsetList: () => names(colorsets, (k, c) => c.description ?? k),
    prepareTextureList: () => names(textures, (k, t) => t.name),
    prepareFontList() {
      const out = {};
      for (const s of systems.values())
        for (const p of s.dice.values()) if (isStr(p.font)) out[p.font] = p.font;
      return out;
    },
    contrastOf: (hex) => (luminance(hex) > 0.5 ? '#000000' : '#ffffff'),
    sanitizeAppearance(a) {
      const out = {};
      if (!isObj(a)) return out;
      for (const k of APPEARANCE_COLORS) {
        const c = cssToHex(a[k]);
        if (c) out[k] = c;
      }
      for (const k of APPEARANCE_STRINGS) if (isStr(a[k])) out[k] = a[k];
      return out;
    },
  };

  const COLORSETS = new Proxy(
    {},
    {
      get: (_, k) => (typeof k === 'string' ? colorsets.get(k) : undefined),
      has: (_, k) => typeof k === 'string' && colorsets.has(k),
      ownKeys: () => [...colorsets.keys()],
      getOwnPropertyDescriptor: (_, k) =>
        typeof k === 'string' && colorsets.has(k)
          ? { value: colorsets.get(k), enumerable: true, configurable: true, writable: true }
          : undefined,
    },
  );

  return {
    systems,
    colorsets,
    textures,
    damageTypeDefaults,
    sfxTriggers,
    sfxModes,
    diceFactory,
    exports: {
      Utils,
      COLORSETS,
      // Dice So Nice's name for the registered textures (addTexture), as a plain object.
      get TEXTURELIST() {
        return Object.fromEntries(textures);
      },
    },
    addSystem,
    addDicePreset,
    addColorset,
    addTexture,
    addDiceShape,
    addRole,
    getRole: (id) => roles.get(id),
    getRoles: () => [...roles.values()],
    addDamageTypeDefaults,
    addSFXTrigger,
    addSFXMode,
    addSFXDefaults,
    getSFXDefaults: () => [...sfxDefaults],
    getSFXModes: () => names(sfxModes, (k, m) => m.name),
    getLoadedDiceSystems: () => systems,
    presetFor,
    /** A roll loaded the model at `url` (DiceBox): every preset using it is now loaded. */
    noteModelLoaded(url) {
      if (!isStr(url)) return;
      for (const sys of systems.values()) {
        for (const entry of sys.dice.values()) if (entry.modelUrl === url) markModelLoaded(entry);
      }
    },
    baseShape,
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

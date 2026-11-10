/**
 * DSN registry: the plain-data model behind game.dice3d's registration methods.
 * Pure data, no three.js. Third-party input is untrusted: a malformed call warns once
 * per member name and returns normally (resolved Promise for async members).
 */
import { dieTypeForFaces } from '../core/dice-shapes.js';
import { cssToHex } from './colors.js';

const MODES = ['default', 'preferred', 'exclusive'];
const BUILTIN_TYPES = [2, 4, 6, 8, 10, 12, 20].map(dieTypeForFaces);
const STANDARD = 'standard';
const APPEARANCE_COLORS = ['foreground', 'background', 'outline', 'edge'];
const APPEARANCE_STRINGS = ['colorset', 'system', 'texture', 'material', 'font'];

const isObj = (v) => v !== null && typeof v === 'object';
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isMapLike = (v) => isObj(v) && typeof v.forEach === 'function';

/** Number of faces implied by a `dN` die type, else null. */
function facesOfType(type) {
  const m = /^d(\d+)$/.exec(type);
  return m ? Number(m[1]) : null;
}

/** Default model loader: the GLTF chunk loads only when a preset's model is first asked for. */
const importModel = (url) => import('../render/model-loader.js').then((m) => m.loadDieModel(url));

/**
 * @param {object} [deps]
 * @param {(message: string) => void} [deps.warn]
 * @param {{ callAll(hook: string, ...args: unknown[]): unknown }} [deps.hooks] Foundry's Hooks
 *   (P3-R2); PresetEntry.loadModel() fires diceSoNiceModelLoaded through it
 * @param {(url: string) => Promise<unknown>} [deps.loadModel]
 */
export function createRegistry({ warn = console.warn, hooks = { callAll() {} }, loadModel = importModel } = {}) {
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

  /** Store one preset; returns false when it is unusable. */
  function storePreset(preset, shape, defaultSystem = STANDARD) {
    if (!isObj(preset) || !isStr(preset.type)) {
      bad('addDicePreset', 'expected a preset object with a string `type`');
      return false;
    }
    const type = preset.type;
    const systemId = isStr(preset.system) ? preset.system : defaultSystem;
    const hasModel = isStr(preset.modelFile);
    if (isStr(shape)) aliases.set(type, shape);
    const base = baseShape(type);
    const given = Array.isArray(preset.labels) ? preset.labels : [];
    // Model-backed presets (e.g. labels: "") carry their faces in the model.
    if (!Array.isArray(preset.labels) && !hasModel) {
      bad('addDicePreset', `"${type}": \`labels\` should be an array`);
    }
    const faces = facesOfType(type) ?? facesOfType(base ?? '') ?? (given.length || null);
    const v = preset.values;
    const values = isObj(v) && Number.isFinite(v.min) && Number.isFinite(v.max)
      ? { min: v.min, max: v.max }
      : { min: 1, max: faces ?? given.length };
    let labels = given.map(String);
    if (faces && given.length !== faces && !(hasModel && given.length === 0)) {
      bad('addDicePreset', `"${type}": expected ${faces} labels, got ${given.length}; padding`);
    }
    if (faces && !(hasModel && given.length === 0)) {
      labels = Array.from({ length: faces }, (_, i) => (i < given.length ? String(given[i]) : String(values.min + i)));
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
      emissiveMaps: preset.emissiveMaps,
      modelLoaded: false,
    };
    let modelLoad = null;
    // Loads once; never rejects into a third-party caller. A failed load can be retried.
    entry.loadModel = () => {
      if (!hasModel) return Promise.resolve();
      modelLoad ??= Promise.resolve()
        .then(() => loadModel(entry.modelFile))
        .then(
          () => {
            entry.modelLoaded = true;
            try {
              hooks.callAll('diceSoNiceModelLoaded', entry);
            } catch (err) {
              bad('loadModel', `a diceSoNiceModelLoaded listener threw: ${err?.message ?? err}`);
            }
          },
          (err) => {
            modelLoad = null;
            bad('loadModel', `"${type}": cannot load ${entry.modelFile}: ${err?.message ?? err}`);
          },
        );
      return modelLoad;
    };
    // A model preset's textures live in its model.
    entry.loadTextures = () => entry.loadModel();
    sys.dice.set(type, entry);
    return true;
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
      system.dice.forEach((preset) => storePreset(preset, undefined, system.id));
    } else {
      sys.instance = null;
    }
    changed();
  }

  async function addDicePreset(preset, shape) {
    if (storePreset(preset, shape)) changed();
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
    textures.set(id, { ...texture, id, name: isStr(texture.name) ? texture.name : id });
    changed();
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
    shapes.set(def.name, def);
    aliases.set(def.name, alias);
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
    const label = [sfxClass.specialEffectName, sfxClass.sfxName, sfxClass.name].find(isStr);
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
      for (const s of systems.values()) for (const p of s.dice.values()) if (isStr(p.font)) out[p.font] = p.font;
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
    diceFactory,
    exports: { Utils, COLORSETS },
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
    baseShape,
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/**
 * Dicer's public API: DiceSystem, DiceSFX and DiceMap with the member names and signatures of
 * Dice So Nice's api.js, so a third-party system can subclass them and pass an instance to
 * game.dice3d.addSystem(). Plain ESM, no imports: loaded at runtime from modules/dicer/api.js.
 * Member names follow DSN's public interface; every body here is Dicer's own.
 */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && v.length > 0;

/** One console warning per (owner, member): a malformed call never throws into its caller. */
function warner(label) {
  const warned = new Set();
  return (member, detail) => {
    if (warned.has(member)) return;
    warned.add(member);
    console.warn(`dicer | ${label()}.${member}: ${detail}`);
  };
}

/** A Map of die type -> preset that stamps each preset with its system's id. */
export class DiceMap extends Map {
  #owner;

  constructor(owner, ...args) {
    super(...args);
    this.#owner = owner;
  }

  set(type, preset) {
    if (isObj(preset) && this.#owner) preset.system = this.#owner.id;
    return super.set(type, preset);
  }
}

export class DiceSystem {
  static SETTING_SCOPE = Object.freeze({ LOCAL: 0, SHARED: 1 });
  static SETTING_TYPE = Object.freeze({
    BOOLEAN: 'boolean',
    SELECT: 'select',
    COLOR: 'color',
    FILE: 'file',
    RANGE: 'range',
    STRING: 'string',
  });
  static SETTING_FORMATING = Object.freeze({ SEPARATOR: 'separator', HTML: 'html' });
  static DICE_EVENT_TYPE = Object.freeze({ SPAWN: 0, CLICK: 1, RESULT: 2, COLLIDE: 3, DESPAWN: 4 });

  /** A 32-bit integer hash of a string (FNV-1a). */
  static generateHash(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h | 0;
  }

  #id;
  #name;
  #mode;
  #group;
  #dice;
  #roleDefaults = {};
  #included = new Set();
  #excluded = new Set();
  #layout = []; // every setting entry in order, formatting ones included
  #values = {}; // scope -> die type ('global' too) -> { settingId: value }
  #listeners = new Map(); // event type -> Set of callbacks
  #processCallbacks = [];
  #shaderCallbacks = [];
  #warn = warner(() => `DiceSystem(${this.#id})`);

  constructor(id, name, mode = 'default', group = null) {
    this.#id = id;
    this.#name = name;
    this.#mode = mode;
    this.#group = group;
    this.#dice = new DiceMap(this);
  }

  get id() {
    return this.#id;
  }
  get name() {
    return this.#name;
  }
  get dice() {
    return this.#dice;
  }
  get mode() {
    return this.#mode;
  }
  get group() {
    return this.#group;
  }
  get roleDefaults() {
    return this.#roleDefaults;
  }
  set roleDefaults(value) {
    this.#roleDefaults = isObj(value) ? value : {};
  }

  // Roles

  setRoleDefaults(role, defaults = {}) {
    if (!isId(role)) return this.#warn('setRoleDefaults', 'expected a role id');
    this.#roleDefaults[role] = isObj(defaults) ? defaults : {};
  }

  includeRoles(...roles) {
    for (const r of roles.flat()) if (isId(r)) this.#included.add(r);
  }

  excludeRoles(...roles) {
    for (const r of roles.flat()) if (isId(r)) this.#excluded.add(r);
  }

  /** Excluded roles never; with an include list, only its roles; otherwise every role. */
  isAvailableForRole(role) {
    if (this.#excluded.has(role)) return false;
    return this.#included.size === 0 || this.#included.has(role);
  }

  // Settings

  /** The value settings (formatting entries such as separators are left out). */
  get settings() {
    const formatting = Object.values(DiceSystem.SETTING_FORMATING);
    return this.#layout.filter((s) => !formatting.includes(s.type));
  }

  /** The options object of an addSetting* call (`{}` when omitted), or null after one warning. */
  #options(member, opts) {
    if (opts === undefined) return {};
    if (isObj(opts)) return opts;
    this.#warn(member, 'expected an options object');
    return null;
  }

  addSettingSeparator(opts) {
    const o = this.#options('addSettingSeparator', opts);
    if (o) this.#layout.push({ type: DiceSystem.SETTING_FORMATING.SEPARATOR, name: o.name ?? '' });
  }

  addSettingHTML(opts) {
    const o = this.#options('addSettingHTML', opts);
    if (o) this.#layout.push({ type: DiceSystem.SETTING_FORMATING.HTML, name: o.name });
  }

  /** `defaults` fill the options left undefined, as destructuring defaults would. */
  #addSetting(member, type, opts, defaults) {
    const o = this.#options(member, opts);
    if (!o) return;
    const filled = { ...o };
    for (const [k, v] of Object.entries(defaults)) if (filled[k] === undefined) filled[k] = v;
    const { id, name, scope = DiceSystem.SETTING_SCOPE.SHARED, defaultValue, ...extra } = filled;
    if (!isId(id)) return this.#warn(member, 'expected a setting with a string `id`');
    this.#layout = this.#layout.filter((s) => s.id !== id);
    this.#layout.push({ id, name: name ?? id, type, scope, defaultValue, ...extra });
  }

  addSettingBoolean(opts) {
    this.#addSetting('addSettingBoolean', DiceSystem.SETTING_TYPE.BOOLEAN, opts, {
      defaultValue: false,
    });
  }

  addSettingColor(opts) {
    this.#addSetting('addSettingColor', DiceSystem.SETTING_TYPE.COLOR, opts, {
      defaultValue: '#ffffff',
    });
  }

  addSettingRange(opts) {
    this.#addSetting('addSettingRange', DiceSystem.SETTING_TYPE.RANGE, opts, {
      defaultValue: 0,
      min: 0,
      max: 100,
      step: 1,
    });
  }

  addSettingFile(opts) {
    this.#addSetting('addSettingFile', DiceSystem.SETTING_TYPE.FILE, opts, { defaultValue: '' });
  }

  addSettingSelect(opts) {
    this.#addSetting('addSettingSelect', DiceSystem.SETTING_TYPE.SELECT, opts, {
      defaultValue: null,
      options: {},
    });
  }

  addSettingString(opts) {
    this.#addSetting('addSettingString', DiceSystem.SETTING_TYPE.STRING, opts, {
      defaultValue: '',
    });
  }

  /** { settingId: defaultValue } for every value setting. */
  getDefaultSettings() {
    return Object.fromEntries(this.settings.map((s) => [s.id, s.defaultValue]));
  }

  /** The defaults, overridden by the 'global' values, overridden by this die type's. */
  getSettingsByDiceType(type, scope = 'basic') {
    const byType = this.#values[scope] ?? {};
    return {
      ...this.getDefaultSettings(),
      ...byType.global,
      ...(type === 'global' ? {} : byType[type]),
    };
  }

  getScopedSettingValue(type, id, scope = 'basic') {
    return this.getSettingsByDiceType(type, scope)[id];
  }

  /** Merges `settings` into the stored values of a die type ('global': every type). */
  updateSettings(type = 'global', settings, scope = 'basic') {
    if (!isId(type) || !isObj(settings)) {
      return this.#warn('updateSettings', 'expected (type: string, settings: object)');
    }
    const byType = (this.#values[scope] ??= {});
    byType[type] = { ...byType[type], ...settings };
  }

  /** Reads this system's values from the current user's dicer.appearance[*].systemSettings. */
  loadSettings() {
    let flag;
    try {
      const user = globalThis.game?.user;
      flag = typeof user?.getFlag === 'function' ? user.getFlag('dicer', 'appearance') : undefined;
    } catch {
      flag = undefined;
    }
    if (!isObj(flag)) return;
    for (const [type, ref] of Object.entries(flag)) {
      const values = isObj(ref) && isObj(ref.systemSettings) ? ref.systemSettings[this.#id] : null;
      if (isObj(values)) this.updateSettings(type, values);
    }
  }

  /** The settings dialog arrives with Dicer's config dialog; until then it has no content. */
  getSettingsDialogContent() {
    return '';
  }

  // Events

  // An unknown event type throws: that is DSN's interface contract for on/off (ruling P3-R21).
  #listenersOf(member, type) {
    if (!Object.values(DiceSystem.DICE_EVENT_TYPE).includes(type)) {
      throw new TypeError(`dicer | DiceSystem.${member}: unknown dice event type ${String(type)}`);
    }
    let set = this.#listeners.get(type);
    if (!set) this.#listeners.set(type, (set = new Set()));
    return set;
  }

  on(type, callback) {
    const set = this.#listenersOf('on', type);
    if (typeof callback !== 'function') return this.#warn('on', 'expected a callback function');
    set.add(callback);
  }

  off(type, callback) {
    this.#listenersOf('off', type).delete(callback);
  }

  /** Calls every listener of `type` with `event`; a throwing listener is logged and skipped. */
  fire(type, event) {
    for (const cb of [...this.#listenersOf('fire', type)]) {
      try {
        cb(event);
      } catch (err) {
        console.warn(`dicer | DiceSystem(${this.#id}) event listener threw`, err);
      }
    }
  }

  // Materials

  /**
   * Part of the material cache key for dice of this system: materials with different
   * strings are built separately. Covers the appearance and the stored setting values.
   */
  getCacheString(appearance) {
    const hash = DiceSystem.generateHash(JSON.stringify([appearance ?? null, this.#values]));
    return `${this.#id}:${hash}`;
  }

  /** Runs the processMaterial callbacks on a freshly built material; returns the material. */
  processMaterial(type, material, appearance) {
    for (const cb of this.#processCallbacks) cb(type, material, appearance);
    return material;
  }

  /** Runs the beforeShaderCompile callbacks, after Dicer's own shader patch. */
  beforeShaderCompile(shader, material) {
    for (const cb of this.#shaderCallbacks) cb(shader, material);
    return shader;
  }

  registerProcessMaterialCallback(callback) {
    if (typeof callback !== 'function') {
      return this.#warn('registerProcessMaterialCallback', 'expected a function');
    }
    this.#processCallbacks.push(callback);
  }

  registerBeforeShaderCompileCallback(callback) {
    if (typeof callback !== 'function') {
      return this.#warn('registerBeforeShaderCompileCallback', 'expected a function');
    }
    this.#shaderCallbacks.push(callback);
  }

  /**
   * The first preset with these values ({min, max} or a list) and this base shape; a preset
   * without a `shape` matches on its values alone.
   */
  getDiceByShapeAndValues(shape, values) {
    const want = JSON.stringify(values);
    for (const preset of this.#dice.values()) {
      if (!preset || JSON.stringify(preset.values) !== want) continue;
      if (preset.shape == null || preset.shape === shape) return preset;
    }
    return undefined;
  }
}

/** Base class for special effects; subclasses set the statics and override play(). */
export class DiceSFX {
  static id = null;
  static specialEffectName = null;
  static PLAY_ONLY_ONCE_PER_MESH = false;

  constructor(box, dicemesh, options) {
    this.box = box;
    this.dicemesh = dicemesh;
    this.options = options ?? {};
  }

  /** Loads shared assets once per effect class; true when it is ready. */
  static async init() {
    return true;
  }

  get nameLocalized() {
    const name = this.constructor.specialEffectName ?? this.constructor.id ?? '';
    try {
      return globalThis.game?.i18n?.localize?.(name) ?? name;
    } catch {
      return name;
    }
  }

  /** The effect's scale for its die: one Dicer world unit is one die, so 1. */
  computeScale() {
    return 1;
  }

  /** The base effect does nothing. */
  async play() {}

  /** Loads `url` with a three.js-style loader (load(url, onLoad, onProgress, onError)). */
  static async loadAsset(loader, url) {
    return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
  }

  static getDialogContent() {
    return '';
  }
}

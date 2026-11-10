import * as THREE from 'three';
import { viewFor } from '../compat/privacy.js';
import { createSync, rollToData, stripResults } from '../compat/sync.js';
import { createRegistry } from '../compat/registry.js';
import { readUserLooks } from '../compat/user-looks.js';
import { measureArea } from '../foundry/area.js';

const STANDARD_SYSTEM = 'standard';
/** The gate and showForRoll hooks enableDebugMode logs. */
const DEBUG_HOOKS = ['diceSoNiceMessageProcessed', 'diceSoNiceRollStart', 'diceSoNiceRollComplete'];

/**
 * migration.js (Task 14) loads only through a lazy import() chunk. A glob, not a literal
 * import(): while the file does not exist the build must still resolve, so the glob is empty,
 * the import rejects and loadSaveFile warns. Once the file exists the glob emits its chunk.
 */
const MIGRATION_PATH = '../compat/migration.js';
const migrationModules = import.meta.glob('../compat/migration.js');
const importMigrationModule = () =>
  migrationModules[MIGRATION_PATH]?.() ?? Promise.reject(new Error('compat/migration.js is not built yet'));

/** True when a face set has image or text faces (rasterized into face layers). */
const needsLayers = (faces) =>
  Array.isArray(faces?.labels) && faces.labels.some((l) => l?.kind === 'image' || l?.kind === 'text');

/**
 * DiceBox's onMaterial callback (P3-R3): fires diceSoNiceOnMaterialReady(material, diceType,
 * appearance) for a material built for a die whose preset belongs to a non-standard system.
 */
export function materialReadyNotifier(hooks = globalThis.Hooks) {
  return (material, diceType, appearance, preset) => {
    if (!preset || typeof preset.system !== 'string' || preset.system === STANDARD_SYSTEM) return;
    try {
      hooks?.callAll('diceSoNiceOnMaterialReady', material, diceType, appearance);
    } catch (err) {
      console.error('dicer: a diceSoNiceOnMaterialReady listener failed', err);
    }
  };
}

const isRollLike = (roll) => Boolean(roll) && typeof roll === 'object';
const idOrNull = (v) => (typeof v === 'string' && v !== '' ? v : null);

/** User ids from ids or User objects; an empty list means everyone (null), like a whisper. */
function idsOf(users) {
  if (!Array.isArray(users)) return null;
  const ids = users.map((u) => (typeof u === 'string' ? u : u?.id)).filter((id) => typeof id === 'string');
  return ids.length ? ids : null;
}

/** Face count of a legacy die type: 'd20' -> 20, 'dc' (coin) -> 2; anything else is skipped. */
function legacyFaces(type) {
  if (type === 'dc') return 2;
  const m = /^d(\d+)$/.exec(String(type));
  return m ? Number(m[1]) : undefined;
}

/** The legacy show() payload as a Roll-like `{dice: [{faces, results, options}]}`, or null. */
function legacyRoll(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.throws)) return null;
  const dice = [];
  for (const t of data.throws) {
    for (const d of Array.isArray(t?.dice) ? t.dice : []) {
      if (!d || typeof d !== 'object' || !Number.isFinite(d.result)) continue;
      dice.push({
        faces: legacyFaces(d.type),
        results: [{ result: d.result, active: true }],
        options: d.options && typeof d.options === 'object' ? d.options : {},
      });
    }
  }
  return { dice };
}

const ghostDecorator = () => ({ ghost: true });

/**
 * The users a RollStart listener left, as a narrowing only: a non-array keeps the original, an
 * array is intersected with the original (null -> array narrows from everyone to that list).
 * An empty result stays empty (nobody listed), never null (everyone).
 */
function narrowedUsers(original, changed) {
  if (!Array.isArray(changed)) return original;
  const ids = changed.map((u) => (typeof u === 'string' ? u : u?.id)).filter((id) => typeof id === 'string');
  return original ? original.filter((id) => ids.includes(id)) : [...new Set(ids)];
}

/**
 * Dice So Nice compatible `game.dice3d`. showForRoll applies the privacy matrix on every client
 * (the caller's and, with synchronize, each receiver's) and fires the RollStart/RollComplete
 * hooks for a call naming a message. `socket` (game.socket) enables synchronize; `_dispose`
 * stops listening on it. Every add* / get* member delegates to `registry`.
 *
 * preloadPresets holds the face textures it loads (one faceTextures reference per face set)
 * until a later preload stops referencing them or `_releasePreloads()` runs (main.js: the look
 * changed, or teardown), so the first roll finds them in the cache. Models stay in the model
 * loader's own cache.
 */
export function createDice3dApi({
  diceBox,
  gate,
  planThrow,
  getSetting,
  renderer = null,
  decorateFor = () => undefined,
  hooks = globalThis.Hooks,
  socket = null,
  currentUser = () => globalThis.game?.user,
  gmIds = () => globalThis.game?.users?.filter((u) => u.isGM).map((u) => u.id) ?? [],
  fromData,
  registry = createRegistry(),
  faceTextures = null,
  facesFor = () => undefined,
  getArea = () => measureArea(),
  importMigration = importMigrationModule,
}) {
  const warned = new Set();
  /** A malformed third-party call logs one warning per member, never throws. */
  const warnOnce = (name, detail) => {
    if (warned.has(name)) return;
    warned.add(name);
    console.warn(`dicer: game.dice3d.${name} ignored a malformed call`, detail);
  };

  const me = () => {
    try {
      return currentUser();
    } catch {
      return undefined;
    }
  };

  /** messageID -> the promise of the showForRoll animations registered with it, until settled. */
  const shows = new Map();
  function track(id, promise) {
    const combined = Promise.all([shows.get(id), promise]);
    shows.set(id, combined);
    const clear = () => {
      if (shows.get(id) === combined) shows.delete(id);
    };
    combined.then(clear, clear);
  }

  const callHook = (name, ...args) => {
    try {
      hooks?.callAll(name, ...args);
    } catch (err) {
      console.error(`dicer: a ${name} listener failed`, err);
    }
  };

  /** How a roll shows here; the content is visible to everyone unless blind (then GMs only). */
  function viewHere({ authorId, users, blind, ghost, secret }) {
    const user = me();
    const isGM = user?.isGM === true;
    return viewFor({
      contentVisible: !blind || isGM,
      isGM,
      isAuthor: user?.id != null && authorId === user.id,
      blind,
      whispered: Boolean(users),
      rollGhost: ghost,
      rollSecret: secret,
      showGhostDice: getSetting('showGhostDice') === true,
    });
  }

  function decoratorFor(roll, authorId) {
    try {
      return decorateFor(null, roll, authorId) || undefined;
    } catch (err) {
      console.error('dicer: cannot resolve the dice looks', err);
      return undefined;
    }
  }

  /** Verbose (enableDebugMode) logging of gate and showForRoll decisions. */
  const debugLog = (...args) => {
    if (api._debug.verbose) console.debug('dicer | debug', ...args);
  };

  function listGms() {
    try {
      return (gmIds() ?? []).filter((id) => typeof id === 'string');
    } catch (err) {
      console.error('dicer: cannot list the GMs', err);
      return [];
    }
  }

  /** Unique ids without the sender: the server would echo a payload to its own socket. */
  const withoutSelf = (ids) => {
    const self = me()?.id;
    return [...new Set(ids)].filter((id) => typeof id === 'string' && id !== self);
  };

  /**
   * Who may receive the real payload (P3-R12; the server honours `recipients` for module
   * sockets), or null for everyone. A secret or blind roll's results go to the GMs only
   * (P3-R14); a whispered one to the GMs and the listed users.
   */
  function recipientsFor(s, gms) {
    if (!s.secret && !s.users && !s.blind) return null;
    return withoutSelf(s.secret || s.blind ? gms : [...gms, ...(s.users ?? [])]);
  }

  /**
   * Two emits at most: the real roll to its recipients and, for a blind (not secret) roll with
   * showGhostDice on, a results-stripped ghost payload to the listed users who are not GMs, so
   * the real results never reach a socket that may not see them (P3-R14).
   */
  function broadcast(roll, s) {
    try {
      if (!sync) return;
      const gms = listGms();
      const payload = {
        v: 1,
        kind: 'show',
        roll: rollToData(roll),
        userId: s.authorId,
        users: s.users,
        blind: s.blind,
        ghost: s.ghost,
        secret: s.secret,
        messageID: s.messageID,
        speaker: s.speaker,
      };
      const recipients = recipientsFor(s, gms);
      if (!recipients || recipients.length) sync.broadcast(payload, recipients);
      if (!s.blind || s.secret || !s.users || getSetting('showGhostDice') !== true) return;
      const players = withoutSelf(s.users.filter((id) => !gms.includes(id)));
      if (!players.length) return;
      sync.broadcast({ ...payload, roll: stripResults(payload.roll), ghost: true }, players);
    } catch (err) {
      console.error('dicer: cannot synchronize a roll', err);
    }
  }

  /**
   * The local throw (no awaits before the dice are planned). A local call naming a message fires
   * RollStart first (a listener may make it blind, narrow its users, flag it ghost/secret, or
   * replace the thrown roll through dsnRoll) and RollComplete exactly once at the end, whatever
   * happens, the enabled setting being off included.
   */
  async function throwHere(roll, s) {
    const hooked = s.local && s.messageID != null;
    try {
      let toThrow = roll;
      if (hooked) {
        // A copy of users, so a listener mutating the list in place cannot widen ours.
        const users = s.users ? [...s.users] : null;
        const context = { roll, user: s.user, users, blind: s.blind, dsnRoll: roll };
        callHook('diceSoNiceRollStart', s.messageID, context);
        // Privacy-first (P3-R13): a listener can make the roll blind, never un-blind it; it can
        // narrow users, never widen them; a ghost/secret flag it sets on either roll applies to
        // the whole call. The local view and the payload both carry the result.
        if (context.blind) s.blind = true;
        s.users = narrowedUsers(s.users, context.users);
        for (const candidate of new Set([context.roll, context.dsnRoll])) {
          if (!isRollLike(candidate)) continue;
          s.ghost ||= Boolean(candidate.ghost);
          s.secret ||= Boolean(candidate.secret);
        }
        if (isRollLike(context.dsnRoll)) toThrow = context.dsnRoll;
      }
      if (s.synchronize) broadcast(toThrow, s);
      // Client-scope (P3-R11): turning 3D dice off here never suppresses the other clients' dice
      // nor the hooks an integration may wait on.
      if (!getSetting('enabled')) {
        debugLog('showForRoll', s.messageID, 'disabled');
        return false;
      }
      const view = viewHere(s);
      debugLog('showForRoll', s.messageID, view);
      if (view === 'none') return false;
      const { dice } = planThrow(toThrow, {
        maxDice: Number(getSetting('maxDice')) || 20,
        showExtra: getSetting('showExtraDice') !== false,
        decorate: view === 'ghost' ? () => ghostDecorator() : decoratorFor(toThrow, s.authorId),
      });
      if (!dice.length) return false;
      await diceBox.roll(dice).landed;
      return true;
    } catch (err) {
      console.error('dicer: showForRoll failed', err);
      return false;
    } finally {
      if (hooked) callHook('diceSoNiceRollComplete', s.messageID, []);
    }
  }

  /** Registers the messageID before throwHere runs, so a RollStart listener's wait waits too. */
  function run(roll, s) {
    let settle;
    const done = new Promise((r) => (settle = r));
    if (s.messageID != null) track(s.messageID, done);
    const promise = throwHere(roll, s);
    promise.then(settle, settle);
    return promise;
  }

  /** A synchronized roll from another client: same privacy and maxDice path, no hooks. */
  function receive(p) {
    return run(p.roll, {
      user: null,
      authorId: p.userId,
      users: p.users,
      blind: p.blind,
      ghost: p.ghost || Boolean(p.roll.ghost),
      secret: p.secret || Boolean(p.roll.secret),
      messageID: p.messageID,
      speaker: p.speaker,
      synchronize: false,
      local: false,
    });
  }

  const sync = socket ? createSync({ socket, currentUser: me, onShow: receive, fromData }) : null;

  /** A registry member, called so that a throw never reaches the third-party caller. */
  function reg(name, args, fallback) {
    try {
      return registry[name](...args);
    } catch (err) {
      warnOnce(name, err);
      return fallback?.();
    }
  }
  /** An async registry member: always a Promise resolving to undefined. */
  function regAsync(name, args) {
    try {
      return Promise.resolve(registry[name](...args)).then(
        () => undefined,
        (err) => warnOnce(name, err),
      );
    } catch (err) {
      warnOnce(name, err);
      return Promise.resolve();
    }
  }

  /** faceSet.key -> faceSet, each holding one faceTextures reference (see the factory doc). */
  const preloaded = new Map();

  /** Presets of every system the current user's looks name (a ref without one: standard). */
  function referencedPresets() {
    const systems = new Set();
    for (const ref of Object.values(readUserLooks(me()))) {
      systems.add(typeof ref.system === 'string' && ref.system ? ref.system : STANDARD_SYSTEM);
    }
    const presets = [];
    for (const id of systems) {
      const sys = registry.systems?.get?.(id);
      if (sys?.dice) for (const preset of sys.dice.values()) presets.push(preset);
    }
    return presets;
  }

  /** Releases every held face set not in `keep`. */
  function releasePreloads(keep = new Map()) {
    for (const [key, faces] of [...preloaded]) {
      if (keep.has(key)) continue;
      preloaded.delete(key);
      try {
        faceTextures?.release(faces);
      } catch (err) {
        warnOnce('preloadPresets', err);
      }
    }
  }

  /** Holds the presets' face sets (acquiring new ones onto `loads`), releasing the rest. */
  function preloadFaces(presets, loads) {
    const wanted = new Map();
    if (getSetting('presetFaces') !== false) {
      for (const preset of presets) {
        try {
          const faces = facesFor(preset);
          if (needsLayers(faces) && typeof faces.key === 'string') wanted.set(faces.key, faces);
        } catch (err) {
          warnOnce('preloadPresets', err);
        }
      }
    }
    for (const [key, faces] of wanted) {
      if (preloaded.has(key)) continue;
      try {
        loads.push(Promise.resolve(faceTextures.acquire(faces)));
        preloaded.set(key, faces); // only once acquired: each release must match a reference
      } catch (err) {
        warnOnce('preloadPresets', err);
      }
    }
    releasePreloads(wanted);
  }

  let debugHooked = false;

  const config = new Proxy(
    {
      get enabled() {
        return Boolean(getSetting('enabled'));
      },
      get maxDice() {
        return Number(getSetting('maxDice')) || 20;
      },
      get hideAfterRoll() {
        return Number(getSetting('timeBeforeHide')) > 0;
      },
      get showGhostDice() {
        return getSetting('showGhostDice') === true;
      },
      get immediatelyDisplayChatMessages() {
        return getSetting('immediatelyDisplayChatMessages') === true;
      },
    },
    // Read-only, yet a write never throws into a strict-mode caller: it is ignored.
    { set: () => true, deleteProperty: () => true, defineProperty: () => true },
  );

  const api = {
    addSystem(system, mode) {
      return reg('addSystem', [system, mode]);
    },
    addDicePreset(preset, shape) {
      return regAsync('addDicePreset', [preset, shape]);
    },
    addColorset(colorset, mode) {
      return regAsync('addColorset', [colorset, mode]);
    },
    addTexture(id, texture) {
      return regAsync('addTexture', [id, texture]);
    },
    addDiceShape(def) {
      return reg('addDiceShape', [def]);
    },
    addDamageTypeDefaults(map) {
      return reg('addDamageTypeDefaults', [map]);
    },
    addRole(role, options) {
      return reg('addRole', [role, options]);
    },
    getRole(id) {
      return reg('getRole', [id]);
    },
    getRoles() {
      return reg('getRoles', [], () => []);
    },
    addSFXTrigger(id, name, results) {
      return reg('addSFXTrigger', [id, name, results]);
    },
    addSFXMode(sfxClass) {
      return reg('addSFXMode', [sfxClass]);
    },
    addSFXDefaults(list) {
      return reg('addSFXDefaults', [list]);
    },
    getSFXDefaults() {
      return reg('getSFXDefaults', [], () => []);
    },
    getSFXModes() {
      return reg('getSFXModes', [], () => ({}));
    },
    getLoadedDiceSystems() {
      return reg('getLoadedDiceSystems', [], () => new Map());
    },

    /**
     * Loads the face textures (unless withTextures is false) and models of every preset the
     * current user's looks reference, honouring presetFaces / presetModels. Never starts the
     * render loop; never rejects.
     */
    async preloadPresets(withTextures = true) {
      const loads = [];
      try {
        const presets = referencedPresets();
        if (getSetting('presetModels') !== false) {
          for (const preset of presets) {
            if (preset.modelFile) loads.push(Promise.resolve().then(() => preset.loadModel?.()));
          }
        }
        if (withTextures !== false && faceTextures) preloadFaces(presets, loads);
      } catch (err) {
        warnOnce('preloadPresets', err);
      }
      for (const r of await Promise.allSettled(loads)) {
        if (r.status === 'rejected') warnOnce('preloadPresets', r.reason);
      }
    },

    /** Drops the face textures preloadPresets holds (main.js: the look changed). */
    _releasePreloads() {
      releasePreloads();
    },

    /** Task 14's migration.loadSaveFile(user, name); until it exists, warns and resolves. */
    async loadSaveFile(name) {
      try {
        const migration = await importMigration();
        if (typeof migration?.loadSaveFile !== 'function') {
          throw new Error('save-file migration is not available');
        }
        await migration.loadSaveFile(me(), name);
      } catch (err) {
        console.warn(`dicer: game.dice3d.loadSaveFile cannot load "${name}"`, err);
      }
    },

    /** A world point (die units) in page CSS px, through the renderer camera and the area. */
    getScreenPosition(vec3) {
      if (!vec3 || typeof vec3 !== 'object') {
        warnOnce('getScreenPosition', vec3);
        return { x: 0, y: 0 };
      }
      try {
        const v = new THREE.Vector3(Number(vec3.x) || 0, Number(vec3.y) || 0, Number(vec3.z) || 0);
        v.project(renderer.camera);
        const rect = getArea();
        return {
          x: rect.left + ((v.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - v.y) / 2) * rect.height,
        };
      } catch (err) {
        warnOnce('getScreenPosition', err);
        return { x: 0, y: 0 };
      }
    },

    /** Verbose logging of gate decisions (the message hooks) and showForRoll views. */
    enableDebugMode() {
      api._debug.verbose = true;
      if (debugHooked) return;
      debugHooked = true;
      for (const name of DEBUG_HOOKS) {
        try {
          hooks?.on?.(name, (...args) => debugLog(name, ...args));
        } catch (err) {
          console.error(`dicer: cannot listen to ${name}`, err);
        }
      }
    },

    get DiceFactory() {
      return registry.diceFactory;
    },
    get exports() {
      return registry.exports;
    },
    /** Box internals are declared unsupported (survey tier 3). */
    box: {},
    get canvas() {
      return renderer?.canvas ?? null;
    },
    /** Accepts any write; the shaders ignore them (survey tier 2 only sets custom glow). */
    uniforms: { moonPhase: 0 },
    /** A live, read-only view of the settings integrations read (midi-qol: dice3d.config). */
    get config() {
      return config;
    },
    /** api.js's DiceSystem, once Task 13 sets globalThis.DicerAPI. */
    get DiceSystem() {
      return globalThis.DicerAPI?.DiceSystem ?? null;
    },

    /**
     * While rolls appended to an existing message fly, hide only the elements matching
     * `selector` inside it instead of the whole message; null restores whole-message hiding.
     */
    setMessageUpdateHideSelector(selector) {
      try {
        if (!gate.setUpdateHideSelector(selector)) warnOnce('setMessageUpdateHideSelector', selector);
      } catch (err) {
        warnOnce('setMessageUpdateHideSelector', err);
      }
    },

    isEnabled() {
      return Boolean(getSetting('enabled'));
    },

    showExtraDiceByDefault() {
      return getSetting('showExtraDice') !== false;
    },

    /**
     * Shows a roll's dice outside the chat flow; with `synchronize`, on the other clients too.
     * Resolves true once landed, false when nothing was animated here.
     */
    showForRoll(
      roll,
      user = undefined,
      synchronize = false,
      users = null,
      blind = false,
      messageID = null,
      speaker = null,
      options = {},
    ) {
      if (!isRollLike(roll) || (users != null && !Array.isArray(users))) {
        warnOnce('showForRoll', roll);
        return Promise.resolve(false);
      }
      const author = user ?? me();
      return run(roll, {
        user: author,
        authorId: author?.id ?? me()?.id ?? null,
        users: idsOf(users),
        blind: Boolean(blind),
        ghost: Boolean(options?.ghost || roll.ghost),
        secret: Boolean(options?.secret || roll.secret),
        messageID: idOrNull(messageID),
        speaker: speaker && typeof speaker === 'object' ? speaker : null,
        synchronize: Boolean(synchronize),
        local: true,
      });
    },

    /** Local only: showForRoll without synchronize, users, blind or a message. */
    animateRoll(roll, options = {}) {
      return api.showForRoll(roll, me(), false, null, false, null, null, options);
    },

    /** The legacy `{throws: [{dice: [{type, result, resultLabel?, options?}]}]}` payload. */
    show(data, user = undefined, synchronize = false, users = null, blind = false) {
      const roll = legacyRoll(data);
      if (!roll) {
        warnOnce('show', data);
        return Promise.resolve(false);
      }
      return api.showForRoll(roll, user, synchronize, users, blind);
    },

    /** Waits on the chat gate's animation and on any showForRoll registered with this id. */
    waitFor3DAnimationByMessageID(id) {
      return Promise.all([gate.waitFor(id), shows.get(id)]).then(() => true);
    },

    get messageHookDisabled() {
      return gate.disabled;
    },
    set messageHookDisabled(value) {
      gate.disabled = value;
    },

    /** Stops receiving synchronized rolls and drops the preloaded faces (engine teardown). */
    _dispose() {
      sync?.dispose();
      releasePreloads();
    },

    _debug: {
      verbose: false,
      get isLooping() {
        return Boolean(renderer?.isLooping);
      },
      get activeRolls() {
        return diceBox.activeRolls;
      },
    },
  };
  return api;
}

import * as THREE from 'three';
import { viewFor } from '../compat/privacy.js';
import { createSync, rollToData, ghostRollData, ghostRoll } from '../compat/sync.js';
import { createRegistry } from '../compat/registry.js';
import { readUserLooks } from '../compat/user-looks.js';
import { measureArea } from '../foundry/area.js';
import { moduleRulesOf } from '../effects/fx-resolver.js';
import { getShape } from '../core/dice-shapes.js';
import { EFFECT_IDS } from '../effects/effect-ids.js';
import { resolveDamageTheme } from '../effects/damage-themes.js';
import { PRESETS, normalizeAreaDef } from '../areas/area-model.js';
import { areaDefFor, withArea } from '../areas/area-store.js';
import { isGmOnly } from '../areas/gm-only.js';
import { petFor } from '../pet/pet-for.js';
import { isHandRoll, allPhysical } from '../hand/gate-hand.js';
import { filtered } from '../foundry/roll-filters.js';
import { loadHand, handNow } from '../hand/hand-loader.js';
import { gpuName } from '../render/gpu-name.js';

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
  migrationModules[MIGRATION_PATH]?.() ??
  Promise.reject(new Error('compat/migration.js is not built yet'));

/** True when a face set has image or text faces (rasterized into face layers). */
const needsLayers = (faces) =>
  Array.isArray(faces?.labels) &&
  faces.labels.some((l) => l?.kind === 'image' || l?.kind === 'text');

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
  const ids = users
    .map((u) => (typeof u === 'string' ? u : u?.id))
    .filter((id) => typeof id === 'string');
  return ids.length ? ids : null;
}

/** Face count of a legacy die type: 'd20' -> 20, 'dc' (coin) -> 2; anything else is skipped. */
function legacyFaces(type) {
  if (type === 'dc') return 2;
  const m = /^d(\d+)$/.exec(String(type));
  return m ? Number(m[1]) : undefined;
}

/** A legacy 'df' die as a Roll-like term: dsnTypeOf gives 'df', like Foundry's FateDie. */
class LegacyFateTerm {
  static DENOMINATION = 'f';
  minValue = -1;
}

/** The legacy show() payload as a Roll-like `{dice: [{faces, results, options}]}`, or null. */
function legacyRoll(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.throws)) return null;
  const dice = [];
  for (const t of data.throws) {
    for (const d of Array.isArray(t?.dice) ? t.dice : []) {
      if (!d || typeof d !== 'object' || !Number.isFinite(d.result)) continue;
      const entry = {
        faces: legacyFaces(d.type),
        results: [{ result: d.result, active: true }],
        options: d.options && typeof d.options === 'object' ? d.options : {},
      };
      // A Fate die: a term of Foundry's FateDie shape (DENOMINATION 'f', -1 / 0 / +1), not a d3.
      dice.push(String(d.type).toLowerCase() === 'df' ? Object.assign(new LegacyFateTerm(), entry, { faces: 3 }) : entry);
    }
  }
  return { dice };
}

/**
 * Debug counters (P4-R4): effect id -> times a landed effect started, and result sound name ->
 * times one was requested, on this client. Names only, never values: the privacy live test
 * (tests/live/effects.mjs) reads them through game.dice3d._debug.
 */
export function createDebugCounters() {
  const counters = { fxPlays: {}, resultSounds: {} };
  const bump = (table) => (name) => {
    if (typeof name !== 'string' || !name) return;
    table[name] = (table[name] ?? 0) + 1;
  };
  return { ...counters, countFx: bump(counters.fxPlays), countSound: bump(counters.resultSounds) };
}

const ghostDecorator = () => ({ ghost: true });

/**
 * Who may receive a roll's real payload (P3-R12/R14; the server honours `recipients` for module
 * sockets), or null for everyone: a secret or blind roll's results go to the GMs only, a
 * whispered one to the GMs and the listed `users`. Unique ids, never `selfId` (the server would
 * echo to its own socket). Shared by showForRoll's sync and the hand trajectory (Task 8).
 */
export function recipientsOf(s, gms, selfId) {
  if (!s.secret && !s.users && !s.blind) return null;
  const ids = s.secret || s.blind ? gms : [...gms, ...(s.users ?? [])];
  return [...new Set(ids)].filter((id) => typeof id === 'string' && id !== selfId);
}

/** The GPU renderer string of the dice canvas (the unmasked one when the browser allows), or 'unknown'. */
function readGpu(renderer) {
  try {
    return gpuName(renderer?.glRenderer?.getContext?.()) || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The users a RollStart listener left, as a narrowing only: a non-array keeps the original, an
 * array is intersected with the original (null -> array narrows from everyone to that list).
 * An empty result stays empty (nobody listed), never null (everyone).
 */
function narrowedUsers(original, changed) {
  if (!Array.isArray(changed)) return original;
  const ids = changed
    .map((u) => (typeof u === 'string' ? u : u?.id))
    .filter((id) => typeof id === 'string');
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
  getUser = (id) => globalThis.game?.users?.get(id),
  gmIds = () => globalThis.game?.users?.filter((u) => u.isGM).map((u) => u.id) ?? [],
  fromData,
  registry = createRegistry(),
  faceTextures = null,
  facesFor = () => undefined,
  getArea = () => measureArea(),
  areaFor = () => null,
  writeSetting = (key, value) => globalThis.game.settings.set('dicer', key, value),
  importMigration = importMigrationModule,
  debugCounters = createDebugCounters(),
  getAtlas = () => null,
  getFonts = () => null,
  getTier = () => null,
  getQualityDrops = () => [],
  getGpu = () => readGpu(renderer),
  importBench = () => import('../bench/dicer-adapter.js'),
  onHand,
}) {
  const warned = new Set();
  /** A malformed third-party call logs one warning per member, never throws. */
  const warnOnce = (name, detail) => {
    if (warned.has(name)) return;
    warned.add(name);
    console.warn(`dicer: game.dice3d.${name} ignored a malformed call`, detail);
  };

  /**
   * One local die for a preview: a d100 shows as a d10, an unknown type as a d20, and the value
   * is one of the shape's faces (its max when missing or not a face). Returns diceBox.roll's result.
   */
  function throwPreviewDie({ type = 'd20', value, fx, appearance, soundMaterial }) {
    let die = type === 'd100' ? 'd10' : type;
    let shape;
    try {
      shape = getShape(die);
    } catch {
      die = 'd20';
      shape = getShape(die);
    }
    const face = shape.values.includes(value) ? value : Math.max(...shape.values);
    const spec = { type: die, value: face };
    if (fx) spec.fx = [fx];
    if (appearance) spec.appearance = appearance;
    if (typeof soundMaterial === 'string' && soundMaterial) spec.soundMaterial = soundMaterial;
    return diceBox.roll([spec], { mine: 'always' }); // a preview: above the window it came from
  }

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

  /**
   * How a roll shows here; the content is visible to everyone unless blind (then GMs only).
   * The author for privacy is the verified sender (P3-R18), never the caller's `user` argument.
   */
  function viewHere({ senderId, users, blind, ghost, secret }) {
    const user = me();
    const isGM = user?.isGM === true;
    return viewFor({
      contentVisible: !blind || isGM,
      isGM,
      isAuthor: user?.id != null && senderId === user.id,
      blind,
      whispered: Boolean(users),
      rollGhost: ghost,
      rollSecret: secret,
      showGhostDice: getSetting('showGhostDice') === true,
    });
  }

  /**
   * The real-view decorator: `authorId` picks the look; the verified sender is the roller whose
   * trigger rules apply (P3-R18: the caller's `user` never chooses rules or runs macros).
   */
  function decoratorFor(roll, authorId, senderId) {
    try {
      return decorateFor(null, roll, authorId, senderId) || undefined;
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
   * Two emits at most: the roll to its recipients and, for a blind (not secret) roll with
   * showGhostDice on, an allow-list ghost payload (ghostRollData, P3-R16) to the listed users who
   * are not GMs, so the real results never reach a socket that may not see them (P3-R14). A roll
   * that is ghost for everyone sends only ghost data, to everyone it goes to (P3-R17).
   * `userId` is the real sender, which receivers check against the server's sender id; the
   * caller's `user` travels as `authorId`, for the dice look only (P3-R18).
   */
  function broadcast(roll, s) {
    try {
      if (!sync) return;
      const gms = listGms();
      const data = rollToData(roll);
      const payload = {
        v: 1,
        kind: 'show',
        roll: s.ghost ? ghostRollData(data) : data,
        userId: s.senderId,
        authorId: s.authorId,
        users: s.users,
        blind: s.blind,
        ghost: s.ghost,
        secret: s.secret,
        messageID: s.messageID,
        speaker: s.speaker,
      };
      const recipients = recipientsOf(s, gms, me()?.id);
      if (!recipients || recipients.length) sync.broadcast(payload, recipients);
      if (!s.blind || s.secret || !s.users || getSetting('showGhostDice') !== true) return;
      const players = withoutSelf(s.users.filter((id) => !gms.includes(id)));
      if (!players.length) return;
      sync.broadcast({ ...payload, roll: ghostRollData(data), ghost: true }, players);
    } catch (err) {
      console.error('dicer: cannot synchronize a roll', err);
    }
  }

  /**
   * The area this throw lands in here: the verified sender's (P5-D1; the caller's `user` never
   * chooses it), or the GM private corner for a real view of a roll only GMs can see (blind, or
   * whispered to GMs only); the resolver also requires a GM client and the setting (P5-D7).
   * A failing lookup throws on the whole stage.
   */
  function areaHere(s, view) {
    try {
      const gms = s.users?.length ? listGms() : [];
      const gmOnly = isGmOnly({
        blind: Boolean(s.blind),
        secret: Boolean(s.secret),
        recipients: s.users,
        isGm: (id) => gms.includes(id),
      });
      return areaFor({ rollerId: s.senderId ?? undefined, gmPrivate: view === 'real' && gmOnly }) ?? null;
    } catch (err) {
      console.error('dicer: cannot resolve the roll area', err);
      return null;
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
      // H-18: this user threw it by hand and saw it land; it is not animated again here.
      if (isHandRoll(toThrow) && toThrow.options.dicerHand.by === me()?.id) return false;
      // Every die rolled on physical dice (Pixels, manual entry) and this player skips those.
      if (getSetting('physicalDice') === 'skip' && allPhysical(toThrow)) return false;
      // Roll filters (initiative, roll tables, combat, damage...): this player's or the GM's choice.
      const message = s.messageID != null ? globalThis.game?.messages?.get?.(s.messageID) : null;
      const ctx = { mine: (message?.author?.id ?? s.authorId) === me()?.id, secret: !!(s.blind || s.secret || message?.whisper?.length), combat: !!globalThis.game?.combat?.started };
      if (filtered(toThrow, message, ctx, getSetting('rollFilters'), getSetting('rollFiltersDefault'))) return false;
      // Client-scope (P3-R11): turning 3D dice off here never suppresses the other clients' dice
      // nor the hooks an integration may wait on.
      if (!getSetting('enabled')) {
        debugLog('showForRoll', s.messageID, 'disabled');
        return false;
      }
      const view = viewHere(s);
      debugLog('showForRoll', s.messageID, view);
      if (view === 'none') return false;
      // A ghost is planned from its ghost shape (P3-R20), never from the real results.
      const ghost = view === 'ghost';
      const { dice } = planThrow(ghost ? ghostRoll(toThrow) : toThrow, {
        maxDice: Number(getSetting('maxDice')) || 20,
        showExtra: getSetting('showExtraDice') !== false,
        decorate: ghost ? () => ghostDecorator() : decoratorFor(toThrow, s.authorId, s.senderId),
      });
      if (!dice.length) return false;
      const area = areaHere(s, view);
      const pet = petFor({ user: getUser(s.senderId), view, getSetting });
      // No area and no pet: the whole stage, called exactly as before areas existed.
      const opts = {};
      if (area) opts.area = area;
      if (pet) opts.pet = pet;
      // Only 'mine' layering needs it (dice above windows while this user's own roll shows).
      if (getSetting('diceAboveWindows') === 'mine' && s.senderId != null && s.senderId === me()?.id) opts.mine = true;
      await (Object.keys(opts).length ? diceBox.roll(dice, opts) : diceBox.roll(dice)).landed;
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
      senderId: p.userId,
      authorId: p.authorId ?? p.userId,
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

  const sync = socket ? createSync({ socket, currentUser: me, onShow: receive, onHand, fromData }) : null;

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

  const isGmHere = () => me()?.isGM === true;
  /** GM-only write: a player's call writes nothing, warns once and resolves false. */
  async function writeAreas(name, key, build) {
    if (!isGmHere()) {
      warnOnce('rollAreas (GM only)', name);
      return false;
    }
    try {
      const value = build();
      if (value === null) {
        // Never overwrite stored data we cannot read (or a "__proto__" id).
        warnOnce('rollAreas (unreadable data)', name);
        return false;
      }
      await writeSetting(key, value);
      return true;
    } catch (err) {
      console.warn(`dicer: game.dice3d.rollAreas.${name} could not save`, err);
      return false;
    }
  }
  const rollAreas = Object.freeze({
    presets: Object.freeze(Object.keys(PRESETS)),
    get(userId = null) {
      // Exactly what the dice use (the resolver's rule), as a copy.
      try {
        return areaDefFor(getSetting, userId);
      } catch (err) {
        warnOnce('rollAreas.get', err);
        return { preset: 'full' };
      }
    },
    rect(userId = null) {
      try {
        // No area from the resolver means the whole usable stage.
        const rect = areaFor({ rollerId: userId ?? undefined, gmPrivate: false }) ?? getArea();
        const { left, top, width, height } = rect;
        return { left, top, width, height };
      } catch (err) {
        warnOnce('rollAreas.rect', err);
        return null;
      }
    },
    set(userId, def) {
      return writeAreas('set', 'rollAreas', () => withArea(getSetting('rollAreas'), userId ?? null, def));
    },
    setGmPrivateArea(def) {
      return writeAreas('setGmPrivateArea', 'gmPrivateArea', () => normalizeAreaDef(def));
    },
  });

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

    /** Dicer's own roll-area API (P5; Dice So Nice has none). */
    rollAreas,

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
        if (!gate.setUpdateHideSelector(selector))
          warnOnce('setMessageUpdateHideSelector', selector);
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
        senderId: me()?.id ?? null,
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

    /**
     * Local only: throws one die (default d20, showing its max) whose spec carries the effect
     * `id` (a library id or a `dsn:` id) with `opts` {color, intensity, duration}. Never
     * synchronized, no chat message, no hooks. Resolves true once the roll finished, false for
     * an unknown id or when effects are off.
     */
    async previewEffect(id, opts = {}) {
      const { die = 'd20', value, ...effectOpts } = opts ?? {};
      if (typeof id !== 'string' || !(EFFECT_IDS.includes(id) || id.startsWith('dsn:'))) {
        warnOnce(`previewEffect:${id}`, id);
        return false;
      }
      if (getSetting('effects') === false) {
        const loc = globalThis.game?.i18n?.localize?.bind(globalThis.game.i18n);
        globalThis.ui?.notifications?.info(loc ? loc('DICER.Effects.PreviewOff') : 'DICER.Effects.PreviewOff');
        return false;
      }
      try {
        const fx = { effect: { id, ...effectOpts } };
        await throwPreviewDie({ type: die, value, fx }).finished;
        return true;
      } catch (err) {
        warnOnce('previewEffect', err);
        return false;
      }
    },

    /**
     * Local only, never broadcast: flares the living inside of the dice of a roll on this screen
     * (a roll id, or the id of its ChatMessage), or of one die by index. `amount` 0..1, `duration`
     * ms. True when at least one die flared; false for the insideFlare setting off, an unknown
     * target, or no die with a moving inside.
     */
    flareInside: (target, opts) => diceBox.flareInside?.(target, opts) === true,

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
      /** effect id -> times a landed effect started on this client. */
      get fxPlays() {
        return { ...debugCounters.fxPlays };
      },
      /** result sound name -> times one was requested on this client. */
      get resultSounds() {
        return { ...debugCounters.resultSounds };
      },
      get isLooping() {
        return Boolean(renderer?.isLooping);
      },
      /** The loop is held (resting pets or dice, no frames): idle for every idleness check. */
      get isHolding() {
        return Boolean(renderer?.isHolding);
      },
      get activeRolls() {
        return diceBox.activeRolls;
      },
      /** Benchmark probes (Plan 8): all free while idle, none ever throws. */
      get frameCount() {
        return renderer?.frameCount ?? 0;
      },
      get generation() {
        return renderer?.generation ?? 0;
      },
      get resources() {
        return renderer?.resourceCounts?.() ?? { geometries: 0, textures: 0, programs: 0 };
      },
      get tier() {
        try {
          return getTier() ?? null;
        } catch {
          return null;
        }
      },
      get canvas() {
        return renderer?.canvas ?? null;
      },
      /** P9-R8: this session's adaptive tier drops, {at, from, to, path, ...judge numbers}. */
      get qualityDrops() {
        try {
          return getQualityDrops() ?? [];
        } catch {
          return [];
        }
      },
      /** message id -> ms from the gate intercepting it to the first drawn frame (last 50). */
      get firstFrames() {
        try {
          return gate.firstFrames?.() ?? {};
        } catch {
          return {};
        }
      },
      /**
       * The most recent roll's area on this client (P5-R4): `{area: {cx, cz, halfWidth, halfDepth}
       * in die units, rect: {left, top, width, height} in px}`, or null. Copies. Owner live test.
       */
      get lastRollArea() {
        try {
          return diceBox.lastRollArea ?? null;
        } catch {
          return null;
        }
      },
      /**
       * message id -> view kinds ('real' | 'ghost' | 'none') per roll for the last messages
       * this client handled. Kinds only, never values: the privacy live test reads it.
       */
      get lastRollViews() {
        try {
          return gate.recentViews?.() ?? {};
        } catch {
          return {};
        }
      },
    },
  };
  // Trigger editor support (Task 12): non-enumerable so they are not part of the DSN surface.
  const moduleRules = moduleRulesOf(registry);
  let benchmarking = false;
  Object.defineProperties(api, {
    /** The benchmark's seam: cb() when the next roll's dice are first drawn (null disarms). */
    _benchArmFirstFrame: {
      value(cb) {
        diceBox.armFirstFrame?.(cb);
      },
    },
    /** The benchmark's hand replay: no payload loads the chunk, a payload replays it (landed, or false). */
    _benchHand: {
      value: (p) => (p && handNow() ? handNow().benchReplay(diceBox, p) : loadHand(diceBox)),
    },
    /**
     * The in-game benchmark (Plan 8): rolls a few scenarios locally (showForRoll, no synchronize, no
     * chat message, nothing sent) and resolves `{suite, text}`, text being a shareable summary.
     * Refuses (a notice, null) while dice are in the air or another run is going. The code loads
     * lazily, so it costs nothing at world start.
     */
    benchmark: {
      async value({ scenarios, onProgress } = {}) {
        const loc = (k) => globalThis.game?.i18n?.localize?.(k) ?? k;
        if (!getSetting('enabled')) {
          globalThis.ui?.notifications?.warn(loc('DICER.Bench.Disabled'));
          return null;
        }
        if (benchmarking || api._debug.activeRolls > 0) {
          globalThis.ui?.notifications?.warn(loc('DICER.Bench.Busy'));
          return null;
        }
        benchmarking = true;
        try {
          const bench = await importBench();
          return await bench.runDicerBenchmark(api, {
            scenarios: scenarios ?? bench.DEFAULT_SCENARIOS,
            onProgress,
            hooks,
            gpu: getGpu,
            maxDice: () => Number(getSetting('maxDice')) || 20,
            version: globalThis.game?.modules?.get?.('dicer')?.version ?? null,
          });
        } finally {
          benchmarking = false;
        }
      },
    },
    /** Local only: throws one die whose spec carries `fx`. Never broadcast, no chat message, no hooks. */
    _preview: {
      value(fx, { type = 'd20', value, appearance, soundMaterial } = {}) {
        // appearance / soundMaterial: a damage theme's look for the damage map editor's preview.
        try {
          return throwPreviewDie({ type, value, fx, appearance, soundMaterial }).landed;
        } catch (err) {
          warnOnce('_preview', err);
          return Promise.resolve();
        }
      },
    },
    /**
     * Local only: throws one die of each type (or of `types`) with a theme's look (the editor and
     * browser Throw buttons; the pet window's Preview throws one d20 with the user's own look).
     */
    _throwLook: {
      value(theme, types = ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
        try {
          const specs = types.map((type) => {
            const values = getShape(type).values;
            const spec = { type, value: values[Math.floor(Math.random() * values.length)] };
            const appearance = theme?.perType?.[type] ?? theme?.appearance;
            if (appearance) spec.appearance = appearance;
            // A module dice set (a theme browser system entry): its preset's faces and model, as
            // a roll with that look gets them (resolve-looks.js).
            const preset = theme?.kind === 'system' && registry.presetFor?.(theme.key, type);
            if (preset)
              Object.assign(spec, { system: theme.key, dsnType: type, faces: facesFor(preset), model: preset.modelUrl ?? preset.modelFile });
            return spec;
          });
          const pet = petFor({ user: me(), view: 'real', getSetting });
          // A preview: above the editor or browser window it came from, whatever diceAboveWindows says.
          return diceBox.roll(specs, pet ? { pet, mine: 'always' } : { mine: 'always' }).landed;
        } catch (err) {
          warnOnce('_throwLook', err);
          return Promise.resolve();
        }
      },
    },
    /** What the damage map editor needs: DSN colorset names, DSN damage defaults, a theme resolver. */
    _damageContext: {
      value() {
        return {
          colorsets: [...registry.colorsets.keys()].map(String),
          damageTypeDefaults: { ...registry.damageTypeDefaults },
          resolveTheme: (type, { userOverrides, worldMap } = {}) =>
            resolveDamageTheme(type, { userOverrides, worldMap, registry, warn: () => {} }),
        };
      },
    },
    /**
     * What the theme browser needs: the digit atlas its thumbnail renderer draws numbers with,
     * and the font layer for looks with another numbers.font.
     */
    _themeContext: {
      value() {
        return { atlas: getAtlas(), fonts: getFonts() };
      },
    },
    /** What the editor needs from the registry: module rules, trigger ids with labels, SFX modes, dice types. */
    _triggerContext: {
      value() {
        const triggers = [...(registry.sfxTriggers?.values() ?? [])].map((t) => ({
          id: t.id,
          name: typeof t.name === 'string' && t.name ? t.name : t.id,
          results: Array.isArray(t.results)
            ? t.results.filter((r) => typeof r === 'string' || typeof r === 'number').map(String)
            : [],
        }));
        const diceTypes = new Set();
        for (const sys of registry.systems.values()) for (const type of sys.dice.keys()) diceTypes.add(type);
        return {
          moduleRules: moduleRules(),
          triggers,
          modes: registry.getSFXModes(),
          diceTypes: [...diceTypes],
        };
      },
    },
  });
  return api;
}

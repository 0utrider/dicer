import { viewFor } from '../compat/privacy.js';
import { createSync, rollToData } from '../compat/sync.js';

/** DSN registration methods that Plan 3 implements; `async` ones return a Promise in DSN. */
const SYNC_STUBS = [
  'addSystem',
  'addDiceShape',
  'addSFXTrigger',
  'addSFXMode',
  'addDamageTypeDefaults',
  'addRole',
];
const ASYNC_STUBS = ['addDicePreset', 'addColorset', 'addTexture'];

/**
 * No-op stand-ins so integrations that register systems, presets, colorsets or textures in
 * their diceSoNiceReady handler do not throw. Each logs once, at debug level.
 */
function registrationStubs() {
  const logged = new Set();
  const note = (name) => {
    if (logged.has(name)) return;
    logged.add(name);
    console.debug(`dicer: game.dice3d.${name} is a no-op until Plan 3 implements it`);
  };
  const stubs = {};
  for (const name of SYNC_STUBS) stubs[name] = () => note(name);
  for (const name of ASYNC_STUBS) {
    stubs[name] = () => {
      note(name);
      return Promise.resolve();
    };
  }
  stubs.getLoadedDiceSystems = () => new Map();
  stubs.getSFXModes = () => ({});
  return stubs;
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
 * stops listening on it.
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

  /**
   * Who may receive a payload (P3-R12; the server honours `recipients` for module sockets), or
   * null for everyone. A secret roll only ever shows to GMs; a whispered or blind one to the GMs
   * and the listed users. The sender is left out: the server would echo it to its own socket.
   */
  function recipientsFor(s) {
    if (!s.secret && !s.users && !s.blind) return null;
    let gms = [];
    try {
      gms = gmIds() ?? [];
    } catch (err) {
      console.error('dicer: cannot list the GMs', err);
    }
    const self = me()?.id;
    const ids = s.secret ? gms : [...gms, ...(s.users ?? [])];
    return [...new Set(ids)].filter((id) => typeof id === 'string' && id !== self);
  }

  function broadcast(roll, s) {
    try {
      if (!sync) return;
      const recipients = recipientsFor(s);
      if (recipients && !recipients.length) return;
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
      sync.broadcast(payload, recipients);
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
      if (!getSetting('enabled')) return false;
      const view = viewHere(s);
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

  const api = {
    ...registrationStubs(),

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

    /** Stops receiving synchronized rolls (engine teardown). */
    _dispose() {
      sync?.dispose();
    },

    _debug: {
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

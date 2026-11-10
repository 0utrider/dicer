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

/**
 * Minimal Dice So Nice compatible `game.dice3d`. Plan 1 animates locally only: `synchronize`,
 * `users`, `speaker` and `options` are accepted for signature compatibility (sync is Plan 3).
 */
export function createDice3dApi({ diceBox, gate, planThrow, getSetting, renderer = null }) {
  const api = {
    ...registrationStubs(),

    isEnabled() {
      return Boolean(getSetting('enabled'));
    },

    // eslint-disable-next-line no-unused-vars
    async showForRoll(roll, user, synchronize, users, blind, messageID, speaker, options) {
      try {
        if (blind || !getSetting('enabled')) return false;
        const { dice } = planThrow(roll, { maxDice: Number(getSetting('maxDice')) || 20 });
        if (!dice.length) return false;
        await diceBox.roll(dice).landed;
        return true;
      } catch (err) {
        console.error('dicer: showForRoll failed', err);
        return false;
      }
    },

    waitFor3DAnimationByMessageID(id) {
      return gate.waitFor(id);
    },

    get messageHookDisabled() {
      return gate.disabled;
    },
    set messageHookDisabled(value) {
      gate.disabled = value;
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

/**
 * Minimal Dice So Nice compatible `game.dice3d`. Plan 1 animates locally only: `synchronize`,
 * `users`, `speaker` and `options` are accepted for signature compatibility (sync is Plan 3).
 */
export function createDice3dApi({ diceBox, gate, planThrow, getSetting, renderer = null }) {
  const api = {
    isEnabled() {
      return Boolean(getSetting('enabled'));
    },

    // eslint-disable-next-line no-unused-vars
    async showForRoll(roll, user, synchronize, users, blind, messageID, speaker, options) {
      try {
        if (blind) return false;
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

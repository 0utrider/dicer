/**
 * Foundry stamps `CONFIG.sounds.dice` onto every roll message when it is created
 * (ChatMessage#_preCreate) and each client plays it when the card is posted. With Dicer
 * animating the dice that sound is a second, unrelated clatter, so on the author's client, in
 * `preCreateChatMessage`, it is removed from the message before it is stored, for everyone.
 * Only Foundry's own dice sound on a message with dice Dicer animates is removed: a sound a system
 * or module chose is kept, as is the sound of a message flagged not to animate.
 */

const flagOf = (message, key) => message?.flags?.['dice-so-nice']?.[key] ?? message?.flags?.dicer?.[key];

/**
 * @param {object} message the chat message being created
 * @param {{enabled: boolean, coreSound: string}} opts
 */
export function shouldDropCoreDiceSound(message, { enabled, coreSound }) {
  try {
    if (!enabled || !message || !coreSound || message.sound !== coreSound) return false;
    if (flagOf(message, 'skip') || flagOf(message, 'pendingCard')) return false;
    const rolls = Array.isArray(message.rolls) ? message.rolls : [];
    return rolls.some((roll) => Array.isArray(roll?.dice) && roll.dice.length > 0);
  } catch {
    return false;
  }
}

/** The `preCreateChatMessage` handler: clears the sound on the message source when it should go. */
export function dropCoreDiceSound(message, opts) {
  try {
    if (shouldDropCoreDiceSound(message, opts)) message.updateSource({ sound: null });
  } catch (err) {
    console.warn("dicer: could not remove Foundry's dice sound", err);
  }
}

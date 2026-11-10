/**
 * The privacy matrix: how one roll is shown to one viewing user.
 *   'real'  the dice show their true values
 *   'ghost' neutral dice that reveal only that a roll happened
 *   'none'  nothing is thrown
 *
 * Privacy outranks looks and compatibility, so every branch that is not clearly allowed to show
 * the real dice falls through to a less revealing view. Rules, first match wins:
 *   1. a secret roll is real only for a GM who can see the message's content, otherwise none
 *   2. unreadable content: ghosts when showGhostDice and (whispered, or blind and the author)
 *   3. unreadable content otherwise: none
 *   4. a ghost-flagged roll: ghost, for everyone (the GM included)
 *   5. real
 *
 * @param {{ contentVisible: boolean, isGM: boolean, isAuthor: boolean, blind: boolean,
 *   whispered: boolean, rollGhost: boolean, rollSecret: boolean, showGhostDice: boolean }} input
 * @returns {'real' | 'ghost' | 'none'}
 */
export function viewFor({
  contentVisible,
  isGM,
  isAuthor,
  blind,
  whispered,
  rollGhost,
  rollSecret,
  showGhostDice,
}) {
  if (rollSecret && !(isGM && contentVisible)) return 'none';
  // Foundry delivers a whispered roll message to everyone (ChatMessage#visible is true for rolls),
  // content hidden. A real blind roll is whispered to the GMs, so `whispered` already covers its
  // author; `blind && isAuthor` only matters for a blind roll with an empty whisper list.
  if (!contentVisible) {
    return showGhostDice && (whispered || (blind && isAuthor)) ? 'ghost' : 'none';
  }
  if (rollGhost) return 'ghost';
  return 'real';
}

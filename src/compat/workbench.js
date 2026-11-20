/**
 * PF2e Workbench (xdy-pf2e-workbench): its "Cancel untargeted attack" (reminderTargeting:
 * mustTarget) cancels an attack's chat message in preCreateChatMessage when the roller has no
 * target. That runs after the roll is evaluated, so a roll Dicer throws while evaluating (physics
 * decides, or by hand) would fly for an attack that never happens. PF2e's CheckRoll carries its
 * check type in its options from the start: such a roll is seen here and not thrown.
 */
const WORKBENCH = 'xdy-pf2e-workbench';
const ATTACKS = ['attack-roll', 'spell-attack-roll'];

/** True when Workbench will cancel `roll`'s message: an attack by `user` (game.user) with no target. */
export function workbenchCancels(roll, user, game = globalThis.game) {
  try {
    if (!ATTACKS.includes(roll?.options?.type)) return false;
    if (!game?.modules?.get?.(WORKBENCH)?.active) return false;
    if (game.settings.get(WORKBENCH, 'reminderTargeting') !== 'mustTarget') return false;
    return !(user?.targets?.size > 0);
  } catch {
    return false; // a setting not registered: Workbench cancels nothing
  }
}

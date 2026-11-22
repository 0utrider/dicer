/**
 * Other modules' dice trays under the chat input (issue #5), and how to switch each one off: its
 * module id and the user-scope Boolean setting that shows it. Shared by the chat dice bar (which
 * stays hidden while one of these is on) and the tray picker (tray-pick.js). Add a tray with its
 * module id, setting key and whether a change needs a reload. main.js keeps a copy of the ids
 * (TRAY_MODULE_IDS) so it loads the picker only where one is active; a test checks they match.
 */
export const OTHER_TRAYS = [
  { id: 'dice-calculator', setting: 'enableDiceTray', reload: true }, // Dice Tray
  { id: 'pf2e-hud', setting: 'dice.enabled', reload: false }, // PF2e HUD's dice panel
];

/** The registered setting `id.key`'s value, or undefined (not registered). Never throws. */
function read(game, id, key) {
  try {
    if (!game?.settings?.settings?.has?.(`${id}.${key}`)) return undefined;
    return game.settings.get(id, key);
  } catch {
    return undefined;
  }
}

/** The other trays whose module is active and whose own setting shows them: [{ ...entry, title }]. */
export function activeOtherTrays(game = globalThis.game) {
  return OTHER_TRAYS.filter((t) => game?.modules?.get?.(t.id)?.active && read(game, t.id, t.setting) === true).map(
    (t) => ({ ...t, title: game.modules.get(t.id).title ?? t.id }),
  );
}

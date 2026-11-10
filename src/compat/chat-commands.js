/**
 * Chat commands for the chat-commands module (`chatCommandsReady` hook). All three names open
 * the settings, so a macro or habit written for Dice So Nice's `/dsn` keeps working.
 */

export const COMMAND_NAMES = ['/dice3d', '/d3d', '/dsn'];

/**
 * @param {{ register?: (command: object) => void } | null} chatCommands the API the hook passes
 * @param {{ openSettings: () => void, description?: string }} deps
 */
export function registerChatCommands(chatCommands, { openSettings, description = '' }) {
  if (typeof chatCommands?.register !== 'function') return;
  const callback = () => {
    try {
      openSettings();
    } catch (err) {
      console.warn('dicer: cannot open the settings from a chat command', err);
    }
    return {}; // no chat message is posted
  };
  for (const name of COMMAND_NAMES) {
    try {
      chatCommands.register({
        name,
        module: 'dicer',
        callback,
        shouldDisplayToChat: false,
        icon: '<i class="fas fa-dice-d20"></i>',
        description,
      });
    } catch (err) {
      console.warn(`dicer: cannot register the ${name} chat command`, err);
    }
  }
}

/** Built-in result sound names. Tiny and dependency-free: the editor lists them without pulling the synth chunk. */
export const RESULT_SOUNDS = ['chime', 'fanfare', 'sparkle', 'fizzle', 'thud', 'whoosh', 'crackle', 'zap', 'boom', 'petHappy', 'petSad'];
/** The pet's own sounds: never offered as a user-facing sound choice. */
export const USER_SOUNDS = RESULT_SOUNDS.filter((n) => !n.startsWith('pet'));

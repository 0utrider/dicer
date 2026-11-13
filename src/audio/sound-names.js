/** Built-in result sound names. Tiny and dependency-free: the editor lists them without pulling the synth chunk. */
export const USER_SOUNDS = ['chime', 'fanfare', 'sparkle', 'fizzle', 'thud', 'whoosh', 'crackle', 'zap', 'boom'];
/** Every built-in result sound: the user's plus the pet's own, which no sound choice offers. */
export const RESULT_SOUNDS = [...USER_SOUNDS, 'petHappy', 'petSad'];

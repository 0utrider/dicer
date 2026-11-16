/** Built-in result sound names. Tiny and dependency-free: the editor lists them without pulling the synth chunk. */
export const USER_SOUNDS = ['chime', 'fanfare', 'sparkle', 'fizzle', 'thud', 'whoosh', 'crackle', 'zap', 'boom'];
/** The dice pet's voice (synth.js): its crit chirp and fumble whimper, a splat, petting's purr, a huff, and its reactions. */
export const PET_SOUNDS = [
  'petHappy',
  'petSad',
  'petSplat',
  'petPurr',
  'petHuff',
  'petYelp',
  'petShiver',
  'petCough',
  'petCoo',
  'petDizzy',
  'petZap',
  'petFizz',
  'petRing',
  'petOof',
  'petOw',
  'petWhoa',
  'petYip',
  'petBonk',
  'petBleh',
  'petSpooked',
  'petWoo',
];
/** Every built-in result sound: the user's plus the pet's own, which no sound choice offers. */
export const RESULT_SOUNDS = [...USER_SOUNDS, ...PET_SOUNDS];

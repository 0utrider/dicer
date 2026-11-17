import { BURST_IDS } from './elements.js';

/** Dicer's own effect ids as a plain list, so the API can validate without loading the lazy library chunk. */
export const EFFECT_IDS = Object.freeze([
  'glow-pulse',
  'glint',
  'color-shift',
  'number-flare',
  'light-burst',
  'sparkles',
  'embers',
  'frost',
  'lightning',
  'smoke',
  'shatter',
  'shockwave',
  'shake',
  'celebrate',
  'fumble',
  ...BURST_IDS,
]);

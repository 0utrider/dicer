import { DIE_EFFECTS } from './die-effects.js';

/**
 * The effects library: effect id -> effect module (contract in ../effect-layer.js). Loaded
 * lazily (the `effects` chunk, through ./effects.js); never part of the world-start bundle.
 * Task 9 adds the particle catalogue, Task 10 the Dice So Nice effects.
 */
export const EFFECTS = Object.freeze({ ...DIE_EFFECTS });

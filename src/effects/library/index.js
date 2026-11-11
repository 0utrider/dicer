import { DIE_EFFECTS } from './die-effects.js';
import { CATALOGUE } from './catalogue.js';

export { createParticlePool } from './particles.js';

/**
 * The effects library: effect id -> effect module (contract in ../effect-layer.js). Loaded
 * lazily (the `effects` chunk, through ./effects.js); never part of the world-start bundle.
 * The layer also takes createParticlePool from here to build its one shared pool.
 * Task 10 adds the Dice So Nice effects.
 */
export const EFFECTS = Object.freeze({ ...DIE_EFFECTS, ...CATALOGUE });

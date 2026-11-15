import { DIE_EFFECTS } from './die-effects.js';
import { CATALOGUE } from './catalogue.js';
import { BURSTS } from './bursts.js';

export { createParticlePool, createImpactFx } from './particles.js';
export { flareRolls } from './inside-flare.js';
export { createTrailFx } from './trails.js';
export { burstFor } from './bursts.js';

/**
 * The effects library: effect id -> effect module (contract in ../effect-layer.js). Loaded
 * lazily (the `effects` chunk, through ./effects.js); never part of the world-start bundle.
 * The layer also takes createParticlePool from here to build its one shared pool.
 * Task 10 adds the Dice So Nice effects. BURSTS are the elemental crit bursts (burst-<element>);
 * the layer takes burstFor from here to append a landed natural 20's burst.
 */
export const EFFECTS = Object.freeze({ ...DIE_EFFECTS, ...CATALOGUE, ...BURSTS });

/** Shared constants and message names for the physics worker protocol. */

/** Floats per die per frame: px, py, pz, qx, qy, qz, qw. */
export const FLOATS_PER_DIE = 7;
/** Floats per impact event: frame, die, other (die index, -1 floor, -2 wall, -3 - i obstacle i), speed. */
export const IMPACT_FLOATS = 4;
/** Most impact events kept per chunk (the fastest); a pile-up must not flood the main thread. */
export const MAX_IMPACTS_PER_CHUNK = 64;
/** Steps simulated before a chunk is handed to the consumer. */
export const CHUNK_STEPS = 30;
/** Hard cap on simulated steps per throw (10 s at 60 Hz). */
export const MAX_STEPS = 600;
export const STEP_SECONDS = 1 / 60;

/**
 * THROW: {id, dice, seed, area?}; `seed` is four uint32 words (128 bits: xoshiro128**, what live
 * throws send) or a 32-bit integer (mulberry32: fixtures and tests), core/rng.js seededRandom; `area` = {cx, cz, halfWidth, halfDepth} (die units relative to
 * the stage centre) is that throw's own walls/spawn/aim rectangle; absent, the stage (RESIZE).
 * `obstacles?: {x, z, r, h}[]` are fixed pet capsules on the floor (scene units, radius r,
 * standing height h; r > 3 or h > 6 is ignored); the caller keeps them inside the stage, off the
 * spawn side. Impacts with obstacle i report other = -3 - i. At most MAX_OBSTACLES.
 * `splatSpeed?`: a die contact with an obstacle at this speed or more splats that pet, and its
 * collider is gone from the next step (absent or null: obstacles stay solid; petSplat off). A die
 * entry with `splat: false` never splats a pet (only a check's d20 does: pets.js maySplat).
 * `free?: true` (rolling by hand): once the dice settle, a die that is cocked (INIT's readers) or
 * whose centre is outside the area gets a nudge from seededRandom(deriveSeed(seed)), and the same
 * world runs on: at most MAX_NUDGES per die, within MAX_FREE_STEPS. Then the reading stands.
 * `launch?: ({pos:[x,y,z], quat:[x,y,z,w], linvel:[x,y,z], angvel:[x,y,z]} | null)[]`: die i
 * starts at launch[i] (die units relative to the stage centre; clamped into the area with a
 * margin of 1, y to [1, 6], speeds and spins capped; lifted to h + 1.2 within r + 1 of an
 * obstacle); a missing entry is a seeded spawn. Frame 0 of a launched throw is the release
 * state, so its impacts' frames are one later. All four walls stand from step 0 unless a die
 * has no launch (then the seeded spawn's wall opens as usual). An entry with `rest: true` (grab and
 * toss: a landed die lying where it is) is clamped with no margin and y >= 0, and never lifted.
 * DONE: {id, settledStep, nudges: number[]} (nudges per die, all 0 unless free).
 * READERS: {readers} (computeReaders(), sent by the lazy hand chunk before its first free throw;
 * messages are handled in order, so it lands before that throw).
 */
export const MAX_OBSTACLES = 3;
export const MAX_NUDGES = 3;
/** A nudge needs this many steps left before MAX_FREE_STEPS to settle again. */
export const NUDGE_STEPS = 60;
/** 13 s: under the pet LIFE_MS and DiceBox DONE_TIMEOUT_MS of 15 s. */
export const MAX_FREE_STEPS = 780;
export const MAX_RELEASE_SPEED = 40;
export const MAX_RELEASE_SPIN = 30;
/** H-2: cocked below this fraction of the shape's own flat gap (face-reader.js and the worker). */
export const COCKED_FRACTION = 0.5;
export const MSG = Object.freeze({
  INIT: 'init',
  RESIZE: 'resize',
  THROW: 'throw',
  CHUNK: 'chunk',
  DONE: 'done',
  RECYCLE: 'recycle',
  ERROR: 'error',
  READERS: 'readers',
});

/** Worker -> client handshake once Rapier is initialised. */
export const READY = 'ready';

/**
 * Whether a die may splat a pet: only a check's d20, never a damage die (one with a damage type)
 * or any other die, which bounce off it (a wobble at most). The sim and the pet layer agree on it.
 */
export const maySplat = (type, damageType) => type === 'd20' && !damageType;

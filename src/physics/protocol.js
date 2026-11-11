/** Shared constants and message names for the physics worker protocol. */

/** Floats per die per frame: px, py, pz, qx, qy, qz, qw. */
export const FLOATS_PER_DIE = 7;
/** Floats per impact event: frame, die, other (die index, -1 floor, -2 wall), speed. */
export const IMPACT_FLOATS = 4;
/** Most impact events kept per chunk (the fastest); a pile-up must not flood the main thread. */
export const MAX_IMPACTS_PER_CHUNK = 64;
/** Steps simulated before a chunk is handed to the consumer. */
export const CHUNK_STEPS = 30;
/** Hard cap on simulated steps per throw (10 s at 60 Hz). */
export const MAX_STEPS = 600;
export const STEP_SECONDS = 1 / 60;

export const MSG = Object.freeze({
  INIT: 'init',
  RESIZE: 'resize',
  THROW: 'throw',
  CHUNK: 'chunk',
  DONE: 'done',
  RECYCLE: 'recycle',
  ERROR: 'error',
});

/** Worker -> client handshake once Rapier is initialised. */
export const READY = 'ready';

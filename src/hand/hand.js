/**
 * The rolling-by-hand chunk (lazy: emitted as hand-[hash].js, never part of world start; the
 * world-start seam is ./hand-loader.js). Everything only hand throws and replays need lives here.
 */
export const CHUNK = 'dicer-hand-chunk';
export { handFor, readFree, RESULT_GLOW_MS } from './chunk/box.js';
export { handEdge } from './chunk/edge.js';
export { fulfill, fulfillTerm, extraResult, handThrows } from './chunk/resolve.js';
export {
  openThrowOverlay,
  velocityFromSamples,
  liftFromSpeed,
  spinFromShake,
  MAX_FLICK_SPEED,
  SAMPLE_WINDOW_MS,
} from './chunk/overlay.js';
export {
  encodeTrajectory,
  decodeTrajectory,
  placeTrajectory,
  replaySource,
  trajectoryBytes,
  MAX_TRAJECTORY_BYTES,
  MAX_REPLAY_DICE,
  MIN_REPLAY_SCALE,
  POS_SCALE,
  TRAJ_STRIDE,
} from './chunk/trajectory.js';

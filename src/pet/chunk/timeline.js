export const ENTER_MS = 350;
export const THROW_MS = 250;
export const REACT_MS = 1200;
export const EXIT_MS = 450;
export const QUICK_EXIT_MS = 300;
/**
 * The hard cap on one throw's pet: a roll that never lands or leaves cannot keep the loop alive.
 * Kept equal to DONE_TIMEOUT_MS in src/throw/dice-box.js (a roll's own stall cap): change them
 * together. Not imported, so the lazy pet chunk does not reach into the world-start DiceBox module.
 */
export const LIFE_MS = 15000;
/** A pet's hop to a resting spot, or off the table (the same length as the old exit). */
export const REST_HOP_MS = 450;
/** A hit that does not splat: the jiggle. */
export const WOBBLE_MS = 400;
/** A splat: the burst, until it is a puddle. */
export const SPLAT_MS = 500;
/** A puddle pulling together into its pet, before the routine. */
export const REFORM_MS = 400;

const WATCH_FROM = ENTER_MS + THROW_MS;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Where a pet is on its timeline at `now`. track = { beganAt, landedAt?, leaveAt?, leaveMs?, hand? }.
 * enter, throw, watch (until the dice land), react, exit, gone. `t` runs 0..1 within the phase
 * (watch has no fixed length: its t is 0). A hand throw (H-5) has no throw phase: the watch starts
 * at ENTER_MS (at once for a pet begun ENTER_MS back, watching from rest). A leave caps the exit
 * so it ends by the fade; with no leave, LIFE_MS after beganAt acts as one (a quick exit that ends
 * by then), but never before a landed roll's reaction and exit (a free throw lands up to 13 s in).
 */
export function phaseAt(track, now) {
  const { beganAt, landedAt } = track;
  let { leaveAt, leaveMs } = track;
  if (leaveAt == null) {
    leaveAt =
      Math.max(beganAt + LIFE_MS, landedAt == null ? 0 : landedAt + REACT_MS + EXIT_MS) - QUICK_EXIT_MS;
    leaveMs = QUICK_EXIT_MS;
  }
  const since = now - beganAt;
  const watchFrom = track.hand ? ENTER_MS : WATCH_FROM;
  const reactAt = landedAt == null ? Infinity : Math.max(landedAt, beganAt + watchFrom);
  let exitAt = reactAt + REACT_MS;
  let exitMs = EXIT_MS;
  // The pet is always gone by leaveAt + leaveMs (the dice have faded by then).
  const deadline = leaveAt + leaveMs;
  if (now >= deadline) return { phase: 'gone', t: 1 };
  const capped = Math.max(deadline - QUICK_EXIT_MS, leaveAt); // never before the leave itself
  if (capped < exitAt) {
    exitAt = capped;
    exitMs = QUICK_EXIT_MS;
  }
  exitMs = Math.min(exitMs, deadline - exitAt);
  if (now >= exitAt) {
    const t = (now - exitAt) / exitMs;
    return t >= 1 ? { phase: 'gone', t: 1 } : { phase: 'exit', t };
  }
  if (now >= reactAt) return { phase: 'react', t: clamp01((now - reactAt) / REACT_MS) };
  if (since < ENTER_MS) return { phase: 'enter', t: clamp01(since / ENTER_MS) };
  if (since < watchFrom) return { phase: 'throw', t: clamp01((since - ENTER_MS) / THROW_MS) };
  return { phase: 'watch', t: 0 };
}

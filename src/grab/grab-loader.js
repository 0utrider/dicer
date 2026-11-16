/** The grab-and-toss chunk (./grab.js), imported once grabDice is on. World-start code: keep it byte-lean. */
let load = () => import('./grab.js');
let mod = null;

/**
 * On (`box` and `on`): imports the chunk (a failure warns once, never retried) and binds it to
 * `box`, which installs its pointer listener. Off: releases it (no listener). Calls apply in order.
 */
export function syncGrab(box, on) {
  if (box && on) mod ??= load().catch((err) => (console.warn('dicer: grab and toss unavailable', err), null));
  return mod?.then((m) => (box && on ? m?.grabFor(box) : m?.releaseGrab()));
}

/** Test seam: replaces the chunk import and resets the state. */
export function _setGrabImport(fn) {
  load = fn;
  mod = null;
}

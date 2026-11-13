/** The rolling-by-hand chunk (./hand.js), imported once on demand. World-start code: keep it byte-lean. */
let load = () => import('./hand.js');
let mod = null;
let now = null;

/**
 * The chunk's module, attached to `box` (handFor) when one is given; null if the import failed
 * (warned once, never retried).
 */
export const loadHand = (box) =>
  (mod ??= load().catch((err) => (console.warn('dicer: hand rolls unavailable', err), null))).then(
    (m) => (m && box && m.handFor(box), (now = m)),
  );

/** The chunk's module once a loadHand has resolved, else null (synchronous). */
export const handNow = () => now;

/**
 * H-20: fetches the chunk for `box` (main.js calls it in an idle callback after ready) when
 * `want()` (shell.wantsHand, M8): only where this user could throw by hand. A throwing want()
 * fetches nothing (a roll still loads the chunk on demand).
 */
export function prefetchHand(box, want) {
  try {
    if (want()) loadHand(box);
  } catch {
    /* not registered */
  }
}

/** Test seam: replaces the chunk import and resets the state. */
export function _setHandImport(fn) {
  load = fn;
  mod = now = null;
}

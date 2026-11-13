/** The rolling-by-hand chunk (./hand.js), imported once on demand. World-start code: keep it byte-lean. */
let load = () => import('./hand.js');
let mod = null;

/**
 * The chunk's module, attached to `box` (handFor) when one is given; null if the import failed
 * (warned once, never retried).
 */
export const loadHand = (box) =>
  (mod ??= load().catch((err) => (console.warn('dicer: hand rolls unavailable', err), null))).then(
    (m) => (m && box && m.handFor(box), m),
  );

/** Test seam: replaces the chunk import and resets the state. */
export function _setHandImport(fn) {
  load = fn;
  mod = null;
}

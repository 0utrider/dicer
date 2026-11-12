/**
 * The look-extras chunk (./extras/look-extras.js: new look shader code, icon art), imported on
 * first use. Until it lands, and if it never does, a look needing it draws fallbackLook().
 * World-start code: keep it byte-lean.
 */

let load = () => import('./extras/look-extras.js');
let mod = null;
let pending = null;
let listeners = new Set();

/** Warns that the look extras cannot be used (callers warn once). */
export const warnLookExtras = (err) =>
  console.warn('dicer: look extras unavailable; looks use their fallback', err);

/** The loaded chunk module, or null. */
export const getLookExtras = () => mod;

/**
 * Imports the chunk once (concurrent calls share one promise) and awaits its `ready`; then calls
 * every listener once. A failed import or `ready` resolves null, warns once, and is never retried.
 */
export const requestLookExtras = () =>
  (pending ??= load()
    .then(async (m) => {
      await m.ready;
      mod = m;
      for (const cb of listeners) {
        try {
          cb();
        } catch (err) {
          console.warn('dicer:', err);
        }
      }
      return m;
    })
    .catch((err) => (warnLookExtras(err), null)));

/** Called once when the chunk lands. Returns the unsubscribe. */
export const onLookExtrasReady = (cb) => (listeners.add(cb), () => listeners.delete(cb));

/** Test seam: replaces the chunk import and resets the state. */
export function _setLookExtrasImport(fn) {
  load = fn;
  mod = pending = null;
  listeners = new Set();
}

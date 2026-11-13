/** The pet chunk (./chunk/pets.js), imported once on request. World-start code: keep it byte-lean. */
let load = () => import('./chunk/pets.js');
let mod = null;
let layer = null;
let deps = null; // the deps the current layer is bound to
let want = null; // the deps of the live request: an import that resolves for any other is stale

/** The current engine's pet layer, or null until the chunk has loaded (or if it never does). */
export const getPets = () => layer;

/** Disposes the current layer and drops pending requests (the engine is rebuilt or torn down). */
export function releasePets() {
  layer?.dispose();
  layer = deps = want = null;
}

/**
 * Imports the chunk once (a failure warns once, resolves null, never retried), then makes a layer
 * bound to `d`, disposing the previous engine's. The same `d` again returns the same layer. A
 * request superseded or released while the import was in flight resolves null and makes nothing.
 */
export const requestPets = (d) =>
  (mod ??= load().catch((err) => (console.warn('dicer: pets unavailable', err), null))).then(
    ((want = d), (m) => {
      if (!m || want !== d) return null;
      if (deps !== d) {
        layer?.dispose();
        layer = m.createPetLayer((deps = d));
      }
      return layer;
    }),
  );

/** Test seam: replaces the chunk import and resets the state. */
export function _setPetImport(fn) {
  load = fn;
  mod = layer = deps = want = null;
}

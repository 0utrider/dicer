/** The pet chunk (./chunk/pets.js), imported once on request. World-start code: keep it byte-lean. */
let load = () => import('./chunk/pets.js');
let mod = null;
let layer = null;
let deps = null;

/** The current engine's pet layer, or null until the chunk has loaded (or if it never does). */
export const getPets = () => layer;

/** Disposes the current layer (the engine is being rebuilt or torn down). */
export function releasePets() {
  layer?.dispose();
  layer = deps = null;
}

/**
 * Imports the chunk once (a failure warns once, resolves null, never retried), then makes a layer
 * bound to `d`, disposing the previous engine's. The same `d` again returns the same layer.
 */
export const requestPets = (d) =>
  (mod ??= load().catch((err) => (console.warn('dicer: pets unavailable', err), null))).then((m) => {
    if (!m) return null;
    if (deps !== d) {
      layer?.dispose();
      layer = m.createPetLayer((deps = d));
    }
    return layer;
  });

/** Test seam: replaces the chunk import and resets the state. */
export function _setPetImport(fn) {
  load = fn;
  mod = layer = deps = null;
}

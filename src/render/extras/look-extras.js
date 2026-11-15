/**
 * The look-extras chunk: shader code and assets for the dice-design options (numbers layer, bodies
 * and insides), loaded lazily through ../extras-loader.js and never imported
 * statically by world-start code.
 *
 * Contract (the loader and createDiceMaterial rely on it):
 * - `ready`: resolves once the chunk's async assets (if any) are usable.
 * - `patchMaterial(a, flags, { shape, labels, atlas })` -> ExtrasPatch, for a normalised
 *   Appearance that needsLookExtras(), never under safe flags.
 *
 * ExtrasPatch = {
 *   defines?: Record<string, string>,          // added to material.defines
 *   uniforms?: Record<string, { value }>,      // added to the material's uniforms
 *   chunks?: Partial<Record<'pars'|'colorPre'|'colorPost'|'roughness'|'tangent'|'normal'
 *     |'emissive'|'coat'|'lighting', string>>, // appended to dice-material's chunk slots
 *   replace?: Array<[from, to]>,               // applied to the final fragment shader, in order
 *   labels?: string[],                         // replaces the face labels
 *   atlas?: object,                            // replaces the label atlas (texture + metrics)
 *   params?: object,                           // material.setValues(params), after defines/uniforms
 *   interior?: { pars, main },                 // replaces interiorChunk() in the march (insides/index.js)
 * }
 */

import { reliefPatch } from './relief.js';
import { fillPatch } from './fills.js';
import { iconPatch } from './icons.js';
import { glyphPatch } from './glyphs.js';
import { bodyPatch } from './bodies/index.js';
import { insidePatch } from './insides/index.js';
import { edgePatch } from './edges.js';
import { mergePatches } from './merge.js';

export { mergePatches };
// Living insides: per-die motion state, stepped from DiceBox.#frame (insides/live.js).
export { insideMotion } from './insides/live.js';

/** Build-test marker: present in this chunk, never in the world-start bundle. */
export const EXTRAS_ID = 'dicer-look-extras';

export const ready = Promise.resolve();

// Icons relabel only the d20, pips only a plain d6, coin motifs only the d2: at most one of them
// gives a die labels and an atlas (tests/unit/glyphs.test.js).
export function patchMaterial(a, flags, ctx) {
  return mergePatches(bodyPatch(a, flags), insidePatch(a, flags), reliefPatch(a), fillPatch(a), iconPatch(a, ctx), glyphPatch(a, ctx), edgePatch(a));
}

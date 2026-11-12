/**
 * The look-extras chunk: shader code and assets for the dice-design options (numbers layer now;
 * bodies and insides later), loaded lazily through ../extras-loader.js and never imported
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
 * }
 */

import { reliefPatch } from './relief.js';
import { fillPatch } from './fills.js';
import { iconPatch } from './icons.js';
import { bodyPatch } from './bodies/index.js';

/** Build-test marker: present in this chunk, never in the world-start bundle. */
export const EXTRAS_ID = 'dicer-look-extras';

export const ready = Promise.resolve();

/**
 * Merges patches: defines/uniforms/params assigned, chunk slots joined by '\n', replace
 * concatenated; the last labels/atlas win. A function declaration: bodies/index.js imports it
 * back (an import cycle that only calls it after both modules have loaded).
 */
export function mergePatches(...patches) {
  const out = { defines: {}, uniforms: {}, chunks: {}, replace: [] };
  for (const p of patches) {
    Object.assign(out.defines, p.defines);
    Object.assign(out.uniforms, p.uniforms);
    for (const [k, code] of Object.entries(p.chunks ?? {})) {
      out.chunks[k] = k in out.chunks ? `${out.chunks[k]}\n${code}` : code;
    }
    out.replace.push(...(p.replace ?? []));
    if (p.labels) out.labels = p.labels;
    if (p.atlas) out.atlas = p.atlas;
    if (p.params) out.params = { ...out.params, ...p.params };
  }
  return out;
}

export function patchMaterial(a, flags, ctx) {
  return mergePatches(bodyPatch(a, flags), reliefPatch(a), fillPatch(a), iconPatch(a, ctx));
}

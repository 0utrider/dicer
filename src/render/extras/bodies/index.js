import { NOISE_GLSL } from '../../shaders/noise.js';
import { mergePatches } from '../merge.js';
import * as iridescent from './iridescent.js';

/**
 * Body modules: one per new body type, plus (later) the metal finishes and luminous.
 *
 * Contract of a module:
 * - `<name>Patch(a) -> ExtrasPatch`: called for EVERY look; it checks its own condition (body
 *   type, metal finish, luminous > 0) and returns {} when it does not apply;
 * - `USES_NOISE = true` when its GLSL calls the noise library (dcHash13, dcNoise3, dcFbm3);
 * - a preset module (a body type with presets) also exports
 *   `PRESET_PARAMS: Record<presetId, number[4]>` (meanings documented in the module), uploaded as
 *   the vec4 uniform uBodyPreset; it guards an unknown preset with its first preset
 *   (`PRESET_PARAMS[a.body.preset] ?? PRESET_PARAMS.<first>`). A look has one body type, so
 *   only one preset module (one uBodyPreset) applies per look; finish and luminous modules may
 *   apply beside it and must not use uBodyPreset;
 * - its patch: `defines: { DICER_<NAME>: '' }`, uniforms, `chunks` (pars, colorPre, roughness?,
 *   normal?, coat?) and its MeshPhysical `params`; colours come from diffuseColor (body.color)
 *   and uBodyColor2 (body.color2), never constants.
 */
const MODULES = [[iridescent.iridescentPatch, iridescent.USES_NOISE]];

const isEmpty = (p) => Object.keys(p).length === 0;

/**
 * ExtrasPatch for the body: {} for today's bodies. NOISE_GLSL is prepended once when an applying
 * module uses it (world start's bodyChunks only adds it for marble and antique metal, which never
 * combine with a new body, so it is never compiled twice).
 */
export function bodyPatch(a, _flags) {
  const parts = [];
  let noise = false;
  for (const [patch, usesNoise] of MODULES) {
    const p = patch(a);
    if (isEmpty(p)) continue;
    parts.push(p);
    noise ||= !!usesNoise;
  }
  if (!parts.length) return {};
  const out = mergePatches(...parts);
  if (noise) out.chunks.pars = `${NOISE_GLSL}\n${out.chunks.pars ?? ''}`;
  return out;
}

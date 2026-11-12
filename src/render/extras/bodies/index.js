import { NOISE_GLSL } from '../../shaders/noise.js';
import { mergePatches } from '../look-extras.js';
import * as iridescent from './iridescent.js';

/**
 * Body modules: one per new body type (later also the metal finishes and luminous).
 *
 * Contract of a body module:
 * - `PRESET_PARAMS: Record<presetId, number[4]>`: per-preset shape parameters (the meanings are
 *   the module's own, documented there), uploaded as the vec4 uniform uBodyPreset;
 * - `<body>Patch(a) -> ExtrasPatch` with `defines: { DICER_<BODY>: '' }`, the uBodyPreset
 *   uniform, `chunks` (pars, colorPre, roughness?, normal?, coat?) and its MeshPhysical `params`;
 *   colours come from diffuseColor (body.color) and uBodyColor2 (body.color2), never constants;
 * - `USES_NOISE = true` when its GLSL calls the noise library (dcHash13, dcNoise3, dcFbm3).
 */
const BODIES = { iridescent: [iridescent, iridescent.iridescentPatch] };

/**
 * ExtrasPatch for the body: {} for today's bodies. NOISE_GLSL is prepended once when a merged
 * module uses it (world start's bodyChunks only adds it for marble and antique metal, which
 * never combine with a new body, so it is never compiled twice).
 */
export function bodyPatch(a, _flags) {
  const parts = [];
  let noise = false;
  const body = BODIES[a.body?.type];
  if (body) {
    parts.push(body[1](a));
    noise ||= !!body[0].USES_NOISE;
  }
  if (!parts.length) return {};
  const p = mergePatches(...parts);
  if (noise) p.chunks.pars = `${NOISE_GLSL}\n${p.chunks.pars ?? ''}`;
  return p;
}

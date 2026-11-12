import * as THREE from 'three';
import { NOISE_GLSL } from '../../shaders/noise.js';
import { INTERIOR_PARS, INTERIOR_MARCH } from '../../shaders/interior.js';
import * as foil from './foil.js';

/**
 * Inside modules: one per new resin inside (foil now; eye, botanical, smoke and the liquid
 * bubble / sand options in later tasks). Insides combine with the resin body only.
 *
 * Contract of a module:
 * - `<type>Inside(a) -> { body: string, uniforms?: object }`: `body` is its GLSL, defining
 *   `vec4 dcInterior( vec3 p, vec3 rd, float dt )` (premultiplied colour and opacity of one
 *   march segment, as in shaders/interior.js), using only INTERIOR_PARS (uInteriorColors,
 *   uInteriorDensity, dcIKey, dcILight, dcIVolume, dcIEdge, dcIAlpha), `dcIUp` (the die's
 *   current world up in the canonical frame, set before the loop) and its own `dc<Prefix>` names;
 * - `USES_NOISE = true` when the GLSL calls the noise library (dcHash13, dcNoise3, dcFbm3).
 *
 * insidePatch builds pars as [NOISE_GLSL if needed, INTERIOR_PARS, 'vec3 dcIUp;', body] and uses
 * marchWithUp() as the march, so every inside gets dcIUp whether it reads it or not.
 */
const MODULES = {
  foil: [foil.foilInside, foil.USES_NOISE],
};

/** Share of the tint target mixed into the resin body at low tier (steps 0), per new inside. */
export const INSIDE_TINT = Object.freeze({ foil: 0.15, eye: 0.2, botanical: 0.25, smoke: 0.4 });

const UP_LINE = 'dcIUp = normalize( transpose( dcRm ) * vec3( 0.0, 1.0, 0.0 ) * dcIs );';

/** INTERIOR_MARCH with the die's up direction (dcIUp) set on the line after dcIKey's. */
export function marchWithUp() {
  return INTERIOR_MARCH.replace(/^([ \t]*)(dcIKey = [^\n]*\n)/m, `$1$2$1${UP_LINE}\n`);
}

const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * The low-tier tint target, recomputed the same way as dice-material.js tintTarget() (kept
 * local: importing it would add a world-start export): colors[0]'s hue at the body colour's
 * luminance, in linear colour.
 */
function tintTarget(a) {
  const c0 = new THREE.Color(a.interior.colors[0]);
  const body = new THREE.Color(a.body.color);
  const l = luminance(c0);
  return l > 0 ? c0.multiplyScalar(luminance(body) / l) : body;
}

const liquidExtras = (i) => i.type === 'liquid' && (i.bubble || i.sand);

/**
 * ExtrasPatch for the inside: {} unless the body is resin, interiors are on and a new inside (or
 * liquid with bubble / sand) is set.
 * - marched (steps > 0): `{ interior: { pars, main }, uniforms }`; a type without a module
 *   throws, so patchMaterial fails and createDiceMaterial draws the fallback look (it would
 *   otherwise call interiorChunk() with a type it does not know, outside its try/catch);
 * - fake (steps 0): `{ uniforms: { uResinTint } }` with w = INSIDE_TINT[type] (liquid keeps
 *   today's fake: {}).
 */
export function insidePatch(a, flags) {
  const i = a.interior;
  if (a.body?.type !== 'resin' || !i || !flags.interiors) return {};
  const isNew = Object.hasOwn(INSIDE_TINT, i.type);
  if (!isNew && !liquidExtras(i)) return {};
  if (!(flags.interiorSteps > 0)) {
    if (!isNew) return {};
    const t = tintTarget(a);
    return { uniforms: { uResinTint: { value: new THREE.Vector4(t.r, t.g, t.b, INSIDE_TINT[i.type]) } } };
  }
  const key = liquidExtras(i) ? 'liquid' : i.type;
  const mod = Object.hasOwn(MODULES, key) ? MODULES[key] : null;
  if (!mod) throw new Error(`dicer: inside "${key}${key === 'liquid' ? ' + bubble/sand' : ''}" not built yet`);
  const [build, usesNoise] = mod;
  const { body, uniforms = {} } = build(a);
  const pars = [usesNoise ? NOISE_GLSL : '', INTERIOR_PARS, 'vec3 dcIUp;', body].filter(Boolean).join('\n');
  return { interior: { pars, main: marchWithUp() }, uniforms };
}

import * as THREE from 'three';
import { NOISE_GLSL } from '../../shaders/noise.js';
import { INTERIOR_PARS, INTERIOR_MARCH } from '../../shaders/interior.js';
import * as foil from './foil.js';
import * as eye from './eye.js';
import * as botanical from './botanical.js';
import * as smoke from './smoke.js';
import * as liquidExtras from './liquid-extras.js';
import * as weapons from './weapons.js';
import * as dragon from './dragon.js';
import * as runes from './runes.js';

/**
 * Inside modules: one per new resin inside (foil, eye, botanical, smoke), plus `liquid` for
 * liquid with the bubble and / or sand options (plain liquid stays interior.js's, unpatched), plus
 * one per fantasy shape of type 'shape' under its shape id (weapons.js serves sword, axe and
 * shield; dragon.js the dragon; runes.js the magic circle). Insides combine with the resin body only.
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
export const MODULES = {
  foil: [foil.foilInside, foil.USES_NOISE],
  eye: [eye.eyeInside, eye.USES_NOISE],
  botanical: [botanical.botanicalInside, botanical.USES_NOISE],
  smoke: [smoke.smokeInside, smoke.USES_NOISE],
  liquid: [liquidExtras.liquidExtrasInside, liquidExtras.USES_NOISE], // only with bubble / sand
  // fantasy shapes of type 'shape', by shape id
  sword: [weapons.weaponsInside, weapons.USES_NOISE],
  axe: [weapons.weaponsInside, weapons.USES_NOISE],
  shield: [weapons.weaponsInside, weapons.USES_NOISE],
  dragon: [dragon.dragonInside, dragon.USES_NOISE],
  runes: [runes.runesInside, runes.USES_NOISE],
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

const hasLiquidExtras = (i) => i.type === 'liquid' && (i.bubble || i.sand);
// the closed list of shapes interior.js draws itself (the keys of its SDF_NAME, pinned by a test):
// every other shape of type 'shape' (plan 3b: sword, axe, shield, dragon, runes) is a module in
// MODULES under its shape id
const BUILT_IN_SHAPES = ['star', 'heart', 'skull', 'sphere'];
const isFantasy = (i) => i.type === 'shape' && !BUILT_IN_SHAPES.includes(i.shape);

/**
 * ExtrasPatch for the inside: {} unless the body is resin, interiors are on and a new inside (or
 * liquid with bubble / sand) is set.
 * - marched (steps > 0): `{ interior: { pars, main }, uniforms }` (liquid with bubble / sand: the
 *   liquid-extras module's); a shape other than the four built-in ones without a module (a safety
 *   net, e.g. a shape added to the world-start list but not here) throws, so
 *   patchMaterial fails and createDiceMaterial draws the fallback look (it would
 *   otherwise call interiorChunk() with a type it does not know, outside its try/catch);
 * - fake (steps 0): `{ uniforms: { uResinTint } }` with w = INSIDE_TINT[type] (liquid keeps
 *   today's fake: {}).
 */
export function insidePatch(a, flags) {
  const i = a.interior;
  if (a.body?.type !== 'resin' || !i || !flags.interiors) return {};
  const isNew = Object.hasOwn(INSIDE_TINT, i.type);
  if (!isNew && !hasLiquidExtras(i) && !isFantasy(i)) return {};
  if (!(flags.interiorSteps > 0)) {
    if (!isNew) return {};
    const t = tintTarget(a);
    return { uniforms: { uResinTint: { value: new THREE.Vector4(t.r, t.g, t.b, INSIDE_TINT[i.type]) } } };
  }
  const key = hasLiquidExtras(i) ? 'liquid' : isFantasy(i) ? i.shape : i.type;
  const mod = Object.hasOwn(MODULES, key) ? MODULES[key] : null;
  if (!mod) throw new Error(`dicer: no inside module for "${key}"`);
  const [build, usesNoise] = mod;
  const { body, uniforms = {} } = build(a);
  const pars = [usesNoise ? NOISE_GLSL : '', INTERIOR_PARS, 'vec3 dcIUp;', body].filter(Boolean).join('\n');
  return { interior: { pars, main: marchWithUp() }, uniforms };
}

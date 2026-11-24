import * as THREE from 'three';
import { WEIGHT_SHIFT } from '../shaders/engrave.js';

/** The widest number outline (numbers.outlineWidth 1), in face units, where the glyph's distance field reaches far enough. */
export const OUTLINE_MAX = 0.035;
/** Face units one atlas pixel spans when no atlas says (the digits are laid out 0.62 of a face tall and about 45 px). */
const DEFAULT_REACH = 0.055;
/** The share of the field's reach the band may use: its last bit is the edge's anti-aliasing and the rect's clip. */
const REACH_USE = 0.9;

/**
 * How far past a glyph's edge its distance field reaches, in face units at size 1: the atlas pad (half
 * the distance range, in atlas px) times the face units one px spans. A die's own atlas says both; without
 * one a default stands in.
 */
export function fieldReach(atlas) {
  const px = atlas?.pad / atlas?.digitHeight;
  return Number.isFinite(px) && px > 0 ? px * 0.62 : DEFAULT_REACH;
}

/**
 * The band's width in face units. numbers.outlineWidth scales OUTLINE_MAX, then it is clamped to what
 * the field gives at this size and weight: the field is sampled at p / size, so a smaller number has
 * less reach, and a thicker stroke (positive weight) uses part of it. Past the rect the field is
 * undefined, so an unclamped band would be cut square there.
 */
export function outlineBand(numbers, atlas) {
  const reach = fieldReach(atlas) - Math.max(0, numbers.weight ?? 0) * WEIGHT_SHIFT;
  return Math.max(0, Math.min(OUTLINE_MAX * numbers.outlineWidth, REACH_USE * (numbers.size ?? 1) * reach));
}

const PARS = 'uniform vec4 uOutline; // rgb: outline colour, w: width in face units';

/**
 * After the number colour (dcD, dcAA and dcMask are set): a band of the outline colour just outside
 * the glyph edge, whatever the fill. dcOutl is the band's coverage; the resin lighting reads it too.
 */
const COLOR = /* glsl */ `
float dcOutl = ( 1.0 - smoothstep( - dcAA, dcAA, dcD ) ) * smoothstep( - uOutline.w - dcAA, - uOutline.w + dcAA, dcD );
diffuseColor.rgb = mix( diffuseColor.rgb, uOutline.rgb, dcOutl );
`;

/**
 * A resin die shows its refracted inside everywhere the number fill (dcMask) does not cover, which
 * would hide the band: it counts as covered too. Matches the resin lighting line on a substring; on
 * every other body there is nothing to replace.
 */
const RESIN_REPLACE = [['* dcRim ), 1.0 - dcMask );', '* dcRim ), 1.0 - max( dcMask, dcOutl ) );']];

/** ExtrasPatch for numbers.outline: {} without an outline colour or with width 0. `ctx.atlas` is the die's number atlas. */
export function outlinePatch(a, ctx) {
  const { outline, outlineWidth } = a.numbers;
  if (!outline || !(outlineWidth > 0)) return {};
  const c = new THREE.Color(outline);
  return {
    uniforms: { uOutline: { value: new THREE.Vector4(c.r, c.g, c.b, outlineBand(a.numbers, ctx?.atlas)) } },
    chunks: { pars: PARS, colorPost: COLOR },
    replace: RESIN_REPLACE,
  };
}

import * as THREE from 'three';
import { RIM_WIDTH } from '../shaders/engrave.js';

/** Outline fill: the width of the filled rim inside the glyph edge, in face units. */
export const OUTLINE_WIDTH = 0.035;
/** Glow-ink fill: emissive strength of the number colour (independent of the body glow). */
export const GLOW_INK = 1.6;
/** [metalness, roughness, gloss] of each new fill (paint's values for outline and glow). */
export const FILL_PBR = { outline: [0, 0.6, 0], holo: [1, 0.2, 0], glow: [0, 0.6, 0] };

const W = OUTLINE_WIDTH.toFixed(4);
const RIM_FROM = (-RIM_WIDTH).toFixed(4);
const RIM_TO = (-0.3 * RIM_WIDTH).toFixed(4);

/**
 * Outline: dcMask becomes a rim of the glyph, so the inside shows the body. The resin ink rim
 * (dcRim, keyed on 1 - dcMask) is rekeyed on the full glyph edge, else it would darken the
 * whole hollow interior. Whole lines, no leading whitespace: they match after GLSL stripping.
 */
const OUTLINE_REPLACE = [
  [
    'float dcMask = smoothstep( - dcAA, dcAA, dcD );',
    `float dcMask = smoothstep( - dcAA, dcAA, dcD ) * ( 1.0 - smoothstep( ${W} - dcAA, ${W} + dcAA, dcD ) );`,
  ],
  [
    `float dcRim = ( 1.0 - dcMask ) * smoothstep( ${RIM_FROM}, ${RIM_TO}, dcD );`,
    `float dcRim = ( 1.0 - smoothstep( - dcAA, dcAA, dcD ) ) * smoothstep( ${RIM_FROM}, ${RIM_TO}, dcD );`,
  ],
];

const HOLO_EMISSIVE = `
vec3 dcV = normalize( vViewPosition );
float dcHue = 1.6 * dot( normal, dcV ) + 0.35 * ( vFaceUV.x + vFaceUV.y );
vec3 dcHolo = 0.55 + 0.45 * cos( 6.2832 * ( dcHue + vec3( 0.0, 0.33, 0.67 ) ) );
diffuseColor.rgb = mix( diffuseColor.rgb, dcHolo * mix( vec3( 1.0 ), uFillColor, 0.35 ), dcMask );
`;

const GLOW_EMISSIVE = `totalEmissiveRadiance += uFillColor * ${GLOW_INK.toFixed(2)} * dcMask;`;

/** ExtrasPatch for the number fill: {} for the four old fills. */
export function fillPatch(a) {
  const fill = a.numbers.fill;
  const pbr = FILL_PBR[fill];
  if (!pbr) return {};
  const patch = {
    uniforms: {
      uFillPBR: { value: new THREE.Vector2(pbr[0], pbr[1]) },
      uFillGloss: { value: pbr[2] },
    },
  };
  if (fill === 'outline') patch.replace = OUTLINE_REPLACE;
  else if (fill === 'holo') patch.chunks = { emissive: HOLO_EMISSIVE };
  else patch.chunks = { emissive: GLOW_EMISSIVE };
  return patch;
}

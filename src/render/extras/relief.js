import { DEPTH_SCALE } from '../shaders/engrave.js';

/**
 * Raised (embossed) numbers: three whole-line rewrites of ENGRAVE_COLOR, applied to the
 * assembled fragment shader. They carry no leading whitespace so they still match after
 * build/glsl-minify-plugin.js strips the shader, and none mentions dcMask (the outline fill
 * rewrites it).
 */
export const RAISED_REPLACE = [
  // the wall tilt flips: the glyph stands proud of the body
  [
    `float dcDepth = uEngrave * ${DEPTH_SCALE.toFixed(4)};`,
    `float dcDepth = - uEngrave * ${DEPTH_SCALE.toFixed(4)};`,
  ],
  // the shadow moves off the glyph floor to a contact shadow on the body around the glyph
  [
    'float dcOcc = 1.0 - 0.5 * clamp( uEngrave * 2.0, 0.0, 1.0 ) * dcMask',
    'float dcOcc = 1.0 - 0.35 * clamp( uEngrave * 2.0, 0.0, 1.0 ) * ( 1.0 - smoothstep( - dcAA, dcAA, dcD ) )',
  ],
  [
    '* ( 1.0 - smoothstep( 0.0, 2.5 * dcBand, dcD ) );',
    '* ( 1.0 - smoothstep( 0.0, 2.5 * dcBand, - dcD ) );',
  ],
];

/** ExtrasPatch for the relief option: nothing for engraved, the three replacements for raised. */
export function reliefPatch(a) {
  return a.numbers.relief === 'raised' ? { replace: RAISED_REPLACE } : {};
}

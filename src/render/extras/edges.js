import * as THREE from 'three';
import { stripActive } from '../../look/appearance.js';

/**
 * Styled edge strips: the rounded bevel strips between faces (aFaceId < 0, so vFaceId < -0.5;
 * a coin's rim too) drawn in their own colour instead of the body's. Active only for a look whose
 * strip style is not 'body' with strength > 0 and radius > 0 (stripActive); {} otherwise, so every
 * other look's program is unchanged.
 *
 * - colorPost: the mask dcEdge and the strip colour over the body diffuse (main scope, after the
 *   numbers' colour code, so it is declared before every use below).
 * - replace before normal_fragment_begin: metalness/roughness mixed to the style's PBR (after
 *   three's metalness/roughness map chunks and dice-material's fill mix).
 * - emissive (glow only): the strip colour added to the emission.
 * - replace before transmission_fragment + lighting: a resin body's refraction overwrites the
 *   non-number diffuse with the refracted body; the lit diffuse is saved just before it and mixed
 *   back by dcEdge after it. The refraction line itself (DECAL_OPAQUE's target) is untouched.
 *
 * The replace targets are three's own `#include` lines, which keep their own line after
 * build/glsl-minify-plugin.js strips three's chunks (tests/unit/edge-strips.test.js).
 */

/** Strip PBR per style: [metalness, roughness]. */
export const STRIP_PBR = Object.freeze({ paint: [0, 0.45], metal: [1, 0.25], glow: [0, 0.45] });

const PARS = /* glsl */ `
uniform vec3 uEdgeColor;
uniform float uEdgeStrength;
uniform vec2 uEdgePBR;
`;

const COLOR = /* glsl */ `
	float dcEdge = ( vFaceId < - 0.5 ? 1.0 : 0.0 ) * uEdgeStrength;
	diffuseColor.rgb = mix( diffuseColor.rgb, uEdgeColor, dcEdge );
`;

const EMISSIVE = /* glsl */ `
	totalEmissiveRadiance += uEdgeColor * dcEdge;
`;

const LIGHTING = /* glsl */ `
#ifdef DICER_RESIN
	totalDiffuse = mix( totalDiffuse, dcEdgeLit, dcEdge );
#endif
`;

const REPLACE = [
  [
    '#include <normal_fragment_begin>',
    '\tmetalnessFactor = mix( metalnessFactor, uEdgePBR.x, dcEdge );\n\troughnessFactor = mix( roughnessFactor, uEdgePBR.y, dcEdge );\n#include <normal_fragment_begin>',
  ],
  ['#include <transmission_fragment>', '\tvec3 dcEdgeLit = totalDiffuse;\n#include <transmission_fragment>'],
];

/** ExtrasPatch for the look's edge strip; {} when the strip is inactive. */
export function edgePatch(a) {
  if (!stripActive(a)) return {};
  const { style, color, strength } = a.edges.strip;
  const chunks = { pars: PARS, colorPost: COLOR, lighting: LIGHTING };
  if (style === 'glow') chunks.emissive = EMISSIVE;
  return {
    defines: { DICER_EDGE: '', [`DICER_EDGE_${style.toUpperCase()}`]: '' },
    uniforms: {
      uEdgeColor: { value: new THREE.Color(color) },
      uEdgeStrength: { value: strength },
      uEdgePBR: { value: new THREE.Vector2(...STRIP_PBR[style]) },
    },
    chunks,
    replace: REPLACE,
  };
}

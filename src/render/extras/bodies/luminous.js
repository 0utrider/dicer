/**
 * Luminous (glow in the dark): not a preset module (no uBodyPreset). It applies to every body type
 * when body.luminous > 0 and returns {} otherwise; it does not depend on flags.glow. Under safe
 * flags world start's fallbackLook sets luminous to 0, so it never reaches this module.
 *
 * The `lighting` chunk runs after transmission_fragment (so after a resin body's refraction, which
 * rewrites totalDiffuse) and adds emission in the body's hue (brightened to a strongest channel of at least 0.6) where the die is lit least: the ratio of
 * the lit diffuse luminance to the unlit albedo luminance fades the glow out as the face lights
 * up. The numbers (dcMask) keep their own fill.
 */
export const USES_NOISE = false;

/** The emission at luminous 1 in full darkness, in body-colour units. */
export const LUMINOUS_MAX = 0.6;

const LIGHTING = /* glsl */ `
	float dcLumIn = dot( totalDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.02 );
	// the body's hue, brightened so its strongest channel is at least 0.6 (a dark or black body still glows; the epsilon keeps pure black a soft grey)
	vec3 dcLumB = diffuseColor.rgb + vec3( 0.004 );
	float dcLumMax = max( dcLumB.r, max( dcLumB.g, dcLumB.b ) );
	vec3 dcLumC = dcLumB * ( max( dcLumMax, 0.6 ) / dcLumMax );
	totalEmissiveRadiance += dcLumC * uLuminous * ( 1.0 - smoothstep( 0.0, 0.8, dcLumIn ) ) * ( 1.0 - dcMask );
`;

const PARS = 'uniform float uLuminous;';

export function luminousPatch(a) {
  const lum = a.body?.luminous ?? 0;
  if (!(lum > 0)) return {};
  return {
    uniforms: { uLuminous: { value: lum * LUMINOUS_MAX } },
    chunks: { pars: PARS, lighting: LIGHTING },
  };
}

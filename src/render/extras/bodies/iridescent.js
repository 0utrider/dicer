import * as THREE from 'three';

/**
 * Iridescent body (chameleon, opal, dichroic): the colour turns from body.color towards
 * body.color2 with view angle, the short way round the hue wheel (a YIQ chroma rotation).
 * One program for the three presets: the preset is the uBodyPreset uniform.
 *
 * PRESET_PARAMS: [turn, width, flash, streak]
 * - turn: how far the hue travels from color (0) to color2 (1) by the end of the transition
 *   (past it the hue keeps turning slowly, so above 1 overshoots color2 at grazing view);
 * - width: half-width of the colour transition in grazing units (1 - |N.V|): wide is a smooth
 *   turn, narrow a sharp flip;
 * - flash: opal play-of-colour strength (0: off, and its cellular noise is skipped);
 * - streak: dichroic streak strength (0: off, skipped).
 */
export const PRESET_PARAMS = {
  chameleon: [1.15, 0.32, 0, 0],
  opal: [0.3, 0.4, 1, 0],
  dichroic: [1, 0.035, 0, 1],
};

export const USES_NOISE = true;

/** MeshPhysical parameters (on top of the opaque preset dice-material gives an unknown body). */
const params = (color2) => ({ clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.3, sheenColor: color2 });

const PARS = /* glsl */ `
uniform vec4 uBodyPreset;
// rgb <-> YIQ: the hue is the angle of the (I, Q) chroma vector
const mat3 DC_YIQ = mat3( 0.299, 0.596, 0.211, 0.587, - 0.274, - 0.523, 0.114, - 0.322, 0.312 );
const mat3 DC_RGB = mat3( 1.0, 1.0, 1.0, 0.956, - 0.272, - 1.106, 0.621, - 0.647, 1.703 );
// a -> b by t, the short way round the hue wheel; t past 1 keeps turning (luma, chroma clamp)
vec3 dcHueTurn( vec3 a, vec3 b, float t ) {
	vec3 ya = DC_YIQ * a;
	vec3 yb = DC_YIQ * b;
	float ha = atan( ya.z, ya.y + 1e-6 );
	float d = mod( atan( yb.z, yb.y + 1e-6 ) - ha + 3.14159, 6.28318 ) - 3.14159;
	float h = ha + d * t;
	float u = clamp( t, 0.0, 1.0 );
	float c = mix( length( ya.yz ), length( yb.yz ), u );
	return max( DC_RGB * vec3( mix( ya.x, yb.x, u ), c * cos( h ), c * sin( h ) ), 0.0 );
}
// c with its hue turned by a (radians), chroma x k, luma at least y
vec3 dcHueRot( vec3 c, float a, float k, float y ) {
	vec3 q = DC_YIQ * c;
	float s = sin( a );
	float co = cos( a );
	q.yz = k * vec2( co * q.y - s * q.z, s * q.y + co * q.z );
	q.x = max( q.x, y );
	return max( DC_RGB * q, 0.0 );
}
`;

const COLOR = /* glsl */ `
#ifdef DICER_IRIDESCENT
	float dcIrT; // the hue turn, read again by COAT (the sheen follows a dichroic flip)
	{
		vec3 dcIn = normalize( vNormal );
		float dcIcos = abs( dot( dcIn, normalize( vViewPosition ) ) );
		// a slow die-local drift, so the colour line wanders across faces instead of tracing edges
		float dcIdrift = dcNoise3( vLocalPos * 1.6 + 3.1 ) - 0.5;
		float dcIg = 1.0 - dcIcos + 0.35 * dcIdrift;
		// past the transition the hue keeps turning slowly (towards and beyond color2)
		dcIrT = uBodyPreset.x * ( smoothstep( 0.42 - uBodyPreset.y, 0.42 + uBodyPreset.y, dcIg ) + 0.6 * max( dcIg - 0.42 - uBodyPreset.y, 0.0 ) );
		vec3 dcIc = dcHueTurn( diffuseColor.rgb, uBodyColor2, dcIrT );
		if ( uBodyPreset.z > 0.0 ) {
			// Opal play of colour: soft Voronoi grains in die-local space, each a glow of color2
			// turned round the hue wheel with a rainbow drift inside it. A grain lights when the view
			// meets its own lattice angle, a mix of the facing angle and the view-space normal, so
			// turning the die lights other grains and slides their hues.
			vec3 dcOq = vLocalPos * 4.2;
			vec3 dcOi = floor( dcOq );
			vec3 dcOf = fract( dcOq );
			float dcOd = 9.0;
			float dcOd2 = 9.0;
			vec3 dcOid = dcOi;
			for ( int z = - 1; z <= 1; z ++ ) for ( int y = - 1; y <= 1; y ++ ) for ( int x = - 1; x <= 1; x ++ ) {
				vec3 dcOc = dcOi + vec3( x, y, z );
				vec3 dcOr = vec3( x, y, z ) + vec3( dcHash13( dcOc ), dcHash13( dcOc + 17.1 ), dcHash13( dcOc + 41.7 ) ) - dcOf;
				float dcOdd = dot( dcOr, dcOr );
				if ( dcOdd < dcOd ) { dcOd2 = dcOd; dcOd = dcOdd; dcOid = dcOc; }
				else dcOd2 = min( dcOd2, dcOdd );
			}
			float dcOh1 = dcHash13( dcOid + 7.3 );
			float dcOh2 = dcHash13( dcOid + 23.9 );
			float dcOh3 = dcHash13( dcOid + 59.1 );
			float dcOph = 6.2832 * dcOh1 + 7.0 * dcIcos + 6.0 * ( dcIn.x * ( dcOh2 - 0.5 ) + dcIn.y * ( dcOh3 - 0.5 ) );
			float dcOfl = smoothstep( 0.2, 0.85, 0.5 + 0.5 * cos( dcOph ) ) * ( 1.0 - smoothstep( 0.25, 0.62, sqrt( dcOd ) ) )
				* smoothstep( 0.0, 0.18, sqrt( dcOd2 ) - sqrt( dcOd ) ); // no hard cut where the next grain begins
			float dcOhue = dcOh2 + 0.4 * dcIcos + 0.7 * ( dcNoise3( vLocalPos * 11.0 + dcOh3 * 9.0 ) - 0.5 );
			vec3 dcOcol = dcHueRot( uBodyColor2, 6.2832 * dcOhue, 2.4, 0.55 );
			// milky haze: a faint cloud of color2 through the white
			dcIc = mix( dcIc, mix( dcIc, uBodyColor2, 0.35 ), smoothstep( 0.1, 0.45, dcIdrift ) );
			dcIc = mix( dcIc, dcOcol, 0.95 * uBodyPreset.z * dcOfl );
		}
		if ( uBodyPreset.w > 0.0 ) {
			// Dichroic streaks: a few thin, nearly straight bands of the far side of the flip, their
			// hue sliding with the view angle.
			float dcSu = dot( vLocalPos, vec3( 0.62, 0.28, 0.73 ) ) * 4.5 + 0.35 * dcNoise3( vLocalPos * 2.2 + 7.0 );
			// thin lines on about one band in three, each broken into runs by a slow noise
			float dcSl = ( 1.0 - smoothstep( 0.012, 0.04, abs( fract( dcSu ) - 0.5 ) ) )
				* step( 0.62, dcHash13( vec3( floor( dcSu ), 3.7, 1.1 ) ) )
				* smoothstep( 0.4, 0.55, dcNoise3( vLocalPos * 1.6 + 2.0 ) );
			vec3 dcScol = dcHueTurn( diffuseColor.rgb, uBodyColor2, 1.0 - min( dcIrT, 1.0 ) + 0.35 * dcIcos );
			dcIc = mix( dcIc, dcScol * 1.3, uBodyPreset.w * dcSl );
		}
		diffuseColor.rgb = dcIc;
	}
#endif
`;

/** Bevels a little rougher (as pearl), so the clearcoat does not mirror the studio strips as hard bars. */
const ROUGHNESS = /* glsl */ `
#ifdef DICER_IRIDESCENT
	if ( vFaceId < - 0.5 ) roughnessFactor = max( roughnessFactor, 0.3 );
#endif
`;
const COAT = /* glsl */ `
#if defined( USE_CLEARCOAT ) && defined( DICER_IRIDESCENT )
	if ( vFaceId < - 0.5 ) material.clearcoatRoughness = max( material.clearcoatRoughness, 0.35 );
#endif
#if defined( USE_SHEEN ) && defined( DICER_IRIDESCENT )
	// streaked (dichroic) glass: the color2 sheen only where the flip shows color2, so the dark
	// side stays dark
	material.sheenColor *= mix( 1.0, clamp( dcIrT, 0.0, 1.0 ), uBodyPreset.w );
#endif
`;

export function iridescentPatch(a) {
  return {
    defines: { DICER_IRIDESCENT: '' },
    uniforms: { uBodyPreset: { value: new THREE.Vector4(...PRESET_PARAMS[a.body.preset]) } },
    chunks: { pars: PARS, colorPre: COLOR, roughness: ROUGHNESS, coat: COAT },
    params: params(new THREE.Color(a.body.color2)),
  };
}

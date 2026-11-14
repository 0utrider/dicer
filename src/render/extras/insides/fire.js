/**
 * Fire inside: flames rising from the bottom of the volume, licking upward, hot core to cool tips.
 *
 * Shape (canonical interior frame, heights along dcIUp, the die's world up, so the flames rise
 * whichever way the die lies):
 * - a flame bed low in the volume, wide at the bottom and narrowing upward (a bonfire's teardrop);
 * - inside it, heat falls off with height: each column across the bed reaches its own height (a
 *   noise of the point projected across up: the tongues), and a second noise in a space squashed
 *   along up tears the tips into ragged licks, more ragged the higher they climb; both scroll up
 *   over time, so the flames lick upward and flicker.
 * (Embers were tried: specks smaller than a march step stipple, so there are none.)
 *
 * Colour: colors[0] (the hot core) at the base, colors[1] (the cool edge) at the tips and edges,
 * whitening a little where it is hottest. Fire glows (emission along the segment, light
 * absorption): it is not lit by the key light. density sets how high the flames reach and how
 * thick they are.
 *
 * Motion: DC_FI_T is uInteriorTime with insideMotion, the constant 0 without (a still frame, no
 * uniform read). DC_FI_FLARE is uInteriorFlare (0..1, roll effects: effects/library/inside-flare.js):
 * the flames reach higher and burn brighter, height and brightness x (1 + flare), the fire roars;
 * without motion it is the constant 0 (no change).
 *
 * Cost: an early out outside the volume, then two noise lookups per sample, only inside the
 * flame bed. Edges widen with the segment length, so the flames stay solid at the lowest marched
 * tier.
 */
export const USES_NOISE = true; // dcNoise3

/** Flame geometry (canonical frame; the march sphere has radius 0.62). */
export const FIRE = Object.freeze({
  /** flame base and the top of the tallest flame along up */
  base: -0.56,
  top: 0.5,
  /** flame bed radius at the base and at the top */
  width: [0.5, 0.14],
});

const f = (x) => x.toFixed(4);

const BODY = /* glsl */ `
#define DC_FI_BASE ${f(FIRE.base)}
#define DC_FI_SPAN ${f(FIRE.top - FIRE.base)}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	float env = dcIEdge( p );
	if ( env <= 0.0 ) return vec4( 0.0 );
	float y = dot( p, dcIUp );
	float h = clamp( ( y - DC_FI_BASE ) / DC_FI_SPAN, 0.0, 1.0 ); // 0 at the base, 1 at the top
	float r = length( p - y * dcIUp ); // distance from the flames' axis
	float fl = DC_FI_FLARE;
	vec3 rad = vec3( 0.0 );
	float a = 0.0;
	// the flame bed: wide low, narrowing to the tips
	float w = mix( ${f(FIRE.width[0])}, ${f(FIRE.width[1])}, h );
	if ( r < w + 0.12 && y > DC_FI_BASE - 0.05 ) {
		// the tongues: each column across the bed reaches its own height (noise of the point
		// projected across up), flickering as the field scrolls along up
		float n1 = dcNoise3( ( p - y * dcIUp ) * 8.5 - dcIUp * ( DC_FI_T * 1.7 ) );
		// rising turbulence, squashed along up (tall features), tearing the tips into licks
		float n2 = dcNoise3( ( p - 0.65 * y * dcIUp ) * 7.0 + vec3( 7.1, 3.3, 1.7 ) - dcIUp * ( DC_FI_T * 3.0 ) );
		// how high the flames reach: density, and the flare makes them roar
		float reach = mix( 0.55, 1.0, uInteriorDensity ) * ( 1.0 + fl ) * ( 0.22 + 1.05 * n1 );
		float heat = 1.0 - h / max( reach, 0.05 ) + ( n2 - 0.5 ) * ( 0.25 + 0.9 * h );
		heat *= 1.0 - smoothstep( 0.4 * w, w + dt * 0.5, r + ( n2 - 0.5 ) * 0.16 );
		heat *= smoothstep( DC_FI_BASE - 0.05, DC_FI_BASE + 0.1, y );
		heat = clamp( heat, 0.0, 1.0 ) * env;
		// hot core at the base, cool tips and edges, whitening where hottest
		vec3 col = mix( uInteriorColors[ 1 ], uInteriorColors[ 0 ], smoothstep( 0.15, 0.8, heat ) );
		col = mix( col, vec3( 1.0 ), 0.3 * smoothstep( 0.85, 1.0, heat ) );
		// fire glows: emission along the segment, with only a light absorption
		float body = smoothstep( 0.02, 0.3 + dt, heat );
		a = dcIAlpha( body * mix( 3.0, 10.0, uInteriorDensity ), dt );
		rad = col * body * ( 0.2 + 1.1 * heat ) * ( 1.0 + fl ) * min( dt * 11.0, 1.0 );
	}
	return vec4( min( rad, vec3( 1.0 ) ), a );
}
`;

const STILL = '#define DC_FI_T 0.0\n#define DC_FI_FLARE 0.0\n';
const LIVE = '#define DC_FI_T uInteriorTime\n#define DC_FI_FLARE uInteriorFlare\n';

/**
 * @returns {{ body: string }} the fire GLSL (every colour and the density are uniforms); `live`
 * (insideMotion) reads time and flare from the motion uniforms, otherwise both are constants
 */
export function fireInside(_a, live = false) {
  return { body: (live ? LIVE : STILL) + BODY };
}

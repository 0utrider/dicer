/**
 * Procedural noise library for the dice shaders (marble veins, grime, interiors).
 * All functions are deterministic and texture-free (no binary assets).
 *
 * - dcHash13(p): hash of a 3D point to [0, 1).
 * - dcNoise3(p): value noise in [0, 1], C1-smooth (quintic fade), period-free.
 * - dcFbm3(p, octaves): fractal sum of dcNoise3, normalized to [0, 1]. Octaves are clamped
 *   to [1, DC_FBM_MAX_OCTAVES] (the loop has a constant bound for older drivers).
 */
export const NOISE_GLSL = /* glsl */ `
#ifndef DC_NOISE
#define DC_NOISE
#define DC_FBM_MAX_OCTAVES 8

float dcHash13( vec3 p ) {
	p = fract( p * 0.1031 );
	p += dot( p, p.zyx + 31.32 );
	return fract( ( p.x + p.y ) * p.z );
}

float dcNoise3( vec3 p ) {
	vec3 i = floor( p );
	vec3 f = fract( p );
	vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
	float n000 = dcHash13( i );
	float n100 = dcHash13( i + vec3( 1.0, 0.0, 0.0 ) );
	float n010 = dcHash13( i + vec3( 0.0, 1.0, 0.0 ) );
	float n110 = dcHash13( i + vec3( 1.0, 1.0, 0.0 ) );
	float n001 = dcHash13( i + vec3( 0.0, 0.0, 1.0 ) );
	float n101 = dcHash13( i + vec3( 1.0, 0.0, 1.0 ) );
	float n011 = dcHash13( i + vec3( 0.0, 1.0, 1.0 ) );
	float n111 = dcHash13( i + vec3( 1.0, 1.0, 1.0 ) );
	return mix(
		mix( mix( n000, n100, u.x ), mix( n010, n110, u.x ), u.y ),
		mix( mix( n001, n101, u.x ), mix( n011, n111, u.x ), u.y ),
		u.z );
}

float dcFbm3( vec3 p, int octaves ) {
	float sum = 0.0;
	float amp = 0.5;
	float norm = 0.0;
	for ( int i = 0; i < DC_FBM_MAX_OCTAVES; i ++ ) {
		if ( i >= octaves ) break;
		sum += amp * dcNoise3( p );
		norm += amp;
		// Rotate-ish and scale between octaves to hide the lattice.
		p = mat3( 0.00, 0.80, 0.60, - 0.80, 0.36, - 0.48, - 0.60, - 0.48, 0.64 ) * p * 2.02;
		amp *= 0.5;
	}
	return norm > 0.0 ? sum / norm : 0.0;
}
#endif
`;

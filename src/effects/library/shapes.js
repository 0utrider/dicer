/**
 * Procedural particle shapes (no textures, so nothing to re-upload after a context restore).
 * `SHAPE_GLSL` defines `float shapeAlpha(int shape, vec2 q, float seed)`: the coverage (0..1) of
 * a shape at q in -1..1 across the particle's quad (+y up, +x along a streak's motion); `seed`
 * is a per-particle random 0..1 that varies the noisy and irregular shapes.
 */
export const SHAPE = Object.freeze({
  DOT: 0,
  STREAK: 1,
  SMOKE: 2,
  GLINT: 3,
  SHARD: 4,
  FLAME: 5,
  FLAKE: 6,
  RING: 7,
});

export const SHAPE_GLSL = /* glsl */ `
float shapeHash( vec2 p ) {
	return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float shapeNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float a = shapeHash( i );
	float b = shapeHash( i + vec2( 1.0, 0.0 ) );
	float c = shapeHash( i + vec2( 0.0, 1.0 ) );
	float d = shapeHash( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
float shapeAlpha( int shape, vec2 q, float seed ) {
	float r = length( q );
	if ( shape == 1 ) {
		// STREAK: a soft capsule along x.
		float d = length( vec2( max( abs( q.x ) - 0.55, 0.0 ) / 0.45, q.y ) );
		return 1.0 - smoothstep( 0.35, 1.0, d );
	}
	if ( shape == 2 ) {
		// SMOKE: 3-octave value noise inside a soft disc.
		vec2 p = q * 1.7 + seed * 37.0;
		float n = 0.5 * shapeNoise( p ) + 0.3 * shapeNoise( p * 2.1 + 5.3 ) + 0.2 * shapeNoise( p * 4.3 + 9.1 );
		float disc = 1.0 - smoothstep( 0.25, 1.0, r );
		return disc * smoothstep( 0.25, 0.75, n + 0.25 * disc );
	}
	if ( shape == 3 ) {
		// GLINT: a four-point star (two crossed thin ellipses) and a hot core.
		float h = 1.0 - smoothstep( 0.0, 1.0, length( vec2( q.x, q.y * 7.0 ) ) );
		float v = 1.0 - smoothstep( 0.0, 1.0, length( vec2( q.x * 7.0, q.y ) ) );
		float core = 1.0 - smoothstep( 0.0, 0.3, r );
		return max( max( h, v ), core );
	}
	if ( shape == 4 ) {
		// SHARD: a triangle, its apex skewed per particle.
		float ax = ( seed - 0.5 ) * 0.7;
		float y = ( q.y + 0.7 ) / 1.6; // 0 at the base, 1 at the apex
		float halfW = 0.85 * ( 1.0 - y );
		float edge = halfW - abs( q.x - ax * y );
		return smoothstep( 0.0, 0.06, edge ) * smoothstep( 0.0, 0.06, y ) * step( y, 1.0 );
	}
	if ( shape == 5 ) {
		// FLAME: a teardrop, round at the bottom and narrow at the top.
		float y = ( q.y + 1.0 ) * 0.5;
		float halfW = 1.6 * sqrt( max( y, 0.0 ) ) * max( 1.0 - y, 0.0 ) + 0.001;
		float a = 1.0 - smoothstep( halfW * 0.45, halfW, abs( q.x ) );
		return a * ( 1.0 - 0.5 * smoothstep( 0.6, 1.0, y ) );
	}
	if ( shape == 6 ) {
		// FLAKE: a diamond.
		float d = abs( q.x ) * 1.35 + abs( q.y );
		return 1.0 - smoothstep( 0.55, 0.9, d );
	}
	if ( shape == 7 ) {
		// RING: a thin annulus.
		return 1.0 - smoothstep( 0.0, 0.14, abs( r - 0.78 ) );
	}
	// DOT: a soft disc with a hot core.
	float soft = 1.0 - smoothstep( 0.2, 1.0, r );
	float hot = 1.0 - smoothstep( 0.0, 0.4, r );
	return clamp( 0.6 * soft + 0.5 * hot, 0.0, 1.0 );
}
`;

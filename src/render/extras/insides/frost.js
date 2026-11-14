/**
 * Frost inside: ice spikes growing inward from the resin's wall, a cold haze, a slow glint crawl.
 *
 * Shape (canonical interior frame; the frost turns with the die like nebula):
 * - FROST.spikes slender cones rooted on the wall (FROST.wall), spread evenly over it (Fibonacci
 *   directions with a hashed nudge), each pointing at the centre and reaching in to a radius set
 *   by density (FROST.reach: shallow at 0, deep at 1), each a hashed share of that length;
 * - a cold haze in colors[1], thin in the middle and thicker towards the wall where the frost
 *   grows, drifting slowly (one noise lookup per sample);
 * - the glint: a bright band crawling along each spike from tip to root (out of phase across the
 *   spikes), on top of a specular highlight of the key light.
 *
 * Spikes are thin: a march sample would hit or miss them with the jitter (stipple). So the ray is
 * tested against every spike once, on its first sample (the spike list runs once per pixel and
 * keeps the two nearest hits in globals: their position along the ray and their shaded,
 * premultiplied colour); each hit is then added only by the march segment that contains it (the
 * last segment also takes the march's tail up to the volume exit), so a spike counts exactly once
 * whatever the jitter or step length. A hit's colour is read at the ray's closest approach to the
 * spike's axis: constant along the ray, so the edges are clean.
 *
 * Colour: colors[0] is the ice (whiter at the tips, a little of colors[1] at the roots), lit by
 * the key light with a rim; colors[1] is the haze.
 *
 * Motion: DC_FR_T is uInteriorTime with insideMotion, the constant 0 without (a still frame, no
 * uniform read): the glint crawls and the haze drifts with time; the spikes hold still.
 *
 * Cost: once per pixel, FROST.spikes ray / segment tests (three hashes each); per sample an exit
 * test, then an early out past the haze's edge (only the spike hits), else one noise lookup.
 */
export const USES_NOISE = true; // dcNoise3, dcHash13

/** Frost geometry (canonical frame; the march sphere has radius 0.62). */
export const FROST = Object.freeze({
  /** the spikes' roots */
  wall: 0.6,
  /** the radius the longest spikes reach in to at density 0 and 1 */
  reach: [0.42, 0.14],
  /** how many spikes */
  spikes: 40,
});

const f = (x) => x.toFixed(4);

const BODY = /* glsl */ `
#define DC_FR_N ${FROST.spikes}
#define DC_FR_WALL ${f(FROST.wall)}
#define DC_FR_IN mix( ${f(FROST.reach[0])}, ${f(FROST.reach[1])}, uInteriorDensity )
// this ray's two nearest spike hits, found on its first sample: where they sit along the ray
// (from dcFrO) and their premultiplied colour
bool dcFrInit = false;
vec3 dcFrO;
float dcFrS1;
float dcFrS2;
vec4 dcFrC1;
vec4 dcFrC2;
// closest approach of the ray o + rd * s to the segment a .. a + ab: ( distance, s, segment u )
vec3 dcFrSeg( vec3 o, vec3 rd, vec3 a, vec3 ab ) {
	vec3 w = o - a;
	float bb = dot( rd, ab );
	float den = dot( ab, ab ) - bb * bb;
	float u = den > 1e-7 ? clamp( ( dot( ab, w ) - bb * dot( rd, w ) ) / den, 0.0, 1.0 ) : 0.5;
	vec3 q = a + u * ab;
	float s = dot( q - o, rd );
	return vec3( length( o + s * rd - q ), s, u );
}
void dcFrRay( vec3 o, vec3 rd ) {
	dcFrS1 = 1e3;
	dcFrS2 = 1e3;
	dcFrC1 = vec4( 0.0 );
	dcFrC2 = vec4( 0.0 );
	float span = DC_FR_WALL - DC_FR_IN;
	for ( int i = 0; i < DC_FR_N; i ++ ) {
		float fi = float( i );
		// evenly over the wall (Fibonacci), nudged by a hash
		float z = 1.0 - ( 2.0 * fi + 1.0 ) / float( DC_FR_N );
		float ph = fi * 2.39996323 + 0.7;
		float rz = sqrt( max( 1.0 - z * z, 0.0 ) );
		vec3 hs = vec3( dcHash13( vec3( fi, 3.1, 7.7 ) ), dcHash13( vec3( fi, 9.2, 1.4 ) ), dcHash13( vec3( fi, 5.6, 4.9 ) ) );
		vec3 ax = normalize( vec3( rz * cos( ph ), z, rz * sin( ph ) ) + 0.2 * ( hs - 0.5 ) );
		float len = span * ( 0.5 + 0.5 * hs.x );
		float tip = DC_FR_WALL - len;
		vec3 dsu = dcFrSeg( o, rd, ax * tip, ax * len );
		float rad = ( 0.022 + 0.026 * hs.y ) * dsu.z; // a cone: 0 at the tip, widest at the root
		if ( dsu.x >= rad ) continue;
		float x = dsu.x / max( rad, 1e-4 );
		float th = 2.0 * rad * sqrt( max( 1.0 - x * x, 0.0 ) );
		float sh = max( dsu.y - 0.5 * th, 0.0 );
		if ( sh >= dcFrS2 ) continue;
		// the surface normal where the ray meets the spike (a round shaft seen at this offset)
		vec3 off = o + dsu.y * rd - ax * ( tip + len * dsu.z );
		vec3 side = dsu.x > 1e-5 ? off / dsu.x : normalize( cross( ax, rd + vec3( 1e-3 ) ) );
		vec3 nrm = normalize( side * x - rd * sqrt( max( 1.0 - x * x, 0.0 ) ) );
		float diff = 0.35 + 0.65 * max( dot( nrm, dcIKey ), 0.0 );
		float rim = 1.0 - max( dot( - rd, nrm ), 0.0 );
		float spec = pow( max( dot( reflect( rd, nrm ), dcIKey ), 0.0 ), 28.0 );
		// the glint: a band crawling from the tip to the root, out of phase across the spikes
		float gb = ( dsu.z - fract( DC_FR_T * 0.22 + hs.z * 3.7 ) ) * 6.0;
		float glint = exp( - gb * gb ) * ( 0.35 + 2.5 * spec );
		vec3 ice = mix( uInteriorColors[ 0 ], uInteriorColors[ 1 ], 0.25 * dsu.z );
		ice = mix( ice, vec3( 1.0 ), 0.3 * ( 1.0 - dsu.z ) );
		vec3 col = ice * ( dcILight * diff * 0.8 + 0.3 ) + ( ice + 0.3 ) * ( rim * rim * rim * 0.5 ) + vec3( spec * 0.9 + glint );
		// soft at the silhouette (no jaggies), more solid where the shaft is thick
		float al = ( 1.0 - smoothstep( 0.7, 1.0, x ) ) * ( 0.55 + 0.4 * ( 1.0 - exp( - th * 60.0 ) ) );
		vec4 c = vec4( min( col, vec3( 1.0 ) ) * al, al );
		if ( sh < dcFrS1 ) {
			dcFrS2 = dcFrS1;
			dcFrC2 = dcFrC1;
			dcFrS1 = sh;
			dcFrC1 = c;
		} else {
			dcFrS2 = sh;
			dcFrC2 = c;
		}
	}
}
// the hits the march segment from p (sp along the ray, lim long) holds, each dimmed by the haze
// (extinction haze) between the segment's start and the hit, so it does not depend on where the
// jitter put the segment's start
vec4 dcFrHits( float sp, float lim, float haze ) {
	vec4 acc = vec4( 0.0 );
	float s1 = dcFrS1 - sp;
	if ( s1 >= 0.0 && s1 < lim ) acc = dcFrC1 * exp( - haze * s1 );
	float s2 = dcFrS2 - sp;
	if ( s2 >= 0.0 && s2 < lim ) acc += ( 1.0 - acc.a ) * dcFrC2 * exp( - haze * s2 );
	return acc;
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	if ( ! dcFrInit ) {
		dcFrInit = true;
		dcFrO = p;
		dcFrRay( p, rd );
	}
	// the hits this segment holds (the last segment also takes the tail up to the exit)
	float sp = dot( p - dcFrO, rd );
	float ex = dcIVolume( p, rd ).y;
	float lim = ex - dt < dt ? ex : dt;
	// the early out: past the haze's edge only the spike hits (roots sit at the wall), no noise
	float env = dcIEdge( p );
	if ( env <= 0.0 ) return dcFrHits( sp, lim, 0.0 );
	// the cold haze: thicker towards the wall where the frost grows, drifting slowly
	float r = length( p );
	float n = dcNoise3( p * 3.4 + vec3( DC_FR_T * 0.05, DC_FR_T * 0.02, 0.0 ) + 1.3 );
	float haze = ( 0.25 + 1.6 * smoothstep( DC_FR_IN - 0.1, DC_FR_WALL, r ) ) * ( 0.4 + n ) * mix( 0.6, 1.4, uInteriorDensity ) * env;
	float a = dcIAlpha( haze, dt );
	vec4 acc = dcFrHits( sp, lim, haze );
	vec3 hc = uInteriorColors[ 1 ] * ( dcILight * 0.55 + 0.2 );
	return acc + ( 1.0 - acc.a ) * vec4( min( hc, vec3( 1.0 ) ) * a, a );
}
`;

const STILL = '#define DC_FR_T 0.0\n';
const LIVE = '#define DC_FR_T uInteriorTime\n';

/**
 * @returns {{ body: string }} the frost GLSL (every colour and the density are uniforms); `live`
 * (insideMotion) reads time from the motion uniform, otherwise it is the constant 0
 */
export function frostInside(_a, live = false) {
  return { body: (live ? LIVE : STILL) + BODY };
}

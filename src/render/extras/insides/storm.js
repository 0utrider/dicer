/**
 * Storm inside: a dark thundercloud with short forked sparks flashing at random spots.
 *
 * Shape (canonical interior frame; the cloud turns with the die like nebula):
 * - the cloud: billows from two noise lookups, denser towards the middle, lit a little from the
 *   key light's side, in colors[1] (keep it dark);
 * - the sparks: time is cut into slots of STORM.period seconds, one spark per slot at a spot and
 *   heading hashed from the slot index: a short jagged bolt (three segments) with a fork. Each
 *   flashes for STORM.flash seconds (with a flicker, a second stroke) and then fades fast, so one
 *   strikes about every 0.4 s. The flash also lights the cloud round the spot, in colors[0].
 *
 * Sparks are thin lines: a march sample cannot hit them (they would stipple). Each segment of a
 * bolt is tested against the whole ray instead: the closest approach of the ray to the segment
 * gives a distance (the glow) and a ray position, and the glow is added only by the one march
 * segment that contains that position (the last segment also takes the march's tail up to the
 * volume exit). Every sample of a ray computes the same closest approach, so the line counts
 * exactly once whatever the jitter or step length (as glitter's flakes do).
 *
 * Motion: DC_ST_T is uInteriorTime with insideMotion, the constant 0 without (a still frame: the
 * first slot's spark at full flash, no uniform read). Under prefers-reduced-motion the patch
 * carries DICER_CALM (index.js): the first three slots' sparks held at half brightness, nothing
 * strobes (the cloud still drifts at the reduced time). Storm does not read uInteriorFlare (Task 9's agitation).
 *
 * Cost: an early out outside the volume, two noise lookups per sample; the bolt (four
 * ray / segment tests) only while a spark is lit (three bolts under DICER_CALM).
 */
export const USES_NOISE = true; // dcNoise3, dcHash13

/** Spark timing (seconds) and size (canonical frame; the march sphere has radius 0.62). */
export const STORM = Object.freeze({
  /** one spark per period */
  period: 0.4,
  /** how long a spark flashes before it fades */
  flash: 0.12,
  /** bolt length */
  length: 0.32,
});

const f = (x) => x.toFixed(4);

const BODY = /* glsl */ `
#define DC_ST_PERIOD ${f(STORM.period)}
#define DC_ST_FLASH ${f(STORM.flash)}
#define DC_ST_LEN ${f(STORM.length)}
// closest approach of the ray p + rd * s to the segment a..b: ( distance, s )
vec2 dcStSeg( vec3 p, vec3 rd, vec3 a, vec3 b ) {
	vec3 ab = b - a;
	vec3 w = p - a;
	float bb = dot( rd, ab );
	float den = dot( ab, ab ) - bb * bb;
	float u = den > 1e-7 ? clamp( ( dot( ab, w ) - bb * dot( rd, w ) ) / den, 0.0, 1.0 ) : 0.5;
	vec3 q = a + u * ab;
	float s = dot( q - p, rd );
	return vec2( length( p + s * rd - q ), s );
}
// a bolt segment's glow, added only by the march segment holding its closest approach, dimmed
// by the cloud between the segment's start and that point (extinction sig), so it does not
// depend on where the jitter put the segment's start
float dcStGlow( vec2 ds, float lim, float sig ) {
	if ( ds.y < 0.0 || ds.y >= lim ) return 0.0;
	return ( exp( - ds.x * ds.x * 4000.0 ) + 0.16 * exp( - ds.x * 26.0 ) ) * exp( - sig * ds.y );
}
// the bolt of slot k: ( its glow on this march segment, the distance from p to its spot )
vec2 dcStBolt( vec3 p, vec3 rd, float k, float lim, float sig ) {
	vec3 h = vec3( dcHash13( vec3( k, 1.3, 7.1 ) ), dcHash13( vec3( k, 5.9, 2.4 ) ), dcHash13( vec3( k, 8.2, 3.7 ) ) );
	vec3 g = vec3( dcHash13( vec3( k, 4.4, 9.6 ) ), dcHash13( vec3( k, 2.2, 6.8 ) ), dcHash13( vec3( k, 7.7, 0.9 ) ) );
	// slot 0 (the still frame) strikes part way out, never deep in the middle
	vec3 c = k == 0.0 ? normalize( h - 0.5 ) * 0.2 : ( h - 0.5 ) * 0.5;
	vec3 dir = normalize( g - 0.5 + vec3( 0.0, 0.002, 0.0 ) );
	vec3 sd = normalize( cross( dir, abs( dir.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) ) );
	vec3 sd2 = cross( dir, sd );
	// the jagged bolt: two kinks off the line, and a fork from the second
	vec3 b0 = c - dir * ( DC_ST_LEN * 0.5 );
	vec3 b1 = c - dir * ( DC_ST_LEN * 0.15 ) + sd * 0.05 + sd2 * ( 0.06 * ( g.x - 0.5 ) );
	vec3 b2 = c + dir * ( DC_ST_LEN * 0.18 ) - sd * 0.045 + sd2 * ( 0.06 * ( h.x - 0.5 ) );
	vec3 b3 = c + dir * ( DC_ST_LEN * 0.5 ) + sd * 0.015;
	vec3 fk = b2 + normalize( dir * 0.7 - sd * 0.9 + sd2 * ( g.z - 0.5 ) ) * ( DC_ST_LEN * 0.32 );
	float gl = dcStGlow( dcStSeg( p, rd, b0, b1 ), lim, sig ) + dcStGlow( dcStSeg( p, rd, b1, b2 ), lim, sig )
		+ dcStGlow( dcStSeg( p, rd, b2, b3 ), lim, sig ) + 0.75 * dcStGlow( dcStSeg( p, rd, b2, fk ), lim, sig );
	return vec2( gl, length( p - c ) );
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	float env = dcIEdge( p );
	if ( env <= 0.0 ) return vec4( 0.0 );
	float r = length( p );
	// the cloud: slow billows, denser towards the middle
	vec3 q = p * 3.0 + vec3( 0.0, DC_ST_T * 0.06, DC_ST_T * 0.04 );
	float n1 = dcNoise3( q + 2.7 );
	float n2 = dcNoise3( q * 1.9 - 6.1 );
	// soft billows: a smooth extinction keeps a spark's dimming the same whatever the jitter
	float dens = smoothstep( 0.2, 0.85, n1 * 0.7 + n2 * 0.3 + 0.3 * ( 0.3 - r ) );
	float sig = ( dens * mix( 5.0, 16.0, uInteriorDensity ) + 0.8 ) * env;
	float a = dcIAlpha( sig, dt );
	float lit = 0.25 + 0.55 * smoothstep( - 0.35, 0.6, dot( p, dcIKey ) ) * ( 1.0 - 0.5 * dens );
	vec3 cloud = uInteriorColors[ 1 ] * ( dcILight * lit * 0.4 + 0.04 );
	// the march's last segment also takes its tail up to the volume exit
	float ex = dcIVolume( p, rd ).y;
	float lim = ex - dt < dt ? ex : dt;
	float gl = 0.0;
	float near = 0.0;
#ifdef DICER_CALM
	// reduced motion: the first three sparks held at half brightness, nothing flashes
	float e = 0.5;
	for ( int i = 0; i < 3; i ++ ) {
		vec2 b = dcStBolt( p, rd, float( i ), lim, sig );
		gl += b.x;
		near += exp( - b.y * 5.0 );
	}
#else
	// this slot's spark: a flash of DC_ST_FLASH with a flicker (the second stroke), then a fast fade
	float tt = DC_ST_T / DC_ST_PERIOD;
	float k = floor( tt );
	float u = ( tt - k ) * DC_ST_PERIOD;
	float e = u < DC_ST_FLASH ? 1.0 - 0.55 * step( 0.04, u ) * step( u, 0.07 ) : exp( - ( u - DC_ST_FLASH ) * 22.0 );
	if ( e > 0.003 ) {
		vec2 b = dcStBolt( p, rd, k, lim, sig );
		gl = b.x;
		near = exp( - b.y * 5.0 );
	}
#endif
	vec3 spark = ( uInteriorColors[ 0 ] * 1.3 + 0.3 ) * ( gl * e );
	// the flash lights the cloud round the spot
	cloud += uInteriorColors[ 0 ] * ( e * 2.6 * near * ( 0.3 + dens ) );
	// the spark is not clamped: which march segment claims each bolt segment depends on the jitter,
	// so a clamp of their sum (or with the cloud) would dither the bolt
	return vec4( min( cloud, vec3( 1.0 ) ) * a + spark, a );
}
`;

const STILL = '#define DC_ST_T 0.0\n';
const LIVE = '#define DC_ST_T uInteriorTime\n';

/**
 * @returns {{ body: string }} the storm GLSL (every colour and the density are uniforms); `live`
 * (insideMotion) reads time from the motion uniform, otherwise it is the constant 0
 */
export function stormInside(_a, live = false) {
  return { body: (live ? LIVE : STILL) + BODY };
}

/**
 * Storm inside: a dark thundercloud with short forked sparks flashing at random spots.
 *
 * Shape (canonical interior frame; the cloud turns with the die like nebula):
 * - the cloud: billows from two noise lookups with gaps between them, denser towards the middle;
 *   their thin rims catch the key light, their dense cores sit in shadow; colors[1] is only tinted
 *   in, so the cloud stays dark whatever its colour;
 * - the sparks: time is cut into slots of STORM.period seconds, one spark per slot at a spot and
 *   heading hashed from the slot index: a short jagged bolt (three segments) with a fork. Each
 *   flashes for STORM.flash seconds (with a flicker, a second stroke) and then fades fast, so one
 *   strikes about every 0.4 s. The flash also lights the cloud round the spot, in colors[0], and
 *   clears it round the spot and along the ray in front of it (a window from the eye to the spark,
 *   the same for every sample of a ray), so a bolt shows through the cloud from any side. Slot 0
 *   (the still frame) has a fixed spot and heading part way out. The bolt's core is white-hot,
 *   tinted colors[0], so it reads on a body of its own colour.
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
 * carries DICER_CALM (index.js): the first three slots' sparks held steady, nothing strobes: their
 * light on the cloud at half a flash, the bolts at three quarters so they still read as sparks (the
 * cloud still drifts at the reduced time). Storm does not read uInteriorFlare (Task 9's agitation).
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
// the spot slot k strikes at; slot 0 (the still frame, a calm spark) at a fixed spot part way out,
// never deep in the cloud
vec3 dcStSpot( float k ) {
	vec3 h = vec3( dcHash13( vec3( k, 1.3, 7.1 ) ), dcHash13( vec3( k, 5.9, 2.4 ) ), dcHash13( vec3( k, 8.2, 3.7 ) ) );
	return k == 0.0 ? vec3( - 0.2, 0.18, 0.0 ) : ( h - 0.5 ) * 0.5;
}
// how much of the cloud a strike at c clears along this ray: a window from the eye to the spark
// (the ray passes close to c, in front of it), so a spark shows through the cloud from any side.
// It depends only on the ray and c, the same at every sample (no stipple at its edge)
float dcStWin( vec3 p, vec3 rd, vec3 c ) {
	vec3 w = c - p;
	float along = dot( w, rd );
	vec3 off = w - rd * along;
	return exp( - dot( off, off ) * 60.0 ) * smoothstep( - 0.08, 0.06, along );
}
// the glow on this march segment of slot k's bolt, struck at c
float dcStBolt( vec3 p, vec3 rd, float k, vec3 c, float lim, float sig ) {
	vec3 g = vec3( dcHash13( vec3( k, 4.4, 9.6 ) ), dcHash13( vec3( k, 2.2, 6.8 ) ), dcHash13( vec3( k, 7.7, 0.9 ) ) );
	// slot 0's bolt: a fixed heading across the yz plane
	vec3 dir = k == 0.0 ? vec3( 0.11, 0.45, - 0.886 ) : normalize( g - 0.5 + vec3( 0.0, 0.002, 0.0 ) );
	vec3 sd = normalize( cross( dir, abs( dir.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) ) );
	vec3 sd2 = cross( dir, sd );
	// the jagged bolt: two kinks off the line, and a fork from the second
	vec3 b0 = c - dir * ( DC_ST_LEN * 0.5 );
	vec3 b1 = c - dir * ( DC_ST_LEN * 0.15 ) + sd * 0.05 + sd2 * ( 0.06 * ( g.x - 0.5 ) );
	vec3 b2 = c + dir * ( DC_ST_LEN * 0.18 ) - sd * 0.045 + sd2 * ( 0.06 * ( g.y - 0.5 ) );
	vec3 b3 = c + dir * ( DC_ST_LEN * 0.5 ) + sd * 0.015;
	vec3 fk = b2 + normalize( dir * 0.7 - sd * 0.9 + sd2 * ( g.z - 0.5 ) ) * ( DC_ST_LEN * 0.32 );
	return dcStGlow( dcStSeg( p, rd, b0, b1 ), lim, sig ) + dcStGlow( dcStSeg( p, rd, b1, b2 ), lim, sig )
		+ dcStGlow( dcStSeg( p, rd, b2, b3 ), lim, sig ) + 0.75 * dcStGlow( dcStSeg( p, rd, b2, fk ), lim, sig );
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	float env = dcIEdge( p );
	if ( env <= 0.0 ) return vec4( 0.0 );
	float r = length( p );
	// the lit sparks: e lights the cloud round their spots, eb is the bolts' own brightness
#ifdef DICER_CALM
	// reduced motion: the first three sparks held steady, nothing flashes: their light on the cloud
	// at half a flash, the bolts themselves at three quarters so they still read as sparks
	float e = 0.5;
	float eb = 0.75;
	vec3 c0 = dcStSpot( 0.0 );
	vec3 c1 = dcStSpot( 1.0 );
	vec3 c2 = dcStSpot( 2.0 );
	vec3 dd = vec3( length( p - c0 ), length( p - c1 ), length( p - c2 ) );
	float near = dot( exp( - dd * 5.0 ), vec3( 1.0 ) );
	float hole = dot( exp( - dd * 4.0 ), vec3( 1.0 ) ) + dcStWin( p, rd, c0 ) + dcStWin( p, rd, c1 ) + dcStWin( p, rd, c2 );
#else
	// this slot's spark: a flash of DC_ST_FLASH with a flicker (the second stroke), then a fast fade
	float tt = DC_ST_T / DC_ST_PERIOD;
	float k = floor( tt );
	float u = ( tt - k ) * DC_ST_PERIOD;
	float e = u < DC_ST_FLASH ? 1.0 - 0.55 * step( 0.04, u ) * step( u, 0.07 ) : exp( - ( u - DC_ST_FLASH ) * 22.0 );
	float eb = e;
	vec3 c0 = dcStSpot( k );
	float d0 = length( p - c0 );
	float near = exp( - d0 * 5.0 );
	float hole = e > 0.003 ? ( exp( - d0 * 4.0 ) + dcStWin( p, rd, c0 ) ) * min( e * 1.5, 1.0 ) : 0.0;
#endif
	// the cloud: slow billows with gaps between them, denser towards the middle; a strike clears
	// the cloud round it and in front of it, so its bolt shows from every side
	vec3 q = p * 3.0 + vec3( 0.0, DC_ST_T * 0.06, DC_ST_T * 0.04 );
	float n1 = dcNoise3( q + 2.7 );
	float n2 = dcNoise3( q * 1.9 - 6.1 );
	float dens = smoothstep( 0.25, 0.72, n1 * 0.7 + n2 * 0.3 + 0.25 * ( 0.3 - r ) ) * ( 1.0 - 0.85 * min( hole, 1.0 ) );
	float sig = ( dens * mix( 8.0, 24.0, uInteriorDensity ) + 1.2 * ( 1.0 - 0.7 * min( hole, 1.0 ) ) ) * env;
	float a = dcIAlpha( sig, dt );
	// billow contrast: the thin rims catch the light on the key's side, the dense cores sit in
	// their own shadow; colors[1] is only tinted in, so the cloud stays dark whatever its colour
	float rim = 1.0 - smoothstep( 0.1, 0.75, dens );
	float side = smoothstep( - 0.45, 0.5, dot( p, dcIKey ) );
	vec3 cloud = uInteriorColors[ 1 ] * ( dcILight * ( 0.015 + 0.45 * rim * side + 0.04 * side ) + 0.008 );
	// the march's last segment also takes its tail up to the volume exit
	float ex = dcIVolume( p, rd ).y;
	float lim = ex - dt < dt ? ex : dt;
#ifdef DICER_CALM
	float gl = dcStBolt( p, rd, 0.0, c0, lim, sig ) + dcStBolt( p, rd, 1.0, c1, lim, sig ) + dcStBolt( p, rd, 2.0, c2, lim, sig );
#else
	float gl = e > 0.003 ? dcStBolt( p, rd, k, c0, lim, sig ) : 0.0;
#endif
	// a white-hot core tinted colors[0], so it reads on a body of its own colour
	vec3 spark = ( mix( uInteriorColors[ 0 ], vec3( 1.0 ), 0.55 ) * 2.0 ) * ( gl * eb );
	// the flash lights the cloud round the spot
	cloud += uInteriorColors[ 0 ] * ( e * 2.2 * near * ( 0.3 + dens ) );
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

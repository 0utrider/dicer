/**
 * Living insides: animated variants of today's liquid, glitter, swirl and nebula (shaders/interior.js
 * draws the still ones, at world start, untouched). insidePatch routes those four types here when
 * insideMotion.wants() (live.js) is true; the pars then hold MOTION_PARS, so the GLSL may read
 * uInteriorTime (seconds, already scaled by the motion factor: it stops after landing and runs at a
 * quarter under reduced motion, so it is never re-scaled here), uInteriorLag (unit, canonical
 * frame) and uInteriorSwirl (rotation vector, canonical frame). uInteriorFlare is Task 9's, not
 * read here.
 *
 * Each variant is today's GLSL with its sample positions moved, never extra noise lookups (the
 * inside must hold up at 16 march steps):
 * - liquid: the core pools along the lagged down: its centre sinks a little and a flat surface
 *   across uInteriorLag cuts its top (lit as a meniscus), so the surface trails the die's turns,
 *   overshoots once and settles (the slosh spring is CPU side, live.js). Its waves drift.
 * - glitter: each flake's centre (and normal) turns by the swirl rotation vector uInteriorSwirl,
 *   more near the centre than at the rim (a swirl, not a rigid turn). The vector is integrated on
 *   the CPU (motion.js: += dt x rate x (0.15 local up + 0.08 spin)), so it speeds up with the spin,
 *   only slows when the spin dies at landing (never unwinds) and stops with the motion factor; as a
 *   vector it has no axis flip as the spin passes through zero. The flake test stays exact:
 *   the candidate cells are those of the segment's ends turned back, and the ray is tested against
 *   the turned disc.
 * - swirl: the vortex turns about y, faster at the core.
 * - nebula: the clouds and their colour mix drift (stars stay put).
 * Drift speeds: about one feature width per 4 s.
 *
 * Contract as the other inside modules (index.js): dcInterior, INTERIOR_PARS names, own dcLv names.
 */
export const USES_NOISE = true; // dcNoise3, dcFbm3, dcHash13

/**
 * Local copies of shaders/interior.js INTERIOR values (pinned by a test: importing INTERIOR would
 * add a world-start export).
 */
export const LIVING = Object.freeze({
  radius: 0.62,
  glitterCells: 11,
  starCells: 11,
  cellMin: 0.3,
  cellMax: 0.7,
});

const f = (x) => x.toFixed(4);
const R = f(LIVING.radius);
/** GLSL: a point in [cellMin, cellMax] of a cell from hash h in [0, 1). */
const cellPos = (h) => `${f(LIVING.cellMin)} + ${f(LIVING.cellMax - LIVING.cellMin)} * ${h}`;

/**
 * The living liquid core over length dt (dent shrinks it: 0 for plain liquid, the air bubble's
 * dent for liquid-extras.js, which reuses this text as its core while moving).
 */
export const LIQUID_CORE = /* glsl */ `
#define DC_LV_SINK 0.06
#define DC_LV_LEVEL 0.4
vec4 dcLvLiquid( vec3 p, float dt, float dent ) {
	// the core's centre sits a little down the lagged up; its waves drift (one width per ~4 s)
	vec3 q = p + uInteriorLag * DC_LV_SINK;
	float r = length( q );
	float wave = dcNoise3( p * 4.0 + 1.7 + uInteriorTime * vec3( 0.2, 0.12, - 0.1 ) ) * 0.65
		+ dcNoise3( p * 9.0 - 3.1 + uInteriorTime * vec3( - 0.15, 0.17, 0.1 ) ) * 0.35;
	float coreR = mix( 0.16, 0.42, uInteriorDensity ) + 0.10 * ( wave - 0.5 );
	coreR -= dent;
	// the surface: a plane across the lagged up, so it trails the die's turns and settles
	float y = dot( q, uInteriorLag );
	float ys = DC_LV_LEVEL * coreR;
	float core = ( 1.0 - smoothstep( coreR - 0.025, coreR + 0.025, r ) )
		* ( 1.0 - smoothstep( ys - 0.02, ys + 0.02, y ) );
	// lit as today (fake radial normal), turning to the surface's normal just under it (meniscus)
	float top = smoothstep( ys - 0.06, ys, y );
	vec3 n = normalize( mix( q / max( r, 1e-4 ), uInteriorLag, top ) );
	float lit = 0.55 + 0.45 * max( dot( n, dcIKey ), 0.0 );
	vec3 coreCol = uInteriorColors[ 0 ] * ( dcILight * lit + 0.35 )
		+ uInteriorColors[ 1 ] * ( 0.35 * top * ( dcILight + 0.2 ) );
	vec3 hazeCol = uInteriorColors[ 1 ] * ( dcILight + 0.25 );
	float a = dcIAlpha( core * 60.0 + 1.6 * dcIEdge( p ), dt );
	return vec4( min( mix( hazeCol, coreCol, core ), vec3( 1.0 ) ) * a, a );
}
`;

const LIQUID = /* glsl */ `${LIQUID_CORE}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	return dcLvLiquid( p, dt, 0.0 );
}
`;

const GLITTER = /* glsl */ `
#define DC_LV_CELLS ${f(LIVING.glitterCells)}
#define DC_LV_FALL ${f(0.6 / LIVING.radius)}
vec3 dcLvHash33( vec3 p ) {
	return vec3( dcHash13( p ), dcHash13( p + 19.19 ), dcHash13( p + 47.77 ) );
}
// v turned by angle a about the unit axis k (Rodrigues)
vec3 dcLvTurn( vec3 v, vec3 k, float a ) {
	float c = cos( a );
	float s = sin( a );
	return v * c + cross( k, v ) * s + k * dot( k, v ) * ( 1.0 - c );
}
// today's flake (shaders/interior.js GLITTER), its centre and normal turned by the swirl
// (axis k, angle w at the centre, less towards the rim)
vec4 dcLvFlake( vec3 cell, vec3 p, vec3 rd, float dt, vec3 k, float w ) {
	if ( dcHash13( cell + 23.9 ) > 0.06 + 0.18 * uInteriorDensity ) return vec4( 0.0 );
	vec3 c = ( cell + ${cellPos('dcLvHash33( cell )')} ) / DC_LV_CELLS;
	float lc = length( c );
	if ( lc > ${f(LIVING.radius - 0.05)} ) return vec4( 0.0 );
	float ang = w * ( 1.0 - DC_LV_FALL * lc );
	c = dcLvTurn( c, k, ang );
	vec3 n = dcLvTurn( normalize( dcLvHash33( cell + 3.7 ) - 0.5 ), k, ang );
	float dn = dot( rd, n );
	if ( abs( dn ) < 1e-3 ) return vec4( 0.0 );
	float t = dot( c - p, n ) / dn;
	if ( t < 0.0 || t >= dt ) return vec4( 0.0 );
	vec3 x = p + rd * t - c;
	if ( dot( x, x ) > ${f((0.3 / LIVING.glitterCells) ** 2)} ) return vec4( 0.0 );
	vec3 col = mix( uInteriorColors[ 0 ], uInteriorColors[ 1 ], step( 0.6, dcHash13( cell + 11.3 ) ) );
	vec3 nf = dn > 0.0 ? - n : n;
	float spec = pow( max( dot( reflect( rd, nf ), dcIKey ), 0.0 ), 24.0 );
	vec3 rad = col * ( 0.3 * dcILight + 0.06 ) + ( col + 0.4 ) * spec * 10.0;
	return vec4( rad * 0.85, 0.85 );
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	// the swirl's rotation vector, integrated on the CPU (motion.js SWIRL)
	float w = length( uInteriorSwirl );
	vec3 k = w > 1e-5 ? uInteriorSwirl / w : vec3( 0.0, 1.0, 0.0 );
	// the candidate cells: the segment's ends turned back by the swirl at their radius
	vec3 e = p + rd * dt;
	vec3 c0 = floor( dcLvTurn( p, k, - w * ( 1.0 - DC_LV_FALL * length( p ) ) ) * DC_LV_CELLS );
	vec3 c1 = floor( dcLvTurn( e, k, - w * ( 1.0 - DC_LV_FALL * length( e ) ) ) * DC_LV_CELLS );
	vec4 acc = dcLvFlake( c0, p, rd, dt, k, w );
	if ( any( notEqual( c0, c1 ) ) ) acc += ( 1.0 - acc.a ) * dcLvFlake( c1, p, rd, dt, k, w );
	return acc;
}
`;

const SWIRL = /* glsl */ `
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	float l = length( p );
	// today's twist, turning with time: about 0.1 rad/s at the rim, 0.22 at the core
	float ang = 3.5 * ( ${R} - l ) + 2.0 * p.y + uInteriorTime * ( 0.1 + 0.2 * ( ${R} - l ) );
	float cs = cos( ang );
	float sn = sin( ang );
	vec3 q = vec3( cs * p.x - sn * p.z, p.y, sn * p.x + cs * p.z );
	q += 0.3 * ( vec3( dcNoise3( q * 1.6 ), dcNoise3( q * 1.6 + 5.2 ), dcNoise3( q * 1.6 + 9.4 ) ) - 0.5 );
	float f = q.x * 5.0 + 0.5;
	float g = ( q.y + 0.4 * q.z ) * 2.6;
	float band = fract( f );
	float ribbon = smoothstep( 0.22, 0.42, band ) * ( 1.0 - smoothstep( 0.58, 0.78, band ) )
		* ( 1.0 - smoothstep( 0.22, 0.32, abs( fract( g ) - 0.5 ) ) );
	vec3 col = uInteriorColors[ int( mod( floor( f ), 2.0 ) ) ];
	float sheen = 0.75 + 0.5 * ( 1.0 - ribbon );
	float a = dcIAlpha( ribbon * mix( 12.0, 36.0, uInteriorDensity ) * dcIEdge( p ), dt );
	return vec4( col * ( dcILight * sheen + 0.3 ) * a, a );
}
`;

const NEBULA = /* glsl */ `
#define DC_LV_STAR_CELLS ${f(LIVING.starCells)}
vec3 dcLvStars( vec3 cell, vec3 p, vec3 rd, float dt ) {
	float h = dcHash13( cell + 71.1 );
	if ( h < 0.86 ) return vec3( 0.0 );
	vec3 c = ( cell + ${cellPos('vec3( dcHash13( cell + 3.1 ), dcHash13( cell + 5.9 ), dcHash13( cell + 8.3 ) )')} ) / DC_LV_STAR_CELLS;
	float t = dot( c - p, rd );
	if ( t < 0.0 || t >= dt || length( c ) > ${f(LIVING.radius - 0.04)} ) return vec3( 0.0 );
	vec3 q = p + rd * t - c;
	float g = exp( - dot( q, q ) * ${f(LIVING.starCells * LIVING.starCells * 90)} );
	return mix( vec3( 1.0 ), uInteriorColors[ 1 ], 0.3 ) * g * ( 2.0 + 6.0 * ( h - 0.86 ) / 0.14 );
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	// the clouds and their colour mix drift (one cloud width per ~4 s), the stars stay
	float n = dcFbm3( p * 2.4 + 0.7 + uInteriorTime * vec3( 0.18, 0.12, - 0.13 ), 3 );
	float mixT = dcNoise3( p * 1.6 + 13.0 + uInteriorTime * vec3( - 0.1, 0.15, 0.17 ) );
	float cloud = smoothstep( 0.62 - 0.25 * uInteriorDensity, 0.9, n ) * dcIEdge( p );
	vec3 col = mix( uInteriorColors[ 0 ], uInteriorColors[ 1 ], smoothstep( 0.3, 0.7, mixT ) );
	float a = dcIAlpha( cloud * 14.0 + 0.4 * dcIEdge( p ), dt );
	vec3 rad = col * ( dcILight * ( 0.4 + 0.6 * n ) + 0.45 ) * a;
	vec3 c0 = floor( p * DC_LV_STAR_CELLS );
	vec3 c1 = floor( ( p + rd * dt ) * DC_LV_STAR_CELLS );
	rad += dcLvStars( c0, p, rd, dt );
	if ( any( notEqual( c0, c1 ) ) ) rad += dcLvStars( c1, p, rd, dt );
	return vec4( rad, a );
}
`;

const BODIES = { liquid: LIQUID, glitter: GLITTER, swirl: SWIRL, nebula: NEBULA };

/** The types this module animates (today's insides drawn by shaders/interior.js). */
export const LIVING_TYPES = Object.freeze(Object.keys(BODIES));

/** @returns {{ body: string }} the animated GLSL of the look's inside (liquid, glitter, swirl or nebula) */
export function livingInside(a) {
  const type = a.interior.type;
  if (!Object.hasOwn(BODIES, type)) throw new Error(`dicer: no living inside for "${type}"`);
  return { body: BODIES[type] };
}

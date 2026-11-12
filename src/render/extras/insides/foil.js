/**
 * Foil inside: crumpled metal-foil shards suspended in the resin, sparser and much larger than
 * glitter's discs.
 *
 * At most one shard per hashed cell (DC_FO_CELLS per canonical unit; density sets the chance a
 * cell holds one). A shard is a flat, star-shaped polygon: FOIL.sides vertices at jittered angles
 * with hashed radii (torn, notched outlines), stretched along one in-plane axis. It is tested
 * exactly against the march segment (plane hit, then point-in-polygon), like glitter's flakes, so
 * it counts once per segment. The segment's cells are walked front to back by a 3D DDA (each cell
 * once, at most FOIL_WALK of them: the longest segment, at the fewest steps, is short against a
 * cell), so no cell it crosses is skipped. The centre stays in [cellMin, cellMax] of its cell
 * with the radius at most 0.38 cell, so a shard always lies whole in its own cell.
 *
 * Crumpling: each of the polygon's triangles (centre to edge) is a facet with its own tilted
 * normal, so a shard catches the light in patches. Shading is metallic: a dim reflection of the
 * environment (brighter where a facet mirrors the view up towards dcIUp, the die's current world
 * up) and a narrow, strong flash where a facet mirrors the key light into the eye. colors[0] is
 * the main foil, colors[1] the foil of about FOIL.second of the shards.
 */
export const USES_NOISE = true; // dcHash13

export const FOIL = Object.freeze({
  cells: 3.5,
  cellMin: 0.38,
  cellMax: 0.62,
  /** shard radius at most this share of a cell (cellMin: the shard stays inside its cell) */
  radius: 0.38,
  sides: 6,
  /** share of shards in colors[1] */
  second: 0.3,
  /** facet tilt (crumpling) */
  tilt: 0.55,
  /** the fewest march steps of any tier with interiors (quality.js medium): bounds the segment length */
  minSteps: 16,
});

/** The march sphere radius (shaders/interior.js INTERIOR.radius; a local copy: no world-start import). */
export const MARCH_RADIUS = 0.62;

/**
 * The most cells one march segment can cross: the longest segment is the march sphere's diameter
 * over the fewest steps; along each axis it spans at most ceil(length x cells) boundaries, so a
 * walk visits at most 1 + 3 x that many cells (4 at the values above).
 */
export const FOIL_WALK = 1 + 3 * Math.ceil(((2 * MARCH_RADIUS) / FOIL.minSteps) * FOIL.cells);

const f = (x) => x.toFixed(4);

const BODY = /* glsl */ `
#define DC_FO_CELLS ${f(FOIL.cells)}
#define DC_FO_SIDES ${FOIL.sides}
#define DC_FO_WALK ${FOIL_WALK}
vec3 dcFoHash3( vec3 p ) {
	return vec3( dcHash13( p ), dcHash13( p + 19.19 ), dcHash13( p + 47.77 ) );
}
// 2D cross product (z of the 3D one)
float dcFoCross( vec2 a, vec2 b ) { return a.x * b.y - a.y * b.x; }
vec4 dcFoShard( vec3 cell0, float off, vec3 p, vec3 rd, float dt ) {
	vec3 cell = cell0 + off * 37.0; // the hash seed: each grid its own shards
	// density: the chance a cell holds a shard, 0.2 .. 0.65 per grid (about 10 .. 30 shards in the volume)
	if ( dcHash13( cell + 23.9 ) > 0.2 + 0.45 * uInteriorDensity ) return vec4( 0.0 );
	vec3 c = ( cell0 + off + ${f(FOIL.cellMin)} + ${f(FOIL.cellMax - FOIL.cellMin)} * dcFoHash3( cell ) ) / DC_FO_CELLS;
	float R = ${f(FOIL.radius)} / DC_FO_CELLS;
	if ( length( c ) > ${f(MARCH_RADIUS)} - R ) return vec4( 0.0 );
	vec3 n = normalize( dcFoHash3( cell + 3.7 ) - 0.5 );
	float dn = dot( rd, n );
	if ( abs( dn ) < 1e-3 ) return vec4( 0.0 );
	float t = dot( c - p, n ) / dn;
	if ( t < 0.0 || t >= dt ) return vec4( 0.0 );
	vec3 q = p + rd * t - c;
	if ( dot( q, q ) > R * R ) return vec4( 0.0 );
	vec3 t1 = normalize( cross( n, abs( n.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) ) );
	vec3 t2 = cross( n, t1 );
	vec3 hs = dcFoHash3( cell + 61.3 );
	// in-plane coordinates in units of R, the shard stretched along a hashed axis (strips)
	float sa = 6.2831853 * hs.x;
	vec2 uv = vec2( dot( q, t1 ), dot( q, t2 ) ) / R;
	uv = mat2( cos( sa ), sin( sa ), - sin( sa ), cos( sa ) ) * uv;
	uv.y /= mix( 0.6, 1.0, hs.y );
	// point in the star-shaped polygon: which centre triangle (facet) holds uv, if any
	int facet = - 1;
	vec2 v0 = vec2( 0.0 );
	for ( int k = 0; k <= DC_FO_SIDES; k ++ ) {
		int kk = k == DC_FO_SIDES ? 0 : k;
		vec3 hk = dcFoHash3( cell + 7.1 * float( kk ) + 101.7 );
		float ang = 6.2831853 * ( float( kk ) + 0.7 * ( hk.x - 0.5 ) ) / float( DC_FO_SIDES );
		vec2 v = mix( 0.5, 1.0, hk.y ) * vec2( cos( ang ), sin( ang ) );
		if ( k > 0 && facet < 0 ) {
			// inside triangle (0, v0, v): uv on the inner side of all three edges (counter-clockwise)
			if ( dcFoCross( v0, uv ) >= 0.0 && dcFoCross( uv, v ) >= 0.0 && dcFoCross( v - v0, uv - v0 ) >= 0.0 ) facet = k;
		}
		v0 = v;
	}
	if ( facet < 0 ) return vec4( 0.0 );
	// the facet's crumpled normal: the shard's normal tilted along a hashed in-plane direction
	vec3 hf = dcFoHash3( cell + 13.3 * float( facet ) + 5.1 );
	vec3 nf = normalize( n + ${f(FOIL.tilt)} * ( ( hf.x - 0.5 ) * 2.0 * t1 + ( hf.y - 0.5 ) * 2.0 * t2 ) );
	nf = dn > 0.0 ? - nf : nf; // two-sided: the side facing the eye
	vec3 col = mix( uInteriorColors[ 0 ], uInteriorColors[ 1 ], step( ${f(1 - FOIL.second)}, dcHash13( cell + 11.3 ) ) );
	vec3 r = reflect( rd, nf );
	// dim metal: the environment it mirrors, brighter towards the sky above the die
	vec3 env = dcILight * ( 0.15 + 0.7 * smoothstep( - 0.3, 1.0, dot( r, dcIUp ) ) ) * mix( 0.6, 1.2, hf.z );
	float rk = max( dot( r, dcIKey ), 0.0 );
	float flash = pow( rk, 28.0 );
	float sheen = pow( rk, 6.0 );
	vec3 rad = col * ( env + 0.03 ) + mix( col, vec3( 1.0 ), 0.3 ) * ( 3.0 * flash + 0.35 * sheen );
	return vec4( min( rad, vec3( 1.0 ) ) * 0.95, 0.95 );
}
// the shards of one grid (offset off, in cells) met by the segment: every cell it crosses, front to
// back (3D DDA: tm is the distance along the segment to the next boundary per axis)
vec4 dcFoGrid( float off, vec3 p, vec3 rd, float dt ) {
	vec3 s = p * DC_FO_CELLS - off;
	vec3 d = rd * DC_FO_CELLS;
	d = mix( d, vec3( 1e-6 ), lessThan( abs( d ), vec3( 1e-6 ) ) ); // no division by 0
	vec3 c = floor( s );
	vec3 tm = ( c + step( 0.0, d ) - s ) / d;
	vec3 td = 1.0 / abs( d );
	vec3 sg = sign( d );
	vec4 acc = vec4( 0.0 );
	for ( int i = 0; i < DC_FO_WALK; i ++ ) {
		acc += ( 1.0 - acc.a ) * dcFoShard( c, off, p, rd, dt );
		float tn = min( tm.x, min( tm.y, tm.z ) );
		if ( tn >= dt ) break;
		vec3 m = step( tm, vec3( tn ) ); // the axes crossed at tn
		c += m * sg;
		tm += m * td;
	}
	return acc;
}
// two interleaved grids (offset half a cell): twice the shards, each still whole in its cell
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	vec4 acc = dcFoGrid( 0.0, p, rd, dt );
	return acc + ( 1.0 - acc.a ) * dcFoGrid( 0.5, p, rd, dt );
}
`;

/** @returns {{ body: string }} the foil GLSL (every colour and the density are uniforms) */
export function foilInside(_a) {
  return { body: BODY };
}

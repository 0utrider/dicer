/**
 * Ray-marched resin interiors (Task 6): liquid core, glitter, swirl, nebula and suspended
 * shapes, all in die-local space (they turn with the die) and texture-free.
 *
 * interiorChunk(type, shape) returns { pars, main }:
 * - pars: the uniforms, the type's GLSL and dcInterior( p, rd, dt ), which returns the
 *   premultiplied colour and opacity of one march segment (p: segment start, rd: unit
 *   direction, dt: length, all in the canonical interior frame below).
 * - main: the march. It runs inside the resin refraction block (shaders/bodies.js), after the
 *   refracted environment colour dcRefracted is known, and reuses that block's die-local
 *   entry point (vLocalPos), refracted ray (dcRd), model rotation (dcRm), up-facing environment
 *   sample (dcRup) and Beer-Lambert body colour (dcRbody, dcRk). The interior is composited over dcRefracted (P2-R6), which
 *   the number fill (dcMask) then covers, so the numbers stay on top.
 *
 * Canonical frame: die-local space divided by uResinRadii / RESIN.radius (the resin body
 * ellipsoid), so the march volume is a sphere of radius INTERIOR.radius on every die and the
 * thin coin gets the same interior squashed into its caps instead of clipped.
 *
 * The step count is the DICER_STEPS define (flags.interiorSteps, part of programKey). Every
 * colour and number is a uniform: uInteriorColors, uInteriorDensity, uKeyLightDir.
 */
import { NOISE_GLSL } from './noise.js';
import { RESIN } from './bodies.js';

/**
 * March sphere radius (canonical frame), opacity at which the march stops, shape SDF scale,
 * glitter and star cells per canonical unit.
 */
export const INTERIOR = Object.freeze({
  radius: 0.62,
  opaque: 0.98,
  shapeScale: 0.35,
  glitterCells: 11,
  starCells: 11,
  cellMin: 0.3,
  cellMax: 0.7,
});

const f = (x) => x.toFixed(4);
/** GLSL: a point in [cellMin, cellMax] of a cell from hash h in [0, 1). */
const cellPos = (h) => `${f(INTERIOR.cellMin)} + ${f(INTERIOR.cellMax - INTERIOR.cellMin)} * ${h}`;

export const INTERIOR_PARS = /* glsl */ `
uniform vec3 uInteriorColors[ 2 ];
uniform float uInteriorDensity;
uniform vec3 uKeyLightDir; // world space, towards the key light
// Set by the march before the first sample: the key light direction in the canonical frame
// and the light level inside the body (environment irradiance from above).
vec3 dcIKey;
vec3 dcILight;

// Ray / march-sphere interval in the canonical frame: (enter, exit), enter > exit on a miss.
vec2 dcIVolume( vec3 o, vec3 d ) {
	float b = dot( o, d );
	float c = dot( o, o ) - ${f(INTERIOR.radius * INTERIOR.radius)};
	float h = b * b - c;
	if ( h < 0.0 ) return vec2( 1.0, - 1.0 );
	h = sqrt( h );
	return vec2( max( - b - h, 0.0 ), - b + h );
}
// Canonical frame scale: die-local / (uResinRadii / ${f(RESIN.radius)}); uniform 1 on dice.
vec3 dcIScale() { return ${f(RESIN.radius)} / uResinRadii; }
// Soft fade to the march sphere's surface (no hard rim where the volume ends).
float dcIEdge( vec3 p ) { return 1.0 - smoothstep( ${f(INTERIOR.radius - 0.08)}, ${f(INTERIOR.radius)}, length( p ) ); }
// Opacity of a homogeneous segment of extinction sigma and length dt.
float dcIAlpha( float sigma, float dt ) { return 1.0 - exp( - sigma * dt ); }
`;

/** Liquid core: a soft colors[0] blob with a wavy noise boundary in a thin colors[1] haze. */
const LIQUID = /* glsl */ `
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	float r = length( p );
	float wave = dcNoise3( p * 4.0 + 1.7 ) * 0.65 + dcNoise3( p * 9.0 - 3.1 ) * 0.35;
	float coreR = mix( 0.16, 0.42, uInteriorDensity ) + 0.10 * ( wave - 0.5 );
	float core = 1.0 - smoothstep( coreR - 0.025, coreR + 0.025, r );
	// fake core normal (radial) for a soft lit side, plus a bright rim at the boundary
	float lit = 0.55 + 0.45 * max( dot( p / max( r, 1e-4 ), dcIKey ), 0.0 );
	vec3 coreCol = uInteriorColors[ 0 ] * ( dcILight * lit + 0.35 );
	vec3 hazeCol = uInteriorColors[ 1 ] * ( dcILight + 0.25 );
	float a = dcIAlpha( core * 60.0 + 1.6 * dcIEdge( p ), dt );
	return vec4( mix( hazeCol, coreCol, core ) * a, a );
}
`;

/**
 * Glitter: at most one flat disc flake per hashed cell (density: the chance a cell holds one),
 * tested exactly against the ray segment, so a flake counts once, on the segment that crosses
 * it, whatever the step length. Only the cells of the segment's two ends are visited. A flake
 * sparkles where its random normal mirrors the key light into the eye.
 */
const GLITTER = /* glsl */ `
#define DC_GLITTER_CELLS ${f(INTERIOR.glitterCells)}
vec3 dcHash33( vec3 p ) {
	return vec3( dcHash13( p ), dcHash13( p + 19.19 ), dcHash13( p + 47.77 ) );
}
vec4 dcFlake( vec3 cell, vec3 p, vec3 rd, float dt ) {
	// density: expected flakes per cell, 0.06 .. 0.24 (about 60 .. 250 in the whole volume)
	if ( dcHash13( cell + 23.9 ) > 0.06 + 0.18 * uInteriorDensity ) return vec4( 0.0 );
	// the centre stays in [${INTERIOR.cellMin}, ${INTERIOR.cellMax}] of the cell, so the whole disc (radius 0.3
	// cell) lies in it: a flake whose cell the march skips is missed whole, never cut to a shard
	vec3 c = ( cell + ${cellPos('dcHash33( cell )')} ) / DC_GLITTER_CELLS;
	if ( length( c ) > ${f(INTERIOR.radius - 0.05)} ) return vec4( 0.0 );
	vec3 n = normalize( dcHash33( cell + 3.7 ) - 0.5 );
	float dn = dot( rd, n );
	if ( abs( dn ) < 1e-3 ) return vec4( 0.0 );
	float t = dot( c - p, n ) / dn;
	if ( t < 0.0 || t >= dt ) return vec4( 0.0 );
	vec3 q = p + rd * t - c;
	if ( dot( q, q ) > ${f((0.3 / INTERIOR.glitterCells) ** 2)} ) return vec4( 0.0 );
	vec3 col = mix( uInteriorColors[ 0 ], uInteriorColors[ 1 ], step( 0.6, dcHash13( cell + 11.3 ) ) );
	// two-sided mirror flake: a dim metallic disc, lit by the inner light, with a specular
	// spike where reflect(view) meets the key light
	vec3 nf = dn > 0.0 ? - n : n;
	float spec = pow( max( dot( reflect( rd, nf ), dcIKey ), 0.0 ), 24.0 );
	vec3 rad = col * ( 0.3 * dcILight + 0.06 ) + ( col + 0.4 ) * spec * 10.0;
	return vec4( rad * 0.85, 0.85 );
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	vec3 c0 = floor( p * DC_GLITTER_CELLS );
	vec3 c1 = floor( ( p + rd * dt ) * DC_GLITTER_CELLS );
	vec4 acc = dcFlake( c0, p, rd, dt );
	if ( any( notEqual( c0, c1 ) ) ) acc += ( 1.0 - acc.a ) * dcFlake( c1, p, rd, dt );
	return acc;
}
`;

/**
 * Swirl: a vortex. Space is twisted about the die-local y axis (more towards the centre),
 * mildly noise-warped, and cut into thin bands that alternate the two colours; each band is
 * limited to strips, so the result is flat ribbons spiralling round the core.
 */
const SWIRL = /* glsl */ `
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	float ang = 3.5 * ( ${f(INTERIOR.radius)} - length( p ) ) + 2.0 * p.y;
	float cs = cos( ang );
	float sn = sin( ang );
	vec3 q = vec3( cs * p.x - sn * p.z, p.y, sn * p.x + cs * p.z );
	q += 0.3 * ( vec3( dcNoise3( q * 1.6 ), dcNoise3( q * 1.6 + 5.2 ), dcNoise3( q * 1.6 + 9.4 ) ) - 0.5 );
	float f = q.x * 5.0 + 0.5;
	float g = ( q.y + 0.4 * q.z ) * 2.6;
	float band = fract( f );
	// a flat strip: thin across the bands (f), about half a period wide along g
	float ribbon = smoothstep( 0.22, 0.42, band ) * ( 1.0 - smoothstep( 0.58, 0.78, band ) )
		* ( 1.0 - smoothstep( 0.22, 0.32, abs( fract( g ) - 0.5 ) ) );
	vec3 col = uInteriorColors[ int( mod( floor( f ), 2.0 ) ) ];
	// the ribbon edges catch the light a little more than their middles
	float sheen = 0.75 + 0.5 * ( 1.0 - ribbon );
	float a = dcIAlpha( ribbon * mix( 12.0, 36.0, uInteriorDensity ) * dcIEdge( p ), dt );
	return vec4( col * ( dcILight * sheen + 0.3 ) * a, a );
}
`;

/** Nebula: fbm clouds mixing the two colours, plus a sparse hashed field of emissive stars. */
const NEBULA = /* glsl */ `
#define DC_STAR_CELLS ${f(INTERIOR.starCells)}
vec3 dcStars( vec3 cell, vec3 p, vec3 rd, float dt ) {
	float h = dcHash13( cell + 71.1 );
	if ( h < 0.86 ) return vec3( 0.0 );
	vec3 c = ( cell + ${cellPos('vec3( dcHash13( cell + 3.1 ), dcHash13( cell + 5.9 ), dcHash13( cell + 8.3 ) )')} ) / DC_STAR_CELLS;
	float t = dot( c - p, rd );
	if ( t < 0.0 || t >= dt || length( c ) > ${f(INTERIOR.radius - 0.04)} ) return vec3( 0.0 );
	vec3 q = p + rd * t - c;
	float g = exp( - dot( q, q ) * ${f(INTERIOR.starCells * INTERIOR.starCells * 90)} );
	return mix( vec3( 1.0 ), uInteriorColors[ 1 ], 0.3 ) * g * ( 2.0 + 6.0 * ( h - 0.86 ) / 0.14 );
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	float n = dcFbm3( p * 2.4 + 0.7, 3 );
	float mixT = dcNoise3( p * 1.6 + 13.0 );
	float cloud = smoothstep( 0.62 - 0.25 * uInteriorDensity, 0.9, n ) * dcIEdge( p );
	vec3 col = mix( uInteriorColors[ 0 ], uInteriorColors[ 1 ], smoothstep( 0.3, 0.7, mixT ) );
	float a = dcIAlpha( cloud * 14.0 + 0.4 * dcIEdge( p ), dt );
	vec3 rad = col * ( dcILight * ( 0.4 + 0.6 * n ) + 0.45 ) * a;
	vec3 c0 = floor( p * DC_STAR_CELLS );
	vec3 c1 = floor( ( p + rd * dt ) * DC_STAR_CELLS );
	rad += dcStars( c0, p, rd, dt );
	if ( any( notEqual( c0, c1 ) ) ) rad += dcStars( c1, p, rd, dt );
	return vec4( rad, a );
}
`;

/** Shape SDFs in unit space (the shape's size is ~1; dcSdShape scales it by shapeScale). */
const SHAPE_SDF = {
  star: /* glsl */ `
float dcSdStar( vec3 p ) {
	// 5-point star (iq's sdStar5) in the xy plane, inflated along z: the half-thickness is an
	// elliptical profile of the inner distance (sqrt), so the faces curve smoothly from a
	// rounded spine down to rim edges that meet the outline vertically (no flat facets).
	vec2 q = p.xy;
	const vec2 k1 = vec2( 0.809016994375, - 0.587785252292 );
	const vec2 k2 = vec2( - k1.x, k1.y );
	q.x = abs( q.x );
	q -= 2.0 * max( dot( k1, q ), 0.0 ) * k1;
	q -= 2.0 * max( dot( k2, q ), 0.0 ) * k2;
	q.x = abs( q.x );
	q.y -= 1.0;
	vec2 ba = 0.45 * vec2( - k1.y, k1.x ) - vec2( 0.0, 1.0 );
	float h = clamp( dot( q, ba ) / dot( ba, ba ), 0.0, 1.0 );
	float d2 = length( q - ba * h ) * sign( q.y * ba.x - q.x * ba.y );
	float halfT = 0.4 * sqrt( clamp( - d2 / 0.36, 0.0, 1.0 ) );
	return max( d2, 0.75 * ( abs( p.z ) - halfT ) ) - 0.03;
}
`,
  heart: /* glsl */ `
float dcSdHeart( vec3 p ) {
	// iq's 2D heart (xy, point down), inflated along z with the same elliptical profile as
	// the star (a pillowy heart).
	vec2 q = vec2( abs( p.x ), p.y + 0.55 ) * 1.1;
	float d2;
	if ( q.y + q.x > 1.0 ) d2 = length( q - vec2( 0.25, 0.75 ) ) - 0.353553;
	else {
		vec2 a = q - vec2( 0.0, 1.0 );
		vec2 b = q - 0.5 * max( q.x + q.y, 0.0 );
		d2 = sqrt( min( dot( a, a ), dot( b, b ) ) ) * sign( q.x - q.y );
	}
	d2 /= 1.1;
	float halfT = 0.38 * sqrt( clamp( - d2 / 0.4, 0.0, 1.0 ) );
	return max( d2, 0.75 * ( abs( p.z ) - halfT ) ) - 0.03;
}
`,
  skull: /* glsl */ `
float dcSmin( float a, float b, float k ) {
	float h = clamp( 0.5 + 0.5 * ( b - a ) / k, 0.0, 1.0 );
	return mix( b, a, h ) - k * h * ( 1.0 - h );
}
float dcSdSkull( vec3 p ) {
	// Simplified rounded skull facing +z: cranium, cheekbones and jaw blended, eye sockets
	// and a nose hole carved out.
	vec3 s = vec3( abs( p.x ), p.yz );
	float cranium = length( ( p - vec3( 0.0, 0.18, - 0.05 ) ) / vec3( 0.82, 0.78, 0.9 ) ) * 0.78 - 0.78;
	vec3 jb = abs( p - vec3( 0.0, - 0.45, 0.12 ) ) - vec3( 0.36, 0.2, 0.32 );
	float jaw = length( max( jb, 0.0 ) ) + min( max( jb.x, max( jb.y, jb.z ) ), 0.0 ) - 0.14;
	float cheek = length( s - vec3( 0.36, - 0.18, 0.32 ) ) - 0.2;
	float d = dcSmin( dcSmin( cranium, jaw, 0.22 ), cheek, 0.12 );
	float eyes = length( s - vec3( 0.28, - 0.02, 0.62 ) ) - 0.2;
	float nose = length( ( s - vec3( 0.0, - 0.26, 0.7 ) ) / vec3( 0.7, 1.2, 1.0 ) ) * 0.7 - 0.08;
	d = max( d, - eyes );
	d = max( d, - nose );
	return d;
}
`,
  sphere: /* glsl */ `
float dcSdSphere( vec3 p ) { return length( p ) - 1.0; }
`,
};
/** Column-major mat3 of R = Ry(b) * Rx(a), for GLSL. */
function rotation(a, b) {
  const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
  const r = [
    [cb, sb * sa, sb * ca],
    [0, ca, -sa],
    [-sb, cb * sa, cb * ca],
  ];
  return [0, 1, 2].flatMap((c) => [0, 1, 2].map((row) => r[row][c]));
}
/**
 * Shape orientation (uShapeRot, column-major). Dice: R = Ry(3.2) * Rx(0.95), picked by eye in
 * the Task 6 fix round so the flat star reads well on the dice resting face up in the
 * gallery; rolled dice show it at any angle anyway. Coin: the
 * shape's flat axis (z) along the coin's thin axis (local y), so the star lies in the caps
 * instead of being crushed edge-on by the 0.125 half-height.
 */
export const SHAPE_ROT = Object.freeze({
  die: Object.freeze(rotation(0.95, 3.2)),
  coin: Object.freeze(rotation(Math.PI / 2, 0)),
});
const SDF_NAME = { star: 'dcSdStar', heart: 'dcSdHeart', skull: 'dcSdSkull', sphere: 'dcSdSphere' };

/**
 * Suspended shape. Each segment end samples the SDF:
 * - inside: the hit is refined by bisection back over the segment and shaded (matte
 *   colors[0] with wrap diffuse from the key light and the inner light, a Blinn-Phong key
 *   highlight, SDF ambient occlusion and a colors[1] Fresnel rim), opaque, which ends the march;
 * - just outside (within DC_SHAPE_AA): the same shading at partial coverage, fading with the
 *   distance, so grazing rays that miss soften the silhouette instead of a hard, jittered edge;
 * - elsewhere: a colors[1] haze that thickens towards the surface (a glow halo).
 */
const shapeMarch = (fn) => /* glsl */ `
uniform mat3 uShapeRot;
#define DC_SHAPE_AA 0.012
float dcSdShape( vec3 p ) {
	return ${fn}( uShapeRot * p / ${f(INTERIOR.shapeScale)} ) * ${f(INTERIOR.shapeScale)};
}
vec3 dcShapeNormal( vec3 p ) {
	const vec2 k = vec2( 1.0, - 1.0 );
	const float e = 0.003;
	return normalize( k.xyy * dcSdShape( p + k.xyy * e ) + k.yyx * dcSdShape( p + k.yyx * e )
		+ k.yxy * dcSdShape( p + k.yxy * e ) + k.xxx * dcSdShape( p + k.xxx * e ) );
}
vec3 dcShapeShade( vec3 hp, vec3 rd ) {
	vec3 n = dcShapeNormal( hp );
	vec3 v = - rd;
	float wrap = clamp( ( dot( n, dcIKey ) + 0.4 ) / 1.4, 0.0, 1.0 );
	float spec = pow( max( dot( n, normalize( dcIKey + v ) ), 0.0 ), 36.0 );
	float ao = clamp( 0.45 + 0.55 * dcSdShape( hp + n * 0.05 ) / 0.05, 0.0, 1.0 );
	float rim = pow( 1.0 - max( dot( n, v ), 0.0 ), 3.0 );
	return uInteriorColors[ 0 ] * ( dcILight * ( 0.25 + 0.75 * wrap ) + 0.12 ) * ao
		+ ( uInteriorColors[ 0 ] + 0.5 ) * spec * 1.6
		+ uInteriorColors[ 1 ] * rim * ( 0.5 + dcILight );
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	vec3 e = p + rd * dt;
	float d = dcSdShape( e );
	if ( d < 0.0 ) {
		float lo = 0.0;
		float hi = dt;
		for ( int i = 0; i < 4; i ++ ) {
			float mid = 0.5 * ( lo + hi );
			if ( dcSdShape( p + rd * mid ) < 0.0 ) hi = mid;
			else lo = mid;
		}
		return vec4( dcShapeShade( p + rd * hi, rd ), 1.0 );
	}
	float a = dcIAlpha( mix( 0.2, 1.8, uInteriorDensity ) * exp( - d * 10.0 ) * dcIEdge( e ), dt );
	vec4 haze = vec4( uInteriorColors[ 1 ] * ( dcILight + 0.4 ) * a, a );
	if ( d < DC_SHAPE_AA ) {
		float cover = 0.7 * ( 1.0 - d / DC_SHAPE_AA );
		return vec4( dcShapeShade( e, rd ) * cover, cover ) + ( 1.0 - cover ) * haze;
	}
	return haze;
}
`;

/**
 * The march (inside the DICER_RESIN block, after dcRefracted). Skipped under the number
 * fill and where the refracted ray misses the march sphere; steps of equal length over the
 * ray's chord through it, start jittered per pixel (interleaved gradient noise) against
 * banding; front-to-back over premultiplied segments; stops at opacity ${INTERIOR.opaque}.
 */
export const INTERIOR_MARCH = /* glsl */ `
	if ( dcMask < 0.99 ) {
		vec3 dcIs = dcIScale();
		vec3 dcIo = vLocalPos * dcIs;
		vec3 dcIdv = dcRd * dcIs;
		float dcIdl = length( dcIdv );
		vec3 dcIrd = dcIdv / dcIdl;
		vec2 dcIt = dcIVolume( dcIo, dcIrd );
		if ( dcIt.y > dcIt.x ) {
			dcIKey = normalize( normalize( transpose( dcRm ) * uKeyLightDir ) * dcIs );
		#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
			dcILight = dcRup * envMapIntensity; // the resin block's up-facing sample
		#else
			dcILight = dcRup;
		#endif
			float dcIdt = ( dcIt.y - dcIt.x ) / float( DICER_STEPS );
			float dcIj = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
			vec4 dcIacc = vec4( 0.0 );
			for ( int dcIi = 0; dcIi < DICER_STEPS; dcIi ++ ) {
				float dcIt0 = dcIt.x + ( float( dcIi ) + dcIj - 1.0 ) * dcIdt;
				float dcIseg = dcIdt;
				if ( dcIt0 < dcIt.x ) { dcIseg -= dcIt.x - dcIt0; dcIt0 = dcIt.x; }
				vec3 dcIp = dcIo + dcIrd * dcIt0;
				vec4 dcIs4 = dcInterior( dcIp, dcIrd, dcIseg );
				dcIacc += ( 1.0 - dcIacc.a ) * dcIs4;
				if ( dcIacc.a >= ${INTERIOR.opaque.toFixed(2)} ) break;
			}
			// the resin between the entry point and the interior tints what it shows
			dcIacc.rgb *= pow( dcRbody, vec3( dcRk * dcIt.x / dcIdl ) );
			dcRefracted = dcRefracted * ( 1.0 - dcIacc.a ) + dcIacc.rgb;
		}
	}
`;

const TYPES = {
  liquid: () => LIQUID,
  glitter: () => GLITTER,
  swirl: () => SWIRL,
  nebula: () => NEBULA,
  shape: (shape) => {
    if (!SHAPE_SDF[shape]) throw new Error(`dicer: unknown interior shape "${shape}"`);
    return SHAPE_SDF[shape] + shapeMarch(SDF_NAME[shape]);
  },
};

/**
 * @param {'liquid'|'glitter'|'swirl'|'nebula'|'shape'} type
 * @param {'star'|'heart'|'skull'|'sphere'} [shape] for type 'shape' (default 'star')
 * @returns {{ pars: string, main: string }}
 */
export function interiorChunk(type, shape = 'star') {
  const build = Object.hasOwn(TYPES, type) ? TYPES[type] : null;
  if (!build) throw new Error(`dicer: unknown interior type "${type}"`);
  return { pars: [NOISE_GLSL, INTERIOR_PARS, build(shape)].join('\n'), main: INTERIOR_MARCH };
}

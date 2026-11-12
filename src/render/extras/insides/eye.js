/**
 * Eye inside: one glossy eyeball floating in the resin, its pupil always turned up (towards the
 * camera above the table) whatever face the die rests on.
 *
 * Geometry (canonical interior frame, in units of the eyeball radius EYE.radius): a sphere at
 * the centre, tested exactly against each march segment (ray / sphere, like glitter's flakes), so
 * it is found once whatever the step count. The pupil axis is dcIUp, the die's current world up.
 * A hit is opaque and ends the march, as shape's does; rays that pass within DC_EY_AA of the
 * silhouette get partial coverage at their closest approach, so the edge is soft, not jittered.
 *
 * Shading:
 * - the cornea: the cap above the limbus (EYE.limbus along the axis) is clear. The view ray is
 *   refracted into it and meets the iris, a flat disc recessed at the limbus plane, so the iris
 *   sits under glass and shifts with the view (parallax) like a real eye or a glass eye;
 * - the iris in colors[0]: radial fibres (stretched noise on the iris circle), a warmer, lighter
 *   inner zone with a wavy collarette, darker crypts, a dark ruff at the pupil edge and a darker
 *   limbal ring; density sets the pupil size (0 small ... 1 wide); the pupil is black;
 * - the sclera: white tinted by colors[1], faintly blotched, pinker and veined in red towards the
 *   back of the eyeball (thin noise ridges), with a soft grey shadow next to the limbus;
 * - light: wrapped key-light diffuse plus the inner light, a sharp wet highlight from the key
 *   light and a Fresnel reflection of the sky above the die (towards dcIUp).
 */
export const USES_NOISE = true; // dcNoise3

export const EYE = Object.freeze({
  /** eyeball radius (canonical frame; the march sphere is 0.62) */
  radius: 0.42,
  /** soft silhouette width (canonical frame), as shape's DC_SHAPE_AA */
  aa: 0.012,
  /** limbus height along the axis (unit sphere): the iris disc lies in this plane */
  limbus: 0.87,
  /** pupil radius as a share of the iris radius at density 0 and 1 */
  pupilMin: 0.26,
  pupilMax: 0.6,
  /** cornea refractive index (relative to the resin it floats in: a mild bend) */
  ior: 1.25,
});

const f = (x) => x.toFixed(4);

const BODY = /* glsl */ `
#define DC_EY_R ${f(EYE.radius)}
#define DC_EY_AA ${f(EYE.aa)}
#define DC_EY_LIMBUS ${f(EYE.limbus)}
#define DC_EY_IRIS ${f(Math.sqrt(1 - EYE.limbus * EYE.limbus))}
// the iris at unit-sphere point s (in the cornea): colour of the disc the refracted view meets
vec3 dcEyIris( vec3 s, vec3 rd, vec3 ax, vec3 t1, vec3 t2, vec3 lightCol, float keyDif ) {
	vec3 rr = refract( rd, s, ${f(1 / EYE.ior)} );
	float down = min( dot( rr, ax ), - 0.05 );
	vec3 xi = s + rr * ( ( dot( s, ax ) - DC_EY_LIMBUS ) / - down );
	vec2 q = vec2( dot( xi, t1 ), dot( xi, t2 ) ) / DC_EY_IRIS;
	float rho = length( q );
	vec2 dir = q / max( rho, 1e-4 );
	rho = min( rho, 1.0 );
	float pr = mix( ${f(EYE.pupilMin)}, ${f(EYE.pupilMax)}, uInteriorDensity );
	float u = clamp( ( rho - pr ) / ( 1.0 - pr ), 0.0, 1.0 ); // 0 at the pupil edge, 1 at the limbus
	// radial fibres: noise sampled round the iris circle (fine across, stretched along the radius)
	float fib = 0.55 * dcNoise3( vec3( dir * 22.0, u * 2.2 ) ) + 0.3 * dcNoise3( vec3( dir * 55.0, u * 4.0 + 7.0 ) )
		+ 0.15 * dcNoise3( vec3( dir * 9.0, u * 1.2 + 3.0 ) );
	// the collarette: a wavy ring about a third of the way out, splitting the warm inner zone from the outer
	float wav = dcNoise3( vec3( dir * 5.0, 11.0 ) );
	float cr = 0.3 + 0.12 * ( wav - 0.5 );
	float inner = 1.0 - smoothstep( cr - 0.05, cr + 0.05, u );
	float dcEyCd = ( u - cr ) / 0.06; // squared by hand: pow() of a negative base is undefined
	float coll = exp( - dcEyCd * dcEyCd );
	vec3 base = uInteriorColors[ 0 ];
	vec3 warm = min( base * vec3( 1.25, 1.0, 0.55 ) + vec3( 0.16, 0.1, 0.0 ), vec3( 1.0 ) );
	vec3 col = mix( base, warm, inner * 0.75 );
	// a little colour drift round the iris
	col *= 0.85 + 0.3 * dcNoise3( vec3( dir * 3.0, 21.0 ) );
	col *= 0.4 + 0.95 * fib;
	col = mix( col, min( warm * 1.25, vec3( 1.0 ) ), 0.35 * coll );
	// crypts: dark pits in the outer zone
	float crypt = smoothstep( 0.62, 0.78, dcNoise3( vec3( dir * 12.0, u * 5.0 + 31.0 ) ) ) * smoothstep( 0.25, 0.45, u ) * ( 1.0 - smoothstep( 0.8, 0.95, u ) );
	col *= 1.0 - 0.55 * crypt;
	// darker limbal ring and the pupillary ruff
	col *= mix( 1.0, 0.12, smoothstep( 0.78, 1.0, rho ) );
	float dcEyRd = u / 0.06;
	col = mix( col, base * 0.25 + vec3( 0.04, 0.025, 0.01 ), exp( - dcEyRd * dcEyRd ) * 0.8 );
	// the pupil: crisp black disc
	float pupil = 1.0 - smoothstep( pr - 0.02, pr + 0.008, rho );
	col = mix( col, vec3( 0.006 ), pupil );
	// lit through the cornea (keyDif: how far the key light is above the iris plane)
	return col * ( lightCol * ( 0.45 + 0.55 * keyDif ) + 0.06 );
}
vec3 dcEySclera( vec3 s, float c ) {
	vec3 col = mix( vec3( 0.94, 0.92, 0.89 ), uInteriorColors[ 1 ], 0.75 );
	col *= 0.9 + 0.1 * dcNoise3( s * 5.0 + 3.0 );
	float back = smoothstep( 0.5, - 0.7, c );
	col = mix( col, col * vec3( 1.0, 0.82, 0.78 ), 0.45 * back );
	// veins: thin ridges of warped noise, branching finer ones, denser towards the back
	vec3 w = s * 2.6 + 0.6 * vec3( dcNoise3( s * 3.0 + 9.0 ), dcNoise3( s * 3.0 + 17.0 ), dcNoise3( s * 3.0 + 29.0 ) );
	float v1 = 1.0 - smoothstep( 0.0, 0.035, abs( dcNoise3( w ) - 0.5 ) );
	float v2 = 1.0 - smoothstep( 0.0, 0.022, abs( dcNoise3( w * 2.7 + 5.0 ) - 0.5 ) );
	float vein = clamp( v1 * smoothstep( 0.6, - 0.4, c ) + 0.7 * v2 * smoothstep( 0.2, - 0.7, c ), 0.0, 1.0 );
	col = mix( col, vec3( 0.72, 0.1, 0.08 ), 0.85 * vein );
	// soft shadow round the cornea
	col *= mix( 1.0, 0.72, smoothstep( DC_EY_LIMBUS - 0.18, DC_EY_LIMBUS, c ) );
	return col;
}
// radiance of the eyeball at unit-sphere point s, seen along rd
vec3 dcEyShade( vec3 s, vec3 rd ) {
	vec3 dcEyAx = dcIUp;
	vec3 t1 = normalize( cross( dcEyAx, abs( dcEyAx.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) ) );
	vec3 t2 = cross( dcEyAx, t1 );
	float c = dot( s, dcEyAx );
	float keyDif = clamp( ( dot( s, dcIKey ) + 0.45 ) / 1.45, 0.0, 1.0 );
	vec3 lightCol = dcILight + 0.1;
	vec3 col;
	float corneaMix = smoothstep( DC_EY_LIMBUS - 0.008, DC_EY_LIMBUS + 0.004, c );
	vec3 sclera = dcEySclera( s, c ) * ( lightCol * ( 0.3 + 0.7 * keyDif ) + 0.08 );
	if ( corneaMix > 0.0 ) col = mix( sclera, dcEyIris( s, rd, dcEyAx, t1, t2, lightCol, clamp( dot( dcEyAx, dcIKey ) * 0.5 + 0.5, 0.0, 1.0 ) ), corneaMix );
	else col = sclera;
	// a round body: darker towards the silhouette
	float facing = max( dot( s, - rd ), 0.0 );
	col *= mix( 0.62, 1.0, smoothstep( 0.0, 0.7, facing ) );
	// wet surface: sharp key highlight, a broad sheen, a catchlight (the bright sky above, a
	// little towards the key light: seen from above it lands on the cornea) and the sky (Fresnel)
	vec3 r = reflect( rd, s );
	float rk = max( dot( r, dcIKey ), 0.0 );
	float rc = max( dot( r, normalize( dcEyAx + 0.5 * dcIKey ) ), 0.0 );
	float fres = 0.04 + 0.96 * pow( max( 1.0 - facing, 0.0 ), 5.0 );
	col += vec3( 1.0 ) * ( 2.5 * pow( rk, 160.0 ) + 0.12 * pow( rk, 16.0 ) + 1.6 * smoothstep( 0.994, 0.998, rc ) + 0.1 * pow( rc, 30.0 ) );
	col += dcILight * fres * 0.7 * smoothstep( - 0.2, 1.0, dot( r, dcEyAx ) );
	return min( col, vec3( 1.0 ) );
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	float b = dot( p, rd );
	float pp = dot( p, p );
	float m2 = max( pp - b * b, 0.0 ); // squared distance from the centre to the ray
	float m = sqrt( m2 );
	if ( m >= DC_EY_R + DC_EY_AA ) return vec4( 0.0 );
	float cover = 1.0 - smoothstep( DC_EY_R - DC_EY_AA, DC_EY_R + DC_EY_AA, m );
	float th;
	if ( pp < DC_EY_R * DC_EY_R ) {
		// the segment starts inside the eyeball: only a march that begins there (a full hit)
		if ( m >= DC_EY_R - DC_EY_AA ) return vec4( 0.0 );
		th = 0.0;
	} else if ( m < DC_EY_R ) th = - b - sqrt( DC_EY_R * DC_EY_R - m2 ); // entry point
	else th = - b; // a near miss: its closest approach
	if ( th < 0.0 || th >= dt ) return vec4( 0.0 );
	vec3 s = normalize( p + rd * th );
	return vec4( dcEyShade( s, rd ) * cover, cover );
}
`;

/** @returns {{ body: string }} the eye GLSL (every colour and the density are uniforms) */
export function eyeInside(_a) {
  return { body: BODY };
}

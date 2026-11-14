/**
 * Smoke inside: a wispy plume of ink or smoke rising through the resin, like a drop of ink in
 * water caught mid-curl.
 *
 * Shape (canonical interior frame, die-local y up; it turns with the die like swirl and nebula):
 * - a column rising from a soft source low in the volume, widening, drifting and twisting as it
 *   climbs, and thinning out towards the top (it dissipates);
 * - inside the column: thin tendrils. Space is stretched along y (so features rise), warped by
 *   two noise lookups (curl-like: the warp folds the tendrils into hooks), and cut by two ridged
 *   noises: the ridge of the first gives thin folded sheets, the second breaks them into
 *   strands. Not a uniform cloud (nebula) nor flat bands (swirl).
 * - the source: a soft, denser puff where the plume starts (the soft base).
 *
 * Colour: colors[0] in the dense cores of the tendrils, colors[1] where they are thin (their
 * edges) or face the key light, so the curls get lit edges. density sets the thickness.
 *
 * Cost: an early out outside the column, then four noise lookups per sample (nebula: fbm of
 * three octaves plus one, and its stars). The sheets' width grows with the segment length, so
 * they stay solid at the lowest marched tier instead of breaking into step noise.
 */
import { brighten, swap } from './live.js';

export const USES_NOISE = true; // dcNoise3

/** Plume geometry (canonical frame; the march sphere has radius 0.62). */
export const SMOKE = Object.freeze({
  /** source and top of the plume along y */
  base: -0.5,
  top: 0.6,
  /** column radius at the source and at the top */
  width: [0.1, 0.46],
});

const f = (x) => x.toFixed(4);

const BODY = /* glsl */ `
#define DC_SM_BASE ${f(SMOKE.base)}
#define DC_SM_SPAN ${f(SMOKE.top - SMOKE.base)}
vec2 dcSmRot( vec2 v, float a ) {
	float c = cos( a );
	float s = sin( a );
	return vec2( c * v.x - s * v.y, s * v.x + c * v.y );
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	float h = clamp( ( p.y - DC_SM_BASE ) / DC_SM_SPAN, 0.0, 1.0 ); // 0 at the source, 1 at the top
	// the column drifts sideways and widens as it rises
	vec2 drift = vec2( 0.13 * sin( p.y * 3.3 + 0.7 ), 0.11 * cos( p.y * 2.6 + 1.9 ) ) * h;
	vec2 xz = p.xz - drift;
	float w = mix( ${f(SMOKE.width[0])}, ${f(SMOKE.width[1])}, h );
	float r = length( xz );
	float env = ( 1.0 - smoothstep( 0.35 * w, w, r ) )
		* smoothstep( DC_SM_BASE - 0.08, DC_SM_BASE + 0.1, p.y ) * dcIEdge( p );
	if ( env <= 0.0 ) return vec4( 0.0 );
	// twisted about the column, more higher up: the tendrils curl round as they climb
	vec2 tw = dcSmRot( xz, 2.4 * h + 1.3 * p.y * h );
	// stretched along y (features rise), then folded by a two-lookup warp
	vec3 s = vec3( tw.x * 5.0, p.y * 1.7, tw.y * 5.0 );
	vec2 wv = vec2( dcNoise3( s * 0.7 + 3.1 ), dcNoise3( s * 0.7 + vec3( 17.7, 4.2, 9.3 ) ) ) - 0.5;
	s.xz += wv * 3.2;
	s.y += ( wv.x - wv.y ) * 1.4;
	// ridged noise: thin folded sheets, broken into strands by the second ridge
	float r1 = 1.0 - abs( 2.0 * dcNoise3( s ) - 1.0 );
	float r2 = 1.0 - abs( 2.0 * dcNoise3( s * vec3( 1.9, 0.8, 1.9 ) + vec3( 5.3, 0.0, 2.1 ) ) - 1.0 );
	// the sheet width grows with the segment length (solid at 16 steps), and higher up (spreading)
	float wid = clamp( 0.12 + dt * 2.0 + 0.08 * h, 0.12, 0.4 );
	float sheet = smoothstep( 1.0 - wid, 1.0, r1 );
	float strand = sheet * smoothstep( 0.25, 0.8, r2 );
	// the soft source: a denser, smoother puff at the base
	float puff = ( 1.0 - smoothstep( 0.0, 0.3, h ) ) * smoothstep( 0.2, 0.7, r2 * r1 );
	float dens = max( strand, 0.7 * puff );
	// a faint veil round the tendrils, so the plume holds together
	float veil = 0.06 * smoothstep( 0.3, 0.9, r1 );
	float thick = mix( 10.0, 70.0, uInteriorDensity ) * mix( 1.0, 0.5, h );
	float a = dcIAlpha( ( dens * thick + veil * thick ) * env, dt );
	// lit edges: the tendrils' thin rims and the side of the column facing the key light
	vec3 rad3 = vec3( xz.x, 0.0, xz.y ) / max( r, 1e-4 );
	float lit = clamp( dot( rad3, dcIKey ) * smoothstep( 0.2 * w, w, r ) * 0.6 + 0.5 * dcIKey.y + 0.2, 0.0, 1.0 );
	float thin = 1.0 - smoothstep( 0.3, 0.95, dens );
	vec3 col = mix( uInteriorColors[ 0 ], uInteriorColors[ 1 ], clamp( 0.15 + 0.75 * thin + 0.3 * lit * thin, 0.0, 1.0 ) );
	vec3 rad = col * ( dcILight * ( 0.4 + 0.6 * lit ) + 0.22 );
	return vec4( min( rad, vec3( 1.0 ) ) * a, a );
}
`;

/**
 * With insideMotion (`live`): the stretched sample space slides down over time, so the tendrils
 * rise through the column, about one feature per 4 s (uInteriorTime, MOTION_PARS in the pars).
 * The anchor sits mid-line (it has no leading indentation, so the inserted line takes the
 * template's tab and the anchor line starts at column 0); swap() throws where it is missing.
 */
const RISE = 's.y -= 0.25 * uInteriorTime;\n';
const RISE_AT = 'vec2 wv = ';

/**
 * @returns {{ body: string }} the smoke GLSL (every colour and the density are uniforms); `live`
 * also brightens with the inside flare (live.js brighten)
 */
export function smokeInside(_a, live = false) {
  return { body: live ? brighten(swap(BODY, RISE_AT, RISE + RISE_AT), 'Sm') : BODY };
}

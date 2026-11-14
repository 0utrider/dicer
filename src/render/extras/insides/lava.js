/**
 * Lava inside: a slow glowing body under a dark crust that cracks and reseals.
 *
 * Shape (canonical interior frame, heights along dcIUp, the die's world up, so the lava pools at
 * the bottom whichever way the die lies):
 * - a pool filling the volume up to a gently heaving surface (density sets the fill), kept just
 *   inside the march sphere so its flanks are crusted too;
 * - a crust shell along the pool's surface and flanks, thick enough to be hit by a sample at the
 *   lowest marched tier; under it the molten body, opaque and glowing;
 * - cracks in the crust: thin lines from a ridged noise (two lookups), each opening and resealing
 *   over about 3 s, out of phase across the crust (the phase comes from the churn noise).
 *
 * Colour: the molten body runs from colors[1] (cool edge) to colors[0] (hot core) with a slow
 * churn (a third, large noise rising very slowly); the crust is the lava's colour darkened (lit a
 * little by the key light) and glows warm at the lips of the cracks.
 *
 * Motion: DC_LA_T is uInteriorTime with insideMotion, the constant 0 without (a still frame, no
 * uniform read). DC_LA_FLARE is uInteriorFlare (0..1, roll effects: effects/library/inside-flare.js)
 * with insideMotion, the constant 0 without: the cracks all open and widen (lava cracks wide).
 *
 * Cost: an early out outside the pool, then three noise lookups per sample; the first opaque
 * sample usually ends the march.
 */
export const USES_NOISE = true; // dcNoise3

/** Pool geometry (canonical frame; the march sphere has radius 0.62). */
export const LAVA = Object.freeze({
  /** surface height along up at density 0 and 1 */
  fill: [-0.34, 0.34],
  /** the pool's flanks stop this far from the centre (inside the edge fade) */
  wall: 0.55,
  /** crack cycle, seconds */
  period: 3,
});

const f = (x) => x.toFixed(4);

const BODY = /* glsl */ `
#define DC_LA_WALL ${f(LAVA.wall)}
#define DC_LA_W ${f((2 * Math.PI) / LAVA.period)}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	float y = dot( p, dcIUp );
	float r = length( p );
	// geometric reject before any noise: above the highest heave or outside the flanks
	float surf0 = mix( ${f(LAVA.fill[0])}, ${f(LAVA.fill[1])}, uInteriorDensity );
	float side = DC_LA_WALL - r;
	if ( min( surf0 + 0.04 - y, side ) <= 0.0 ) return vec4( 0.0 );
	// where this ray entered the pool's bounding volume: back along rd to the plane of the highest
	// heave or the flank sphere, whichever is nearer. Every sample of a ray gets the same point, and
	// every crack and phase value is read there, so the march jitter does not move them (no hatching)
	float top0 = surf0 - y;
	float ru = dot( rd, dcIUp );
	float sTop = ru < - 0.05 ? ( top0 + 0.04 ) / - ru : 1e3;
	float b = dot( p, rd );
	float sSide = b + sqrt( max( b * b - r * r + DC_LA_WALL * DC_LA_WALL, 0.0 ) );
	vec3 ps = p - rd * min( sTop, sSide );
	// the churn: large slow blobs (the surface's heave, the crack phase, the body's heat)
	float n1 = dcNoise3( ps * 2.6 - dcIUp * ( DC_LA_T * 0.05 ) + 4.3 );
	// depth into the lava: under the heaving surface and inside the flanks
	float depth = min( top0 + 0.08 * ( n1 - 0.5 ), side );
	if ( depth <= 0.0 ) return vec4( 0.0 );
	// the crust shell: at least one sample deep at 16 steps
	float th = max( 0.06, dt * 1.5 );
	float shell = 1.0 - smoothstep( th, 1.6 * th, depth );
	// cracks: ridged noise lines, each opening and resealing over the cycle, out of phase
	float n2 = dcNoise3( ps * 7.0 + 1.9 );
	float n3 = dcNoise3( ps * 15.0 - 5.2 );
	float ridge = 1.0 - abs( 2.0 * mix( n2, n3, 0.3 ) - 1.0 );
	// the inside flare cracks it wide: every crack opens, up to twice as wide
	float open = max( 0.5 + 0.5 * sin( DC_LA_T * DC_LA_W + n1 * 9.0 ), DC_LA_FLARE );
	float wid = mix( 0.02, 0.14, open ) * ( 1.0 + DC_LA_FLARE ) + dt * 0.3;
	float crack = smoothstep( 1.0 - wid, 1.0 - 0.35 * wid, ridge );
	float crust = shell * ( 1.0 - crack );
	// the molten body: cool edge to hot core with the churn, brightest in the open cracks
	float heat = 0.5 + 0.5 * smoothstep( 0.3, 0.8, n1 );
	vec3 molten = mix( uInteriorColors[ 1 ], uInteriorColors[ 0 ], heat ) * ( 0.75 + 0.5 * heat + 0.25 * open * shell );
	// the crust: the lava's colour darkened, lit a little by the key, warm at the crack lips
	float lip = smoothstep( 1.0 - 3.0 * wid, 1.0 - wid, ridge );
	float lit = 0.3 + 0.7 * max( dot( dcIUp, dcIKey ), 0.0 );
	vec3 rock = uInteriorColors[ 1 ] * ( 0.025 *( dcILight * lit + 0.25 ) + 0.4 * lip * lip );
	vec3 col = mix( molten, rock, crust );
	float a = dcIAlpha( 70.0, dt );
	return vec4( min( col, vec3( 1.0 ) ) * a, a );
}
`;

const STILL = '#define DC_LA_T 0.0\n#define DC_LA_FLARE 0.0\n';
const LIVE = '#define DC_LA_T uInteriorTime\n#define DC_LA_FLARE uInteriorFlare\n';

/**
 * @returns {{ body: string }} the lava GLSL (every colour and the density are uniforms); `live`
 * (insideMotion) reads time from the motion uniform, otherwise it is the constant 0
 */
export function lavaInside(_a, live = false) {
  return { body: (live ? LIVE : STILL) + BODY };
}

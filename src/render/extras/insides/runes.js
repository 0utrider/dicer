import { CARD_AXIS, upFrame, upFrameGLSL } from './frame.js';
import { swap } from './live.js';

/**
 * Magic circle inside (plan 3b): a glowing arcane circle of runes cast flat in the resin.
 *
 * Card: like dragon.js, the circle lies on a card (a disc of radius mix(RUNES.radius, density) in
 * the canonical frame) through the centre, facing the die's current up (dcIUp), so the camera
 * above the table sees it face-on whatever face the die rests on. The card is tested exactly
 * against each march segment (a plane hit, then the 2D circle at the hit point), so it counts once
 * whatever the step count. Its in-plane frame is dragon.js's continuous one: n = dcIUp, t1 = the
 * constant RUNES.axis projected off n (its .zxy where they are parallel), t2 = n x t1. Right-handed,
 * so the runes are never mirrored, and with no switch on any component of up the circle turns
 * smoothly while the die tumbles (runesFrame, tested).
 *
 * The 2D circle (unit card, every distance in card units, anti-aliased by one width that grows at
 * grazing angles; no derivatives):
 * - an outer double ring (a bold ring and a fine one inside it) and a fine inner ring, colors[0];
 * - between the fine rings a band of RUNES.glyphs rune glyphs in even sectors, tops outward, with
 *   a dot between neighbours. Each glyph is a stem plus 1-3 branches picked (hashed in JS, all
 *   different) from RU_STROKES, straight strokes between the points of a 3x3 grid, so every glyph
 *   differs but they read as one angular script. Only the sector's own glyph is evaluated, and
 *   only inside the band;
 * - the inner sigil, colors[1]: a hexagram (two interlaced triangles) whose points touch the inner
 *   ring, a small ring at its heart and a centre dot;
 * - a faint glow over every stroke (an exponential bloom) and a faint fill of the disc.
 * Emissive: the strokes radiate colors[0] x RUNES.glow (the sigil colors[1] x RUNES.glow); they are
 * not lit by the key light, so the circle reads in the dark. A soft volumetric halo glows above and
 * below the plane (the exact integral along the segment of an exponential falloff with the height
 * over the plane, inside the circle's radius only). Every segment is clamped to <= 1 per channel
 * after the emission is added.
 */
export const USES_NOISE = false;

/**
 * Card radius (canonical) at density 0 and 1; the frame's axis before projection (dragon.js's: the
 * direction furthest from every die's resting up and the coin's caps); the anti-alias width (card
 * units) face-on and its growth at grazing angles; the emission gain; the glyph count; the rings
 * (centre radius, half width: bold outer, fine outer, fine inner); the band the glyphs are
 * evaluated in; the glyph half size (tangential, radial) and stroke half width; the sigil (star
 * circumradius, heart ring radius and half width, centre dot radius); the bloom length; the halo
 * (height falloff over R, gain, the floor of |cos| against the plane that bounds it edge-on); the
 * glyph hash seed.
 */
export const RUNES = Object.freeze({
  radius: Object.freeze([0.44, 0.6]),
  axis: CARD_AXIS,
  aa: Object.freeze([0.012, 0.03]),
  glow: 1.6,
  glyphs: 14,
  rings: Object.freeze([Object.freeze([0.9, 0.013]), Object.freeze([0.855, 0.005]), Object.freeze([0.625, 0.006])]),
  band: Object.freeze([0.619, 0.861]),
  glyphSize: Object.freeze([0.055, 0.071]),
  stroke: 0.011,
  sigil: Object.freeze({ star: 0.625, ring: 0.2, ringW: 0.006, dot: 0.035 }),
  bloom: 0.03,
  halo: Object.freeze({ width: 0.09, gain: 1.0, floor: 0.1 }),
  seed: 1213,
});

/** The stem every glyph has, and the branches a glyph picks from: [from, to] on the 3x3 grid (x along the band, y outward). */
export const RU_STEM = Object.freeze([
  [0, -1],
  [0, 1],
]);
export const RU_STROKES = Object.freeze([
  [[0, 1], [1, 0]],
  [[0, 1], [-1, 0]],
  [[0, 0], [1, 1]],
  [[0, 0], [-1, 1]],
  [[0, 0], [1, -1]],
  [[0, 0], [-1, -1]],
  [[0, -1], [1, 0]],
  [[0, -1], [-1, 0]],
  [[0, 1], [1, 1]],
  [[-1, 1], [1, -1]],
]);

/** The glyphs: one bit mask over RU_STROKES per sector, 1-3 branches each, all different (hashed). */
export function runeGlyphs() {
  let s = RUNES.seed >>> 0;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const bits = (m) => [...RU_STROKES.keys()].filter((k) => (m >> k) & 1).length;
  const out = [];
  while (out.length < RUNES.glyphs) {
    const u = rnd();
    const nb = u < 0.2 ? 1 : u < 0.7 ? 2 : 3;
    let m = 0;
    while (bits(m) < nb) m |= 1 << Math.floor(rnd() * RU_STROKES.length);
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * The GLSL frame in JS (for tests): up = the die's up in the canonical frame (unit). Returns
 * { n, t1, t2 } (canonical): the card's normal and its in-plane axes (x and y of the unit card).
 */
export function runesFrame(up) {
  const { n, t1, t2 } = upFrame(up, RUNES.axis);
  return { n, t1, t2 };
}

const f = (x) => x.toFixed(4);
const v2 = (p) => `vec2( ${f(p[0])}, ${f(p[1])} )`;
const list = (type, name, xs, fmt) => `const ${type} ${name}[ ${xs.length} ] = ${type}[ ${xs.length} ]( ${xs.map(fmt).join(', ')} );`;

function body() {
  const { glyphs: N, rings, band, glyphSize: G, stroke, sigil, bloom, halo, glow } = RUNES;
  const g = (p) => [p[0] * G[0], p[1] * G[1]];
  const rc = (band[0] + band[1]) / 2;
  // the dot between neighbouring glyphs, in a glyph's local frame (on the band's middle, half a sector off)
  const sep = [rc * Math.sin(Math.PI / N), rc * Math.cos(Math.PI / N) - rc];
  // the hexagram: two triangles, points up and down along the card's y
  const star = [0, 1, 2, 3, 4, 5].map((k) => [sigil.star * Math.sin((k * Math.PI) / 3), sigil.star * Math.cos((k * Math.PI) / 3)]);
  const tri = [
    [star[0], star[2]],
    [star[2], star[4]],
    [star[4], star[0]],
    [star[1], star[3]],
    [star[3], star[5]],
    [star[5], star[1]],
  ];
  const [r0, r1, r2] = rings;
  return /* glsl */ `
#define DC_RU_N ${N}
#define DC_RU_NS ${RU_STROKES.length}
${list('int', 'DC_RU_GLYPH', runeGlyphs(), String)}
${list('vec2', 'DC_RU_SA', RU_STROKES.map((s) => g(s[0])), v2)}
${list('vec2', 'DC_RU_SB', RU_STROKES.map((s) => g(s[1])), v2)}
${list('vec2', 'DC_RU_SIGA', tri.map((s) => s[0]), v2)}
${list('vec2', 'DC_RU_SIGB', tri.map((s) => s[1]), v2)}
// distance from p to the segment a-b
float dcRuSeg( vec2 p, vec2 a, vec2 b ) {
	vec2 pa = p - a;
	vec2 ba = b - a;
	float h = clamp( dot( pa, ba ) / max( dot( ba, ba ), 1e-8 ), 0.0, 1.0 );
	return length( pa - ba * h );
}
// the circle on the unit card: (colors[0] emission weight, colors[1] emission weight, coverage)
vec3 dcRuCircle( vec2 uv, float aa ) {
	float r = length( uv );
	// the rings: bold and fine outside, fine inside the band
	float dR = min( min( abs( r - ${f(r0[0])} ) - ${f(r0[1])}, abs( r - ${f(r1[0])} ) - ${f(r1[1])} ), abs( r - ${f(r2[0])} ) - ${f(r2[1])} );
	// the runes: only the glyph of the sector the point is in, only inside the band
	float dG = 1e9;
	if ( r > ${f(band[0])} && r < ${f(band[1])} ) {
		float ang = atan( uv.y, abs( uv.x ) < 1e-6 ? 1e-6 : uv.x ); // (never atan( 0, 0 ))
		float fi = mod( floor( ang * ${f(N / (2 * Math.PI))} + 0.5 ), ${f(N)} );
		float ac = fi * ${f((2 * Math.PI) / N)};
		vec2 er = vec2( cos( ac ), sin( ac ) );
		// the glyph's frame: x along the band, y outward from the band's middle (tops outward)
		vec2 lp = vec2( dot( uv, vec2( - er.y, er.x ) ), dot( uv, er ) - ${f(rc)} );
		int m = DC_RU_GLYPH[ min( int( fi + 0.5 ), DC_RU_N - 1 ) ];
		dG = dcRuSeg( lp, ${v2(g(RU_STEM[0]))}, ${v2(g(RU_STEM[1]))} );
		for ( int k = 0; k < DC_RU_NS; k ++ )
			if ( ( ( m >> k ) & 1 ) == 1 ) dG = min( dG, dcRuSeg( lp, DC_RU_SA[ k ], DC_RU_SB[ k ] ) );
		dG -= ${f(stroke)};
		// a dot between neighbouring glyphs
		dG = min( dG, length( vec2( abs( lp.x ), lp.y ) - ${v2(sep)} ) - ${f(stroke * 1.3)} );
	}
	// the sigil: a hexagram, a small ring at its heart and a centre dot
	float dS = 1e9;
	if ( r < ${f(sigil.star + 0.06)} ) {
		for ( int k = 0; k < 6; k ++ ) dS = min( dS, dcRuSeg( uv, DC_RU_SIGA[ k ], DC_RU_SIGB[ k ] ) );
		dS -= ${f(stroke * 0.8)};
		dS = min( dS, abs( r - ${f(sigil.ring)} ) - ${f(sigil.ringW)} );
		dS = min( dS, r - ${f(sigil.dot)} );
	}
	float d0 = min( dR, dG );
	float k0 = 1.0 - smoothstep( - aa, aa, d0 );
	float k1 = 1.0 - smoothstep( - aa, aa, dS );
	// a soft bloom round every stroke, fading out before the card's edge; a faint disc fill
	float edge = 1.0 - smoothstep( 0.93, 1.0, r );
	// (the disc also dims what is behind it a little, so the glow reads on clear resin too)
	float fill = 1.0 - smoothstep( ${f(r0[0] - 0.01)}, ${f(r0[0] + 0.01)}, r );
	float e0 = k0 + ( 0.2 * exp( - max( d0, 0.0 ) / ${f(bloom)} ) + 0.04 * fill ) * edge;
	float e1 = k1 + 0.2 * exp( - max( dS, 0.0 ) / ${f(bloom)} ) * edge;
	return vec3( e0, e1, max( 0.85 * max( k0, k1 ), 0.3 * fill ) );
}
// the halo: the segment's emission weight, the integral along it of exp( - |h| / w ) (h: the height
// over the plane), inside the circle's radius only; times max( |cos|, floor ) against the plane, so
// it stays bounded when the ray runs along the plane
float dcRuHalo( vec3 p, vec3 rd, float dt, vec3 n, float dn, float h0, float R ) {
	float h1 = h0 + dn * dt;
	bool cross0 = h0 * h1 <= 0.0;
	// the segment's point nearest the plane decides whether it is over the circle
	vec3 qn = cross0 && abs( dn ) >= 1e-4 ? p - rd * ( h0 / dn ) : ( abs( h0 ) < abs( h1 ) ? p : p + rd * dt );
	float rr = length( qn - dot( qn, n ) * n ) / R;
	if ( rr >= 0.97 ) return 0.0;
	float w = ${f(halo.width)} * R;
	// F( h ) = sign( h ) w ( 1 - exp( - |h| / w ) ), the antiderivative of exp( - |h| / w ) in h
	float F0 = ( h0 < 0.0 ? - w : w ) * ( 1.0 - exp( - abs( h0 ) / w ) );
	float F1 = ( h1 < 0.0 ? - w : w ) * ( 1.0 - exp( - abs( h1 ) / w ) );
	float hm = cross0 ? 0.0 : min( abs( h0 ), abs( h1 ) );
	float I = min( dt * exp( - hm / w ), abs( F1 - F0 ) / max( abs( dn ), 1e-4 ) );
	float mask = ( 1.0 - smoothstep( 0.8, 0.97, rr ) ) * ( 0.6 + 0.4 * smoothstep( 0.4, 0.9, rr ) );
	return ${f(halo.gain)} * I * max( abs( dn ), ${f(halo.floor)} ) / R * mask;
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	vec3 n = dcIUp;
	float dn = dot( rd, n );
	float h0 = dot( p, n );
	float R = mix( ${f(RUNES.radius[0])}, ${f(RUNES.radius[1])}, uInteriorDensity );
	// emissive: not lit by the key light
	vec3 dcRuG0 = uInteriorColors[ 0 ] * ${f(glow)};
	vec3 dcRuG1 = uInteriorColors[ 1 ] * ${f(glow)};
	vec4 acc = vec4( 0.0 );
	// the halo above and below the plane
	float hal = dcRuHalo( p, rd, dt, n, dn, h0, R );
	acc.rgb += dcRuG0 * hal;
	acc.a = clamp( 0.3 * hal, 0.0, 1.0 );
	// the card through the centre, facing the die's up
	float dcRuDn = abs( dn ) < 1e-4 ? 1e-4 : dn;
	float t = - h0 / dcRuDn;
	if ( abs( dn ) >= 1e-4 && t >= 0.0 && t < dt ) {
		vec3 q = p + rd * t;
		if ( dot( q, q ) < R * R ) {
			// the continuous up frame (runesFrame in JS): t1 = RUNES.axis projected off n (another
			// axis where they are parallel), t2 = n x t1 (right-handed, never mirrored)
			vec3 dcRuN = n;
			vec3 dcRuT1;
			vec3 dcRuT2;
${upFrameGLSL('dcRu', `vec3( ${RUNES.axis.map(f).join(', ')} )`)}
			vec2 uv = vec2( dot( q, dcRuT1 ), dot( q, dcRuT2 ) ) / R;
			float aa = ${f(RUNES.aa[0])} + ${f(RUNES.aa[1])} * ( 1.0 - abs( dn ) );
			vec3 c = dcRuCircle( uv, aa );
			acc.rgb += dcRuG0 * c.x + dcRuG1 * c.y;
			acc.a = c.z + ( 1.0 - c.z ) * acc.a;
		}
	}
	return vec4( min( acc.rgb, vec3( 1.0 ) ), clamp( acc.a, 0.0, 1.0 ) );
}
`;
}

/**
 * @param {object} _a normalized appearance whose interior is type 'shape' with shape runes
 * @returns {{ body: string }} the circle's GLSL (every colour and the density are uniforms)
 */
export function runesInside(_a, live = false) {
  const b = body();
  if (!live) return { body: b };
  // insideMotion: the glow pulses 0.7 .. 1.0 over 2.5 s (uInteriorTime, MOTION_PARS in the pars)
  const g = f(RUNES.glow);
  const g0 = `vec3 dcRuG0 = uInteriorColors[ 0 ] * ${g};`;
  const g1 = `vec3 dcRuG1 = uInteriorColors[ 1 ] * ${g};`;
  const pulse = 'float dcRuPulse = 0.85 + 0.15 * sin( uInteriorTime * 2.5133 );\n\t';
  return { body: swap(swap(b, g0, `${pulse}${g0.slice(0, -1)} * dcRuPulse;`), g1, `${g1.slice(0, -1)} * dcRuPulse;`) };
}

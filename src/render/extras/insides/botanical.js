/**
 * Botanical inside: a pressed flower, a cushion of moss or a butterfly cast in the resin, like
 * the real resin dice with dried specimens. One program for the three kinds: uBoKind (0 flower,
 * 1 moss, 2 butterfly, the appearance.js INCLUSIONS order) selects a branch, and as a uniform
 * the branch is coherent.
 *
 * Flower and butterfly: "cards", flat specimens floating level (CARDS: three flowers, or a large
 * and two small butterflies). Each card's centre is fixed in die-local space; its normal is the
 * die's current world up (dcIUp, set before the march loop, as the eye's pupil axis) tilted by a
 * small fixed tilt (TILT, under 25 degrees), so the camera above the table sees the specimens
 * face-on whatever face the die rests on. The cards of a kind share that normal: parallel cards
 * never cross, whatever the die's rotation. A card's in-plane orientation is a die-local
 * reference axis (ref) projected into its plane, so it turns with the die (and only spins round
 * where up meets that axis; a fallback axis takes over exactly there).
 * Each card is tested exactly against the march segment (plane hit, then the card's 2D shape at
 * the hit point), like glitter's flakes and foil's shards, so it counts once whatever the step
 * count and never flickers between tiers. Hits within one segment are composited in depth order.
 * The shape's edge is anti-aliased by a fixed width in card units, wider at grazing angles (no
 * derivatives: the march is non-uniform control flow).
 * - flower: 5 or 6 rounded, slightly wavy petals in colors[0] (deeper at the base, paler and
 *   more translucent at the tips, with fine streaks and a crease between petals), cupped a
 *   little, round a domed, granular centre in colors[1] with a ring of stamens;
 * - butterfly: forewings broadening to the apex and rounder hindwings in colors[0] (brighter
 *   towards the body, with a view-dependent sheen), colors[1] veins, a dark margin with pale
 *   dots, a dark apex and eyespots; a thin dark segmented body with a head and clubbed antennae.
 *   The wings are raised a little (a shallow V), so the two sides catch the light differently.
 * Cards are two-sided, lit by the inner light (dcILight) and the key light with a wrap, and the
 * key light shines through the thin tissue from behind (translucency, strongest at the edges,
 * where the cards are also a little see-through).
 *
 * Moss: not a card. A soft cushion settled just below the centre (along -dcIUp, so it sits
 * low whatever face the die rests on): a squashed dome with a flat base and a gently undulating
 * surface, its outer shell made of many fine strands radiating from the dome (noise fine across,
 * stretched along the radius) that thin out outwards; colors[0], darker in the hollows and
 * inside, with speckled colors[1] strand tips. Long segments are sub-sampled inside the cushion
 * so the fuzz survives the lowest marched tier.
 *
 * density sets the card size (flower, butterfly) or the cushion size (moss).
 */
import { brighten } from './live.js';

export const USES_NOISE = true; // dcNoise3, dcFbm3, dcHash13

/** The inclusion kinds in uBoKind order (appearance.js INCLUSIONS; a local copy, pinned by a test). */
export const BO_KINDS = Object.freeze(['flower', 'moss', 'butterfly']);

/**
 * The cards (canonical interior frame; the march sphere has radius 0.62): die-local centre,
 * in-plane reference axis (ref: the flower's rotation, the butterfly's body), size share and a
 * variant (flower: < 0.5 five petals, else six). Flowers 0-2, butterflies 3-5. The refs avoid
 * the dice's face normals (where a card would spin round). The large butterfly sits a little off
 * the centre, so the number on the top face does not hide its body. Tests: inside the march sphere.
 */
export const CARDS = Object.freeze([
  { c: [0.03, 0.06, 0.04], ref: [0.83, 0.21, 0.52], size: 1, v: 0.2 },
  { c: [-0.2, -0.25, -0.05], ref: [0.18, 0.43, 0.88], size: 0.55, v: 0.7 },
  { c: [0.1, 0.33, -0.1], ref: [-0.61, 0.25, 0.75], size: 0.5, v: 0.35 },
  { c: [0.09, 0.0, -0.1], ref: [0.27, 0.36, 0.89], size: 1, v: 0 },
  { c: [-0.24, -0.22, 0.08], ref: [0.92, -0.12, 0.37], size: 0.4, v: 0 },
  { c: [0.2, 0.26, 0.16], ref: [-0.35, 0.22, 0.91], size: 0.32, v: 0 },
]);

/**
 * The shared tilt of each kind's cards off the die's up, in the up frame built from the first
 * card's ref (tan of the angle along each axis): flower about 12, butterfly about 10 degrees.
 */
export const TILT = Object.freeze({ flower: [0.18, 0.12], butterfly: [-0.1, 0.14] });

/** Card radius (canonical) at density 0 and 1, before the card's size share. */
export const CARD_RADIUS = Object.freeze({ flower: [0.28, 0.44], butterfly: [0.32, 0.46] });

/**
 * The moss cushion: its base this far below the centre along up, its radius at density 0 and 1
 * (canonical), and its squash (height = radius / squash).
 */
export const MOSS = Object.freeze({ drop: 0.3, radius: [0.32, 0.46], squash: 1.6 });

const f = (x) => x.toFixed(4);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vec3 = (v) => `vec3( ${v.map(f).join(', ')} )`;
const REFS = CARDS.map((x) => norm(x.ref));
/** a projected into the plane of unit normal n, unit (the GLSL dcBoPerp): alt where a is along n */
function perp(a, n) {
  let t = a.map((x, i) => x - dot(a, n) * n[i]);
  if (Math.hypot(...t) < 1e-3) {
    const alt = [a[2], a[0], a[1]];
    t = alt.map((x, i) => x - dot(alt, n) * n[i]);
  }
  return norm(t);
}

/**
 * The JS mirror of the cards' GLSL frames for an up direction (unit, canonical frame): per card
 * its centre, the shared unit normal and the in-plane axes t1, t2. kind: 'flower' or 'butterfly'.
 */
export function cardFrames(up, kind) {
  const base = kind === 'butterfly' ? 3 : 0;
  const b1 = perp(REFS[base], up);
  const b2 = cross(up, b1);
  const [ja, jb] = TILT[kind];
  const n = norm(up.map((x, i) => x + ja * b1[i] + jb * b2[i]));
  return [0, 1, 2].map((k) => {
    const t1 = perp(REFS[base + k], n);
    return { c: CARDS[base + k].c, n, t1, t2: cross(n, t1), size: CARDS[base + k].size };
  });
}

const arr = (type, xs) => `${type}[ ${xs.length} ]( ${xs.join(', ')} )`;
const N = CARDS.length;

const BODY = /* glsl */ `
uniform int uBoKind; // 0 flower, 1 moss, 2 butterfly
const vec3 DC_BO_C[ ${N} ] = ${arr('vec3', CARDS.map((x) => vec3(x.c)))};
const vec3 DC_BO_REF[ ${N} ] = ${arr('vec3', REFS.map(vec3))};
const float DC_BO_S[ ${N} ] = ${arr('float', CARDS.map((x) => f(x.size)))};
const float DC_BO_V[ ${N} ] = ${arr('float', CARDS.map((x) => f(x.v)))};
// a projected into the plane of unit normal n, unit; a fallback axis where a is along n
vec3 dcBoPerp( vec3 a, vec3 n ) {
	vec3 t = a - dot( a, n ) * n;
	if ( dot( t, t ) < 1e-6 ) {
		vec3 alt = a.zxy;
		t = alt - dot( alt, n ) * n;
	}
	return normalize( t );
}
mat2 dcBoRot( float a ) { return mat2( cos( a ), sin( a ), - sin( a ), cos( a ) ); }
float dcBoSq( float x ) { return x * x; }
// approximate signed distance to the ellipse of radii r (the value over its gradient), so edges
// anti-alias evenly all round
float dcBoEll( vec2 p, vec2 r ) {
	float k0 = length( p / r );
	float k1 = length( p / ( r * r ) );
	return k0 * ( k0 - 1.0 ) / max( k1, 1e-5 );
}
// a pressed flower on the unit card: albedo and coverage; ex = (in-plane normal tilt, translucency)
vec4 dcBoFlower( vec2 uv, float aa, float v, out vec3 ex ) {
	float k = v < 0.5 ? 5.0 : 6.0;
	float W = v < 0.5 ? 0.33 : 0.28; // petal half-width
	float r = length( uv );
	vec2 dir = uv / max( r, 1e-4 );
	float sec = 6.2831853 / k;
	float fa = atan( uv.y, abs( uv.x ) < 1e-6 ? 1e-6 : uv.x ) / sec; // (never atan( 0, 0 ))
	float ia = floor( fa + 0.5 ); // the nearest petal and the next nearest
	float ib = ia + ( fa > ia ? 1.0 : - 1.0 );
	vec2 pa = dcBoRot( - ia * sec ) * uv;
	vec2 pb = dcBoRot( - ib * sec ) * uv;
	// petals: ellipses along x, broader towards the tip (obovate), with a wavy edge
	float ga = W * ( 0.5 + 0.65 * clamp( pa.x / 0.95, 0.0, 1.0 ) );
	float gb = W * ( 0.5 + 0.65 * clamp( pb.x / 0.95, 0.0, 1.0 ) );
	float da = dcBoEll( vec2( pa.x - 0.52, pa.y ), vec2( 0.43, ga ) );
	float db = dcBoEll( vec2( pb.x - 0.52, pb.y ), vec2( 0.43, gb ) );
	float wav = 0.035 * ( dcNoise3( vec3( uv * 6.0, v * 13.0 ) ) - 0.5 );
	da += wav;
	db += wav;
	// five-petal flowers: a small notch at each tip
	if ( k < 5.5 ) {
		da = max( da, 0.075 - length( pa - vec2( 0.99, 0.0 ) ) );
		db = max( db, 0.075 - length( pb - vec2( 0.99, 0.0 ) ) );
	}
	float d = min( da, db );
	vec2 pp = da < db ? pa : pb;
	float g = da < db ? ga : gb;
	float cov = 1.0 - smoothstep( - aa, aa, d );
	// petal colour: deeper at the base, paler at the tip, fine streaks along it, a faint midrib
	vec3 c0 = uInteriorColors[ 0 ];
	float grad = smoothstep( 0.2, 0.95, r );
	vec3 alb = mix( c0 * c0 * 0.9, c0, smoothstep( 0.12, 0.45, r ) );
	alb = mix( alb, mix( c0, vec3( 1.0 ), 0.35 ), 0.6 * smoothstep( 0.55, 1.0, r ) );
	float s = pp.y / g;
	float streak = dcNoise3( vec3( s * 7.0, pp.x * 1.2, mod( da < db ? ia : ib, k ) * 3.1 + v * 11.0 ) );
	alb *= 0.86 + 0.24 * streak;
	alb *= 1.0 - 0.1 * exp( - dcBoSq( s / 0.1 ) );
	// the crease where two petals meet
	float crease = ( 1.0 - smoothstep( 0.0, 0.05, abs( da - db ) ) ) * step( max( da, db ), 0.0 );
	alb *= 1.0 - 0.3 * crease;
	float alpha = cov * mix( 0.96, 0.78, grad * grad );
	float thin = 0.35 + 0.65 * grad;
	vec2 tilt = - dir * 0.4 * ( r - 0.3 ); // cupped: the petals curve up towards their tips
	// the centre: a domed, granular disc with a ring of stamens and a darker heart
	float rc = ( k < 5.5 ? 0.21 : 0.18 ) * ( 1.0 + 0.08 * ( dcNoise3( vec3( dir * 3.0, v * 7.0 ) ) - 0.5 ) );
	float ccov = 1.0 - smoothstep( - aa, aa, r - rc );
	float u = r / rc;
	// florets: small round bumps on a jittered grid, each its own shade
	vec2 fg = uv * 30.0;
	vec2 fc = floor( fg );
	vec2 fo = fract( fg ) - 0.5 - 0.3 * ( vec2( dcHash13( vec3( fc, v ) ), dcHash13( vec3( fc, v + 9.1 ) ) ) - 0.5 );
	float floret = 1.0 - smoothstep( 0.18, 0.42, length( fo ) );
	vec3 cc = uInteriorColors[ 1 ] * ( 0.5 + 0.35 * floret * ( 0.7 + 0.6 * dcHash13( vec3( fc, v + 3.3 ) ) ) + 0.2 * dcNoise3( vec3( uv * 9.0, v ) ) );
	cc = mix( cc, cc * vec3( 0.55, 0.4, 0.3 ), 1.0 - smoothstep( 0.0, 0.4, u ) );
	float stamen = smoothstep( 0.55, 0.75, dcNoise3( vec3( dir * 9.0, 2.0 + v ) ) ) * smoothstep( 0.65, 0.85, u ) * ( 1.0 - smoothstep( 0.9, 1.0, u ) );
	cc = mix( cc, min( uInteriorColors[ 1 ] * 1.3 + 0.15, vec3( 1.0 ) ), stamen );
	cc *= mix( 1.0, 0.7, smoothstep( 0.8, 1.0, u ) );
	// the petal base just round the centre: a soft shadow
	alb *= mix( 1.0, 0.72, ( 1.0 - smoothstep( rc, rc + 0.12, r ) ) );
	alb = mix( alb, cc, ccov );
	alpha = mix( alpha, 0.98, ccov );
	ex = vec3( mix( tilt, dir * 0.6 * u, ccov ), mix( thin, 0.1, ccov ) );
	return vec4( min( alb, vec3( 1.0 ) ), max( alpha, 0.0 ) );
}
// a segment's distance to a point (2D)
float dcBoSeg( vec2 p, vec2 a, vec2 b ) {
	vec2 pa = p - a;
	vec2 ba = b - a;
	return length( pa - ba * clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 ) );
}
// a butterfly on the unit card (body along +y): albedo and coverage; ex as dcBoFlower's
vec4 dcBoButterfly( vec2 uv, float aa, out vec3 ex ) {
	vec2 w = vec2( abs( uv.x ), uv.y );
	// forewing: from the root up and out, broadening towards the apex
	vec2 fq = dcBoRot( - 0.6 ) * ( w - vec2( 0.45, 0.3 ) );
	float fb = mix( 0.13, 0.3, clamp( fq.x / 0.5 * 0.5 + 0.5, 0.0, 1.0 ) );
	float df = dcBoEll( fq, vec2( 0.52, fb ) );
	// hindwing: rounder, down and out
	vec2 hq = dcBoRot( 0.75 ) * ( w - vec2( 0.29, - 0.27 ) );
	float dh = dcBoEll( hq, vec2( 0.36, 0.27 ) );
	// scalloped margins (scallops between the vein ends)
	vec2 rw = w - vec2( 0.03, 0.0 );
	float ang = atan( rw.y, abs( rw.x ) < 1e-6 ? 1e-6 : rw.x ); // (never atan( 0, 0 ))
	float rr = length( rw );
	df += 0.008 * cos( ang * 22.0 );
	dh += 0.012 * cos( ang * 18.0 );
	float d = min( df, dh );
	bool fore = df < dh;
	float wcov = ( 1.0 - smoothstep( - aa, aa, d ) ) * smoothstep( 0.02, 0.04, w.x );
	vec3 c0 = uInteriorColors[ 0 ];
	vec3 c1 = uInteriorColors[ 1 ];
	// brighter towards the body, darker out at the margin
	vec3 alb = c0 * ( 0.7 + 0.5 * ( 1.0 - smoothstep( 0.1, 0.75, rr ) ) );
	// veins: rays from the root, with the discal cell's outline on the forewing
	float vn = fore ? 22.0 : 18.0;
	float vl = abs( fract( ang * vn / 6.2831853 ) - 0.5 ) * 6.2831853 / vn * rr;
	float vein = ( 1.0 - smoothstep( 0.006, 0.014, vl ) ) * smoothstep( 0.12, 0.3, rr );
	float cell = fore ? 1.0 - smoothstep( 0.005, 0.012, abs( length( ( w - vec2( 0.27, 0.15 ) ) / vec2( 0.2, 0.075 ) ) - 1.0 ) * 0.075 ) : 0.0;
	alb = mix( alb, c1, 0.9 * max( vein, cell ) );
	// the dark margin (broad at the forewing's apex) with a row of pale dots
	// (the forewing lies over the hindwing: its own margin runs across it)
	float dTop = df < 0.0 ? df : dh;
	float band = ( 1.0 - smoothstep( 0.055, 0.068, - dTop ) ) * smoothstep( 0.2, 0.35, rr );
	float apex = fore ? smoothstep( 0.68, 0.74, length( w - vec2( 0.05, 0.05 ) ) ) : 0.0;
	alb = mix( alb, c1, max( band, apex ) * 0.92 );
	vec2 cellUV = vec2( ( fract( ang * vn / 12.5663706 ) - 0.5 ) * 12.5663706 / vn * rr, - dTop - 0.035 );
	float dots = ( 1.0 - smoothstep( 0.012, 0.02, length( cellUV ) ) ) * smoothstep( 0.4, 0.5, rr );
	vec3 pale = mix( c0, vec3( 1.0 ), 0.75 );
	alb = mix( alb, pale, dots * band );
	// eyespots: a dark ring round a pale pupil on each hindwing, a dark spot on each forewing
	float es = length( w - vec2( 0.36, - 0.37 ) );
	alb = mix( alb, c1, ( 1.0 - smoothstep( 0.05, 0.062, es ) ) * ( fore ? 0.0 : 1.0 ) );
	alb = mix( alb, pale, ( 1.0 - smoothstep( 0.018, 0.028, es ) ) * ( fore ? 0.0 : 1.0 ) );
	float fs = length( w - vec2( 0.53, 0.5 ) );
	alb = mix( alb, c1, ( 1.0 - smoothstep( 0.035, 0.045, fs ) ) * ( fore ? 0.85 : 0.0 ) );
	float edge = 1.0 - smoothstep( 0.0, 0.03, - d );
	float alpha = wcov * mix( 0.97, 0.86, edge );
	// the wings raised a little: a shallow V along the body
	vec2 tilt = vec2( sign( uv.x ) * 0.3, 0.0 );
	float thin = mix( 0.45, 0.9, edge );
	// the body: abdomen and thorax, a head and two clubbed antennae
	float db = dcBoEll( vec2( uv.x, uv.y + 0.12 ), vec2( 0.05, 0.36 ) );
	db = min( db, length( uv - vec2( 0.0, 0.28 ) ) - 0.045 );
	float ant = min( dcBoSeg( w, vec2( 0.012, 0.31 ), vec2( 0.17, 0.72 ) ) - 0.008, length( w - vec2( 0.17, 0.72 ) ) - 0.022 );
	float bcov = 1.0 - smoothstep( - aa * 0.5, aa * 0.5, min( db, ant ) );
	vec3 bc = mix( c1, vec3( 0.04 ), 0.4 ) * ( 0.75 + 0.25 * step( 0.5, fract( uv.y * 20.0 ) ) );
	bc += 0.12 * ( 1.0 - smoothstep( 0.0, 0.03, abs( uv.x ) ) ) * step( - 0.45, uv.y ); // a soft sheen along the back
	alb = mix( alb, bc, bcov );
	alpha = mix( alpha, 1.0, bcov );
	ex = vec3( mix( tilt, vec2( uv.x / 0.05, 0.0 ) * 0.5, bcov ), mix( thin, 0.0, bcov ) );
	return vec4( min( alb, vec3( 1.0 ) ), max( alpha, 0.0 ) );
}
// card i (unit normal n, shared by the kind) if the segment crosses it: premultiplied radiance
// and opacity, th = the hit distance
vec4 dcBoCard( int i, vec3 n, vec3 p, vec3 rd, float dt, out float th ) {
	th = 1e9;
	float dn = dot( rd, n );
	if ( abs( dn ) < 1e-4 ) return vec4( 0.0 );
	float t = dot( DC_BO_C[ i ] - p, n ) / dn;
	if ( t < 0.0 || t >= dt ) return vec4( 0.0 );
	bool bfly = uBoKind == 2;
	float R = DC_BO_S[ i ] * ( bfly ? mix( ${f(CARD_RADIUS.butterfly[0])}, ${f(CARD_RADIUS.butterfly[1])}, uInteriorDensity )
		: mix( ${f(CARD_RADIUS.flower[0])}, ${f(CARD_RADIUS.flower[1])}, uInteriorDensity ) );
	vec3 q = p + rd * t - DC_BO_C[ i ];
	if ( dot( q, q ) >= R * R ) return vec4( 0.0 );
	vec3 t1 = dcBoPerp( DC_BO_REF[ i ], n );
	vec3 t2 = cross( n, t1 );
	vec2 uv = vec2( dot( q, t1 ), dot( q, t2 ) ) / R;
	float aa = 0.018 + 0.03 * ( 1.0 - abs( dn ) );
	vec3 ex;
	// (the butterfly drawn at 1 / 1.15: its forewing tips inside the card)
	vec4 m = bfly ? dcBoButterfly( uv * 1.15, aa * 1.15, ex ) : dcBoFlower( uv, aa, DC_BO_V[ i ], ex );
	if ( m.a <= 0.0 ) return vec4( 0.0 );
	th = t;
	// two-sided: the side facing the eye, tilted by the specimen's relief
	vec3 nf = normalize( n + ex.x * t1 + ex.y * t2 );
	nf = dot( rd, nf ) > 0.0 ? - nf : nf;
	float kd = dot( nf, dcIKey );
	float wrap = clamp( ( kd + 0.35 ) / 1.35, 0.0, 1.0 );
	vec3 col = m.rgb * ( dcILight * ( 0.3 + 0.7 * wrap ) + 0.12 );
	// the key light through the thin tissue from behind
	col += m.rgb * ex.z * 0.6 * max( - kd, 0.0 ) * ( dcILight + 0.3 );
	float rk = max( dot( reflect( rd, nf ), dcIKey ), 0.0 );
	col += vec3( 0.25 ) * pow( max( rk, 0.0 ), 24.0 );
	// butterfly scales: a broad, view-dependent sheen of the wing colour
	if ( bfly ) col += uInteriorColors[ 0 ] * 0.45 * pow( max( rk, 0.0 ), 3.0 ) * ex.z;
	return vec4( min( col, vec3( 1.0 ) ) * m.a, m.a );
}
vec4 dcBoCards( vec3 p, vec3 rd, float dt ) {
	bool bfly = uBoKind == 2;
	int b = bfly ? 3 : 0;
	// the kind's shared normal: up, tilted in the up frame built from the first card's ref
	vec3 b1 = dcBoPerp( DC_BO_REF[ b ], dcIUp );
	vec3 b2 = cross( dcIUp, b1 );
	vec2 tl = bfly ? vec2( ${TILT.butterfly.map(f).join(', ')} ) : vec2( ${TILT.flower.map(f).join(', ')} );
	vec3 n = normalize( dcIUp + tl.x * b1 + tl.y * b2 );
	float t0;
	float t1;
	float t2;
	vec4 a0 = dcBoCard( b, n, p, rd, dt, t0 );
	vec4 a1 = dcBoCard( b + 1, n, p, rd, dt, t1 );
	vec4 a2 = dcBoCard( b + 2, n, p, rd, dt, t2 );
	// front to back: sort the (at most three) hits by distance
	vec4 dcBoTa;
	float dcBoTt;
	if ( t1 < t0 ) { dcBoTa = a0; a0 = a1; a1 = dcBoTa; dcBoTt = t0; t0 = t1; t1 = dcBoTt; }
	if ( t2 < t1 ) { dcBoTa = a1; a1 = a2; a2 = dcBoTa; dcBoTt = t1; t1 = t2; t2 = dcBoTt; }
	if ( t1 < t0 ) { dcBoTa = a0; a0 = a1; a1 = dcBoTa; }
	vec4 acc = a0;
	acc += ( 1.0 - acc.a ) * a1;
	return acc + ( 1.0 - acc.a ) * a2;
}
// the moss at x (canonical frame; Rc: the cushion radius): premultiplied radiance and opacity over h
vec4 dcBoMossAt( vec3 x, float Rc, float h ) {
	// cushion space: from the centre of its flat base (below the die's centre), height along up
	vec3 q = x + ${f(MOSS.drop)} * dcIUp;
	float hy = dot( q, dcIUp );
	if ( hy < - 0.02 ) return vec4( 0.0 );
	vec3 qs = q + ${f(MOSS.squash - 1)} * hy * dcIUp; // squashed: a low dome
	float rho = length( qs );
	if ( rho > Rc * 1.15 ) return vec4( 0.0 );
	vec3 d = qs / max( rho, 1e-4 ); // the direction out of the dome (its strands grow along it)
	// the surface: a gentle undulation (small hummocks and hollows), no broad lobes
	float und = dcFbm3( d * 4.5 + 2.0, 2 );
	float Rs = Rc * ( 0.94 + 0.12 * und );
	float u = rho / Rs;
	// strands: noise fine across the dome, stretched along its radius, thinning out in the shell
	float s1 = dcNoise3( d * 75.0 + vec3( rho * 7.0 ) );
	float s2 = dcNoise3( d * 150.0 + vec3( rho * 12.0 + 5.0 ) );
	float strand = 0.65 * s1 + 0.35 * s2;
	float shell = smoothstep( 0.86, 1.08, u );
	float dens = mix( 1.0, smoothstep( 0.5, 0.62, strand - 0.35 * ( shell - 0.5 ) ), smoothstep( 0.84, 0.9, u ) );
	dens *= 1.0 - smoothstep( 1.04, 1.12, u );
	dens *= smoothstep( - 0.02, 0.0, hy ); // the flat base
	if ( dens <= 0.0 ) return vec4( 0.0 );
	// colour: dark inside and in the hollows, colors[0] in the cushion, speckled colors[1] tips
	vec3 c0 = uInteriorColors[ 0 ];
	vec3 col = mix( c0 * 0.3, c0, smoothstep( 0.8, 1.0, u ) );
	col *= mix( 0.55, 1.15, und );
	col *= 0.75 + 0.5 * s2;
	float tip = smoothstep( 0.62, 0.74, s2 ) * smoothstep( 0.92, 1.02, u );
	col = mix( col, uInteriorColors[ 1 ], tip );
	// light: the key light on the dome (its own normal), the inner light, darker low down
	float kd = clamp( ( dot( normalize( q + 1e-4 * dcIUp ), dcIKey ) + 0.4 ) / 1.4, 0.0, 1.0 );
	float low = smoothstep( 0.0, 0.12, hy );
	vec3 rad = col * ( dcILight * ( 0.2 + 0.7 * kd ) * ( 0.55 + 0.45 * low ) + 0.08 );
	float a = dcIAlpha( dens * 80.0, h ) * dcIEdge( x );
	return vec4( min( rad, vec3( 1.0 ) ) * a, a );
}
vec4 dcBoMoss( vec3 p, vec3 rd, float dt ) {
	float Rc = mix( ${f(MOSS.radius[0])}, ${f(MOSS.radius[1])}, uInteriorDensity );
	// sub-samples on long segments, so the fuzz survives the lowest marched tier
	int ns = int( clamp( ceil( dt / 0.03 ), 1.0, 4.0 ) );
	float h = dt / float( ns );
	vec4 acc = vec4( 0.0 );
	for ( int i = 0; i < 4; i ++ ) {
		if ( i >= ns ) break;
		acc += ( 1.0 - acc.a ) * dcBoMossAt( p + rd * ( h * ( float( i ) + 0.5 ) ), Rc, h );
	}
	return acc;
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	if ( uBoKind == 1 ) return dcBoMoss( p, rd, dt );
	return dcBoCards( p, rd, dt );
}
`;

/**
 * @returns {{ body: string, uniforms: { uBoKind: { value: number } } }} the botanical GLSL (one
 * program: every colour, the density and the kind are uniforms); `live` (insideMotion) brightens
 * with the inside flare (live.js brighten), otherwise as before
 */
export function botanicalInside(a, live = false) {
  const k = BO_KINDS.indexOf(a.interior.inclusion);
  return { body: live ? brighten(BODY, 'Bo') : BODY, uniforms: { uBoKind: { value: Math.max(k, 0) } } };
}

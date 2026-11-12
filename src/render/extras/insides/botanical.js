/**
 * Botanical inside: a pressed flower, a clump of moss or a butterfly cast in the resin, like the
 * real resin dice with dried specimens. One program for the three kinds: uBoKind (0 flower,
 * 1 moss, 2 butterfly, the appearance.js INCLUSIONS order) selects a branch, and as a uniform
 * the branch is coherent.
 *
 * Flower and butterfly: "cards", flat specimens at fixed positions and tilts (CARDS: three
 * flowers, or a large and two small butterflies), spread so one faces the eye whatever face
 * the die rests on. Each card is tested exactly against the march segment (plane hit, then the
 * card's 2D shape at the hit point), like glitter's flakes and foil's shards, so it counts once
 * whatever the step count and never flickers between tiers. Hits within one segment are
 * composited in depth order. The shape's edge is anti-aliased by a fixed width in card units,
 * wider at grazing angles (no derivatives: the march is non-uniform control flow).
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
 * Moss: not a card. A soft, fuzzy clump of overlapping domes on a flat bed in the lower centre
 * of the die (die-local, not gravity-aligned: a pressed specimen), built from fbm density with
 * upright fibres at the surface; colors[0] in the body, darker inside, colors[1] at the tips.
 * Long segments are sub-sampled inside the clump so the fuzz survives the lowest marched tier.
 *
 * density sets the card size (flower, butterfly) or the clump size (moss).
 */
export const USES_NOISE = true; // dcNoise3, dcFbm3

/** The inclusion kinds in uBoKind order (appearance.js INCLUSIONS; a local copy, pinned by a test). */
export const BO_KINDS = Object.freeze(['flower', 'moss', 'butterfly']);

/**
 * The cards (canonical interior frame; the march sphere has radius 0.62): centre, normal,
 * in-plane rotation (radians), size share and a variant (flower: < 0.5 five petals, else six).
 * Flowers 0-2, butterflies 3-5 (a large one and two small). Picked by eye: one card roughly
 * along each axis (one faces the eye whatever face the die rests on), the large card in the
 * coin's caps, no card crossing another or reaching past the march sphere (tests).
 */
export const CARDS = Object.freeze([
  { c: [0.03, 0.06, 0.04], n: [0.25, 1, 0.2], rot: 0.3, size: 1, v: 0.2 },
  { c: [-0.2, -0.25, -0.05], n: [-0.85, 0.5, 0.3], rot: 1.9, size: 0.55, v: 0.7 },
  { c: [0.1, 0.33, -0.1], n: [0.35, 0.5, -0.85], rot: 4.1, size: 0.5, v: 0.35 },
  { c: [0.03, 0.05, 0.04], n: [0.2, 1, 0.3], rot: 0.5, size: 1, v: 0 },
  { c: [-0.24, -0.22, -0.08], n: [-0.9, 0.35, 0.4], rot: 2.4, size: 0.45, v: 0 },
  { c: [0.18, -0.24, -0.2], n: [0.3, 0.3, -0.9], rot: 5.2, size: 0.4, v: 0 },
]);

/** Card radius (canonical) at density 0 and 1, before the card's size share. */
export const CARD_RADIUS = Object.freeze({ flower: [0.28, 0.44], butterfly: [0.34, 0.5] });

/** The moss domes (clump space, canonical frame): centre and radius; squashed 1.45x in height. */
export const DOMES = Object.freeze([
  [0.0, -0.4, 0.02, 0.27],
  [0.18, -0.42, -0.1, 0.2],
  [-0.16, -0.43, 0.12, 0.19],
  [-0.06, -0.42, -0.19, 0.17],
  [0.12, -0.44, 0.17, 0.14],
  [-0.22, -0.45, -0.06, 0.12],
]);

const f = (x) => x.toFixed(4);
const norm = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vec3 = (v) => `vec3( ${v.map(f).join(', ')} )`;

/** Each card's unit normal and in-plane axes (t1, t2), rotated by rot. */
export function cardFrames() {
  return CARDS.map(({ c, n, rot, size, v }) => {
    const nn = norm(n);
    const u = norm(cross(nn, Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const w = cross(nn, u);
    const [cs, sn] = [Math.cos(rot), Math.sin(rot)];
    const t1 = u.map((x, i) => cs * x + sn * w[i]);
    const t2 = w.map((x, i) => cs * x - sn * u[i]);
    return { c, n: nn, t1, t2, size, v };
  });
}

const FR = cardFrames();
const arr = (type, xs) => `${type}[ ${xs.length} ]( ${xs.join(', ')} )`;

const BODY = /* glsl */ `
uniform int uBoKind; // 0 flower, 1 moss, 2 butterfly
const vec3 DC_BO_C[ ${FR.length} ] = ${arr('vec3', FR.map((x) => vec3(x.c)))};
const vec3 DC_BO_N[ ${FR.length} ] = ${arr('vec3', FR.map((x) => vec3(x.n)))};
const vec3 DC_BO_T1[ ${FR.length} ] = ${arr('vec3', FR.map((x) => vec3(x.t1)))};
const vec3 DC_BO_T2[ ${FR.length} ] = ${arr('vec3', FR.map((x) => vec3(x.t2)))};
const float DC_BO_S[ ${FR.length} ] = ${arr('float', FR.map((x) => f(x.size)))};
const float DC_BO_V[ ${FR.length} ] = ${arr('float', FR.map((x) => f(x.v)))};
const vec4 DC_BO_DOME[ ${DOMES.length} ] = ${arr('vec4', DOMES.map((d) => `vec4( ${d.map(f).join(', ')} )`))};
mat2 dcBoRot( float a ) { return mat2( cos( a ), sin( a ), - sin( a ), cos( a ) ); }
float dcBoSq( float x ) { return x * x; }
// a pressed flower on the unit card: albedo and coverage; ex = (in-plane normal tilt, translucency)
vec4 dcBoFlower( vec2 uv, float aa, float v, out vec3 ex ) {
	float k = v < 0.5 ? 5.0 : 6.0;
	float W = v < 0.5 ? 0.33 : 0.28; // petal half-width
	float r = length( uv );
	vec2 dir = uv / max( r, 1e-4 );
	float sec = 6.2831853 / k;
	float fa = atan( uv.y, uv.x ) / sec;
	float ia = floor( fa + 0.5 ); // the nearest petal and the next nearest
	float ib = ia + ( fa > ia ? 1.0 : - 1.0 );
	vec2 pa = dcBoRot( - ia * sec ) * uv;
	vec2 pb = dcBoRot( - ib * sec ) * uv;
	// petals: ellipses along x, broader towards the tip (obovate), with a wavy edge
	float ga = W * ( 0.5 + 0.65 * clamp( pa.x / 0.95, 0.0, 1.0 ) );
	float gb = W * ( 0.5 + 0.65 * clamp( pb.x / 0.95, 0.0, 1.0 ) );
	float da = ( length( vec2( ( pa.x - 0.52 ) / 0.43, pa.y / ga ) ) - 1.0 ) * 0.3;
	float db = ( length( vec2( ( pb.x - 0.52 ) / 0.43, pb.y / gb ) ) - 1.0 ) * 0.3;
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
	float df = ( length( vec2( fq.x / 0.52, fq.y / fb ) ) - 1.0 ) * 0.2;
	// hindwing: rounder, down and out
	vec2 hq = dcBoRot( 0.75 ) * ( w - vec2( 0.29, - 0.27 ) );
	float dh = ( length( vec2( hq.x / 0.36, hq.y / 0.27 ) ) - 1.0 ) * 0.25;
	// scalloped margins (scallops between the vein ends)
	vec2 rw = w - vec2( 0.03, 0.0 );
	float ang = atan( rw.y, rw.x );
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
	float vein = ( 1.0 - smoothstep( 0.004, 0.011, vl ) ) * smoothstep( 0.12, 0.3, rr );
	float cell = fore ? 1.0 - smoothstep( 0.005, 0.012, abs( length( ( w - vec2( 0.27, 0.15 ) ) / vec2( 0.2, 0.075 ) ) - 1.0 ) * 0.075 ) : 0.0;
	alb = mix( alb, c1, 0.75 * max( vein, cell ) );
	// the dark margin (broad at the forewing's apex) with a row of pale dots
	// (the forewing lies over the hindwing: its own margin runs across it)
	float dTop = df < 0.0 ? df : dh;
	float band = ( 1.0 - smoothstep( 0.05, 0.08, - dTop ) ) * smoothstep( 0.2, 0.35, rr );
	float apex = fore ? smoothstep( 0.62, 0.8, length( w - vec2( 0.05, 0.05 ) ) ) : 0.0;
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
	float edge = 1.0 - smoothstep( 0.0, 0.06, - d );
	float alpha = wcov * mix( 0.97, 0.8, edge );
	// the wings raised a little: a shallow V along the body
	vec2 tilt = vec2( sign( uv.x ) * 0.3, 0.0 );
	float thin = mix( 0.45, 0.9, edge );
	// the body: abdomen and thorax, a head and two clubbed antennae
	float db = ( length( vec2( uv.x / 0.042, ( uv.y + 0.12 ) / 0.36 ) ) - 1.0 ) * 0.042;
	db = min( db, length( uv - vec2( 0.0, 0.28 ) ) - 0.045 );
	float ant = min( dcBoSeg( w, vec2( 0.012, 0.31 ), vec2( 0.17, 0.72 ) ) - 0.008, length( w - vec2( 0.17, 0.72 ) ) - 0.022 );
	float bcov = 1.0 - smoothstep( - aa * 0.5, aa * 0.5, min( db, ant ) );
	vec3 bc = mix( c1, vec3( 0.04 ), 0.4 ) * ( 0.75 + 0.25 * step( 0.5, fract( uv.y * 20.0 ) ) );
	bc += 0.12 * ( 1.0 - smoothstep( 0.0, 0.03, abs( uv.x ) ) ) * step( - 0.45, uv.y ); // a soft sheen along the back
	alb = mix( alb, bc, bcov );
	alpha = mix( alpha, 1.0, bcov );
	ex = vec3( mix( tilt, vec2( uv.x / 0.042, 0.0 ) * 0.5, bcov ), mix( thin, 0.0, bcov ) );
	return vec4( min( alb, vec3( 1.0 ) ), max( alpha, 0.0 ) );
}
// card i if the segment crosses it: premultiplied radiance and opacity, th = the hit distance
vec4 dcBoCard( int i, vec3 p, vec3 rd, float dt, out float th ) {
	th = 1e9;
	vec3 n = DC_BO_N[ i ];
	float dn = dot( rd, n );
	if ( abs( dn ) < 1e-4 ) return vec4( 0.0 );
	float t = dot( DC_BO_C[ i ] - p, n ) / dn;
	if ( t < 0.0 || t >= dt ) return vec4( 0.0 );
	bool bfly = uBoKind == 2;
	float R = DC_BO_S[ i ] * ( bfly ? mix( ${f(CARD_RADIUS.butterfly[0])}, ${f(CARD_RADIUS.butterfly[1])}, uInteriorDensity )
		: mix( ${f(CARD_RADIUS.flower[0])}, ${f(CARD_RADIUS.flower[1])}, uInteriorDensity ) );
	vec3 q = p + rd * t - DC_BO_C[ i ];
	vec2 uv = vec2( dot( q, DC_BO_T1[ i ] ), dot( q, DC_BO_T2[ i ] ) ) / R;
	if ( dot( uv, uv ) >= 1.0 ) return vec4( 0.0 );
	float aa = 0.018 + 0.03 * ( 1.0 - abs( dn ) );
	vec3 ex;
	// (the butterfly drawn at 1 / 1.15: its forewing tips inside the card)
	vec4 m = bfly ? dcBoButterfly( uv * 1.15, aa * 1.15, ex ) : dcBoFlower( uv, aa, DC_BO_V[ i ], ex );
	if ( m.a <= 0.0 ) return vec4( 0.0 );
	th = t;
	// two-sided: the side facing the eye, tilted by the specimen's relief
	vec3 nf = normalize( n + ex.x * DC_BO_T1[ i ] + ex.y * DC_BO_T2[ i ] );
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
	int b = uBoKind == 2 ? 3 : 0;
	float t0;
	float t1;
	float t2;
	vec4 a0 = dcBoCard( b, p, rd, dt, t0 );
	vec4 a1 = dcBoCard( b + 1, p, rd, dt, t1 );
	vec4 a2 = dcBoCard( b + 2, p, rd, dt, t2 );
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
// the moss at x (canonical frame, sz: the clump size): premultiplied radiance and opacity over h
vec4 dcBoMossAt( vec3 x, float sz, float h ) {
	// clump space: scaled about the bed point, so the clump grows up and out from the bed
	vec3 bed = vec3( 0.0, - 0.46, 0.0 );
	vec3 y = ( x - bed ) / sz + bed;
	if ( y.y < - 0.5 || y.y > - 0.08 || dot( y.xz, y.xz ) > 0.26 ) return vec4( 0.0 );
	// overlapping domes (squashed spheres): the nearest (e, its centre) and the next (e2: crevices)
	vec3 sq = vec3( 1.0, 1.45, 1.0 );
	float e = 1e3;
	float e2 = 1e3;
	vec3 dc = vec3( 0.0, - 0.5, 0.0 );
	for ( int i = 0; i < 6; i ++ ) {
		float ei = length( ( y - DC_BO_DOME[ i ].xyz ) * sq ) / DC_BO_DOME[ i ].w;
		if ( ei < e ) { e2 = e; e = ei; dc = DC_BO_DOME[ i ].xyz; }
		else e2 = min( e2, ei );
	}
	// lumpy, then fuzzy: upright fibres (noise stretched along y) near the surface
	float lump = dcFbm3( y * 7.0 + 3.0, 3 );
	float fib = dcNoise3( vec3( y.xz * 60.0, y.y * 9.0 ) );
	float fib2 = dcNoise3( vec3( y.xz * 130.0, y.y * 20.0 + 7.0 ) );
	float sur = smoothstep( 0.55, 1.0, e );
	float ef = e + 0.45 * ( lump - 0.5 ) - sur * ( 0.32 * ( fib - 0.5 ) + 0.18 * ( fib2 - 0.5 ) );
	float dens = 1.0 - smoothstep( 0.82, 1.0, ef );
	dens *= smoothstep( - 0.5, - 0.47, y.y ); // the flat bed
	if ( dens <= 0.0 ) return vec4( 0.0 );
	// colour: deep inside, colors[0] in the body, colors[1] at the fibre tips
	float tip = smoothstep( 0.65, 0.98, ef ) * smoothstep( 0.4, 0.7, fib );
	vec3 c0 = uInteriorColors[ 0 ];
	vec3 col = mix( c0 * 0.45, c0, smoothstep( 0.35, 0.85, ef ) );
	col = mix( col, uInteriorColors[ 1 ], tip );
	col *= 0.7 + 0.6 * lump;
	// shade in the crevices between domes
	col *= mix( 0.55, 1.0, smoothstep( 0.0, 0.25, e2 - e ) );
	// light: from above and from the key light (each dome's surface faces out of it), darker low down
	vec3 nrm = normalize( ( y - dc ) * sq + vec3( 0.0, 1e-3, 0.0 ) );
	float kd = clamp( ( dot( nrm, dcIKey ) + 0.4 ) / 1.4, 0.0, 1.0 );
	float low = smoothstep( - 0.5, - 0.3, y.y );
	vec3 rad = col * ( dcILight * ( 0.2 + 0.7 * kd ) * ( 0.5 + 0.5 * low ) + 0.08 );
	float a = dcIAlpha( dens * 70.0, h ) * dcIEdge( x );
	return vec4( min( rad, vec3( 1.0 ) ) * a, a );
}
vec4 dcBoMoss( vec3 p, vec3 rd, float dt ) {
	float sz = mix( 0.75, 1.15, uInteriorDensity );
	// sub-samples on long segments, so the fuzz survives the lowest marched tier
	int ns = int( clamp( ceil( dt / 0.03 ), 1.0, 4.0 ) );
	float h = dt / float( ns );
	vec4 acc = vec4( 0.0 );
	for ( int i = 0; i < 4; i ++ ) {
		if ( i >= ns ) break;
		acc += ( 1.0 - acc.a ) * dcBoMossAt( p + rd * ( h * ( float( i ) + 0.5 ) ), sz, h );
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
 * program: every colour, the density and the kind are uniforms)
 */
export function botanicalInside(a) {
  const k = BO_KINDS.indexOf(a.interior.inclusion);
  return { body: BODY, uniforms: { uBoKind: { value: Math.max(k, 0) } } };
}

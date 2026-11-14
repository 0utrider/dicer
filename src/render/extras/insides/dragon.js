import { CARD_AXIS, upFrame, upFrameGLSL } from './frame.js';
import { brighten, swap } from './live.js';

/**
 * Dragon inside (plan 3b): one detailed dragon cast in the resin, a fine pressed inclusion in
 * the manner of a heraldic "dragon displayed": the body seen from above with both bat wings
 * spread, four clawed legs and a long sinuous tail ending in a spade, the horned head turned in
 * profile with its jaws open.
 *
 * Card: like botanical.js's flowers and butterflies, the dragon is flat, on a card (a disc of
 * radius mix(DRAGON.radius, density) in the canonical frame) through the centre, facing the die's
 * current up (dcIUp), so the camera above the table sees it face-on whatever face the die rests
 * on. The card is tested exactly against each march segment (a plane hit, then the 2D shape at
 * the hit point), so it counts once whatever the step count. Its in-plane frame is continuous in
 * dcIUp (as weapons.js's): n = dcIUp, t1 = the constant DRAGON.axis projected off n (its .zxy where
 * they are parallel), t2 = n x t1. Right-handed, so the dragon is never mirrored, and with no
 * switch on any component of up it turns smoothly while the die tumbles. The frame is singular
 * only where up is along DRAGON.axis, which lies at least 22 degrees off every die's resting up
 * and the coin's caps (dragonFrame, tested).
 *
 * The 2D shape (unit card, the head towards +y, every distance a signed distance in card units,
 * so every edge is anti-aliased by one width, wider at grazing angles; no derivatives):
 * - wings (mirrored): a membrane polygon from the shoulder over the arm to the wrist, out along
 *   the first finger and back over the finger tips to the flank, its trailing edges scalloped
 *   between the tips; colors[1], slightly translucent (the key light shines through it from
 *   behind), darker by the bones and at its rim, with fine veins fanning from the wrist and
 *   cross veins; the arm, the four fingers (bent at a knuckle) and a clawed thumb are colors[0]
 *   bones, raised (shaded as tubes);
 * - the body and tail: one tapered tube along a Catmull-Rom spine (SPINE, sampled in JS) from the
 *   neck through the chest and hips to the tail tip, shaded as a rounded tube with overlapping
 *   scales and a ridge of dorsal plates down its middle; a spade (a barbed arrowhead) ends the
 *   tail;
 * - four legs (mirrored), bent, each foot with three ivory-tipped claws;
 * - the head in profile: a skull, a long upper jaw and an open lower jaw with teeth, two swept
 *   ivory horns and a glowing eye.
 * Lit two-sided by dcILight and the key light (wrap diffuse, a glossy key highlight on the scales
 * and bones, the key light through the membranes from behind), as botanical.js's cards.
 */
export const USES_NOISE = false;

/**
 * Card radius (canonical) at density 0 and 1; the frame's axis before projection (canonical, as
 * the GLSL gets it, unit to 4 places): the direction furthest from every die's resting up and the
 * coin's caps (|cos| <= 0.924); the anti-alias width (card units) face-on and its growth at
 * grazing angles.
 */
export const DRAGON = Object.freeze({
  radius: Object.freeze([0.44, 0.58]),
  axis: CARD_AXIS,
  aa: Object.freeze([0.012, 0.03]),
});

/** Spine control points (x, y, radius) from the neck's top to the tail's tip. */
const SPINE = [
  [0.045, 0.655, 0.042],
  [0.0, 0.57, 0.047],
  [-0.05, 0.465, 0.056],
  [-0.035, 0.345, 0.072],
  [0.0, 0.23, 0.098],
  [0.0, 0.06, 0.096],
  [0.0, -0.11, 0.086],
  [0.03, -0.28, 0.064],
  [0.01, -0.44, 0.048],
  [-0.09, -0.58, 0.036],
  [-0.25, -0.66, 0.027],
  [-0.41, -0.64, 0.019],
  [-0.51, -0.54, 0.013],
];
/** Samples per spine span. */
const SPAN = 3;

// the right wing (the left one mirrored): shoulder, elbow, wrist, thumb claw, finger tips, the
// flank where the membrane meets the body, each finger's knuckle bend (card units, to its right)
const WING = {
  s: [0.055, 0.215],
  e: [0.29, 0.4],
  w: [0.47, 0.6],
  thumb: [0.43, 0.705],
  tips: [
    [0.86, 0.4],
    [0.85, 0.04],
    [0.66, -0.29],
    [0.37, -0.45],
  ],
  flank: [0.065, -0.08],
  bend: [-0.02, 0.025, 0.025, 0.02],
  /** scallop depth over the edge length, per trailing edge */
  sag: 0.16,
};
// the right legs (the left ones mirrored): hip / shoulder, knee / elbow, foot (x, y, radius),
// and the three claw tips of each foot
const LEGS = [
  { joints: [[0.05, 0.15, 0.05], [0.18, 0.08, 0.037], [0.215, 0.19, 0.026]], claws: [[0.198, 0.27], [0.25, 0.258], [0.278, 0.212]] },
  { joints: [[0.05, -0.14, 0.062], [0.2, -0.07, 0.048], [0.19, -0.245, 0.027]], claws: [[0.256, -0.212], [0.266, -0.262], [0.232, -0.308]] },
];
// the head in profile, facing +x: its joint at the neck's top, and its parts' scale
const HEAD = [0.055, 0.685];
const HEAD_SCALE = 1.45;

const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const mul = (a, k) => a.map((x) => x * k);
const len = (a) => Math.hypot(...a);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The spine sampled (Catmull-Rom, SPAN points per span) plus a short straight end into the spade. */
function spinePoints() {
  const P = SPINE;
  const at = (i) => P[Math.max(0, Math.min(P.length - 1, i))];
  const out = [];
  for (let i = 0; i < P.length - 1; i++)
    for (let k = 0; k < SPAN; k++) {
      const t = k / SPAN;
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      const t2 = t * t;
      const t3 = t2 * t;
      out.push(p1.map((_, j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  const last = P[P.length - 1];
  out.push(last);
  const prev = out[out.length - 2];
  const d = sub(last.slice(0, 2), prev.slice(0, 2));
  const u = mul(d, 1 / len(d));
  out.push([...add(last.slice(0, 2), mul(u, 0.045)), 0.008]);
  return { pts: out, tip: last.slice(0, 2), dir: u };
}

/** Each finger: wrist -> knuckle -> tip, the knuckle bent to the finger's right. */
function fingers() {
  return WING.tips.map((tip, i) => {
    const d = sub(tip, WING.w);
    const n = mul([d[1], -d[0]], 1 / len(d));
    return add(add(WING.w, mul(d, 0.55)), mul(n, WING.bend[i]));
  });
}

/** The membrane polygon (right wing) and its scallops (centre x, y, radius) on the trailing edges. */
function membrane() {
  const k = fingers();
  const poly = [WING.s, WING.e, WING.w, k[0], ...WING.tips, WING.flank];
  const c = mul(poly.reduce((a, b) => add(a, b), [0, 0]), 1 / poly.length);
  const edges = [[WING.tips[0], WING.tips[1]], [WING.tips[1], WING.tips[2]], [WING.tips[2], WING.tips[3]], [WING.tips[3], WING.flank]];
  const scallops = edges.map(([a, b]) => {
    const m = mul(add(a, b), 0.5);
    const d = sub(b, a);
    const L = len(d);
    let n = mul([d[1], -d[0]], 1 / L);
    if (dot3([...n, 0], [...sub(m, c), 0]) < 0) n = mul(n, -1); // outward
    const s = WING.sag * L;
    const r = (L * L) / 4 / (2 * s) + s / 2;
    return [...add(m, mul(n, r - s)), r];
  });
  return { poly, scallops };
}

/** Bone tubes of the right wing: [a, b] with (x, y, radius) ends. */
function bones() {
  const k = fingers();
  const { s, e, w, thumb, tips } = WING;
  const out = [
    [[...s, 0.032], [...e, 0.024]],
    [[...e, 0.024], [...w, 0.019]],
    [[...w, 0.016], [...thumb, 0.005]],
  ];
  tips.forEach((tip, i) => {
    out.push([[...w, 0.018], [...k[i], 0.012]]);
    out.push([[...k[i], 0.012], [...tip, 0.004]]);
  });
  return out;
}

/** Leg tubes and claw tubes of the right legs. */
function limbs() {
  const legs = [];
  const claws = [];
  for (const { joints, claws: cl } of LEGS) {
    legs.push([joints[0], joints[1]], [joints[1], joints[2]]);
    const foot = joints[2];
    for (const c of cl) claws.push([[foot[0], foot[1], 0.016], [...c, 0.004]]);
  }
  return { legs, claws };
}

// the head's parts relative to HEAD: tubes (a, b with radius) and the skull ellipse
const HEAD_PARTS = {
  skull: { c: [0.015, 0.02], r: [0.062, 0.046] },
  upper: [[0.03, 0.03, 0.04], [0.178, 0.04, 0.019]],
  lower: [[0.02, 0.0, 0.032], [0.158, -0.047, 0.013]],
  horns: [
    [[-0.02, 0.05, 0.02], [-0.075, 0.105, 0.012]],
    [[-0.075, 0.105, 0.012], [-0.152, 0.126, 0.003]],
    [[-0.035, 0.03, 0.015], [-0.095, 0.046, 0.009]],
    [[-0.095, 0.046, 0.009], [-0.158, 0.02, 0.002]],
  ],
  eye: [0.06, 0.045, 0.011],
};
const SPADE = { len: 0.13, half: 0.066, notch: [-0.035, 0.066] };

/**
 * The furthest point of the dragon from the card's centre, in card units (inside the unit card
 * with a margin, and inside the march sphere at density 1: tested).
 */
export function dragonExtent() {
  const far = (p, r = 0) => len(p.slice(0, 2)) + r;
  const tube = ([a, b]) => Math.max(far(a, a[2]), far(b, b[2]));
  const { pts, tip, dir } = spinePoints();
  let m = Math.max(...pts.map((p) => far(p, p[2])));
  m = Math.max(m, far(add(tip, mul(dir, SPADE.len))) + 0.001, far(tip) + Math.hypot(SPADE.half, SPADE.len));
  m = Math.max(m, ...membrane().poly.map((p) => far(p)), ...bones().map(tube));
  const { legs, claws } = limbs();
  m = Math.max(m, ...legs.map(tube), ...claws.map(tube));
  const k = HEAD_SCALE;
  const hp = (q) => [HEAD[0] + k * q[0], HEAD[1] + k * q[1], k * (q[2] ?? 0)];
  const sk = HEAD_PARTS.skull;
  m = Math.max(m, far(hp(sk.c)) + k * Math.max(...sk.r));
  m = Math.max(m, far(hp(HEAD_PARTS.eye)) + k * HEAD_PARTS.eye[2]);
  for (const t of [HEAD_PARTS.upper, HEAD_PARTS.lower, ...HEAD_PARTS.horns]) m = Math.max(m, tube([hp(t[0]), hp(t[1])]));
  return m;
}

/**
 * The GLSL frame in JS (for tests): up = the die's up in the canonical frame (unit). Returns
 * { n, t1, t2 } (canonical): the card's normal and its in-plane axes (x and y of the unit card).
 */
export function dragonFrame(up) {
  const { n, t1, t2 } = upFrame(up, DRAGON.axis);
  return { n, t1, t2 };
}

const f = (x) => x.toFixed(4);
const v2 = (p) => `vec2( ${f(p[0])}, ${f(p[1])} )`;
const v3 = (p) => `vec3( ${p.map(f).join(', ')} )`;
const list = (type, name, xs, fmt) => `const ${type} ${name}[ ${xs.length} ] = ${type}[ ${xs.length} ]( ${xs.map(fmt).join(', ')} );`;

function body() {
  const { pts, tip, dir } = spinePoints();
  const arc = [0];
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + len(sub(pts[i].slice(0, 2), pts[i - 1].slice(0, 2))));
  const { poly, scallops } = membrane();
  const bn = bones();
  const { legs, claws } = limbs();
  const H = HEAD_PARTS;
  const tubes = (name, xs) => `${list('vec3', `${name}A`, xs, (t) => v3(t[0]))}\n${list('vec3', `${name}B`, xs, (t) => v3(t[1]))}`;
  return /* glsl */ `
#define DC_DR_NSP ${pts.length}
#define DC_DR_NBONE ${bn.length}
#define DC_DR_NLEG ${legs.length}
#define DC_DR_NCLAW ${claws.length}
#define DC_DR_NWING ${poly.length}
${list('vec3', 'DC_DR_SP', pts, v3)}
${list('float', 'DC_DR_SS', arc, f)}
${list('vec2', 'DC_DR_WING', poly, v2)}
${list('vec3', 'DC_DR_SCAL', scallops, v3)}
${tubes('DC_DR_BONE', bn)}
${tubes('DC_DR_LEG', legs)}
${tubes('DC_DR_CLAW', claws)}
const vec3 DC_DR_HORNA[ 4 ] = vec3[ 4 ]( ${H.horns.map((t) => v3(t[0])).join(', ')} );
const vec3 DC_DR_HORNB[ 4 ] = vec3[ 4 ]( ${H.horns.map((t) => v3(t[1])).join(', ')} );
const vec3 DC_DR_IVORY = vec3( 0.86, 0.8, 0.66 );
// a tapered tube from a to b (xy, radius): (signed distance, parameter along it, lateral offset
// over the radius: -1 .. 1 across the tube); nrm = its unit side direction
vec3 dcDrTube( vec2 p, vec3 a, vec3 b, out vec2 nrm ) {
	vec2 pa = p - a.xy;
	vec2 ba = b.xy - a.xy;
	float l2 = max( dot( ba, ba ), 1e-8 );
	float h = clamp( dot( pa, ba ) / l2, 0.0, 1.0 );
	float r = mix( a.z, b.z, h );
	nrm = vec2( - ba.y, ba.x ) * inversesqrt( l2 );
	return vec3( length( pa - ba * h ) - r, h, clamp( dot( pa, nrm ) / max( r, 1e-4 ), - 1.0, 1.0 ) );
}
// the signed distance to the wing membrane's polygon (the right wing)
float dcDrPoly( vec2 p ) {
	float d = dot( p - DC_DR_WING[ 0 ], p - DC_DR_WING[ 0 ] );
	float s = 1.0;
	for ( int i = 0; i < DC_DR_NWING; i ++ ) {
		int j = i == 0 ? DC_DR_NWING - 1 : i - 1;
		vec2 e = DC_DR_WING[ j ] - DC_DR_WING[ i ];
		vec2 w = p - DC_DR_WING[ i ];
		vec2 b = w - e * clamp( dot( w, e ) / dot( e, e ), 0.0, 1.0 );
		d = min( d, dot( b, b ) );
		bvec3 c = bvec3( p.y >= DC_DR_WING[ i ].y, p.y < DC_DR_WING[ j ].y, e.x * w.y > e.y * w.x );
		if ( all( c ) || all( not( c ) ) ) s = - s;
	}
	return s * sqrt( d );
}
// "over": layer colour col at coverage a onto acc (straight colour, opacity)
void dcDrOver( inout vec4 acc, vec3 col, float a ) {
	acc.rgb = mix( acc.rgb, col, a );
	acc.a = a + ( 1.0 - a ) * acc.a;
}
// the dragon on the unit card (head towards +y): straight albedo and coverage; ex = (in-plane
// normal tilt, translucency, gloss), glow = emission (the eye)
vec4 dcDrDragon( vec2 uv, float aa, out vec4 ex, out float glow ) {
	vec3 c0 = uInteriorColors[ 0 ];
	vec3 c1 = uInteriorColors[ 1 ];
	float sx = uv.x < 0.0 ? - 1.0 : 1.0; // the side (the left wing and legs mirror the right)
	vec2 w = vec2( abs( uv.x ), uv.y );
	vec2 nn;
	vec3 t;
	glow = 0.0;
	// wing bones: the nearest one
	float dB = 1e9;
	float lB = 0.0;
	float hB = 0.0;
	vec2 nB = vec2( 0.0 );
	int iB = 0;
	for ( int i = 0; i < DC_DR_NBONE; i ++ ) {
		t = dcDrTube( w, DC_DR_BONEA[ i ], DC_DR_BONEB[ i ], nn );
		if ( t.x < dB ) { dB = t.x; hB = t.y; lB = t.z; nB = nn; iB = i; }
	}
	// the membrane: the polygon with its trailing edges scalloped
	float dM = dcDrPoly( w );
	for ( int i = 0; i < 4; i ++ ) dM = max( dM, DC_DR_SCAL[ i ].z - length( w - DC_DR_SCAL[ i ].xy ) );
	vec4 acc = vec4( 0.0 );
	ex = vec4( 0.0, 0.0, 0.0, 0.0 );
	float cM = 1.0 - smoothstep( - aa, aa, dM );
	if ( cM > 0.0 ) {
		// veins fanning from the wrist, cross veins in arcs round it
		vec2 rw = w - DC_DR_BONEB[ 1 ].xy;
		float rr = length( rw );
		float ang = atan( rw.y, abs( rw.x ) < 1e-6 ? 1e-6 : rw.x ); // (never atan( 0, 0 ))
		float vl = abs( fract( ang / 0.13 ) - 0.5 ) * 0.13 * rr;
		float vein = ( 1.0 - smoothstep( 0.003, 0.008, vl ) ) * smoothstep( 0.06, 0.16, rr );
		float xl = abs( fract( rr / 0.1 + 0.18 * sin( ang * 11.0 ) ) - 0.5 ) * 0.1;
		float xv = ( 1.0 - smoothstep( 0.002, 0.006, xl ) ) * smoothstep( 0.12, 0.2, rr ) * 0.6;
		// darker by the bones and at the rim, the panels' middles lighter and thinner
		float nearB = 1.0 - smoothstep( 0.0, 0.07, dB );
		float rim = 1.0 - smoothstep( 0.0, 0.035, - dM );
		vec3 mc = c1 * ( 0.78 + 0.3 * smoothstep( 0.02, 0.16, dB ) );
		mc = mix( mc, c1 * c1 * 0.7, 0.45 * nearB );
		mc = mix( mc, mix( c0, c1, 0.35 ) * 0.8, 0.8 * max( vein, xv ) );
		mc = mix( mc, c0 * 0.7, 0.75 * rim );
		float ma = cM * mix( 0.66, 0.92, max( max( rim, nearB * 0.8 ), max( vein, xv ) ) );
		dcDrOver( acc, mc, ma );
		// stretched between the bones: tilted gently away from the nearest one
		vec2 tm = - nB * 0.25 * lB * ( 1.0 - nearB );
		ex = vec4( tm.x * sx, tm.y, mix( 1.0, 0.5, rim ), 0.2 );
	}
	// the bones over the membrane: raised tubes, the thumb's claw ivory
	float cB = 1.0 - smoothstep( - aa * 0.7, aa * 0.7, dB );
	if ( cB > 0.0 ) {
		vec3 bc = c0 * ( 0.85 + 0.25 * ( 1.0 - abs( lB ) ) );
		if ( iB == 2 ) bc = mix( bc, DC_DR_IVORY, smoothstep( 0.45, 0.75, hB ) );
		dcDrOver( acc, bc, cB );
		vec2 tb = nB * lB * 0.8;
		ex = mix( ex, vec4( tb.x * sx, tb.y, 0.15, 0.7 ), cB );
	}
	// legs and claws
	float dL = 1e9;
	float lL = 0.0;
	vec2 nL = vec2( 0.0 );
	for ( int i = 0; i < DC_DR_NLEG; i ++ ) {
		t = dcDrTube( w, DC_DR_LEGA[ i ], DC_DR_LEGB[ i ], nn );
		if ( t.x < dL ) { dL = t.x; lL = t.z; nL = nn; }
	}
	float dC = 1e9;
	float hC = 0.0;
	for ( int i = 0; i < DC_DR_NCLAW; i ++ ) {
		t = dcDrTube( w, DC_DR_CLAWA[ i ], DC_DR_CLAWB[ i ], nn );
		if ( t.x < dC ) { dC = t.x; hC = t.y; }
	}
	float cC = 1.0 - smoothstep( - aa * 0.6, aa * 0.6, dC );
	if ( cC > 0.0 ) {
		dcDrOver( acc, mix( c0, DC_DR_IVORY, smoothstep( 0.3, 0.7, hC ) ), cC );
		ex = mix( ex, vec4( 0.0, 0.0, 0.0, 0.8 ), cC );
	}
	float cL = 1.0 - smoothstep( - aa, aa, dL );
	if ( cL > 0.0 ) {
		dcDrOver( acc, c0 * ( 0.7 + 0.35 * ( 1.0 - lL * lL ) ), cL );
		vec2 tl = nL * lL * 0.9;
		ex = mix( ex, vec4( tl.x * sx, tl.y, 0.0, 0.6 ), cL );
	}
	// the body and tail: the nearest spine tube
	float dS = 1e9;
	float sS = 0.0;
	float lS = 0.0;
	float rS = 0.0;
	vec2 nS = vec2( 0.0 );
	for ( int i = 0; i < DC_DR_NSP - 1; i ++ ) {
		t = dcDrTube( uv, DC_DR_SP[ i ], DC_DR_SP[ i + 1 ], nn );
		if ( t.x < dS ) {
			dS = t.x;
			sS = mix( DC_DR_SS[ i ], DC_DR_SS[ i + 1 ], t.y );
			lS = t.z;
			rS = mix( DC_DR_SP[ i ].z, DC_DR_SP[ i + 1 ].z, t.y );
			nS = nn;
		}
	}
	// the spade: a barbed arrowhead at the tail's tip
	vec2 sd = vec2( ${f(dir[0])}, ${f(dir[1])} );
	vec2 sq = uv - vec2( ${f(tip[0])}, ${f(tip[1])} );
	vec2 sp = vec2( dot( sq, sd ), abs( dot( sq, vec2( - sd.y, sd.x ) ) ) );
	float dP = max( dot( sp - vec2( ${f(SPADE.len)}, 0.0 ), normalize( vec2( ${f(SPADE.half)}, ${f(SPADE.len)} ) ) ), - sp.x );
	dP = max( dP, ${f(SPADE.notch[1])} - length( sp - vec2( ${f(SPADE.notch[0])}, 0.0 ) ) );
	float cS = 1.0 - smoothstep( - aa, aa, min( dS, dP ) );
	if ( cS > 0.0 ) {
		// scales: overlapping rows across the tube, each scale's rim darker
		float su = sS / 0.03;
		float sv = lS * rS / 0.024 + 0.5 * mod( floor( su ), 2.0 );
		vec2 sc = vec2( fract( su ), fract( sv ) - 0.5 );
		float scale = smoothstep( 0.25, 0.55, length( vec2( sc.x * 0.8, sc.y ) ) );
		float side = lS * lS;
		vec3 bc = c0 * ( 0.95 + 0.25 * ( 1.0 - side ) ) * ( 1.0 - 0.2 * scale ) * ( 1.0 - 0.35 * side );
		// the dorsal ridge: plates pointing down the tail along the middle
		float plate = 1.0 - smoothstep( - aa * 0.5, aa * 0.5, abs( lS ) * rS - 0.35 * rS * ( 1.0 - fract( sS / 0.045 ) ) );
		bc = mix( bc, c0 * 0.55, plate * smoothstep( 0.03, 0.08, sS ) );
		bc = mix( bc, c0 * ( 0.9 - 0.2 * sp.y / ${f(SPADE.half)} ), step( dP, dS ) );
		dcDrOver( acc, min( bc, vec3( 1.0 ) ), cS );
		vec2 ts = nS * lS * 0.95;
		ex = mix( ex, vec4( ts, 0.0, 0.9 ), cS );
	}
	// the head in profile, in head units (the head's parts scaled by HEAD_SCALE about its
	// joint; ha: the anti-alias width there): skull, upper and open lower jaw, teeth, horns, eye
	vec2 hq = ( uv - vec2( ${f(HEAD[0])}, ${f(HEAD[1])} ) ) / ${f(HEAD_SCALE)};
	float ha = aa / ${f(HEAD_SCALE)};
	vec2 ke = ( hq - vec2( ${f(H.skull.c[0])}, ${f(H.skull.c[1])} ) ) / vec2( ${f(H.skull.r[0])}, ${f(H.skull.r[1])} );
	float dK = ( length( ke ) - 1.0 ) * ${f(Math.min(...H.skull.r))};
	vec3 tu = dcDrTube( hq, ${v3(H.upper[0])}, ${v3(H.upper[1])}, nn );
	vec3 tlw = dcDrTube( hq, ${v3(H.lower[0])}, ${v3(H.lower[1])}, nn );
	float dH = min( dK, min( tu.x, tlw.x ) );
	// teeth: a saw of small points down from the upper jaw, into the open mouth
	// (on the jaw's underside: tu.z < 0; each point narrowing away from the jaw)
	float tooth = max( abs( fract( hq.x / 0.022 ) - 0.5 ) * 0.022 - 0.006 * ( 1.0 - tu.x / 0.013 ), tu.x - 0.013 );
	tooth = max( tooth, max( max( 0.075 - hq.x, hq.x - 0.165 ), tu.z * 0.02 ) );
	float dHo = 1e9;
	float hHo = 0.0;
	for ( int i = 0; i < 4; i ++ ) {
		t = dcDrTube( hq, DC_DR_HORNA[ i ], DC_DR_HORNB[ i ], nn );
		if ( t.x < dHo ) { dHo = t.x; hHo = t.y + ( i == 1 || i == 3 ? 1.0 : 0.0 ); }
	}
	float cT = 1.0 - smoothstep( - ha * 0.5, ha * 0.5, tooth );
	if ( cT > 0.0 ) dcDrOver( acc, DC_DR_IVORY, cT * 0.9 );
	float cHo = 1.0 - smoothstep( - ha * 0.7, ha * 0.7, dHo );
	if ( cHo > 0.0 ) {
		dcDrOver( acc, mix( DC_DR_IVORY * 0.6, DC_DR_IVORY, smoothstep( 0.1, 1.5, hHo ) ), cHo );
		ex = mix( ex, vec4( 0.0, 0.0, 0.0, 0.8 ), cHo );
	}
	float cH = 1.0 - smoothstep( - ha, ha, dH );
	if ( cH > 0.0 ) {
		// lit along the top of the skull and snout, the lower jaw darker, a brow over the eye
		vec3 hc = c0 * ( 0.8 + 0.3 * smoothstep( - 0.6, 0.6, tu.z ) * step( tu.x, tlw.x ) );
		hc *= tlw.x < tu.x && tlw.x < dK ? 0.72 : 1.0;
		hc *= 1.0 - 0.35 * ( 1.0 - smoothstep( 0.0, 0.006, abs( length( ( hq - vec2( 0.055, 0.048 ) ) * vec2( 0.8, 1.3 ) ) - 0.02 ) ) ) * step( 0.04, hq.y );
		// a nostril near the snout
		hc *= 1.0 - 0.6 * ( 1.0 - smoothstep( 0.004, 0.008, length( hq - vec2( 0.165, 0.048 ) ) ) );
		dcDrOver( acc, hc, cH );
		ex = mix( ex, vec4( ( hq - vec2( 0.06, 0.02 ) ) / max( length( hq - vec2( 0.06, 0.02 ) ), 1e-4 ) * 0.4, 0.0, 0.8 ), cH );
		// the eye: a glowing gold almond with a slit pupil
		vec2 eq = hq - vec2( ${f(H.eye[0])}, ${f(H.eye[1])} );
		float de = length( eq * vec2( 0.8, 1.4 ) ) - ${f(H.eye[2])};
		float ce = ( 1.0 - smoothstep( - ha * 0.4, ha * 0.4, de ) ) * cH;
		float pupil = 1.0 - smoothstep( 0.0015, 0.003, abs( eq.x ) );
		vec3 gold = mix( vec3( 1.0, 0.82, 0.25 ), c1, 0.25 );
		dcDrOver( acc, mix( gold, vec3( 0.05 ), pupil ), ce );
		glow = ce * ( 1.0 - pupil ) * 0.6;
	}
	return vec4( min( acc.rgb, vec3( 1.0 ) ), clamp( acc.a, 0.0, 1.0 ) );
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	// the card through the centre, facing the die's up
	vec3 n = dcIUp;
	float dn = dot( rd, n );
	if ( abs( dn ) < 1e-4 ) return vec4( 0.0 );
	float t = - dot( p, n ) / dn;
	if ( t < 0.0 || t >= dt ) return vec4( 0.0 );
	float R = mix( ${f(DRAGON.radius[0])}, ${f(DRAGON.radius[1])}, uInteriorDensity );
	vec3 q = p + rd * t;
	if ( dot( q, q ) >= R * R ) return vec4( 0.0 );
	// the continuous up frame (dragonFrame in JS): t1 = DRAGON.axis projected off n (another axis
	// where they are parallel), t2 = n x t1 (right-handed, never mirrored)
	vec3 dcDrN = n;
	vec3 dcDrT1;
	vec3 dcDrT2;
${upFrameGLSL('dcDr', `vec3( ${DRAGON.axis.map(f).join(', ')} )`)}
	vec2 uv = vec2( dot( q, dcDrT1 ), dot( q, dcDrT2 ) ) / R;
	float aa = ${f(DRAGON.aa[0])} + ${f(DRAGON.aa[1])} * ( 1.0 - abs( dn ) );
	vec4 ex;
	float glow;
	vec4 m = dcDrDragon( uv, aa, ex, glow );
	if ( m.a <= 0.0 ) return vec4( 0.0 );
	// two-sided: the side facing the eye, tilted by the relief
	vec3 nf = normalize( n + ex.x * dcDrT1 + ex.y * dcDrT2 );
	nf = dot( rd, nf ) > 0.0 ? - nf : nf;
	float kd = dot( nf, dcIKey );
	float wrap = clamp( ( kd + 0.35 ) / 1.35, 0.0, 1.0 );
	vec3 col = m.rgb * ( dcILight * ( 0.3 + 0.7 * wrap ) + 0.12 );
	// the key light through the membranes from behind
	col += m.rgb * ex.z * 0.7 * max( - kd, 0.0 ) * ( dcILight + 0.3 );
	float rk = max( dot( reflect( rd, nf ), dcIKey ), 0.0 );
	col += ( m.rgb * 0.5 + 0.35 ) * ex.w * ( 0.9 * pow( rk, 40.0 ) + 0.15 * pow( rk, 6.0 ) );
	col += vec3( 1.0, 0.85, 0.4 ) * glow;
	return vec4( min( col, vec3( 1.0 ) ) * m.a, m.a );
}
`;
}

/**
 * @param {object} _a normalized appearance whose interior is type 'shape' with shape dragon
 * @returns {{ body: string }} the dragon's GLSL (every colour and the density are uniforms)
 */
export function dragonInside(_a, live = false) {
  const b = body();
  // insideMotion: the eye's glow breathes 0.8 .. 1.0 over 3 s (uInteriorTime, MOTION_PARS in the pars)
  const at = 'col += vec3( 1.0, 0.85, 0.4 ) * glow;';
  // and the inside flare brightens it (live.js brighten)
  if (!live) return { body: b };
  return { body: brighten(swap(b, at, 'col += vec3( 1.0, 0.85, 0.4 ) * glow * ( 0.9 + 0.1 * sin( uInteriorTime * 2.0944 ) );'), 'Dr') };
}

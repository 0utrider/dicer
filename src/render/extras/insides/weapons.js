import { upFrame, upFrameGLSL } from './frame.js';
import { brighten } from './live.js';

/**
 * Weapons inside (plan 3b): a floating sword, axe or shield, one program per shape (programKey
 * carries the shape id; `#define DC_WE_KIND 0/1/2` selects the shape and its material zones).
 *
 * Geometry: a signed-distance function in a unit frame (the shape is about 3 units long), rotated
 * by uShapeRot like interior.js's shape march and scaled by INTERIOR.shapeScale x mix(0.8, 1.15,
 * density). The shapes are flat-ish in the unit frame's xy plane (the shield's front is +z). After
 * uShapeRot, the unit frame is a continuous right-handed frame (as botanical.js's cards): z = the
 * die's current up n (uShapeRot * dcIUp), x = the constant WEAPON.axis projected off n, y = n x x.
 * So a thin blade is never seen edge-on from above and the shield always shows its emblem, with
 * no mirror and no switch: the weapon turns smoothly while the die tumbles. The frame is singular
 * only where n is along WEAPON.axis (a quick turn there, never a flip); the axis lies in the
 * coin's plane and at least 21 degrees off every die's resting up (weaponFrame, tested).
 *
 * March: the blade is thinner (~0.07 unit, >= 0.02 canonical at density 0) than one step of the
 * lowest marched tier (2 x 0.62 / 16 = 0.078 canonical), so testing segment ends alone would
 * step over it. Each segment that comes within its own length of the surface is sphere-traced
 * (exact SDF steps cannot pass through a surface, however thin), the hit is refined by bisection
 * when the last step overshot, and rays that miss within DC_WE_AA of the surface get partial
 * coverage at their closest approach (the soft silhouette). Elsewhere: a colors[1] haze halo
 * thickening towards the surface, as the shape march's.
 *
 * Materials by zone (dcWeMap's .y): 0 polished steel (bright key specular, cool environment
 * tint from dcILight, a sky catchlight and a bright edge glint on the bevels, .z); 1 colors[0],
 * rough (grip wrap, haft, shield face; .w darkens the wrap grooves and wood grain); 2 colors[1],
 * glossy trim (guard, pommel, rim, emblem, caps); 3 a colors[1] gem; 4 the shield's back
 * (colors[0], darker planks). Wrap diffuse, specular and SDF ambient occlusion as the shape march.
 */
export const USES_NOISE = false;

/** Shape ids in DC_WE_KIND order. */
export const WE_KINDS = Object.freeze(['sword', 'axe', 'shield']);

export const WEAPON = Object.freeze({
  /** INTERIOR.shapeScale, a local copy (importing it would add a world-start export) */
  shapeScale: 0.35,
  /** soft silhouette width (canonical frame), as shape's DC_SHAPE_AA */
  aa: 0.012,
  /** sphere-trace steps per segment that comes near the surface */
  trace: 14,
  /**
   * The frame's x before projection, in the post-uShapeRot frame: in the xy plane (so off the
   * coin's up, +-z), at the angle (147 degrees) that keeps it furthest from every die's resting
   * up under SHAPE_ROT.die (|cos| <= 0.931). Rounded as the GLSL gets it.
   */
  axis: Object.freeze([-0.8387, 0.5446, 0]),
  /** canonical thickness of the blade and axe edges at density 0 (>= 0.02, tested) */
  edgeUnit: 2 * (0.028 + 0.008),
  /** furthest point of each kind from the centre in the unit frame (inside the sphere at density 1, tested) */
  extent: Object.freeze({ sword: 1.509, axe: 1.51, shield: 1.23 }),
});

const f = (x) => x.toFixed(4);

/**
 * The GLSL frame in JS (for tests): up = the die's up in the canonical frame (unit), rot =
 * uShapeRot (column-major). Returns { n, t1, t2 } in the post-uShapeRot frame.
 */
export function weaponFrame(up, rot) {
  const n = [0, 1, 2].map((r) => rot[r] * up[0] + rot[3 + r] * up[1] + rot[6 + r] * up[2]);
  return upFrame(n, WEAPON.axis);
}

const COMMON = /* glsl */ `
uniform mat3 uShapeRot;
#define DC_WE_AA ${f(WEAPON.aa)}
#define DC_WE_TRACE ${WEAPON.trace}
float dcWeS; // unit frame -> canonical scale (set per segment)
// the unit frame's axes in the post-uShapeRot frame (set per segment): z along the die's up
vec3 dcWeT1;
vec3 dcWeT2;
vec3 dcWeN;
// rounded box, distance to a segment with its parameter, closer of two (d, zone, edge, detail)
float dcWeBox( vec3 p, vec3 b, float r ) {
	vec3 q = abs( p ) - b + r;
	return length( max( q, 0.0 ) ) + min( max( q.x, max( q.y, q.z ) ), 0.0 ) - r;
}
float dcWeBox2( vec2 p, vec2 b ) {
	vec2 q = abs( p ) - b;
	return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 );
}
vec2 dcWeSeg( vec3 p, vec3 a, vec3 b ) {
	vec3 pa = p - a;
	vec3 ba = b - a;
	float h = clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 );
	return vec2( length( pa - ba * h ), h );
}
vec4 dcWeU( vec4 a, vec4 b ) { return b.x < a.x ? b : a; }
`;

/**
 * Sword along +y: blade y -0.66 .. 1.5 (tapering, a curved point from 1.08, a diamond section
 * with a fuller down both faces), a crossguard with curved quillons and ball finials, a wrapped
 * grip between two ferrules and a round pommel with a gem set in each face.
 */
const SWORD = /* glsl */ `
vec4 dcWeMap( vec3 q ) {
	float ax = abs( q.x );
	float dcWeU0 = clamp( ( q.y + 0.66 ) / 2.16, 0.0, 1.0 );
	float tip = clamp( ( q.y - 1.08 ) / 0.42, 0.0, 1.0 );
	float w = mix( 0.145, 0.112, dcWeU0 ) * ( 1.0 - tip * tip );
	float d2 = max( ( ax - w ) * 0.8, max( - 0.66 - q.y, q.y - 1.5 ) );
	float e = clamp( ax / max( w, 0.001 ), 0.0, 1.0 ); // 0 on the spine, 1 at the edge
	float fuller = ( 1.0 - smoothstep( 0.016, 0.038, ax ) ) * smoothstep( - 0.62, - 0.52, q.y ) * ( 1.0 - smoothstep( 0.72, 0.88, q.y ) );
	float halfT = mix( 0.066, 0.028, e ) - 0.024 * fuller;
	vec4 r = vec4( max( d2, 0.7 * ( abs( q.z ) - halfT ) ) - 0.008, 0.0, smoothstep( 0.62, 0.95, e ) + 0.6 * tip, fuller );
	// crossguard: a bar whose quillons curve towards the blade, a centre block, ball finials
	float gy = q.y + 0.71 - 0.1 * q.x * q.x;
	float guard = min( dcWeBox( vec3( q.x, gy, q.z ), vec3( 0.4, 0.042, 0.052 ), 0.02 ),
		dcWeBox( vec3( q.x, q.y + 0.71, q.z ), vec3( 0.085, 0.07, 0.072 ), 0.025 ) );
	guard = min( guard, length( vec3( ax - 0.42, q.y + 0.692, q.z ) ) - 0.06 );
	r = dcWeU( r, vec4( guard, 2.0, 0.0, 0.0 ) );
	// grip: leather wrap (raised bands, slightly helical) between two ferrules
	float band = smoothstep( 0.55, 1.0, abs( sin( q.y * 36.0 + q.x * 14.0 ) ) );
	vec2 g = dcWeSeg( q, vec3( 0.0, - 1.24, 0.0 ), vec3( 0.0, - 0.77, 0.0 ) );
	r = dcWeU( r, vec4( ( g.x - 0.064 - 0.01 * ( 1.0 - band ) ) * 0.85, 1.0, 0.0, band ) );
	float ferrule = min( length( vec2( length( q.xz ) - 0.066, q.y + 0.785 ) ), length( vec2( length( q.xz ) - 0.066, q.y + 1.225 ) ) ) - 0.02;
	r = dcWeU( r, vec4( ferrule, 2.0, 0.0, 0.0 ) );
	// pommel and its gems
	vec3 pm = q - vec3( 0.0, - 1.36, 0.0 );
	r = dcWeU( r, vec4( length( pm ) - 0.11, 2.0, 0.0, 0.0 ) );
	r = dcWeU( r, vec4( length( vec3( pm.xy, abs( pm.z ) - 0.068 ) ) - 0.055, 3.0, 0.0, 0.0 ) );
	return r;
}
`;

/**
 * Axe: a haft along y (wrapped low, wood grain above, a butt cap), a socket at y 0.78 carrying a
 * crescent blade on +x (the cutting arc between two horns, an etched line along it, the cheeks
 * thinning to a bevelled edge), a back spike on -x and a short top spike.
 */
const AXE = /* glsl */ `
vec4 dcWeMap( vec3 q ) {
	const float H = 0.78;
	// haft
	vec2 hs = dcWeSeg( q, vec3( 0.0, - 1.4, 0.0 ), vec3( 0.0, 1.08, 0.0 ) );
	float wrapped = 1.0 - smoothstep( - 0.72, - 0.68, q.y );
	float band = smoothstep( 0.55, 1.0, abs( sin( q.y * 34.0 + q.x * 14.0 ) ) );
	float grain = 0.5 + 0.5 * sin( q.x * 70.0 + 2.0 * sin( q.y * 6.0 + q.z * 30.0 ) );
	float hr = 0.057 + 0.008 * smoothstep( - 0.8, - 1.3, q.y ) - 0.009 * wrapped * ( 1.0 - band );
	vec4 r = vec4( ( hs.x - hr ) * 0.85, 1.0, 0.0, mix( 0.3 * grain, band, wrapped ) );
	// butt cap and the ring that ends the wrap
	float cap = min( length( q - vec3( 0.0, - 1.42, 0.0 ) ) - 0.078, length( vec2( length( q.xz ) - 0.064, q.y + 0.69 ) ) - 0.019 );
	r = dcWeU( r, vec4( cap, 2.0, 0.0, 0.0 ) );
	// socket
	float head = dcWeBox( q - vec3( 0.0, H, 0.0 ), vec3( 0.1, 0.19, 0.085 ), 0.03 );
	// crescent blade: a disc's arc, its top and bottom bitten by two discs into horns
	vec2 c = vec2( q.x, q.y - H );
	float outer = length( c - vec2( 0.02, 0.0 ) ) - 0.74;
	float d2 = max( outer, 0.5 - length( c - vec2( 0.12, 0.63 ) ) );
	d2 = max( d2, 0.5 - length( c - vec2( 0.12, - 0.63 ) ) );
	d2 = max( d2, 0.04 - c.x );
	float halfT = mix( 0.08, 0.045, smoothstep( 0.08, 0.5, c.x ) );
	float bevel = smoothstep( - 0.1, 0.0, outer );
	halfT = mix( halfT, 0.028, bevel );
	float etch = 1.0 - smoothstep( 0.004, 0.01, abs( outer + 0.14 ) );
	r = dcWeU( r, vec4( max( d2, 0.75 * ( abs( q.z ) - halfT ) ) - 0.008, 0.0, smoothstep( 0.45, 0.95, bevel ), etch ) );
	r = dcWeU( r, vec4( head, 0.0, 0.0, 0.0 ) );
	// back spike and top spike: tapered cones
	vec2 bs = dcWeSeg( q, vec3( - 0.06, H + 0.02, 0.0 ), vec3( - 0.48, H - 0.07, 0.0 ) );
	r = dcWeU( r, vec4( ( bs.x - mix( 0.062, 0.012, bs.y ) ) * 0.9, 0.0, bs.y * bs.y, 0.0 ) );
	vec2 ts = dcWeSeg( q, vec3( 0.0, H + 0.18, 0.0 ), vec3( 0.0, H + 0.36, 0.0 ) );
	r = dcWeU( r, vec4( ( ts.x - mix( 0.05, 0.012, ts.y ) ) * 0.9, 0.0, ts.y * ts.y, 0.0 ) );
	return r;
}
`;

/**
 * Shield: a round board (radius 1.15) domed towards +z (a shell of a radius-3.2 sphere), a rim
 * all round, a steel boss with a flange, a raised cross on the face and a ring of twelve rivets;
 * the back is darker planks.
 */
const SHIELD = /* glsl */ `
vec4 dcWeMap( vec3 q ) {
	const float RS = 3.2;
	const float R = 1.15;
	vec3 dcWeC = vec3( 0.0, 0.0, 0.16 - RS );
	float rr = length( q.xy );
	float sph = length( q - dcWeC ) - RS; // > 0 in front of the face
	float shell = abs( sph + 0.045 ) - 0.045;
	float board = max( shell, rr - R );
	float seam = 1.0 - smoothstep( 0.0, 0.03, abs( fract( q.x * 2.6 ) - 0.5 ) - 0.47 );
	vec4 r = vec4( board, sph > - 0.045 ? 1.0 : 4.0, 0.0, sph > - 0.045 ? 0.0 : seam );
	// rim
	float zE = - RS + 0.16 + sqrt( RS * RS - R * R ) - 0.045;
	r = dcWeU( r, vec4( length( vec2( rr - R, q.z - zE ) ) - 0.075, 2.0, 0.0, 0.0 ) );
	// emblem: a cross raised 0.035 off the face
	float cr = min( dcWeBox2( q.xy, vec2( 0.11, 0.78 ) ), dcWeBox2( q.xy, vec2( 0.78, 0.11 ) ) );
	r = dcWeU( r, vec4( max( cr, max( sph - 0.035, - sph - 0.06 ) ) - 0.008, 2.0, 0.0, 0.0 ) );
	// rivets: twelve round heads on the face, between the cross and the rim
	float ang = rr > 1e-4 ? atan( q.y, q.x ) : 0.0;
	float sec = 0.5235988;
	float a = mod( ang + 0.5 * sec, sec ) - 0.5 * sec;
	r = dcWeU( r, vec4( length( vec3( rr * cos( a ) - 0.98, rr * sin( a ), sph ) ) - 0.045, 0.0, 0.0, 0.0 ) );
	// boss: a steel dome over the centre, ringed by a flange
	float boss = max( length( q - vec3( 0.0, 0.0, 0.06 ) ) - 0.3, 0.1 - q.z );
	boss = min( boss, length( vec2( rr - 0.3, q.z - 0.14 ) ) - 0.035 );
	r = dcWeU( r, vec4( boss, 0.0, 0.0, 0.0 ) );
	return r;
}
`;

// per kind: the map, the in-plane angle that lays it diagonally and the offset that centres it
const KINDS = [
  { map: SWORD, angle: Math.PI / 4, offset: [0, 0] },
  { map: AXE, angle: -Math.PI / 5, offset: [0.135, -0.175] },
  { map: SHIELD, angle: 0, offset: [0, 0] },
];

const march = (kind) => {
  const { angle, offset } = KINDS[kind];
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return /* glsl */ `
// canonical point -> unit frame: uShapeRot, the scale, the up frame, the diagonal lay
vec3 dcWeLocal( vec3 p ) {
	vec3 q0 = uShapeRot * p / dcWeS;
	vec3 q = vec3( dot( q0, dcWeT1 ), dot( q0, dcWeT2 ), dot( q0, dcWeN ) );
	q.xy = mat2( ${f(c)}, ${f(s)}, ${f(-s)}, ${f(c)} ) * q.xy + vec2( ${f(offset[0])}, ${f(offset[1])} );
	return q;
}
float dcWeSd( vec3 p ) { return dcWeMap( dcWeLocal( p ) ).x * dcWeS; }
vec3 dcWeNormal( vec3 p ) {
	const vec2 k = vec2( 1.0, - 1.0 );
	const float e = 0.003;
	return normalize( k.xyy * dcWeSd( p + k.xyy * e ) + k.yyx * dcWeSd( p + k.yyx * e )
		+ k.yxy * dcWeSd( p + k.yxy * e ) + k.xxx * dcWeSd( p + k.xxx * e ) );
}
vec3 dcWeShade( vec3 hp, vec3 rd ) {
	vec3 n = dcWeNormal( hp );
	vec4 m = dcWeMap( dcWeLocal( hp ) );
	int zone = int( m.y + 0.5 );
	vec3 v = - rd;
	float nv = clamp( dot( n, v ), 0.0, 1.0 );
	float wrap = clamp( ( dot( n, dcIKey ) + 0.4 ) / 1.4, 0.0, 1.0 );
	float ao = clamp( 0.5 + 0.5 * dcWeSd( hp + n * 0.02 ) / 0.02, 0.0, 1.0 );
	vec3 rf = reflect( rd, n );
	float rk = max( dot( rf, dcIKey ), 0.0 );
	// the bright sky above the die, a little towards the key light: a catchlight that stays
	// when the key light is behind the shape
	float rc = max( dot( rf, normalize( dcIUp + 0.5 * dcIKey ) ), 0.0 );
	float sky = smoothstep( - 0.4, 1.0, dot( rf, dcIUp ) );
	float fres = pow( clamp( 1.0 - nv, 0.0, 1.0 ), 5.0 );
	vec3 col;
	if ( zone == 0 ) {
		// polished steel: a dark base, the cool environment mirrored (more at grazing angles),
		// a sharp key highlight with a softer lobe, the sky catchlight and the edge glint
		// (the sky mirrored only near the zenith, a dark horizon band below: faces and bevels
		// tilted differently read as different brightnesses, as on real polished metal)
		float zen = smoothstep( 0.8, 0.99, dot( rf, dcIUp ) );
		vec3 env = dcILight * vec3( 0.74, 0.85, 1.0 ) * ( 0.08 + 0.22 * sky + 0.7 * zen );
		col = vec3( 0.06, 0.065, 0.075 ) * ( dcILight * ( 0.3 + 0.7 * wrap ) + 0.08 ) + env * mix( 0.6, 1.0, fres ) * ( 1.0 - 0.5 * m.w );
		col *= 0.6 + 0.4 * ao;
		col += vec3( 1.0 ) * ( 2.4 * pow( rk, 90.0 ) + 0.3 * pow( rk, 10.0 ) );
		col += vec3( 0.92, 0.96, 1.0 ) * ( 1.3 * smoothstep( 0.985, 0.997, rc ) + 0.18 * pow( rc, 14.0 ) );
		col += clamp( m.z, 0.0, 1.0 ) * ( vec3( 0.8, 0.88, 1.0 ) * ( 0.3 * dcILight + 0.12 ) + 1.6 * pow( rk, 6.0 ) + 0.7 * pow( rc, 6.0 ) );
	} else if ( zone == 3 ) {
		// a gem: deep colour inside, lighter towards the facing centre, a hard white sparkle
		vec3 c1 = uInteriorColors[ 1 ];
		col = c1 * c1 * ( 0.25 + 0.75 * nv ) * ( dcILight + 0.35 );
		col += vec3( 1.0 ) * ( 3.0 * pow( rk, 200.0 ) + 1.5 * smoothstep( 0.99, 0.998, rc ) ) + c1 * fres * 0.6;
	} else if ( zone == 2 ) {
		// glossy colors[1] trim: metallic, tinted reflections of the sky and the key light
		vec3 c1 = uInteriorColors[ 1 ];
		col = c1 * ( dcILight * ( 0.2 + 0.55 * wrap ) + 0.08 ) * ao + c1 * dcILight * sky * ( 0.35 + 0.5 * fres );
		col += ( c1 * 0.6 + 0.4 ) * ( 1.8 * pow( rk, 60.0 ) + 0.25 * pow( rk, 8.0 ) + 1.0 * smoothstep( 0.99, 0.998, rc ) );
	} else {
		// colors[0], rough: the wrap's grooves, the grain and the shield's back darker
		vec3 c0 = uInteriorColors[ 0 ] * ( 1.0 - 0.45 * m.w ) * ( zone == 4 ? 0.55 : 1.0 );
		col = c0 * ( dcILight * ( 0.25 + 0.75 * wrap ) + 0.12 ) * ao + ( c0 + 0.25 ) * 0.22 * pow( rk, 14.0 );
	}
	return min( col, vec3( 1.0 ) );
}
vec4 dcInterior( vec3 p, vec3 rd, float dt ) {
	dcWeS = ${f(WEAPON.shapeScale)} * mix( 0.8, 1.15, uInteriorDensity );
	// the continuous up frame (weaponFrame in JS): z = the die's up, x = WEAPON.axis projected
	// off it (another axis where they are parallel), y = z x x (right-handed, no mirror)
	dcWeN = uShapeRot * dcIUp;
${upFrameGLSL('dcWe', `vec3( ${WEAPON.axis.map(f).join(', ')} )`)}
	float h = dcWeSd( p );
	float a = dcIAlpha( mix( 0.15, 1.4, uInteriorDensity ) * exp( - max( h, 0.0 ) * 10.0 ) * dcIEdge( p ), dt );
	vec4 haze = vec4( uInteriorColors[ 1 ] * ( dcILight + 0.4 ) * a, a );
	// no surface within the segment's length of its start: the whole segment misses
	if ( h > dt + DC_WE_AA ) return haze;
	float t = 0.0;
	float tp = 0.0;
	float best = h;
	float tb = 0.0;
	for ( int dcWeI = 0; dcWeI < DC_WE_TRACE; dcWeI ++ ) {
		if ( h < 0.0004 ) break;
		tp = t;
		t += max( h, 0.0015 );
		if ( t > dt ) break;
		h = dcWeSd( p + rd * t );
		if ( h < best ) { best = h; tb = t; }
	}
	// the trace ran out on a grazing ray before the segment's end: if the end is inside, bisect
	// between the last trace point and the end (as the plain march), so nothing shows through
	if ( h >= 0.0004 && t <= dt && dcWeSd( p + rd * dt ) < 0.0 ) {
		tp = t;
		t = dt;
		h = - 1.0;
	}
	if ( h < 0.0004 && t <= dt ) {
		if ( h < 0.0 ) {
			// inside (the last step overshot, or the end is): bisect back to the surface
			float lo = tp;
			float hi = t;
			for ( int dcWeB = 0; dcWeB < 4; dcWeB ++ ) {
				float mid = 0.5 * ( lo + hi );
				if ( dcWeSd( p + rd * mid ) < 0.0 ) hi = mid;
				else lo = mid;
			}
			t = hi;
		}
		return vec4( dcWeShade( p + rd * t, rd ), 1.0 );
	}
	if ( best < DC_WE_AA ) {
		float cover = 0.7 * ( 1.0 - max( best, 0.0 ) / DC_WE_AA );
		return vec4( dcWeShade( p + rd * tb, rd ) * cover, cover ) + ( 1.0 - cover ) * haze;
	}
	return haze;
}
`;
};

/**
 * @param {object} a normalized appearance whose interior is type 'shape' with shape sword, axe or shield
 * @param {boolean} [live] insideMotion: brightens with the inside flare (live.js brighten)
 * @returns {{ body: string }} the weapon's GLSL (every colour and the density are uniforms)
 */
export function weaponsInside(a, live = false) {
  const kind = WE_KINDS.indexOf(a.interior.shape);
  if (kind < 0) throw new Error(`dicer: not a weapon shape "${a.interior.shape}"`);
  const body = `#define DC_WE_KIND ${kind}\n${COMMON}${KINDS[kind].map}${march(kind)}`;
  return { body: live ? brighten(body, 'We') : body };
}

/**
 * Engraved face labels (moved verbatim from the Plan 1 dice-material.js).
 *
 * The labels are cut into the surface from the MSDF digit atlas. Per face, uLabels holds
 * 4 RGBA float texels (glyph 0 rect, glyph 0 uv rect, glyph 1 rect, glyph 1 uv rect; see
 * layoutLabel). The colour mask (ENGRAVE_COLOR) always runs, so the numbers are drawn on
 * every program; the recess (occlusion) and the wall normal tilt (ENGRAVE_NORMAL) only run
 * when DICER_ENGRAVE is defined.
 */

/** Recess depth per unit of engraveDepth, in face units (face inradius = 1). */
export const DEPTH_SCALE = 0.02;
/** Width of the sloped wall band at the glyph edge, in face units. */
export const WALL_BAND = 0.035;
/** Corner radius of the 6/9 mark's box, in face units. */
export const BOX_ROUND = 0.012;

/** Vertex shader: after `#include <common>`. */
export const ENGRAVE_VERTEX_PARS = /* glsl */ `
attribute float aFaceId;
attribute vec2 aFaceUV;
varying float vFaceId;
varying vec2 vFaceUV;
`;

/** Vertex shader: after `#include <begin_vertex>`. */
export const ENGRAVE_VERTEX = /* glsl */ `
	vFaceId = aFaceId;
	vFaceUV = aFaceUV;
`;

/** Fragment shader: after `#include <common>`. */
export const ENGRAVE_PARS = /* glsl */ `
uniform sampler2D uAtlas;
uniform highp sampler2D uLabels;
uniform vec3 uAtlasInfo; // distanceRange (px), atlas width, atlas height
uniform vec3 uFillColor;
uniform vec2 uFillPBR;   // fill metalness, fill roughness
uniform float uFillGloss; // 0..1 clearcoat-like gloss on the fill (enamel)
uniform float uEngrave;
varying float vFaceId;
varying vec2 vFaceUV;

float dcMedian( vec3 c ) { return max( min( c.r, c.g ), min( max( c.r, c.g ), c.b ) ); }

float dcSample( vec2 uv ) { return dcMedian( textureLod( uAtlas, uv, 0.0 ).rgb ) - 0.5; }

// Signed distance (face units, positive inside) of glyph slot k of a face at p, and the
// distance gradient direction (face space). Outside the glyph rect: -1.
float dcGlyph( int face, int k, vec2 p, out vec2 grad ) {
	vec4 r = texelFetch( uLabels, ivec2( 2 * k, face ), 0 );
	vec4 t = texelFetch( uLabels, ivec2( 2 * k + 1, face ), 0 );
	grad = vec2( 0.0 );
	if ( r.z <= r.x || any( lessThan( p, r.xy ) ) || any( greaterThan( p, r.zw ) ) ) return - 1.0;
	if ( t.x < 0.0 ) {
		// the 6/9 mark: a rounded box (t.y: centre y, t.zw: half extents), no atlas lookup
		vec2 sg = sign( p - vec2( 0.5 * ( r.x + r.z ), t.y ) );
		vec2 q = abs( p - vec2( 0.5 * ( r.x + r.z ), t.y ) ) - t.zw + ${BOX_ROUND.toFixed(4)};
		bool outside = max( q.x, q.y ) > 0.0;
		grad = outside ? - normalize( max( q, 0.0 ) ) * sg : ( q.x > q.y ? vec2( - sg.x, 0.0 ) : vec2( 0.0, - sg.y ) );
		return ${BOX_ROUND.toFixed(4)} - length( max( q, 0.0 ) ) - min( max( q.x, q.y ), 0.0 );
	}
	vec2 uvPerFace = ( t.zw - t.xy ) / ( r.zw - r.xy );
	vec2 facePerPx = 1.0 / ( uvPerFace * uAtlasInfo.yz );
	vec2 uv = t.xy + ( p - r.xy ) * uvPerFace;
	vec2 e = 1.0 / uAtlasInfo.yz;
	float d = dcSample( uv );
	float gx = dcSample( uv + vec2( e.x, 0.0 ) ) - dcSample( uv - vec2( e.x, 0.0 ) );
	float gy = dcSample( uv + vec2( 0.0, e.y ) ) - dcSample( uv - vec2( 0.0, e.y ) );
	// Gradient of the px distance, per face unit. Dividing by its length converts px to face
	// units, also for a non-uniformly stretched glyph (the underline mark).
	grad = vec2( gx, gy ) * ( 0.5 * uAtlasInfo.x ) / facePerPx;
	float glen = max( length( grad ), 0.5 / max( facePerPx.x, facePerPx.y ) );
	return d * uAtlasInfo.x / glen;
}
`;

/**
 * Fragment shader: after `#include <color_fragment>`. Label distance, fill mask, fill colour
 * and (DICER_ENGRAVE) the recess occlusion.
 */
export const ENGRAVE_COLOR = /* glsl */ `
	float dcAA = max( 0.7 * length( fwidth( vFaceUV ) ), 1e-4 );
	float dcD = - 1.0;
	vec2 dcGrad = vec2( 0.0 );
	int dcFace = int( floor( vFaceId + 0.5 ) );
	if ( dcFace >= 0 ) {
		vec2 dcG0, dcG1;
		float dcD0 = dcGlyph( dcFace, 0, vFaceUV, dcG0 );
		float dcD1 = dcGlyph( dcFace, 1, vFaceUV, dcG1 );
		dcD = max( dcD0, dcD1 );
		dcGrad = dcD0 >= dcD1 ? dcG0 : dcG1;
	}
	float dcMask = smoothstep( - dcAA, dcAA, dcD );
	float dcBand = max( ${WALL_BAND.toFixed(4)}, 2.0 * dcAA );
	float dcDepth = uEngrave * ${DEPTH_SCALE.toFixed(4)};
#ifdef DICER_ENGRAVE
	// The recess floor is shadowed by its walls: darkest right under them.
	float dcOcc = 1.0 - 0.5 * clamp( uEngrave * 2.0, 0.0, 1.0 ) * dcMask
		* ( 1.0 - smoothstep( 0.0, 2.5 * dcBand, dcD ) );
#else
	float dcOcc = 1.0;
#endif
	diffuseColor.rgb = mix( diffuseColor.rgb, uFillColor, dcMask ) * dcOcc;
`;

/**
 * Fragment shader: after `#include <normal_fragment_maps>`. Tilts the normal along the
 * distance gradient inside the wall band, so the cut's walls catch the light.
 */
export const ENGRAVE_NORMAL = /* glsl */ `
#ifdef DICER_ENGRAVE
	vec3 dcQ0 = dFdx( - vViewPosition );
	vec3 dcQ1 = dFdy( - vViewPosition );
	vec2 dcS0 = dFdx( vFaceUV );
	vec2 dcS1 = dFdy( vFaceUV );
	vec3 dcQ1p = cross( dcQ1, normal );
	vec3 dcQ0p = cross( normal, dcQ0 );
	vec3 dcT = dcQ1p * dcS0.x + dcQ0p * dcS1.x;
	vec3 dcB = dcQ1p * dcS0.y + dcQ0p * dcS1.y;
	float dcDet = max( dot( dcT, dcT ), dot( dcB, dcB ) );
	float dcInv = dcDet > 0.0 ? inversesqrt( dcDet ) : 0.0;
	float dcGl = length( dcGrad );
	vec2 dcGn = dcGl > 0.0 ? dcGrad / dcGl : vec2( 0.0 );
	float dcWt = clamp( dcD / dcBand, 0.0, 1.0 );
	float dcSlope = dcDepth * 6.0 * dcWt * ( 1.0 - dcWt ) / dcBand;
	vec3 dcTilt = dcSlope * ( dcT * dcGn.x + dcB * dcGn.y ) * dcInv;
	normal = normalize( normal + dcTilt );
#endif
`;

/** Fragment shader: after `#include <clearcoat_normal_fragment_begin>`. */
export const ENGRAVE_CLEARCOAT = /* glsl */ `
#if defined( USE_CLEARCOAT ) && defined( DICER_ENGRAVE )
	clearcoatNormal = normal;
#endif
`;

/**
 * Fragment shader: after `#include <lights_physical_fragment>`. Enamel gloss: the fill gets
 * a clearcoat layer of strength uFillGloss (every dice program compiles USE_CLEARCOAT).
 */
export const FILL_GLOSS = /* glsl */ `
#ifdef USE_CLEARCOAT
	material.clearcoat = max( material.clearcoat, uFillGloss * dcMask );
	material.clearcoatRoughness = mix( material.clearcoatRoughness, 0.0525 + geometryRoughness, uFillGloss * dcMask );
#endif
`;

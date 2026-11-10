import * as THREE from 'three';
import { layoutLabel } from './sdf-atlas.js';

/**
 * Engraved dice material: a MeshPhysicalMaterial whose fragment shader cuts the face labels
 * into the surface from the MSDF digit atlas. Per face, uLabels holds 4 RGBA float texels
 * (glyph 0 rect, glyph 0 uv rect, glyph 1 rect, glyph 1 uv rect; see layoutLabel).
 * The program is shared per body type: colours, labels and engraving live in uniforms.
 */

const TEXELS_PER_FACE = 4;
/** Recess depth per unit of engraveDepth, in face units (face inradius = 1). */
const DEPTH_SCALE = 0.02;
/** Width of the sloped wall band at the glyph edge, in face units. */
const WALL_BAND = 0.035;

const BODY_PRESETS = {
  opaque: (color) => ({ color, roughness: 0.35, clearcoat: 0.6 }),
  metal: (color) => ({ color, metalness: 1, roughness: 0.28 }),
  resin: (color) => ({
    color, // also tints what little the overlay has behind the die to transmit
    transmission: 0.9,
    thickness: 1.2,
    ior: 1.52,
    attenuationColor: color,
    attenuationDistance: 0.8,
    roughness: 0.05,
    clearcoat: 1,
  }),
};

const VERTEX_PARS = /* glsl */ `
attribute float aFaceId;
attribute vec2 aFaceUV;
varying float vFaceId;
varying vec2 vFaceUV;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uAtlas;
uniform highp sampler2D uLabels;
uniform vec3 uAtlasInfo; // distanceRange (px), atlas width, atlas height
uniform vec3 uFillColor;
uniform vec2 uFillPBR;   // fill metalness, fill roughness
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

// After color_fragment: label distance, fill mask, fill colour and recess occlusion.
const FRAGMENT_MASK = /* glsl */ `
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
	// The recess floor is shadowed by its walls: darkest right under them.
	float dcOcc = 1.0 - 0.5 * clamp( uEngrave * 2.0, 0.0, 1.0 ) * dcMask
		* ( 1.0 - smoothstep( 0.0, 2.5 * dcBand, dcD ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, uFillColor, dcMask ) * dcOcc;
`;

// After normal_fragment_maps: tilt the normal along the distance gradient inside the wall
// band, so the cut's walls catch the light.
const FRAGMENT_NORMAL = /* glsl */ `
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
`;

const FRAGMENT_CLEARCOAT = /* glsl */ `
#ifdef USE_CLEARCOAT
	clearcoatNormal = normal;
#endif
`;

function patchShader(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\tvFaceId = aFaceId;\n\tvFaceUV = aFaceUV;',
    );
  const transmission = THREE.ShaderChunk.transmission_fragment.replace(
    'material.transmission = transmission;',
    'material.transmission = transmission * ( 1.0 - dcMask ); // the fill is opaque',
  );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_MASK}`)
    .replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n\troughnessFactor = mix( roughnessFactor, uFillPBR.y, dcMask );',
    )
    .replace(
      '#include <metalnessmap_fragment>',
      '#include <metalnessmap_fragment>\n\tmetalnessFactor = mix( metalnessFactor, uFillPBR.x, dcMask );',
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`,
    )
    .replace(
      '#include <clearcoat_normal_fragment_begin>',
      `#include <clearcoat_normal_fragment_begin>\n${FRAGMENT_CLEARCOAT}`,
    )
    .replace('#include <transmission_fragment>', transmission);
}

function faceCountOf(shape, labels) {
  return Math.max(1, shape.faces?.length ?? 0, labels?.length ?? 0);
}

function writeLabels(data, faceCount, labels, atlas) {
  data.fill(0);
  const n = Math.min(faceCount, labels.length);
  for (let f = 0; f < n; f++) data.set(layoutLabel(labels[f], atlas), f * TEXELS_PER_FACE * 4);
}

function fillPBR(fillMetallic) {
  return fillMetallic ? new THREE.Vector2(1, 0.3) : new THREE.Vector2(0, 0.6);
}

/**
 * @param {{body: 'opaque'|'metal'|'resin', bodyColor: string, fillColor: string,
 *   fillMetallic: boolean, engraveDepth?: number}} appearance
 * @param {object} atlas from loadDigitAtlas() (parseAtlas() fields + texture)
 * @param {object} shape ShapeDef from getShape()
 * @param {string[]} labels one label per face (labelFor())
 * @returns {THREE.MeshPhysicalMaterial}
 */
export function createDiceMaterial(appearance, atlas, shape, labels) {
  const body = BODY_PRESETS[appearance.body] ? appearance.body : 'opaque';
  const material = new THREE.MeshPhysicalMaterial(
    BODY_PRESETS[body](new THREE.Color(appearance.bodyColor)),
  );

  const faceCount = faceCountOf(shape, labels);
  const data = new Float32Array(faceCount * TEXELS_PER_FACE * 4);
  writeLabels(data, faceCount, labels, atlas);
  const labelTex = new THREE.DataTexture(
    data,
    TEXELS_PER_FACE,
    faceCount,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  labelTex.minFilter = THREE.NearestFilter;
  labelTex.magFilter = THREE.NearestFilter;
  labelTex.generateMipmaps = false;
  labelTex.needsUpdate = true;

  const uniforms = {
    uAtlas: { value: atlas.texture ?? null },
    uLabels: { value: labelTex },
    uAtlasInfo: {
      value: new THREE.Vector3(atlas.distanceRange, atlas.scaleW, atlas.scaleH),
    },
    uFillColor: { value: new THREE.Color(appearance.fillColor) },
    uFillPBR: { value: fillPBR(appearance.fillMetallic) },
    uEngrave: { value: appearance.engraveDepth ?? 0.5 },
  };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => patchShader(shader, uniforms);
  material.customProgramCacheKey = () => `dicer-${body}`;
  return material;
}

/** Rewrites the label texture of a material created by createDiceMaterial, in place. */
export function updateLabels(material, labels, atlas) {
  const tex = material.userData.uniforms.uLabels.value;
  writeLabels(tex.image.data, tex.image.height, labels, atlas);
  tex.needsUpdate = true;
}

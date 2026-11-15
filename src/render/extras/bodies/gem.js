import * as THREE from 'three';

/**
 * Gem body (amethyst, malachite, obsidian, quartz): procedural volume colour, no refraction.
 * One program for the four presets: the preset is the uBodyPreset uniform (an unknown preset
 * draws as amethyst, the first); the pattern is picked by a branch on the uniform. Returns {}
 * for any other body type.
 *
 * Depth: every pattern is read at a point below the surface, pushed into the die along the
 * view ray in die-local space (a parallax read), so it slides under the coat as the die turns
 * and reads as colour inside the stone, not printed on it.
 *
 * PRESET_PARAMS: [pattern, scale, depth, rim]
 * - pattern: 0 amethyst (warped hexagonal zoning shells round die-local y, deepening to
 *   the centre), 1 malachite (concentric rings of a warped distance field), 2 obsidian
 *   (glassy, faint sheen in soft flows), 3 quartz (milky, soft cloudy veins);
 * - scale: pattern frequency, per die-local unit (amethyst: zoning bands, malachite: rings);
 * - depth: how far below the surface the pattern is read (die-local units along the view ray);
 * - rim: translucency, the brighter colour at grazing view (0: none).
 */
export const PRESET_PARAMS = {
  amethyst: [0, 3.5, 0.3, 0.45],
  malachite: [1, 5.5, 0.06, 0],
  obsidian: [2, 1.4, 0.4, 0.12],
  quartz: [3, 2.2, 0.4, 0.7],
};

export const USES_NOISE = true;

const PARAMS = { clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, ior: 1.55 };

const PARS = /* glsl */ `
uniform vec4 uBodyPreset;
#ifndef DICER_RESIN
uniform mat4 modelMatrix; // three uploads it per object; the vertex stage declares it too
#endif
// A flat fracture sheet inside the die (quartz): the plane through o with unit normal n, cut to a
// ragged disc of radius r, met by the view ray x = p - d t below the surface (t > 0). Returns
// x: the sheet (feathered, fading with depth, brightest seen face on, where it catches the light);
// y: its ragged rim, the crack line.
vec2 dcGsheet( vec3 p, vec3 d, vec3 n, vec3 o, float r ) {
	float dn = dot( d, n );
	float t = dot( p - o, n ) / ( abs( dn ) > 1e-3 ? dn : 1e-3 );
	vec3 h = p - d * t;
	float e = length( h - o ) / r + 0.4 * ( dcNoise3( h * 6.0 ) - 0.5 );
	float feather = 0.45 + 0.55 * smoothstep( 0.3, 0.7, dcNoise3( h * vec3( 15.0, 4.0, 15.0 ) + 3.0 ) );
	float k = step( 0.0, t ) * ( 1.0 - 0.45 * smoothstep( 0.0, 0.8, t ) );
	return k * vec2( ( 1.0 - smoothstep( 0.8, 0.95, e ) ) * feather * ( 0.4 + 0.6 * pow( abs( dn ), 3.0 ) ),
		1.0 - smoothstep( 0.0, 0.05, abs( e - 0.9 ) ) );
}
`;

const COLOR = /* glsl */ `
#ifdef DICER_GEM
	{
		vec3 dcGv = normalize( vViewPosition );
		float dcGcos = clamp( abs( dot( normalize( vNormal ), dcGv ) ), 0.0, 1.0 );
		// towards the camera in die-local space (uniform scale: the transpose inverts the rotation)
		vec3 dcGd = normalize( transpose( mat3( viewMatrix ) * mat3( modelMatrix ) ) * dcGv );
		// the parallax read: along the view ray into the die, longer at grazing view (refraction-ish)
		vec3 dcGq = vLocalPos - dcGd * uBodyPreset.z * ( 0.6 + 0.4 / max( dcGcos, 0.35 ) );
		float dcGaa = length( fwidth( vLocalPos ) ) * uBodyPreset.y; // pattern units per pixel
		float dcGrim = pow( 1.0 - dcGcos, 2.5 );
		vec3 dcGa = diffuseColor.rgb;
		vec3 dcGb = uBodyColor2;
		vec3 dcGc = dcGa;
		vec3 dcGp = dcGq * uBodyPreset.y;
		if ( uBodyPreset.x < 0.5 ) {
			// Amethyst: growth zoning in shells round the crystal axis (die-local y), hexagonal
			// prisms capped by pyramids, a little warped; the shells darken to color2 towards the core
			// and pale out to a lavender (and patchy, nearly colourless) rim zone.
			vec2 dcGh = abs( dcGq.xz );
			float dcGz = max( max( dot( dcGh, vec2( 0.866, 0.5 ) ), dcGh.y ), 0.62 * abs( dcGq.y ) + 0.18 );
			dcGz += 0.14 * ( dcFbm3( dcGq * 3.0 + 3.0, 3 ) - 0.5 );
			float dcGband = smoothstep( 0.3, 0.7, 0.5 + 0.5 * cos( 6.2832 * dcGz * uBodyPreset.y ) );
			float dcGcore = 1.0 - smoothstep( 0.45, 1.0, dcGz );
			dcGc = mix( dcGa, dcGb, clamp( 0.15 + 0.6 * dcGcore + 0.6 * dcGband * ( 1.0 - 0.5 * dcGcore ), 0.0, 1.0 ) );
			float dcGpale = smoothstep( 0.45, 0.75, dcNoise3( dcGq * 2.2 + 11.0 ) );
			dcGc = mix( dcGc, min( dcGa * 1.4 + 0.1, 1.0 ), ( 0.2 + 0.6 * dcGpale ) * ( 1.0 - dcGcore ) * ( 1.0 - dcGband ) );
		} else if ( uBodyPreset.x < 1.5 ) {
			// Malachite: concentric bands round a few botryoidal centres (the eyes) just inside the
			// surface, the distance field warped; light color bands, dark color2 bands, each light band
			// with a sharp dark inner edge and fine growth lines.
			float dcGdist = min( min( length( dcGq - vec3( 0.75, 0.55, - 0.35 ) ),
				length( dcGq - vec3( - 0.6, - 0.45, 0.7 ) ) ),
				min( length( dcGq - vec3( - 0.25, 0.8, - 0.8 ) ), length( dcGq - vec3( 0.3, - 0.9, - 0.2 ) ) ) );
			dcGdist += 0.16 * ( dcFbm3( dcGq * 2.4 + 5.0, 3 ) - 0.5 );
			float dcGr = dcGdist * uBodyPreset.y;
			float dcGf = fract( dcGr );
			float dcGwid = 0.3 + 0.35 * dcHash13( vec3( floor( dcGr ), 1.7, 4.3 ) ); // varying band widths
			float dcGe = max( dcGaa * 1.5, 0.02 );
			float dcGlight = smoothstep( dcGwid - dcGe, dcGwid + dcGe, dcGf ) * ( 1.0 - smoothstep( 1.0 - dcGe * 2.0, 1.0, dcGf ) );
			float dcGfine = 0.5 + 0.5 * sin( 6.2832 * dcGr * 5.0 );
			dcGc = mix( dcGb, min( dcGa * 1.3, 1.0 ), dcGlight * ( 0.75 + 0.25 * dcGf ) );
			dcGc *= 1.0 - 0.18 * dcGfine * ( 1.0 - min( dcGaa * 4.0, 1.0 ) );
			// the dark line at the inner edge of each light band
			float dcGedge = abs( dcGf - dcGwid );
			dcGc = mix( dcGc, dcGb * 0.55, 0.7 * ( 1.0 - smoothstep( dcGe, dcGe + 0.05, dcGedge ) ) );
		} else if ( uBodyPreset.x < 2.5 ) {
			// Obsidian: glassy color; a faint color2 sheen in thin soft streaks along slow stretched
			// flows below the surface, strongest at an angle (light off aligned inclusions).
			float dcGflow = dcFbm3( dcGp * vec3( 1.0, 2.6, 1.0 ) + 1.0 * dcFbm3( dcGp + 7.0, 2 ), 2 );
			float dcGs = 0.5 + 0.5 * sin( 6.2832 * 1.6 * dcGflow );
			float dcGsheen = smoothstep( 0.35, 1.0, dcGs ) * smoothstep( 0.3, 0.65, dcNoise3( dcGp * 0.7 + 2.0 ) );
			// a faint smoky depth everywhere, so a face seen straight on is deep glass, not a black hole
			dcGc = mix( dcGa, dcGb, 0.14 + dcGsheen * ( 0.12 + 0.4 * ( 1.0 - dcGcos ) ) );
		} else {
			// Quartz: a clear body (greyer color2, deeper towards the core) holding milky color clouds
			// at two depths, feathery wisps along them, and a few fracture sheets deep inside that
			// catch the light when seen face on.
			// two cloud layers, the second twice as deep along the view ray: they part as the die turns
			float dcGcl = 0.5 * ( dcFbm3( dcGp + 2.0, 3 ) + dcFbm3( ( dcGq - dcGd * uBodyPreset.z ) * uBodyPreset.y * 0.7 + 6.0, 3 ) );
			float dcGmilk = smoothstep( 0.44, 0.64, dcGcl );
			// wisps: thin ridges of a warped noise, only in and near the clouds
			float dcGwf = dcFbm3( dcGp * 1.4 + 9.0 + 1.5 * dcGcl, 3 );
			float dcGwisp = ( 1.0 - smoothstep( 0.0, 0.03 + dcGaa, abs( dcGwf - 0.5 ) ) ) * smoothstep( 0.4, 0.6, dcGcl );
			vec2 dcGfr = max( max(
				dcGsheet( vLocalPos, dcGd, vec3( 0.57, 0.69, - 0.44 ), vec3( 0.15, 0.1, - 0.1 ), 0.5 ),
				dcGsheet( vLocalPos, dcGd, vec3( - 0.71, 0.21, 0.67 ), vec3( - 0.2, - 0.25, 0.15 ), 0.42 ) ),
				dcGsheet( vLocalPos, dcGd, vec3( 0.12, - 0.6, - 0.79 ), vec3( 0.1, 0.3, 0.25 ), 0.36 ) );
			float dcGcore = 1.0 - smoothstep( 0.35, 1.0, length( dcGq ) );
			vec3 dcGmk = min( dcGa * 1.06 + 0.04, 1.0 );
			dcGc = dcGb * ( 0.84 - 0.24 * dcGcore );
			dcGc = mix( dcGc, dcGmk, dcGmilk );
			dcGc = mix( dcGc, dcGmk, 0.6 * dcGwisp );
			dcGc = mix( dcGc, min( dcGa * 1.2 + 0.12, 1.0 ), dcGfr.x );
			dcGc = mix( dcGc, dcGb * 0.7, 0.6 * dcGfr.y );
		}
		// translucency: light through the thin edge, brighter at grazing view
		dcGc = mix( dcGc, min( dcGa * 1.25 + 0.08, 1.0 ), uBodyPreset.w * dcGrim );
		diffuseColor.rgb = clamp( dcGc, 0.0, 1.0 );
	}
#endif
`;

/**
 * Bevels: a rounded bevel is a cylinder that mirrors a whole line of the studio, and a clear
 * 1.55 coat over it turned every gem edge silver-grey. On the bevel the coat is thinner and a
 * little rougher, and the base reflection is tinted by the stone (a coloured gloss, as light
 * leaving a gem through its edge), so the stone colour runs over the edge.
 */
const COAT = /* glsl */ `
#ifdef DICER_GEM
	if ( vFaceId < - 0.5 ) {
		vec3 dcGt = material.diffuseColor / max( max( material.diffuseColor.r, material.diffuseColor.g ), max( material.diffuseColor.b, 1e-3 ) );
#ifdef DICER_EDGE
		// a styled strip (edges.js) keeps its own reflection: no stone tint, no dimming over it
		dcGt = mix( dcGt, vec3( 1.0 ), dcEdge );
		material.specularF90 *= mix( 0.45, 1.0, dcEdge );
#else
		material.specularF90 *= 0.45;
#endif
		material.specularColor *= dcGt;
		material.specularColorBlended *= dcGt;
#ifdef USE_CLEARCOAT
		material.clearcoat *= 0.3;
		material.clearcoatRoughness = max( material.clearcoatRoughness, 0.2 );
#endif
	}
#endif
`;

export function gemPatch(a) {
  if (a.body?.type !== 'gem') return {};
  return {
    defines: { DICER_GEM: '' },
    uniforms: { uBodyPreset: { value: new THREE.Vector4(...(PRESET_PARAMS[a.body.preset] ?? PRESET_PARAMS.amethyst)) } },
    chunks: { pars: PARS, colorPre: COLOR, coat: COAT },
    params: { ...PARAMS },
  };
}

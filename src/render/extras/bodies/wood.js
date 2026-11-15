import * as THREE from 'three';

/**
 * Wood body (oak, walnut, cherry, ebony): procedural grain in die-local space under a satin
 * varnish. One program for the four presets: the preset is the uBodyPreset uniform (an unknown
 * preset draws as oak, the first). Returns {} for any other body type.
 *
 * The grain is a 3D field, so it runs on unbroken across faces and over the bevels, as if the
 * die were cut from one block: annual rings round a log axis (the pith), tilted per preset and
 * lying well outside the die, so most faces show long grain and gentle arcs, never a target;
 * the rings are warped by an fbm stretched along the grain. Inside them: fine fibre streaks
 * along the grain, pores (darker, and rougher under the varnish) and, for oak, ray flecks.
 * body.color is the earlywood, body.color2 the ring (latewood) and streak colour.
 *
 * PRESET_PARAMS: [kind, rings, warp, contrast]
 * - kind: 0 oak (wide prominent rings, ring-porous: big pores at the start of each ring, ray
 *   flecks), 1 walnut (wavy, a long warp along the grain), 2 cherry (fine, even, small pores),
 *   3 ebony (dense low-contrast streaks). The kind picks the log axis and pith, the streak,
 *   pore and fleck strengths and the warp's stretch (constants in the shader);
 * - rings: annual rings per die-local unit;
 * - warp: how far the fbm shifts the rings, in rings;
 * - contrast: how strongly the ring lines take color2 (0: none).
 */
export const PRESET_PARAMS = {
  oak: [0, 5, 0.8, 0.9],
  walnut: [1, 6, 2.2, 0.7],
  cherry: [2, 10, 0.9, 0.4],
  ebony: [3, 16, 1.4, 0.4],
};

export const USES_NOISE = true;

/** A satin varnish. */
const PARAMS = { clearcoat: 0.5, clearcoatRoughness: 0.25 };

const PARS = /* glsl */ `
uniform vec4 uBodyPreset;
`;

const COLOR = /* glsl */ `
#ifdef DICER_WOOD
	float dcWpore = 0.0; // pore cover, read again by the roughness chunk
	{
		// Per-kind constants (a branch on the uniform: no derivatives inside).
		// ax: the log axis; o: the pith, in the plane across the axis (far outside the die);
		// k: streaks, pores, ring-porous (pores only in the earlywood), ray flecks;
		// m: the warp's stretch along the grain (low: long waves), fibre and pore frequencies.
		vec3 dcWax = vec3( 0.2, 1.0, 0.33 );
		vec2 dcWo = vec2( 2.4, - 1.6 );
		vec4 dcWk = vec4( 0.4, 0.9, 1.0, 0.6 );
		vec3 dcWm = vec3( 0.6, 40.0, 100.0 );
		if ( uBodyPreset.x > 2.5 ) {
			dcWax = vec3( 0.3, 1.0, - 0.5 ); dcWo = vec2( - 2.2, - 2.0 ); dcWk = vec4( 0.8, 0.25, 0.0, 0.0 ); dcWm = vec3( 0.8, 70.0, 160.0 );
		} else if ( uBodyPreset.x > 1.5 ) {
			dcWax = vec3( - 0.35, 0.3, 1.0 ); dcWo = vec2( 2.8, 1.3 ); dcWk = vec4( 0.35, 0.15, 0.0, 0.0 ); dcWm = vec3( 0.5, 60.0, 160.0 );
		} else if ( uBodyPreset.x > 0.5 ) {
			dcWax = vec3( 1.0, 0.25, - 0.4 ); dcWo = vec2( - 1.7, 2.5 ); dcWk = vec4( 0.5, 0.3, 0.0, 0.0 ); dcWm = vec3( 0.25, 50.0, 120.0 );
		}
		vec3 dcWa = normalize( dcWax );
		vec3 dcWb = normalize( cross( dcWa, abs( dcWa.y ) < 0.8 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) ) );
		// x along the grain, yz across it
		vec3 dcWg = vec3( dot( vLocalPos, dcWa ), dot( vLocalPos, dcWb ), dot( vLocalPos, cross( dcWa, dcWb ) ) );
		float dcWaa = length( fwidth( vLocalPos ) ); // die units per pixel
		vec2 dcWd = dcWg.yz - dcWo;
		float dcWr = length( dcWd );
		float dcWw = dcFbm3( dcWg * vec3( dcWm.x, 2.4, 2.4 ) + 3.0, 3 ) - 0.5;
		float dcWrt = dcWr * uBodyPreset.y + 2.0 * uBodyPreset.z * dcWw; // in rings
		float dcWfw = fwidth( dcWrt ); // rings per pixel
		// a ring: earlywood (color) darkening into latewood (color2), then a crisp edge to the next
		// ring; ring widths and strengths vary
		float dcWi = floor( dcWrt );
		float dcWf = fract( dcWrt );
		float dcWlo = mix( 0.5, 0.82, dcHash13( vec3( dcWi, 2.3, 7.1 ) ) );
		float dcWe = clamp( dcWfw * 1.5, 0.02, 0.2 );
		float dcWlate = smoothstep( dcWlo, 1.0 - dcWe, dcWf ) * ( 1.0 - smoothstep( 1.0 - dcWe, 1.0, dcWf ) );
		dcWlate *= 0.65 + 0.35 * dcHash13( vec3( dcWi, 5.9, 1.3 ) );
		// rings finer than a pixel: their average
		dcWlate = mix( dcWlate, 0.25, smoothstep( 0.3, 0.8, dcWfw ) );
		// fibres: two octaves of noise stretched along the grain, faded out below a pixel
		float dcWfa = 1.0 - smoothstep( 0.4, 1.0, dcWaa * dcWm.y );
		float dcWfb = 1.0 - smoothstep( 0.4, 1.0, dcWaa * dcWm.y * 2.7 );
		float dcWs = smoothstep( 0.45, 0.85, dcNoise3( dcWg * vec3( 1.2, dcWm.y, dcWm.y ) ) ) * dcWfa
			+ 0.6 * smoothstep( 0.5, 0.85, dcNoise3( dcWg * vec3( 2.5, 2.7 * dcWm.y, 2.7 * dcWm.y ) + 5.0 ) ) * dcWfb;
		// pores: short dark dashes along the grain; ring-porous wood keeps them to the earlywood
		float dcWpa = 1.0 - smoothstep( 0.3, 0.8, dcWaa * dcWm.z );
		float dcWp = smoothstep( 0.8 - 0.1 * dcWk.y, 0.9 - 0.06 * dcWk.y, dcNoise3( dcWg * vec3( 8.0, dcWm.z, dcWm.z ) + 11.0 ) );
		float dcWzone = mix( 1.0, 1.0 - smoothstep( 0.12, 0.35, dcWf ), dcWk.z );
		dcWpore = dcWk.y * dcWzone * mix( 0.12, dcWp, dcWpa );
		vec3 dcWa1 = diffuseColor.rgb;
		vec3 dcWc = dcWa1 * ( 1.0 + 0.25 * dcWw ); // slow tone drift along the board
		dcWc = mix( dcWc, uBodyColor2, uBodyPreset.w * dcWlate );
		dcWc = mix( dcWc, uBodyColor2, dcWk.x * 0.6 * dcWs );
		dcWc = mix( dcWc, uBodyColor2 * 0.6, 0.75 * dcWpore );
		if ( dcWk.w > 0.0 ) {
			// oak ray flecks: thin across the rings' tangent, long along the radius, short along
			// the grain; pale and a little glossy where a face cuts them lengthwise
			vec2 dcWn = normalize( - dcWo );
			float dcWarc = atan( dot( dcWd, vec2( - dcWn.y, dcWn.x ) ), dot( dcWd, dcWn ) ) * dcWr;
			float dcWfl = smoothstep( 0.78, 0.9, dcNoise3( vec3( dcWarc * 26.0, dcWr * 2.5, dcWg.x * 6.0 ) + 17.0 ) );
			dcWc = mix( dcWc, min( dcWa1 * 1.15 + 0.04, 1.0 ), dcWk.w * dcWfl * dcWpa );
		}
		diffuseColor.rgb = clamp( dcWc, 0.0, 1.0 );
	}
#endif
`;

/** Pores stay open under the varnish: a little rougher. */
const ROUGHNESS = /* glsl */ `
#ifdef DICER_WOOD
	roughnessFactor = clamp( roughnessFactor + dcWpore * 0.35, 0.0, 1.0 );
#endif
`;

/**
 * Bevels: a rounded bevel mirrors a whole line of the studio, and a clear varnish over it reads
 * as a grey band. On the bevel the varnish is thinner and a little rougher and its reflection is
 * tinted by the wood, so the grain runs over the edge in the wood's own colour.
 */
const COAT = /* glsl */ `
#ifdef DICER_WOOD
	if ( vFaceId < - 0.5 ) {
		vec3 dcWt = material.diffuseColor / max( max( material.diffuseColor.r, material.diffuseColor.g ), max( material.diffuseColor.b, 1e-3 ) );
#ifdef DICER_EDGE
		// a styled strip (edges.js) keeps its own reflection: no wood tint, no dimming over it
		dcWt = mix( dcWt, vec3( 1.0 ), dcEdge );
		material.specularF90 *= mix( 0.6, 1.0, dcEdge );
#else
		material.specularF90 *= 0.6;
#endif
		material.specularColor *= dcWt;
		material.specularColorBlended *= dcWt;
#ifdef USE_CLEARCOAT
		material.clearcoat *= 0.5;
		material.clearcoatRoughness = max( material.clearcoatRoughness, 0.35 );
#endif
	}
#endif
`;

export function woodPatch(a) {
  if (a.body?.type !== 'wood') return {};
  return {
    defines: { DICER_WOOD: '' },
    uniforms: { uBodyPreset: { value: new THREE.Vector4(...(PRESET_PARAMS[a.body.preset] ?? PRESET_PARAMS.oak)) } },
    chunks: { pars: PARS, colorPre: COLOR, roughness: ROUGHNESS, coat: COAT },
    params: { ...PARAMS },
  };
}

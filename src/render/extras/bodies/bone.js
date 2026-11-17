import * as THREE from 'three';

/**
 * Bone body (bone, ivory, fossil): a warm, dense organic body in die-local space, under a soft
 * waxy sheen. One program for the three presets: the preset is the uBodyPreset uniform (an
 * unknown preset draws as bone, the first). body.color is the bone, body.color2 its stain (the
 * growth lines, pores and the fossil's minerals). Returns {} for any other body type.
 *
 * PRESET_PARAMS: [kind, lines, pores, stain]
 * - kind: 0 bone (fine growth lines, open pores), 1 ivory (smooth, faint crosshatched Schreger
 *   lines), 2 fossil (mineral mottling, dark hairline cracks);
 * - lines: growth line frequency per die-local unit;
 * - pores: how many pores show (0: none);
 * - stain: how strongly color2 shows overall (0: none).
 */
export const PRESET_PARAMS = {
  bone: [0, 14, 0.8, 0.45],
  ivory: [1, 10, 0.15, 0.25],
  fossil: [2, 6, 0.5, 0.8],
};

export const USES_NOISE = true;

/** Waxy: a soft sheen in the bone's own colour, a thin satin coat. */
const PARAMS = { clearcoat: 0.3, clearcoatRoughness: 0.45, sheen: 0.5, sheenRoughness: 0.5 };

const PARS = /* glsl */ `
uniform vec4 uBodyPreset;
`;

const COLOR = /* glsl */ `
#ifdef DICER_BONE
	float dcBpore = 0.0; // pore cover, read again by the roughness chunk
	{
		vec3 dcBp = vLocalPos;
		vec3 dcBa = diffuseColor.rgb;
		float dcBaa = length( fwidth( dcBp ) ) * uBodyPreset.y; // lines per pixel
		float dcBfine = 1.0 - smoothstep( 0.3, 0.9, dcBaa );
		// growth lines: warped bands round a long axis
		float dcBw = dcFbm3( dcBp * 2.2 + 1.7, 3 );
		float dcBr = length( dcBp.xz - vec2( 1.8, - 1.1 ) ) * uBodyPreset.y + 3.0 * dcBw;
		float dcBl = smoothstep( 0.55, 1.0, 0.5 + 0.5 * sin( dcBr * 6.2832 ) ) * dcBfine;
		vec3 dcBc = dcBa * ( 0.94 + 0.1 * dcBw );
		dcBc = mix( dcBc, uBodyColor2, uBodyPreset.w * 0.5 * dcBl );
		if ( uBodyPreset.x > 1.5 ) {
			// fossil: mineral mottling and dark hairline cracks
			float dcBm = dcFbm3( dcBp * 4.0 + 5.0, 4 );
			dcBc = mix( dcBc, uBodyColor2, uBodyPreset.w * smoothstep( 0.4, 0.75, dcBm ) );
			float dcBk = abs( dcFbm3( dcBp * 3.0 + 11.0, 3 ) - 0.5 );
			dcBc *= 1.0 - 0.6 * dcBfine * ( 1.0 - smoothstep( 0.0, 0.015 + fwidth( dcBk ), dcBk ) );
		} else if ( uBodyPreset.x > 0.5 ) {
			// ivory: faint crosshatch (Schreger lines), seen on the cut faces
			float dcBs = sin( ( dcBp.x + dcBp.y ) * 40.0 + 2.0 * dcBw ) * sin( ( dcBp.x - dcBp.y ) * 40.0 + 2.0 * dcBw );
			dcBc = mix( dcBc, uBodyColor2, 0.12 * dcBfine * smoothstep( 0.3, 0.9, dcBs ) );
		}
		// pores: small dark dots, faded out below a pixel
		float dcBpa = 1.0 - smoothstep( 0.2, 0.6, length( fwidth( dcBp ) ) * 90.0 );
		dcBpore = uBodyPreset.z * dcBpa * smoothstep( 0.78, 0.86, dcNoise3( dcBp * vec3( 90.0, 60.0, 90.0 ) ) );
		dcBc = mix( dcBc, uBodyColor2 * 0.5, 0.7 * dcBpore );
		diffuseColor.rgb = clamp( dcBc, 0.0, 1.0 );
	}
#endif
`;

const ROUGHNESS = /* glsl */ `
#ifdef DICER_BONE
	roughnessFactor = clamp( roughnessFactor + dcBpore * 0.4, 0.0, 1.0 );
#endif
`;

export function bonePatch(a) {
  if (a.body?.type !== 'bone') return {};
  return {
    defines: { DICER_BONE: '' },
    uniforms: {
      uBodyPreset: {
        value: new THREE.Vector4(...(PRESET_PARAMS[a.body.preset] ?? PRESET_PARAMS.bone)),
      },
    },
    chunks: { pars: PARS, colorPre: COLOR, roughness: ROUGHNESS },
    params: { ...PARAMS, sheenColor: new THREE.Color(a.body.color) },
  };
}

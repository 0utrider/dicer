import * as THREE from 'three';

/**
 * Stone body (granite, slate, sandstone, rock, brick): a matte procedural stone in die-local
 * space, so the pattern runs on unbroken across faces as if the die were cut from one block. One
 * program for the five presets: the preset is the uBodyPreset uniform (an unknown preset draws
 * as granite, the first). body.color is the stone, body.color2 its second mineral (granite's dark
 * crystals, slate's darker strata, rock's pits) or, for brick, the mortar. Returns {} for any
 * other body type.
 *
 * PRESET_PARAMS: [kind, scale, contrast, gloss]
 * - kind: 0 granite (crystal speckle in three tones), 1 slate (thin warped strata, a cleft sheen),
 *   2 sandstone (fine sand grain in soft bedding bands), 3 rock (mottled, pitted basalt),
 *   4 brick (a brick bond laid on each face's dominant axis, mortar in color2);
 * - scale: pattern frequency per die-local unit (brick: bricks per unit);
 * - contrast: how strongly color2 shows (0: none);
 * - gloss: how much the polish lowers the roughness (slate's cleft, granite's polish).
 */
export const PRESET_PARAMS = {
  granite: [0, 26, 0.85, 0.35],
  slate: [1, 7, 0.55, 0.15],
  sandstone: [2, 60, 0.35, 0],
  rock: [3, 6, 0.7, 0],
  brick: [4, 3.2, 1, 0],
};

export const USES_NOISE = true;

/** Matte: a faint coat at most (polished granite takes the gloss from its preset). */
const PARAMS = { clearcoat: 0.08, clearcoatRoughness: 0.6 };

const PARS = /* glsl */ `
uniform vec4 uBodyPreset;
#ifndef DICER_RESIN
uniform mat4 modelMatrix; // three uploads it per object; the vertex stage declares it too
#endif
`;

const COLOR = /* glsl */ `
#ifdef DICER_STONE
	float dcSrough = 0.0; // extra roughness (pits, mortar), read again by the roughness chunk
	{
		vec3 dcSp = vLocalPos * uBodyPreset.y;
		vec3 dcSa = diffuseColor.rgb;
		vec3 dcSb = uBodyColor2;
		float dcSk = uBodyPreset.z;
		float dcSaa = length( fwidth( dcSp ) ); // pattern units per pixel: fine detail fades below it
		float dcSfine = 1.0 - smoothstep( 0.3, 1.0, dcSaa );
		vec3 dcSc = dcSa;
		if ( uBodyPreset.x > 3.5 ) {
			// brick: the bond on the face's dominant die-local axis
			vec3 dcSn = abs( normalize( transpose( mat3( viewMatrix ) * mat3( modelMatrix ) ) * normalize( vNormal ) ) );
			vec2 dcSuv = dcSn.x > dcSn.y && dcSn.x > dcSn.z ? dcSp.zy : ( dcSn.y > dcSn.z ? dcSp.xz : dcSp.xy );
			dcSuv.y *= 2.1; // bricks twice as long as tall
			float dcSrow = floor( dcSuv.y );
			dcSuv.x += 0.5 * mod( dcSrow, 2.0 );
			vec2 dcScell = floor( dcSuv );
			vec2 dcSf = fract( dcSuv );
			float dcSe = min( min( dcSf.x, 1.0 - dcSf.x ) * 0.48, min( dcSf.y, 1.0 - dcSf.y ) );
			float dcSmw = 0.08 + 0.5 * fwidth( dcSuv.y );
			float dcSmortar = 1.0 - smoothstep( dcSmw * 0.6, dcSmw, dcSe );
			// each brick its own fired tone, speckled
			float dcSh = dcHash13( vec3( dcScell, 4.7 ) );
			vec3 dcSbrick = dcSa * ( 0.78 + 0.4 * dcSh ) * ( 0.9 + 0.2 * dcNoise3( dcSp * 9.0 ) );
			dcSbrick *= 1.0 - 0.25 * dcSfine * smoothstep( 0.72, 0.85, dcNoise3( dcSp * 40.0 ) );
			dcSc = mix( dcSbrick, dcSb, dcSk * dcSmortar );
			dcSrough = 0.25 * dcSmortar;
		} else if ( uBodyPreset.x > 2.5 ) {
			// rock: mottled fbm, dark pits
			float dcSm = dcFbm3( dcSp, 4 );
			dcSc = mix( dcSa, mix( dcSa, dcSb, 0.6 ), dcSk * smoothstep( 0.35, 0.7, dcSm ) );
			float dcSpit = smoothstep( 0.74, 0.82, dcNoise3( dcSp * 7.0 + 3.0 ) ) * dcSfine;
			dcSc = mix( dcSc, dcSb * 0.55, dcSk * dcSpit );
			dcSc *= 0.88 + 0.24 * dcNoise3( dcSp * 22.0 );
			dcSrough = 0.3 * dcSpit;
		} else if ( uBodyPreset.x > 1.5 ) {
			// sandstone: soft bedding bands and fine grain
			float dcSband = dcFbm3( vec3( vLocalPos.y * 9.0, vLocalPos.xz * 1.5 ) + 2.0 * dcFbm3( vLocalPos * 2.0, 2 ), 3 );
			dcSc = mix( dcSa, dcSb, dcSk * smoothstep( 0.3, 0.75, dcSband ) );
			float dcSg = dcNoise3( dcSp ) * dcSfine;
			dcSc *= 0.9 + 0.2 * dcSg;
		} else if ( uBodyPreset.x > 0.5 ) {
			// slate: thin warped strata
			float dcSw = dcFbm3( vLocalPos * 3.0, 3 );
			float dcSs = 0.5 + 0.5 * sin( ( dcSp.y + 1.6 * dcSw ) * 6.2832 );
			dcSc = mix( dcSa, dcSb, dcSk * dcSs * dcSs );
			dcSc *= 0.92 + 0.16 * dcNoise3( dcSp * vec3( 6.0, 1.0, 6.0 ) );
		} else {
			// granite: three-tone crystal speckle (dark mica, pale feldspar) over a cloudy ground
			float dcSn1 = dcNoise3( dcSp );
			float dcSn2 = dcNoise3( dcSp * 1.7 + 7.3 );
			dcSc = dcSa * ( 0.92 + 0.16 * dcFbm3( vLocalPos * 3.0, 3 ) );
			dcSc = mix( dcSc, dcSb, dcSk * dcSfine * smoothstep( 0.62, 0.7, dcSn1 ) );
			dcSc = mix( dcSc, min( dcSa * 1.35 + 0.08, 1.0 ), 0.6 * dcSfine * smoothstep( 0.66, 0.74, dcSn2 ) );
		}
		diffuseColor.rgb = clamp( dcSc, 0.0, 1.0 );
	}
#endif
`;

/** Polish lowers the roughness; pits and mortar raise it. */
const ROUGHNESS = /* glsl */ `
#ifdef DICER_STONE
	roughnessFactor = clamp( roughnessFactor * ( 1.0 - uBodyPreset.w ) + dcSrough, 0.0, 1.0 );
#endif
`;

export function stonePatch(a) {
  if (a.body?.type !== 'stone') return {};
  return {
    defines: { DICER_STONE: '' },
    uniforms: {
      uBodyPreset: {
        value: new THREE.Vector4(...(PRESET_PARAMS[a.body.preset] ?? PRESET_PARAMS.granite)),
      },
    },
    chunks: { pars: PARS, colorPre: COLOR, roughness: ROUGHNESS },
    params: { ...PARAMS },
  };
}

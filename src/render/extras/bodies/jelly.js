import * as THREE from 'three';
import { RESIN_REFRACTION } from '../../shaders/bodies.js';

/**
 * Jelly body: a soft, gummy translucent die. It is seen through like clear resin (the same
 * environment refraction, DICER_RESIN) but bends light less (a low ior), soaks up more of its
 * colour on the way through (a denser Beer-Lambert body) and the light inside it scatters: the
 * refraction reads rougher, and a velvety sheen in its own colour rims it. Nothing is drawn
 * inside it. body.color is the jelly; body.color2 the glow its rim scatters. Returns {} for any
 * other body type.
 */
export const USES_NOISE = false;

const PARAMS = {
  ior: 1.18,
  clearcoat: 0.35,
  clearcoatRoughness: 0.35,
  sheen: 0.35,
  sheenRoughness: 0.5,
};

/** The light inside scatters: the refraction is read as if from a rougher body. */
const ROUGHNESS = /* glsl */ `
#ifdef DICER_JELLY
	roughnessFactor = max( roughnessFactor, 0.18 );
#endif
`;

/** Scattering: light that crossed the jelly lifts its body a little, most at the thin rim. */
const LIGHTING = /* glsl */ `
#ifdef DICER_JELLY
	{
		float dcJg = 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) );
		totalDiffuse += ( 1.0 - dcMask ) * uBodyColor2 * ( 0.02 + 0.12 * dcJg * dcJg );
	}
#endif
`;

export function jellyPatch(a) {
  if (a.body?.type !== 'jelly') return {};
  return {
    defines: { DICER_RESIN: '', DICER_JELLY: '' },
    uniforms: { uResinDensity: { value: 1.8 } },
    chunks: { roughness: ROUGHNESS, lighting: `${RESIN_REFRACTION}\n${LIGHTING}` },
    params: { ...PARAMS, sheenColor: new THREE.Color(a.body.color2) },
  };
}

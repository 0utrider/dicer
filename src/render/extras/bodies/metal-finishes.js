/**
 * Aged metal finishes: copper patina and battle-worn metal. Not a preset module (no
 * uBodyPreset): it keys on the metal finish and returns {} for any other body or finish. The
 * finishes get the base metal program (the raised border, no brushed or antique chunks) plus
 * these chunks, which run after the number fill (they read dcD and dcMask) and never paint it.
 *
 * - Patina (body.color the copper, body.color2 the verdigris): green-blue oxide gathers in the
 *   recesses (the face-edge channel, the foot of the raised border, just outside the number
 *   walls), with a crusty fbm fringe, plus blotches across the faces. Oxide is matte and not a
 *   metal: roughness towards 0.85 and metalness towards 0 (a replace pair on patchShader's
 *   metalness line). The copper between is mottled with brown tarnish, darkest at the oxide's
 *   rim, and rubbed bright on the bevels and the border crest.
 * - Worn (body.color the metal, body.color2 the grime): fine random scratches in face UV
 *   (brighter and rougher, faded where a scratch is under a pixel wide), edges and corners worn
 *   to bright, smoother bare metal (the bevels, the face edge and the border crest, with a ragged
 *   wear front), and a light grime in the recesses (lighter than antique's).
 */
export const USES_NOISE = true;

/**
 * The raised border's inner edge and bump height: a copy of BORDER.to / BORDER.height
 * (shaders/bodies.js; a unit test keeps them equal). Importing BORDER would make the world-start
 * bundle export it, about 10 bytes.
 */
export const LIP = Object.freeze({ to: 0.14, height: 0.012 });

const f = (x) => x.toFixed(4);
const H = f(LIP.height);
const LIP_IN = f(LIP.to);

const PATINA_COLOR = /* glsl */ `
#ifdef DICER_PATINA
	float dcPatina = 0.0; // oxide cover, read again by the roughness chunk and the metalness line
	float dcPaTarn = 0.0; // tarnish on the copper, read again by the roughness chunk
	{
		float dcPaBlot = dcFbm3( vLocalPos * 3.2 + 7.0, 4 );
		float dcPaMid = dcFbm3( vLocalPos * 7.0 + 1.0, 3 );
		float dcPaFine = dcFbm3( vLocalPos * 16.0 + 3.0, 3 );
		float dcPaRec = 0.0; // recess depth, 0..1
		float dcPaHigh = vFaceId < - 0.5 ? 1.0 : 0.0; // rubbed copper: bevels and the border crest
		if ( vFaceId > - 0.5 ) {
			dcPaRec = 1.0 - smoothstep( 0.0, 0.08, vEdgeDist );
			dcPaRec = max( dcPaRec, 1.0 - smoothstep( 0.0, 0.1, - dcD ) );
		#ifdef DICER_BORDER
			// the inner foot of the raised lip collects oxide; its crest stays copper
			dcPaRec = max( dcPaRec, 0.85 * smoothstep( ${LIP_IN} - 0.02, ${LIP_IN} + 0.01, vEdgeDist ) * ( 1.0 - smoothstep( ${LIP_IN} + 0.02, ${LIP_IN} + 0.12, vEdgeDist ) ) );
			dcPaHigh = dcBorderH( vEdgeDist ) / ${H};
		#endif
		}
		// the recesses fill unevenly: some stretches crusted, some nearly clean
		dcPaRec *= mix( 0.45, 1.3, smoothstep( 0.3, 0.7, dcPaMid ) );
		// a crusty fringe: the recess field thresholded through fine noise, plus face blotches
		float dcPaField = max( dcPaRec * 1.1, smoothstep( 0.48, 0.7, dcPaBlot ) * 0.95 ) + ( dcPaFine - 0.5 ) * 0.8;
		dcPaField *= 1.0 - 0.85 * dcPaHigh;
		dcPatina = smoothstep( 0.4, 0.68, dcPaField );
		dcPatina *= 1.0 - dcMask;
	#ifdef DICER_FACE_LAYERS
		dcPatina *= 1.0 - dcDecal;
	#endif
		// copper: an aged brown tarnish over all of it, mottled, darkest round the oxide (cuprite),
		// and warm bright copper where it is rubbed (bevels, border crest)
		dcPaTarn = mix( 0.45, 1.0, smoothstep( 0.3, 0.72, dcFbm3( vLocalPos * 1.7 + 11.0, 3 ) ) );
		float dcPaRim = smoothstep( 0.1, 0.45, dcPaField );
		vec3 dcPaCu = diffuseColor.rgb;
		// deeper, browner, less saturated copper
		vec3 dcPaBrown = mix( dcPaCu * dcPaCu, vec3( dot( dcPaCu * dcPaCu, vec3( 0.333 ) ) ), 0.25 ) * 0.8;
		dcPaCu = mix( dcPaCu, dcPaBrown, min( 0.8 * dcPaTarn + 0.6 * dcPaRim, 1.0 ) );
		dcPaCu = mix( dcPaCu, min( diffuseColor.rgb * 1.12 + 0.02, 1.0 ), dcPaHigh * 0.85 );
		dcPaTarn *= 1.0 - dcPaHigh;
		diffuseColor.rgb = mix( diffuseColor.rgb, dcPaCu, 1.0 - dcMask );
		// verdigris: pale, chalky and a little greyer where it is thick, deeper teal where thin
		float dcPaLum = dot( uBodyColor2, vec3( 0.299, 0.587, 0.114 ) );
		vec3 dcPaThin = uBodyColor2 * 0.3;
		vec3 dcPaThick = mix( uBodyColor2, vec3( dcPaLum ), 0.25 ) * 0.7;
		vec3 dcPaV = mix( dcPaThin, dcPaThick, smoothstep( 0.3, 0.75, dcPaFine * 0.6 + 0.5 * dcPatina ) );
		diffuseColor.rgb = clamp( mix( diffuseColor.rgb, dcPaV, dcPatina ), 0.0, 1.0 );
	}
#endif
`;

const PATINA_ROUGHNESS = /* glsl */ `
#ifdef DICER_PATINA
	roughnessFactor = clamp( roughnessFactor + 0.18 * dcPaTarn * ( 1.0 - dcMask ), 0.0, 1.0 );
	roughnessFactor = mix( roughnessFactor, 0.85, dcPatina );
#endif
`;

/** Oxide is not metal: the body metalness goes to 0 under the patina (the fill keeps its own). */
const METAL_LINE = 'metalnessFactor = mix( metalnessFactor, uFillPBR.x, dcMask );';
const PATINA_REPLACE = [
  [METAL_LINE, 'metalnessFactor = mix( mix( metalnessFactor, 0.0, dcPatina ), uFillPBR.x, dcMask );'],
];

/**
 * Scratches: three layers of short straight lines, each layer at its own angle per face. A
 * layer's lines sit one per cell across it (most cells empty), broken into segments along it.
 */
const WORN_COLOR = /* glsl */ `
#ifdef DICER_WORN
	float dcWoScr = 0.0;  // scratch cover
	float dcWoEdge = 0.0; // worn-through bare metal
	float dcWoCav = 0.0;  // grime
	{
		float dcWoPx = length( fwidth( vFaceUV ) ); // face units per pixel (uniform control flow)
		float dcWoN = dcFbm3( vLocalPos * 6.0 + 2.0, 3 );
		if ( vFaceId > - 0.5 ) {
			for ( int dcWoK = 0; dcWoK < 3; dcWoK ++ ) {
				float dcWoL = float( dcWoK );
				float dcWoFreq = 7.0 + 6.0 * dcWoL;   // lines per face unit
				float dcWoHalf = 0.006 - 0.0015 * dcWoL; // half width, face units
				float dcWoA = 6.2832 * dcHash13( vec3( vFaceId * 3.7, dcWoL * 5.3, 1.9 ) );
				vec2 dcWoDir = vec2( cos( dcWoA ), sin( dcWoA ) );
				float dcWoU = dot( vFaceUV, dcWoDir );
				float dcWoV = dot( vFaceUV, vec2( - dcWoDir.y, dcWoDir.x ) ) * dcWoFreq;
				float dcWoCell = floor( dcWoV );
				float dcWoH = dcHash13( vec3( dcWoCell, vFaceId + 0.5, dcWoL + 7.0 ) );
				float dcWoC = 0.2 + 0.6 * fract( dcWoH * 13.7 );
				float dcWoD = abs( fract( dcWoV ) - dcWoC ) / dcWoFreq; // face units to the line
				// a segment: noise along the line, so a scratch starts and stops
				float dcWoSeg = smoothstep( 0.55, 0.75, dcNoise3( vec3( dcWoU * ( 2.0 + 2.0 * dcWoH ), dcWoCell * 1.7, dcWoL * 4.0 + vFaceId ) ) );
				// drawn at least a pixel wide, at its true coverage, and faded out where it is
				// much thinner than a pixel (it would only shimmer)
				float dcWoW = max( dcWoHalf, 0.5 * dcWoPx );
				float dcWoLine = ( 1.0 - smoothstep( dcWoW * 0.5, dcWoW + 0.5 * dcWoPx, dcWoD ) ) * dcWoHalf / dcWoW;
				float dcWoAA = 1.0 - smoothstep( 2.0, 5.0, dcWoPx / ( 2.0 * dcWoHalf ) );
				dcWoScr = max( dcWoScr, dcWoLine * dcWoSeg * step( 0.45, dcWoH ) * dcWoAA * ( 0.55 + 0.45 * dcWoH ) );
			}
			// worn edge: a ragged front inside the face edge, and the raised lip's crest
			dcWoEdge = smoothstep( 0.45, 0.65, ( 1.0 - vEdgeDist / 0.1 ) + ( dcWoN - 0.5 ) * 0.8 );
		#ifdef DICER_BORDER
			dcWoEdge = max( dcWoEdge, smoothstep( 0.55, 0.85, dcBorderH( vEdgeDist ) / ${H} + ( dcWoN - 0.5 ) * 0.6 ) );
		#endif
			// grime: just outside the number walls and at the inner foot of the lip
			dcWoCav = 1.0 - smoothstep( 0.0, 0.07, - dcD );
		#ifdef DICER_BORDER
			dcWoCav = max( dcWoCav, 0.7 * smoothstep( ${LIP_IN} - 0.02, ${LIP_IN} + 0.01, vEdgeDist ) * ( 1.0 - smoothstep( ${LIP_IN} + 0.02, ${LIP_IN} + 0.09, vEdgeDist ) ) );
		#endif
			dcWoCav *= mix( 0.3, 1.0, dcWoN ) * ( 1.0 - dcWoEdge );
		} else {
			dcWoEdge = mix( 0.75, 1.0, dcWoN );
		}
		float dcWoKeep = 1.0 - dcMask;
	#ifdef DICER_FACE_LAYERS
		dcWoKeep *= 1.0 - dcDecal;
	#endif
		dcWoScr *= dcWoKeep * ( 1.0 - dcWoEdge );
		dcWoEdge *= dcWoKeep;
		dcWoCav *= dcWoKeep;
		vec3 dcWoC0 = diffuseColor.rgb;
		// the handled faces: dulled and mottled, so the bare edges and scratches read brighter
		vec3 dcWoC1 = dcWoC0 * mix( 1.0, mix( 0.62, 0.85, dcWoN ), dcWoKeep );
		dcWoC1 = mix( dcWoC1, min( dcWoC0 * 1.3 + 0.12, 1.0 ), dcWoScr );
		dcWoC1 = mix( dcWoC1, min( dcWoC0 * 1.3 + 0.1, 1.0 ), dcWoEdge );
		dcWoC1 = mix( dcWoC1, uBodyColor2 * 0.55, 0.65 * dcWoCav );
		diffuseColor.rgb = clamp( dcWoC1, 0.0, 1.0 );
	}
#endif
`;

const WORN_ROUGHNESS = /* glsl */ `
#ifdef DICER_WORN
	// handled faces a little duller, scratches and grime rougher, worn edges smoother
	roughnessFactor = clamp( roughnessFactor + ( 0.12 + 0.3 * dcWoScr + 0.25 * dcWoCav ) * ( 1.0 - dcMask ), 0.0, 1.0 );
	roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.4, dcWoEdge );
#endif
`;

export function metalFinishPatch(a) {
  if (a.body?.type !== 'metal') return {};
  if (a.body.finish === 'patina') {
    return {
      defines: { DICER_PATINA: '' },
      chunks: { colorPost: PATINA_COLOR, roughness: PATINA_ROUGHNESS },
      replace: PATINA_REPLACE,
    };
  }
  if (a.body.finish === 'worn') {
    return {
      defines: { DICER_WORN: '' },
      chunks: { colorPost: WORN_COLOR, roughness: WORN_ROUGHNESS },
    };
  }
  return {};
}

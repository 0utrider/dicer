/**
 * The suspension layer: one optional, lightweight layer composited over the main inside
 * (interior.extra: foil flakes, glitter, sand or bubbles, with interior.extraColor and
 * interior.extraDensity). insidePatch (index.js) renames the main inside's dcInterior to dcXMain
 * and appends withExtra()'s GLSL: per march segment, the layer, then the main inside behind it.
 * Same march and step count, so the cost is bounded: one layer sample per step.
 *
 * Reuse, not copies: foil is foil.js's GLSL and glitter / sand are living.js's glitter, each
 * re-prefixed (dcXf, dcXg) so they coexist with a foil or glitter main, and reading the layer's
 * uniforms instead of the main's: uInteriorExtra (rgb: colour, linear; a: density) and
 * uInteriorExtraKind (the EXTRA_KINDS index). The kind is a uniform branch, so every kind shares
 * one program (programKey's '+x'). Sand is the glitter flake turned matte (specks, no flash).
 * Bubbles are their own: at most one small air bubble per hashed cell, its front surface tested
 * exactly per segment (ray / sphere), drawn as a mirror ring round a clear middle.
 *
 * With motion (live), glitter and sand swirl with the inside (uInteriorSwirl, MOTION_PARS in the
 * pars); otherwise the swirl is a constant 1e-4 rad (still flakes).
 */
import * as THREE from 'three';
import { swap } from './live.js';
import { foilInside, MARCH_RADIUS } from './foil.js';
import { GLITTER } from './living.js';

/** interior.extra kinds (not 'none'), in uInteriorExtraKind order. */
export const EXTRA_KINDS = Object.freeze(['foil', 'glitter', 'sand', 'bubbles']);

const SIG = 'vec4 dcInterior( vec3 p, vec3 rd, float dt )';
const f = (x) => x.toFixed(4);

// the main inside's colour / density uniforms -> the layer's (colors[1]: a paler shade of the one colour)
const recolor = (s) =>
  s.replaceAll('uInteriorColors[ 0 ]', 'uInteriorExtra.rgb').replaceAll('uInteriorColors[ 1 ]', 'DC_X_PALE').replaceAll('uInteriorDensity', 'uInteriorExtra.a');

const foilLayer = () => recolor(swap(foilInside(null, false).body, SIG, 'vec4 dcXfLayer( vec3 p, vec3 rd, float dt )')).replaceAll('dcFo', 'dcXf').replaceAll('DC_FO_', 'DC_XF_');

const glitterLayer = (live) => {
  let g = swap(GLITTER, SIG, 'vec4 dcXgLayer( vec3 p, vec3 rd, float dt )');
  // sand: the same flake, lit matte (more diffuse, almost no flash)
  g = swap(swap(g, 'spec * 10.0', 'spec * DC_X_SHINE'), '0.3 * dcILight', 'DC_X_DIFF * dcILight');
  // still: a swirl too small to see (an exact 0 makes the compiler fold a division by zero)
  if (!live) g = g.replaceAll('uInteriorSwirl', 'vec3( 0.0, 1e-4, 0.0 )');
  return recolor(g).replaceAll('dcLv', 'dcXg').replaceAll('DC_LV_', 'DC_XG_');
};

const BUBBLES = /* glsl */ `
#define DC_XB_CELLS 8.0
vec4 dcXbBubble( vec3 cell, vec3 p, vec3 rd, float dt ) {
	if ( dcHash13( cell + 41.3 ) > 0.05 + 0.3 * uInteriorExtra.a ) return vec4( 0.0 );
	// the centre in [0.3, 0.7] of the cell and the radius at most 0.28 cell: whole in its cell
	vec3 c = ( cell + 0.3 + 0.4 * vec3( dcHash13( cell + 2.9 ), dcHash13( cell + 8.1 ), dcHash13( cell + 13.7 ) ) ) / DC_XB_CELLS;
	float h = dcHash13( cell + 5.3 );
	float br = mix( 0.07, 0.28, h * h ) / DC_XB_CELLS; // mostly small, a few larger
	if ( length( c ) > ${f(MARCH_RADIUS)} - br ) return vec4( 0.0 );
	vec3 o = p - c;
	float b = dot( o, rd );
	float m2 = dot( o, o ) - b * b;
	if ( m2 >= br * br ) return vec4( 0.0 );
	float t = - b - sqrt( br * br - m2 );
	if ( t < 0.0 || t >= dt ) return vec4( 0.0 ); // the front surface, on the segment that crosses it
	vec3 n = ( o + rd * t ) / br;
	// beyond the critical angle the air mirrors: a bright ring, a clear middle
	float ring = 1.0 - smoothstep( 0.35, 0.75, abs( dot( n, rd ) ) );
	vec3 r = reflect( rd, n );
	vec3 col = mix( uInteriorExtra.rgb, vec3( 1.0 ), 0.5 ) * ( dcILight * ( 0.35 + 0.65 * smoothstep( - 0.3, 0.8, dot( r, dcIUp ) ) ) + 0.1 );
	float spec = 2.5 * pow( max( dot( r, dcIKey ), 0.0 ), 60.0 );
	float a = 0.75 * ring;
	return vec4( min( col * a + spec, vec3( 1.0 ) ), min( a + spec, 1.0 ) );
}
vec4 dcXbLayer( vec3 p, vec3 rd, float dt ) {
	vec3 c0 = floor( p * DC_XB_CELLS );
	vec3 c1 = floor( ( p + rd * dt ) * DC_XB_CELLS );
	vec4 acc = dcXbBubble( c0, p, rd, dt );
	if ( any( notEqual( c0, c1 ) ) ) acc += ( 1.0 - acc.a ) * dcXbBubble( c1, p, rd, dt );
	return acc;
}
`;

/** GLSL defining `vec4 dcXLayer( vec3 p, vec3 rd, float dt )` (the layer over one march segment). */
export function extraLayer(live = false) {
  return `uniform vec4 uInteriorExtra;
uniform float uInteriorExtraKind;
#define DC_X_PALE min( uInteriorExtra.rgb * 1.25 + 0.15, vec3( 1.0 ) )
#define DC_X_SHINE ( uInteriorExtraKind > 1.5 ? 0.6 : 10.0 )
#define DC_X_DIFF ( uInteriorExtraKind > 1.5 ? 0.9 : 0.3 )
${foilLayer()}
${glitterLayer(live)}
${BUBBLES}
vec4 dcXLayer( vec3 p, vec3 rd, float dt ) {
	vec4 x;
	if ( uInteriorExtraKind < 0.5 ) x = dcXfLayer( p, rd, dt );
	else if ( uInteriorExtraKind < 2.5 ) x = dcXgLayer( p, rd, dt );
	else x = dcXbLayer( p, rd, dt );
	return x;
}
`;
}

/** `body` (a main inside's GLSL) with its dcInterior renamed dcXMain and the layer composited over it. */
export function withExtra(body, live = false) {
  return `${swap(body, SIG, 'vec4 dcXMain( vec3 p, vec3 rd, float dt )')}
${extraLayer(live)}
${SIG} {
	vec4 x = dcXLayer( p, rd, dt );
	return x + ( 1.0 - x.a ) * dcXMain( p, rd, dt );
}
`;
}

/** The layer's uniforms for interior `i` (its colour as createDiceMaterial converts colours: linear). */
export function extraUniforms(i) {
  const c = new THREE.Color(i.extraColor);
  return {
    uInteriorExtra: { value: new THREE.Vector4(c.r, c.g, c.b, i.extraDensity) },
    uInteriorExtraKind: { value: EXTRA_KINDS.indexOf(i.extra) },
  };
}

import * as THREE from 'three';
import { TEX, getTexture } from './textures.js';

/**
 * Particle shapes. DOT, SMOKE, GLINT, SHARD and FLAME sample the generated sprite masks
 * (textures.js), packed side by side into one atlas so each pool layer stays a single draw;
 * STREAK, RING and FLAKE stay procedural.
 * `SHAPE_GLSL` defines `float shapeAlpha(int shape, vec2 q, float seed)`: the coverage (0..1) of
 * a shape at q in -1..1 across the particle's quad (+y up, +x along a streak's motion; 0 outside
 * the quad); `seed` is a per-particle random 0..1 that mirrors or varies the shape. It also
 * defines `float shapeGlow(vec2 q)` (the GLOW mask, for halos) and needs the uniforms
 * `uAtlas` and `uTile[5]` from `buildAtlas()`.
 */
export const SHAPE = Object.freeze({
  DOT: 0,
  STREAK: 1,
  SMOKE: 2,
  GLINT: 3,
  SHARD: 4,
  FLAME: 5,
  FLAKE: 6,
  RING: 7,
});

/** The atlas tiles, left to right (the index is the tile number in uTile). */
const ATLAS = [TEX.GLOW, TEX.PUFF, TEX.SPARK, TEX.FLAME, TEX.SHARD];
const ATLAS_H = 128;

/**
 * Copies the five masks side by side into one RGBA8 DataTexture (height 128, the shorter masks
 * padded with zeros above). The CPU data stays on `image.data`, so a context restore re-uploads it.
 * `tiles[i]` is tile i's rect (u0, v0, du, dv), inset half a texel so filtering stays in the tile.
 * @returns {{texture: THREE.DataTexture, tiles: THREE.Vector4[]}}
 */
export function buildAtlas() {
  const masks = ATLAS.map((kind) => getTexture(kind).image);
  const W = masks.reduce((s, m) => s + m.width, 0);
  const data = new Uint8Array(W * ATLAS_H * 4);
  const tiles = [];
  let x0 = 0;
  for (const { width: w, height: h, data: src } of masks) {
    for (let y = 0; y < h; y++) data.set(src.subarray(y * w * 4, (y + 1) * w * 4), (y * W + x0) * 4);
    tiles.push(new THREE.Vector4((x0 + 0.5) / W, 0.5 / ATLAS_H, (w - 1) / W, (h - 1) / ATLAS_H));
    x0 += w;
  }
  const texture = new THREE.DataTexture(data, W, ATLAS_H, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return { texture, tiles };
}

export const SHAPE_GLSL = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec4 uTile[ 5 ];
float shapeTexel( int tile, vec2 q ) {
	vec4 rect = uTile[ tile ];
	float inside = step( max( abs( q.x ), abs( q.y ) ), 1.0 );
	return texture2D( uAtlas, rect.xy + clamp( q * 0.5 + 0.5, 0.0, 1.0 ) * rect.zw ).a * inside;
}
float shapeGlow( vec2 q ) {
	return shapeTexel( 0, q );
}
float shapeAlpha( int shape, vec2 q, float seed ) {
	float r = length( q );
	// DOT -> GLOW (0), SMOKE -> PUFF (1), GLINT -> SPARK (2), FLAME -> FLAME (3), SHARD -> SHARD (4).
	int tile = shape == 0 ? 0 : shape == 2 ? 1 : shape == 3 ? 2 : shape == 5 ? 3 : shape == 4 ? 4 : -1;
	// Puffs and shards are mirrored for half the particles, so a burst does not repeat one sprite.
	vec2 tq = ( ( shape == 2 || shape == 4 ) && seed > 0.5 ) ? vec2( - q.x, q.y ) : q;
	// The fetch is outside any branch (mipmapped sampling needs uniform control flow).
	float tex = shapeTexel( max( tile, 0 ), tq );
	if ( tile >= 0 ) return tex;
	if ( shape == 1 ) {
		// STREAK: a soft capsule along x.
		float d = length( vec2( max( abs( q.x ) - 0.55, 0.0 ) / 0.45, q.y ) );
		return 1.0 - smoothstep( 0.35, 1.0, d );
	}
	if ( shape == 6 ) {
		// FLAKE: a diamond.
		float d = abs( q.x ) * 1.35 + abs( q.y );
		return 1.0 - smoothstep( 0.55, 0.9, d );
	}
	if ( shape == 7 ) {
		// RING: a thin annulus.
		return 1.0 - smoothstep( 0.0, 0.14, abs( r - 0.78 ) );
	}
	return 0.0;
}
`;

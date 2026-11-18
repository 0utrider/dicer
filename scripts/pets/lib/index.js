/**
 * The pet model library (browser and node; see scripts/pets/README.md). export.js is separate:
 * it is node-only (it post-processes the exported .glb).
 */
export * from './math.js';
export * from './sdf.js';
export * from './mesh.js';
export * from './uv.js';
export { createCanvas, write, paintShell, paintRect, dilate, toTexture } from './paint.js';
export * from './skin.js';
export * from './rig.js';
export * from './parts.js';

/** The spec's shape key names: the 7 required, then the optional ones. */
export const REQUIRED_KEYS = ['blink_L', 'blink_R', 'happy', 'sad', 'surprised', 'mouthOpen', 'angry'];
export const ALL_KEYS = [...REQUIRED_KEYS, 'squint_L', 'squint_R', 'puff', 'tongue'];

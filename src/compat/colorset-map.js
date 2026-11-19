/** Maps Dice So Nice style colorsets onto Dicer appearances (pure; no DOM, no three). */
import { cssToHex } from './colors.js';
import { normalizeAppearance } from '../look/appearance.js';

const pickAt = (v, index) => {
  if (Array.isArray(v)) return v.length ? v[((index % v.length) + v.length) % v.length] : undefined;
  return v;
};

function isYellowish(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return false;
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return h >= 35 && h <= 60 && s > 0.4;
}

// Body mapping per DSN material name. Unknown names fall through to plastic.
const MATERIALS = {
  pristine: { type: 'opaque', roughness: 0.1 },
  wood: { type: 'opaque', roughness: 0.75 }, // Dicer has no wood body
  metal: { type: 'metal', finish: 'polished', roughness: 0.6 }, // Dice So Nice's metal is satin, not a mirror
  chrome: { type: 'metal', finish: 'polished', roughness: 0.05 },
  glass: { type: 'resin', interior: 'none' },
  stone: { type: 'marble' },
  iridescent: { type: 'pearl' },
};
const PLASTIC = { type: 'opaque', roughness: 0.35 };

/**
 * Texture ruling: a texture with an image file (a module's addTexture source) is drawn as the
 * body image (textureImage); otherwise only the texture's name/id matters: marble/stone gives a
 * marble body, metal/bronze gives an antique metal body, anything else is ignored.
 */
function textureBody(texture, textures) {
  const id = typeof texture === 'string' ? texture : texture && typeof texture === 'object' ? texture.id ?? texture.name : null;
  if (typeof id !== 'string') return null;
  const entry = textures instanceof Map ? textures.get(id) : null;
  const text = `${id} ${entry?.name ?? (typeof texture === 'object' ? texture.name ?? '' : '')}`.toLowerCase();
  if (/marble|stone/.test(text)) return { type: 'marble' };
  if (/metal|bronze/.test(text)) return { type: 'metal', finish: 'antique' };
  return null;
}

/**
 * A colorset texture with an image file, as a body image on every face (Dice So Nice lays its
 * texture on each face): source-over draws it over the colour as it is, multiply tints it with
 * the colour, any other composite tints it at half strength. Null without an image file.
 */
function textureImage(texture, textures) {
  const id = typeof texture === 'string' ? texture : texture && typeof texture === 'object' ? texture.id ?? texture.name : null;
  const entry = (typeof id === 'string' && textures instanceof Map ? textures.get(id) : null) ?? (typeof texture === 'object' ? texture : null);
  const src = typeof entry?.source === 'string' ? entry.source : null;
  if (!src) return null;
  const composite = typeof entry.composite === 'string' ? entry.composite : 'source-over';
  const over = composite === 'source-over';
  return { src, mode: 'face', tint: !over, blend: over || composite === 'multiply' ? 1 : 0.5 };
}

export function colorsetToAppearance(colorset, { textures, index = 0 } = {}) {
  const cs = colorset && typeof colorset === 'object' ? colorset : {};
  const hex = (v) => cssToHex(pickAt(v, index), null) ?? undefined;
  const material = typeof cs.material === 'string' ? cs.material.toLowerCase() : '';
  const spec = { ...(Object.hasOwn(MATERIALS, material) ? MATERIALS[material] : PLASTIC) };
  const image = textureImage(cs.texture, textures);
  if (!image) Object.assign(spec, textureBody(cs.texture, textures) ?? {});

  const fg = hex(cs.foreground);
  const body = { type: spec.type, color: hex(cs.background), color2: hex(cs.edge) ?? hex(cs.outline) };
  if (spec.finish) body.finish = spec.finish;
  if (spec.roughness !== undefined) body.roughness = spec.roughness;
  const metallic = body.type === 'metal' && (material === 'metal' || material === 'chrome');
  const input = {
    body,
    numbers: { fill: metallic && fg && isYellowish(fg) ? 'gold' : 'paint', color: fg },
  };
  // The colorset's font, as a page font (normalizeAppearance keeps a valid family; one the page
  // never loaded draws in the serif, as any missing css font does).
  if (typeof cs.font === 'string' && cs.font.trim() && cs.font !== 'auto') input.numbers.font = `css:${cs.font.trim()}`;
  if (spec.interior) input.interior = { type: spec.interior };
  if (image) input.bodyImage = image; // normalizeAppearance drops a path it does not accept
  const glowColor = cssToHex(cs.emissive, null);
  if (glowColor) {
    const raw = typeof cs.emissiveIntensity === 'number' && Number.isFinite(cs.emissiveIntensity) ? cs.emissiveIntensity : 1;
    input.glow = { color: glowColor, intensity: Math.max(0, Math.min(2, raw)) };
  }
  return normalizeAppearance(input);
}

export const BUILTIN_COLORSETS = {
  white: { foreground: '#1a1a1a', background: '#f4f1ea', edge: '#cfcabd', material: 'plastic' },
  black: { foreground: '#f2f2f2', background: '#16161a', edge: '#3a3a42', material: 'plastic' },
  red: { foreground: '#ffffff', background: '#c8221c', edge: '#7a110e', material: 'plastic' },
  blue: { foreground: '#ffffff', background: '#1f4fc9', edge: '#12307d', material: 'plastic' },
  green: { foreground: '#ffffff', background: '#1f9a3f', edge: '#0f5c24', material: 'plastic' },
  yellow: { foreground: '#2a2200', background: '#f2d21e', edge: '#b89a0a', material: 'plastic' },
  purple: { foreground: '#ffffff', background: '#7a35c4', edge: '#471d7a', material: 'plastic' },
  orange: { foreground: '#1f1000', background: '#f08a1c', edge: '#a85a08', material: 'plastic' },
  pink: { foreground: '#4a0f2c', background: '#f58cbc', edge: '#c24d84', material: 'plastic' },
  grey: { foreground: '#ffffff', background: '#767a82', edge: '#4a4d54', material: 'plastic' },
  gold: { foreground: '#3b2a00', background: '#e0b02a', edge: '#8f6c0a', material: 'metal' },
  silver: { foreground: '#1c1f26', background: '#c4c9d2', edge: '#7c828e', material: 'metal' },
  bronze: { foreground: '#2a1608', background: '#a8672e', edge: '#5c3513', material: 'metal' },
  glass: { foreground: '#ffffff', background: '#8fd0e8', edge: '#4f8fa8', material: 'glass' },
  fire: { foreground: '#ffe9a8', background: '#d63a0c', edge: '#7a1a04', material: 'plastic', emissive: '#ff6a1a', emissiveIntensity: 0.6 },
  ice: { foreground: '#0c2a44', background: '#bfe6f7', edge: '#6aa9cc', material: 'glass' },
  poison: { foreground: '#e8ffd0', background: '#4a7a1a', edge: '#27420a', material: 'plastic' },
  acid: { foreground: '#143000', background: '#a6e01c', edge: '#5f8a08', material: 'glass', emissive: '#b8ff2a', emissiveIntensity: 0.4 },
  lightning: { foreground: '#0a1a44', background: '#f5e642', edge: '#8a7d0c', material: 'plastic', emissive: '#fff35a', emissiveIntensity: 0.7 },
  thunder: { foreground: '#e8eeff', background: '#3a3f6b', edge: '#1c1f3a', material: 'plastic' },
  force: { foreground: '#ffffff', background: '#c43ab8', edge: '#6f1566', material: 'glass', emissive: '#ff66f0', emissiveIntensity: 0.5 },
  radiant: { foreground: '#4a3500', background: '#fff1b8', edge: '#d9b84a', material: 'pristine', emissive: '#ffe680', emissiveIntensity: 0.6 },
  necrotic: { foreground: '#b8f0c8', background: '#1e2a24', edge: '#0a100d', material: 'plastic' },
  psychic: { foreground: '#ffffff', background: '#9a52d6', edge: '#d9a0ff', material: 'iridescent' },
  bludgeoning: { foreground: '#ffffff', background: '#6e5a48', edge: '#3d3126', material: 'wood' },
  piercing: { foreground: '#1c1f26', background: '#9aa0aa', edge: '#d6dae0', material: 'metal' },
  slashing: { foreground: '#ffffff', background: '#8f1d2c', edge: '#c9ced6', material: 'plastic' },
};

export const GHOST_APPEARANCE = normalizeAppearance({
  body: { type: 'resin', color: '#c8ccd4', color2: '#9aa0ab' },
  interior: { type: 'none' },
  numbers: { fill: 'paint', color: '#c8ccd4' },
  glow: { intensity: 0 },
});

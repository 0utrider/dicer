/**
 * Face labels of a registered Dice So Nice preset, classified for the renderer: digits the MSDF
 * atlas can draw stay glyphs; image files and other text are rasterized per face
 * (render/face-textures.js). Everything read here is third-party data: nothing may throw.
 */
import { getShape, labelFor, resultOf } from '../core/dice-shapes.js';

const IMAGE_EXT = /\.(png|jpe?g|webp|svg|gif)$/i;
/** layoutLabel draws at most two glyph slots per face. */
const MAX_GLYPHS = 2;

/** FNV-1a 32-bit hash of a string, as 8 hex digits. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A relabelled die's face images in a look: [its appearance.faces key, the image key of shape face
 * v]. A coin: 1 heads, 0 tails; a Fate die: -1, 0, 1; a d100's tens die: 10 ... 100 (00).
 */
const VARIANT_FACES = {
  dc: ['dc', (v) => resultOf(v, 'dc')],
  dF: ['df', (v) => resultOf(v, 'dF')],
  d100tens: ['d100', (v) => v * 10],
};

/**
 * A look's own face images (appearance.faces[type]: face value -> image path) as a FaceSet over
 * `base` (a preset's FaceSet): a face with an image shows it, any other keeps base's label or its
 * number. `appearance.facesTint`: the images are masks in the number colour, like text faces.
 * `variant`: a coin, Fate die or d100 tens die reads its own key (VARIANT_FACES); another
 * relabelled die (d3 / d5 / d7) has none. `base` itself when the look has no images for it.
 */
export function lookFacesFor(type, appearance, base, variant) {
  const vf = variant ? VARIANT_FACES[variant] : null;
  if (variant && !vf) return base;
  const key = vf ? vf[0] : type;
  const map = appearance?.faces?.[key];
  if (!map) return base;
  let shape;
  try {
    shape = getShape(type);
  } catch {
    return base;
  }
  const tint = appearance.facesTint === true;
  const labels = shape.values.map((v, i) => {
    const url = map[vf ? vf[1](v) : v];
    return url
      ? { kind: 'image', url, ...(tint ? { tint } : {}) }
      : (base?.labels?.[i] ?? { kind: 'glyph', text: labelFor(type, variant === 'd100tens' ? v * 10 : v, variant) });
  });
  return { key: `look|${key}|${tint ? 1 : 0}|${hash(JSON.stringify(map))}|${base?.key ?? ''}`, labels };
}

/** The Fate die's faces on Dicer's d6 (text faces drawn from face layers): 1, 2 +; 3, 4 blank; 5, 6 −. */
export const FATE_FACES = Object.freeze({
  key: 'dicer|df',
  labels: Object.freeze(
    getShape('d6').values.map((v) =>
      Object.freeze(v > 2 && v < 5 ? { kind: 'blank' } : { kind: 'text', text: v < 3 ? '+' : '−' }),
    ),
  ),
});

/** @returns {import('../throw/throw-planner.js').FaceLabel} */
export function classifyLabel(label, atlasHasGlyphs) {
  const text = String(label ?? '');
  if (text === '') return { kind: 'blank' };
  if (IMAGE_EXT.test(text.split(/[?#]/)[0])) return { kind: 'image', url: text };
  let glyph = false;
  try {
    glyph = atlasHasGlyphs(text) === true;
  } catch {
    glyph = false;
  }
  return glyph ? { kind: 'glyph', text } : { kind: 'text', text };
}

/**
 * The atlas test for facesFor: every character is in the digit atlas and the label fits its
 * two glyph slots.
 * @param {{glyphs: Map<string, object>}} atlas
 */
export function atlasGlyphTest(atlas) {
  return (text) => {
    const chars = [...String(text)];
    return chars.length > 0 && chars.length <= MAX_GLYPHS && chars.every((c) => atlas?.glyphs?.has(c));
  };
}

/** Preset label index per face of the base shape (face i shows value values[i]). */
function faceOrder(preset, count) {
  try {
    // A d100 preset dresses the tens die, a d10.
    const values = getShape(preset.shape ?? (preset.type === 'd100' ? 'd10' : preset.type)).values;
    if (values.length === count) return values.map((v) => v - 1);
  } catch {
    /* an unknown shape keeps the preset's own order */
  }
  return Array.from({ length: count }, (_, i) => i);
}

/**
 * @param {object} preset a registry PresetEntry ({system, type, shape?, labels})
 * @param {(text: string) => boolean} atlasHasGlyphs
 * @returns {import('../throw/throw-planner.js').FaceSet | undefined} undefined when the preset
 *   has no labels (model presets) or only the plain numbers Dicer draws anyway
 */
export function facesFor(preset, atlasHasGlyphs) {
  const given = Array.isArray(preset?.labels) ? preset.labels.map((l) => String(l ?? '')) : [];
  if (!given.length) return undefined;
  const order = faceOrder(preset, given.length);
  const ordered = order.map((i) => given[i] ?? '');
  const labels = ordered.map((l) => classifyLabel(l, atlasHasGlyphs));
  // Plain numbers: Dicer's own labels draw the same digits (and underline 6 and 9).
  const tens = preset.type === 'd100';
  const plain = labels.every(
    (l, i) =>
      l.kind === 'glyph' &&
      (tens
        ? l.text === labelFor('d10', (order[i] + 1) * 10, 'd100tens') || l.text === String((order[i] + 1) * 10)
        : l.text === String(order[i] + 1) || l.text === labelFor(preset.type, order[i] + 1)),
  );
  if (plain) return undefined;
  const key = `${preset.system ?? ''}|${preset.type ?? ''}|${hash(ordered.join('\u0000'))}`;
  return { key, labels };
}

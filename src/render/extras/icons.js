import { labelFor } from '../../core/dice-shapes.js';
import { glyphComposer, circle } from './glyph-atlas.js';

/**
 * Crit and fumble icons: own-work glyphs drawn into the label atlas next to the digits
 * (glyph-atlas.js), so a die's max face (crit) or its 1 (fumble) shows an icon through the
 * ordinary label path. Only the labels and the atlas change; the shader and the program key do not.
 *
 * World-start cost: every binding this chunk imports from the world-start bundle makes dicer.js
 * export it. So ICON_IDS (look/appearance.js) is not imported: ICON_PATHS lists the icons in
 * ICON_IDS order (tests/unit/icons.test.js checks it against the original).
 */

/**
 * SVG path data in a 0..100 viewBox, filled even-odd (subpaths never overlap, so a nested one is
 * a hole). No stroke, gap or hole is thinner than 8 units, so each survives a 64 px SDF. Keys are
 * in ICON_IDS order.
 */
export const ICON_PATHS = Object.freeze({
  // an eight-point burst
  starburst:
    'M 50 0 L 60.3 25.1 L 85.4 14.6 L 74.9 39.7 L 100 50 L 74.9 60.3 L 85.4 85.4 L 60.3 74.9 ' +
    'L 50 100 L 39.7 74.9 L 14.6 85.4 L 25.1 60.3 L 0 50 L 25.1 39.7 L 14.6 14.6 L 39.7 25.1 Z',
  // three-point crown with a jewel over each point and a band below
  crown:
    'M 8 36 L 30 58 L 50 28 L 70 58 L 92 36 L 84 76 L 16 76 Z M 16 84 L 84 84 L 84 100 L 16 100 Z ' +
    `${circle(8, 20, 8)} ${circle(50, 10, 9)} ${circle(92, 20, 8)}`,
  // cranium and jaw with two eye sockets, a nose hole and three teeth
  skull:
    'M 50 0 C 23 0 4 18 4 44 C 4 60 12 70 22 74 L 22 100 L 36 100 L 36 88 L 45 88 L 45 100 ' +
    'L 55 100 L 55 88 L 64 88 L 64 100 L 78 100 L 78 74 C 88 70 96 60 96 44 C 96 18 77 0 50 0 Z ' +
    `${circle(32, 41, 12)} ${circle(68, 41, 12)} M 50 62 L 58 76 L 42 76 Z`,
  // a heater shield split by a zigzag crack
  'broken-shield':
    'M 45 1.6 L 6 14 L 6 46 C 6 72 24 89 47 99 L 39 66 L 51 46 L 37 26 Z ' +
    'M 55 1.6 L 94 14 L 94 46 C 94 72 76 89 57 99 L 49 66 L 61 46 L 47 26 Z',
  heart:
    'M 50 100 C 22 80 0 60 0 32 C 0 13 13 0 29 0 C 39 0 46 6 50 14 C 54 6 61 0 71 0 ' +
    'C 87 0 100 13 100 32 C 100 60 78 80 50 100 Z',
  // a flame with a side lick and an inner flame cut out
  flame:
    'M 52 0 C 56 20 84 34 84 64 C 84 86 68 100 50 100 C 32 100 16 86 16 66 C 16 52 22 42 30 34 ' +
    'C 30 44 34 52 40 56 C 38 34 44 16 52 0 Z ' +
    'M 50 50 C 54 62 64 68 64 78 C 64 85 58 88 50 88 C 42 88 36 85 36 78 C 36 68 46 62 50 50 Z',
});

const IDS = Object.keys(ICON_PATHS); // ICON_IDS, in order

/** The atlas char of each icon: private-use code points, in ICON_IDS order. */
export const ICON_CHARS = Object.freeze(
  Object.fromEntries(IDS.map((id, i) => [id, String.fromCharCode(0xe000 + i)])),
);

/**
 * The face labels with the crit icon on the d20's 20 and the fumble icon on its 1. Only the d20
 * shows icons: every other die returns its labels unchanged (the d100 ones die is a plain d10,
 * and the d4 reads its result face-down). Only faces that carry their plain number change:
 * preset glyph / blank / layered faces and ghosts ('') keep their labels.
 */
export function iconLabels(labels, shape, icons) {
  const values = shape?.values;
  if (shape?.type !== 'd20' || !values?.length || !(icons?.crit || icons?.fumble)) return labels;
  return labels.map((label, i) => {
    const v = values[i];
    if (v === undefined || label !== labelFor(shape.type, v)) return label;
    if (icons.crit && v === 20) return ICON_CHARS[icons.crit];
    if (icons.fumble && v === 1) return ICON_CHARS[icons.fumble];
    return label;
  });
}

/** The atlas with the six icons added (glyph-atlas.js glyphComposer), or null. */
export const withIcons = glyphComposer(
  IDS.map((id) => [ICON_CHARS[id], ICON_PATHS[id]]),
  1.15,
  'dicer-icons',
);

/**
 * ExtrasPatch for the crit/fumble icons: new labels and the icon atlas, or {} when no icon is on,
 * the die is not a d20 (no label changes, so no composed atlas) or the atlas cannot take icons. `compose` is the test seam.
 */
export function iconPatch(a, ctx, compose = withIcons) {
  const icons = a.numbers.icons;
  if (!icons?.crit && !icons?.fumble) return {};
  const labels = ctx?.labels;
  if (!labels) return {};
  const next = iconLabels(labels, ctx.shape, icons);
  if (next.every((l, i) => l === labels[i])) return {};
  const atlas = compose(ctx.atlas);
  return atlas ? { labels: next, atlas } : {};
}

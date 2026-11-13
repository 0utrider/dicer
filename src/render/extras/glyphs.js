import { labelFor } from '../../core/dice-shapes.js';
import { glyphComposer, circle } from './glyph-atlas.js';

/**
 * Pipped d6 and coin motifs: own-work glyphs drawn into the label atlas (glyph-atlas.js), one
 * glyph per face value, so the pips and motifs take the number's fill, depth and relief through
 * the ordinary label path. Only the labels and the atlas change; the shader and the program key
 * do not.
 *
 * Like the crit icons, they replace only plain numbers: pips on a d6 whose every label is its
 * number (labelFor('d6', v)), motifs on the d2 (the coin). Preset faces, Fate and relabelled d6s
 * (their labels differ), ghosts ('') and every other die keep their labels. Icons are d20-only, so
 * at most one of icons / pips / coin relabels a die.
 *
 * Paths are in a 0..100 viewBox. No part, gap or hole is thinner than 8 units (pointed tips aside),
 * so each survives the distance field.
 */

const r1 = (n) => Math.round(n * 10) / 10;

// Pips: round pips on a 3 x 3 grid, as on real dice (pip diameter ~ 0.27 of the pattern).
const PIP_R = 13.5;
const AT = [PIP_R, 50, 100 - PIP_R];
/** Grid cells [column, row] of each value's pips, 1..6. */
const LAYOUTS = [
  [[1, 1]],
  [[2, 0], [0, 2]],
  [[2, 0], [1, 1], [0, 2]],
  [[0, 0], [2, 0], [0, 2], [2, 2]],
  [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
];
/** SVG path of each pip layout, for values 1..6. */
export const PIP_PATHS = Object.freeze(LAYOUTS.map((cells) => cells.map(([c, r]) => circle(AT[c], AT[r], PIP_R)).join(' ')));

/** Pip glyph chars, for values 1..6 (private use, clear of the icons' U+E000..). */
export const PIP_CHARS = Object.freeze(PIP_PATHS.map((_, i) => String.fromCharCode(0xe010 + i)));

/** A lens (leaf) from (x, y), length len, width w, at angle a (radians, SVG y down). */
function leaf(x, y, a, len, w) {
  const s = w / 2;
  const R = r1((len * len) / 4 / (2 * s) + s / 2);
  const tx = r1(x + len * Math.cos(a));
  const ty = r1(y + len * Math.sin(a));
  return `M ${r1(x)} ${r1(y)} A ${R} ${R} 0 0 1 ${tx} ${ty} A ${R} ${R} 0 0 1 ${r1(x)} ${r1(y)} Z`;
}

const RAD = Math.PI / 180;

/** Two laurel branches on curved stems, crossing at the bottom and open at the top. */
function laurel() {
  const parts = [];
  const R = 36;
  const cy = 52;
  for (const side of [-1, 1]) {
    const at = (r, t) => `${r1(50 + side * r * Math.sin(t))} ${r1(cy + r * Math.cos(t))}`;
    const [t0, t1] = [-12 * RAD, 150 * RAD];
    const sweep = side > 0 ? 0 : 1;
    // the stem: an 8-unit band along the arc
    parts.push(`M ${at(R - 4, t0)} A ${R - 4} ${R - 4} 0 0 ${sweep} ${at(R - 4, t1)} L ${at(R + 4, t1)} A ${R + 4} ${R + 4} 0 0 ${1 - sweep} ${at(R + 4, t0)} Z`);
    for (let k = 0; k < 7; k++) {
      const t = (20 + k * 20) * RAD; // from the bottom, up the side
      // the tangent heading up the branch; a leaf off it to each side
      const up = Math.atan2(-Math.sin(t), side * Math.cos(t));
      const x = 50 + side * R * Math.sin(t);
      const y = cy + R * Math.cos(t);
      parts.push(leaf(x, y, up - side * 0.6, 20, 10), leaf(x, y, up + side * 0.5, 18, 9));
    }
    // the top leaf continues the stem
    parts.push(leaf(50 + side * R * Math.sin(t1), cy + R * Math.cos(t1), Math.atan2(-Math.sin(t1), side * Math.cos(t1)), 18, 10));
  }
  return parts.join(' ');
}

/** A rayed sun: a disc in a ring of ten pointed rays. */
function sun() {
  const rays = [];
  for (let k = 0; k < 10; k++) {
    const a = (k * 36 - 90) * RAD;
    const h = 0.18; // ray bases 11.5 wide, 8.6 apart
    const p = (r, d) => `${r1(50 + r * Math.cos(a + d))} ${r1(50 + r * Math.sin(a + d))}`;
    rays.push(`M ${p(32, -h)} L ${p(50, 0)} L ${p(32, h)} Z`);
  }
  return `${circle(50, 50, 24)} ${rays.join(' ')}`;
}

/** A crescent: a disc less an offset disc. */
function crescent() {
  const [ax, ay, ar] = [50, 50, 48];
  const [bx, by, br] = [70, 38, 40];
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  const m = (ar * ar - br * br + d * d) / (2 * d);
  const h = Math.sqrt(ar * ar - m * m);
  const p = (s) => `${r1(ax + (m * dx - s * h * dy) / d)} ${r1(ay + (m * dy + s * h * dx) / d)}`;
  return `M ${p(1)} A ${ar} ${ar} 0 1 1 ${p(-1)} A ${br} ${br} 0 1 0 ${p(1)} Z`;
}

/** Coin motif paths: heads (a crowned head in profile), tails (a laurel wreath), sun, moon. */
export const COIN_PATHS = Object.freeze({
  heads:
    // a three-point crown above a head facing left: brow, nose, lips, chin, neck and bust
    'M 28 25 L 28 3 L 41 14 L 54 0 L 67 14 L 80 3 L 80 25 Z ' +
    'M 31 36 C 44 32 68 32 80 38 C 92 46 93 62 85 72 L 78 79 C 78 87 84 93 94 100 L 22 100 ' +
    'C 31 94 40 90 42 84 L 42 81 L 34 81 C 28 81 26 78 27 75 C 25 74 24 72 26 70.5 L 24 69 ' +
    'C 23 67 25 65.5 26 64.5 C 22 64 18 63 15 61 C 18 57 22 53 24 50 C 24 44 27 39 31 36 Z',
  tails: laurel(),
  sun: sun(),
  moon: crescent(),
});
/** Fill rule per motif: the wreath's leaves overlap its stems (each part filled on its own). */
const COIN_RULES = { tails: 'union' };

/** Coin motif chars (private use, clear of the icons and pips). */
export const COIN_CHARS = Object.freeze(
  Object.fromEntries(Object.keys(COIN_PATHS).map((id, i) => [id, String.fromCharCode(0xe020 + i)])),
);
/** The motif pair of each coin option: [value 1, value 2]. */
const COIN_PAIRS = { 'heads-tails': ['heads', 'tails'], 'sun-moon': ['sun', 'moon'] };

/**
 * The face labels with pips (a plain d6, numbers.pips) or the coin motif pair (the d2,
 * numbers.coin); the labels themselves (same array) when nothing changes.
 */
export function glyphLabels(labels, shape, numbers) {
  const type = shape?.type;
  const values = shape?.values ?? [];
  const pair = COIN_PAIRS[numbers?.coin];
  const map = type === 'd6' && numbers?.pips ? (v) => PIP_CHARS[v - 1] : type === 'd2' && pair ? (v) => COIN_CHARS[pair[v - 1]] : null;
  if (!map || labels.length !== values.length || !values.every((v, i) => labels[i] === labelFor(type, v))) return labels;
  return values.map(map);
}

/** Pip and motif ink heights relative to the font's digit height (they fill the face). */
export const PIP_SCALE = 2.2;
export const COIN_SCALE = 2.3;

/** The atlas with the six pip glyphs added, or null (glyph-atlas.js glyphComposer). */
export const withPips = glyphComposer(
  PIP_PATHS.map((p, i) => [PIP_CHARS[i], p]),
  PIP_SCALE,
  'dicer-pips',
);
/** The atlas with the four coin motifs added, or null. */
export const withCoins = glyphComposer(
  Object.entries(COIN_PATHS).map(([id, p]) => [COIN_CHARS[id], p, COIN_RULES[id]]),
  COIN_SCALE,
  'dicer-coin',
);

const composeSet = (atlas, kind) => (kind === 'pips' ? withPips : withCoins)(atlas);

/**
 * ExtrasPatch for pips and coin motifs: new labels and the set's atlas, or {} when no label
 * changes or the atlas cannot take glyphs. `compose(atlas, 'pips' | 'coin')` is the test seam.
 */
export function glyphPatch(a, ctx, compose = composeSet) {
  const labels = ctx?.labels;
  if (!labels) return {};
  const next = glyphLabels(labels, ctx.shape, a.numbers);
  if (next === labels) return {};
  const atlas = compose(ctx.atlas, ctx.shape.type === 'd6' ? 'pips' : 'coin');
  return atlas ? { labels: next, atlas } : {};
}

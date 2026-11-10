/** CSS colour parsing for the DSN compat layer (pure; no DOM, no three). */

const NAMED = {
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
  orange: '#ffa500',
  pink: '#ffc0cb',
};

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

function channel(token) {
  const t = token.trim();
  const m = /^(-?\d*\.?\d+)(%?)$/.exec(t);
  if (!m) return NaN;
  const v = parseFloat(m[1]);
  return m[2] ? (v / 100) * 255 : v;
}

/**
 * Normalise a CSS colour to `#rrggbb`.
 * @param {string} value `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()` or a basic colour name
 * @param {string|null} [fallback] returned for anything unrecognised
 * @returns {string|null}
 */
export function cssToHex(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  const s = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return `#${[...m[1]].map((c) => c + c).join('')}`;
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*([^)]*)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3 && parts.length <= 4) {
      const rgb = parts.slice(0, 3).map(channel);
      if (rgb.every(Number.isFinite)) return `#${rgb.map(hex2).join('')}`;
    }
    return fallback;
  }
  if (Object.hasOwn(NAMED, s)) return NAMED[s];
  return fallback;
}

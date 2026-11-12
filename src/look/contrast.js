// Numbers readable against the die's own colour. Pure and three-free.
//
// The fill colour the look chose is kept when it already contrasts with what is seen around it.
// Otherwise its lightness moves (hue and saturation kept) towards whichever end, lighter or
// darker, can contrast more, until the WCAG contrast ratio reaches MIN_CONTRAST; a glowing
// number's glow counts as part of how it is seen, and is turned down when darkening alone cannot
// get there.

/** Minimum contrast ratio between a number (as seen) and the die colour around it. */
export const MIN_CONTRAST = 3;
/** Share of the glow colour x intensity that adds to how a number is seen. */
const GLOW_SEEN = 0.5;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const hex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratioOf = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

/** WCAG contrast ratio of two #rrggbb colours (1..21). */
export const contrastRatio = (a, b) => ratioOf(rgb(a), rgb(b));

/** The colour seen around the numbers: the body, or on resin with an inside, leaning to the inside. */
export function visibleBodyColor(a) {
  if (a.body.type !== 'resin' || a.interior.type === 'none') return a.body.color;
  // Insides read as self-lit through resin: they dominate what is seen, more so when dense.
  const k = 0.6 + 0.4 * a.interior.density;
  const b = rgb(a.body.color);
  const i = rgb(a.interior.colors[0]);
  return hex(b.map((v, n) => v + (i[n] - v) * k));
}

function toHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function fromHsl([h, s, l]) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)];
}

/** How a number of fill `f` with glow `g` (intensity) of colour `gc` is seen. */
const seen = (f, gc, g) => f.map((v, i) => Math.min(1, v + gc[i] * g * GLOW_SEEN));

/** The number fill and glow intensity to draw with: unchanged when they already read. */
export function readableNumbers(a) {
  const glow = a.glow.intensity;
  const fill = rgb(a.numbers.color);
  const gc = rgb(a.glow.color);
  const ref = rgb(visibleBodyColor(a));
  // A number must read on its fill alone and with its glow added: a glow the same hue as the
  // inside washes it out rather than helping, so it never counts as contrast by itself.
  const reads = (f, gl) => ratioOf(f, ref) >= MIN_CONTRAST && ratioOf(seen(f, gc, gl), ref) >= MIN_CONTRAST;
  if (reads(fill, glow)) return { fill: a.numbers.color, glow };
  const [h, s, l0] = toHsl(fill);
  // Keep the number's own side (a light number gets lighter, a dark one darker); flip only when
  // that side cannot reach the contrast at all.
  const okAt = (l, gl) => reads(fromHsl([h, s, l]), gl);
  let lighter = lum(seen(fill, gc, glow)) >= lum(ref);
  if (!okAt(lighter ? 1 : 0, glow) && okAt(lighter ? 0 : 1, lighter ? 0 : glow)) lighter = !lighter;
  // Binary search for the smallest lightness move that reaches the contrast.
  let lo = l0;
  let hi = lighter ? 1 : 0;
  let g = glow;
  const ok = okAt;
  if (!ok(hi, g)) {
    if (lighter) return { fill: hex(fromHsl([h, s, hi])), glow: g };
    // Darker alone cannot get there: the glow brightens the number too, so turn it down.
    while (g > 0 && !ok(hi, g)) g = Math.max(0, g - 0.05);
    if (!ok(hi, g)) return { fill: hex(fromHsl([h, s, hi])), glow: g };
  }
  for (let n = 0; n < 24; n++) {
    const mid = (lo + hi) / 2;
    if (ok(mid, g)) hi = mid;
    else lo = mid;
  }
  return { fill: hex(fromHsl([h, s, hi])), glow: g };
}

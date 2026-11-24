// Numbers readable against the die's own colour. Pure and three-free.
//
// The fill colour the look chose is kept when it already contrasts with what is seen around it.
// Otherwise its lightness moves (hue and saturation kept) towards whichever end, lighter or
// darker, can contrast more, until the WCAG contrast ratio reaches the look's required ratio; a
// glowing number's glow counts as part of how it is seen, and is turned down when darkening alone
// cannot get there.
//
// What is seen is an estimate: the body with its second colour and what shows through it, and the
// whitish veil a clear coat lays over body and number alike (the constants below are tuned by eye,
// not measured from a render). A thin font needs more contrast than a bold one.

/** Minimum contrast ratio between a number (as seen) and the die colour around it. */
export const MIN_CONTRAST = 3;
/** Share of the glow colour x intensity that adds to how a number is seen. */
const GLOW_SEEN = 1.3;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const hex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratioOf = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

/** WCAG contrast ratio of two #rrggbb colours (1..21). */
export const contrastRatio = (a, b) => ratioOf(rgb(a), rgb(b));

/** Share of the die's second colour (body.color2) seen across the body, per body type. */
const SECOND_SEEN = { stone: 0.3, marble: 0.3, wood: 0.3, bone: 0.15, gem: 0.3, iridescent: 0.5, pearl: 0.35, jelly: 0.5 };
/** Metal finishes that show the second colour (verdigris, grime). */
const METAL_SECOND = { patina: 0.3, worn: 0.3 };
/** How bright translucent resin looks next to its colour: the table shows through it. */
const RESIN_SEEN = 0.7;
// Insides that are flecks or one object: the body shows all around them, so they lean little.
const SPARSE = new Set(['glitter', 'foil', 'frost', 'shape', 'eye', 'botanical']);
/**
 * The share of whitish light a clear coat lays over everything under it (body and number alike), per
 * body type. It lifts a dark number towards the body and is why a pearl die washes dark ink out. Metal
 * is set by its finish. Without a coat (stone, bone) it is small.
 */
const VEIL = { pearl: 0.15, iridescent: 0.15, resin: 0.1, jelly: 0.1, gem: 0.1, opaque: 0.08, marble: 0.08, wood: 0.08, stone: 0.04, bone: 0.04 };
const METAL_VEIL = { mirror: 0.15, polished: 0.1, brushed: 0.05 };
const VEIL_COLOR = [0.9, 0.9, 0.9];
/** How much of the veil a number's fill takes: flat inks all of it, a metallic fill reflects on its own. */
const FILL_VEIL = { paint: 1, enamel: 1, outline: 1, gold: 0.5, silver: 0.5, holo: 0.5, glow: 0.3 };
/** Extra contrast thin built-in faces need; other fonts (file:, css:) are the author's to set (numbers.minContrast). */
const FONT_EXTRA = { handwritten: 1.5, blackletter: 0.5 };
/** Share of the automatic contrast a gold or silver fill asks for. */
const METAL_EASE = 0.8;
/** Contrast a bolder or thinner stroke (numbers.weight, -1 to 1) takes off or adds. */
const WEIGHT_EASE = 0.75;

const mixRgb = (b, i, k) => b.map((v, n) => v + (i[n] - v) * k);

/**
 * The colour seen around the numbers, as rgb: the body, with its second colour where it shows, or on
 * resin the darker colour resin looks, leaning towards what fills it (both inside colours count) and
 * only a little towards flecks or a single shape. Leaning too far made the numbers match the inside and
 * vanish on the body (gold numbers turned brown for gold glitter on dark resin).
 */
function bodyRgb(a, only) {
  const { body, interior } = a;
  const c = rgb(body.color);
  if (body.type === 'resin') {
    const b = c.map((v) => v * RESIN_SEEN);
    if (interior.type === 'none') return b;
    const d = interior.density;
    const inside = only === undefined ? mixRgb(rgb(interior.colors[0]), rgb(interior.colors[1] ?? interior.colors[0]), 0.5) : rgb(interior.colors[only]);
    return mixRgb(b, inside, SPARSE.has(interior.type) ? 0.3 * d : 0.3 + 0.3 * d);
  }
  const second = body.type === 'metal' ? (METAL_SECOND[body.finish] ?? 0) : (SECOND_SEEN[body.type] ?? 0);
  return second ? mixRgb(c, rgb(body.color2), second) : c;
}

/** The coat's veil for a look. */
const veilOf = (a) => (a.body.type === 'metal' ? (METAL_VEIL[a.body.finish] ?? 0) : (VEIL[a.body.type] ?? 0));

/** The body as the player sees it, with the coat's veil. */
const seenBody = (a) => mixRgb(bodyRgb(a), VEIL_COLOR, veilOf(a));

/**
 * What a number must contrast with: the seen body, or on resin with a two colour swirl each of
 * them (a number crosses both in turn, and their average would hide the one it matches). When no ink,
 * black or white, can read on both (a light colour next to a dark one), the average stands in.
 */
function refsOf(a) {
  const { body, interior } = a;
  const avg = seenBody(a);
  if (body.type !== 'resin' || interior.type !== 'swirl' || !interior.colors[1] || interior.colors[1] === interior.colors[0]) return [avg];
  const refs = [0, 1].map((n) => mixRgb(bodyRgb(a, n), VEIL_COLOR, veilOf(a)));
  const need = requiredContrast(a);
  const veil = veilOf(a) * (FILL_VEIL[a.numbers.fill] ?? 1);
  const fits = [[0, 0, 0], [1, 1, 1]].some((ink) => refs.every((r) => ratioOf(mixRgb(ink, VEIL_COLOR, veil), r) >= need));
  return fits ? refs : [avg];
}

/** The colour seen around the numbers, as #rrggbb (the body without a coat's veil). */
export const visibleBodyColor = (a) => hex(bodyRgb(a));

/** The contrast ratio a look asks of its numbers: its own numbers.minContrast, else 3 plus its font's need less what weight eases. */
export function requiredContrast(a) {
  const own = a.numbers.minContrast;
  const auto = MIN_CONTRAST + (FONT_EXTRA[a.numbers.font] ?? 0) - WEIGHT_EASE * (a.numbers.weight ?? 0);
  // a gold or silver fill shines against the body, so the automatic ask is a little lower (the stock gold on blue resin stays gold)
  const base = own > 0 ? own : a.numbers.fill === 'gold' || a.numbers.fill === 'silver' ? auto * METAL_EASE : auto;
  return Math.min(7, Math.max(1.5, base));
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

/** How a number of fill `f` with glow `g` (intensity) of colour `gc` is seen, under a coat's veil `v` (the share a fill takes of it). */
const seen = (f, gc, g, v) => mixRgb(f, VEIL_COLOR, v).map((x, i) => Math.min(1, x + gc[i] * g * GLOW_SEEN));

/** The number fill and glow intensity to draw with: unchanged when they already read, or the look keeps its colour. */
export function readableNumbers(a) {
  const glow = a.glow.intensity;
  const fill = rgb(a.numbers.color);
  const gc = rgb(a.glow.color);
  const ref = seenBody(a);
  const refs = refsOf(a);
  const need = requiredContrast(a);
  const veil = veilOf(a) * (FILL_VEIL[a.numbers.fill] ?? 1);
  // A number must read on its fill alone and with its glow added: a glow the same hue as the
  // inside washes it out rather than helping, so it never counts as contrast by itself.
  const reads = (f, gl) => refs.every((r) => ratioOf(seen(f, gc, 0, veil), r) >= need && ratioOf(seen(f, gc, gl, veil), r) >= need);
  // numbers.contrast off (a colour the player picked): drawn as chosen
  if (a.numbers.contrast === false || reads(fill, glow)) return { fill: a.numbers.color, glow };
  const [h, s, l0] = toHsl(fill);
  // Keep the number's own side (a light number gets lighter, a dark one darker); flip only when
  // that side cannot reach the contrast at all.
  const okAt = (l, gl) => reads(fromHsl([h, s, l]), gl);
  let lighter = lum(seen(fill, gc, glow, veil)) >= lum(ref);
  if (!okAt(lighter ? 1 : 0, glow) && okAt(lighter ? 0 : 1, lighter ? 0 : glow)) lighter = !lighter;
  // Binary search for the smallest lightness move that reaches the contrast.
  let lo = l0;
  let hi = lighter ? 1 : 0;
  let g = glow;
  if (!lighter) {
    // A number darker than the body: a glow only washes it out, so turn the glow down first, and
    // darken the fill only if the glow gone is not enough.
    while (g > 0 && !okAt(l0, g)) g = Math.max(0, g - 0.05);
    if (okAt(l0, g)) return { fill: a.numbers.color, glow: g };
  }
  if (!okAt(hi, g)) return { fill: hex(fromHsl([h, s, hi])), glow: g };
  for (let n = 0; n < 24; n++) {
    const mid = (lo + hi) / 2;
    if (okAt(mid, g)) hi = mid;
    else lo = mid;
  }
  return { fill: hex(fromHsl([h, s, hi])), glow: g };
}

/**
 * What the editor shows about a look's numbers: `off` (numbers.contrast false), `adjusted` (the fill or glow
 * had to move; `fill` is what is drawn), `close` (it reads, with under half a point to spare) or `ok`, with the
 * ratio the numbers reach and the ratio the look asks for.
 */
export function numbersReport(a) {
  const need = requiredContrast(a);
  if (a.numbers.contrast === false) return { state: 'off', need };
  const r = readableNumbers(a);
  if (r.fill !== a.numbers.color || r.glow !== a.glow.intensity) return { state: 'adjusted', need, fill: r.fill };
  const seenNum = seen(rgb(r.fill), rgb(a.glow.color), r.glow, veilOf(a) * (FILL_VEIL[a.numbers.fill] ?? 1));
  const ratio = Math.min(...refsOf(a).map((ref) => ratioOf(seenNum, ref)));
  return { state: ratio < need + 0.5 ? 'close' : 'ok', need, ratio };
}

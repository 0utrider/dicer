// Plain-data Appearance model. Pure and three-free.

/** Body types with named presets (the preset picks a look; its first entry is the default). */
export const BODY_PRESETS = Object.freeze({
  iridescent: ['chameleon', 'opal', 'dichroic'],
  gem: ['amethyst', 'malachite', 'obsidian', 'quartz'],
  wood: ['oak', 'walnut', 'cherry', 'ebony'],
});
const BODY_TYPES = ['opaque', 'resin', 'metal', 'marble', 'pearl', 'iridescent', 'gem', 'wood'];
const FINISHES = ['polished', 'brushed', 'antique', 'patina', 'worn'];
const AGED = ['patina', 'worn']; // metal finishes drawn by the look-extras chunk
const INTERIOR_TYPES = ['none', 'liquid', 'glitter', 'swirl', 'nebula', 'shape', 'foil', 'eye', 'botanical', 'smoke', 'fire', 'lava', 'storm', 'frost'];
const INCLUSIONS = ['flower', 'moss', 'butterfly'];
// the new insides (drawn by the look-extras chunk) and what they draw while it is missing
const NEW_INSIDES = { foil: { type: 'glitter' }, eye: { type: 'shape', shape: 'sphere' }, botanical: { type: 'swirl' }, smoke: { type: 'swirl' }, fire: { type: 'liquid' }, lava: { type: 'liquid' }, storm: { type: 'nebula' }, frost: { type: 'glitter' } };
const SHAPES = ['star', 'heart', 'skull', 'sphere', 'sword', 'axe', 'shield', 'dragon', 'runes']; // those after the first four: look-extras chunk
const FILLS = ['paint', 'gold', 'silver', 'enamel', 'outline', 'holo', 'glow'];
const RELIEFS = ['engraved', 'raised'];
const COINS = ['numbers', 'heads-tails', 'sun-moon']; // d2 faces; the motifs: look-extras chunk
/** Crit/fumble icons a die can show instead of the number. */
export const ICON_IDS = Object.freeze(['starburst', 'crown', 'skull', 'broken-shield', 'heart', 'flame']);
/** Edge sharpness steps: 0 sharp .. 1 very rounded. One cached geometry per step per die type. */
export const STRIP_STYLES = Object.freeze(['body', 'paint', 'metal', 'glow']);
export const stripActive = (a) => a.edges.strip.style !== 'body' && a.edges.strip.strength > 0 && a.edges.radius > 0;
export const EDGE_STEPS =Object.freeze([0, 0.25, 0.5, 0.75, 1]);
/** Fonts that ship with the module; others are 'css:<family>' or 'file:<path>'. */
export const FONT_IDS_BUILTIN = Object.freeze(['serif', 'sans', 'blackletter', 'norse', 'uncial', 'scifi', 'handwritten', 'deco']);

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

export const DEFAULT_APPEARANCE = deepFreeze({
  body: { type: 'resin', color: '#1f5fd1', color2: '#0b1f4a', finish: 'polished', roughness: 0.05, preset: null, luminous: 0 },
  interior: { type: 'nebula', colors: ['#8a4dff', '#22d3ee'], density: 0.6, shape: 'star', inclusion: 'flower', bubble: false, sand: false },
  numbers: { fill: 'gold', relief: 'engraved', icons: { crit: null, fumble: null }, color: '#e2b04a', depth: 0.5, font: 'serif', pips: false, coin: 'numbers' },
  edges: { radius: 0.5, style: 'rounded', strip: { style: 'body', color: '#e2b04a', strength: 1 } },
  glow: { color: '#ffffff', intensity: 0 },
  shapes: { d4: 'classic' },
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function color(v, fallback) {
  if (typeof v !== 'string') return fallback;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return fallback;
}
const num = (v, min, max, fallback) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

const snapEdge = (v) => EDGE_STEPS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), EDGE_STEPS[0]);

// radius wins; a legacy edges.style 'sharp' means radius 0
function edgeRadius(e, fallback) {
  if (typeof e.radius === 'number' && Number.isFinite(e.radius)) return snapEdge(e.radius);
  if (e.radius !== undefined) return fallback;
  return e.style === 'sharp' ? 0 : fallback;
}

// Block only the dangerous: control chars, backslash, ? # : (http:, data:, C:), encoded dots/slashes.
// eslint-disable-next-line no-control-regex
const FONT_BAD = /[\u0000-\u001f\u007f-\u009f\\?#:]|%2e|%2f|%5c/i;
const FONT_FILE = { test: (p) => !FONT_BAD.test(p) && /^[^]+\.(woff2?|ttf|otf)$/i.test(p) && p === p.trim() };
function font(v, fallback) {
  if (typeof v !== 'string') return fallback;
  if (FONT_IDS_BUILTIN.includes(v)) return v;
  if (v.startsWith('css:')) return /^css:[A-Za-z0-9 -]{1,64}$/.test(v) ? v : fallback;
  if (v.startsWith('file:')) {
    const p = v.slice(5);
    if (!FONT_FILE.test(p) || p.startsWith('/')) return fallback;
    if (p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return fallback;
    return v;
  }
  return fallback;
}

// Plan 1 flat shape: { body: 'opaque'|'metal'|'resin', bodyColor, fillColor, fillMetallic, engraveDepth }
function fromLegacy(i) {
  const out = { body: { type: i.body }, numbers: {} };
  if ('bodyColor' in i) out.body.color = i.bodyColor;
  if ('fillColor' in i) out.numbers.color = i.fillColor;
  if ('fillMetallic' in i) out.numbers.fill = i.fillMetallic ? 'gold' : 'paint';
  if ('engraveDepth' in i) out.numbers.depth = i.engraveDepth;
  return out;
}

export function normalizeAppearance(input) {
  try {
    const D = DEFAULT_APPEARANCE;
    let i = isObj(input) ? input : {};
    if (typeof i.body === 'string') i = fromLegacy(i);
    const b = isObj(i.body) ? i.body : {};
    const n = isObj(i.numbers) ? i.numbers : {};
    const e = isObj(i.edges) ? i.edges : {};
    const es = isObj(e.strip) ? e.strip : {};
    const g = isObj(i.glow) ? i.glow : {};
    const it = isObj(i.interior) ? i.interior : {};
    const cols = Array.isArray(it.colors) ? it.colors : [];
    const ic = isObj(n.icons) ? n.icons : {};

    const type = pick(b.type, BODY_TYPES, D.body.type);
    const presets = BODY_PRESETS[type];
    const body = {
      type,
      color: color(b.color, D.body.color),
      color2: color(b.color2, D.body.color2),
      finish: pick(b.finish, FINISHES, D.body.finish),
      roughness: num(b.roughness, 0, 1, D.body.roughness),
      preset: presets ? pick(b.preset, presets, presets[0]) : null,
      luminous: num(b.luminous, 0, 1, 0),
    };
    const interior = {
      type: pick(it.type, INTERIOR_TYPES, D.interior.type),
      colors: [color(cols[0], D.interior.colors[0]), color(cols[1], D.interior.colors[1])],
      density: num(it.density, 0, 1, D.interior.density),
      shape: pick(it.shape, SHAPES, D.interior.shape),
      inclusion: pick(it.inclusion, INCLUSIONS, D.interior.inclusion),
      bubble: it.bubble === true,
      sand: it.sand === true,
    };
    if (body.type !== 'resin') interior.type = 'none';
    const radius = edgeRadius(e, D.edges.radius);
    return {
      body,
      interior,
      numbers: {
        fill: pick(n.fill, FILLS, D.numbers.fill),
        relief: pick(n.relief, RELIEFS, D.numbers.relief),
        icons: { crit: pick(ic.crit, ICON_IDS, null), fumble: pick(ic.fumble, ICON_IDS, null) },
        color: color(n.color, D.numbers.color),
        depth: num(n.depth, 0, 1, D.numbers.depth),
        font: font(n.font, D.numbers.font),
        pips: n.pips === true,
        coin: pick(n.coin, COINS, 'numbers'),
      },
      edges: {
        radius,
        style: radius === 0 ? 'sharp' : 'rounded',
        strip: { style: pick(es.style, STRIP_STYLES, 'body'), color: color(es.color, D.edges.strip.color), strength: num(es.strength, 0, 1, 1) },
      },
      glow: { color: color(g.color, D.glow.color), intensity: num(g.intensity, 0, 2, D.glow.intensity) },
      shapes: { d4: i.shapes?.d4 === 'crystal' ? 'crystal' : 'classic' },
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_APPEARANCE));
  }
}

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (isObj(v)) {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canonical(v[k]);
    return o;
  }
  return v;
}

/** Material-cache key: stable over key order; equal looks give equal keys. */
export function appearanceKey(a) {
  return JSON.stringify(canonical(a));
}

/**
 * Shader-program key. Excludes every colour and numeric look parameter.
 * P2-R1: interior part (type, shape, steps) only when the interior is active.
 * P2-R2: glow part is the boolean flags.glow && glow.intensity > 0.
 * P2-R12: the safe flag is a boolean part; a safe material is plain opaque whatever the body,
 * so every safe look shares one key. edges.style is not part of it: no define depends on it
 * (it only selects the geometry).
 */
export function programKey(a, flags) {
  if (flags.safe) return ['opaque', '-', 'none', 'eng0', 'glow0', 'fx0', 'safe1'].join('|');
  const steps = flags.interiorSteps;
  const active =
    a.body.type === 'resin' && !!flags.interiors && steps > 0 && a.interior.type !== 'none';
  const { type, shape } = a.interior;
  const interior = active ? `${type}${type === 'shape' ? ':' + shape : ''}${LIQUID_EXTRA(a)}:${steps}` : 'none';
  const finish = a.body.type === 'metal' ? a.body.finish : '-';
  const glow = !!flags.glow && a.glow.intensity > 0 ? 1 : 0;
  const fx = flags.effects ? 1 : 0; // the die fx uniform block (trigger effects)
  const parts = [a.body.type, finish, interior, `eng${flags.engraving ? 1 : 0}`, `glow${glow}`, `fx${fx}`, 'safe0'];
  if (a.body.luminous > 0) parts.push('lum');
  if (active && flags.insideMotion && (type !== 'shape' || SHAPES.indexOf(shape) > 3)) parts.push('mo'); // living insides (the look-extras chunk's)
  const { fill, relief } = a.numbers;
  if (FILLS.indexOf(fill) > 3 || relief === 'raised') parts.push(`n:${fill}${relief === 'raised' ? '+r' : ''}`);
  if (stripActive(a)) parts.push(`e:${a.edges.strip.style}`);
  return parts.join('|');
}

// liquid's bubble / sand programs: '+b', '+s', '+bs'; nothing for other insides
const LIQUID_EXTRA = ({ interior: i }) => (i.type === 'liquid' && (i.bubble || i.sand) ? `+${i.bubble ? 'b' : ''}${i.sand ? 's' : ''}` : '');

/** True when the look needs the lazy look-extras chunk (new fills, raised relief, icons, pips, coin motifs, bodies, finishes, luminous). */
export const needsLookExtras = (a) =>
  FILLS.indexOf(a.numbers.fill) > 3 ||
  a.numbers.relief === 'raised' ||
  !!(a.numbers.icons.crit || a.numbers.icons.fumble || a.numbers.pips) ||
  a.numbers.coin !== 'numbers' ||
  !!BODY_PRESETS[a.body.type] ||
  (a.body.type === 'metal' && AGED.includes(a.body.finish)) ||
  a.body.luminous > 0 ||
  stripActive(a) ||
  (a.body.type === 'resin' && (a.interior.type in NEW_INSIDES || LIQUID_EXTRA(a) !== '' || (a.interior.type === 'shape' && SHAPES.indexOf(a.interior.shape) > 3)));

/** The look a die draws while the chunk is missing (and for safe flags): today's body, plain fill, engraved, numbers. */
export const fallbackLook = (a) =>
  needsLookExtras(a)
    ? {
        ...a,
        body: {
          ...a.body,
          type: { iridescent: 'pearl', gem: 'marble', wood: 'opaque' }[a.body.type] ?? a.body.type,
          finish: AGED.includes(a.body.finish) ? 'antique' : a.body.finish,
          luminous: 0,
          preset: null,
        },
        interior: {
          ...a.interior,
          shape: SHAPES.indexOf(a.interior.shape) > 3 ? 'star' : a.interior.shape,
          ...NEW_INSIDES[a.interior.type],
          bubble: false,
          sand: false,
        },
        edges: { ...a.edges, strip: { ...a.edges.strip, style: 'body' } },
        numbers: {
          ...a.numbers,
          fill: { outline: 'paint', holo: 'gold', glow: 'paint' }[a.numbers.fill] || a.numbers.fill,
          relief: 'engraved',
          icons: { crit: null, fumble: null },
          pips: false,
          coin: 'numbers',
        },
      }
    : a;

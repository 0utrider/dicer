// Plain-data Appearance model. Pure and three-free.

const BODY_TYPES = ['opaque', 'resin', 'metal', 'marble', 'pearl'];
const FINISHES = ['polished', 'brushed', 'antique'];
const INTERIOR_TYPES = ['none', 'liquid', 'glitter', 'swirl', 'nebula', 'shape'];
const SHAPES = ['star', 'heart', 'skull', 'sphere'];
const FILLS = ['paint', 'gold', 'silver', 'enamel'];
const EDGE_STYLES = ['rounded', 'sharp'];

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

export const DEFAULT_APPEARANCE = deepFreeze({
  body: { type: 'resin', color: '#1f5fd1', color2: '#0b1f4a', finish: 'polished', roughness: 0.05 },
  interior: { type: 'nebula', colors: ['#8a4dff', '#22d3ee'], density: 0.6, shape: 'star' },
  numbers: { fill: 'gold', color: '#e2b04a', depth: 0.5 },
  edges: { style: 'rounded' },
  glow: { color: '#ffffff', intensity: 0 },
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
    const g = isObj(i.glow) ? i.glow : {};
    const it = isObj(i.interior) ? i.interior : {};
    const cols = Array.isArray(it.colors) ? it.colors : [];

    const body = {
      type: pick(b.type, BODY_TYPES, D.body.type),
      color: color(b.color, D.body.color),
      color2: color(b.color2, D.body.color2),
      finish: pick(b.finish, FINISHES, D.body.finish),
      roughness: num(b.roughness, 0, 1, D.body.roughness),
    };
    const interior = {
      type: pick(it.type, INTERIOR_TYPES, D.interior.type),
      colors: [color(cols[0], D.interior.colors[0]), color(cols[1], D.interior.colors[1])],
      density: num(it.density, 0, 1, D.interior.density),
      shape: pick(it.shape, SHAPES, D.interior.shape),
    };
    if (body.type !== 'resin') interior.type = 'none';
    return {
      body,
      interior,
      numbers: {
        fill: pick(n.fill, FILLS, D.numbers.fill),
        color: color(n.color, D.numbers.color),
        depth: num(n.depth, 0, 1, D.numbers.depth),
      },
      edges: { style: pick(e.style, EDGE_STYLES, D.edges.style) },
      glow: { color: color(g.color, D.glow.color), intensity: num(g.intensity, 0, 2, D.glow.intensity) },
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
  if (flags.safe) return ['opaque', '-', 'none', 'eng0', 'glow0', 'safe1'].join('|');
  const steps = flags.interiorSteps;
  const active =
    a.body.type === 'resin' && !!flags.interiors && steps > 0 && a.interior.type !== 'none';
  const interior = active
    ? `${a.interior.type}${a.interior.type === 'shape' ? ':' + a.interior.shape : ''}:${steps}`
    : 'none';
  const finish = a.body.type === 'metal' ? a.body.finish : '-';
  const glow = !!flags.glow && a.glow.intensity > 0 ? 1 : 0;
  return [a.body.type, finish, interior, `eng${flags.engraving ? 1 : 0}`, `glow${glow}`, 'safe0'].join('|');
}

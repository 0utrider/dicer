import { describe, expect, test } from 'vitest';
import { contrastRatio, numbersReport, readableNumbers, requiredContrast, visibleBodyColor, MIN_CONTRAST } from '../../src/look/contrast.js';
import { normalizeAppearance } from '../../src/look/appearance.js';

const look = (o) => normalizeAppearance(o);
const lumOf = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};
const hueOf = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe('number contrast against the die colour', () => {
  test('contrastRatio follows the WCAG formula', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  test('the visible colour of resin with an inside leans to the inside, more so when dense', () => {
    const thin = visibleBodyColor(look({ body: { type: 'resin', color: '#000000' }, interior: { type: 'liquid', colors: ['#ffffff', '#ffffff'], density: 0 } }));
    const dense = visibleBodyColor(look({ body: { type: 'resin', color: '#000000' }, interior: { type: 'liquid', colors: ['#ffffff', '#ffffff'], density: 1 } }));
    expect(lumOf(dense)).toBeGreaterThan(lumOf(thin));
    expect(visibleBodyColor(look({ body: { type: 'opaque', color: '#123456' } }))).toBe('#123456');
  });

  test('a look with numbers.contrast off draws its numbers in the colour picked, readable or not', () => {
    const grey = { body: { type: 'opaque', color: '#777777' }, numbers: { fill: 'paint', color: '#7a7a7a' } };
    expect(readableNumbers(look(grey)).fill).not.toBe('#7a7a7a');
    expect(readableNumbers(look({ ...grey, numbers: { ...grey.numbers, contrast: false } })).fill).toBe('#7a7a7a');
    expect(look({}).numbers.contrast).toBe(true);
  });

  test('a stone die is seen with its second colour mixed in (brick and its mortar)', () => {
    const brick = look({ body: { type: 'stone', preset: 'brick', color: '#000000', color2: '#ffffff' } });
    const seen = lumOf(visibleBodyColor(brick));
    expect(seen).toBeGreaterThan(lumOf('#202020'));
    expect(seen).toBeLessThan(lumOf('#808080'));
  });

  test('flecks or a single shape lean the visible colour far less than a filling inside', () => {
    const inside = (type) => visibleBodyColor(look({ body: { type: 'resin', color: '#000000' }, interior: { type, colors: ['#ffffff', '#ffffff'], density: 0.7 } }));
    for (const sparse of ['glitter', 'shape', 'foil', 'frost'])
      expect(lumOf(inside(sparse))).toBeLessThan(lumOf(inside('liquid')) / 2);
  });

  test('clear resin counts darker than its colour: the table shows through it', () => {
    const clear = look({ body: { type: 'resin', color: '#58c0d6' }, interior: { type: 'none' } });
    expect(lumOf(visibleBodyColor(clear))).toBeLessThan(lumOf('#58c0d6'));
  });

  test('gold numbers over gold glitter on dark resin stay gold (they were turned brown and sank into the body)', () => {
    const hoard = look({
      body: { type: 'resin', color: '#6b3a0a' },
      interior: { type: 'glitter', colors: ['#ffd24a', '#ff9a1f'], density: 0.75 },
      numbers: { fill: 'gold', color: '#ffd24a' },
    });
    expect(readableNumbers(hoard).fill).toBe('#ffd24a');
  });

  test('white numbers on clear light-blue resin stay white (they were turned teal on teal)', () => {
    const crystal = look({ body: { type: 'resin', color: '#58c0d6' }, interior: { type: 'none' }, numbers: { fill: 'paint', color: '#f4f8fa' } });
    expect(readableNumbers(crystal).fill).toBe('#f4f8fa');
  });

  test('numbers that already read are left exactly as chosen', () => {
    const a = look({ body: { type: 'opaque', color: '#101010' }, numbers: { fill: 'paint', color: '#f5f5f5' } });
    expect(readableNumbers(a)).toEqual({ fill: '#f5f5f5', glow: a.glow.intensity });
  });

  test('dark numbers on a dark die get lighter, light numbers on a light die get darker, hue kept', () => {
    const dark = look({ body: { type: 'opaque', color: '#1a1a2e' }, numbers: { fill: 'paint', color: '#2a2a6e' } });
    const r1 = readableNumbers(dark);
    expect(lumOf(r1.fill)).toBeGreaterThan(lumOf('#2a2a6e'));
    expect(contrastRatio(r1.fill, '#1a1a2e')).toBeGreaterThanOrEqual(MIN_CONTRAST - 0.01);
    expect(Math.abs(hueOf(r1.fill) - hueOf('#2a2a6e'))).toBeLessThan(6);
    const light = look({ body: { type: 'pearl', color: '#f2eff6' }, numbers: { fill: 'paint', color: '#d8d0e8' } });
    const r2 = readableNumbers(light);
    expect(lumOf(r2.fill)).toBeLessThan(lumOf('#d8d0e8'));
    expect(contrastRatio(r2.fill, '#f2eff6')).toBeGreaterThanOrEqual(MIN_CONTRAST - 0.01);
  });

  test('Ember Core (gold numbers glowing orange over a glowing orange inside) becomes readable', () => {
    const ember = look({
      body: { type: 'resin', color: '#3a0f06', color2: '#140402' },
      interior: { type: 'liquid', colors: ['#ff7a1a', '#ffb347'], density: 0.7 },
      numbers: { fill: 'gold', color: '#ffd9a0' },
      glow: { color: '#ff7a1a', intensity: 0.6 },
    });
    const r = readableNumbers(ember);
    const ref = visibleBodyColor(ember);
    // the number as seen (fill plus its glow) now contrasts with what is seen around it
    const seen = (fill, glow) => {
      const f = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
      const g = [1, 3, 5].map((i) => parseInt('#ff7a1a'.slice(i, i + 2), 16));
      return '#' + f.map((v, i) => Math.min(255, Math.round(v + g[i] * glow * 0.5)).toString(16).padStart(2, '0')).join('');
    };
    expect(contrastRatio(seen(r.fill, r.glow), ref)).toBeGreaterThanOrEqual(MIN_CONTRAST - 0.01);
    expect(r.glow).toBeLessThanOrEqual(0.6);
  });

  test('a glow-less look keeps glow 0; output colours are #rrggbb', () => {
    const r = readableNumbers(look({ body: { type: 'opaque', color: '#cccccc' }, numbers: { color: '#bbbbbb' } }));
    expect(r.glow).toBe(0);
    expect(r.fill).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('number contrast that sees the material', () => {
  const pearl = (n = {}, b = {}) => look({ body: { type: 'pearl', color: '#fffdfb', color2: '#f3dbe9', ...b }, numbers: { fill: 'enamel', color: '#4a0f45', ...n } });

  test('a coat lays a veil over the dark ink of a pearl die, so the check asks more of it than of a plain body', () => {
    const plain = look({ body: { type: 'opaque', color: '#fffdfb' }, numbers: { fill: 'enamel', color: '#9a8a96' } });
    const coated = look({ body: { type: 'pearl', color: '#fffdfb', color2: '#fffdfb' }, numbers: { fill: 'enamel', color: '#9a8a96' } });
    // the same ink on the same body colour: the pearl coat's veil (0.15) asks it to move further than an opaque body's (0.08)
    expect(lumOf(readableNumbers(coated).fill)).toBeLessThan(lumOf(readableNumbers(plain).fill));
    expect(lumOf(readableNumbers(coated).fill)).toBeLessThan(lumOf('#9a8a96'));
  });

  test('a metallic fill takes half the veil, a paint or enamel one all of it', () => {
    const a = (fill) => look({ body: { type: 'pearl', color: '#fffdfb', color2: '#fffdfb' }, numbers: { fill, color: '#7a6a76' } });
    expect(lumOf(readableNumbers(a('enamel')).fill)).toBeLessThanOrEqual(lumOf(readableNumbers(a('gold')).fill));
  });

  test("the second colour counts where the material shows it, and both inside colours count on resin", () => {
    const iridescent = (c2) => look({ body: { type: 'iridescent', color: '#202020', color2: c2 }, numbers: { fill: 'paint', color: '#9a9a9a' } });
    expect(readableNumbers(iridescent('#202020')).fill).not.toBe(readableNumbers(iridescent('#ffffff')).fill);
    const nebula = (c2) => look({ body: { type: 'resin', color: '#101828' }, interior: { type: 'nebula', colors: ['#202040', c2], density: 1 }, numbers: { fill: 'paint', color: '#aaaaaa' } });
    expect(readableNumbers(nebula('#202040')).fill).not.toBe(readableNumbers(nebula('#ffffff')).fill);
  });

  test('a metal finish that is dull shows its second colour; a mirror finish lays a veil', () => {
    const metal = (finish, c2) => look({ body: { type: 'metal', color: '#808080', color2: c2, finish }, numbers: { fill: 'paint', color: '#a0a0a0' } });
    expect(readableNumbers(metal('patina', '#000000')).fill).not.toBe(readableNumbers(metal('polished', '#000000')).fill);
  });

  test('thin built-in faces ask for more contrast, a heavier weight for less, and numbers.minContrast overrides both', () => {
    const need = (n) => requiredContrast(look({ numbers: { fill: 'paint', ...n } }));
    expect(need({})).toBe(MIN_CONTRAST);
    expect(need({ font: 'handwritten' })).toBeGreaterThan(MIN_CONTRAST);
    expect(need({ font: 'blackletter' })).toBeGreaterThan(MIN_CONTRAST);
    expect(need({ weight: 1 })).toBeLessThan(MIN_CONTRAST);
    expect(need({ weight: -1 })).toBeGreaterThan(MIN_CONTRAST);
    expect(need({ font: 'handwritten', minContrast: 4 })).toBe(4);
    expect(need({ minContrast: 7 })).toBe(7);
    expect(need({ fill: 'gold' })).toBeLessThan(MIN_CONTRAST);
  });

  test('a stricter numbers.minContrast moves a colour that passes the default', () => {
    const base = { body: { type: 'opaque', color: '#777777' }, numbers: { fill: 'paint', color: '#f2f2f2' } };
    expect(readableNumbers(look(base)).fill).toBe('#f2f2f2');
    const strict = readableNumbers(look({ ...base, numbers: { ...base.numbers, minContrast: 7 } })).fill;
    expect(strict).not.toBe('#f2f2f2');
    expect(contrastRatio('#777777', strict)).toBeGreaterThan(contrastRatio('#777777', '#f2f2f2') - 0.001);
  });

  test('numbersReport: off, adjusted, close and ok', () => {
    expect(numbersReport(look({ body: { type: 'opaque', color: '#777777' }, numbers: { fill: 'paint', color: '#7a7a7a', contrast: false } })).state).toBe('off');
    const adjusted = numbersReport(look({ body: { type: 'opaque', color: '#777777' }, numbers: { fill: 'paint', color: '#7a7a7a' } }));
    expect(adjusted.state).toBe('adjusted');
    expect(adjusted.fill).toMatch(/^#[0-9a-f]{6}$/);
    const ok = numbersReport(look({ body: { type: 'opaque', color: '#000000' }, numbers: { fill: 'paint', color: '#ffffff' } }));
    expect(ok.state).toBe('ok');
    expect(ok.ratio).toBeGreaterThan(ok.need);
    const close = numbersReport(look({ body: { type: 'opaque', color: '#777777' }, numbers: { fill: 'paint', color: '#000000', minContrast: 4.5 } }));
    expect(close.state).toBe('close');
  });

  test('numbers.minContrast: stored from 1.5 to 7 only, so old looks keep their keys', () => {
    expect(look({}).numbers).not.toHaveProperty('minContrast');
    expect(look({ numbers: { minContrast: 4 } }).numbers.minContrast).toBe(4);
    expect(look({ numbers: { minContrast: 7 } }).numbers.minContrast).toBe(7);
    for (const bad of [0, 1, 1.4, -2, 12, NaN, '4', null]) expect(look({ numbers: { minContrast: bad } }).numbers).not.toHaveProperty('minContrast');
  });

  test('the reference case: pearl with dark enamel ink passes when it is dark enough and the report says so', () => {
    expect(pearl().numbers.fill).toBe('enamel');
    expect(numbersReport(pearl()).state).toBe('ok');
  });

  test('a dark number under a glow is darkened first and keeps its glow when that is enough', () => {
    const base = { body: { type: 'opaque', color: '#888888' }, numbers: { fill: 'paint', color: '#555555' }, glow: { color: '#3050ff', intensity: 0.2 } };
    const r = readableNumbers(look(base));
    expect(r.glow).toBe(0.2);
    expect(lumOf(r.fill)).toBeLessThan(lumOf('#555555'));
  });

  test('the glow is turned down only when darkening alone cannot reach the contrast', () => {
    const pearlGlow = { body: { type: 'pearl', color: '#f4dff0', color2: '#e8c8e0' }, numbers: { fill: 'paint', color: '#3a1030' }, glow: { color: '#fff0f8', intensity: 0.3 } };
    const r = readableNumbers(look(pearlGlow));
    expect(r.glow).toBeLessThan(0.3);
    const fixed = look({ ...pearlGlow, numbers: { ...pearlGlow.numbers, color: r.fill }, glow: { ...pearlGlow.glow, intensity: r.glow } });
    expect(numbersReport(fixed).state).not.toBe('adjusted');
  });

  test('jelly shows its second colour', () => {
    const jelly = { body: { type: 'jelly', color: '#e0a910', color2: '#ff00c8' } };
    expect(visibleBodyColor(look(jelly))).not.toBe('#e0a910');
  });

  test('a two colour swirl is checked against each colour, so the ink reads on both', () => {
    const swirl = { body: { type: 'resin', color: '#d8202f' }, interior: { type: 'swirl', colors: ['#d8202f', '#ffffff'], density: 1 }, numbers: { fill: 'paint', color: '#d8202f', weight: 0 } };
    const r = readableNumbers(look(swirl));
    const after = numbersReport(look({ ...swirl, numbers: { ...swirl.numbers, color: r.fill } }));
    expect(after.state).not.toBe('adjusted');
    expect(after.ratio).toBeGreaterThanOrEqual(after.need - 0.05); // the ink is rounded to #rrggbb
  });
});

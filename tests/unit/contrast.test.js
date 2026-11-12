import { describe, expect, test } from 'vitest';
import { contrastRatio, readableNumbers, visibleBodyColor, MIN_CONTRAST } from '../../src/look/contrast.js';
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

import { describe, test, expect, vi, afterEach } from 'vitest';
import { getTexture, disposeTextures, TEX } from '../../src/effects/library/textures.js';

afterEach(() => disposeTextures());

describe('fx textures', () => {
  test('getTexture returns the same texture per kind and keeps CPU pixel data', () => {
    const a = getTexture(TEX.GLOW);
    expect(getTexture(TEX.GLOW)).toBe(a);
    expect(a.image.data).toBeInstanceOf(Uint8Array);
    expect(a.image.width).toBe(64);
  });

  test('sizes match the spec', () => {
    const dims = (k) => [getTexture(k).image.width, getTexture(k).image.height];
    expect(dims(TEX.GLOW)).toEqual([64, 64]);
    expect(dims(TEX.PUFF)).toEqual([128, 128]);
    expect(dims(TEX.SPARK)).toEqual([64, 64]);
    expect(dims(TEX.FLAME)).toEqual([64, 128]);
    expect(dims(TEX.SHARD)).toEqual([64, 64]);
  });

  test('GLOW is bright at the centre and zero at the edge', () => {
    const t = getTexture(TEX.GLOW);
    const w = t.image.width;
    const d = t.image.data;
    expect(d[((w / 2) * w + w / 2) * 4]).toBeGreaterThan(240);
    expect(d[0]).toBe(0);
  });

  test('GLOW is wide: at r = 0.55 it is still at least half its centre (a DOT sprite stays full-size)', () => {
    const { width: w, data } = getTexture(TEX.GLOW).image;
    const c = w / 2;
    // Average the two centre rows; column c + 0.55 * c along +u.
    const at = (x) => (data[((c - 1) * w + x) * 4] + data[(c * w + x) * 4]) / 2;
    const x = c + 0.55 * c; // 49.6 -> interpolate texels 49 and 50 (centres at u = (x + 0.5) / c - 1)
    const fx = x - 0.5;
    const v = at(Math.floor(fx)) + (at(Math.floor(fx) + 1) - at(Math.floor(fx))) * (fx - Math.floor(fx));
    expect(v / ((at(c - 1) + at(c)) / 2)).toBeGreaterThanOrEqual(0.5);
  });

  test('pixels are single-channel coverage (R=G=B=A) for every kind', () => {
    for (const k of Object.values(TEX)) {
      const d = getTexture(k).image.data;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) {
        expect(d[i + 1]).toBe(d[i]);
        expect(d[i + 2]).toBe(d[i]);
        expect(d[i + 3]).toBe(d[i]);
        max = Math.max(max, d[i]);
      }
      expect(max).toBeGreaterThan(200);
    }
  });

  test('disposeTextures disposes and a later getTexture makes a fresh one', () => {
    const a = getTexture(TEX.PUFF);
    const spy = vi.spyOn(a, 'dispose');
    disposeTextures();
    expect(spy).toHaveBeenCalled();
    expect(getTexture(TEX.PUFF)).not.toBe(a);
  });

  test('textures are deterministic', () => {
    const a = Array.from(getTexture(TEX.PUFF).image.data);
    disposeTextures();
    const b = Array.from(getTexture(TEX.PUFF).image.data);
    expect(b).toEqual(a);
  });

  test('every texture fades to ~0 at its border', () => {
    for (const k of Object.values(TEX)) {
      const { width: w, height: h, data } = getTexture(k).image;
      for (let x = 0; x < w; x++) {
        expect(data[x * 4]).toBeLessThanOrEqual(3);
        expect(data[((h - 1) * w + x) * 4]).toBeLessThanOrEqual(3);
      }
      for (let y = 0; y < h; y++) {
        expect(data[y * w * 4]).toBeLessThanOrEqual(3);
        expect(data[(y * w + w - 1) * 4]).toBeLessThanOrEqual(3);
      }
    }
  });

  test('unknown kind throws, including inherited names', () => {
    expect(() => getTexture('constructor')).toThrow(/Unknown texture kind/);
    expect(() => getTexture('nope')).toThrow();
  });
});

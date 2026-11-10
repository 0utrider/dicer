import { readFileSync } from 'node:fs';
import { parseAtlas, layoutLabel } from '../../src/render/sdf-atlas.js';

const atlas = parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8')));

test('atlas has 0-9 and the underline mark', () => {
  for (const c of '0123456789.') expect(atlas.glyphs.has(c)).toBe(true);
  expect(atlas.distanceRange).toBe(8);
});

test('layoutLabel packs 2 glyphs x 8 floats', () => {
  expect(layoutLabel('7', atlas)).toBeInstanceOf(Float32Array);
  expect(layoutLabel('7', atlas).length).toBe(16);
});

test('two-digit label lays out two centred, non-overlapping glyphs', () => {
  const L = layoutLabel('20', atlas);
  const [ax0, , ax1] = L,
    [bx0, , bx1] = L.slice(8);
  expect(ax1).toBeLessThanOrEqual(bx0 + 1e-6);
  expect((ax0 + bx1) / 2).toBeCloseTo(0, 3);
});

test('"6." lays out a digit and an underline below it', () => {
  const L = layoutLabel('6.', atlas);
  expect(L[8 + 3]).toBeLessThan(L[1]); // underline top below digit bottom
});

test('single digit is centred and leaves the second slot zero', () => {
  const L = layoutLabel('7', atlas);
  expect((L[0] + L[2]) / 2).toBeCloseTo(0, 3);
  expect((L[1] + L[3]) / 2).toBeCloseTo(0, 3);
  expect(Array.from(L.slice(8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test('labels fit inside the inset face (|uv| < 0.8) at the default size', () => {
  for (const label of ['20', '00', '6.', '1', '18']) {
    const L = layoutLabel(label, atlas);
    for (let g = 0; g < 2; g++) {
      for (let k = 0; k < 4; k++) expect(Math.abs(L[g * 8 + k])).toBeLessThan(0.8);
    }
  }
});

test('uv rects lie inside the atlas', () => {
  const L = layoutLabel('20', atlas);
  for (const g of [0, 8]) {
    for (let k = 4; k < 8; k++) {
      expect(L[g + k]).toBeGreaterThanOrEqual(0);
      expect(L[g + k]).toBeLessThanOrEqual(1);
    }
  }
});

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

/**
 * Ink rect (face units) of glyph slot k: the face rect minus the distance-field margin.
 * The stretch comes from face-units-per-uv, so it also works for the stretched underline.
 * A rect edge may be clipped (the digit bottom, the underline top), so each axis is
 * measured from its unclipped side: digit top / underline bottom, and the left edge.
 */
function inkRect(L, k, ch) {
  const g = atlas.glyphs.get(ch);
  const [x0, y0, x1, y1, u0, v0, u1, v1] = L.slice(k * 8, k * 8 + 8);
  const fx = (x1 - x0) / (u1 - u0); // face units per uv
  const fy = (y1 - y0) / (v1 - v0);
  const padX = (atlas.pad / atlas.scaleW) * fx;
  const padY = (atlas.pad / atlas.scaleH) * fy;
  const w = ((g.w - 2 * atlas.pad) / atlas.scaleW) * fx;
  const h = ((g.h - 2 * atlas.pad) / atlas.scaleH) * fy;
  const left = x0 + padX;
  if (ch === '.') return { x0: left, x1: left + w, y0: y0 + padY, y1: y0 + padY + h };
  return { x0: left, x1: left + w, y0: y1 - padY - h, y1: y1 - padY };
}

test('"6." underline is a short, thick bar well below the digit (not a "1")', () => {
  const size = 0.62; // the default digit height in face units
  const L = layoutLabel('6.', atlas);
  const digit = inkRect(L, 0, '6');
  const bar = inkRect(L, 1, '.');
  expect(bar.x1 - bar.x0).toBeLessThanOrEqual(0.5 * (digit.x1 - digit.x0) + 1e-6);
  expect(bar.y1 - bar.y0).toBeGreaterThanOrEqual(0.15 * size);
  expect(digit.y0 - bar.y1).toBeGreaterThanOrEqual(0.25 * size);
  // still centred under the digit
  expect((bar.x0 + bar.x1) / 2).toBeCloseTo((digit.x0 + digit.x1) / 2, 3);
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

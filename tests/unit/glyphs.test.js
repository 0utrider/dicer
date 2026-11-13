import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';
import { normalizeAppearance } from '../../src/look/appearance.js';
import { ICON_CHARS, iconPatch, withIcons } from '../../src/render/extras/icons.js';
import { atlasCharsOf } from '../../src/render/extras/glyph-atlas.js';
import {
  PIP_CHARS,
  PIP_PATHS,
  COIN_CHARS,
  COIN_PATHS,
  glyphLabels,
  glyphPatch,
  withPips,
  withCoins,
} from '../../src/render/extras/glyphs.js';
import { patchMaterial } from '../../src/render/extras/look-extras.js';

const digitsJson = JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'));
const labelsOf = (type, variant) => getShape(type).values.map((v) => labelFor(type, v, variant));
const nums = (n) => normalizeAppearance({ numbers: n }).numbers;
const TYPES = ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd14', 'd16', 'd20', 'd4crystal'];

test('pip and motif chars are distinct private-use code points that never collide with the icons', () => {
  expect(PIP_CHARS).toHaveLength(6);
  expect(PIP_PATHS).toHaveLength(6);
  expect(Object.keys(COIN_CHARS).sort()).toEqual(['heads', 'moon', 'sun', 'tails']);
  expect(Object.keys(COIN_PATHS).sort()).toEqual(['heads', 'moon', 'sun', 'tails']);
  const chars = [...PIP_CHARS, ...Object.values(COIN_CHARS)];
  const icons = Object.values(ICON_CHARS);
  expect(new Set([...chars, ...icons]).size).toBe(chars.length + icons.length);
  for (const c of chars) {
    expect(c).toHaveLength(1);
    expect(c.charCodeAt(0)).toBeGreaterThanOrEqual(0xe000);
    expect(c.charCodeAt(0)).toBeLessThanOrEqual(0xf8ff);
  }
  for (const p of [...PIP_PATHS, ...Object.values(COIN_PATHS)]) expect(typeof p).toBe('string');
});

describe('glyphLabels', () => {
  test("pips: a plain d6's labels become 6 distinct pip chars; a preset-face d6 and other types unchanged", () => {
    const d6 = getShape('d6');
    const plain = labelsOf('d6');
    const out = glyphLabels(plain, d6, nums({ pips: true }));
    expect(new Set(out).size).toBe(6);
    d6.values.forEach((v, i) => expect(out[i]).toBe(PIP_CHARS[v - 1]));
    expect(plain).toEqual(labelsOf('d6')); // input untouched
    expect(glyphLabels(plain, d6, nums({}))).toBe(plain);
    expect(glyphLabels(plain, d6, nums({ coin: 'sun-moon' }))).toBe(plain);
    // preset faces (blank / glyph labels), a Fate d6, a d3-relabelled d6 and ghosts keep theirs
    for (const labels of [
      plain.map((l, i) => (i === 2 ? '' : l)),
      plain.map((l, i) => (i === 0 ? 'X' : l)),
      labelsOf('d6', 'dF'),
      labelsOf('d6', 'd3'),
      plain.map(() => ''),
    ]) {
      expect(glyphLabels(labels, d6, nums({ pips: true }))).toBe(labels);
    }
    for (const type of TYPES.filter((t) => t !== 'd6')) {
      const labels = labelsOf(type);
      expect(glyphLabels(labels, getShape(type), nums({ pips: true }))).toBe(labels);
    }
    const d10 = getShape('d10');
    const tens = d10.values.map((v) => labelFor('d10', v * 10, 'd100tens'));
    expect(glyphLabels(tens, d10, nums({ pips: true, coin: 'heads-tails' }))).toBe(tens);
  });

  test('coin motifs: d2 labels become the motif pair; other types unchanged', () => {
    const d2 = getShape('d2');
    const plain = labelsOf('d2');
    const at = (labels, v) => labels[d2.values.indexOf(v)];
    const ht = glyphLabels(plain, d2, nums({ coin: 'heads-tails' }));
    expect([at(ht, 1), at(ht, 2)]).toEqual([COIN_CHARS.heads, COIN_CHARS.tails]);
    const sm = glyphLabels(plain, d2, nums({ coin: 'sun-moon' }));
    expect([at(sm, 1), at(sm, 2)]).toEqual([COIN_CHARS.sun, COIN_CHARS.moon]);
    expect(glyphLabels(plain, d2, nums({}))).toBe(plain);
    expect(glyphLabels(plain, d2, nums({ pips: true }))).toBe(plain);
    for (const labels of [['', ''], ['X', '2'], ['1', '']]) {
      expect(glyphLabels(labels, d2, nums({ coin: 'sun-moon' }))).toBe(labels);
    }
    for (const type of TYPES.filter((t) => t !== 'd2')) {
      const labels = labelsOf(type);
      expect(glyphLabels(labels, getShape(type), nums({ coin: 'heads-tails' }))).toBe(labels);
    }
  });
});

test('glyphPatch gives labels and the set\'s atlas only when a label changed', () => {
  const calls = [];
  const compose = (atlas, kind) => (calls.push(kind), { composed: kind });
  const atlas = { distanceRange: 8 };
  const ctx = (type, labels = labelsOf(type)) => ({ shape: getShape(type), labels, atlas });
  const a = normalizeAppearance({ numbers: { pips: true, coin: 'sun-moon', icons: { crit: 'crown' } } });
  expect(glyphPatch(normalizeAppearance({}), ctx('d6'), compose)).toEqual({});
  const d6 = glyphPatch(a, ctx('d6'), compose);
  expect(d6.atlas).toEqual({ composed: 'pips' });
  expect(d6.labels).toEqual(glyphLabels(labelsOf('d6'), getShape('d6'), a.numbers));
  expect(Object.keys(d6).sort()).toEqual(['atlas', 'labels']);
  expect(glyphPatch(a, ctx('d2'), compose).atlas).toEqual({ composed: 'coin' });
  expect(calls).toEqual(['pips', 'coin']);
  for (const type of ['d4', 'd8', 'd10', 'd12', 'd20']) expect(glyphPatch(a, ctx(type), compose)).toEqual({});
  expect(glyphPatch(a, ctx('d6', labelsOf('d6', 'd3')), compose)).toEqual({});
  expect(glyphPatch(a, { shape: getShape('d6'), atlas }, compose)).toEqual({});
  expect(glyphPatch(a, ctx('d6'), () => null)).toEqual({});
  expect(calls).toEqual(['pips', 'coin']);
});

test('icons, pips and coin motifs never relabel the same die: at most one patch gives labels', () => {
  const a = normalizeAppearance({ numbers: { pips: true, coin: 'heads-tails', icons: { crit: 'crown', fumble: 'skull' } } });
  const compose = () => ({ composed: true });
  for (const type of TYPES) {
    const ctx = { shape: getShape(type), labels: labelsOf(type), atlas: { distanceRange: 8 } };
    const given = [iconPatch(a, ctx, compose), glyphPatch(a, ctx, compose)].filter((p) => p.labels);
    expect(given.length).toBeLessThanOrEqual(1);
    expect(given.length).toBe(['d2', 'd6', 'd20'].includes(type) ? 1 : 0);
  }
});

describe('glyph atlas composes like icons', () => {
  // A fake 2D canvas whose every drawing is an inked square in the middle (no Path2D in node).
  const makeCanvas = (w, h) => ({
    width: w,
    height: h,
    getContext: () => ({
      setTransform() {},
      clearRect() {},
      fill() {},
      getImageData(x, y, cw, ch) {
        const data = new Uint8ClampedArray(cw * ch * 4);
        for (let r = ch >> 2; r < (3 * ch) >> 2; r++)
          for (let c = cw >> 2; c < (3 * cw) >> 2; c++) data[(r * cw + c) * 4 + 3] = 255;
        return { data };
      },
    }),
  });
  beforeAll(() => {
    globalThis.Path2D = class {};
  });
  afterAll(() => {
    delete globalThis.Path2D;
  });
  const readPixels = (texture, w, h) => new Uint8Array(w * h * 4).fill(9);

  test('glyph atlas composes like icons (font glyph boxes unchanged, glyphs below)', () => {
    const src = { ...parseAtlas(digitsJson), texture: new THREE.Texture() };
    const pick = ({ char, x, y, width, height, xoffset, yoffset, xadvance }) => ({ char, x, y, width, height, xoffset, yoffset, xadvance });
    for (const [compose, chars] of [
      [withPips, PIP_CHARS],
      [withCoins, Object.values(COIN_CHARS)],
    ]) {
      const out = compose(src, { makeCanvas, readPixels });
      expect(out.texture.isDataTexture).toBe(true);
      expect(out.distanceRange).toBe(8);
      expect(out.digitHeight).toBe(src.digitHeight);
      const all = atlasCharsOf(out);
      const font = all.filter((c) => !chars.includes(c.char));
      expect(font.map(pick)).toEqual(digitsJson.chars.map(pick));
      for (const ch of chars) {
        const g = out.glyphs.get(ch);
        expect(g).toBeDefined();
        expect(Math.round((1 - g.v1) * out.scaleH)).toBeGreaterThanOrEqual(128 + 2);
      }
      expect(compose(src, { makeCanvas, readPixels })).toBe(out); // cached per source
    }
  });

  test('each glyph set keeps its own composed atlas for the same source texture', () => {
    const src = { ...parseAtlas(digitsJson), texture: new THREE.Texture() };
    const o = { makeCanvas, readPixels };
    const icons = withIcons(src, o);
    const pips = withPips(src, o);
    const coins = withCoins(src, o);
    expect(new Set([icons, pips, coins]).size).toBe(3);
    expect(withIcons(src, o)).toBe(icons);
    expect(withPips(src, o)).toBe(pips);
    expect(withCoins(src, o)).toBe(coins);
    expect(icons.glyphs.has(PIP_CHARS[0])).toBe(false);
    expect(pips.glyphs.has(Object.values(ICON_CHARS)[0])).toBe(false);
    expect(coins.glyphs.has(COIN_CHARS.sun)).toBe(true);
  });

  test('the pip glyphs are drawn larger than the icons (they fill the face)', () => {
    const src = { ...parseAtlas(digitsJson), texture: new THREE.Texture() };
    const o = { makeCanvas, readPixels };
    const icon = withIcons(src, o).glyphs.get(Object.values(ICON_CHARS)[0]);
    const pip = withPips(src, o).glyphs.get(PIP_CHARS[5]);
    expect(pip.h).toBeGreaterThan(icon.h);
  });
});

test('patchMaterial merges the pips on a d6 and the motif on a d2 (no shader change)', () => {
  const a = normalizeAppearance({ numbers: { pips: true, coin: 'sun-moon' } });
  const flags = { interiors: true, engraving: true, glow: true, effects: true, interiorSteps: 32, safe: false };
  // no 2D canvas in node: the composers return null and the die keeps its numbers
  const d6 = patchMaterial(a, flags, { shape: getShape('d6'), labels: labelsOf('d6'), atlas: { distanceRange: 8 } });
  expect(d6.labels).toBeUndefined();
  expect(d6.replace).toEqual([]);
  expect(d6.chunks).toEqual({});
  expect(d6.defines).toEqual({});
});

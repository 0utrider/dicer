import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';
import { ICON_IDS, normalizeAppearance } from '../../src/look/appearance.js';
import {
  ICON_PATHS,
  ICON_CHARS,
  iconLabels,
  atlasCharsOf,
  composeAtlas,
  withIcons,
  iconPatch,
} from '../../src/render/extras/icons.js';

const PUA0 = String.fromCharCode(0xe000);
const PUA1 = String.fromCharCode(0xe001);
const digitsJson = JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'));
const labelsOf = (type) => getShape(type).values.map((v) => labelFor(type, v));
const faceOf = (type, value) => getShape(type).values.indexOf(value);

test('ICON_PATHS and ICON_CHARS cover exactly ICON_IDS; chars are distinct private-use code points', () => {
  expect(Object.keys(ICON_PATHS)).toEqual([...ICON_IDS]); // same order: icons.js does not import ICON_IDS
  expect(Object.keys(ICON_CHARS).sort()).toEqual([...ICON_IDS].sort());
  ICON_IDS.forEach((id, i) => {
    expect(ICON_CHARS[id]).toBe(String.fromCharCode(0xe000 + i));
    expect(typeof ICON_PATHS[id]).toBe('string');
    expect(ICON_PATHS[id].length).toBeGreaterThan(10);
  });
  expect(new Set(Object.values(ICON_CHARS)).size).toBe(ICON_IDS.length);
});

describe('iconLabels', () => {
  test('crit on the max face, fumble on the 1', () => {
    const icons = { crit: 'crown', fumble: 'skull' };
    const d20 = labelsOf('d20');
    const out = iconLabels(d20, getShape('d20'), icons);
    const hi = faceOf('d20', 20);
    const lo = faceOf('d20', 1);
    expect(out[hi]).toBe(ICON_CHARS.crown);
    expect(out[lo]).toBe(ICON_CHARS.skull);
    out.forEach((l, i) => {
      if (i !== hi && i !== lo) expect(l).toBe(d20[i]);
    });
    expect(d20[hi]).toBe('20'); // input untouched

    const d10 = iconLabels(labelsOf('d10'), getShape('d10'), { crit: 'starburst', fumble: null });
    expect(labelsOf('d10')[faceOf('d10', 10)]).toBe('0');
    expect(d10[faceOf('d10', 10)]).toBe(ICON_CHARS.starburst);
    expect(d10[faceOf('d10', 1)]).toBe('1');

    const d6 = iconLabels(labelsOf('d6'), getShape('d6'), { crit: 'heart', fumble: null });
    expect(labelsOf('d6')[faceOf('d6', 6)]).toBe('6.');
    expect(d6[faceOf('d6', 6)]).toBe(ICON_CHARS.heart);

    const d4 = iconLabels(labelsOf('d4'), getShape('d4'), { crit: 'flame', fumble: 'broken-shield' });
    expect(d4[faceOf('d4', 4)]).toBe(ICON_CHARS.flame);
    expect(d4[faceOf('d4', 1)]).toBe(ICON_CHARS['broken-shield']);

    expect(iconLabels(d20, getShape('d20'), { crit: null, fumble: null })).toEqual(d20);
  });

  test('keeps numbers on a coin, the d100 tens die, preset faces and ghosts', () => {
    const icons = { crit: 'crown', fumble: 'skull' };
    const d2 = labelsOf('d2');
    expect(iconLabels(d2, getShape('d2'), icons)).toEqual(d2);
    const d10 = getShape('d10');
    const tens = d10.values.map((v) => labelFor('d10', v * 10, 'd100tens'));
    expect(iconLabels(tens, d10, icons)).toEqual(tens);
    const preset = d10.values.map((v, i) => (i % 2 ? '' : 'X'));
    expect(iconLabels(preset, d10, icons)).toEqual(preset);
  });
});

test('atlasCharsOf round-trips digits.json', () => {
  const pick = ({ char, x, y, width, height, xoffset, yoffset, xadvance }) => ({
    char,
    x,
    y,
    width,
    height,
    xoffset,
    yoffset,
    xadvance,
  });
  expect(atlasCharsOf(parseAtlas(digitsJson)).map(pick)).toEqual(digitsJson.chars.map(pick));
});

test("composeAtlas keeps every font glyph's pixels and boxes and adds the icons below", () => {
  const fw = 8;
  const fh = 4;
  const rgba = new Uint8Array(fw * fh * 4).map((_, i) => (i * 7) % 251);
  const fontChar = { char: '1', x: 1, y: 0, width: 5, height: 4, xoffset: 0, yoffset: 2, xadvance: 4 };
  const font = { chars: [fontChar], base: 3, width: fw, height: fh, rgba, distanceRange: 8 };
  const iw = 16;
  const ih = 8;
  const field = new Uint8Array(iw * ih).map((_, i) => (i * 13) % 253);
  const iconChar = (char, x) => ({ id: char.charCodeAt(0), char, x, y: 0, width: 8, height: 8, xoffset: 0, yoffset: 0, xadvance: 8 });
  const icons = {
    json: { common: { base: 7, scaleW: iw, scaleH: ih }, chars: [iconChar(PUA0, 0), iconChar(PUA1, 8)] },
    width: iw,
    height: ih,
    field,
  };
  const out = composeAtlas(font, icons);
  const W = out.json.common.scaleW;
  const H = out.json.common.scaleH;
  expect(W).toBe(16);
  expect(out.width).toBe(W);
  expect(out.height).toBe(H);
  expect(Math.log2(H) % 1).toBe(0);
  expect(H).toBeGreaterThanOrEqual(fh + 2 + ih);
  expect(out.rgba).toHaveLength(W * H * 4);

  const parsed = parseAtlas(out.json);
  expect(parsed.distanceRange).toBe(8);
  expect(parsed.base).toBe(3);
  const one = out.json.chars.find((c) => c.char === '1');
  expect([one.x, one.y, one.width, one.height]).toEqual([1, 0, 5, 4]);
  for (const ch of [PUA0, PUA1]) {
    const c = out.json.chars.find((k) => k.char === ch);
    expect(c.y).toBeGreaterThanOrEqual(6);
    expect(parsed.glyphs.has(ch)).toBe(true);
  }

  // top-down row r -> bottom-up index H - 1 - r
  const texel = (r, c) => Array.from(out.rgba.subarray(((H - 1 - r) * W + c) * 4, ((H - 1 - r) * W + c) * 4 + 4));
  for (const [r, c] of [[0, 0], [1, 5], [3, 7], [2, 3]]) {
    const src = ((fh - 1 - r) * fw + c) * 4;
    expect(texel(r, c)).toEqual(Array.from(rgba.subarray(src, src + 4)));
  }
  for (const [r, c] of [[0, 0], [3, 9], [7, 15], [5, 2]]) {
    const v = field[(ih - 1 - r) * iw + c];
    expect(texel(fh + 2 + r, c)).toEqual([v, v, v, 255]);
  }
});

test('withIcons returns null for an atlas whose distance range is not 8', () => {
  const json = { ...digitsJson, distanceField: { ...digitsJson.distanceField, distanceRange: 4 } };
  expect(withIcons({ ...parseAtlas(json), texture: new THREE.Texture() })).toBeNull();
});

describe('withIcons on a readable atlas', () => {
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
  const source = () => ({ ...parseAtlas(digitsJson), texture: new THREE.Texture() });
  const readPixels = (texture, w, h) => new Uint8Array(w * h * 4).fill(9);

  test('a linear, unmipmapped RGBA DataTexture; glyphs equal parseAtlas of the composed atlas; cached per source', () => {
    const src = source();
    const reads = [];
    const read = (t, w, h) => (reads.push([w, h]), readPixels(t, w, h));
    const out = withIcons(src, { makeCanvas, readPixels: read });
    const t = out.texture;
    expect(t.isDataTexture).toBe(true);
    expect([t.format, t.type, t.colorSpace]).toEqual([THREE.RGBAFormat, THREE.UnsignedByteType, THREE.NoColorSpace]);
    expect([t.minFilter, t.magFilter, t.generateMipmaps, t.flipY]).toEqual([THREE.LinearFilter, THREE.LinearFilter, false, false]);
    expect([t.image.width, t.image.height]).toEqual([out.scaleW, out.scaleH]);
    expect(reads).toEqual([[256, 128]]);
    const json = {
      common: { base: src.base, scaleW: out.scaleW, scaleH: out.scaleH },
      distanceField: { distanceRange: 8 },
      chars: [
        ...digitsJson.chars,
        ...atlasCharsOf(out).filter((c) => Object.values(ICON_CHARS).includes(c.char)),
      ],
    };
    const { texture: _t, ...rest } = out;
    expect(rest).toEqual(parseAtlas(json));
    for (const ch of Object.values(ICON_CHARS)) {
      const g = out.glyphs.get(ch);
      expect(Math.round((1 - g.v1) * out.scaleH)).toBeGreaterThanOrEqual(128 + 2);
    }
    // the font's top-left texel (top-down row 0) is the source's
    const top = (out.scaleH - 1) * out.scaleW * 4;
    expect(Array.from(t.image.data.subarray(top, top + 4))).toEqual([9, 9, 9, 9]);
    expect(withIcons(src, { makeCanvas, readPixels: read })).toBe(out);
    expect(reads).toHaveLength(1);
  });

  test('keeps four composed atlases and disposes the evicted texture', () => {
    const first = withIcons(source(), { makeCanvas, readPixels });
    let disposed = 0;
    first.texture.addEventListener('dispose', () => disposed++);
    for (let i = 0; i < 3; i++) withIcons(source(), { makeCanvas, readPixels });
    expect(disposed).toBe(0);
    withIcons(source(), { makeCanvas, readPixels });
    expect(disposed).toBe(1);
  });

  test('null when the pixels cannot be read', () => {
    expect(withIcons(source(), { makeCanvas, readPixels: () => null })).toBeNull();
    expect(withIcons(source(), { makeCanvas })).toBeNull(); // a Texture without an image
  });
});

test('iconPatch gives labels and atlas only when an icon is on and a label changed', () => {
  const d20 = getShape('d20');
  const ctx = { shape: d20, labels: labelsOf('d20'), atlas: { distanceRange: 8 } };
  const composed = { composed: true };
  const calls = [];
  const compose = (atlas) => (calls.push(atlas), composed);
  expect(iconPatch(normalizeAppearance({}), ctx, compose)).toEqual({});
  expect(calls).toHaveLength(0);

  const a = normalizeAppearance({ numbers: { icons: { crit: 'crown' } } });
  const p = iconPatch(a, ctx, compose);
  expect(p.atlas).toBe(composed);
  expect(calls).toEqual([ctx.atlas]);
  expect(p.labels).toEqual(iconLabels(ctx.labels, d20, a.numbers.icons));
  expect(p.labels[faceOf('d20', 20)]).toBe(ICON_CHARS.crown);
  expect(p).not.toHaveProperty('replace');
  expect(p).not.toHaveProperty('chunks');

  const coin = { shape: getShape('d2'), labels: labelsOf('d2'), atlas: ctx.atlas };
  expect(iconPatch(a, coin, compose)).toEqual({});
  expect(iconPatch(a, ctx, () => null)).toEqual({});
});

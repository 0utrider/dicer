import { readFileSync } from 'node:fs';
import { facesFor, atlasGlyphTest, FATE_FACES, lookFacesFor } from '../../src/compat/faces.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';

const atlas = parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8')));
const digitsOnly = atlasGlyphTest(atlas);

test('labels classify as glyph, image, blank and text', () => {
  const preset = { system: 'sys', type: 'dx', labels: ['1', 'icons/a.webp?v=2', '', '+', 'A'] };
  const faces = facesFor(preset, digitsOnly);
  expect(faces.labels).toEqual([
    { kind: 'glyph', text: '1' },
    { kind: 'image', url: 'icons/a.webp?v=2' },
    { kind: 'blank' },
    { kind: 'text', text: '+' },
    { kind: 'text', text: 'A' },
  ]);
  expect(faces.key.startsWith('sys|dx|')).toBe(true);
});

test('image extensions are case-insensitive and ignore the query', () => {
  for (const url of ['a.PNG', 'b.jpg', 'c.JPEG', 'd.webp#x', 'e.svg?q=1', 'f.Gif']) {
    const [face] = facesFor({ system: 's', type: 'dx', labels: [url] }, digitsOnly).labels;
    expect(face).toEqual({ kind: 'image', url });
  }
  const [txt] = facesFor({ system: 's', type: 'dx', labels: ['png'] }, digitsOnly).labels;
  expect(txt.kind).toBe('text');
});

test('equal label lists give equal keys, different ones different keys', () => {
  const a = facesFor({ system: 's', type: 'df', labels: ['-', '', '+'] }, digitsOnly);
  const b = facesFor({ system: 's', type: 'df', labels: ['-', '', '+'] }, digitsOnly);
  const c = facesFor({ system: 's', type: 'df', labels: ['+', '', '-'] }, digitsOnly);
  expect(a.key).toBe(b.key);
  expect(a.key).not.toBe(c.key);
});

test('faces follow the base shape order (face i shows value values[i])', () => {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  const faces = facesFor({ system: 's', type: 'd6', shape: 'd6', labels }, digitsOnly);
  const values = getShape('d6').values;
  expect(faces.labels.map((l) => l.text)).toEqual(values.map((v) => labels[v - 1]));
});

test('plain numbers and model presets keep the default labels', () => {
  const d6 = { system: 's', type: 'd6', labels: ['1', '2', '3', '4', '5', '6'] };
  expect(facesFor(d6, digitsOnly)).toBeUndefined();
  expect(facesFor({ system: 's', type: 'd6', labels: [] }, digitsOnly)).toBeUndefined();
});

test('the atlas test needs every character in the atlas and at most two glyphs', () => {
  expect(digitsOnly('12')).toBe(true);
  expect(digitsOnly('100')).toBe(false);
  expect(digitsOnly('A')).toBe(false);
  expect(digitsOnly('')).toBe(false);
});

test('the built-in Fate faces sit on the d6: 1, 2 plus; 3, 4 blank; 5, 6 minus', () => {
  const plus = { kind: 'text', text: '+' };
  const minus = { kind: 'text', text: '−' };
  const byValue = { 1: plus, 2: plus, 3: { kind: 'blank' }, 4: { kind: 'blank' }, 5: minus, 6: minus };
  expect(FATE_FACES.labels).toEqual(getShape('d6').values.map((v) => byValue[v]));
  expect(typeof FATE_FACES.key).toBe('string');
  // Shared by every Fate die: nothing may change it.
  expect(Object.isFrozen(FATE_FACES) && Object.isFrozen(FATE_FACES.labels)).toBe(true);
  expect(FATE_FACES.labels.every(Object.isFrozen)).toBe(true);
});

test('a throwing atlas test classifies as text', () => {
  const [face] = facesFor({ system: 's', type: 'dx', labels: ['1'] }, () => {
    throw new Error('x');
  }).labels;
  expect(face.kind).toBe('text');
});

describe('lookFacesFor: the face images of a look', () => {
  const look = (faces, facesTint) => ({ faces, ...(facesTint ? { facesTint } : {}) });

  test('an image on the faces it names, numbers elsewhere; no images: base as it is', () => {
    const set = lookFacesFor('d6', look({ d6: { 6: 'worlds/w/logo.webp' } }));
    const values = getShape('d6').values;
    set.labels.forEach((l, i) =>
      expect(l).toEqual(values[i] === 6 ? { kind: 'image', url: 'worlds/w/logo.webp' } : { kind: 'glyph', text: labelFor('d6', values[i]) }),
    );
    expect(set.key.startsWith('look|d6|0|')).toBe(true);
    const base = { key: 'p', labels: [] };
    expect(lookFacesFor('d20', look({ d6: { 6: 'a.png' } }), base)).toBe(base);
    expect(lookFacesFor('d6', {}, undefined)).toBeUndefined();
  });

  test('over a preset: its labels stay on the other faces; the key follows both and the tint', () => {
    const base = { key: 'sys|d6|x', labels: getShape('d6').values.map((v) => ({ kind: 'text', text: `p${v}` })) };
    const a = lookFacesFor('d6', look({ d6: { 1: 'a.png' } }), base);
    const i1 = getShape('d6').values.indexOf(1);
    expect(a.labels[i1]).toEqual({ kind: 'image', url: 'a.png' });
    expect(a.labels.filter((l) => l.kind === 'text')).toHaveLength(5);
    expect(a.key.endsWith('|sys|d6|x')).toBe(true);
    const tinted = lookFacesFor('d6', look({ d6: { 1: 'a.png' } }, true), base);
    expect(tinted.labels[i1]).toEqual({ kind: 'image', url: 'a.png', tint: true });
    expect(tinted.key).not.toBe(a.key);
    expect(lookFacesFor('d6', look({ d6: { 1: 'b.png' } }), base).key).not.toBe(a.key);
  });
});

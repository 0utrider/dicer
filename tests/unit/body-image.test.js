/**
 * Body images (appearance.bodyImage): the look field, the look-extras patch, the texture cache and
 * the material's program key.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { normalizeAppearance, appearanceKey, needsLookExtras, fallbackLook } from '../../src/look/appearance.js';
import { bodyImagePatch, createBodyImages } from '../../src/render/extras/body-image.js';
import { patchMaterial } from '../../src/render/extras/look-extras.js';
import { createDiceMaterial } from '../../src/render/dice-material.js';
import { _setLookExtrasImport, requestLookExtras } from '../../src/render/extras-loader.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';

const FLAGS = { interiors: true, engraving: true, glow: true, interiorSteps: 32, effects: true };

describe('the look field', () => {
  test('a valid image with its settings, clamped; defaults filled', () => {
    const a = normalizeAppearance({ bodyImage: { src: 'worlds/w/galaxy.webp', mode: 'face', scale: 9, rotation: -5, blend: 0.4, tint: true } });
    expect(a.bodyImage).toEqual({ src: 'worlds/w/galaxy.webp', mode: 'face', scale: 1, rotation: 0, blend: 0.4, tint: true });
    expect(normalizeAppearance({ bodyImage: { src: 'https://x.y/camo.png' } }).bodyImage).toEqual({
      src: 'https://x.y/camo.png',
      mode: 'wrap',
      scale: 1,
      rotation: 0,
      blend: 1,
      tint: false,
    });
  });

  test('no image or a bad path: no field (old looks keep their key); a body image needs the chunk', () => {
    const plain = normalizeAppearance({});
    for (const bad of [{}, { src: '' }, { src: 'javascript:alert(1).png' }, { src: 'notes.txt' }, 'x'])
      expect('bodyImage' in normalizeAppearance({ bodyImage: bad })).toBe(false);
    const withImage = normalizeAppearance({ body: { type: 'opaque' }, bodyImage: { src: 'a.png' } });
    expect(appearanceKey(normalizeAppearance({ bodyImage: { src: 'x.txt' } }))).toBe(appearanceKey(plain));
    expect(needsLookExtras(withImage)).toBe(true);
    expect(fallbackLook(withImage).body.type).toBe('opaque'); // the fallback keeps the body, just no image
  });
});

describe('bodyImagePatch', () => {
  const texture = new THREE.Texture();
  const look = (bodyImage) => normalizeAppearance({ bodyImage });

  test('only with a loaded texture: define, uniforms (mode, scale, radians, blend, tint) and colour code', () => {
    expect(bodyImagePatch(look({ src: 'a.png' }), {})).toEqual({});
    expect(bodyImagePatch(normalizeAppearance({}), { bodyTex: { texture } })).toEqual({});
    const p = bodyImagePatch(look({ src: 'a.png', mode: 'face', scale: 2, rotation: 90, blend: 0.5, tint: true }), { bodyTex: { texture } });
    expect(p.defines).toEqual({ DICER_BODY_IMAGE: '' });
    expect(p.uniforms.uBodyImage.value).toBe(texture);
    const m = p.uniforms.uBodyImageMap.value;
    expect([m.x, m.y, m.z, m.w]).toEqual([1, 2, Math.PI / 2, 0.5]);
    expect(p.uniforms.uBodyImageTint.value).toBe(1);
    expect(p.chunks.colorPost).toContain('( 1.0 - dcMask )'); // never over the numbers
  });

  test('look-extras merges it into the material patch after the body pattern', () => {
    const a = normalizeAppearance({ body: { type: 'wood' }, bodyImage: { src: 'a.png' } });
    const p = patchMaterial(a, FLAGS, { bodyTex: { texture } });
    expect(p.defines.DICER_BODY_IMAGE).toBe('');
    expect(p.defines.DICER_WOOD).toBe('');
  });
});

describe('createBodyImages', () => {
  test('one texture per url, refcounted; repeat-wrapped sRGB; disposed when nobody holds it', async () => {
    const loadImage = vi.fn(async () => ({ width: 4, height: 4 }));
    const images = createBodyImages({ loadImage });
    const a = await images.acquire('a.png');
    const b = await images.acquire('a.png');
    expect(b).toBe(a);
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(a.texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(a.texture.colorSpace).toBe(THREE.SRGBColorSpace);
    const dispose = vi.spyOn(a.texture, 'dispose');
    images.release('a.png');
    expect(images.size).toBe(1);
    images.release('a.png');
    await Promise.resolve();
    expect(images.size).toBe(0);
    expect(dispose).toHaveBeenCalled();
  });

  test('a failing image: null and one warning per url', async () => {
    const warn = vi.fn();
    const images = createBodyImages({ loadImage: async () => Promise.reject(new Error('404')), warn });
    expect(await images.acquire('x.png')).toBeNull();
    images.release('x.png');
    expect(await images.acquire('x.png')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('createDiceMaterial with a body image', () => {
  const atlas = { ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))), texture: new THREE.Texture() };
  const shape = getShape('d20');
  const labels = shape.values.map((v) => labelFor('d20', v));
  afterAll(() => _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js')));

  test('the image program is keyed apart from the plain one; without the texture the die is plain', async () => {
    _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
    await requestLookExtras();
    const a = normalizeAppearance({ body: { type: 'opaque' }, bodyImage: { src: 'a.png' } });
    const plain = createDiceMaterial(a, atlas, shape, labels, FLAGS);
    expect(plain.defines.DICER_BODY_IMAGE).toBeUndefined();
    expect(plain.userData.programKey).not.toContain('|bi1');
    const withTex = createDiceMaterial(a, atlas, shape, labels, FLAGS, null, { texture: new THREE.Texture() });
    expect(withTex.defines.DICER_BODY_IMAGE).toBe('');
    expect(withTex.userData.programKey).toBe(`${plain.userData.programKey}|bi1`);
  });
});

/**
 * Body images (appearance.bodyImage): the look field, the look-extras patch, the texture cache and
 * the material's program key.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { normalizeAppearance, appearanceKey, needsLookExtras, fallbackLook } from '../../src/look/appearance.js';
import { bodyImagePatch, createBodyImages, faceFit, FACE_FIT } from '../../src/render/extras/body-image.js';
import { colorsetToAppearance } from '../../src/compat/colorset-map.js';
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

describe('each face: laid out as Dice So Nice lays a texture on a face', () => {
  const deg = (r) => Math.round((r * 180) / Math.PI);

  test('the measured fit per die type; the d6 art turns to sit square, the d10 keeps its sharp pole up', () => {
    for (const t of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
      const { fit } = faceFit(getShape(t));
      expect([fit.x, fit.y, fit.z]).toEqual([FACE_FIT[t][0], 0.5, FACE_FIT[t][1]]);
    }
    const d6 = Array.from(faceFit(getShape('d6')).rot).slice(0, 6).map(deg);
    for (const a of d6) expect(Math.abs(a)).toBe(45);
    for (const t of ['d8', 'd10', 'd12', 'd20']) expect(Array.from(faceFit(getShape(t)).rot).every((r) => Math.abs(r) < 1e-6)).toBe(true);
  });

  test('another shape fits the face’s outer circle, centred; the face uniforms reach the patch', () => {
    const { fit } = faceFit(getShape('d4crystal'));
    expect(fit.y).toBe(0.5);
    expect(fit.z).toBe(0.5);
    expect(fit.x).toBeGreaterThan(0);
    expect(fit.x).toBeLessThan(0.5);
    const a = normalizeAppearance({ bodyImage: { src: 'a.png', mode: 'face' } });
    const p = bodyImagePatch(a, { bodyTex: { texture: new THREE.Texture() }, shape: getShape('d20') });
    expect(p.uniforms.uBodyImageFit.value.x).toBe(FACE_FIT.d20[0]);
    expect(p.uniforms.uBodyImageRot.value).toHaveLength(20);
  });
});

describe('Dice So Nice colorset textures', () => {
  const textures = new Map([
    ['art', { id: 'art', name: 'Art', composite: 'source-over', source: 'modules/m/assets/d20.webp' }],
    ['tinted', { id: 'tinted', name: 'Tinted', composite: 'multiply', source: 'modules/m/t.png' }],
    ['soft', { id: 'soft', name: 'Soft', composite: 'soft-light', source: 'modules/m/s.png' }],
  ]);

  test('a texture image becomes an each-face body image; the composite sets tint and strength', () => {
    const a = colorsetToAppearance({ background: '#272727', foreground: '#fffec8', texture: 'art', material: 'plastic' }, { textures });
    expect(a.bodyImage).toEqual({ src: 'modules/m/assets/d20.webp', mode: 'face', scale: 1, rotation: 0, blend: 1, tint: false });
    expect(colorsetToAppearance({ texture: 'tinted' }, { textures }).bodyImage).toMatchObject({ tint: true, blend: 1 });
    expect(colorsetToAppearance({ texture: 'soft' }, { textures }).bodyImage).toMatchObject({ tint: true, blend: 0.5 });
  });

  test('a named texture without an image keeps the old ruling; the font becomes a page font', () => {
    const a = colorsetToAppearance({ texture: 'stone', font: 'Grenze' }, { textures: new Map() });
    expect('bodyImage' in a).toBe(false);
    expect(a.body.type).toBe('marble');
    expect(a.numbers.font).toBe('css:Grenze');
    expect(colorsetToAppearance({ font: 'Bad<Font>' }).numbers.font).toBe('serif');
  });
});

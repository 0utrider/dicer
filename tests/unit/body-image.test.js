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

  test("a DSN add-on texture: its bump map as a normal map on each face (once built); on metal, Dice So Nice's reflections", async () => {
    const { addonTextures, loadNormal, resetAddonTextures } = await import('../../src/render/extras/addon-textures.js');
    const flat = bodyImagePatch(look({ src: 'a.png', mode: 'face' }), { bodyTex: { texture } });
    expect(flat.defines.DICER_BODY_RELIEF).toBeUndefined();
    expect(flat.chunks.normal).toBeUndefined();
    addonTextures.set('b.webp', { bump: 'b-bump.webp' });
    addonTextures.set('f.webp', { bump: null });
    // not built yet: no relief (the build starts)
    expect(bodyImagePatch(look({ src: 'b.webp', mode: 'face' }), { bodyTex: { texture } }).defines.DICER_BODY_RELIEF).toBeUndefined();
    const img = { width: 4, height: 4 };
    const ctx = { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(256 * 256 * 4) }), putImageData() {} };
    globalThis.ImageData ??= class {
      constructor(data, w, h) {
        Object.assign(this, { data, width: w, height: h });
      }
    };
    resetAddonTextures();
    addonTextures.set('b.webp', { bump: 'b-bump.webp' });
    addonTextures.set('f.webp', { bump: null });
    await loadNormal('b-bump.webp', { load: async () => img, doc: { createElement: () => ({ getContext: () => ctx }) } });
    const p = bodyImagePatch(look({ src: 'b.webp', mode: 'face' }), { bodyTex: { texture } });
    expect(p.defines).toEqual({ DICER_BODY_IMAGE: '', DICER_BODY_RELIEF: '' });
    expect(p.uniforms.uBodyNormal.value).toBeInstanceOf(THREE.Texture);
    expect(p.chunks.normal).toContain('dcBodyNormal');
    expect(bodyImagePatch(look({ src: 'b.webp', mode: 'wrap' }), { bodyTex: { texture } }).defines.DICER_BODY_RELIEF).toBeUndefined(); // each face only
    expect(bodyImagePatch(look({ src: 'f.webp', mode: 'face' }), { bodyTex: { texture } }).defines.DICER_BODY_RELIEF).toBeUndefined(); // no bump map
    // on metal an add-on texture gets Dice So Nice's reflections; Dicer's own images never do
    const metal = (src) => bodyImagePatch(normalizeAppearance({ body: { type: 'metal' }, bodyImage: { src } }), { bodyTex: { texture } }).defines.DICER_ADDON_METAL;
    expect(metal('f.webp')).toBe('');
    expect(metal('a.png')).toBeUndefined();
    expect(p.defines.DICER_ADDON_METAL).toBeUndefined(); // not metal
    resetAddonTextures();
  });

  test("normalFromHeights: flat is straight up; a slope tilts the normal downhill, as Dice So Nice's Sobel does", async () => {
    const { normalFromHeights } = await import('../../src/render/extras/addon-textures.js');
    const flat = normalFromHeights(new Float32Array(16).fill(0.5), 4, 4);
    expect([flat[0], flat[1], flat[2]]).toEqual([128, 128, 255]);
    // brighter to the right: the normal leans left (x below the middle), as higher ground faces away
    const ramp = Float32Array.from({ length: 64 }, (_, i) => (i % 8) / 8);
    const n = normalFromHeights(ramp, 8, 8);
    const o = (3 * 8 + 4) * 4;
    expect(n[o]).toBeLessThan(120);
    expect(n[o + 1]).toBeGreaterThanOrEqual(126);
    expect(n[o + 1]).toBeLessThanOrEqual(128);
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

  test('never over an image face: with face layers the print skips the decal too (PF2e Dicefinder Campaign)', async () => {
    _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
    await requestLookExtras();
    const a = normalizeAppearance({ body: { type: 'opaque' }, bodyImage: { src: 'a.png', mode: 'face' } });
    const n = shape.faces.length;
    const faceTex = { texture: new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4 * n), 4, 4, n), layers: Int16Array.from({ length: n }, (_, i) => i), tint: new Uint8Array(n) };
    const frag = (m) => {
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
      m.onBeforeCompile(shader);
      return shader.fragmentShader;
    };
    const layered = frag(createDiceMaterial(a, atlas, shape, labels, FLAGS, faceTex, { texture: new THREE.Texture() }));
    expect(layered).toContain('dcBodyPrint = uBodyImageMap.w * dcBi.a * ( 1.0 - max( dcMask, dcDecal ) );');
    expect(layered.indexOf('float dcDecal')).toBeLessThan(layered.indexOf('dcBodyPrint = uBodyImageMap.w'));
    const plain = frag(createDiceMaterial(a, atlas, shape, labels, FLAGS, null, { texture: new THREE.Texture() }));
    expect(plain).toContain('dcBodyPrint = uBodyImageMap.w * dcBi.a * ( 1.0 - dcMask );');
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

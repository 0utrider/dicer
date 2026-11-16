// @vitest-environment jsdom
/**
 * A look from a die model's colours: the most common colour for the body, the common colour
 * farthest from it for the numbers, metal when the material is.
 */
import * as THREE from 'three';
import { paletteOf, materialPalette, modelLook, lookFromModels } from '../../src/themes/model-colours.js';

/** RGBA pixels: `n` of each [r, g, b] (alpha 255), plus `clear` transparent ones. */
const px = (pairs, clear = 0) => {
  const out = [];
  for (const [n, rgb] of pairs) for (let i = 0; i < n; i++) out.push(...rgb, 255);
  for (let i = 0; i < clear; i++) out.push(0, 0, 0, 0);
  return Uint8ClampedArray.from(out);
};

describe('paletteOf', () => {
  test('body is the common colour, accent the far one; specks and transparent pixels do not count', () => {
    const p = paletteOf(px([[700, [150, 20, 25]], [250, [220, 170, 60]], [5, [0, 255, 0]]], 400));
    expect(p.body).toBe('#961419');
    expect(p.accent).toBe('#dcaa3c');
  });

  test('the colour factor tints the texture; a one-colour die gets black or white numbers', () => {
    expect(paletteOf(px([[100, [200, 200, 200]]]), [1, 0.5, 0.5]).body).toBe('#c86464');
    expect(paletteOf(px([[100, [30, 30, 30]]])).accent).toBe('#f0f0f0');
    expect(paletteOf(px([[100, [230, 230, 230]]])).accent).toBe('#141414');
    expect(paletteOf(px([], 10))).toBeNull();
  });
});

describe('modelLook', () => {
  test('from a material with no texture: its colour, metal when metallic, no inside', () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xb08d2a, metalness: 0.9, roughness: 0.3 });
    expect(materialPalette(mat).body).toBe('#b08d2a');
    const look = modelLook(mat);
    expect(look.body).toMatchObject({ type: 'metal', color: '#b08d2a', roughness: 0.3 });
    expect(look.interior.type).toBe('none');
    expect(look.numbers.fill).toBe('gold');
    const plastic = modelLook(new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0 }));
    expect(plastic.body.type).toBe('opaque');
    expect(plastic.numbers).toMatchObject({ fill: 'paint', color: '#f0f0f0' });
    expect(modelLook(null)).toBeNull();
  });

  test('lookFromModels: the d20 first, the next model when one fails; null when none gives a colour', async () => {
    const red = new THREE.MeshStandardMaterial({ color: 0xaa0000 });
    const load = vi.fn(async (url) => {
      if (url === 'd20.gltf') throw new Error('404');
      return { material: red };
    });
    const look = await lookFromModels({ d6: 'd6.gltf', d20: 'd20.gltf' }, { load });
    expect(load.mock.calls.map((c) => c[0])).toEqual(['d20.gltf', 'd6.gltf']);
    expect(look.body.color).toBe('#aa0000');
    expect(await lookFromModels({ d6: 'x' }, { load: async () => ({ material: null }) })).toBeNull();
    expect(await lookFromModels(undefined, { load })).toBeNull();
  });
});

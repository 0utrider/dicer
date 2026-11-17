/**
 * Stone, bone and jelly bodies and the mirror metal finish: what normalisation keeps, the
 * look-extras patch each body brings, and what a die draws while the chunk is missing.
 */
import {
  normalizeAppearance,
  needsLookExtras,
  fallbackLook,
  programKey,
} from '../../src/look/appearance.js';
import { bodyPatch } from '../../src/render/extras/bodies/index.js';
import { PRESET_PARAMS as STONE } from '../../src/render/extras/bodies/stone.js';
import { PRESET_PARAMS as BONE } from '../../src/render/extras/bodies/bone.js';
import { RESIN_REFRACTION } from '../../src/render/shaders/bodies.js';
import { createDiceMaterial } from '../../src/render/dice-material.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const FLAGS = { interiors: true, engraving: true, glow: true, interiorSteps: 32, effects: true };
const look = (body) => normalizeAppearance({ body });

test('stone and bone keep their presets (an unknown one is the first); jelly has none and nothing inside', () => {
  expect(look({ type: 'stone', preset: 'brick' }).body.preset).toBe('brick');
  expect(look({ type: 'stone', preset: 'lava' }).body.preset).toBe('granite');
  expect(look({ type: 'bone', preset: 'fossil' }).body.preset).toBe('fossil');
  const jelly = normalizeAppearance({ body: { type: 'jelly' }, interior: { type: 'nebula' } });
  expect(jelly.body.preset).toBeNull();
  expect(jelly.interior.type).toBe('none');
  for (const type of ['stone', 'bone', 'jelly']) expect(needsLookExtras(look({ type }))).toBe(true);
});

test('each body patch: its define and preset uniform; programs keyed apart', () => {
  const stone = bodyPatch(look({ type: 'stone', preset: 'slate' }), FLAGS);
  expect(stone.defines.DICER_STONE).toBe('');
  expect(stone.uniforms.uBodyPreset.value.toArray()).toEqual(STONE.slate);
  expect(stone.chunks.colorPre).toContain('dcFbm3'); // the noise library rides along
  expect(stone.chunks.pars).toContain('float dcFbm3');
  const bone = bodyPatch(look({ type: 'bone', preset: 'ivory' }), FLAGS);
  expect(bone.defines.DICER_BONE).toBe('');
  expect(bone.uniforms.uBodyPreset.value.toArray()).toEqual(BONE.ivory);
  expect(bone.params.sheen).toBeGreaterThan(0);
  const keys = ['stone', 'bone', 'jelly', 'resin'].map((type) => programKey(look({ type }), FLAGS));
  expect(new Set(keys).size).toBe(4);
});

test('jelly is seen through like resin: the refraction, a low ior, a denser body and a sheen', () => {
  const p = bodyPatch(look({ type: 'jelly', color: '#ff3366', color2: '#ffd0e0' }), FLAGS);
  expect(p.defines).toMatchObject({ DICER_RESIN: '', DICER_JELLY: '' });
  expect(p.chunks.lighting).toContain(RESIN_REFRACTION);
  expect(p.params.ior).toBeLessThan(1.3);
  expect(p.uniforms.uResinDensity.value).toBeGreaterThan(1);
  expect(p.params.sheenColor.getHexString()).toBe('ffd0e0');
});

test('without the chunk: stone draws as marble, bone as opaque, jelly as clear resin', () => {
  expect(['stone', 'bone', 'jelly'].map((type) => fallbackLook(look({ type })).body.type)).toEqual([
    'marble',
    'opaque',
    'resin',
  ]);
});

test('a mirror metal is polished flawless whatever its roughness', () => {
  const atlas = {
    ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
    texture: new THREE.Texture(),
  };
  const shape = getShape('d6');
  const labels = shape.values.map((v) => labelFor('d6', v));
  const m = createDiceMaterial(
    look({ type: 'metal', finish: 'mirror', roughness: 0.6 }),
    atlas,
    shape,
    labels,
    FLAGS,
  );
  expect(m.roughness).toBeLessThan(0.05);
  expect(m.metalness).toBe(1);
  expect(
    createDiceMaterial(look({ type: 'metal', roughness: 0.6 }), atlas, shape, labels, FLAGS)
      .roughness,
  ).toBe(0.6);
});

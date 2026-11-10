import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { createDiceMaterial, updateLabels } from '../../src/render/dice-material.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';

const atlas = {
  ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
  texture: new THREE.Texture(),
};
const s = getShape('d20');
const labels = s.values.map((v) => labelFor('d20', v));

test('program cache key depends on body only', () => {
  const a = createDiceMaterial(
    { body: 'resin', bodyColor: '#f00', fillColor: '#fc0', fillMetallic: true },
    atlas,
    s,
    labels,
  );
  const b = createDiceMaterial(
    { body: 'resin', bodyColor: '#00f', fillColor: '#fff', fillMetallic: false },
    atlas,
    s,
    labels,
  );
  const c = createDiceMaterial(
    { body: 'metal', bodyColor: '#00f', fillColor: '#fff', fillMetallic: false },
    atlas,
    s,
    labels,
  );
  expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
  expect(a.customProgramCacheKey()).toBe('dicer-resin');
  expect(c.customProgramCacheKey()).not.toBe(a.customProgramCacheKey());
});

test('label texture has 4 texels per face and updates in place', () => {
  const m = createDiceMaterial(
    { body: 'opaque', bodyColor: '#fff', fillColor: '#000', fillMetallic: false },
    atlas,
    s,
    labels,
  );
  const tex = m.userData.uniforms.uLabels.value;
  expect(tex.image.width * tex.image.height).toBe(s.faces.length * 4);
  const before = Array.from(tex.image.data);
  const v0 = tex.version;
  updateLabels(m, labels.slice().reverse(), atlas);
  expect(m.userData.uniforms.uLabels.value).toBe(tex);
  expect(tex.version).toBeGreaterThan(v0);
  expect(Array.from(tex.image.data)).not.toEqual(before);
});

test('uniforms: atlas, fill colour, engrave depth', () => {
  const m = createDiceMaterial(
    {
      body: 'opaque',
      bodyColor: '#fff',
      fillColor: '#ffcc00',
      fillMetallic: true,
      engraveDepth: 0.8,
    },
    atlas,
    s,
    labels,
  );
  const u = m.userData.uniforms;
  expect(u.uAtlas.value).toBe(atlas.texture);
  expect(u.uFillColor.value.getHexString()).toBe(new THREE.Color('#ffcc00').getHexString());
  expect(u.uEngrave.value).toBeCloseTo(0.8);
  const d = createDiceMaterial(
    { body: 'opaque', bodyColor: '#fff', fillColor: '#000', fillMetallic: false },
    atlas,
    s,
    labels,
  );
  expect(d.userData.uniforms.uEngrave.value).toBeCloseTo(0.5);
});

test('body presets', () => {
  const opaque = createDiceMaterial(
    { body: 'opaque', bodyColor: '#fff', fillColor: '#000', fillMetallic: false },
    atlas,
    s,
    labels,
  );
  const metal = createDiceMaterial(
    { body: 'metal', bodyColor: '#c90', fillColor: '#210', fillMetallic: false },
    atlas,
    s,
    labels,
  );
  const resin = createDiceMaterial(
    { body: 'resin', bodyColor: '#28f', fillColor: '#fc0', fillMetallic: true },
    atlas,
    s,
    labels,
  );
  expect(opaque.roughness).toBeCloseTo(0.35);
  expect(opaque.clearcoat).toBeCloseTo(0.6);
  expect(metal.metalness).toBe(1);
  expect(metal.roughness).toBeCloseTo(0.28);
  expect(resin.transmission).toBeGreaterThan(0.5);
  expect(resin.ior).toBeCloseTo(1.52);
  expect(resin.attenuationColor.getHexString()).toBe(new THREE.Color('#28f').getHexString());
});

test('onBeforeCompile patches the shaders with the face varyings and uniforms', () => {
  const m = createDiceMaterial(
    { body: 'opaque', bodyColor: '#fff', fillColor: '#000', fillMetallic: false },
    atlas,
    s,
    labels,
  );
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  m.onBeforeCompile(shader);
  expect(shader.vertexShader).toContain('aFaceId');
  expect(shader.vertexShader).toContain('vFaceUV');
  expect(shader.fragmentShader).toContain('uLabels');
  // every injection point exists in r184's physical shader
  for (const marker of [
    'dcMask = smoothstep',
    'roughnessFactor = mix',
    'metalnessFactor = mix',
    'normal = normalize( normal + dcTilt )',
    'clearcoatNormal = normal',
    'transmission * ( 1.0 - dcMask )',
  ])
    expect(shader.fragmentShader).toContain(marker);
  expect(shader.vertexShader).toContain('vFaceId = aFaceId');
  expect(shader.uniforms.uAtlas).toBe(m.userData.uniforms.uAtlas);
});

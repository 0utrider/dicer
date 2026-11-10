import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { createDiceMaterial, updateLabels } from '../../src/render/dice-material.js';
import { ENGRAVE_PARS, ENGRAVE_NORMAL, ENGRAVE_COLOR } from '../../src/render/shaders/engrave.js';
import { NOISE_GLSL } from '../../src/render/shaders/noise.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';
import { normalizeAppearance, programKey } from '../../src/look/appearance.js';
import { LOOKS } from '../../src/look/looks.js';

const atlas = {
  ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
  texture: new THREE.Texture(),
};
const s = getShape('d20');
const labels = s.values.map((v) => labelFor('d20', v));
const FLAGS = { interiors: true, engraving: true, glow: true, interiorSteps: 32 };

const look = (partial) => normalizeAppearance(partial);
const opaque = (extra = {}) =>
  look({ body: { type: 'opaque', color: '#ffffff', roughness: 0.3 }, ...extra });

function patched(material) {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader);
  return shader;
}

test('two looks that differ only in colours share one program', () => {
  const a = createDiceMaterial(
    look({
      body: { type: 'resin', color: '#ff0000', color2: '#110000', roughness: 0.04 },
      interior: { type: 'nebula', colors: ['#ff00ff', '#00ffff'], density: 0.2 },
      numbers: { fill: 'gold', color: '#ffcc00', depth: 0.3 },
    }),
    atlas,
    s,
    labels,
  );
  const b = createDiceMaterial(
    look({
      body: { type: 'resin', color: '#0000ff', color2: '#000011', roughness: 0.09 },
      interior: { type: 'nebula', colors: ['#00ff00', '#ffffff'], density: 0.9 },
      numbers: { fill: 'gold', color: '#ffffff', depth: 0.8 },
    }),
    atlas,
    s,
    labels,
  );
  expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
  expect(a.userData.programKey).toBe(b.userData.programKey);
});

test('customProgramCacheKey is dicer- + programKey(appearance, flags)', () => {
  const a = look({ body: { type: 'metal' } });
  const m = createDiceMaterial(a, atlas, s, labels, FLAGS);
  expect(m.customProgramCacheKey()).toBe('dicer-' + programKey(a, FLAGS));
  expect(m.userData.programKey).toBe(programKey(a, FLAGS));
  const r = createDiceMaterial(look({ body: { type: 'resin' } }), atlas, s, labels);
  expect(r.customProgramCacheKey()).not.toBe(m.customProgramCacheKey());
});

test('paint and gold fills share one program (the fill is uniform-driven)', () => {
  const paint = createDiceMaterial(opaque({ numbers: { fill: 'paint' } }), atlas, s, labels);
  const gold = createDiceMaterial(opaque({ numbers: { fill: 'gold' } }), atlas, s, labels);
  const enamel = createDiceMaterial(opaque({ numbers: { fill: 'enamel' } }), atlas, s, labels);
  expect(paint.customProgramCacheKey()).toBe(gold.customProgramCacheKey());
  expect(enamel.customProgramCacheKey()).toBe(gold.customProgramCacheKey());
});

test('fill PBR uniforms', () => {
  const fill = (f) =>
    createDiceMaterial(opaque({ numbers: { fill: f, color: '#123456' } }), atlas, s, labels)
      .userData.uniforms;
  const expectPBR = (u, metal, rough, gloss) => {
    expect(u.uFillPBR.value.x).toBeCloseTo(metal);
    expect(u.uFillPBR.value.y).toBeCloseTo(rough);
    expect(u.uFillGloss.value).toBeCloseTo(gloss);
  };
  expectPBR(fill('paint'), 0, 0.6, 0);
  expectPBR(fill('gold'), 1, 0.3, 0);
  expectPBR(fill('silver'), 1, 0.25, 0);
  expectPBR(fill('enamel'), 0, 0.15, 1);
  expect(fill('gold').uFillColor.value.getHexString()).toBe(
    new THREE.Color('#123456').getHexString(),
  );
});

test('legacy flat input still builds', () => {
  const m = createDiceMaterial(
    { body: 'resin', bodyColor: '#28f', fillColor: '#fc0', fillMetallic: true, engraveDepth: 0.8 },
    atlas,
    s,
    labels,
  );
  expect(m).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  expect(m.transmission).toBeGreaterThan(0.5);
  expect(m.attenuationColor.getHexString()).toBe(new THREE.Color('#28f').getHexString());
  const u = m.userData.uniforms;
  expect(u.uFillColor.value.getHexString()).toBe(new THREE.Color('#fc0').getHexString());
  expect(u.uFillPBR.value.x).toBe(1); // fillMetallic -> gold
  expect(u.uEngrave.value).toBeCloseTo(0.8);
});

test('engraving: false changes the program key and leaves DICER_ENGRAVE undefined', () => {
  const a = opaque();
  const on = createDiceMaterial(a, atlas, s, labels, FLAGS);
  const off = createDiceMaterial(a, atlas, s, labels, { ...FLAGS, engraving: false });
  expect(off.customProgramCacheKey()).not.toBe(on.customProgramCacheKey());
  expect(on.defines).toHaveProperty('DICER_ENGRAVE');
  expect(off.defines?.DICER_ENGRAVE).toBeUndefined();
  // numbers are still drawn: the colour mask is in the program either way
  expect(patched(off).fragmentShader).toContain('dcMask = smoothstep');
});

test('flags default to everything on, and partial flags merge over the defaults', () => {
  const a = look({ body: { type: 'resin' } });
  const def = createDiceMaterial(a, atlas, s, labels);
  expect(def.userData.programKey).toBe(programKey(a, FLAGS));
  const part = createDiceMaterial(a, atlas, s, labels, { interiorSteps: 16 });
  expect(part.userData.programKey).toBe(programKey(a, { ...FLAGS, interiorSteps: 16 }));
});

test('body presets', () => {
  const o = createDiceMaterial(
    look({ body: { type: 'opaque', roughness: 0.42 } }),
    atlas,
    s,
    labels,
  );
  expect(o.roughness).toBeCloseTo(0.42);
  expect(o.clearcoat).toBeCloseTo(0.6);
  expect(o.metalness).toBe(0);
  expect(o.transmission).toBe(0);

  const m = createDiceMaterial(look({ body: { type: 'metal', color: '#c90' } }), atlas, s, labels);
  expect(m.metalness).toBe(1);
  expect(m.color.getHexString()).toBe(new THREE.Color('#c90').getHexString());

  const r = createDiceMaterial(
    look({ body: { type: 'resin', color: '#28f', roughness: 0.04 } }),
    atlas,
    s,
    labels,
  );
  expect(r.transmission).toBeCloseTo(0.9);
  expect(r.thickness).toBeCloseTo(1.2);
  expect(r.ior).toBeCloseTo(1.52);
  expect(r.attenuationDistance).toBeCloseTo(0.8);
  expect(r.clearcoat).toBe(1);
  expect(r.roughness).toBeCloseTo(0.04);
  expect(r.attenuationColor.getHexString()).toBe(new THREE.Color('#28f').getHexString());

  // Until Task 5: marble/pearl render as opaque, other metal finishes as polished metal.
  const marble = createDiceMaterial(LOOKS['marble-white'].appearance, atlas, s, labels);
  expect(marble.transmission).toBe(0);
  expect(marble.clearcoat).toBeCloseTo(0.6);
  const brushed = createDiceMaterial(LOOKS['silver-brushed'].appearance, atlas, s, labels);
  expect(brushed.metalness).toBe(1);
});

test('label texture has 4 texels per face and updates in place', () => {
  const m = createDiceMaterial(opaque(), atlas, s, labels);
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
    opaque({ numbers: { fill: 'gold', color: '#ffcc00', depth: 0.8 } }),
    atlas,
    s,
    labels,
  );
  const u = m.userData.uniforms;
  expect(u.uAtlas.value).toBe(atlas.texture);
  expect(u.uFillColor.value.getHexString()).toBe(new THREE.Color('#ffcc00').getHexString());
  expect(u.uEngrave.value).toBeCloseTo(0.8);
});

test('shader modules export the engraving GLSL and the noise library', () => {
  expect(ENGRAVE_PARS).toContain('float dcGlyph(');
  expect(ENGRAVE_COLOR).toContain('dcMask = smoothstep');
  expect(ENGRAVE_NORMAL).toContain('normal = normalize( normal + dcTilt )');
  expect(ENGRAVE_NORMAL).toMatch(/#ifdef DICER_ENGRAVE/);
  expect(ENGRAVE_COLOR).toMatch(/#ifdef DICER_ENGRAVE/);
  for (const sig of ['float dcHash13( vec3', 'float dcNoise3( vec3', 'float dcFbm3( vec3'])
    expect(NOISE_GLSL).toContain(sig);
});

test('onBeforeCompile patches the shaders with the face varyings and uniforms', () => {
  const m = createDiceMaterial(opaque(), atlas, s, labels);
  const shader = patched(m);
  expect(shader.vertexShader).toContain('aFaceId');
  expect(shader.vertexShader).toContain('vFaceUV');
  expect(shader.fragmentShader).toContain('uLabels');
  expect(shader.fragmentShader).toContain('uFillGloss');
  // every injection point exists in r184's physical shader
  for (const marker of [
    'dcMask = smoothstep',
    'roughnessFactor = mix',
    'metalnessFactor = mix',
    'normal = normalize( normal + dcTilt )',
    'clearcoatNormal = normal',
    'transmission * ( 1.0 - dcMask )',
    'uFillGloss * dcMask',
  ])
    expect(shader.fragmentShader).toContain(marker);
  expect(shader.vertexShader).toContain('vFaceId = aFaceId');
  expect(shader.uniforms.uAtlas).toBe(m.userData.uniforms.uAtlas);
});

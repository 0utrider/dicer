import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { createDiceMaterial, updateLabels, isolateMaterial } from '../../src/render/dice-material.js';
import { ENGRAVE_PARS, ENGRAVE_NORMAL, ENGRAVE_COLOR } from '../../src/render/shaders/engrave.js';
import { NOISE_GLSL } from '../../src/render/shaders/noise.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';
import { normalizeAppearance, programKey } from '../../src/look/appearance.js';
import { LOOKS } from '../../src/look/looks.js';
import { readableNumbers } from '../../src/look/contrast.js';

const atlas = {
  ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
  texture: new THREE.Texture(),
};
const s = getShape('d20');
const labels = s.values.map((v) => labelFor('d20', v));
const FLAGS = { interiors: true, engraving: true, glow: true, effects: true, interiorSteps: 32 };

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
  expect(m.transmission).toBe(0); // P2-R6: resin is environment refraction
  expect(m.defines).toHaveProperty('DICER_RESIN');
  expect(m.color.getHexString()).toBe(new THREE.Color('#28f').getHexString());
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
  expect(r.transmission).toBe(0);
  expect(r.ior).toBeCloseTo(1.52);
  expect(r.clearcoat).toBe(1);
  expect(r.roughness).toBeCloseTo(0.04);
  expect(r.opacity).toBe(1);
  expect(r.transparent).toBe(false);
  expect(r.color.getHexString()).toBe(new THREE.Color('#28f').getHexString());
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
  // gold on a white body does not read, so the fill is the readable one, not the raw colour
  const want = readableNumbers(opaque({ numbers: { fill: 'gold', color: '#ffcc00', depth: 0.8 } }));
  expect(u.uFillColor.value.getHexString()).toBe(new THREE.Color(want.fill).getHexString());
  expect(want.fill).not.toBe('#ffcc00');
  expect(u.uGlowIntensity.value).toBeCloseTo(want.glow);
  expect(u.uEngrave.value).toBeCloseTo(0.8);
});

test('numbers that already read keep their exact colour', () => {
  const m = createDiceMaterial(
    look({ body: { type: 'opaque', color: '#101830' }, numbers: { fill: 'gold', color: '#ffcc00' } }),
    atlas,
    s,
    labels,
  );
  expect(m.userData.uniforms.uFillColor.value.getHexString()).toBe(new THREE.Color('#ffcc00').getHexString());
});

// A glowing resin inside (Ember Core) washed the numbers out: a thin dark ink rim just outside each
// glyph (from the glyph's signed distance, inside its rect only) darkens the refracted body there.
test('numbers get an ink rim on resin: defined from the glyph distance, applied to the refracted body', async () => {
  const { RIM_WIDTH, RIM_DARK } = await import('../../src/render/shaders/engrave.js');
  const { RESIN_REFRACTION } = await import('../../src/render/shaders/bodies.js');
  expect(RIM_WIDTH).toBeGreaterThan(0);
  expect(RIM_DARK).toBeGreaterThan(0);
  expect(RIM_DARK).toBeLessThan(1);
  expect(ENGRAVE_COLOR).toMatch(/float dcRim = \( 1\.0 - dcMask \) \* smoothstep\(/);
  expect(RESIN_REFRACTION).toMatch(/dcRefracted \* \( 1\.0 - [0-9.]+ \* dcRim \)/);
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
    'uFillGloss * dcMask',
  ])
    expect(shader.fragmentShader).toContain(marker);
  expect(shader.vertexShader).toContain('vFaceId = aFaceId');
  expect(shader.uniforms.uAtlas).toBe(m.userData.uniforms.uAtlas);
});

// ---- Task 5: bodies and finishes -------------------------------------------------------

const BODY_DEFINES = [
  'DICER_RESIN',
  'DICER_MARBLE',
  'DICER_PEARL',
  'DICER_BRUSHED',
  'DICER_ANTIQUE',
  'DICER_BORDER',
  'DICER_GLOW',
];
const definesOf = (m) => BODY_DEFINES.filter((d) => d in m.defines).sort();
const make = (partial, flags = FLAGS) => createDiceMaterial(look(partial), atlas, s, labels, flags);
const metal = (finish, extra = {}) =>
  make({ body: { type: 'metal', color: '#c0c0c0', color2: '#404040', finish }, ...extra });

const CASES = {
  opaque: [() => make({ body: { type: 'opaque' } }), []],
  resin: [() => make({ body: { type: 'resin' } }), ['DICER_RESIN']],
  marble: [() => make({ body: { type: 'marble' } }), ['DICER_MARBLE']],
  pearl: [() => make({ body: { type: 'pearl' } }), ['DICER_PEARL']],
  polished: [() => metal('polished'), ['DICER_BORDER']],
  brushed: [() => metal('brushed'), ['DICER_BORDER', 'DICER_BRUSHED']],
  antique: [() => metal('antique'), ['DICER_ANTIQUE', 'DICER_BORDER']],
};

test.each(Object.keys(CASES))('%s: body defines', (name) => {
  const [build, defines] = CASES[name];
  expect(definesOf(build())).toEqual(defines.slice().sort());
});

test.each(Object.keys(CASES))(
  '%s: anisotropy only on brushed, iridescence only on pearl',
  (name) => {
    const m = CASES[name][0]();
    if (name === 'brushed') expect(m.anisotropy).toBeCloseTo(0.8);
    else expect(m.anisotropy).toBe(0);
    if (name === 'pearl') expect(m.iridescence).toBe(1);
    else expect(m.iridescence).toBe(0);
    if (name === 'marble' || name === 'pearl') expect(m.sheen).toBeGreaterThan(0);
    else expect(m.sheen).toBe(0);
    expect(m.transmission).toBe(0);
  },
);

test('marble preset: sheen 0.4 in the body colour, body roughness, vein scale uniform 1.6', () => {
  const m = make({ body: { type: 'marble', color: '#f1efe9', color2: '#8d8a84', roughness: 0.3 } });
  expect(m.sheen).toBeCloseTo(0.4);
  expect(m.sheenColor.getHexString()).toBe(new THREE.Color('#f1efe9').getHexString());
  expect(m.roughness).toBeCloseTo(0.3);
  expect(m.metalness).toBe(0);
  expect(m.userData.uniforms.uVeinScale.value).toBeCloseTo(1.6);
  expect(m.userData.uniforms.uBodyColor2.value.getHexString()).toBe(
    new THREE.Color('#8d8a84').getHexString(),
  );
});

test('pearl preset: iridescence, sheen in color2, body roughness, clearcoat 1', () => {
  const m = make({ body: { type: 'pearl', color: '#e9e4f4', color2: '#a9c8f0', roughness: 0.25 } });
  expect(m.iridescence).toBe(1);
  expect(m.iridescenceIOR).toBeCloseTo(1.3);
  expect(m.iridescenceThicknessRange).toEqual([250, 650]);
  expect(m.sheen).toBeCloseTo(0.6);
  expect(m.sheenColor.getHexString()).toBe(new THREE.Color('#a9c8f0').getHexString());
  expect(m.roughness).toBeCloseTo(0.25);
  expect(m.clearcoat).toBe(1);
});

test('metal finishes: the body roughness, metalness 1, the enamel coat is kept', () => {
  expect(
    metal('polished', { body: { type: 'metal', finish: 'polished', roughness: 0.18 } }).roughness,
  ).toBeCloseTo(0.18);
  for (const f of ['polished', 'brushed', 'antique']) {
    expect(metal(f).metalness).toBe(1);
    expect(metal(f).clearcoat).toBeCloseTo(0.001);
  }
});

test('glow: define only when the flag is on and intensity > 0; colour x intensity uniforms', () => {
  const g = { glow: { color: '#ff7a1a', intensity: 0.6 } };
  const on = make({ body: { type: 'opaque' }, ...g });
  expect(on.defines).toHaveProperty('DICER_GLOW');
  expect(on.userData.uniforms.uGlowColor.value.getHexString()).toBe(
    new THREE.Color('#ff7a1a').getHexString(),
  );
  expect(on.userData.uniforms.uGlowIntensity.value).toBeCloseTo(0.6);
  expect(patched(on).fragmentShader).toContain('totalEmissiveRadiance += uGlowColor');
  const zero = make({ body: { type: 'opaque' }, glow: { color: '#ff7a1a', intensity: 0 } });
  expect(zero.defines.DICER_GLOW).toBeUndefined();
  const off = make({ body: { type: 'opaque' }, ...g }, { ...FLAGS, glow: false });
  expect(off.defines.DICER_GLOW).toBeUndefined();
  expect(off.customProgramCacheKey()).not.toBe(on.customProgramCacheKey());
});

test('marble and pearl program keys differ from opaque (and from each other)', () => {
  const keys = ['opaque', 'marble', 'pearl'].map((t) =>
    make({ body: { type: t } }).customProgramCacheKey(),
  );
  expect(new Set(keys).size).toBe(3);
});

test('dcFbm3 is injected only for marble, antique and marched resin interiors', () => {
  for (const name of Object.keys(CASES)) {
    const src = patched(CASES[name][0]()).fragmentShader;
    // the resin case is the default appearance: a nebula interior, marched at 32 steps
    if (name === 'marble' || name === 'antique' || name === 'resin')
      expect(src).toContain('dcFbm3');
    else expect(src).not.toContain('dcFbm3');
  }
  const clear = make({ body: { type: 'resin' }, interior: { type: 'none' } });
  expect(patched(clear).fragmentShader).not.toContain('dcFbm3');
});

test('body shader code lands at its anchors', () => {
  const src = (name) => patched(CASES[name][0]());
  expect(src('marble').fragmentShader).toContain('uVeinScale');
  expect(src('pearl').fragmentShader).toContain('uBodyColor2');
  const brushed = src('brushed').fragmentShader;
  expect(brushed).toMatch(/tbn = mat3\( dcAnisoT/);
  // the tangent frame override follows three's own tbn (normal_fragment_begin)
  expect(brushed.indexOf('dcAnisoT')).toBeGreaterThan(brushed.indexOf('vec3 nonPerturbedNormal'));
  expect(src('polished').fragmentShader).toContain('dcBorderSlope');
  expect(src('polished').vertexShader).toContain('vEdgeDist = aEdgeDist');
  expect(src('antique').fragmentShader).toContain('dcCav');
});

test('resin: environment refraction, no transmission pass', () => {
  const m = make({ body: { type: 'resin', color: '#28f' } });
  expect(m.transmission).toBe(0);
  expect(m.defines).toHaveProperty('DICER_RESIN');
  expect(m.userData.uniforms.uResinDensity.value).toBeCloseTo(1.0);
  const sh = patched(m);
  const fs = sh.fragmentShader;
  const block = fs.slice(fs.indexOf('#ifdef DICER_RESIN'));
  expect(block).toContain('textureCubeUV( envMap');
  expect(block).toContain('refract(');
  expect(block).toContain('uResinDensity');
  // the refracted base goes behind the specular/clearcoat terms
  const at = fs.indexOf('totalDiffuse = mix( totalDiffuse, dcRefracted');
  expect(at).toBeGreaterThan(fs.indexOf('vec3 totalSpecular'));
  expect(at).toBeLessThan(fs.indexOf('vec3 outgoingLight'));
  expect(sh.vertexShader).toContain('vLocalPos');
  expect(sh.vertexShader).toContain('vLocalCam');
  expect(sh.uniforms.uResinDensity).toBe(m.userData.uniforms.uResinDensity);
});

test('resin program key has no colour in it', () => {
  const a = make({ body: { type: 'resin', color: '#ff0000', color2: '#00ff00' } });
  const b = make({ body: { type: 'resin', color: '#0000ff', color2: '#ffffff' } });
  expect(a.userData.programKey).toBe(b.userData.programKey);
  expect(a.userData.programKey).not.toMatch(/#|[0-9a-f]{6}/);
  expect(a.userData.programKey.split('|')[0]).toBe('resin');
});

test('every chunk anchor the material patches exists in r184 (a three upgrade fails loudly)', () => {
  const anchors = {
    vertex: ['common', 'begin_vertex'],
    fragment: [
      'common',
      'color_fragment',
      'roughnessmap_fragment',
      'metalnessmap_fragment',
      'normal_fragment_begin',
      'normal_fragment_maps',
      'clearcoat_normal_fragment_begin',
      'emissivemap_fragment',
      'lights_physical_fragment',
      'transmission_fragment',
    ],
  };
  const lib = THREE.ShaderLib.physical;
  for (const a of anchors.vertex) expect(lib.vertexShader).toContain(`#include <${a}>`);
  for (const a of anchors.fragment) expect(lib.fragmentShader).toContain(`#include <${a}>`);
  // the brushed tangent override reassigns three's tbn; the resin block reads these
  expect(THREE.ShaderChunk.normal_fragment_begin).toContain('mat3 tbn');
  expect(THREE.ShaderChunk.lights_physical_fragment).toContain('material.anisotropyT = tbn[ 0 ]');
  expect(THREE.ShaderChunk.lights_fragment_begin).toContain('vec3 geometryViewDir');
  expect(THREE.ShaderChunk.cube_uv_reflection_fragment).toContain(
    'vec4 textureCubeUV( sampler2D envMap',
  );
  expect(THREE.ShaderChunk.envmap_common_pars_fragment).toContain('uniform mat3 envMapRotation');
  // every program gets the shared varyings
  const sh = patched(createDiceMaterial(opaque(), atlas, s, labels));
  expect(sh.vertexShader).toContain('vLocalPos = transformed');
  expect(sh.fragmentShader).toContain('varying float vEdgeDist');
});

// ---- Task 6: ray-marched interiors -----------------------------------------------------

const nebula = (extra = {}) => ({
  body: { type: 'resin', color: '#1f5fd1' },
  interior: { type: 'nebula', colors: ['#8a4dff', '#22d3ee'], density: 0.6 },
  ...extra,
});

test('interior: steps are part of the program key and the DICER_STEPS define', () => {
  const a = make(nebula(), { ...FLAGS, interiorSteps: 32 });
  const b = make(nebula(), { ...FLAGS, interiorSteps: 16 });
  expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
  expect(a.defines.DICER_STEPS).toBe(32);
  expect(b.defines.DICER_STEPS).toBe(16);
  expect(a.defines).toHaveProperty('DICER_INTERIOR');
  const fs = patched(a).fragmentShader;
  expect(fs).toContain('vec4 dcInterior( vec3 p');
});

test('interior: interiors off gives the same key and defines as a plain resin', () => {
  const off = make(nebula(), { ...FLAGS, interiors: false });
  const none = make(nebula({ interior: { type: 'none' } }));
  expect(off.customProgramCacheKey()).toBe(none.customProgramCacheKey());
  expect(off.defines).toEqual(none.defines);
  expect(off.defines.DICER_STEPS).toBeUndefined();
  expect(patched(off).fragmentShader).not.toContain('dcInterior');
  expect(off.userData.uniforms.uResinTint.value.w).toBe(0);
});

test('interior: steps 0 has no march and tints the resin towards colors[0] (low-tier fake)', () => {
  const m = make(nebula(), { ...FLAGS, interiorSteps: 0 });
  expect(m.defines.DICER_STEPS).toBeUndefined();
  expect(m.defines.DICER_INTERIOR).toBeUndefined();
  expect(patched(m).fragmentShader).not.toContain('dcInterior');
  const t = m.userData.uniforms.uResinTint.value;
  expect(t.w).toBeGreaterThan(0);
  const tint = new THREE.Color(t.x, t.y, t.z);
  // colors[0]'s hue at the body's luminance (see the Void Star test below)
  const c0 = new THREE.Color('#8a4dff');
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  expect(tint.r / tint.b).toBeCloseTo(c0.r / c0.b);
  expect(lum(tint)).toBeCloseTo(lum(new THREE.Color('#1f5fd1')));
  const tinted = new THREE.Color('#1f5fd1').lerp(tint, t.w);
  expect(tinted.getHexString()).not.toBe(m.color.getHexString());
  // the Beer-Lambert colour reads the tint
  expect(patched(m).fragmentShader).toMatch(/mix\( diffuse, uResinTint\.rgb, uResinTint\.a \)/);
  // marched and interior-less resins are untinted
  expect(make(nebula()).userData.uniforms.uResinTint.value.w).toBe(0);
  expect(make(nebula({ interior: { type: 'none' } })).userData.uniforms.uResinTint.value.w).toBe(0);
});

test('interior: a non-resin body never gets interior defines', () => {
  for (const type of ['opaque', 'metal', 'marble', 'pearl']) {
    const m = make({ body: { type }, interior: { type: 'nebula' } });
    expect(m.defines.DICER_STEPS).toBeUndefined();
    expect(m.defines.DICER_INTERIOR).toBeUndefined();
    expect(patched(m).fragmentShader).not.toContain('dcInterior');
  }
});

test('interior: uniforms (colours, density, key light) and per-shape programs', () => {
  const m = make(nebula());
  const u = m.userData.uniforms;
  expect(u.uInteriorColors.value[0].getHexString()).toBe(new THREE.Color('#8a4dff').getHexString());
  expect(u.uInteriorColors.value[1].getHexString()).toBe(new THREE.Color('#22d3ee').getHexString());
  expect(u.uInteriorDensity.value).toBeCloseTo(0.6);
  const k = u.uKeyLightDir.value;
  expect(k.length()).toBeCloseTo(1);
  const expected = new THREE.Vector3(-6, 4, 2).normalize();
  expect(k.distanceTo(expected)).toBeLessThan(1e-6);
  const star = make({ body: { type: 'resin' }, interior: { type: 'shape', shape: 'star' } });
  const heart = make({ body: { type: 'resin' }, interior: { type: 'shape', shape: 'heart' } });
  expect(star.customProgramCacheKey()).not.toBe(heart.customProgramCacheKey());
  expect(patched(heart).fragmentShader).toContain('dcSdHeart');
});

test('interior: composites into the refracted colour, before the number mask', () => {
  const fs = patched(make(nebula())).fragmentShader;
  const march = fs.indexOf('dcInterior( dcIp');
  expect(march).toBeGreaterThan(fs.indexOf('dcRefracted = ( 1.0 - dcRF )'));
  expect(march).toBeLessThan(fs.indexOf('totalDiffuse = mix( totalDiffuse, dcRefracted'));
  expect(fs).toContain('dcRefracted = dcRefracted * ( 1.0 - dcIacc.a ) + dcIacc.rgb');
});

test('interior: the coin lays the shape flat in its caps (uShapeRot), dice keep the tilt', () => {
  const star = { body: { type: 'resin' }, interior: { type: 'shape', shape: 'star' } };
  const coin = getShape('d2');
  const c = createDiceMaterial(look(star), atlas, coin, ['1', '2'], FLAGS);
  const d = make(star);
  const rc = c.userData.uniforms.uShapeRot.value;
  const rd = d.userData.uniforms.uShapeRot.value;
  expect(rc.equals(rd)).toBe(false);
  // the shape's flat axis (z in SDF space) is the coin's thin axis: R * y = z
  const v = new THREE.Vector3(0, 1, 0).applyMatrix3(rc);
  expect(v.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-6);
  // orientation is a uniform: coin and die share the program
  expect(c.customProgramCacheKey()).toBe(d.customProgramCacheKey());
});

// ---- Task 9: tuning-list fixes ---------------------------------------------------------

test('P2-R8: body.roughness is honoured for every body type and metal finish', () => {
  const bodies = [
    { type: 'opaque' },
    { type: 'resin' },
    { type: 'marble' },
    { type: 'pearl' },
    { type: 'metal', finish: 'polished' },
    { type: 'metal', finish: 'brushed' },
    { type: 'metal', finish: 'antique' },
  ];
  for (const b of bodies) {
    for (const r of [0.13, 0.62]) {
      expect(make({ body: { ...b, roughness: r } }).roughness).toBeCloseTo(r);
    }
  }
});

test('resin: entry Fresnel scales the refracted base (and the interior) by 1 - F_schlick', () => {
  const fs = patched(make(nebula())).fragmentShader;
  expect(fs).toMatch(/float dcRFin = [^;]*pow\( 1\.0 - [^;]*dcRn[^;]*5\.0 \)/);
  const scale = fs.indexOf('dcRefracted *= 1.0 - dcRFin');
  expect(scale).toBeGreaterThan(fs.indexOf('dcRefracted = dcRefracted * ( 1.0 - dcIacc.a )'));
  expect(scale).toBeLessThan(fs.indexOf('totalDiffuse = mix( totalDiffuse, dcRefracted'));
  // a clear resin without an interior gets it too
  const clear = patched(
    make({ body: { type: 'resin' }, interior: { type: 'none' } }),
  ).fragmentShader;
  expect(clear).toContain('dcRefracted *= 1.0 - dcRFin');
});

test('resin: bevels (aFaceId < 0) are rougher, so the rounded edge does not mirror a strip light', () => {
  const fs = patched(make({ body: { type: 'resin' } })).fragmentShader;
  expect(fs).toMatch(/vFaceId < - 0\.5 \) roughnessFactor = max\( roughnessFactor, [\d.]+ \)/);
  expect(patched(make({ body: { type: 'opaque' } })).fragmentShader).not.toMatch(
    /roughnessFactor = max\( roughnessFactor/,
  );
});

test('low-tier interior tint is per type: glitter 0.1, shape 0.2, nebula/liquid/swirl 0.45', () => {
  const expected = { glitter: 0.1, shape: 0.2, nebula: 0.45, liquid: 0.45, swirl: 0.45 };
  for (const [type, share] of Object.entries(expected)) {
    const m = make(nebula({ interior: { type, colors: ['#8a4dff', '#22d3ee'] } }), {
      ...FLAGS,
      interiorSteps: 0,
    });
    expect(m.userData.uniforms.uResinTint.value.w).toBeCloseTo(share);
  }
});

test('resin coin: a per-shape density boost (uniform), dice keep density 1', () => {
  const a = look({ body: { type: 'resin', color: '#1f5fd1' }, interior: { type: 'none' } });
  const coin = createDiceMaterial(a, atlas, getShape('d2'), ['1', '2'], FLAGS);
  const die = createDiceMaterial(a, atlas, s, labels, FLAGS);
  expect(die.userData.uniforms.uResinDensity.value).toBeCloseTo(1);
  expect(coin.userData.uniforms.uResinDensity.value).toBeGreaterThan(2);
  expect(coin.customProgramCacheKey()).toBe(die.customProgramCacheKey());
});

test('interior: the inner light reuses the up-facing environment sample of the floor term', () => {
  const fs = patched(make(nebula())).fragmentShader;
  expect(fs).toContain('dcILight = dcRup * envMapIntensity');
  const ups = fs.match(/textureCubeUV\( envMap, envMapRotation \* vec3\( 0\.0, 1\.0, 0\.0 \)/g);
  expect(ups).toHaveLength(1);
});

test('resin and pearl bevels also get a rougher clearcoat (the lobe that drew the white bar)', () => {
  for (const type of ['resin', 'pearl']) {
    const fs = patched(make({ body: { type } })).fragmentShader;
    const at = fs.search(
      /vFaceId < - 0\.5 \) material\.clearcoatRoughness = max\( material\.clearcoatRoughness, [\d.]+ \)/,
    );
    expect(at).toBeGreaterThan(
      fs.indexOf('material.clearcoat = max( material.clearcoat, uFillGloss'),
    );
  }
  for (const type of ['opaque', 'marble', 'metal'])
    expect(patched(make({ body: { type } })).fragmentShader).not.toContain(
      'material.clearcoatRoughness = max(',
    );
});

test('low-tier tint keeps the body luminance: a near-black Void Star with a gold star stays dark, not olive', () => {
  const m = make(
    {
      body: { type: 'resin', color: '#08080f' },
      interior: { type: 'shape', colors: ['#ffe27a', '#ff9d2e'], shape: 'star' },
    },
    { ...FLAGS, interiorSteps: 0 },
  );
  const t = m.userData.uniforms.uResinTint.value;
  const body = new THREE.Color('#08080f');
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  expect(lum(t.x, t.y, t.z)).toBeCloseTo(lum(body.r, body.g, body.b), 4);
  // the tinted Beer-Lambert colour stays within a hair of the body
  const mixed = body.clone().lerp(new THREE.Color(t.x, t.y, t.z), t.w);
  expect(Math.max(mixed.r, mixed.g, mixed.b)).toBeLessThan(0.01);
});

describe('P2-R12 safe flags', () => {
  const SAFE = { ...FLAGS, safe: true };
  const bodies = [
    look({ body: { type: 'resin' }, interior: { type: 'nebula' }, glow: { intensity: 1 } }),
    look({ body: { type: 'metal', finish: 'brushed' } }),
    look({ body: { type: 'metal', finish: 'antique' } }),
    look({ body: { type: 'marble' } }),
    look({ body: { type: 'pearl' } }),
    opaque(),
  ];

  test('every body becomes plain opaque physical: no DICER_* define, no body chunk, one program', () => {
    const keys = new Set();
    for (const a of bodies) {
      const m = createDiceMaterial(a, atlas, s, labels, SAFE);
      expect(Object.keys(m.defines).filter((k) => k.startsWith('DICER_'))).toEqual([]);
      const fs = patched(m).fragmentShader;
      for (const marker of ['dcRefracted', 'dcBorderSlope', 'dcMw', 'dcFilm', 'dcBrush', 'dcGrime', 'dcIVolume'])
        expect(fs).not.toContain(marker);
      expect(m.metalness).toBe(0);
      expect(m.transmission).toBe(0);
      expect(m.iridescence).toBe(0);
      expect(m.sheen).toBe(0);
      expect(m.anisotropy).toBe(0);
      expect(m.color.getHexString()).toBe(a.body.color.slice(1));
      keys.add(m.customProgramCacheKey());
    }
    expect(keys.size).toBe(1);
  });

  test('the numbers stay readable (label colour mask), without the recess', () => {
    const m = createDiceMaterial(bodies[0], atlas, s, labels, SAFE);
    const fs = patched(m).fragmentShader;
    expect(fs).toContain('dcMask');
    expect(m.defines.DICER_ENGRAVE).toBeUndefined();
  });
});

test('resin exit Fresnel clamps its cosine to [0, 1] before pow (no NaN sparkles)', () => {
  const m = createDiceMaterial(look({ body: { type: 'resin' } }), atlas, s, labels, FLAGS);
  const fs = patched(m).fragmentShader;
  expect(fs).toContain('float dcRcos = clamp( abs( dot( dcRout, dcRne ) ), 0.0, 1.0 );');
  expect(fs).toMatch(/pow\( 1\.0 - dcRcos, 5\.0 \)/);
});

describe('face layers (image and text faces)', () => {
  const d6 = getShape('d6');
  const d6Labels = d6.values.map((v) => labelFor('d6', v));
  const faceTex = () => ({
    texture: new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4 * 2), 4, 4, 2),
    layers: Int16Array.from([-1, 0, -1, 1, -1, -1]),
    tint: Uint8Array.from([0, 0, 0, 1, 0, 0]),
  });

  test('without layers the program is exactly the one used today', () => {
    const a = opaque();
    const plain = createDiceMaterial(a, atlas, d6, d6Labels, FLAGS);
    const none = createDiceMaterial(a, atlas, d6, d6Labels, FLAGS, {
      texture: null,
      layers: new Int16Array(6).fill(-1),
    });
    for (const m of [plain, none]) {
      expect(m.customProgramCacheKey()).toBe('dicer-' + programKey(a, FLAGS));
      expect(m.defines.DICER_FACE_LAYERS).toBeUndefined();
      expect(m.userData.uniforms.uFaceTex).toBeUndefined();
    }
    expect(patched(none).fragmentShader).toBe(patched(plain).fragmentShader);
    expect(patched(plain).fragmentShader).not.toContain('uFaceLayer');
  });

  test('layers add DICER_FACE_LAYERS and the |fl1 cache-key suffix only', () => {
    const a = opaque();
    const m = createDiceMaterial(a, atlas, d6, d6Labels, FLAGS, faceTex());
    expect(m.customProgramCacheKey()).toBe('dicer-' + programKey(a, FLAGS) + '|fl1');
    expect(m.userData.programKey).toBe(programKey(a, FLAGS) + '|fl1');
    expect(m.defines).toHaveProperty('DICER_FACE_LAYERS');
    const fs = patched(m).fragmentShader;
    expect(fs).toContain('uniform vec2 uFaceLayer[');
    expect(fs).toContain('sampler2DArray uFaceTex');
  });

  test('an image decal stays opaque on a resin body (layered programs only)', () => {
    const resin = look({ body: { type: 'resin' } });
    const layered = patched(createDiceMaterial(resin, atlas, d6, d6Labels, FLAGS, faceTex()));
    const plain = patched(createDiceMaterial(resin, atlas, d6, d6Labels, FLAGS));
    expect(layered.fragmentShader).toContain('1.0 - max( dcMask, dcDecal ) )');
    expect(plain.fragmentShader).not.toContain('dcDecal');
    expect(plain.fragmentShader).toContain('* dcRim ), 1.0 - dcMask );');
  });

  test('uFaceLayer holds the layer and the text tint per face', () => {
    const tex = faceTex();
    const m = createDiceMaterial(opaque(), atlas, d6, d6Labels, FLAGS, tex);
    const u = m.userData.uniforms;
    expect(u.uFaceTex.value).toBe(tex.texture);
    const v = u.uFaceLayer.value;
    expect(v[1].toArray()).toEqual([0, 0]);
    expect(v[3].toArray()).toEqual([1, 1]);
    expect(v[0].x).toBe(-1);
    expect(v[19].x).toBe(-1); // unused slots draw nothing
  });
});

describe('fx uniform block (Plan 4 Task 8)', () => {
  const build = (flags) => createDiceMaterial(opaque(), atlas, s, labels, flags);
  test('flags.effects false: no fx GLSL and key segment fx0', () => {
    const m = build({ ...FLAGS, effects: false });
    expect(m.userData.programKey.split('|')).toContain('fx0');
    expect(patched(m).fragmentShader).not.toContain('uFxTint');
    expect(patched(m).fragmentShader).not.toContain('uFxFlare');
  });
  test('flags.effects true: uFxTint / uFxFlare in the shader, key fx1, defaults zero', () => {
    const m = build({ ...FLAGS, effects: true });
    expect(m.userData.programKey.split('|')).toContain('fx1');
    const sh = patched(m);
    expect(sh.fragmentShader).toContain('uniform vec4 uFxTint');
    expect(sh.fragmentShader).toContain('uniform vec3 uFxFlare');
    expect(sh.fragmentShader).toMatch(/uFxFlare \* dcMask/);
    const u = m.userData.uniforms;
    expect(u.uFxTint.value.toArray()).toEqual([0, 0, 0, 0]);
    expect(u.uFxFlare.value.toArray()).toEqual([0, 0, 0]);
    expect(sh.uniforms.uFxTint).toBe(u.uFxTint);
    expect(build({ ...FLAGS, effects: false }).customProgramCacheKey()).not.toBe(
      m.customProgramCacheKey(),
    );
  });
  test('safe flags drop the fx block', () => {
    const m = build({ ...FLAGS, effects: true, safe: true });
    expect(m.userData.programKey.split('|')).toContain('fx0');
    expect(patched(m).fragmentShader).not.toContain('uFxTint');
  });
  test('isolateMaterial: own uniform copies, shared textures, same program, original untouched', () => {
    const m = build({ ...FLAGS, effects: true });
    const iso = isolateMaterial(m);
    expect(iso).not.toBe(m);
    const a = m.userData.uniforms;
    const b = iso.userData.uniforms;
    expect(b).not.toBe(a);
    expect(b.uFxTint).not.toBe(a.uFxTint);
    expect(b.uFxTint.value).not.toBe(a.uFxTint.value);
    expect(b.uGlowColor.value).not.toBe(a.uGlowColor.value);
    expect(b.uGlowColor.value.equals(a.uGlowColor.value)).toBe(true);
    expect(b.uLabels.value).toBe(a.uLabels.value); // textures are shared, never copied
    expect(b.uAtlas.value).toBe(a.uAtlas.value);
    b.uFxTint.value.set(1, 0, 0, 1);
    expect(a.uFxTint.value.w).toBe(0);
    expect(iso.customProgramCacheKey()).toBe(m.customProgramCacheKey());
    expect(iso.defines).toEqual(m.defines);
    expect(iso.defines).not.toBe(m.defines);
    expect(iso.userData.programKey).toBe(m.userData.programKey);
    // its compile patch binds its own uniforms, the original keeps its own
    expect(patched(iso).uniforms.uFxTint).toBe(b.uFxTint);
    expect(patched(m).uniforms.uFxTint).toBe(a.uFxTint);
    expect(m.userData.uniforms).toBe(a);
  });
});

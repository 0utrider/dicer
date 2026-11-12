import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { _setLookExtrasImport, requestLookExtras } from '../../src/render/extras-loader.js';
import { createDiceMaterial } from '../../src/render/dice-material.js';
import { ENGRAVE_COLOR, RIM_WIDTH } from '../../src/render/shaders/engrave.js';
import { RAISED_REPLACE } from '../../src/render/extras/relief.js';
import { OUTLINE_WIDTH, GLOW_INK } from '../../src/render/extras/fills.js';
import { stripGlslParts } from '../../build/glsl-minify-plugin.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';
import { normalizeAppearance, programKey } from '../../src/look/appearance.js';

const atlas = {
  ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
  texture: new THREE.Texture(),
};
const s = getShape('d20');
const labels = s.values.map((v) => labelFor('d20', v));
const FLAGS = { interiors: true, engraving: true, glow: true, effects: true, interiorSteps: 32 };
const look = (partial) => normalizeAppearance(partial);
const count = (text, part) => text.split(part).length - 1;

function patched(material) {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader);
  return shader;
}

beforeAll(async () => {
  _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
  await requestLookExtras();
});
afterAll(() => _setLookExtrasImport(() => new Promise(() => {})));

const engraved = () => createDiceMaterial(look({ body: { type: 'metal' } }), atlas, s, labels, FLAGS);
const raised = () =>
  createDiceMaterial(
    look({ body: { type: 'metal' }, numbers: { relief: 'raised' } }),
    atlas,
    s,
    labels,
    FLAGS,
  );

describe('raised relief', () => {
  test('every RAISED_REPLACE line occurs exactly once in the assembled fragment shader and survives GLSL stripping', () => {
    const fs = patched(engraved()).fragmentShader;
    const stripped = stripGlslParts([ENGRAVE_COLOR]).join('');
    expect(RAISED_REPLACE).toHaveLength(3);
    for (const [from] of RAISED_REPLACE) {
      expect(count(fs, from)).toBe(1);
      expect(stripped).toContain(from);
    }
  });

  test('raised: each line is replaced once, the program key ends n:<fill>+r', () => {
    const m = raised();
    const fs = patched(m).fragmentShader;
    for (const [from, to] of RAISED_REPLACE) {
      expect(count(fs, from)).toBe(0);
      expect(count(fs, to)).toBe(1);
    }
    expect(m.userData.programKey).toMatch(/\|n:gold\+r$/);
    expect(m.userData.programKey).toBe(programKey(look({ body: { type: 'metal' }, numbers: { relief: 'raised' } }), FLAGS));
  });

  test("engraved adds no replacement and keeps today's shader", () => {
    const fs = patched(engraved()).fragmentShader;
    for (const [, to] of RAISED_REPLACE) expect(count(fs, to)).toBe(0);
    expect(engraved().userData.programKey).not.toContain('|n:');
  });
});

const fillLook = (fill, extra = {}) => look({ numbers: { fill, ...extra } });
const fillMat = (fill, extra, body = { type: 'opaque' }) =>
  createDiceMaterial({ ...fillLook(fill, extra), body: { ...look({ body }).body } }, atlas, s, labels, FLAGS);
const uniformsOf = (m) => m.userData.uniforms;

describe('new number fills', () => {
  test('outline replaces the mask line once with a rim of OUTLINE_WIDTH; the line survives GLSL stripping', () => {
    const W = OUTLINE_WIDTH.toFixed(4);
    const mask = 'float dcMask = smoothstep( - dcAA, dcAA, dcD );';
    const rimTo = `float dcMask = smoothstep( - dcAA, dcAA, dcD ) * ( 1.0 - smoothstep( ${W} - dcAA, ${W} + dcAA, dcD ) );`;
    const rim = `float dcRim = ( 1.0 - dcMask ) * smoothstep( ${(-RIM_WIDTH).toFixed(4)}, ${(-0.3 * RIM_WIDTH).toFixed(4)}, dcD );`;
    const stripped = stripGlslParts([ENGRAVE_COLOR]).join('');
    expect(stripped).toContain(mask);
    expect(stripped).toContain(rim);
    expect(count(patched(fillMat('paint')).fragmentShader, mask)).toBe(1);
    const fs = patched(fillMat('outline', {}, { type: 'resin' })).fragmentShader;
    expect(count(fs, mask)).toBe(0);
    expect(count(fs, rimTo)).toBe(1);
    expect(count(fs, rim)).toBe(0);
    expect(
      count(
        fs,
        `float dcRim = ( 1.0 - smoothstep( - dcAA, dcAA, dcD ) ) * smoothstep( ${(-RIM_WIDTH).toFixed(4)}, ${(-0.3 * RIM_WIDTH).toFixed(4)}, dcD );`,
      ),
    ).toBe(1);
    expect(uniformsOf(fillMat('outline')).uFillPBR.value.toArray()).toEqual([0, 0.6]);
  });

  test('holo: the rainbow lands after emissivemap_fragment; PBR (1, 0.2), no gloss', () => {
    const m = fillMat('holo');
    const fs = patched(m).fragmentShader;
    const at = fs.indexOf('vec3 dcHolo');
    expect(count(fs, 'vec3 dcHolo')).toBe(1);
    expect(at).toBeGreaterThan(fs.indexOf('totalEmissiveRadiance = emissive'));
    expect(at).toBeLessThan(fs.indexOf('#include <lights_physical_fragment>'));
    const u = uniformsOf(m);
    expect(u.uFillPBR.value.toArray()).toEqual([1, expect.closeTo(0.2)]);
    expect(u.uFillGloss.value).toBe(0);
  });

  test('glow: emissive fill colour x GLOW_INK x dcMask; paint PBR; body glow uniforms untouched', () => {
    const m = fillMat('glow');
    const fs = patched(m).fragmentShader;
    expect(count(fs, `totalEmissiveRadiance += uFillColor * ${GLOW_INK.toFixed(2)} * dcMask;`)).toBe(1);
    const u = uniformsOf(m);
    expect(u.uFillPBR.value.toArray()).toEqual([0, expect.closeTo(0.6)]);
    expect(u.uFillGloss.value).toBe(0);
    const base = uniformsOf(fillMat('paint'));
    expect(u.uGlowIntensity.value).toBe(base.uGlowIntensity.value);
    expect(u.uGlowColor.value.equals(base.uGlowColor.value)).toBe(true);
  });

  test('each new fill is its own program; paint, gold, silver and enamel still share today\'s program', () => {
    const key = (fill) => fillMat(fill).userData.programKey;
    const old = ['paint', 'gold', 'silver', 'enamel'].map(key);
    expect(new Set(old).size).toBe(1);
    expect(old[0]).not.toContain('n:');
    const nu = ['outline', 'holo', 'glow'].map(key);
    expect(new Set([...nu, old[0]]).size).toBe(4);
    for (const k of nu) expect(k).toContain('|n:');
  });

  test('outline with raised: all five replacements apply once each', () => {
    const m = fillMat('outline', { relief: 'raised' }, { type: 'resin' });
    const fs = patched(m).fragmentShader;
    let applied = 0;
    for (const [from, to] of [...RAISED_REPLACE]) {
      expect(count(fs, from)).toBe(0);
      expect(count(fs, to)).toBe(1);
      applied++;
    }
    expect(count(fs, 'float dcMask = smoothstep( - dcAA, dcAA, dcD ) * ( 1.0 - smoothstep(')).toBe(1);
    expect(count(fs, 'float dcRim = ( 1.0 - smoothstep( - dcAA, dcAA, dcD ) ) * smoothstep(')).toBe(1);
    expect(applied + 2).toBe(5);
  });
});

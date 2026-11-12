import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { _setLookExtrasImport, requestLookExtras } from '../../src/render/extras-loader.js';
import { createDiceMaterial } from '../../src/render/dice-material.js';
import { ENGRAVE_COLOR } from '../../src/render/shaders/engrave.js';
import { RAISED_REPLACE } from '../../src/render/extras/relief.js';
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

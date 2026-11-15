import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { _setLookExtrasImport, requestLookExtras } from '../../src/render/extras-loader.js';
import { createDiceMaterial } from '../../src/render/dice-material.js';
import { stripGlslParts } from '../../build/glsl-minify-plugin.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';
import { normalizeAppearance } from '../../src/look/appearance.js';
import { STRIP_PBR, edgePatch } from '../../src/render/extras/edges.js';

const atlas = {
  ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
  texture: new THREE.Texture(),
};
const s = getShape('d20');
const labels = s.values.map((v) => labelFor('d20', v));
const FLAGS = { interiors: true, engraving: true, glow: true, effects: true, interiorSteps: 32, insideMotion: false };
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

const mat = (strip, body = { type: 'opaque' }, radius = 0.5) =>
  createDiceMaterial(normalizeAppearance({ body, edges: { radius, strip } }), atlas, s, labels, FLAGS);

describe('edge strips', () => {
  test('inactive strip: no patch, no DICER_EDGE, shader identical to a plain look', () => {
    expect(edgePatch(normalizeAppearance({}))).toEqual({});
    expect(edgePatch({ numbers: {} })).toEqual({}); // partial look (extras-loader contract test)
    expect(edgePatch(normalizeAppearance({ edges: { radius: 0, strip: { style: 'paint' } } }))).toEqual({});
    const plain = patched(createDiceMaterial(normalizeAppearance({ body: { type: 'opaque' } }), atlas, s, labels, FLAGS)).fragmentShader;
    expect(patched(mat({ style: 'body' })).fragmentShader).toBe(plain);
  });

  test('radius 0 with a paint strip: same fragment shader and programKey as a radius-0 plain look', () => {
    const plain = createDiceMaterial(normalizeAppearance({ body: { type: 'opaque' }, edges: { radius: 0 } }), atlas, s, labels, FLAGS);
    const painted = mat({ style: 'paint', color: '#ff0000', strength: 1 }, { type: 'opaque' }, 0);
    expect(painted.defines.DICER_EDGE).toBeUndefined();
    expect(painted.userData.programKey).toBe(plain.userData.programKey);
    expect(patched(painted).fragmentShader).toBe(patched(plain).fragmentShader);
  });

  test.each(['paint', 'metal', 'glow'])('%s: define, uniforms, key part and both anchors patched once', (style) => {
    const m = mat({ style, color: '#ff0000', strength: 0.5 });
    expect(m.defines).toMatchObject({ DICER_EDGE: '', [`DICER_EDGE_${style.toUpperCase()}`]: '' });
    expect(m.userData.uniforms.uEdgeStrength.value).toBe(0.5);
    expect(m.userData.uniforms.uEdgeColor.value.getHexString()).toBe('ff0000');
    expect(m.userData.uniforms.uEdgePBR.value.toArray()).toEqual(STRIP_PBR[style]);
    expect(m.userData.programKey).toMatch(new RegExp(`\\|e:${style}$`));
    const fs = patched(m).fragmentShader;
    expect(count(fs, 'float dcEdge =')).toBe(1);
    expect(count(fs, 'metalnessFactor = mix( metalnessFactor, uEdgePBR.x, dcEdge );')).toBe(1);
    expect(count(fs, 'roughnessFactor = mix( roughnessFactor, uEdgePBR.y, dcEdge );')).toBe(1);
    expect(count(fs, 'vec3 dcEdgeLit = totalDiffuse;')).toBe(1);
    expect(count(fs, 'totalEmissiveRadiance += uEdgeColor * dcEdge;')).toBe(style === 'glow' ? 1 : 0);
    // dcEdge is declared (colour slot) before every use (PBR mix, emissive, lighting)
    const decl = fs.indexOf('float dcEdge =');
    expect(decl).toBeLessThan(fs.indexOf('uEdgePBR.x, dcEdge'));
    expect(decl).toBeLessThan(fs.indexOf('vec3 dcEdgeLit'));
  });

  test('resin: strip saved before refraction and restored after; refraction line untouched', () => {
    const fs = patched(mat({ style: 'paint' }, { type: 'resin' })).fragmentShader;
    expect(fs.indexOf('vec3 dcEdgeLit = totalDiffuse;')).toBeLessThan(fs.indexOf('totalDiffuse = mix( totalDiffuse, dcRefracted'));
    expect(fs.indexOf('totalDiffuse = mix( totalDiffuse, dcEdgeLit, dcEdge );')).toBeGreaterThan(fs.indexOf('totalDiffuse = mix( totalDiffuse, dcRefracted'));
  });

  test('resin with face layers: DECAL_OPAQUE refraction rewrite once, then the strip restore once', () => {
    const d6 = getShape('d6');
    const faceTex = {
      texture: new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4 * 2), 4, 4, 2),
      layers: Int16Array.from([-1, 0, -1, 1, -1, -1]),
      tint: Uint8Array.from([0, 0, 0, 1, 0, 0]),
    };
    const a = normalizeAppearance({ body: { type: 'resin' }, edges: { radius: 0.5, strip: { style: 'paint' } } });
    const m = createDiceMaterial(a, atlas, d6, d6.values.map((v) => labelFor('d6', v)), FLAGS, faceTex);
    expect(m.defines).toHaveProperty('DICER_FACE_LAYERS');
    expect(m.defines).toHaveProperty('DICER_EDGE');
    const fs = patched(m).fragmentShader;
    const decal = '1.0 - max( dcMask, dcDecal )';
    const restore = 'totalDiffuse = mix( totalDiffuse, dcEdgeLit, dcEdge );';
    expect(count(fs, decal)).toBe(1);
    expect(count(fs, restore)).toBe(1);
    expect(fs.indexOf(decal)).toBeLessThan(fs.indexOf(restore));
  });

  test('safe flags: fallback, no strip', () => {
    const m = createDiceMaterial(normalizeAppearance({ edges: { strip: { style: 'glow' } } }), atlas, s, labels, { ...FLAGS, safe: true });
    expect(m.defines.DICER_EDGE).toBeUndefined();
  });

  test('build stripping: replace anchors survive in three\'s stripped shader and the injected lines survive stripping', () => {
    const p = edgePatch(normalizeAppearance({ edges: { radius: 0.5, strip: { style: 'glow' } } }));
    const three = stripGlslParts([THREE.ShaderLib.physical.fragmentShader]).join('');
    for (const [from, to] of p.replace) {
      expect(count(three, from)).toBe(1);
      const out = stripGlslParts([to]).join('');
      expect(out).toContain(from); // the anchor is kept on its own line
      expect(out.split('\n').at(-1)).toBe(from);
    }
    for (const code of Object.values(p.chunks)) expect(stripGlslParts([code])).not.toBeNull();
    const lighting = stripGlslParts([p.chunks.lighting]).join('');
    expect(lighting).toContain('#ifdef DICER_RESIN\ntotalDiffuse = mix( totalDiffuse, dcEdgeLit, dcEdge );\n#endif');
  });
});

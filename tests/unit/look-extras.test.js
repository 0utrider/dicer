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
import { bodyPatch } from '../../src/render/extras/bodies/index.js';
import { PRESET_PARAMS, iridescentPatch } from '../../src/render/extras/bodies/iridescent.js';
import { PRESET_PARAMS as GEM_PARAMS, gemPatch } from '../../src/render/extras/bodies/gem.js';
import { PRESET_PARAMS as WOOD_PARAMS, woodPatch } from '../../src/render/extras/bodies/wood.js';
import { LUMINOUS_MAX, luminousPatch } from '../../src/render/extras/bodies/luminous.js';
import { LIP, metalFinishPatch } from '../../src/render/extras/bodies/metal-finishes.js';
import { BORDER, FX_COLOR } from '../../src/render/shaders/bodies.js';
import { mergePatches } from '../../src/render/extras/merge.js';
import * as lookExtras from '../../src/render/extras/look-extras.js';
import { insidePatch, INSIDE_TINT, marchWithUp, MODULES } from '../../src/render/extras/insides/index.js';
import { INTERIOR, INTERIOR_MARCH, INTERIOR_PARS, SHAPE_ROT, interiorChunk } from '../../src/render/shaders/interior.js';
import { MARCH_RADIUS, FOIL, FOIL_WALK } from '../../src/render/extras/insides/foil.js';
import { eyeInside } from '../../src/render/extras/insides/eye.js';
import { BO_KINDS, CARDS, CARD_RADIUS, TILT, botanicalInside, cardFrames } from '../../src/render/extras/insides/botanical.js';
import { smokeInside } from '../../src/render/extras/insides/smoke.js';
import { LQ, liquidExtrasInside } from '../../src/render/extras/insides/liquid-extras.js';
import { NOISE_GLSL } from '../../src/render/shaders/noise.js';
import { fallbackLook, needsLookExtras } from '../../src/look/appearance.js';
import { WEAPON, WE_KINDS, weaponFrame, weaponsInside } from '../../src/render/extras/insides/weapons.js';
import { CARD_AXIS, upFrame, upFrameGLSL } from '../../src/render/extras/insides/frame.js';
import { DRAGON, dragonExtent, dragonFrame, dragonInside } from '../../src/render/extras/insides/dragon.js';
import { RUNES, RU_STEM, RU_STROKES, runeGlyphs, runesFrame, runesInside } from '../../src/render/extras/insides/runes.js';
import { LIVING, USES_NOISE as LIVING_NOISE, livingInside } from '../../src/render/extras/insides/living.js';
import { _resetInsideMotion, motionUniforms } from '../../src/render/extras/insides/live.js';

const atlas = {
  ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
  texture: new THREE.Texture(),
};
const s = getShape('d20');
const labels = s.values.map((v) => labelFor('d20', v));
// insideMotion off: these tests pin the still insides (living insides set it on explicitly)
const FLAGS = { interiors: true, engraving: true, glow: true, effects: true, interiorSteps: 32, insideMotion: false };
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

/**
 * The lines the preprocessor keeps for these defines: #ifdef / #ifndef are evaluated; any other
 * #if / #elif is treated as true with every branch kept (an over-count, never an under-count).
 */
function activeGlsl(text, defines) {
  const stack = []; // per open block: { known, on, taken }
  const live = () => stack.every((b) => b.on);
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    let m;
    if ((m = t.match(/^#if(n?)def\s+(\w+)/))) {
      const on = (m[2] in defines) !== (m[1] === 'n');
      stack.push({ known: true, on, taken: on });
    } else if (t.startsWith('#if')) stack.push({ known: false, on: true });
    else if (t.startsWith('#elif')) {
      const b = stack.at(-1);
      if (b.known) b.on = false;
    } else if (t.startsWith('#else')) {
      const b = stack.at(-1);
      if (b.known) b.on = !b.taken;
    } else if (t.startsWith('#endif')) stack.pop();
    else if (live()) out.push(line);
  }
  return out.join('\n');
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

describe('bodies', () => {
  const TODAY = [
    { type: 'opaque' },
    { type: 'resin' },
    { type: 'metal', finish: 'polished' },
    { type: 'metal', finish: 'brushed' },
    { type: 'metal', finish: 'antique' },
    { type: 'marble' },
    { type: 'pearl' },
  ];
  const bodyMat = (body) => createDiceMaterial(look({ body }), atlas, s, labels, FLAGS);

  test("today's bodies get no body patch and keep today's shader with the chunk loaded", async () => {
    const loaded = TODAY.map((body) => {
      expect(bodyPatch(look({ body }), FLAGS)).toEqual({});
      const m = bodyMat(body);
      return { fs: patched(m).fragmentShader, defines: { ...m.defines }, key: m.userData.programKey };
    });
    _setLookExtrasImport(() => new Promise(() => {}));
    try {
      TODAY.forEach((body, i) => {
        const m = bodyMat(body);
        expect(patched(m).fragmentShader).toBe(loaded[i].fs);
        expect(m.defines).toEqual(loaded[i].defines);
        expect(m.userData.programKey).toBe(loaded[i].key);
        expect(loaded[i].fs).not.toContain('DICER_IRIDESCENT');
      });
    } finally {
      _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
      await requestLookExtras();
    }
  });

  test('body modules check their own type; an unknown preset draws as the first; mergePatches lives in merge.js', () => {
    for (const body of TODAY) expect(iridescentPatch(look({ body }))).toEqual({});
    const raw = { body: { type: 'iridescent', preset: 'nope', color: '#000000', color2: '#ffffff' } };
    expect(iridescentPatch(raw).uniforms.uBodyPreset.value.toArray()).toEqual(PRESET_PARAMS.chameleon);
    expect(lookExtras.mergePatches).toBe(mergePatches);
  });

  test('iridescent GLSL edges: pow base clamped, fwidth hoisted out of the ternary', () => {
    const fs = patched(bodyMat({ type: 'iridescent', preset: 'opal', color: '#1a9e8f', color2: '#6a2bd1' })).fragmentShader;
    const opal = fs.split('\n').find((l) => l.includes('dcOfl ='));
    expect(opal).toContain('pow( max( 0.5 + 0.5 * cos( dcOph ), 0.0 ), 4.0 )');
    const slope = fs.split('\n').find((l) => l.includes('dcSslope ='));
    expect(slope).not.toContain('fwidth');
    expect(fs).toMatch(/float dcSfu = fwidth\( dcSu \);/);
    expect(fs.indexOf('dcSfu = fwidth')).toBeLessThan(fs.indexOf('dcSslope ='));
    const seg = fs.slice(fs.indexOf('float dcSu ='), fs.indexOf('float dcSl ='));
    expect(seg.match(/fwidth\(/g).length).toBe(2); // the float and the vec3, each once, outside the ternary
  });

  test('iridescent: one program for all three presets (same key), uBodyPreset differs, params set, fragment compiles the DICER_IRIDESCENT chunk once', () => {
    const presets = ['chameleon', 'opal', 'dichroic'];
    const mats = presets.map((preset) =>
      bodyMat({ type: 'iridescent', preset, color: '#1a9e8f', color2: '#6a2bd1' }),
    );
    const keys = new Set(mats.map((m) => m.userData.programKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toMatch(/^iridescent\|/);
    const vals = mats.map((m) => m.userData.uniforms.uBodyPreset.value.toArray());
    presets.forEach((p, i) => expect(vals[i]).toEqual(PRESET_PARAMS[p]));
    expect(new Set(vals.map(String)).size).toBe(3);
    for (const m of mats) {
      expect(m.defines.DICER_IRIDESCENT).toBe('');
      expect(m.clearcoat).toBe(1);
      expect(m.clearcoatRoughness).toBeCloseTo(0.05);
      expect(m.sheen).toBeCloseTo(0.3);
      expect(m.sheenColor.getHexString()).toBe('6a2bd1');
      const fs = patched(m).fragmentShader;
      expect(count(fs, '#ifdef DICER_IRIDESCENT')).toBeGreaterThan(0);
      expect(count(fs, 'uniform vec4 uBodyPreset;')).toBe(1);
      expect(count(fs, '#define DC_NOISE')).toBe(1);
      expect(fs.indexOf('#define DC_NOISE')).toBeLessThan(fs.indexOf('uniform vec4 uBodyPreset;'));
      // the colour chunk sits after color_fragment, before the number fill mix
      const at = fs.indexOf('vec3 dcIc = ');
      expect(count(fs, 'vec3 dcIc = ')).toBe(1);
      expect(at).toBeGreaterThan(fs.indexOf('#include <color_fragment>'));
      expect(at).toBeLessThan(fs.indexOf(ENGRAVE_COLOR.trim().split('\n')[0]));
    }
  });

  test('gem: one program for the four presets; each preset\'s uBodyPreset is distinct; params set; the DICER_GEM chunk is present once; NOISE_GLSL is included exactly once', () => {
    const presets = ['amethyst', 'malachite', 'obsidian', 'quartz'];
    const mats = presets.map((preset) =>
      bodyMat({ type: 'gem', preset, color: '#7b3fb5', color2: '#2a0f45' }),
    );
    const keys = new Set(mats.map((m) => m.userData.programKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toMatch(/^gem\|/);
    const vals = mats.map((m) => m.userData.uniforms.uBodyPreset.value.toArray());
    presets.forEach((p, i) => expect(vals[i]).toEqual(GEM_PARAMS[p]));
    expect(new Set(vals.map(String)).size).toBe(4);
    for (const body of TODAY) expect(gemPatch(look({ body }))).toEqual({});
    const raw = { body: { type: 'gem', preset: 'nope', color: '#000000', color2: '#ffffff' } };
    expect(gemPatch(raw).uniforms.uBodyPreset.value.toArray()).toEqual(GEM_PARAMS.amethyst);
    for (const m of mats) {
      expect(m.defines.DICER_GEM).toBe('');
      expect(m.defines.DICER_IRIDESCENT).toBeUndefined();
      expect(m.clearcoat).toBe(1);
      expect(m.clearcoatRoughness).toBeCloseTo(0.02);
      expect(m.specularIntensity).toBe(1);
      expect(m.ior).toBeCloseTo(1.55);
      const fs = patched(m).fragmentShader;
      expect(count(fs, '#ifdef DICER_GEM')).toBeGreaterThan(0);
      expect(count(fs, 'uniform vec4 uBodyPreset;')).toBe(1);
      expect(count(fs, '#define DC_NOISE')).toBe(1);
      expect(fs.indexOf('#define DC_NOISE')).toBeLessThan(fs.indexOf('uniform vec4 uBodyPreset;'));
      // the gem declares modelMatrix itself (the view ray in die-local space): exactly once in
      // the compiled text (resin's own declaration sits behind #ifdef DICER_RESIN)
      expect(count(activeGlsl(fs, m.defines), 'uniform mat4 modelMatrix;')).toBe(1);
      // the bevel coat chunk once, after the physical material is set up
      expect(count(fs, 'material.specularColorBlended *= dcGt;')).toBe(1);
      expect(fs.indexOf('material.specularColorBlended *= dcGt;')).toBeGreaterThan(
        fs.indexOf('#include <lights_physical_fragment>'),
      );
      // the colour chunk once, after color_fragment, before the number fill mix
      const at = fs.indexOf('vec3 dcGc = ');
      expect(count(fs, 'vec3 dcGc = ')).toBe(1);
      expect(at).toBeGreaterThan(fs.indexOf('#include <color_fragment>'));
      expect(at).toBeLessThan(fs.indexOf(ENGRAVE_COLOR.trim().split('\n')[0]));
    }
  });

  test('wood: one program for the four presets; preset params distinct; params set; roughness chunk present', () => {
    const presets = ['oak', 'walnut', 'cherry', 'ebony'];
    const mats = presets.map((preset) =>
      bodyMat({ type: 'wood', preset, color: '#b98a52', color2: '#6e4a26', roughness: 0.55 }),
    );
    const keys = new Set(mats.map((m) => m.userData.programKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toMatch(/^wood\|/);
    const vals = mats.map((m) => m.userData.uniforms.uBodyPreset.value.toArray());
    presets.forEach((p, i) => expect(vals[i]).toEqual(WOOD_PARAMS[p]));
    expect(new Set(vals.map(String)).size).toBe(4);
    for (const body of TODAY) expect(woodPatch(look({ body }))).toEqual({});
    const raw = { body: { type: 'wood', preset: 'nope', color: '#000000', color2: '#ffffff' } };
    expect(woodPatch(raw).uniforms.uBodyPreset.value.toArray()).toEqual(WOOD_PARAMS.oak);
    for (const m of mats) {
      expect(m.defines.DICER_WOOD).toBe('');
      expect(m.defines.DICER_GEM).toBeUndefined();
      expect(m.defines.DICER_IRIDESCENT).toBeUndefined();
      expect(m.clearcoat).toBeCloseTo(0.5);
      expect(m.clearcoatRoughness).toBeCloseTo(0.25);
      const fs = patched(m).fragmentShader;
      expect(count(fs, '#ifdef DICER_WOOD')).toBeGreaterThan(0);
      expect(count(fs, 'uniform vec4 uBodyPreset;')).toBe(1);
      expect(count(fs, '#define DC_NOISE')).toBe(1);
      expect(fs.indexOf('#define DC_NOISE')).toBeLessThan(fs.indexOf('uniform vec4 uBodyPreset;'));
      // the colour chunk once, after color_fragment, before the number fill mix
      const at = fs.indexOf('vec3 dcWc = ');
      expect(count(fs, 'vec3 dcWc = ')).toBe(1);
      expect(at).toBeGreaterThan(fs.indexOf('#include <color_fragment>'));
      expect(at).toBeLessThan(fs.indexOf(ENGRAVE_COLOR.trim().split('\n')[0]));
      // the pore roughness once, after roughnessmap_fragment, reading the pores colorPre found
      const r = fs.indexOf('roughnessFactor = clamp( roughnessFactor + dcWpore');
      expect(count(fs, 'roughnessFactor = clamp( roughnessFactor + dcWpore')).toBe(1);
      expect(r).toBeGreaterThan(fs.indexOf('#include <roughnessmap_fragment>'));
      expect(r).toBeGreaterThan(at);
      // the varnish bevel chunk once, after the physical material is set up
      expect(count(fs, 'material.specularColorBlended *= dcWt;')).toBe(1);
      expect(fs.indexOf('material.specularColorBlended *= dcWt;')).toBeGreaterThan(
        fs.indexOf('#include <lights_physical_fragment>'),
      );
    }
  });

  const METAL_LINE = 'metalnessFactor = mix( metalnessFactor, uFillPBR.x, dcMask );';

  test('patina and worn: own programs (key finish part), other metal finishes untouched', () => {
    const copper = { type: 'metal', color: '#b5653a', color2: '#3fae9a', roughness: 0.4 };
    const keys = ['polished', 'brushed', 'antique', 'patina', 'worn'].map(
      (finish) => bodyMat({ ...copper, finish }).userData.programKey,
    );
    expect(new Set(keys).size).toBe(5);
    expect(keys[3]).toMatch(/^metal\|patina\|/);
    expect(keys[4]).toMatch(/^metal\|worn\|/);
    for (const finish of ['polished', 'brushed', 'antique']) {
      expect(metalFinishPatch(look({ body: { ...copper, finish } }))).toEqual({});
    }
    const pat = bodyMat({ ...copper, finish: 'patina' });
    const worn = bodyMat({ ...copper, finish: 'worn' });
    expect(pat.defines.DICER_PATINA).toBe('');
    expect(pat.defines.DICER_WORN).toBeUndefined();
    expect(worn.defines.DICER_WORN).toBe('');
    expect(worn.defines.DICER_PATINA).toBeUndefined();
    for (const m of [pat, worn]) {
      // the base metal program: border yes, brushed and antique chunks no
      expect(m.defines.DICER_BORDER).toBe('');
      expect(m.defines.DICER_BRUSHED).toBeUndefined();
      expect(m.defines.DICER_ANTIQUE).toBeUndefined();
      const fs = patched(m).fragmentShader;
      expect(fs).not.toContain('#ifdef DICER_ANTIQUE');
      expect(fs).not.toContain('#ifdef DICER_BRUSHED');
      expect(count(fs, '#define DC_NOISE')).toBe(1);
    }
    const pfs = patched(pat).fragmentShader;
    // the colour chunk after the number fill (it reads dcD and dcMask), never painting the fill
    const at = pfs.indexOf('float dcPatina = 0.0;');
    expect(count(pfs, 'float dcPatina = 0.0;')).toBe(1);
    expect(at).toBeGreaterThan(pfs.indexOf('float dcMask = smoothstep( - dcAA, dcAA, dcD );'));
    expect(pfs).toContain('dcPatina *= 1.0 - dcMask;');
    const r = pfs.indexOf('roughnessFactor = mix( roughnessFactor, 0.85, dcPatina );');
    expect(r).toBeGreaterThan(pfs.indexOf('#include <roughnessmap_fragment>'));
    const wfs = patched(worn).fragmentShader;
    const w = wfs.indexOf('float dcWoScr = 0.0;');
    expect(count(wfs, 'float dcWoScr = 0.0;')).toBe(1);
    expect(w).toBeGreaterThan(wfs.indexOf('float dcMask = smoothstep( - dcAA, dcAA, dcD );'));
    expect(count(wfs, 'dcWoScr')).toBeGreaterThan(2);
    expect(wfs.indexOf('roughnessFactor', w)).toBeGreaterThan(wfs.indexOf('#include <roughnessmap_fragment>'));
    // worn keeps the plain metalness line
    expect(count(wfs, METAL_LINE)).toBe(1);
  });

  test('the colour-shift effect tint runs after the patina / worn colour code', () => {
    const copper = { type: 'metal', color: '#b5653a', color2: '#3fae9a', roughness: 0.4 };
    for (const [finish, marker] of [
      ['patina', 'float dcPatina = 0.0;'],
      ['worn', 'float dcWoScr = 0.0;'],
    ]) {
      const fs = patched(bodyMat({ ...copper, finish })).fragmentShader;
      expect(count(fs, FX_COLOR.trim())).toBe(1);
      expect(fs.indexOf(FX_COLOR.trim())).toBeGreaterThan(fs.indexOf('#ifdef DICER_' + finish.toUpperCase()));
      expect(fs.indexOf(FX_COLOR.trim())).toBeGreaterThan(fs.indexOf(marker));
    }
  });

  test("patina's metalness pair applies exactly once, also with raised + outline numbers, and survives GLSL stripping", () => {
    const pair = metalFinishPatch(look({ body: { type: 'metal', finish: 'patina' } })).replace;
    expect(pair).toHaveLength(1);
    const [from, to] = pair[0];
    expect(from).toBe(METAL_LINE);
    expect(to).toBe('metalnessFactor = mix( mix( metalnessFactor, 0.0, dcPatina ), uFillPBR.x, dcMask );');
    // the line patchShader writes: once in today's metal shader, and it survives stripping
    expect(count(patched(engraved()).fragmentShader, from)).toBe(1);
    expect(stripGlslParts([`\t${from}`]).join('')).toContain(from);
    const all = createDiceMaterial(
      look({
        body: { type: 'metal', finish: 'patina' },
        numbers: { relief: 'raised', fill: 'outline' },
      }),
      atlas,
      s,
      labels,
      FLAGS,
    );
    const fs = patched(all).fragmentShader;
    expect(count(fs, from)).toBe(0);
    expect(count(fs, to)).toBe(1);
    for (const [f, t] of RAISED_REPLACE) {
      expect(count(fs, f)).toBe(0);
      expect(count(fs, t)).toBe(1);
    }
    expect(count(fs, 'float dcMask = smoothstep( - dcAA, dcAA, dcD ) * ( 1.0 - smoothstep(')).toBe(1);
  });

  test('metalFinishPatch is {} for a non-metal body with finish patina', () => {
    for (const type of ['opaque', 'resin', 'marble', 'pearl', 'wood', 'gem', 'iridescent']) {
      for (const finish of ['patina', 'worn']) {
        expect(metalFinishPatch({ body: { type, finish, color: '#000000', color2: '#ffffff' } })).toEqual({});
      }
    }
    expect(metalFinishPatch({ body: { type: 'metal', finish: 'worn' } }).defines).toEqual({ DICER_WORN: '' });
    // the finishes' copy of the raised border geometry (kept local: no world-start export)
    expect(LIP).toEqual({ to: BORDER.to, height: BORDER.height });
  });
});

describe('luminous', () => {
  const mat = (body, flags = FLAGS) => createDiceMaterial(look({ body }), atlas, s, labels, flags);

  test('lum key part, the lighting chunk lands after the resin refraction on a resin body, uLuminous = luminous x LUMINOUS_MAX', () => {
    const m = mat({ type: 'resin', luminous: 0.5 });
    expect(m.userData.programKey).toContain('|lum');
    const patch = luminousPatch(look({ body: { type: 'resin', luminous: 0.5 } }));
    expect(patch.uniforms.uLuminous.value).toBeCloseTo(0.5 * LUMINOUS_MAX, 6);
    expect(LUMINOUS_MAX).toBe(0.6);
    const fs = patched(m).fragmentShader;
    const refr = fs.indexOf('vec3 dcRefracted = vec3( 0.0 );');
    const lum = fs.indexOf('float dcLumIn');
    expect(count(fs, 'float dcLumIn')).toBe(1);
    expect(refr).toBeGreaterThan(-1);
    expect(lum).toBeGreaterThan(refr);
    expect(lum).toBeGreaterThan(fs.indexOf('#include <lights_physical_fragment>'));
    expect(lum).toBeLessThan(fs.indexOf('vec3 outgoingLight'));
    expect(fs).toContain('vec3 dcLumC = dcLumB * ( max( dcLumMax, 0.6 ) / dcLumMax );');
    expect(fs).toContain('totalEmissiveRadiance += dcLumC * uLuminous');
    expect(fs).toContain('dot( diffuseColor.rgb, vec3( 0.2126');
    // it merges with a body module (chunks concatenate per slot)
    const both = bodyPatch(look({ body: { type: 'gem', luminous: 1 } }), FLAGS);
    expect(both.chunks.lighting).toContain('dcLumIn');
    expect(both.defines.DICER_GEM).toBe('');
    expect(both.uniforms.uLuminous.value).toBeCloseTo(LUMINOUS_MAX, 6);
  });

  test('luminous 0 adds nothing', () => {
    for (const type of ['opaque', 'resin', 'wood']) {
      const a = look({ body: { type, luminous: 0 } });
      expect(luminousPatch(a)).toEqual({});
      expect(mat({ type, luminous: 0 }).userData.programKey).not.toContain('|lum');
    }
    expect(patched(mat({ type: 'opaque', luminous: 0 })).fragmentShader).not.toContain('dcLumIn');
  });

  test('luminous works with flags.glow false and engraving false; safe flags: no luminous, safe key', () => {
    const m = mat({ type: 'opaque', luminous: 1 }, { ...FLAGS, glow: false, engraving: false });
    expect(m.userData.programKey).toContain('|lum');
    expect(patched(m).fragmentShader).toContain('dcLumIn');
    const safe = mat({ type: 'opaque', luminous: 1 }, { ...FLAGS, safe: true });
    expect(safe.userData.programKey).toMatch(/safe1/);
    expect(safe.userData.programKey).not.toContain('|lum');
    expect(patched(safe).fragmentShader).not.toContain('dcLumIn');
  });
});

describe('insides', () => {
  const UP_LINE = 'dcIUp = normalize( transpose( dcRm ) * vec3( 0.0, 1.0, 0.0 ) * dcIs );';
  const resin = (interior, body = {}) => look({ body: { type: 'resin', ...body }, interior });
  const mat = (a, flags = FLAGS) => createDiceMaterial(a, atlas, s, labels, flags);
  const TODAY = [
    { type: 'liquid' },
    { type: 'glitter' },
    { type: 'swirl' },
    { type: 'nebula' },
    ...['star', 'heart', 'skull', 'sphere'].map((shape) => ({ type: 'shape', shape })),
  ];

  test("today's insides get no inside patch and keep today's shader with the chunk loaded", async () => {
    // insideMotion off: today's insides exactly as before living insides
    const STILL = { ...FLAGS, insideMotion: false };
    const FL = [STILL, { ...STILL, interiorSteps: 16 }, { ...STILL, interiorSteps: 0 }];
    const run = () =>
      TODAY.flatMap((it) =>
        FL.map((f) => {
          const m = mat(resin(it), f);
          return { fs: patched(m).fragmentShader, defines: { ...m.defines }, key: m.userData.programKey };
        }),
      );
    for (const it of TODAY) {
      for (const f of FL) expect(insidePatch(resin(it), f)).toEqual({});
      // also when the look needs the chunk for another reason (luminous)
      expect(insidePatch(resin(it, { luminous: 1 }), STILL)).toEqual({});
      expect(lookExtras.patchMaterial(resin(it, { luminous: 1 }), STILL, {}).interior).toBeUndefined();
    }
    const loaded = run();
    _setLookExtrasImport(() => new Promise(() => {}));
    try {
      const missing = run();
      missing.forEach((m, i) => {
        expect(m.fs).toBe(loaded[i].fs);
        expect(m.defines).toEqual(loaded[i].defines);
        expect(m.key).toBe(loaded[i].key);
        expect(m.fs).not.toContain('dcIUp');
      });
    } finally {
      _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
      await requestLookExtras();
    }
  });

  describe('living insides: motion uniforms (insideMotion on)', () => {
    const LIVE = { ...FLAGS, insideMotion: true };
    const MOTION = ['uInteriorFlare', 'uInteriorLag', 'uInteriorSpin', 'uInteriorSwirl', 'uInteriorTime'];
    const DECL = [
      'uniform float uInteriorTime;',
      'uniform vec3 uInteriorSpin;',
      'uniform vec3 uInteriorLag;',
      'uniform float uInteriorFlare;',
      'uniform vec3 uInteriorSwirl;',
    ];
    const defaults = (u) => {
      expect(u.uInteriorTime.value).toBe(0);
      expect(u.uInteriorSpin.value.toArray()).toEqual([0, 0, 0]);
      expect(u.uInteriorLag.value.toArray()).toEqual([0, 1, 0]);
      expect(u.uInteriorFlare.value).toBe(0);
      expect(u.uInteriorSwirl.value.toArray()).toEqual([0, 0, 0]);
    };
    const { wants } = lookExtras.insideMotion;

    test('wants: resin + an inside + interiors + steps > 0 + insideMotion, nothing less', () => {
      const a = resin({ type: 'liquid' });
      expect(wants(a, LIVE)).toBe(true);
      expect(wants(resin({ type: 'none' }), LIVE)).toBe(false);
      expect(wants(look({ body: { type: 'opaque' }, interior: { type: 'liquid' } }), LIVE)).toBe(false);
      expect(wants(a, { ...LIVE, interiorSteps: 0 })).toBe(false);
      expect(wants(a, { ...LIVE, interiors: false })).toBe(false);
      expect(wants(a, { ...LIVE, insideMotion: false })).toBe(false);
      const { insideMotion: _, ...unset } = LIVE;
      expect(wants(a, unset)).toBe(false); // unset: off
    });

    test("today's four shapes get a uniforms-only patch with the four motion uniforms at their defaults", () => {
      for (const it of TODAY.filter((x) => x.type === 'shape')) {
        const p = insidePatch(resin(it), LIVE);
        expect(Object.keys(p)).toEqual(['uniforms']);
        expect(Object.keys(p.uniforms).sort()).toEqual(MOTION);
        defaults(p.uniforms);
        // fresh objects per patch: dice never share motion state
        expect(insidePatch(resin(it), LIVE).uniforms.uInteriorTime).not.toBe(p.uniforms.uInteriorTime);
        expect(insidePatch(resin(it), { ...LIVE, interiorSteps: 0 })).toEqual({});
      }
    });

    test('a marched new inside declares the four uniforms in its pars (once) and supplies them with its own', () => {
      const a = resin({ type: 'foil', colors: ['#ffcf5a', '#d9814a'], density: 0.5 });
      const p = insidePatch(a, LIVE);
      for (const d of DECL) expect(count(p.interior.pars, d)).toBe(1);
      defaults(p.uniforms);
      const still = insidePatch(a, { ...LIVE, insideMotion: false });
      for (const d of DECL) expect(still.interior.pars).not.toContain(d);
      expect(Object.keys(p.uniforms).sort()).toEqual([...Object.keys(still.uniforms), ...MOTION].sort());
    });

    test("a today's-inside material carries the uniforms and the 'mo' key with the chunk; without it, today's material and key", async () => {
      const a = resin({ type: 'liquid' });
      const live = mat(a, LIVE);
      expect(live.userData.programKey).toMatch(/\|mo$/);
      defaults(live.userData.uniforms);
      const still = mat(a, { ...LIVE, insideMotion: false });
      expect(still.userData.programKey).not.toContain('|mo');
      expect(still.userData.uniforms.uInteriorTime).toBeUndefined();
      // the four built-in shapes stay still: no GLSL reads the uniforms there
      const star = resin({ type: 'shape', shape: 'star' });
      expect(patched(mat(star, LIVE)).fragmentShader).toBe(patched(mat(star, { ...LIVE, insideMotion: false })).fragmentShader);
      _setLookExtrasImport(() => new Promise(() => {}));
      try {
        const missing = mat(a, LIVE);
        expect(missing.userData.programKey).toBe(still.userData.programKey);
        expect(missing.userData.uniforms.uInteriorTime).toBeUndefined();
      } finally {
        _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
        await requestLookExtras();
      }
    });

    test('step writes time, spin and a unit lag from the die rotation; frame clamps dt', () => {
      const u = insidePatch(resin({ type: 'liquid' }), LIVE).uniforms;
      const die = {};
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      lookExtras.insideMotion.step(die, u, q, 0, { factor: 1 });
      // first step: the lag starts at world up in the die frame (+y turned -90° about x: -z)
      expect(u.uInteriorLag.value.x).toBeCloseTo(0, 6);
      expect(u.uInteriorLag.value.z).toBeCloseTo(-1, 6);
      lookExtras.insideMotion.step(die, u, q, 5, { factor: 1 });
      expect(u.uInteriorTime.value).toBeCloseTo(0.1, 6); // clamped to 0.1 s
      expect(u.uInteriorLag.value.length()).toBeCloseTo(1, 6);
      // the swirl: 0.1 s of 0.15 rad/s about local up (-z here), the die not turning
      expect(u.uInteriorSwirl.value.z).toBeCloseTo(-0.015, 6);
      lookExtras.insideMotion.step(die, u, q, 0.05, { factor: 0 });
      expect(u.uInteriorSwirl.value.z).toBeCloseTo(-0.015, 6); // frozen at factor 0
    });

    test('frame: a throw warns once (Dicer |) and stops stepping, never reaching the render loop', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const a = resin({ type: 'liquid' });
        const die = { appearance: a, inner: { material: { userData: { uniforms: motionUniforms() } } } };
        const box = {
          isolate: vi.fn(() => {
            throw new Error('boom');
          }),
        };
        const roll = { phase: 'playing', flags: LIVE, dice: [die] };
        expect(() => lookExtras.insideMotion.frame(box, roll, 100)).not.toThrow();
        expect(lookExtras.insideMotion.frame(box, roll, 116)).toBe(false);
        expect(box.isolate).toHaveBeenCalledTimes(1); // stopped after the throw
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/^Dicer \|/);
      } finally {
        _resetInsideMotion();
        warn.mockRestore();
      }
    });

    describe('animated GLSL (Task 3)', () => {
      const BASE = ['liquid', 'glitter', 'swirl', 'nebula'];
      const COLORS = { colors: ['#3a7fd0', '#e0f0ff'], density: 0.5 };

      test('with insideMotion, liquid/glitter/swirl/nebula get the living patch and read uInteriorTime', () => {
        for (const type of BASE) {
          const a = resin({ type, ...COLORS });
          const p = insidePatch(a, LIVE);
          expect(Object.keys(p).sort()).toEqual(['interior', 'uniforms']);
          expect(p.interior.main).toBe(marchWithUp());
          const { body } = livingInside(a);
          expect(count(p.interior.pars, body)).toBe(1);
          for (const d of DECL) expect(count(p.interior.pars, d)).toBe(1);
          expect(count(p.interior.pars, NOISE_GLSL)).toBe(1);
          expect(Object.keys(p.uniforms).sort()).toEqual(MOTION);
          defaults(p.uniforms);
          // the animation is wired: the GLSL reads the time uniform (glitter: the CPU-integrated swirl)
          expect(body).toMatch(type === 'glitter' ? /\buInteriorSwirl\b/ : /\buInteriorTime\b/);
          expect(body).not.toMatch(/\buInteriorFlare\b/); // Task 9's
          expect(body).toContain('vec4 dcInterior( vec3 p, vec3 rd, float dt )');
          // today's GLSL is not it
          expect(interiorChunk(type).pars).not.toContain(body);
          // still: no patch, today's shader
          expect(insidePatch(a, { ...LIVE, insideMotion: false })).toEqual({});
        }
        expect(LIVING_NOISE).toBe(true);
      });

      test("liquid's living patch reads uInteriorLag, not dcIUp, for the surface", () => {
        const { body } = livingInside(resin({ type: 'liquid', ...COLORS }));
        expect(body).toMatch(/\buInteriorLag\b/);
        expect(body).not.toContain('dcIUp');
        // glitter turns by the CPU-integrated swirl rotation vector (motion.js), never by a
        // time x spin product that would unwind when the spin dies at landing
        const gl = livingInside(resin({ type: 'glitter', ...COLORS })).body;
        expect(gl).toContain('float w = length( uInteriorSwirl );');
        expect(gl).not.toMatch(/\buInteriorTime\b|\buInteriorSpin\b/);
        // no living inside reads the die's true up (motion has its own frame)
        for (const type of BASE) expect(livingInside(resin({ type, ...COLORS })).body).not.toContain('dcIUp');
      });

      test('liquid bubble / sand use the lagged surface, smoke drifts, only with insideMotion', () => {
        for (const opt of [{ bubble: true }, { sand: true }, { bubble: true, sand: true }]) {
          const a = resin({ type: 'liquid', ...opt, ...COLORS });
          const live = insidePatch(a, LIVE).interior.pars;
          const still = insidePatch(a, { ...LIVE, insideMotion: false }).interior.pars;
          expect(live).toMatch(/\buInteriorLag\b/);
          expect(live.split('vec3 dcIUp;')[1]).not.toContain('dcIUp'); // declared, never read
          expect(still.split('vec3 dcIUp;')[1]).toContain('dcIUp');
          expect(still).toContain(liquidExtrasInside(a).body);
          expect(still).not.toMatch(/\buInteriorLag\b/);
        }
        const sm = resin({ type: 'smoke', ...COLORS });
        const live = insidePatch(sm, LIVE).interior.pars;
        const still = insidePatch(sm, { ...LIVE, insideMotion: false }).interior.pars;
        expect(live.split('uniform float uInteriorFlare;')[1]).toMatch(/\buInteriorTime\b/);
        expect(still).toContain(smokeInside(sm).body);
        expect(smokeInside(sm).body).not.toMatch(/\buInteriorTime\b/);
      });

      test('chunk missing: insideMotion looks render today\'s shader', async () => {
        const cases = [...BASE.map((type) => ({ type })), { type: 'smoke' }, { type: 'liquid', bubble: true }];
        const still = cases.map((it) => patched(mat(resin({ ...it, ...COLORS }), { ...LIVE, insideMotion: false })).fragmentShader);
        // with the chunk: animated, so different from the still shader
        cases.forEach((it, i) => expect(patched(mat(resin({ ...it, ...COLORS }), LIVE)).fragmentShader).not.toBe(still[i]));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        _setLookExtrasImport(() => new Promise(() => {}));
        try {
          // today's insides: exactly today's shader; the new ones: their fallback look, never motion
          BASE.forEach((type, i) => {
            const m = mat(resin({ type, ...COLORS }), LIVE);
            expect(patched(m).fragmentShader).toBe(still[i]);
            expect(m.userData.programKey).not.toContain('|mo');
          });
          for (const it of cases) expect(patched(mat(resin({ ...it, ...COLORS }), LIVE)).fragmentShader).not.toMatch(/\buInteriorTime\b/);
        } finally {
          warn.mockRestore();
          _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
          await requestLookExtras();
        }
      });

      test('every living inside compiles at 16 and 48 steps', () => {
        for (const type of BASE) {
          const a = resin({ type, ...COLORS });
          const { body } = livingInside(a);
          // dcLv names only (besides the shared interior names), no derivatives, pow of max(...)
          const own = [...body.matchAll(/\b(?:vec[234]|float|int|bool|mat[23])\s+(dc\w+)\s*\(/g)].map((x) => x[1]);
          for (const name of own) if (name !== 'dcInterior') expect(name).toMatch(/^dcLv/);
          for (const [, name] of body.matchAll(/#define\s+(\w+)/g)) expect(name).toMatch(/^DC_LV_/);
          expect(body).not.toMatch(/\b(dFdx|dFdy|fwidth)\b/);
          for (const [, base] of body.matchAll(/pow\( ([^,]+),/g)) expect(base).toMatch(/^max\(/);
          for (const steps of [16, 48]) {
            for (const shape of [s, getShape('d2')]) {
              const f = { ...LIVE, interiorSteps: steps };
              const m = createDiceMaterial(a, atlas, shape, labels, f);
              expect(m.userData.programKey).toBe(programKey(a, f));
              expect(m.userData.programKey).toContain(`|${type}:${steps}|`);
              expect(m.userData.programKey).toMatch(/\|mo$/);
              expect(m.defines.DICER_STEPS).toBe(steps);
              const fs = patched(m).fragmentShader;
              expect(count(fs, body)).toBe(1);
              expect(count(fs, 'vec4 dcInterior( vec3 p, vec3 rd, float dt )')).toBe(1);
              expect(count(fs, 'uniform float uInteriorTime;')).toBe(1);
              expect(count(fs, '#define DC_NOISE')).toBe(1);
              expect(count(fs, 'vec3 dcIUp;')).toBe(1);
              expect(fs).toContain(marchWithUp());
              for (const k of MOTION) expect(m.userData.uniforms[k]).toBeDefined();
            }
          }
        }
      });

      test("the living GLSL's local constants match interior.js", () => {
        expect(LIVING).toEqual({
          radius: INTERIOR.radius,
          glitterCells: INTERIOR.glitterCells,
          starCells: INTERIOR.starCells,
          cellMin: INTERIOR.cellMin,
          cellMax: INTERIOR.cellMax,
        });
      });
    });
  });

  test('foil: interior pars/main come from the patch; dcIUp declared once; the up line inserted once after dcIKey; NOISE_GLSL once', () => {
    const a = resin({ type: 'foil', colors: ['#ffcf5a', '#d9814a'], density: 0.5 });
    const patch = insidePatch(a, FLAGS);
    expect(Object.keys(patch).sort()).toEqual(['interior', 'uniforms']);
    expect(patch.interior.main).toBe(marchWithUp());
    expect(patch.interior.pars).toContain(INTERIOR_PARS);
    expect(count(patch.interior.pars, NOISE_GLSL)).toBe(1);
    // the up line: once, directly after the dcIKey line, before the loop
    const main = marchWithUp();
    expect(count(main, UP_LINE)).toBe(1);
    const keyLine = main.split('\n').findIndex((l) => l.trim().startsWith('dcIKey = '));
    expect(main.split('\n')[keyLine + 1].trim()).toBe(UP_LINE);
    expect(main.replace(UP_LINE, '').replace(/\n[ \t]*\n/, '\n')).toBe(INTERIOR_MARCH);
    const m = mat(a);
    expect(m.userData.programKey).toContain('|foil:32|');
    expect(m.defines.DICER_INTERIOR).toBe('');
    const fs = patched(m).fragmentShader;
    expect(fs).toContain(patch.interior.pars);
    expect(fs).toContain(patch.interior.main);
    expect(count(fs, 'vec3 dcIUp;')).toBe(1);
    expect(count(fs, UP_LINE)).toBe(1);
    expect(fs.indexOf(UP_LINE)).toBeGreaterThan(fs.indexOf('dcIKey = normalize'));
    expect(fs.indexOf(UP_LINE)).toBeLessThan(fs.indexOf('for ( int dcIi = 0;'));
    expect(count(fs, '#define DC_NOISE')).toBe(1);
    expect(count(fs, 'vec4 dcInterior( vec3 p, vec3 rd, float dt )')).toBe(1);
    expect(fs).toContain('dcFoShard');
    expect(MARCH_RADIUS).toBe(INTERIOR.radius); // foil's local copy
    // one program for every colour and density
    const other = mat(resin({ type: 'foil', colors: ['#e8edf2', '#f3dc9a'], density: 0.2 }));
    expect(other.userData.programKey).toBe(m.userData.programKey);
    expect(patched(other).fragmentShader).toBe(fs);
    // a non-resin body hides it (normalisation forces none)
    expect(insidePatch(look({ body: { type: 'opaque' }, interior: { type: 'foil' } }), FLAGS)).toEqual({});
    expect(insidePatch(a, { ...FLAGS, interiors: false })).toEqual({});
  });

  test('foil: the cell walk is a 3D DDA with a constant bound that covers the longest segment, each cell once', () => {
    // longest segment: the chord of the march sphere over the fewest steps (16)
    const dtMax = (2 * INTERIOR.radius) / FOIL.minSteps;
    expect(FOIL_WALK).toBe(1 + 3 * Math.ceil(dtMax * FOIL.cells));
    expect(FOIL_WALK).toBeLessThanOrEqual(5);
    const fs = patched(mat(resin({ type: 'foil', colors: ['#ffcf5a', '#d9814a'], density: 0.5 }))).fragmentShader;
    expect(fs).toContain(`#define DC_FO_WALK ${FOIL_WALK}`);
    expect(fs).not.toContain('0.5 * dt ) ) * DC_FO_CELLS');
    // reference walk (the GLSL's algorithm) against dense sampling of the segment
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let n = 0; n < 2000; n++) {
      const off = n % 2 ? 0.5 : 0;
      const p = [0, 1, 2].map(() => (rnd() - 0.5) * 1.2);
      let d = [0, 1, 2].map(() => rnd() - 0.5);
      if (n % 7 === 0) d[1] = 0; // an axis-parallel segment
      const l = Math.hypot(...d);
      d = d.map((x) => x / l);
      const dt = n % 5 === 0 ? dtMax : rnd() * dtMax;
      const s = p.map((x) => x * FOIL.cells - off);
      const dd = d.map((x) => x * FOIL.cells);
      const c = s.map(Math.floor);
      const safe = dd.map((x) => (Math.abs(x) < 1e-6 ? 1e-6 : x));
      const tm = safe.map((x, i) => (c[i] + (safe[i] >= 0 ? 1 : 0) - s[i]) / x);
      const td = safe.map((x) => 1 / Math.abs(x));
      const visited = [];
      for (let i = 0; i < FOIL_WALK; i++) {
        visited.push(c.join(','));
        if (Math.min(...tm) >= dt) break;
        const mn = Math.min(...tm);
        for (let k = 0; k < 3; k++) {
          if (tm[k] <= mn) {
            c[k] += Math.sign(safe[k]);
            tm[k] += td[k];
          }
        }
      }
      const seen = new Set(visited);
      expect(seen.size).toBe(visited.length);
      // one assertion per segment: every densely sampled cell along it was visited
      const missed = [];
      for (let k = 0; k <= 200; k++) {
        const cell = s.map((x, i) => Math.floor(x + dd[i] * dt * (k / 200))).join(',');
        if (!seen.has(cell)) missed.push(cell);
      }
      expect(missed).toEqual([]);
      // and the walk ended inside the bound: the segment's end cell was reached
      expect(Math.min(...tm)).toBeGreaterThanOrEqual(dt - 1e-9);
    }
  });

  test('eye: dcIUp is used for the pupil axis; one program; patch interior present; fake tint 0.2', () => {
    const a = resin({ type: 'eye', colors: ['#3fae5a', '#fff4ea'], density: 0.4 });
    const patch = insidePatch(a, FLAGS);
    expect(Object.keys(patch).sort()).toEqual(['interior', 'uniforms']);
    expect(patch.interior.main).toBe(marchWithUp());
    expect(patch.interior.pars).toContain(INTERIOR_PARS);
    const { body } = eyeInside(a);
    expect(patch.interior.pars).toContain(body);
    // the pupil axis is the die's current world up (set from dcRm before the march loop)
    expect(body).toContain('vec3 dcEyAx = dcIUp;');
    // ... and it feeds the shading frame: the tangent frame, the height along the axis (cornea /
    // sclera split), the iris disc and the catchlight
    expect(body).toMatch(/vec3 t1 = normalize\( cross\( dcEyAx,/);
    expect(body).toContain('vec3 t2 = cross( dcEyAx, t1 );');
    expect(body).toContain('float c = dot( s, dcEyAx );');
    expect(body).toMatch(/dcEyIris\( s, rd, dcEyAx, t1, t2,/);
    expect(body).toContain('vec2 q = vec2( dot( xi, t1 ), dot( xi, t2 ) )');
    expect(body).toContain('normalize( dcEyAx + 0.5 * dcIKey )');
    // dcIUp is read only through dcEyAx (no second, unrelated axis)
    expect(count(body, 'dcIUp')).toBe(1);
    // pow() only of bases that cannot be negative (undefined in GLSL ES): max(...) or a max'd name
    for (const [, base] of body.matchAll(/pow\( ([^,]+),/g)) expect(base).toMatch(/^(max\(|rk$|rc$)/);
    expect(body).toContain('vec4 dcInterior( vec3 p, vec3 rd, float dt )');
    expect(body).toMatch(/DC_EY_AA/); // soft silhouette
    expect(body).not.toMatch(/\b(dFdx|dFdy|fwidth)\b/);
    // dcEy names only (besides the shared interior names)
    const own = [...body.matchAll(/\b(?:vec[234]|float|int|bool|mat3)\s+(dc\w+)\s*\(/g)].map((x) => x[1]);
    for (const name of own) if (name !== 'dcInterior') expect(name).toMatch(/^dcEy/);
    const m = mat(a);
    expect(m.userData.programKey).toContain('|eye:32|');
    const fs = patched(m).fragmentShader;
    expect(fs).toContain(patch.interior.pars);
    expect(fs).toContain(patch.interior.main);
    expect(count(fs, 'vec3 dcIUp;')).toBe(1);
    expect(count(fs, UP_LINE)).toBe(1);
    expect(fs.indexOf(UP_LINE)).toBeLessThan(fs.indexOf('for ( int dcIi = 0;'));
    expect(count(fs, 'vec4 dcInterior( vec3 p, vec3 rd, float dt )')).toBe(1);
    expect(count(fs, '#define DC_NOISE')).toBeLessThanOrEqual(1);
    // one program for every colour and density
    const other = mat(resin({ type: 'eye', colors: ['#c8322a', '#ffe6dc'], density: 0.6 }));
    expect(other.userData.programKey).toBe(m.userData.programKey);
    expect(patched(other).fragmentShader).toBe(fs);
    // also on the coin
    expect(() => createDiceMaterial(a, atlas, getShape('d2'), labels, FLAGS)).not.toThrow();
    // fake mode: the tint share 0.2, no interior
    const low = { ...FLAGS, interiorSteps: 0 };
    const fake = insidePatch(a, low);
    expect(Object.keys(fake)).toEqual(['uniforms']);
    expect(fake.uniforms.uResinTint.value.w).toBeCloseTo(0.2, 6);
    expect(patched(mat(a, low)).fragmentShader).not.toContain('dcInterior');
  });

  test('botanical: one program for the three kinds (same key), uBoKind 0/1/2, fake tint 0.25', () => {
    // the local kind list matches appearance.js INCLUSIONS (not exported: no world-start cost)
    const src = readFileSync('src/look/appearance.js', 'utf8');
    const lit = src.match(/const INCLUSIONS = (\[[^\]]*\]);/)[1];
    expect(BO_KINDS).toEqual(JSON.parse(lit.replace(/'/g, '"')));
    const colors = { flower: ['#f28fb0', '#f6d24a'], moss: ['#4f8a3a', '#b9d36a'], butterfly: ['#2f7fe0', '#111a2c'] };
    const mats = BO_KINDS.map((inclusion, k) => {
      const a = resin({ type: 'botanical', inclusion, colors: colors[inclusion], density: 0.5 });
      expect(a.interior.inclusion).toBe(inclusion);
      const patch = insidePatch(a, FLAGS);
      expect(Object.keys(patch).sort()).toEqual(['interior', 'uniforms']);
      expect(patch.interior.main).toBe(marchWithUp());
      expect(patch.uniforms.uBoKind.value).toBe(k);
      expect(botanicalInside(a).uniforms.uBoKind.value).toBe(k);
      const m = mat(a);
      expect(m.userData.programKey).toContain('|botanical:32|');
      expect(m.userData.uniforms.uBoKind.value).toBe(k);
      expect(() => createDiceMaterial(a, atlas, getShape('d2'), labels, FLAGS)).not.toThrow();
      // fake mode: the tint share 0.25, no interior
      const low = { ...FLAGS, interiorSteps: 0 };
      const fake = insidePatch(a, low);
      expect(Object.keys(fake)).toEqual(['uniforms']);
      expect(fake.uniforms.uResinTint.value.w).toBeCloseTo(0.25, 6);
      expect(patched(mat(a, low)).fragmentShader).not.toContain('dcInterior');
      return m;
    });
    // one program: same key and the same shader text for every kind, colour and density
    const fs = patched(mats[0]).fragmentShader;
    for (const m of mats) {
      expect(m.userData.programKey).toBe(mats[0].userData.programKey);
      expect(patched(m).fragmentShader).toBe(fs);
    }
    const { body } = botanicalInside(resin({ type: 'botanical' }));
    expect(count(fs, body)).toBe(1);
    expect(count(fs, 'uniform int uBoKind;')).toBe(1);
    expect(count(fs, 'vec4 dcInterior( vec3 p, vec3 rd, float dt )')).toBe(1);
    expect(count(fs, '#define DC_NOISE')).toBe(1);
    expect(body).not.toMatch(/\b(dFdx|dFdy|fwidth)\b/);
    // pow() only of bases that cannot be negative (undefined in GLSL ES)
    for (const [, base] of body.matchAll(/pow\( ([^,]+),/g)) expect(base).toMatch(/^max\(/);
    // dcBo names only (besides the shared interior names)
    const own = [...body.matchAll(/\b(?:vec[234]|float|int|bool|mat[23])\s+(dc\w+)\s*\(/g)].map((x) => x[1]);
    expect(own.length).toBeGreaterThan(3);
    for (const name of own) if (name !== 'dcInterior') expect(name).toMatch(/^dcBo/);
    // the cards follow the die's up: one shared normal per kind (dcIUp tilted by TILT), built in
    // the shader from dcIUp before the cards are tested
    expect(body).toContain('vec3 b1 = dcBoPerp( DC_BO_REF[ b ], dcIUp );');
    expect(body).toContain('vec3 n = normalize( dcIUp + tl.x * b1 + tl.y * b2 );');
    expect(count(body, 'dcBoCard( b')).toBe(3);
    expect(body).toMatch(/vec3 q = x \+ [\d.]+ \* dcIUp;/); // the moss settles below the centre along up
    for (const t of Object.values(TILT)) expect(Math.atan(Math.hypot(...t))).toBeLessThan((25 * Math.PI) / 180);
    // over every resting up of every die (face normals, both signs; the coin's caps), sampled
    // directions all round and the refs themselves (the fallback axis): the cards of a kind are
    // parallel (so they never cross), their normal within 25 degrees of up, their frames
    // orthonormal; at density 1, their largest, they stay inside the march sphere
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const unit = (v) => v.map((x) => x / Math.hypot(...v));
    const ups = [[0, 1, 0], [0, -1, 0], ...CARDS.map((c) => unit(c.ref))];
    for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
      const sh = getShape(type);
      for (const fc of sh.faces) {
        const n = [0, 0, 0];
        fc.forEach((vi, k) => {
          const [a, b] = [sh.vertices[vi], sh.vertices[fc[(k + 1) % fc.length]]];
          n[0] += (a[1] - b[1]) * (a[2] + b[2]);
          n[1] += (a[2] - b[2]) * (a[0] + b[0]);
          n[2] += (a[0] - b[0]) * (a[1] + b[1]);
        });
        ups.push(unit(n), unit(n.map((x) => -x)));
      }
    }
    for (let k = 0; k < 200; k++) {
      const y = 1 - (2 * (k + 0.5)) / 200;
      const r = Math.sqrt(1 - y * y);
      ups.push([r * Math.cos(2.39996 * k), y, r * Math.sin(2.39996 * k)]);
    }
    const cos25 = Math.cos((25 * Math.PI) / 180);
    for (const up of ups)
      for (const kind of ['flower', 'butterfly']) {
        const frames = cardFrames(up, kind);
        expect(frames.length).toBe(3);
        for (const fr of frames) {
          expect(fr.n).toEqual(frames[0].n);
          expect(dot(fr.n, up)).toBeGreaterThan(cos25);
          expect(dot(fr.n, fr.n)).toBeCloseTo(1, 9);
          expect(dot(fr.t1, fr.t1)).toBeCloseTo(1, 9);
          expect(dot(fr.n, fr.t1)).toBeCloseTo(0, 9);
          expect(dot(fr.n, fr.t2)).toBeCloseTo(0, 9);
          expect(Math.hypot(...fr.c) + fr.size * CARD_RADIUS[kind][1]).toBeLessThan(0.6);
        }
      }
    // an unknown inclusion normalises to the default kind (flower)
    expect(botanicalInside(resin({ type: 'botanical', inclusion: 'cactus' })).uniforms.uBoKind.value).toBe(0);
  });

  test('smoke: patch interior, fake tint 0.4', () => {
    const a = resin({ type: 'smoke', colors: ['#2a2440', '#9a8fc8'], density: 0.6 });
    const patch = insidePatch(a, FLAGS);
    expect(Object.keys(patch).sort()).toEqual(['interior', 'uniforms']);
    expect(patch.interior.main).toBe(marchWithUp());
    expect(patch.interior.pars).toContain(INTERIOR_PARS);
    expect(count(patch.interior.pars, NOISE_GLSL)).toBe(1);
    const { body } = smokeInside(a);
    expect(patch.interior.pars).toContain(body);
    expect(body).toContain('vec4 dcInterior( vec3 p, vec3 rd, float dt )');
    // its own plume, neither nebula's clouds nor swirl's ribbons
    expect(body).not.toBe(interiorChunk('nebula').pars);
    expect(interiorChunk('nebula').pars).not.toContain(body);
    expect(interiorChunk('swirl').pars).not.toContain(body);
    expect(body).not.toMatch(/\b(dFdx|dFdy|fwidth)\b/);
    for (const [, base] of body.matchAll(/pow\( ([^,]+),/g)) expect(base).toMatch(/^max\(/);
    const own = [...body.matchAll(/\b(?:vec[234]|float|int|bool|mat[23])\s+(dc\w+)\s*\(/g)].map((x) => x[1]);
    for (const name of own) if (name !== 'dcInterior') expect(name).toMatch(/^dcSm/);
    const m = mat(a);
    expect(m.userData.programKey).toContain('|smoke:32|');
    const fs = patched(m).fragmentShader;
    expect(count(fs, body)).toBe(1);
    expect(count(fs, 'vec4 dcInterior( vec3 p, vec3 rd, float dt )')).toBe(1);
    expect(count(fs, '#define DC_NOISE')).toBe(1);
    // one program for every colour and density
    const other = mat(resin({ type: 'smoke', colors: ['#e8e8f0', '#30a0ff'], density: 0.2 }));
    expect(other.userData.programKey).toBe(m.userData.programKey);
    expect(patched(other).fragmentShader).toBe(fs);
    expect(() => createDiceMaterial(a, atlas, getShape('d2'), labels, FLAGS)).not.toThrow();
    // fake mode: the tint share 0.4, no interior
    const low = { ...FLAGS, interiorSteps: 0 };
    const fake = insidePatch(a, low);
    expect(Object.keys(fake)).toEqual(['uniforms']);
    expect(fake.uniforms.uResinTint.value.w).toBeCloseTo(0.4, 6);
    expect(patched(mat(a, low)).fragmentShader).not.toContain('dcInterior');
  });

  test('liquid + bubble / sand / both: patched, dcIUp used, keys distinct; plain liquid unpatched', () => {
    const colors = ['#1f7fd1', '#bfe6ff'];
    const plain = resin({ type: 'liquid', colors, density: 0.5 });
    expect(insidePatch(plain, FLAGS)).toEqual({});
    const plainM = mat(plain);
    expect(plainM.userData.programKey).toContain('|liquid:32|');
    const plainFs = patched(plainM).fragmentShader;
    expect(plainFs).not.toContain('dcIUp');
    expect(plainFs).not.toContain('dcLq');
    // the liquid core of interior.js, copied (world start untouched)
    const LIQ_LINES = [
      'float wave = dcNoise3( p * 4.0 + 1.7 ) * 0.65 + dcNoise3( p * 9.0 - 3.1 ) * 0.35;',
      'float coreR = mix( 0.16, 0.42, uInteriorDensity ) + 0.10 * ( wave - 0.5 );',
      'vec3 hazeCol = uInteriorColors[ 1 ] * ( dcILight + 0.25 );',
    ];
    for (const l of LIQ_LINES) expect(interiorChunk('liquid').pars).toContain(l);
    const low = { ...FLAGS, interiorSteps: 0 };
    const plainLow = mat(plain, low);
    const cases = [
      [{ bubble: true }, '|liquid+b:32|'],
      [{ sand: true }, '|liquid+s:32|'],
      [{ bubble: true, sand: true }, '|liquid+bs:32|'],
    ];
    const keys = new Set([plainM.userData.programKey]);
    const shaders = new Set([plainFs]);
    for (const [opts, part] of cases) {
      const a = resin({ type: 'liquid', colors, density: 0.5, ...opts });
      const patch = insidePatch(a, FLAGS);
      expect(Object.keys(patch).sort()).toEqual(['interior', 'uniforms']);
      expect(patch.interior.main).toBe(marchWithUp());
      expect(patch.interior.pars).toContain(INTERIOR_PARS);
      expect(count(patch.interior.pars, NOISE_GLSL)).toBe(1);
      const { body } = liquidExtrasInside(a);
      expect(patch.interior.pars).toContain(body);
      for (const l of LIQ_LINES) expect(body).toContain(l);
      // gravity: the bubble up along dcIUp, the sand down (heights measured along dcIUp)
      expect(count(body, '#define DC_LQ_BUBBLE')).toBe(opts.bubble ? 1 : 0);
      expect(count(body, '#define DC_LQ_SAND')).toBe(opts.sand ? 1 : 0);
      // the sand: a warm sand tone tinted 25% towards colors[1], whatever the liquid's colours
      expect(body).toContain('vec3 base = mix( vec3( 0.78, 0.66, 0.46 ), uInteriorColors[ 1 ], 0.25 );');
      expect(body).toContain('vec3 dcLqBt = DC_LQ_REF - dot( DC_LQ_REF, dcIUp ) * dcIUp;');
      expect(body).toContain('vec3 dcLqBc = dcIUp * DC_LQ_BH + dcLqBt * DC_LQ_BO;');
      expect(body).toContain('dot( p, dcIUp )');
      expect(body).not.toMatch(/\b(dFdx|dFdy|fwidth)\b/);
      for (const [, base] of body.matchAll(/pow\( ([^,]+),/g)) expect(base).toMatch(/^max\(/);
      const own = [...body.matchAll(/\b(?:vec[234]|float|int|bool|mat[23])\s+(dc\w+)\s*\(/g)].map((x) => x[1]);
      expect(own.length).toBeGreaterThan(1);
      for (const name of own) if (name !== 'dcInterior') expect(name).toMatch(/^dcLq/);
      const m = mat(a);
      expect(m.userData.programKey).toContain(part);
      const fs = patched(m).fragmentShader;
      expect(count(fs, body)).toBe(1);
      expect(count(fs, 'vec3 dcIUp;')).toBe(1);
      expect(count(fs, UP_LINE)).toBe(1);
      expect(count(fs, 'vec4 dcInterior( vec3 p, vec3 rd, float dt )')).toBe(1);
      keys.add(m.userData.programKey);
      shaders.add(fs);
      // one program per option set, for every colour and density
      const other = mat(resin({ type: 'liquid', colors: ['#d14a1f', '#ffe0b0'], density: 0.8, ...opts }));
      expect(other.userData.programKey).toBe(m.userData.programKey);
      expect(patched(other).fragmentShader).toBe(fs);
      expect(() => createDiceMaterial(a, atlas, getShape('d2'), labels, FLAGS)).not.toThrow();
      // fake mode: plain liquid's fake (no patch, the same tint and program)
      expect(insidePatch(a, low)).toEqual({});
      const lowM = mat(a, low);
      expect(lowM.userData.programKey).toBe(plainLow.userData.programKey);
      expect(lowM.userData.uniforms.uResinTint.value.toArray()).toEqual(plainLow.userData.uniforms.uResinTint.value.toArray());
      expect(patched(lowM).fragmentShader).toBe(patched(plainLow).fragmentShader);
    }
    expect(keys.size).toBe(4);
    expect(shaders.size).toBe(4);
    // the bubble (radius about 0.09) just inside the volume at the top; the sand up to about 22%
    // of the volume's height at the bottom
    expect(LQ.radius).toBe(INTERIOR.radius); // liquid-extras' local copy
    expect(LQ.bubbleRadius).toBeCloseTo(0.09, 6);
    const reach = Math.hypot(LQ.bubbleHeight, LQ.bubbleOffset) + LQ.bubbleRadius;
    expect(reach).toBeLessThan(INTERIOR.radius);
    expect(reach).toBeGreaterThan(INTERIOR.radius - 0.1);
    // at the top: its centre within 25 degrees of up
    expect(LQ.bubbleOffset / LQ.bubbleHeight).toBeLessThan(Math.tan((25 * Math.PI) / 180));
    expect(Math.hypot(...LQ.bubbleRef)).toBeCloseTo(1, 9);
    expect((LQ.sandTop + INTERIOR.radius) / (2 * INTERIOR.radius)).toBeCloseTo(0.22, 2);
  });

  test('liquid bubble: the segment liquid is split at the bubble hit, front to back (liquid, bubble, liquid, sand)', () => {
    const { body } = liquidExtrasInside(
      resin({ type: 'liquid', colors: ['#1f7fd1', '#bfe6ff'], density: 0.5, bubble: true, sand: true }),
    );
    expect(body).toContain('vec4 dcLqBubble( vec3 o, vec3 rd, float dt, float b, float oo, float m2, out float th )');
    const main = body.slice(body.indexOf('vec4 dcInterior('));
    const before = main.indexOf('dcLqLiquid( p, min( la, lim )');
    const bubble = main.indexOf('( 1.0 - acc.a ) * front');
    const after = main.indexOf('dcLqLiquid( p + rd * lb');
    const sand = main.indexOf('( 1.0 - acc.a ) * back');
    expect(before).toBeGreaterThan(0);
    expect(bubble).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(bubble);
    expect(sand).toBeGreaterThan(after);
    // bounded: lengths clamped to [0, dt]
    expect(main).toContain('max( lim - lb, 0.0 )');
  });

  test('fake mode: uResinTint.w = INSIDE_TINT.foil, no interior chunk', () => {
    expect(INSIDE_TINT).toEqual({ foil: 0.15, eye: 0.2, botanical: 0.25, smoke: 0.4 });
    const low = { ...FLAGS, interiorSteps: 0 };
    const a = resin({ type: 'foil', colors: ['#ffcf5a', '#d9814a'] }, { color: '#304050' });
    const patch = insidePatch(a, low);
    expect(Object.keys(patch)).toEqual(['uniforms']);
    const m = mat(a, low);
    expect(m.userData.programKey).toContain('|none|');
    expect(m.defines.DICER_INTERIOR).toBeUndefined();
    const fs = patched(m).fragmentShader;
    expect(fs).not.toContain('dcInterior');
    expect(fs).not.toContain('dcIUp');
    const t = m.userData.uniforms.uResinTint.value;
    expect(t.w).toBeCloseTo(INSIDE_TINT.foil, 6);
    // the target is createDiceMaterial's: colors[0]'s hue at the body's luminance (linear)
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const c0 = new THREE.Color('#ffcf5a');
    const want = c0.clone().multiplyScalar(lum(new THREE.Color('#304050')) / lum(c0));
    expect([t.x, t.y, t.z].map((v) => +v.toFixed(6))).toEqual([want.r, want.g, want.b].map((v) => +v.toFixed(6)));
    // a glitter look's tint is untouched (same body, same colours)
    const g = mat(resin({ type: 'glitter', colors: ['#ffcf5a', '#d9814a'] }, { color: '#304050' }), low);
    expect(g.userData.uniforms.uResinTint.value.toArray().slice(0, 3)).toEqual([t.x, t.y, t.z]);
    // every new inside has a share at low, built or not
    for (const type of Object.keys(INSIDE_TINT)) {
      const p = insidePatch(resin({ type }), low);
      expect(p.uniforms.uResinTint.value.w).toBeCloseTo(INSIDE_TINT[type], 6);
    }
  });

  test('every new inside and liquid option draws (its patch or the fallback look), never throws, at every step count', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const cases = [
        ...['foil', 'eye', 'botanical', 'smoke'].map((type) => ({ type })),
        { type: 'liquid', bubble: true },
        { type: 'liquid', sand: true },
        { type: 'liquid', bubble: true, sand: true },
        ...['sword', 'axe', 'shield', 'dragon', 'runes'].map((shape) => ({ type: 'shape', shape })),
      ];
      for (const it of cases) {
        for (const steps of [48, 32, 16, 0]) {
          for (const shape of [s, getShape('d2')]) {
            const f = { ...FLAGS, interiorSteps: steps };
            const a = resin(it);
            let m;
            expect(() => (m = createDiceMaterial(a, atlas, shape, labels, f))).not.toThrow();
            const fs = patched(m).fragmentShader;
            let patch = null;
            try {
              patch = insidePatch(a, f);
            } catch {
              // a type without a module: the material must be the fallback look's
            }
            if (patch?.interior) {
              expect(fs).toContain(patch.interior.main);
              expect(m.userData.programKey).toBe(programKey(a, f));
            } else if (patch) {
              expect(steps).toBe(0);
              expect(fs).not.toContain('dcInterior');
            } else {
              expect(steps).toBeGreaterThan(0);
              expect(m.userData.programKey).toBe(programKey(fallbackLook(a), f));
              expect(fs).toContain('dcInterior');
            }
          }
        }
      }
    } finally {
      warn.mockRestore();
    }
  });

  test('new shapes: marched builds the module, fake is {}, plain shapes stay {}', () => {
    for (const shape of ['sword', 'axe', 'shield', 'dragon', 'runes']) {
      const a = resin({ type: 'shape', shape });
      expect(insidePatch(a, FLAGS).interior.pars).toContain('dcInterior');
      expect(insidePatch(a, { ...FLAGS, interiorSteps: 0 })).toEqual({});
      expect(insidePatch(a, { ...FLAGS, interiors: false })).toEqual({});
    }
    for (const shape of ['star', 'heart', 'skull', 'sphere']) expect(insidePatch(resin({ type: 'shape', shape }), FLAGS)).toEqual({});
  });

  test('the shared up frame: one axis for dragon and runes, the same frame in JS and GLSL', () => {
    expect(DRAGON.axis).toBe(CARD_AXIS);
    expect(RUNES.axis).toBe(CARD_AXIS);
    for (const up of [[0, 1, 0], [0.6, 0.8, 0], [0, 0, 1], CARD_AXIS]) {
      const fr = upFrame(up, CARD_AXIS);
      expect(dragonFrame(up)).toEqual(fr);
      expect(runesFrame(up)).toEqual(fr);
      expect(Math.hypot(...fr.t1)).toBeCloseTo(1, 6);
      expect(fr.t1[0] * up[0] + fr.t1[1] * up[1] + fr.t1[2] * up[2]).toBeCloseTo(0, 4); // (CARD_AXIS is unit only to 4 places)
    }
    const gl = upFrameGLSL('dcXx', 'vec3( 1.0, 0.0, 0.0 )');
    expect(gl).toContain('vec3 dcXxA = vec3( 1.0, 0.0, 0.0 );');
    expect(gl).toContain('vec3 dcXxT = dcXxA - dot( dcXxA, dcXxN ) * dcXxN;');
    expect(gl).toContain('if ( dot( dcXxT, dcXxT ) < 1e-6 ) dcXxT = dcXxA.zxy - dot( dcXxA.zxy, dcXxN ) * dcXxN;');
    expect(gl).toContain('dcXxT1 = normalize( dcXxT );');
    expect(gl).toContain('dcXxT2 = cross( dcXxN, dcXxT1 );');
  });

  test('safety net: a non-built-in shape without a module throws, and the material draws the star fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved = MODULES.dragon;
    try {
      delete MODULES.dragon; // a shape in the world-start list that the chunk does not know
      const a = resin({ type: 'shape', shape: 'dragon' });
      expect(() => insidePatch(a, FLAGS)).toThrow(/no inside module/);
      expect(insidePatch(a, { ...FLAGS, interiorSteps: 0 })).toEqual({});
      let m;
      expect(() => (m = mat(a, FLAGS))).not.toThrow();
      expect(m.userData.programKey).toBe(programKey(fallbackLook(a), FLAGS));
      expect(fallbackLook(a).interior.shape).toBe('star');
      expect(patched(m).fragmentShader).toContain('dcInterior');
      // a shape id nothing knows throws the same way
      expect(() => insidePatch({ ...a, interior: { ...a.interior, shape: 'ghost' } }, FLAGS)).toThrow(/no inside module/);
    } finally {
      MODULES.dragon = saved;
      warn.mockRestore();
    }
  });

  test('the built-in list is the keys of interior.js SDF_NAME; the modules are the world-start SHAPES minus them', () => {
    const sdf = /const SDF_NAME = \{([^}]*)\}/.exec(readFileSync('src/render/shaders/interior.js', 'utf8'))[1];
    const builtIn = [...sdf.matchAll(/(\w+):/g)].map((x) => x[1]);
    expect(builtIn).toEqual(['star', 'heart', 'skull', 'sphere']);
    const src = readFileSync('src/look/appearance.js', 'utf8');
    const shapes = JSON.parse(/^const SHAPES = (\[[^\]]*\]);/m.exec(src)[1].replace(/'/g, '"'));
    const fantasy = shapes.filter((x) => !builtIn.includes(x));
    expect(Object.keys(MODULES).filter((k) => shapes.includes(k)).sort()).toEqual([...fantasy].sort());
    for (const shape of shapes) {
      const a = resin({ type: 'shape', shape });
      expect(!!insidePatch(a, FLAGS).interior).toBe(fantasy.includes(shape));
    }
  });

  test("today's four shapes unpatched and byte-identical with the chunk loaded", async () => {
    const FL = [{ ...FLAGS, interiorSteps: 48 }, FLAGS, { ...FLAGS, interiorSteps: 16 }, { ...FLAGS, interiorSteps: 0 }];
    const cases = ['star', 'heart', 'skull', 'sphere'].map((shape) => resin({ type: 'shape', shape, colors: ['#5a2e1a', '#e0b040'], density: 0.5 }));
    const run = () =>
      cases.flatMap((a) =>
        FL.flatMap((f) =>
          [s, getShape('d2')].map((shape) => {
            const m = createDiceMaterial(a, atlas, shape, labels, f);
            return { fs: patched(m).fragmentShader, defines: { ...m.defines }, key: m.userData.programKey };
          }),
        ),
      );
    for (const a of cases) {
      expect(needsLookExtras(a)).toBe(false); // no chunk import for them
      for (const f of FL) expect(insidePatch(a, f)).toEqual({});
    }
    const loaded = run();
    for (const m of loaded) expect(m.fs).not.toContain('dcWe');
    _setLookExtrasImport(() => new Promise(() => {}));
    try {
      const missing = run();
      missing.forEach((m, i) => {
        expect(m.fs).toBe(loaded[i].fs);
        expect(m.defines).toEqual(loaded[i].defines);
        expect(m.key).toBe(loaded[i].key);
      });
    } finally {
      _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
      await requestLookExtras();
    }
  });

  test('sword/axe/shield: patch interior, distinct keys, DC_WE_KIND per shape, uShapeRot used, no derivatives, dcWe prefix', () => {
    expect(WE_KINDS).toEqual(['sword', 'axe', 'shield']);
    const keys = new Set();
    WE_KINDS.forEach((shape, kind) => {
      const a = resin({ type: 'shape', shape, colors: ['#5a2e1a', '#e0b040'], density: 0.5 });
      expect(needsLookExtras(a)).toBe(true);
      const patch = insidePatch(a, FLAGS);
      expect(Object.keys(patch).sort()).toEqual(['interior', 'uniforms']);
      expect(patch.interior.main).toBe(marchWithUp());
      expect(patch.interior.pars).toContain(INTERIOR_PARS);
      const { body } = weaponsInside(a);
      expect(patch.interior.pars).toContain(body);
      // the kind selects the shape and its zones: one define per program
      expect(count(body, '#define DC_WE_KIND')).toBe(1);
      expect(body).toContain(`#define DC_WE_KIND ${kind}\n`);
      // rotated by uShapeRot (declared here: INTERIOR_PARS does not), scaled by
      // shapeScale x mix(0.8, 1.15, density)
      expect(INTERIOR_PARS).not.toContain('uShapeRot');
      expect(count(body, 'uniform mat3 uShapeRot;')).toBe(1);
      expect(body).toMatch(/uShapeRot \* p\b/);
      expect(body).toContain(`${INTERIOR.shapeScale.toFixed(4)} * mix( 0.8, 1.15, uInteriorDensity )`);
      // the shape march: refinement on a hit, a soft silhouette and a colors[1] haze halo
      expect(body).toMatch(/for \( int dcWeB = 0; dcWeB < 4; dcWeB \+\+ \)/);
      expect(body).toContain('DC_WE_AA');
      expect(body).toMatch(/uInteriorColors\[ 1 \] \* \( dcILight \+ 0\.4 \) \* a/);
      expect(body).toContain('vec4 dcInterior( vec3 p, vec3 rd, float dt )');
      expect(body).not.toMatch(/\b(dFdx|dFdy|fwidth)\b/);
      // pow() only of bases that cannot be negative
      for (const [, base] of body.matchAll(/pow\( ([^,]+),/g)) expect(base).toMatch(/^(max\(|clamp\(|rk$|rc$)/);
      expect(body).toMatch(/float rk = max\(/);
      expect(body).toMatch(/float rc = max\(/);
      // dcWe names only (besides the shared interior names)
      const own = [...body.matchAll(/\b(?:vec[234]|float|int|bool|mat[23])\s+(dc\w+)\s*[(;=]/g)].map((x) => x[1]);
      expect(own.length).toBeGreaterThan(3);
      for (const name of own) if (name !== 'dcInterior') expect(name).toMatch(/^dcWe/);
      for (const [, name] of body.matchAll(/#define (\w+)/g)) expect(name).toMatch(/^DC_WE_/);
      const m = mat(a);
      const key = m.userData.programKey;
      expect(key).toContain(`|shape:${shape}:32|`);
      keys.add(key);
      const fs = patched(m).fragmentShader;
      expect(fs).toContain(patch.interior.pars);
      expect(fs).toContain(patch.interior.main);
      expect(count(fs, 'uniform mat3 uShapeRot;')).toBe(1);
      expect(count(fs, 'vec4 dcInterior( vec3 p, vec3 rd, float dt )')).toBe(1);
      expect(count(fs, 'vec3 dcIUp;')).toBe(1);
      expect(m.userData.uniforms.uShapeRot).toBeDefined();
      // one program for every colour and density
      const other = mat(resin({ type: 'shape', shape, colors: ['#8a1f1f', '#d9a93a'], density: 0.9 }));
      expect(other.userData.programKey).toBe(key);
      expect(patched(other).fragmentShader).toBe(fs);
      // every step count and the coin
      for (const steps of [48, 16]) expect(() => mat(a, { ...FLAGS, interiorSteps: steps })).not.toThrow();
      expect(() => createDiceMaterial(a, atlas, getShape('d2'), labels, FLAGS)).not.toThrow();
      // fake mode keeps today's shape tint (world-start INTERIOR_TINT.shape): no patch
      expect(insidePatch(a, { ...FLAGS, interiorSteps: 0 })).toEqual({});
    });
    expect(keys.size).toBe(3);
  });

  test('weapons: a continuous right-handed up frame, no mirror, off its singular axis at every rest', () => {
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = (v) => v.map((x) => x / Math.hypot(...v));
    const axis = unit(WEAPON.axis);
    for (const shape of WE_KINDS) {
      const { body } = weaponsInside(resin({ type: 'shape', shape }));
      // the GLSL builds the same frame as weaponFrame: no sign switch anywhere
      expect(body).toContain('dcWeN = uShapeRot * dcIUp;');
      expect(body).toContain(`vec3 dcWeA = vec3( ${WEAPON.axis.map((x) => x.toFixed(4)).join(', ')} );`);
      expect(body).toContain('if ( dot( dcWeT, dcWeT ) < 1e-6 ) dcWeT = dcWeA.zxy - dot( dcWeA.zxy, dcWeN ) * dcWeN;');
      expect(body).toContain('dcWeT2 = cross( dcWeN, dcWeT1 );');
      expect(body).toContain('vec3 q = vec3( dot( q0, dcWeT1 ), dot( q0, dcWeT2 ), dot( q0, dcWeN ) );');
      expect(body).not.toMatch(/dcWeFace|dcWeAlign|\? - 1\.0 : 1\.0/);
    }
    expect(WEAPON.axis[2]).toBe(0); // in the coin's plane
    const check = (fr) => {
      expect(dot(fr.n, fr.n)).toBeCloseTo(1, 9);
      expect(dot(fr.t1, fr.t1)).toBeCloseTo(1, 9);
      expect(dot(fr.t1, fr.n)).toBeCloseTo(0, 9);
      // right-handed: t1 x t2 = n (a rotation, never a mirror)
      cross(fr.t1, fr.t2).forEach((x, i) => expect(x).toBeCloseTo(fr.n[i], 9));
    };
    // every die's resting ups (face normals, both signs) and the coin's caps
    const rests = [];
    for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
      const sh = getShape(type);
      for (const fc of sh.faces) {
        const n = [0, 0, 0];
        fc.forEach((vi, k) => {
          const [a, b] = [sh.vertices[vi], sh.vertices[fc[(k + 1) % fc.length]]];
          n[0] += (a[1] - b[1]) * (a[2] + b[2]);
          n[1] += (a[2] - b[2]) * (a[0] + b[0]);
          n[2] += (a[0] - b[0]) * (a[1] + b[1]);
        });
        rests.push([unit(n), SHAPE_ROT.die], [unit(n.map((x) => -x)), SHAPE_ROT.die]);
      }
    }
    rests.push([[0, 1, 0], SHAPE_ROT.coin], [[0, -1, 0], SHAPE_ROT.coin]);
    for (const [up, rot] of rests) {
      const fr = weaponFrame(up, rot);
      check(fr);
      expect(Math.abs(dot(axis, fr.n))).toBeLessThan(0.94);
    }
    // continuous tumbles: slerp paths between pseudo-random orientations; the die's up in its
    // own frame is R^T (0, 1, 0). Adjacent samples (< 0.01 rad apart) keep the frame within
    // 0.05, except within about 11 degrees of the two singular directions (n along +-axis)
    let seed = 777;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const quat = () => unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
    const slerp = (a, b, t) => {
      let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
      const bb = d < 0 ? b.map((x) => -x) : b;
      d = Math.abs(d);
      if (d > 0.9995) return unit(a.map((x, i) => x + t * (bb[i] - x)));
      const th = Math.acos(d);
      return a.map((x, i) => (Math.sin((1 - t) * th) * x + Math.sin(t * th) * bb[i]) / Math.sin(th));
    };
    // up in the die frame: rotate (0,1,0) by the conjugate of q = (x, y, z, w)
    const localUp = ([x, y, z, w]) => {
      const [qx, qy, qz] = [-x, -y, -z];
      const v = [0, 1, 0];
      const tt = cross([qx, qy, qz], v).map((c) => 2 * c);
      const c2 = cross([qx, qy, qz], tt);
      return v.map((c, i) => c + w * tt[i] + c2[i]);
    };
    let jumps = 0;
    let samples = 0;
    for (let path = 0; path < 60; path++) {
      const [qa, qb] = [quat(), quat()];
      for (const rot of [SHAPE_ROT.die, SHAPE_ROT.coin]) {
        let prev = null;
        for (let k = 0; k <= 400; k++) {
          const fr = weaponFrame(unit(localUp(slerp(qa, qb, k / 400))), rot);
          check(fr);
          if (prev) {
            samples++;
            const step = Math.max(Math.hypot(...fr.t1.map((x, i) => x - prev.t1[i])), Math.hypot(...fr.n.map((x, i) => x - prev.n[i])));
            const nearAxis = Math.max(Math.abs(dot(axis, fr.n)), Math.abs(dot(axis, prev.n))) > 0.98;
            if (step > 0.05) {
              expect(nearAxis).toBe(true);
              jumps++;
            }
          }
          prev = fr;
        }
      }
    }
    // (the two 11-degree caps are 1.8 % of all directions; fast turns happen only inside them)
    expect(jumps / samples).toBeLessThan(0.01);
  });

  test('weapons: every kind fits inside the march sphere at density 1; blade edges >= 0.02 at density 0', () => {
    expect(WEAPON.shapeScale).toBe(INTERIOR.shapeScale); // the local copy
    for (const shape of WE_KINDS) expect(WEAPON.extent[shape] * WEAPON.shapeScale * 1.15 + WEAPON.aa).toBeLessThanOrEqual(INTERIOR.radius);
    expect(WEAPON.edgeUnit * WEAPON.shapeScale * 0.8).toBeGreaterThanOrEqual(0.02);
    const body = (shape) => weaponsInside(resin({ type: 'shape', shape })).body;
    // the geometry the extents and the edge come from
    const sword = body('sword');
    expect(sword).toContain('float d2 = max( ( ax - w ) * 0.8, max( - 0.66 - q.y, q.y - 1.5 ) );');
    expect(sword).toContain('float halfT = mix( 0.066, 0.028, e ) - 0.024 * fuller;');
    expect(sword).toContain('* ( abs( q.z ) - halfT ) ) - 0.008, 0.0,');
    expect(sword).toContain("vec3 pm = q - vec3( 0.0, - 1.36, 0.0 );");
    expect(sword).toContain('length( pm ) - 0.11');
    const axe = body('axe');
    expect(axe).toContain('halfT = mix( halfT, 0.028, bevel );');
    expect(axe).toContain('float outer = length( c - vec2( 0.02, 0.0 ) ) - 0.74;');
    expect(axe).toContain('+ vec2( 0.1350, -0.1750 )');
    // the axe blade's furthest point (the horns), sampled in the unit frame
    let far = 0;
    for (let x = -0.1; x <= 0.8; x += 0.0025)
      for (let y = -0.8; y <= 0.8; y += 0.0025) {
        const d2 = Math.max(Math.hypot(x - 0.02, y) - 0.74, 0.5 - Math.hypot(x - 0.12, y - 0.63), 0.5 - Math.hypot(x - 0.12, y + 0.63), 0.04 - x);
        if (d2 <= 0.008) far = Math.max(far, Math.hypot(x - 0.135, y + 0.78 + 0.175));
      }
    expect(far + 0.001).toBeLessThanOrEqual(WEAPON.extent.axe);
    expect(body('shield')).toContain('const float R = 1.15;');
    expect(body('shield')).toContain('length( vec2( rr - R, q.z - zE ) ) - 0.075');
    expect(Math.hypot(1.15, 0.1) + 0.075).toBeLessThanOrEqual(WEAPON.extent.shield);
  });

  test('dragon: patch interior, dcIUp-facing card (frame from dcIUp), inside the march sphere at density 1 over all die rest directions, dcDr prefix, no derivatives', () => {
    const a = resin({ type: 'shape', shape: 'dragon', colors: ['#8a1c1c', '#d9603a'], density: 0.5 });
    expect(needsLookExtras(a)).toBe(true);
    const patch = insidePatch(a, FLAGS);
    expect(Object.keys(patch).sort()).toEqual(['interior', 'uniforms']);
    expect(patch.interior.main).toBe(marchWithUp());
    expect(patch.interior.pars).toContain(INTERIOR_PARS);
    const { body } = dragonInside(a);
    expect(patch.interior.pars).toContain(body);
    expect(patch.interior.pars).not.toContain(NOISE_GLSL);
    // the card: through the centre, facing dcIUp, tested exactly against the segment (plane hit,
    // then the disc of radius mix(DRAGON.radius, density))
    expect(body).toContain('vec3 n = dcIUp;');
    expect(body).toContain('float t = - dot( p, n ) / dn;');
    expect(body).toContain('if ( t < 0.0 || t >= dt ) return vec4( 0.0 );');
    expect(body).toContain(`float R = mix( ${DRAGON.radius.map((x) => x.toFixed(4)).join(', ')}, uInteriorDensity );`);
    expect(body).toContain('if ( dot( q, q ) >= R * R ) return vec4( 0.0 );');
    // the continuous, right-handed frame from dcIUp (dragonFrame in JS): no sign switch
    expect(body).toContain(`vec3 dcDrA = vec3( ${DRAGON.axis.map((x) => x.toFixed(4)).join(', ')} );`);
    expect(body).toContain('vec3 dcDrN = n;');
    expect(body).toContain('vec3 dcDrT = dcDrA - dot( dcDrA, dcDrN ) * dcDrN;');
    expect(body).toContain('if ( dot( dcDrT, dcDrT ) < 1e-6 ) dcDrT = dcDrA.zxy - dot( dcDrA.zxy, dcDrN ) * dcDrN;');
    expect(body).toContain('dcDrT2 = cross( dcDrN, dcDrT1 );');
    expect(body).toContain('vec2 uv = vec2( dot( q, dcDrT1 ), dot( q, dcDrT2 ) ) / R;');
    expect(body).not.toMatch(/dcIUp\.[xyz]|sign\( n|sign\( dcIUp/);
    // two-sided, lit by dcILight and the key light; colours clamped
    expect(body).toMatch(/nf = dot\( rd, nf \) > 0\.0 \? - nf : nf;/);
    expect(body).toContain('dcILight');
    expect(body).toContain('dcIKey');
    expect(body).toContain('return vec4( min( col, vec3( 1.0 ) ) * m.a, m.a );');
    // the parts: wings (colors[1] membranes, colors[0] bones), spine and spade, legs and claws, head
    for (const part of ['dcDrPoly', 'DC_DR_SCAL', 'DC_DR_BONEA', 'DC_DR_SP', 'DC_DR_LEGA', 'DC_DR_CLAWA', 'DC_DR_HORNA', 'float scale', 'float plate', 'float tooth'])
      expect(body).toContain(part);
    expect(body).toContain('vec4 dcInterior( vec3 p, vec3 rd, float dt )');
    expect(body).not.toMatch(/\b(dFdx|dFdy|fwidth)\b/);
    // pow() only of bases that cannot be negative
    for (const [, base] of body.matchAll(/pow\( ([^,]+),/g)) expect(base).toMatch(/^(max\(|clamp\(|rk$)/);
    expect(body).toMatch(/float rk = max\(/);
    // atan never of (0, 0)
    for (const [call] of body.matchAll(/atan\( [a-z][^;]*/g)) expect(call).toContain('1e-6');
    // dcDr names only (besides the shared interior names)
    const own = [...body.matchAll(/\b(?:vec[234]|float|int|bool|mat[23]|void)\s+(dc\w+)\s*[(;=]/g)].map((x) => x[1]);
    expect(own.length).toBeGreaterThan(3);
    for (const name of own) if (name !== 'dcInterior') expect(name).toMatch(/^dcDr/);
    for (const [, name] of body.matchAll(/#define (\w+)/g)) expect(name).toMatch(/^DC_DR_/);
    for (const [, name] of body.matchAll(/const \w+ (\w+)\s*\[/g)) expect(name).toMatch(/^DC_DR_/);
    // the program: its own key, one for every colour and density, every tier and the coin
    const m = mat(a);
    const key = m.userData.programKey;
    expect(key).toContain('|shape:dragon:32|');
    const fs = patched(m).fragmentShader;
    expect(fs).toContain(patch.interior.pars);
    expect(count(fs, 'vec4 dcInterior( vec3 p, vec3 rd, float dt )')).toBe(1);
    expect(count(fs, 'vec3 dcIUp;')).toBe(1);
    const other = mat(resin({ type: 'shape', shape: 'dragon', colors: ['#1f5a2e', '#6fbf5a'], density: 0.9 }));
    expect(other.userData.programKey).toBe(key);
    expect(patched(other).fragmentShader).toBe(fs);
    for (const steps of [48, 16]) expect(() => mat(a, { ...FLAGS, interiorSteps: steps })).not.toThrow();
    expect(() => createDiceMaterial(a, atlas, getShape('d2'), labels, FLAGS)).not.toThrow();
    expect(insidePatch(a, { ...FLAGS, interiorSteps: 0 })).toEqual({});
    // geometry: the dragon inside the unit card (with an anti-alias margin) and, at density 1,
    // inside the march sphere (whatever the frame: the card is a disc through the centre)
    const ext = dragonExtent();
    expect(ext + DRAGON.aa[0] + DRAGON.aa[1]).toBeLessThan(1);
    expect(ext * DRAGON.radius[1]).toBeLessThan(0.6);
    expect(DRAGON.radius[1]).toBeLessThan(INTERIOR.radius);
    // every die's resting ups (face normals, both signs), the coin's caps and sampled directions:
    // the card faces up exactly, its frame orthonormal and right-handed (never mirrored), and the
    // frame's axis is off every rest (a quick turn only far from any rest)
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const unit = (v) => v.map((x) => x / Math.hypot(...v));
    const axis = unit(DRAGON.axis);
    expect(Math.hypot(...DRAGON.axis)).toBeCloseTo(1, 3);
    const check = (fr, up) => {
      fr.n.forEach((x, i) => expect(x).toBeCloseTo(up[i], 9));
      expect(dot(fr.t1, fr.t1)).toBeCloseTo(1, 9);
      expect(dot(fr.t1, fr.n)).toBeCloseTo(0, 9);
      cross(fr.t1, fr.t2).forEach((x, i) => expect(x).toBeCloseTo(fr.n[i], 9));
    };
    const rests = [[0, 1, 0], [0, -1, 0]];
    for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
      const sh = getShape(type);
      for (const fc of sh.faces) {
        const n = [0, 0, 0];
        fc.forEach((vi, k) => {
          const [u, v] = [sh.vertices[vi], sh.vertices[fc[(k + 1) % fc.length]]];
          n[0] += (u[1] - v[1]) * (u[2] + v[2]);
          n[1] += (u[2] - v[2]) * (u[0] + v[0]);
          n[2] += (u[0] - v[0]) * (u[1] + v[1]);
        });
        rests.push(unit(n), unit(n.map((x) => -x)));
      }
    }
    for (const up of rests) {
      check(dragonFrame(up), up);
      expect(Math.abs(dot(axis, up))).toBeLessThan(0.93);
    }
    for (const up of [axis, axis.map((x) => -x)]) check(dragonFrame(up), up); // the fallback axis
    // continuous tumbles: slerp paths between pseudo-random orientations (up in the die frame is
    // R^T (0, 1, 0)); adjacent samples keep the frame within 0.05 except near the axis
    let seed = 4242;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const quat = () => unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
    const slerp = (qa, qb, k) => {
      let d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
      const bb = d < 0 ? qb.map((x) => -x) : qb;
      d = Math.abs(d);
      if (d > 0.9995) return unit(qa.map((x, i) => x + k * (bb[i] - x)));
      const th = Math.acos(d);
      return qa.map((x, i) => (Math.sin((1 - k) * th) * x + Math.sin(k * th) * bb[i]) / Math.sin(th));
    };
    const localUp = ([x, y, z, w]) => {
      const qv = [-x, -y, -z];
      const v = [0, 1, 0];
      const tt = cross(qv, v).map((c) => 2 * c);
      const c2 = cross(qv, tt);
      return v.map((c, i) => c + w * tt[i] + c2[i]);
    };
    let jumps = 0;
    let samples = 0;
    for (let path = 0; path < 60; path++) {
      const [qa, qb] = [quat(), quat()];
      let prev = null;
      for (let k = 0; k <= 400; k++) {
        const up = unit(localUp(slerp(qa, qb, k / 400)));
        const fr = dragonFrame(up);
        check(fr, up);
        if (prev) {
          samples++;
          const step = Math.max(Math.hypot(...fr.t1.map((x, i) => x - prev.t1[i])), Math.hypot(...fr.n.map((x, i) => x - prev.n[i])));
          if (step > 0.05) {
            expect(Math.max(Math.abs(dot(axis, fr.n)), Math.abs(dot(axis, prev.n)))).toBeGreaterThan(0.98);
            jumps++;
          }
        }
        prev = fr;
      }
    }
    expect(jumps / samples).toBeLessThan(0.01);
  });

  test('runes: patch interior, dcIUp-facing card, emissive term present and clamped, 12-16 glyph sectors, dcRu prefix, no derivatives', () => {
    const a = resin({ type: 'shape', shape: 'runes', colors: ['#7fd0ff', '#c8a2ff'], density: 0.5 });
    expect(needsLookExtras(a)).toBe(true);
    const patch = insidePatch(a, FLAGS);
    expect(Object.keys(patch).sort()).toEqual(['interior', 'uniforms']);
    expect(patch.interior.main).toBe(marchWithUp());
    expect(patch.interior.pars).toContain(INTERIOR_PARS);
    const { body } = runesInside(a);
    expect(patch.interior.pars).toContain(body);
    expect(patch.interior.pars).not.toContain(NOISE_GLSL);
    const f4 = (x) => x.toFixed(4);
    // the card: through the centre, facing dcIUp, tested exactly against the segment (plane hit,
    // then the disc of radius mix(RUNES.radius, density))
    expect(body).toContain('vec3 n = dcIUp;');
    expect(body).toContain('float h0 = dot( p, n );');
    expect(body).toContain('float dcRuDn = abs( dn ) < 1e-4 ? 1e-4 : dn;');
    expect(body).toContain('float t = - h0 / dcRuDn;');
    expect(body).toContain('if ( abs( dn ) >= 1e-4 && t >= 0.0 && t < dt ) {');
    expect(body).toContain(`float R = mix( ${RUNES.radius.map(f4).join(', ')}, uInteriorDensity );`);
    expect(body).toContain('if ( dot( q, q ) < R * R ) {');
    // the continuous, right-handed frame from dcIUp (runesFrame in JS): no sign switch
    expect(body).toContain(`vec3 dcRuA = vec3( ${RUNES.axis.map(f4).join(', ')} );`);
    expect(body).toContain('vec3 dcRuN = n;');
    expect(body).toContain('vec3 dcRuT = dcRuA - dot( dcRuA, dcRuN ) * dcRuN;');
    expect(body).toContain('if ( dot( dcRuT, dcRuT ) < 1e-6 ) dcRuT = dcRuA.zxy - dot( dcRuA.zxy, dcRuN ) * dcRuN;');
    expect(body).toContain('dcRuT2 = cross( dcRuN, dcRuT1 );');
    expect(body).toContain('vec2 uv = vec2( dot( q, dcRuT1 ), dot( q, dcRuT2 ) ) / R;');
    expect(body).not.toMatch(/dcIUp\.[xyz]|sign\( n|sign\( dcIUp/);
    // emissive: colors[0] x the glow gain (colors[1] for the sigil), not lit by the key light,
    // every segment clamped to <= 1 per channel after the emission is added
    expect(RUNES.glow).toBe(1.6);
    expect(body).toContain('vec3 dcRuG0 = uInteriorColors[ 0 ] * 1.6000;');
    expect(body).toContain('vec3 dcRuG1 = uInteriorColors[ 1 ] * 1.6000;');
    expect(body).not.toContain('dcIKey');
    expect(body).toContain('acc.rgb += ');
    expect(body.trimEnd()).toMatch(/return vec4\( min\( acc\.rgb, vec3\( 1\.0 \) \), clamp\( acc\.a, 0\.0, 1\.0 \) \);\n}$/);
    // the halo: exponential in the height above / below the plane, only inside the circle
    expect(body).toContain('float dcRuHalo(');
    expect(body).toMatch(/exp\( - [^;]*\/ w \)/);
    // glyphs: 12-16 sectors, each from 2-4 strokes (the stem plus hashed branches), all distinct,
    // angular (straight segments on a 3x3 grid)
    expect(RUNES.glyphs).toBeGreaterThanOrEqual(12);
    expect(RUNES.glyphs).toBeLessThanOrEqual(16);
    expect(body).toContain(`#define DC_RU_N ${RUNES.glyphs}`);
    const glyphs = runeGlyphs();
    expect(glyphs).toHaveLength(RUNES.glyphs);
    expect(new Set(glyphs).size).toBe(RUNES.glyphs);
    for (const m of glyphs) {
      const strokes = 1 + [...Array(RU_STROKES.length).keys()].filter((k) => (m >> k) & 1).length;
      expect(strokes).toBeGreaterThanOrEqual(2);
      expect(strokes).toBeLessThanOrEqual(4);
    }
    expect(body).toContain(`const int DC_RU_GLYPH[ ${RUNES.glyphs} ] = int[ ${RUNES.glyphs} ]( ${glyphs.join(', ')} );`);
    for (const [p, q] of [RU_STEM, ...RU_STROKES]) for (const c of [...p, ...q]) expect([-1, 0, 1]).toContain(c);
    // bounded cost: one glyph per point (the sector's), only inside the band, after the disc test
    expect([...body.matchAll(/DC_RU_GLYPH\[ (?!\d)/g)]).toHaveLength(1);
    const band = body.indexOf('if ( r > RU_IN && r < RU_OUT ) {'.replace('RU_IN', f4(RUNES.band[0])).replace('RU_OUT', f4(RUNES.band[1])));
    expect(band).toBeGreaterThan(0);
    expect(body.indexOf('atan(')).toBeGreaterThan(band);
    // the glyphs fit the band between the rings (with the stroke and the anti-alias widths), and
    // never reach the next sector
    const [rIn, rOut] = RUNES.band;
    const rc = (rIn + rOut) / 2;
    const reach = RUNES.glyphSize[1] + RUNES.stroke + RUNES.aa[0];
    expect(rc - reach).toBeGreaterThan(RUNES.rings[2][0] + RUNES.rings[2][1] + RUNES.aa[0]);
    expect(rc + reach).toBeLessThan(RUNES.rings[1][0] - RUNES.rings[1][1] - RUNES.aa[0]);
    expect(rc - reach).toBeGreaterThan(rIn);
    expect(rc + reach).toBeLessThan(rOut);
    expect(RUNES.glyphSize[0] + RUNES.stroke + RUNES.aa[0]).toBeLessThan((rc - RUNES.glyphSize[1]) * Math.sin(Math.PI / RUNES.glyphs) * 0.8);
    // inside the card and the march sphere at density 1
    expect(RUNES.rings[0][0] + RUNES.rings[0][1] + RUNES.aa[0] + RUNES.aa[1]).toBeLessThan(1);
    expect(RUNES.radius[1]).toBeLessThanOrEqual(0.6);
    expect(RUNES.radius[1]).toBeLessThan(INTERIOR.radius);
    // the sigil in colors[1]: a hexagram with a small inner ring
    expect(body).toContain('DC_RU_SIGA');
    expect(body).toMatch(/dcRuG1 \*/);
    // GLSL rules
    expect(body).toContain('vec4 dcInterior( vec3 p, vec3 rd, float dt )');
    expect(body).not.toMatch(/\b(dFdx|dFdy|fwidth)\b/);
    expect(body).not.toMatch(/\bpow\(/);
    for (const [call] of body.matchAll(/atan\( [a-z][^;]*/g)) expect(call).toContain('1e-6');
    const own = [...body.matchAll(/\b(?:vec[234]|float|int|bool|mat[23]|void)\s+(dc\w+)\s*[(;=]/g)].map((x) => x[1]);
    expect(own.length).toBeGreaterThan(3);
    for (const name of own) if (name !== 'dcInterior') expect(name).toMatch(/^dcRu/);
    for (const [, name] of body.matchAll(/#define (\w+)/g)) expect(name).toMatch(/^DC_RU_/);
    for (const [, name] of body.matchAll(/const \w+ (\w+)\s*\[/g)) expect(name).toMatch(/^DC_RU_/);
    // the program: its own key, one for every colour and density, every tier and the coin
    const m = mat(a);
    const key = m.userData.programKey;
    expect(key).toContain('|shape:runes:32|');
    const fs = patched(m).fragmentShader;
    expect(fs).toContain(patch.interior.pars);
    expect(count(fs, 'vec4 dcInterior( vec3 p, vec3 rd, float dt )')).toBe(1);
    const other = mat(resin({ type: 'shape', shape: 'runes', colors: ['#ff9a3a', '#ffd27a'], density: 0.9 }));
    expect(other.userData.programKey).toBe(key);
    expect(patched(other).fragmentShader).toBe(fs);
    for (const steps of [48, 16]) expect(() => mat(a, { ...FLAGS, interiorSteps: steps })).not.toThrow();
    expect(() => createDiceMaterial(a, atlas, getShape('d2'), labels, FLAGS)).not.toThrow();
    expect(insidePatch(a, { ...FLAGS, interiorSteps: 0 })).toEqual({});
    // the frame over every die rest, the coin's caps and tumble paths (as the dragon's)
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const unit = (v) => v.map((x) => x / Math.hypot(...v));
    const axis = unit(RUNES.axis);
    expect(Math.hypot(...RUNES.axis)).toBeCloseTo(1, 3);
    const check = (fr, up) => {
      fr.n.forEach((x, i) => expect(x).toBeCloseTo(up[i], 9));
      expect(dot(fr.t1, fr.t1)).toBeCloseTo(1, 9);
      expect(dot(fr.t1, fr.n)).toBeCloseTo(0, 9);
      cross(fr.t1, fr.t2).forEach((x, i) => expect(x).toBeCloseTo(fr.n[i], 9));
    };
    const rests = [[0, 1, 0], [0, -1, 0]];
    for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
      const sh = getShape(type);
      for (const fc of sh.faces) {
        const n = [0, 0, 0];
        fc.forEach((vi, k) => {
          const [u, v] = [sh.vertices[vi], sh.vertices[fc[(k + 1) % fc.length]]];
          n[0] += (u[1] - v[1]) * (u[2] + v[2]);
          n[1] += (u[2] - v[2]) * (u[0] + v[0]);
          n[2] += (u[0] - v[0]) * (u[1] + v[1]);
        });
        rests.push(unit(n), unit(n.map((x) => -x)));
      }
    }
    for (const up of rests) {
      check(runesFrame(up), up);
      expect(Math.abs(dot(axis, up))).toBeLessThan(0.93);
    }
    for (const up of [axis, axis.map((x) => -x)]) check(runesFrame(up), up);
    let seed = 777;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const quat = () => unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
    const slerp = (qa, qb, k) => {
      let d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
      const bb = d < 0 ? qb.map((x) => -x) : qb;
      d = Math.abs(d);
      if (d > 0.9995) return unit(qa.map((x, i) => x + k * (bb[i] - x)));
      const th = Math.acos(d);
      return qa.map((x, i) => (Math.sin((1 - k) * th) * x + Math.sin(k * th) * bb[i]) / Math.sin(th));
    };
    const localUp = ([x, y, z, w]) => {
      const qv = [-x, -y, -z];
      const v = [0, 1, 0];
      const tt = cross(qv, v).map((c) => 2 * c);
      const c2 = cross(qv, tt);
      return v.map((c, i) => c + w * tt[i] + c2[i]);
    };
    let jumps = 0;
    let samples = 0;
    for (let path = 0; path < 60; path++) {
      const [qa, qb] = [quat(), quat()];
      let prev = null;
      for (let k = 0; k <= 400; k++) {
        const up = unit(localUp(slerp(qa, qb, k / 400)));
        const fr = runesFrame(up);
        check(fr, up);
        if (prev) {
          samples++;
          const step = Math.max(Math.hypot(...fr.t1.map((x, i) => x - prev.t1[i])), Math.hypot(...fr.n.map((x, i) => x - prev.n[i])));
          if (step > 0.05) {
            expect(Math.max(Math.abs(dot(axis, fr.n)), Math.abs(dot(axis, prev.n)))).toBeGreaterThan(0.98);
            jumps++;
          }
        }
        prev = fr;
      }
    }
    expect(jumps / samples).toBeLessThan(0.01);
  });

  test('mergePatches: interior, last wins', () => {
    const i1 = { pars: '1', main: '1' };
    const i2 = { pars: '2', main: '2' };
    expect(mergePatches({ interior: i1 }, {}).interior).toBe(i1);
    expect(mergePatches({ interior: i1 }, { interior: i2 }).interior).toBe(i2);
    expect(mergePatches({}).interior).toBeUndefined();
  });
});

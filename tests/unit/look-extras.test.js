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
import { insidePatch, INSIDE_TINT, marchWithUp } from '../../src/render/extras/insides/index.js';
import { INTERIOR, INTERIOR_MARCH, INTERIOR_PARS, interiorChunk } from '../../src/render/shaders/interior.js';
import { MARCH_RADIUS } from '../../src/render/extras/insides/foil.js';
import { eyeInside } from '../../src/render/extras/insides/eye.js';
import { BO_KINDS, CARDS, CARD_RADIUS, TILT, botanicalInside, cardFrames } from '../../src/render/extras/insides/botanical.js';
import { smokeInside } from '../../src/render/extras/insides/smoke.js';
import { LQ, liquidExtrasInside } from '../../src/render/extras/insides/liquid-extras.js';
import { NOISE_GLSL } from '../../src/render/shaders/noise.js';
import { fallbackLook } from '../../src/look/appearance.js';

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
    const FL = [FLAGS, { ...FLAGS, interiorSteps: 16 }, { ...FLAGS, interiorSteps: 0 }];
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
      expect(insidePatch(resin(it, { luminous: 1 }), FLAGS)).toEqual({});
      expect(lookExtras.patchMaterial(resin(it, { luminous: 1 }), FLAGS, {}).interior).toBeUndefined();
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

  test('mergePatches: interior, last wins', () => {
    const i1 = { pars: '1', main: '1' };
    const i2 = { pars: '2', main: '2' };
    expect(mergePatches({ interior: i1 }, {}).interior).toBe(i1);
    expect(mergePatches({ interior: i1 }, { interior: i2 }).interior).toBe(i2);
    expect(mergePatches({}).interior).toBeUndefined();
  });
});

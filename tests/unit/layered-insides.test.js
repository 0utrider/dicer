import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { normalizeAppearance, programKey, needsLookExtras, fallbackLook, DEFAULT_APPEARANCE } from '../../src/look/appearance.js';
import { LOOKS } from '../../src/look/looks.js';
import { insidePatch } from '../../src/render/extras/insides/index.js';
import { insideMotion } from '../../src/render/extras/insides/live.js';
import { EXTRA_KINDS, extraLayer } from '../../src/render/extras/insides/extra.js';
import { formFromAppearance, appearanceFromForm, visibleSections, setField, EXTRA_LIST } from '../../src/ui/appearance-form.js';
import { _setLookExtrasImport, requestLookExtras } from '../../src/render/extras-loader.js';
import { createDiceMaterial } from '../../src/render/dice-material.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';

const F = { interiors: true, engraving: true, glow: false, effects: true, interiorSteps: 32, insideMotion: false };
const MO = { ...F, insideMotion: true };
const ins = (i, b) => normalizeAppearance({ body: { type: 'resin', ...b }, interior: i });
const count = (text, part) => text.split(part).length - 1;

describe('layered insides: the appearance model', () => {
  test('motion, extra, extraColor and extraDensity normalise; unknown values fall back', () => {
    expect(DEFAULT_APPEARANCE.interior).toMatchObject({ motion: true, extra: 'none', extraColor: '#ffffff', extraDensity: 0.5 });
    expect(ins({}).interior).toMatchObject({ motion: true, extra: 'none' });
    expect(ins({ motion: false }).interior.motion).toBe(false);
    for (const v of [0, 'false', null, {}]) expect(ins({ motion: v }).interior.motion).toBe(true);
    for (const extra of EXTRA_KINDS) expect(ins({ extra }).interior.extra).toBe(extra);
    for (const extra of ['confetti', 3, null, {}]) expect(ins({ extra }).interior.extra).toBe('none');
    expect(ins({ extraColor: '#ABC', extraDensity: 0.25 }).interior).toMatchObject({ extraColor: '#aabbcc', extraDensity: 0.25 });
    expect(ins({ extraColor: 'gold', extraDensity: 2 }).interior).toMatchObject({ extraColor: '#ffffff', extraDensity: 0.5 });
    const a = ins({ type: 'liquid', extra: 'foil', extraColor: '#d4af37', extraDensity: 0.8, motion: false });
    expect(normalizeAppearance(a)).toEqual(a);
  });

  test('an extra layer adds +x to the marched interior part; kind, colour and density never change the key', () => {
    const k = (i, f = F) => programKey(ins({ type: 'liquid', ...i }), f);
    expect(k({})).toBe('resin|-|liquid:32|eng1|glow0|fx1|safe0');
    expect(k({ extra: 'foil' })).toBe('resin|-|liquid+x:32|eng1|glow0|fx1|safe0');
    expect(k({ extra: 'bubbles', bubble: true, sand: true })).toBe('resin|-|liquid+bs+x:32|eng1|glow0|fx1|safe0');
    // one program for every kind / colour / density
    const keys = new Set(EXTRA_KINDS.map((extra) => k({ extra, extraColor: '#123456', extraDensity: Math.random() })));
    expect(keys.size).toBe(1);
    // not marched: no part
    expect(k({ extra: 'foil' }, { ...F, interiorSteps: 0 })).toContain('|none|');
    expect(k({ extra: 'foil' }, { ...F, interiors: false })).toContain('|none|');
    expect(programKey(ins({ type: 'none', extra: 'foil' }), F)).toContain('|none|');
  });

  test('every built-in look keeps its programKey and needs no chunk because of the new fields', () => {
    for (const l of Object.values(LOOKS)) {
      const a = l.appearance;
      expect(a.interior).toMatchObject({ motion: true, extra: 'none' });
      for (const f of [F, MO]) expect(programKey(a, f)).not.toContain('+x');
    }
  });

  test('needsLookExtras for resin with an extra; fallbackLook drops the layer while the chunk is missing', () => {
    expect(needsLookExtras(ins({ type: 'glitter' }))).toBe(false);
    expect(needsLookExtras(ins({ type: 'glitter', extra: 'sand' }))).toBe(true);
    expect(needsLookExtras(normalizeAppearance({ body: { type: 'metal' }, interior: { type: 'glitter', extra: 'foil' } }))).toBe(false);
    const fb = fallbackLook(ins({ type: 'nebula', extra: 'foil' }));
    expect(fb.interior).toMatchObject({ type: 'nebula', extra: 'none' });
    expect(needsLookExtras(fb)).toBe(false);
    expect(programKey(fb, F)).toBe(programKey(ins({ type: 'nebula' }), F));
  });

  test("per-look motion: 'mo' only when the setting and the look's field are both on", () => {
    const k = (i, f) => programKey(ins({ type: 'nebula', ...i }), f);
    expect(k({}, MO)).toContain('|mo');
    expect(k({ motion: false }, MO)).not.toContain('|mo');
    expect(k({ motion: false }, MO)).toBe(k({}, F));
    expect(k({}, F)).not.toContain('|mo');
  });
});

describe('layered insides: the inside patch (look-extras chunk)', () => {
  const kind = (u) => u.uInteriorExtraKind.value;

  test('a look without an extra layer gets exactly the patch it got before', () => {
    for (const i of [{ type: 'nebula' }, { type: 'foil' }, { type: 'liquid', bubble: true }, { type: 'shape', shape: 'star' }]) {
      const p = insidePatch(ins(i), F);
      expect(p.uniforms?.uInteriorExtra).toBeUndefined();
      expect(p.interior?.pars ?? '').not.toContain('dcXLayer');
    }
    expect(insidePatch(ins({ type: 'nebula' }), F)).toEqual({});
  });

  test.each([
    [{ type: 'liquid' }],
    [{ type: 'glitter' }],
    [{ type: 'shape', shape: 'heart' }],
    [{ type: 'foil' }],
    [{ type: 'liquid', bubble: true }],
    [{ type: 'eye' }],
  ])('%o + foil flakes: main renamed, the layer composited over it, one dcInterior', (i) => {
    const p = insidePatch(ins({ ...i, extra: 'foil', extraColor: '#ff0000', extraDensity: 0.7 }), F);
    const pars = p.interior.pars;
    expect(count(pars, 'vec4 dcInterior( vec3 p, vec3 rd, float dt )')).toBe(1);
    expect(count(pars, 'vec4 dcXMain( vec3 p, vec3 rd, float dt )')).toBe(1);
    expect(pars).toContain('vec4 dcXLayer( vec3 p, vec3 rd, float dt )');
    expect(count(pars, 'uniform vec4 uInteriorExtra;')).toBe(1);
    expect(count(pars, 'vec3 dcIUp;')).toBe(1);
    // NOISE_GLSL once
    expect(count(pars, 'float dcHash13(')).toBe(1);
    expect(p.uniforms.uInteriorExtra.value).toBeInstanceOf(THREE.Vector4);
    expect(p.uniforms.uInteriorExtra.value.w).toBeCloseTo(0.7);
    expect(p.uniforms.uInteriorExtra.value.x).toBeCloseTo(1);
    expect(kind(p.uniforms)).toBe(EXTRA_KINDS.indexOf('foil'));
  });

  test('every kind is one GLSL text (the kind is a uniform); low tier drops the layer', () => {
    const texts = new Set(EXTRA_KINDS.map((extra) => insidePatch(ins({ type: 'nebula', extra }), F).interior.pars));
    expect(texts.size).toBe(1);
    for (const extra of EXTRA_KINDS) expect(kind(insidePatch(ins({ type: 'nebula', extra }), F).uniforms)).toBe(EXTRA_KINDS.indexOf(extra));
    expect(insidePatch(ins({ type: 'nebula', extra: 'foil' }), { ...F, interiorSteps: 0 })).toEqual({});
    const foilLow = insidePatch(ins({ type: 'foil', extra: 'foil' }), { ...F, interiorSteps: 0 });
    expect(foilLow.interior).toBeUndefined();
    expect(foilLow.uniforms.uInteriorExtra).toBeUndefined();
  });

  test("the layer's GLSL reuses foil and glitter, re-prefixed, reading only the layer's colour and density", () => {
    for (const live of [false, true]) {
      const g = extraLayer(live);
      expect(g).not.toMatch(/uInteriorColors|uInteriorDensity|dcFo|DC_FO_|dcLv|DC_LV_|dcInterior/);
      expect(g).toContain('dcXfShard'); // foil.js's shard test
      expect(g).toContain('dcXgFlake'); // living.js's glitter flake
      expect(g.includes('uInteriorSwirl')).toBe(live);
    }
  });

  test('with motion: the living main plus the layer, the motion uniforms supplied', () => {
    const p = insidePatch(ins({ type: 'glitter', extra: 'bubbles' }), MO);
    expect(p.interior.pars).toContain('uniform float uInteriorTime;');
    expect(p.interior.pars).toContain('dcLvFlake'); // the living glitter is the main
    expect(p.interior.pars).toContain('dcXgFlake');
    expect(p.uniforms.uInteriorTime).toBeDefined();
    expect(kind(p.uniforms)).toBe(EXTRA_KINDS.indexOf('bubbles'));
  });

  test("insideMotion.wants follows the look's motion field", () => {
    expect(insideMotion.wants(ins({ type: 'nebula' }), MO)).toBe(true);
    expect(insideMotion.wants(ins({ type: 'nebula', motion: false }), MO)).toBe(false);
    expect(insideMotion.wants(ins({ type: 'nebula' }), F)).toBe(false);
    // a look with motion off gets the still patch
    expect(insidePatch(ins({ type: 'nebula', motion: false }), MO)).toEqual({});
    expect(insidePatch(ins({ type: 'smoke', motion: false }), MO)).toEqual(insidePatch(ins({ type: 'smoke' }), F));
  });
});

describe('layered insides: materials', () => {
  const atlas = { ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))), texture: new THREE.Texture() };
  const s = getShape('d20');
  const labels = s.values.map((v) => labelFor('d20', v));
  const mat = (a, f) => createDiceMaterial(a, atlas, s, labels, f);
  beforeAll(async () => {
    _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
    await requestLookExtras();
  });
  afterAll(() => _setLookExtrasImport(() => new Promise(() => {})));

  test('blobs + flakes: one program for every kind, motion per look', () => {
    const progs = new Set(EXTRA_KINDS.map((extra) => mat(ins({ type: 'liquid', extra }), F).customProgramCacheKey()));
    expect([...progs]).toEqual(['dicer-resin|-|liquid+x:32|eng1|glow0|fx1|safe0']);
    expect(mat(ins({ type: 'liquid' }), F).customProgramCacheKey()).toBe('dicer-resin|-|liquid:32|eng1|glow0|fx1|safe0');
    const still = mat(ins({ type: 'liquid', motion: false }), MO);
    expect(still.customProgramCacheKey()).toBe(mat(ins({ type: 'liquid' }), F).customProgramCacheKey());
    expect(still.userData.uniforms.uInteriorTime).toBeUndefined();
    expect(mat(ins({ type: 'liquid' }), MO).userData.uniforms.uInteriorTime).toBeDefined();
  });
});

describe('layered insides: the editor form', () => {
  test('round trip keeps motion and the extra layer', () => {
    const a = ins({ type: 'liquid', motion: false, extra: 'foil', extraColor: '#d4af37', extraDensity: 0.3 });
    const form = formFromAppearance(a);
    expect(form.interior).toMatchObject({ motion: false, extra: 'foil', extraColor: '#d4af37', extraDensity: 0.3 });
    expect(appearanceFromForm(form)).toEqual(a);
    // an old look: defaults
    expect(formFromAppearance({ body: { type: 'resin' }, interior: { type: 'glitter' } }).interior).toMatchObject({ motion: true, extra: 'none' });
    // a range input gives a string
    expect(setField(form, 'interior.extraDensity', '0.6').interior.extraDensity).toBe(0.6);
    expect(appearanceFromForm(setField(form, 'interior.motion', true)).interior.motion).toBe(true);
  });

  test("the editor's kind list is what normalisation accepts", () => {
    expect(EXTRA_LIST).toEqual(['none', ...EXTRA_KINDS]);
    for (const extra of EXTRA_LIST) expect(ins({ extra }).interior.extra).toBe(extra);
  });

  test('the extra-layer controls show for a resin body with an inside only; its details once a kind is picked', () => {
    const show = (i, b = 'resin') => visibleSections(formFromAppearance({ body: { type: b }, interior: i }));
    expect(show({ type: 'nebula' })).toMatchObject({ insideMotion: true, extraLayer: true, extraDetails: false });
    expect(show({ type: 'nebula', extra: 'sand' })).toMatchObject({ extraLayer: true, extraDetails: true });
    expect(show({ type: 'none', extra: 'sand' })).toMatchObject({ insideMotion: false, extraLayer: false, extraDetails: false });
    expect(show({ type: 'nebula', extra: 'sand' }, 'metal')).toMatchObject({ insideMotion: false, extraLayer: false, extraDetails: false });
  });
});

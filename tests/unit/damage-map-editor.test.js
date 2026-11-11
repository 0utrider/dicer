// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { duplicateKeys, usedKeys, resolve } from './lang-check.js';
import { DAMAGE_THEMES } from '../../src/effects/damage-themes.js';

let mod;
beforeAll(async () => {
  class FakeApp {
    constructor(options = {}) {
      this.options = options;
    }
    static DEFAULT_OPTIONS = {};
  }
  vi.stubGlobal('foundry', {
    applications: {
      api: { ApplicationV2: FakeApp, HandlebarsApplicationMixin: (Base) => class extends Base {} },
    },
  });
  mod = await import('../../src/ui/damage-map-editor.js');
});
afterAll(() => vi.unstubAllGlobals());

describe('formFromMap / mapFromForm', () => {
  const stored = {
    worldMap: { fire: 'cold', goo: 'ice' },
    overrides: { acid: 'none', cold: 'fire' },
    sounds: { fire: { src: 'sounds/whoosh.ogg', volume: 0.4 }, goo: { src: 'x.ogg' } },
  };

  it('round-trips the world map, the overrides and the sounds, keeping stored extra types', () => {
    const form = mod.formFromMap(stored, ['fire', 'cold', 'acid']);
    expect(form.rows.map((r) => r.type)).toEqual(['fire', 'cold', 'acid', 'goo']);
    expect(mod.mapFromForm(form)).toEqual(stored);
  });

  it('shows default for a type with no entry and removes the key when default is chosen', () => {
    const form = mod.formFromMap(stored, ['fire', 'cold', 'acid']);
    expect(form.rows.find((r) => r.type === 'cold').world).toBe('default');
    form.rows.find((r) => r.type === 'fire').world = 'default';
    form.rows.find((r) => r.type === 'cold').user = 'default';
    form.rows.find((r) => r.type === 'goo').soundSrc = '';
    const out = mod.mapFromForm(form);
    expect(out.worldMap).toEqual({ goo: 'ice' });
    expect(Object.hasOwn(out.worldMap, 'fire')).toBe(false);
    expect(out.overrides).toEqual({ acid: 'none' });
    expect(out.sounds).toEqual({ fire: { src: 'sounds/whoosh.ogg', volume: 0.4 } });
  });

  it('accepts an index-keyed object of strings, as a submitted form gives; clamps and drops a bad volume', () => {
    const out = mod.mapFromForm({
      rows: {
        1: { type: 'cold', world: ' ice ', user: '', soundSrc: 'a.ogg', soundVolume: '7' },
        0: { type: 'fire', world: 'default', user: 'none', soundSrc: 'b.ogg', soundVolume: 'abc' },
        2: { type: '', world: 'x' },
      },
    });
    expect(out.worldMap).toEqual({ cold: 'ice' });
    expect(out.overrides).toEqual({ fire: 'none' });
    expect(out.sounds).toEqual({ cold: { src: 'a.ogg', volume: 1 }, fire: { src: 'b.ogg' } });
  });

  it('tolerates junk settings', () => {
    const form = mod.formFromMap({ worldMap: 'x', overrides: [1], sounds: null }, ['fire']);
    expect(mod.mapFromForm(form)).toEqual({ worldMap: {}, overrides: {}, sounds: {} });
  });
});

describe('damageTypeList', () => {
  it('puts the active system types first', () => {
    const pf2e = mod.damageTypeList({ systemId: 'pf2e' });
    expect(pf2e.slice(0, 4)).toEqual(['acid', 'bludgeoning', 'cold', 'electricity']);
    expect(pf2e.indexOf('vitality')).toBeLessThan(pf2e.indexOf('lightning'));
    const dnd = mod.damageTypeList({ systemId: 'dnd5e' });
    expect(dnd.indexOf('lightning')).toBeLessThan(dnd.indexOf('vitality'));
    expect(new Set(pf2e).size).toBe(pf2e.length);
  });

  it('is alphabetical elsewhere, with the DSN defaults and stored extras', () => {
    const list = mod.damageTypeList({ systemId: 'swade', extra: ['goo', 'acid'] });
    expect(list).toEqual([...list].sort((a, b) => a.localeCompare(b)));
    expect(list).toContain('goo');
    expect(list.filter((t) => t === 'acid')).toHaveLength(1);
  });
});

describe('saveMaps', () => {
  const deps = (isGM) => ({ isGM, setWorld: vi.fn(), setSounds: vi.fn(), setOverrides: vi.fn() });
  const formOf = () =>
    mod.formFromMap(
      { worldMap: { fire: 'cold' }, overrides: { acid: 'none' }, sounds: { fire: { src: 'a.ogg' } } },
      ['fire', 'acid'],
    );

  it('a player save writes only damageThemeOverrides', async () => {
    const form = formOf();
    const d = deps(false);
    await mod.saveMaps(form, d);
    expect(d.setOverrides).toHaveBeenCalledWith({ acid: 'none' });
    expect(d.setWorld).not.toHaveBeenCalled();
    expect(d.setSounds).not.toHaveBeenCalled();
  });

  it('the GM writes the world map, the sounds and their own overrides', async () => {
    const d = deps(true);
    await mod.saveMaps(formOf(), d);
    expect(d.setWorld).toHaveBeenCalledWith({ fire: 'cold' });
    expect(d.setSounds).toHaveBeenCalledWith({ fire: { src: 'a.ogg' } });
    expect(d.setOverrides).toHaveBeenCalledWith({ acid: 'none' });
  });
});

describe('buildChoices', () => {
  it('offers themes and colorsets (a colorset named like a theme is left out); none only for overrides', () => {
    const c = mod.buildChoices({ colorsets: ['mycolors', 'fire'] });
    for (const id of Object.keys(DAMAGE_THEMES)) expect(c.world).toHaveProperty(id);
    expect(c.world).toHaveProperty('mycolors');
    expect(c.world).toHaveProperty('ice'); // a built-in colorset
    expect(c.world).not.toHaveProperty('none');
    expect(c.user).toHaveProperty('none');
    expect(Object.keys(c.world)[0]).toBe('default');
    expect(c.world.fire).toMatch(/Theme/);
  });
});

describe('previewSpec', () => {
  it('carries the theme look, sound material and landing fx; a custom sound replaces the built-in', () => {
    const theme = DAMAGE_THEMES.fire;
    const plain = mod.previewSpec('fire', theme, undefined);
    expect(plain.options).toMatchObject({ type: 'd6', appearance: theme.appearance, soundMaterial: 'glass' });
    expect(plain.fx).toMatchObject({ ruleId: 'damage:fire', effect: { id: 'embers' }, sound: { builtin: 'crackle' } });
    const custom = mod.previewSpec('fire', theme, { src: 'a.ogg', volume: 0.5 });
    expect(custom.fx.sound).toEqual({ src: 'a.ogg', volume: 0.5 });
    expect(custom.fx.effect).toEqual({ id: 'embers' });
  });

  it('has no fx for a colorset theme without a custom sound', () => {
    expect(mod.previewSpec('goo', { appearance: {} }, undefined).fx).toBeNull();
    expect(mod.previewSpec('goo', { appearance: {} }, { src: 'a.ogg' }).fx.sound).toEqual({ src: 'a.ogg' });
  });
});

describe('DamageMapEditor', () => {
  it('is the dicer-damage-map-editor application', () => {
    expect(mod.DamageMapEditor.DEFAULT_OPTIONS.id).toBe('dicer-damage-map-editor');
  });
});

describe('lang/en.json', () => {
  it('has no duplicate keys and resolves every DICER.DamageMap key the editor and template use', () => {
    expect(duplicateKeys()).toEqual([]);
    const lang = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.DamageMap;
    const keys = usedKeys('DamageMap', ['src/ui/damage-map-editor.js', 'templates/damage-map-editor.hbs']);
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) expect(typeof resolve(lang, k), `DICER.DamageMap.${k}`).toBe('string');
  });

  it('has the damageMap menu keys', () => {
    const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Settings.damageMap;
    expect(Object.keys(en).sort()).toEqual(['Hint', 'Label', 'Name']);
  });
});

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { duplicateKeys, usedKeys, resolve } from './lang-check.js';
import { DAMAGE_THEMES, resolveDamageTheme } from '../../src/effects/damage-themes.js';

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

describe('choiceGroups', () => {
  const t = (id, name, moduleId, category) => ({ id, name, moduleId, ...(category && { category }) });
  const themes = [t('dicey.fire', 'Dicey: Fire', 'dicey', 'damage'), t('dicey.yule', 'Yule', 'dicey'), t('other.x', 'X', 'other')];
  const titleOf = (id) => ({ dicey: 'Things Got Dicey', other: 'Other Mod' })[id] ?? id;

  it('puts damage themes right after Default, then the built-ins, then one group per module', () => {
    const c = mod.buildChoices({ colorsets: [] });
    const groups = mod.choiceGroups(c.world, 'default', { themes, titleOf });
    expect(groups[0]).toMatchObject({ label: null });
    expect(groups[0].options.map((o) => o.value)).toEqual(['default']);
    expect(groups[1].label).toBe('DICER.DamageMap.GroupDamageThemes');
    expect(groups[1].options).toEqual([{ value: 'dicey.fire', label: 'Dicey: Fire', selected: false }]);
    expect(groups[2]).toMatchObject({ label: null });
    expect(groups[2].options.map((o) => o.value)).toContain('fire');
    expect(groups.slice(3).map((g) => g.label)).toEqual(['Things Got Dicey', 'Other Mod']);
    expect(groups[3].options.map((o) => o.value)).toEqual(['dicey.yule']);
  });

  it('keeps None with Default for overrides, and marks the current value', () => {
    const c = mod.buildChoices({ colorsets: [] });
    const groups = mod.choiceGroups(c.user, 'dicey.yule', { themes, titleOf });
    expect(groups[0].options.map((o) => o.value)).toEqual(['default', 'none']);
    const selected = groups.flatMap((g) => g.options).filter((o) => o.selected);
    expect(selected.map((o) => o.value)).toEqual(['dicey.yule']);
  });

  it('shows a stored value no group holds (a removed module) as its id; no add-ons gives no extra groups', () => {
    const c = mod.buildChoices({ colorsets: [] });
    const none = mod.choiceGroups(c.world, 'gone.theme', { themes: [], titleOf });
    expect(none.every((g) => g.label === null)).toBe(true);
    expect(none.flatMap((g) => g.options).find((o) => o.selected)).toMatchObject({ value: 'gone.theme', label: 'gone.theme' });
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

  it('plays a registered theme\'s landing rules, the custom sound standing in for theirs', () => {
    const theme = { appearance: {}, landing: null, themeId: 'mod.ember' };
    const rules = [{ id: 'mod.land', effect: { id: 'embers' }, sound: { src: 'land.ogg' } }];
    const plain = mod.previewSpec('fire', theme, undefined, undefined, rules);
    expect(plain.fx).toMatchObject([{ ruleId: 'mod.land', effect: { id: 'embers' }, sound: { src: 'land.ogg' } }]);
    const custom = mod.previewSpec('fire', theme, { src: 'a.ogg' }, undefined, rules);
    expect(custom.fx).toMatchObject([
      { ruleId: 'damage:fire', effect: null, sound: { src: 'a.ogg' } },
      { ruleId: 'mod.land', effect: { id: 'embers' }, sound: null },
    ]);
  });

  it('has no fx for a colorset theme without a custom sound', () => {
    expect(mod.previewSpec('goo', { appearance: {} }, undefined).fx).toBeNull();
    expect(mod.previewSpec('goo', { appearance: {} }, { src: 'a.ogg' }).fx.sound).toEqual({ src: 'a.ogg' });
  });
});

describe('stored entries that cannot be shown are kept', () => {
  const stored = {
    worldMap: { fire: 'cold', acid: 7, goo: { x: 1 } },
    overrides: { cold: ['nope'], acid: 'none' },
    sounds: {
      fire: { src: 'a.ogg', volume: 0.5 },
      cold: { src: 5 },
      acid: { src: 'b.ogg', volume: '0.4' },
      sonic: { src: 'c.ogg', loop: true },
    },
  };

  it('formFromMap lists them and a save writes them back untouched next to the readable ones', () => {
    const form = mod.formFromMap(stored, ['fire', 'cold', 'acid', 'sonic']);
    expect(form.unreadable.sort()).toEqual(
      ['world:acid', 'world:goo', 'mine:cold', 'sound:cold', 'sound:acid', 'sound:sonic'].sort(),
    );
    expect(mod.mapFromForm(form)).toEqual({
      worldMap: { fire: 'cold', acid: 7, goo: { x: 1 } },
      overrides: { acid: 'none', cold: ['nope'] },
      sounds: { fire: { src: 'a.ogg', volume: 0.5 }, cold: { src: 5 }, acid: { src: 'b.ogg', volume: '0.4' }, sonic: { src: 'c.ogg', loop: true } },
    });
  });

  it('a row the user edited for that type wins over the kept entry', () => {
    const form = mod.formFromMap(stored, ['fire', 'cold', 'acid', 'sonic']);
    form.rows.find((r) => r.type === 'acid').world = 'ice';
    form.rows.find((r) => r.type === 'sonic').soundSrc = 'new.ogg';
    const out = mod.mapFromForm(form);
    expect(out.worldMap.acid).toBe('ice');
    expect(out.sounds.sonic).toEqual({ src: 'new.ogg' });
    expect(out.worldMap.goo).toEqual({ x: 1 });
  });
});

describe('DamageMapEditor', () => {
  it('is the dicer-damage-map-editor application', () => {
    expect(mod.DamageMapEditor.DEFAULT_OPTIONS.id).toBe('dicer-damage-map-editor');
  });

  describe('behaviour', () => {
    let store, game, ui, expand;
    const stubs = () => {
      expand = (flat) => {
        const out = {};
        for (const [k, v] of Object.entries(flat)) {
          const parts = k.split('.');
          let o = out;
          parts.slice(0, -1).forEach((p) => (o = o[p] ??= {}));
          o[parts.at(-1)] = v;
        }
        return out;
      };
      vi.stubGlobal('foundry', {
        applications: {
          api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {} },
          ux: { FormDataExtended: class { constructor() { this.object = globalThis.__form; } } },
        },
        utils: { expandObject: expand },
      });
      store = {
        damageTypeMap: { fire: 'cold' },
        damageThemeOverrides: {},
        damageTypeSounds: { fire: { src: 'a.ogg' } },
      };
      game = {
        user: { isGM: false },
        system: { id: 'pf2e' },
        settings: { get: vi.fn((ns, k) => store[k]), set: vi.fn(async () => {}) },
        socket: { emit: vi.fn() },
        dice3d: {
          _preview: vi.fn(async () => {}),
          _damageContext: () => ({
            colorsets: [],
            damageTypeDefaults: {},
            resolveTheme: (type, { userOverrides, worldMap }) =>
              resolveDamageTheme(type, { userOverrides, worldMap, warn: () => {} }),
          }),
        },
      };
      ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
      vi.stubGlobal('game', game);
      vi.stubGlobal('ui', ui);
    };
    beforeEach(stubs);
    afterEach(() => {
      delete globalThis.__form;
      vi.stubGlobal('foundry', { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {} } } });
    });

    const make = async () => {
      const editor = new mod.DamageMapEditor();
      editor.render = vi.fn(async () => {});
      const ctx = await editor._prepareContext();
      return { editor, ctx, i: ctx.rows.findIndex((r) => r.type === 'fire') };
    };
    const tampered = (i) => ({
      [`rows.${i}.type`]: 'fire',
      [`rows.${i}.world`]: 'acid',
      [`rows.${i}.user`]: 'default',
      [`rows.${i}.soundSrc`]: 'evil.ogg',
      [`rows.${i}.soundVolume`]: '1',
    });
    const actions = new Proxy({}, { get: (_, k) => mod.DamageMapEditor.DEFAULT_OPTIONS.actions[k] });

    it('the table groups the system types first, shows the resolved colour and the sound chip', async () => {
      game.system.title = 'Pathfinder Second Edition';
      const { ctx } = await make();
      const groups = ctx.rows.filter((r) => r.group).map((r) => [r.type, r.group]);
      expect(groups[0]).toEqual(['acid', 'Pathfinder Second Edition']);
      expect(groups[1][1]).toBe('DICER.DamageMap.GroupOther');
      expect(ctx.rows.findIndex((r) => r.type === groups[1][0])).toBe(mod.systemTypes('pf2e').length);
      const fire = ctx.rows.find((r) => r.type === 'fire');
      expect(fire.swatch).toBe(DAMAGE_THEMES.cold.appearance.body.color); // the world map sends fire to the cold theme
      expect(fire).toMatchObject({ soundName: 'a.ogg', worldLabel: expect.stringContaining('Cold'), canEditWorld: false, canEditVolume: false });
      expect(mod.systemTypes('swade')).toEqual([]);
    });

    it('the GM edits the volume only of a type with a custom sound', async () => {
      game.user.isGM = true;
      const { ctx } = await make();
      expect(ctx.rows.find((r) => r.type === 'fire').canEditVolume).toBe(true);
      expect(ctx.rows.find((r) => r.type === 'cold').canEditVolume).toBe(false);
    });

    it('a player draft ignores tampered world, sound and volume form values', async () => {
      const { editor, i } = await make();
      globalThis.__form = tampered(i);
      await actions.preview.call(editor, {}, { dataset: { index: String(i) } });
      const row = (await editor._prepareContext()).rows[i];
      expect(row).toMatchObject({ world: 'cold', soundSrc: 'a.ogg', soundVolume: '' });
    });

    it('a player save writes only damageThemeOverrides, whatever the form carried', async () => {
      const { editor, i } = await make();
      await mod.DamageMapEditor.DEFAULT_OPTIONS.form.handler.call(editor, { preventDefault() {} }, null, { object: tampered(i) });
      expect(game.settings.set.mock.calls.map((c) => c[1])).toEqual(['damageThemeOverrides']);
    });

    it('Preview throws one local die in the draft theme and never broadcasts', async () => {
      const { editor, i } = await make();
      globalThis.__form = { ...tampered(i), [`rows.${i}.user`]: 'acid' };
      await actions.preview.call(editor, {}, { dataset: { index: String(i) } });
      expect(game.dice3d._preview).toHaveBeenCalledTimes(1);
      const [fx, options] = game.dice3d._preview.mock.calls[0];
      expect(options).toMatchObject({ type: 'd6', appearance: DAMAGE_THEMES.acid.appearance, soundMaterial: 'glass' });
      expect(fx).toMatchObject({ ruleId: 'damage:acid', macro: null, slowMotion: false, sound: { src: 'a.ogg' } });
      expect(game.socket.emit).not.toHaveBeenCalled();
      expect(game.settings.set).not.toHaveBeenCalled();
    });

    it('the GM draft takes the form values and warns once on open about unreadable entries', async () => {
      game.user.isGM = true;
      store.damageTypeMap = { fire: 'cold', acid: 7 };
      const { editor, i } = await make();
      expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
      expect(ui.notifications.warn.mock.calls[0][0]).toContain('world:acid');
      globalThis.__form = tampered(i);
      await mod.DamageMapEditor.DEFAULT_OPTIONS.form.handler.call(editor, { preventDefault() {} }, null, { object: tampered(i) });
      expect(game.settings.set).toHaveBeenCalledWith('dicer', 'damageTypeMap', expect.objectContaining({ fire: 'acid', acid: 7 }));
      expect(game.settings.set).toHaveBeenCalledWith('dicer', 'damageTypeSounds', { fire: { src: 'evil.ogg', volume: 1 } });
      await editor._prepareContext();
      expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
    });
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

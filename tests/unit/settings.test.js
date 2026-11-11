import { registerSettings, migrateLookSetting } from '../../src/settings.js';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';
import { readFileSync } from 'node:fs';
import { LOOKS } from '../../src/look/looks.js';
import { DEFAULT_RULES } from '../../src/effects/rules.js';

function capture(callbacks) {
  const registered = {};
  globalThis.game = {
    settings: { register: (ns, key, cfg) => (registered[key] = { ns, ...cfg }) },
  };
  try {
    registerSettings(callbacks);
  } finally {
    delete globalThis.game;
  }
  return registered;
}

test('maxDice is a 1..100 range in steps of 1 (default 20)', () => {
  const registered = capture();
  expect(registered.maxDice.range).toEqual({ min: 1, max: 100, step: 1 });
  expect(registered.maxDice.default).toBe(20);
});

test('showGhostDice is a world Boolean, default off (ghost dice reveal that a hidden roll happened)', () => {
  const cfg = capture().showGhostDice;
  expect(cfg).toMatchObject({ ns: 'dicer', scope: 'world', config: true, type: Boolean, default: false });
  expect(cfg.name).toBe('DICER.Settings.showGhostDice.Name');
  expect(cfg.hint).toBe('DICER.Settings.showGhostDice.Hint');
});

test('showExtraDice is a client Boolean, default on', () => {
  const cfg = capture().showExtraDice;
  expect(cfg).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Boolean, default: true });
  expect(cfg.name).toBe('DICER.Settings.showExtraDice.Name');
  expect(cfg.hint).toBe('DICER.Settings.showExtraDice.Hint');
});

test('immediatelyDisplayChatMessages is a world Boolean, default off', () => {
  const cfg = capture().immediatelyDisplayChatMessages;
  expect(cfg).toMatchObject({ ns: 'dicer', scope: 'world', config: true, type: Boolean, default: false });
  expect(cfg.name).toBe('DICER.Settings.immediatelyDisplayChatMessages.Name');
  expect(cfg.hint).toBe('DICER.Settings.immediatelyDisplayChatMessages.Hint');
});

test('hideInitiative is a world Boolean, default on', () => {
  const cfg = capture().hideInitiative;
  expect(cfg).toMatchObject({ ns: 'dicer', scope: 'world', config: true, type: Boolean, default: true });
  expect(cfg.name).toBe('DICER.Settings.hideInitiative.Name');
  expect(cfg.hint).toBe('DICER.Settings.hideInitiative.Hint');
});

test('theme is a client String whose choices map every built-in theme id to its name (default "default")', () => {
  const { theme } = capture();
  expect(theme).toMatchObject({
    ns: 'dicer',
    scope: 'client',
    config: true,
    type: String,
    default: 'default',
  });
  expect(theme.choices).toEqual(Object.fromEntries(BUILTIN_THEMES.map((t) => [t.id, t.name])));
  expect(theme.name).toBe('DICER.Settings.theme.Name');
  expect(theme.hint).toBe('DICER.Settings.theme.Hint');
});

test('the old look setting stays registered, hidden, only so its value can migrate; every LOOKS id is a theme', () => {
  const { look } = capture();
  expect(look).toMatchObject({ ns: 'dicer', scope: 'client', config: false, type: String, default: 'default' });
  expect(look.onChange).toBeUndefined();
  for (const id of Object.keys(LOOKS)) expect(BUILTIN_THEMES.some((t) => t.id === id)).toBe(true);
});

test('worldThemes is a hidden world Array, default []', () => {
  expect(capture().worldThemes).toMatchObject({ ns: 'dicer', scope: 'world', config: false, type: Array, default: [] });
});

describe('migrateLookSetting', () => {
  const store = (init) => {
    const s = { ...init };
    return { s, get: (k) => s[k], set: vi.fn(async (k, v) => (s[k] = v)) };
  };
  test("copies the user's look into theme once, then clears look", async () => {
    const st = store({ look: 'ruby-classic', theme: 'default' });
    expect(await migrateLookSetting(st)).toBe(true);
    expect(st.s).toEqual({ look: 'default', theme: 'ruby-classic' });
    expect(await migrateLookSetting(st)).toBe(false);
    expect(st.s.theme).toBe('ruby-classic');
  });
  test('a theme already chosen wins; look is still cleared', async () => {
    const st = store({ look: 'ruby-classic', theme: 'obsidian' });
    expect(await migrateLookSetting(st)).toBe(false);
    expect(st.s).toEqual({ look: 'default', theme: 'obsidian' });
  });
  test('a default or unknown look changes nothing it should not', async () => {
    const def = store({ look: 'default', theme: 'default' });
    expect(await migrateLookSetting(def)).toBe(false);
    expect(def.set).not.toHaveBeenCalled();
    const gone = store({ look: 'no-such-look', theme: 'default' });
    expect(await migrateLookSetting(gone)).toBe(false);
    expect(gone.s.theme).toBe('default');
  });
});

test('quality is a client String auto/low/medium/high/ultra (default auto)', () => {
  const { quality } = capture();
  expect(quality).toMatchObject({ ns: 'dicer', scope: 'client', type: String, default: 'auto' });
  expect(Object.keys(quality.choices)).toEqual(['auto', 'low', 'medium', 'high', 'ultra']);
});

test('qualityCap is a world String low/medium/high/ultra (default ultra)', () => {
  const { qualityCap } = capture();
  expect(qualityCap).toMatchObject({ ns: 'dicer', scope: 'world', type: String, default: 'ultra' });
  expect(Object.keys(qualityCap.choices)).toEqual(['low', 'medium', 'high', 'ultra']);
});

test.each(['interiors', 'engraving', 'shadows', 'glow', 'presetFaces', 'presetModels'])(
  '%s is a client Boolean toggle, default on',
  (key) => {
    const cfg = capture()[key];
    expect(cfg).toMatchObject({
      ns: 'dicer',
      scope: 'client',
      config: true,
      type: Boolean,
      default: true,
    });
    expect(cfg.name).toBe(`DICER.Settings.${key}.Name`);
    expect(cfg.hint).toBe(`DICER.Settings.${key}.Hint`);
  },
);

test('onChange routes look and feature toggles to onLookChange, quality and qualityCap to onQualityChange', () => {
  const onLookChange = vi.fn();
  const onQualityChange = vi.fn();
  const onAreaChange = vi.fn();
  const r = capture({ onAreaChange, onLookChange, onQualityChange });
  for (const key of ['theme', 'interiors', 'engraving', 'shadows', 'glow']) r[key].onChange('x');
  expect(onLookChange.mock.calls.map((c) => c[0])).toEqual([
    'theme',
    'interiors',
    'engraving',
    'shadows',
    'glow',
  ]);
  r.quality.onChange('low');
  r.qualityCap.onChange('medium');
  expect(onQualityChange.mock.calls.map((c) => c[0])).toEqual(['quality', 'qualityCap']);
  r.diceScale.onChange(1.5);
  expect(onAreaChange).toHaveBeenCalledTimes(1);
  expect(onLookChange).toHaveBeenCalledTimes(5);
});

test('onChange without callbacks does not throw', () => {
  const r = capture();
  for (const key of [
    'theme',
    'quality',
    'qualityCap',
    'interiors',
    'engraving',
    'shadows',
    'glow',
  ]) {
    expect(() => r[key].onChange('x')).not.toThrow();
  }
});

test('migrateFromDsn is a world Boolean, default on; dsnWorldMigrated is hidden', () => {
  const registered = capture();
  expect(registered.migrateFromDsn).toMatchObject({ ns: 'dicer', scope: 'world', config: true, type: Boolean, default: true });
  expect(registered.migrateFromDsn.name).toBe('DICER.Settings.migrateFromDsn.Name');
  expect(registered.dsnWorldMigrated).toMatchObject({ scope: 'world', config: false, type: Number, default: 0 });
});

describe('sound settings', () => {
  const surfaces = ['felt', 'wood', 'stone', 'metal'];
  test('sounds and quietWhenUnfocused are client Booleans, default on', () => {
    const r = capture();
    for (const key of ['sounds', 'quietWhenUnfocused']) {
      expect(r[key]).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Boolean, default: true });
      expect(r[key].name).toBe(`DICER.Settings.${key}.Name`);
      expect(r[key].hint).toBe(`DICER.Settings.${key}.Hint`);
    }
  });
  test('soundVolume (0.6) and effectsVolume (0.8) are client 0..1 ranges in steps of 0.05', () => {
    const r = capture();
    expect(r.soundVolume).toMatchObject({ scope: 'client', type: Number, default: 0.6 });
    expect(r.soundVolume.range).toEqual({ min: 0, max: 1, step: 0.05 });
    expect(r.effectsVolume).toMatchObject({ scope: 'client', type: Number, default: 0.8 });
    expect(r.effectsVolume.range).toEqual({ min: 0, max: 1, step: 0.05 });
  });
  test('soundSurface is a world String (default felt); the override is a client String (default world)', () => {
    const r = capture();
    expect(r.soundSurface).toMatchObject({ scope: 'world', type: String, default: 'felt', config: true });
    expect(Object.keys(r.soundSurface.choices)).toEqual(surfaces);
    expect(r.soundSurfaceOverride).toMatchObject({ scope: 'client', type: String, default: 'world', config: true });
    expect(Object.keys(r.soundSurfaceOverride.choices)).toEqual(['world', ...surfaces]);
  });
  test('turning sounds on or off reports it through onSoundChange', () => {
    const onSoundChange = vi.fn();
    const r = capture({ onSoundChange });
    r.sounds.onChange(false);
    expect(onSoundChange).toHaveBeenCalledWith('sounds', false);
  });
});

describe('effects settings', () => {
  test('effects, showOthersEffects and slowMotion are client Booleans, default on', () => {
    const r = capture();
    for (const key of ['effects', 'showOthersEffects', 'slowMotion']) {
      expect(r[key]).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Boolean, default: true });
      expect(r[key].name).toBe(`DICER.Settings.${key}.Name`);
      expect(r[key].hint).toBe(`DICER.Settings.${key}.Hint`);
    }
  });
  test('screenShake is a client Boolean, default on (Task 8)', () => {
    const r = capture();
    expect(r.screenShake).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Boolean, default: true });
    expect(r.screenShake.name).toBe('DICER.Settings.screenShake.Name');
  });
  test('turning effects on or off refreshes materials through onLookChange (the fx program key)', () => {
    const onLookChange = vi.fn();
    capture({ onLookChange }).effects.onChange(false);
    expect(onLookChange).toHaveBeenCalledWith('effects', false);
  });
  test('triggerMacros is a world Boolean, default on', () => {
    expect(capture().triggerMacros).toMatchObject({ scope: 'world', config: true, type: Boolean, default: true });
  });
  test('worldTriggers is a hidden world Array defaulting to a deep copy of DEFAULT_RULES', () => {
    const cfg = capture().worldTriggers;
    expect(cfg).toMatchObject({ scope: 'world', config: false, type: Array });
    expect(cfg.default).toEqual(DEFAULT_RULES);
    expect(cfg.default).not.toBe(DEFAULT_RULES);
    expect(cfg.default[0]).not.toBe(DEFAULT_RULES[0]);
  });
});

test('every effects setting has its English name and hint', () => {
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Settings;
  for (const key of ['effects', 'showOthersEffects', 'slowMotion', 'triggerMacros', 'screenShake']) {
    expect(typeof en[key]?.Name).toBe('string');
    expect(typeof en[key]?.Hint).toBe('string');
  }
});

test('disabledModuleTriggers is a hidden world Array defaulting to empty (P4-R12)', () => {
  const cfg = capture().disabledModuleTriggers;
  expect(cfg).toMatchObject({ ns: 'dicer', scope: 'world', config: false, type: Array });
  expect(cfg.default).toEqual([]);
});

test('the trigger editor menu is a client-visible ApplicationV2 proxy that lazily opens the editor', () => {
  class FakeApp {}
  const menus = {};
  globalThis.foundry = { applications: { api: { ApplicationV2: FakeApp } } };
  globalThis.game = {
    settings: { register: () => {}, registerMenu: (ns, key, cfg) => (menus[key] = { ns, ...cfg }) },
  };
  try {
    registerSettings();
  } finally {
    delete globalThis.game;
    delete globalThis.foundry;
  }
  const menu = menus.triggerEditor;
  expect(menu).toMatchObject({ ns: 'dicer', restricted: false });
  expect(menu.name).toBe('DICER.Settings.triggerEditor.Name');
  expect(menu.label).toBe('DICER.Settings.triggerEditor.Label');
  expect(menu.hint).toBe('DICER.Settings.triggerEditor.Hint');
  expect(Object.getPrototypeOf(menu.type)).toBe(FakeApp);
  expect(typeof menu.type.prototype.render).toBe('function');
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Settings.triggerEditor;
  expect(Object.keys(en).sort()).toEqual(['Hint', 'Label', 'Name']);
});

test('the damage map menu is a lazy ApplicationV2 proxy and damageTypeSounds is a hidden world Object', () => {
  class FakeApp {}
  const menus = {};
  const registered = {};
  globalThis.foundry = { applications: { api: { ApplicationV2: FakeApp } } };
  globalThis.game = {
    settings: {
      register: (ns, key, cfg) => (registered[key] = cfg),
      registerMenu: (ns, key, cfg) => (menus[key] = { ns, ...cfg }),
    },
  };
  try {
    registerSettings();
  } finally {
    delete globalThis.game;
    delete globalThis.foundry;
  }
  const menu = menus.damageMap;
  expect(menu).toMatchObject({ ns: 'dicer', restricted: false });
  expect(menu.name).toBe('DICER.Settings.damageMap.Name');
  expect(Object.getPrototypeOf(menu.type)).toBe(FakeApp);
  expect(menus.triggerEditor.type).not.toBe(menu.type);
  expect(registered.damageTypeSounds).toMatchObject({ scope: 'world', config: false, type: Object, default: {} });
});

describe('roll area settings (Plan 5 Task 3)', () => {
  test('rollAreas is a hidden world Object defaulting to the full default and no users', () => {
    const cfg = capture().rollAreas;
    expect(cfg).toMatchObject({ ns: 'dicer', scope: 'world', config: false, type: Object });
    expect(cfg.default).toEqual({ default: { preset: 'full' }, users: {} });
  });

  test('areaScale is a client Number range 0.5..1.5 step 0.05, default 1', () => {
    const cfg = capture().areaScale;
    expect(cfg).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Number, default: 1 });
    expect(cfg.range).toEqual({ min: 0.5, max: 1.5, step: 0.05 });
  });

  test('gmPrivateCorner is a world Boolean, default off (P5-D7)', () => {
    const cfg = capture().gmPrivateCorner;
    expect(cfg).toMatchObject({ ns: 'dicer', scope: 'world', config: true, type: Boolean, default: false });
  });

  test('gmPrivateArea is a hidden world Object defaulting to the corner preset', () => {
    const cfg = capture().gmPrivateArea;
    expect(cfg).toMatchObject({ ns: 'dicer', scope: 'world', config: false, type: Object });
    expect(cfg.default).toEqual({ preset: 'corner' });
  });

  test('perPlayerAreas is a world Boolean, default on', () => {
    const cfg = capture().perPlayerAreas;
    expect(cfg).toMatchObject({ ns: 'dicer', scope: 'world', config: true, type: Boolean, default: true });
  });

  test('defaults are fresh objects on each registration', () => {
    expect(capture().rollAreas.default).not.toBe(capture().rollAreas.default);
  });

  test('only rollAreas and gmPrivateArea react to a change (the hook source); the resolver reads the rest per throw', () => {
    const onRollAreasChange = vi.fn();
    const r = capture({ onRollAreasChange });
    r.rollAreas.onChange({ default: { preset: 'full' } });
    expect(onRollAreasChange).toHaveBeenCalledTimes(1);
    r.gmPrivateArea.onChange({ preset: 'corner' });
    expect(onRollAreasChange).toHaveBeenCalledTimes(2);
    for (const key of ['areaScale', 'gmPrivateCorner', 'perPlayerAreas']) {
      expect(r[key].onChange).toBeUndefined();
    }
  });

  test('the area change hook source does not throw without its callback', () => {
    expect(() => capture().rollAreas.onChange({})).not.toThrow();
  });

  test('every visible area setting has its English name and hint', () => {
    const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Settings;
    const r = capture();
    for (const key of ['areaScale', 'gmPrivateCorner', 'perPlayerAreas']) {
      expect(r[key].name).toBe(`DICER.Settings.${key}.Name`);
      expect(r[key].hint).toBe(`DICER.Settings.${key}.Hint`);
      expect(typeof en[key]?.Name).toBe('string');
      expect(typeof en[key]?.Hint).toBe('string');
    }
  });
});

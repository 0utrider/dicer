import { registerSettings, migrateLookSetting, migratePetStay, getSetting, clearSettingCache } from '../../src/settings.js';
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
  expect(() => look.onChange('default')).not.toThrow(); // only clears the read cache (P9-R17)
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

test('insideMotion is registered (client, true) and has strings; a change rebuilds materials like interiors', () => {
  const onLookChange = vi.fn();
  const cfg = capture({ onLookChange }).insideMotion;
  expect(cfg).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Boolean, default: true });
  expect(cfg.name).toBe('DICER.Settings.insideMotion.Name');
  expect(cfg.hint).toBe('DICER.Settings.insideMotion.Hint');
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8'));
  expect(en.DICER.Settings.insideMotion.Name).toEqual(expect.any(String));
  expect(en.DICER.Settings.insideMotion.Hint).toEqual(expect.any(String));
  cfg.onChange(false);
  expect(onLookChange).toHaveBeenCalledWith('insideMotion', false);
});

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
  test('impactEffects is a client Boolean, default on', () => {
    const r = capture();
    expect(r.impactEffects).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Boolean, default: true });
    expect(r.impactEffects.name).toBe('DICER.Settings.impactEffects.Name');
    expect(r.impactEffects.hint).toBe('DICER.Settings.impactEffects.Hint');
  });
  test('elementalTrails and elementalCritBursts are client Booleans, default on', () => {
    const r = capture();
    for (const key of ['elementalTrails', 'elementalCritBursts']) {
      expect(r[key]).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Boolean, default: true });
      expect(r[key].name).toBe(`DICER.Settings.${key}.Name`);
      expect(r[key].hint).toBe(`DICER.Settings.${key}.Hint`);
    }
  });
  test('the trail and burst hints say what triggers them (insides too; any natural 20, not only a crit hit)', () => {
    const en = JSON.parse(readFileSync(new URL('../../lang/en.json', import.meta.url), 'utf8'));
    const s = en.DICER.Settings;
    expect(s.elementalTrails.Hint).toMatch(/inside/i);
    expect(s.elementalTrails.Hint).toMatch(/damage type/i);
    expect(s.elementalCritBursts.Hint).toMatch(/natural 20/i);
    expect(s.elementalCritBursts.Hint).not.toMatch(/critical hit/i);
  });
  test('jb2aEffects is a client Boolean, default on', () => {
    const r = capture();
    expect(r.jb2aEffects).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Boolean, default: true });
    expect(r.jb2aEffects.name).toBe('DICER.Settings.jb2aEffects.Name');
    expect(r.jb2aEffects.hint).toBe('DICER.Settings.jb2aEffects.Hint');
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

test('rolling by hand: the 8 keys with their defaults; the four that decide the dice config call onHandChange', () => {
  const onHandChange = vi.fn();
  const r = capture({ onHandChange });
  const want = {
    handRolls: { scope: 'client', type: String, default: 'off', config: true },
    handRollTypes: { scope: 'client', type: Array, default: [], config: false },
    handRollsAllowed: { scope: 'world', type: String, default: 'all', config: true },
    handRollsRequired: { scope: 'world', type: Boolean, default: false, config: true },
    handRollTimeout: { scope: 'world', type: Number, default: 60, config: true },
    handReplay: { scope: 'client', type: Boolean, default: true, config: true },
    handFollowUps: { scope: 'client', type: Boolean, default: true, config: true },
    handLiveShare: { scope: 'world', type: Boolean, default: true, config: true },
    diceTray: { scope: 'client', type: Boolean, default: true, config: true },
    chatTray: { scope: 'client', type: Boolean, default: true, config: true },
  };
  for (const [key, cfg] of Object.entries(want)) expect(r[key]).toMatchObject({ ns: 'dicer', ...cfg });
  // plus the hidden stash of entries handRollsRequired took from another method
  expect(r.handRollStash).toMatchObject({ ns: 'dicer', scope: 'client', config: false, type: Object, default: {} });
  // and the record of the dice configuration entries Dicer wrote itself (I2: only those are removed)
  expect(r.handRollMapped).toMatchObject({ ns: 'dicer', scope: 'client', config: false, type: Array, default: [] });
  expect(Object.keys(r.handRolls.choices)).toEqual(['off', 'ask', 'always']);
  expect(Object.keys(r.handRollsAllowed.choices)).toEqual(['all', 'trusted', 'gm', 'none']);
  expect(r.handRollTimeout.range).toMatchObject({ min: 10, max: 300 });
  for (const key of ['handRolls', 'handRollTypes', 'handRollsAllowed', 'handRollsRequired']) r[key].onChange('x');
  expect(onHandChange).toHaveBeenCalledTimes(4);
  // diceTray re-prepares the scene controls, so its tool comes and goes at once
  globalThis.ui = { controls: { render: vi.fn() } };
  try {
    for (const key of ['handRollTimeout', 'handReplay', 'diceTray']) r[key].onChange?.('x');
    expect(onHandChange).toHaveBeenCalledTimes(4);
    expect(globalThis.ui.controls.render).toHaveBeenCalledWith({ reset: true });
    // no controls yet, or a throwing render: never thrown into Foundry's setting change
    globalThis.ui = {};
    expect(() => r.diceTray.onChange(true)).not.toThrow();
  } finally {
    delete globalThis.ui;
  }
  // chatTray's change is the chat-tray chunk's (clientSettingChanged): nothing to call here
  expect(() => r.chatTray.onChange?.(false)).not.toThrow();
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER;
  for (const key of Object.keys(want).filter((k) => want[k].config)) {
    expect(r[key].name).toBe(`DICER.Settings.${key}.Name`);
    expect(typeof en.Settings[key]?.Name).toBe('string');
    expect(typeof en.Settings[key]?.Hint).toBe('string');
  }
  for (const k of ['off', 'ask', 'always']) expect(typeof en.Settings.handRolls.Choices[k]).toBe('string');
  for (const k of ['all', 'trusted', 'gm', 'none']) expect(typeof en.Settings.handRollsAllowed.Choices[k]).toBe('string');
  for (const k of ['Method', 'AskTitle', 'AskText', 'ThrowByHand', 'RollAuto']) expect(typeof en.Hand[k]).toBe('string');
});

test('every effects setting has its English name and hint', () => {
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Settings;
  for (const key of ['effects', 'showOthersEffects', 'slowMotion', 'triggerMacros', 'screenShake', 'impactEffects', 'jb2aEffects', 'elementalTrails', 'elementalCritBursts']) {
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
      r[key].onChange(1); // only clears the read cache (P9-R17)
    }
    expect(onRollAreasChange).toHaveBeenCalledTimes(2);
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

test('diceLookButton is a client Boolean, default on', () => {
  const registered = capture();
  expect(registered.diceLookButton).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Boolean, default: true });
  expect(registered.diceLookButton.name).toBe('DICER.Settings.diceLookButton.Name');
});

describe('GM controls settings (P7-D4)', () => {
  test('lockPlayerLooks is a world Boolean, default off, shown in the form', () => {
    const cfg = capture().lockPlayerLooks;
    expect(cfg).toMatchObject({ ns: 'dicer', scope: 'world', config: true, type: Boolean, default: false });
    expect(cfg.name).toBe('DICER.Settings.lockPlayerLooks.Name');
    expect(cfg.hint).toBe('DICER.Settings.lockPlayerLooks.Hint');
  });
  test("worldDefaultTheme is a world String, '' = none, starting with built-in choices", () => {
    const cfg = capture().worldDefaultTheme;
    expect(cfg).toMatchObject({ ns: 'dicer', scope: 'world', config: true, type: String, default: '' });
    expect(Object.keys(cfg.choices)[0]).toBe('');
    expect(cfg.choices['']).toBe('DICER.Settings.worldDefaultTheme.None');
    for (const t of BUILTIN_THEMES) expect(cfg.choices[t.id]).toBe(t.name);
  });
  test('a stored world default that no longer exists stays a (missing) choice', async () => {
    const { worldDefaultChoices } = await import('../../src/settings.js');
    const get = (k) => (k === 'worldDefaultTheme' ? 'world.gone' : []);
    expect(worldDefaultChoices('none', get, '(missing)')['world.gone']).toBe('world.gone (missing)');
    expect(Object.keys(worldDefaultChoices('none', () => 'ruby-classic'))).not.toContain('(missing)');
  });
  test('its choices follow the stored world themes live (and never the current user themes)', async () => {
    const registered = {};
    const entries = new Map();
    let worlds = [];
    globalThis.game = {
      user: { getFlag: () => [{ id: 'user.u1.m', name: 'M', appearance: BUILTIN_THEMES[0].appearance }] },
      settings: {
        settings: entries,
        get: (_ns, k) => (k === 'worldThemes' ? worlds : undefined),
        register: (ns, key, cfg) => {
          registered[key] = { ns, ...cfg };
          entries.set(`${ns}.${key}`, registered[key]);
        },
      },
    };
    try {
      registerSettings();
      const entry = entries.get('dicer.worldDefaultTheme');
      expect(Object.keys(entry.choices)).not.toContain('world.w');
      worlds = [{ id: 'world.w', name: 'W', appearance: BUILTIN_THEMES[0].appearance }];
      expect(entry.choices['world.w']).toBe('W (world)');
      expect(entry.choices['']).toBe('DICER.Settings.worldDefaultTheme.None');
      expect(Object.keys(entry.choices)).not.toContain('user.u1.m');
    } finally {
      delete globalThis.game;
    }
  });
});

// P9-R17: Foundry's settings lookup is slow and the roll loop read sound settings on every impact
// (a quarter of Dicer's loop time in the 30-die profile). Simple values are remembered until that
// setting's onChange, which Foundry fires on every client, world settings included.
describe('getSetting cache', () => {
  function world(values) {
    const registered = {};
    const get = vi.fn((ns, key) => values[key]);
    globalThis.game = {
      settings: { register: (ns, key, cfg) => (registered[key] = cfg), get },
      user: { isGM: true },
    };
    clearSettingCache();
    registerSettings();
    return { registered, get };
  }
  afterEach(() => {
    clearSettingCache();
    delete globalThis.game;
  });

  test('a simple value is read from Foundry once, then again after that setting changes', () => {
    const values = { sounds: true, soundVolume: 0.6 };
    const { registered, get } = world(values);
    expect(getSetting('sounds')).toBe(true);
    expect(getSetting('sounds')).toBe(true);
    expect(getSetting('soundVolume')).toBe(0.6);
    expect(get).toHaveBeenCalledTimes(2);
    values.sounds = false;
    registered.sounds.onChange(false);
    expect(getSetting('sounds')).toBe(false);
    expect(getSetting('soundVolume')).toBe(0.6); // other keys stay cached
    expect(get).toHaveBeenCalledTimes(3);
  });

  test('the setting callbacks still run, after the cache is cleared', () => {
    const values = { sounds: true };
    const registered = {};
    globalThis.game = {
      settings: { register: (ns, key, cfg) => (registered[key] = cfg), get: (ns, key) => values[key] },
    };
    clearSettingCache();
    let seen;
    registerSettings({ onSoundChange: () => (seen = getSetting('sounds')) });
    expect(getSetting('sounds')).toBe(true);
    values.sounds = false;
    registered.sounds.onChange(false);
    expect(seen).toBe(false); // the callback reads the new value, not the cached one
  });

  test('object values and unregistered keys are read fresh every time', () => {
    const values = { worldThemes: [], notOurs: 1 };
    const { get } = world(values);
    expect(getSetting('worldThemes')).not.toBe(undefined);
    getSetting('worldThemes');
    getSetting('notOurs');
    getSetting('notOurs');
    expect(get).toHaveBeenCalledTimes(4);
  });
});

test('petsAllowed (world), showPets and petSounds (client) are Booleans, default on', () => {
  const r = capture();
  for (const [key, scope] of [
    ['petsAllowed', 'world'],
    ['showPets', 'client'],
    ['petSounds', 'client'],
  ]) {
    expect(r[key]).toMatchObject({ ns: 'dicer', scope, config: true, type: Boolean, default: true });
    expect(r[key].name).toBe(`DICER.Settings.${key}.Name`);
    expect(r[key].hint).toBe(`DICER.Settings.${key}.Hint`);
  }
});

test('grabDice (client) is a Boolean, default on, and tells grab and toss on change', () => {
  const onGrabChange = vi.fn();
  const r = capture({ onGrabChange });
  expect(r.grabDice).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Boolean, default: true });
  expect(r.grabDice.name).toBe('DICER.Settings.grabDice.Name');
  expect(r.grabDice.hint).toBe('DICER.Settings.grabDice.Hint');
  r.grabDice.onChange(false);
  expect(onGrabChange).toHaveBeenCalledWith(false);
});

test('petSplat (client) is a Boolean, default on, and wakes the layer on change', () => {
  const onPetStayChange = vi.fn();
  const r = capture({ onPetStayChange });
  expect(r.petSplat).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Boolean, default: true });
  expect(r.petSplat.name).toBe('DICER.Settings.petSplat.Name');
  expect(r.petSplat.hint).toBe('DICER.Settings.petSplat.Hint');
  r.petSplat.onChange(false);
  expect(onPetStayChange).toHaveBeenCalledTimes(1);
});

test('petStay (client) is a Number with choices 0, 30, 60, 120, -1, default 60, and wakes the layer', () => {
  const onPetStayChange = vi.fn();
  const r = capture({ onPetStayChange });
  expect(r.petsStay).toBeUndefined();
  expect(r.petStay).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Number, default: 60 });
  expect(r.petStay.name).toBe('DICER.Settings.petStay.Name');
  expect(r.petStay.hint).toBe('DICER.Settings.petStay.Hint');
  expect(Object.keys(r.petStay.choices).sort()).toEqual(['-1', '0', '120', '30', '60']);
  for (const label of Object.values(r.petStay.choices)) expect(label).toMatch(/^DICER.Settings.petStay./);
  r.petStay.onChange(30);
  expect(onPetStayChange).toHaveBeenCalledTimes(1);
});

test('migratePetStay: a stored petsStay=false becomes petStay 0 once; otherwise nothing', async () => {
  const run = async (items) => {
    const set = vi.fn(async () => {});
    await migratePetStay({ getItem: (k) => items[k] ?? null }, set);
    return set;
  };
  expect(await run({ 'dicer.petsStay': 'false' })).toHaveBeenCalledWith('petStay', 0);
  expect(await run({ 'dicer.petsStay': 'false', 'dicer.petStay': '30' })).not.toHaveBeenCalled();
  expect(await run({ 'dicer.petsStay': 'true' })).not.toHaveBeenCalled();
  expect(await run({})).not.toHaveBeenCalled();
  const throws = vi.fn();
  await migratePetStay({ getItem: () => { throw new Error('blocked'); } }, throws);
  expect(throws).not.toHaveBeenCalled();
});

test('petsAllowed and showPets call onPetChange; petSounds does not', () => {
  const onPetChange = vi.fn();
  const r = capture({ onPetChange });
  r.petsAllowed.onChange(false);
  r.showPets.onChange(false);
  r.petSounds.onChange?.(false);
  expect(onPetChange).toHaveBeenCalledTimes(2);
});

test('jb2aEffects has its exact English name and hint', () => {
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Settings.jb2aEffects;
  expect(en.Name).toBe('Use JB2A animations');
  expect(en.Hint).toBe(
    "Play JB2A's animated effects (Jules & Ben's Animated Assets) at the dice instead of the built-in ones, when the JB2A module is installed and active. Does nothing without JB2A.",
  );
});

test('elementalDamageInsides is registered (world, true) and has strings', () => {
  const cfg = capture().elementalDamageInsides;
  expect(cfg).toMatchObject({ ns: 'dicer', scope: 'world', config: true, type: Boolean, default: true });
  expect(cfg.name).toBe('DICER.Settings.elementalDamageInsides.Name');
  expect(cfg.hint).toBe('DICER.Settings.elementalDamageInsides.Hint');
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8'));
  expect(en.DICER.Settings.elementalDamageInsides.Name).toEqual(expect.any(String));
  expect(en.DICER.Settings.elementalDamageInsides.Hint).toEqual(expect.any(String));
});

test('insideFlare registered (client, true) with strings', () => {
  const cfg = capture().insideFlare;
  expect(cfg).toMatchObject({ ns: 'dicer', scope: 'client', config: true, type: Boolean, default: true });
  expect(cfg.name).toBe('DICER.Settings.insideFlare.Name');
  expect(cfg.hint).toBe('DICER.Settings.insideFlare.Hint');
  const onLookChange = vi.fn();
  capture({ onLookChange }).insideFlare.onChange(false);
  expect(onLookChange).not.toHaveBeenCalled(); // read when an effect starts: nothing to rebuild
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8'));
  expect(en.DICER.Settings.insideFlare.Name).toEqual(expect.any(String));
  expect(en.DICER.Settings.insideFlare.Hint).toEqual(expect.any(String));
});

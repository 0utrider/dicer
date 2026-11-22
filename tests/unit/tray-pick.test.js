import { beforeEach, describe, expect, test, vi } from 'vitest';
import { applyPick, askTrayPick, FLAG, forcer, pickContent, traysToAsk } from '../../src/ui/tray-pick.js';
import { OTHER_TRAYS } from '../../src/ui/other-trays.js';
import { readFileSync } from 'node:fs';

let values;
let modules;
let user;
let game;
let dialog;

beforeEach(() => {
  values = { 'dicer.chatTray': true, 'dice-calculator.enableDiceTray': true };
  modules = new Map([
    ['dicer', { active: true, version: '1.4.1' }],
    ['dice-calculator', { active: true, title: 'Dice Tray' }],
  ]);
  user = {
    isGM: false,
    flags: {},
    getFlag(scope, key) {
      return this.flags[scope]?.[key];
    },
    setFlag: vi.fn(async function (scope, key, value) {
      this.flags[scope] = { ...this.flags[scope], [key]: value };
    }),
  };
  game = {
    user,
    modules,
    i18n: { localize: (k) => k, format: (k, d) => `${k}:${Object.values(d ?? {}).join(',')}` },
    settings: {
      settings: { has: (key) => key in values },
      get: (ns, k) => values[`${ns}.${k}`],
      set: vi.fn(async (ns, k, v) => {
        values[`${ns}.${k}`] = v;
      }),
    },
  };
  globalThis.game = game; // the strings read the global game
  dialog = vi.fn();
  globalThis.foundry = {
    applications: {
      api: { DialogV2: { wait: dialog } },
      settings: { SettingsConfig: { reloadConfirm: vi.fn(async () => {}) } },
    },
  };
});

/** Makes the dialog press `action`, with the form's checkbox and scope as given. */
const press = (action, { never = false, mode } = {}) =>
  dialog.mockImplementation(async ({ buttons }) => {
    const b = buttons.find((x) => x.action === action);
    const form = { elements: { never: { checked: never }, ...(mode ? { mode: { value: mode } } : {}) } };
    return b.callback({}, { dataset: { action }, form });
  });

describe('registry', () => {
  test("main.js's copy of the module ids matches OTHER_TRAYS", () => {
    // read as text: importing main.js would start Dicer
    const src = readFileSync('src/main.js', 'utf8');
    const list = src.match(/const TRAY_MODULE_IDS = (\[[^\]]*\]);/)[1];
    expect(JSON.parse(list.replace(/'/g, '"'))).toEqual(OTHER_TRAYS.map((t) => t.id));
  });
});

describe('traysToAsk', () => {
  test('asks while both show, once per version, never after "don\'t show again"', () => {
    expect(traysToAsk(game, '1.4.1').map((t) => t.title)).toEqual(['Dice Tray']);
    user.flags.dicer = { [FLAG]: { seen: '1.4.1' } };
    expect(traysToAsk(game, '1.4.1')).toBeNull();
    expect(traysToAsk(game, '1.4.2')).toHaveLength(1); // a new version asks again
    user.flags.dicer = { [FLAG]: { seen: '1.4.0', never: true } };
    expect(traysToAsk(game, '1.4.2')).toBeNull();
  });

  test('nothing to ask: Dicer\'s bar off, the other tray off, or its module inactive', () => {
    values['dicer.chatTray'] = false;
    expect(traysToAsk(game, 'v')).toBeNull();
    values['dicer.chatTray'] = true;
    values['dice-calculator.enableDiceTray'] = false;
    expect(traysToAsk(game, 'v')).toBeNull();
    values['dice-calculator.enableDiceTray'] = true;
    modules.set('dice-calculator', { active: false });
    expect(traysToAsk(game, 'v')).toBeNull();
    delete values['dice-calculator.enableDiceTray']; // not registered (an old version)
    modules.set('dice-calculator', { active: true });
    expect(traysToAsk(game, 'v')).toBeNull();
  });
});

describe('applyPick', () => {
  const trays = [
    { id: 'dice-calculator', setting: 'enableDiceTray', reload: true },
    { id: 'pf2e-hud', setting: 'dice.enabled', reload: false },
  ];

  test("Dicer's bar: every other tray off; a reload when one needs it", async () => {
    values['pf2e-hud.dice.enabled'] = true;
    expect(await applyPick(game, 'dicer', trays)).toBe(true);
    expect(values).toMatchObject({ 'dicer.chatTray': true, 'dice-calculator.enableDiceTray': false, 'pf2e-hud.dice.enabled': false });
    expect(await applyPick(game, 'dicer', [trays[1]])).toBe(false);
  });

  test("keep another: only Dicer's bar goes off, no reload", async () => {
    expect(await applyPick(game, 'dice-calculator', trays)).toBe(false);
    expect(values).toMatchObject({ 'dicer.chatTray': false, 'dice-calculator.enableDiceTray': true });
  });

  test('soft or hard: each changed setting is forced for everyone; "me" forces nothing', async () => {
    const fcs = { forceSetting: vi.fn(async () => {}) };
    await applyPick(game, 'dicer', [trays[0]], { mode: 'hard', fcs });
    expect(fcs.forceSetting.mock.calls).toEqual([
      ['dicer.chatTray', 'hard'],
      ['dice-calculator.enableDiceTray', 'hard'],
    ]);
    fcs.forceSetting.mockClear();
    await applyPick(game, 'dice-calculator', [trays[0]], { mode: 'soft', fcs });
    expect(fcs.forceSetting.mock.calls).toEqual([['dicer.chatTray', 'soft']]);
    fcs.forceSetting.mockClear();
    await applyPick(game, 'dicer', [trays[0]], { mode: 'me', fcs });
    expect(fcs.forceSetting).not.toHaveBeenCalled();
  });

  test('a setting that fails is skipped with a warning, the rest still change', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    game.settings.set.mockImplementationOnce(async () => {
      throw new Error('nope');
    });
    await applyPick(game, 'dicer', [trays[0]]);
    expect(values['dice-calculator.enableDiceTray']).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('forcer', () => {
  test('only for a GM, only with Force Client Settings active', () => {
    const fcs = { forceSetting: () => {} };
    expect(forcer(game, fcs)).toBeNull(); // a player
    user.isGM = true;
    expect(forcer(game, fcs)).toBeNull(); // module not active
    modules.set('force-client-settings', { active: true });
    expect(forcer(game, fcs)).toBe(fcs);
    expect(forcer(game, {})).toBeNull(); // no forceSetting
  });
});

describe('pickContent', () => {
  test('names the trays (escaped), offers the scope only to a forcing GM', () => {
    const html = pickContent([{ title: 'Dice <Tray>' }], false);
    expect(html).toContain('Dice &lt;Tray&gt;');
    expect(html).toContain('name="never"');
    expect(html).not.toContain('name="mode"');
    expect(pickContent([{ title: 'x' }], true)).toMatch(/<select name="mode">.*value="soft".*value="hard"/);
  });
});

describe('askTrayPick', () => {
  test('use Dicer: settings change, the version is remembered, Dice Tray asks for a reload', async () => {
    press('dicer');
    await askTrayPick(game);
    const { buttons } = dialog.mock.calls[0][0];
    expect(buttons.map((b) => b.action)).toEqual(['dicer', 'dice-calculator']);
    expect(buttons[1].label).toBe('DICER.TrayPick.Keep:Dice Tray');
    expect(values['dice-calculator.enableDiceTray']).toBe(false);
    expect(user.flags.dicer[FLAG]).toEqual({ seen: '1.4.1', never: false });
    expect(foundry.applications.settings.SettingsConfig.reloadConfirm).toHaveBeenCalledWith({ world: false });
  });

  test('keep the other with "don\'t show again": Dicer\'s bar off, never asked again', async () => {
    press('dice-calculator', { never: true });
    await askTrayPick(game);
    expect(values['dicer.chatTray']).toBe(false);
    expect(user.flags.dicer[FLAG]).toEqual({ seen: '1.4.1', never: true });
    expect(foundry.applications.settings.SettingsConfig.reloadConfirm).not.toHaveBeenCalled();
    dialog.mockClear();
    values['dicer.chatTray'] = true;
    await askTrayPick(game);
    expect(dialog).not.toHaveBeenCalled();
  });

  test('closed without a choice: nothing changes, not asked again this version', async () => {
    dialog.mockResolvedValue(null);
    await askTrayPick(game);
    expect(game.settings.set).not.toHaveBeenCalled();
    expect(user.flags.dicer[FLAG]).toEqual({ seen: '1.4.1', never: false });
  });

  test('nothing to ask: no window', async () => {
    values['dice-calculator.enableDiceTray'] = false;
    await askTrayPick(game);
    expect(dialog).not.toHaveBeenCalled();
  });
});

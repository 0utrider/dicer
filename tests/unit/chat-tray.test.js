// @vitest-environment jsdom
/**
 * The chat dice tray (lazy chat-tray chunk): a Dice Tray replacement docked under the chat input.
 * Formula building (counts, modifier, advantage), message mode, theme tint, when it hides, the
 * dock's mounting and moving, its buttons, a plain Roll and a drag that throws by hand through
 * the hand chunk's throwTray.
 */
import { readFileSync } from 'node:fs';
import {
  chatFormula,
  toggleAdv,
  chatTrayShown,
  tintOf,
  tintsFor,
  dock as dockTray,
  trayProfile,
  flatFormula,
  flatDegree,
  flatFlavor,
  DEGREES,
  readPrefs,
  trayFor,
  isDuality,
  _resetChatTray,
  HOLD_MS,
  bagChoices,
  bagPicks,
  bagView,
  bagFavorites,
} from '../../src/ui/chat-tray.js';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';
import { TRAY_DICE } from '../../src/hand/chunk/tray.js';
import { setHandDeps } from '../../src/hand/shell.js';

let settings;
let modules;
let others;
let user;
let made;
let hooks;

class FakeRoll {
  constructor(formula) {
    this.formula = formula;
    this.toMessage = vi.fn(async () => ({ id: 'm' }));
    made.push(this);
  }
  async evaluate() {
    this.total = FakeRoll.nextTotal;
    return this;
  }
}
FakeRoll.nextTotal = 10;

beforeEach(() => {
  settings = { chatTray: true, handRollsAllowed: 'all' };
  others = {}; // other modules' settings, 'id.key'
  modules = new Map();
  user = {
    id: 'u1',
    role: 1,
    isGM: false,
    flags: {},
    getFlag(scope, key) {
      return this.flags[scope]?.[key];
    },
    setFlag: vi.fn(async function (scope, key, value) {
      this.flags[scope] = { ...this.flags[scope], [key]: value };
    }),
    unsetFlag: vi.fn(async function (scope, key) {
      delete this.flags[scope]?.[key];
    }),
  };
  made = [];
  hooks = [];
  globalThis.game = {
    system: { id: 'dnd5e' },
    user,
    modules,
    i18n: {
      localize: (k) => k,
      format: (k, d) => `${k}:${Object.values(d ?? {}).join(',')}`,
    },
    settings: {
      settings: { has: (key) => key in others },
      get: (ns, k) => {
        if (`${ns}.${k}` in others) return others[`${ns}.${k}`];
        if (ns === 'core') return k === 'messageMode' ? 'gm' : undefined;
        if (!(k in settings)) throw new Error('not registered');
        return settings[k];
      },
    },
  };
  globalThis.foundry = { dice: { Roll: { defaultImplementation: FakeRoll } } };
  globalThis.Hooks = { on: (n, fn) => hooks.push([n, fn]) };
  setHandDeps(null);
  _resetChatTray();
  document.body.innerHTML =
    '<div id="sidebar"><form class="chat-form"><textarea id="chat-message"></textarea></form></div>' +
    '<div id="chat-popout"><div class="slot"></div></div><div id="board"></div>';
});

afterEach(() => {
  vi.useRealTimers();
  _resetChatTray();
  setHandDeps(null);
  delete globalThis.game;
  delete globalThis.foundry;
  delete globalThis.Hooks;
  delete globalThis.ui;
  delete globalThis.CONFIG;
});

const textarea = () => document.getElementById('chat-message');
const dock = () => document.querySelector('.dicer-chat-tray');
const die = (k) => dock().querySelector(`.dicer-chat-tray-die[data-die="${k}"]`);
const click = (el, init = {}) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
const rightClick = (el) =>
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
const pointer = (el, type, x = 0, y = 0) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
const rollButton = () => dock().querySelector('[data-act="roll"]');
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('formula', () => {
  test('counts and modifier, in tray order (formulaFromCounts)', () => {
    expect(chatFormula({ counts: { d20: 1, d6: 2 }, modifier: 3 })).toBe('2d6 + 1d20 + 3');
    expect(chatFormula({ counts: { d8: 1 }, modifier: -2 })).toBe('1d8 - 2');
    expect(chatFormula({ counts: {}, modifier: 0 })).toBe('');
    expect(chatFormula({})).toBe('');
  });

  test('advantage keeps the highest d20, disadvantage the lowest; no d20, no suffix', () => {
    expect(chatFormula({ counts: { d20: 2 }, modifier: 5, adv: 1 })).toBe('2d20kh + 5');
    expect(chatFormula({ counts: { d20: 2, d4: 1 }, adv: -1 })).toBe('1d4 + 2d20kl');
    expect(chatFormula({ counts: { d20: 3 }, adv: 1 })).toBe('3d20kh');
    // a single d20 still rolls two under advantage
    expect(chatFormula({ counts: { d20: 1 }, adv: 1 })).toBe('2d20kh');
    // d2 and d100 are never taken for the d20
    expect(chatFormula({ counts: { d2: 1, d100: 1 }, adv: 1 })).toBe('1d100 + 1d2');
  });

  test('toggleAdv raises a lone d20 to two, switches, and drops back to one when cleared', () => {
    let s = toggleAdv({ counts: {}, adv: 0 }, 1);
    expect(s).toMatchObject({ counts: { d20: 2 }, adv: 1 });
    s = toggleAdv(s, -1);
    expect(s).toMatchObject({ counts: { d20: 2 }, adv: -1 });
    s = toggleAdv(s, -1);
    expect(s).toMatchObject({ counts: { d20: 1 }, adv: 0 });
    // three d20s stay three either way
    s = toggleAdv({ counts: { d20: 3 }, adv: 0 }, 1);
    expect(s.counts.d20).toBe(3);
    expect(toggleAdv(s, 1).counts.d20).toBe(3);
  });
});

describe('theme tint', () => {
  test('tintOf reads the body and number colours; unreadable numbers fall back to black or white', () => {
    expect(tintOf({ body: { color: '#1f5fd1' }, numbers: { color: '#e2b04a' } })).toEqual({
      body: '#1f5fd1',
      number: '#e2b04a',
    });
    // white on near-white: black instead
    expect(tintOf({ body: { color: '#fafafa' }, numbers: { color: '#ffffff' } }).number).toBe(
      '#000000',
    );
    // black on black: white
    expect(tintOf({ body: { color: '#000000' }, numbers: { color: '#111111' } }).number).toBe(
      '#ffffff',
    );
    // short hex is fine, junk is not
    expect(tintOf({ body: { color: '#000' }, numbers: { color: '#fff' } })).toEqual({
      body: '#000',
      number: '#fff',
    });
    expect(tintOf({ body: { color: 'url(x)' }, numbers: { color: '#fff' } })).toBeNull();
    expect(tintOf(null)).toBeNull();
    expect(tintOf({ body: { color: '#123456' } })).toEqual({ body: '#123456', number: '#ffffff' });
  });

  test("tintsFor resolves one look per die through decorateFor, as the user's own dice", () => {
    const seen = [];
    const decorateFor = vi.fn(() => (term) => {
      const type = term.constructor?.DENOMINATION === 'f' ? 'df' : `d${term.faces}`;
      seen.push(type);
      return {
        appearance: {
          body: { color: type === 'd20' ? '#ff0000' : '#0000ff' },
          numbers: { color: '#ffffff' },
        },
      };
    });
    const t = tintsFor(decorateFor, 'u1');
    expect(decorateFor.mock.calls[0][2]).toBe('u1'); // the author whose looks resolve
    expect(seen).toEqual(['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'd2', 'df']);
    expect(t.d20).toEqual({ body: '#ff0000', number: '#ffffff' });
    expect(t.dF).toEqual({ body: '#0000ff', number: '#ffffff' });
    // a throwing resolver or none: no tints, never a throw
    expect(
      tintsFor(() => {
        throw new Error('x');
      }, 'u1'),
    ).toEqual({});
    expect(tintsFor(undefined, 'u1')).toEqual({});
  });
});

describe('shown', () => {
  test('on by default; off with the setting, while another tray shows, or unregistered', () => {
    expect(chatTrayShown()).toBe(true);
    settings.chatTray = false;
    expect(chatTrayShown()).toBe(false);
    settings.chatTray = true;
    // Dice Tray (dice-calculator) active with its tray on hides the bar; its tray off, it shows
    modules.set('dice-calculator', { active: true, title: 'Dice Tray' });
    others['dice-calculator.enableDiceTray'] = true;
    expect(chatTrayShown()).toBe(false);
    others['dice-calculator.enableDiceTray'] = false;
    expect(chatTrayShown()).toBe(true);
    // PF2e HUD's dice panel, the same way; an inactive module never counts
    modules.set('pf2e-hud', { active: true, title: 'PF2e HUD' });
    others['pf2e-hud.dice.enabled'] = true;
    expect(chatTrayShown()).toBe(false);
    modules.set('pf2e-hud', { active: false });
    expect(chatTrayShown()).toBe(true);
    delete settings.chatTray;
    expect(chatTrayShown()).toBe(false);
  });
});

describe('dock', () => {
  test('docks once under the chat form, follows the textarea to the popout, and leaves when hidden', () => {
    dockTray({ '#chat-message': textarea() }, vi.fn());
    expect(dock()).toBeTruthy();
    expect(document.querySelector('.chat-form').nextElementSibling).toBe(dock());
    expect(dock().querySelectorAll('.dicer-chat-tray-die')).toHaveLength(trayProfile().dice.length);
    dockTray({ '#chat-message': textarea() }, vi.fn());
    expect(document.querySelectorAll('.dicer-chat-tray')).toHaveLength(1);
    // Foundry moves the textarea (popout): the dock follows it
    document.querySelector('#chat-popout .slot').append(textarea());
    dockTray(document.getElementById('chat-popout'), vi.fn()); // renderChatLog's element
    expect(textarea().nextElementSibling).toBe(dock());
    expect(document.querySelectorAll('.dicer-chat-tray')).toHaveLength(1);
    // the setting off (a user setting: created on the first change, then updated) undocks it at
    // once, and on docks it again
    const onCreate = hooks.filter(([n]) => n === 'createSetting');
    const onUpdate = hooks.filter(([n]) => n === 'updateSetting');
    expect([onCreate.length, onUpdate.length]).toEqual([1, 1]);
    settings.chatTray = false;
    onUpdate[0][1]({ key: 'dicer.diceTray' }); // another setting: nothing
    expect(dock()).toBeTruthy();
    onCreate[0][1]({ key: 'dicer.chatTray' });
    expect(dock()).toBeNull();
    settings.chatTray = true;
    onUpdate[0][1]({ key: 'dicer.chatTray' });
    expect(textarea().nextElementSibling).toBe(dock());
    settings.chatTray = false;
    dockTray(undefined, vi.fn());
    expect(dock()).toBeNull();
    // the Dice Tray module's tray on: never docked; switched off, the bar docks at once
    settings.chatTray = true;
    modules.set('dice-calculator', { active: true });
    others['dice-calculator.enableDiceTray'] = true;
    dockTray({ '#chat-message': textarea() }, vi.fn());
    expect(dock()).toBeNull();
    others['dice-calculator.enableDiceTray'] = false;
    onUpdate[0][1]({ key: 'dice-calculator.enableDiceTray' });
    expect(dock()).toBeTruthy();
  });

  test('no chat textarea: nothing, never a throw', () => {
    document.body.innerHTML = '';
    expect(() => dockTray({}, vi.fn())).not.toThrow();
    expect(dock()).toBeNull();
  });

  test('left-click adds, right-click removes, badges count, the Roll label shows the formula', () => {
    dockTray(undefined, vi.fn());
    click(die('d6'));
    click(die('d6'));
    click(die('d20'));
    expect(die('d6').querySelector('.dicer-chat-tray-count').textContent).toBe('2');
    expect(die('d6').classList.contains('has-dice')).toBe(true);
    expect(die('d4').classList.contains('has-dice')).toBe(false);
    // the button just says Roll; the formula leads its tooltip
    expect(rollButton().textContent).toBe('DICER.ChatTray.Roll');
    expect(rollButton().dataset.tooltip).toContain('2d6 + 1d20');
    expect(rollButton().disabled).toBe(false);
    rightClick(die('d6'));
    expect(die('d6').querySelector('.dicer-chat-tray-count').textContent).toBe('1');
    // the modifier stepper and typing
    click(dock().querySelector('[data-mod="1"]'));
    click(dock().querySelector('[data-mod="1"]'));
    expect(rollButton().dataset.tooltip).toContain('1d6 + 1d20 + 2');
    const mod = dock().querySelector('.dicer-chat-tray-mod input');
    mod.value = '-4';
    mod.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rollButton().dataset.tooltip).toContain('1d6 + 1d20 - 4');
    // advantage on the d20
    click(dock().querySelector('[data-adv="1"]'));
    expect(rollButton().dataset.tooltip).toContain('2d20kh');
    expect(dock().querySelector('[data-adv="1"]').getAttribute('aria-pressed')).toBe('true');
    // clear
    click(dock().querySelector('[data-act="clear"]'));
    expect(rollButton().disabled).toBe(true);
    expect(dock().querySelector('[data-adv="1"]').getAttribute('aria-pressed')).toBe('false');
    expect(mod.value).toBe('0');
  });

  test('no mode picker: a roll goes out in the chat mode set by its own buttons, read at roll time', async () => {
    dockTray(undefined, vi.fn());
    expect(dock().querySelector('select')).toBeNull();
    click(die('d8'));
    click(rollButton());
    await flush();
    expect(made[0].toMessage).toHaveBeenCalledWith({}, { messageMode: 'gm' });
  });

  test('Roll posts the formula as a normal Foundry roll and clears the selection', async () => {
    dockTray(undefined, vi.fn());
    click(die('d20'));
    click(dock().querySelector('[data-adv="-1"]'));
    click(dock().querySelector('[data-mod="1"]'));
    click(rollButton());
    await flush();
    expect(made.map((r) => r.formula)).toEqual(['2d20kl + 1']);
    expect(made[0].toMessage).toHaveBeenCalledWith({}, { messageMode: 'gm' });
    expect(rollButton().disabled).toBe(true);
    // nothing picked: nothing rolled
    click(rollButton());
    await flush();
    expect(made).toHaveLength(1);
  });

  test('click-and-hold opens the quick counts (and adv/dis on the d20); a pick sets the count', () => {
    vi.useFakeTimers();
    dockTray(undefined, vi.fn());
    pointer(die('d6'), 'pointerdown');
    vi.advanceTimersByTime(HOLD_MS + 10);
    const menu = dock().querySelector('.dicer-chat-tray-menu');
    expect(menu).toBeTruthy();
    expect([...menu.querySelectorAll('[data-count]')].map((b) => b.dataset.count)).toEqual([
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
    expect(menu.querySelector('[data-adv]')).toBeNull();
    pointer(die('d6'), 'pointerup');
    click(die('d6')); // the click ending the hold adds nothing
    click(menu.querySelector('[data-count="5"]'));
    expect(die('d6').querySelector('.dicer-chat-tray-count').textContent).toBe('5');
    expect(dock().querySelector('.dicer-chat-tray-menu')).toBeNull();
    // the d20's menu offers advantage and disadvantage
    pointer(die('d20'), 'pointerdown');
    vi.advanceTimersByTime(HOLD_MS + 10);
    const m20 = dock().querySelector('.dicer-chat-tray-menu');
    expect(m20.querySelectorAll('[data-adv]')).toHaveLength(2);
    click(m20.querySelector('[data-adv="1"]'));
    expect(rollButton().dataset.tooltip).toContain('5d6 + 2d20kh');
    // a short press is a click, no menu
    pointer(die('d4'), 'pointerdown');
    vi.advanceTimersByTime(HOLD_MS / 2);
    pointer(die('d4'), 'pointerup');
    vi.advanceTimersByTime(HOLD_MS);
    expect(dock().querySelector('.dicer-chat-tray-menu')).toBeNull();
  });
});

describe('throw by hand', () => {
  const allow = () =>
    setHandDeps({ getSetting: (k) => settings[k], user: () => user, decorateFor: () => undefined });

  test('dragging a die out of the chat onto the table throws it through the hand chunk', async () => {
    allow();
    const throwTray = vi.fn(async () => ({ id: 'm' }));
    const loadHand = vi.fn(async () => ({ throwTray }));
    dockTray(undefined, loadHand);
    expect(dock().classList.contains('can-throw')).toBe(true);
    click(die('d6'));
    click(die('d6'));
    click(dock().querySelector('[data-mod="1"]'));
    pointer(die('d20'), 'pointerdown', 10, 10);
    pointer(document, 'pointermove', 60, 10);
    expect(dock().classList.contains('is-dragging')).toBe(true);
    pointer(document, 'pointerup', 500, 300);
    await flush();
    expect(loadHand).toHaveBeenCalledTimes(1);
    // the dragged die alone (one, as none was picked), with the modifier, in the chosen mode
    expect(throwTray).toHaveBeenCalledWith({
      counts: { d20: 1 },
      modifier: 1,
      mode: 'gm',
      formula: '1d20 + 1',
    });
    expect(dock().classList.contains('is-dragging')).toBe(false);
    // the click that ends a drag adds nothing
    click(die('d20'));
    expect(die('d20').classList.contains('has-dice')).toBe(false);
  });

  test('dragging the Roll button throws the whole set, keeping advantage; the set then clears', async () => {
    allow();
    const throwTray = vi.fn(async () => ({ id: 'm' }));
    dockTray(undefined, async () => ({ throwTray }));
    click(die('d4'));
    click(dock().querySelector('[data-adv="1"]'));
    pointer(rollButton(), 'pointerdown', 10, 10);
    pointer(document, 'pointermove', 40, 40);
    pointer(document, 'pointerup', 400, 400);
    await flush();
    await flush();
    expect(throwTray).toHaveBeenCalledWith({
      counts: { d4: 1, d20: 2 },
      modifier: 0,
      mode: 'gm',
      formula: '1d4 + 2d20kh',
    });
    expect(rollButton().disabled).toBe(true);
    expect(made).toEqual([]); // never also a plain roll
  });

  test('a drag dropped back inside the chat, or by a user not allowed to roll by hand, throws nothing', async () => {
    allow();
    const throwTray = vi.fn();
    dockTray(undefined, async () => ({ throwTray }));
    const sidebar = document.getElementById('sidebar');
    sidebar.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 300,
      bottom: 800,
      width: 300,
      height: 800,
    });
    pointer(die('d6'), 'pointerdown', 10, 10);
    pointer(document, 'pointermove', 80, 10);
    pointer(document, 'pointerup', 100, 100);
    await flush();
    expect(throwTray).not.toHaveBeenCalled();
    // not allowed: no drag affordance, a drag does nothing
    settings.handRollsAllowed = 'gm';
    _resetChatTray();
    dockTray(undefined, async () => ({ throwTray }));
    expect(dock().classList.contains('can-throw')).toBe(false);
    pointer(die('d6'), 'pointerdown', 10, 10);
    pointer(document, 'pointermove', 80, 10);
    pointer(document, 'pointerup', 900, 900);
    await flush();
    expect(throwTray).not.toHaveBeenCalled();
  });

  test('the dice wear the player theme tint once the engine is up', () => {
    setHandDeps({
      getSetting: (k) => settings[k],
      user: () => user,
      decorateFor: () => () => ({
        appearance: { body: { color: '#204080' }, numbers: { color: '#f0e0a0' } },
      }),
    });
    dockTray(undefined, vi.fn());
    expect(die('d6').style.getPropertyValue('--dicer-ct-body')).toBe('#204080');
    expect(die('d6').style.getPropertyValue('--dicer-ct-num')).toBe('#f0e0a0');
    // this user's look changed: repainted
    const [, onUpdate] = hooks.find(([n]) => n === 'updateUser');
    setHandDeps({
      getSetting: (k) => settings[k],
      user: () => user,
      decorateFor: () => () => ({
        appearance: { body: { color: '#008000' }, numbers: { color: '#ffffff' } },
      }),
    });
    onUpdate({ id: 'u1' }, { flags: { dicer: {} } });
    expect(die('d6').style.getPropertyValue('--dicer-ct-body')).toBe('#008000');
  });
});

describe('lang and styles', () => {
  test('every DICER.ChatTray key the chunk uses exists in en.json; the setting has its strings', () => {
    const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER;
    const src = readFileSync('src/ui/chat-tray.js', 'utf8');
    const keys = [...src.matchAll(/DICER\.ChatTray\.([A-Za-z]+)/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) expect(typeof en.ChatTray[k], k).toBe('string');
    expect(en.Settings.chatTray.Name).toBeTypeOf('string');
    expect(en.Settings.chatTray.Hint).toMatch(/Dice Tray/);
  });

  test('styles live in dicer.css under the dicer-chat-tray prefix', () => {
    const css = readFileSync('styles/dicer.css', 'utf8');
    expect(css).toContain('.dicer-chat-tray-die');
    expect(css).toContain('--dicer-ct-body');
  });
});

describe('trayProfile: the tray follows the world system', () => {
  test('D&D-likes keep advantage; PF2e names it fortune; others get none', () => {
    expect(trayProfile('dnd5e').helper).toMatchObject({ kind: 'keep', die: 'd20', up: 'Adv', down: 'Dis' });
    expect(trayProfile('pf2e').helper).toMatchObject({ kind: 'keep', die: 'd20', up: 'Fortune', down: 'Misfortune' });
    for (const id of ['swade', 'CoC7', 'cyberpunk-red-core', 'some-unknown-system'])
      expect(trayProfile(id).helper).toBeNull();
  });

  test('dice per system, standard ones for an unknown system, every key a tray die', () => {
    expect(trayProfile('cyberpunk-red-core').dice).toEqual(['d6', 'd10']);
    expect(trayProfile('fate-core-official').dice).toEqual(['dF']);
    expect(trayProfile('unknown').dice).toEqual(['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);
    for (const id of ['dnd5e', 'pf2e', 'swade', 'CoC7', 'ModularFate', 'x'])
      for (const k of trayProfile(id).dice) expect(TRAY_DICE).toContain(k);
    expect(trayProfile('toString').dice).toHaveLength(7); // no prototype keys
  });

  test('a system without a keep pair docks no Adv/Dis buttons and no d20 menu entries', () => {
    vi.useFakeTimers();
    globalThis.game.system.id = 'swade';
    dockTray(undefined, vi.fn());
    expect(dock().querySelectorAll('[data-adv]')).toHaveLength(0);
    expect([...dock().querySelectorAll('.dicer-chat-tray-die')].map((b) => b.dataset.die)).toEqual(
      ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'],
    );
    die('d20').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    vi.advanceTimersByTime(HOLD_MS + 10);
    const menu = dock().querySelector('.dicer-chat-tray-menu');
    expect(menu).not.toBeNull();
    expect(menu.querySelectorAll('[data-adv]')).toHaveLength(0);
  });

  test('PF2e labels the pair Fortune / Misfortune and it still keeps the higher / lower d20', () => {
    globalThis.game.system.id = 'pf2e';
    dockTray(undefined, vi.fn());
    const up = dock().querySelector('[data-adv="1"]');
    expect(up.textContent).toBe('DICER.ChatTray.Fortune');
    expect(up.dataset.tooltip).toBe('DICER.ChatTray.FortuneHint');
    click(die('d20'));
    click(up);
    expect(rollButton().dataset.tooltip).toContain('2d20kh');
  });
});

describe('flat checks (pf2e, sf2e)', () => {
  const flat = (dc) => dock().querySelector(`[data-flat="${dc}"]`);

  test('PF2e and SF2e get DC 5 and DC 11 buttons after the dice; other systems none', () => {
    expect(trayProfile('pf2e').flat).toEqual([5, 11]);
    expect(trayProfile('sf2e').flat).toEqual([5, 11]);
    expect(trayProfile('dnd5e').flat).toEqual([]);
    globalThis.game.system.id = 'pf2e';
    dockTray(undefined, vi.fn());
    const buttons = [...dock().querySelectorAll('.dicer-chat-tray-dice > *')];
    expect(buttons.slice(-2).map((b) => b.dataset.flat)).toEqual(['5', '11']);
    expect(flat(5).dataset.tooltip).toBe('DICER.ChatTray.FlatHint:5');
  });

  test('one click posts a d20 against the DC with its result; the selection stays', async () => {
    globalThis.game.system.id = 'pf2e';
    dockTray(undefined, vi.fn());
    click(die('d6'));
    FakeRoll.nextTotal = 11;
    click(flat(11));
    await flush();
    expect(made.map((r) => r.formula)).toEqual(['1d20']);
    expect(made[0].toMessage).toHaveBeenCalledWith({ flavor: flatFlavor(11, 2) }, { messageMode: 'gm' });
    // pf2e's check markup: the degree's class is what its chat CSS colours
    expect(flatFlavor(11, 2)).toContain('<span class="success">DICER.ChatTray.FlatSuccess</span>');
    expect(flatFlavor(11, 2)).toContain('degree-of-success');
    FakeRoll.nextTotal = 4;
    click(flat(5));
    await flush();
    expect(made[1].toMessage.mock.calls[0][0].flavor).toBe(flatFlavor(5, 1));
    expect(die('d6').classList.contains('has-dice')).toBe(true);
    FakeRoll.nextTotal = 10;
  });

  test('the degree as pf2e counts it: 10 over or under is critical, a natural 20 / 1 moves it a step', () => {
    expect(flatDegree(15, 15, 5)).toBe(3);
    expect(flatDegree(5, 5, 5)).toBe(2);
    expect(flatDegree(4, 4, 5)).toBe(1);
    expect(flatDegree(1, 1, 11)).toBe(0);
    expect(flatDegree(20, 20, 11)).toBe(3); // success, up one
    expect(flatDegree(1, 1, 5)).toBe(0); // failure, down one
    expect(DEGREES[flatDegree(10, 10, 11)]).toBe('failure');
  });

  test("with the system's CheckRoll (pf2e) the card is one, carrying the degree (a natural 20 / 1 colours the total)", async () => {
    globalThis.game.system.id = 'pf2e';
    class CheckRoll extends FakeRoll {
      constructor(formula, data, options) {
        super(formula);
        this.options = { ...options };
      }
    }
    globalThis.CONFIG = { Dice: { rolls: [FakeRoll, CheckRoll] } };
    dockTray(undefined, vi.fn());
    FakeRoll.nextTotal = 12;
    click(flat(11));
    await flush();
    expect(made[0]).toBeInstanceOf(CheckRoll);
    expect(made[0].options).toMatchObject({ type: 'flat-check', degreeOfSuccess: 2 });
    FakeRoll.nextTotal = 10;
  });

  test('fortune / misfortune roll two and keep the higher / lower', async () => {
    expect(flatFormula(0, trayProfile('pf2e').helper)).toBe('1d20');
    expect(flatFormula(1, trayProfile('pf2e').helper)).toBe('2d20kh');
    expect(flatFormula(-1, trayProfile('pf2e').helper)).toBe('2d20kl');
    expect(flatFormula(1, null)).toBe('1d20');
    globalThis.game.system.id = 'pf2e';
    dockTray(undefined, vi.fn());
    click(dock().querySelector('[data-adv="-1"]'));
    click(flat(5));
    await flush();
    expect(made.map((r) => r.formula)).toEqual(['2d20kl']);
  });

  test('a player can hide them in Customize', async () => {
    globalThis.game.system.id = 'pf2e';
    dockTray(undefined, vi.fn());
    click(dock().querySelector('[data-act="customize"]'));
    click(dock().querySelector('[data-panel-tab="prefs"]'));
    const box = dock().querySelector('[data-pref="flat"]');
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(user.flags.dicer.chatTray).toEqual({ flat: false });
    expect(dock().querySelector('[data-flat]')).toBeNull();
  });
});

describe('Daggerheart and Draw Steel helpers add a term instead of keeping a die', () => {
  test('Daggerheart: advantage adds a d6, disadvantage subtracts one, the duality d12s stay as rolled', () => {
    const h = trayProfile('daggerheart').helper;
    expect(h).toMatchObject({ kind: 'duality', die: 'd12', term: '1d6', up: 'Adv', down: 'Dis' });
    expect(chatFormula({ counts: { d12: 2 }, modifier: 3, adv: 1 }, h)).toBe('2d12 + 3 + 1d6');
    expect(chatFormula({ counts: { d12: 2 }, adv: -1 }, h)).toBe('2d12 - 1d6');
    expect(chatFormula({ counts: {}, adv: 1 }, h)).toBe(''); // nothing picked: nothing to roll
    expect(toggleAdv({ counts: { d12: 2 }, adv: 0 }, 1, h)).toEqual({ counts: { d12: 2 }, adv: 1 });
    expect(trayProfile('daggerheart').dice).toEqual(['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);
  });

  test('Draw Steel: an edge is +2 and a bane -2 on the 2d10 power roll', () => {
    const h = trayProfile('draw-steel').helper;
    expect(h).toMatchObject({ kind: 'add', die: 'd10', term: '2', up: 'Edge', down: 'Bane' });
    expect(chatFormula({ counts: { d10: 2 }, adv: 1 }, h)).toBe('2d10 + 2');
    expect(chatFormula({ counts: { d10: 2 }, modifier: 2, adv: -1 }, h)).toBe('2d10 + 2 - 2');
    expect(trayProfile('draw-steel').dice).toEqual(['d10', 'd6']);
  });

  test('docked in Draw Steel: Edge / Bane buttons, and the hold menu offers them on the d10', () => {
    vi.useFakeTimers();
    globalThis.game.system.id = 'draw-steel';
    dockTray(undefined, vi.fn());
    const [edge, bane] = dock().querySelectorAll('[data-adv]');
    expect([edge.textContent, bane.textContent]).toEqual(['DICER.ChatTray.Edge', 'DICER.ChatTray.Bane']);
    expect(edge.dataset.tooltip).toBe('DICER.ChatTray.EdgeHint');
    click(die('d10'));
    click(die('d10'));
    click(edge);
    expect(rollButton().dataset.tooltip).toContain('2d10 + 2');
    die('d10').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    vi.advanceTimersByTime(HOLD_MS + 10);
    expect(dock().querySelectorAll('.dicer-chat-tray-menu [data-adv]')).toHaveLength(2);
  });
});

describe('each user customizes their own tray (flag dicer.chatTray)', () => {
  const chip = (k) => dock().querySelector(`[data-pref-die="${k}"]`);
  const openPanel = () => {
    click(dock().querySelector('[data-act="customize"]'));
    click(dock().querySelector('[data-panel-tab="prefs"]'));
  };
  const shownDice = () => [...dock().querySelectorAll('.dicer-chat-tray-die')].map((b) => b.dataset.die);

  test('readPrefs validates the flag: tray dice only, in tray order; only false hides a part', () => {
    user.flags.dicer = { chatTray: { dice: ['d20', 'bogus', 'd6', 'dF'], helper: false, modifier: 'no' } };
    expect(readPrefs(user)).toEqual({ dice: ['d6', 'd20', 'dF'], helper: false });
    user.flags.dicer.chatTray = { dice: ['nope'] };
    expect(readPrefs(user)).toEqual({}); // no valid die: the system's dice
    user.flags.dicer.chatTray = 'junk';
    expect(readPrefs(user)).toEqual({});
  });

  test('trayFor lays the user choices over the system profile', () => {
    const profile = trayProfile('dnd5e');
    expect(trayFor({}, profile)).toMatchObject({ dice: profile.dice, modifier: true });
    expect(trayFor({}, profile).helper).toBe(profile.helper);
    const mine = trayFor({ dice: ['d20', 'd2'], helper: false, modifier: false }, profile);
    expect(mine).toMatchObject({ dice: ['d20', 'd2'], helper: null, modifier: false });
    expect(mine.systemHelper).toBe(profile.helper);
  });

  test('the gear opens the panel; a die chip saves the choice and the dock shows it at once', async () => {
    dockTray(undefined, vi.fn());
    openPanel();
    expect(dock().querySelector('.dicer-chat-tray-prefs')).not.toBeNull();
    expect(chip('d4').getAttribute('aria-pressed')).toBe('true');
    expect(chip('dF').getAttribute('aria-pressed')).toBe('false');
    click(chip('d4')); // hide d4
    await flush();
    expect(user.setFlag).toHaveBeenLastCalledWith('dicer', 'chatTray', {
      dice: ['d6', 'd8', 'd10', 'd12', 'd20', 'd100'],
    });
    expect(shownDice()).toEqual(['d6', 'd8', 'd10', 'd12', 'd20', 'd100']);
    expect(dock().querySelector('.dicer-chat-tray-prefs')).not.toBeNull(); // still open
    click(chip('dF')); // a die the system does not show by default
    await flush();
    expect(shownDice()).toContain('dF');
  });

  test('the last die cannot be hidden', async () => {
    user.flags.dicer = { chatTray: { dice: ['d20'] } };
    dockTray(undefined, vi.fn());
    openPanel();
    click(chip('d20'));
    await flush();
    expect(user.setFlag).not.toHaveBeenCalled();
    expect(shownDice()).toEqual(['d20']);
  });

  test('hiding the helper and the modifier removes them; the formula ignores a hidden helper', async () => {
    dockTray(undefined, vi.fn());
    click(die('d20'));
    click(dock().querySelector('[data-adv="1"]'));
    expect(rollButton().dataset.tooltip).toContain('2d20kh');
    openPanel();
    const helper = dock().querySelector('[data-pref="helper"]');
    expect(helper.parentElement.textContent).toBe('DICER.ChatTray.CustomizeHelper:DICER.ChatTray.Adv,DICER.ChatTray.Dis');
    helper.checked = false;
    helper.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(dock().querySelectorAll('.dicer-chat-tray-bar [data-adv]')).toHaveLength(0);
    expect(rollButton().dataset.tooltip).not.toContain('kh');
    const mod = dock().querySelector('[data-pref="modifier"]');
    mod.checked = false;
    mod.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(user.flags.dicer.chatTray).toEqual({ helper: false, modifier: false });
    expect(dock().querySelector('.dicer-chat-tray-mod').hidden).toBe(true);
  });

  test('a system without a helper offers no helper checkbox', () => {
    globalThis.game.system.id = 'swade';
    dockTray(undefined, vi.fn());
    openPanel();
    expect(dock().querySelector('[data-pref="helper"]')).toBeNull();
    expect(dock().querySelector('[data-pref="modifier"]')).not.toBeNull();
  });

  test('Reset goes back to the system tray', async () => {
    user.flags.dicer = { chatTray: { dice: ['d20'], modifier: false } };
    dockTray(undefined, vi.fn());
    expect(shownDice()).toEqual(['d20']);
    openPanel();
    click(dock().querySelector('[data-pref-act="reset"]'));
    await flush();
    expect(user.unsetFlag).toHaveBeenCalledWith('dicer', 'chatTray');
    expect(shownDice()).toEqual(trayProfile().dice);
  });

  test('choices saved on another device rebuild the dock (updateUser)', () => {
    dockTray(undefined, vi.fn());
    user.flags.dicer = { chatTray: { dice: ['d6', 'd20'] } };
    for (const [name, fn] of hooks) if (name === 'updateUser') fn(user, { flags: { dicer: { chatTray: {} } } });
    expect(shownDice()).toEqual(['d6', 'd20']);
  });
});

describe('Daggerheart rolls Duality through the system pipeline', () => {
  let moveBuild;
  let dualityBuild;
  beforeEach(() => {
    globalThis.game.system = { id: 'daggerheart', api: { data: { actions: { MoveContext: { build: null } } } } };
    moveBuild = vi.fn(async (data) => ({ built: data }));
    dualityBuild = vi.fn(async () => ({}));
    globalThis.game.system.api.data.actions.MoveContext.build = moveBuild;
    globalThis.CONFIG = { Dice: { daggerheart: { DualityRoll: { build: dualityBuild } } } };
  });

  test('isDuality: empty or exactly 2d12, only with the system API', () => {
    expect(isDuality({ counts: {} })).toBe(true);
    expect(isDuality({ counts: { d12: 2 } })).toBe(true);
    expect(isDuality({ counts: { d12: 1 } })).toBe(false);
    expect(isDuality({ counts: { d12: 2, d8: 1 } })).toBe(false);
    delete globalThis.CONFIG;
    expect(isDuality({ counts: {} })).toBe(false);
  });

  test('Roll with nothing picked is a Duality roll; advantage goes in as the system state', async () => {
    dockTray(undefined, vi.fn());
    expect(rollButton().disabled).toBe(false);
    expect(rollButton().dataset.tooltip).toContain('DICER.ChatTray.Duality:');
    click(dock().querySelector('[data-adv="1"]'));
    expect(rollButton().dataset.tooltip).toContain('DICER.ChatTray.DualityAdv:');
    click(rollButton());
    await flush();
    expect(moveBuild).toHaveBeenCalledWith(
      expect.objectContaining({ roll: expect.objectContaining({ type: 'trait', advantage: 1 }) }),
    );
    expect(dualityBuild).toHaveBeenCalledWith({ built: moveBuild.mock.calls[0][0] });
    expect(made).toHaveLength(0); // no plain roll
    expect(rollButton().dataset.tooltip).toContain('DICER.ChatTray.Duality:'); // cleared
  });

  test('other dice roll as a plain formula', async () => {
    dockTray(undefined, vi.fn());
    click(die('d8'));
    click(die('d8'));
    click(rollButton());
    await flush();
    expect(dualityBuild).not.toHaveBeenCalled();
    expect(made.map((r) => r.formula)).toEqual(['2d8']);
  });

  test('without the system API, 2d12 is a plain roll with the advantage d6', async () => {
    delete globalThis.CONFIG;
    dockTray(undefined, vi.fn());
    expect(rollButton().disabled).toBe(true);
    click(die('d12'));
    click(die('d12'));
    click(dock().querySelector('[data-adv="1"]'));
    click(rollButton());
    await flush();
    expect(made.map((r) => r.formula)).toEqual(['2d12 + 1d6']);
  });
});

describe('the dice bag', () => {
  test('bagChoices: my themes, then the world ones, then the built-ins; junk entries and empty groups left out', () => {
    const groups = bagChoices({ userThemes: [{ id: 'user.u1.a', name: 'Mine A' }, { name: 'no id' }, null], worldThemes: 'junk' });
    expect(groups.map((g) => g.group)).toEqual(['Mine', 'Builtin']);
    expect(groups[0].themes).toEqual([{ id: 'user.u1.a', name: 'Mine A' }]);
    expect(groups[1].themes).toHaveLength(BUILTIN_THEMES.length);
  });

  test('bagPicks: the default theme (the slot one, else the setting) and the own theme of each die type', () => {
    expect(bagPicks({ global: { theme: 'ember' }, d20: { theme: 'verdant' }, d6: { look: 'x' } }, 'default')).toMatchObject({ all: 'ember', d20: 'verdant', d6: '', d4: '' });
    expect(bagPicks(undefined, 'frost').all).toBe('frost');
    expect(bagPicks('junk').all).toBe('default');
  });

  test('the gear opens one panel with two tabs (dice bag first, then customize), remembering the last', () => {
    settings.theme = 'default';
    settings.worldThemes = [];
    dockTray(undefined, vi.fn());
    expect(dock().querySelector('[data-act="bag"]')).toBeNull(); // no button of its own: the bar keeps room for Roll
    const gear = dock().querySelector('[data-act="customize"]');
    click(gear);
    expect(dock().querySelector('.dicer-chat-tray-bag')).toBeTruthy();
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    expect([...dock().querySelectorAll('[data-panel-tab]')].map((t) => t.dataset.panelTab)).toEqual(['bag', 'prefs']);
    expect([...dock().querySelectorAll('[data-bag-slot]')].map((s) => s.dataset.bagSlot)).toEqual(['all', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);
    click(dock().querySelector('[data-panel-tab="prefs"]'));
    expect(dock().querySelector('.dicer-chat-tray-bag')).toBeNull();
    expect(dock().querySelector('.dicer-chat-tray-prefs')).toBeTruthy();
    click(gear); // closes
    expect(dock().querySelector('.dicer-chat-tray-prefs, .dicer-chat-tray-bag')).toBeNull();
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    click(gear); // back on the tab last shown
    expect(dock().querySelector('.dicer-chat-tray-prefs')).toBeTruthy();
  });

  test('the bag shows each look as a tile (a picture of the die), the picked one pressed', () => {
    settings.theme = 'default';
    settings.worldThemes = [];
    dockTray(undefined, vi.fn());
    click(dock().querySelector('[data-act="customize"]'));
    let bag = dock().querySelector('.dicer-chat-tray-bag');
    const tiles = [...bag.querySelectorAll('[data-bag-theme]')];
    expect(tiles).toHaveLength(BUILTIN_THEMES.length); // all dice: no "same as all" tile
    expect(tiles.every((t) => t.querySelector('img') && t.querySelector('svg'))).toBe(true);
    expect(bag.querySelector('[aria-pressed="true"][data-bag-theme]').dataset.bagTheme).toBe('default');
    // one die type: its own slot, led by "same as all dice" (picked while it has no theme of its own)
    click(bag.querySelector('[data-bag-slot="d20"]'));
    bag = dock().querySelector('.dicer-chat-tray-bag');
    expect(bag.querySelector('[data-bag-slot="d20"]').getAttribute('aria-pressed')).toBe('true');
    const first = bag.querySelector('[data-bag-theme]');
    expect(first.dataset.bagTheme).toBe('');
    expect(first.getAttribute('aria-pressed')).toBe('true');
  });

  test('bagView: with looks starred, only those (one Favourites group); else every group', () => {
    const groups = [
      { group: 'Mine', themes: [{ id: 'a', name: 'A' }] },
      { group: 'Builtin', themes: [{ id: 'b', name: 'B' }, { id: 'c', name: 'C' }] },
    ];
    expect(bagView(groups, [])).toBe(groups);
    expect(bagView(groups, ['c', 'a'])).toEqual([{ group: 'Favorites', themes: [{ id: 'a', name: 'A' }, { id: 'c', name: 'C' }] }]);
    expect(bagView(groups, ['c'], true)).toBe(groups); // show all
    expect(bagView(groups, ['gone'])).toBe(groups); // starred looks that are gone: everything
    expect(bagFavorites(['a', 'a', 3, '', 'b'])).toEqual(['a', 'b']);
    expect(bagFavorites('junk')).toEqual([]);
  });

  test('a star saves the look to favourites; the bag then lists only those, with a switch to all', async () => {
    settings.theme = 'default';
    settings.worldThemes = [];
    dockTray(undefined, vi.fn());
    click(dock().querySelector('[data-act="customize"]'));
    click(dock().querySelector('[data-bag-fav="default"]'));
    await flush();
    expect(user.flags.dicer.bagFavorites).toEqual(['default']);
    let bag = dock().querySelector('.dicer-chat-tray-bag');
    expect([...bag.querySelectorAll('[data-bag-theme]')].map((t) => t.dataset.bagTheme)).toEqual(['default']);
    click(bag.querySelector('[data-bag-all]')); // show all
    bag = dock().querySelector('.dicer-chat-tray-bag');
    expect(bag.querySelectorAll('[data-bag-theme]')).toHaveLength(BUILTIN_THEMES.length);
    expect(bag.querySelector('[data-bag-fav="default"]').getAttribute('aria-pressed')).toBe('true');
  });

  test('a long helper word (Fortune) can give way to its arrow; a short one (Adv) never does', () => {
    globalThis.game.system.id = 'pf2e';
    dockTray(undefined, vi.fn());
    const [up] = dock().querySelectorAll('[data-adv]');
    expect(up.classList.contains('is-long')).toBe(true);
    expect(up.textContent).toBe('DICER.ChatTray.Fortune');
    expect(up.querySelector('i.fa-angles-up')).toBeTruthy();
  });
});

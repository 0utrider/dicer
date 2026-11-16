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
  _resetChatTray,
  HOLD_MS,
} from '../../src/ui/chat-tray.js';
import { TRAY_DICE } from '../../src/hand/chunk/tray.js';
import { setHandDeps } from '../../src/hand/shell.js';

let settings;
let modules;
let user;
let made;
let hooks;

class FakeRoll {
  constructor(formula) {
    this.formula = formula;
    this.toMessage = vi.fn(async () => ({ id: 'm' }));
    made.push(this);
  }
}

beforeEach(() => {
  settings = { chatTray: true, handRollsAllowed: 'all' };
  modules = new Map();
  user = { id: 'u1', role: 1, isGM: false };
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
      get: (ns, k) => {
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
  test('on by default; off with the setting, with the Dice Tray module active, or unregistered', () => {
    expect(chatTrayShown()).toBe(true);
    settings.chatTray = false;
    expect(chatTrayShown()).toBe(false);
    settings.chatTray = true;
    modules.set('dice-tray', { active: true });
    expect(chatTrayShown()).toBe(false);
    modules.set('dice-tray', { active: false });
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
    // the setting off: Foundry's clientSettingChanged undocks it at once, and on docks it again
    const changed = hooks.filter(([n]) => n === 'clientSettingChanged');
    expect(changed).toHaveLength(1);
    const [, onSetting] = changed[0];
    settings.chatTray = false;
    onSetting('dicer.diceTray', false); // another setting: nothing
    expect(dock()).toBeTruthy();
    onSetting('dicer.chatTray', false);
    expect(dock()).toBeNull();
    settings.chatTray = true;
    onSetting('dicer.chatTray', true);
    expect(textarea().nextElementSibling).toBe(dock());
    settings.chatTray = false;
    dockTray(undefined, vi.fn());
    expect(dock()).toBeNull();
    // the Dice Tray module active: never docked
    settings.chatTray = true;
    modules.set('dice-tray', { active: true });
    dockTray({ '#chat-message': textarea() }, vi.fn());
    expect(dock()).toBeNull();
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
    expect(rollButton().textContent).toContain('2d6 + 1d20');
    expect(rollButton().disabled).toBe(false);
    rightClick(die('d6'));
    expect(die('d6').querySelector('.dicer-chat-tray-count').textContent).toBe('1');
    // the modifier stepper and typing
    click(dock().querySelector('[data-mod="1"]'));
    click(dock().querySelector('[data-mod="1"]'));
    expect(rollButton().textContent).toContain('1d6 + 1d20 + 2');
    const mod = dock().querySelector('.dicer-chat-tray-mod input');
    mod.value = '-4';
    mod.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rollButton().textContent).toContain('1d6 + 1d20 - 4');
    // advantage on the d20
    click(dock().querySelector('[data-adv="1"]'));
    expect(rollButton().textContent).toContain('2d20kh');
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
    expect(rollButton().textContent).toContain('5d6 + 2d20kh');
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
    expect(rollButton().textContent).toContain('2d20kh');
  });
});

describe('Daggerheart and Draw Steel helpers add a term instead of keeping a die', () => {
  test('Daggerheart: advantage adds a d6, disadvantage subtracts one, the duality d12s stay as rolled', () => {
    const h = trayProfile('daggerheart').helper;
    expect(h).toMatchObject({ kind: 'add', die: 'd12', term: '1d6', up: 'Adv', down: 'Dis' });
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
    expect(rollButton().textContent).toContain('2d10 + 2');
    die('d10').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    vi.advanceTimersByTime(HOLD_MS + 10);
    expect(dock().querySelectorAll('.dicer-chat-tray-menu [data-adv]')).toHaveLength(2);
  });
});

// @vitest-environment jsdom
/**
 * Typed-in dice (src/ui/manual-entry.js): the die shapes in Foundry's dice entry window, the
 * dice configuration the chat button writes and restores, and the button itself.
 */
import {
  MANUAL_KEYS,
  shapeOf,
  decorate,
  manualOn,
  manualConfig,
  rolledConfig,
  toggleManual,
  dockToggle,
} from '../../src/ui/manual-entry.js';

let store;
let infos;
beforeEach(() => {
  infos = [];
  store = {
    'core.diceConfiguration': {},
    'dicer.manualStash': {},
    'dicer.handRollMapped': [],
    'dicer.manualButton': true,
    'dicer.handRollsRequired': false,
    'dicer.manualGlow': '#00ff00',
    'dicer.manualText': '#123456',
  };
  globalThis.CONFIG = {
    Dice: {
      fulfillment: {
        methods: {
          mersenne: { label: 'Random' },
          manual: { label: 'Manual', interactive: true },
          dicer: { label: 'Dicer', interactive: true },
          pixels: { label: 'Pixels', interactive: true },
        },
      },
    },
  };
  globalThis.game = {
    settings: {
      get: (ns, k) => structuredClone(store[`${ns}.${k}`]),
      set: async (ns, k, v) => (store[`${ns}.${k}`] = structuredClone(v)),
    },
    i18n: { localize: (k) => k },
  };
  globalThis.ui = { notifications: { info: (m) => infos.push(m) } };
  globalThis.Hooks = { on: () => {} };
});
afterEach(() => {
  delete globalThis.CONFIG;
  delete globalThis.game;
  delete globalThis.ui;
  delete globalThis.Hooks;
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

const allManual = () => Object.fromEntries(MANUAL_KEYS.map((k) => [k, 'manual']));

describe('shapeOf', () => {
  it('draws each die its own outline, and a circle for an unknown one', () => {
    expect(shapeOf('d4').querySelector('polygon.body').getAttribute('points').split(' ')).toHaveLength(3);
    expect(shapeOf('d6').querySelector('rect.body')).toBeTruthy();
    expect(shapeOf('d8').querySelector('polygon.body').getAttribute('points').split(' ')).toHaveLength(4);
    expect(shapeOf('d12').querySelector('polygon.body').getAttribute('points').split(' ')).toHaveLength(5);
    expect(shapeOf('d20').querySelector('polygon.body').getAttribute('points').split(' ')).toHaveLength(6);
    expect(shapeOf('d20').querySelector('polyline.facet')).toBeTruthy();
    expect(shapeOf('d100').querySelector('polygon.body').getAttribute('points')).toBe(
      shapeOf('d10').querySelector('polygon.body').getAttribute('points'),
    );
    expect(shapeOf('d7').querySelector('circle.body')).toBeTruthy();
    expect(shapeOf('c').querySelector('circle.body')).toBeTruthy();
  });
});

describe('decorate', () => {
  const form = () => {
    document.body.innerHTML = `<form class="roll-resolver"><fieldset class="input-grid" data-term-id="a">
      <label class="icon die-input" data-denomination="d20" data-method="manual"><input type="number" name="a" value=""><i class="fas fa-dice-d20"></i></label>
      <label class="icon die-input" data-denomination="d6" data-method="pixels"><input type="number" name="b" readonly></label>
    </fieldset></form>`;
    return document.querySelector('form');
  };

  it('draws the manual dice only, in the player colours, and injects the style once', () => {
    const el = form();
    const app = { element: el, setPosition: vi.fn() };
    decorate(app, el);
    decorate(app, el);
    const [manual, pixels] = el.querySelectorAll('label');
    expect(manual.classList.contains('dicer-manual-die')).toBe(true);
    expect(manual.querySelectorAll('svg.dicer-manual-shape')).toHaveLength(1);
    expect(pixels.querySelector('svg')).toBeNull();
    expect(el.classList.contains('dicer-manual-form')).toBe(true);
    expect(el.style.getPropertyValue('--dicer-manual-glow')).toBe('#00ff00');
    expect(el.style.getPropertyValue('--dicer-manual-text')).toBe('#123456');
    expect(document.querySelectorAll('#dicer-manual-style')).toHaveLength(1);
    expect(app.setPosition).toHaveBeenCalledWith({ height: 'auto' });
  });

  it('marks a die filled once a number is typed in', () => {
    const el = form();
    decorate({ element: el }, el);
    const label = el.querySelector('label');
    label.querySelector('input').value = '17';
    label.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
    expect(label.classList.contains('dicer-manual-filled')).toBe(true);
  });

  it('draws a die Foundry adds later (a reroll) without a render', async () => {
    const el = form();
    decorate({ element: el }, el);
    const extra = document.createElement('label');
    extra.className = 'icon die-input new-addition';
    extra.dataset.denomination = 'd8';
    extra.dataset.method = 'manual';
    extra.innerHTML = '<input type="number">';
    el.querySelector('fieldset').append(extra);
    await new Promise((r) => setTimeout(r));
    expect(extra.querySelector('svg.dicer-manual-shape')).toBeTruthy();
  });

  it('falls back to the default colours when the settings are not there', () => {
    game.settings.get = () => {
      throw new Error('not registered');
    };
    const el = form();
    decorate({ element: el }, el);
    expect(el.style.getPropertyValue('--dicer-manual-glow')).toBe('#ff9f1c');
  });
});

describe('the dice configuration', () => {
  it('types in every die, keeping Pixels and stashing what each die had', () => {
    const { out, stash } = manualConfig({ d20: 'pixels', d6: 'mersenne', d8: 'dicer', d10: 'dicer' }, ['d8']);
    expect(out.d20).toBe('pixels');
    for (const k of MANUAL_KEYS.filter((k) => k !== 'd20')) expect(out[k]).toBe('manual');
    expect(stash.d20).toBeUndefined();
    expect(stash.d6).toBe('mersenne');
    expect(stash.d8).toBe(''); // Dicer's own mapping: the hand sync maps it again
    expect(stash.d10).toBe('dicer'); // the user's own pick comes back
    expect(stash.default).toBe('');
    expect(manualOn(out)).toBe(true);
  });

  it('rolls again: the stashed methods come back, the rest go', () => {
    const out = rolledConfig({ ...allManual(), d20: 'pixels' }, { d6: 'mersenne', d10: 'dicer', d8: '' });
    expect(out).toEqual({ d20: 'pixels', d6: 'mersenne', d10: 'dicer' });
    expect(manualOn(out)).toBe(false);
  });

  it('is on only when every die is typed in (or held by physical dice)', () => {
    expect(manualOn({})).toBe(false);
    expect(manualOn({ d20: 'manual' })).toBe(false);
    expect(manualOn(allManual())).toBe(true);
    expect(manualOn(Object.fromEntries(MANUAL_KEYS.map((k) => [k, 'pixels'])))).toBe(false);
  });

  it('toggleManual switches and restores, then runs the hand sync', async () => {
    store['core.diceConfiguration'] = { d6: 'mersenne' };
    const sync = vi.fn();
    dockToggle(null, sync);
    await toggleManual();
    expect(manualOn(store['core.diceConfiguration'])).toBe(true);
    expect(store['dicer.manualStash'].d6).toBe('mersenne');
    expect(sync).toHaveBeenCalledTimes(1);
    expect(infos.at(-1)).toBe('DICER.Manual.On');
    await toggleManual();
    expect(store['core.diceConfiguration']).toEqual({ d6: 'mersenne' });
    expect(store['dicer.manualStash']).toEqual({});
    expect(infos.at(-1)).toBe('DICER.Manual.Off');
  });
});

describe('dockToggle', () => {
  const controls = () => {
    document.body.innerHTML = '<div id="chat-controls"><div id="message-modes"></div></div>';
    return document.getElementById('chat-controls');
  };

  it('puts the button after the message modes, pressed when the dice are typed in', () => {
    const c = controls();
    store['core.diceConfiguration'] = allManual();
    const b = dockToggle({ '#chat-controls': c });
    expect(c.querySelector('#message-modes').nextElementSibling).toBe(b);
    expect(b.querySelector('button').getAttribute('aria-pressed')).toBe('true');
    expect(b.querySelector('button').getAttribute('aria-label')).toBe('DICER.Manual.ButtonOn');
  });

  it('removes the button when the GM turns it off or hand rolls are required', () => {
    const c = controls();
    dockToggle({ '#chat-controls': c });
    expect(c.querySelector('.dicer-manual-toggle')).toBeTruthy();
    store['dicer.handRollsRequired'] = true;
    expect(dockToggle({ '#chat-controls': c })).toBeNull();
    expect(c.querySelector('.dicer-manual-toggle')).toBeNull();
    store['dicer.handRollsRequired'] = false;
    store['dicer.manualButton'] = false;
    expect(dockToggle({ '#chat-controls': c })).toBeNull();
  });
});

// @vitest-environment jsdom
/**
 * The Your pet window: the player's own pet (the dicer.pet user flag), its kind and colour, saved
 * at once; never part of a theme.
 */
import { buildPetForm, savePet, openPetWindow } from '../../src/ui/pet-window.js';

let flags;
let user;
let store;
beforeEach(() => {
  flags = {};
  store = {};
  user = {
    id: 'u1',
    color: '#778899',
    getFlag: (scope, key) => flags[key],
    setFlag: vi.fn(async (scope, key, value) => {
      flags[key] = value;
    }),
  };
  globalThis.game = {
    user,
    i18n: { localize: (k) => k },
    settings: { get: (ns, k) => store[k] },
  };
  globalThis.ui = { notifications: { warn: vi.fn() } };
});
afterEach(() => {
  delete globalThis.game;
  delete globalThis.ui;
  delete globalThis.foundry;
});

const kinds = (form) => [...form.querySelectorAll('[data-kind]')];

describe('the form', () => {
  test('one button per kind, the current one active; the colour in both inputs', () => {
    const form = buildPetForm({ kind: 'dragonling', color: '#112233' });
    expect(kinds(form).map((b) => b.dataset.kind)).toEqual(['none', 'mimic', 'slime', 'dragonling', 'owl', 'frog', 'ghost', 'mushroom', 'eye', 'golem', 'cat']);
    expect(kinds(form).filter((b) => b.classList.contains('active')).map((b) => b.dataset.kind)).toEqual(['dragonling']);
    expect([...form.querySelectorAll('[data-pet-color]')].map((i) => i.value)).toEqual(['#112233', '#112233']);
    expect(form.querySelector('.dicer-pet-off')).toBeNull();
  });

  test('a Natural colours box, ticked when the pet wears its own colours', () => {
    const box = (pet) => buildPetForm(pet).querySelector('[data-pet-natural]');
    expect(box({ kind: 'owl', color: '#112233' }).checked).toBe(false);
    expect(box({ kind: 'owl', color: '#112233', natural: true }).checked).toBe(true);
  });

  test('a voice pitch slider with its value; readPitch clamps the stored one', async () => {
    const { readPitch } = await import('../../src/ui/pet-window.js');
    const form = buildPetForm({ kind: 'owl', color: '#112233', pitch: 1.5 });
    expect(form.querySelector('[data-pet-pitch]').value).toBe('1.5');
    expect(form.querySelector('.dicer-pet-pitch output').textContent).toBe('×1.50');
    expect(buildPetForm({ kind: 'none', color: '#112233' }).querySelector('[data-pet-pitch]')).toBeNull();
    expect(readPitch({ getFlag: () => ({ pitch: 7 }) })).toBe(2);
    expect(readPitch({ getFlag: () => undefined })).toBe(1);
  });

  test('a Preview button (not for no pet) throws one local d20 with the pet', async () => {
    const { previewPet } = await import('../../src/ui/pet-window.js');
    expect(buildPetForm({ kind: 'cat', color: '#112233' }).querySelector('[data-act="preview"]')).not.toBeNull();
    expect(buildPetForm({ kind: 'none', color: '#112233' }).querySelector('[data-act="preview"]')).toBeNull();
    const throwLook = vi.fn();
    const had = globalThis.game.dice3d;
    globalThis.game.dice3d = { _throwLook: throwLook };
    previewPet();
    expect(throwLook).toHaveBeenCalledWith(null, ['d20']);
    globalThis.game.dice3d = had;
  });

  test('no pet: no colour; pets off by the GM or hidden here: a note', () => {
    expect(buildPetForm({ kind: 'none', color: '#112233' }).querySelector('[data-pet-color]')).toBeNull();
    expect(buildPetForm({ kind: 'mimic', color: '#112233' }, { allowed: false }).textContent).toContain('DICER.PetWindow.Off');
    expect(buildPetForm({ kind: 'mimic', color: '#112233' }, { hidden: true }).textContent).toContain('DICER.Appearance.Pet.Hidden');
  });
});

describe('pet settings rows', () => {
  test('a checkbox, a select or a slider from the registration; changes save as the setting’s type', async () => {
    const { settingRow, controlValue } = await import('../../src/ui/pet-window.js');
    const box = settingRow('petClick', { name: 'N', hint: 'H', type: Boolean }, false);
    expect(box.querySelector('input[type=checkbox]').checked).toBe(false);
    const sel = settingRow('petRestSpot', { name: 'N', hint: 'H', type: String, choices: { dice: 'D', topLeft: 'TL' } }, 'topLeft');
    expect(sel.querySelector('select').value).toBe('topLeft');
    const range = settingRow('petScale', { name: 'N', hint: 'H', type: Number, range: { min: 0.5, max: 3, step: 0.1 } }, 1.5);
    const slider = range.querySelector('input[type=range]');
    expect([slider.min, slider.max, slider.value]).toEqual(['0.5', '3', '1.5']);
    expect(settingRow('x', undefined, 1)).toBeNull();
    slider.value = '2';
    expect(controlValue(slider, { type: Number })).toBe(2);
    expect(controlValue(sel.querySelector('select'), { type: String })).toBe('topLeft');
  });

  test('the window lists the registered pet settings and saves a change at once', async () => {
    const set = vi.fn(async () => {});
    globalThis.game.settings = {
      get: (ns, k) => store[k],
      set,
      settings: new Map([
        ['dicer.petClick', { name: 'Click', hint: 'h', type: Boolean }],
        ['dicer.petStay', { name: 'Stay', hint: 'h', type: Number, choices: { 30: '30', 60: '60' } }],
      ]),
    };
    store.petClick = true;
    store.petStay = 60;
    const form = buildPetForm({ kind: 'mimic', color: '#112233' });
    expect([...form.querySelectorAll('[data-setting]')].map((r) => r.dataset.setting)).toEqual(['petStay', 'petClick']);
    globalThis.foundry = {
      applications: {
        api: {
          ApplicationV2: class {
            constructor() {
              this.element = document.createElement('div');
            }
            async render() {
              this._replaceHTML(await this._renderHTML(), this.element);
              this.rendered = true;
              return this;
            }
          },
        },
      },
    };
    const app = await openPetWindow();
    const select = app.element.querySelector('[data-setting="petStay"] select');
    select.value = '30';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(set).toHaveBeenCalledWith('dicer', 'petStay', 30);
  });
});

describe('savePet', () => {
  test('writes only the changed field over the raw flag (no stored colour keeps following the player colour)', async () => {
    flags.pet = { kind: 'dragonling', later: 1 };
    await savePet({ color: '#abcdef' });
    expect(user.setFlag).toHaveBeenLastCalledWith('dicer', 'pet', { kind: 'dragonling', later: 1, color: '#abcdef' });
    flags.pet = undefined;
    await savePet({ kind: 'slime' });
    expect(user.setFlag).toHaveBeenLastCalledWith('dicer', 'pet', { kind: 'slime' });
  });

  test('a failed save warns and says so', async () => {
    user.setFlag.mockImplementation(() => {
      throw new Error('nope');
    });
    expect(await savePet({ kind: 'slime' })).toBe(false);
    expect(ui.notifications.warn).toHaveBeenCalledWith('DICER.Appearance.Pet.SaveFailed');
  });
});

describe('the window', () => {
  // A minimal ApplicationV2: render puts _renderHTML's result into a content element.
  class FakeApp {
    constructor() {
      this.element = document.createElement('div');
      this.rendered = false;
    }
    async render() {
      this._replaceHTML(await this._renderHTML(), this.element);
      this.rendered = true;
      return this;
    }
  }
  beforeEach(() => {
    globalThis.foundry = { applications: { api: { ApplicationV2: FakeApp } } };
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test('picking a kind saves it; the stored kind again saves nothing', async () => {
    flags.pet = { kind: 'mimic', color: '#445566' };
    const app = await openPetWindow();
    app.element.querySelector('[data-kind="slime"]').click();
    await flush();
    expect(user.setFlag).toHaveBeenCalledWith('dicer', 'pet', { kind: 'slime', color: '#445566' });
    user.setFlag.mockClear();
    app.element.querySelector('[data-kind="slime"]').click();
    await flush();
    expect(user.setFlag).not.toHaveBeenCalled();
  });

  test('typing a colour mirrors it; the change saves it; half typed saves nothing', async () => {
    flags.pet = { kind: 'slime', color: '#445566' };
    const app = await openPetWindow();
    const [picker, text] = app.element.querySelectorAll('[data-pet-color]');
    text.value = '#abcdef';
    text.dispatchEvent(new Event('input', { bubbles: true }));
    expect(picker.value).toBe('#abcdef');
    expect(user.setFlag).not.toHaveBeenCalled();
    text.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(user.setFlag).toHaveBeenCalledWith('dicer', 'pet', { kind: 'slime', color: '#abcdef', natural: false });
    text.value = '#12';
    text.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(user.setFlag).toHaveBeenCalledTimes(1);
  });
});

test('every pet label the window uses is in lang/en.json under DICER.Appearance.Pet / PetWindow', async () => {
  const { readFileSync } = await import('node:fs');
  const lang = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER;
  const src = readFileSync('src/ui/pet-window.js', 'utf8');
  const used = [...src.matchAll(/DICER.(Appearance.Pet|PetWindow).([A-Za-z]+)/g)].map((m) => [m[1], m[2]]);
  expect(used.length).toBeGreaterThan(5);
  const at = (path) => path.split('.').reduce((o, k) => o?.[k], lang);
  expect(used.filter(([sec, key]) => typeof at(sec)?.[key] !== 'string').map(([s2, k]) => `${s2}.${k}`)).toEqual([]);
  // the kind labels come from LABELS
  for (const label of ['Mimic', 'Slime', 'Dragonling', 'Owl', 'Frog', 'Ghost', 'Mushroom', 'Eye', 'Golem', 'Cat']) expect(typeof lang.Appearance.Pet[label]).toBe('string');
});

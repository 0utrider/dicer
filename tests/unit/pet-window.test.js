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
    expect(kinds(form).map((b) => b.dataset.kind)).toEqual(['none', 'mimic', 'slime', 'dragonling', 'owl', 'frog', 'ghost', 'mushroom', 'eye', 'golem', 'cat', 'fox', 'lantern', 'imp', 'robot', 'jester', 'raven', 'spider', 'skull']);
    expect(kinds(form).filter((b) => b.classList.contains('active')).map((b) => b.dataset.kind)).toEqual(['dragonling']);
    expect([...form.querySelectorAll('[data-pet-color]')].map((i) => i.value)).toEqual(['#112233', '#112233']);
    expect(form.querySelector('.dicer-pet-off')).toBeNull();
  });

  test('the drone is offered only in a Starfinder 2e world, or when it is already the pet', () => {
    const shown = (pet) => kinds(buildPetForm(pet)).map((b) => b.dataset.kind);
    expect(shown({ kind: 'owl', color: '#112233' })).not.toContain('drone');
    globalThis.game.system = { id: 'pf2e' };
    expect(shown({ kind: 'owl', color: '#112233' })).not.toContain('drone');
    expect(shown({ kind: 'drone', color: '#112233' }).at(-1)).toBe('drone');
    globalThis.game.system = { id: 'sf2e' };
    expect(shown({ kind: 'owl', color: '#112233' }).slice(-4)).toEqual(['raven', 'spider', 'skull', 'drone']);
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
    expect(throwLook).toHaveBeenLastCalledWith(null, ['d20'], undefined, user); // any face, this user's pet
    flags.pet = { catch: true };
    previewPet();
    expect(throwLook).toHaveBeenLastCalledWith(null, ['d20'], 20, user); // a catching pet shows its catch
    const other = { id: 'u2', getFlag: () => undefined };
    previewPet(other);
    expect(throwLook).toHaveBeenLastCalledWith(null, ['d20'], undefined, other); // a GM previews a player's pet
    globalThis.game.dice3d = had;
  });

  test('a "catches your natural 20s" box, ticked from the flag; ticking it saves catch over the raw flag', async () => {
    const { readCatch } = await import('../../src/ui/pet-window.js');
    const box = (pet) => buildPetForm(pet).querySelector('[data-pet-catch]');
    expect(box({ kind: 'mimic', color: '#112233' }).checked).toBe(false);
    expect(box({ kind: 'mimic', color: '#112233', catch: true }).checked).toBe(true);
    expect(buildPetForm({ kind: 'none', color: '#112233' }).querySelector('[data-pet-catch]')).toBeNull();
    expect(readCatch({ getFlag: () => ({ catch: true }) })).toBe(true);
    expect(readCatch({ getFlag: () => ({ catch: 'yes' }) })).toBe(false);
    expect(readCatch({ getFlag: () => undefined })).toBe(false);
    flags.pet = { kind: 'slime', pitch: 1.2 };
    expect(await savePet({ catch: true })).toBe(true);
    expect(flags.pet).toEqual({ kind: 'slime', pitch: 1.2, catch: true });
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

describe('a GM sets pets for players', () => {
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
  const flush = () => new Promise((r) => setTimeout(r, 0));
  let bob;
  let alice;
  const mkUser = (id, name, pet) => {
    const f = { pet };
    return {
      id,
      name,
      color: '#334455',
      getFlag: (scope, key) => f[key],
      setFlag: vi.fn(async (scope, key, value) => {
        f[key] = value;
      }),
      flags: f,
    };
  };
  beforeEach(() => {
    globalThis.foundry = { applications: { api: { ApplicationV2: FakeApp } } };
    user.isGM = true;
    user.name = 'Gamemaster';
    bob = mkUser('u3', 'Bob', { kind: 'owl', color: '#010203', pitch: 1.5, catch: true });
    alice = mkUser('u2', 'alice', undefined);
    const all = [bob, user, alice];
    globalThis.game.users = Object.assign(all, { get: (id) => all.find((u) => u.id === id) });
  });

  test('petPlayers: the GM first, then the others by name; nothing for a player', async () => {
    const { petPlayers } = await import('../../src/ui/pet-window.js');
    expect(petPlayers()).toEqual([
      { id: 'u1', name: 'Gamemaster' },
      { id: 'u2', name: 'alice' },
      { id: 'u3', name: 'Bob' },
    ]);
    user.isGM = false;
    expect(petPlayers()).toEqual([]);
  });

  test('the form: a Player select only with players; another player loses the settings rows and gets a note', () => {
    globalThis.game.settings.settings = new Map([['dicer.petClick', { name: 'Click', hint: 'h', type: Boolean }]]);
    const players = [
      { id: 'u1', name: 'GM' },
      { id: 'u3', name: 'Bob' },
    ];
    const pet = { kind: 'owl', color: '#010203' };
    expect(buildPetForm(pet).querySelector('[data-pet-player]')).toBeNull();
    const own = buildPetForm(pet, { players, target: 'u1', hidden: true });
    expect([...own.querySelectorAll('[data-pet-player] option')].map((o) => [o.value, o.textContent, o.selected])).toEqual([
      ['u1', 'GM', true],
      ['u3', 'Bob', false],
    ]);
    expect(own.querySelector('[data-setting="petClick"]')).not.toBeNull();
    expect(own.textContent).not.toContain('DICER.PetWindow.OtherSettings');
    const theirs = buildPetForm(pet, { players, target: 'u3', hidden: true });
    expect(theirs.querySelector('[data-pet-player]').value).toBe('u3');
    expect(theirs.querySelector('[data-setting]')).toBeNull();
    expect(theirs.textContent).toContain('DICER.PetWindow.OtherSettings');
    expect(theirs.textContent).not.toContain('DICER.Appearance.Pet.Hidden'); // the GM's own showPets is not theirs
  });

  test('picking a player loads their pet, pitch and catch; every change saves on them, not the GM', async () => {
    flags.pet = { kind: 'mimic', color: '#445566' };
    const app = await openPetWindow();
    const select = app.element.querySelector('[data-pet-player]');
    expect(select.value).toBe('u1');
    select.value = 'u3';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const el = app.element;
    expect(el.querySelector('[data-pet-player]').value).toBe('u3');
    expect(el.querySelector('[data-kind="owl"]').classList.contains('active')).toBe(true);
    expect(el.querySelector('[data-pet-color]').value).toBe('#010203');
    expect(el.querySelector('[data-pet-pitch]').value).toBe('1.5');
    expect(el.querySelector('[data-pet-catch]').checked).toBe(true);

    el.querySelector('[data-kind="cat"]').click();
    await flush();
    expect(bob.flags.pet).toEqual({ kind: 'cat', color: '#010203', pitch: 1.5, catch: true });
    const pitch = app.element.querySelector('[data-pet-pitch]');
    pitch.value = '0.75';
    pitch.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const box = app.element.querySelector('[data-pet-catch]');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const [, text] = app.element.querySelectorAll('[data-pet-color]');
    text.value = '#abcdef';
    text.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(bob.flags.pet).toEqual({ kind: 'cat', color: '#abcdef', natural: false, pitch: 0.75, catch: false });
    expect(user.setFlag).not.toHaveBeenCalled();

    const throwLook = vi.fn();
    globalThis.game.dice3d = { _throwLook: throwLook };
    app.element.querySelector('[data-act="preview"]').click();
    expect(throwLook).toHaveBeenLastCalledWith(null, ['d20'], undefined, bob); // the preview throws with Bob's pet
  });

  test('a player sees no Player select', async () => {
    user.isGM = false;
    const app = await openPetWindow();
    expect(app.element.querySelector('[data-pet-player]')).toBeNull();
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

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
    expect(kinds(form).map((b) => b.dataset.kind)).toEqual(['none', 'mimic', 'slime', 'dragonling']);
    expect(kinds(form).filter((b) => b.classList.contains('active')).map((b) => b.dataset.kind)).toEqual(['dragonling']);
    expect([...form.querySelectorAll('[data-pet-color]')].map((i) => i.value)).toEqual(['#112233', '#112233']);
    expect(form.querySelector('.dicer-pet-off')).toBeNull();
  });

  test('no pet: no colour; pets off by the GM or hidden here: a note', () => {
    expect(buildPetForm({ kind: 'none', color: '#112233' }).querySelector('[data-pet-color]')).toBeNull();
    expect(buildPetForm({ kind: 'mimic', color: '#112233' }, { allowed: false }).textContent).toContain('DICER.PetWindow.Off');
    expect(buildPetForm({ kind: 'mimic', color: '#112233' }, { hidden: true }).textContent).toContain('DICER.Appearance.Pet.Hidden');
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
    expect(user.setFlag).toHaveBeenCalledWith('dicer', 'pet', { kind: 'slime', color: '#abcdef' });
    text.value = '#12';
    text.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(user.setFlag).toHaveBeenCalledTimes(1);
  });
});

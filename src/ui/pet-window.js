/**
 * The Your pet window (lazy chunk; Configure Settings, Dicer, Your pet, or the theme browser's Pet
 * button): the player's own dice pet, its kind and colour. The pet is the user's flag (dicer.pet),
 * not part of any theme, so it comes along whatever dice they roll, module dice sets included.
 * Each change saves at once.
 */
import { PET_KINDS, readPet } from '../pet/pet-for.js';

const MODULE = 'dicer';
const HEX6 = /^#[0-9a-f]{6}$/;
const ICONS = {
  none: 'fa-ban',
  mimic: 'fa-box-open',
  slime: 'fa-droplet',
  dragonling: 'fa-dragon',
  owl: 'fa-crow',
  frog: 'fa-frog',
  ghost: 'fa-ghost',
  mushroom: 'fa-seedling',
  eye: 'fa-eye',
  golem: 'fa-mountain',
  cat: 'fa-cat',
};
const LABELS = {
  none: 'None',
  mimic: 'Mimic',
  slime: 'Slime',
  dragonling: 'Dragonling',
  owl: 'Owl',
  frog: 'Frog',
  ghost: 'Ghost',
  mushroom: 'Mushroom',
  eye: 'Eye',
  golem: 'Golem',
  cat: 'Cat',
};
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const me = () => globalThis.game?.user;
const setting = (key) => {
  try {
    return globalThis.game.settings.get(MODULE, key);
  } catch {
    return undefined;
  }
};

function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === undefined || v === null) continue;
    if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids);
  return el;
}

/** This player's pet settings, in the window's order (each registered with config: false in settings.js). */
export const PET_SETTINGS = ['showPets', 'petScale', 'petRestSpot', 'petStay', 'petSplat', 'petClick', 'petElemental', 'petMoods', 'petCheer', 'petSounds'];

/**
 * One setting row from its registration (`cfg`: name, hint, type, choices, range) and value: a
 * checkbox, a select or a slider. Null for an unregistered key.
 */
export function settingRow(key, cfg, value) {
  if (!cfg) return null;
  const name = `dicer.${key}`;
  let control;
  if (cfg.choices) {
    control = h(
      'select',
      { name },
      Object.entries(cfg.choices).map(([v, label]) => h('option', { value: v, selected: String(value) === v, text: loc(label) })),
    );
  } else if (cfg.type === Boolean) {
    control = h('input', { type: 'checkbox', name, checked: value !== false });
  } else if (cfg.range) {
    control = h('span', { class: 'dicer-pet-range' }, [
      h('input', { type: 'range', name, min: String(cfg.range.min), max: String(cfg.range.max), step: String(cfg.range.step), value: String(value) }),
      h('output', { text: String(value) }),
    ]);
  } else return null;
  return h('div', { class: 'dicer-pet-setting', 'data-setting': key }, [
    h('label', {}, [h('span', { class: 'dicer-pet-setting-name', text: loc(cfg.name) }), control]),
    h('p', { class: 'dicer-hint', text: loc(cfg.hint) }),
  ]);
}

/** The value a settings control holds, as its setting's type. */
export function controlValue(el, cfg) {
  if (el.type === 'checkbox') return el.checked;
  return cfg?.type === Number ? Number(el.value) : el.value;
}

/** The voice pitch shown as text: 1 is the pet's own voice. */
export const pitchText = (p) => `×${Number(p).toFixed(2)}`;

/** The user's raw pet pitch (the dicer.pet flag's `pitch`, 0.5..2; 1 when unset). */
export function readPitch(user) {
  let p;
  try {
    p = user?.getFlag?.(MODULE, 'pet')?.pitch;
  } catch {
    /* unreadable: 1 */
  }
  return typeof p === 'number' && Number.isFinite(p) ? Math.min(2, Math.max(0.5, p)) : 1;
}

/** The window's content for `pet` ({kind, color, natural, pitch}); `allowed`: the GM's petsAllowed; `hidden`: showPets off. */
export function buildPetForm(pet, { allowed = true, hidden = false } = {}) {
  const notes = [
    h('p', { class: 'dicer-hint', text: loc('DICER.Appearance.Pet.Hint') }),
    ...(allowed ? [] : [h('p', { class: 'dicer-hint dicer-pet-off', text: loc('DICER.PetWindow.Off') })]),
    ...(hidden ? [h('p', { class: 'dicer-hint dicer-pet-off' }, [h('i', { class: 'fa-solid fa-eye-slash' }), ` ${loc('DICER.Appearance.Pet.Hidden')}`])] : []),
  ];
  const chips = h(
    'div',
    { class: 'dicer-pet-kinds', role: 'radiogroup', 'aria-label': loc('DICER.Appearance.Pet.Title') },
    PET_KINDS.map((id) =>
      h('button', { type: 'button', class: `dicer-pet-kind${id === pet.kind ? ' active' : ''}`, role: 'radio', 'aria-checked': String(id === pet.kind), 'data-kind': id }, [
        h('i', { class: `fa-solid ${ICONS[id]}`, 'aria-hidden': 'true' }),
        h('span', { text: loc(`DICER.Appearance.Pet.${LABELS[id]}`) }),
      ]),
    ),
  );
  // natural: the kind's own colours; the picker stays, and picking a colour turns natural off
  const color = h('div', { class: 'dicer-pet-color' }, [
    h('span', { text: loc('DICER.Appearance.Pet.Color') }),
    h('label', { class: 'dicer-pet-natural', 'data-tooltip': loc('DICER.Appearance.Pet.NaturalHint') }, [
      h('input', { type: 'checkbox', 'data-pet-natural': '', checked: !!pet.natural }),
      h('span', { text: loc('DICER.Appearance.Pet.Natural') }),
    ]),
    h('input', { type: 'color', value: pet.color, 'data-pet-color': '', 'aria-label': loc('DICER.Appearance.Pet.Color') }),
    h('input', { type: 'text', value: pet.color, maxlength: '7', spellcheck: 'false', 'data-pet-color': '', 'aria-label': loc('DICER.Appearance.Pet.Color') }),
  ]);
  // the voice: a playback rate on the pet's sounds (its kind's own voice times this)
  const pitch = h('label', { class: 'dicer-pet-pitch', 'data-tooltip': loc('DICER.Appearance.Pet.PitchHint') }, [
    h('span', { text: loc('DICER.Appearance.Pet.Pitch') }),
    h('input', { type: 'range', min: '0.5', max: '2', step: '0.05', value: String(pet.pitch ?? 1), 'data-pet-pitch': '' }),
    h('output', { text: pitchText(pet.pitch ?? 1) }),
  ]);
  const registered = globalThis.game?.settings?.settings;
  const rows = PET_SETTINGS.map((key) => settingRow(key, registered?.get?.(`dicer.${key}`), setting(key))).filter(Boolean);
  return h('form', { class: 'dicer-pet-window' }, [
    ...notes,
    chips,
    ...(pet.kind === 'none'
      ? []
      : [
          color,
          pitch,
          // a local throw: the pet comes, throws one d20, reacts and settles, on this screen only
          h('button', { type: 'button', class: 'dicer-pet-preview', 'data-act': 'preview' }, [
            h('i', { class: 'fa-solid fa-play', 'aria-hidden': 'true' }),
            ` ${loc('DICER.Appearance.Pet.Preview')}`,
          ]),
        ]),
    ...(rows.length ? [h('h3', { class: 'dicer-pet-heading', text: loc('DICER.PetWindow.Settings') }), ...rows] : []),
  ]);
}

/**
 * Saves a change to the user's pet: only the changed field over the RAW stored flag (not readPet's
 * filled defaults), so a pet with no stored colour keeps following the player colour. True when saved.
 */
export async function savePet(change, user = me()) {
  try {
    const raw = user.getFlag(MODULE, 'pet');
    await user.setFlag(MODULE, 'pet', { ...(raw && typeof raw === 'object' ? raw : {}), ...change });
    return true;
  } catch {
    globalThis.ui?.notifications?.warn(loc('DICER.Appearance.Pet.SaveFailed'));
    return false;
  }
}

/** Throws one d20 on this screen only (no roll, no chat message): the pet comes and plays it out. */
export function previewPet() {
  try {
    return globalThis.game?.dice3d?._throwLook?.(null, ['d20']);
  } catch {
    return undefined;
  }
}

let app = null;

/** Opens (or brings forward) the Your pet window. */
export function openPetWindow() {
  const { ApplicationV2 } = globalThis.foundry.applications.api;
  class PetWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: 'dicer-pet-window',
      classes: ['dicer-pet-window-app'],
      window: { title: 'DICER.PetWindow.Title', icon: 'fa-solid fa-dragon', resizable: true },
      position: { width: 460, height: 'auto' },
    };
    async _renderHTML() {
      return buildPetForm({ ...readPet(me()), pitch: readPitch(me()) }, { allowed: setting('petsAllowed') !== false, hidden: setting('showPets') === false });
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
      result.addEventListener('click', (event) => {
        if (event.target.closest?.('[data-act="preview"]')) return previewPet();
        this.#onClick(event.target.closest?.('[data-kind]'));
      });
      // dragging the picker or typing only mirrors the value; the save is on change
      result.addEventListener('input', (event) => this.#mirror(event.target));
      result.addEventListener('change', (event) => this.#onColor(event.target));
    }
    async #onClick(button) {
      const kind = button?.dataset.kind;
      if (!PET_KINDS.includes(kind) || kind === readPet(me()).kind) return;
      if (await savePet({ kind })) this.render();
    }
    #mirror(el) {
      // a slider shows its value as it moves
      if (el?.type === 'range') el.nextElementSibling.textContent = el.matches('[data-pet-pitch]') ? pitchText(el.value) : el.value;
      if (!el?.matches?.('[data-pet-color]')) return null;
      const v = String(el.value).trim().toLowerCase();
      if (!HEX6.test(v)) return null; // half typed: wait
      for (const input of this.element.querySelectorAll('[data-pet-color]')) input.value = v;
      return v;
    }
    async #onColor(el) {
      const key = el?.closest?.('[data-setting]')?.dataset.setting;
      if (key) return this.#onSetting(key, el);
      if (el?.matches?.('[data-pet-pitch]')) {
        if (!(await savePet({ pitch: Math.min(2, Math.max(0.5, Number(el.value) || 1)) }))) this.render();
        return;
      }
      if (el?.matches?.('[data-pet-natural]')) {
        if (!(await savePet({ natural: el.checked }))) this.render();
        return;
      }
      const v = this.#mirror(el);
      if (!v) return;
      // a colour picked: the pet wears it, natural colours off
      const box = this.element.querySelector('[data-pet-natural]');
      if (box) box.checked = false;
      if (!(await savePet({ color: v, natural: false }))) this.render(); // show the stored colour again
    }
    /** A pet setting changed: saved at once (its own onChange wakes the pets); showPets redraws the notes. */
    async #onSetting(key, el) {
      const cfg = globalThis.game.settings.settings.get(`dicer.${key}`);
      try {
        await globalThis.game.settings.set(MODULE, key, controlValue(el, cfg));
      } catch (err) {
        console.warn(`dicer: cannot save ${key}`, err);
      }
      if (key === 'showPets') this.render();
    }
  }
  if (!app?.rendered) app = new PetWindow();
  return app.render({ force: true });
}

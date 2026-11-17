/**
 * The Dice from installed modules window (lazy chunk; GM; the theme browser's Installed dice): the inactive installed modules that add dice, a box each to load their dice without
 * activating them (compat/installed-dice.js). Saved as each box changes; the world setting's
 * onChange loads new picks on every client. Unpicked dice go away at the next reload.
 */
import { scanInstalled, isLoaded, fetchText } from '../compat/installed-dice.js';

const MODULE = 'dicer';
const KEY = 'installedDice';
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const read = () => {
  try {
    const v = globalThis.game.settings.get(MODULE, KEY);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
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

/** The list: a box per module that only adds dice, the others greyed with why. */
export function buildList(found, picked) {
  const ids = new Set(picked.map((p) => p.id));
  const rows = found.map((m) => {
    const ok = m.status === 'ok';
    const box = h('input', { type: 'checkbox', name: m.id, checked: ok && ids.has(m.id), disabled: !ok });
    const note = ok
      ? !ids.has(m.id) && isLoaded(m.id) ? loc('DICER.InstalledDice.AfterReload') : '' // unpicked, still here
      : loc(`DICER.InstalledDice.Status.${m.status}`);
    return h('li', { class: ok ? '' : 'is-off' }, [
      h('label', {}, [box, h('span', { class: 'dicer-installed-title', text: m.title })]),
      ...(note ? [h('small', { class: 'dicer-hint', text: note })] : []),
    ]);
  });
  return h('form', { class: 'dicer-installed-dice' }, [
    h('style', { text: CSS }),
    h('p', { class: 'dicer-hint', text: loc('DICER.InstalledDice.Intro') }),
    found.length ? h('ul', {}, rows) : h('p', { class: 'dicer-empty', text: loc('DICER.InstalledDice.None') }),
    h('p', { class: 'dicer-hint', text: loc('DICER.InstalledDice.Remove') }),
  ]);
}

/** The setting after a box changed: the module added (with its title and scripts) or removed. */
export function togglePick(picked, mod, on) {
  const rest = picked.filter((p) => p.id !== mod.id);
  return on ? [...rest, { id: mod.id, title: mod.title, scripts: [...mod.scripts] }] : rest;
}

// its own look, here in the lazy chunk (not in dicer.css, which every world start loads)
const CSS =
  '.dicer-installed-dice ul{list-style:none;margin:.5em 0;padding:0}' +
  '.dicer-installed-dice li{padding:.4em 0;border-bottom:1px solid var(--color-border-light-tertiary,rgba(127,127,127,.25))}' +
  '.dicer-installed-dice li.is-off{opacity:.6}' +
  '.dicer-installed-dice label{display:flex;gap:.5em;align-items:center}' +
  '.dicer-installed-dice li small{display:block;margin-inline-start:1.9em}';

let app = null;

/** Opens (or brings forward) the window; GM only. */
export function openInstalledDice() {
  if (!globalThis.game?.user?.isGM) return null;
  const { ApplicationV2 } = globalThis.foundry.applications.api;
  class InstalledDice extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: 'dicer-installed-dice',
      classes: ['dicer-installed-dice-app'],
      window: { title: 'DICER.InstalledDice.Title', icon: 'fa-solid fa-box-open', resizable: true },
      position: { width: 480, height: 'auto' },
    };
    #found = null;
    async _renderHTML() {
      this.#found ??= await scanInstalled({ modules: globalThis.game.modules, fetchText });
      return buildList(this.#found, read());
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
      result.addEventListener('change', (event) => this.#onChange(event.target));
    }
    async #onChange(el) {
      const mod = this.#found?.find((m) => m.id === el.name && m.status === 'ok');
      if (!mod) return;
      try {
        await globalThis.game.settings.set(MODULE, KEY, togglePick(read(), mod, el.checked));
      } catch (err) {
        console.warn('dicer: cannot save the installed module dice', err);
        globalThis.ui?.notifications?.warn(loc('DICER.InstalledDice.SaveFailed'));
      }
      this.render();
    }
  }
  if (!app?.rendered) app = new InstalledDice();
  return app.render({ force: true });
}

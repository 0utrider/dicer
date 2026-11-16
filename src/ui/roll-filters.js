/**
 * The Roll filters window (lazy chunk; Configure Settings, Dicer, Roll filters): which kinds of
 * roll this player sees as 3D dice (foundry/roll-filters.js), saved as each change is made. A GM
 * also sets the world default, which applies wherever a player chose "Default".
 */
import { FILTER_KINDS, BIG_DICE } from '../foundry/roll-filters.js';

const MODULE = 'dicer';
const MODES = ['show', 'mine', 'skip'];
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => {
  const f = globalThis.game?.i18n?.format;
  return f ? f.call(globalThis.game.i18n, key, data) : key;
};
const settings = () => globalThis.game.settings;
const read = (key) => {
  try {
    const v = settings().get(MODULE, key);
    return v && typeof v === 'object' ? { ...v } : {};
  } catch {
    return {};
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

/** A select of `modes` (labels: DICER.RollFilters.Mode.<m>), `first` an extra first option. */
function select(name, value, first) {
  const options = [...(first ? [first] : []), ...MODES.map((m) => ({ value: m, label: loc(`DICER.RollFilters.Mode.${m}`) }))];
  return h(
    'select',
    { name },
    options.map((o) => h('option', { value: o.value, selected: o.value === value, text: o.label })),
  );
}

/** The form's rows: one per kind, the player's select and (for a GM) the world default's. */
export function buildForm(mine, world, isGM) {
  const def = (k) => loc(`DICER.RollFilters.Mode.${world[k] ?? 'show'}`);
  const rows = FILTER_KINDS.map((kind) =>
    h('tr', {}, [
      h('th', { scope: 'row' }, [
        h('span', { text: loc(`DICER.RollFilters.Kind.${kind}.Name`) }),
        h('small', { class: 'dicer-hint', text: loc(`DICER.RollFilters.Kind.${kind}.Hint`) }),
      ]),
      h('td', {}, [select(`mine.${kind}`, mine[kind] ?? '', { value: '', label: fmt('DICER.RollFilters.Default', { mode: def(kind) }) })]),
      ...(isGM ? [h('td', {}, [select(`world.${kind}`, world[kind] ?? 'show')])] : []),
    ]),
  );
  const big = (scope, value) => h('input', { type: 'number', name: `${scope}.bigDice`, min: '1', max: '200', step: '1', value: String(value ?? ''), placeholder: String(world.bigDice ?? BIG_DICE) });
  return h('form', { class: 'dicer-roll-filters' }, [
    h('p', { class: 'dicer-hint', text: loc('DICER.RollFilters.Intro') }),
    h('table', {}, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', {}),
          h('th', { text: loc('DICER.RollFilters.Mine') }),
          ...(isGM ? [h('th', { text: loc('DICER.RollFilters.World') })] : []),
        ]),
      ]),
      h('tbody', {}, rows),
    ]),
    h('label', { class: 'dicer-roll-filters-big' }, [
      h('span', { text: loc('DICER.RollFilters.BigDice') }),
      big('mine', mine.bigDice),
      ...(isGM ? [h('span', { text: loc('DICER.RollFilters.World') }), big('world', world.bigDice ?? BIG_DICE)] : []),
    ]),
  ]);
}

/** A change in the form, as the next {mine, world} objects (only what changed). */
export function applyChange(name, value, mine, world) {
  const [scope, key] = String(name).split('.');
  const target = scope === 'world' ? { ...world } : { ...mine };
  if (key === 'bigDice') {
    const n = Math.trunc(Number(value));
    if (n >= 1) target.bigDice = Math.min(200, n);
    else delete target.bigDice;
  } else if (FILTER_KINDS.includes(key)) {
    if (MODES.includes(value)) target[key] = value;
    else delete target[key]; // "Default": follow the world
  } else return null;
  return scope === 'world' ? { mine, world: target } : { mine: target, world };
}

let app = null;

/** Opens (or brings forward) the Roll filters window. */
export function openRollFilters() {
  const { ApplicationV2 } = globalThis.foundry.applications.api;
  class RollFilters extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: 'dicer-roll-filters',
      classes: ['dicer-roll-filters-app'],
      window: { title: 'DICER.RollFilters.Title', icon: 'fa-solid fa-filter', resizable: true },
      position: { width: 660, height: 'auto' },
    };
    async _renderHTML() {
      return buildForm(read('rollFilters'), read('rollFiltersDefault'), globalThis.game.user?.isGM === true);
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
      result.addEventListener('change', (event) => this.#onChange(event.target));
    }
    async #onChange(el) {
      const next = applyChange(el.name, el.value, read('rollFilters'), read('rollFiltersDefault'));
      if (!next) return;
      try {
        if (el.name.startsWith('world.')) await settings().set(MODULE, 'rollFiltersDefault', next.world);
        else await settings().set(MODULE, 'rollFilters', next.mine);
      } catch (err) {
        console.warn('dicer: cannot save the roll filters', err);
        globalThis.ui?.notifications?.warn(loc('DICER.RollFilters.SaveFailed'));
      }
      if (el.name.startsWith('world.')) this.render(); // the "Default (…)" labels follow
    }
  }
  if (!app?.rendered) app = new RollFilters();
  return app.render({ force: true });
}

/**
 * The Roll filters window (lazy chunk; Configure Settings, Dicer, Roll filters): which kinds of
 * roll this player sees as 3D dice (foundry/roll-filters.js), saved as each change is made. A GM
 * also sets the world default, which applies wherever a player chose "Default".
 */
import { FILTER_KINDS, BIG_DICE } from '../foundry/roll-filters.js';

const MODULE = 'dicer';
const MODES = ['show', 'mine', 'skip'];
/**
 * "Roll by hand": which rolls this player throws by hand (hand/chunk/hand-kinds.js reads it).
 * "All rolls" (the player's: the handRolls setting, '' following the world's `hand.all`) and, for
 * the kinds known while a roll is still evaluated, a choice of their own in `hand[kind]`. The hand
 * chunk's lists; a test keeps the two equal.
 */
export const HAND_KINDS = ['initiative', 'combat', 'damage', 'big'];
export const HAND_MODES = ['off', 'ask', 'always'];
/** A saved choice as a mode (1.4.4's "No", false, is 'off'), or undefined. */
const handNorm = (v) => (v === false ? 'off' : HAND_MODES.includes(v) ? v : undefined);
const handChoice = (filters, key) => handNorm(filters?.hand?.[key]);
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

/** A select of `modes` (labels: DICER.RollFilters.<labels>.<m>), `first` an extra first option. */
function select(name, value, first, modes = MODES, labels = 'Mode') {
  const options = [...(first ? [first] : []), ...modes.map((m) => ({ value: m, label: loc(`DICER.RollFilters.${labels}.${m}`) }))];
  return h(
    'select',
    { name },
    options.map((o) => h('option', { value: o.value, selected: o.value === value, text: o.label })),
  );
}

/**
 * The "Roll by hand" cells of a row: the player's choice and (for a GM) the world's. `key` is
 * 'all' ("All rolls"; `all` is the player's own, '' following the world) or a kind; a kind with
 * no choice (not known while rolling) gets empty cells. "Default" names what it follows: for a
 * kind the world's choice for it, else this player's "All rolls".
 */
function handCells(key, mine, world, isGM, all) {
  const blank = () => [h('td', {}), ...(isGM ? [h('td', {})] : [])];
  if (key !== 'all' && !HAND_KINDS.includes(key)) return blank();
  const worldAll = handChoice(world, 'all') ?? 'off';
  const worldOwn = key === 'all' ? worldAll : handChoice(world, key);
  const own = key === 'all' ? handNorm(all) : handChoice(mine, key);
  const follows = worldOwn ?? handNorm(all) ?? worldAll;
  const pick = (name, value, first) => h('td', {}, [select(name, value, first, HAND_MODES, 'HandMode')]);
  return [
    pick(`mine.hand.${key}`, own ?? '', { value: '', label: fmt('DICER.RollFilters.Default', { mode: loc(`DICER.RollFilters.HandMode.${follows}`) }) }),
    // the world's "All rolls" is always a mode; a kind may follow it
    ...(isGM ? [pick(`world.hand.${key}`, worldOwn ?? '', key === 'all' ? null : { value: '', label: loc('DICER.RollFilters.HandAsAll') })] : []),
  ];
}

/**
 * The form's rows: "All rolls" (Roll by hand only), then one per kind, with the player's selects
 * and (for a GM) the world default's. `all`: the player's own "All rolls" (the handRolls setting).
 */
export function buildForm(mine, world, isGM, all = '') {
  const def = (k) => loc(`DICER.RollFilters.Mode.${world[k] ?? 'show'}`);
  const head = (kind) =>
    h('th', { scope: 'row' }, [
      h('span', { text: loc(`DICER.RollFilters.Kind.${kind}.Name`) }),
      h('small', { class: 'dicer-hint', text: loc(`DICER.RollFilters.Kind.${kind}.Hint`) }),
    ]);
  const rows = [
    h('tr', {}, [head('all'), h('td', {}), ...(isGM ? [h('td', {})] : []), ...handCells('all', mine, world, isGM, all)]),
    ...FILTER_KINDS.map((kind) =>
      h('tr', {}, [
        head(kind),
        h('td', {}, [select(`mine.${kind}`, mine[kind] ?? '', { value: '', label: fmt('DICER.RollFilters.Default', { mode: def(kind) }) })]),
        ...(isGM ? [h('td', {}, [select(`world.${kind}`, world[kind] ?? 'show')])] : []),
        ...handCells(kind, mine, world, isGM, all),
      ]),
    ),
  ];
  const span = isGM ? '2' : false;
  const who = () => [h('th', { text: loc('DICER.RollFilters.Mine') }), ...(isGM ? [h('th', { text: loc('DICER.RollFilters.World') })] : [])];
  const big = (scope, value) => h('input', { type: 'number', name: `${scope}.bigDice`, min: '1', max: '200', step: '1', value: String(value ?? ''), placeholder: String(world.bigDice ?? BIG_DICE) });
  return h('form', { class: 'dicer-roll-filters' }, [
    h('p', { class: 'dicer-hint', text: loc('DICER.RollFilters.Intro') }),
    h('p', { class: 'dicer-hint', text: loc('DICER.RollFilters.HandIntro') }),
    h('table', {}, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', {}),
          // centred over its columns, here and not in the stylesheet (a world-start download)
          h('th', { colspan: span, style: 'text-align:center', text: loc('DICER.RollFilters.Dice') }),
          h('th', { colspan: span, style: 'text-align:center', text: loc('DICER.RollFilters.Hand') }),
        ]),
        h('tr', {}, [h('th', {}), ...who(), ...who()]),
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

/**
 * A change in the form, as the next {mine, world} objects (only what changed). The player's own
 * "All rolls" (mine.hand.all) is the handRolls setting: its next value comes back as `handRolls`
 * ('' follows the world), with mine and world as they were.
 */
export function applyChange(name, value, mine, world) {
  const [scope, key, sub, ...rest] = String(name).split('.');
  const target = scope === 'world' ? { ...world } : { ...mine };
  if (key === 'hand') {
    if ((sub !== 'all' && !HAND_KINDS.includes(sub)) || rest.length) return null;
    const mode = HAND_MODES.includes(value) ? value : undefined;
    if (sub === 'all' && scope !== 'world') return { mine, world, handRolls: mode ?? '' };
    // Rewritten whole: only real choices are kept (1.4.4's "No" as 'off', its "Yes" as none).
    const hand = {};
    for (const k of ['all', ...HAND_KINDS]) {
      const saved = k === 'all' && scope !== 'world' ? undefined : handChoice(target, k);
      const next = k === sub ? mode : saved; // no mode: "Default", follow what is above it
      if (next) hand[k] = next;
    }
    if (Object.keys(hand).length) target.hand = hand;
    else delete target.hand;
  } else if (sub !== undefined) return null;
  else if (key === 'bigDice') {
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
      position: { width: 780, height: 'auto' },
    };
    async _renderHTML() {
      let all = '';
      try {
        all = settings().get(MODULE, 'handRolls');
      } catch {
        /* not registered: follows the world */
      }
      return buildForm(read('rollFilters'), read('rollFiltersDefault'), globalThis.game.user?.isGM === true, all);
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
      result.addEventListener('change', (event) => this.#onChange(event.target));
    }
    async #onChange(el) {
      const next = applyChange(el.name, el.value, read('rollFilters'), read('rollFiltersDefault'));
      if (!next) return;
      try {
        if (next.handRolls !== undefined) await settings().set(MODULE, 'handRolls', next.handRolls);
        else if (el.name.startsWith('world.')) await settings().set(MODULE, 'rollFiltersDefault', next.world);
        else await settings().set(MODULE, 'rollFilters', next.mine);
      } catch (err) {
        console.warn('dicer: cannot save the roll filters', err);
        globalThis.ui?.notifications?.warn(loc('DICER.RollFilters.SaveFailed'));
      }
      // the "Default (…)" labels follow the world's choices and "All rolls"
      if (el.name.startsWith('world.') || el.name.includes('.hand.')) this.render();
    }
  }
  if (!app?.rendered) app = new RollFilters();
  return app.render({ force: true });
}

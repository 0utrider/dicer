/**
 * The free-roll dice tray (lazy hand chunk; its world-start half is the "Dice tray" tool main.js
 * adds under the token controls). Anyone allowed to roll by hand picks dice, a modifier and a
 * message mode, then throws them in the throw overlay, in their own area.
 *
 * H-14: the tray builds a real Roll from the formula, pushes the read results into its DiceTerms,
 * then evaluate({allowInteractive: false}): Foundry rolls only what the throw could not hold (past
 * maxDice: `partial`) and computes modifiers and the total. The Roll carries dicerHand and the
 * recording is stored under its id like a hand roll's (R10), so Task 8 replays the message to the
 * users allowed to see it and the thrower's own lingering dice play its landed effects. A blind
 * tray roll ghosts on release (P6-D1 / H-19: Dicer chose the mode, so the roller never sees the
 * faces; a GM sees blind rolls). Cancel, timeout or a throw that never lands posts nothing.
 */
import { openThrowOverlay } from './overlay.js';
import { handFor } from './box.js';
import { planFor, push, handThrows, queued, storeThrow, throwWithin } from './resolve.js';
import { handAllowed, handDeps } from '../shell.js';

/** The tray's dice, in its order (Foundry denominations: d2 is a two-sided Die, dF Fate). */
export const TRAY_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'd2', 'dF'];
/** The CONFIG.ChatMessage.modes a tray roll can go out in. */
export const TRAY_MODES = ['public', 'gm', 'blind', 'self'];
/** A count above this is clamped (Foundry rolls what the throw cannot hold anyway). */
const MAX_COUNT = 99;
const MAX_MODIFIER = 9999;

/**
 * Each die's outline for its button (inner SVG of a 24x24 viewBox; trusted constants, never user
 * input): a coin for d2, a triangle for d4, a square for d6 and so on, as the dice look in hand.
 */
const poly = (points) => `<polygon points="${points}"/>`;
const KITE = '12,1.5 22,10 12,22.5 2,10';
export const DIE_SHAPES = {
  d4: poly('12,2 22.5,21 1.5,21'),
  d6: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  d8: poly('12,1 23,12 12,23 1,12'),
  d10: poly(KITE),
  d12: poly('12,1.5 22.5,9.2 18.5,21.5 5.5,21.5 1.5,9.2'),
  d20: poly('12,1 21.5,6.5 21.5,17.5 12,23 2.5,17.5 2.5,6.5'),
  d100: poly(KITE),
  d2: '<circle cx="12" cy="12" r="10.5"/>',
  dF: '<rect x="3" y="3" width="18" height="18" rx="5"/>',
};

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => {
  const f = globalThis.game?.i18n?.format;
  return f ? f.call(globalThis.game.i18n, key, data) : key;
};
const int = (v) => Math.trunc(Number(v)) || 0;
const countOf = (v) => Math.min(MAX_COUNT, Math.max(0, int(v)));
/** The modifier, a finite integer within ±MAX_MODIFIER. */
const modOf = (v) => Math.min(MAX_MODIFIER, Math.max(-MAX_MODIFIER, int(v)));

/** '2d6 + 1d20 + 3' from {d6: 2, d20: 1} and 3: the dice in tray order, then the modifier. */
export function formulaFromCounts(counts, modifier) {
  let f = TRAY_DICE.filter((k) => countOf(counts?.[k]) > 0)
    .map((k) => `${countOf(counts[k])}${k}`)
    .join(' + ');
  const m = modOf(modifier);
  if (m) f = f ? `${f} ${m < 0 ? '-' : '+'} ${Math.abs(m)}` : String(m);
  return f;
}

/** The core chat mode when the tray offers it, else public. */
function coreMode() {
  try {
    const m = globalThis.game.settings.get('core', 'messageMode');
    if (TRAY_MODES.includes(m)) return m;
  } catch {
    /* not registered */
  }
  return 'public';
}

/**
 * Throws the chosen dice and posts the roll; the created message, or null when nothing was
 * posted (no dice, no engine, not allowed, cancelled, timed out, never landed). `deps`: the hand
 * chunk's dependencies (shell.handDeps); `overlay` and `Roll` are test seams.
 */
export async function throwTray(
  { counts = {}, modifier = 0, mode } = {},
  {
    deps = handDeps(),
    overlay = openThrowOverlay,
    Roll = globalThis.foundry?.dice?.Roll?.defaultImplementation,
  } = {},
) {
  if (!formulaFromCounts(counts, 0)) return null;
  // M7: no engine (3D dice off, or not started): say so, never a silent no-op
  if (!deps) {
    globalThis.ui?.notifications?.warn(loc('DICER.Tray.NoEngine'));
    return null;
  }
  const me = deps.user();
  if (!handAllowed(me, deps.getSetting)) return null;
  if (!TRAY_MODES.includes(mode)) mode = 'public';
  const roll = new Roll(formulaFromCounts(counts, modifier));
  const ms = Number(deps.getSetting('handRollTimeout')) * 1000 || 60000;
  const { specs, owners, dropped } = planFor({ roll, dicer: deps }, roll.dice, (t) =>
    Math.abs(t.number),
  );
  const id = foundry.utils.randomID();
  const hand = { id, by: me.id, n: specs.length };
  if (specs.length) {
    let out;
    try {
      out = await queued(ms, () => {
        handFor(deps.diceBox);
        const rect = () => deps.areas.rectFor({ rollerId: me.id });
        return throwWithin(
          overlay,
          {
            specs,
            rect: rect(),
            getRect: rect,
            diceBox: deps.diceBox,
            timeoutMs: ms,
            ghostOnRelease: mode === 'blind' && !me.isGM,
            label: roll.formula,
          },
          ms,
        );
      });
    } catch (err) {
      console.warn('dicer: the dice tray throw failed', err);
    }
    if (!out?.values) return null;
    const n = push(specs, owners, out.values);
    // Foundry's tooltip shows the hand on the terms thrown (the method setter takes known ones).
    for (const t of owners) if (t) t.method = 'dicer';
    const partial = dropped + owners.filter(Boolean).length - n;
    if (partial) hand.partial = partial;
    storeThrow(id, { recording: out.recording, handle: out.handle, specs, extras: [] });
  } else hand.fallback = 'auto';
  roll.options.dicerHand = hand;
  try {
    await roll.evaluate({ allowInteractive: false });
    return await roll.toMessage({}, { messageMode: mode });
  } catch (err) {
    handThrows.delete(id);
    throw err;
  }
}

/** `counts` with one more (delta 1) or one fewer (-1) of `key`, within 0..99; a new object. */
export function stepCount(counts, key, delta) {
  if (!TRAY_DICE.includes(key)) return { ...counts };
  return { ...counts, [key]: countOf(countOf(counts?.[key]) + delta) };
}

/** What the window shows for a choice: the formula, and whether Throw / Clear do anything. */
export function trayView({ counts = {}, modifier = 0 } = {}) {
  const formula = formulaFromCounts(counts, modifier);
  // how many dice it throws (the formula itself is shown above, too long for the button)
  const n = TRAY_DICE.reduce((sum, k) => sum + countOf(counts?.[k]), 0);
  let throwLabel = loc('DICER.Tray.ThrowNone');
  if (n === 1) throwLabel = loc('DICER.Tray.ThrowOne');
  else if (n > 1) throwLabel = fmt('DICER.Tray.ThrowMany', { n });
  return { formula, canThrow: n > 0, canClear: !!formula, throwLabel };
}

/** The tray window's context: the dice with their counts, the modifier, the modes, the formula. */
export function trayContext({ counts = {}, modifier = 0, mode } = {}) {
  mode = TRAY_MODES.includes(mode) ? mode : coreMode();
  return {
    dice: TRAY_DICE.map((key) => ({
      key,
      count: countOf(counts[key]),
      shape: DIE_SHAPES[key],
      addLabel: fmt('DICER.Tray.Add', { die: key }),
      removeLabel: fmt('DICER.Tray.Remove', { die: key }),
    })),
    modifier: modOf(modifier),
    // who sees it, in plain words (Foundry's labels say how, e.g. "Public as User")
    modes: TRAY_MODES.map((value) => ({
      value,
      label: loc(`DICER.Tray.Modes.${value}`),
      selected: value === mode,
    })),
    ...trayView({ counts, modifier }),
  };
}

/**
 * Shows `state` in a rendered tray: the badges and highlighted dice, the formula (or its
 * placeholder), and the Throw button's label and enabled state. The modifier field is left
 * alone unless `syncModifier` (it may be mid-typing).
 */
export function paintTray(root, state, { syncModifier = false } = {}) {
  const counts = state.counts ?? {};
  const view = trayView(state);
  for (const el of root.querySelectorAll('.dicer-tray-die')) {
    const n = countOf(counts[el.dataset.die]);
    el.classList.toggle('has-dice', n > 0);
    const badge = el.querySelector('.dicer-tray-count');
    if (badge) badge.textContent = String(n);
  }
  const out = root.querySelector('.dicer-tray-formula');
  if (out) {
    out.textContent = view.formula || loc('DICER.Tray.Empty');
    out.classList.toggle('is-empty', !view.formula);
  }
  const go = root.querySelector('button[type="submit"]');
  if (go) {
    go.disabled = !view.canThrow;
    const label = go.querySelector('.dicer-tray-throw-label');
    if (label) label.textContent = view.throwLabel;
  }
  const clear = root.querySelector('[data-action="clear"]');
  if (clear) clear.disabled = !view.canClear;
  const mod = root.querySelector('[name="modifier"]');
  if (mod && syncModifier) mod.value = String(modOf(state.modifier));
}

/**
 * Wires a tray element to `state` (mutated in place): a die button adds one on click and removes
 * one on right-click or Backspace / Delete / minus; its minus button removes one; the modifier
 * steps by its +/- buttons or by typing; the select sets the mode. Listeners are delegated on
 * `root`, so they survive re-renders of its content; `onChange(state)` follows every change.
 */
export function wireTray(root, state, onChange = () => {}) {
  state.counts ??= {};
  const changed = (opts) => {
    paintTray(root, state, opts);
    onChange(state);
  };
  const step = (key, delta) => {
    state.counts = stepCount(state.counts, key, delta);
    changed();
  };
  root.addEventListener('click', (event) => {
    const t = event.target.closest?.('button');
    if (!t || !root.contains(t)) return;
    if (t.matches('.dicer-tray-add')) step(t.dataset.die, event.shiftKey ? -1 : 1);
    else if (t.matches('.dicer-tray-remove')) step(t.dataset.die, -1);
    else if (t.dataset.modStep) {
      state.modifier = modOf(modOf(state.modifier) + Number(t.dataset.modStep));
      changed({ syncModifier: true });
    }
  });
  root.addEventListener('contextmenu', (event) => {
    const t = event.target.closest?.('.dicer-tray-add, .dicer-tray-remove');
    if (!t) return;
    event.preventDefault();
    step(t.dataset.die, -1);
  });
  root.addEventListener('keydown', (event) => {
    const t = event.target.closest?.('.dicer-tray-add');
    if (!t || !['Backspace', 'Delete', '-'].includes(event.key)) return;
    event.preventDefault();
    step(t.dataset.die, -1);
  });
  const field = (event) => {
    const name = event.target?.name;
    if (name === 'modifier') {
      state.modifier = modOf(event.target.value);
      changed();
    } else if (name === 'mode') {
      state.mode = event.target.value;
      changed();
    }
  };
  root.addEventListener('input', field);
  root.addEventListener('change', field);
  paintTray(root, state);
}

const STYLE_ID = 'dicer-tray-style';
/** The tray's styles, injected once (lazy, like the overlay's: never in dicer.css). */
const TRAY_CSS = `
.dicer-tray .window-content { padding: 0.75rem; }
.dicer-tray-body { display: flex; flex-direction: column; gap: 0.6rem; }
.dicer-tray-body .dicer-hint { margin: 0; font-size: 0.85em; opacity: 0.75; text-align: center; }
.dicer-tray-formula {
  margin: 0; padding: 0.3rem 0.5rem; min-height: 2.6rem; text-align: center;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono, monospace); font-size: 1.35em; font-weight: 600;
  border-radius: 6px; background: rgba(0, 0, 0, 0.25);
  overflow-wrap: anywhere;
}
.dicer-tray-formula.is-empty { font-family: inherit; font-size: 1em; font-weight: normal; opacity: 0.6; }
.dicer-tray-dice { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; }
.dicer-tray-die { position: relative; }
.dicer-tray-add {
  width: 100%; height: auto; margin: 0; padding: 0.4rem 0.25rem 0.3rem;
  display: flex; flex-direction: column; align-items: center; gap: 0.15rem;
  border-radius: 6px; border: 1px solid var(--color-border, rgba(255, 255, 255, 0.15));
  background: rgba(0, 0, 0, 0.12); cursor: pointer; line-height: 1.1;
}
.dicer-tray-add:hover, .dicer-tray-add:focus-visible { background: rgba(255, 255, 255, 0.08); }
.dicer-tray-add svg {
  width: 2.1em; height: 2.1em; fill: rgba(255, 255, 255, 0.06);
  stroke: currentColor; stroke-width: 1.4; stroke-linejoin: round; opacity: 0.8;
}
.dicer-tray-die-name { font-weight: 600; font-size: 1.05em; }
.dicer-tray-die.has-dice .dicer-tray-add {
  border-color: var(--color-warm-2, #ff6400); background: rgba(255, 100, 0, 0.14);
}
.dicer-tray-die.has-dice .dicer-tray-add svg { stroke: var(--color-warm-2, #ff6400); opacity: 1; }
.dicer-tray-count, .dicer-tray-remove { display: none; position: absolute; top: -0.4em; }
.dicer-tray-die.has-dice .dicer-tray-count, .dicer-tray-die.has-dice .dicer-tray-remove { display: flex; }
.dicer-tray-count {
  right: -0.3em; min-width: 1.6em; height: 1.6em; padding: 0 0.3em;
  align-items: center; justify-content: center; pointer-events: none;
  border-radius: 0.8em; background: var(--color-warm-2, #ff6400); color: #fff;
  font-weight: 700; font-size: 0.85em;
}
.dicer-tray-remove {
  left: -0.3em; width: 1.6em; height: 1.6em; min-height: 0; margin: 0; padding: 0;
  align-items: center; justify-content: center; border-radius: 50%; font-size: 0.7em;
}
.dicer-tray-row { display: flex; align-items: center; gap: 0.5rem; }
.dicer-tray-row label { flex: 0 0 6.5em; }
.dicer-tray-row select, .dicer-tray-stepper { flex: 1; }
.dicer-tray-stepper { display: flex; gap: 0.25rem; }
.dicer-tray-stepper input { flex: 1; text-align: center; }
.dicer-tray-stepper button { flex: 0 0 2em; margin: 0; padding: 0; }
.dicer-tray-body .form-footer { display: flex; gap: 0.5rem; margin: 0; }
.dicer-tray-body .form-footer button { flex: 1; min-width: 0; }
.dicer-tray-body .form-footer button[type="submit"] { flex: 2; }
.dicer-tray-throw-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dicer-tray-body .form-footer button:disabled { opacity: 0.5; cursor: default; }
`;
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = TRAY_CSS;
  document.head.append(style);
}

/** What the window last showed (kept for its next opening). */
const last = { counts: {}, modifier: 0, mode: undefined };
/** The choice to throw: the dice picked (kept in `last`), the modifier and mode from the form. */
const choiceOf = (form) => {
  const v = (name) => form.elements.namedItem(name)?.value;
  return {
    counts: Object.fromEntries(TRAY_DICE.map((k) => [k, countOf(last.counts[k])])),
    modifier: modOf(v('modifier')),
    mode: v('mode'),
  };
};

let Tray = null;
let instance = null;
/** The window class, made on first use (Foundry's ApplicationV2 is a global of the running game). */
function trayClass() {
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
  return (Tray ??= class DiceTray extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: 'dicer-tray',
      tag: 'form',
      classes: ['dicer-tray'],
      window: { title: 'DICER.Tray.Title', icon: 'fa-solid fa-dice' },
      position: { width: 320, height: 'auto' },
      form: { handler: DiceTray.#onThrow, closeOnSubmit: false },
      actions: { clear: DiceTray.#onClear },
    };

    static PARTS = { body: { template: 'modules/dicer/templates/dice-tray.hbs' } };

    async _prepareContext() {
      return trayContext(last);
    }

    /** The die buttons, badges, formula and Throw button follow `last`. */
    _onRender(...args) {
      super._onRender?.(...args);
      injectStyle();
      // The window's element outlives its renders: wire it once (delegated), paint every render.
      if (!this._wired) wireTray(this.element, last);
      else paintTray(this.element, last);
      this._wired = true;
    }

    static #onClear() {
      Object.assign(last, { counts: {}, modifier: 0 });
      return this.render();
    }

    /** Throw: the window steps aside (minimized) while the dice are held and in flight. */
    static async #onThrow(event, form) {
      const choice = choiceOf(form);
      Object.assign(last, choice);
      if (!formulaFromCounts(choice.counts, 0)) {
        globalThis.ui?.notifications?.warn(loc('DICER.Tray.NoDice'));
        return;
      }
      await this.minimize?.();
      try {
        await throwTray(choice);
      } catch (err) {
        console.warn('dicer: the dice tray could not post its roll', err);
        globalThis.ui?.notifications?.warn(loc('DICER.Tray.Failed'));
      } finally {
        await this.maximize?.();
      }
    }

    async close(options) {
      if (instance === this) instance = null;
      return super.close(options);
    }
  });
}

/** Opens (or brings to front) the dice tray: what the "Dice tray" tool calls. */
export function openTray() {
  instance ??= new (trayClass())();
  return instance.render({ force: true });
}

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

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
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

/** The tray window's context: the dice with their counts, the modifier, the modes, the formula. */
export function trayContext({ counts = {}, modifier = 0, mode } = {}) {
  const modes = globalThis.CONFIG?.ChatMessage?.modes ?? {};
  mode = TRAY_MODES.includes(mode) ? mode : coreMode();
  return {
    dice: TRAY_DICE.map((key) => ({ key, count: countOf(counts[key]) })),
    modifier: modOf(modifier),
    modes: TRAY_MODES.map((value) => ({
      value,
      label: loc(modes[value]?.label ?? value),
      selected: value === mode,
    })),
    formula: formulaFromCounts(counts, modifier),
  };
}

const STYLE_ID = 'dicer-tray-style';
/** The tray's styles, injected once (lazy, like the overlay's: never in dicer.css). */
const TRAY_CSS = `
.dicer-tray .window-content { padding: 0.75rem; }
.dicer-tray-body { display: flex; flex-direction: column; gap: 0.6rem; }
.dicer-tray-dice { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; }
.dicer-tray-die {
  display: flex; flex-direction: column; align-items: center; gap: 0.2rem;
  padding: 0.35rem 0.25rem; border-radius: 6px;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.15));
  background: rgba(0, 0, 0, 0.12);
}
.dicer-tray-die.has-dice { border-color: var(--color-warm-2, #ff6400); background: rgba(255, 100, 0, 0.12); }
.dicer-tray-die-name { font-weight: 600; font-size: 1.05em; }
.dicer-tray-die input { width: 4em; text-align: center; }
.dicer-tray-row { display: flex; align-items: center; gap: 0.5rem; }
.dicer-tray-row label { flex: 0 0 6.5em; }
.dicer-tray-row input, .dicer-tray-row select { flex: 1; }
.dicer-tray-formula {
  margin: 0; min-height: 1.4em; text-align: center; font-family: var(--font-mono, monospace);
  opacity: 0.85;
}
.dicer-tray-body .form-footer { display: flex; gap: 0.5rem; margin: 0; }
.dicer-tray-body .form-footer button { flex: 1; }
.dicer-tray-body .form-footer button[type="submit"] { flex: 2; }
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
/** The choice in the tray's form. */
const choiceOf = (form) => {
  const v = (name) => form.elements.namedItem(name)?.value;
  return {
    counts: Object.fromEntries(TRAY_DICE.map((k) => [k, countOf(v(k))])),
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

    /** The formula line and the highlighted dice follow the inputs. */
    _onRender(...args) {
      super._onRender?.(...args);
      injectStyle();
      const form = this.element;
      const update = () => {
        const c = choiceOf(form);
        Object.assign(last, c);
        const out = form.querySelector('.dicer-tray-formula');
        if (out) out.textContent = formulaFromCounts(c.counts, c.modifier);
        for (const el of form.querySelectorAll('.dicer-tray-die')) {
          el.classList.toggle('has-dice', c.counts[el.dataset.die] > 0);
        }
      };
      // The window's element outlives its renders: listen once.
      if (!this._wired) form.addEventListener('input', () => this._update());
      this._wired = true;
      this._update = update;
      update();
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

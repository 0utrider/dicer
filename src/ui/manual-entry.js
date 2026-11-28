/**
 * Typed-in dice (lazy chunk; main.js loads it when Foundry's dice entry window shows a manual die,
 * or for the chat button): each manual die of the RollResolver drawn as a big die shape with its
 * number field inside, in the player's glow and text colours, and the chat button that switches a
 * player's dice between typing them in (Foundry's `manual` method) and rolling them.
 */
import { HAND_DICE } from '../hand/shell.js';

export const MANUAL_KEYS = [...HAND_DICE, 'default'];

/** `n` points on a circle of radius `r` around the centre, the first at `turn` degrees. */
const ring = (n, r, turn = -90) =>
  Array.from({ length: n }, (_, i) => {
    const a = ((turn + (360 / n) * i) * Math.PI) / 180;
    return `${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`;
  });

/** The d12: a front pentagon, the five faces around it out to a decagon. */
function d12() {
  const p = ring(5, 27);
  const o = ring(10, 47);
  const faces = p.map((v, i) => [i === 0 || i === 4 ? 1 : 2, [v, o[2 * i], o[2 * i + 1], o[(2 * i + 2) % 10], p[(i + 1) % 5]]]);
  return { faces: [...faces, [0, p]], n: [0, 2, 26] };
}

/** The d20: a front triangle, its three neighbours, and six faces out to a hexagon. */
function d20() {
  const [t0, t1, t2] = ring(3, 33);
  const [h0, h1, h2, h3, h4, h5] = ring(6, 47);
  return {
    faces: [
      [2, [t0, h0, h1]], [2, [t1, h1, h2]], [2, [t1, h2, h3]], [2, [t2, h3, h4]], [2, [t2, h4, h5]], [2, [t0, h5, h0]],
      [1, [t0, t1, h1]], [1, [t1, t2, h3]], [1, [t2, t0, h5]],
      [0, [t0, t1, t2]],
    ],
    n: [0, 3, 24],
  };
}

const split = (s) => s.split(' ');

/**
 * Each denomination's faces (shade 0: the front face, where the number goes; 1 and 2: the sides,
 * darker) in a 100 x 100 box, and where its number sits: [dx, dy, font size] in pixels.
 */
const SHAPES = {
  d4: { faces: [[2, split('50,6 64,90 95,90')], [0, split('50,6 5,90 64,90')]], n: [-10, 13, 24] },
  d6: {
    faces: [[1, split('8,26 28,8 92,8 72,26')], [2, split('72,26 92,8 92,72 72,90')], [0, split('8,26 72,26 72,90 8,90')]],
    n: [-10, 8, 28],
  },
  d8: {
    faces: [
      [2, split('8,52 16,60 84,60 92,52 50,96')],
      [1, split('50,4 8,52 16,60')],
      [1, split('50,4 92,52 84,60')],
      [0, split('50,4 84,60 16,60')],
    ],
    n: [0, -8, 26],
  },
  d10: {
    faces: [
      [2, split('6,46 24,50 50,64 50,96')],
      [2, split('94,46 76,50 50,64 50,96')],
      [1, split('50,4 24,50 6,46')],
      [1, split('50,4 94,46 76,50')],
      [0, split('50,4 76,50 50,64 24,50')],
    ],
    n: [0, -8, 22],
  },
  d12: d12(),
  d20: d20(),
  coin: { circles: [[1, 45], [0, 34]], n: [0, 0, 28] },
};
SHAPES.d100 = SHAPES.d10;
SHAPES.d2 = SHAPES.c = SHAPES.coin;
SHAPES.f = SHAPES.d6;
SHAPES.d3 = SHAPES.d4;

const NS = 'http://www.w3.org/2000/svg';

/** The SVG die of `denomination` (a coin for one Dicer has no shape for). */
export function shapeOf(denomination, doc = document) {
  const s = SHAPES[denomination] ?? SHAPES.coin;
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'dicer-manual-shape');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => {
    const el = doc.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    svg.append(el);
  };
  for (const [shade, points] of s.faces ?? []) add('polygon', { class: `face f${shade}`, points: points.join(' ') });
  for (const [shade, r] of s.circles ?? []) add('circle', { class: `face f${shade}`, cx: 50, cy: 50, r });
  return svg;
}

/** Where `denomination`'s number sits on its front face, as CSS custom properties. */
export function numberOf(denomination) {
  const [dx, dy, size] = (SHAPES[denomination] ?? SHAPES.coin).n;
  return { '--dicer-manual-dx': `${dx}px`, '--dicer-manual-dy': `${dy}px`, '--dicer-manual-size': `${size}px` };
}

export const MANUAL_CSS = `
.application.dicer-manual-form .standard-form {
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
}
.application.dicer-manual-form .standard-form > :not(fieldset) {
  flex: 1 0 100%;
}
.application.dicer-manual-form .standard-form > fieldset {
  flex: 0 1 auto;
  margin: 0;
}
.application.dicer-manual-form .input-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}
.application.dicer-manual-form .form-fields:has(> .dicer-manual-die) {
  justify-content: center;
}
.application.dicer-manual-form label.dicer-manual-die {
  position: relative;
  display: grid;
  place-items: center;
  width: 104px;
  height: 104px;
  flex: 0 0 auto;
  padding: 0;
  border: none;
  background: none;
  box-shadow: none;
  outline: none;
}
.application.dicer-manual-form label.dicer-manual-die > :not(input, svg.dicer-manual-shape, .fa-arrow-rotate-right, .fa-burst) {
  display: none;
}
.application.dicer-manual-form .dicer-manual-shape {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  transition: filter 0.15s;
}
.application.dicer-manual-form .dicer-manual-shape .face {
  stroke: var(--dicer-manual-glow);
  stroke-width: 2.2;
  stroke-linejoin: round;
  transition: fill 0.15s;
}
.application.dicer-manual-form .dicer-manual-shape .f0 {
  fill: color-mix(in srgb, var(--dicer-manual-glow) 26%, #14121a);
}
.application.dicer-manual-form .dicer-manual-shape .f1 {
  fill: color-mix(in srgb, var(--dicer-manual-glow) 14%, #0c0b10);
}
.application.dicer-manual-form .dicer-manual-shape .f2 {
  fill: color-mix(in srgb, var(--dicer-manual-glow) 6%, #060509);
}
.application.dicer-manual-form label.dicer-manual-die:focus-within .dicer-manual-shape,
.application.dicer-manual-form label.dicer-manual-die.dicer-manual-filled .dicer-manual-shape {
  filter: drop-shadow(0 0 5px var(--dicer-manual-glow)) drop-shadow(0 0 10px var(--dicer-manual-glow));
}
.application.dicer-manual-form label.dicer-manual-die.dicer-manual-filled .dicer-manual-shape .f0 {
  fill: color-mix(in srgb, var(--dicer-manual-glow) 45%, #14121a);
}
.application.dicer-manual-form label.dicer-manual-die > input {
  position: relative;
  z-index: 1;
  width: 64px;
  height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  outline: none;
  transform: translate(var(--dicer-manual-dx, 0), var(--dicer-manual-dy, 0));
  color: var(--dicer-manual-text);
  font-size: var(--dicer-manual-size, 28px);
  font-weight: bold;
  text-align: center;
  text-shadow: 0 0 3px #000, 0 0 6px rgba(0, 0, 0, 0.8);
  -moz-appearance: textfield;
}
.application.dicer-manual-form label.dicer-manual-die > input::-webkit-inner-spin-button,
.application.dicer-manual-form label.dicer-manual-die > input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.application.dicer-manual-form label.dicer-manual-die > input::placeholder {
  color: var(--dicer-manual-text);
  opacity: 0.5;
  font-size: calc(var(--dicer-manual-size, 28px) * 0.62);
}
.application.dicer-manual-form label.dicer-manual-die > input:disabled {
  opacity: 0.75;
}
.application.dicer-manual-form label.dicer-manual-die > i {
  position: absolute;
  right: 4px;
  top: 4px;
  z-index: 1;
  color: var(--dicer-manual-glow);
}
#chat-controls .dicer-manual-toggle [aria-pressed="true"] {
  color: var(--color-text-primary, #fff);
  background: var(--color-warm-2, #c9593f);
}
`;

const injectStyle = (doc) => {
  if (doc.getElementById('dicer-manual-style')) return;
  const style = doc.createElement('style');
  style.id = 'dicer-manual-style';
  style.textContent = MANUAL_CSS;
  doc.head.append(style);
};

const setting = (key, fallback) => {
  try {
    return game.settings.get('dicer', key) ?? fallback;
  } catch {
    return fallback;
  }
};

const fill = (label) => {
  const input = label.querySelector('input');
  label.classList.toggle('dicer-manual-filled', !!input && input.value !== '');
};

/** Draws one manual die's field inside its die shape (once). */
function decorateLabel(label) {
  if (label.classList.contains('dicer-manual-die')) return;
  label.classList.add('dicer-manual-die');
  label.prepend(shapeOf(label.dataset.denomination, label.ownerDocument));
  for (const [k, v] of Object.entries(numberOf(label.dataset.denomination))) label.style.setProperty(k, v);
  fill(label);
  label.addEventListener('input', () => fill(label));
  label.addEventListener('change', () => fill(label));
}

const observers = new WeakMap();

/**
 * Puts the die shapes on every manual die of the resolver window `app` (its element `el`), and on
 * the ones Foundry adds later (rerolls, explosions: resolveResult appends them without a render).
 */
export function decorate(app, el = app?.element) {
  try {
    if (!el?.querySelectorAll) return;
    const doc = el.ownerDocument ?? document;
    injectStyle(doc);
    el.classList.add('dicer-manual-form');
    el.style.setProperty('--dicer-manual-glow', String(setting('manualGlow', '#ff9f1c')));
    el.style.setProperty('--dicer-manual-text', String(setting('manualText', '#ffffff')));
    const all = () => el.querySelectorAll('label.die-input[data-method="manual"]').forEach(decorateLabel);
    all();
    if (!observers.has(el) && globalThis.MutationObserver) {
      const mo = new MutationObserver(all);
      mo.observe(el, { childList: true, subtree: true });
      observers.set(el, mo);
    }
    app?.setPosition?.({ height: 'auto' });
  } catch (err) {
    console.warn('dicer: cannot draw the dice entry window', err);
  }
}

const interactiveOther = (m) =>
  !!m && m !== 'manual' && m !== 'dicer' && !!CONFIG.Dice.fulfillment.methods[m]?.interactive;

/** Every die of this browser's dice configuration is typed in (the button is pressed). */
export const manualOn = (core) =>
  MANUAL_KEYS.some((k) => core?.[k] === 'manual') &&
  MANUAL_KEYS.every((k) => core?.[k] === 'manual' || interactiveOther(core?.[k]));

/**
 * The dice configuration with every die typed in, and the stash that brings the old one back. A die
 * held by another interactive method (Pixels) keeps it; a die Dicer mapped itself (`mapped`) is
 * stashed as empty, so the hand sync maps it again later rather than taking it for the user's pick.
 */
export function manualConfig(core, mapped = []) {
  const out = { ...core };
  const stash = {};
  for (const k of MANUAL_KEYS) {
    const was = core?.[k];
    if (interactiveOther(was) || was === 'manual') continue;
    stash[k] = was === 'dicer' && mapped.includes(k) ? '' : (was ?? '');
    out[k] = 'manual';
  }
  return { out, stash };
}

/** The dice configuration with the typed-in dice rolled again: the stashed methods back, else none. */
export function rolledConfig(core, stash = {}) {
  const out = { ...core };
  for (const k of MANUAL_KEYS) {
    if (out[k] !== 'manual') continue;
    if (stash[k]) out[k] = stash[k];
    else delete out[k];
  }
  return out;
}

let sync = null;
let busy = false;

/** Switches this browser's dice between typed in and rolled; then the hand sync (main.js's). */
export async function toggleManual() {
  if (busy) return;
  busy = true;
  try {
    const core = game.settings.get('core', 'diceConfiguration') ?? {};
    if (manualOn(core)) {
      const out = rolledConfig(core, game.settings.get('dicer', 'manualStash') ?? {});
      await game.settings.set('core', 'diceConfiguration', out);
      await game.settings.set('dicer', 'manualStash', {});
    } else {
      const { out, stash } = manualConfig(core, game.settings.get('dicer', 'handRollMapped') ?? []);
      await game.settings.set('dicer', 'manualStash', stash);
      await game.settings.set('core', 'diceConfiguration', out);
    }
    sync?.();
    const on = manualOn(game.settings.get('core', 'diceConfiguration'));
    ui.notifications?.info(game.i18n.localize(`DICER.Manual.${on ? 'On' : 'Off'}`));
  } catch (err) {
    console.warn('dicer: cannot switch typed-in dice', err);
  } finally {
    busy = false;
    paint();
  }
}

let button = null;
let hooked = false;

/** The button's pressed state and tooltip, from this browser's dice configuration. */
function paint() {
  const b = button?.querySelector('button');
  if (!b) return;
  let on = false;
  try {
    on = manualOn(game.settings.get('core', 'diceConfiguration'));
  } catch {
    /* not registered */
  }
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', game.i18n.localize(`DICER.Manual.${on ? 'ButtonOn' : 'ButtonOff'}`));
}

/** The button is shown: the GM's manualButton, and no hand rolls required (they take every die). */
const shown = () => setting('manualButton', false) === true && setting('handRollsRequired', false) !== true;

const controlsOf = (els) =>
  els?.['#chat-controls'] ??
  (els instanceof Element ? els.querySelector('#chat-controls') : null) ??
  document.getElementById('chat-controls');

/**
 * Puts the typed-in dice button in the chat controls, after the message modes (main.js:
 * renderChatInput, renderChatLog and the manualButton setting's change); removed when not shown.
 * `syncHand`: main.js's dice configuration sync, run after each switch.
 */
export function dockToggle(els, syncHand) {
  try {
    if (syncHand) sync = syncHand;
    if (!hooked) {
      hooked = true;
      Hooks.on('updateSetting', (doc) => {
        if (doc?.key === 'core.diceConfiguration') paint();
      });
      Hooks.on('createSetting', (doc) => {
        if (doc?.key === 'core.diceConfiguration') paint();
      });
    }
    if (!shown()) {
      button?.remove();
      return null;
    }
    const controls = controlsOf(els);
    if (!controls) return null;
    if (!button) {
      button = document.createElement('div');
      button.className = 'split-button dicer-manual-toggle';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-control icon fa-solid fa-keyboard';
      b.dataset.tooltip = '';
      b.addEventListener('click', () => toggleManual());
      button.append(b);
      injectStyle(document);
    }
    const modes = controls.querySelector('#message-modes');
    if (modes) {
      if (modes.nextElementSibling !== button) modes.after(button);
    } else if (button.parentElement !== controls) controls.prepend(button);
    paint();
    return button;
  } catch (err) {
    console.warn('dicer: cannot show the typed-in dice button', err);
    return null;
  }
}

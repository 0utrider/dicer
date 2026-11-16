/**
 * The chat dice tray (lazy chat-tray chunk; its world-start half is main.js's dockChat on
 * renderChatInput / renderChatLog and the client setting chatTray). A Dice Tray replacement: one
 * button per die docked under the chat input. Click adds a die, right-click removes one, holding
 * offers quick counts (and advantage on the d20); a modifier, Clear and Roll (who sees it: the chat's own mode buttons).
 *
 * Roll posts the formula as a normal Foundry roll, so Dicer animates it like any other. Where the
 * user may roll by hand (shell.handAllowed, engine up), a die or the Roll button dragged out of
 * the chat onto the table opens the throw overlay with those dice: the hand chunk's own
 * throwTray, never a second resolve path. Only the tray's pure core (tray-dice.js) is imported
 * here, so docking never fetches the hand chunk; a drop loads it.
 */
import {
  TRAY_DICE,
  DIE_SHAPES,
  countOf,
  modOf,
  formulaFromCounts,
  coreMode,
  stepCount,
} from '../hand/chunk/tray-dice.js';
import { handAllowed, handDeps } from '../hand/shell.js';

/** A press held this long (ms) opens the quick-count menu. */
export const HOLD_MS = 450;
/** A press that moves this far (px) is a drag, not a click or a hold. */
const DRAG_PX = 6;
const QUICK = [2, 3, 4, 5, 6, 7, 8, 9, 10];
/** decorateFor's roller for swatches: no one, so no trigger macros or own effects resolve. */
const SWATCH_ROLLER = 'dicer-chat-tray';

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => {
  const f = globalThis.game?.i18n?.format;
  return f ? f.call(globalThis.game.i18n, key, data) : key;
};

/** The dock's formula: the tray's, with the d20 term keeping its highest (adv 1) or lowest (-1). */
export function chatFormula({ counts = {}, modifier = 0, adv = 0 } = {}) {
  const c = { ...counts };
  if (adv && countOf(c.d20) === 1) c.d20 = 2; // advantage is two d20s at least
  const f = formulaFromCounts(c, modifier);
  return adv ? f.replace(/\b(\d+)d20(?!\d)/, `$1d20${adv > 0 ? 'kh' : 'kl'}`) : f;
}

/**
 * `state` with advantage (dir 1) or disadvantage (-1) toggled: switching it on raises the d20s
 * to two, switching it off drops a pair back to one. A new object.
 */
export function toggleAdv(state, dir) {
  const n = countOf(state.counts?.d20);
  const adv = state.adv === dir ? 0 : dir;
  let d20 = n;
  if (adv && n < 2) d20 = 2;
  else if (!adv && n === 2) d20 = 1;
  return { ...state, adv, counts: { ...state.counts, d20 } };
}

/** Shown: the client setting on and the Dice Tray module not active. Never throws. */
export function chatTrayShown() {
  try {
    return (
      globalThis.game.settings.get('dicer', 'chatTray') === true &&
      !globalThis.game.modules?.get('dice-tray')?.active
    );
  } catch {
    return false; // not registered (Dice So Nice active)
  }
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** WCAG relative luminance of a #rgb / #rrggbb colour. */
function lum(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/**
 * A die button's tint from a resolved appearance: {body, number} (hex), or null when the body
 * colour is not a plain hex. Numbers under 2:1 against the body become black or white.
 */
export function tintOf(appearance) {
  const body = appearance?.body?.color;
  if (typeof body !== 'string' || !HEX.test(body)) return null;
  let number = appearance?.numbers?.color;
  if (typeof number !== 'string' || !HEX.test(number) || contrast(body, number) < 2) {
    number = contrast(body, '#000000') >= contrast(body, '#ffffff') ? '#000000' : '#ffffff';
  }
  return { body, number };
}

/** A stand-in term of the tray die `key`, enough for the look resolver (dsnTypeOf). */
const termOf = (key) =>
  key === 'dF'
    ? { constructor: { DENOMINATION: 'f' }, options: {} }
    : { faces: +key.slice(1), options: {} };

/**
 * Each tray die's tint as `userId`'s own dice look (the hand deps' decorateFor: the look path the
 * dice use); {} when it cannot resolve. Never throws.
 */
export function tintsFor(decorateFor, userId) {
  const out = {};
  try {
    const roll = { formula: '', terms: [], dice: [], options: {} };
    const dec = decorateFor(null, roll, userId, SWATCH_ROLLER);
    for (const key of TRAY_DICE) {
      const t = tintOf(dec?.(termOf(key), undefined, 0)?.appearance);
      if (t) out[key] = t;
    }
  } catch {
    /* no engine yet, or a throwing resolver: plain buttons */
  }
  return out;
}

/** What the dock holds while the page lives. */
let state = { counts: {}, modifier: 0, adv: 0 };
let dockEl = null;
let loader = null; // main.js's loadHand
let hooked = false;

/** Test seam: forgets the dock and the selection. */
export function _resetChatTray() {
  dockEl?.remove();
  dockEl = null;
  loader = null;
  hooked = false;
  state = { counts: {}, modifier: 0, adv: 0 };
}

const getSetting = (k) => globalThis.game.settings.get('dicer', k);
/** Throwing by hand is offered: the engine is up and this user may roll by hand. */
const canThrow = () => {
  try {
    return !!handDeps() && handAllowed(globalThis.game.user, getSetting);
  } catch {
    return false;
  }
};

function h(tag, attrs = {}, kids = []) {
  const el =
    tag === 'svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', tag)
      : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') el.textContent = v;
    else if (k === 'html')
      el.innerHTML = v; // trusted constants only (DIE_SHAPES)
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}
const tip = (attrs, text) => ({ ...attrs, 'aria-label': text, 'data-tooltip': text });

function build() {
  const dice = TRAY_DICE.map((key) =>
    h(
      'button',
      tip(
        { type: 'button', class: 'dicer-chat-tray-die', 'data-die': key },
        fmt('DICER.ChatTray.Die', { die: key }),
      ),
      [
        h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', html: DIE_SHAPES[key] }),
        h('span', { class: 'dicer-chat-tray-name', text: key }),
        h('span', { class: 'dicer-chat-tray-count', 'aria-hidden': 'true' }),
      ],
    ),
  );
  const icon = (cls) => h('i', { class: `fa-solid ${cls}`, 'aria-hidden': 'true' });
  const btn = (attrs, text, kids) => h('button', tip({ type: 'button', ...attrs }, text), kids);
  // No mode picker: the chat's own roll-mode buttons decide who sees it (coreMode at roll time).
  const bar = h('div', { class: 'dicer-chat-tray-bar' }, [
    h('span', { class: 'dicer-chat-tray-mod' }, [
      btn({ 'data-mod': '-1' }, loc('DICER.Tray.ModifierDown'), [icon('fa-minus')]),
      h(
        'input',
        tip(
          { type: 'number', value: '0', step: '1', min: '-9999', max: '9999' },
          loc('DICER.Tray.Modifier'),
        ),
      ),
      btn({ 'data-mod': '1' }, loc('DICER.Tray.ModifierUp'), [icon('fa-plus')]),
    ]),
    btn(
      { 'data-adv': '1', 'aria-pressed': 'false', class: 'dicer-chat-tray-adv' },
      loc('DICER.ChatTray.AdvHint'),
      [loc('DICER.ChatTray.Adv')],
    ),
    btn(
      { 'data-adv': '-1', 'aria-pressed': 'false', class: 'dicer-chat-tray-adv' },
      loc('DICER.ChatTray.DisHint'),
      [loc('DICER.ChatTray.Dis')],
    ),
    btn({ 'data-act': 'clear' }, loc('DICER.ChatTray.Clear'), [icon('fa-eraser')]),
    btn({ 'data-act': 'roll', class: 'dicer-chat-tray-roll' }, loc('DICER.ChatTray.RollHint'), [
      icon('fa-dice-d20'),
      h('span', { class: 'dicer-chat-tray-formula' }),
    ]),
  ]);
  return h('section', { class: 'dicer-chat-tray', 'aria-label': loc('DICER.ChatTray.Label') }, [
    h('div', { class: 'dicer-chat-tray-dice' }, dice),
    bar,
  ]);
}

/** Shows `state` in the dock: badges, the d20 helpers, the modifier and the Roll label. */
function paint({ syncModifier = true } = {}) {
  if (!dockEl) return;
  for (const el of dockEl.querySelectorAll('.dicer-chat-tray-die')) {
    const n = countOf(state.counts[el.dataset.die]);
    el.classList.toggle('has-dice', n > 0);
    el.querySelector('.dicer-chat-tray-count').textContent = n ? String(n) : '';
  }
  for (const el of dockEl.querySelectorAll('[data-adv]')) {
    el.setAttribute('aria-pressed', String(state.adv === Number(el.dataset.adv)));
  }
  const formula = chatFormula(state);
  const roll = dockEl.querySelector('[data-act="roll"]');
  roll.disabled = !formulaFromCounts(state.counts, 0);
  roll.querySelector('.dicer-chat-tray-formula').textContent =
    formula || loc('DICER.ChatTray.Roll');
  if (syncModifier)
    dockEl.querySelector('.dicer-chat-tray-mod input').value = String(modOf(state.modifier));
  const throwing = canThrow();
  dockEl.classList.toggle('can-throw', throwing);
  roll.dataset.tooltip = loc(throwing ? 'DICER.ChatTray.RollThrowHint' : 'DICER.ChatTray.RollHint');
}

/** Tints the die buttons as this user's dice look (CSS vars; none: the plain style). */
function tint() {
  if (!dockEl) return;
  const deps = handDeps();
  const tints = deps?.decorateFor ? tintsFor(deps.decorateFor, globalThis.game.user?.id) : {};
  for (const el of dockEl.querySelectorAll('.dicer-chat-tray-die')) {
    const t = tints[el.dataset.die];
    el.style.setProperty('--dicer-ct-body', t?.body ?? '');
    el.style.setProperty('--dicer-ct-num', t?.number ?? '');
  }
  dockEl.dataset.tinted = deps ? '1' : '';
}

const modeOf = () => coreMode();
const clear = () => (state = { ...state, counts: {}, modifier: 0, adv: 0 });

/** Posts the formula as a normal Foundry roll (Dicer animates it as any roll). */
async function roll() {
  const formula = chatFormula(state);
  if (!formulaFromCounts(state.counts, 0)) return;
  const mode = modeOf();
  clear();
  paint();
  try {
    const Roll = globalThis.foundry.dice.Roll.defaultImplementation;
    await new Roll(formula).toMessage({}, { messageMode: mode });
  } catch (err) {
    console.warn('dicer: the chat dice tray could not roll', err);
    globalThis.ui?.notifications?.warn(loc('DICER.Tray.Failed'));
  }
}

/** The dice a drag carries: one die (its count, or 1) or, with no die, the whole selection. */
function choiceFor(key) {
  const counts = {};
  for (const k of key ? [key] : TRAY_DICE) {
    const n = countOf(state.counts[k]);
    if (n || k === key) counts[k] = Math.max(1, n);
  }
  const adv = key && key !== 'd20' ? 0 : state.adv;
  if (adv && counts.d20) counts.d20 = Math.max(2, counts.d20);
  const modifier = modOf(state.modifier);
  return { counts, modifier, mode: modeOf(), formula: chatFormula({ counts, modifier, adv }) };
}

/** Throws by hand through the hand chunk's tray (overlay, resolve, post); the set clears once posted. */
async function throwByHand(key) {
  if (!canThrow() || !loader) return;
  const choice = choiceFor(key);
  if (!formulaFromCounts(choice.counts, 0)) return;
  try {
    const m = await loader();
    const msg = await m?.throwTray(choice);
    if (msg && !key) {
      clear();
      paint();
    }
  } catch (err) {
    console.warn('dicer: the chat dice tray could not throw', err);
    globalThis.ui?.notifications?.warn(loc('DICER.Tray.Failed'));
  }
}

function closeMenu() {
  dockEl?.querySelector('.dicer-chat-tray-menu')?.remove();
}

/** The quick-count menu of die `key` (and advantage / disadvantage on the d20). */
function openMenu(button) {
  closeMenu();
  const key = button.dataset.die;
  const items = QUICK.map((n) =>
    h('button', { type: 'button', 'data-count': String(n), 'data-die': key, text: `${n}${key}` }),
  );
  if (key === 'd20') {
    items.push(
      h('button', {
        type: 'button',
        'data-adv': '1',
        'data-menu': '1',
        text: loc('DICER.ChatTray.AdvHint'),
      }),
      h('button', {
        type: 'button',
        'data-adv': '-1',
        'data-menu': '1',
        text: loc('DICER.ChatTray.DisHint'),
      }),
    );
  }
  const menu = h('div', { class: 'dicer-chat-tray-menu', role: 'menu' }, items);
  menu.style.left = `${button.offsetLeft}px`;
  dockEl.append(menu);
}

/** Wires the dock (delegated: one set of listeners for its life). */
function wire(root) {
  let press = null; // {button, x, y, timer, dragging}
  let swallowClick = false;

  root.addEventListener('click', (event) => {
    const t = event.target.closest?.('button');
    if (!t || !root.contains(t)) return;
    if (swallowClick) {
      swallowClick = false;
      if (t.matches('.dicer-chat-tray-die, [data-act="roll"]')) return;
    }
    if (t.dataset.count) {
      state.counts = { ...state.counts, [t.dataset.die]: countOf(t.dataset.count) };
      closeMenu();
    } else if (t.matches('.dicer-chat-tray-die')) {
      state.counts = stepCount(state.counts, t.dataset.die, event.shiftKey ? -1 : 1);
    } else if (t.dataset.mod) {
      state.modifier = modOf(modOf(state.modifier) + Number(t.dataset.mod));
    } else if (t.dataset.adv) {
      state = toggleAdv(state, Number(t.dataset.adv));
      if (t.dataset.menu) {
        if (state.adv === 0) state = toggleAdv(state, Number(t.dataset.adv)); // a menu pick sets it
        closeMenu();
      }
    } else if (t.dataset.act === 'clear') clear();
    else if (t.dataset.act === 'roll') return void roll();
    else return;
    paint();
  });
  root.addEventListener('contextmenu', (event) => {
    const t = event.target.closest?.('.dicer-chat-tray-die');
    if (!t) return;
    event.preventDefault();
    state.counts = stepCount(state.counts, t.dataset.die, -1);
    paint();
  });
  root.addEventListener('keydown', (event) => {
    const t = event.target;
    if (t.matches?.('.dicer-chat-tray-die') && ['Backspace', 'Delete', '-'].includes(event.key)) {
      event.preventDefault();
      state.counts = stepCount(state.counts, t.dataset.die, -1);
      paint();
    } else if (event.key === 'Enter' && t.matches?.('input')) event.preventDefault(); // not the chat form's submit
  });
  root.addEventListener('input', (event) => {
    if (event.target.matches?.('.dicer-chat-tray-mod input')) {
      state.modifier = modOf(event.target.value);
      paint({ syncModifier: false });
    }
  });
  // The engine may come up after the first chat render: tint on the first hover then.
  root.addEventListener('pointerenter', () => !root.dataset.tinted && tint());

  // Press: hold for the quick counts; drag out of the chat to throw by hand.
  const end = () => {
    clearTimeout(press?.timer);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    root.classList.remove('is-dragging');
    press = null;
  };
  const move = (event) => {
    if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_PX) return;
    clearTimeout(press.timer);
    if (!press.dragging && canThrow()) {
      press.dragging = true;
      root.classList.add('is-dragging');
    }
  };
  const up = (event) => {
    const p = press;
    end();
    if (!p?.dragging) return;
    swallowClick = true;
    // Dropped outside the chat (sidebar, popout or notifications): onto the table.
    const host = root.closest('#sidebar, #chat-popout, .chat-popout, #chat-notifications') ?? root;
    const r = host.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return;
    throwByHand(p.button.dataset.die);
  };
  root.addEventListener('pointerdown', (event) => {
    if (!event.target.closest?.('.dicer-chat-tray-menu')) closeMenu();
    swallowClick = false; // a new press: only its own hold or drag swallows its click
    const button = event.target.closest?.('.dicer-chat-tray-die, [data-act="roll"]');
    if (!button || event.button !== 0) return;
    end();
    press = { button, x: event.clientX, y: event.clientY, dragging: false };
    if (button.dataset.die) {
      press.timer = setTimeout(() => {
        swallowClick = true;
        openMenu(button);
      }, HOLD_MS);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}

/** The chat textarea in renderChatInput's elements, renderChatLog's element, or the page. */
function textareaOf(els) {
  const ta =
    els?.['#chat-message'] ?? (els instanceof Element ? els.querySelector('#chat-message') : null);
  return ta?.isConnected ? ta : document.getElementById('chat-message');
}

/**
 * Docks the tray under the chat input (main.js: renderChatInput, renderChatLog and the setting's
 * change): built once, then moved after the chat form wherever Foundry put the textarea (sidebar,
 * popout, notifications); removed when not shown (chatTrayShown). `loadHand`: main.js's.
 */
export function dock(els, loadHand) {
  try {
    if (loadHand) loader = loadHand;
    if (!hooked) {
      hooked = true;
      // This user's look changed (theme setting mirrored into the flag, a GM push): repaint.
      globalThis.Hooks?.on?.('updateUser', (user, changes) => {
        if (user?.id === globalThis.game.user?.id && changes?.flags?.dicer) tint();
      });
      // The chatTray setting docks or undocks at once (kept out of world start's settings.js).
      globalThis.Hooks?.on?.('clientSettingChanged', (key) => key === 'dicer.chatTray' && dock());
    }
    const ta = textareaOf(els);
    if (!chatTrayShown()) return (undock(), null);
    if (!ta) return null;
    if (!dockEl) {
      dockEl = build();
      wire(dockEl);
    }
    const anchor = ta.closest('.chat-form, form') ?? ta;
    if (anchor.nextElementSibling !== dockEl) anchor.after(dockEl);
    tint();
    paint();
    return dockEl;
  } catch (err) {
    console.warn('dicer: cannot dock the chat dice tray', err);
    return null;
  }
}

function undock() {
  closeMenu();
  dockEl?.remove();
}

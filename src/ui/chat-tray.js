/**
 * The chat dice tray (lazy chat-tray chunk; its world-start half is main.js's dockChat on
 * renderChatInput / renderChatLog and the client setting chatTray). A Dice Tray replacement: one
 * button per die docked under the chat input. Click adds a die, right-click removes one, holding
 * offers quick counts (and the system's roll helper pair on its main die, if it has one);
 * a modifier, Clear and Roll (who sees it: the chat's own mode buttons). The dice and that pair
 * follow the world's system (trayProfile).
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

const STANDARD = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
/**
 * Each system's pair of roll helpers (labels: lang DICER.ChatTray.<up|down>, tooltips <upHint|downHint>),
 * offered on its main die `die`:
 * - keep: two of `die`, keep the highest (up) or lowest (down);
 * - add: `term` added (up) or subtracted (down) at the end of the formula;
 * - duality: Daggerheart's advantage state, given to the system's own Duality roll (rollDuality);
 *   without that API it acts as add (`term`).
 */
const HELPERS = {
  adv: { kind: 'keep', die: 'd20', up: 'Adv', down: 'Dis', upHint: 'AdvHint', downHint: 'DisHint' },
  // PF2e: roll twice, use the higher / lower
  fortune: { kind: 'keep', die: 'd20', up: 'Fortune', down: 'Misfortune', upHint: 'FortuneHint', downHint: 'MisfortuneHint' },
  // Daggerheart: an advantage die (d6) added to, or a disadvantage die taken from, the duality roll
  hope: { kind: 'duality', die: 'd12', term: '1d6', up: 'Adv', down: 'Dis', upHint: 'AdvD6Hint', downHint: 'DisD6Hint' },
  // Draw Steel: an edge is +2 and a bane -2 on the power roll (double ones move the tier instead)
  edge: { kind: 'add', die: 'd10', term: '2', up: 'Edge', down: 'Bane', upHint: 'EdgeHint', downHint: 'BaneHint' },
};
/**
 * Per world system (game.system.id): the dice the tray shows (default STANDARD) and its helper
 * pair (default none). A system not listed gets the standard dice and no pair: a helper the rules
 * do not have is worse than none.
 */
const PROFILES = {
  dnd5e: { helper: 'adv' },
  sw5e: { helper: 'adv' },
  a5e: { helper: 'adv' },
  'black-flag': { helper: 'adv' },
  // flat: one-click flat checks at these DCs (concealed 5, hidden 11)
  pf2e: { helper: 'fortune', flat: [5, 11] },
  sf2e: { helper: 'fortune', flat: [5, 11] },
  daggerheart: { dice: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'], helper: 'hope' },
  'draw-steel': { dice: ['d10', 'd6'], helper: 'edge' },
  swade: { dice: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] },
  'cyberpunk-red-core': { dice: ['d6', 'd10'] },
  CoC7: { dice: ['d4', 'd6', 'd8', 'd10', 'd20', 'd100'] },
  'fate-core-official': { dice: ['dF'] },
  ModularFate: { dice: ['dF'] },
};

/** The tray for system `id`: {dice: tray die keys, helper: a HELPERS entry | null, flat: flat check DCs}. */
export function trayProfile(id = globalThis.game?.system?.id) {
  const p = Object.hasOwn(PROFILES, id) ? PROFILES[id] : {};
  return {
    dice: (p.dice ?? STANDARD).filter((k) => TRAY_DICE.includes(k)),
    helper: HELPERS[p.helper] ?? null,
    flat: p.flat ?? [],
  };
}

/** The user flag (dicer.chatTray) holding each user's own tray choices; follows them to any device. */
export const PREFS_FLAG = 'chatTray';

/**
 * `user`'s own tray choices, validated (a flag is data any script may write): {dice?: tray die keys
 * in tray order, at least one; helper?: false; modifier?: false}. Absent: the system's tray.
 */
export function readPrefs(user = globalThis.game?.user) {
  let raw;
  try {
    raw = user?.getFlag?.('dicer', PREFS_FLAG) ?? user?.flags?.dicer?.[PREFS_FLAG];
  } catch {
    raw = null;
  }
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (Array.isArray(raw.dice)) {
    const dice = TRAY_DICE.filter((k) => raw.dice.includes(k));
    if (dice.length) out.dice = dice;
  }
  if (raw.helper === false) out.helper = false;
  if (raw.modifier === false) out.modifier = false;
  if (raw.flat === false) out.flat = false;
  return out;
}

/**
 * The tray as this user sees it: the system profile with their own choices on top. {dice, helper
 * (null: hidden or none), modifier: shown, systemHelper: the system's pair, hidden or not, flat:
 * the flat check DCs shown, systemFlat: the system's}.
 */
export function trayFor(prefs = readPrefs(), profile = trayProfile()) {
  return {
    dice: prefs.dice ?? profile.dice,
    helper: prefs.helper === false ? null : profile.helper,
    modifier: prefs.modifier !== false,
    systemHelper: profile.helper,
    flat: prefs.flat === false ? [] : profile.flat,
    systemFlat: profile.flat,
  };
}

/**
 * A flat check at `dc`: 1d20, or with the d20 helper on the higher (fortune, adv 1) or lower
 * (misfortune, -1) of two. A success is the total at or above the DC.
 */
export const flatFormula = (adv = 0, helper = helperNow()) =>
  adv && helper?.kind === 'keep' && helper.die === 'd20' ? `2d20${adv > 0 ? 'kh' : 'kl'}` : '1d20';

/** pf2e's degree names, 0 (critical failure) to 3 (critical success): its chat CSS classes. */
export const DEGREES = ['criticalFailure', 'failure', 'success', 'criticalSuccess'];
const DEGREE_LABELS = [
  'DICER.ChatTray.FlatCriticalFailure',
  'DICER.ChatTray.FlatFailure',
  'DICER.ChatTray.FlatSuccess',
  'DICER.ChatTray.FlatCriticalSuccess',
];
/**
 * The degree of success of `total` against `dc`, as pf2e counts it: 10 over is a critical success,
 * 10 under a critical failure, and a natural 20 / 1 (`natural`, the d20 kept) moves it one step.
 */
export function flatDegree(total, natural, dc) {
  let d = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (natural === 20) d = Math.min(3, d + 1);
  else if (natural === 1) d = Math.max(0, d - 1);
  return d;
}
/** The card's flavor, in pf2e's own check markup, so its chat styles colour the result. */
export function flatFlavor(dc, degree) {
  const name = DEGREES[degree];
  return (
    `<h4 class="action"><strong>${loc('DICER.ChatTray.FlatTitle')}</strong></h4>` +
    `<div class="target-dc-result"><div class="target-dc"><span>${fmt('DICER.ChatTray.FlatDC', { dc })}</span></div>` +
    `<div class="result degree-of-success dicer-flat-result">${loc('DICER.ChatTray.FlatResult')} ` +
    `<span class="${name}">${loc(DEGREE_LABELS[degree])}</span></div></div>`
  );
}
const helperNow = () => trayFor().helper;

/**
 * The dock's formula: the tray's, with the system helper on (adv 1) or its opposite (-1): a keep
 * helper keeps the highest / lowest of its die (two at least), an add helper adds / subtracts its term.
 */
export function chatFormula({ counts = {}, modifier = 0, adv = 0 } = {}, helper = helperNow()) {
  if (!adv || !helper) return formulaFromCounts(counts, modifier);
  if (helper.kind === 'add' || helper.kind === 'duality') {
    const f = formulaFromCounts(counts, modifier);
    return f && `${f} ${adv > 0 ? '+' : '-'} ${helper.term}`;
  }
  const c = { ...counts };
  const { die } = helper;
  if (countOf(c[die]) === 1) c[die] = 2;
  const term = new RegExp(String.raw`\b(\d+)${die}(?!\d)`);
  return formulaFromCounts(c, modifier).replace(term, `$1${die}${adv > 0 ? 'kh' : 'kl'}`);
}

/**
 * `state` with the helper (dir 1) or its opposite (-1) toggled. A keep helper switched on raises its
 * die to two, switched off drops a pair back to one. A new object.
 */
export function toggleAdv(state, dir, helper = helperNow()) {
  const adv = state.adv === dir ? 0 : dir;
  if (helper?.kind !== 'keep') return { ...state, adv };
  const { die } = helper;
  const n = countOf(state.counts?.[die]);
  let m = n;
  if (adv && n < 2) m = 2;
  else if (!adv && n === 2) m = 1;
  return { ...state, adv, counts: { ...state.counts, [die]: m } };
}

/**
 * Daggerheart's own Duality roll pipeline (the one its [[/dr]] button uses): MoveContext builds the
 * roll config, DualityRoll.build opens the system's roll dialog, rolls Hope and Fear and posts the
 * card. Null when the system does not offer it.
 */
function dualityApi() {
  const Move = globalThis.game?.system?.api?.data?.actions?.MoveContext;
  const Duality = globalThis.CONFIG?.Dice?.daggerheart?.DualityRoll;
  return typeof Move?.build === 'function' && typeof Duality?.build === 'function' ? { Move, Duality } : null;
}

/**
 * The selection is a Duality roll: the system has one (a duality helper and its API) and the
 * selection is empty or exactly two d12.
 */
export function isDuality(st, helper = helperNow()) {
  if (helper?.kind !== 'duality' || !dualityApi()) return false;
  const d12 = countOf(st.counts?.d12);
  return (d12 === 0 || d12 === 2) && TRAY_DICE.every((k) => k === 'd12' || !countOf(st.counts?.[k]));
}

/**
 * Rolls Daggerheart's Duality roll with the tray's advantage (-1, 0, 1: the system's advantage
 * states). The tray modifier is not carried: the system's dialog adds traits and experiences.
 * True once handed to the system.
 */
export async function rollDuality(adv = 0) {
  const api = dualityApi();
  if (!api) return false;
  const config = await api.Move.build({
    roll: { type: 'trait', trait: null, difficulty: undefined, advantage: adv || undefined },
    skips: { resources: false, triggers: false },
  });
  await api.Duality.build(config);
  return true;
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
// The dock sits at the bottom of the chat: its tooltips open upward, never over its own buttons.
const tip = (attrs, text) => ({ ...attrs, 'aria-label': text, 'data-tooltip': text, 'data-tooltip-direction': 'UP' });

function build() {
  const { dice: keys, helper: keep, modifier, flat } = trayFor();
  const dice = keys.map((key) =>
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
    h('span', { class: 'dicer-chat-tray-mod', ...(modifier ? {} : { hidden: '' }) }, [
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
    ...(keep
      ? [
          btn(
            { 'data-adv': '1', 'aria-pressed': 'false', class: 'dicer-chat-tray-adv' },
            loc(`DICER.ChatTray.${keep.upHint}`),
            [loc(`DICER.ChatTray.${keep.up}`)],
          ),
          btn(
            { 'data-adv': '-1', 'aria-pressed': 'false', class: 'dicer-chat-tray-adv' },
            loc(`DICER.ChatTray.${keep.downHint}`),
            [loc(`DICER.ChatTray.${keep.down}`)],
          ),
        ]
      : []),
    btn({ 'data-act': 'clear' }, loc('DICER.ChatTray.Clear'), [icon('fa-eraser')]),
    btn({ 'data-act': 'customize', 'aria-expanded': 'false' }, loc('DICER.ChatTray.Customize'), [
      icon('fa-gear'),
    ]),
    btn({ 'data-act': 'roll', class: 'dicer-chat-tray-roll' }, loc('DICER.ChatTray.RollHint'), [
      icon('fa-dice-d20'),
      h('span', { class: 'dicer-chat-tray-formula', text: loc('DICER.ChatTray.Roll') }),
    ]),
  ]);
  // Flat checks (pf2e, sf2e): one click rolls a d20 against the DC, after the dice.
  const flats = flat.map((dc) =>
    h('button', tip({ type: 'button', class: 'dicer-chat-tray-flat', 'data-flat': String(dc) }, fmt('DICER.ChatTray.FlatHint', { dc })), [
      h('span', { class: 'dicer-chat-tray-flat-dc', text: String(dc) }),
      h('span', { class: 'dicer-chat-tray-name', text: loc('DICER.ChatTray.Flat') }),
    ]),
  );
  return h('section', { class: 'dicer-chat-tray', 'aria-label': loc('DICER.ChatTray.Label') }, [
    h('div', { class: 'dicer-chat-tray-dice' }, [...dice, ...flats]),
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
  const duality = isDuality(state);
  roll.disabled = !duality && !formulaFromCounts(state.counts, 0);
  // The button just says Roll; what it rolls (the formula, or Duality) leads its tooltip.
  const what = duality
    ? loc(state.adv > 0 ? 'DICER.ChatTray.DualityAdv' : state.adv < 0 ? 'DICER.ChatTray.DualityDis' : 'DICER.ChatTray.Duality')
    : formula;
  const mod = dockEl.querySelector('.dicer-chat-tray-mod input');
  if (syncModifier && mod) mod.value = String(modOf(state.modifier));
  const throwing = canThrow();
  dockEl.classList.toggle('can-throw', throwing);
  const hint = loc(
    duality ? 'DICER.ChatTray.DualityHint' : throwing ? 'DICER.ChatTray.RollThrowHint' : 'DICER.ChatTray.RollHint',
  );
  roll.dataset.tooltip = what ? `${what}: ${hint}` : hint;
  roll.setAttribute('aria-label', roll.dataset.tooltip);
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
  if (isDuality(state)) {
    const adv = state.adv;
    clear();
    paint();
    try {
      if (await rollDuality(adv)) return;
    } catch (err) {
      console.warn('dicer: the chat dice tray could not roll duality', err);
      globalThis.ui?.notifications?.warn(loc('DICER.Tray.Failed'));
    }
    return;
  }
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

/**
 * Posts a flat check at `dc` (flatFormula: fortune or misfortune when on) as the system shows one:
 * its own CheckRoll where it has one (pf2e, sf2e: a natural 20 / 1 colours the total), the degree
 * of success in its check markup (flatFlavor). The tray's selection stays as it is.
 */
async function rollFlat(dc) {
  const formula = flatFormula(state.adv);
  const mode = modeOf();
  try {
    const rolls = globalThis.CONFIG?.Dice?.rolls;
    const Check = Array.isArray(rolls) ? rolls.find((c) => c?.name === 'CheckRoll') : null;
    const Roll = Check ?? globalThis.foundry.dice.Roll.defaultImplementation;
    const options = Check ? { type: 'flat-check', rollerId: globalThis.game?.user?.id, showBreakdown: true } : {};
    const r = await new Roll(formula, {}, options).evaluate();
    const natural = r.dice?.[0]?.results?.find?.((x) => x.active !== false)?.result;
    const degree = flatDegree(r.total, natural, dc);
    if (Check && r.options) r.options.degreeOfSuccess = degree;
    await r.toMessage({ flavor: flatFlavor(dc, degree) }, { messageMode: mode });
  } catch (err) {
    console.warn('dicer: the chat dice tray could not roll a flat check', err);
    globalThis.ui?.notifications?.warn(loc('DICER.Tray.Failed'));
  }
}

/** The dice a drag carries: one die (its count, or 1) or, with no die, the whole selection. */
function choiceFor(key) {
  const counts = {};
  for (const k of key ? [key] : trayFor().dice) {
    const n = countOf(state.counts[k]);
    if (n || k === key) counts[k] = Math.max(1, n);
  }
  const helper = helperNow();
  const adv = key && key !== helper?.die ? 0 : state.adv;
  if (adv && helper?.kind === 'keep' && counts[helper.die]) counts[helper.die] = Math.max(2, counts[helper.die]);
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

/** The quick-count menu of die `key` (and the system's helper pair on its main die). */
function openMenu(button) {
  closeMenu();
  const key = button.dataset.die;
  const items = QUICK.map((n) =>
    h('button', { type: 'button', 'data-count': String(n), 'data-die': key, text: `${n}${key}` }),
  );
  const keep = helperNow();
  if (keep && key === keep.die) {
    items.push(
      h('button', {
        type: 'button',
        'data-adv': '1',
        'data-menu': '1',
        text: loc(`DICER.ChatTray.${keep.upHint}`),
      }),
      h('button', {
        type: 'button',
        'data-adv': '-1',
        'data-menu': '1',
        text: loc(`DICER.ChatTray.${keep.downHint}`),
      }),
    );
  }
  const menu = h('div', { class: 'dicer-chat-tray-menu', role: 'menu' }, items);
  menu.style.left = `${button.offsetLeft}px`;
  dockEl.append(menu);
}

function closePrefs() {
  dockEl?.querySelector('.dicer-chat-tray-prefs')?.remove();
  dockEl?.querySelector('[data-act="customize"]')?.setAttribute('aria-expanded', 'false');
}

/** The customize panel: which dice show, the system helper pair and the modifier (this user's own). */
function openPrefs() {
  closeMenu();
  closePrefs();
  const tray = trayFor();
  const chip = (key) =>
    h(
      'button',
      tip(
        { type: 'button', class: 'dicer-chat-tray-chip', 'data-pref-die': key, 'aria-pressed': String(tray.dice.includes(key)) },
        key,
      ),
      [h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', html: DIE_SHAPES[key] }), key],
    );
  const check = (pref, on, text) =>
    h('label', { class: 'dicer-chat-tray-check' }, [
      h('input', { type: 'checkbox', 'data-pref': pref, ...(on ? { checked: '' } : {}) }),
      text,
    ]);
  const sys = tray.systemHelper;
  const panel = h('div', { class: 'dicer-chat-tray-prefs', role: 'dialog', 'aria-label': loc('DICER.ChatTray.Customize') }, [
    h('strong', { text: loc('DICER.ChatTray.Customize') }),
    h('div', { class: 'dicer-chat-tray-chips' }, TRAY_DICE.map(chip)),
    ...(sys
      ? [
          check(
            'helper',
            !!tray.helper,
            fmt('DICER.ChatTray.CustomizeHelper', {
              up: loc(`DICER.ChatTray.${sys.up}`),
              down: loc(`DICER.ChatTray.${sys.down}`),
            }),
          ),
        ]
      : []),
    check('modifier', tray.modifier, loc('DICER.ChatTray.CustomizeModifier')),
    ...(tray.systemFlat.length
      ? [check('flat', tray.flat.length > 0, fmt('DICER.ChatTray.CustomizeFlat', { dcs: tray.systemFlat.join(', ') }))]
      : []),
    h('button', { type: 'button', 'data-pref-act': 'reset', text: loc('DICER.ChatTray.CustomizeReset') }),
  ]);
  dockEl.append(panel);
  dockEl.querySelector('[data-act="customize"]')?.setAttribute('aria-expanded', 'true');
}

/**
 * Rebuilds the dock for the current choices (the selection kept for dice still shown; the helper
 * off when hidden), reopening the customize panel if it was open.
 */
function rebuild() {
  if (!dockEl) return;
  const open = !!dockEl.querySelector('.dicer-chat-tray-prefs');
  const tray = trayFor();
  const counts = {};
  for (const k of tray.dice) if (state.counts[k]) counts[k] = state.counts[k];
  state = { ...state, counts, adv: tray.helper ? state.adv : 0 };
  if (!tray.modifier) state.modifier = 0;
  const fresh = build();
  wire(fresh);
  dockEl.replaceWith(fresh);
  dockEl = fresh;
  tint();
  paint();
  if (open) openPrefs();
}

/** Saves this user's choices (null: back to the system's tray) and shows them at once. */
async function savePrefs(next) {
  const user = globalThis.game?.user;
  try {
    if (next) await user.setFlag('dicer', PREFS_FLAG, next);
    else await user.unsetFlag('dicer', PREFS_FLAG);
  } catch (err) {
    console.warn('dicer: cannot save the chat tray choices', err);
    globalThis.ui?.notifications?.warn(loc('DICER.ChatTray.CustomizeFailed'));
  }
  rebuild();
}

/** A click or toggle in the customize panel: the new choices, from the current ones. */
function onPref(target) {
  const prefs = readPrefs();
  const tray = trayFor(prefs);
  if (target.dataset.prefAct === 'reset') return savePrefs(null);
  if (target.dataset.prefDie) {
    const key = target.dataset.prefDie;
    const on = tray.dice.includes(key);
    const dice = TRAY_DICE.filter((k) => (k === key ? !on : tray.dice.includes(k)));
    if (!dice.length) return; // at least one die stays
    return savePrefs({ ...prefs, dice });
  }
  const pref = target.dataset.pref;
  if (pref !== 'helper' && pref !== 'modifier' && pref !== 'flat') return;
  const next = { ...prefs };
  if (target.checked) delete next[pref];
  else next[pref] = false;
  return savePrefs(next);
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
    if (t.dataset.prefDie || t.dataset.prefAct) return void onPref(t);
    if (t.dataset.act === 'customize') {
      if (dockEl?.querySelector('.dicer-chat-tray-prefs')) closePrefs();
      else openPrefs();
      return;
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
    else if (t.dataset.flat) return void rollFlat(Number(t.dataset.flat));
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
  root.addEventListener('change', (event) => {
    if (event.target.dataset?.pref) onPref(event.target);
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
        const f = changes?.flags?.dicer;
        if (user?.id !== globalThis.game.user?.id || !f) return;
        if (PREFS_FLAG in f || `-=${PREFS_FLAG}` in f) rebuild();
        else tint();
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
  closePrefs();
  dockEl?.remove();
}

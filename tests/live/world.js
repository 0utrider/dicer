/* global Roll, Combat */
/**
 * Browser-side RPC module for the live smoke test. Foundry serves it at
 * /modules/dicer/tests/live/world.js; smoke.mjs imports it inside the page.
 */

const ELEMENT_WAIT_MS = 500;
const ELEMENT_POLL_MS = 10;
const LOOP_SAMPLE_MS = 4000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The message's element in the sidebar chat log (not a notification card or popout). */
function logElement(id) {
  return ui.chat?.element?.querySelector(`.chat-log [data-message-id="${id}"]`) ?? null;
}

/** Polls for the message element for up to ELEMENT_WAIT_MS; null if it never appears. */
async function waitForElement(id) {
  const until = performance.now() + ELEMENT_WAIT_MS;
  for (;;) {
    const el = logElement(id) ?? document.querySelector(`[data-message-id="${id}"]`);
    if (el) return el;
    if (performance.now() >= until) return null;
    await sleep(ELEMENT_POLL_MS);
  }
}

/**
 * Whether the revealed element's bottom edge lies within the chat log's visible rect. null
 * when it cannot be judged (no element in the sidebar log, or the log is not displayed).
 */
function scrolledIntoView(id) {
  const el = logElement(id);
  const scroller = el?.closest('.chat-scroll') ?? el?.parentElement;
  if (!el || !scroller || el.offsetParent === null) return null;
  const view = scroller.getBoundingClientRect();
  const { bottom } = el.getBoundingClientRect();
  return bottom <= view.bottom + 1 && bottom >= view.top;
}

/**
 * Roll a formula into chat and track how Dicer handled the message.
 * @param {string} formula
 * @returns {Promise<{id: string, hiddenEarly: boolean | null, completeCount: number,
 *   msToComplete: number, scrolledIntoView: boolean | null, loopingAfter: boolean}>}
 *   hiddenEarly is null when the message element never appeared within 500 ms.
 */
export async function rollAndTrack(formula) {
  const completed = [];
  const start = performance.now();
  let messageId = null;
  let resolveFirst;
  const first = new Promise((r) => (resolveFirst = r));
  // Other messages (another user's roll) must not satisfy this one: filter by id.
  const hookId = Hooks.on('diceSoNiceRollComplete', (id) => {
    completed.push({ id, at: performance.now() });
    if (messageId !== null && id === messageId) resolveFirst();
  });
  try {
    const message = await new Roll(formula).toMessage();
    const id = message.id;
    messageId = id;
    if (completed.some((c) => c.id === id)) resolveFirst();
    const el = await waitForElement(id);
    const hiddenEarly = el ? el.classList.contains('dsn-hide') : null;
    // Rolls that Dicer does not animate (e.g. 1d7) never complete: stop waiting at the watchdog.
    await Promise.race([first, sleep(16000)]);
    const mine = completed.filter((c) => c.id === id);
    const msToComplete = mine.length ? Math.round(mine[0].at - start) : -1;
    // Foundry's scrollBottom is synchronous after the reveal; give layout one frame.
    await new Promise((r) => requestAnimationFrame(() => r()));
    const inView = mine.length ? scrolledIntoView(id) : null;
    await sleep(LOOP_SAMPLE_MS);
    return {
      id,
      hiddenEarly,
      completeCount: mine.length,
      msToComplete,
      scrolledIntoView: inView,
      loopingAfter: Boolean(game.dice3d?._debug?.isLooping),
    };
  } finally {
    Hooks.off('diceSoNiceRollComplete', hookId);
  }
}

/* ------------------------------------------------------------------------------------------ *
 * Privacy and compatibility RPCs (tests/live/compat.mjs). Everything recorded here is a view
 * kind, a count or a flag: never a roll value.
 * ------------------------------------------------------------------------------------------ */

const SAMPLE_MS = 40;

function freshWindow() {
  return {
    complete: {}, // message id -> diceSoNiceRollComplete count
    processed: {}, // message id -> willTrigger3DRoll
    elements: new Set(), // message ids that got a [data-message-id] element on this client
    maxActive: 0, // most dice rolls in flight (game.dice3d._debug.activeRolls)
    canvasShown: false, // the dice canvas was displayed at some sample
    looping: false,
  };
}

/** Starts recording on this client (idempotent). */
export function arm() {
  if (globalThis.__dicerCompat) return true;
  const state = { cur: freshWindow() };
  state.hookComplete = Hooks.on('diceSoNiceRollComplete', (id) => {
    state.cur.complete[id] = (state.cur.complete[id] ?? 0) + 1;
  });
  state.hookProcessed = Hooks.on('diceSoNiceMessageProcessed', (id, info) => {
    state.cur.processed[id] = Boolean(info?.willTrigger3DRoll);
  });
  const note = (node) => {
    if (node.nodeType !== 1) return;
    const own = node.dataset?.messageId;
    if (own) state.cur.elements.add(own);
    for (const el of node.querySelectorAll?.('[data-message-id]') ?? []) {
      state.cur.elements.add(el.dataset.messageId);
    }
  };
  state.observer = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(note);
  });
  state.observer.observe(document.body, { childList: true, subtree: true });
  state.timer = setInterval(() => {
    const debug = game.dice3d?._debug;
    state.cur.maxActive = Math.max(state.cur.maxActive, debug?.activeRolls ?? 0);
    state.cur.looping ||= Boolean(debug?.isLooping);
    const canvas = document.querySelector('#dicer-layer canvas');
    if (canvas && canvas.style.display !== 'none') state.cur.canvasShown = true;
  }, SAMPLE_MS);
  globalThis.__dicerCompat = state;
  return true;
}

/** Forgets everything recorded so far; the next scenario starts clean. */
export function mark() {
  globalThis.__dicerCompat.cur = freshWindow();
  return true;
}

/**
 * Whether the rendered message shows any roll result: a total other than Foundry's private "?"
 * placeholder, or tooltip dice. A boolean only: no value ever leaves the page.
 */
function resultShownIn(id) {
  const safe = String(id).replace(/["\\]/g, '\\$&');
  const els = document.querySelectorAll(`[data-message-id="${safe}"]`);
  for (const el of els) {
    for (const total of el.querySelectorAll('.dice-total')) {
      const text = total.textContent.trim();
      if (text !== '' && text !== '?') return true;
    }
    if (el.querySelector('.dice-tooltip .roll.die, .dice-rolls .roll')) return true;
  }
  return false;
}

/** What this client saw for message `id` (null: only the window-wide facts). */
export function report(id) {
  const cur = globalThis.__dicerCompat.cur;
  return {
    completeCount: id ? (cur.complete[id] ?? 0) : null,
    processed: id ? (cur.processed[id] ?? null) : null,
    hasElement: id ? cur.elements.has(id) : null,
    resultShown: id ? resultShownIn(id) : null,
    views: id ? (game.dice3d._debug.lastRollViews[id] ?? null) : null,
    maxActive: cur.maxActive,
    canvasShown: cur.canvasShown,
    looping: cur.looping,
  };
}

export function getGhostSetting() {
  return game.settings.get('dicer', 'showGhostDice');
}

export function setGhostSetting(value) {
  return game.settings.set('dicer', 'showGhostDice', Boolean(value));
}

/** Rolls into chat with a roll mode ('publicroll' | 'gmroll' | 'blindroll' | 'selfroll'). */
export async function rollInChat({ formula, rollMode }) {
  const message = await new Roll(formula).toMessage({}, { rollMode });
  return message.id;
}

/** game.dice3d.showForRoll(roll, game.user, synchronize); resolves when the local show ends. */
export async function showForRollSynced(formula) {
  const roll = await new Roll(formula).evaluate();
  const shown = await game.dice3d.showForRoll(roll, game.user, true);
  return { shown };
}

/**
 * Rolls initiative for a throwaway combatant and samples the tracker row: was the value hidden
 * (dicer-hide-initiative) while the dice flew, and shown again afterwards. Cleans up after
 * itself. Returns { skipped } when there is no scene to hold a combat.
 */
export async function initiativeTrack() {
  if (!canvas?.scene) return { skipped: 'no active scene to hold a combat' };
  const combat = await Combat.create({ scene: canvas.scene.id, active: true });
  try {
    const [combatant] = await combat.createEmbeddedDocuments('Combatant', [
      { name: 'Dicer compat test' },
    ]);
    await ui.combat?.render?.({ force: true });
    ui.combat?.activate?.();
    const row = () =>
      ui.combat?.element?.querySelector(`[data-combatant-id="${combatant.id}"]`) ?? null;
    const valueEl = () => row()?.querySelector('.token-initiative, .initiative') ?? null;
    let hiddenWhileFlying = false;
    let sawValueEl = false;
    const sampler = setInterval(() => {
      const el = valueEl();
      if (!el) return;
      sawValueEl = true;
      if (el.classList.contains('dicer-hide-initiative')) hiddenWhileFlying = true;
    }, 10);
    const done = new Promise((resolve) => {
      const hookId = Hooks.on('diceSoNiceRollComplete', () => {
        Hooks.off('diceSoNiceRollComplete', hookId);
        resolve(true);
      });
      setTimeout(() => resolve(false), 16000);
    });
    await combat.rollInitiative([combatant.id]);
    const completed = await done;
    clearInterval(sampler);
    await sleep(600); // the reveal re-renders the tracker
    const el = valueEl();
    return {
      completed,
      sawValueEl,
      hiddenWhileFlying,
      shownAfter: Boolean(el) && !el.classList.contains('dicer-hide-initiative'),
    };
  } finally {
    await combat.delete();
  }
}

/* ------------------------------------------------------------------------------------------ *
 * Effects and sounds RPCs (tests/live/effects.mjs). Names and counts only: the counters in
 * game.dice3d._debug hold effect ids and result sound names, never roll values.
 * ------------------------------------------------------------------------------------------ */

/** This client's effect play and result sound counters (copies). */
export function fxCounts() {
  const d = game.dice3d._debug;
  return { fxPlays: { ...d.fxPlays }, resultSounds: { ...d.resultSounds } };
}

export function getDicerSetting(key) {
  return game.settings.get('dicer', key);
}

export function setDicerSetting({ key, value }) {
  return game.settings.set('dicer', key, value);
}

/** Rolls a 1d20 forced to a natural 20 into chat with the roll mode; returns the message id. */
export async function rollNat20({ rollMode }) {
  const roll = await new Roll('1d20').evaluate();
  roll.dice[0].results[0].result = 20;
  roll._total = 20;
  const message = await roll.toMessage({}, { rollMode });
  return message.id;
}

/** View kinds ('real' | 'ghost' | 'none') this client used for message `id`; null if none recorded. */
export function viewKinds(id) {
  return game.dice3d._debug.lastRollViews[id] ?? null;
}

// --- roll areas (tests/live/areas.mjs) ---------------------------------------------------------

/** This client's user id. */
export function myUserId() {
  return game.user.id;
}

/** game.dice3d._debug.lastRollArea as plain data: {area, rect} of the latest roll here, or null. */
export function lastRollArea() {
  return game.dice3d._debug.lastRollArea;
}

/** game.dice3d.rollAreas.set(userId, def); userId null sets the default area. Resolves true on success. */
export function setRollArea({ userId, def }) {
  return game.dice3d.rollAreas.set(userId ?? null, def);
}

export function setGmPrivateArea(def) {
  return game.dice3d.rollAreas.setGmPrivateArea(def);
}

/** The px rect the area of `userId` (null: the default) resolves to on this screen. */
export function rollAreaRect(userId) {
  return game.dice3d.rollAreas.rect(userId ?? null);
}

/**
 * The px rect `def` resolves to on this screen (with this client's area scale) when the default
 * area is the full stage: the live-test's independent check of the GM private corner.
 */
export async function resolveHere(def) {
  const { resolveArea } = await import('/modules/dicer/src/areas/area-model.js');
  const stage = game.dice3d.rollAreas.rect(null);
  return resolveArea(def, stage, { scale: Number(game.settings.get('dicer', 'areaScale')) || 1 });
}

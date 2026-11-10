/* global Roll */
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

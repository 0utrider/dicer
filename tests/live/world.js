/* global Roll */
/**
 * Browser-side RPC module for the live smoke test. Foundry serves it at
 * /modules/dicer/tests/live/world.js; smoke.mjs imports it inside the page.
 */

const HIDE_SAMPLE_MS = 100;
const LOOP_SAMPLE_MS = 4000;

/**
 * Roll a formula into chat and track how Dicer handled the message.
 * @param {string} formula
 * @returns {Promise<{id: string, hiddenEarly: boolean, completeCount: number,
 *   msToComplete: number, loopingAfter: boolean}>}
 */
export async function rollAndTrack(formula) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const completed = [];
  const start = performance.now();
  let resolveFirst;
  const first = new Promise((r) => (resolveFirst = r));
  const hookId = Hooks.on('diceSoNiceRollComplete', (id) => {
    completed.push({ id, at: performance.now() });
    resolveFirst();
  });
  try {
    const message = await new Roll(formula).toMessage();
    const id = message.id;
    await sleep(HIDE_SAMPLE_MS);
    const hiddenEarly = Boolean(
      document.querySelector(`[data-message-id="${id}"]`)?.classList.contains('dsn-hide'),
    );
    // Rolls that Dicer does not animate (e.g. 1d7) never complete: stop waiting at the watchdog.
    await Promise.race([first, sleep(16000)]);
    const msToComplete = completed.length ? Math.round(completed[0].at - start) : -1;
    await sleep(LOOP_SAMPLE_MS);
    return {
      id,
      hiddenEarly,
      completeCount: completed.filter((c) => c.id === id).length,
      msToComplete,
      loopingAfter: Boolean(game.dice3d?._debug?.isLooping),
    };
  } finally {
    Hooks.off('diceSoNiceRollComplete', hookId);
  }
}

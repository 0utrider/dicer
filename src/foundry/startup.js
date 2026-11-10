/**
 * Builds the dice engine and activates it. If any step throws, everything created so far is
 * released (no leaked worker or WebGL context) and one warning says 3D dice are disabled.
 *
 * @param {object} deps
 * @param {() => Promise<object>} deps.loadAtlas
 * @param {() => { terminate(): void }} deps.createPhysics
 * @param {() => { dispose(): void }} deps.createRenderer
 * @param {(parts: { atlas, physics, renderer }) => { dispose(): void }} deps.createDiceBox
 * @param {(parts: { physics, renderer, diceBox }) => void | Promise<void>} deps.activate
 * @returns {Promise<{ physics, renderer, diceBox } | null>} null when startup failed
 */
export async function startEngine({
  loadAtlas,
  createPhysics,
  createRenderer,
  createDiceBox,
  activate,
  warn = (...args) => console.warn(...args),
}) {
  let physics = null;
  let renderer = null;
  let diceBox = null;
  try {
    const atlas = await loadAtlas();
    physics = createPhysics();
    renderer = createRenderer();
    diceBox = createDiceBox({ atlas, physics, renderer });
    await activate({ physics, renderer, diceBox });
    return { physics, renderer, diceBox };
  } catch (err) {
    // The dice box uses the renderer, so it goes first; the worker last.
    for (const release of [
      () => diceBox?.dispose(),
      () => renderer?.dispose(),
      () => physics?.terminate(),
    ]) {
      try {
        release();
      } catch {
        // best effort: keep releasing the rest
      }
    }
    warn('dicer: 3D dice are disabled (startup failed); chat rolls are shown without them', err);
    return null;
  }
}

/**
 * Fires diceSoNiceInit then diceSoNiceReady with `api` once `apiReady` (globalThis.DicerAPIReady)
 * has settled, so `game.dice3d.DiceSystem` is set inside both hooks. A missing or rejected
 * promise still fires them; nothing here rejects or throws. Not awaited by startup, so a slow
 * api.js never delays the engine.
 */
export async function announceReady({ hooks, api, apiReady }) {
  try {
    await apiReady;
  } catch {
    // DicerAPIReady never rejects; anything else must not stop the hooks
  }
  try {
    hooks.callAll('diceSoNiceInit', api);
    hooks.callAll('diceSoNiceReady', api);
  } catch (err) {
    console.error('dicer: cannot announce game.dice3d', err);
  }
}

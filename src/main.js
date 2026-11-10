import { createPhysicsWorker, PhysicsClient } from './physics/physics-client.js';
import { computeHulls } from './physics/hulls.js';
import { DiceRenderer } from './render/renderer.js';
import { loadDigitAtlas } from './render/sdf-atlas.js';
import { DiceBox } from './throw/dice-box.js';
import { planThrow } from './throw/throw-planner.js';
import { createMessageGate } from './foundry/message-gate.js';
import { dsnIsActive, notifyGmOnce } from './foundry/coexistence.js';
import { measureArea, watchArea } from './foundry/area.js';
import { startEngine } from './foundry/startup.js';
import { createDice3dApi } from './api/dice3d.js';
import { registerNoticeSetting, registerSettings, getSetting } from './settings.js';

/** Plan 1 appearance; Plan 2 replaces it with themes (dispose and recreate the DiceBox then). */
const DEFAULT_APPEARANCE = {
  body: 'opaque',
  bodyColor: '#b3202a',
  fillColor: '#f2f2f2',
  fillMetallic: false,
};

let dormant = false;
let gate = null;
let diceBox = null;
let stopWatchingArea = null;

const NOOP_HANDLERS = { onCreate() {}, onRender() {}, onDelete() {} };
/** Chat hooks are registered at init but stay no-ops until the engine is ready. */
const handlers = () => gate ?? NOOP_HANDLERS;

/** A layer right after #board holding the dice canvas (document.body without a board). */
function createLayer() {
  const layer = document.createElement('div');
  layer.id = 'dicer-layer';
  const board = document.getElementById('board');
  if (board) board.after(layer);
  else document.body.appendChild(layer);
  return layer;
}

function resizeDice() {
  try {
    diceBox?.onResize();
  } catch (err) {
    console.error('dicer: resize failed', err);
  }
}

Hooks.once('init', () => {
  if (dsnIsActive(game)) {
    dormant = true;
    registerNoticeSetting();
    return;
  }
  registerSettings({ onAreaChange: resizeDice });
  Hooks.on('createChatMessage', (message) => handlers().onCreate(message));
  Hooks.on('renderChatMessageHTML', (message, html) => handlers().onRender(message, html));
  Hooks.on('deleteChatMessage', (message) => handlers().onDelete(message));
});

Hooks.once('ready', async () => {
  if (dormant) {
    try {
      await notifyGmOnce(game, ui);
    } catch (err) {
      console.error('dicer: cannot show the Dice So Nice notice', err);
    }
    return;
  }
  let api = null;
  const started = await startEngine({
    // loadDigitAtlas appends /digits.json and /digits.png to this folder.
    loadAtlas: () => loadDigitAtlas(foundry.utils.getRoute('modules/dicer/assets/fonts')),
    // No initial area: DiceBox sends the real one through resize() on construction.
    createPhysics: () => new PhysicsClient(createPhysicsWorker, { hulls: computeHulls() }),
    createRenderer: () =>
      new DiceRenderer({
        container: createLayer(),
        pixelRatioCap: Number(getSetting('pixelRatioCap')) || 1.5,
      }),
    createDiceBox: ({ atlas, physics, renderer }) =>
      new DiceBox({
        renderer,
        physics,
        atlas,
        appearance: DEFAULT_APPEARANCE,
        getArea: () => measureArea(),
        diceScale: () => Number(getSetting('diceScale')) || 1,
        timeBeforeHide: () => Number(getSetting('timeBeforeHide')) || 0,
      }),
    activate: ({ renderer, diceBox: box }) => {
      diceBox = box;
      gate = createMessageGate({ diceBox: box, planThrow, hooks: Hooks, getSetting });
      api = createDice3dApi({ diceBox: box, gate, planThrow, getSetting, renderer });
      game.dice3d = api;
      // The sidebar is observed directly: v14 fires collapseSidebar mid-transition.
      stopWatchingArea = watchArea(resizeDice);
      Hooks.callAll('diceSoNiceInit', game.dice3d);
      Hooks.callAll('diceSoNiceReady', game.dice3d);
    },
  });
  if (!started) {
    gate = null;
    diceBox = null;
    stopWatchingArea?.();
    stopWatchingArea = null;
    if (api && game.dice3d === api) delete game.dice3d;
  }
});

import { createPhysicsWorker, PhysicsClient } from './physics/physics-client.js';
import { computeHulls } from './physics/hulls.js';
import { DiceRenderer } from './render/renderer.js';
import { loadDigitAtlas } from './render/sdf-atlas.js';
import { DiceBox } from './throw/dice-box.js';
import { planThrow } from './throw/throw-planner.js';
import { createMessageGate } from './foundry/message-gate.js';
import { dsnIsActive, notifyGmOnce } from './foundry/coexistence.js';
import { createDice3dApi } from './api/dice3d.js';
import { registerNoticeSetting, registerSettings, getSetting } from './settings.js';

/** Plan 1 appearance; Plan 2 replaces it with themes (dispose and recreate the DiceBox then). */
const DEFAULT_APPEARANCE = {
  body: 'opaque',
  bodyColor: '#b3202a',
  fillColor: '#f2f2f2',
  fillMetallic: false,
};
const RESIZE_DEBOUNCE_MS = 150;

let dormant = false;
let gate = null;
let diceBox = null;

const NOOP_HANDLERS = { onCreate() {}, onRender() {}, onDelete() {} };
/** Chat hooks are registered at init but stay no-ops until the engine is ready. */
const handlers = () => gate ?? NOOP_HANDLERS;

/** The play area: the window minus the sidebar (0 when collapsed or missing). */
function getArea() {
  const sidebar = document.getElementById('sidebar');
  const collapsed = globalThis.ui?.sidebar?.expanded === false;
  const sidebarWidth = sidebar && !collapsed ? sidebar.getBoundingClientRect().width : 0;
  return {
    left: 0,
    top: 0,
    width: Math.max(1, window.innerWidth - sidebarWidth),
    height: window.innerHeight,
  };
}

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

function debounce(fn, ms) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
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
  try {
    // loadDigitAtlas appends /digits.json and /digits.png to this folder.
    const atlas = await loadDigitAtlas(foundry.utils.getRoute('modules/dicer/assets/fonts'));
    // No initial area: DiceBox sends the real one through resize() on construction.
    const physics = new PhysicsClient(createPhysicsWorker, { hulls: computeHulls() });
    const renderer = new DiceRenderer({
      container: createLayer(),
      pixelRatioCap: Number(getSetting('pixelRatioCap')) || 1.5,
    });
    diceBox = new DiceBox({
      renderer,
      physics,
      atlas,
      appearance: DEFAULT_APPEARANCE,
      getArea,
      diceScale: () => Number(getSetting('diceScale')) || 1,
      timeBeforeHide: () => Number(getSetting('timeBeforeHide')) || 0,
    });
    gate = createMessageGate({ diceBox, planThrow, hooks: Hooks, getSetting });
    game.dice3d = createDice3dApi({ diceBox, gate, planThrow, getSetting, renderer });

    window.addEventListener('resize', debounce(resizeDice, RESIZE_DEBOUNCE_MS));
    Hooks.on('collapseSidebar', resizeDice);

    Hooks.callAll('diceSoNiceInit', game.dice3d);
    Hooks.callAll('diceSoNiceReady', game.dice3d);
  } catch (err) {
    gate = null;
    console.error('dicer: failed to start; chat rolls are shown without 3D dice', err);
  }
});

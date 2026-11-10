import { createPhysicsWorker, PhysicsClient } from './physics/physics-client.js';
import { computeHulls } from './physics/hulls.js';
import { DiceRenderer } from './render/renderer.js';
import { loadDigitAtlas } from './render/sdf-atlas.js';
import { createQualityController } from './render/quality-controller.js';
import { DiceBox } from './throw/dice-box.js';
import { planThrow } from './throw/throw-planner.js';
import { createMessageGate } from './foundry/message-gate.js';
import { dsnIsActive, notifyGmOnce } from './foundry/coexistence.js';
import { measureArea, watchArea } from './foundry/area.js';
import { startEngine } from './foundry/startup.js';
import { createDice3dApi } from './api/dice3d.js';
import { DEFAULT_APPEARANCE } from './look/appearance.js';
import { LOOKS } from './look/looks.js';
import { registerNoticeSetting, registerSettings, getSetting } from './settings.js';

let dormant = false;
let gate = null;
let diceBox = null;
let diceRenderer = null;
let quality = null;
let stopWatchingArea = null;
let warming = null;
let warmAgain = false;

const NOOP_HANDLERS = { onCreate() {}, onRender() {}, onDelete() {} };
/** Chat hooks are registered at init but stay no-ops until the engine is ready. */
const handlers = () => gate ?? NOOP_HANDLERS;

/** The chosen look; an unknown id (e.g. a removed look) falls back to the default. */
const getAppearance = () => LOOKS[getSetting('look')]?.appearance ?? DEFAULT_APPEARANCE;

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

/**
 * Compiles the current look's materials (one per die type, current tier) without starting the
 * render loop. Calls made while one runs are coalesced into one more pass afterwards.
 */
function warmUp() {
  if (warming) {
    warmAgain = true;
    return warming;
  }
  warming = (async () => {
    do {
      warmAgain = false;
      const box = diceBox;
      const renderer = diceRenderer;
      if (!box || !renderer) return;
      const warm = box.acquireWarmup();
      try {
        await renderer.warmup(warm.materials, warm.geometry);
        quality?.warmedUp(); // P2-R10: fresh adaptive window once the new programs exist
      } catch (err) {
        console.warn('dicer: material warm-up failed', err);
      } finally {
        warm.release();
      }
    } while (warmAgain);
  })().finally(() => {
    warming = null;
  });
  return warming;
}

/**
 * The look, a feature flag or the tier changed: new rolls get rebuilt materials, rolls in
 * flight keep theirs (unless a shader failed: then they move onto the rebuilt ones too).
 */
function refreshMaterials({ replaceInFlight = false } = {}) {
  if (!diceBox) return;
  try {
    diceBox.invalidateMaterials({ replaceInFlight });
  } catch (err) {
    console.error('dicer: cannot rebuild dice materials', err);
  }
  warmUp();
}

function onLookChange(key) {
  if (key === 'shadows') return; // read when each roll is revealed; no material depends on it
  refreshMaterials();
}

/** quality (client) or qualityCap (world; its onChange fires on every client). */
function onQualityChange() {
  quality?.refresh(); // emits onChange (-> refreshMaterials) only if the tier changed
}

Hooks.once('init', () => {
  if (dsnIsActive(game)) {
    dormant = true;
    registerNoticeSetting();
    return;
  }
  registerSettings({ onAreaChange: resizeDice, onLookChange, onQualityChange });
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
    createDiceBox: ({ atlas, physics, renderer }) => {
      // Applies the medium tier now and starts the (cached) probe; rolls never wait for it.
      quality = createQualityController({
        renderer,
        getSetting,
        atlas,
        notify: (message) => ui.notifications?.info(message),
        localize: (key) => game.i18n.localize(key),
      });
      return new DiceBox({
        renderer,
        physics,
        atlas,
        getAppearance,
        getFlags: () => quality.flags(),
        shadows: () => getSetting('shadows') !== false,
        getArea: () => measureArea(),
        diceScale: () => Number(getSetting('diceScale')) || 1,
        timeBeforeHide: () => Number(getSetting('timeBeforeHide')) || 0,
      });
    },
    activate: ({ renderer, diceBox: box }) => {
      diceBox = box;
      diceRenderer = renderer;
      gate = createMessageGate({ diceBox: box, planThrow, hooks: Hooks, getSetting });
      api = createDice3dApi({ diceBox: box, gate, planThrow, getSetting, renderer });
      game.dice3d = api;
      // The sidebar is observed directly: v14 fires collapseSidebar mid-transition.
      stopWatchingArea = watchArea(resizeDice);
      quality.onChange((event) => refreshMaterials({ replaceInFlight: event.reason === 'shader' }));
      // Once the probe has picked the tier: rebuild for it and compile ahead of the first roll.
      // Not awaited, so the probe never delays readiness; no render loop starts.
      quality.ready
        .then(() => refreshMaterials())
        .catch((err) => console.warn('dicer: quality setup failed', err));
      Hooks.callAll('diceSoNiceInit', game.dice3d);
      Hooks.callAll('diceSoNiceReady', game.dice3d);
    },
  });
  if (!started) {
    quality?.dispose();
    quality = null;
    gate = null;
    diceBox = null;
    diceRenderer = null;
    stopWatchingArea?.();
    stopWatchingArea = null;
    if (api && game.dice3d === api) delete game.dice3d;
  }
});

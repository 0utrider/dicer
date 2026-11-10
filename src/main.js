import { createPhysicsWorker, PhysicsClient } from './physics/physics-client.js';
import { computeHulls } from './physics/hulls.js';
import { DiceRenderer } from './render/renderer.js';
import { loadDigitAtlas } from './render/sdf-atlas.js';
import { createQualityController } from './render/quality-controller.js';
import { createWarmup } from './render/warmup.js';
import { DiceBox } from './throw/dice-box.js';
import { planThrow } from './throw/throw-planner.js';
import { createMessageGate } from './foundry/message-gate.js';
import { dsnIsActive, notifyGmOnce } from './foundry/coexistence.js';
import { measureArea, watchArea } from './foundry/area.js';
import { startEngine } from './foundry/startup.js';
import { createDice3dApi } from './api/dice3d.js';
import { createRegistry } from './compat/registry.js';
import { createLookResolver } from './compat/resolve-looks.js';
import { facesFor, atlasGlyphTest } from './compat/faces.js';
import { createFaceTextures, FACE_FONT_FAMILY } from './render/face-textures.js';
import { mirrorLookSetting, mirrorLookIfMissing } from './compat/user-looks.js';
import { DEFAULT_APPEARANCE } from './look/appearance.js';
import { LOOKS } from './look/looks.js';
import { registerNoticeSetting, registerSettings, getSetting } from './settings.js';

let dormant = false;
let gate = null;
let diceBox = null;
let diceRenderer = null;
let quality = null;
let stopWatchingArea = null;
let digitAtlas = null;
let registry = null; // the DSN registry, once activate() made it

const NOOP_HANDLERS = { onCreate() {}, onUpdate() {}, onRender() {}, onDelete() {} };
/** Chat hooks are registered at init but stay no-ops until the engine is ready. */
const handlers = () => gate ?? NOOP_HANDLERS;

/** The chosen look; an unknown id (e.g. a removed look) falls back to the default. */
const getAppearance = () => LOOKS[getSetting('look')]?.appearance ?? DEFAULT_APPEARANCE;

/** A module-relative or absolute URL as the browser can fetch it. */
const routeOf = (url) =>
  /^([a-z][a-z0-9+.-]*:|\/)/i.test(url) ? url : foundry.utils.getRoute(url);

/** Makes the bundled DM Serif Display available to canvas text (text die faces). */
async function loadFaceFont() {
  const url = routeOf('modules/dicer/assets/fonts/DMSerifDisplay-Regular.woff');
  const face = new FontFace(FACE_FONT_FAMILY, `url("${url}")`);
  document.fonts.add(await face.load());
}

/** Image die faces load through Foundry's route (module paths are relative). */
function loadFaceImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${url}`));
    img.src = routeOf(url);
  });
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

/**
 * Compiles the current look's materials (one per die type, current tier) without starting the
 * render loop; calls made while one runs coalesce. A context loss or a 10 s timeout rejects
 * the compile, so the pass still releases its materials and later warm-ups still run.
 */
const warmUp = createWarmup({
  getBox: () => diceBox,
  getRenderer: () => diceRenderer,
  onWarmed: () => quality?.warmedUp(), // P2-R10: fresh adaptive window once the new programs exist
});

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

/** Publishes the chosen look in the user flag so other clients draw this user's dice with it. */
function mirrorLook(lookId) {
  mirrorLookSetting(game.user, lookId).catch((err) =>
    console.warn('dicer: cannot mirror the look setting to the user flag', err),
  );
}

function onLookChange(key, value) {
  if (key === 'look') mirrorLook(value);
  // Read per roll; no cached material depends on them.
  if (key === 'shadows' || key === 'presetFaces' || key === 'presetModels') return;
  refreshMaterials();
}

/**
 * quality (client) or qualityCap (world; its onChange fires on every client). A quality pick
 * clears the session's adaptive ceiling; a cap change keeps it (P2-R11).
 */
function onQualityChange(key) {
  quality?.refresh(key); // emits onChange (-> refreshMaterials) only if the tier changed
}

Hooks.once('init', () => {
  if (dsnIsActive(game)) {
    dormant = true;
    registerNoticeSetting();
    return;
  }
  registerSettings({ onAreaChange: resizeDice, onLookChange, onQualityChange });
  Hooks.on('createChatMessage', (message) => handlers().onCreate(message));
  Hooks.on('updateChatMessage', (message, changes) => handlers().onUpdate(message, changes));
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
  mirrorLookIfMissing(game.user, getSetting('look')).catch((err) =>
    console.warn('dicer: cannot mirror the look setting to the user flag', err),
  );
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
      digitAtlas = atlas;
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
        faceTextures: createFaceTextures({ loadImage: loadFaceImage, loadFont: loadFaceFont }),
        faceLayers: () => getSetting('presetFaces') !== false,
        modelPresets: () => getSetting('presetModels') !== false,
        onModelLoaded: (url) => registry?.noteModelLoaded(url),
      });
    },
    activate: ({ renderer, diceBox: box }) => {
      diceBox = box;
      diceRenderer = renderer;
      // Each die resolves its look from its roll's options and its roller's flag; custom die
      // types are shaped through the registry.
      // Model urls go through the same routeOf as face images: one url policy.
      registry = createRegistry({ hooks: Hooks, routeUrl: routeOf });
      const resolver = createLookResolver({
        registry,
        getUser: (id) => game.users?.get(id),
        getActor: (id) => game.actors?.get(id),
        // Preset faces the digit atlas cannot draw become image / text face layers.
        facesFor: (preset) => facesFor(preset, atlasGlyphTest(digitAtlas)),
      });
      const plan = (roll, opts) => planThrow(roll, { shapeFor: resolver.shapeFor, ...opts });
      const decorateFor = (message, roll, authorId) =>
        resolver.decorate(message, roll, authorId ?? message?.author?.id);
      gate = createMessageGate({
        diceBox: box,
        planThrow: plan,
        decorateFor,
        hooks: Hooks,
        getSetting,
      });
      api = createDice3dApi({
        diceBox: box,
        gate,
        planThrow: plan,
        decorateFor,
        getSetting,
        renderer,
      });
      game.dice3d = api;
      // The sidebar is observed directly: v14 fires collapseSidebar mid-transition.
      stopWatchingArea = watchArea(resizeDice);
      // 'shader': the low fallback or the P2-R12 safe flags; dice in flight move over too.
      quality.onChange((event) => refreshMaterials({ replaceInFlight: event.reason === 'shader' }));
      // three rebuilds every program lazily on a restored context: compile them ahead again.
      renderer.onContextRestored(() => warmUp());
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
    registry = null;
    stopWatchingArea?.();
    stopWatchingArea = null;
    if (api && game.dice3d === api) delete game.dice3d;
  }
});

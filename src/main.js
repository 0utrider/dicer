import { dropCoreDiceSound } from './foundry/core-dice-sound.js';
import { createPhysicsWorker, PhysicsClient } from './physics/physics-client.js';
import { computeHulls } from './physics/hulls.js';
import { DiceRenderer } from './render/renderer.js';
import { loadDigitAtlas } from './render/sdf-atlas.js';
import { createFontAtlases, createFontWorker } from './fonts/font-atlas.js';
import { createQualityController } from './render/quality-controller.js';
import { createWarmup } from './render/warmup.js';
import { DiceBox } from './throw/dice-box.js';
import { planThrow } from './throw/throw-planner.js';
import { createMessageGate } from './foundry/message-gate.js';
import { createInitiativeHider } from './compat/initiative.js';
import { registerChatCommands } from './compat/chat-commands.js';
import { dsnIsActive, notifyGmOnce } from './foundry/coexistence.js';
import { measureArea, watchArea } from './foundry/area.js';
import { createAreaResolver } from './areas/area-resolver.js';
import { emitRollAreasChanged } from './areas/area-store.js';
import { startEngine, announceReady } from './foundry/startup.js';
import { createDice3dApi, createDebugCounters, materialReadyNotifier } from './api/dice3d.js';
import { createRegistry } from './compat/registry.js';
import { createLookResolver } from './compat/resolve-looks.js';
import { facesFor, atlasGlyphTest } from './compat/faces.js';
import { createFaceTextures, FACE_FONT_FAMILY } from './render/face-textures.js';
import { mirrorLookSetting, mirrorLookIfMissing } from './compat/user-looks.js';
import { DEFAULT_APPEARANCE } from './look/appearance.js';
import { findTheme, readThemeList } from './themes/themes.js';
import { createSoundEngine } from './audio/sound-engine.js';
import {
  createFxResolver,
  composeDecorateFor,
  createLandedFx,
  moduleRulesOf,
} from './effects/fx-resolver.js';
import { createDamageThemer } from './effects/damage-themes.js';
import { createEffectLayer } from './effects/effect-layer.js';
import { createDsnSfx } from './effects/dsn-sfx.js';
import { registerNoticeSetting, registerSettings, getSetting, migrateLookSetting } from './settings.js';

let dormant = false;
let gate = null;
let initiative = null; // hides rolled initiative in the combat tracker while its dice fly
let diceBox = null;
let diceRenderer = null;
let quality = null;
let stopWatchingArea = null;
let digitAtlas = null;
let fontAtlases = null; // the font layer: the atlas of each look's numbers.font
let registry = null; // the DSN registry, once activate() made it
let faceTextures = null; // shared by DiceBox and preloadPresets (one cache)
let dice3d = null; // game.dice3d, once activate() made it
let soundEngine = null; // impact and result sounds; its synth is a lazy chunk
let effectLayer = null; // trigger effects; its library is a lazy chunk

/** The table surface the dice sound on: the client's override unless it is 'world'. */
export function soundSurface(get) {
  const own = get('soundSurfaceOverride');
  return own && own !== 'world' ? own : get('soundSurface') || 'felt';
}

/** game.dice3d._debug.fxPlays / resultSounds: counted where effects start and sounds are requested. */
const debugCounters = createDebugCounters();

/** Result sounds (never awaited) and trigger macros, once per landed die carrying fx. */
const landedFx = createLandedFx({
  playSound: (sound) => soundEngine?.result(sound),
  onSound: debugCounters.countSound,
  fromUuid: (uuid) => globalThis.fromUuid(uuid),
});

/** Renders the sounds in an idle callback (never on a roll's frames). */
function preloadSounds() {
  if (!soundEngine || getSetting('sounds') === false) return;
  const run = () => soundEngine?.preload();
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
  else setTimeout(run, 200);
}

/** Fetches the effects library in an idle callback, so it is in before the first effect. */
function preloadEffects() {
  if (!effectLayer || getSetting('effects') === false) return;
  const run = () => effectLayer?.prefetch();
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
  else setTimeout(run, 200);
}

/** Fetches the editor chunks (triggers, damage map, roll areas, themes, appearance) in an idle callback (they are small), so opening one is instant. */
export function preloadEditors(
  loaders = [() => import('./ui/trigger-editor.js'), () => import('./ui/damage-map-editor.js'), () => import('./ui/area-editor.js'), () => import('./ui/theme-browser.js'), () => import('./ui/appearance-editor.js')],
) {
  const run = () => {
    for (const load of loaders) {
      try {
        Promise.resolve(load()).catch(() => {}); // a failed prefetch only means a later cold open
      } catch {
        /* same */
      }
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
  else setTimeout(run, 200);
}

function onSoundChange(key, value) {
  if (key === 'sounds' && value) preloadSounds();
}

const NOOP_HANDLERS = { onCreate() {}, onUpdate() {}, onRender() {}, onDelete() {} };
/** Chat hooks are registered at init but stay no-ops until the engine is ready. */
const handlers = () => gate ?? NOOP_HANDLERS;

/**
 * The chosen theme's look (DiceBox's fallback and the warm-up); an unknown id (e.g. a removed
 * theme) falls back to the default.
 */
export const getAppearance = () => {
  const quiet = () => {};
  const themes = {
    worldThemes: readThemeList(getSetting('worldThemes'), 'world', quiet),
    userThemes: readThemeList(game.user?.getFlag?.('dicer', 'themes'), 'user', quiet),
  };
  return findTheme(getSetting('theme'), themes)?.appearance ?? DEFAULT_APPEARANCE;
};

/** A module-relative or absolute URL as the browser can fetch it. */
const routeOf = (url) =>
  /^([a-z][a-z0-9+.-]*:|\/)/i.test(url) ? url : foundry.utils.getRoute(url);

/**
 * The public api.js (DiceSystem, DiceSFX, DiceMap) ships beside module.json, outside the
 * bundle: it is imported at runtime from its route (the path is computed so Vite leaves the
 * import alone) and exposed as globalThis.DicerAPI, which is set asynchronously during init.
 * globalThis.DicerAPIReady is a promise of the module (null if the load failed); it never
 * rejects. Integrations should prefer importing `modules/dicer/api.js` directly (e.g.
 * `import { DiceSystem } from '/modules/dicer/api.js'`): it needs neither global.
 */
function loadPublicApi() {
  globalThis.DicerAPIReady = (async () => {
    try {
      const url = foundry.utils.getRoute(['modules', 'dicer', 'api.js'].join('/'));
      const api = await import(/* @vite-ignore */ url);
      globalThis.DicerAPI = api;
      return api;
    } catch (err) {
      console.warn('dicer: cannot load api.js; DiceSystem and DiceSFX are unavailable', err);
      return null;
    }
  })();
}

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

/** The raw world settings storage (a WorldSettings collection); DSN's scope is not registered. */
const worldStorage = () => game.settings.storage?.get('world') ?? null;

/** The DSN world settings the migration maps or logs (keys as stored in the world settings). */
const DSN_WORLD_KEYS = new Set(
  [
    'maxDiceNumber',
    'immediatelyDisplayChatMessages',
    'showGhostDice',
    'hideNpcRolls',
    'diceCanBeFlipped',
  ].map((k) => `dice-so-nice.${k}`),
);

/** Which DSN data is still to be migrated, judged from raw data only (no chunk is loaded). */
function dsnPending() {
  if (getSetting('migrateFromDsn') === false) return { user: false, world: false };
  const dsnAppearance = game.user?._source?.flags?.['dice-so-nice']?.appearance;
  const user =
    dsnAppearance !== null &&
    typeof dsnAppearance === 'object' &&
    !Array.isArray(dsnAppearance) &&
    Object.keys(dsnAppearance).length > 0 &&
    !game.user.getFlag('dicer', 'migratedFromDsn');
  let world = false;
  if (game.user?.isGM && !getSetting('dsnWorldMigrated')) {
    for (const setting of worldStorage() ?? []) {
      if (DSN_WORLD_KEYS.has(setting?.key)) {
        world = true;
        break;
      }
    }
  }
  return { user, world };
}

/**
 * Copies Dice So Nice data into Dicer (once). The migration code is a lazy chunk, loaded only
 * when there is DSN data. Never rejects, never delays the engine; the look mirror waits for it
 * so a mirrored default does not pre-empt the user's imported global look.
 */
async function migrateFromDsn() {
  try {
    const pending = dsnPending();
    if (!pending.user && !pending.world) return;
    const migration = await import('./compat/migration.js');
    const done = await migration.runMigration({
      user: game.user,
      isGM: pending.world,
      worldSettings: migration.worldSettingsReader(worldStorage()),
      settings: game.settings,
    });
    if (done) ui.notifications?.info(game.i18n.localize('DICER.Notice.Migrated'));
  } catch (err) {
    console.warn('dicer: cannot migrate Dice So Nice data', err);
  }
}

/** Publishes the chosen theme in the user flag so other clients draw this user's dice with it. */
function mirrorLook(themeId) {
  mirrorLookSetting(game.user, themeId).catch((err) =>
    console.warn('dicer: cannot mirror the theme setting to the user flag', err),
  );
}

/** Preset face sets the digit atlas cannot draw, as image / text face layers. */
const presetFaces = (preset) => facesFor(preset, atlasGlyphTest(digitAtlas));

function onLookChange(key, value) {
  if (key === 'theme') {
    mirrorLook(value);
    dice3d?._releasePreloads(); // preloadPresets holds faces until the theme changes
  }
  if (key === 'effects' && value) preloadEffects();
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

/** Opens Foundry's settings on the Dicer tab (Dicer's own dialog is Plan 7). */
function openDicerSettings() {
  const SettingsConfig = foundry.applications.settings.SettingsConfig;
  new SettingsConfig({ initialCategory: 'dicer' }).render({ force: true });
}

// /dice3d, /d3d and /dsn through the chat-commands module (absent: nothing to register).
// Registered at module load, not in init: the hook may fire before Dicer's init runs, so
// dormancy is checked here, from game.modules too in case init has not set it yet.
Hooks.on('chatCommandsReady', (commands) => {
  if (dormant || dsnIsActive(game)) return;
  registerChatCommands(commands, {
    openSettings: openDicerSettings,
    description: game.i18n.localize('DICER.Commands.Description'),
  });
});

Hooks.once('init', () => {
  if (dsnIsActive(game)) {
    dormant = true;
    registerNoticeSetting();
    return;
  }
  registerSettings({
    onAreaChange: resizeDice,
    onRollAreasChange: () => emitRollAreasChanged(Hooks, getSetting),
    onLookChange,
    onQualityChange,
    onSoundChange,
  });
  loadPublicApi();
  // On the author's client, before the message is stored: everyone then skips Foundry's clatter.
  Hooks.on('preCreateChatMessage', (message) =>
    dropCoreDiceSound(message, {
      enabled: getSetting('muteCoreDiceSound') !== false,
      coreSound: globalThis.CONFIG?.sounds?.dice,
    }),
  );
  Hooks.on('createChatMessage', (message) => {
    handlers().onCreate(message); // first: the hider reads gate.isAnimating
    initiative?.onCreateMessage(message);
  });
  Hooks.on('renderCombatTracker', (app, html) => initiative?.onRenderTracker(app, html));
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
  // The old client `look` setting moves to `theme` once (its onChange mirrors and refreshes).
  const lookMigrated = migrateLookSetting({
    get: getSetting,
    set: (key, value) => game.settings.set('dicer', key, value),
  }).catch((err) => console.warn('dicer: cannot move the look setting to theme', err));
  Promise.all([migrateFromDsn(), lookMigrated])
    .then(() => mirrorLookIfMissing(game.user, getSetting('theme')))
    .catch((err) => console.warn('dicer: cannot mirror the theme setting to the user flag', err));
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
      fontAtlases?.dispose();
      // serif is the atlas above; sans and runtime fonts load only when a look uses them
      fontAtlases = createFontAtlases({
        serif: atlas,
        loadBundled: (name) =>
          loadDigitAtlas(foundry.utils.getRoute('modules/dicer/assets/fonts'), `digits-${name}`),
        createWorker: createFontWorker,
        getRoute: (path) => foundry.utils.getRoute(path),
      });
      // Applies the medium tier now and starts the (cached) probe; rolls never wait for it.
      quality = createQualityController({
        renderer,
        getSetting,
        atlas,
        notify: (message) => ui.notifications?.info(message),
        localize: (key) => game.i18n.localize(key),
      });
      faceTextures = createFaceTextures({ loadImage: loadFaceImage, loadFont: loadFaceFont });
      soundEngine?.dispose();
      soundEngine = createSoundEngine({ getSetting: (k) => getSetting(k), resolveUrl: routeOf });
      let box = null;
      effectLayer?.dispose();
      effectLayer = createEffectLayer({
        scene: renderer.scene,
        camera: renderer.camera,
        canvas: renderer.canvas, // screen shake moves the dice canvas only
        getTier: () => quality.config,
        getSetting,
        onPlay: debugCounters.countFx,
        isSafe: () => quality.flags().safe === true,
        isolate: (die) => box?.isolate(die) ?? null,
        // Dice So Nice special effects: `registry` is made later (activate), so read it lazily.
        dsnSfx: createDsnSfx({
          registry: {
            get sfxModes() {
              return registry?.sfxModes;
            },
          },
          getBox: () => ({
            scene: renderer.scene,
            camera: renderer.camera,
            glRenderer: renderer.glRenderer,
          }),
        }),
      });
      box = new DiceBox({
        renderer,
        physics,
        atlas,
        getAppearance,
        getFlags: () => quality.flags(),
        shadows: () => getSetting('shadows') !== false,
        getArea: () => measureArea(),
        diceScale: () => Number(getSetting('diceScale')) || 1,
        timeBeforeHide: () => Number(getSetting('timeBeforeHide')) || 0,
        faceTextures,
        faceLayers: () => getSetting('presetFaces') !== false,
        modelPresets: () => getSetting('presetModels') !== false,
        onModelLoaded: (url) => registry?.noteModelLoaded(url),
        presetFor: (system, type) => registry?.presetFor(system, type) ?? null,
        onMaterial: materialReadyNotifier(Hooks),
        // addSystem(DiceSystem instance): its material callbacks and dice events (api.js).
        systemFor: (id) => registry?.systems.get(id)?.instance ?? null,
        onImpact: (e) => soundEngine?.impact(e),
        getSurface: () => soundSurface(getSetting),
        onLandedFx: (die, fx, rollKey) => landedFx(die, fx, rollKey),
        effects: effectLayer,
        fonts: fontAtlases,
      });
      return box;
    },
    activate: ({ renderer, diceBox: box }) => {
      diceBox = box;
      diceRenderer = renderer;
      // Each die resolves its look from its roll's options and its roller's flag; custom die
      // types are shaped through the registry.
      // Model urls go through the same routeOf as face images: one url policy.
      registry = createRegistry({ hooks: Hooks, routeUrl: routeOf });
      const userThemes = (id) => game.users?.get(id)?.getFlag?.('dicer', 'themes');
      const damageThemer = createDamageThemer({
        registry,
        getSetting,
        getUserThemes: userThemes,
        getViewerId: () => game.user?.id,
      });
      const resolver = createLookResolver({
        registry,
        getUser: (id) => game.users?.get(id),
        getActor: (id) => game.actors?.get(id),
        damageThemeFor: (roll, userId) => damageThemer.forRoll(roll, userId),
        getWorldThemes: () => getSetting('worldThemes'),
        // Preset faces the digit atlas cannot draw become image / text face layers.
        facesFor: presetFaces,
      });
      const plan = (roll, opts) => planThrow(roll, { shapeFor: resolver.shapeFor, ...opts });
      // Trigger effects ride the same decorator, which the gate and showForRoll call for real
      // views only (ghosts use the ghost decorator, 'none' is not planned): privacy-first.
      const fxResolver = createFxResolver({
        getWorldRules: () => getSetting('worldTriggers'),
        getUserRules: (id) => game.users?.get(id)?.getFlag?.('dicer', 'triggers'),
        getModuleRules: moduleRulesOf(registry),
        getDisabledModuleRules: () => getSetting('disabledModuleTriggers'),
        currentUser: () => game.user,
        getSetting,
        shapeFor: resolver.shapeFor,
        getKnownDamageTypes: damageThemer.knownTypes,
        // The roller's id, so a theme named in the damage map resolves here as on the look path.
        damageThemeFor: (roll, rollerId) => damageThemer.forRoll(roll, rollerId),
        getWorldThemes: () => getSetting('worldThemes'),
        getUserThemes: userThemes,
      });
      // (message, roll, authorId?, rollerId?): looks from the author, rules from the roller.
      const decorateFor = composeDecorateFor({ looks: resolver, fx: fxResolver });
      // Which area each throw lands in on this screen (the roller's; the GM private corner).
      const areas = createAreaResolver({ getSetting, measureUsable: () => measureArea(), currentUser: () => game.user });
      gate = createMessageGate({
        diceBox: box,
        planThrow: plan,
        decorateFor,
        hooks: Hooks,
        getSetting,
        areaFor: areas.rectFor,
      });
      initiative = createInitiativeHider({
        gate,
        getCombat: () => game.combat ?? null,
        documentRef: document,
        enabled: () => getSetting('hideInitiative') !== false,
      });
      api = createDice3dApi({
        diceBox: box,
        gate,
        planThrow: plan,
        decorateFor,
        getSetting,
        renderer,
        hooks: Hooks,
        // showForRoll's synchronize: the module socket ("socket": true in module.json).
        socket: game.socket ?? null,
        currentUser: () => game.user,
        fromData: (data) => foundry.dice.Roll.fromData(data),
        registry,
        faceTextures,
        facesFor: presetFaces,
        getArea: () => measureArea(),
        areaFor: areas.rectFor,
        debugCounters,
        getAtlas: () => digitAtlas,
        getFonts: () => fontAtlases,
      });
      dice3d = api;
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
    },
  });
  if (!started) {
    quality?.dispose();
    quality = null;
    gate = null;
    initiative = null;
    diceBox = null;
    diceRenderer = null;
    registry = null;
    faceTextures = null;
    dice3d = null;
    soundEngine?.dispose();
    soundEngine = null;
    effectLayer?.dispose();
    effectLayer = null;
    stopWatchingArea?.();
    stopWatchingArea = null;
    api?._dispose();
    if (api && game.dice3d === api) delete game.dice3d;
    return;
  }
  // After api.js has loaded, so game.dice3d.DiceSystem is set inside both hooks. Not awaited:
  // the engine is already up, and announceReady never rejects.
  announceReady({ hooks: Hooks, api, apiReady: globalThis.DicerAPIReady });
  preloadSounds();
  preloadEffects();
  preloadEditors();
});

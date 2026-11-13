import { dropCoreDiceSound } from './foundry/core-dice-sound.js';
import { createPhysicsWorker, PhysicsClient } from './physics/physics-client.js';
import { computeHulls } from './physics/hulls.js';
import { DiceRenderer } from './render/renderer.js';
import { loadDigitAtlas } from './render/sdf-atlas.js';
import { onLookExtrasReady } from './render/extras-loader.js';
import { getPets, requestPets, releasePets } from './pet/pet-loader.js';
import { loadHand, prefetchHand, handNow } from './hand/hand-loader.js';
import { createHandGate, markCard } from './hand/gate-hand.js';
import { registerHandMethod, setHandDeps, syncDiceConfiguration, handAllowed } from './hand/shell.js';
import { createFontAtlases, createFontWorker } from './fonts/font-atlas.js';
import { createQualityController } from './render/quality-controller.js';
import { createWarmup, createAppearanceRewarm } from './render/warmup.js';
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
import {
  mirrorLookSetting,
  mirrorLookIfMissing,
  shouldMirror,
  ownDefaultRefs,
  lookRefToAppearance,
} from './compat/user-looks.js';
import { DEFAULT_APPEARANCE } from './look/appearance.js';
import { readThemeList } from './themes/themes.js';
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
import { registerNoticeSetting, registerSettings, getSetting, migrateLookSetting, migratePetStay, resetControls } from './settings.js';

let dormant = false;
let gate = null;
let initiative = null; // hides rolled initiative in the combat tracker while its dice fly
let diceBox = null;
let diceRenderer = null;
let quality = null;
let stopWatchingArea = null;
let stopLookExtras = null;
let digitAtlas = null;
let fontAtlases = null; // the font layer: the atlas of each look's numbers.font
let registry = null; // the DSN registry, once activate() made it
let faceTextures = null; // shared by DiceBox and preloadPresets (one cache)
let dice3d = null; // game.dice3d, once activate() made it
let soundEngine = null; // impact and result sounds; its synth is a lazy chunk
let effectLayer = null; // trigger effects; its library is a lazy chunk
let petDeps = null; // what the lazy pet chunk's layer is made from

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

/** Runs `run` in an idle callback (a 200 ms timer where there is none). */
const idle = (run) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(run) : setTimeout(run, 200));

/** Renders the sounds in an idle callback (never on a roll's frames). */
function preloadSounds() {
  if (!soundEngine || getSetting('sounds') === false) return;
  const run = () => soundEngine?.preload();
  idle(run);
}

/** Fetches the effects library in an idle callback, so it is in before the first effect. */
function preloadEffects() {
  if (!effectLayer || getSetting('effects') === false) return;
  const run = () => effectLayer?.prefetch();
  idle(run);
}

/** Fetches the pet chunk in an idle callback, only when pets are allowed and shown. */
function preloadPets() {
  if (!petDeps || getSetting('petsAllowed') === false || getSetting('showPets') === false) return;
  const run = () => petDeps && requestPets(petDeps);
  idle(run);
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
  idle(run);
}

/** The core client setting Foundry's dice fulfillment reads (Roll.DICE_CONFIGURATION_SETTING). */
const getCore = () => game.settings.get('core', 'diceConfiguration');

/** Rolling by hand: maps this user's dice to the `dicer` method, or removes Dicer's entries (ready, settings). */
function syncHand() {
  try {
    Promise.resolve(
      syncDiceConfiguration({
        getSetting,
        user: game.user,
        getCore,
        setCore: (v) => game.settings.set('core', 'diceConfiguration', v),
        setSetting: (k, v) => game.settings.set('dicer', k, v), // a failure skips setCore (warned below)
      }),
    ).catch((err) => console.warn('dicer: cannot update the dice configuration', err));
  } catch (err) {
    console.warn('dicer: cannot update the dice configuration', err);
  }
}

function onSoundChange(key, value) {
  if (key === 'sounds' && value) preloadSounds();
}

const NOOP_HANDLERS = { onCreate() {}, onUpdate() {}, onRender() {}, onDelete() {} };
/** Chat hooks are registered at init but stay no-ops until the engine is ready. */
const handlers = () => gate ?? NOOP_HANDLERS;
/**
 * Task 8 (P6-D2): this user's hand throws of `m` go to the users allowed to see them, under the
 * gate's RollStart outcome (none known: GMs only). A throw is stored only where the chunk loaded.
 */
const sendHand = (m) =>
  handNow()?.sendHand(m, { start: gate?.startOf(m.id), pending: gate?.isAnimating(m.id) });

/**
 * This user's own default look (DiceBox's fallback and the warm-up), by the resolver's chain:
 * the world default under the lock, else the stored global choice (a GM push included), the
 * world default, then the client `theme` setting. An unknown id (e.g. a removed theme) is
 * skipped; nothing usable gives the default.
 */
export const getAppearance = () => {
  const quiet = () => {};
  const themes = {
    worldThemes: readThemeList(getSetting('worldThemes'), 'world', quiet),
    userThemes: readThemeList(game.user?.getFlag?.('dicer', 'themes'), 'user', quiet),
  };
  const refs = ownDefaultRefs(game.user, {
    theme: getSetting('theme'),
    worldDefaultTheme: getSetting('worldDefaultTheme'),
    lock: getSetting('lockPlayerLooks'),
  });
  for (const ref of refs) {
    const got = lookRefToAppearance(ref, registry, 0, { themes });
    if (got) return got.appearance;
  }
  return DEFAULT_APPEARANCE;
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
  appearanceRewarm.markWarmed();
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
  if (!shouldMirror(game.user, themeId)) return; // "My default" Clear: stays never-chose (P7-R5)
  mirrorLookSetting(game.user, themeId).catch((err) =>
    console.warn('dicer: cannot mirror the theme setting to the user flag', err),
  );
}

/** Preset face sets the digit atlas cannot draw, as image / text face layers. */
const presetFaces = (preset) => facesFor(preset, atlasGlyphTest(digitAtlas));

/**
 * M-2: a GM push (the user's appearance flag) or a change of the world default / lock changes
 * what getAppearance resolves to, so the materials and warm-up are redone, debounced to 500 ms.
 */
const appearanceRewarm = createAppearanceRewarm({
  rewarm: () => refreshMaterials(),
  getUserId: () => game.user?.id,
  getAppearance: () => getAppearance(),
});
let updateUserHook = null;

function onLookChange(key, value) {
  if (key === 'worldDefaultTheme' || key === 'lockPlayerLooks') {
    appearanceRewarm.onSettingChange();
    return;
  }
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

// "Dice look" on actor sheets the user owns: opens the theme browser (lazy chunk) on that actor.
// ApplicationV2 sheets (v14 core, PF2e's new sheets) use getHeaderControls; legacy v1 sheets (PF2e's
// character sheet today) use getActorSheetHeaderButtons. One shared handler. Module load, like the
// chat commands, so the first render of a sheet already has it.
const DICE_LOOK_LABEL = 'DICER.ThemeBrowser.DiceLook';
const DICE_LOOK_ICON = 'fa-solid fa-dice-d20';

/** The actor of a sheet when the user owns it (GMs own everything); else null. Never while Dicer is dormant. */
function ownedActorOf(app) {
  if (dormant || dsnIsActive(game)) return null;
  if (game.settings?.get?.('dicer', 'diceLookButton') === false) return null; // read at hook time: applies on the next render
  const doc = app?.document ?? app?.actor;
  return doc?.documentName === 'Actor' && doc.isOwner === true && doc.id ? doc : null;
}

function openDiceLook(actor) {
  return import('./ui/theme-browser.js')
    .then((m) => m.openThemeBrowser({ target: `actor:${actor.id}` }))
    .catch((err) => console.warn('dicer: cannot open the theme browser', err));
}

let warnedHeader = false;
/** A header hook must never throw into Foundry's sheet render: warn once and add nothing. */
function guarded(fn) {
  return (app, list) => {
    try {
      fn(app, list);
    } catch (err) {
      if (!warnedHeader) {
        warnedHeader = true;
        console.warn('dicer: cannot add the Dice look control', err);
      }
    }
  };
}

export const addDiceLookControl = guarded((app, controls) => {
  const actor = ownedActorOf(app);
  if (!actor || !Array.isArray(controls) || controls.some((c) => c?.action === 'dicerDiceLook')) return;
  controls.push({
    action: 'dicerDiceLook',
    icon: DICE_LOOK_ICON,
    label: DICE_LOOK_LABEL,
    onClick: () => openDiceLook(actor),
  });
});

export const addDiceLookButton = guarded((app, buttons) => {
  const actor = ownedActorOf(app);
  if (!actor || !Array.isArray(buttons) || buttons.some((b) => b?.class === 'dicer-dice-look')) return;
  buttons.unshift({
    class: 'dicer-dice-look',
    icon: DICE_LOOK_ICON,
    label: DICE_LOOK_LABEL,
    onclick: () => openDiceLook(actor),
  });
});

Hooks.on('getHeaderControlsApplicationV2', addDiceLookControl);
Hooks.on('getActorSheetHeaderButtons', addDiceLookButton);

// Rolling by hand (module load, like the header controls): the card mark (H-15, every viewer) and
// the "Dice tray" tool under the token controls (diceTray on, hand rolls allowed). The tray
// itself is the lazy hand chunk's.
Hooks.on('renderChatMessageHTML', markCard);
Hooks.on('getSceneControlButtons', (c) => {
  try {
    const get = (k) => game.settings.get('dicer', k);
    if (dormant || !c.tokens || !get('diceTray') || !handAllowed(game.user, get)) return;
    c.tokens.tools.dicerTray = {
      name: 'dicerTray',
      order: 99,
      title: 'DICER.Tray.Title',
      icon: 'fa-solid fa-dice',
      button: true,
      onChange: () => loadHand(diceBox).then((m) => m?.openTray()),
    };
  } catch {
    /* settings not registered (Dice So Nice active) */
  }
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
    onPetChange: () => (preloadPets(), diceBox?.wake()), // a held resting pet must see pets hidden
    onPetStayChange: () => diceBox?.wake(),
    onLookChange,
    onQualityChange,
    onSoundChange,
    onHandChange: () => (syncHand(), resetControls()), // and the tray tool
  });
  try {
    registerHandMethod(); // CONFIG.Dice.fulfillment.methods.dicer with the DicerResolver
  } catch (err) {
    console.warn('dicer: cannot register rolling by hand', err);
  }
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
    sendHand(message); // what the gate did not send from its RollStart (not animated here)
  });
  Hooks.on('renderCombatTracker', (app, html) => initiative?.onRenderTracker(app, html));
  updateUserHook = Hooks.on('updateUser', (user, changes) =>
    appearanceRewarm.onUpdateUser(user, changes),
  );
  Hooks.on('updateChatMessage', (message, changes) => {
    handlers().onUpdate(message, changes);
    sendHand(message); // appended hand rolls (sent ones are no longer stored)
  });
  Hooks.on('renderChatMessageHTML', (message, html) => handlers().onRender(message, html));
  Hooks.on('deleteChatMessage', (message) => handlers().onDelete(message));
  Hooks.on('userConnected', (user, connected) => {
    if (!connected) getPets()?.userGone?.(user.id);
  });
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
  migratePetStay(game.settings.storage.get('client'), (k, v) => game.settings.set('dicer', k, v));
  syncHand();
  Promise.all([migrateFromDsn(), lookMigrated])
    .then(() => mirrorLookIfMissing(game.user, getSetting('theme')))
    .catch((err) => console.warn('dicer: cannot mirror the theme setting to the user flag', err));
  let api = null;
  const started = await startEngine({
    // loadDigitAtlas appends /digits.json and /digits.png to this folder.
    loadAtlas: () => loadDigitAtlas(foundry.utils.getRoute('modules/dicer/assets/fonts')),
    // No initial area: DiceBox sends the real one through resize() on construction.
    createPhysics: () =>
      new PhysicsClient(createPhysicsWorker, { hulls: computeHulls() }),
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
      releasePets(); // the old engine's layer; preloadPets makes one for this engine
      effectLayer = createEffectLayer({
        scene: renderer.scene,
        camera: renderer.camera,
        canvas: renderer.canvas, // screen shake moves the dice canvas only
        getTier: () => quality.config,
        getSetting,
        onPlay: debugCounters.countFx,
        isSafe: () => quality.flags().safe === true,
        isolate: (die) => box?.isolate(die) ?? null,
        // The particle pool's programs compile at prefetch (idle), not on the first impact.
        warm: (objects) => renderer.warmObjects(objects),
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
      petDeps = {
        scene: renderer.scene,
        camera: renderer.camera,
        getTier: () => quality.config,
        getSetting,
        playSound: (sound) => soundEngine?.result(sound),
        warm: (objects) => renderer.warmObjects(objects),
        wake: () => box?.wake(),
        activeRolls: () => box?.activeRolls ?? 0,
        holding: () => box?.holding, // H-8: pets hold still while dice are held
      };
      preloadPets(); // this engine's layer (idle; the old one was released above)
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
        pet: () => getPets(),
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
        getWorldDefaultTheme: () => getSetting('worldDefaultTheme'),
        getLockPlayerLooks: () => getSetting('lockPlayerLooks'),
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
      // A user's area as their throws use it: the pet layer moves resting pets when areas change.
      petDeps.areaOf = (id) => box.dieArea(areas.rectFor({ rollerId: id }));
      // Task 8: hand throws from other users, buffered until their message; the chunk on demand.
      const hand = createHandGate({ importChunk: () => loadHand(box), chunkNow: handNow });
      gate = createMessageGate({
        diceBox: box,
        planThrow: plan,
        decorateFor,
        hooks: Hooks,
        getSetting,
        areaFor: areas.rectFor,
        hand,
        onStarted: sendHand,
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
        onHand: hand.accept,
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
        getTier: () => quality?.tier,
        getQualityDrops: () => quality?.drops ?? [],
      });
      dice3d = api;
      game.dice3d = api;
      // The lazy hand chunk on demand, attached to this engine's DiceBox; with options it opens the
      // throw overlay ({specs, rect?, timeoutMs?, ...}: live checks until the resolver opens it).
      api._debug.hand = (o) =>
        loadHand(box).then((m) => (o ? m.openThrowOverlay({ diceBox: box, ...o }) : m));
      // What the DicerResolver's body (the hand chunk) throws with.
      setHandDeps({
        diceBox: box,
        areas,
        decorateFor,
        plan,
        getSetting,
        getCore,
        hooks: Hooks,
        user: () => game.user,
      });
      // The sidebar is observed directly: v14 fires collapseSidebar mid-transition.
      stopWatchingArea = watchArea(resizeDice);
      // The look-extras chunk landed: later rolls draw the real looks, not their fallbacks.
      stopLookExtras = onLookExtrasReady(refreshMaterials);
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
    appearanceRewarm.dispose();
    if (updateUserHook !== null) Hooks.off('updateUser', updateUserHook);
    updateUserHook = null;
    quality?.dispose();
    quality = null;
    gate = null;
    initiative = null;
    diceBox = null;
    diceRenderer = null;
    registry = null;
    faceTextures = null;
    dice3d = null;
    fontAtlases?.dispose(); // its textures and the font builder's worker
    fontAtlases = null;
    digitAtlas = null;
    soundEngine?.dispose();
    soundEngine = null;
    effectLayer?.dispose();
    effectLayer = null;
    releasePets();
    petDeps = null;
    setHandDeps(null); // a dicer roll then falls back to Foundry's random
    stopWatchingArea?.();
    stopWatchingArea = null;
    stopLookExtras?.(); // idempotent: no reset needed
    api?._dispose();
    if (api && game.dice3d === api) delete game.dice3d;
    return;
  }
  // After api.js has loaded, so game.dice3d.DiceSystem is set inside both hooks. Not awaited:
  // the engine is already up, and announceReady never rejects.
  announceReady({ hooks: Hooks, api, apiReady: globalThis.DicerAPIReady });
  preloadSounds();
  preloadEffects();
  preloadPets();
  preloadEditors();
  idle(() => prefetchHand(diceBox, () => getSetting('handRollsAllowed'))); // H-20
});

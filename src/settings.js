import { findTheme } from './themes/themes.js';
import { DEFAULT_RULES } from './effects/rules.js';

export const MODULE_ID = 'dicer';

/**
 * P9-R17: Foundry's settings lookup is slow and the roll loop read sound settings on every die
 * impact (a quarter of Dicer's loop time in the 30-die profile). getSetting remembers simple
 * values (booleans, numbers, strings, null) of the settings registered here, and each one's
 * onChange forgets its value before anything else runs (Foundry fires a world setting's onChange
 * on every client). Object values are read fresh: a caller could change a shared copy.
 */
const cache = new Map();
const cachable = new Set();

function register(key, cfg) {
  cachable.add(key);
  const onChange = cfg.onChange;
  game.settings.register(MODULE_ID, key, {
    ...cfg,
    onChange: (...args) => {
      cache.delete(key);
      return onChange?.(...args);
    },
  });
}

/** Forgets every remembered setting value (tests, teardown). */
export function clearSettingCache() {
  cache.clear();
}

/** The hidden world flag behind the one-time "Dice So Nice is active" GM notice. */
export function registerNoticeSetting() {
  register('dsnNoticeShown', {
    scope: 'world',
    config: false,
    type: Boolean,
    default: false,
  });
}

/**
 * An editor's settings menu. registerMenu needs a class now, so this is a tiny proxy whose
 * render() lazily imports the real editor (a separate chunk) and renders that instead.
 * `open` is the dynamic import, written out by each caller so the bundler emits one chunk each.
 */
function registerEditorMenu(t, key, icon, open) {
  const Base = globalThis.foundry?.applications?.api?.ApplicationV2;
  if (!Base || typeof game.settings.registerMenu !== 'function') return;
  class EditorMenu extends Base {
    async render() {
      return (await open())();
    }
  }
  game.settings.registerMenu(MODULE_ID, key, {
    name: t(`${key}.Name`),
    label: t(`${key}.Label`),
    hint: t(`${key}.Hint`),
    icon,
    type: EditorMenu,
    restricted: false,
  });
}

/**
 * The client `look` setting became `theme` (Plan 5; the ids are the same). Copies a chosen look
 * into `theme` when no theme was chosen yet, then resets `look`, so it runs once.
 * @param {{get: (key: string) => unknown, set: (key: string, value: unknown) => Promise<unknown>}} store
 * @returns {Promise<boolean>} true if the look was copied
 */
export async function migrateLookSetting({ get, set }) {
  const look = get('look');
  if (typeof look !== 'string' || !look || look === 'default') return false;
  const theme = get('theme');
  const copy = (!theme || theme === 'default') && findTheme(look) !== null;
  if (copy) await set('theme', look);
  await set('look', 'default');
  return copy;
}

/** The old client `petsStay` (stored false) becomes petStay 0, once: `store` is the client storage. */
export async function migratePetStay(store, set) {
  try {
    if (store.getItem('dicer.petsStay') === 'false' && store.getItem('dicer.petStay') === null)
      await set('petStay', 0);
  } catch {
    /* storage blocked */
  }
}

/** Re-prepares Foundry's scene controls (the Dice tray tool comes and goes); never throws. */
export const resetControls = () => {
  try {
    ui.controls.render({ reset: true });
  } catch {
    /* no controls yet */
  }
};

/**
 * Registers every Dicer setting.
 * @param {object} [callbacks]
 * @param {() => void} [callbacks.onAreaChange] runs when diceScale or petScale changes
 * @param {() => void} [callbacks.onPetChange] runs when petsAllowed or showPets changes
 * @param {() => void} [callbacks.onPetStayChange] runs when petStay, petSplat or petRestSpot changes
 * @param {() => void} [callbacks.onRollAreasChange] runs when rollAreas or gmPrivateArea changes
 * @param {(key: string, value: unknown) => void} [callbacks.onLookChange] runs when theme,
 *   interiors, engraving, shadows, glow, presetFaces, presetModels or effects changes
 * @param {(key: string, value: unknown) => void} [callbacks.onQualityChange] runs when quality
 *   or the world qualityCap changes (Foundry fires a world setting's onChange on every client)
 * @param {(key: string, value: unknown) => void} [callbacks.onSoundChange] runs when sounds changes
 * @param {() => void} [callbacks.onHandChange] runs when handRolls, handRollTypes, handRollsAllowed
 *   or handRollsRequired changes (the core dice configuration is re-synced)
 * @param {() => void} [callbacks.onLayerChange] runs when diceAboveWindows changes
 * @param {() => void} [callbacks.onLightingChange] runs when diceLighting changes
 * @param {() => void} [callbacks.onTrayChange] runs when a dice tray setting changes
 * @param {(value: boolean) => void} [callbacks.onGrabChange] runs when grabDice changes
 * @param {() => void} [callbacks.onInstalledDiceChange] runs when installedDice changes (every client)
 */
export function registerSettings({
  onAreaChange,
  onRollAreasChange,
  onPetChange,
  onPetStayChange,
  onLookChange,
  onQualityChange,
  onSoundChange,
  onHandChange,
  onLayerChange,
  onLightingChange,
  onTrayChange,
  onGrabChange,
  onInstalledDiceChange,
} = {}) {
  const t = (key) => `DICER.Settings.${key}`;
  register('enabled', {
    name: t('enabled.Name'),
    hint: t('enabled.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
  register('diceLookButton', {
    name: t('diceLookButton.Name'),
    hint: t('diceLookButton.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
  register('pixelRatioCap', {
    name: t('pixelRatioCap.Name'),
    hint: t('pixelRatioCap.Hint'),
    scope: 'client',
    config: true,
    type: Number,
    choices: { 1: '1', 1.5: '1.5', 2: '2' },
    default: 1.5,
    requiresReload: true, // the renderer reads its cap once, at creation
  });
  // Pets have their own on-screen size: the pet layer sizes them by petScale / diceScale.
  // The per-player pet settings (config: false) are edited in the Your pet window (ui/pet-window.js).
  for (const key of ['diceScale', 'petScale']) {
    register(key, {
      name: t(`${key}.Name`),
      hint: t(`${key}.Hint`),
      scope: 'client',
      config: key === 'diceScale',
      type: Number,
      range: { min: 0.5, max: 3, step: 0.1 },
      default: 1,
      onChange: () => onAreaChange?.(),
    });
  }
  register('diceAboveWindows', {
    name: t('diceAboveWindows.Name'),
    hint: t('diceAboveWindows.Hint'),
    scope: 'client',
    config: true,
    type: String,
    choices: Object.fromEntries(['none', 'mine', 'all'].map((k) => [k, t(`diceAboveWindows.Choices.${k}`)])),
    default: 'none',
    onChange: () => onLayerChange?.(),
  });
  register('diceLighting', {
    name: t('diceLighting.Name'),
    hint: t('diceLighting.Hint'),
    scope: 'client',
    config: true,
    type: String,
    choices: Object.fromEntries(['studio', 'scene', 'sun'].map((k) => [k, t(`diceLighting.Choices.${k}`)])),
    default: 'studio',
    onChange: () => onLightingChange?.(),
  });
  // clear and glowing dice cast coloured light on the table (DiceBox lightPools); off by default
  register('diceLight', {
    name: t('diceLight.Name'),
    hint: t('diceLight.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
  });
  // Dice trays (src/tray): the GM's table look, this player's choice, own look, place and showing.
  register('trayMode', {
    name: t('trayMode.Name'),
    hint: t('trayMode.Hint'),
    scope: 'client',
    config: true,
    type: String,
    choices: Object.fromEntries(['table', 'mine', 'none'].map((k) => [k, t(`trayMode.Choices.${k}`)])),
    default: 'table',
    onChange: () => onTrayChange?.(),
  });
  register('trayShow', {
    name: t('trayShow.Name'),
    hint: t('trayShow.Hint'),
    scope: 'client',
    config: true,
    type: String,
    choices: Object.fromEntries(['always', 'rolls'].map((k) => [k, t(`trayShow.Choices.${k}`)])),
    default: 'always',
    onChange: () => onTrayChange?.(),
  });
  register('petTray', {
    name: t('petTray.Name'),
    hint: t('petTray.Hint'),
    scope: 'client',
    config: true,
    type: String,
    choices: Object.fromEntries(['rim', 'in', 'away'].map((k) => [k, t(`petTray.Choices.${k}`)])),
    default: 'rim',
  });
  // the GM's saved trays, each a look any player may take for their own (the Dice tray window)
  register('trayPresets', { scope: 'world', config: false, type: Array, default: [] });
  for (const [key, scope] of [['tableTray', 'world'], ['myTray', 'client'], ['trayRect', 'client']])
    register(key, { scope, config: false, type: Object, default: null, onChange: () => onTrayChange?.() });
  registerEditorMenu(t, 'trayEditor', 'fa-solid fa-chess-board', () =>
    import('./ui/tray-editor.js').then((m) => m.openTrayEditor),
  );
  register('physicalDice', {
    name: t('physicalDice.Name'),
    hint: t('physicalDice.Hint'),
    scope: 'client',
    config: true,
    type: String,
    choices: Object.fromEntries(['animate', 'mark', 'skip'].map((k) => [k, t(`physicalDice.Choices.${k}`)])),
    default: 'mark',
  });
  register('timeBeforeHide', {
    name: t('timeBeforeHide.Name'),
    hint: t('timeBeforeHide.Hint'),
    scope: 'client',
    config: true,
    type: Number,
    default: 2000,
  });
  register('grabDice', {
    name: t('grabDice.Name'),
    hint: t('grabDice.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: (v) => onGrabChange?.(v),
  });
  register('maxDice', {
    name: t('maxDice.Name'),
    hint: t('maxDice.Hint'),
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 1, max: 100, step: 1 },
    default: 20,
  });
  // Ghost dice reveal THAT a hidden roll happened, so the privacy-first default is off.
  register('showGhostDice', {
    name: t('showGhostDice.Name'),
    hint: t('showGhostDice.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });
  register('showExtraDice', {
    name: t('showExtraDice.Name'),
    hint: t('showExtraDice.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
  register('petsAllowed', {
    name: t('petsAllowed.Name'),
    hint: t('petsAllowed.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => onPetChange?.(),
  });
  register('showPets', {
    name: t('showPets.Name'),
    hint: t('showPets.Hint'),
    scope: 'client',
    config: false,
    type: Boolean,
    default: true,
    onChange: () => onPetChange?.(),
  });
  register('petSounds', {
    name: t('petSounds.Name'),
    hint: t('petSounds.Hint'),
    scope: 'client',
    config: false,
    type: Boolean,
    default: true,
  });
  register('petStay', {
    name: t('petStay.Name'),
    hint: t('petStay.Hint'),
    scope: 'client',
    config: false,
    type: Number,
    choices: Object.fromEntries([0, 30, 60, 120, -1].map((v) => [v, t(`petStay.Choices.${v}`)])),
    default: 60,
    onChange: () => onPetStayChange?.(),
  });
  register('petSplat', {
    name: t('petSplat.Name'),
    hint: t('petSplat.Hint'),
    scope: 'client',
    config: false,
    type: Boolean,
    default: true,
    onChange: () => onPetStayChange?.(),
  });
  for (const [k, type = Boolean, def = true, more] of [
    [
      'petRestSpot',
      String,
      'dice',
      {
        choices: Object.fromEntries(
          ['dice', 'placed'].map((v) => [v, t(`petRestSpot.Choices.${v}`)]),
        ),
        onChange: onPetStayChange,
      },
    ],
    ['petClick'],
    ['petElemental'],
    ['petMoods'],
    ['petCheer'],
  ]) {
    register(k, { name: t(`${k}.Name`), hint: t(`${k}.Hint`), scope: 'client', config: false, type, default: def, ...more });
  }
  register('immediatelyDisplayChatMessages', {
    name: t('immediatelyDisplayChatMessages.Name'),
    hint: t('immediatelyDisplayChatMessages.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });
  register('hideInitiative', {
    name: t('hideInitiative.Name'),
    hint: t('hideInitiative.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
  register('migrateFromDsn', {
    name: t('migrateFromDsn.Name'),
    hint: t('migrateFromDsn.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
  // Set (to 1) once the GM's run has copied the Dice So Nice world settings.
  register('dsnWorldMigrated', {
    scope: 'world',
    config: false,
    type: Number,
    default: 0,
  });
  // The player's theme and the GM's world default are picked in the theme browser (a dropdown
  // here duplicated it); both stay settings, out of Foundry's list.
  register('theme', {
    scope: 'client',
    config: false,
    type: String,
    default: 'default',
    onChange: (value) => onLookChange?.('theme', value),
  });
  // GM controls (P7-D4): a world default theme, and a lock that makes it win for players.
  register('worldDefaultTheme', {
    scope: 'world',
    config: false,
    type: String,
    default: '',
    onChange: (value) => onLookChange?.('worldDefaultTheme', value),
  });
  register('lockPlayerLooks', {
    name: t('lockPlayerLooks.Name'),
    hint: t('lockPlayerLooks.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange: (value) => onLookChange?.('lockPlayerLooks', value),
  });
  // The pre-Plan-5 look choice: hidden, read once by migrateLookSetting.
  register('look', {
    scope: 'client',
    config: false,
    type: String,
    default: 'default',
  });
  // GM-published themes (Plan 5); validated when read, unreadable entries are kept.
  register('worldThemes', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });
  const tiers = ['low', 'medium', 'high', 'ultra'];
  const tierChoices = (keys) => Object.fromEntries(keys.map((k) => [k, t(`quality.Choices.${k}`)]));
  register('quality', {
    name: t('quality.Name'),
    hint: t('quality.Hint'),
    scope: 'client',
    config: true,
    type: String,
    choices: tierChoices(['auto', ...tiers]),
    default: 'auto',
    onChange: (value) => onQualityChange?.('quality', value),
  });
  register('qualityCap', {
    name: t('qualityCap.Name'),
    hint: t('qualityCap.Hint'),
    scope: 'world',
    config: true,
    type: String,
    choices: tierChoices(tiers),
    default: 'ultra',
    onChange: (value) => onQualityChange?.('qualityCap', value),
  });
  for (const key of ['interiors', 'insideMotion', 'engraving', 'shadows', 'glow', 'presetFaces', 'presetModels']) {
    register(key, {
      name: t(`${key}.Name`),
      hint: t(`${key}.Hint`),
      scope: 'client',
      config: true,
      type: Boolean,
      default: true,
      onChange: (value) => onLookChange?.(key, value),
    });
  }
  // effectSounds: theme and trigger result sounds (zap, chime...); pet chirps have their own.
  for (const key of ['sounds', 'effectSounds', 'quietWhenUnfocused']) {
    register(key, {
      name: t(`${key}.Name`),
      hint: t(`${key}.Hint`),
      scope: 'client',
      config: true,
      type: Boolean,
      default: true,
      onChange: (value) => onSoundChange?.(key, value),
    });
  }
  for (const [key, def] of [
    ['soundVolume', 0.6],
    ['effectsVolume', 0.8],
  ]) {
    register(key, {
      name: t(`${key}.Name`),
      hint: t(`${key}.Hint`),
      scope: 'client',
      config: true,
      type: Number,
      range: { min: 0, max: 1, step: 0.05 },
      default: def,
    });
  }
  const surfaceChoices = (keys) =>
    Object.fromEntries(keys.map((k) => [k, t(`soundSurface.Choices.${k}`)]));
  const surfaces = ['felt', 'wood', 'stone', 'metal'];
  register('soundSurface', {
    name: t('soundSurface.Name'),
    hint: t('soundSurface.Hint'),
    scope: 'world',
    config: true,
    type: String,
    choices: surfaceChoices(surfaces),
    default: 'felt',
  });
  register('soundSurfaceOverride', {
    name: t('soundSurfaceOverride.Name'),
    hint: t('soundSurfaceOverride.Hint'),
    scope: 'client',
    config: true,
    type: String,
    choices: surfaceChoices(['world', ...surfaces]),
    default: 'world',
  });
  // Foundry's own dice clatter plays on every roll card; with Dicer's sounds it is a second,
  // unrelated one (src/foundry/core-dice-sound.js).
  register('muteCoreDiceSound', {
    name: t('muteCoreDiceSound.Name'),
    hint: t('muteCoreDiceSound.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
  // Trigger effects (P4-D2): the roller's rules decide; each viewer filters what they see.
  for (const key of ['effects', 'showOthersEffects', 'slowMotion', 'screenShake', 'impactEffects', 'jb2aEffects', 'insideFlare', 'elementalTrails', 'elementalCritBursts']) {
    register(key, {
      name: t(`${key}.Name`),
      hint: t(`${key}.Hint`),
      scope: 'client',
      config: true,
      type: Boolean,
      default: true,
      // effects also selects the die programs (the fx uniform block): rebuild the materials.
      ...(key === 'effects' ? { onChange: (value) => onLookChange?.(key, value) } : {}),
    });
  }
  register('triggerMacros', {
    name: t('triggerMacros.Name'),
    hint: t('triggerMacros.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
  // Damage themes: a look, impact sound and landing effect per damage type.
  register('damagePresets', {
    name: t('damagePresets.Name'),
    hint: t('damagePresets.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
  register('damageOverDiceSet', {
    name: t('damageOverDiceSet.Name'),
    hint: t('damageOverDiceSet.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
  // damage type -> theme id | colorset name | 'none'; edited by the damage-theme UI, not the form.
  register('damageTypeMap', {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
  });
  // damage type -> { src, volume? }: the GM's custom landing sound, replacing the theme's own.
  register('damageTypeSounds', {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
  });
  registerEditorMenu(t, 'damageMap', 'fa-solid fa-fire', () =>
    import('./ui/damage-map-editor.js').then((m) => m.openDamageMapEditor),
  );
  register('damageThemeOverrides', {
    scope: 'client',
    config: false,
    type: Object,
    default: {},
  });
  // Edited by the trigger editor (Task 12), never in the settings form.
  register('worldTriggers', {
    scope: 'world',
    config: false,
    type: Array,
    default: structuredClone(DEFAULT_RULES),
  });
  registerEditorMenu(t, 'triggerEditor', 'fa-solid fa-bolt', () =>
    import('./ui/trigger-editor.js').then((m) => m.openTriggerEditor),
  );
  // The theme gallery: everyone browses, assigns and edits their own; the GM also publishes.
  // Roll filters (foundry/roll-filters.js): the player's choices, and the GM's world default.
  register('rollFilters', { scope: 'client', config: false, type: Object, default: {} });
  register('rollFiltersDefault', { scope: 'world', config: false, type: Object, default: {} });
  registerEditorMenu(t, 'rollFilters', 'fa-solid fa-filter', () =>
    import('./ui/roll-filters.js').then((m) => () => m.openRollFilters()),
  );
  // The player's own pet (its kind and colour): its own window, since it is not part of any theme.
  registerEditorMenu(t, 'petWindow', 'fa-solid fa-dragon', () =>
    import('./ui/pet-window.js').then((m) => () => m.openPetWindow()),
  );
  // Dice of installed modules that are not active (compat/installed-dice.js): the GM's picks, each
  // {id, title, scripts}, made in the theme browser; every client loads new picks as they are made.
  register('installedDice', { scope: 'world', config: false, type: Array, default: [], onChange: () => onInstalledDiceChange?.() });
  registerEditorMenu(t, 'themeBrowser', 'fa-solid fa-dice-d20', () =>
    import('./ui/theme-browser.js').then((m) => m.openThemeBrowser),
  );
  // The appearance editor: everyone designs looks and saves them as their own themes; the GM also as world themes.
  registerEditorMenu(t, 'appearanceEditor', 'fa-solid fa-palette', () =>
    import('./ui/appearance-editor.js').then((m) => m.openAppearanceEditor),
  );
  // Opens for everyone: the GM edits, a player gets a read-only preview of their own area (P5-D3).
  registerEditorMenu(t, 'rollAreaEditor', 'fa-solid fa-vector-square', () =>
    import('./ui/area-editor.js').then((m) => m.openAreaEditor),
  );
  // The in-game benchmark window: a few local test rolls and a shareable summary. For everyone.
  registerEditorMenu(t, 'benchmark', 'fa-solid fa-gauge-high', () =>
    import('./bench/benchmark-app.js').then((m) => m.openBenchmarkApp),
  );
  // Ids of module (Dice So Nice default) rules the GM switched off in the trigger editor.
  register('disabledModuleTriggers', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });
  // Roll areas (Plan 5): read per throw by the area resolver, so no onChange rebuilds anything.
  // Edited by the area editor (GM only, P5-D3), never in the settings form.
  register('rollAreas', {
    scope: 'world',
    config: false,
    type: Object,
    default: { default: { preset: 'full' }, users: {} },
    // Foundry fires a world setting's onChange on every client: the dicerRollAreasChanged hook.
    onChange: () => onRollAreasChange?.(),
  });
  register('perPlayerAreas', {
    name: t('perPlayerAreas.Name'),
    hint: t('perPlayerAreas.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
  // P5-D2: this screen's override is a scale around each area's centre, not a second area.
  register('areaScale', {
    name: t('areaScale.Name'),
    hint: t('areaScale.Hint'),
    scope: 'client',
    config: true,
    type: Number,
    range: { min: 0.5, max: 1.5, step: 0.05 },
    default: 1,
  });
  // P5-D7: opt-in; only a GM's own client, only rolls only GMs can see.
  register('gmPrivateCorner', {
    name: t('gmPrivateCorner.Name'),
    hint: t('gmPrivateCorner.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });
  register('gmPrivateArea', {
    scope: 'world',
    config: false,
    type: Object,
    default: { preset: 'corner' },
    onChange: () => onRollAreasChange?.(),
  });
  // Rolling by hand (G10, P6-D4: off by default; the GM allows everyone). The four that decide the
  // core dice configuration re-sync it on change (handRollsAllowed and -Required fire on every client).
  const choices = (key, keys) => Object.fromEntries(keys.map((k) => [k, t(`${key}.Choices.${k}`)]));
  const hand = [
    ['handRolls', 'client', String, 'off', { choices: choices('handRolls', ['off', 'ask', 'always']) }],
    ['handRollTypes', 'client', Array, [], { config: false }], // Foundry denominations; empty: all
    ['handRollsAllowed', 'world', String, 'all', { choices: choices('handRollsAllowed', ['all', 'trusted', 'gm', 'none']) }],
    ['handRollsRequired', 'world', Boolean, false],
    ['handRollTimeout', 'world', Number, 60, { range: { min: 10, max: 300, step: 5 } }],
    ['handReplay', 'client', Boolean, true],
    ['handFollowUps', 'client', Boolean, true], // a roll right after a hand throw throws itself
    ['handLiveShare', 'world', Boolean, true], // a hand throw reaches the others as it flies
    ['elementalDamageInsides', 'world', Boolean, true], // fire, cold and electricity dice get elemental insides
    ['diceTray', 'client', Boolean, true, { onChange: resetControls }], // its tool
    ['chatTray', 'client', Boolean, true], // its chunk follows it (clientSettingChanged)
  ];
  hand.forEach(([key, scope, type, def, more], i) =>
    register(key, {
      name: t(`${key}.Name`),
      hint: t(`${key}.Hint`),
      scope,
      config: true,
      type,
      default: def,
      ...more,
      ...(i < 4 ? { onChange: () => onHandChange?.() } : {}),
    }),
  );
  // The dice configuration entries handRollsRequired took from another method, restored when it ends.
  register('handRollStash', { scope: 'client', config: false, type: Object, default: {} });
  // The entries Dicer wrote itself: only those are ever removed (a user's own Dicer pick stays).
  register('handRollMapped', { scope: 'client', config: false, type: Array, default: [] });
  register('petRestAt', { scope: 'client', config: false, type: Object, default: null }); // where 'placed' pets rest
  registerNoticeSetting();
}

export function getSetting(key) {
  if (cache.has(key)) return cache.get(key);
  const value = game.settings.get(MODULE_ID, key);
  if (cachable.has(key) && (value == null || (typeof value !== 'object' && typeof value !== 'function'))) {
    cache.set(key, value);
  }
  return value;
}

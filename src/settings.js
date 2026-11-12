import { BUILTIN_THEMES, findTheme, readThemeList } from './themes/themes.js';
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
 * The `theme` setting's choices: built-ins, the world's themes and the current user's own (name +
 * source). Read live, so a theme chosen in the theme browser stays a valid choice in Foundry's
 * settings form (which would otherwise replace it with the first built-in on save).
 */
export function themeChoices(get = (key) => game.settings.get(MODULE_ID, key), user = () => game.user) {
  const quiet = () => {};
  const label = (t, src) => (src ? `${t.name} (${src})` : t.name);
  const out = Object.fromEntries(BUILTIN_THEMES.map((t) => [t.id, t.name]));
  const add = (list, src) => {
    for (const t of list) if (!(t.id in out)) out[t.id] = label(t, src);
  };
  try {
    add(readThemeList(get('worldThemes'), 'world', quiet), 'world');
    add(readThemeList(user()?.getFlag?.(MODULE_ID, 'themes'), 'user', quiet), 'mine');
  } catch {
    /* settings not ready: built-ins only */
  }
  return out;
}

/**
 * The `worldDefaultTheme` choices: none (''), built-ins and the world's themes. Read live, for the
 * same reason as themeChoices. Not the user's own themes: the GM's default must exist for everyone.
 */
export function worldDefaultChoices(none, get = (key) => game.settings.get(MODULE_ID, key), missing = '(missing)') {
  const out = { '': none, ...Object.fromEntries(BUILTIN_THEMES.map((t) => [t.id, t.name])) };
  try {
    for (const t of readThemeList(get('worldThemes'), 'world', () => {})) if (!(t.id in out)) out[t.id] = `${t.name} (world)`;
  } catch {
    /* settings not ready: built-ins only */
  }
  // A stored id that no longer exists stays a choice, so the settings form does not clear it.
  try {
    const current = get('worldDefaultTheme');
    if (typeof current === 'string' && current && !(current in out)) out[current] = `${current} ${missing}`;
  } catch {
    /* none */
  }
  return out;
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

/**
 * Registers every Dicer setting.
 * @param {object} [callbacks]
 * @param {() => void} [callbacks.onAreaChange] runs when diceScale changes
 * @param {() => void} [callbacks.onRollAreasChange] runs when rollAreas or gmPrivateArea changes
 * @param {(key: string, value: unknown) => void} [callbacks.onLookChange] runs when theme,
 *   interiors, engraving, shadows, glow, presetFaces, presetModels or effects changes
 * @param {(key: string, value: unknown) => void} [callbacks.onQualityChange] runs when quality
 *   or the world qualityCap changes (Foundry fires a world setting's onChange on every client)
 * @param {(key: string, value: unknown) => void} [callbacks.onSoundChange] runs when sounds changes
 */
export function registerSettings({
  onAreaChange,
  onRollAreasChange,
  onLookChange,
  onQualityChange,
  onSoundChange,
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
  register('diceScale', {
    name: t('diceScale.Name'),
    hint: t('diceScale.Hint'),
    scope: 'client',
    config: true,
    type: Number,
    range: { min: 0.5, max: 2, step: 0.1 },
    default: 1,
    onChange: () => onAreaChange?.(),
  });
  register('timeBeforeHide', {
    name: t('timeBeforeHide.Name'),
    hint: t('timeBeforeHide.Hint'),
    scope: 'client',
    config: true,
    type: Number,
    default: 2000,
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
  register('theme', {
    name: t('theme.Name'),
    hint: t('theme.Hint'),
    scope: 'client',
    config: true,
    type: String,
    choices: Object.fromEntries(BUILTIN_THEMES.map((theme) => [theme.id, theme.name])),
    default: 'default',
    onChange: (value) => onLookChange?.('theme', value),
  });
  // P5-R10: the choices follow the stored themes (read each time the settings form renders).
  try {
    const entry = game.settings.settings?.get?.(`${MODULE_ID}.theme`);
    if (entry) Object.defineProperty(entry, 'choices', { get: () => themeChoices(), configurable: true, enumerable: true });
  } catch {
    /* the fixed built-in choices stay */
  }
  // GM controls (P7-D4): a world default theme, and a lock that makes it win for players.
  register('worldDefaultTheme', {
    name: t('worldDefaultTheme.Name'),
    hint: t('worldDefaultTheme.Hint'),
    scope: 'world',
    config: true,
    type: String,
    choices: worldDefaultChoices(t('worldDefaultTheme.None'), () => []),
    default: '',
    onChange: (value) => onLookChange?.('worldDefaultTheme', value),
  });
  try {
    const entry = game.settings.settings?.get?.(`${MODULE_ID}.worldDefaultTheme`);
    if (entry) {
      const none = t('worldDefaultTheme.None');
      const missing = t('worldDefaultTheme.Missing');
      Object.defineProperty(entry, 'choices', {
        get: () => worldDefaultChoices(none, undefined, missing),
        configurable: true,
        enumerable: true,
      });
    }
  } catch {
    /* the fixed built-in choices stay */
  }
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
  for (const key of ['interiors', 'engraving', 'shadows', 'glow', 'presetFaces', 'presetModels']) {
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
  for (const key of ['sounds', 'quietWhenUnfocused']) {
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
  for (const key of ['effects', 'showOthersEffects', 'slowMotion', 'screenShake']) {
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

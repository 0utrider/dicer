import { LOOKS } from './look/looks.js';
import { DEFAULT_RULES } from './effects/rules.js';

export const MODULE_ID = 'dicer';

/** The hidden world flag behind the one-time "Dice So Nice is active" GM notice. */
export function registerNoticeSetting() {
  game.settings.register(MODULE_ID, 'dsnNoticeShown', {
    scope: 'world',
    config: false,
    type: Boolean,
    default: false,
  });
}

/**
 * The trigger editor's settings menu. registerMenu needs a class now, so this is a tiny proxy
 * whose render() lazily imports the real editor (a separate chunk) and renders that instead.
 */
function registerTriggerMenu(t) {
  const Base = globalThis.foundry?.applications?.api?.ApplicationV2;
  if (!Base || typeof game.settings.registerMenu !== 'function') return;
  class TriggerEditorMenu extends Base {
    async render() {
      const { openTriggerEditor } = await import('./ui/trigger-editor.js');
      return openTriggerEditor();
    }
  }
  game.settings.registerMenu(MODULE_ID, 'triggerEditor', {
    name: t('triggerEditor.Name'),
    label: t('triggerEditor.Label'),
    hint: t('triggerEditor.Hint'),
    icon: 'fa-solid fa-bolt',
    type: TriggerEditorMenu,
    restricted: false,
  });
}

/**
 * Registers every Dicer setting.
 * @param {object} [callbacks]
 * @param {() => void} [callbacks.onAreaChange] runs when diceScale changes
 * @param {(key: string, value: unknown) => void} [callbacks.onLookChange] runs when look,
 *   interiors, engraving, shadows, glow, presetFaces, presetModels or effects changes
 * @param {(key: string, value: unknown) => void} [callbacks.onQualityChange] runs when quality
 *   or the world qualityCap changes (Foundry fires a world setting's onChange on every client)
 * @param {(key: string, value: unknown) => void} [callbacks.onSoundChange] runs when sounds changes
 */
export function registerSettings({ onAreaChange, onLookChange, onQualityChange, onSoundChange } = {}) {
  const t = (key) => `DICER.Settings.${key}`;
  game.settings.register(MODULE_ID, 'enabled', {
    name: t('enabled.Name'),
    hint: t('enabled.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, 'pixelRatioCap', {
    name: t('pixelRatioCap.Name'),
    hint: t('pixelRatioCap.Hint'),
    scope: 'client',
    config: true,
    type: Number,
    choices: { 1: '1', 1.5: '1.5', 2: '2' },
    default: 1.5,
    requiresReload: true, // the renderer reads its cap once, at creation
  });
  game.settings.register(MODULE_ID, 'diceScale', {
    name: t('diceScale.Name'),
    hint: t('diceScale.Hint'),
    scope: 'client',
    config: true,
    type: Number,
    range: { min: 0.5, max: 2, step: 0.1 },
    default: 1,
    onChange: () => onAreaChange?.(),
  });
  game.settings.register(MODULE_ID, 'timeBeforeHide', {
    name: t('timeBeforeHide.Name'),
    hint: t('timeBeforeHide.Hint'),
    scope: 'client',
    config: true,
    type: Number,
    default: 2000,
  });
  game.settings.register(MODULE_ID, 'maxDice', {
    name: t('maxDice.Name'),
    hint: t('maxDice.Hint'),
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 1, max: 100, step: 1 },
    default: 20,
  });
  // Ghost dice reveal THAT a hidden roll happened, so the privacy-first default is off.
  game.settings.register(MODULE_ID, 'showGhostDice', {
    name: t('showGhostDice.Name'),
    hint: t('showGhostDice.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, 'showExtraDice', {
    name: t('showExtraDice.Name'),
    hint: t('showExtraDice.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, 'immediatelyDisplayChatMessages', {
    name: t('immediatelyDisplayChatMessages.Name'),
    hint: t('immediatelyDisplayChatMessages.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, 'hideInitiative', {
    name: t('hideInitiative.Name'),
    hint: t('hideInitiative.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, 'migrateFromDsn', {
    name: t('migrateFromDsn.Name'),
    hint: t('migrateFromDsn.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
  // Set (to 1) once the GM's run has copied the Dice So Nice world settings.
  game.settings.register(MODULE_ID, 'dsnWorldMigrated', {
    scope: 'world',
    config: false,
    type: Number,
    default: 0,
  });
  game.settings.register(MODULE_ID, 'look', {
    name: t('look.Name'),
    hint: t('look.Hint'),
    scope: 'client',
    config: true,
    type: String,
    choices: Object.fromEntries(Object.entries(LOOKS).map(([id, look]) => [id, look.name])),
    default: 'default',
    onChange: (value) => onLookChange?.('look', value),
  });
  const tiers = ['low', 'medium', 'high', 'ultra'];
  const tierChoices = (keys) => Object.fromEntries(keys.map((k) => [k, t(`quality.Choices.${k}`)]));
  game.settings.register(MODULE_ID, 'quality', {
    name: t('quality.Name'),
    hint: t('quality.Hint'),
    scope: 'client',
    config: true,
    type: String,
    choices: tierChoices(['auto', ...tiers]),
    default: 'auto',
    onChange: (value) => onQualityChange?.('quality', value),
  });
  game.settings.register(MODULE_ID, 'qualityCap', {
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
    game.settings.register(MODULE_ID, key, {
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
    game.settings.register(MODULE_ID, key, {
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
    game.settings.register(MODULE_ID, key, {
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
  game.settings.register(MODULE_ID, 'soundSurface', {
    name: t('soundSurface.Name'),
    hint: t('soundSurface.Hint'),
    scope: 'world',
    config: true,
    type: String,
    choices: surfaceChoices(surfaces),
    default: 'felt',
  });
  game.settings.register(MODULE_ID, 'soundSurfaceOverride', {
    name: t('soundSurfaceOverride.Name'),
    hint: t('soundSurfaceOverride.Hint'),
    scope: 'client',
    config: true,
    type: String,
    choices: surfaceChoices(['world', ...surfaces]),
    default: 'world',
  });
  // Trigger effects (P4-D2): the roller's rules decide; each viewer filters what they see.
  for (const key of ['effects', 'showOthersEffects', 'slowMotion', 'screenShake']) {
    game.settings.register(MODULE_ID, key, {
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
  game.settings.register(MODULE_ID, 'triggerMacros', {
    name: t('triggerMacros.Name'),
    hint: t('triggerMacros.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
  // Damage themes: a look, impact sound and landing effect per damage type.
  game.settings.register(MODULE_ID, 'damagePresets', {
    name: t('damagePresets.Name'),
    hint: t('damagePresets.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
  // damage type -> theme id | colorset name | 'none'; edited by the damage-theme UI, not the form.
  game.settings.register(MODULE_ID, 'damageTypeMap', {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
  });
  game.settings.register(MODULE_ID, 'damageThemeOverrides', {
    scope: 'client',
    config: false,
    type: Object,
    default: {},
  });
  // Edited by the trigger editor (Task 12), never in the settings form.
  game.settings.register(MODULE_ID, 'worldTriggers', {
    scope: 'world',
    config: false,
    type: Array,
    default: structuredClone(DEFAULT_RULES),
  });
  registerTriggerMenu(t);
  // Ids of module (Dice So Nice default) rules the GM switched off in the trigger editor.
  game.settings.register(MODULE_ID, 'disabledModuleTriggers', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });
  registerNoticeSetting();
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

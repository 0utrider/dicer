import { LOOKS } from './look/looks.js';

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
 * Registers every Dicer setting.
 * @param {object} [callbacks]
 * @param {() => void} [callbacks.onAreaChange] runs when diceScale changes
 * @param {(key: string, value: unknown) => void} [callbacks.onLookChange] runs when look,
 *   interiors, engraving, shadows, glow, presetFaces or presetModels changes
 * @param {(key: string, value: unknown) => void} [callbacks.onQualityChange] runs when quality
 *   or the world qualityCap changes (Foundry fires a world setting's onChange on every client)
 */
export function registerSettings({ onAreaChange, onLookChange, onQualityChange } = {}) {
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
  registerNoticeSetting();
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

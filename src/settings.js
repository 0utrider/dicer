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
 * @param {{ onAreaChange?: () => void }} [callbacks] onAreaChange runs when diceScale changes.
 */
export function registerSettings({ onAreaChange } = {}) {
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
    default: 20,
  });
  registerNoticeSetting();
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export const DSN_ID = 'dice-so-nice';
export const DSN_NOTICE_KEY = 'DICER.Notice.DsnActive';

/** True when Dice So Nice is installed and enabled in this world. */
export function dsnIsActive(game) {
  return Boolean(game?.modules?.get(DSN_ID)?.active);
}

/** Tells the GM, once per world, that Dicer stays dormant while Dice So Nice is enabled. */
export async function notifyGmOnce(game, ui) {
  if (!game?.user?.isGM) return;
  if (game.settings.get('dicer', 'dsnNoticeShown')) return;
  ui.notifications.warn(game.i18n.localize(DSN_NOTICE_KEY));
  await game.settings.set('dicer', 'dsnNoticeShown', true);
}

import { dsnIsActive, notifyGmOnce, DSN_NOTICE_KEY } from '../../src/foundry/coexistence.js';

function fakeGame({ dsn, isGM = true, shown = false } = {}) {
  const store = { dsnNoticeShown: shown };
  return {
    modules: new Map(dsn === undefined ? [] : [['dice-so-nice', { active: dsn }]]),
    user: { isGM },
    i18n: { localize: (k) => `L(${k})` },
    settings: {
      get: vi.fn((scope, key) => store[key]),
      set: vi.fn(async (scope, key, v) => (store[key] = v)),
    },
    store,
  };
}

const fakeUi = () => ({ notifications: { warn: vi.fn() } });

test('dsnIsActive true when game.modules.get("dice-so-nice").active', () => {
  expect(dsnIsActive(fakeGame({ dsn: true }))).toBe(true);
});
test('dsnIsActive false when the module is missing', () => {
  expect(dsnIsActive(fakeGame())).toBe(false);
});
test('dsnIsActive false when the module is inactive', () => {
  expect(dsnIsActive(fakeGame({ dsn: false }))).toBe(false);
});

test('notifyGmOnce warns only for GM and only while dsnNoticeShown is false, then sets it', async () => {
  const ui = fakeUi();

  const player = fakeGame({ isGM: false });
  await notifyGmOnce(player, ui);
  expect(ui.notifications.warn).not.toHaveBeenCalled();
  expect(player.settings.set).not.toHaveBeenCalled();

  const gm = fakeGame();
  await notifyGmOnce(gm, ui);
  expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
  expect(ui.notifications.warn).toHaveBeenCalledWith(`L(${DSN_NOTICE_KEY})`);
  expect(gm.settings.set).toHaveBeenCalledWith('dicer', 'dsnNoticeShown', true);

  await notifyGmOnce(gm, ui);
  expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
});

import { registerSettings } from '../../src/settings.js';

test('maxDice is a 1..100 range in steps of 1 (default 20)', () => {
  const registered = {};
  globalThis.game = { settings: { register: (ns, key, cfg) => (registered[key] = cfg) } };
  try {
    registerSettings();
    expect(registered.maxDice.range).toEqual({ min: 1, max: 100, step: 1 });
    expect(registered.maxDice.default).toBe(20);
  } finally {
    delete globalThis.game;
  }
});

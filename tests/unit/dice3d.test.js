import { createDice3dApi } from '../../src/api/dice3d.js';
import { planThrow } from '../../src/throw/throw-planner.js';

function fakeDiceBox() {
  const rolls = [];
  return {
    rolls,
    get activeRolls() {
      return rolls.length;
    },
    roll: vi.fn((specs) => {
      let resolve;
      const landed = new Promise((r) => (resolve = r));
      rolls.push({ specs, resolve });
      return { landed, finished: landed };
    }),
  };
}

const roll = (faces, result) => ({ dice: [{ faces, results: [{ result, active: true }] }] });

let diceBox, gate, api, settings;
beforeEach(() => {
  diceBox = fakeDiceBox();
  gate = { disabled: false, waitFor: vi.fn(async () => true) };
  settings = { enabled: true, maxDice: 20 };
  api = createDice3dApi({
    diceBox,
    gate,
    planThrow,
    getSetting: (k) => settings[k],
    renderer: { isLooping: true },
  });
});

test('isEnabled follows the enabled setting', () => {
  expect(api.isEnabled()).toBe(true);
  settings.enabled = false;
  expect(api.isEnabled()).toBe(false);
});

test('showForRoll resolves true after landing', async () => {
  let result = null;
  api.showForRoll(roll(20, 12)).then((v) => (result = v));
  await Promise.resolve();
  expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 12 }]);
  expect(result).toBe(null);
  diceBox.rolls[0].resolve();
  await new Promise((r) => setTimeout(r, 0));
  expect(result).toBe(true);
});

test('showForRoll decorates with the given user (or the local user) as author', async () => {
  const decorateFor = vi.fn(() => () => ({ appearance: { tag: 'x' } }));
  globalThis.game = { user: { id: 'me' } };
  try {
    const a = createDice3dApi({
      diceBox,
      gate,
      planThrow,
      getSetting: (k) => settings[k],
      decorateFor,
    });
    const r = roll(20, 4);
    a.showForRoll(r, { id: 'remote' });
    expect(decorateFor).toHaveBeenLastCalledWith(null, r, 'remote');
    expect(diceBox.roll).toHaveBeenLastCalledWith([
      { type: 'd20', value: 4, appearance: { tag: 'x' } },
    ]);
    a.showForRoll(r);
    expect(decorateFor).toHaveBeenLastCalledWith(null, r, 'me');
  } finally {
    delete globalThis.game;
  }
});

test('showForRoll resolves false for blind', async () => {
  await expect(api.showForRoll(roll(20, 12), {}, false, null, true)).resolves.toBe(false);
  expect(diceBox.roll).not.toHaveBeenCalled();
});

test('showForRoll resolves false for a roll with only d7s', async () => {
  await expect(api.showForRoll(roll(7, 3))).resolves.toBe(false);
  expect(diceBox.roll).not.toHaveBeenCalled();
});

test('showForRoll resolves false when diceBox.roll throws', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  diceBox.roll.mockImplementation(() => {
    throw new Error('boom');
  });
  await expect(api.showForRoll(roll(20, 1))).resolves.toBe(false);
  spy.mockRestore();
});

test('waitFor3DAnimationByMessageID delegates to gate.waitFor', async () => {
  await expect(api.waitFor3DAnimationByMessageID('m1')).resolves.toBe(true);
  expect(gate.waitFor).toHaveBeenCalledWith('m1');
});

test('messageHookDisabled proxies gate.disabled', () => {
  expect(api.messageHookDisabled).toBe(false);
  api.messageHookDisabled = true;
  expect(gate.disabled).toBe(true);
  gate.disabled = false;
  expect(api.messageHookDisabled).toBe(false);
});

test('_debug exposes isLooping and activeRolls', () => {
  expect(api._debug.isLooping).toBe(true);
  expect(api._debug.activeRolls).toBe(0);
  api.showForRoll(roll(6, 2));
  expect(api._debug.activeRolls).toBe(1);
});

test('showForRoll resolves false without rolling when the enabled setting is off', async () => {
  settings.enabled = false;
  await expect(api.showForRoll(roll(20, 12))).resolves.toBe(false);
  expect(diceBox.roll).not.toHaveBeenCalled();
});

describe('Plan 3 registration stubs (integrations call them from diceSoNiceReady)', () => {
  const STUBS = [
    'addSystem',
    'addDicePreset',
    'addColorset',
    'addTexture',
    'addDiceShape',
    'addSFXTrigger',
    'addSFXMode',
    'addDamageTypeDefaults',
    'addRole',
  ];

  test.each(STUBS)('%s exists and does not throw', async (name) => {
    expect(typeof api[name]).toBe('function');
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    let out;
    expect(() => (out = api[name]({ id: 'x', name: 'X' }, 'default'))).not.toThrow();
    await out; // the async DSN methods resolve
    vi.restoreAllMocks();
  });

  test('the async DSN methods return promises so `.then` chains work', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    for (const name of ['addDicePreset', 'addColorset', 'addTexture']) {
      await expect(api[name]({})).resolves.toBeUndefined();
    }
    vi.restoreAllMocks();
  });

  test('each stub logs once at debug level', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    for (const name of STUBS) {
      api[name]({});
      api[name]({});
    }
    expect(debug).toHaveBeenCalledTimes(STUBS.length);
    expect(debug.mock.calls.every(([msg]) => /Plan 3/.test(msg))).toBe(true);
    debug.mockRestore();
  });

  test('getLoadedDiceSystems returns an empty Map, getSFXModes an empty object', () => {
    const systems = api.getLoadedDiceSystems();
    expect(systems).toBeInstanceOf(Map);
    expect(systems.size).toBe(0);
    expect(api.getSFXModes()).toEqual({});
  });
});

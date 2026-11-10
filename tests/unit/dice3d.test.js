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

test('showExtraDiceByDefault follows the showExtraDice setting (unset counts as on)', () => {
  expect(api.showExtraDiceByDefault()).toBe(true);
  settings.showExtraDice = false;
  expect(api.showExtraDiceByDefault()).toBe(false);
  settings.showExtraDice = true;
  expect(api.showExtraDiceByDefault()).toBe(true);
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

describe('setMessageUpdateHideSelector', () => {
  test('passes the selector to the gate and returns nothing', () => {
    gate.setUpdateHideSelector = vi.fn(() => true);
    expect(api.setMessageUpdateHideSelector('.dice-roll')).toBeUndefined();
    expect(api.setMessageUpdateHideSelector(null)).toBeUndefined();
    expect(gate.setUpdateHideSelector.mock.calls).toEqual([['.dice-roll'], [null]]);
  });

  test('a rejected selector logs one warning per member and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gate.setUpdateHideSelector = vi.fn(() => false);
    expect(() => api.setMessageUpdateHideSelector(42)).not.toThrow();
    gate.setUpdateHideSelector = vi.fn(() => {
      throw new Error('x');
    });
    expect(() => api.setMessageUpdateHideSelector('div[')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('Task 11: showForRoll privacy, hooks, show and animateRoll', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  let hooks, me, a;
  const make = (extra = {}) =>
    createDice3dApi({
      diceBox,
      gate,
      planThrow,
      getSetting: (k) => settings[k],
      hooks,
      currentUser: () => me,
      ...extra,
    });
  beforeEach(() => {
    hooks = { callAll: vi.fn() };
    me = { id: 'p1', isGM: false };
    a = make();
  });
  const calls = (name) => hooks.callAll.mock.calls.filter(([n]) => n === name);

  test('a blind showForRoll on a player client throws nothing when showGhostDice is off', async () => {
    await expect(a.showForRoll(roll(20, 12), me, false, null, true)).resolves.toBe(false);
    expect(diceBox.roll).not.toHaveBeenCalled();
  });

  test('a blind showForRoll on a player client throws ghosts when showGhostDice is on', async () => {
    settings.showGhostDice = true;
    const decorateFor = vi.fn(() => () => ({ appearance: { tag: 'real' } }));
    a = make({ decorateFor });
    const p = a.showForRoll(roll(20, 12), me, false, null, true);
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 12, ghost: true }]);
    expect(decorateFor).not.toHaveBeenCalled(); // a ghost never resolves its real look
    diceBox.rolls[0].resolve();
    await expect(p).resolves.toBe(true);
  });

  test('a blind showForRoll on the GM client shows the real dice', async () => {
    me = { id: 'gm', isGM: true };
    a.showForRoll(roll(20, 12), me, false, null, true);
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 12 }]);
  });

  test('options.ghost and roll.ghost throw ghosts; options.secret hides from a player', async () => {
    a.showForRoll(roll(6, 2), me, false, null, false, null, null, { ghost: true });
    a.animateRoll({ ...roll(6, 3), ghost: true });
    await Promise.resolve();
    expect(diceBox.roll.mock.calls).toEqual([
      [[{ type: 'd6', value: 2, ghost: true }]],
      [[{ type: 'd6', value: 3, ghost: true }]],
    ]);
    await expect(a.animateRoll(roll(6, 4), { secret: true })).resolves.toBe(false);
    expect(diceBox.roll).toHaveBeenCalledTimes(2);
  });

  test('showExtra follows the showExtraDice setting', async () => {
    settings.showExtraDice = false;
    const r = {
      dice: [
        {
          faces: 20,
          results: [
            { result: 3, active: true },
            { result: 17, active: false, discarded: true },
          ],
        },
      ],
    };
    a.showForRoll(r, me);
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 3 }]);
  });

  test('animateRoll animates locally like showForRoll without sync', async () => {
    const p = a.animateRoll(roll(8, 5));
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd8', value: 5 }]);
    diceBox.rolls[0].resolve();
    await expect(p).resolves.toBe(true);
  });

  test('show(legacy) throws 2 dice for a 2-die legacy payload', async () => {
    const p = a.show(
      { throws: [{ dice: [{ type: 'd20', result: 7, resultLabel: '7' }, { type: 'd6', result: 2 }] }] },
      me,
    );
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([
      { type: 'd20', value: 7 },
      { type: 'd6', value: 2 },
    ]);
    diceBox.rolls[0].resolve();
    await expect(p).resolves.toBe(true);
  });

  test('show(legacy) maps d100 and dc', async () => {
    a.show({ throws: [{ dice: [{ type: 'd100', result: 42 }] }, { dice: [{ type: 'dc', result: 2 }] }] }, me);
    await Promise.resolve();
    const [specs] = diceBox.roll.mock.calls[0];
    expect(specs.map((d) => d.type)).toEqual(['d10', 'd10', 'd2']);
  });

  test('show() with a malformed payload warns once and resolves false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(a.show(null)).resolves.toBe(false);
    await expect(a.show({ throws: 'x' })).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(diceBox.roll).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('showForRoll with a malformed roll warns once and resolves false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(a.showForRoll(null)).resolves.toBe(false);
    await expect(a.showForRoll('1d20')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('waitFor3DAnimationByMessageID("m1") resolves only after a showForRoll with m1 lands', async () => {
    a.showForRoll(roll(20, 12), me, false, null, false, 'm1');
    let done = false;
    a.waitFor3DAnimationByMessageID('m1').then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    diceBox.rolls[0].resolve();
    await flush();
    expect(done).toBe(true);
    // settled: a later wait on m1 resolves at once (only the gate's promise remains)
    await expect(a.waitFor3DAnimationByMessageID('m1')).resolves.toBe(true);
  });

  test('waitFor3DAnimationByMessageID also waits on the gate', async () => {
    let release;
    gate.waitFor = vi.fn(() => new Promise((r) => (release = r)));
    let done = false;
    a.waitFor3DAnimationByMessageID('m2').then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    release(true);
    await flush();
    expect(done).toBe(true);
  });

  test('without a messageID no hooks fire', async () => {
    const p = a.showForRoll(roll(20, 1), me);
    await Promise.resolve();
    diceBox.rolls[0].resolve();
    await p;
    expect(hooks.callAll).not.toHaveBeenCalled();
  });

  test('with a messageID RollStart fires before the throw and RollComplete once after landing', async () => {
    const r = roll(20, 1);
    let thrownBeforeStart = null;
    hooks.callAll.mockImplementation((name) => {
      if (name === 'diceSoNiceRollStart') thrownBeforeStart = diceBox.roll.mock.calls.length > 0;
    });
    const p = a.showForRoll(r, me, false, ['p1'], false, 'm1');
    expect(calls('diceSoNiceRollStart')).toEqual([
      ['diceSoNiceRollStart', 'm1', { roll: r, user: me, users: ['p1'], blind: false, dsnRoll: r }],
    ]);
    expect(thrownBeforeStart).toBe(false);
    await Promise.resolve();
    expect(calls('diceSoNiceRollComplete')).toHaveLength(0);
    diceBox.rolls[0].resolve();
    await p;
    expect(calls('diceSoNiceRollComplete')).toEqual([['diceSoNiceRollComplete', 'm1', []]]);
  });

  test('RollComplete fires once when nothing animated or the throw fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await a.showForRoll(roll(7, 3), me, false, null, false, 'none');
    diceBox.roll.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await a.showForRoll(roll(20, 3), me, false, null, false, 'fail');
    diceBox.roll.mockImplementationOnce(() => ({ landed: Promise.reject(new Error('lost')) }));
    await a.showForRoll(roll(20, 3), me, false, null, false, 'reject');
    expect(calls('diceSoNiceRollComplete').map(([, id]) => id)).toEqual(['none', 'fail', 'reject']);
    err.mockRestore();
  });

  test('a RollStart listener setting context.blind throws nothing and does not broadcast', async () => {
    const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    me = { id: 'gm', isGM: true };
    a = make({ socket });
    hooks.callAll.mockImplementation((name, id, ctx) => {
      if (name === 'diceSoNiceRollStart') ctx.blind = true;
    });
    await expect(a.showForRoll(roll(20, 3), me, true, null, false, 'm1')).resolves.toBe(false);
    expect(diceBox.roll).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(calls('diceSoNiceRollComplete')).toHaveLength(1);
  });

  test('a RollStart listener cannot un-blind a blind roll', async () => {
    hooks.callAll.mockImplementation((name, id, ctx) => {
      if (name === 'diceSoNiceRollStart') ctx.blind = false;
    });
    await expect(a.showForRoll(roll(20, 3), me, false, null, true, 'm1')).resolves.toBe(false);
    expect(diceBox.roll).not.toHaveBeenCalled();
  });

  test('a ghost or secret flag set during RollStart applies to the whole showForRoll', async () => {
    const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    me = { id: 'gm', isGM: true };
    a = make({ socket });
    hooks.callAll.mockImplementation((name, id, ctx) => {
      if (name === 'diceSoNiceRollStart') ctx.roll.ghost = true;
    });
    a.showForRoll(roll(20, 3), me, true, null, false, 'm1');
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 3, ghost: true }]);
    expect(socket.emit.mock.calls[0][1]).toMatchObject({ ghost: true });

    me = { id: 'p1', isGM: false };
    hooks.callAll.mockImplementation((name, id, ctx) => {
      if (name === 'diceSoNiceRollStart') ctx.dsnRoll = { ...ctx.roll, secret: true };
    });
    await expect(a.showForRoll(roll(20, 4), me, true, null, false, 'm2')).resolves.toBe(false);
    expect(socket.emit.mock.calls[1][1]).toMatchObject({ secret: true });
  });

  test('a RollStart listener can replace the thrown roll through dsnRoll', async () => {
    hooks.callAll.mockImplementation((name, id, ctx) => {
      if (name === 'diceSoNiceRollStart') ctx.dsnRoll = roll(12, 9);
    });
    a.showForRoll(roll(20, 3), me, false, null, false, 'm1');
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd12', value: 9 }]);
  });

  test('a throwing RollStart listener still throws the dice and fires RollComplete', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    hooks.callAll.mockImplementation((name) => {
      if (name === 'diceSoNiceRollStart') throw new Error('listener');
    });
    const p = a.showForRoll(roll(20, 3), me, false, null, false, 'm1');
    await Promise.resolve();
    diceBox.rolls[0].resolve();
    await expect(p).resolves.toBe(true);
    expect(calls('diceSoNiceRollComplete')).toHaveLength(1);
    err.mockRestore();
  });
});

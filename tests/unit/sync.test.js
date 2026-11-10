import { createSync, SOCKET_EVENT, MAX_RESULTS, rollToData } from '../../src/compat/sync.js';
import { createDice3dApi } from '../../src/api/dice3d.js';
import { planThrow } from '../../src/throw/throw-planner.js';

/** A socket.io-like fake: one handler per event, emits recorded (Foundry never echoes). */
function fakeSocket() {
  const handlers = new Map();
  return {
    handlers,
    on: vi.fn((event, fn) => handlers.set(event, fn)),
    off: vi.fn((event, fn) => {
      if (handlers.get(event) === fn) handlers.delete(event);
    }),
    emit: vi.fn(),
    deliver(payload) {
      return handlers.get(SOCKET_EVENT)?.(payload);
    },
  };
}

function fakeDiceBox() {
  const rolls = [];
  return {
    rolls,
    roll: vi.fn((specs) => {
      let resolve;
      const landed = new Promise((r) => (resolve = r));
      rolls.push({ specs, resolve });
      return { landed, finished: landed };
    }),
  };
}

/** Roll.fromData stand-in: accepts the Foundry-shaped data rollToData builds, throws otherwise. */
function fakeFromData(data) {
  if (!Array.isArray(data?.terms)) throw new Error('not roll data');
  return { dice: data.terms.filter((t) => t?.class === 'Die') };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const roll = (...dice) => ({ dice: dice.map(([faces, result]) => ({ faces, results: [{ result, active: true }] })) });

const payload = (o = {}) => ({
  v: 1,
  kind: 'show',
  roll: rollToData(roll([20, 12])),
  userId: 'author',
  users: null,
  blind: false,
  ghost: false,
  secret: false,
  messageID: null,
  speaker: null,
  ...o,
});

describe('createSync', () => {
  test('listens on module.dicer, broadcasts on it, and disposes the listener', () => {
    const socket = fakeSocket();
    const sync = createSync({ socket, currentUser: () => ({ id: 'me' }), onShow: vi.fn() });
    expect(SOCKET_EVENT).toBe('module.dicer');
    expect(socket.on).toHaveBeenCalledWith('module.dicer', expect.any(Function));
    sync.broadcast({ v: 1 });
    expect(socket.emit).toHaveBeenCalledWith('module.dicer', { v: 1 });
    sync.broadcast({ v: 1 }, ['gm']);
    expect(socket.emit).toHaveBeenLastCalledWith('module.dicer', { v: 1 }, { recipients: ['gm'] });
    sync.dispose();
    expect(socket.handlers.size).toBe(0);
  });

  test('passes a valid payload to onShow with the roll parsed', () => {
    const socket = fakeSocket();
    const onShow = vi.fn(async () => {});
    createSync({ socket, currentUser: () => ({ id: 'me' }), onShow, fromData: fakeFromData });
    socket.deliver(payload({ users: ['me', 'other'], messageID: 'm1' }));
    expect(onShow).toHaveBeenCalledTimes(1);
    const got = onShow.mock.calls[0][0];
    expect(got.roll.dice).toHaveLength(1);
    expect(got).toMatchObject({ userId: 'author', users: ['me', 'other'], messageID: 'm1', blind: false });
  });

  test.each([
    ['v: 2', { v: 2 }],
    ["kind: 'x'", { kind: 'x' }],
    ['users excluding me', { users: ['someone-else'] }],
    ['users not an array', { users: 'me' }],
    ['garbage roll', { roll: { garbage: true } }],
    ['no roll', { roll: null }],
  ])('ignores a payload with %s', (_, o) => {
    const socket = fakeSocket();
    const onShow = vi.fn();
    createSync({ socket, currentUser: () => ({ id: 'me' }), onShow, fromData: fakeFromData });
    expect(() => socket.deliver(payload(o))).not.toThrow();
    expect(onShow).not.toHaveBeenCalled();
  });

  test(`ignores a payload with more than ${MAX_RESULTS} results before parsing it`, () => {
    const socket = fakeSocket();
    const onShow = vi.fn();
    const fromData = vi.fn(fakeFromData);
    createSync({ socket, currentUser: () => ({ id: 'me' }), onShow, fromData });
    const many = Array.from({ length: MAX_RESULTS + 1 }, () => [6, 3]);
    socket.deliver(payload({ roll: rollToData(roll(...many)) }));
    expect(fromData).not.toHaveBeenCalled();
    expect(onShow).not.toHaveBeenCalled();
  });

  test('a throwing or rejecting onShow never reaches the socket handler', async () => {
    const socket = fakeSocket();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    createSync({
      socket,
      currentUser: () => ({ id: 'me' }),
      onShow: () => Promise.reject(new Error('x')),
      fromData: fakeFromData,
    });
    expect(() => socket.deliver(payload())).not.toThrow();
    await flush();
    err.mockRestore();
  });
});

describe('showForRoll over the socket', () => {
  let settings;
  /** A client: its own dice box, user and api, sharing one fake socket bus with the others. */
  function client(user, bus) {
    const socket = fakeSocket();
    // Like Foundry's handleCustomSocket: `recipients` limits delivery, else everyone but the sender.
    socket.emit = vi.fn((event, data, options) => {
      for (const other of bus) {
        if (other.socket === socket) continue;
        if (Array.isArray(options?.recipients) && !options.recipients.includes(other.user.id)) continue;
        other.socket.handlers.get(event)?.(data, user.id);
      }
    });
    const diceBox = fakeDiceBox();
    const api = createDice3dApi({
      diceBox,
      gate: { disabled: false, waitFor: async () => true },
      planThrow,
      getSetting: (k) => settings[k],
      socket,
      currentUser: () => user,
      gmIds: () => ['gm'],
      fromData: fakeFromData,
      hooks: { callAll: vi.fn() },
    });
    const c = { user, socket, diceBox, api };
    bus.push(c);
    return c;
  }

  let bus, gm, alice, bob;
  beforeEach(() => {
    settings = { enabled: true, maxDice: 20, showGhostDice: false };
    bus = [];
    gm = client({ id: 'gm', isGM: true }, bus);
    alice = client({ id: 'alice', isGM: false }, bus);
    bob = client({ id: 'bob', isGM: false }, bus);
  });

  test('synchronize broadcasts one payload with users and blind copied', () => {
    alice.api.showForRoll(roll([20, 5]), alice.user, true, ['gm', 'alice'], true, 'm1');
    expect(alice.socket.emit).toHaveBeenCalledTimes(1);
    const [event, sent] = alice.socket.emit.mock.calls[0];
    expect(event).toBe('module.dicer');
    expect(sent).toMatchObject({
      v: 1,
      kind: 'show',
      userId: 'alice',
      users: ['gm', 'alice'],
      blind: true,
      ghost: false,
      secret: false,
      messageID: 'm1',
      speaker: null,
    });
  });

  test('restricted payloads are only delivered to their recipients (P3-R12)', () => {
    alice.api.showForRoll(roll([20, 5]), alice.user, true, ['bob'], false);
    expect(alice.socket.emit.mock.calls[0][2]).toEqual({ recipients: ['gm', 'bob'] });
    alice.api.showForRoll(roll([20, 5]), alice.user, true, null, true);
    expect(alice.socket.emit.mock.calls[1][2]).toEqual({ recipients: ['gm'] });
    alice.api.showForRoll(roll([20, 5]), alice.user, true, ['bob'], false, null, null, { secret: true });
    expect(alice.socket.emit.mock.calls[2][2]).toEqual({ recipients: ['gm'] });
    alice.api.showForRoll(roll([20, 5]), alice.user, true);
    expect(alice.socket.emit.mock.calls[3]).toHaveLength(2); // public: no options, everyone
  });

  test('a blind roll never reaches another player socket', async () => {
    const handler = bob.socket.handlers.get('module.dicer');
    const spy = vi.fn(handler);
    bob.socket.handlers.set('module.dicer', spy);
    alice.api.showForRoll(roll([20, 5]), alice.user, true, null, true);
    await flush();
    expect(spy).not.toHaveBeenCalled();
    expect(gm.diceBox.roll).toHaveBeenCalledTimes(1);
  });

  test('a disabled sender still synchronizes to the other clients (P3-R11)', async () => {
    settings.enabled = false;
    const p = alice.api.showForRoll(roll([20, 5]), alice.user, true);
    expect(alice.socket.emit).toHaveBeenCalledTimes(1);
    await expect(p).resolves.toBe(false);
    expect(alice.diceBox.roll).not.toHaveBeenCalled();
  });

  test('a receiver in users animates, one outside it does not', async () => {
    alice.api.showForRoll(roll([20, 5]), alice.user, true, ['gm', 'alice']);
    await flush();
    expect(gm.diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 5 }]);
    expect(bob.diceBox.roll).not.toHaveBeenCalled();
  });

  test('receiving a secret roll animates nothing on a player client, real dice for the GM', async () => {
    alice.api.showForRoll(roll([20, 5]), alice.user, true, null, false, null, null, { secret: true });
    await flush();
    expect(bob.diceBox.roll).not.toHaveBeenCalled();
    expect(gm.diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 5 }]);
  });

  test('a blind roll shows real dice to the GM and nothing to other players', async () => {
    alice.api.showForRoll(roll([20, 5]), alice.user, true, null, true);
    await flush();
    expect(gm.diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 5 }]);
    expect(bob.diceBox.roll).not.toHaveBeenCalled();
  });

  test('a whispered blind roll shows ghosts to a player recipient when showGhostDice is on', async () => {
    settings.showGhostDice = true;
    alice.api.showForRoll(roll([20, 5]), alice.user, true, ['gm', 'bob'], true);
    await flush();
    const [specs] = bob.diceBox.roll.mock.calls[0];
    expect(specs).toEqual([{ type: 'd20', value: 5, ghost: true }]);
  });

  test('a ghost roll is thrown as ghosts on every receiver, the GM included', async () => {
    alice.api.showForRoll(roll([6, 2]), alice.user, true, null, false, null, null, { ghost: true });
    await flush();
    expect(gm.diceBox.roll).toHaveBeenCalledWith([{ type: 'd6', value: 2, ghost: true }]);
    expect(bob.diceBox.roll).toHaveBeenCalledWith([{ type: 'd6', value: 2, ghost: true }]);
  });

  test('animateRoll never broadcasts', async () => {
    alice.api.animateRoll(roll([20, 5]));
    await flush();
    expect(alice.socket.emit).not.toHaveBeenCalled();
    expect(alice.diceBox.roll).toHaveBeenCalledTimes(1);
  });

  test('without synchronize nothing is broadcast', () => {
    alice.api.showForRoll(roll([20, 5]), alice.user);
    expect(alice.socket.emit).not.toHaveBeenCalled();
  });

  test('show(legacy) with synchronize throws the dice on the receiver too', async () => {
    const legacy = { throws: [{ dice: [{ type: 'd20', result: 7 }, { type: 'd6', result: 3 }] }] };
    alice.api.show(legacy, alice.user, true);
    await flush();
    expect(alice.diceBox.roll).toHaveBeenCalledWith([
      { type: 'd20', value: 7 },
      { type: 'd6', value: 3 },
    ]);
    expect(bob.diceBox.roll).toHaveBeenCalledWith([
      { type: 'd20', value: 7 },
      { type: 'd6', value: 3 },
    ]);
  });

  test('a receiver registers the messageID so waitFor3DAnimationByMessageID waits on it', async () => {
    alice.api.showForRoll(roll([20, 5]), alice.user, true, null, false, 'm9');
    await flush();
    let done = false;
    bob.api.waitFor3DAnimationByMessageID('m9').then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    bob.diceBox.rolls[0].resolve();
    await flush();
    expect(done).toBe(true);
  });

  test('dispose stops receiving', async () => {
    bob.api._dispose();
    alice.api.showForRoll(roll([20, 5]), alice.user, true);
    await flush();
    expect(bob.diceBox.roll).not.toHaveBeenCalled();
  });

  describe('forged payloads are harmless (Review Focus 3)', () => {
    const forge = (o) => bob.socket.handlers.get('module.dicer')(payload(o));

    test('users excluding the receiver: nothing thrown', async () => {
      expect(() => forge({ users: ['someone-else'] })).not.toThrow();
      await flush();
      expect(bob.diceBox.roll).not.toHaveBeenCalled();
    });

    test('500 dice with maxDice 20: at most 20 thrown', async () => {
      const many = Array.from({ length: 500 }, () => [6, 4]);
      expect(() => forge({ roll: rollToData(roll(...many)) })).not.toThrow();
      await flush();
      expect(bob.diceBox.roll).toHaveBeenCalledTimes(1);
      expect(bob.diceBox.roll.mock.calls[0][0].length).toBeLessThanOrEqual(20);
    });

    test.each([
      ['roll: {garbage: true}', { roll: { garbage: true } }],
      ['v: 2', { v: 2 }],
      ["kind: 'x'", { kind: 'x' }],
      ['users: a string', { users: 'bob' }],
      ['roll: a string', { roll: 'd20' }],
    ])('%s: nothing thrown, no exception', async (_, o) => {
      expect(() => forge(o)).not.toThrow();
      await flush();
      expect(bob.diceBox.roll).not.toHaveBeenCalled();
    });

    test('a non-object payload is ignored', async () => {
      const handler = bob.socket.handlers.get('module.dicer');
      for (const p of [null, undefined, 42, 'show', []]) expect(() => handler(p)).not.toThrow();
      await flush();
      expect(bob.diceBox.roll).not.toHaveBeenCalled();
    });

    test('no real face is drawn where the view says none or ghost', async () => {
      // secret to a player: none; blind to a player: none; whispered blind with ghosts: ghost only
      forge({ secret: true });
      forge({ blind: true });
      await flush();
      expect(bob.diceBox.roll).not.toHaveBeenCalled();
      settings.showGhostDice = true;
      forge({ blind: true, users: ['gm', 'bob'] });
      forge({ ghost: true });
      await flush();
      for (const [specs] of bob.diceBox.roll.mock.calls) {
        expect(specs.every((d) => d.ghost === true)).toBe(true);
      }
      expect(bob.diceBox.roll).toHaveBeenCalledTimes(2);
    });
  });
});

import {
  createSync,
  SOCKET_EVENT,
  MAX_RESULTS,
  rollToData,
  ghostRoll,
  ghostRollData,
} from '../../src/compat/sync.js';
import { createDice3dApi } from '../../src/api/dice3d.js';
import { MAX_TRAJECTORY_BYTES } from '../../src/hand/gate-hand.js';
import { planThrow } from '../../src/throw/throw-planner.js';
import { explodingD6, rerolledD20, dynamicCountD6, coin } from './foundry-roll.js';
import { createFxResolver, composeDecorateFor } from '../../src/effects/fx-resolver.js';
import { DEFAULT_RULES } from '../../src/effects/rules.js';

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
      // planThrow's dice keys ('t:r:p') are covered in throw-planner.test.js: compared without them.
      for (const s of specs) delete s.key;
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
const roll = (...dice) => ({
  dice: dice.map(([faces, result]) => ({ faces, results: [{ result, active: true }] })),
});

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
    expect(got).toMatchObject({
      userId: 'author',
      users: ['me', 'other'],
      messageID: 'm1',
      blind: false,
    });
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

describe('anti-spoofing (P3-R15)', () => {
  test('a payload whose userId differs from the server-supplied sender is ignored', () => {
    const socket = fakeSocket();
    const onShow = vi.fn(async () => {});
    createSync({ socket, currentUser: () => ({ id: 'me' }), onShow, fromData: fakeFromData });
    const handler = socket.handlers.get(SOCKET_EVENT);
    expect(() => handler(payload({ userId: 'author' }), 'mallory')).not.toThrow();
    expect(() => handler(payload({ userId: null }), 'mallory')).not.toThrow();
    expect(onShow).not.toHaveBeenCalled();
    handler(payload({ userId: 'author' }), 'author');
    expect(onShow).toHaveBeenCalledTimes(1);
    handler(payload({ userId: 'author' })); // no sender id supplied: not checked
    expect(onShow).toHaveBeenCalledTimes(2);
  });
});

describe('showForRoll over the socket', () => {
  let settings;
  /** A client: its own dice box, user and api, sharing one fake socket bus with the others. */
  function client(user, bus, extra = {}) {
    const socket = fakeSocket();
    // Like Foundry's handleCustomSocket: `recipients` limits delivery, else everyone but the sender.
    socket.emit = vi.fn((event, data, options) => {
      for (const other of bus) {
        if (other.socket === socket) continue;
        if (Array.isArray(options?.recipients) && !options.recipients.includes(other.user.id))
          continue;
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
      ...extra,
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
    alice.api.showForRoll(roll([20, 5]), alice.user, true, ['bob'], false, null, null, {
      secret: true,
    });
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
    alice.api.showForRoll(roll([20, 5]), alice.user, true, null, false, null, null, {
      secret: true,
    });
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
    // P3-R14: the player only ever receives a stripped payload, so the ghost is thrown as a 1.
    expect(specs).toEqual([{ type: 'd20', value: 1, ghost: true }]);
  });

  test('a ghost roll is thrown as ghosts on every receiver, the GM included', async () => {
    alice.api.showForRoll(roll([6, 2]), alice.user, true, null, false, null, null, { ghost: true });
    await flush();
    // P3-R17: only ghost data is sent, so every receiver throws a 1.
    expect(gm.diceBox.roll).toHaveBeenCalledWith([{ type: 'd6', value: 1, ghost: true }]);
    expect(bob.diceBox.roll).toHaveBeenCalledWith([{ type: 'd6', value: 1, ghost: true }]);
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
    const legacy = {
      throws: [
        {
          dice: [
            { type: 'd20', result: 7 },
            { type: 'd6', result: 3 },
          ],
        },
      ],
    };
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

  test("a payload forged in another user's name is ignored by every receiver (P3-R15)", async () => {
    // bob claims the GM sent it; the server tells receivers it came from bob.
    bob.socket.emit('module.dicer', payload({ userId: 'gm' }));
    await flush();
    expect(gm.diceBox.roll).not.toHaveBeenCalled();
    expect(alice.diceBox.roll).not.toHaveBeenCalled();
  });

  describe('ghost-for-everyone rolls (P3-R17)', () => {
    const json = {
      class: 'Roll',
      formula: '1d20',
      options: { degreeOfSuccess: 2 },
      terms: [{ class: 'Die', faces: 20, number: 1, results: [{ result: 17, active: true }] }],
      total: 17,
      evaluated: true,
    };
    const ghostRoll = (extra = {}) => ({
      dice: [{ faces: 20, results: [{ result: 17, active: true }] }],
      toJSON: () => json,
      ...extra,
    });
    const sent = () => alice.socket.emit.mock.calls.map(([, data]) => JSON.stringify(data));

    test.each([
      ['roll.ghost', (a) => a.showForRoll(ghostRoll({ ghost: true }), alice.user, true)],
      [
        'options.ghost',
        (a) =>
          a.showForRoll(ghostRoll(), alice.user, true, null, false, null, null, { ghost: true }),
      ],
    ])('%s: only allow-list ghost data is broadcast, to everyone', async (_, call) => {
      call(alice.api);
      expect(alice.socket.emit).toHaveBeenCalledTimes(1);
      expect(alice.socket.emit.mock.calls[0]).toHaveLength(2); // public
      for (const data of sent()) expect(data).not.toMatch(/17|degreeOfSuccess/);
      await flush();
      expect(gm.diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 1, ghost: true }]);
    });

    test('a ghost flag added in RollStart also sends only ghost data', () => {
      const api = createDice3dApi({
        diceBox: alice.diceBox,
        gate: { disabled: false, waitFor: async () => true },
        planThrow,
        getSetting: (k) => settings[k],
        socket: alice.socket,
        currentUser: () => alice.user,
        gmIds: () => ['gm'],
        fromData: fakeFromData,
        hooks: {
          callAll: (name, id, ctx) => {
            if (name === 'diceSoNiceRollStart') ctx.roll.ghost = true;
          },
        },
      });
      api.showForRoll(ghostRoll(), alice.user, true, null, false, 'm1');
      expect(sent()).toHaveLength(1);
      expect(sent()[0]).not.toMatch(/17|degreeOfSuccess/);
      expect(JSON.parse(sent()[0])).toMatchObject({ ghost: true });
    });
  });

  describe('trigger effects on receivers (privacy)', () => {
    function fxDecorateFor(user, world = DEFAULT_RULES) {
      const fx = createFxResolver({
        getWorldRules: () => world,
        getUserRules: () => undefined,
        currentUser: () => user,
        getSetting: (k) => settings[k] ?? true,
      });
      return composeDecorateFor({ looks: null, fx });
    }
    function fxBus(world) {
      bus.length = 0;
      const mk = (user) => client(user, bus, { decorateFor: fxDecorateFor(user, world) });
      gm = mk({ id: 'gm', isGM: true });
      alice = mk({ id: 'alice', isGM: false });
      bob = mk({ id: 'bob', isGM: false });
    }

    test('a blind nat 20: the GM (real view) gets fx, bob (ghost view) gets none', async () => {
      settings.showGhostDice = true;
      fxBus();
      alice.api.showForRoll(roll([20, 20]), alice.user, true, ['gm', 'bob'], true);
      await flush();
      expect(gm.diceBox.rolls[0].specs[0].fx[0].ruleId).toBe('dicer.nat20');
      expect(bob.diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 1, ghost: true }]);
    });

    test('a receiver reads the outcome from roll.options (there is no message)', async () => {
      const world = [{ id: 'crit', outcome: 'critical-success', effect: { id: 'celebrate' } }];
      const fromData = (data) => ({ ...fakeFromData(data), options: data.options });
      bus.length = 0;
      const mk = (user) => client(user, bus, { decorateFor: fxDecorateFor(user, world), fromData });
      alice = mk({ id: 'alice', isGM: false });
      bob = mk({ id: 'bob', isGM: false });
      const r = roll([20, 14]);
      r.toJSON = () => ({ ...rollToData(roll([20, 14])), options: { degreeOfSuccess: 3 } });
      alice.api.showForRoll(r, alice.user, true);
      await flush();
      expect(bob.diceBox.rolls[0].specs[0].fx[0].ruleId).toBe('crit');
    });

    test("the sender, not the caller's author, is the roller: no macro runs on the author's client", async () => {
      const world = [{ id: 'm', die: 'd20', result: { kind: 'value', value: 20 }, macro: 'Macro.x' }];
      fxBus(world);
      gm.api.showForRoll(roll([20, 20]), alice.user, true);
      await flush();
      expect(alice.diceBox.rolls[0].specs[0].fx[0].macro).toBeNull();
      expect(gm.diceBox.rolls[0].specs[0].fx[0].macro).toBe('Macro.x');
    });
  });

  describe('author vs sender (P3-R18)', () => {
    test("a GM's showForRoll for a player animates on receivers with the player's look", async () => {
      const decorateFor = vi.fn(() => () => ({ appearance: { tag: 'look' } }));
      bus.length = 0;
      gm = client({ id: 'gm', isGM: true }, bus);
      alice = client({ id: 'alice', isGM: false }, bus);
      bob = client({ id: 'bob', isGM: false }, bus, { decorateFor });
      gm.api.showForRoll(roll([20, 5]), alice.user, true);
      expect(gm.socket.emit.mock.calls[0][1]).toMatchObject({ userId: 'gm', authorId: 'alice' });
      await flush();
      expect(bob.diceBox.roll).toHaveBeenCalledWith([
        { type: 'd20', value: 5, appearance: { tag: 'look' } },
      ]);
      expect(decorateFor).toHaveBeenCalledWith(null, expect.anything(), 'alice', 'gm');
    });

    test('a forged userId is still rejected, whatever authorId says', async () => {
      bob.socket.emit('module.dicer', payload({ userId: 'gm', authorId: 'alice' }));
      await flush();
      expect(gm.diceBox.roll).not.toHaveBeenCalled();
      expect(alice.diceBox.roll).not.toHaveBeenCalled();
    });

    test('privacy uses the sender, not the author: a blind roll made for bob shows bob nothing', async () => {
      settings.showGhostDice = true;
      gm.api.showForRoll(roll([20, 5]), bob.user, true, null, true);
      await flush();
      expect(bob.diceBox.roll).not.toHaveBeenCalled();
    });
  });

  describe('blind rolls on the wire (P3-R14)', () => {
    /** Every payload each client's socket receives, as the server would deliver it. */
    function record(c) {
      const got = [];
      const handler = c.socket.handlers.get('module.dicer');
      c.socket.handlers.set('module.dicer', (data, sender) => {
        got.push(JSON.parse(JSON.stringify(data)));
        return handler(data, sender);
      });
      return got;
    }
    /** Every number in a JSON tree. */
    const numbers = (node, out = []) => {
      if (typeof node === 'number') out.push(node);
      else if (node && typeof node === 'object')
        for (const v of Object.values(node)) numbers(v, out);
      return out;
    };
    /** A Foundry-like Roll: nested pool rolls, a success flag and totals in its JSON. */
    const richRoll = () => ({
      dice: [{ faces: 20, results: [{ result: 17, active: true }] }],
      toJSON: () => ({
        class: 'Roll',
        formula: '1d20 + {1d8}',
        terms: [
          {
            class: 'Die',
            faces: 20,
            number: 1,
            results: [{ result: 17, active: true, success: true, count: 1 }],
          },
          {
            class: 'PoolTerm',
            rolls: [
              {
                class: 'Roll',
                terms: [{ class: 'Die', faces: 8, results: [{ result: 7, active: true }] }],
                total: 7,
              },
            ],
            results: [{ result: 7, active: true }],
          },
        ],
        total: 24,
        _total: 24,
        evaluated: true,
      }),
    });

    /** A Foundry-like Roll whose JSON is `json`; `dice` is what the sender throws locally. */
    const rollWith = (json, dice = [{ faces: 20, results: [{ result: 17, active: true }] }]) => ({
      dice,
      toJSON: () => json,
    });
    /** Bob's whole payload: no number but 1 and the face counts, no option, flag or term but Die. */
    function expectGhostOnly(got, faces) {
      expect(got.roll).toMatchObject({ class: 'Roll', formula: '', options: {}, evaluated: true });
      const allowed = new Set([0, 1, ...faces]); // 0: a term whose dice count was unusable
      expect(numbers(got).filter((n) => !allowed.has(n))).toEqual([]);
      for (const term of got.roll.terms) {
        expect(Object.keys(term).sort()).toEqual(['class', 'faces', 'number', 'results']);
        expect(term.class).toBe('Die');
        expect(term.results).toEqual(
          Array.from({ length: term.number }, () => ({ result: 1, active: true })),
        );
      }
      const text = JSON.stringify(got);
      expect(text).not.toMatch(
        /degreeOfSuccess|success|count|total|flavor|exploded|modifiers|Function|Pool/,
      );
    }

    test('the real results go to GMs only; listed players get an allow-list ghost payload', async () => {
      settings.showGhostDice = true;
      const toGm = record(gm);
      const toBob = record(bob);
      alice.api.showForRoll(richRoll(), alice.user, true, ['gm', 'bob'], true);
      expect(alice.socket.emit).toHaveBeenCalledTimes(2);
      expect(alice.socket.emit.mock.calls[0][2]).toEqual({ recipients: ['gm'] });
      expect(alice.socket.emit.mock.calls[1][2]).toEqual({ recipients: ['bob'] });
      await flush();
      expect(numbers(toGm[0].roll)).toEqual(expect.arrayContaining([17, 7, 24]));
      expect(toBob).toHaveLength(1);
      expect(toBob[0]).toMatchObject({
        ghost: true,
        blind: true,
        users: ['gm', 'bob'],
        userId: 'alice',
      });
      // The pool's d8 carries no dice count: it arrives as 0 dice.
      expect(toBob[0].roll.terms).toEqual([
        { class: 'Die', faces: 20, number: 1, results: [{ result: 1, active: true }] },
        { class: 'Die', faces: 8, number: 0, results: [] },
      ]);
      expectGhostOnly(toBob[0], [20, 8]);
      expect(gm.diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 17 }]);
      expect(bob.diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 1, ghost: true }]);
    });

    test("pf2e's options.degreeOfSuccess never reaches a player (P3-R16)", async () => {
      settings.showGhostDice = true;
      const toBob = record(bob);
      const json = {
        class: 'CheckRoll',
        formula: '1d20 + 5',
        options: { degreeOfSuccess: 3, type: 'check', dc: { value: 15 } },
        terms: [
          {
            class: 'Die',
            faces: 20,
            number: 1,
            results: [{ result: 17, active: true }],
            options: { flavor: 'x' },
          },
          { class: 'OperatorTerm', operator: '+' },
          { class: 'NumericTerm', number: 5 },
        ],
        total: 22,
        evaluated: true,
      };
      alice.api.showForRoll(rollWith(json), alice.user, true, ['gm', 'bob'], true);
      await flush();
      expect(toBob).toHaveLength(1);
      expectGhostOnly(toBob[0], [20]);
      expect(toBob[0].roll.terms).toHaveLength(1);
      expect(bob.diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 1, ghost: true }]);
    });

    test("a FunctionTerm's evaluated result never reaches a player (P3-R16)", async () => {
      settings.showGhostDice = true;
      const toBob = record(bob);
      const inner = { class: 'Die', faces: 20, number: 1, results: [{ result: 17, active: true }] };
      const json = {
        class: 'Roll',
        formula: 'max(1d20, 10)',
        terms: [
          {
            class: 'FunctionTerm',
            fn: 'max',
            terms: ['1d20', '10'],
            rolls: [{ class: 'Roll', terms: [inner], total: 17 }],
            result: 17,
          },
        ],
        total: 17,
        evaluated: true,
      };
      alice.api.showForRoll(rollWith(json), alice.user, true, ['gm', 'bob'], true);
      await flush();
      expectGhostOnly(toBob[0], [20]);
      expect(toBob[0].roll.terms).toHaveLength(1);
    });

    test('an exploding 1d6x with 3 results arrives as exactly 1 ghost die (P3-R16)', async () => {
      settings.showGhostDice = true;
      const toBob = record(bob);
      const results = [6, 6, 2].map((result, i) => ({ result, active: true, exploded: i < 2 }));
      const json = {
        class: 'Roll',
        formula: '1d6x',
        terms: [{ class: 'Die', faces: 6, number: 1, modifiers: ['x'], results }],
        total: 14,
        evaluated: true,
      };
      alice.api.showForRoll(
        rollWith(json, [{ faces: 6, results }]),
        alice.user,
        true,
        ['gm', 'bob'],
        true,
      );
      await flush();
      expectGhostOnly(toBob[0], [6]);
      expect(toBob[0].roll.terms[0].results).toHaveLength(1);
      expect(bob.diceBox.roll).toHaveBeenCalledWith([{ type: 'd6', value: 1, ghost: true }]);
    });

    test('a dynamic (1d4)d6 or 1d(1d20) never leaks its inner total as number or faces (P3-R19)', async () => {
      settings.showGhostDice = true;
      const toBob = record(bob);
      // As Foundry's DiceTerm.toJSON writes them: the number/faces getters give the inner
      // roll's total, and _number/_faces hold the inner roll.
      const inner = (faces, total) => ({
        class: 'Roll',
        formula: `1d${faces}`,
        terms: [{ class: 'Die', number: 1, faces, results: [{ result: total, active: true }] }],
        total,
        evaluated: true,
      });
      const json = {
        class: 'Roll',
        formula: '(1d4)d6 + 1d(1d20)',
        terms: [
          {
            class: 'Die',
            number: 3,
            faces: 6,
            _number: inner(4, 3),
            results: [5, 2, 6].map((result) => ({ result, active: true })),
          },
          { class: 'OperatorTerm', operator: '+' },
          {
            class: 'Die',
            number: 1,
            faces: 17,
            _faces: inner(20, 17),
            results: [{ result: 9, active: true }],
          },
          { class: 'Die', number: 1.5, faces: 6, results: [] },
          { class: 'Die', number: 1, faces: '6', results: [] },
        ],
        total: 22,
        evaluated: true,
      };
      const local = [{ faces: 6, results: [{ result: 5, active: true }] }];
      alice.api.showForRoll(rollWith(json, local), alice.user, true, ['gm', 'bob'], true);
      await flush();
      expect(toBob).toHaveLength(1);
      // (1d4)d6 keeps its static d6 shape with 0 dice; 1d(1d20) and the non-integer faces send nothing.
      expect(toBob[0].roll.terms).toEqual([
        { class: 'Die', faces: 6, number: 0, results: [] },
        { class: 'Die', faces: 6, number: 0, results: [] },
      ]);
      expectGhostOnly(toBob[0], [6]);
      const all = numbers(toBob[0]);
      expect(all).not.toContain(3);
      expect(all).not.toContain(17);
    });

    test('a d100 still arrives as a d10 pair; an absurd or missing count is 0 dice', async () => {
      settings.showGhostDice = true;
      const toBob = record(bob);
      const d100 = { faces: 100, results: [{ result: 42, active: true }] };
      const json = {
        class: 'Roll',
        terms: [
          { class: 'Die', number: 1, ...d100 },
          { class: 'Die', faces: 6, number: 1e9, results: [] },
          { class: 'Die', faces: 6, number: 'NaN', results: [] },
        ],
      };
      alice.api.showForRoll(rollWith(json, [d100]), alice.user, true, ['gm', 'bob'], true);
      await flush();
      expect(toBob[0].roll.terms.map((t) => t.number)).toEqual([1, 0, 0]);
      expectGhostOnly(toBob[0], [100, 6]);
      const [specs] = bob.diceBox.roll.mock.calls[0];
      expect(specs.map((d) => [d.type, d.ghost])).toEqual([
        ['d10', true],
        ['d10', true],
      ]);
    });

    test('without showGhostDice the listed players receive nothing at all', async () => {
      settings.showGhostDice = false;
      const toBob = record(bob);
      alice.api.showForRoll(richRoll(), alice.user, true, ['gm', 'bob'], true);
      expect(alice.socket.emit).toHaveBeenCalledTimes(1);
      expect(alice.socket.emit.mock.calls[0][2]).toEqual({ recipients: ['gm'] });
      await flush();
      expect(toBob).toHaveLength(0);
    });

    test('a blind roll with no listed users never reaches a player socket, ghosts on or off', async () => {
      settings.showGhostDice = true;
      const toBob = record(bob);
      alice.api.showForRoll(roll([20, 5]), alice.user, true, null, true);
      await flush();
      expect(toBob).toHaveLength(0);
    });

    test('a blind secret roll goes to GMs only, even to listed players with ghosts on', async () => {
      settings.showGhostDice = true;
      const toBob = record(bob);
      alice.api.showForRoll(roll([20, 5]), alice.user, true, ['bob'], true, null, null, {
        secret: true,
      });
      await flush();
      expect(toBob).toHaveLength(0);
      expect(alice.socket.emit).toHaveBeenCalledTimes(1);
    });
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

describe('ghostRoll (P3-R20: every ghost render uses the wire ghost shape)', () => {
  const ones = (n) => Array.from({ length: n }, () => ({ result: 1, active: true }));

  test('an exploding 1d6x with 3 results is one ghost die', () => {
    const g = ghostRoll(explodingD6());
    expect(g.dice).toHaveLength(1);
    expect(g.dice[0]).toMatchObject({ faces: 6, number: 1, results: ones(1) });
    expect(planThrow(g).dice).toEqual([{ type: 'd6', value: 1, key: '0:0:0' }]);
  });

  test('a rerolled 1d20r1 with 2 results is one ghost die', () => {
    expect(planThrow(ghostRoll(rerolledD20())).dice).toEqual([{ type: 'd20', value: 1, key: '0:0:0' }]);
  });

  test('a dynamic count (1d4)d6 is no dice', () => {
    expect(planThrow(ghostRoll(dynamicCountD6())).dice).toEqual([]);
  });

  test('matches ghostRollData term for term', () => {
    const r = explodingD6();
    const wire = ghostRollData(r.toJSON());
    expect(
      ghostRoll(r).dice.map(({ faces, number, results }) => ({ faces, number, results })),
    ).toEqual(wire.terms.map(({ faces, number, results }) => ({ faces, number, results })));
  });

  test('keeps the term class, so shapeFor still finds a coin', () => {
    const shapeFor = (t) => (t.constructor?.DENOMINATION === 'c' ? 'dc' : null);
    expect(planThrow(ghostRoll(coin()), { shapeFor }).dice).toEqual([{ type: 'dc', value: 1, variant: 'dc', key: '0:0:0' }]);
  });

  test('a legacy Roll-like shape uses its number when given, else its result count', () => {
    const legacy = {
      dice: [
        { faces: 6, number: 1, results: [{ result: 6 }, { result: 3 }] },
        { faces: 8, results: [{ result: 2 }] },
      ],
    };
    expect(planThrow(ghostRoll(legacy)).dice).toEqual([
      { type: 'd6', value: 1, key: '0:0:0' },
      { type: 'd8', value: 1, key: '1:0:0' },
    ]);
    expect(ghostRoll(null).dice).toEqual([]);
  });

  test('never copies results, options or flavor', () => {
    const r = explodingD6();
    r.dice[0].options = { flavor: 'secret', appearance: { colorset: 'x' } };
    expect(JSON.stringify(ghostRoll(r))).not.toMatch(/secret|colorset|exploded|"6",|result":6/);
  });
});

describe('rollToData on a Roll-like object without toJSON', () => {
  it('keeps the die number, so a ghost never counts explosions', () => {
    const exploded = {
      dice: [
        {
          faces: 6,
          number: 1,
          results: [{ result: 6 }, { result: 6 }, { result: 3 }],
        },
      ],
    };
    const ghost = ghostRollData(rollToData(exploded));
    expect(ghost.terms).toHaveLength(1);
    expect(ghost.terms[0].number).toBe(1);
    expect(ghost.terms[0].results).toEqual([{ result: 1, active: true }]);
  });

  it('marks a dynamic number or faces, so the ghost drops it', () => {
    const inner = { total: 4 };
    const data = rollToData({
      dice: [
        { faces: 6, number: 4, _number: inner, results: [1, 2, 3, 4].map((result) => ({ result })) },
        { faces: 12, number: 1, _faces: inner, results: [{ result: 9 }] },
      ],
    });
    const ghost = ghostRollData(data);
    expect(ghost.terms).toHaveLength(1);
    expect(ghost.terms[0].number).toBe(0);
    expect(ghost.terms[0].results).toEqual([]);
  });

  it('falls back to the result count when no number is given (legacy show shape)', () => {
    const data = rollToData({ dice: [{ faces: 20, results: [{ result: 7 }, { result: 13 }] }] });
    expect(data.terms[0].number).toBe(2);
  });
});

describe('Task 8: kind hand', () => {
  const traj = (o = {}) => ({ v: 1, n: 1, pos: 'AAAA', rot: 'AAAA', last: 'AAAA', events: '', ...o });
  const hand = (o = {}) => ({ v: 1, kind: 'hand', id: 'h1', messageId: 'm1', userId: 'a', trajectory: traj(), ...o });
  const make = () => {
    const socket = fakeSocket();
    const onShow = vi.fn();
    const onHand = vi.fn();
    createSync({ socket, currentUser: () => ({ id: 'me' }), onShow, onHand, fromData: fakeFromData });
    const deliver = (p, sender) => socket.handlers.get(SOCKET_EVENT)(p, sender);
    return { socket, onShow, onHand, deliver };
  };

  test('kind hand reaches onHand only with a matching sender', () => {
    const { onShow, onHand, deliver } = make();
    deliver(hand(), 'a');
    expect(onHand).toHaveBeenCalledTimes(1);
    expect(onHand).toHaveBeenCalledWith(hand(), 'a');
    deliver(hand(), 'b'); // spoofed: userId a, sent by b
    deliver(hand()); // no verified sender
    deliver(hand({ v: 2 }), 'a');
    deliver(hand({ trajectory: null }), 'a');
    deliver(hand({ trajectory: 'x' }), 'a');
    expect(onHand).toHaveBeenCalledTimes(1);
    expect(onShow).not.toHaveBeenCalled();
  });

  test('oversized hand payload ignored', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { onHand, deliver } = make();
    const big = 'A'.repeat(MAX_TRAJECTORY_BYTES);
    deliver(hand({ trajectory: traj({ pos: big }) }), 'a');
    deliver(hand({ trajectory: traj({ rot: big.slice(8), last: big.slice(8) }) }), 'a');
    expect(onHand).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1); // one warning
    deliver(hand({ trajectory: traj({ pos: big.slice(200) }) }), 'a'); // fits, as JSON
    expect(onHand).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('a throwing onHand never reaches the socket handler', () => {
    const socket = fakeSocket();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    createSync({ socket, currentUser: () => ({ id: 'me' }), onShow: vi.fn(), onHand: () => { throw new Error('x'); } });
    expect(() => socket.handlers.get(SOCKET_EVENT)(hand(), 'a')).not.toThrow();
    err.mockRestore();
  });

  test('show path unchanged', () => {
    const { onShow, onHand, deliver } = make();
    deliver(payload({ users: ['me'] }), 'author');
    expect(onShow).toHaveBeenCalledTimes(1);
    deliver(payload({ users: ['me'] }), 'other'); // P3-R15 as before
    expect(onShow).toHaveBeenCalledTimes(1);
    deliver({ ...payload(), kind: 'hand' }, 'author'); // a show body labelled hand is no show
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onHand).not.toHaveBeenCalled();
  });

  test('without onHand a hand payload is ignored', () => {
    const socket = fakeSocket();
    createSync({ socket, currentUser: () => ({ id: 'me' }), onShow: vi.fn() });
    expect(() => socket.handlers.get(SOCKET_EVENT)(hand(), 'a')).not.toThrow();
  });
});

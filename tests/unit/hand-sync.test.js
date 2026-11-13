/**
 * Task 8: the thrower sends its recorded hand throw only to the users whose view is real (G1), and
 * a receiver's hand gate buffers it until its chat message is there (P6-D2).
 */
import { readFileSync } from 'node:fs';
import { createSync, SOCKET_EVENT } from '../../src/compat/sync.js';
import {
  createHandGate,
  isHandRoll,
  HAND_BUFFER_MS,
  HAND_REPLAY_WAIT_MS,
  MAX_TRAJECTORY_BYTES,
} from '../../src/hand/gate-hand.js';
import { handRecipients, sendHand } from '../../src/hand/chunk/send.js';
import { handThrows } from '../../src/hand/chunk/resolve.js';
import * as chunk from '../../src/hand/hand.js';
import { recordingOf, handD20 } from './hand-fixtures.js';

const GMS = ['gm'];
const msg = (o = {}) => ({ id: 'm1', whisper: [], blind: false, rolls: [handD20()], ...o });

test('constants', () => {
  expect(HAND_REPLAY_WAIT_MS).toBe(4000);
  expect(HAND_BUFFER_MS).toBe(30000);
  expect(MAX_TRAJECTORY_BYTES).toBe(chunk.MAX_TRAJECTORY_BYTES);
});

test('recipients: public -> all but self; whisper -> recipients + GMs; blind -> GMs; secret roll -> GMs; ghost roll -> nobody', () => {
  // null: everyone the server reaches, which never includes the sender.
  expect(handRecipients(msg(), GMS, 'me')).toBeNull();
  expect(handRecipients(msg({ whisper: ['p2', 'me'] }), GMS, 'me')).toEqual(['gm', 'p2']);
  expect(handRecipients(msg({ whisper: ['p2'] }), ['me', 'gm2'], 'me')).toEqual(['gm2', 'p2']);
  expect(handRecipients(msg({ blind: true, whisper: ['gm'] }), GMS, 'me')).toEqual(['gm']);
  expect(handRecipients(msg({ blind: true }), ['gm', 'me'], 'me')).toEqual(['gm']);
  const secret = { ...handD20(), secret: true };
  expect(handRecipients(msg({ rolls: [secret] }), GMS, 'me')).toEqual(['gm']);
  expect(handRecipients(msg({ rolls: [handD20(), secret], whisper: ['p2'] }), GMS, 'me')).toEqual(['gm']);
  const ghost = { ...handD20(), ghost: true };
  expect(handRecipients(msg({ rolls: [ghost] }), GMS, 'me')).toEqual([]);
  expect(handRecipients(msg({ rolls: [handD20(), ghost], whisper: ['p2'] }), GMS, 'me')).toEqual([]);
});

/** A fake server: module socket emits reach every other client, or only `recipients` (P3-R12). */
function fakeServer() {
  const clients = new Map();
  return {
    client(id) {
      const handlers = new Map();
      const socket = {
        on: (e, fn) => handlers.set(e, fn),
        off: () => {},
        emit: vi.fn((e, data, opts) => {
          for (const [other, h] of clients) {
            if (other === id) continue; // never echoed to the sender
            if (opts?.recipients && !opts.recipients.includes(other)) continue;
            h.get(e)?.(JSON.parse(JSON.stringify(data)), id);
          }
        }),
      };
      clients.set(id, handlers);
      return socket;
    },
  };
}

describe('sending', () => {
  let server, onHand, syncs;
  const ids = ['me', 'gm', 'p2', 'p3'];
  beforeEach(() => {
    server = fakeServer();
    onHand = {};
    syncs = {};
    for (const id of ids) {
      onHand[id] = vi.fn();
      syncs[id] = createSync({
        socket: server.client(id),
        currentUser: () => ({ id }),
        onShow: vi.fn(),
        onHand: onHand[id],
      });
    }
    handThrows.clear();
  });
  const store = (id = 'h1') =>
    handThrows.set(id, {
      recording: recordingOf([{ shapeType: 'd20', key: '0:0:0', face: 17 }]),
      handle: {},
      specs: [],
      extras: [],
    });
  const send = (message) =>
    sendHand(message, {
      broadcast: (p, r) => syncs.me.broadcast(p, r),
      gms: GMS,
      selfId: 'me',
    });
  const rollBy = (o) => handD20([17], { by: 'me', ...o });

  test('a player not allowed to see a whispered hand roll receives nothing (socket spy)', () => {
    store();
    send(msg({ whisper: ['p2'], rolls: [rollBy()] }));
    expect(onHand.p2).toHaveBeenCalledTimes(1);
    expect(onHand.gm).toHaveBeenCalledTimes(1);
    expect(onHand.p3).not.toHaveBeenCalled();
    expect(onHand.me).not.toHaveBeenCalled();
    const [payload, sender] = onHand.p2.mock.calls[0];
    expect(sender).toBe('me');
    expect(payload).toMatchObject({ v: 1, kind: 'hand', id: 'h1', messageId: 'm1', userId: 'me' });
    expect(payload.trajectory).toMatchObject({ v: 1, n: 1, keys: ['0:0:0'], shapes: ['d20'] });
    expect(handThrows.has('h1')).toBe(false); // dropped once sent
  });

  test('a public hand roll reaches every other user; a ghost or secret one is never sent to players', () => {
    store();
    send(msg({ rolls: [rollBy()] }));
    expect(['gm', 'p2', 'p3'].map((id) => onHand[id].mock.calls.length)).toEqual([1, 1, 1]);
    store();
    send(msg({ rolls: [{ ...rollBy(), ghost: true }] }));
    expect(['gm', 'p2', 'p3'].map((id) => onHand[id].mock.calls.length)).toEqual([1, 1, 1]);
    expect(handThrows.has('h1')).toBe(false);
    store();
    send(msg({ rolls: [{ ...rollBy(), secret: true }] }));
    expect(['gm', 'p2', 'p3'].map((id) => onHand[id].mock.calls.length)).toEqual([2, 1, 1]);
  });

  test('only this user\'s own non-fallback hand rolls with a stored throw are sent', () => {
    store();
    send(msg({ rolls: [handD20([17], { by: 'other' })] }));
    send(msg({ rolls: [rollBy({ fallback: 'timeout' })] }));
    send(msg({ rolls: [rollBy({ id: 'unknown' })] }));
    expect(onHand.p2).not.toHaveBeenCalled();
    expect(handThrows.has('h1')).toBe(true);
  });

  test('by default it emits on the module socket, limited server-side to the recipients', () => {
    const emit = vi.fn();
    vi.stubGlobal('game', {
      socket: { emit },
      user: { id: 'me' },
      users: [{ id: 'gm', isGM: true }, { id: 'me', isGM: false }, { id: 'p2', isGM: false }],
    });
    try {
      store();
      sendHand(msg({ whisper: ['p2'], rolls: [rollBy()] }));
      expect(emit).toHaveBeenCalledWith(SOCKET_EVENT, expect.objectContaining({ kind: 'hand', userId: 'me' }), {
        recipients: ['gm', 'p2'],
      });
      store();
      sendHand(msg({ rolls: [rollBy()] }));
      expect(emit).toHaveBeenLastCalledWith(SOCKET_EVENT, expect.objectContaining({ kind: 'hand' }));
      expect(emit.mock.lastCall).toHaveLength(2); // public: no recipients option, everyone
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('an oversized recording is not sent (the encoder gives null); the entry is still dropped', () => {
    handThrows.set('h1', { recording: { dice: [] }, handle: {}, specs: [], extras: [] });
    send(msg({ rolls: [rollBy()] }));
    expect(onHand.p2).not.toHaveBeenCalled();
    expect(handThrows.has('h1')).toBe(false);
  });
});

describe('the hand gate', () => {
  let t, gate, importChunk;
  const traj = (key = '0:0:0', face = 17) =>
    chunk.encodeTrajectory(recordingOf([{ shapeType: 'd20', key, face }]));
  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
    importChunk = vi.fn(() => Promise.resolve(chunk));
    gate = createHandGate({ importChunk, now: () => t });
  });
  afterEach(() => vi.useRealTimers());
  const payload = (o = {}) => ({ v: 1, kind: 'hand', id: 'h1', messageId: 'm1', userId: 'a', trajectory: traj(), ...o });

  test('isHand: a non-fallback dicerHand with dice thrown', () => {
    expect(gate.isHand(handD20())).toBe(true);
    expect(isHandRoll(handD20([17], { fallback: 'cancel' }))).toBe(false);
    expect(isHandRoll(handD20([17], { n: 0 }))).toBe(false);
    expect(isHandRoll({ dice: [] })).toBe(false);
    expect(isHandRoll(null)).toBe(false);
  });

  test('payload before message and message before payload both replay', async () => {
    gate.accept(payload(), 'a');
    await expect(gate.waitFor('m1', 'h1', 'a')).resolves.toMatchObject({ n: 1, keys: ['0:0:0'], shapes: ['d20'] });
    const later = gate.waitFor('m2', 'h1', 'a');
    await vi.advanceTimersByTimeAsync(1000);
    gate.accept(payload({ messageId: 'm2', trajectory: traj('0:1:0') }), 'a');
    await expect(later).resolves.toMatchObject({ keys: ['0:1:0'] });
    // A payload is used once.
    let again = 'pending';
    gate.waitFor('m1', 'h1', 'a').then((v) => (again = v));
    await vi.advanceTimersByTimeAsync(HAND_REPLAY_WAIT_MS);
    expect(again).toBeNull();
  });

  test('a payload from another sender than the author never matches: null after HAND_REPLAY_WAIT_MS', async () => {
    gate.accept(payload({ userId: 'b' }), 'b');
    let out = 'pending';
    gate.waitFor('m1', 'h1', 'a').then((v) => (out = v));
    gate.accept(payload({ userId: 'b' }), 'b');
    await vi.advanceTimersByTimeAsync(HAND_REPLAY_WAIT_MS - 1);
    expect(out).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(out).toBeNull();
  });

  test('buffer entries expire after HAND_BUFFER_MS', async () => {
    gate.accept(payload(), 'a');
    await vi.advanceTimersByTimeAsync(0);
    t = HAND_BUFFER_MS + 1;
    let out = 'pending';
    gate.waitFor('m1', 'h1', 'a').then((v) => (out = v));
    await vi.advanceTimersByTimeAsync(HAND_REPLAY_WAIT_MS);
    expect(out).toBeNull();
    // Within HAND_BUFFER_MS it is still there.
    gate.accept(payload(), 'a');
    await vi.advanceTimersByTimeAsync(0);
    t += HAND_BUFFER_MS;
    await expect(gate.waitFor('m1', 'h1', 'a')).resolves.toMatchObject({ n: 1 });
  });

  test('a malformed payload or a missing chunk resolves null, never throws', async () => {
    expect(() => gate.accept(null, 'a')).not.toThrow();
    expect(() => gate.accept({ id: 3 }, 'a')).not.toThrow();
    gate.accept(payload({ trajectory: { v: 1, n: 'x' } }), 'a');
    await expect(gate.waitFor('m1', 'h1', 'a')).resolves.toBeNull();
    const broken = createHandGate({ importChunk: () => Promise.resolve(null) });
    broken.accept(payload(), 'a');
    await expect(broken.waitFor('m1', 'h1', 'a')).resolves.toBeNull();
    const failing = createHandGate({ importChunk: () => Promise.reject(new Error('offline')) });
    expect(() => failing.accept(payload(), 'a')).not.toThrow();
    await expect(failing.waitFor('m1', 'h1', 'a')).resolves.toBeNull();
    expect(failing.replay({}, {})).toBeNull();
  });

  test('an early payload fetches the chunk at once (the receiver loads it on demand)', () => {
    gate.accept(payload(), 'a');
    expect(importChunk).toHaveBeenCalledTimes(1);
  });

  test('replay never throws: a failing replayFor is null', async () => {
    gate.accept(payload(), 'a');
    const d = await gate.waitFor('m1', 'h1', 'a');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const roll = handD20([17], { by: 'a' });
    expect(gate.replay(d, { roll, author: 'a', specs: null, full: () => [], cast: vi.fn() })).toBeNull();
    // Not the author who threw it: null, without warning.
    expect(gate.replay(d, { roll, author: 'b', specs: [], full: () => [], cast: vi.fn() })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('ownHandle reads the stored throw synchronously from the loaded chunk', () => {
    handThrows.set('h1', { handle: 'H', recording: null, specs: [], extras: [] });
    const g = createHandGate({ importChunk, chunkNow: () => chunk });
    expect(g.ownHandle(handD20())).toBe('H');
    expect(g.ownHandle(handD20([17], { id: 'zz' }))).toBeNull();
    expect(createHandGate({ importChunk }).ownHandle(handD20())).toBeNull();
    handThrows.clear();
  });
});

test('main.js: the hand gate feeds the message gate and the socket; the thrower sends after the gate', () => {
  const src = readFileSync('src/main.js', 'utf8').replace(/\r\n/g, '\n');
  expect(src).toContain('createHandGate({ importChunk: () => loadHand(box), chunkNow: handNow })');
  expect(src).toMatch(/createMessageGate\(\{[^}]*\n\s+hand,\n/);
  expect(src).toContain('onHand: hand.accept,');
  const create = src.slice(src.indexOf("Hooks.on('createChatMessage'"));
  expect(create.indexOf('handlers().onCreate(message)')).toBeLessThan(create.indexOf('handNow()?.sendHand(message)'));
  const update = src.slice(src.indexOf("Hooks.on('updateChatMessage'"));
  expect(update.indexOf('handlers().onUpdate(message, changes)')).toBeLessThan(update.indexOf('handNow()?.sendHand(message)'));
});

test('SOCKET_EVENT carries the hand payloads too', () => {
  expect(SOCKET_EVENT).toBe('module.dicer');
});

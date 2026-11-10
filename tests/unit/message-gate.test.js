// @vitest-environment jsdom
import { createMessageGate, WATCHDOG_MS } from '../../src/foundry/message-gate.js';
import { planThrow as realPlanThrow } from '../../src/throw/throw-planner.js';

const COMPLETE = 'diceSoNiceRollComplete';

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

function fakeHooks() {
  return {
    calls: [],
    listeners: {},
    callAll(name, ...a) {
      this.calls.push([name, ...a]);
      for (const fn of this.listeners[name] ?? []) fn(...a);
    },
    named(name) {
      return this.calls.filter((c) => c[0] === name);
    },
  };
}

function fakeDiceBox() {
  const rolls = [];
  return {
    rolls,
    activeRolls: 0,
    roll: vi.fn((specs) => {
      const landed = deferred();
      const finished = deferred();
      rolls.push({ specs, landed, finished });
      return { landed: landed.promise, finished: finished.promise };
    }),
  };
}

const d20Roll = (result = 17) => ({ dice: [{ faces: 20, results: [{ result, active: true }] }] });

function message(id = 'm1', extra = {}) {
  return { id, rolls: [d20Roll()], isContentVisible: true, flags: {}, user: {}, ...extra };
}

function li(id) {
  const el = document.createElement('li');
  el.dataset.messageId = id;
  document.body.appendChild(el);
  return el;
}

/** Let promise callbacks (landed.then) run. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let hooks, diceBox, settings, gate, errorSpy;

function makeGate(overrides = {}) {
  return createMessageGate({
    diceBox,
    planThrow: realPlanThrow,
    hooks,
    getSetting: (k) => settings[k],
    documentRef: document,
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  hooks = fakeHooks();
  diceBox = fakeDiceBox();
  settings = { enabled: true, maxDice: 20 };
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  gate = makeGate();
});

afterEach(() => {
  vi.useRealTimers();
  errorSpy.mockRestore();
});

test('WATCHDOG_MS is 15000', () => {
  expect(WATCHDOG_MS).toBe(15000);
});

test('hides the message (dsn-hide on render and on an already-rendered element), fires MessageProcessed(willTrigger3DRoll true) and RollStart(id, {roll, user, users, blind:false, dsnRoll})', () => {
  const existing = li('m1');
  const msg = message();
  gate.onCreate(msg);
  expect(existing.classList.contains('dsn-hide')).toBe(true);
  expect(gate.isAnimating('m1')).toBe(true);

  const rendered = document.createElement('li');
  rendered.dataset.messageId = 'm1';
  gate.onRender(msg, rendered);
  expect(rendered.classList.contains('dsn-hide')).toBe(true);

  expect(hooks.named('diceSoNiceMessageProcessed')).toEqual([
    ['diceSoNiceMessageProcessed', 'm1', { willTrigger3DRoll: true }],
  ]);
  const start = hooks.named('diceSoNiceRollStart');
  expect(start).toHaveLength(1);
  expect(start[0][1]).toBe('m1');
  expect(start[0][2]).toEqual({
    roll: msg.rolls[0],
    user: msg.user,
    users: [],
    blind: false,
    dsnRoll: msg.rolls[0],
  });
  // MessageProcessed precedes RollStart.
  expect(hooks.calls.map((c) => c[0])).toEqual([
    'diceSoNiceMessageProcessed',
    'diceSoNiceRollStart',
  ]);
  expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 17 }]);
});

test('on landed: removes dsn-hide and fires diceSoNiceRollComplete(id) exactly once', async () => {
  const el = li('m1');
  gate.onCreate(message());
  const rendered = document.createElement('li');
  gate.onRender(message(), rendered);
  expect(hooks.named(COMPLETE)).toEqual([]);
  diceBox.rolls[0].landed.resolve();
  await flush();
  expect(el.classList.contains('dsn-hide')).toBe(false);
  expect(rendered.classList.contains('dsn-hide')).toBe(false);
  expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1']]);
  expect(gate.isAnimating('m1')).toBe(false);
  vi.advanceTimersByTime(WATCHDOG_MS + 1);
  await flush();
  expect(hooks.named(COMPLETE)).toHaveLength(1);
});

test('RollStart listener setting context.blind=true → no animation, message revealed, RollComplete once', async () => {
  const el = li('m1');
  hooks.listeners.diceSoNiceRollStart = [(id, ctx) => (ctx.blind = true)];
  gate.onCreate(message());
  await flush();
  expect(diceBox.roll).not.toHaveBeenCalled();
  expect(el.classList.contains('dsn-hide')).toBe(false);
  expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1']]);
  vi.advanceTimersByTime(WATCHDOG_MS + 1);
  expect(hooks.named(COMPLETE)).toHaveLength(1);
});

test('RollStart listener replacing context.dsnRoll → the replacement is thrown', () => {
  hooks.listeners.diceSoNiceRollStart = [(id, ctx) => (ctx.dsnRoll = d20Roll(3))];
  gate.onCreate(message());
  expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 3 }]);
});

test('not visible (isContentVisible false) → never animated, never hidden, MessageProcessed(willTrigger3DRoll false)', () => {
  const el = li('m1');
  const msg = message('m1', { isContentVisible: false });
  gate.onCreate(msg);
  const rendered = document.createElement('li');
  gate.onRender(msg, rendered);
  expect(diceBox.roll).not.toHaveBeenCalled();
  expect(el.classList.contains('dsn-hide')).toBe(false);
  expect(rendered.classList.contains('dsn-hide')).toBe(false);
  expect(hooks.named('diceSoNiceMessageProcessed')).toEqual([
    ['diceSoNiceMessageProcessed', 'm1', { willTrigger3DRoll: false }],
  ]);
  expect(hooks.named('diceSoNiceRollStart')).toEqual([]);
  expect(hooks.named(COMPLETE)).toEqual([]);
});

test("flags['dice-so-nice'].skip → not animated", () => {
  const el = li('m1');
  gate.onCreate(message('m1', { flags: { 'dice-so-nice': { skip: true } } }));
  expect(diceBox.roll).not.toHaveBeenCalled();
  expect(el.classList.contains('dsn-hide')).toBe(false);
  expect(gate.isAnimating('m1')).toBe(false);
});

test('no animatable dice (planThrow returns empty) → not hidden, MessageProcessed false', () => {
  const el = li('m1');
  const msg = message('m1', { rolls: [{ dice: [{ faces: 7, results: [{ result: 3 }] }] }] });
  gate.onCreate(msg);
  expect(diceBox.roll).not.toHaveBeenCalled();
  expect(el.classList.contains('dsn-hide')).toBe(false);
  expect(hooks.named('diceSoNiceMessageProcessed')).toEqual([
    ['diceSoNiceMessageProcessed', 'm1', { willTrigger3DRoll: false }],
  ]);
});

test('a message without rolls fires nothing', () => {
  gate.onCreate(message('m1', { rolls: [] }));
  expect(hooks.calls).toEqual([]);
  expect(diceBox.roll).not.toHaveBeenCalled();
});

test('enabled setting false or gate.disabled → not animated', () => {
  const el = li('m1');
  settings.enabled = false;
  gate.onCreate(message());
  expect(diceBox.roll).not.toHaveBeenCalled();
  expect(el.classList.contains('dsn-hide')).toBe(false);

  settings.enabled = true;
  gate.disabled = true;
  expect(gate.disabled).toBe(true);
  gate.onCreate(message());
  expect(diceBox.roll).not.toHaveBeenCalled();
  expect(el.classList.contains('dsn-hide')).toBe(false);
  expect(hooks.named(COMPLETE)).toEqual([]);
});

test('watchdog: landed never resolves → revealed and RollComplete fired at 15000 ms, once; a later landed does not fire again', async () => {
  const el = li('m1');
  gate.onCreate(message());
  vi.advanceTimersByTime(WATCHDOG_MS - 1);
  await flush();
  expect(el.classList.contains('dsn-hide')).toBe(true);
  expect(hooks.named(COMPLETE)).toEqual([]);
  vi.advanceTimersByTime(1);
  await flush();
  expect(el.classList.contains('dsn-hide')).toBe(false);
  expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1']]);
  diceBox.rolls[0].landed.resolve();
  await flush();
  expect(hooks.named(COMPLETE)).toHaveLength(1);
});

test('diceBox.roll throws synchronously → revealed immediately, RollComplete once, error logged', async () => {
  const el = li('m1');
  diceBox.roll.mockImplementation(() => {
    throw new Error('boom');
  });
  gate.onCreate(message());
  expect(el.classList.contains('dsn-hide')).toBe(false);
  expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1']]);
  expect(errorSpy).toHaveBeenCalled();
  vi.advanceTimersByTime(WATCHDOG_MS + 1);
  await flush();
  expect(hooks.named(COMPLETE)).toHaveLength(1);
});

test('deleted mid-animation → RollComplete once, waitFor resolves true, later landed fires nothing', async () => {
  gate.onCreate(message());
  const wait = gate.waitFor('m1');
  gate.onDelete({ id: 'm1' });
  expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1']]);
  await expect(wait).resolves.toBe(true);
  diceBox.rolls[0].landed.resolve();
  await flush();
  vi.advanceTimersByTime(WATCHDOG_MS + 1);
  expect(hooks.named(COMPLETE)).toHaveLength(1);
});

test('two messages created in the same tick → both hidden, each revealed by its own landed', async () => {
  const a = li('a');
  const b = li('b');
  gate.onCreate(message('a'));
  gate.onCreate(message('b'));
  expect(a.classList.contains('dsn-hide')).toBe(true);
  expect(b.classList.contains('dsn-hide')).toBe(true);
  diceBox.rolls[1].landed.resolve();
  await flush();
  expect(a.classList.contains('dsn-hide')).toBe(true);
  expect(b.classList.contains('dsn-hide')).toBe(false);
  expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'b']]);
  diceBox.rolls[0].landed.resolve();
  await flush();
  expect(a.classList.contains('dsn-hide')).toBe(false);
  expect(hooks.named(COMPLETE)).toEqual([
    [COMPLETE, 'b'],
    [COMPLETE, 'a'],
  ]);
});

test('a message with several rolls is revealed only when all have landed', async () => {
  const el = li('m1');
  gate.onCreate(message('m1', { rolls: [d20Roll(1), d20Roll(2)] }));
  expect(diceBox.roll).toHaveBeenCalledTimes(2);
  diceBox.rolls[0].landed.resolve();
  await flush();
  expect(el.classList.contains('dsn-hide')).toBe(true);
  diceBox.rolls[1].landed.resolve();
  await flush();
  expect(el.classList.contains('dsn-hide')).toBe(false);
  expect(hooks.named(COMPLETE)).toHaveLength(1);
});

test('waitFor(id) resolves true once the animation completes', async () => {
  gate.onCreate(message());
  let done = false;
  gate.waitFor('m1').then((v) => (done = v));
  await flush();
  expect(done).toBe(false);
  diceBox.rolls[0].landed.resolve();
  await flush();
  expect(done).toBe(true);
});

test('waitFor(id) on an unknown id resolves true immediately', async () => {
  await expect(gate.waitFor('nope')).resolves.toBe(true);
});

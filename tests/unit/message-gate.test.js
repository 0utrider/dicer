// @vitest-environment jsdom
import { createMessageGate, WATCHDOG_MS } from '../../src/foundry/message-gate.js';
import { planThrow as realPlanThrow } from '../../src/throw/throw-planner.js';

const COMPLETE = 'diceSoNiceRollComplete';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
  return { id, rolls: [d20Roll()], isContentVisible: true, flags: {}, author: {}, ...extra };
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
    user: msg.author,
    users: null,
    blind: false,
    dsnRoll: msg.rolls[0],
  });
  expect(start[0][2].user).toBe(msg.author);
  // MessageProcessed precedes RollStart.
  expect(hooks.calls.map((c) => c[0])).toEqual([
    'diceSoNiceMessagePreProcess',
    'diceSoNiceMessageProcessed',
    'diceSoNiceRollStart',
  ]);
  expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 17 }]);
});

test('on landed: removes dsn-hide and fires diceSoNiceRollComplete(id, []) exactly once', async () => {
  const el = li('m1');
  gate.onCreate(message());
  const rendered = document.createElement('li');
  gate.onRender(message(), rendered);
  expect(hooks.named(COMPLETE)).toEqual([]);
  diceBox.rolls[0].landed.resolve();
  await flush();
  expect(el.classList.contains('dsn-hide')).toBe(false);
  expect(rendered.classList.contains('dsn-hide')).toBe(false);
  expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);
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
  expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);
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

test('decorateFor decorates the dice with the message as context; a throwing one is ignored', () => {
  const decorateFor = vi.fn(() => () => ({ appearance: { tag: 'remote' } }));
  const g = makeGate({ decorateFor });
  const msg = message('m1', { author: { id: 'remote' } });
  g.onCreate(msg);
  expect(decorateFor).toHaveBeenCalledWith(msg, msg.rolls[0]);
  expect(diceBox.rolls[0].specs).toEqual([
    { type: 'd20', value: 17, appearance: { tag: 'remote' } },
  ]);

  const broken = makeGate({
    decorateFor: () => {
      throw new Error('x');
    },
  });
  broken.onCreate(message('m2'));
  expect(diceBox.rolls[1].specs).toEqual([{ type: 'd20', value: 17 }]);
});

test('a message without rolls fires PreProcess then MessageProcessed(willTrigger3DRoll false)', () => {
  gate.onCreate(message('m1', { rolls: [] }));
  gate.onCreate(message('m2', { rolls: undefined }));
  expect(hooks.calls).toEqual([
    ['diceSoNiceMessagePreProcess', 'm1', { willTrigger3DRoll: true }],
    ['diceSoNiceMessageProcessed', 'm1', { willTrigger3DRoll: false }],
    ['diceSoNiceMessagePreProcess', 'm2', { willTrigger3DRoll: true }],
    ['diceSoNiceMessageProcessed', 'm2', { willTrigger3DRoll: false }],
  ]);
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
  expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);
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
  expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);
  expect(errorSpy).toHaveBeenCalled();
  vi.advanceTimersByTime(WATCHDOG_MS + 1);
  await flush();
  expect(hooks.named(COMPLETE)).toHaveLength(1);
});

test('deleted mid-animation → RollComplete once, waitFor resolves true, later landed fires nothing', async () => {
  gate.onCreate(message());
  const wait = gate.waitFor('m1');
  gate.onDelete({ id: 'm1' });
  expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);
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
  expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'b', []]]);
  diceBox.rolls[0].landed.resolve();
  await flush();
  expect(a.classList.contains('dsn-hide')).toBe(false);
  expect(hooks.named(COMPLETE)).toEqual([
    [COMPLETE, 'b', []],
    [COMPLETE, 'a', []],
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

describe('privacy matrix', () => {
  const player = { id: 'p1', isGM: false };
  const gm = { id: 'gm', isGM: true };
  const priv = (user, extra = {}) => makeGate({ currentUser: () => user, ...extra });

  test('a whisper the user is not in, showGhostDice false: no dice, MessageProcessed(false)', () => {
    const el = li('m1');
    const g = priv(player);
    g.onCreate(message('m1', { isContentVisible: false, whisper: ['x'], author: { id: 'x' } }));
    expect(diceBox.roll).not.toHaveBeenCalled();
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(hooks.named('diceSoNiceMessageProcessed')).toEqual([
      ['diceSoNiceMessageProcessed', 'm1', { willTrigger3DRoll: false }],
    ]);
    expect(hooks.named(COMPLETE)).toEqual([]);
  });

  test('the same with showGhostDice true: all ghosts, hidden until landing, RollComplete once', async () => {
    settings.showGhostDice = true;
    const el = li('m1');
    const decorateFor = vi.fn(() => () => ({ appearance: { tag: 'real-look' } }));
    const g = priv(player, { decorateFor });
    g.onCreate(message('m1', { isContentVisible: false, whisper: ['x'], author: { id: 'x' } }));
    expect(decorateFor).not.toHaveBeenCalled();
    expect(diceBox.rolls).toHaveLength(1);
    expect(diceBox.rolls[0].specs).toEqual([{ type: 'd20', value: 17, ghost: true }]);
    expect(el.classList.contains('dsn-hide')).toBe(true);
    expect(hooks.named('diceSoNiceMessageProcessed')[0][2]).toEqual({ willTrigger3DRoll: true });
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);
  });

  describe('a blind roll (Foundry whispers it to the GM ids)', () => {
    const blindMsg = (id, visible = false) =>
      message(id, { isContentVisible: visible, blind: true, whisper: ['gm'], author: { id: 'p1' } });

    test('the author, not a recipient: ghost with showGhostDice, none without; never real', () => {
      priv(player).onCreate(blindMsg('m1'));
      expect(diceBox.roll).not.toHaveBeenCalled();

      settings.showGhostDice = true;
      priv(player).onCreate(blindMsg('m2'));
      expect(diceBox.rolls).toHaveLength(1);
      expect(diceBox.rolls[0].specs).toEqual([{ type: 'd20', value: 17, ghost: true }]);
    });

    test('another player, not a recipient: ghost with showGhostDice (whispered), none without', () => {
      const other = { id: 'p2', isGM: false };
      priv(other).onCreate(blindMsg('m1'));
      expect(diceBox.roll).not.toHaveBeenCalled();

      settings.showGhostDice = true;
      priv(other).onCreate(blindMsg('m2'));
      expect(diceBox.rolls[0].specs).toEqual([{ type: 'd20', value: 17, ghost: true }]);
    });

    test('the GM sees it for real', () => {
      priv(gm).onCreate(blindMsg('m1', true));
      expect(diceBox.rolls[0].specs).toEqual([{ type: 'd20', value: 17 }]);
    });
  });

  describe('a RollStart listener flagging a roll applies to the whole message (pf2e)', () => {
    const two = () => [d20Roll(4), d20Roll(8)];

    test('ctx.roll.ghost = true on a two-roll message: every roll is a ghost', () => {
      hooks.listeners.diceSoNiceRollStart = [(id, ctx) => (ctx.roll.ghost = true)];
      priv(player).onCreate(message('m1', { rolls: two() }));
      expect(diceBox.rolls).toHaveLength(2);
      for (const r of diceBox.rolls) expect(r.specs.every((s) => s.ghost === true)).toBe(true);
    });

    test('ctx.dsnRoll replaced with a ghost roll: every roll is a ghost', () => {
      hooks.listeners.diceSoNiceRollStart = [
        (id, ctx) => (ctx.dsnRoll = { ...d20Roll(3), ghost: true }),
      ];
      priv(player).onCreate(message('m1', { rolls: two() }));
      expect(diceBox.rolls).toHaveLength(2);
      for (const r of diceBox.rolls) expect(r.specs.every((s) => s.ghost === true)).toBe(true);
    });

    test('ctx.roll replaced with a ghost roll: every roll is a ghost', () => {
      hooks.listeners.diceSoNiceRollStart = [
        (id, ctx) => (ctx.roll = { ...d20Roll(3), ghost: true }),
      ];
      priv(player).onCreate(message('m1', { rolls: two() }));
      expect(diceBox.rolls).toHaveLength(2);
      for (const r of diceBox.rolls) expect(r.specs.every((s) => s.ghost === true)).toBe(true);
    });

    test('ctx.dsnRoll replaced with a secret roll on a player client: none', () => {
      hooks.listeners.diceSoNiceRollStart = [
        (id, ctx) => (ctx.dsnRoll = { ...d20Roll(3), secret: true }),
      ];
      priv(player).onCreate(message('m1', { rolls: two() }));
      expect(diceBox.roll).not.toHaveBeenCalled();
    });

    test('ctx.roll replaced with a secret roll on a player client: none', () => {
      hooks.listeners.diceSoNiceRollStart = [
        (id, ctx) => (ctx.roll = { ...d20Roll(3), secret: true }),
      ];
      priv(player).onCreate(message('m1', { rolls: two() }));
      expect(diceBox.roll).not.toHaveBeenCalled();
    });

    test('ctx.roll.secret = true on a player client: none for every roll', () => {
      hooks.listeners.diceSoNiceRollStart = [(id, ctx) => (ctx.roll.secret = true)];
      priv(player).onCreate(message('m1', { rolls: two() }));
      expect(diceBox.roll).not.toHaveBeenCalled();
    });

    test('a roll that was already ghost before RollStart stays per roll', () => {
      const rolls = [{ ...d20Roll(4), ghost: true }, d20Roll(8)];
      priv(player).onCreate(message('m1', { rolls }));
      expect(diceBox.rolls[0].specs[0].ghost).toBe(true);
      expect(diceBox.rolls[1].specs[0].ghost).toBeUndefined();
    });
  });

  test('roll.secret on a player client: none; on a GM client that sees it: real', () => {
    const secret = { ...d20Roll(), secret: true };
    priv(player).onCreate(message('m1', { rolls: [secret] }));
    expect(diceBox.roll).not.toHaveBeenCalled();
    expect(hooks.named('diceSoNiceMessageProcessed')[0][2]).toEqual({ willTrigger3DRoll: false });

    priv(gm).onCreate(message('m2', { rolls: [secret] }));
    expect(diceBox.rolls[0].specs).toEqual([{ type: 'd20', value: 17 }]);
  });

  test('two rolls, one roll.ghost: one ghost group (no real look resolved) and one real group', () => {
    const decorateFor = vi.fn(() => () => ({ appearance: { tag: 'real-look' } }));
    const ghostRoll = { ...d20Roll(5), ghost: true };
    priv(player, { decorateFor }).onCreate(message('m1', { rolls: [ghostRoll, d20Roll(9)] }));
    expect(diceBox.rolls[0].specs).toEqual([{ type: 'd20', value: 5, ghost: true }]);
    expect(diceBox.rolls[1].specs).toEqual([
      { type: 'd20', value: 9, appearance: { tag: 'real-look' } },
    ]);
    // Only the real roll's look is resolved, once: the eligibility plan is reused for the throw.
    expect(decorateFor).toHaveBeenCalledTimes(1);
    for (const call of decorateFor.mock.calls) expect(call[1]).not.toBe(ghostRoll);
  });

  test('a ghost-only message is hidden and revealed on landing, even for a player who sees it', async () => {
    const el = li('m1');
    priv(player).onCreate(message('m1', { rolls: [{ ...d20Roll(), ghost: true }] }));
    expect(el.classList.contains('dsn-hide')).toBe(true);
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(hooks.named(COMPLETE)).toHaveLength(1);
  });

  test('a RollStart listener cannot swap a secret roll for a visible one', () => {
    hooks.listeners.diceSoNiceRollStart = [(id, ctx) => (ctx.dsnRoll = d20Roll(3))];
    priv(player).onCreate(message('m1', { rolls: [{ ...d20Roll(), secret: true }] }));
    expect(diceBox.roll).not.toHaveBeenCalled();
  });

  test('context.blind forces none: nothing thrown even for real rolls, revealed once', async () => {
    const el = li('m1');
    hooks.listeners.diceSoNiceRollStart = [(id, ctx) => (ctx.blind = true)];
    priv(player).onCreate(message('m1', { rolls: [d20Roll(), { ...d20Roll(2), ghost: true }] }));
    await flush();
    expect(diceBox.roll).not.toHaveBeenCalled();
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);
  });

  test('without a current user nothing is treated as GM or author', () => {
    const g = makeGate({ currentUser: () => undefined });
    g.onCreate(message('m1', { rolls: [{ ...d20Roll(), secret: true }] }));
    expect(diceBox.roll).not.toHaveBeenCalled();
  });
});

describe('reveal scrolls the chat log (Foundry only scrolls on append, while the message is hidden)', () => {
  function chatUi(isAtBottom) {
    return { isAtBottom, scrollBottom: vi.fn(async () => {}) };
  }

  test('at the bottom → scrollBottom({ popout: true }) after dsn-hide is removed', async () => {
    const el = li('m1');
    const ui = chatUi(true);
    let hiddenWhenScrolled = null;
    ui.scrollBottom.mockImplementation(async () => {
      hiddenWhenScrolled = el.classList.contains('dsn-hide');
    });
    gate = makeGate({ chatUi: ui, currentUserId: () => 'me' });
    gate.onCreate(message('m1', { author: { id: 'other' } }));
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(ui.scrollBottom).toHaveBeenCalledTimes(1);
    expect(ui.scrollBottom).toHaveBeenCalledWith({ popout: true });
    expect(hiddenWhenScrolled).toBe(false);
  });

  test("scrolled up, someone else's roll → no scroll", async () => {
    li('m1');
    const ui = chatUi(false);
    gate = makeGate({ chatUi: ui, currentUserId: () => 'me' });
    gate.onCreate(message('m1', { author: { id: 'other' } }));
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(ui.scrollBottom).not.toHaveBeenCalled();
    expect(hooks.named(COMPLETE)).toHaveLength(1);
  });

  test('scrolled up, own roll → scrolls (mirrors Foundry: isAtBottom || author is the user)', async () => {
    li('m1');
    const ui = chatUi(false);
    gate = makeGate({ chatUi: ui, currentUserId: () => 'me' });
    gate.onCreate(message('m1', { author: { id: 'me' } }));
    vi.advanceTimersByTime(WATCHDOG_MS); // the watchdog reveal scrolls too
    await flush();
    expect(ui.scrollBottom).toHaveBeenCalledWith({ popout: true });
  });

  test('isAtBottom is read before dsn-hide is removed', async () => {
    const el = li('m1');
    const ui = {
      get isAtBottom() {
        return el.classList.contains('dsn-hide'); // true only while still hidden
      },
      scrollBottom: vi.fn(async () => {}),
    };
    gate = makeGate({ chatUi: ui, currentUserId: () => 'me' });
    gate.onCreate(message('m1', { author: { id: 'other' } }));
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(ui.scrollBottom).toHaveBeenCalledTimes(1);
  });

  test('a deleted message does not scroll', () => {
    li('m1');
    const ui = chatUi(true);
    gate = makeGate({ chatUi: ui, currentUserId: () => 'me' });
    gate.onCreate(message());
    gate.onDelete({ id: 'm1' });
    expect(ui.scrollBottom).not.toHaveBeenCalled();
  });

  test('a throwing or rejecting scrollBottom still fires RollComplete once', async () => {
    li('m1');
    const ui = chatUi(true);
    ui.scrollBottom.mockImplementation(() => {
      throw new Error('boom');
    });
    gate = makeGate({ chatUi: ui, currentUserId: () => 'me' });
    gate.onCreate(message());
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);

    const ui2 = chatUi(true);
    ui2.scrollBottom.mockImplementation(() => Promise.reject(new Error('later')));
    gate = makeGate({ chatUi: ui2, currentUserId: () => 'me' });
    li('m2');
    gate.onCreate(message('m2'));
    diceBox.rolls[1].landed.resolve();
    await flush();
    expect(hooks.named(COMPLETE)).toHaveLength(2);
  });

  test('no chat UI (tests, early startup) → reveal still works', async () => {
    const el = li('m1');
    gate = makeGate({ chatUi: null });
    gate.onCreate(message());
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(el.classList.contains('dsn-hide')).toBe(false);
  });
});

describe('chat notification cards (#chat-notifications, Foundry element._lifeSpan)', () => {
  /** Mimics ChatLog#postNotification: the card is rendered, connected, then _lifeSpan = 0. */
  function postCard(id) {
    let box = document.getElementById('chat-notifications');
    if (!box) {
      box = document.createElement('div');
      box.id = 'chat-notifications';
      box.innerHTML = '<div class="overflow"><ol class="chat-log"></ol></div>';
      document.body.appendChild(box);
    }
    const card = document.createElement('li');
    card.className = 'chat-message message';
    card.dataset.messageId = id;
    return { box, card, connect: () => box.querySelector('.chat-log').append(card) };
  }
  /** One ChatLog#checkNotificationLifeSpan tick (NOTIFY_TICKER 500, NOTIFY_DURATION 5000). */
  const tick = (card) => {
    card._lifeSpan += 500;
    return card._lifeSpan >= 5000; // true → Foundry would dismiss it
  };

  test('a card hidden longer than NOTIFY_DURATION is not dismissed, and gets a fresh lifespan on reveal', async () => {
    gate.onCreate(message());
    const { card, connect } = postCard('m1');
    gate.onRender(message(), card); // renderChatMessageHTML fires before the card is connected
    connect();
    vi.advanceTimersByTime(0);
    card._lifeSpan = 0; // Foundry, at the end of the insertion animation
    for (let i = 0; i < 20; i++) expect(tick(card)).toBe(false); // 10 s hidden
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(card.classList.contains('dsn-hide')).toBe(false);
    expect(card._lifeSpan).toBe(0);
    for (let i = 0; i < 9; i++) expect(tick(card)).toBe(false);
    expect(tick(card)).toBe(true); // normal 5 s life after the reveal
  });

  test('a card whose lifespan already ran is reset on reveal', async () => {
    gate.onCreate(message());
    const { card, connect } = postCard('m1');
    connect();
    card._lifeSpan = 3500; // posted before the gate could pin it
    card.classList.add('dsn-hide');
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(card._lifeSpan).toBe(0);
  });

  test('chat-log messages (outside #chat-notifications) never get a _lifeSpan', async () => {
    const el = li('m1');
    gate.onCreate(message());
    const rendered = document.createElement('li');
    rendered.dataset.messageId = 'm1';
    gate.onRender(message(), rendered);
    document.body.appendChild(rendered);
    vi.advanceTimersByTime(0);
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect('_lifeSpan' in el).toBe(false);
    expect('_lifeSpan' in rendered).toBe(false);
  });
});

describe('message lifecycle depth', () => {
  const PRE = 'diceSoNiceMessagePreProcess';
  const PROCESSED = 'diceSoNiceMessageProcessed';
  const linked = (target, scope = 'dice-so-nice') => ({ flags: { [scope]: { linkedTo: target } } });
  /** A d20 roll ordered by roll.options.rollOrder. */
  const ordered = (result, order) => ({ ...d20Roll(result), options: { rollOrder: order } });
  /** A d20 roll ordered by its terms' lowest options.rollOrder. */
  const termOrdered = (result, order) => ({
    ...d20Roll(result),
    terms: [{ options: { rollOrder: order + 5 } }, { options: { rollOrder: order } }, {}],
  });

  test('PreProcess fires first, with { willTrigger3DRoll: true }', () => {
    gate.onCreate(message());
    expect(hooks.calls[0]).toEqual([PRE, 'm1', { willTrigger3DRoll: true }]);
  });

  test('a PreProcess listener cancelling: no dice, not hidden, Processed(false), no RollStart or RollComplete', () => {
    const el = li('m1');
    hooks.listeners[PRE] = [(id, interception) => (interception.willTrigger3DRoll = false)];
    gate.onCreate(message());
    const rendered = document.createElement('li');
    gate.onRender(message(), rendered);
    expect(diceBox.roll).not.toHaveBeenCalled();
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(rendered.classList.contains('dsn-hide')).toBe(false);
    expect(hooks.named(PROCESSED)).toEqual([[PROCESSED, 'm1', { willTrigger3DRoll: false }]]);
    expect(hooks.named('diceSoNiceRollStart')).toEqual([]);
    expect(hooks.named(COMPLETE)).toEqual([]);
  });

  test('a throwing PreProcess listener is logged and the message still animates', () => {
    hooks.listeners[PRE] = [
      () => {
        throw new Error('listener');
      },
    ];
    gate.onCreate(message());
    expect(errorSpy).toHaveBeenCalled();
    expect(diceBox.roll).toHaveBeenCalledTimes(1);
  });

  test('context.users is message.whisper when non-empty, else null', () => {
    gate.onCreate(message('m1', { whisper: ['a', 'b'] }));
    gate.onCreate(message('m2', { whisper: [] }));
    const starts = hooks.named('diceSoNiceRollStart');
    expect(starts[0][2].users).toEqual(['a', 'b']);
    expect(starts[1][2].users).toBeNull();
  });

  test('planThrow runs once per roll (the eligibility plan is reused for the throw)', () => {
    const planThrow = vi.fn(realPlanThrow);
    makeGate({ planThrow }).onCreate(message('m1', { rolls: [d20Roll(1), d20Roll(2)] }));
    expect(planThrow).toHaveBeenCalledTimes(2);
    expect(diceBox.roll).toHaveBeenCalledTimes(2);
  });

  test('a RollStart listener that changes the views gets a fresh plan', () => {
    hooks.listeners.diceSoNiceRollStart = [(id, ctx) => (ctx.roll.ghost = true)];
    makeGate({ currentUser: () => ({ id: 'p1' }) }).onCreate(message());
    expect(diceBox.rolls[0].specs).toEqual([{ type: 'd20', value: 17, ghost: true }]);
  });

  describe('showExtraDice', () => {
    const withDiscard = () => ({
      dice: [
        {
          faces: 20,
          results: [
            { result: 17, active: true },
            { result: 3, active: false, discarded: true },
          ],
        },
      ],
    });

    test('unset or true: discarded dice are thrown', () => {
      gate.onCreate(message('m1', { rolls: [withDiscard()] }));
      settings.showExtraDice = true;
      gate.onCreate(message('m2', { rolls: [withDiscard()] }));
      expect(diceBox.rolls[0].specs).toHaveLength(2);
      expect(diceBox.rolls[1].specs).toHaveLength(2);
    });

    test('false: only the active dice are thrown', () => {
      settings.showExtraDice = false;
      gate.onCreate(message('m1', { rolls: [withDiscard()] }));
      expect(diceBox.rolls[0].specs).toEqual([{ type: 'd20', value: 17 }]);
    });
  });

  describe('roll order', () => {
    test('orders 2 and 1: 1 is thrown first, 2 only after it lands, RollComplete once after both', async () => {
      const el = li('m1');
      gate.onCreate(message('m1', { rolls: [ordered(2, 2), ordered(1, 1)] }));
      expect(diceBox.rolls.map((r) => r.specs[0].value)).toEqual([1]);
      await flush();
      expect(diceBox.rolls).toHaveLength(1);
      diceBox.rolls[0].landed.resolve();
      await flush();
      expect(diceBox.rolls.map((r) => r.specs[0].value)).toEqual([1, 2]);
      expect(el.classList.contains('dsn-hide')).toBe(true);
      expect(hooks.named(COMPLETE)).toEqual([]);
      diceBox.rolls[1].landed.resolve();
      await flush();
      expect(el.classList.contains('dsn-hide')).toBe(false);
      expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);
      expect(hooks.named('diceSoNiceRollStart')).toHaveLength(1);
    });

    test('the lowest term.options.rollOrder orders a roll; rolls without an order go in group 0', async () => {
      gate.onCreate(message('m1', { rolls: [termOrdered(5, 1), d20Roll(9), ordered(6, 0)] }));
      expect(diceBox.rolls.map((r) => r.specs[0].value)).toEqual([9, 6]);
      diceBox.rolls[0].landed.resolve();
      await flush();
      expect(diceBox.rolls).toHaveLength(2); // the whole group must land
      diceBox.rolls[1].landed.resolve();
      await flush();
      expect(diceBox.rolls.map((r) => r.specs[0].value)).toEqual([9, 6, 5]);
    });

    test('the watchdog runs per group, measured from that group start', async () => {
      const el = li('m1');
      gate.onCreate(message('m1', { rolls: [ordered(1, 1), ordered(2, 2)] }));
      vi.advanceTimersByTime(WATCHDOG_MS - 1000);
      diceBox.rolls[0].landed.resolve();
      await flush();
      expect(diceBox.rolls).toHaveLength(2);
      vi.advanceTimersByTime(WATCHDOG_MS - 1);
      await flush();
      expect(el.classList.contains('dsn-hide')).toBe(true);
      expect(hooks.named(COMPLETE)).toEqual([]);
      vi.advanceTimersByTime(1);
      await flush();
      expect(el.classList.contains('dsn-hide')).toBe(false);
      expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);
    });

    test('a group watchdog reveals once and the remaining groups are skipped', async () => {
      gate.onCreate(message('m1', { rolls: [ordered(1, 1), ordered(2, 2)] }));
      vi.advanceTimersByTime(WATCHDOG_MS);
      await flush();
      expect(hooks.named(COMPLETE)).toHaveLength(1);
      diceBox.rolls[0].landed.resolve();
      await flush();
      expect(diceBox.rolls).toHaveLength(1);
      expect(hooks.named(COMPLETE)).toHaveLength(1);
    });

    test('a later group that throws synchronously reveals once, error logged', async () => {
      gate.onCreate(message('m1', { rolls: [ordered(1, 1), ordered(2, 2)] }));
      diceBox.roll.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      diceBox.rolls[0].landed.resolve();
      await flush();
      expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);
      expect(errorSpy).toHaveBeenCalled();
      vi.advanceTimersByTime(WATCHDOG_MS * 2);
      expect(hooks.named(COMPLETE)).toHaveLength(1);
    });

    test('deleted while queued: RollComplete once, group 2 never thrown, a linked B waiting on it is revealed', async () => {
      const b = li('B');
      gate.onCreate(message('A', { rolls: [ordered(1, 1), ordered(2, 2)] }));
      gate.onCreate(message('B', linked('A')));
      expect(b.classList.contains('dsn-hide')).toBe(true);
      gate.onDelete({ id: 'A' }); // group 1 is in flight
      expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'A', ['B']]]);
      expect(b.classList.contains('dsn-hide')).toBe(false);
      diceBox.rolls[0].landed.resolve();
      await flush();
      vi.advanceTimersByTime(WATCHDOG_MS * 3);
      await flush();
      expect(diceBox.rolls).toHaveLength(1);
      expect(hooks.named(COMPLETE)).toHaveLength(1);
    });
  });

  describe('linkedTo', () => {
    test('B linked to animating A: B hidden (also on render) until A reveals; A RollComplete gets [B.id]', async () => {
      const a = li('A');
      const b = li('B');
      gate.onCreate(message('A'));
      const msgB = message('B', linked('A'));
      gate.onCreate(msgB);
      const renderedB = document.createElement('li');
      renderedB.dataset.messageId = 'B';
      gate.onRender(msgB, renderedB);
      expect(diceBox.rolls).toHaveLength(1); // B is not animated itself
      expect(gate.isAnimating('B')).toBe(false);
      expect(b.classList.contains('dsn-hide')).toBe(true);
      expect(renderedB.classList.contains('dsn-hide')).toBe(true);
      expect(hooks.named(PROCESSED)).toContainEqual([PROCESSED, 'B', { willTrigger3DRoll: false }]);
      diceBox.rolls[0].landed.resolve();
      await flush();
      expect(a.classList.contains('dsn-hide')).toBe(false);
      expect(b.classList.contains('dsn-hide')).toBe(false);
      expect(renderedB.classList.contains('dsn-hide')).toBe(false);
      expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'A', ['B']]]);
    });

    test('flags.dicer.linkedTo works too, and companions are revealed before RollComplete fires', async () => {
      const b = li('B');
      let hiddenAtComplete = null;
      hooks.listeners[COMPLETE] = [() => (hiddenAtComplete = b.classList.contains('dsn-hide'))];
      gate.onCreate(message('A'));
      gate.onCreate(message('B', linked('A', 'dicer')));
      expect(b.classList.contains('dsn-hide')).toBe(true);
      diceBox.rolls[0].landed.resolve();
      await flush();
      expect(hiddenAtComplete).toBe(false);
      expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'A', ['B']]]);
    });

    test('B linked to a non-animating id shows at once and fires no RollComplete', () => {
      const b = li('B');
      gate.onCreate(message('B', linked('nope')));
      expect(b.classList.contains('dsn-hide')).toBe(false);
      expect(diceBox.roll).not.toHaveBeenCalled();
      expect(hooks.named(PROCESSED)).toEqual([[PROCESSED, 'B', { willTrigger3DRoll: false }]]);
      expect(hooks.named(COMPLETE)).toEqual([]);
    });

    test('the target watchdog releases B', async () => {
      const b = li('B');
      gate.onCreate(message('A'));
      gate.onCreate(message('B', linked('A')));
      vi.advanceTimersByTime(WATCHDOG_MS);
      await flush();
      expect(b.classList.contains('dsn-hide')).toBe(false);
      expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'A', ['B']]]);
    });

    test('the target failing releases B', async () => {
      const b = li('B');
      gate.onCreate(message('A'));
      gate.onCreate(message('B', linked('A')));
      diceBox.rolls[0].landed.resolve(Promise.reject(new Error('lost')));
      await flush();
      expect(b.classList.contains('dsn-hide')).toBe(false);
      expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'A', ['B']]]);
    });

    test('B deleted before A reveals is not listed as a companion', async () => {
      li('B');
      gate.onCreate(message('A'));
      gate.onCreate(message('B', linked('A')));
      gate.onDelete({ id: 'B' });
      expect(hooks.named(COMPLETE)).toEqual([]);
      diceBox.rolls[0].landed.resolve();
      await flush();
      expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'A', []]]);
    });
  });

  describe('flags', () => {
    test.each([
      ['dice-so-nice', 'pendingCard'],
      ['dicer', 'pendingCard'],
      ['dicer', 'skip'],
    ])('flags[%s].%s: no animation, Processed(false)', (scope, flag) => {
      const el = li('m1');
      gate.onCreate(message('m1', { flags: { [scope]: { [flag]: true } } }));
      expect(diceBox.roll).not.toHaveBeenCalled();
      expect(el.classList.contains('dsn-hide')).toBe(false);
      expect(hooks.named(PROCESSED)).toEqual([[PROCESSED, 'm1', { willTrigger3DRoll: false }]]);
    });

    test.each(['persistent', 'interactiveThrow'])('flags[dice-so-nice].%s: animates normally', (flag) => {
      gate.onCreate(message('m1', { flags: { 'dice-so-nice': { [flag]: true } } }));
      expect(diceBox.roll).toHaveBeenCalledTimes(1);
    });

    test('absent or malformed flags animate normally', () => {
      gate.onCreate(message('m1', { flags: undefined }));
      gate.onCreate(message('m2', { flags: { 'dice-so-nice': 'x', dicer: null } }));
      expect(diceBox.roll).toHaveBeenCalledTimes(2);
    });
  });

  test('immediatelyDisplayChatMessages: nothing is hidden, the dice animate, the hooks fire', async () => {
    settings.immediatelyDisplayChatMessages = true;
    const el = li('m1');
    const b = li('B');
    gate.onCreate(message('m1'));
    gate.onCreate(message('B', linked('m1')));
    const rendered = document.createElement('li');
    gate.onRender(message('m1'), rendered);
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(b.classList.contains('dsn-hide')).toBe(false);
    expect(rendered.classList.contains('dsn-hide')).toBe(false);
    expect(diceBox.roll).toHaveBeenCalledTimes(1);
    expect(hooks.named(PROCESSED)[0][2]).toEqual({ willTrigger3DRoll: true });
    expect(hooks.named('diceSoNiceRollStart')).toHaveLength(1);
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', ['B']]]);
  });
});

describe('Task 8 review carry-overs', () => {
  const PRE = 'diceSoNiceMessagePreProcess';
  const ordered = (result, order) => ({ ...d20Roll(result), options: { rollOrder: order } });
  const player = { id: 'p1', isGM: false };

  test('a duplicate onCreate for an animating id fires PreProcess once', () => {
    gate.onCreate(message());
    gate.onCreate(message());
    expect(hooks.named(PRE)).toHaveLength(1);
    expect(diceBox.roll).toHaveBeenCalledTimes(1);
  });

  test("roll 0's rollOrder is read from the message, not from a RollStart replacement", async () => {
    hooks.listeners.diceSoNiceRollStart = [(id, ctx) => (ctx.dsnRoll = ordered(3, 0))];
    gate.onCreate(message('m1', { rolls: [ordered(1, 2), ordered(2, 1)] }));
    expect(diceBox.rolls.map((r) => r.specs[0].value)).toEqual([2]);
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(diceBox.rolls.map((r) => r.specs[0].value)).toEqual([2, 3]);
  });

  test('rollOrder with privacy: a secret roll in group 2 is never thrown, a ghost one is thrown as a ghost', async () => {
    const g = makeGate({ currentUser: () => player });
    g.onCreate(message('m1', { rolls: [ordered(1, 1), { ...ordered(2, 2), secret: true }] }));
    expect(diceBox.rolls).toHaveLength(1);
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(diceBox.rolls).toHaveLength(1);
    expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);

    g.onCreate(message('m2', { rolls: [ordered(1, 1), { ...ordered(2, 2), ghost: true }] }));
    expect(diceBox.rolls).toHaveLength(2);
    expect(diceBox.rolls[1].specs).toEqual([{ type: 'd20', value: 1 }]);
    diceBox.rolls[1].landed.resolve();
    await flush();
    expect(diceBox.rolls[2].specs).toEqual([{ type: 'd20', value: 2, ghost: true }]);
  });

  test('immediatelyDisplayChatMessages keeps the ghost and none views', () => {
    settings.immediatelyDisplayChatMessages = true;
    const el = li('m1');
    const rolls = [{ ...d20Roll(1), ghost: true }, { ...d20Roll(2), secret: true }, d20Roll(3)];
    makeGate({ currentUser: () => player }).onCreate(message('m1', { rolls }));
    expect(diceBox.rolls.map((r) => r.specs)).toEqual([
      [{ type: 'd20', value: 1, ghost: true }],
      [{ type: 'd20', value: 3 }],
    ]);
    expect(el.classList.contains('dsn-hide')).toBe(false);
  });
});

describe('appended rolls (updateChatMessage)', () => {
  const PRE = 'diceSoNiceMessagePreProcess';
  const START = 'diceSoNiceRollStart';
  const ordered = (result, order) => ({ ...d20Roll(result), options: { rollOrder: order } });

  /** Creates a one-roll message and lets it land. */
  async function created(id = 'm1', extra = {}) {
    const msg = message(id, extra);
    gate.onCreate(msg);
    diceBox.rolls.at(-1).landed.resolve();
    await flush();
    return msg;
  }

  function append(msg, ...rolls) {
    msg.rolls = [...msg.rolls, ...rolls];
    gate.onUpdate(msg, { rolls: msg.rolls });
  }

  /** A rendered message with two .dice-roll children. */
  function card(id) {
    const el = li(id);
    el.innerHTML = '<div class="dice-roll">a</div><div class="dice-roll">b</div>';
    return el;
  }

  test('create with 1 roll, update to 2: only the 2nd is thrown, the message is hidden until it lands, RollComplete once more', async () => {
    const el = li('m1');
    const msg = await created();
    expect(hooks.named(COMPLETE)).toHaveLength(1);
    const second = d20Roll(4);
    append(msg, second);
    expect(diceBox.rolls).toHaveLength(2);
    expect(diceBox.rolls[1].specs).toEqual([{ type: 'd20', value: 4 }]);
    expect(el.classList.contains('dsn-hide')).toBe(true);
    const rendered = document.createElement('li');
    gate.onRender(msg, rendered);
    expect(rendered.classList.contains('dsn-hide')).toBe(true);
    expect(gate.isAnimating('m1')).toBe(true);
    expect(hooks.named(PRE)).toHaveLength(2);
    const starts = hooks.named(START);
    expect(starts).toHaveLength(2);
    expect(starts[1][2].roll).toBe(second);
    expect(starts[1][2].dsnRoll).toBe(second);
    expect(hooks.named(COMPLETE)).toHaveLength(1);
    diceBox.rolls[1].landed.resolve();
    await flush();
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(rendered.classList.contains('dsn-hide')).toBe(false);
    expect(hooks.named(COMPLETE)).toEqual([
      [COMPLETE, 'm1', []],
      [COMPLETE, 'm1', []],
    ]);
    vi.advanceTimersByTime(WATCHDOG_MS * 2);
    await flush();
    expect(hooks.named(COMPLETE)).toHaveLength(2);
  });

  test('only the appended rolls are planned', async () => {
    const planThrow = vi.fn(realPlanThrow);
    gate = makeGate({ planThrow });
    const msg = await created();
    planThrow.mockClear();
    append(msg, d20Roll(4));
    expect(planThrow).toHaveBeenCalledTimes(1);
    expect(planThrow.mock.calls[0][0]).toBe(msg.rolls[1]);
  });

  test('a selector .dice-roll:last-child hides only the matching element, also on re-render', async () => {
    const el = card('m1');
    const msg = await created();
    expect(gate.setUpdateHideSelector('.dice-roll:last-child')).toBe(true);
    append(msg, d20Roll(4));
    const [first, last] = el.children;
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(first.classList.contains('dsn-hide')).toBe(false);
    expect(last.classList.contains('dsn-hide')).toBe(true);

    const rendered = document.createElement('li');
    rendered.innerHTML = '<div class="dice-roll">a</div><div class="dice-roll">b</div>';
    gate.onRender(msg, rendered);
    expect(rendered.classList.contains('dsn-hide')).toBe(false);
    expect(rendered.children[0].classList.contains('dsn-hide')).toBe(false);
    expect(rendered.children[1].classList.contains('dsn-hide')).toBe(true);

    diceBox.rolls[1].landed.resolve();
    await flush();
    expect(document.querySelectorAll('.dsn-hide')).toHaveLength(0);
    expect(rendered.querySelectorAll('.dsn-hide')).toHaveLength(0);
    expect(hooks.named(COMPLETE)).toHaveLength(2);
  });

  test('with a selector a notification card is pinned while its match hides, and refreshed on reveal', async () => {
    const box = document.createElement('div');
    box.id = 'chat-notifications';
    document.body.appendChild(box);
    const msg = await created();
    gate.setUpdateHideSelector('.dice-roll:last-child');
    append(msg, d20Roll(4));
    const cardEl = document.createElement('li');
    cardEl.dataset.messageId = 'm1';
    cardEl.innerHTML = '<div class="dice-roll">a</div><div class="dice-roll">b</div>';
    gate.onRender(msg, cardEl);
    box.append(cardEl);
    vi.advanceTimersByTime(0);
    cardEl._lifeSpan = 4500;
    expect(cardEl._lifeSpan).toBe(0);
    expect(cardEl.classList.contains('dsn-hide')).toBe(false);
    expect(cardEl.children[1].classList.contains('dsn-hide')).toBe(true);
    diceBox.rolls[1].landed.resolve();
    await flush();
    expect(cardEl.children[1].classList.contains('dsn-hide')).toBe(false);
    cardEl._lifeSpan = 500;
    expect(cardEl._lifeSpan).toBe(500); // unpinned
  });

  test('the selector never applies to a create; null restores whole-message hiding', async () => {
    const el = card('m1');
    gate.setUpdateHideSelector('.dice-roll:last-child');
    const msg = message();
    gate.onCreate(msg);
    expect(el.classList.contains('dsn-hide')).toBe(true);
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(gate.setUpdateHideSelector(null)).toBe(true);
    append(msg, d20Roll(4));
    expect(el.classList.contains('dsn-hide')).toBe(true);
    expect(el.querySelectorAll('.dsn-hide')).toHaveLength(0);
  });

  test('setUpdateHideSelector rejects a non-string or an invalid selector and keeps the previous one', async () => {
    const el = card('m1');
    const msg = await created();
    expect(gate.setUpdateHideSelector('.dice-roll:last-child')).toBe(true);
    expect(gate.setUpdateHideSelector(42)).toBe(false);
    expect(gate.setUpdateHideSelector('div[')).toBe(false);
    expect(gate.setUpdateHideSelector('')).toBe(false);
    append(msg, d20Roll(4));
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(el.children[1].classList.contains('dsn-hide')).toBe(true);
  });

  test('an update with no new rolls, or without changes.rolls, does nothing', async () => {
    const el = li('m1');
    const msg = await created();
    hooks.calls.length = 0;
    gate.onUpdate(msg, { rolls: msg.rolls });
    gate.onUpdate(msg, { content: 'x' });
    msg.rolls = [...msg.rolls, d20Roll(4)];
    gate.onUpdate(msg, { content: 'y' }); // not a rolls change
    expect(diceBox.rolls).toHaveLength(1);
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(hooks.calls).toEqual([]);
  });

  test('an update to an unknown id does nothing', () => {
    const el = li('m1');
    const msg = message('m1', { rolls: [d20Roll(1), d20Roll(2)] });
    gate.onUpdate(msg, { rolls: msg.rolls });
    gate.onUpdate(undefined, { rolls: [] });
    gate.onUpdate({}, { rolls: [] });
    expect(diceBox.roll).not.toHaveBeenCalled();
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(hooks.calls).toEqual([]);
  });

  test('a later update to an id first seen by an update animates the rolls added since', () => {
    const msg = message('m1', { rolls: [d20Roll(1)] });
    gate.onUpdate(msg, { rolls: msg.rolls });
    append(msg, d20Roll(2));
    expect(diceBox.rolls.map((r) => r.specs[0].value)).toEqual([2]);
  });

  test('roll counts are kept for the last 200 ids only', () => {
    const first = message('m0', { flags: { dicer: { skip: true } } });
    gate.onCreate(first);
    first.flags = {};
    for (let i = 1; i <= 200; i++) gate.onCreate(message(`m${i}`, { rolls: [] }));
    append(first, d20Roll(4));
    expect(diceBox.roll).not.toHaveBeenCalled(); // m0 was evicted: unknown, not animated

    const recent = message('m200', { rolls: [] });
    append(recent, d20Roll(5));
    expect(diceBox.rolls.map((r) => r.specs)).toEqual([[{ type: 'd20', value: 5 }]]);
  });

  test('deleted mid-append: RollComplete once, nothing stays hidden', async () => {
    const el = card('m1');
    const msg = await created();
    gate.setUpdateHideSelector('.dice-roll:last-child');
    append(msg, d20Roll(4));
    expect(el.children[1].classList.contains('dsn-hide')).toBe(true);
    gate.onDelete({ id: 'm1' });
    expect(hooks.named(COMPLETE)).toHaveLength(2);
    expect(document.querySelectorAll('.dsn-hide')).toHaveLength(0);
    diceBox.rolls[1].landed.resolve();
    await flush();
    vi.advanceTimersByTime(WATCHDOG_MS * 2);
    await flush();
    expect(hooks.named(COMPLETE)).toHaveLength(2);
    expect(document.querySelectorAll('.dsn-hide')).toHaveLength(0);
  });

  test('an append while the create animates is queued until the create reveals', async () => {
    const el = li('m1');
    const msg = message();
    gate.onCreate(msg);
    append(msg, d20Roll(4));
    expect(diceBox.rolls).toHaveLength(1);
    expect(hooks.named(PRE)).toHaveLength(1);
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(hooks.named(COMPLETE)).toEqual([[COMPLETE, 'm1', []]]);
    expect(diceBox.rolls).toHaveLength(2);
    expect(diceBox.rolls[1].specs).toEqual([{ type: 'd20', value: 4 }]);
    expect(el.classList.contains('dsn-hide')).toBe(true);
    diceBox.rolls[1].landed.resolve();
    await flush();
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(hooks.named(COMPLETE)).toHaveLength(2);
  });

  test('two appends queued behind one animation are thrown together, with one RollComplete', async () => {
    const msg = message();
    gate.onCreate(msg);
    append(msg, d20Roll(4));
    append(msg, d20Roll(5));
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(diceBox.rolls.slice(1).map((r) => r.specs[0].value)).toEqual([4, 5]);
    diceBox.rolls[1].landed.resolve();
    diceBox.rolls[2].landed.resolve();
    await flush();
    expect(hooks.named(COMPLETE)).toHaveLength(2);
  });

  test('an append queued behind a selector append hides the whole message meanwhile', async () => {
    const el = card('m1');
    const msg = await created();
    gate.setUpdateHideSelector('.dice-roll:last-child');
    append(msg, d20Roll(4));
    expect(el.classList.contains('dsn-hide')).toBe(false);
    append(msg, d20Roll(5));
    expect(el.classList.contains('dsn-hide')).toBe(true);
    const rendered = document.createElement('li');
    rendered.innerHTML = '<div class="dice-roll">a</div>';
    gate.onRender(msg, rendered);
    expect(rendered.classList.contains('dsn-hide')).toBe(true);
    diceBox.rolls[1].landed.resolve();
    await flush();
    // The queued append starts with the selector again.
    expect(diceBox.rolls).toHaveLength(3);
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(el.children[1].classList.contains('dsn-hide')).toBe(true);
    diceBox.rolls[2].landed.resolve();
    await flush();
    expect(document.querySelectorAll('.dsn-hide')).toHaveLength(0);
    expect(hooks.named(COMPLETE)).toHaveLength(3);
  });

  test('deleted while an append is queued: RollComplete once, the append is never thrown, nothing hidden', async () => {
    li('m1');
    const msg = message();
    gate.onCreate(msg);
    append(msg, d20Roll(4));
    gate.onDelete({ id: 'm1' });
    expect(hooks.named(COMPLETE)).toHaveLength(1);
    diceBox.rolls[0].landed.resolve();
    await flush();
    vi.advanceTimersByTime(WATCHDOG_MS * 2);
    await flush();
    expect(diceBox.rolls).toHaveLength(1);
    expect(hooks.named(COMPLETE)).toHaveLength(1);
    expect(document.querySelectorAll('.dsn-hide')).toHaveLength(0);
  });

  test('appended rolls follow the privacy views: a secret append is not animated for a player', async () => {
    gate = makeGate({ currentUser: () => ({ id: 'p1', isGM: false }) });
    const el = li('m1');
    const msg = await created();
    append(msg, { ...d20Roll(4), secret: true });
    expect(diceBox.rolls).toHaveLength(1);
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(hooks.named(COMPLETE)).toHaveLength(1);
    expect(hooks.named('diceSoNiceMessageProcessed').at(-1)[2]).toEqual({
      willTrigger3DRoll: false,
    });

    append(msg, { ...d20Roll(5), ghost: true });
    expect(diceBox.rolls[1].specs).toEqual([{ type: 'd20', value: 5, ghost: true }]);
  });

  test('a RollStart flag on an appended roll applies to the appended rolls only', async () => {
    gate = makeGate({ currentUser: () => ({ id: 'p1', isGM: false }) });
    const msg = await created();
    hooks.listeners[START] = [(id, ctx) => (ctx.roll.ghost = true)];
    append(msg, d20Roll(4), d20Roll(5));
    expect(diceBox.rolls.slice(1).map((r) => r.specs)).toEqual([
      [{ type: 'd20', value: 4, ghost: true }],
      [{ type: 'd20', value: 5, ghost: true }],
    ]);
  });

  test('appended rolls are thrown in rollOrder groups', async () => {
    const msg = await created();
    append(msg, ordered(4, 2), ordered(5, 1));
    expect(diceBox.rolls.slice(1).map((r) => r.specs[0].value)).toEqual([5]);
    diceBox.rolls[1].landed.resolve();
    await flush();
    expect(diceBox.rolls.slice(1).map((r) => r.specs[0].value)).toEqual([5, 4]);
  });

  test('a PreProcess listener can cancel an append', async () => {
    const el = li('m1');
    const msg = await created();
    hooks.listeners[PRE] = [(id, i) => (i.willTrigger3DRoll = false)];
    append(msg, d20Roll(4));
    expect(diceBox.rolls).toHaveLength(1);
    expect(el.classList.contains('dsn-hide')).toBe(false);
  });

  test('the watchdog fires during a selector append: revealed, RollComplete once more, a late landing is ignored', async () => {
    const el = card('m1');
    const msg = await created();
    gate.setUpdateHideSelector('.dice-roll:last-child');
    append(msg, d20Roll(4));
    expect(el.children[1].classList.contains('dsn-hide')).toBe(true);
    vi.advanceTimersByTime(WATCHDOG_MS);
    await flush();
    expect(document.querySelectorAll('.dsn-hide')).toHaveLength(0);
    expect(hooks.named(COMPLETE)).toHaveLength(2);
    diceBox.rolls[1].landed.resolve();
    await flush();
    expect(hooks.named(COMPLETE)).toHaveLength(2);
  });

  test('the watchdog fires on an animation with a queued append: the append starts, RollComplete once per animation', async () => {
    li('m1');
    const msg = message();
    gate.onCreate(msg);
    append(msg, d20Roll(4));
    vi.advanceTimersByTime(WATCHDOG_MS);
    await flush();
    expect(hooks.named(COMPLETE)).toHaveLength(1);
    expect(diceBox.rolls).toHaveLength(2);
    expect(gate.isAnimating('m1')).toBe(true);
    diceBox.rolls[0].landed.resolve(); // the first one lands late: nothing happens
    await flush();
    expect(gate.isAnimating('m1')).toBe(true);
    diceBox.rolls[1].landed.resolve();
    await flush();
    expect(hooks.named(COMPLETE)).toHaveLength(2);
    vi.advanceTimersByTime(WATCHDOG_MS * 2);
    await flush();
    expect(hooks.named(COMPLETE)).toHaveLength(2);
    expect(document.querySelectorAll('.dsn-hide')).toHaveLength(0);
  });

  test('diceBox.roll throwing during an append reveals once and hides nothing', async () => {
    const el = li('m1');
    const msg = await created();
    diceBox.roll.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    append(msg, d20Roll(4));
    expect(errorSpy).toHaveBeenCalled();
    expect(el.classList.contains('dsn-hide')).toBe(false);
    expect(gate.isAnimating('m1')).toBe(false);
    expect(hooks.named(COMPLETE)).toHaveLength(2);
    vi.advanceTimersByTime(WATCHDOG_MS * 2);
    await flush();
    expect(hooks.named(COMPLETE)).toHaveLength(2);
  });

  test('a stale landed rejection does not reveal the next animation of the same id', async () => {
    li('m1');
    const msg = message();
    gate.onCreate(msg);
    append(msg, d20Roll(4));
    vi.advanceTimersByTime(WATCHDOG_MS); // A revealed, B starts
    await flush();
    expect(gate.isAnimating('m1')).toBe(true);
    diceBox.rolls[0].landed.promise.catch(() => {});
    diceBox.rolls[0].landed.reject(new Error('late'));
    await flush();
    expect(gate.isAnimating('m1')).toBe(true);
    expect(hooks.named(COMPLETE)).toHaveLength(1);
    diceBox.rolls[1].landed.resolve();
    await flush();
    expect(hooks.named(COMPLETE)).toHaveLength(2);
  });

  test('two appends merged into one animation start with whole-message hiding, not the selector', async () => {
    const el = card('m1');
    gate.setUpdateHideSelector('.dice-roll:last-child');
    const msg = message();
    gate.onCreate(msg);
    append(msg, d20Roll(4));
    append(msg, d20Roll(5));
    diceBox.rolls[0].landed.resolve();
    await flush();
    expect(diceBox.rolls).toHaveLength(3);
    expect(el.classList.contains('dsn-hide')).toBe(true);
    expect(el.querySelectorAll('.dsn-hide')).toHaveLength(0);
    diceBox.rolls[1].landed.resolve();
    diceBox.rolls[2].landed.resolve();
    await flush();
    expect(document.querySelectorAll('.dsn-hide')).toHaveLength(0);
  });

  test('immediatelyDisplayChatMessages: an append hides nothing but still completes once', async () => {
    settings.immediatelyDisplayChatMessages = true;
    const el = li('m1');
    const msg = await created();
    append(msg, d20Roll(4));
    expect(el.classList.contains('dsn-hide')).toBe(false);
    diceBox.rolls[1].landed.resolve();
    await flush();
    expect(hooks.named(COMPLETE)).toHaveLength(2);
  });
});

describe('recentViews (debug record)', () => {
  it('records view kinds per message and never roll values', () => {
    gate.onCreate(message('m1', { rolls: [d20Roll(13)] }));
    gate.onCreate(
      message('m2', { rolls: [d20Roll(7)], isContentVisible: false, blind: true, whisper: ['gm'] }),
    );
    const views = gate.recentViews();
    expect(views.m1).toEqual(['real']);
    expect(views.m2).toEqual(['none']);
    expect(JSON.stringify(views)).not.toMatch(/13|17|"7"/);
  });
});

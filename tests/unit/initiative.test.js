// @vitest-environment jsdom
import { createInitiativeHider } from '../../src/compat/initiative.js';
import { createMessageGate, WATCHDOG_MS } from '../../src/foundry/message-gate.js';
import { planThrow } from '../../src/throw/throw-planner.js';

const HIDDEN = 'dicer-hide-initiative';

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** A rendered v14 tracker fragment with one row per combatant id. */
function tracker(...ids) {
  const ol = document.createElement('ol');
  ol.innerHTML = ids
    .map(
      (id) =>
        `<li class="combatant" data-combatant-id="${id}"><div class="token-initiative"><span>12</span></div></li>`,
    )
    .join('');
  return ol;
}

const initMessage = (id, speaker, flags = { core: { initiativeRoll: true } }) => ({
  id,
  speaker,
  flags,
});

let animating, waits, combat, rerender, hider;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  animating = new Set();
  waits = new Map();
  combat = {
    combatants: [
      { id: 'c1', tokenId: 'T', actorId: 'A' },
      { id: 'c2', tokenId: 'U', actorId: 'B' },
    ],
  };
  rerender = vi.fn();
  const gate = {
    isAnimating: (id) => animating.has(id),
    waitFor: (id) => waits.get(id)?.promise ?? Promise.resolve(true),
  };
  hider = createInitiativeHider({
    gate,
    getCombat: () => combat,
    documentRef: document,
    rerender,
  });
});

afterEach(() => vi.useRealTimers());

function start(id, speaker, flags) {
  animating.add(id);
  waits.set(id, deferred());
  hider.onCreateMessage(initMessage(id, speaker, flags));
}

const hiddenIn = (root) =>
  [...root.querySelectorAll(`.${HIDDEN}`)].map((e) => e.closest('li').dataset.combatantId);

test("an animating initiative message hides its token's initiative in a rendered tracker", () => {
  start('m1', { token: 'T' });
  const html = tracker('c1', 'c2');
  hider.onRenderTracker({}, html);
  expect(hiddenIn(html)).toEqual(['c1']);
});

test('it hides an already rendered tracker at once', () => {
  const html = tracker('c1', 'c2');
  document.body.append(html);
  start('m1', { token: 'T' });
  expect(hiddenIn(html)).toEqual(['c1']);
});

test('the fallback .initiative element is hidden too', () => {
  start('m1', { token: 'T' });
  const html = document.createElement('div');
  html.innerHTML = '<li data-combatant-id="c1"><span class="initiative">9</span></li>';
  hider.onRenderTracker({}, html);
  expect(html.querySelector('.initiative').classList.contains(HIDDEN)).toBe(true);
});

test('an actor speaker matches when there is no token', () => {
  start('m1', { actor: 'B' });
  const html = tracker('c1', 'c2');
  hider.onRenderTracker({}, html);
  expect(hiddenIn(html)).toEqual(['c2']);
});

test('when the gate reveals, the tracker re-renders and shows it', async () => {
  start('m1', { token: 'T' });
  expect(rerender).not.toHaveBeenCalled();
  waits.get('m1').resolve(true);
  await flush();
  expect(rerender).toHaveBeenCalledTimes(1);
  const html = tracker('c1');
  hider.onRenderTracker({}, html);
  expect(hiddenIn(html)).toEqual([]);
});

test('a message deleted mid-roll releases the hold (the gate resolves its wait)', async () => {
  start('m1', { token: 'T' });
  const html = tracker('c1');
  hider.onRenderTracker({}, html);
  expect(hiddenIn(html)).toEqual(['c1']);
  waits.get('m1').resolve(true); // gate.onDelete -> reveal -> resolve
  await flush();
  const again = tracker('c1');
  hider.onRenderTracker({}, again);
  expect(hiddenIn(again)).toEqual([]);
  expect(rerender).toHaveBeenCalledTimes(1);
});

test('a non-initiative message leaves the tracker alone', () => {
  start('m1', { token: 'T' }, { core: {} });
  start('m2', { token: 'T' }, {});
  const html = tracker('c1');
  hider.onRenderTracker({}, html);
  expect(hiddenIn(html)).toEqual([]);
});

test('an initiative message the gate is not animating is ignored', () => {
  waits.set('m1', deferred());
  hider.onCreateMessage(initMessage('m1', { token: 'T' }));
  const html = tracker('c1');
  hider.onRenderTracker({}, html);
  expect(hiddenIn(html)).toEqual([]);
});

test('an actor or token not in combat does nothing', () => {
  start('m1', { token: 'Z' });
  start('m2', { actor: 'Q' });
  start('m3', {});
  const html = tracker('c1', 'c2');
  hider.onRenderTracker({}, html);
  expect(hiddenIn(html)).toEqual([]);
  expect(rerender).not.toHaveBeenCalled();
});

test('no combat does nothing', () => {
  combat = null;
  start('m1', { token: 'T' });
  const html = tracker('c1');
  hider.onRenderTracker({}, html);
  expect(hiddenIn(html)).toEqual([]);
});

test('a hold never outlasts WATCHDOG_MS + 1000', async () => {
  start('m1', { token: 'T' });
  vi.advanceTimersByTime(WATCHDOG_MS + 999);
  expect(rerender).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(rerender).toHaveBeenCalledTimes(1);
  const html = tracker('c1');
  hider.onRenderTracker({}, html);
  expect(hiddenIn(html)).toEqual([]);
  waits.get('m1').resolve(true); // a late resolve releases nothing twice
  await flush();
  expect(rerender).toHaveBeenCalledTimes(1);
});

test('two holds on one combatant release only when both are done', async () => {
  start('m1', { token: 'T' });
  start('m2', { token: 'T' });
  waits.get('m1').resolve(true);
  await flush();
  const html = tracker('c1');
  hider.onRenderTracker({}, html);
  expect(hiddenIn(html)).toEqual(['c1']);
  waits.get('m2').resolve(true);
  await flush();
  const after = tracker('c1');
  hider.onRenderTracker({}, after);
  expect(hiddenIn(after)).toEqual([]);
});

test('the enabled switch turns hiding off', () => {
  const gate = { isAnimating: () => true, waitFor: () => new Promise(() => {}) };
  const off = createInitiativeHider({
    gate,
    getCombat: () => combat,
    documentRef: document,
    enabled: () => false,
    rerender,
  });
  off.onCreateMessage(initMessage('m1', { token: 'T' }));
  const html = tracker('c1');
  off.onRenderTracker({}, html);
  expect(hiddenIn(html)).toEqual([]);
});

test('a throwing apply still releases the hold on waitFor and on the cap', async () => {
  const boom = {
    querySelectorAll: () => {
      throw new Error('dom');
    },
  };
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const make = () => {
    animating.add('m1');
    waits.set('m1', deferred());
    return createInitiativeHider({
      gate: { isAnimating: (id) => animating.has(id), waitFor: (id) => waits.get(id).promise },
      getCombat: () => combat,
      documentRef: boom,
      rerender,
    });
  };
  let h = make();
  h.onCreateMessage(initMessage('m1', { token: 'T' }));
  expect(errorSpy).toHaveBeenCalled();
  waits.get('m1').resolve(true);
  await flush();
  expect(rerender).toHaveBeenCalledTimes(1);
  const html = tracker('c1');
  h.onRenderTracker({}, html);
  expect(hiddenIn(html)).toEqual([]);

  h = make();
  h.onCreateMessage(initMessage('m1', { token: 'T' }));
  vi.advanceTimersByTime(WATCHDOG_MS + 1000);
  expect(rerender).toHaveBeenCalledTimes(2);
  const again = tracker('c1');
  h.onRenderTracker({}, again);
  expect(hiddenIn(again)).toEqual([]);
  errorSpy.mockRestore();
});

test('with the real gate, deleting the message mid-roll releases the hold and a re-render shows it', async () => {
  const gate = createMessageGate({
    diceBox: { roll: () => ({ landed: new Promise(() => {}) }) },
    planThrow,
    hooks: { callAll() {} },
    getSetting: (k) => ({ enabled: true, maxDice: 20 })[k],
    documentRef: document,
  });
  const real = createInitiativeHider({
    gate,
    getCombat: () => combat,
    documentRef: document,
    rerender,
  });
  const msg = {
    id: 'mi',
    rolls: [{ dice: [{ faces: 20, results: [{ result: 9, active: true }] }] }],
    isContentVisible: true,
    flags: { core: { initiativeRoll: true } },
    author: {},
    speaker: { token: 'T' },
  };
  gate.onCreate(msg);
  real.onCreateMessage(msg);
  expect(gate.isAnimating('mi')).toBe(true);
  const held = tracker('c1');
  real.onRenderTracker({}, held);
  expect(hiddenIn(held)).toEqual(['c1']);
  gate.onDelete({ id: 'mi' });
  await flush();
  expect(rerender).toHaveBeenCalledTimes(1);
  const shown = tracker('c1');
  real.onRenderTracker({}, shown);
  expect(hiddenIn(shown)).toEqual([]);
});

describe('immediatelyDisplayChatMessages: the card already shows the value', () => {
  const realGate = (settings) =>
    createMessageGate({
      diceBox: { roll: () => ({ landed: new Promise(() => {}) }) },
      planThrow,
      hooks: { callAll() {} },
      getSetting: (k) => ({ enabled: true, maxDice: 20, ...settings })[k],
      documentRef: document,
    });
  const msg = () => ({
    id: 'mi',
    rolls: [{ dice: [{ faces: 20, results: [{ result: 9, active: true }] }] }],
    isContentVisible: true,
    flags: { core: { initiativeRoll: true } },
    author: {},
    speaker: { token: 'T' },
  });

  test('with the real gate and immediate display on, no hold is taken', () => {
    const gate = realGate({ immediatelyDisplayChatMessages: true });
    const real = createInitiativeHider({
      gate,
      getCombat: () => combat,
      documentRef: document,
      rerender,
    });
    const m = msg();
    gate.onCreate(m);
    real.onCreateMessage(m);
    expect(gate.isAnimating('mi')).toBe(true);
    expect(gate.isHiding('mi')).toBe(false);
    const t = tracker('c1');
    real.onRenderTracker({}, t);
    expect(hiddenIn(t)).toEqual([]);
  });

  test('with the real gate hiding the card, the hold is taken', () => {
    const gate = realGate({});
    const real = createInitiativeHider({
      gate,
      getCombat: () => combat,
      documentRef: document,
      rerender,
    });
    const m = msg();
    gate.onCreate(m);
    real.onCreateMessage(m);
    expect(gate.isHiding('mi')).toBe(true);
    const t = tracker('c1');
    real.onRenderTracker({}, t);
    expect(hiddenIn(t)).toEqual(['c1']);
  });

  test('a gate without isHiding (older shape) still holds', () => {
    animating.add('m1');
    hider.onCreateMessage(initMessage('m1', { token: 'T' }));
    const t = tracker('c1');
    hider.onRenderTracker({}, t);
    expect(hiddenIn(t)).toEqual(['c1']);
  });
});

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createDicerAdapter } from '../../src/bench/dicer-adapter.js';

const debug = (over = {}) => ({
  activeRolls: 0,
  frameCount: 0,
  resources: { geometries: 1, textures: 2, programs: 3 },
  tier: 'medium',
  ...over,
});

class FakeRoll {
  async evaluate() {
    return this;
  }
}

beforeEach(() => {
  globalThis.Roll = FakeRoll;
  globalThis.game = { user: { id: 'u' } };
});
afterEach(() => {
  delete globalThis.Roll;
  delete globalThis.game;
});

test('the default roll goes through showForRoll with synchronize false; done settles at completion', async () => {
  let finish;
  const api = { _debug: debug(), showForRoll: vi.fn(() => new Promise((r) => (finish = r))) };
  const ad = createDicerAdapter(api);
  const res = await ad.roll('1d20');
  expect(api.showForRoll).toHaveBeenCalledWith(expect.any(FakeRoll), globalThis.game.user, false);
  let done = false;
  res.done.then(() => (done = true));
  await new Promise((r) => setTimeout(r, 5));
  expect(done).toBe(false);
  finish(true);
  await res.done;
  expect(done).toBe(true);
});

test('done rejects when showForRoll shows nothing; a custom roll replaces the default', async () => {
  const api = { _debug: debug(), showForRoll: vi.fn(async () => false) };
  const res = await createDicerAdapter(api).roll('1d20');
  await expect(res.done).rejects.toThrow();
  const custom = createDicerAdapter(api, { roll: async (formula) => ({ messageId: formula }) });
  expect(await custom.roll('x')).toEqual({ messageId: 'x' });
});

test('started resolves at the first rendered frame after the call, and is bounded when none comes', async () => {
  const d = debug();
  const api = { _debug: d, showForRoll: vi.fn(async () => true) };
  const raf = (cb) => setTimeout(() => cb(performance.now()), 2);
  const win = { requestAnimationFrame: raf, cancelAnimationFrame: clearTimeout, dispatchEvent: vi.fn() };
  const ad = createDicerAdapter(api, { win, startTimeoutMs: 80 });
  const res = await ad.roll('1d20');
  let started = false;
  res.started.then(() => (started = true));
  await new Promise((r) => setTimeout(r, 20));
  expect(started).toBe(false);
  d.frameCount = 1;
  await res.started;
  expect(started).toBe(true);
  // A frame count that never moves: the wait gives up instead of hanging.
  const t0 = Date.now();
  const again = await ad.roll('1d20');
  await again.started;
  expect(Date.now() - t0).toBeLessThan(1000);
});

test('heap, resources, isBusy, perturb and info', async () => {
  const dispatch = vi.fn();
  const ad = createDicerAdapter(
    { _debug: debug({ activeRolls: 2 }) },
    {
      win: {
        dispatchEvent: dispatch,
        requestAnimationFrame: () => 0,
        cancelAnimationFrame: () => {},
        navigator: { userAgent: 'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36' },
        performance: { memory: { usedJSHeapSize: 1234 } },
      },
      gpu: () => 'GPU X',
      version: '1.2.3',
    },
  );
  expect(ad.product).toBe('dicer');
  expect(ad.isBusy()).toBe(true);
  expect(ad.resources()).toEqual({ geometries: 1, textures: 2, programs: 3 });
  expect(await ad.heap()).toBe(1234);
  await ad.perturb('resize', 400);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch.mock.calls[0][0].type).toBe('resize');
  await ad.perturb('hidden', 3000);
  await ad.perturb('contextLoss', 500);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(await ad.info()).toEqual({ browser: 'Chrome 131', gpu: 'GPU X', tier: 'medium', version: '1.2.3' });
});

test('heap is null without performance.memory', async () => {
  const win = { performance: {}, requestAnimationFrame: () => 0, dispatchEvent: () => {} };
  expect(await createDicerAdapter({ _debug: debug() }, { win }).heap()).toBeNull();
});

test('started is this roll own first frame (armFirstFrame), not the renderer global frame counter', async () => {
  let armed = null;
  const calls = [];
  const d = debug({ frameCount: 5, isLooping: true });
  const api = {
    _debug: d,
    _benchArmFirstFrame: vi.fn((cb) => {
      calls.push(cb ? 'arm' : 'disarm');
      armed = cb;
    }),
    showForRoll: vi.fn(async () => {
      calls.push('show');
      return true;
    }),
  };
  const ad = createDicerAdapter(api, { startTimeoutMs: 500 });
  const res = await ad.roll('1d20');
  expect(calls).toEqual(['arm', 'show', 'disarm']);
  let started = false;
  res.started.then(() => (started = true));
  d.frameCount = 50; // a looping renderer keeps counting frames: not this roll's first frame
  await new Promise((r) => setTimeout(r, 30));
  expect(started).toBe(false);
  armed?.call?.(null);
  api._benchArmFirstFrame.mock.calls[0][0]();
  await res.started;
  expect(started).toBe(true);
});

test('a looping renderer is busy, so each roll starts from an idle one', () => {
  const ad = createDicerAdapter({ _debug: debug({ isLooping: true }) });
  expect(ad.isBusy()).toBe(true);
  expect(createDicerAdapter({ _debug: debug({ isLooping: false }) }).isBusy()).toBe(false);
});

test('a held loop (resting pets, no frames) is idle, not busy', () => {
  expect(createDicerAdapter({ _debug: debug({ isLooping: true, isHolding: true }) }).isBusy()).toBe(false);
  expect(createDicerAdapter({ _debug: debug({ isLooping: true, isHolding: false }) }).isBusy()).toBe(true);
  expect(createDicerAdapter({ _debug: debug({ activeRolls: 1, isLooping: true, isHolding: true }) }).isBusy()).toBe(true);
});

test('a dice cap below a scenario pool adds a note to its result', async () => {
  const sc = await import('../../src/bench/scenarios.js');
  vi.spyOn(sc, 'runSuite');
  const api = { _debug: debug(), _benchArmFirstFrame: (cb) => cb?.(), showForRoll: vi.fn(async () => true) };
  const { runDicerBenchmark } = await import('../../src/bench/dicer-adapter.js');
  const out = await runDicerBenchmark(api, { scenarios: ['pool30', 'd20'], hooks: { on() {}, off() {} }, maxDice: () => 20, idleSampleMs: 50, win: { ...globalThis, requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 1), cancelAnimationFrame: clearTimeout, dispatchEvent() {}, performance, navigator: {} } });
  expect(out.suite.results[0].notes).toContain('pool30 threw 20 of 30 dice (maxDice)');
  expect(out.suite.results[1].notes.some((n) => /maxDice/.test(n))).toBe(false);
  expect(out.text).toContain('pool30 threw 20 of 30 dice (maxDice)');
});

test('M2: an idle display below 60 Hz makes the frame checks n/a, with a summary note', async () => {
  const { runDicerBenchmark, REFRESH_NOTE } = await import('../../src/bench/dicer-adapter.js');
  const api = { _debug: debug(), _benchArmFirstFrame: (cb) => cb?.(), showForRoll: vi.fn(async () => true) };
  const run = (frameMs) =>
    runDicerBenchmark(api, {
      scenarios: ['d20'],
      hooks: { on() {}, off() {} },
      idleSampleMs: 300,
      win: { ...globalThis, requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), frameMs), cancelAnimationFrame: clearTimeout, dispatchEvent() {}, performance, navigator: {} },
    });
  expect(REFRESH_NOTE).toBe('display refresh below 60 Hz: frame checks n/a');
  const slow = await run(33);
  expect(slow.suite.notes).toEqual([REFRESH_NOTE]);
  expect(slow.suite.results[0].refreshLimited).toBe(true);
  expect(slow.text).toContain(REFRESH_NOTE);
  const { checkTargets } = await import('../../src/bench/dicer-adapter.js');
  expect(checkTargets(slow.suite.results[0]).find((c) => c.id === 'frameP95Ms').pass).toBeNull();
  const fast = await run(4);
  expect(fast.suite.notes ?? []).toEqual([]);
  expect(fast.suite.results[0].refreshLimited).toBeUndefined();
});

describe('hand scenarios (rolling by hand)', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/trajectory-mixed10.json', 'utf8'));

  test('hand scenarios replay the fixture through source, never THROW', async () => {
    // The chunk's replay, on a DiceBox stand-in: roll() gets {source}; the physics worker is never asked.
    const hand = await import('../../src/hand/hand.js');
    const box = {
      _area: { halfWidth: 12, halfDepth: 7 },
      _physics: { throw: vi.fn() },
      roll: vi.fn(() => ({ landed: Promise.resolve() })),
    };
    const landed = hand.benchReplay(box, fixture);
    expect(landed).toBeInstanceOf(Promise);
    await landed;
    expect(box.roll).toHaveBeenCalledTimes(1);
    const [specs, opts] = box.roll.mock.calls[0];
    expect(specs).toHaveLength(10);
    expect(specs.every((s) => s.free && s.shapeType === s.type)).toBe(true);
    expect(opts.free).toBe(true);
    expect(typeof opts.source.onChunk).toBe('function');
    expect(opts.launch).toBeUndefined();
    expect(box._physics.throw).not.toHaveBeenCalled();
    // a malformed payload throws nothing and shows nothing
    expect(hand.benchReplay(box, { v: 1 })).toBe(false);
    expect(box.roll).toHaveBeenCalledTimes(1);
  });

  test('the adapter warms the chunk, arms the first frame, then replays the fixture through the api hook', async () => {
    const calls = [];
    const api = {
      _debug: debug(),
      _benchArmFirstFrame: vi.fn((cb) => calls.push(cb ? 'arm' : 'disarm')),
      _benchHand: vi.fn((p) => {
        calls.push(p ? 'replay' : 'warm');
        return p ? Promise.resolve(true) : Promise.resolve({});
      }),
      showForRoll: vi.fn(),
    };
    const ad = createDicerAdapter(api, { fixture: async () => fixture, startTimeoutMs: 50 });
    const res = await ad.roll(undefined, { id: 'handReplay10', hand: true });
    expect(calls).toEqual(['warm', 'arm', 'replay', 'disarm']);
    expect(api._benchHand).toHaveBeenLastCalledWith(fixture);
    expect(api.showForRoll).not.toHaveBeenCalled();
    await res.done;
    // a replay that shows nothing fails the roll; no fixture fails it too
    api._benchHand = vi.fn((p) => Promise.resolve(p ? false : {}));
    await expect((await ad.roll(undefined, { hand: true })).done).rejects.toThrow();
    await expect(createDicerAdapter(api).roll(undefined, { hand: true })).rejects.toThrow(/fixture/);
    // a plain scenario is unchanged
    expect(await createDicerAdapter(api, { roll: async (f) => ({ messageId: f }) }).roll('1d20', { id: 'd20' })).toEqual({ messageId: '1d20' });
  });
});

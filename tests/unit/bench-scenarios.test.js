import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createRecorder } from '../../src/bench/recorder.js';
import { runScenario, runSuite, SCENARIOS } from '../../src/bench/scenarios.js';

const now = () => Date.now();

function fakeWin({ observer = false } = {}) {
  const w = {
    pending: new Set(),
    observers: new Set(),
    performance: { now },
    requestAnimationFrame(cb) {
      const id = setTimeout(() => {
        w.pending.delete(id);
        cb(now());
      }, 16);
      w.pending.add(id);
      return id;
    },
    cancelAnimationFrame(id) {
      w.pending.delete(id);
      clearTimeout(id);
    },
  };
  if (observer) {
    w.PerformanceObserver = class {
      static supportedEntryTypes = ['longtask'];
      constructor(cb) {
        this.cb = cb;
      }
      observe() {
        w.observers.add(this);
      }
      disconnect() {
        w.observers.delete(this);
      }
      takeRecords() {
        return [];
      }
    };
  }
  return w;
}

function fakeHooks() {
  const m = new Map();
  return {
    on(n, f) {
      if (!m.has(n)) m.set(n, new Set());
      m.get(n).add(f);
    },
    off(n, f) {
      m.get(n)?.delete(f);
    },
    callAll(n, ...a) {
      for (const f of [...(m.get(n) ?? [])]) f(...a);
    },
    count: (n) => m.get(n)?.size ?? 0,
  };
}

function adapterFor(hooks, { startAfter = 20, completeAfter = 100, never = false, extra = {} } = {}) {
  let n = 0;
  const a = {
    product: 'dicer',
    rollTimes: [],
    completeTimes: [],
    perturbs: [],
    async roll() {
      const id = `m${++n}`;
      a.rollTimes.push(now());
      if (!never) {
        setTimeout(() => hooks.callAll('diceSoNiceRollStart', id, {}), startAfter);
        setTimeout(() => {
          a.completeTimes.push(now());
          hooks.callAll('diceSoNiceRollComplete', id);
        }, completeAfter);
      }
      return { messageId: id };
    },
    isBusy: () => false,
    resources: vi.fn(() => ({ geometries: 3, textures: 2, programs: 1 })),
    heap: vi.fn(async () => 1000),
    dicerFirstFrame: (id) => (id === 'm1' ? null : 12),
    perturb: vi.fn(async (kind, ms) => {
      a.perturbs.push({ kind, ms, at: now() });
    }),
    ...extra,
  };
  return a;
}

const by = (id) => SCENARIOS.find((s) => s.id === id);

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
afterEach(() => vi.useRealTimers());

test('SCENARIOS is the frozen spec list', () => {
  const mixed = '1d4+2d6+2d8+2d10+2d12+1d20';
  expect(Object.isFrozen(SCENARIOS)).toBe(true);
  expect(SCENARIOS.map((s) => [s.id, s.kind, s.formula, s.rolls])).toEqual([
    ['d20', 'typical', '1d20', 1],
    ['mixed10', 'typical', mixed, 1],
    ['pool30', 'bigPool', '30d6', 1],
    ['burst100', 'burst', '1d20+2d6', 100],
    ['burst20', 'burst', '1d20+2d6', 20],
    ['soak500', 'soak', '1d20+2d6', 500],
    ['resize', 'perturb', mixed, 1],
    ['contextLoss', 'perturb', mixed, 2],
    ['hidden', 'perturb', mixed, 1],
  ]);
  expect(by('contextLoss').recover).toBe(true);
  expect(by('resize').recover).toBeFalsy();
});

test('contextLoss: perturb on roll 1 only, roll 2 after the restore, then verifyRecovered', async () => {
  const hooks = fakeHooks();
  const log = [];
  let restore;
  const a = adapterFor(hooks, { startAfter: 10, completeAfter: 600 });
  const roll = a.roll;
  a.roll = async (f) => {
    log.push('roll');
    return roll(f);
  };
  a.perturb = vi.fn(() => {
    log.push('perturb');
    return new Promise((r) => (restore = () => {
      log.push('restored');
      r();
    }));
  });
  a.verifyRecovered = vi.fn((ctx) => {
    log.push(`verify ${ctx?.messageId}`);
    return true;
  });
  const p = runScenario(by('contextLoss'), a, { hooks, win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(2000);
  expect(log).toEqual(['roll', 'perturb']); // roll 1 done, roll 2 waits for the restore
  restore();
  await vi.advanceTimersByTimeAsync(2000);
  const r = await p;
  expect(log).toEqual(['roll', 'perturb', 'restored', 'roll', 'verify m2']);
  expect(a.perturb).toHaveBeenCalledTimes(1);
  expect(r).toMatchObject({ scenario: 'contextLoss', kind: 'perturb', rolls: 2, failures: 0, recovered: true });
});

test('recovered: null without verifyRecovered, null plus a note when it throws; absent for other perturbs', async () => {
  const run = async (sc, extra) => {
    const hooks = fakeHooks();
    const p = runScenario(sc, adapterFor(hooks, { startAfter: 10, completeAfter: 500, extra }), { hooks, win: fakeWin(), now });
    await vi.advanceTimersByTimeAsync(3000);
    return p;
  };
  expect((await run(by('contextLoss'), {})).recovered).toBeNull();
  const thrown = await run(by('contextLoss'), { verifyRecovered: () => { throw new Error('gl gone'); } });
  expect(thrown.recovered).toBeNull();
  expect(thrown.notes.join(' ')).toMatch(/verifyRecovered failed: gl gone/);
  expect(await run(by('contextLoss'), { verifyRecovered: () => false })).toMatchObject({ recovered: false });
  expect('recovered' in (await run(by('resize'), { verifyRecovered: () => true }))).toBe(false);
});

test('a perturb that never fired (the roll ended first) is noted', async () => {
  const hooks = fakeHooks();
  const a = adapterFor(hooks, { startAfter: 5, completeAfter: 50 });
  const p = runScenario(by('resize'), a, { hooks, win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(1000);
  const r = await p;
  expect(a.perturb).not.toHaveBeenCalled();
  expect(r.notes.join(' ')).toMatch(/perturb did not fire/);
});

test('tier is recorded before and after each scenario; a change is noted (adaptive drop)', async () => {
  const hooks = fakeHooks();
  const tiers = ['high', 'medium'];
  const a = adapterFor(hooks, { extra: { info: vi.fn(() => ({ tier: tiers.shift() ?? 'medium' })) } });
  const p = runScenario(by('d20'), a, { hooks, win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(500);
  const r = await p;
  expect(r.tier).toEqual({ before: 'high', after: 'medium' });
  expect(r.notes).toContain('tier changed high -> medium (adaptive drop)');
  const b = adapterFor(hooks, { extra: { info: async () => ({ tier: 'high' }) } });
  const q = runScenario(by('d20'), b, { hooks, win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(500);
  const s = await q;
  expect(s.tier).toEqual({ before: 'high', after: 'high' });
  expect(s.notes.join(' ')).not.toMatch(/tier changed/);
  const c = runScenario(by('d20'), adapterFor(hooks), { hooks, win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(500);
  expect((await c).tier).toEqual({ before: null, after: null });
});

test('d20 firstFrame is roll call to first rAF after RollStart', async () => {
  const win = fakeWin();
  const hooks = fakeHooks();
  const a = adapterFor(hooks);
  const p = runScenario(by('d20'), a, { hooks, win, now });
  await vi.advanceTimersByTimeAsync(500);
  const r = await p;
  expect(r).toMatchObject({ scenario: 'd20', kind: 'typical', product: 'dicer', rolls: 1, failures: 0 });
  expect(r.firstFrame.p50).toBe(36);
  expect(r.frame.n).toBeGreaterThan(3);
  expect(r.longTasks).toBeNull();
  expect(r.heap).toBeNull();
  expect(r.resources).toBeNull();
  expect(r.dicerFirstFrame).toBeNull();
  expect(hooks.count('diceSoNiceRollStart')).toBe(0);
  expect(hooks.count('diceSoNiceRollComplete')).toBe(0);
  expect(win.pending.size).toBe(0);
});

test('dicerFirstFrame summarises non-null values only', async () => {
  const hooks = fakeHooks();
  const a = adapterFor(hooks, { completeAfter: 30 });
  const p = runScenario({ id: 'x', kind: 'burst', formula: '1d20', rolls: 3 }, a, { hooks, win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(1000);
  const r = await p;
  expect(r.dicerFirstFrame.n).toBe(2);
  expect(r.dicerFirstFrame.mean).toBe(12);
});

test('burst100 starts roll k+1 only after roll k completes', async () => {
  const hooks = fakeHooks();
  const a = adapterFor(hooks, { startAfter: 5, completeAfter: 40 });
  const p = runScenario(by('burst100'), a, { hooks, win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(20000);
  const r = await p;
  expect(r.rolls).toBe(100);
  expect(a.rollTimes).toHaveLength(100);
  for (let k = 1; k < 100; k++) expect(a.rollTimes[k]).toBeGreaterThanOrEqual(a.completeTimes[k - 1]);
  expect(r.failures).toBe(0);
});

test('a roll that never completes fails after timeoutMs and the suite finishes', async () => {
  const hooks = fakeHooks();
  const a = adapterFor(hooks, { never: true });
  const p = runSuite(['d20', 'mixed10'], a, { hooks, win: fakeWin(), now, timeoutMs: 1000 });
  await vi.advanceTimersByTimeAsync(5000);
  const s = await p;
  expect(s.results.map((r) => r.failures)).toEqual([1, 1]);
  expect(s.results[0].notes.join(' ')).toMatch(/timed out/i);
  expect(hooks.count('diceSoNiceRollComplete')).toBe(0);
});

test('soak500 reads heap and resources exactly at roll 50 and roll 500', async () => {
  const hooks = fakeHooks();
  let rolled = 0;
  const log = [];
  const a = adapterFor(hooks, { startAfter: 1, completeAfter: 5 });
  const origRoll = a.roll;
  a.roll = async (f) => {
    rolled++;
    return origRoll(f);
  };
  a.heap = vi.fn(async () => {
    log.push(['heap', rolled]);
    return log.length < 3 ? 1000 : 1500;
  });
  a.resources = vi.fn(() => {
    log.push(['res', rolled]);
    return { geometries: 3, textures: 2, programs: 1 };
  });
  const p = runScenario(by('soak500'), a, { hooks, win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(20000);
  const r = await p;
  expect(a.heap).toHaveBeenCalledTimes(2);
  expect(a.resources).toHaveBeenCalledTimes(2);
  expect(log.map(([, n]) => n).sort((x, y) => x - y)).toEqual([50, 50, 500, 500]);
  expect(r.heap).toEqual({ before: 1000, after: 1500 });
  expect(r.resources.before).toEqual({ geometries: 3, textures: 2, programs: 1 });
  expect(r.rolls).toBe(500);
});

test('soak heap and resources are null when a reading is null', async () => {
  const hooks = fakeHooks();
  const a = adapterFor(hooks, { startAfter: 1, completeAfter: 3, extra: { heap: async () => null, resources: () => null } });
  const p = runScenario({ id: 'soak500', kind: 'soak', formula: '1d20', rolls: 500 }, a, { hooks, win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(20000);
  const r = await p;
  expect(r.heap).toBeNull();
  expect(r.resources).toBeNull();
});

test('perturb fires about 300 ms after RollStart without blocking completion', async () => {
  const hooks = fakeHooks();
  const a = adapterFor(hooks, { startAfter: 20, completeAfter: 1000 });
  a.perturb = vi.fn(() => new Promise(() => {}));
  const p = runScenario(by('hidden'), a, { hooks, win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(2000);
  const r = await p;
  expect(r.failures).toBe(0);
  expect(a.perturb).toHaveBeenCalledTimes(1);
  expect(a.perturb.mock.calls[0]).toEqual(['hidden', 3000]);
});

test('perturb kind, duration and timing per scenario', async () => {
  const got = {};
  for (const id of ['resize', 'contextLoss', 'hidden']) {
    const hooks = fakeHooks();
    const a = adapterFor(hooks, { startAfter: 10, completeAfter: 800 });
    const t0 = now();
    const p = runScenario(by(id), a, { hooks, win: fakeWin(), now });
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    got[id] = { ...a.perturbs[0], dt: a.perturbs[0].at - t0 };
  }
  expect(got.resize.kind).toBe('resize');
  expect(got.contextLoss).toMatchObject({ kind: 'contextLoss', ms: 500 });
  expect(got.hidden).toMatchObject({ kind: 'hidden', ms: 3000 });
  expect(got.hidden.dt).toBeGreaterThanOrEqual(300);
  expect(got.hidden.dt).toBeLessThan(400);
});

test('runSuite shapes SuiteResult with info and nulls', async () => {
  const hooks = fakeHooks();
  const a = adapterFor(hooks);
  const s1 = runSuite(['d20'], a, { hooks, win: fakeWin(), now, profile: 'vsync' });
  await vi.advanceTimersByTimeAsync(500);
  expect(await s1).toMatchObject({ browser: null, gpu: null, tier: null, version: null, profile: 'vsync' });
  a.info = () => ({ browser: 'Chrome 130', gpu: 'RTX', tier: 'high', version: '0.1.0' });
  const s2 = runSuite(['d20'], a, { hooks, win: fakeWin(), now, profile: 'vsync' });
  await vi.advanceTimersByTimeAsync(500);
  const r = await s2;
  expect(r).toMatchObject({ browser: 'Chrome 130', gpu: 'RTX', tier: 'high', version: '0.1.0' });
  expect(r.results).toHaveLength(1);
});

test('recorder samples between start and stop and cleans up', async () => {
  const win = fakeWin({ observer: true });
  const rec = createRecorder({ win });
  rec.start();
  rec.mark('a');
  expect(win.observers.size).toBe(1);
  await vi.advanceTimersByTimeAsync(100);
  const out = rec.stop();
  expect(out.intervals.length).toBeGreaterThan(3);
  expect(out.intervals.every((x) => x === 16)).toBe(true);
  expect(out.longTasks).toEqual([]);
  expect(typeof out.marks.a).toBe('number');
  expect(win.pending.size).toBe(0);
  expect(win.observers.size).toBe(0);
});

test('recorder longTasks is null without PerformanceObserver', async () => {
  const win = fakeWin();
  const rec = createRecorder({ win });
  rec.start();
  await vi.advanceTimersByTimeAsync(50);
  expect(rec.stop().longTasks).toBeNull();
  expect(win.pending.size).toBe(0);
});

function noMsgAdapter({ doneAfter = 40, startAfter = 10, never = false, withStarted = true } = {}) {
  const a = {
    product: 'dicer',
    rollTimes: [],
    doneTimes: [],
    isBusy: () => false,
    resources: () => null,
    heap: async () => null,
    dicerFirstFrame: () => null,
    perturb: async () => {},
    async roll() {
      a.rollTimes.push(now());
      const done = never
        ? new Promise(() => {})
        : new Promise((r) => setTimeout(() => {
            a.doneTimes.push(now());
            r();
          }, doneAfter));
      const started = new Promise((r) => setTimeout(r, startAfter));
      return withStarted ? { done, started } : { done };
    },
  };
  return a;
}

test('no-message burst: roll k+1 starts after roll k done', async () => {
  const a = noMsgAdapter();
  const p = runScenario({ id: 'b', kind: 'burst', formula: '1d20', rolls: 5 }, a, { hooks: fakeHooks(), win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(2000);
  const r = await p;
  expect(r.failures).toBe(0);
  for (let k = 1; k < 5; k++) expect(a.rollTimes[k]).toBeGreaterThanOrEqual(a.doneTimes[k - 1]);
});

test('no-message roll that never finishes times out', async () => {
  const a = noMsgAdapter({ never: true });
  const p = runScenario({ id: 'b', kind: 'typical', formula: '1d20', rolls: 1 }, a, { hooks: fakeHooks(), win: fakeWin(), now, timeoutMs: 1000 });
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  expect(r.failures).toBe(1);
  expect(r.notes.join(' ')).toMatch(/timed out/);
});

test('no-message started gives a firstFrame, absent started gives null', async () => {
  const a = noMsgAdapter({ startAfter: 20 });
  let p = runScenario({ id: 'b', kind: 'typical', formula: '1d20', rolls: 1 }, a, { hooks: fakeHooks(), win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(500);
  // started already resolves at the roll's first drawn frame: no extra rAF on top (I1).
  expect((await p).firstFrame.p50).toBe(20);
  const b = noMsgAdapter({ withStarted: false });
  p = runScenario({ id: 'b', kind: 'typical', formula: '1d20', rolls: 1 }, b, { hooks: fakeHooks(), win: fakeWin(), now });
  await vi.advanceTimersByTimeAsync(500);
  expect((await p).firstFrame).toBeNull();
});

test('a roll result with neither messageId nor done is a failure', async () => {
  const a = noMsgAdapter();
  a.roll = async () => ({});
  const r = await runScenario({ id: 'b', kind: 'typical', formula: '1d20', rolls: 1 }, a, { hooks: fakeHooks(), win: fakeWin(), now });
  expect(r.failures).toBe(1);
});

test('a roll() that never settles fails and the suite finishes', async () => {
  const hooks = fakeHooks();
  const a = adapterFor(hooks);
  a.roll = () => new Promise(() => {});
  const p = runSuite(['d20', 'mixed10'], a, { hooks, win: fakeWin(), now, timeoutMs: 1000 });
  await vi.advanceTimersByTimeAsync(5000);
  const s = await p;
  expect(s.results.map((r) => r.failures)).toEqual([1, 1]);
  expect(hooks.count('diceSoNiceRollStart')).toBe(0);
});

test('a soak heap() that never settles gives heap null and the run finishes', async () => {
  const hooks = fakeHooks();
  const a = adapterFor(hooks, { startAfter: 1, completeAfter: 3, extra: { heap: () => new Promise(() => {}) } });
  const p = runScenario(by('soak500'), a, { hooks, win: fakeWin(), now, timeoutMs: 1000 });
  await vi.advanceTimersByTimeAsync(30000);
  const r = await p;
  expect(r.heap).toBeNull();
  expect(r.rolls).toBe(500);
  expect(r.notes.join(' ')).toMatch(/heap timed out/);
});

test('heap throw: null plus note, recorder stopped, listeners removed', async () => {
  const hooks = fakeHooks();
  const a = adapterFor(hooks, { startAfter: 1, completeAfter: 3, extra: { heap: async () => { throw new Error('boom'); } } });
  const rec = { start: vi.fn(), stop: vi.fn(() => ({ intervals: [], longTasks: null, marks: {} })), mark() {} };
  const p = runScenario(by('soak500'), a, { hooks, win: fakeWin(), now, recorder: rec });
  await vi.advanceTimersByTimeAsync(30000);
  const r = await p;
  expect(r.heap).toBeNull();
  expect(r.notes.join(' ')).toMatch(/heap failed: boom/);
  expect(rec.stop).toHaveBeenCalledTimes(1);
  expect(hooks.count('diceSoNiceRollStart')).toBe(0);
  expect(hooks.count('diceSoNiceRollComplete')).toBe(0);
});

test('recorder.start throwing still removes the listeners', async () => {
  const hooks = fakeHooks();
  const rec = { start() { throw new Error('nope'); }, stop: vi.fn(() => null), mark() {} };
  await expect(runScenario(by('d20'), adapterFor(hooks), { hooks, win: fakeWin(), now, recorder: rec })).rejects.toThrow('nope');
  expect(hooks.count('diceSoNiceRollStart')).toBe(0);
  expect(hooks.count('diceSoNiceRollComplete')).toBe(0);
});

test('no Hooks global: the no-message path still works', async () => {
  const saved = globalThis.Hooks;
  delete globalThis.Hooks;
  try {
    const a = noMsgAdapter();
    const p = runScenario({ id: 'b', kind: 'typical', formula: '1d20', rolls: 1 }, a, { win: fakeWin(), now });
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).failures).toBe(0);
  } finally {
    if (saved) globalThis.Hooks = saved;
  }
});

test('hook events for foreign ids are ignored', async () => {
  const win = fakeWin();
  const hooks = fakeHooks();
  const a = adapterFor(hooks, { startAfter: 20, completeAfter: 100 });
  const p = runScenario(by('d20'), a, { hooks, win, now });
  await vi.advanceTimersByTimeAsync(50);
  const orig = win.requestAnimationFrame;
  let calls = 0;
  win.requestAnimationFrame = (cb) => {
    calls++;
    return orig(cb);
  };
  hooks.callAll('diceSoNiceRollStart', 'foreign', {});
  hooks.callAll('diceSoNiceRollComplete', 'foreign');
  expect(calls).toBe(0);
  await vi.advanceTimersByTimeAsync(500);
  const r = await p;
  expect(r.failures).toBe(0);
  expect(r.firstFrame.n).toBe(1);
});

// @vitest-environment jsdom
import { createDice3dApi } from '../../src/api/dice3d.js';
import { planThrow } from '../../src/throw/throw-planner.js';

/** A diceBox whose rolls land after a tick; the renderer's frame counter advances per frame. */
function fakes() {
  const state = { active: 0, rolls: 0 };
  const diceBox = {
    get activeRolls() {
      return state.active;
    },
    roll: vi.fn(() => {
      state.active++;
      state.rolls++;
      const landed = new Promise((r) =>
        setTimeout(() => {
          state.active--;
          r();
        }, 5),
      );
      return { landed, finished: landed };
    }),
  };
  const renderer = { isLooping: true, frameCount: 0, canvas: {}, glRenderer: null };
  const timer = setInterval(() => renderer.frameCount++, 4);
  return { state, diceBox, renderer, stop: () => clearInterval(timer) };
}

class FakeRoll {
  constructor(formula) {
    this.formula = formula;
    this.dice = [];
  }
  async evaluate() {
    this.dice = [{ faces: 20, results: [{ result: 7, active: true }] }];
    return this;
  }
}

let f, api, warn, create;
beforeEach(() => {
  f = fakes();
  warn = vi.fn();
  create = vi.fn();
  globalThis.Roll = FakeRoll;
  globalThis.ChatMessage = { create };
  globalThis.ui = { notifications: { warn } };
  globalThis.game = {
    user: { id: 'u1', isGM: true },
    i18n: { localize: (k) => `L:${k}` },
    modules: { get: () => ({ version: '9.9.9' }) },
  };
  api = createDice3dApi({
    diceBox: f.diceBox,
    gate: { disabled: false, waitFor: async () => true },
    planThrow,
    getSetting: (k) => ({ enabled: true, maxDice: 20 })[k],
    renderer: f.renderer,
    hooks: { on: () => {}, off: () => {}, callAll: () => {} },
    getTier: () => 'high',
    getGpu: () => 'Test GPU 9000',
  });
});
afterEach(() => {
  f.stop();
  delete globalThis.Roll;
  delete globalThis.ChatMessage;
  delete globalThis.ui;
  delete globalThis.game;
});

test('benchmark is a non-enumerable member', () => {
  expect(typeof api.benchmark).toBe('function');
  expect(Object.keys(api)).not.toContain('benchmark');
});

test('benchmark refuses with a localized notice while a roll is active, and runs nothing', async () => {
  f.state.active = 1;
  const spy = vi.spyOn(api, 'showForRoll');
  const out = await api.benchmark({ scenarios: ['d20'] });
  expect(out).toBeNull();
  expect(warn).toHaveBeenCalledWith('L:DICER.Bench.Busy');
  expect(spy).not.toHaveBeenCalled();
  expect(f.diceBox.roll).not.toHaveBeenCalled();
});

test('benchmark rolls with synchronize false, creates no chat message, and reports gpu and tier', async () => {
  const spy = vi.spyOn(api, 'showForRoll');
  const out = await api.benchmark({ scenarios: ['d20'] });
  expect(spy).toHaveBeenCalled();
  for (const call of spy.mock.calls) {
    expect(call[0]).toBeInstanceOf(FakeRoll);
    expect(call[1]).toBe(globalThis.game.user);
    expect(call[2]).toBe(false);
  }
  expect(create).not.toHaveBeenCalled();
  expect(out.suite.results).toHaveLength(1);
  expect(out.suite.results[0].failures).toBe(0);
  expect(out.suite.version).toBe('9.9.9');
  expect(out.text).toContain('Test GPU 9000');
  expect(out.text).toContain('tier high');
});

test('benchmark reports progress and refuses a second concurrent run', async () => {
  const progress = vi.fn();
  const first = api.benchmark({ scenarios: ['d20', 'mixed10'], onProgress: progress });
  expect(await api.benchmark({ scenarios: ['d20'] })).toBeNull();
  expect(warn).toHaveBeenCalledTimes(1);
  await first;
  expect(progress.mock.calls.map((c) => c[0].id)).toEqual(['d20', 'mixed10']);
  expect(progress.mock.calls[1][0]).toMatchObject({ index: 1, total: 2 });
});

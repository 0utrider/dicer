import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DiceBox } from '../../src/throw/dice-box.js';
import { buildScene } from '../../src/render/scene.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { buildDieGeometry } from '../../src/core/chamfer.js';

vi.mock('../../src/core/chamfer.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, buildDieGeometry: vi.fn(mod.buildDieGeometry) };
});

const atlas = {
  ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
  texture: new THREE.Texture(),
};
const appearance = { body: 'opaque', bodyColor: '#fff', fillColor: '#000', fillMetallic: false };
// 960 x 480 px at 48 px per die: halfWidth 10, halfDepth 5.
const rect = { left: 0, top: 0, width: 960, height: 480 };

/** Two 30-step chunks per throw: the dice roll in from x = -30 and stop at x = 0. */
function chunksFor(n) {
  const out = [];
  for (let c = 0; c < 2; c++) {
    const data = new Float32Array(30 * 7 * n);
    for (let s = 0; s < 30; s++) {
      const x = -30 + (30 * (c * 30 + s)) / 59;
      for (let d = 0; d < n; d++) data.set([x, 0.5, d * 1.5, 0, 0, 0, 1], (s * n + d) * 7);
    }
    out.push({ index: c, steps: 30, data, done: c === 1 });
  }
  return out;
}

function fakePhysics() {
  const streams = [];
  return {
    streams,
    resize: vi.fn(),
    recycle: vi.fn(),
    emitted: 0,
    throw(req) {
      const s = { req, cb: null, flushed: false };
      s.done = new Promise((resolve, reject) => {
        s.resolve = resolve;
        s.reject = reject;
      });
      s.done.catch(() => {});
      streams.push(s);
      return { onChunk: (cb) => (s.cb = cb), done: s.done };
    },
    /** Emits both chunks of every unflushed stream (or only stream i). */
    flush(i) {
      const list = i === undefined ? streams : [streams[i]];
      for (const s of list) {
        if (s.flushed) continue;
        s.flushed = true;
        for (const c of chunksFor(s.req.dice.length)) {
          this.emitted += 1;
          s.cb(c);
        }
        s.resolve({ settledStep: 59 });
      }
    },
    /** Emits only the first (not done) chunk of stream i. */
    emitFirst(i) {
      const s = streams[i];
      s.flushed = true;
      this.emitted += 1;
      s.cb(chunksFor(s.req.dice.length)[0]);
    },
    fail(i, err = new Error('boom')) {
      streams[i].reject(err);
    },
  };
}

function fakeRenderer() {
  const sceneApi = buildScene();
  const r = {
    sceneApi,
    scene: sceneApi.scene,
    setArea: vi.fn(),
    onContextLost: vi.fn(),
    startLoop: vi.fn((t) => (r.tickFn = t)),
    hide: vi.fn(() => (r.tickFn = null)),
    tickFn: null,
    get isLooping() {
      return r.tickFn !== null;
    },
    /** Runs one frame; like DiceRenderer, a false return stops the loop and hides. */
    tick(ms) {
      if (!r.tickFn) return false;
      const again = r.tickFn(ms);
      if (!again) r.hide();
      return again;
    },
  };
  return r;
}

function setup(opts = {}) {
  const renderer = fakeRenderer();
  const physics = fakePhysics();
  const box = new DiceBox({
    renderer,
    physics,
    atlas,
    appearance,
    getArea: () => rect,
    diceScale: () => 1,
    timeBeforeHide: () => 2000,
    ...opts,
  });
  return { renderer, physics, box };
}

const settled = (p) => {
  let done = false;
  p.then(() => (done = true));
  return () => done;
};
const flushMicrotasks = () => new Promise((r) => queueMicrotask(r)).then(() => Promise.resolve());
const dieGroups = (renderer) =>
  renderer.scene.children.filter((o) => o.isGroup && o.userData.dicerDie);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test('constructor fits the area in die units', () => {
  const { renderer, physics } = setup({ diceScale: () => 2 });
  expect(renderer.setArea).toHaveBeenCalledWith(rect);
  expect(physics.resize).toHaveBeenCalledWith({ halfWidth: 5, halfDepth: 2.5 });
});

test('landed resolves after playback lands; finished after timeBeforeHide + fade; then the loop stops and the canvas hides', async () => {
  const { renderer, physics, box } = setup();
  const { landed, finished } = box.roll([{ type: 'd6', value: 3 }]);
  const isLanded = settled(landed);
  const isFinished = settled(finished);
  expect(box.activeRolls).toBe(1);
  expect(dieGroups(renderer).every((g) => !g.visible)).toBe(true);

  physics.flush();
  renderer.tick(16);
  expect(dieGroups(renderer).every((g) => g.visible)).toBe(true);
  renderer.tick(500);
  await flushMicrotasks();
  expect(isLanded()).toBe(false);
  expect(renderer.tick(2000)).toBe(true);
  await flushMicrotasks();
  expect(isLanded()).toBe(true);
  expect(isFinished()).toBe(false);

  vi.advanceTimersByTime(1999);
  expect(renderer.tick(2100)).toBe(true);
  vi.advanceTimersByTime(1);
  expect(renderer.tick(2200)).toBe(true); // fade starts
  const mesh = dieGroups(renderer)[0].children[0];
  expect(mesh.material.transparent).toBe(true);
  renderer.tick(2400);
  expect(mesh.material.opacity).toBeCloseTo(0.5, 5);
  await flushMicrotasks();
  expect(isFinished()).toBe(false);
  expect(renderer.tick(2600)).toBe(false);
  await flushMicrotasks();
  expect(isFinished()).toBe(true);
  expect(renderer.hide).toHaveBeenCalled();
  expect(renderer.isLooping).toBe(false);
  expect(box.activeRolls).toBe(0);
  expect(dieGroups(renderer)).toHaveLength(0);
});

test('fade uses clones and never mutates the cached materials', async () => {
  const { renderer, physics, box } = setup();
  box.roll([{ type: 'd6', value: 3 }]);
  physics.flush();
  renderer.tick(0);
  renderer.tick(2000);
  const mesh = dieGroups(renderer)[0].children[0];
  const original = mesh.material;
  vi.advanceTimersByTime(2000);
  renderer.tick(2100);
  expect(mesh.material).not.toBe(original);
  expect(original.transparent).toBe(false);
  expect(original.opacity).toBe(1);
  expect(mesh.material.customProgramCacheKey()).toBe(original.customProgramCacheKey());

  const second = box.roll([{ type: 'd6', value: 5 }]);
  physics.flush();
  renderer.tick(2200);
  const mesh2 = dieGroups(renderer).at(-1).children[0];
  expect(mesh2.material).toBe(original);
  box.clear();
  await second.finished;
});

test('two concurrent rolls each resolve landed independently, and the loop keeps running until both finish', async () => {
  const { renderer, physics, box } = setup();
  const a = box.roll([{ type: 'd20', value: 17 }]);
  const b = box.roll([
    { type: 'd6', value: 1 },
    { type: 'd6', value: 6 },
  ]);
  const aLanded = settled(a.landed);
  const bLanded = settled(b.landed);
  const aFinished = settled(a.finished);
  const bFinished = settled(b.finished);
  expect(box.activeRolls).toBe(2);

  physics.flush(0);
  renderer.tick(0);
  renderer.tick(2000);
  await flushMicrotasks();
  expect(aLanded()).toBe(true);
  expect(bLanded()).toBe(false);

  physics.flush(1);
  vi.advanceTimersByTime(2000);
  expect(renderer.tick(2100)).toBe(true);
  expect(renderer.tick(2600)).toBe(true); // a has finished, b is still playing
  await flushMicrotasks();
  expect(aFinished()).toBe(true);
  expect(bLanded()).toBe(false);
  expect(box.activeRolls).toBe(1);

  expect(renderer.tick(4000)).toBe(true);
  await flushMicrotasks();
  expect(bLanded()).toBe(true);
  vi.advanceTimersByTime(2000);
  renderer.tick(4100);
  expect(renderer.tick(4600)).toBe(false);
  await flushMicrotasks();
  expect(bFinished()).toBe(true);
  expect(renderer.hide).toHaveBeenCalled();
});

test('clear() resolves all pending landed/finished promises and leaves no rolls', async () => {
  const { renderer, physics, box } = setup();
  const a = box.roll([{ type: 'd8', value: 2 }]);
  const b = box.roll([{ type: 'd10', value: 0, variant: 'd100tens' }]);
  physics.flush(0);
  renderer.tick(0);
  renderer.tick(16);
  expect(renderer.sceneApi.scene.children.length).toBeGreaterThan(1);
  box.clear();
  await Promise.all([a.landed, a.finished, b.landed, b.finished]);
  expect(box.activeRolls).toBe(0);
  expect(dieGroups(renderer)).toHaveLength(0);
  expect(renderer.scene.children.filter((o) => o.isMesh)).toHaveLength(0); // no shadows
  // Chunks that arrive after the roll was cleared go straight back to the pool.
  const before = physics.recycle.mock.calls.length;
  physics.flush(1);
  expect(physics.recycle.mock.calls.length - before).toBe(2);
  expect(renderer.tick(32)).toBe(false);
});

test('chunk buffers are recycled to physics after each roll finishes', async () => {
  const { renderer, physics, box } = setup();
  const a = box.roll([{ type: 'd4', value: 3 }]);
  const b = box.roll([{ type: 'd12', value: 9 }]);
  physics.flush();
  renderer.tick(0);
  renderer.tick(2000);
  expect(physics.recycle).not.toHaveBeenCalled();
  vi.advanceTimersByTime(2000);
  renderer.tick(2100);
  renderer.tick(2600);
  await Promise.all([a.finished, b.finished]);
  expect(physics.recycle).toHaveBeenCalledTimes(physics.emitted);
  for (const [buf] of physics.recycle.mock.calls) expect(buf).toBeInstanceOf(Float32Array);
});

test('geometry is built once per die type across rolls', async () => {
  buildDieGeometry.mockClear();
  const { physics, box } = setup();
  box.roll([
    { type: 'd6', value: 1 },
    { type: 'd6', value: 2 },
    { type: 'd20', value: 3 },
  ]);
  box.roll([
    { type: 'd6', value: 4 },
    { type: 'd10', value: 10, variant: 'd100tens' },
    { type: 'd10', value: 7 },
  ]);
  physics.flush();
  expect(buildDieGeometry).toHaveBeenCalledTimes(3);
  box.clear();
});

test('tens dice use their own label set and map onto d10 faces 1..10', () => {
  const { physics, box, renderer } = setup();
  box.roll([
    { type: 'd10', value: 0, variant: 'd100tens' },
    { type: 'd10', value: 10 },
  ]);
  const [tens, ones] = dieGroups(renderer).map((g) => g.children[0]);
  expect(tens.material).not.toBe(ones.material);
  expect(tens.geometry).toBe(ones.geometry);
  expect(physics.streams[0].req.dice).toEqual([{ type: 'd10' }, { type: 'd10' }]);
  expect(Number.isInteger(physics.streams[0].req.seed)).toBe(true);
  box.clear();
});

test('an empty roll resolves immediately and starts no loop', async () => {
  const { renderer, box } = setup();
  const { landed, finished } = box.roll([]);
  await Promise.all([landed, finished]);
  expect(renderer.startLoop).not.toHaveBeenCalled();
  expect(box.activeRolls).toBe(0);
});

test('a roll that throws synchronously or whose physics stream rejects does not hang', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { renderer, physics, box } = setup();
  const bad = box.roll([{ type: 'd7', value: 1 }]);
  await Promise.all([bad.landed, bad.finished]);
  const rejected = box.roll([{ type: 'd6', value: 2 }]);
  physics.fail(0);
  await Promise.all([rejected.landed, rejected.finished]);
  expect(err).toHaveBeenCalledTimes(2);
  expect(box.activeRolls).toBe(0);
  expect(dieGroups(renderer)).toHaveLength(0);
  err.mockRestore();
});

test('onResize refits the area', () => {
  const { renderer, physics, box } = setup();
  rect.width = 480;
  box.onResize();
  rect.width = 960;
  expect(renderer.setArea).toHaveBeenCalledTimes(2);
  expect(physics.resize).toHaveBeenLastCalledWith({ halfWidth: 5, halfDepth: 5 });
});

test('context loss clears every roll', async () => {
  const { renderer, box } = setup();
  const r = box.roll([{ type: 'd6', value: 2 }]);
  renderer.onContextLost.mock.calls[0][0]();
  await Promise.all([r.landed, r.finished]);
  expect(box.activeRolls).toBe(0);
});

test('the loop starts on the first chunk, not when the roll is made', () => {
  const { renderer, physics, box } = setup();
  box.roll([{ type: 'd6', value: 2 }]);
  expect(renderer.startLoop).not.toHaveBeenCalled();
  physics.emitFirst(0);
  expect(renderer.startLoop).toHaveBeenCalledTimes(1);
  box.clear();
});

test('a roll with no chunk within 5000 ms fails without ever starting the loop', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { renderer, box } = setup();
  const r = box.roll([{ type: 'd6', value: 2 }]);
  const isFinished = settled(r.finished);
  vi.advanceTimersByTime(4999);
  await flushMicrotasks();
  expect(isFinished()).toBe(false);
  vi.advanceTimersByTime(1);
  await Promise.all([r.landed, r.finished]);
  expect(box.activeRolls).toBe(0);
  expect(renderer.startLoop).not.toHaveBeenCalled();
  expect(dieGroups(renderer)).toHaveLength(0);
  expect(err).toHaveBeenCalledTimes(1);
  err.mockRestore();
});

test('a roll whose done chunk never comes fails after 15000 ms and recycles its buffers', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { renderer, physics, box } = setup();
  const r = box.roll([{ type: 'd6', value: 2 }]);
  const isFinished = settled(r.finished);
  vi.advanceTimersByTime(1000);
  physics.emitFirst(0);
  renderer.tick(0);
  vi.advanceTimersByTime(13999);
  await flushMicrotasks();
  expect(isFinished()).toBe(false);
  vi.advanceTimersByTime(1);
  await Promise.all([r.landed, r.finished]);
  expect(box.activeRolls).toBe(0);
  expect(physics.recycle).toHaveBeenCalledTimes(1);
  expect(renderer.tick(16)).toBe(false);
  expect(err).toHaveBeenCalledTimes(1);
  err.mockRestore();
});

test('a roll that completes normally does not trip the stall timeouts', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { renderer, physics, box } = setup({ timeBeforeHide: () => 20000 });
  const r = box.roll([{ type: 'd6', value: 2 }]);
  physics.flush();
  renderer.tick(0);
  renderer.tick(2000);
  await r.landed;
  vi.advanceTimersByTime(16000);
  expect(box.activeRolls).toBe(1);
  expect(err).not.toHaveBeenCalled();
  box.clear();
  err.mockRestore();
});

describe('hidden tabs get no animation frames', () => {
  class FakeVisibility extends EventTarget {
    hidden = false;
    setHidden(value) {
      this.hidden = value;
      this.dispatchEvent(new Event('visibilitychange'));
    }
  }

  test('(a) a roll made while the document is hidden resolves landed and finished at once, without throwing', async () => {
    const visibility = new FakeVisibility();
    visibility.hidden = true;
    const { renderer, physics, box } = setup({ visibility });
    const r = box.roll([{ type: 'd6', value: 2 }]);
    await Promise.all([r.landed, r.finished]);
    expect(physics.streams).toHaveLength(0);
    expect(box.activeRolls).toBe(0);
    expect(renderer.startLoop).not.toHaveBeenCalled();
    expect(dieGroups(renderer)).toHaveLength(0);
  });

  test('(b) visibilitychange to hidden clears every roll; back to visible does nothing', async () => {
    const visibility = new FakeVisibility();
    const { physics, box } = setup({ visibility });
    const a = box.roll([{ type: 'd6', value: 2 }]);
    physics.flush();
    visibility.setHidden(false);
    expect(box.activeRolls).toBe(1);
    visibility.setHidden(true);
    await Promise.all([a.landed, a.finished]);
    expect(box.activeRolls).toBe(0);
  });

  test('(b) dispose() stops listening for visibilitychange', () => {
    const visibility = new FakeVisibility();
    const { box } = setup({ visibility });
    const remove = vi.spyOn(visibility, 'removeEventListener');
    box.dispose();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  test('(c) after done, a roll that gets no frames fails at its expected duration + 3000 ms', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { physics, box } = setup();
    const r = box.roll([{ type: 'd6', value: 2 }]);
    const isLanded = settled(r.landed);
    physics.flush(); // done: settledStep 59 → ceil(59 / 60 s) = 984 ms
    await flushMicrotasks();
    vi.advanceTimersByTime(984 + 3000 - 1);
    await flushMicrotasks();
    expect(isLanded()).toBe(false);
    vi.advanceTimersByTime(1);
    await Promise.all([r.landed, r.finished]);
    expect(box.activeRolls).toBe(0);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  test('(c) the landing timeout is cleared when the roll lands normally', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { renderer, physics, box } = setup({ timeBeforeHide: () => 60000 });
    const r = box.roll([{ type: 'd6', value: 2 }]);
    physics.flush();
    await flushMicrotasks();
    renderer.tick(0);
    renderer.tick(2000);
    await r.landed;
    vi.advanceTimersByTime(10000);
    expect(box.activeRolls).toBe(1);
    expect(err).not.toHaveBeenCalled();
    box.clear();
    err.mockRestore();
  });

  test('(d) an exception inside the chunk handler fails the roll instead of escaping', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { renderer, physics, box } = setup();
    renderer.startLoop.mockImplementation(() => {
      throw new Error('startLoop boom');
    });
    const r = box.roll([{ type: 'd6', value: 2 }]);
    expect(() => physics.flush()).not.toThrow();
    await Promise.all([r.landed, r.finished]);
    expect(box.activeRolls).toBe(0);
    expect(err).toHaveBeenCalledTimes(1);
    // The rest of the stream's chunks went straight back to the pool.
    expect(physics.recycle).toHaveBeenCalledTimes(physics.emitted);
    err.mockRestore();
  });
});

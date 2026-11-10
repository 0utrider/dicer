import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DiceBox } from '../../src/throw/dice-box.js';
import { buildScene } from '../../src/render/scene.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { buildDieGeometry } from '../../src/core/chamfer.js';
import { createDiceMaterial } from '../../src/render/dice-material.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';
import { GHOST_APPEARANCE } from '../../src/compat/colorset-map.js';
import { createFaceTextures } from '../../src/render/face-textures.js';

vi.mock('../../src/render/dice-material.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    createDiceMaterial: vi.fn(mod.createDiceMaterial),
  };
});
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
  // the clone compiles the same program: Material.clone() resets three's defines
  expect(original.defines).toHaveProperty('DICER_ENGRAVE');
  expect(mesh.material.defines).toEqual(original.defines);

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

test('geometry cache is keyed by type|edge style and passes the style (P2-R5)', () => {
  buildDieGeometry.mockClear();
  const { physics, box } = setup({
    appearance: { body: { type: 'resin' }, edges: { style: 'sharp' } },
  });
  box.roll([
    { type: 'd6', value: 1 },
    { type: 'd6', value: 2 },
  ]);
  physics.flush();
  expect(buildDieGeometry).toHaveBeenCalledTimes(1);
  expect(buildDieGeometry.mock.calls[0][1]).toEqual({ style: 'sharp' });
  box.clear();
  buildDieGeometry.mockClear();
  const legacy = setup();
  legacy.box.roll([{ type: 'd6', value: 1 }]);
  legacy.physics.flush();
  expect(buildDieGeometry.mock.calls[0][1]).toEqual({ style: 'rounded' });
  legacy.box.clear();
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

describe('per-roll appearance, flags and refcounted materials', () => {
  const ruby = { body: { type: 'opaque', color: '#b3202a' }, numbers: { fill: 'paint' } };
  const jade = { body: { type: 'marble', color: '#3f9a6c' }, numbers: { fill: 'gold' } };
  const meshOf = (renderer, i = -1) => dieGroups(renderer).at(i).children[0];

  test('two looks give different cached materials; same look reuses', () => {
    let look = ruby;
    const { renderer, box } = setup({ appearance: undefined, getAppearance: () => look });
    box.roll([{ type: 'd6', value: 1 }]);
    const a = meshOf(renderer).material;
    look = jade;
    box.roll([{ type: 'd6', value: 1 }]);
    const b = meshOf(renderer).material;
    expect(b).not.toBe(a);
    look = { ...ruby }; // a different object, the same look
    box.roll([{ type: 'd6', value: 1 }]);
    expect(meshOf(renderer).material).toBe(a);
    box.clear();
  });

  test('the fixed appearance option still works as a constant getter', () => {
    const { renderer, box } = setup({ appearance: ruby });
    box.roll([{ type: 'd6', value: 1 }]);
    box.roll([{ type: 'd6', value: 2 }]);
    expect(meshOf(renderer, 0).material).toBe(meshOf(renderer, 1).material);
    box.clear();
  });

  test('flags change the programKey part of the cache key', () => {
    const flags = { interiors: true, engraving: true, glow: true, interiorSteps: 32 };
    const { renderer, box } = setup({
      appearance: undefined,
      getAppearance: () => ({}),
      getFlags: () => flags,
    });
    box.roll([{ type: 'd6', value: 1 }]);
    const a = meshOf(renderer).material;
    flags.interiorSteps = 16;
    box.roll([{ type: 'd6', value: 1 }]);
    const b = meshOf(renderer).material;
    expect(b).not.toBe(a);
    expect(b.userData.programKey).not.toBe(a.userData.programKey);
    expect(b.userData.programKey).toContain(':16');
    flags.interiorSteps = 32;
    box.roll([{ type: 'd6', value: 1 }]);
    expect(meshOf(renderer).material).toBe(a);
    box.clear();
  });

  test('the geometry edge style follows the look of each roll', () => {
    buildDieGeometry.mockClear();
    let look = ruby;
    const { box } = setup({ appearance: undefined, getAppearance: () => look });
    box.roll([{ type: 'd6', value: 1 }]);
    look = { ...ruby, edges: { style: 'sharp' } };
    box.roll([{ type: 'd6', value: 1 }]);
    expect(buildDieGeometry.mock.calls.map((c) => c[1])).toEqual([
      { style: 'rounded' },
      { style: 'sharp' },
    ]);
    box.clear();
  });

  test('invalidateMaterials during a roll keeps the rolling dice rendering with their material, disposes it after finished', async () => {
    const { renderer, physics, box } = setup({ appearance: ruby });
    const r = box.roll([{ type: 'd6', value: 3 }]);
    physics.flush();
    renderer.tick(0);
    const mesh = meshOf(renderer);
    const mat = mesh.material;
    const dispose = vi.spyOn(mat, 'dispose');
    const labels = vi.spyOn(mat.userData.uniforms.uLabels.value, 'dispose');
    box.invalidateMaterials();
    expect(dispose).not.toHaveBeenCalled();
    expect(mesh.material).toBe(mat);
    // A new roll gets a fresh material for the same look.
    const r2 = box.roll([{ type: 'd6', value: 4 }]);
    expect(meshOf(renderer).material).not.toBe(mat);
    renderer.tick(2000);
    vi.advanceTimersByTime(2000);
    renderer.tick(2100); // fade (a clone of the stale material)
    expect(dispose).not.toHaveBeenCalled();
    renderer.tick(2600);
    await r.finished;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(labels).toHaveBeenCalledTimes(1);
    box.clear();
    await r2.finished;
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('an unused stale material is disposed immediately', async () => {
    const { renderer, box } = setup({ appearance: ruby });
    const r = box.roll([{ type: 'd6', value: 3 }]);
    const mat = meshOf(renderer).material;
    const dispose = vi.spyOn(mat, 'dispose');
    box.clear();
    await r.finished;
    expect(dispose).not.toHaveBeenCalled(); // still cached for the next roll
    box.invalidateMaterials();
    expect(dispose).toHaveBeenCalledTimes(1);
    box.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('a material shared by two rolls is disposed only when the last one finishes', async () => {
    const { renderer, physics, box } = setup({ appearance: ruby });
    const a = box.roll([{ type: 'd6', value: 3 }]);
    const mat = meshOf(renderer).material;
    const b = box.roll([{ type: 'd6', value: 5 }]);
    expect(meshOf(renderer).material).toBe(mat);
    const dispose = vi.spyOn(mat, 'dispose');
    box.invalidateMaterials();
    physics.flush(0);
    renderer.tick(0);
    renderer.tick(2000);
    vi.advanceTimersByTime(2000);
    renderer.tick(2100);
    renderer.tick(2600);
    await a.finished;
    expect(dispose).not.toHaveBeenCalled();
    box.clear();
    await b.finished;
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('invalidateMaterials({ replaceInFlight }) swaps rolling and fading dice onto rebuilt materials', async () => {
    const flags = { interiors: true, engraving: true, glow: true, interiorSteps: 32 };
    const { renderer, physics, box } = setup({
      appearance: undefined,
      getAppearance: () => ({}),
      getFlags: () => flags,
    });
    const fading = box.roll([{ type: 'd6', value: 3 }]);
    physics.flush(0);
    renderer.tick(0);
    renderer.tick(2000);
    vi.advanceTimersByTime(2000);
    renderer.tick(2100);
    renderer.tick(2200); // fading, opacity 0.75
    const rolling = box.roll([{ type: 'd8', value: 2 }]);
    const fadeMesh = meshOf(renderer, 0);
    const rollMesh = meshOf(renderer, 1);
    const oldFade = fadeMesh.material;
    const oldRoll = rollMesh.material;
    const disposeRoll = vi.spyOn(oldRoll, 'dispose');
    const disposeFade = vi.spyOn(oldFade, 'dispose');
    flags.interiorSteps = 0; // e.g. a shader error forced low
    box.invalidateMaterials({ replaceInFlight: true });
    expect(rollMesh.material).not.toBe(oldRoll);
    expect(rollMesh.material.userData.programKey).toContain('|none|');
    expect(disposeRoll).toHaveBeenCalledTimes(1);
    expect(fadeMesh.material).not.toBe(oldFade);
    expect(fadeMesh.material.transparent).toBe(true);
    expect(fadeMesh.material.opacity).toBeCloseTo(0.75, 5);
    expect(fadeMesh.material.userData.programKey).toContain('|none|');
    expect(disposeFade).toHaveBeenCalledTimes(1);
    renderer.tick(2300);
    expect(fadeMesh.material.opacity).toBeCloseTo(0.5, 5);
    box.clear();
    await Promise.all([fading.finished, rolling.finished]);
  });

  test('shadows() false creates no shadow planes', async () => {
    const { renderer, physics, box } = setup({ shadows: () => false });
    const r = box.roll([{ type: 'd6', value: 3 }]);
    physics.flush();
    renderer.tick(0);
    renderer.tick(16);
    expect(dieGroups(renderer).every((g) => g.visible)).toBe(true);
    expect(renderer.scene.children.filter((o) => o.isMesh)).toHaveLength(0);
    box.clear();
    await r.finished;
  });

  test('acquireWarmup() holds the current look materials until released', () => {
    const { box } = setup({ appearance: ruby });
    const warm = box.acquireWarmup(['d6', 'd20']);
    expect(warm.materials).toHaveLength(2);
    expect(warm.geometry.isBufferGeometry).toBe(true);
    const disposes = warm.materials.map((m) => vi.spyOn(m, 'dispose'));
    box.invalidateMaterials();
    for (const d of disposes) expect(d).not.toHaveBeenCalled();
    warm.release();
    for (const d of disposes) expect(d).toHaveBeenCalledTimes(1);
    warm.release(); // idempotent
    for (const d of disposes) expect(d).toHaveBeenCalledTimes(1);
  });

  test('warm-up materials are the ones the next roll uses', () => {
    const { renderer, box } = setup({ appearance: ruby });
    const warm = box.acquireWarmup(['d6']);
    warm.release();
    box.roll([{ type: 'd6', value: 1 }]);
    expect(meshOf(renderer).material).toBe(warm.materials[0]);
    box.clear();
  });
});

describe('per-die looks', () => {
  const red = { body: 'opaque', bodyColor: '#f00', fillColor: '#000', fillMetallic: false };
  const meshes = (renderer) => dieGroups(renderer).map((g) => g.children[0]);
  beforeEach(() => {
    createDiceMaterial.mockClear();
  });

  test('different appearances build different materials, equal ones share', () => {
    const { renderer, box } = setup();
    box.roll([
      { type: 'd6', value: 1, appearance: red },
      { type: 'd6', value: 2, appearance: red },
      { type: 'd6', value: 3, appearance },
      { type: 'd6', value: 4 },
    ]);
    const [a, b, c, d] = meshes(renderer).map((m) => m.material);
    expect(a).toBe(b);
    expect(c).toBe(d);
    expect(a).not.toBe(c);
    expect(createDiceMaterial).toHaveBeenCalledTimes(2);
  });

  test('face sets split the cache and map glyph / blank labels', () => {
    const { renderer, box } = setup();
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'].map((text) => ({ kind: 'glyph', text }));
    labels[1] = { kind: 'blank' };
    labels[2] = { kind: 'text', text: 'zzz' };
    box.roll([
      { type: 'd6', value: 1, faces: { key: 'k1', labels } },
      { type: 'd6', value: 1, faces: { key: 'k1', labels } },
      { type: 'd6', value: 1 },
    ]);
    const [a, b, c] = meshes(renderer).map((m) => m.material);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    const sent = createDiceMaterial.mock.calls.find((call) => call[3][0] === 'A')[3];
    expect(sent.slice(0, 2)).toEqual(['A', '']);
    expect(sent[2]).toBe(labelFor('d6', getShape('d6').values[2])); // text falls back
  });

  test('a ghost die throws value 1 with the ghost look and blank labels', () => {
    const { renderer, box } = setup();
    box.roll([{ type: 'd20', value: 17, ghost: true, appearance: red }]);
    const [group] = dieGroups(renderer);
    expect(createDiceMaterial).toHaveBeenCalledTimes(1);
    const [app, , , labels] = createDiceMaterial.mock.calls[0];
    expect(app).toBe(GHOST_APPEARANCE);
    expect(labels.length).toBe(20);
    expect(labels.every((l) => l === '')).toBe(true);
    const die = box._rolls.values().next().value.dice[0];
    expect(die.targetValue).toBe(1);
    expect(
      JSON.stringify(die, (k, v) =>
        k === 'outer' || k === 'inner' || k === 'geometry' || k === 'shape' ? undefined : v,
      ),
    ).not.toContain('17');
    expect(JSON.stringify(group.userData)).not.toContain('17');
  });

  test('rematerialize keeps each die on its own look', () => {
    const { renderer, box } = setup();
    box.roll([
      { type: 'd6', value: 1, appearance: red },
      { type: 'd6', value: 2, ghost: true },
    ]);
    box.invalidateMaterials({ replaceInFlight: true });
    const [a, b] = meshes(renderer).map((m) => m.material);
    expect(a).not.toBe(b);
    expect(createDiceMaterial).toHaveBeenCalledTimes(4);
    expect(createDiceMaterial.mock.calls[3][0]).toBe(GHOST_APPEARANCE);
  });
});

describe('image and text faces', () => {
  const meshes = (renderer) => dieGroups(renderer).map((g) => g.children[0]);
  const rasterFaces = () => {
    const labels = getShape('d6').values.map((v) => ({ kind: 'glyph', text: String(v) }));
    labels[0] = { kind: 'image', url: 'a.png' };
    labels[1] = { kind: 'text', text: '+' };
    labels[2] = { kind: 'image', url: 'broken.png' };
    return { key: 'sys|d6|x', labels };
  };
  const fakeFaceTextures = () => {
    let resolve;
    const result = {
      texture: new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4 * 2), 4, 4, 2),
      layers: Int16Array.from([0, 1, -1, -1, -1, -1]),
      tint: Uint8Array.from([0, 1, 0, 0, 0, 0]),
    };
    const ft = {
      result,
      acquire: vi.fn(() => new Promise((r) => (resolve = () => r(result)))),
      release: vi.fn(),
      resolve: () => resolve(),
    };
    return ft;
  };
  beforeEach(() => {
    createDiceMaterial.mockClear();
  });

  test('the roll waits for the face layers before its dice show, then draws them', async () => {
    const faceTextures = fakeFaceTextures();
    const { renderer, physics, box } = setup({ faceTextures });
    const faces = rasterFaces();
    const r = box.roll([{ type: 'd6', value: 1, faces }, { type: 'd6', value: 2 }]);
    expect(faceTextures.acquire).toHaveBeenCalledTimes(1);
    expect(faceTextures.acquire).toHaveBeenCalledWith(faces);
    expect(physics.streams).toHaveLength(1); // the throw starts at once
    physics.flush();
    expect(renderer.isLooping).toBe(false); // nothing to show yet
    renderer.tick(16);
    expect(dieGroups(renderer).some((g) => g.visible)).toBe(false);

    faceTextures.resolve();
    await flushMicrotasks();
    expect(renderer.isLooping).toBe(true);
    const call = createDiceMaterial.mock.calls.find((c) => c[5]);
    expect(call[5]).toBe(faceTextures.result);
    const labels = call[3];
    expect(labels.slice(0, 2)).toEqual(['', '']); // layered faces: no MSDF label
    expect(labels[2]).toBe(labelFor('d6', getShape('d6').values[2])); // failed face: its number
    expect(meshes(renderer)[0].material.userData.programKey).toMatch(/\|fl1$/);
    expect(meshes(renderer)[1].material.userData.programKey).not.toMatch(/\|fl1$/);
    renderer.tick(32);
    expect(dieGroups(renderer).every((g) => g.visible)).toBe(true);

    box.clear();
    await r.finished;
    expect(faceTextures.release).toHaveBeenCalledTimes(1);
    expect(faceTextures.release).toHaveBeenCalledWith(faces);
  });

  test('ghost dice and glyph-only face sets never acquire face textures', () => {
    const faceTextures = fakeFaceTextures();
    const { box } = setup({ faceTextures });
    const glyphs = { key: 'g', labels: [{ kind: 'glyph', text: 'A' }] };
    box.roll([
      { type: 'd6', value: 1, faces: rasterFaces(), ghost: true },
      { type: 'd6', value: 1, faces: glyphs },
    ]);
    expect(faceTextures.acquire).not.toHaveBeenCalled();
    for (const call of createDiceMaterial.mock.calls) expect(call[5]).toBeFalsy();
    box.clear();
  });

  test('the presetFaces setting off: no face textures are acquired', () => {
    const faceTextures = fakeFaceTextures();
    const { box } = setup({ faceTextures, faceLayers: () => false });
    box.roll([{ type: 'd6', value: 1, faces: rasterFaces() }]);
    expect(faceTextures.acquire).not.toHaveBeenCalled();
    box.clear();
  });

  test('without face textures, text and image faces show their numbers', () => {
    const { renderer, box } = setup();
    box.roll([{ type: 'd6', value: 1, faces: rasterFaces() }]);
    expect(dieGroups(renderer)).toHaveLength(1);
    const labels = createDiceMaterial.mock.calls[0][3];
    expect(labels[0]).toBe(labelFor('d6', getShape('d6').values[0]));
    box.clear();
  });

  test('failed and slow faces fall back', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.fn();
    const loadImage = (url) =>
      url === 'a.png' ? Promise.reject(new Error('404')) : new Promise(() => {});
    const faceTextures = createFaceTextures({ loadImage, timeoutMs: 4000, warn });
    const { renderer, physics, box } = setup({ faceTextures });
    const labels = getShape('d6').values.map((v) => ({ kind: 'glyph', text: String(v) }));
    labels[0] = { kind: 'image', url: 'a.png' };
    labels[1] = { kind: 'image', url: 'slow.png' };
    const { landed } = box.roll([{ type: 'd6', value: 1, faces: { key: 'k', labels } }]);
    const isLanded = settled(landed);
    physics.flush();
    await vi.advanceTimersByTimeAsync(4000);
    expect(warn).toHaveBeenCalledTimes(2);
    renderer.tick(5000);
    expect(dieGroups(renderer).every((g) => g.visible)).toBe(true);
    renderer.tick(8000);
    await flushMicrotasks();
    expect(isLanded()).toBe(true);
    expect(error).not.toHaveBeenCalled(); // landed, not failed by a stall timer
    expect(createDiceMaterial.mock.calls.every((c) => !c[5])).toBe(true);
    box.clear();
    error.mockRestore();
  });
});

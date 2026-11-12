import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DiceBox, ASSET_WAIT_MS, IDLE_GEOMETRY_CAP } from '../../src/throw/dice-box.js';
import { MODEL_ROTATIONS } from '../../src/compat/dsn-orientation.js';
import { rotationToShow, readTopFace, faceForValue } from '../../src/core/face-reader.js';
import { buildScene } from '../../src/render/scene.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { buildDieGeometry } from '../../src/core/chamfer.js';
import { createDiceMaterial } from '../../src/render/dice-material.js';
import { _setLookExtrasImport, requestLookExtras } from '../../src/render/extras-loader.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';
import { GHOST_APPEARANCE } from '../../src/compat/colorset-map.js';
import { createFaceTextures } from '../../src/render/face-textures.js';
import { createEffectLayer } from '../../src/effects/effect-layer.js';
import { EFFECTS } from '../../src/effects/library/index.js';
import { TIERS } from '../../src/render/quality.js';
import { CAPACITY_PER_DIE, ONE_DIE_HALF } from '../../src/areas/area-model.js';
import { createFontAtlases } from '../../src/fonts/font-atlas.js';

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
function chunksFor(n, evs) {
  const out = [];
  for (let c = 0; c < 2; c++) {
    const data = new Float32Array(30 * 7 * n);
    for (let s = 0; s < 30; s++) {
      const x = -30 + (30 * (c * 30 + s)) / 59;
      for (let d = 0; d < n; d++) data.set([x, 0.5, d * 1.5, 0, 0, 0, 1], (s * n + d) * 7);
    }
    out.push({ index: c, steps: 30, data, done: c === 1, events: evs?.[c] ?? new Float32Array(0) });
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
    events: null, // per-chunk Float32Array of [step, die, other, speed]*
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
        for (const c of chunksFor(s.req.dice.length, this.events)) {
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
      s.cb(chunksFor(s.req.dice.length, this.events)[0]);
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
    camera: sceneApi.camera,
    canvas: { style: { transform: '' } },
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
/** Drains the microtask queue (asset loads settle through a few promise hops). */
const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
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
  expect(renderer.tick(2000)).toBe('hold'); // P9-R18: landed and at rest: drawn, then held
  await flushMicrotasks();
  expect(isLanded()).toBe(true);
  expect(isFinished()).toBe(false);

  vi.advanceTimersByTime(1999);
  expect(renderer.tick(2100)).toBe('hold');
  const wakes = renderer.startLoop.mock.calls.length;
  vi.advanceTimersByTime(1);
  expect(renderer.startLoop.mock.calls.length).toBe(wakes + 1); // the fade wakes the held loop
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

  expect(renderer.tick(4000)).toBe('hold'); // a finished, b landed: nothing moves
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

test('geometry cache is keyed by type|edge radius and passes the radius (P2-R5, P7-D2)', () => {
  buildDieGeometry.mockClear();
  const { physics, box } = setup({
    appearance: { body: { type: 'resin' }, edges: { radius: 0 } },
  });
  box.roll([
    { type: 'd6', value: 1 },
    { type: 'd6', value: 2 },
  ]);
  physics.flush();
  expect(buildDieGeometry).toHaveBeenCalledTimes(1);
  expect(buildDieGeometry.mock.calls[0][1]).toEqual({ radius: 0 });
  box.clear();
  buildDieGeometry.mockClear();
  const legacy = setup();
  legacy.box.roll([{ type: 'd6', value: 1 }]);
  legacy.physics.flush();
  expect(buildDieGeometry.mock.calls[0][1]).toEqual({ radius: 0.5 });
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

  test('a roll before the chunk loads draws the fallback; after refresh the next roll draws the real look', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const load = vi.fn(() => gate.then(() => import('../../src/render/extras/look-extras.js')));
    _setLookExtrasImport(load);
    const extras = {
      body: { type: 'opaque', color: '#ffffff' },
      numbers: { fill: 'holo', relief: 'raised', icons: { crit: 'crown' } },
    };
    const { renderer, box } = setup({ appearance: undefined, getAppearance: () => extras });
    expect(() => box.roll([{ type: 'd20', value: 20 }])).not.toThrow();
    const first = meshOf(renderer).material.userData.programKey;
    expect(first).not.toContain('|n:');
    expect(load).toHaveBeenCalledTimes(1);
    release();
    expect(await requestLookExtras()).not.toBeNull();
    box.invalidateMaterials();
    expect(() => box.roll([{ type: 'd20', value: 20 }])).not.toThrow();
    const second = meshOf(renderer).material.userData.programKey;
    expect(second).toContain('|n:holo+r');
    expect(load).toHaveBeenCalledTimes(1);
    box.clear();
  });

  test('an iridescent look rolled before the chunk loads draws pearl, then iridescent after it loads', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const load = vi.fn(() => gate.then(() => import('../../src/render/extras/look-extras.js')));
    _setLookExtrasImport(load);
    const irid = { body: { type: 'iridescent', preset: 'opal', color: '#e8eef0', color2: '#7fd6e8' } };
    const { renderer, box } = setup({ appearance: undefined, getAppearance: () => irid });
    expect(() => box.roll([{ type: 'd8', value: 3 }])).not.toThrow();
    const first = meshOf(renderer).material;
    expect(first.userData.programKey).toMatch(/^pearl\|/);
    expect(first.userData.uniforms.uBodyPreset).toBeUndefined();
    release();
    expect(await requestLookExtras()).not.toBeNull();
    box.invalidateMaterials();
    expect(() => box.roll([{ type: 'd8', value: 3 }])).not.toThrow();
    const second = meshOf(renderer).material;
    expect(second.userData.programKey).toMatch(/^iridescent\|/);
    expect(second.defines.DICER_IRIDESCENT).toBe('');
    expect(second.userData.uniforms.uBodyPreset).toBeDefined();
    expect(load).toHaveBeenCalledTimes(1);
    box.clear();
  });

  test('a foil look rolled before the chunk loads draws glitter, then foil after it loads', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const load = vi.fn(() => gate.then(() => import('../../src/render/extras/look-extras.js')));
    _setLookExtrasImport(load);
    const foil = {
      body: { type: 'resin', color: '#d9e6f0', color2: '#9fb3c8', roughness: 0.05 },
      interior: { type: 'foil', colors: ['#ffcf5a', '#d9814a'], density: 0.5 },
    };
    const flags = { interiors: true, engraving: true, glow: true, interiorSteps: 32 };
    const { renderer, box } = setup({ appearance: undefined, getAppearance: () => foil, getFlags: () => flags });
    expect(() => box.roll([{ type: 'd20', value: 7 }])).not.toThrow();
    const first = meshOf(renderer).material.userData.programKey;
    expect(first).toContain('|glitter:32|');
    release();
    expect(await requestLookExtras()).not.toBeNull();
    box.invalidateMaterials();
    expect(() => box.roll([{ type: 'd20', value: 7 }])).not.toThrow();
    const second = meshOf(renderer).material.userData.programKey;
    expect(second).toContain('|foil:32|');
    expect(load).toHaveBeenCalledTimes(1);
    box.clear();
  });

  test('the geometry edge radius follows the look of each roll', () => {
    buildDieGeometry.mockClear();
    let look = ruby;
    const { box } = setup({ appearance: undefined, getAppearance: () => look });
    box.roll([{ type: 'd6', value: 1 }]);
    look = { ...ruby, edges: { radius: 0 } };
    box.roll([{ type: 'd6', value: 1 }]);
    expect(buildDieGeometry.mock.calls.map((c) => c[1])).toEqual([
      { radius: 0.5 },
      { radius: 0 },
    ]);
    box.clear();
  });

  describe('geometry per edge step (P7-D2)', () => {
    const STEPS = [0, 0.25, 0.5, 0.75, 1];
    const TYPES = ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20'];
    const withRadius = (r) => ({ ...ruby, edges: { radius: r } });

    test('two dice of one type and step share one geometry; another step gets its own', () => {
      buildDieGeometry.mockClear();
      let look = withRadius(1);
      const { renderer, box } = setup({ appearance: undefined, getAppearance: () => look });
      box.roll([
        { type: 'd6', value: 1 },
        { type: 'd6', value: 2 },
      ]);
      expect(meshOf(renderer, 0).geometry).toBe(meshOf(renderer, 1).geometry);
      expect(buildDieGeometry).toHaveBeenCalledTimes(1);
      look = withRadius(0.25);
      box.roll([{ type: 'd6', value: 3 }]);
      expect(meshOf(renderer, 2).geometry).not.toBe(meshOf(renderer, 0).geometry);
      expect(buildDieGeometry).toHaveBeenCalledTimes(2);
      box.clear();
    });

    test('changing the look mid-roll leaves in-flight dice on their geometry and frees nothing early', () => {
      let look = withRadius(1);
      const { renderer, box } = setup({ appearance: undefined, getAppearance: () => look });
      box.roll([{ type: 'd6', value: 1 }]);
      const mesh = meshOf(renderer, 0);
      const held = mesh.geometry;
      const dispose = vi.spyOn(held, 'dispose');
      // Churn every other type and step through the cache while the first roll is in flight.
      for (const r of STEPS)
        for (const type of TYPES) {
          look = withRadius(r);
          box.roll([{ type, value: 1 }]);
        }
      look = withRadius(0);
      box.roll([{ type: 'd6', value: 2 }]);
      expect(mesh.geometry).toBe(held);
      expect(dispose).not.toHaveBeenCalled();
      box.clear();
    });

    test('200 rolls cycling every step and type keep the geometry count within 5 x types', () => {
      let look = withRadius(0);
      const { box } = setup({ appearance: undefined, getAppearance: () => look });
      let peak = 0;
      for (let i = 0; i < 200; i++) {
        look = withRadius(STEPS[i % STEPS.length]);
        box.roll([{ type: TYPES[i % TYPES.length], value: 1 }]);
        peak = Math.max(peak, box._geometries.size);
        box.clear();
        expect(box._geometries.size).toBeLessThanOrEqual(5 * TYPES.length);
      }
      expect(peak).toBeLessThanOrEqual(5 * TYPES.length);
      // Nothing is held after clear(): only the idle LRU remains, and every cached one is live.
      expect(box._geometries.size).toBeLessThanOrEqual(IDLE_GEOMETRY_CAP);
      for (const g of box._geometries.values()) expect(box._geoRefs.get(g).refs).toBe(0);
    });

    test('a geometry evicted from the idle LRU is disposed once, and a rebuild works', () => {
      let look = withRadius(0);
      const { renderer, box } = setup({ appearance: undefined, getAppearance: () => look });
      box.roll([{ type: 'd4', value: 1 }]);
      const first = meshOf(renderer, 0).geometry;
      const dispose = vi.spyOn(first, 'dispose');
      box.clear();
      for (const r of STEPS)
        for (const type of TYPES.slice(1)) {
          look = withRadius(r);
          box.roll([{ type, value: 1 }]);
          box.clear();
        }
      expect(dispose).toHaveBeenCalledTimes(1);
      look = withRadius(0);
      box.roll([{ type: 'd4', value: 1 }]);
      expect(meshOf(renderer, 0).geometry).not.toBe(first);
      box.clear();
    });

    test('dispose() frees every cached geometry', () => {
      const { renderer, box } = setup({ appearance: ruby });
      box.roll([{ type: 'd6', value: 1 }]);
      const dispose = vi.spyOn(meshOf(renderer, 0).geometry, 'dispose');
      box.dispose();
      expect(dispose).toHaveBeenCalled();
      expect(box._geometries.size).toBe(0);
    });
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
    const r = box.roll([
      { type: 'd6', value: 1, faces },
      { type: 'd6', value: 2 },
    ]);
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

describe('model presets', () => {
  const meshes = (renderer) => dieGroups(renderer).map((g) => g.children[0]);
  const fakeModels = () => {
    const pending = [];
    const model = {
      geometry: new THREE.BoxGeometry(1, 1, 1),
      material: new THREE.MeshStandardMaterial(),
    };
    const loadModel = vi.fn(
      () =>
        new Promise((resolve, reject) => pending.push({ resolve: () => resolve(model), reject })),
    );
    return { model, loadModel, pending };
  };
  const liveRefs = (box) => [...box._refs.values()].filter((e) => e.refs > 0).length;
  const landRoll = async (renderer, r) => {
    const isLanded = settled(r.landed);
    renderer.tick(10000);
    renderer.tick(20000);
    await flushMicrotasks();
    return isLanded();
  };
  /** The face-forcing rotation of an identity landing for `value`. */
  const forcedFor = (type, value) => {
    const shape = getShape(type);
    const r = rotationToShow(
      shape,
      readTopFace(shape, { x: 0, y: 0, z: 0, w: 1 }),
      faceForValue(shape, value),
    );
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  };
  beforeEach(() => {
    createDiceMaterial.mockClear();
  });

  test('a model whose type has no verified rotation renders procedurally, and the roll lands', async () => {
    const models = fakeModels();
    const { renderer, physics, box } = setup({ loadModel: models.loadModel });
    const r = box.roll([{ type: 'd20', value: 7, dsnType: 'd20', model: 'm/dice_20.glb' }]);
    expect(models.loadModel).not.toHaveBeenCalled();
    physics.flush();
    expect(renderer.isLooping).toBe(true); // nothing to wait for
    const [mesh] = meshes(renderer);
    expect(mesh.material).toBe(createDiceMaterial.mock.results[0].value);
    expect(await landRoll(renderer, r)).toBe(true);
    box.clear();
  });

  test('a verified model waits, then becomes the inner mesh with its rotation premultiplied', async () => {
    const models = fakeModels();
    const { renderer, physics, box } = setup({ loadModel: models.loadModel });
    const r = box.roll([
      { type: 'd6', value: 5, dsnType: 'd6', model: 'm/dice_6.glb' },
      { type: 'd6', value: 2, dsnType: 'd6', model: 'm/dice_6.glb' },
    ]);
    expect(models.loadModel).toHaveBeenCalledTimes(1); // one load per url
    const [url, opts] = models.loadModel.mock.calls[0];
    expect(url).toBe('m/dice_6.glb');
    expect(opts.radius).toBeCloseTo(meshes(renderer)[0].geometry.boundingSphere.radius, 9);
    const procedural = meshes(renderer)[0].material;
    physics.flush(); // results applied while the model is still loading
    expect(renderer.isLooping).toBe(false);
    renderer.tick(16);
    expect(dieGroups(renderer).some((g) => g.visible)).toBe(false);
    const forced = meshes(renderer).map((m) => m.quaternion.clone());

    models.pending[0].resolve();
    await flushMicrotasks();
    expect(renderer.isLooping).toBe(true);
    const M = new THREE.Quaternion(...MODEL_ROTATIONS.d6);
    meshes(renderer).forEach((mesh, i) => {
      expect(mesh.geometry).toBe(models.model.geometry);
      expect(mesh.material).toBe(models.model.material);
      const want = forced[i].clone().multiply(M);
      expect(Math.abs(mesh.quaternion.dot(want))).toBeCloseTo(1, 9);
    });
    expect(box._refs.get(procedural)?.refs ?? 0).toBe(0); // no die uses it any more
    expect(await landRoll(renderer, r)).toBe(true);
    vi.advanceTimersByTime(2000);
    renderer.tick(20100); // fade: a clone of the model material
    expect(meshes(renderer)[0].material).not.toBe(models.model.material);
    expect(models.model.material.transparent).toBe(false);
    box.clear();
    await r.finished;
    expect(liveRefs(box)).toBe(0);
  });

  test('a model that loads before the results arrive still gets the rotation', async () => {
    const models = fakeModels();
    const { renderer, physics, box } = setup({ loadModel: models.loadModel });
    box.roll([{ type: 'd6', value: 5, dsnType: 'd6', model: 'm/dice_6.glb' }]);
    models.pending[0].resolve();
    await flushMicrotasks();
    physics.flush();
    const [mesh] = meshes(renderer);
    expect(mesh.material).toBe(models.model.material);
    const want = forcedFor('d6', 5).multiply(new THREE.Quaternion(...MODEL_ROTATIONS.d6));
    expect(Math.abs(mesh.quaternion.dot(want))).toBeCloseTo(1, 9);
    box.clear();
  });

  test('a failed model load falls back to the procedural die and the roll lands', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const models = fakeModels();
    const { renderer, physics, box } = setup({ loadModel: models.loadModel });
    const r = box.roll([{ type: 'd6', value: 5, dsnType: 'd6', model: 'm/dice_6.glb' }]);
    const procedural = meshes(renderer)[0].material;
    physics.flush();
    models.pending[0].reject(new Error('404'));
    await flushMicrotasks();
    expect(renderer.isLooping).toBe(true);
    const [mesh] = meshes(renderer);
    expect(mesh.material).toBe(procedural);
    expect(Math.abs(mesh.quaternion.dot(forcedFor('d6', 5)))).toBeCloseTo(1, 9); // no model rotation
    expect(await landRoll(renderer, r)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    box.clear();
    error.mockRestore();
    warn.mockRestore();
  });

  test('the presetModels setting off, ghosts and dice without a model load nothing', () => {
    const models = fakeModels();
    const off = setup({ loadModel: models.loadModel, modelPresets: () => false });
    off.box.roll([{ type: 'd6', value: 5, dsnType: 'd6', model: 'm/dice_6.glb' }]);
    const on = setup({ loadModel: models.loadModel });
    on.box.roll([
      { type: 'd6', value: 5, dsnType: 'd6', model: 'm/dice_6.glb', ghost: true },
      { type: 'd6', value: 5, dsnType: 'd6' },
    ]);
    expect(models.loadModel).not.toHaveBeenCalled();
    off.box.clear();
    on.box.clear();
  });

  test('a material rebuild leaves model dice on their model material', async () => {
    const models = fakeModels();
    const { renderer, physics, box } = setup({ loadModel: models.loadModel });
    box.roll([
      { type: 'd6', value: 5, dsnType: 'd6', model: 'm/dice_6.glb' },
      { type: 'd6', value: 1 },
    ]);
    models.pending[0].resolve();
    await flushMicrotasks();
    physics.flush();
    box.invalidateMaterials({ replaceInFlight: true });
    const [model, plain] = meshes(renderer);
    expect(model.material).toBe(models.model.material);
    expect(plain.material).toBe(createDiceMaterial.mock.results.at(-1).value);
    box.clear();
    expect(liveRefs(box)).toBe(0);
  });
});

describe('pending assets (Task 5 review)', () => {
  const meshes = (renderer) => dieGroups(renderer).map((g) => g.children[0]);
  const rasterFaces = () => {
    const labels = getShape('d6').values.map((v) => ({ kind: 'glyph', text: String(v) }));
    labels[0] = { kind: 'image', url: 'a.png' };
    return { key: 'sys|d6|x', labels };
  };
  const result = () => ({
    texture: new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4), 4, 4, 1),
    layers: Int16Array.from([0, -1, -1, -1, -1, -1]),
    tint: Uint8Array.from([0, 0, 0, 0, 0, 0]),
  });
  const controlledFaces = () => {
    let resolve;
    return {
      acquire: vi.fn(() => new Promise((r) => (resolve = () => r(result())))),
      release: vi.fn(),
      resolve: () => resolve(),
    };
  };
  const liveRefs = (box) => [...box._refs.values()].filter((e) => e.refs > 0).length;
  beforeEach(() => {
    createDiceMaterial.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('(a) loaders that never settle cannot keep a roll alive: it proceeds after the cap', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const faceTextures = { acquire: vi.fn(() => new Promise(() => {})), release: vi.fn() };
    const loadModel = vi.fn(() => new Promise(() => {}));
    const { renderer, physics, box } = setup({ faceTextures, loadModel });
    const r = box.roll([
      { type: 'd6', value: 1, faces: rasterFaces() },
      { type: 'd6', value: 5, dsnType: 'd6', model: 'm/dice_6.glb' },
    ]);
    const isLanded = settled(r.landed);
    const isFinished = settled(r.finished);
    physics.flush();
    await vi.advanceTimersByTimeAsync(ASSET_WAIT_MS - 1);
    expect(renderer.isLooping).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(renderer.isLooping).toBe(true);
    renderer.tick(10000);
    renderer.tick(20000);
    await flushMicrotasks();
    expect(isLanded()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    renderer.tick(20100);
    renderer.tick(21000);
    await flushMicrotasks();
    expect(isFinished()).toBe(true);
    expect(error).not.toHaveBeenCalled(); // landed, not failed
    expect(faceTextures.release).toHaveBeenCalledTimes(1);
    expect(liveRefs(box)).toBe(0);
  });

  test('(a) a load that settles after the cap swaps nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const faceTextures = controlledFaces();
    const { renderer, physics, box } = setup({ faceTextures });
    box.roll([{ type: 'd6', value: 1, faces: rasterFaces() }]);
    const before = meshes(renderer)[0].material;
    physics.flush();
    await vi.advanceTimersByTimeAsync(ASSET_WAIT_MS);
    faceTextures.resolve();
    await flushMicrotasks();
    expect(meshes(renderer)[0].material).toBe(before);
    expect(createDiceMaterial.mock.calls.every((c) => !c[5])).toBe(true);
    box.clear();
    expect(faceTextures.release).toHaveBeenCalledTimes(1);
    expect(liveRefs(box)).toBe(0);
  });

  test('(b) a pending roll does not keep the loop drawing empty frames', async () => {
    const faceTextures = controlledFaces();
    const { renderer, physics, box } = setup({ faceTextures });
    const a = box.roll([{ type: 'd6', value: 3 }]);
    box.roll([{ type: 'd6', value: 1, faces: rasterFaces() }]);
    physics.flush();
    renderer.tick(0);
    renderer.tick(2000);
    await flushMicrotasks();
    vi.advanceTimersByTime(2000);
    renderer.tick(2100);
    expect(renderer.tick(2600)).toBe(false); // a finished; only the pending roll is left
    await a.finished;
    expect(box.activeRolls).toBe(1);
    faceTextures.resolve();
    await flushMicrotasks();
    expect(renderer.isLooping).toBe(true); // restarted once the faces exist
    box.clear();
  });

  test.each(['cleared', 'failed'])(
    '(c) a roll %s mid-wait releases once; a late resolve swaps nothing and leaks no refs',
    async (how) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const faceTextures = controlledFaces();
      let resolveModel;
      const model = {
        geometry: new THREE.BoxGeometry(),
        material: new THREE.MeshStandardMaterial(),
      };
      const loadModel = vi.fn(() => new Promise((r) => (resolveModel = () => r(model))));
      const { renderer, physics, box } = setup({ faceTextures, loadModel });
      const r = box.roll([
        { type: 'd6', value: 1, faces: rasterFaces() },
        { type: 'd6', value: 5, dsnType: 'd6', model: 'm/dice_6.glb' },
      ]);
      const dice = meshes(renderer);
      const before = dice.map((m) => m.material);
      if (how === 'cleared') box.clear();
      else physics.fail(0);
      await r.finished;
      expect(faceTextures.release).toHaveBeenCalledTimes(1);
      faceTextures.resolve();
      resolveModel();
      await flushMicrotasks();
      expect(dice.map((m) => m.material)).toEqual(before);
      expect(dice[1].geometry).not.toBe(model.geometry);
      expect(createDiceMaterial.mock.calls.every((c) => !c[5])).toBe(true);
      expect(faceTextures.release).toHaveBeenCalledTimes(1);
      expect(liveRefs(box)).toBe(0);
      expect(renderer.isLooping).toBe(false);
    },
  );
});

describe('model loads reach the registry (fix round 1)', () => {
  const model = () => ({
    geometry: new THREE.BoxGeometry(),
    material: new THREE.MeshStandardMaterial(),
  });

  test('a successful model load is reported once per url', async () => {
    const onModelLoaded = vi.fn();
    const { box } = setup({ loadModel: vi.fn(async () => model()), onModelLoaded });
    box.roll([
      { type: 'd6', value: 5, dsnType: 'd6', model: 'm/dice_6.glb' },
      { type: 'd6', value: 2, dsnType: 'd6', model: 'm/dice_6.glb' },
    ]);
    await flushMicrotasks();
    expect(onModelLoaded).toHaveBeenCalledTimes(1);
    expect(onModelLoaded).toHaveBeenCalledWith('m/dice_6.glb');
    box.clear();
  });

  test('a failed load, or a type with no verified rotation, reports nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onModelLoaded = vi.fn();
    const failing = setup({
      loadModel: vi.fn(async () => Promise.reject(new Error('404'))),
      onModelLoaded,
    });
    failing.box.roll([{ type: 'd6', value: 5, dsnType: 'd6', model: 'm/dice_6.glb' }]);
    const unverified = setup({ loadModel: vi.fn(async () => model()), onModelLoaded });
    unverified.box.roll([{ type: 'd20', value: 5, dsnType: 'd20', model: 'm/dice_20.glb' }]);
    await flushMicrotasks();
    expect(onModelLoaded).not.toHaveBeenCalled();
    failing.box.clear();
    unverified.box.clear();
    vi.restoreAllMocks();
  });

  test('a throwing reporter changes nothing for the roll', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = model();
    const { renderer, box } = setup({
      loadModel: vi.fn(async () => m),
      onModelLoaded: () => {
        throw new Error('listener');
      },
    });
    box.roll([{ type: 'd6', value: 5, dsnType: 'd6', model: 'm/dice_6.glb' }]);
    await flushMicrotasks();
    expect(dieGroups(renderer)[0].children[0].material).toBe(m.material);
    box.clear();
    vi.restoreAllMocks();
  });
});

describe('onMaterial (P3-R3)', () => {
  const preset = { system: 'pf2e', type: 'd20' };

  test('fires once per newly built material of a die with a preset', () => {
    const onMaterial = vi.fn();
    const presetFor = vi.fn((system, type) =>
      system === 'pf2e' && type === 'd20' ? preset : null,
    );
    const { box } = setup({ onMaterial, presetFor });
    const spec = { type: 'd20', value: 3, system: 'pf2e', dsnType: 'd20' };
    box.roll([spec, { ...spec, value: 4 }]);
    expect(onMaterial).toHaveBeenCalledTimes(1);
    const [material, type, look, got] = onMaterial.mock.calls[0];
    expect(material).toBeInstanceOf(THREE.Material);
    expect(type).toBe('d20');
    expect(look).toEqual(expect.any(Object));
    expect(got).toBe(preset);
    box.roll([spec]); // cached material: not new
    expect(onMaterial).toHaveBeenCalledTimes(1);
    box.clear();
  });

  test('a non-standard preset die never shares a material with a standard die', () => {
    const onMaterial = vi.fn();
    const presetFor = (system, type) => (system === 'pf2e' && type === 'd20' ? preset : null);
    const { renderer, box } = setup({ onMaterial, presetFor });
    // The standard die builds first: the pf2e die must still get (and announce) its own.
    box.roll([
      { type: 'd20', value: 3, system: 'standard', dsnType: 'd20' },
      { type: 'd20', value: 4, system: 'pf2e', dsnType: 'd20' },
    ]);
    const [plain, custom] = dieGroups(renderer).map((g) => g.children[0].material);
    expect(custom).not.toBe(plain);
    expect(onMaterial).toHaveBeenCalledTimes(1);
    expect(onMaterial.mock.calls[0][0]).toBe(custom);
    // A listener mutating the announced material cannot reach the standard die.
    onMaterial.mock.calls[0][0].userData.mutated = true;
    expect(plain.userData.mutated).toBeUndefined();
    box.clear();
  });

  test('a standard preset die shares the plain cache (no extra material)', () => {
    const std = { system: 'standard', type: 'd20' };
    const { renderer, box } = setup({ presetFor: (s) => (s === 'standard' ? std : null) });
    box.roll([
      { type: 'd20', value: 3 },
      { type: 'd20', value: 4, system: 'standard', dsnType: 'd20' },
    ]);
    const [a, b] = dieGroups(renderer).map((g) => g.children[0].material);
    expect(a).toBe(b);
    box.clear();
  });

  test('no preset, no system, or a ghost: nothing fires', () => {
    const onMaterial = vi.fn();
    const presetFor = vi.fn(() => null);
    const { box } = setup({ onMaterial, presetFor });
    box.roll([
      { type: 'd20', value: 3, system: 'standard', dsnType: 'd20' },
      { type: 'd6', value: 2 },
    ]);
    const ghostly = setup({ onMaterial, presetFor: () => preset });
    ghostly.box.roll([{ type: 'd20', value: 1, ghost: true, system: 'pf2e', dsnType: 'd20' }]);
    expect(onMaterial).not.toHaveBeenCalled();
    box.clear();
    ghostly.box.clear();
  });

  test('a throwing presetFor or onMaterial changes nothing for the roll', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { renderer, box } = setup({
      presetFor: () => preset,
      onMaterial: () => {
        throw new Error('listener');
      },
    });
    box.roll([{ type: 'd20', value: 3, system: 'pf2e', dsnType: 'd20' }]);
    const other = setup({
      presetFor: () => {
        throw new Error('registry');
      },
      onMaterial: vi.fn(),
    });
    other.box.roll([{ type: 'd20', value: 3, system: 'pf2e', dsnType: 'd20' }]);
    expect(dieGroups(renderer)).toHaveLength(1);
    expect(dieGroups(other.renderer)).toHaveLength(1);
    box.clear();
    other.box.clear();
    warn.mockRestore();
  });
});

describe('material cache cap', () => {
  const look = (i) => ({
    body: { type: 'opaque', color: `#${(i + 1).toString(16).padStart(6, '0')}` },
  });
  const idle = (box) => [...box._refs.values()].filter((e) => e.refs === 0 && !e.stale).length;
  const meshOf = (renderer) => dieGroups(renderer).at(-1).children[0];
  let error;
  beforeEach(() => (error = vi.spyOn(console, 'error').mockImplementation(() => {})));
  afterEach(() => error.mockRestore());

  test('200 rolls with distinct appearances keep at most 64 unreferenced materials, never disposing one in use', async () => {
    const { renderer, physics, box } = setup();
    const warm = box.acquireWarmup(['d6', 'd20']);
    const warmDispose = warm.materials.map((m) => vi.spyOn(m, 'dispose'));
    // A roll held for the whole run (stream 0): its material must survive every eviction.
    const held = box.roll([{ type: 'd8', value: 2, appearance: look(9999) }]);
    const heldDispose = vi.spyOn(meshOf(renderer).material, 'dispose');
    const disposes = [];
    for (let i = 0; i < 200; i++) {
      const r = box.roll([{ type: 'd6', value: 3, appearance: look(i) }]);
      disposes.push(vi.spyOn(meshOf(renderer).material, 'dispose'));
      physics.fail(i + 1); // finishes this roll only: its material becomes unreferenced
      await r.finished;
      expect(idle(box)).toBeLessThanOrEqual(64);
    }
    expect(disposes.filter((d) => d.mock.calls.length === 1)).toHaveLength(200 - 64);
    for (const spy of disposes) expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    // The 64 most recently used stay cached.
    expect(disposes.slice(-64).every((d) => d.mock.calls.length === 0)).toBe(true);
    expect(heldDispose).not.toHaveBeenCalled();
    for (const spy of warmDispose) expect(spy).not.toHaveBeenCalled();
    box.clear();
    await held.finished;
    warm.release();
    expect(idle(box)).toBeLessThanOrEqual(64);
  });

  test('the least recently used idle material is the one evicted', async () => {
    const { renderer, box } = setup();
    const roll = async (i) => {
      const r = box.roll([{ type: 'd6', value: 3, appearance: look(i) }]);
      const mat = meshOf(renderer).material;
      box.clear();
      await r.finished;
      return mat;
    };
    const first = await roll(0);
    const firstDispose = vi.spyOn(first, 'dispose');
    const second = await roll(1);
    const secondDispose = vi.spyOn(second, 'dispose');
    for (let i = 2; i < 64; i++) await roll(i); // 64 idle now
    expect(await roll(0)).toBe(first); // reused: now the most recent
    await roll(64); // 65 idle: the LRU (second) goes
    expect(secondDispose).toHaveBeenCalledTimes(1);
    expect(firstDispose).not.toHaveBeenCalled();
    expect(idle(box)).toBe(64);
  });
});

describe('impact sounds', () => {
  // Frames are absolute; the dice are first inside the area at frame 40.
  const events = [new Float32Array([5, 0, -1, 9]), new Float32Array([45, 1, 0, 12, 55, 0, -2, 20])];

  test('impacts reach onImpact while playing, in step order, none before the dice enter', () => {
    const onImpact = vi.fn();
    const { renderer, physics, box } = setup({ onImpact, getSurface: () => 'wood' });
    physics.events = events;
    box.roll([
      { type: 'd6', value: 3, soundMaterial: 'metal' },
      { type: 'd6', value: 4 },
    ]);
    physics.flush();
    renderer.tick(0);
    renderer.tick(800);
    renderer.tick(950); // playhead ~57, still playing
    expect(onImpact).toHaveBeenCalledTimes(2);
    const [a, b] = onImpact.mock.calls.map((c) => c[0]);
    expect(a).toMatchObject({ material: 'plastic', surface: 'wood', speed: 12, other: 0, dieType: 'd6' });
    expect(b).toMatchObject({ material: 'metal', surface: 'wood', speed: 20, other: -2 });
    expect(a.dieKey).not.toBe(b.dieKey);
  });

  test('a ghost die still clacks; a cleared roll stops', () => {
    const onImpact = vi.fn();
    const { renderer, physics, box } = setup({ onImpact });
    physics.events = events;
    box.roll([
      { type: 'd6', value: 3, ghost: true },
      { type: 'd6', value: 4 },
    ]);
    physics.flush();
    renderer.tick(0);
    renderer.tick(800); // playhead ~48: only die 1's frame-45 impact
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(onImpact.mock.calls[0][0].surface).toBe('felt');
    renderer.tick(950); // playhead ~57: the ghost die 0's frame-55 impact
    expect(onImpact).toHaveBeenCalledTimes(2);
    const ghostHit = onImpact.mock.calls[1][0];
    expect(ghostHit).toMatchObject({ other: -2, speed: 20 });
    expect(ghostHit.dieKey.endsWith(':0')).toBe(true);
    expect(ghostHit.material).toBe(box._rolls.values().next().value.dice[0].soundMaterial);
    expect(ghostHit.dieKey).not.toBe(onImpact.mock.calls[0][0].dieKey);
    box.clear();
    renderer.tick(1000);
    expect(onImpact).toHaveBeenCalledTimes(2);
  });

  test('a throwing onImpact never fails the roll', () => {
    const { renderer, physics, box } = setup({
      onImpact: () => {
        throw new Error('x');
      },
    });
    physics.events = events;
    const { landed } = box.roll([
      { type: 'd6', value: 3 },
      { type: 'd6', value: 4 },
    ]);
    physics.flush();
    renderer.tick(0);
    expect(() => renderer.tick(1000)).not.toThrow();
    expect(box.activeRolls).toBe(1);
    expect(landed).toBeTruthy();
  });
});

describe('trigger effects at landing (onLandedFx)', () => {
  const nat20fx = [
    {
      ruleId: 'dicer.nat20',
      effect: { id: 'celebrate' },
      sound: { builtin: 'fanfare' },
      macro: null,
      slowMotion: true,
    },
  ];
  // nat20fx slows the landing down (Task 8): give playback the extra time.
  const land = (renderer, physics) => {
    physics.flush();
    renderer.tick(0);
    renderer.tick(2000);
    renderer.tick(8000);
  };

  test('a landed die with fx calls onLandedFx(die, fx, rollKey) once; the sound plays once', async () => {
    const result = vi.fn();
    const onLandedFx = vi.fn((die, fx) => fx.forEach((f) => f.sound && result(f.sound)));
    const { renderer, physics, box } = setup({ onLandedFx });
    const { landed } = box.roll([
      { type: 'd20', value: 20, fx: nat20fx, damageType: 'fire' },
      { type: 'd6', value: 3 },
    ]);
    const isLanded = settled(landed);
    renderer.tick(0);
    expect(onLandedFx).not.toHaveBeenCalled();
    land(renderer, physics);
    renderer.tick(2100);
    await flushMicrotasks();
    expect(isLanded()).toBe(true);
    expect(onLandedFx).toHaveBeenCalledTimes(1);
    const [die, fx, key] = onLandedFx.mock.calls[0];
    expect(die).toMatchObject({ type: 'd20', value: 20, damageType: 'fire' });
    expect(fx).toBe(nat20fx);
    expect(key).toEqual(expect.any(Object));
    expect(result).toHaveBeenCalledTimes(1);
    expect(result).toHaveBeenCalledWith({ builtin: 'fanfare' });
  });

  test('a ghost die never calls it, even if its spec carried fx', () => {
    const onLandedFx = vi.fn();
    const { renderer, physics, box } = setup({ onLandedFx });
    box.roll([{ type: 'd20', value: 20, ghost: true, fx: nat20fx, damageType: 'fire' }]);
    const die = box._rolls.values().next().value.dice[0];
    expect(die.fx).toBeNull();
    expect(die.damageType).toBeUndefined();
    land(renderer, physics);
    expect(onLandedFx).not.toHaveBeenCalled();
  });

  test('a d100 fires its fx on the ones die only', () => {
    const onLandedFx = vi.fn();
    const { renderer, physics, box } = setup({ onLandedFx });
    box.roll([
      { type: 'd10', value: 90, variant: 'd100tens', fx: nat20fx },
      { type: 'd10', value: 7, fx: nat20fx },
    ]);
    land(renderer, physics);
    expect(onLandedFx).toHaveBeenCalledTimes(1);
    expect(onLandedFx.mock.calls[0][0].variant).toBeUndefined();
  });

  test('roll.slowMotion is true only when a (non-ghost) spec fx asks for it', () => {
    const { box } = setup();
    box.roll([{ type: 'd20', value: 20, fx: nat20fx }]);
    box.roll([{ type: 'd20', value: 20, fx: [{ ...nat20fx[0], slowMotion: false }] }]);
    box.roll([{ type: 'd20', value: 20, ghost: true, fx: nat20fx }]);
    expect([...box._rolls].map((r) => r.slowMotion)).toEqual([true, false, false]);
  });

  test('a throwing onLandedFx warns once and never blocks landing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onLandedFx = vi.fn(() => {
      throw new Error('x');
    });
    const { renderer, physics, box } = setup({ onLandedFx });
    const a = settled(box.roll([{ type: 'd20', value: 20, fx: nat20fx }]).landed);
    const b = settled(box.roll([{ type: 'd20', value: 1, fx: nat20fx }]).landed);
    land(renderer, physics);
    await flushMicrotasks();
    expect(a()).toBe(true);
    expect(b()).toBe(true);
    expect(onLandedFx).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('effect runtime (Task 8)', () => {
  /** A long, die-independent effect (a stand-in for a particle burst) and the three die effects. */
  function longEffect(log) {
    return {
      id: 'long',
      cost: 1,
      defaults: { color: '#fff', intensity: 1, duration: 5000 },
      start(ctx) {
        log.push('start');
        let t0 = null;
        return {
          update(now) {
            t0 ??= now;
            return now - t0 < ctx.duration;
          },
          stop: () => log.push('stop'),
        };
      },
    };
  }
  async function withEffects(opts = {}) {
    const log = [];
    let box = null;
    const effects = createEffectLayer({
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      canvas: { style: { transform: '' } },
      getTier: () => TIERS.ultra,
      getSetting: () => undefined,
      loadLibrary: async () => ({ EFFECTS: { ...EFFECTS, long: longEffect(log) } }),
      isolate: (die) => box.isolate(die),
      matchMedia: () => ({ matches: false }),
      debug: () => {},
    });
    await effects.prefetch();
    const made = setup({ effects, getFlags: () => ({ effects: true }), ...opts });
    box = made.box;
    return { ...made, effects, log };
  }
  const fx = (id, extra = {}) => [
    { ruleId: 'r', effect: { id, ...extra }, sound: null, macro: null, slowMotion: false },
  ];

  test('the loop outlives the roll while an effect runs, then stops (hide); landing timing is unchanged', async () => {
    const { renderer, physics, box, log } = await withEffects();
    const { landed, finished } = box.roll([{ type: 'd20', value: 20, fx: fx('long') }]);
    const isLanded = settled(landed);
    const isFinished = settled(finished);
    physics.flush();
    renderer.tick(16);
    renderer.tick(500);
    await flushMicrotasks();
    expect(isLanded()).toBe(false);
    expect(renderer.tick(2000)).toBe(true);
    await flushMicrotasks();
    expect(isLanded()).toBe(true); // same frame as without effects
    expect(log).toEqual(['start']);
    vi.advanceTimersByTime(2000);
    renderer.tick(2100); // fade starts
    expect(renderer.tick(2600)).toBe(true); // roll finished, the effect still runs
    await flushMicrotasks();
    expect(isFinished()).toBe(true);
    expect(box.activeRolls).toBe(0);
    expect(renderer.isLooping).toBe(true);
    expect(renderer.hide).not.toHaveBeenCalled();
    expect(renderer.tick(6000)).toBe(true);
    expect(renderer.tick(7100)).toBe(false);
    expect(renderer.hide).toHaveBeenCalled();
    expect(renderer.isLooping).toBe(false);
    expect(log).toEqual(['start', 'stop']);
  });

  test('clear() mid-effect stops the effects and the loop', async () => {
    const { renderer, physics, box, log, effects } = await withEffects();
    box.roll([{ type: 'd20', value: 20, fx: fx('long') }]);
    physics.flush();
    renderer.tick(0);
    renderer.tick(2000);
    expect(log).toEqual(['start']);
    box.clear();
    expect(log).toEqual(['start', 'stop']);
    expect(effects.running).toBe(0);
    expect(renderer.isLooping).toBe(false);
    expect(renderer.tick(2100)).toBe(false);
  });

  test('a die effect isolates its die: own material and uniforms, faded from the isolated one, freed at finish', async () => {
    const { renderer, physics, box } = await withEffects();
    box.roll([
      { type: 'd20', value: 20, fx: fx('color-shift', { duration: 10000 }) },
      { type: 'd20', value: 5 },
    ]);
    const [hot, plain] = box._rolls.values().next().value.dice;
    expect(hot.inner.material).toBe(plain.inner.material); // one cached material before landing
    const shared = plain.inner.material;
    physics.flush();
    renderer.tick(0);
    renderer.tick(2000);
    renderer.tick(2100);
    const iso = hot.inner.material;
    expect(iso).not.toBe(shared);
    expect(iso.userData.uniforms).not.toBe(shared.userData.uniforms);
    expect(iso.userData.uniforms.uFxTint.value.w).toBeGreaterThan(0);
    expect(shared.userData.uniforms.uFxTint.value.w).toBe(0);
    const isoDispose = vi.spyOn(iso, 'dispose');
    const sharedDispose = vi.spyOn(shared, 'dispose');
    vi.advanceTimersByTime(2000);
    renderer.tick(2200); // fade starts: the fade clone shares the isolated uniforms
    expect(hot.inner.material).not.toBe(iso);
    expect(hot.inner.material.userData.uniforms).toBe(iso.userData.uniforms);
    renderer.tick(2700); // finished: the die effect is released with its die
    expect(isoDispose).toHaveBeenCalled();
    expect(sharedDispose).not.toHaveBeenCalled(); // cached, idle
    expect(renderer.tick(2800)).toBe(false);
  });

  test('isolate() returns null for a model die, a ghost, or a die of no live roll', async () => {
    const { box } = await withEffects();
    box.roll([{ type: 'd20', value: 20 }]);
    const die = box._rolls.values().next().value.dice[0];
    expect(box.isolate({ ...die, model: {} })).toBeNull();
    expect(box.isolate({ ...die, ghost: true })).toBeNull();
    expect(box.isolate({ outer: {}, inner: {} })).toBeNull();
    const u = box.isolate(die);
    expect(u.uFxTint).toBeTruthy();
    expect(box.isolate(die)).toBe(u); // once per die
  });

  test('replaceInFlight moves an isolated die onto a rebuilt isolated material, keeping its fx uniforms', async () => {
    const { renderer, physics, box } = await withEffects();
    box.roll([{ type: 'd20', value: 20, fx: fx('color-shift', { duration: 10000 }) }]);
    const die = box._rolls.values().next().value.dice[0];
    physics.flush();
    renderer.tick(0);
    renderer.tick(2000);
    const iso = die.inner.material;
    const tint = iso.userData.uniforms.uFxTint;
    const dispose = vi.spyOn(iso, 'dispose');
    box.invalidateMaterials({ replaceInFlight: true });
    expect(die.inner.material).not.toBe(iso);
    expect(die.inner.material.userData.uniforms).not.toBe(iso.userData.uniforms);
    expect(die.inner.material.userData.uniforms.uFxTint).toBe(tint);
    expect(dispose).toHaveBeenCalled();
  });

  test('a throwing effect layer warns and never blocks landing; onLandedFx still runs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onLandedFx = vi.fn();
    const effects = {
      play: vi.fn(() => {
        throw new Error('x');
      }),
      update: () => false,
      releaseDie() {},
      clear() {},
    };
    const { renderer, physics, box } = setup({ effects, onLandedFx });
    const a = settled(box.roll([{ type: 'd20', value: 20, fx: fx('long') }]).landed);
    physics.flush();
    renderer.tick(0);
    renderer.tick(2000);
    await flushMicrotasks();
    expect(a()).toBe(true);
    expect(onLandedFx).toHaveBeenCalledTimes(1);
    expect(effects.play).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  describe('slow motion', () => {
    const slow = [{ ruleId: 'r', effect: null, sound: null, macro: null, slowMotion: true }];
    test('a slow-motion roll ramps its playback when the final chunk arrives; others do not', () => {
      const { physics, box } = setup();
      box.roll([{ type: 'd20', value: 20, fx: slow }]);
      box.roll([{ type: 'd20', value: 20 }]);
      physics.flush();
      const [a, b] = [...box._rolls];
      expect(a.playback.speedAt(59)).toBeCloseTo(0.35);
      expect(b.playback.speedAt(59)).toBe(1);
    });
    test('the landing watchdog allows for the slower playback', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { physics, box } = setup();
      box.roll([{ type: 'd20', value: 20, fx: slow }]);
      box.roll([{ type: 'd20', value: 20 }]);
      physics.flush();
      await flushMicrotasks();
      vi.advanceTimersByTime(4500); // past the plain roll's 59 steps + grace
      expect(box.activeRolls).toBe(1);
      expect([...box._rolls][0].slowMotion).toBe(true);
      vi.advanceTimersByTime(10000);
      expect(box.activeRolls).toBe(0);
      err.mockRestore();
    });
    test('the slow-motion roll still lands', async () => {
      const { renderer, physics, box } = setup();
      const isLanded = settled(box.roll([{ type: 'd20', value: 20, fx: slow }]).landed);
      physics.flush();
      renderer.tick(0);
      renderer.tick(2000);
      await flushMicrotasks();
      expect(isLanded()).toBe(false);
      renderer.tick(4000);
      await flushMicrotasks();
      expect(isLanded()).toBe(true);
    });
  });
});

describe('per-throw areas', () => {
  // Stage 960 x 480 px at 48 px per die: halfWidth 10, halfDepth 5, centre (480, 240).
  const left = { left: 0, top: 0, width: 480, height: 240 }; // top-left quarter
  const right = { left: 480, top: 240, width: 480, height: 240 }; // bottom-right quarter

  test('two rolls started together with different areas each carry their own area and both land; only onResize fits', async () => {
    const { renderer, physics, box } = setup();
    const fit = vi.spyOn(renderer.sceneApi, 'fitArea');
    const resizes = physics.resize.mock.calls.length;
    const a = box.roll([{ type: 'd20', value: 17 }], { area: left });
    const b = box.roll([{ type: 'd6', value: 2 }], { area: right });
    expect(physics.streams[0].req.area).toEqual({ cx: -5, cz: -2.5, halfWidth: 5, halfDepth: 2.5 });
    expect(physics.streams[1].req.area).toEqual({ cx: 5, cz: 2.5, halfWidth: 5, halfDepth: 2.5 });
    const aLanded = settled(a.landed);
    const bLanded = settled(b.landed);
    physics.flush();
    renderer.tick(0);
    renderer.tick(3000);
    await flushMicrotasks();
    expect(aLanded()).toBe(true);
    expect(bLanded()).toBe(true);
    expect(fit).not.toHaveBeenCalled();
    expect(physics.resize.mock.calls.length).toBe(resizes);
    expect(renderer.setArea).toHaveBeenCalledTimes(1); // the canvas stays on the stage
    box.onResize();
    expect(fit).toHaveBeenCalledTimes(1);
  });

  test('capacityDice sizes the area for the whole throw group, not just this roll', () => {
    const { physics, box } = setup();
    box.roll([{ type: 'd20', value: 17 }], { area: left });
    box.roll([{ type: 'd20', value: 17 }], { area: left, capacityDice: 40 });
    const [small, big] = physics.streams.map((s) => s.req.area);
    expect(small.halfWidth * small.halfDepth).toBeCloseTo(12.5); // 1 die: no growth
    expect(big.halfWidth * big.halfDepth).toBeGreaterThanOrEqual(40);
    // never smaller than the roll's own dice need
    box.roll(Array.from({ length: 30 }, () => ({ type: 'd6', value: 2 })), { area: left, capacityDice: 2 });
    const own = physics.streams[2].req.area;
    expect(own.halfWidth * own.halfDepth).toBeGreaterThanOrEqual(30);
  });

  test('lastRollArea records the latest roll area (die units and clamped px rect), as copies', () => {
    const { box } = setup();
    expect(box.lastRollArea).toBeNull();
    box.roll([{ type: 'd6', value: 2 }], {
      area: { left: 720, top: -120, width: 480, height: 240 },
    });
    expect(box.lastRollArea).toEqual({
      area: { cx: 5, cz: -2.5, halfWidth: 5, halfDepth: 2.5 },
      rect: { left: 480, top: 0, width: 480, height: 240 },
      stage: { left: 0, top: 0, width: 960, height: 480 },
      diePx: 48,
      dice: null,
    });
    box.lastRollArea.rect.left = 1;
    expect(box.lastRollArea.rect.left).toBe(480);
    box.roll([{ type: 'd6', value: 2 }]);
    expect(box.lastRollArea).toMatchObject({
      area: { cx: 0, cz: 0, halfWidth: 10, halfDepth: 5 },
      rect: { left: 0, top: 0, width: 960, height: 480 },
    });
  });

  test('lastRollArea gets the settled die centres (die units) once the roll lands', async () => {
    const { renderer, physics, box } = setup();
    const r = box.roll(
      [
        { type: 'd6', value: 2 },
        { type: 'd6', value: 3 },
      ],
      { area: { left: 480, top: 240, width: 480, height: 240 } },
    );
    expect(box.lastRollArea.dice).toBeNull();
    physics.flush();
    renderer.tick(0);
    renderer.tick(3000);
    await r.landed;
    const { dice } = box.lastRollArea;
    expect(dice).toHaveLength(2);
    for (const d of dice) expect(Number.isFinite(d.x) && Number.isFinite(d.z)).toBe(true);
    dice[0].x = 999;
    expect(box.lastRollArea.dice[0].x).not.toBe(999);
  });

  test('without an area the request is unchanged and playback uses the stage', () => {
    const { physics, box } = setup();
    box.roll([{ type: 'd6', value: 2 }]);
    box.roll([{ type: 'd6', value: 2 }], {});
    for (const s of physics.streams) expect('area' in s.req).toBe(false);
  });

  test('an area is clamped inside the stage; a malformed one falls back to the stage', () => {
    const { physics, box } = setup();
    box.roll([{ type: 'd6', value: 2 }], {
      area: { left: 720, top: -120, width: 480, height: 240 },
    });
    // Shifted to left 480, top 0.
    expect(physics.streams[0].req.area).toEqual({ cx: 5, cz: -2.5, halfWidth: 5, halfDepth: 2.5 });
    box.roll([{ type: 'd6', value: 2 }], { area: { left: 0, top: 0, width: 4800, height: 2400 } });
    expect(physics.streams[1].req.area).toEqual({ cx: 0, cz: 0, halfWidth: 10, halfDepth: 5 });
    box.roll([{ type: 'd6', value: 2 }], { area: { left: NaN, top: 0, width: 100, height: 100 } });
    box.roll([{ type: 'd6', value: 2 }], { area: { left: 0, top: 0, width: 0, height: 100 } });
    expect('area' in physics.streams[2].req).toBe(false);
    expect('area' in physics.streams[3].req).toBe(false);
  });

  test('an area lands where its pixel rect is, through the real camera (x right, z down)', () => {
    const { renderer, physics, box } = setup();
    box.roll([{ type: 'd6', value: 2 }], { area: right });
    const { cx, cz, halfWidth, halfDepth } = physics.streams[0].req.area;
    // Same projection as game.dice3d.getScreenPosition.
    const toScreen = (x, z) => {
      const v = new THREE.Vector3(x, 0, z).project(renderer.camera);
      return {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - v.y) / 2) * rect.height,
      };
    };
    const centre = toScreen(cx, cz);
    expect(centre.x).toBeCloseTo(right.left + right.width / 2, 3);
    expect(centre.y).toBeCloseTo(right.top + right.height / 2, 3);
    const corner = toScreen(cx - halfWidth, cz - halfDepth);
    expect(corner.x).toBeCloseTo(right.left, 3);
    expect(corner.y).toBeCloseTo(right.top, 3);
  });
});

test('P5-R6: a tiny per-throw area is grown to hold its dice, around its centre, inside the stage', () => {
  const { physics, box } = setup();
  box.roll([{ type: 'd6', value: 2 }], { area: { left: 475, top: 235, width: 10, height: 10 } });
  const one = physics.streams[0].req.area;
  expect(one.cx).toBeCloseTo(0, 9);
  expect(one.cz).toBeCloseTo(0, 9);
  expect(one.halfWidth).toBeGreaterThanOrEqual(ONE_DIE_HALF);
  expect(one.halfDepth).toBeGreaterThanOrEqual(ONE_DIE_HALF);
  // 12 dice from a 10 x 10 px rect in the top-left corner: grown, then kept inside the stage.
  const specs = Array.from({ length: 12 }, () => ({ type: 'd6', value: 1 }));
  box.roll(specs, { area: { left: 0, top: 0, width: 10, height: 10 } });
  const many = physics.streams[1].req.area;
  expect(4 * many.halfWidth * many.halfDepth).toBeGreaterThanOrEqual(12 * CAPACITY_PER_DIE - 1e-9);
  expect(many.cx - many.halfWidth).toBeCloseTo(-10, 9);
  expect(many.cz - many.halfDepth).toBeCloseTo(-5, 9);
});

describe('per-look fonts (font layer)', () => {
  const sansLook = { numbers: { font: 'css:Comic Neue' } };
  const fontAtlas = {
    ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits-sans.json', 'utf8'))),
    texture: new THREE.Texture(),
  };
  function fakeFonts() {
    const ready = new Set();
    const listeners = new Set();
    return {
      get: vi.fn((id) => (ready.has(id) ? fontAtlas : null)),
      request: vi.fn(async () => null),
      onReady: vi.fn((cb) => (listeners.add(cb), () => listeners.delete(cb))),
      listeners,
      makeReady(id) {
        ready.add(id);
        for (const cb of listeners) cb(id);
      },
    };
  }
  beforeEach(() => {
    createDiceMaterial.mockClear();
  });

  test('a font not ready yet: the material uses the serif and the font is requested', () => {
    const fonts = fakeFonts();
    const { box } = setup({ appearance: sansLook, fonts });
    const warm = box.acquireWarmup(['d6']);
    expect(createDiceMaterial.mock.calls[0][1]).toBe(atlas);
    expect(fonts.request).toHaveBeenCalledWith('css:Comic Neue');
    warm.release();
    box.dispose();
  });

  test('onReady rebuilds the stand-in materials of that font; the new ones draw with the font atlas', () => {
    const fonts = fakeFonts();
    const { box } = setup({ appearance: sansLook, fonts });
    const before = box.acquireWarmup(['d6']);
    before.release();
    const invalidateAll = vi.spyOn(box, 'invalidateMaterials');
    const dispose = vi.spyOn(before.materials[0], 'dispose');
    fonts.makeReady('css:Comic Neue');
    expect(invalidateAll).not.toHaveBeenCalled(); // targeted, never a full invalidation
    expect(dispose).toHaveBeenCalledTimes(1);
    const after = box.acquireWarmup(['d6']);
    expect(after.materials[0]).not.toBe(before.materials[0]);
    expect(createDiceMaterial.mock.calls.at(-1)[1]).toBe(fontAtlas);
    after.release();
    box.dispose();
    expect(fonts.listeners.size).toBe(0); // dispose unsubscribes
  });

  test('a font ready that no material of this box stood in for disposes nothing (I-2)', () => {
    const fonts = fakeFonts();
    let look = { numbers: { font: 'serif' } };
    const { box } = setup({ getAppearance: () => look, fonts });
    const serifWarm = box.acquireWarmup(['d6', 'd20']);
    serifWarm.release();
    const disposes = serifWarm.materials.map((m) => vi.spyOn(m, 'dispose'));
    const built = createDiceMaterial.mock.calls.length;
    fonts.makeReady('css:Editor Only'); // e.g. an editor preview or thumbnail through the shared layer
    for (const d of disposes) expect(d).not.toHaveBeenCalled();
    const again = box.acquireWarmup(['d6', 'd20']);
    expect(again.materials).toEqual(serifWarm.materials); // still cached: no recompile
    expect(createDiceMaterial.mock.calls.length).toBe(built);
    again.release();
    box.dispose();
  });

  test('a font ready invalidates only the materials that stood in for it (I-2)', () => {
    const fonts = fakeFonts();
    let look = { numbers: { font: 'serif' } };
    const { box } = setup({ getAppearance: () => look, fonts });
    const serifMats = box.acquireWarmup(['d6']);
    look = sansLook;
    const comic = box.acquireWarmup(['d6']);
    look = { numbers: { font: 'css:Other' } };
    const other = box.acquireWarmup(['d6']);
    for (const w of [serifMats, comic, other]) w.release();
    const spy = (w) => vi.spyOn(w.materials[0], 'dispose');
    const [dSerif, dComic, dOther] = [serifMats, comic, other].map(spy);
    fonts.makeReady('css:Comic Neue');
    expect(dComic).toHaveBeenCalledTimes(1);
    expect(dSerif).not.toHaveBeenCalled();
    expect(dOther).not.toHaveBeenCalled();
    look = { numbers: { font: 'serif' } };
    const back = box.acquireWarmup(['d6']);
    expect(back.materials[0]).toBe(serifMats.materials[0]);
    back.release();
    box.dispose();
  });

  test('a stand-in material held by a roll stays until the roll lets go, then is disposed', () => {
    const fonts = fakeFonts();
    const { box } = setup({ appearance: sansLook, fonts });
    const held = box.acquireWarmup(['d6']);
    const dispose = vi.spyOn(held.materials[0], 'dispose');
    fonts.makeReady('css:Comic Neue');
    expect(dispose).not.toHaveBeenCalled();
    held.release();
    expect(dispose).toHaveBeenCalledTimes(1);
    box.dispose();
  });

  test('the serif look never asks the font layer; the cache key separates fonts', () => {
    const fonts = fakeFonts();
    fonts.makeReady('css:Comic Neue');
    let look = { numbers: { font: 'serif' } };
    const { box } = setup({ getAppearance: () => look, fonts });
    const a = box.acquireWarmup(['d6']);
    expect(fonts.get).not.toHaveBeenCalled();
    look = sansLook;
    const b = box.acquireWarmup(['d6']);
    expect(b.materials[0]).not.toBe(a.materials[0]);
    expect(createDiceMaterial.mock.calls.at(-1)[1]).toBe(fontAtlas);
    a.release();
    b.release();
    box.dispose();
  });

  test('an atlas evicted while a roll holds its material is disposed once, after the roll lets go', async () => {
    vi.useRealTimers();
    const textures = [];
    const fonts = createFontAtlases({
      serif: atlas,
      loadBundled: async () => null,
      build: async () => ({ json: {}, width: 1, height: 1, field: new Uint8Array(1) }),
      store: { get: async () => undefined, set: async () => {} },
      getRoute: (p) => `/${p}`,
      origin: 'https://vtt.example',
      toAtlas: () => {
        const texture = new THREE.Texture();
        textures.push(texture);
        return { ...fontAtlas, texture };
      },
      cacheSize: 1,
      warn: () => {},
    });
    let look = sansLook;
    const { box } = setup({ getAppearance: () => look, fonts });
    await fonts.request('css:Comic Neue');
    box.roll([{ type: 'd6', value: 1 }]);
    expect(createDiceMaterial.mock.calls.at(-1)[1].texture).toBe(textures[0]);
    const disposeA = vi.spyOn(textures[0], 'dispose');
    look = { numbers: { font: 'css:Other' } };
    await fonts.request('css:Other'); // evicts Comic Neue; onReady invalidates the materials
    expect(fonts.get('css:Comic Neue')).toBeNull();
    expect(disposeA).not.toHaveBeenCalled(); // the rolling die still binds it
    box.clear(); // the roll lets go: its stale material is disposed, and with it the atlas
    expect(disposeA).toHaveBeenCalledTimes(1);
    box.dispose();
    expect(disposeA).toHaveBeenCalledTimes(1);
  });

  test('a throwing font layer falls back to the serif', () => {
    const fonts = { get: () => { throw new Error('x'); }, request: () => { throw new Error('y'); } };
    const { box } = setup({ appearance: sansLook, fonts });
    const warm = box.acquireWarmup(['d6']);
    expect(createDiceMaterial.mock.calls[0][1]).toBe(atlas);
    warm.release();
    box.dispose();
  });
});

describe('armFirstFrame (Plan 8 Task 2)', () => {
  function withFrames() {
    const s = setup();
    let frame = null;
    s.renderer.onFrameTime = vi.fn((cb) => (frame = cb));
    // setup() built the box before onFrameTime existed: rebuild it with the probe present.
    const box = new DiceBox({
      renderer: s.renderer,
      physics: s.physics,
      atlas,
      appearance,
      getArea: () => rect,
      diceScale: () => 1,
      timeBeforeHide: () => 2000,
    });
    return { ...s, box, frame: () => frame?.(16, {}) };
  }

  test('fires once, on the first rendered frame after the roll starts drawing', () => {
    const { physics, box, frame } = withFrames();
    const cb = vi.fn();
    box.armFirstFrame(cb);
    box.roll([{ type: 'd6', value: 2 }]);
    frame();
    expect(cb).not.toHaveBeenCalled(); // no chunk yet: nothing drawn for this roll
    physics.emitFirst(0);
    expect(cb).not.toHaveBeenCalled(); // the loop only started; no frame rendered yet
    frame();
    expect(cb).toHaveBeenCalledTimes(1);
    frame();
    expect(cb).toHaveBeenCalledTimes(1);
    box.clear();
  });

  test('applies to the next roll only', () => {
    const { physics, box, frame } = withFrames();
    const cb = vi.fn();
    box.armFirstFrame(cb);
    box.roll([{ type: 'd6', value: 2 }]);
    box.roll([{ type: 'd6', value: 3 }]);
    physics.emitFirst(0);
    physics.emitFirst(1);
    frame();
    expect(cb).toHaveBeenCalledTimes(1);
    box.clear();
  });

  test('a roll cleared before it draws never fires', () => {
    const { physics, box, frame } = withFrames();
    const cb = vi.fn();
    box.armFirstFrame(cb);
    box.roll([{ type: 'd6', value: 2 }]);
    physics.emitFirst(0);
    box.clear();
    frame();
    expect(cb).not.toHaveBeenCalled();
  });
});

// P9-R18: the loop holds only while every shown roll rests and no effect runs.
test('a running effect keeps the loop going through the linger, then it holds', async () => {
  let running = true;
  const effects = { update: vi.fn(() => running), play: vi.fn(), clear: vi.fn() };
  const { renderer, physics, box } = setup({ effects });
  box.roll([{ type: 'd6', value: 3 }]);
  physics.flush();
  renderer.tick(16);
  expect(renderer.tick(2000)).toBe(true); // landed, but an effect is still animating
  expect(renderer.tick(2050)).toBe(true);
  running = false;
  expect(renderer.tick(2100)).toBe('hold');
});

test('a roll still playing keeps the loop going while another rests', async () => {
  const { renderer, physics, box } = setup();
  box.roll([{ type: 'd6', value: 3 }]);
  physics.flush(0);
  renderer.tick(0);
  expect(renderer.tick(2000)).toBe('hold');
  box.roll([{ type: 'd6', value: 4 }]);
  physics.flush(1);
  expect(renderer.tick(2016)).toBe(true);
});

test('removing a roll, or re-skinning resting dice, asks a held renderer for a frame', async () => {
  const { renderer, physics, box } = setup();
  renderer.requestFrame = vi.fn();
  const { finished } = box.roll([{ type: 'd6', value: 3 }]);
  physics.flush();
  renderer.tick(16);
  expect(renderer.tick(2000)).toBe('hold');
  renderer.requestFrame.mockClear();
  box.invalidateMaterials({ replaceInFlight: true });
  expect(renderer.requestFrame).toHaveBeenCalledTimes(1);
  box.invalidateMaterials();
  expect(renderer.requestFrame).toHaveBeenCalledTimes(1); // new rolls only: nothing shown changes
  box.clear();
  await finished;
  expect(renderer.requestFrame).toHaveBeenCalled();
});

describe('impact effects', () => {
  test('each playback impact event reaches effects.impact with the die position', () => {
    const effects = { update: vi.fn(() => false), play: vi.fn(), clear: vi.fn(), impact: vi.fn() };
    const { renderer, physics, box } = setup({ effects, getSurface: () => 'wood' });
    physics.events = [new Float32Array([5, 0, -1, 9]), new Float32Array([45, 1, 0, 12, 55, 0, -2, 20])];
    box.roll([
      { type: 'd6', value: 3 },
      { type: 'd6', value: 4, ghost: true },
    ]);
    physics.flush();
    renderer.tick(0);
    renderer.tick(800);
    renderer.tick(950);
    expect(effects.impact).toHaveBeenCalledTimes(2);
    const [a, b] = effects.impact.mock.calls.map((c) => c[0]);
    expect(a).toMatchObject({ speed: 12, surface: 'wood' });
    expect(b).toMatchObject({ speed: 20, surface: 'wood' });
    expect(a.position).toBeDefined();
    expect(typeof a.position.x).toBe('number');
    expect(a.dieKey).not.toBe(b.dieKey);
  });
});

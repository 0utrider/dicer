import { maySplat } from '../../src/physics/protocol.js';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  DiceBox,
  ASSET_WAIT_MS,
  IDLE_GEOMETRY_CAP,
} from '../../src/throw/dice-box.js';
import { MODEL_ROTATIONS } from '../../src/compat/dsn-orientation.js';
import {
  rotationToShow,
  readTopFace,
  faceForValue,
  faceNormals,
} from '../../src/core/face-reader.js';
import { readResult, combineD100 } from '../../src/core/physical-read.js';
import { buildScene } from '../../src/render/scene.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { buildDieGeometry } from '../../src/core/chamfer.js';
import { createDiceMaterial } from '../../src/render/dice-material.js';
import { _setLookExtrasImport, requestLookExtras } from '../../src/render/extras-loader.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';
import { DEFAULT_APPEARANCE } from '../../src/look/appearance.js';
import { dsnModelRotation, dsnFaceNormal } from '../../src/compat/dsn-layouts.js';
import { followFor } from '../../src/render/model-loader.js';
import { GHOST_APPEARANCE } from '../../src/compat/colorset-map.js';
import { createFaceTextures } from '../../src/render/face-textures.js';
import { FATE_FACES } from '../../src/compat/faces.js';
import { planThrow } from '../../src/throw/throw-planner.js';
import { foundryRoll, Coin } from './foundry-roll.js';
import { createEffectLayer } from '../../src/effects/effect-layer.js';
import { EFFECTS, flareRolls, withBursts } from '../../src/effects/library/index.js';
import { TIERS } from '../../src/render/quality.js';
import { CAPACITY_PER_DIE, ONE_DIE_HALF } from '../../src/areas/area-model.js';
import { createFontAtlases } from '../../src/fonts/font-atlas.js';
import { isSeed128, throwEdge } from '../../src/core/rng.js';
import { handEdge, handFor, readFree, RESULT_GLOW_MS } from '../../src/hand/hand.js';

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
        s.resolve({ settledStep: 59, nudges: s.req.dice.map(() => 0) });
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
    onContextRestored: vi.fn(),
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

test("a material keeps one fade clone (three would drop the fade program with the last), later rolls' clones are disposed", async () => {
  const { renderer, physics, box } = setup();
  const fadeOnce = async (value) => {
    const r = box.roll([{ type: 'd6', value }]);
    physics.flush();
    renderer.tick(0);
    renderer.tick(2000);
    vi.advanceTimersByTime(2000);
    renderer.tick(2100);
    const mesh = dieGroups(renderer).at(-1).children[0];
    const fade = mesh.material;
    const dispose = vi.spyOn(fade, 'dispose');
    renderer.tick(2200);
    renderer.tick(2700);
    await r.finished;
    return dispose;
  };
  expect(await fadeOnce(3)).not.toHaveBeenCalled(); // kept
  expect(await fadeOnce(4)).toHaveBeenCalledTimes(1);
  // the warm-up compiles the kept clone, and the material's disposal takes it along
  const warm = box.acquireWarmup(['d6']);
  expect(warm.fades).toHaveLength(1);
  expect(warm.fades[0].transparent).toBe(true);
  const keptDispose = vi.spyOn(warm.fades[0], 'dispose');
  warm.release();
  box.invalidateMaterials();
  expect(keptDispose).toHaveBeenCalledTimes(1);
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
  expect(physics.streams[0].req.dice.map((d) => d.type)).toEqual(['d10', 'd10']);
  expect(isSeed128(physics.streams[0].req.seed)).toBe(true); // a fresh 128-bit seed
  box.clear();
});

test('a d7 and a d14 in one roll get different label sets', () => {
  createDiceMaterial.mockClear();
  const { box, renderer } = setup();
  box.roll([
    { type: 'd14', value: 8, variant: 'd7' },
    { type: 'd14', value: 8 },
    { type: 'd6', value: 5, variant: 'd3' },
    { type: 'd10', value: 10, variant: 'd5' },
  ]);
  const [d7, d14] = dieGroups(renderer).map((g) => g.children[0]);
  expect(d7.material).not.toBe(d14.material);
  expect(d7.geometry).toBe(d14.geometry);
  const values = (t) => getShape(t).values;
  const labelSets = createDiceMaterial.mock.calls.map((c) => c[3]);
  expect(labelSets).toEqual([
    values('d14').map((v) => labelFor('d14', v, 'd7')),
    values('d14').map((v) => labelFor('d14', v)),
    values('d6').map((v) => labelFor('d6', v, 'd3')),
    values('d10').map((v) => labelFor('d10', v, 'd5')),
  ]);
  expect(labelSets[0]).not.toEqual(labelSets[1]);
  // The die turns to the planned face itself (face 8 shows a 1 on the d7).
  const dice = box._rolls.values().next().value.dice;
  expect(dice.map((d) => d.targetValue)).toEqual([8, 8, 5, 10]);
  // The die reports the Foundry result (dice events, DSN sfx), not the face it turned to.
  expect(dice.map((d) => d.value)).toEqual([1, 8, 2, 5]);
  box.clear();
});

test('a Foundry coin (results 0 / 1) throws the d2 on face 2 / 1 and reports the Foundry result', () => {
  const { box } = setup();
  const { dice: specs } = planThrow(foundryRoll(new Coin({ faces: 2, results: [{ result: 0, active: true }, { result: 1, active: true }] })));
  expect(specs).toEqual([
    { type: 'd2', value: 2, variant: 'dc', key: '0:0:0' },
    { type: 'd2', value: 1, variant: 'dc', key: '0:1:0' },
  ]);
  box.roll(specs);
  const dice = box._rolls.values().next().value.dice;
  expect(dice.map((d) => d.targetValue)).toEqual([2, 1]);
  expect(dice.map((d) => d.value)).toEqual([0, 1]);
  // A plain d2 (results 1 / 2) is unchanged.
  box.clear();
  box.roll([{ type: 'd2', value: 2 }]);
  expect(box._rolls.values().next().value.dice[0].value).toBe(2);
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

test('a restored context wakes the loop, so resting pets show again', () => {
  const update = vi.fn(() => 'rest');
  const { renderer } = setup({ pet: { update } });
  renderer.onContextLost.mock.calls[0][0]();
  expect(renderer.isLooping).toBe(false);
  renderer.onContextRestored.mock.calls[0][0]();
  expect(renderer.isLooping).toBe(true);
  expect(renderer.tick(0)).toBe('hold');
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

  test('(b) visibilitychange to hidden clears every roll; back to visible keeps the rolls', async () => {
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

  test('(b) back to visible wakes the loop, so resting pets show again', () => {
    const visibility = new FakeVisibility();
    const update = vi.fn(() => 'rest');
    const { renderer, box } = setup({ visibility, pet: { update } });
    box.wake();
    expect(renderer.tick(0)).toBe('hold');
    visibility.setHidden(true);
    expect(renderer.hide).toHaveBeenCalled();
    expect(renderer.isLooping).toBe(false);
    visibility.setHidden(false);
    expect(renderer.isLooping).toBe(true);
    expect(renderer.tick(16)).toBe('hold');
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

  test('a clear die casts no coloured light unless lightPools() (the diceLight setting) says so', async () => {
    const clear = { body: { type: 'resin', color: '#2050ff' }, interior: { type: 'none' } };
    for (const [on, pooled] of [[undefined, false], [() => true, true]]) {
      const { renderer, physics, box } = setup({ appearance: clear, ...(on && { lightPools: on }) });
      const spy = vi.spyOn(renderer.sceneApi, 'shadowFor');
      const r = box.roll([{ type: 'd6', value: 3 }]);
      physics.flush();
      renderer.tick(0);
      renderer.tick(16);
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls.every(([, o]) => (o?.pool != null) === pooled)).toBe(true);
      box.clear();
      await r.finished;
    }
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

  test('acquireWarmup(_, looks) holds one material per other look', () => {
    const { box } = setup({ appearance: ruby });
    const blue = { body: { type: 'opaque', color: '#2040c0' }, numbers: { fill: 'paint' } };
    const warm = box.acquireWarmup(undefined, [blue, ruby, blue]);
    expect(warm.materials).toHaveLength(2);
    const own = box.acquireWarmup(['d6']);
    expect(warm.materials).toContain(own.materials[0]);
    own.release();
    warm.release();
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

  test('a Fate die uses the Fate faces', async () => {
    const faceTextures = fakeFaceTextures();
    faceTextures.result.layers = Int16Array.from(
      FATE_FACES.labels.map((l, i) => (l.kind === 'text' ? i : -1)),
    );
    const { renderer, physics, box } = setup({ faceTextures });
    box.roll([
      { type: 'd6', value: 5, variant: 'dF', faces: FATE_FACES },
      { type: 'd6', value: 5 },
    ]);
    expect(faceTextures.acquire).toHaveBeenCalledWith(FATE_FACES);
    // Before (or without) its layers a Fate die shows no numbers at all.
    expect(createDiceMaterial.mock.calls[0][3].every((l) => l === '')).toBe(true);
    physics.flush();
    faceTextures.resolve();
    await flushMicrotasks();
    const call = createDiceMaterial.mock.calls.find((c) => c[5]);
    expect(call[5]).toBe(faceTextures.result);
    expect(call[3].every((l) => l === '')).toBe(true); // + and − from layers, blanks blank
    const [fate, plain] = meshes(renderer).map((m) => m.material);
    expect(fate).not.toBe(plain);
    const [die] = box._rolls.values().next().value.dice;
    expect([die.targetValue, die.value]).toEqual([5, -1]);
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
    const r = box.roll([{ type: 'd6', value: 3, dsnType: 'dX', model: 'm/dice_x.glb' }]);
    expect(models.loadModel).not.toHaveBeenCalled();
    physics.flush();
    expect(renderer.isLooping).toBe(true); // nothing to wait for
    const [mesh] = meshes(renderer);
    expect(mesh.material).toBe(createDiceMaterial.mock.results[0].value);
    expect(await landRoll(renderer, r)).toBe(true);
    box.clear();
  });

  test('a d20 model takes the rotation of its value: the model face for it lies on Dicer’s', async () => {
    const models = fakeModels();
    const loadModel = vi.fn(() => models.loadModel().then((m) => ({ ...m, rotationFor: dsnModelRotation })));
    const { renderer, physics, box } = setup({ loadModel });
    const r = box.roll([{ type: 'd20', value: 17, dsnType: 'd20', model: 'm/dice_20.glb' }]);
    expect(loadModel).toHaveBeenCalledTimes(1);
    physics.flush();
    renderer.tick(16);
    const forced = meshes(renderer)[0].quaternion.clone();
    models.pending[0].resolve();
    await flushMicrotasks();
    const [mesh] = meshes(renderer);
    expect(mesh.geometry).toBe(models.model.geometry);
    const q = new THREE.Quaternion(...dsnModelRotation('d20', 17).rotation);
    expect(Math.abs(mesh.quaternion.dot(forced.clone().multiply(q)))).toBeCloseTo(1, 9);
    // the model's 17 points where Dicer's 17 points once forced
    const shape = getShape('d20');
    const n = faceNormals(shape)[shape.values.indexOf(17)];
    const dicer17 = new THREE.Vector3(n.x, n.y, n.z).applyQuaternion(forced);
    const model17 = dsnFaceNormal('d20', 17).applyQuaternion(mesh.quaternion);
    expect(model17.distanceTo(dicer17)).toBeLessThan(1e-6);
    expect(await landRoll(renderer, r)).toBe(true);
    box.clear();
  });

  test('a d4 model takes its value’s rotation too, and keeps the plain d4 over the crystal look', async () => {
    const models = fakeModels();
    const loadModel = vi.fn(() => models.loadModel().then((m) => ({ ...m, rotationFor: dsnModelRotation })));
    const { renderer, physics, box } = setup({ loadModel });
    const crystal = { ...DEFAULT_APPEARANCE, shapes: { ...DEFAULT_APPEARANCE.shapes, d4: 'crystal' } };
    box.roll([{ type: 'd4', value: 3, dsnType: 'd4', model: 'm/dice_4.glb', appearance: crystal }]);
    expect(box._rolls.values().next().value.dice[0].shapeType).toBe('d4');
    physics.flush();
    renderer.tick(16);
    const forced = meshes(renderer)[0].quaternion.clone();
    models.pending[0].resolve();
    await flushMicrotasks();
    const [mesh] = meshes(renderer);
    expect(mesh.geometry).toBe(models.model.geometry);
    const shape = getShape('d4');
    const n = faceNormals(shape)[shape.values.indexOf(3)];
    const dicer3 = new THREE.Vector3(n.x, n.y, n.z).applyQuaternion(forced);
    expect(dsnFaceNormal('d4', 3).applyQuaternion(mesh.quaternion).distanceTo(dicer3)).toBeLessThan(1e-6);
    box.clear();
  });

  test('without a model the crystal look still makes a d4 a d4crystal', () => {
    const { box } = setup({});
    const crystal = { ...DEFAULT_APPEARANCE, shapes: { ...DEFAULT_APPEARANCE.shapes, d4: 'crystal' } };
    box.roll([{ type: 'd4', value: 3, dsnType: 'd4', appearance: crystal }]);
    expect(box._rolls.values().next().value.dice[0].shapeType).toBe('d4crystal');
    box.clear();
  });

  test('a per-value model without the solver keeps Dicer’s die', async () => {
    const models = fakeModels();
    const { renderer, physics, box } = setup({ loadModel: models.loadModel });
    box.roll([{ type: 'd12', value: 4, dsnType: 'd12', model: 'm/dice_12.glb' }]);
    physics.flush();
    models.pending[0].resolve();
    await flushMicrotasks();
    expect(meshes(renderer)[0].geometry).not.toBe(models.model.geometry);
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
    unverified.box.roll([{ type: 'd6', value: 3, dsnType: 'dX', model: 'm/dice_x.glb' }]);
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

  test('flareInside finds a roll by its id or message id, one die by index, and hands the dice to the layer', async () => {
    const { box, effects } = await withEffects();
    const flare = vi.spyOn(effects, 'flare').mockReturnValue(true);
    box.roll([{ type: 'd20', value: 20 }, { type: 'd6', value: 2 }]);
    const roll = box._rolls.values().next().value;
    roll.messageId = 'msgA';
    expect(box.flareInside(roll.id, { amount: 1, duration: 900 })).toBe(true);
    expect(flare).toHaveBeenLastCalledWith([roll], { amount: 1, duration: 900 });
    expect(box.flareInside('msgA', { die: 1 })).toBe(true);
    expect(flare).toHaveBeenLastCalledWith([roll], { die: 1 });
    flare.mockReturnValue(false); // setting off or no inside: the layer says false
    expect(box.flareInside('other', {})).toBe(false);
    expect(flare).toHaveBeenLastCalledWith([], {});
    expect(box.flareInside(undefined, {})).toBe(false);
    expect(flare).toHaveBeenLastCalledWith([], {});
  });

  test('flareInside with null opts does not throw and leaves the effect-layer warning armed', async () => {
    const { box } = await withEffects();
    const effects = createEffectLayer({
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      canvas: { style: { transform: '' } },
      getTier: () => TIERS.ultra,
      getSetting: () => undefined,
      loadLibrary: async () => ({ EFFECTS, flareRolls }),
      isolate: () => null,
      matchMedia: () => ({ matches: false }),
      debug: () => {},
    });
    await effects.prefetch();
    box._effects = effects;
    box.roll([{ type: 'd20', value: 20 }]);
    const roll = box._rolls.values().next().value;
    expect(box.flareInside(roll.id, null)).toBe(false);
    expect(box._effectsWarned).toBe(false);
  });

  test('flareInside restarts the render loop for a lingering roll at rest', async () => {
    const { renderer, physics, box, effects } = await withEffects();
    box.roll([{ type: 'd20', value: 20 }]);
    const roll = box._rolls.values().next().value;
    physics.flush();
    renderer.tick(0);
    renderer.tick(2000); // landed, at rest, nothing running: the loop holds
    expect(renderer.tick(2100)).toBe('hold');
    renderer.startLoop.mockClear?.();
    const spy = vi.spyOn(effects, 'flare').mockReturnValue(false);
    expect(box.flareInside(roll.id)).toBe(false);
    expect(renderer.startLoop).not.toHaveBeenCalled(); // nothing flared: no wake
    spy.mockReturnValue(true);
    expect(box.flareInside(roll.id)).toBe(true);
    expect(renderer.startLoop).toHaveBeenCalledTimes(1);
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

  test('a landed trail-2 die with no fx still reaches the effect layer (its crit burst); others without fx do not', async () => {
    const onLandedFx = vi.fn();
    const effects = { play: vi.fn(), update: () => false, releaseDie() {}, clear() {} };
    const { renderer, physics, box } = setup({ effects, onLandedFx });
    const a = settled(
      box.roll([
        { type: 'd20', value: 20, trail: 2 },
        { type: 'd20', value: 20, trail: 1 },
        { type: 'd6', value: 3 },
      ]).landed,
    );
    physics.flush();
    renderer.tick(0);
    renderer.tick(2000);
    await flushMicrotasks();
    expect(a()).toBe(true);
    expect(effects.play).toHaveBeenCalledTimes(1);
    const [die, fx] = effects.play.mock.calls[0];
    expect(die.trail).toBe(2);
    expect(fx).toBeNull();
    expect(onLandedFx).not.toHaveBeenCalled(); // no fx: no sound or macro to run
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

test('a strict area (a dice tray) is never grown for its dice: they pile inside it instead', () => {
  const { physics, box } = setup();
  const tray = { left: 380, top: 160, width: 240, height: 180, strict: true };
  box.roll(Array.from({ length: 25 }, () => ({ type: 'd20', value: 5 })), { area: tray });
  const a = physics.streams[0].req.area;
  const loose = box.lastRollArea;
  expect(4 * a.halfWidth * a.halfDepth).toBeLessThan(25 * CAPACITY_PER_DIE); // not grown to fit 25
  expect(a.halfWidth * 2 * loose.diePx).toBeCloseTo(240, 6);
  expect(a.halfDepth * 2 * loose.diePx).toBeCloseTo(180, 6);
  // the same rect without strict grows as before
  const { physics: p2, box: b2 } = setup();
  b2.roll(Array.from({ length: 25 }, () => ({ type: 'd20', value: 5 })), { area: { ...tray, strict: false } });
  const grown = p2.streams[0].req.area;
  expect(4 * grown.halfWidth * grown.halfDepth).toBeGreaterThanOrEqual(25 * CAPACITY_PER_DIE - 1e-9);
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

describe('elemental trail flight hook', () => {
  test('a spec trail mark reaches the die (0 on a ghost); flight runs each playing frame, not after landing', () => {
    const effects = { update: vi.fn(() => false), play: vi.fn(), clear: vi.fn(), flight: vi.fn() };
    const { renderer, physics, box } = setup({ effects });
    box.roll([
      { type: 'd6', value: 3, trail: 2 },
      { type: 'd6', value: 4, trail: 2, ghost: true },
      { type: 'd6', value: 5, trail: 4 },
      { type: 'd6', value: 1 },
    ]);
    const roll = box._rolls.values().next().value;
    expect(roll.dice.map((d) => d.trail)).toEqual([2, 0, 4, 0]);
    physics.flush();
    renderer.tick(0);
    renderer.tick(100);
    expect(effects.flight).toHaveBeenCalled();
    expect(effects.flight.mock.calls[0][0]).toBe(roll);
    expect(typeof effects.flight.mock.calls[0][1]).toBe('number');
    renderer.tick(10000);
    renderer.tick(20000);
    const n = effects.flight.mock.calls.length;
    renderer.tick(30000);
    expect(effects.flight.mock.calls.length).toBe(n);
  });

  test('an effect layer without flight does not fail the frame', () => {
    const effects = { update: vi.fn(() => false), play: vi.fn(), clear: vi.fn() };
    const { renderer, physics, box } = setup({ effects });
    box.roll([{ type: 'd6', value: 3, trail: 1 }]);
    physics.flush();
    renderer.tick(0);
    expect(() => renderer.tick(100)).not.toThrow();
  });
});

describe('the crystal d4 look', () => {
  const crystal = { ...DEFAULT_APPEARANCE, shapes: { d4: 'crystal' } };
  const landed = async (renderer, physics, box, specs) => {
    const r = box.roll(specs);
    physics.flush();
    renderer.tick(10000);
    renderer.tick(20000);
    await flushMicrotasks();
    return r;
  };

  test('a d4 with a crystal look is thrown as d4crystal (hull, geometry key, reader) and shows the rolled value', async () => {
    buildDieGeometry.mockClear();
    createDiceMaterial.mockClear();
    const { renderer, physics, box } = setup();
    await landed(renderer, physics, box, [{ type: 'd4', value: 3, appearance: crystal }]);
    expect(physics.streams[0].req.dice.map((d) => d.type)).toEqual(['d4crystal']);
    expect(buildDieGeometry.mock.calls.map((c) => c[0].type)).toEqual(['d4crystal']);
    expect([...box._geometries.keys()][0].startsWith('d4crystal|')).toBe(true);
    const shape = getShape('d4crystal');
    expect(createDiceMaterial.mock.calls[0][2]).toBe(shape);
    expect(createDiceMaterial.mock.calls[0][3]).toEqual(shape.values.map((v) => labelFor('d4crystal', v)));
    const die = box._rolls.values().next().value.dice[0];
    // Foundry's type and result stay d4's; the face reader is the crystal's
    expect(die.type).toBe('d4');
    expect(die.value).toBe(3);
    expect(die.shape).toBe(shape);
    expect(die.targetValue).toBe(3);
    const r = rotationToShow(shape, readTopFace(shape, { x: 0, y: 0, z: 0, w: 1 }), faceForValue(shape, 3));
    const q = die.inner.quaternion;
    expect(Math.abs(q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w)).toBeCloseTo(1, 5);
    box.clear();
  });

  test('a classic d4 and a crystal d4 do not share a geometry or a material', () => {
    const { renderer, box } = setup();
    box.roll([
      { type: 'd4', value: 2 },
      { type: 'd4', value: 2, appearance: crystal },
    ]);
    const [a, b] = dieGroups(renderer).map((g) => g.children[0]);
    expect(a.geometry).not.toBe(b.geometry);
    expect(a.material).not.toBe(b.material);
    box.clear();
  });

  test('a roll-level crystal look, a ghost and a rebuilt material all keep the shape', () => {
    const { physics, box } = setup({ getAppearance: () => crystal });
    box.roll([
      { type: 'd4', value: 4 },
      { type: 'd4', value: 4, ghost: true },
    ]);
    expect(physics.streams[0].req.dice.map((d) => d.type)).toEqual(['d4crystal', 'd4crystal']);
    box.invalidateMaterials({ replaceInFlight: true });
    const dice = box._rolls.values().next().value.dice;
    expect(dice.every((d) => d.shape.type === 'd4crystal' && d.type === 'd4')).toBe(true);
    expect(dice[0].inner.geometry).toBe(dice[1].inner.geometry);
    box.clear();
  });

  test('other types ignore shapes.d4', () => {
    const { physics, box } = setup();
    box.roll(['d6', 'd8', 'd20', 'd2'].map((type) => ({ type, value: 1, appearance: crystal })));
    expect(physics.streams[0].req.dice.map((d) => d.type)).toEqual(['d6', 'd8', 'd20', 'd2']);
    // only the d20 may splat a pet (protocol.js maySplat)
    expect(physics.streams[0].req.dice.map((d) => d.splat)).toEqual([false, false, undefined, false]);
    box.clear();
  });

  test('a classic look keeps the d4', () => {
    const { physics, box } = setup();
    box.roll([{ type: 'd4', value: 1, appearance: DEFAULT_APPEARANCE }]);
    expect(physics.streams[0].req.dice.map((d) => d.type)).toEqual(['d4']);
    box.clear();
  });
});

describe('a DSN preset faces keep the d4 classic; a never-drawn d4 model does not', () => {
  const crystal = { ...DEFAULT_APPEARANCE, shapes: { d4: 'crystal' } };

  test('a d4 with a model and a crystal look is the classic d4 (the model is drawn on it)', () => {
    buildDieGeometry.mockClear();
    const { physics, box } = setup();
    box.roll([{ type: 'd4', value: 2, dsnType: 'd4', model: 'm/dice_4.glb', appearance: crystal }]);
    expect(physics.streams[0].req.dice.map((d) => d.type)).toEqual(['d4']);
    const die = box._rolls.values().next().value.dice[0];
    expect(die.shapeType).toBe('d4');
    expect(die.modelRotation).toBe(MODEL_ROTATIONS.d4);
    box.clear();
  });

  test('a d4 with preset faces and a crystal look keeps its faces and the classic shape', () => {
    const { physics, box } = setup();
    const faces = { key: 'k', labels: getShape('d4').values.map((v) => ({ kind: 'glyph', text: 'g' + v })) };
    box.roll([{ type: 'd4', value: 2, faces, appearance: crystal }]);
    expect(physics.streams[0].req.dice.map((d) => d.type)).toEqual(['d4']);
    const die = box._rolls.values().next().value.dice[0];
    expect(die.faces).toBe(faces);
    expect(die.shape).toBe(getShape('d4'));
    box.clear();
  });
});

describe('pet hook', () => {
  const PET = { userId: 'u1', kind: 'cat', color: '#fa0', ghost: false };
  const fakePet = (over = {}) => {
    const calls = [];
    const pet = {
      calls,
      moving: false,
      begin: vi.fn((key, info) => calls.push(['begin', key, info])),
      landed: vi.fn((key, dice) => calls.push(['landed', key, dice])),
      leave: vi.fn((key, ms) => calls.push(['leave', key, ms])),
      end: vi.fn((key) => calls.push(['end', key])),
      update: vi.fn(() => pet.moving),
      ...over,
    };
    return pet;
  };
  const names = (pet) => pet.calls.map((c) => c[0]);

  /** Lands the roll, lets it linger and fade, and finishes it. */
  async function playOut(renderer, physics) {
    physics.flush();
    renderer.tick(16);
    renderer.tick(500);
    renderer.tick(2000);
    await flushMicrotasks();
    vi.advanceTimersByTime(2000);
    renderer.tick(2100);
    renderer.tick(2600);
    await flushMicrotasks();
  }

  test('a roll with a pet spec calls begin at reveal, landed with each die, leave on fade, end on finish', async () => {
    const seed = [0xc0001234, 5, 6, 7]; // a 128-bit seed (edge 3)
    vi.stubGlobal('crypto', { getRandomValues: (a) => (a.set(seed), a) });
    try {
      const pet = fakePet();
      const { renderer, physics, box } = setup({ pet });
      const area = { left: 0, top: 0, width: 480, height: 240 };
      box.roll(
        [
          { type: 'd20', value: 17 },
          { type: 'd6', value: 3, ghost: true },
        ],
        { area, pet: PET },
      );
      expect(pet.begin).not.toHaveBeenCalled();
      await playOut(renderer, physics);
      expect(names(pet)).toEqual(['begin', 'landed', 'leave', 'end']);
      const [, key, info] = pet.calls[0];
      expect(typeof key).toBe('string');
      expect(info.spec).toBe(PET);
      expect(info.edge).toBe(throwEdge(seed));
      expect(Object.keys(info.area).sort()).toEqual(['cx', 'cz', 'halfDepth', 'halfWidth']);
      expect(info.area).toEqual(physics.streams[0].req.area);
      // the live dice (the pet faces their centre, and may catch a natural 20 mid-roll)
      expect(info.dice).toHaveLength(2);
      expect(info.dice.every((d) => d.outer?.isGroup)).toBe(true);
      const landedDice = pet.calls[1][2];
      expect(landedDice.map(({ x, z, appearance, damageType, ...rest }) => rest)).toEqual([
        { type: 'd20', value: 17, ghost: false },
        { type: 'd6', ghost: true }, // a ghost shows no result
      ]);
      for (const d of landedDice) {
        expect(Number.isFinite(d.x)).toBe(true);
        expect(Number.isFinite(d.z)).toBe(true);
      }
      expect(landedDice[0]).toHaveProperty('appearance');
      expect('damageType' in landedDice[0]).toBe(true);
      // privacy: a ghost passes no look and no damage type
      expect('appearance' in landedDice[1]).toBe(false);
      expect('damageType' in landedDice[1]).toBe(false);
      expect(pet.calls[2][2]).toBe(400);
      expect(pet.calls.every((c) => c[1] === key)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('a non-ghost die reaches landed with its damageType and its appearance object', async () => {
    const pet = fakePet();
    const { renderer, physics, box } = setup({ pet });
    box.roll([{ type: 'd6', value: 3, damageType: 'fire' }], { pet: PET });
    await playOut(renderer, physics);
    const [die] = pet.calls.find((c) => c[0] === 'landed')[2];
    expect(die.damageType).toBe('fire');
    expect(die.appearance).toBeTypeOf('object');
    expect(die.appearance).not.toBeNull();
  });

  test('the area is the stage rectangle when the throw had none; the hook may be a function', () => {
    const pet = fakePet();
    const { renderer, physics, box } = setup({ pet: () => pet });
    box.roll([{ type: 'd6', value: 3 }], { pet: PET });
    physics.flush();
    renderer.tick(16);
    expect(pet.calls[0][2].area).toEqual({ cx: 0, cz: 0, halfWidth: 10, halfDepth: 5 });
    box.clear();
  });

  test('no pet spec: no begin, leave or end, only a keyless landed (resting pets react to its dice), ghosts stripped', async () => {
    const pet = fakePet();
    const { renderer, physics, box } = setup({ pet });
    box.roll([
      { type: 'd6', value: 3, damageType: 'fire' },
      { type: 'd6', value: 4, ghost: true, damageType: 'fire' },
    ]);
    await playOut(renderer, physics);
    expect(names(pet)).toEqual(['landed']);
    const [, key, dice] = pet.calls[0];
    expect(key == null).toBe(true);
    expect(dice[0].damageType).toBe('fire');
    expect(Number.isFinite(dice[0].x) && Number.isFinite(dice[0].z)).toBe(true);
    // privacy: the ghost passes no look and no damage type
    expect(dice[1].ghost).toBe(true);
    expect('appearance' in dice[1]).toBe(false);
    expect('damageType' in dice[1]).toBe(false);
  });

  test('no pet spec and no pet layer loaded: nothing is called or loaded', async () => {
    const hook = vi.fn(() => null); // getPets() before the chunk loads
    const { renderer, physics, box } = setup({ pet: hook });
    box.roll([{ type: 'd6', value: 3, damageType: 'fire' }]);
    await playOut(renderer, physics);
    expect(hook.mock.results.every((r) => r.value === null)).toBe(true);
  });

  test('a keyless landed that throws warns, and the roll still finishes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pet = fakePet({
      landed: vi.fn(() => {
        throw new Error('pet boom');
      }),
    });
    const { renderer, physics, box } = setup({ pet });
    const { landed, finished } = box.roll([{ type: 'd6', value: 3 }]);
    const isLanded = settled(landed);
    const isFinished = settled(finished);
    await playOut(renderer, physics);
    expect(isLanded()).toBe(true);
    expect(isFinished()).toBe(true);
    expect(warn.mock.calls.filter((c) => c[0] === 'Dicer | pet')).toHaveLength(1);
    expect(pet.update).toHaveBeenCalled(); // the update still runs: only that roll's call failed
    warn.mockRestore();
  });

  test('the loop keeps running while pet.update returns true, and holds once it returns false', () => {
    const pet = fakePet();
    const { renderer, physics, box } = setup({ pet });
    box.roll([{ type: 'd6', value: 3 }], { pet: PET });
    physics.flush();
    renderer.tick(16);
    renderer.tick(500);
    renderer.tick(2000); // landed, lingering
    pet.moving = true;
    expect(renderer.tick(2100)).toBe(true);
    pet.moving = false;
    expect(renderer.tick(2200)).toBe('hold');
    box.clear();
  });

  test('a pet that throws in update warns once and is not called again for that roll; the roll still lands and finishes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pet = fakePet({
      update: vi.fn(() => {
        throw new Error('pet boom');
      }),
    });
    const { renderer, physics, box } = setup({ pet });
    const { landed, finished } = box.roll([{ type: 'd6', value: 3 }], { pet: PET });
    const isLanded = settled(landed);
    const isFinished = settled(finished);
    await playOut(renderer, physics);
    expect(isLanded()).toBe(true);
    expect(isFinished()).toBe(true);
    expect(pet.update).toHaveBeenCalledTimes(1);
    expect(names(pet)).toEqual(['begin']);
    expect(warn.mock.calls.filter((c) => c[0] === 'Dicer | pet')).toHaveLength(1);
    warn.mockRestore();
  });

  test('clear() mid-throw calls leave(key, 0) and end(key)', () => {
    const pet = fakePet();
    const { renderer, physics, box } = setup({ pet });
    box.roll([{ type: 'd6', value: 3 }], { pet: PET });
    physics.flush();
    renderer.tick(16);
    box.clear();
    expect(names(pet)).toEqual(['begin', 'leave', 'end']);
    expect(pet.calls[1][2]).toBe(0);
    expect(pet.calls[1][1]).toBe(pet.calls[0][1]);
    expect(pet.calls[2][1]).toBe(pet.calls[0][1]);
  });

  describe('obstacles, hits and a held rest', () => {
    const OBS = (n) => Array.from({ length: n }, (_, i) => ({ x: i, z: 1, r: 1, h: 2, id: `p${i}` }));
    const pump = (renderer, physics) => {
      physics.flush();
      renderer.tick(0);
      renderer.tick(800); // playhead ~48
      renderer.tick(950); // playhead ~57
    };

    test('roll() asks obstaclesFor before the throw and sends at most 3 obstacles without ids', () => {
      const seed = [0x80000987, 1, 2, 3]; // edge 2
      vi.stubGlobal('crypto', { getRandomValues: (a) => (a.set(seed), a) });
      try {
        const pet = fakePet({ obstaclesFor: vi.fn(() => OBS(4)) });
        const { physics, box } = setup({ pet: () => pet });
        box.roll([{ type: 'd6', value: 3 }], { pet: PET });
        expect(pet.obstaclesFor).toHaveBeenCalledTimes(1);
        const info = pet.obstaclesFor.mock.calls[0][0];
        expect(info.spec).toBe(PET);
        expect(info.edge).toBe(throwEdge(seed));
        expect(info.area).toEqual({ cx: 0, cz: 0, halfWidth: 10, halfDepth: 5 });
        expect(physics.streams[0].req.obstacles).toEqual([
          { x: 0, z: 1, r: 1, h: 2 },
          { x: 1, z: 1, r: 1, h: 2 },
          { x: 2, z: 1, r: 1, h: 2 },
        ]);
        box.clear();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    test('obstaclesFor is asked for a throw with no PetSpec too (spec null), and sends none for an empty list', () => {
      const pet = fakePet({ obstaclesFor: vi.fn(() => []) });
      const { physics, box } = setup({ pet });
      box.roll([{ type: 'd6', value: 3 }]);
      expect(pet.obstaclesFor.mock.calls[0][0].spec).toBeNull();
      expect('obstacles' in physics.streams[0].req).toBe(false);
      box.clear();
    });

    test('a throw with no pet hook sends no obstacles key', () => {
      const { physics, box } = setup();
      box.roll([{ type: 'd6', value: 3 }]);
      expect('obstacles' in physics.streams[0].req).toBe(false);
      const bare = fakePet();
      const other = setup({ pet: bare });
      other.box.roll([{ type: 'd6', value: 3 }], { pet: PET });
      expect('obstacles' in other.physics.streams[0].req).toBe(false);
      box.clear();
      other.box.clear();
    });

    test('the hook that answered obstaclesFor is the one begin is called on', () => {
      const first = fakePet({ obstaclesFor: vi.fn(() => []) });
      const second = fakePet();
      let current = first;
      const { renderer, physics, box } = setup({ pet: () => current });
      box.roll([{ type: 'd6', value: 3 }], { pet: PET });
      current = second;
      physics.flush();
      renderer.tick(16);
      expect(first.begin).toHaveBeenCalledTimes(1);
      expect(second.begin).not.toHaveBeenCalled();
      box.clear();
    });

    test('an impact with other -4 calls hit with the second id, at playback time, with the die position copied', () => {
      const hit = vi.fn();
      const pet = fakePet({ obstaclesFor: () => OBS(3), hit });
      const { renderer, physics, box } = setup({ pet });
      physics.events = [new Float32Array(0), new Float32Array([45, 0, -4, 12])];
      box.roll([{ type: 'd6', value: 3 }]); // no PetSpec: hits still arrive
      physics.flush();
      renderer.tick(0);
      expect(hit).not.toHaveBeenCalled();
      renderer.tick(800);
      expect(hit).toHaveBeenCalledTimes(1);
      const [id, info] = hit.mock.calls[0];
      expect(id).toBe('p1');
      expect(info.speed).toBe(12);
      expect(info.dieKey).toMatch(/^\d+:0$/);
      expect(Object.keys(info.position).sort()).toEqual(['x', 'y', 'z']);
      const die = box._rolls.values().next().value.dice[0];
      expect(info.position).not.toBe(die.outer.position);
      expect(info.position.x).toBe(die.outer.position.x);
      box.clear();
    });

    test('impacts with other -1/-2/0 never call hit; an unknown obstacle index is ignored', () => {
      const hit = vi.fn();
      const pet = fakePet({ obstaclesFor: () => OBS(1), hit });
      const { renderer, physics, box } = setup({ pet });
      physics.events = [
        new Float32Array([5, 0, -1, 9]),
        new Float32Array([45, 0, -2, 12, 50, 0, 0, 5, 55, 0, -6, 7]),
      ];
      box.roll([{ type: 'd6', value: 3 }]);
      pump(renderer, physics);
      expect(hit).not.toHaveBeenCalled();
      box.clear();
    });

    test('a pet contact plays no die click and raises no dust; the floor and wall contacts still do', () => {
      const hit = vi.fn();
      const onImpact = vi.fn();
      const effects = { update: vi.fn(() => false), play: vi.fn(), clear: vi.fn(), impact: vi.fn() };
      const pet = fakePet({ obstaclesFor: () => OBS(2), hit });
      const { renderer, physics, box } = setup({ pet, onImpact, effects });
      physics.events = [
        new Float32Array(0),
        new Float32Array([42, 0, -1, 9, 45, 0, -3, 12, 50, 0, -4, 3, 55, 0, -2, 7]),
      ];
      box.roll([{ type: 'd6', value: 3 }]);
      pump(renderer, physics);
      expect(hit).toHaveBeenCalledTimes(2);
      expect(onImpact.mock.calls.map((c) => c[0].other)).toEqual([-1, -2]);
      expect(effects.impact).toHaveBeenCalledTimes(2);
      box.clear();
    });

    test("the throw carries the pet layer's splatSpeed with its obstacles, and none when it has none", () => {
      const withSplat = setup({ pet: fakePet({ obstaclesFor: () => OBS(1), splatSpeed: 10 }) });
      withSplat.box.roll([{ type: 'd6', value: 3 }]);
      expect(withSplat.physics.streams[0].req.splatSpeed).toBe(10);
      const off = setup({ pet: fakePet({ obstaclesFor: () => OBS(1), splatSpeed: null }) });
      off.box.roll([{ type: 'd6', value: 3 }]);
      expect('splatSpeed' in off.physics.streams[0].req).toBe(false);
      const none = setup({ pet: fakePet({ obstaclesFor: () => [], splatSpeed: 10 }) });
      none.box.roll([{ type: 'd6', value: 3 }]);
      expect('splatSpeed' in none.physics.streams[0].req).toBe(false);
      for (const s of [withSplat, off, none]) s.box.clear();
    });

    test('no rolls + update "rest" -> #frame returns "hold"; no rolls + update false -> false', () => {
      const pet = fakePet({ update: vi.fn(() => 'rest') });
      const { renderer, box } = setup({ pet });
      box.wake();
      expect(renderer.tick(0)).toBe('hold');
      pet.update.mockImplementation(() => false);
      expect(renderer.tick(16)).toBe(false);
    });

    test('with rolls, "rest" counts as not moving', () => {
      const pet = fakePet({ update: vi.fn(() => 'rest') });
      const { renderer, physics, box } = setup({ pet });
      box.roll([{ type: 'd6', value: 3 }], { pet: PET });
      physics.flush();
      renderer.tick(16);
      renderer.tick(500);
      expect(renderer.tick(2000)).toBe('hold');
      box.clear();
    });

    test('wake() restarts a held loop', () => {
      const pet = fakePet({ update: vi.fn(() => 'rest') });
      const { renderer, box } = setup({ pet });
      box.wake();
      expect(renderer.tick(0)).toBe('hold');
      const starts = renderer.startLoop.mock.calls.length;
      box.wake();
      expect(renderer.startLoop.mock.calls.length).toBe(starts + 1);
      expect(renderer.startLoop).toHaveBeenLastCalledWith(box._tick);
    });

    test('a throwing obstaclesFor or hit warns once and the roll still lands', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const pet = fakePet({
        obstaclesFor: vi.fn(() => {
          throw new Error('obs boom');
        }),
        hit: vi.fn(() => {
          throw new Error('hit boom');
        }),
      });
      const { renderer, physics, box } = setup({ pet });
      physics.events = [new Float32Array(0), new Float32Array([45, 0, -3, 12, 50, 0, -3, 12])];
      const { landed } = box.roll([{ type: 'd6', value: 3 }]);
      const isLanded = settled(landed);
      expect('obstacles' in physics.streams[0].req).toBe(false);
      pump(renderer, physics);
      renderer.tick(2000);
      await flushMicrotasks();
      expect(isLanded()).toBe(true);
      expect(warn.mock.calls.filter((c) => c[0] === 'Dicer | pet')).toHaveLength(1);
      warn.mockRestore();
      box.clear();
    });

    test('a hit that throws warns once without skipping the next impact sound', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onImpact = vi.fn();
      const pet = fakePet({
        obstaclesFor: () => OBS(1),
        hit: vi.fn(() => {
          throw new Error('hit boom');
        }),
      });
      const { renderer, physics, box } = setup({ pet, onImpact });
      physics.events = [
        new Float32Array(0),
        new Float32Array([45, 0, -3, 12, 50, 0, -3, 12, 55, 0, -1, 12]),
      ];
      box.roll([{ type: 'd6', value: 3 }]);
      pump(renderer, physics);
      expect(pet.hit).toHaveBeenCalledTimes(2);
      expect(onImpact).toHaveBeenCalledTimes(1); // the floor's; a pet contact has no die click
      expect(warn.mock.calls.filter((c) => c[0] === 'Dicer | pet')).toHaveLength(1);
      warn.mockRestore();
      box.clear();
    });

    test('a bad obstacle list never fails a throw: junk entries are dropped, a non-array sends none', () => {
      const hit = vi.fn();
      const good = { x: 0, z: 1, r: 1, h: 2, id: 'a' };
      const pet = fakePet({ obstaclesFor: () => [null, 5, good], hit });
      const { renderer, physics, box } = setup({ pet });
      physics.events = [new Float32Array(0), new Float32Array([45, 0, -3, 12])];
      box.roll([{ type: 'd6', value: 3 }]);
      expect(physics.streams[0].req.obstacles).toEqual([{ x: 0, z: 1, r: 1, h: 2 }]);
      pump(renderer, physics);
      expect(hit.mock.calls.map((c) => c[0])).toEqual(['a']);
      box.clear();

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const bad = setup({ pet: fakePet({ obstaclesFor: () => 'oops' }) });
      const { landed } = bad.box.roll([{ type: 'd6', value: 3 }]);
      expect(bad.physics.streams).toHaveLength(1);
      expect('obstacles' in bad.physics.streams[0].req).toBe(false);
      expect(landed).toBeInstanceOf(Promise);
      warn.mockRestore();
      bad.box.clear();
    });

    test('two concurrent rolls map -3 to their own ids', () => {
      const hit = vi.fn();
      let n = 0;
      const pet = fakePet({
        obstaclesFor: () => [{ x: 0, z: 0, r: 1, h: 2, id: `r${++n}` }],
        hit,
      });
      const { renderer, physics, box } = setup({ pet });
      physics.events = [new Float32Array(0), new Float32Array([45, 0, -3, 12])];
      box.roll([{ type: 'd6', value: 3 }]);
      box.roll([{ type: 'd6', value: 4 }]);
      pump(renderer, physics);
      expect(hit.mock.calls.map((c) => c[0]).sort()).toEqual(['r1', 'r2']);
      box.clear();
    });

    test('onResize tells the hook the new area through areaChanged', () => {
      const pet = fakePet({ areaChanged: vi.fn() });
      let r = rect;
      const { box } = setup({ pet, getArea: () => r });
      pet.areaChanged.mockClear();
      r = { left: 0, top: 0, width: 480, height: 240 };
      box.onResize();
      expect(pet.areaChanged).toHaveBeenCalledWith({
        cx: 0,
        cz: 0,
        halfWidth: 5,
        halfDepth: 2.5,
        rect: { left: 0, top: 0, width: 480, height: 240 },
      });
    });

    test('obstaclesFor gets the stage too (the pet layer may load after the last resize)', () => {
      const pet = fakePet({ obstaclesFor: vi.fn(() => []) });
      const { box } = setup({ pet });
      box.roll([{ type: 'd6', value: 3 }]);
      expect(pet.obstaclesFor.mock.calls[0][0].stage).toEqual({
        cx: 0,
        cz: 0,
        halfWidth: 10,
        halfDepth: 5,
        rect: { left: 0, top: 0, width: 960, height: 480 },
      });
      box.clear();
    });

    test('dieArea turns a px area into the die-unit area a throw there uses; null is the stage', () => {
      const { box } = setup();
      expect(box.dieArea(null)).toEqual({ cx: 0, cz: 0, halfWidth: 10, halfDepth: 5 });
      expect(box.dieArea({ left: 480, top: 0, width: 480, height: 240 })).toEqual({
        cx: 5,
        cz: -2.5,
        halfWidth: 5,
        halfDepth: 2.5,
      });
    });
  });

  test('a hidden tab or empty specs never calls begin', () => {
    const pet = fakePet();
    const { box } = setup({ pet, visibility: { hidden: true, addEventListener() {} } });
    box.roll([{ type: 'd6', value: 3 }], { pet: PET });
    const other = setup({ pet });
    other.box.roll([], { pet: PET });
    expect(pet.calls).toEqual([]);
  });
});
describe('rolling by hand: free rolls, record, source, hold', () => {
  const PET = { userId: 'u1', kind: 'cat', color: '#fa0', ghost: false };
  const ID = { x: 0, y: 0, z: 0, w: 1 };
  /** A box with the hand chunk attached (it reads free dice, counts values, glows, records). */
  const handSetup = (o) => {
    const s = setup(o);
    handFor(s.box);
    return s;
  };
  const LAUNCH = [{ pos: [1, 2, 0], quat: [0, 0, 0, 1], linvel: [3, 0, 0], angvel: [0, 0, 0] }];
  const hook = (over = {}) => ({
    begin: vi.fn(),
    landed: vi.fn(),
    leave: vi.fn(),
    end: vi.fn(),
    update: vi.fn(() => false),
    ...over,
  });
  const liveRefs = (box) => [...box._refs.values()].filter((e) => e.refs > 0).length;
  const liveGeo = (box) => [...box._geoRefs.values()].filter((e) => e.refs > 0).length;
  /** Lands every flushed roll, then lingers, fades and finishes them. */
  const playOut = async (renderer, t = 0) => {
    renderer.tick(t);
    renderer.tick(t + 5000);
    await flushMicrotasks();
    vi.advanceTimersByTime(2000);
    renderer.tick(t + 5100);
    renderer.tick(t + 6000);
    await flushMicrotasks();
  };

  test('handEdge is the side whose wall the mean release point is nearest (0 = +x, as throwEdge)', () => {
    const area = { cx: 0, cz: 0, halfWidth: 10, halfDepth: 5 };
    const at = (...xz) => xz.map(([x, z]) => ({ pos: [x, 2, z] }));
    expect(handEdge(at([8, 0]), area)).toBe(0);
    expect(handEdge(at([-8, 0]), area)).toBe(1);
    expect(handEdge(at([0, 4]), area)).toBe(2);
    expect(handEdge(at([0, -4]), area)).toBe(3);
    expect(handEdge([null, ...at([9, -4], [7, -2])], area)).toBe(0); // mean (8, -3): +x is 2 away
    // an offset area: x = -4 is 1 from its -x wall at -5
    expect(handEdge(at([-4, 0]), { ...area, cx: 5 })).toBe(1);
  });

  test('a free roll without the hand chunk attached warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { box } = setup();
    box.roll([{ type: 'd6', value: 1 }], { free: true });
    box.roll([{ type: 'd6', value: 1, free: true }]);
    box.roll([{ type: 'd6', value: 1 }]); // a forced roll needs no chunk
    expect(warn.mock.calls.filter((c) => /hand chunk/.test(String(c[0])))).toHaveLength(1);
    const ok = handSetup();
    warn.mockClear();
    ok.box.roll([{ type: 'd6', value: 1 }], { free: true });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('read resolves at physics done, before landing, with the values landing gives', async () => {
    const { renderer, physics, box } = handSetup();
    const order = [];
    const r = box.roll(
      [
        { type: 'd6', value: 1 },
        { type: 'd10', value: 0, variant: 'd100tens' },
        { type: 'd10', value: 10 },
      ],
      { free: true, record: () => order.push('record') },
    );
    r.read.then(() => order.push('read'));
    const landed = settled(r.landed);
    physics.flush();
    await flushMicrotasks();
    expect(order).toEqual(['record', 'read']);
    expect(landed()).toBe(false);
    const early = await r.read;
    renderer.tick(0);
    renderer.tick(5000);
    expect(await r.values).toEqual(early);
    expect(r.handle.dice.some((d) => d.glows)).toBe(false); // no d16 glow from the early read
  });

  test('read resolves null for a roll that fails, and null without the hand chunk', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { physics, box } = handSetup();
    const r = box.roll([{ type: 'd6', value: 1 }], { free: true });
    physics.fail(0);
    expect(await r.read).toBeNull();
    const bare = setup();
    const b = bare.box.roll([{ type: 'd6', value: 1 }], { free: true });
    bare.physics.flush();
    await flushMicrotasks();
    expect(await b.read).toBeNull();
    const hidden = setup({ visibility: { hidden: true, addEventListener() {} } });
    expect(await hidden.box.roll([{ type: 'd6', value: 1 }]).read).toBeNull();
    warn.mockRestore();
    err.mockRestore();
  });

  test('values resolves in spec order at landing (free and forced)', async () => {
    const { renderer, physics, box } = handSetup();
    const free = box.roll(
      [
        { type: 'd6', value: 1 },
        { type: 'd10', value: 0, variant: 'd100tens' },
        { type: 'd10', value: 10 },
        { type: 'd20', value: 1, ghost: true },
      ],
      { free: true },
    );
    expect(physics.streams[0].req.free).toBe(true);
    expect(free.handle).toBeTruthy();
    const got = settled(free.values);
    physics.flush();
    renderer.tick(0);
    renderer.tick(300);
    await flushMicrotasks();
    expect(got()).toBe(false);
    renderer.tick(5000);
    const tens = readResult(getShape('d10'), ID, 'd100tens');
    expect(await free.values).toEqual([
      readResult(getShape('d6'), ID),
      null,
      combineD100(tens, readResult(getShape('d10'), ID)),
      readResult(getShape('d20'), ID), // a ghost on this screen still reads its value
    ]);
    const dice = free.handle.dice;
    expect(dice[0].value).toBe(readResult(getShape('d6'), ID));
    expect(dice[3].value).toBeUndefined();
    expect(dice.every((d) => d.inner.quaternion.equals(new THREE.Quaternion()))).toBe(true);

    const forced = box.roll([
      { type: 'd6', value: 3 },
      { type: 'd10', value: 40, variant: 'd100tens' },
      { type: 'd10', value: 7 },
      { type: 'd6', value: 5, variant: 'd3' },
    ]);
    expect('free' in physics.streams[1].req).toBe(false);
    physics.flush(1);
    renderer.tick(6000);
    renderer.tick(9000);
    expect(await forced.values).toEqual([3, null, 47, 2]);
    box.clear();
  });

  test('a failed roll resolves values with null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { physics, box } = handSetup();
    const r = box.roll([{ type: 'd6', value: 1 }], { free: true });
    physics.fail(0);
    await flushMicrotasks();
    expect(await r.values).toBeNull();
    vi.restoreAllMocks();
  });

  test('record gets every chunk, events, obstacles with ids; #finish does not recycle recorded chunks', async () => {
    const OBS = [
      { x: 3, z: 1, r: 1, h: 2, id: 'u1' },
      { x: -3, z: 1, r: 1, h: 2, id: 'u2' },
    ];
    const { renderer, physics, box } = handSetup({
      pet: hook({ obstaclesFor: () => OBS, splatSpeed: 10 }),
    });
    physics.events = [new Float32Array([5, 0, -1, 7]), new Float32Array([40, 0, -4, 12])];
    const record = vi.fn();
    const r = box.roll([{ type: 'd6', value: 1, key: '0:0:0' }], {
      free: true,
      launch: LAUNCH,
      seed: 42,
      record,
    });
    const s = physics.streams[0];
    expect(s.req).toMatchObject({ seed: 42, free: true, launch: LAUNCH });
    const emitted = [];
    const inner = s.cb;
    s.cb = (c) => (emitted.push(c.data), inner(c));
    physics.flush();
    await flushMicrotasks();
    expect(record).toHaveBeenCalledTimes(1);
    const rec = record.mock.calls[0][0];
    expect(rec.chunks).toHaveLength(2);
    rec.chunks.forEach((c, i) => expect(c).toBe(emitted[i]));
    expect(rec.events).toBeInstanceOf(Float32Array);
    expect([...rec.events]).toEqual([5, 0, -1, 7, 40, 0, -4, 12]);
    expect(rec.settledStep).toBe(59);
    expect(rec.nudges).toEqual([0]);
    expect(rec.dice).toEqual([{ shapeType: 'd6', key: '0:0:0' }]);
    expect(rec.area).toEqual({ cx: 0, cz: 0, halfWidth: 10, halfDepth: 5 });
    expect(rec.obstacles).toEqual([
      { id: 'u1', x: 3, z: 1, r: 1, h: 2 },
      { id: 'u2', x: -3, z: 1, r: 1, h: 2 },
    ]);
    expect(rec.splatSpeed).toBe(10);
    const finished = settled(r.finished);
    await playOut(renderer);
    expect(finished()).toBe(true);
    expect(physics.recycle).not.toHaveBeenCalled();
    expect(emitted.every((d) => d.length > 0)).toBe(true); // never transferred away
  });

  test('source plays without a THROW and without obstaclesFor; its chunks are never recycled; hit maps -3-i to source.obstacleIds', async () => {
    const hit = vi.fn();
    const pet = hook({ obstaclesFor: vi.fn(() => []), hit });
    const { renderer, physics, box } = handSetup({ pet });
    let push;
    let finish;
    const source = {
      onChunk: (cb) => (push = cb),
      done: new Promise((res) => (finish = res)),
      obstacleIds: ['a', 'b'],
    };
    const r = box.roll([{ type: 'd6', value: 1 }], { source, free: true, edge: 3, pet: PET });
    expect(physics.streams).toHaveLength(0);
    expect(pet.obstaclesFor).not.toHaveBeenCalled();
    for (const c of chunksFor(1, [new Float32Array(0), new Float32Array([45, 0, -4, 12])])) push(c);
    finish({ settledStep: 59 });
    renderer.tick(0);
    expect(pet.begin.mock.calls[0][1]).toMatchObject({ edge: 3, hand: true });
    renderer.tick(800);
    expect(hit).toHaveBeenCalledWith('b', expect.objectContaining({ speed: 12 }));
    renderer.tick(5000);
    expect(await r.values).toEqual([readResult(getShape('d6'), ID)]);
    const finished = settled(r.finished);
    vi.advanceTimersByTime(2000);
    renderer.tick(5100);
    renderer.tick(6000);
    await flushMicrotasks();
    expect(finished()).toBe(true);
    expect(physics.recycle).not.toHaveBeenCalled();
  });

  test("spec.shapeType forces the geometry over the viewer's crystal look", () => {
    const crystal = { ...DEFAULT_APPEARANCE, shapes: { d4: 'crystal' } };
    const a = handSetup({ getAppearance: () => crystal });
    a.box.roll([
      { type: 'd4', value: 2, shapeType: 'd4' },
      { type: 'd4', value: 2 },
    ]);
    expect(a.physics.streams[0].req.dice.map((d) => d.type)).toEqual(['d4', 'd4crystal']);
    const b = handSetup();
    b.box.roll([{ type: 'd4', value: 2, shapeType: 'd4crystal' }]);
    expect(b.physics.streams[0].req.dice.map((d) => d.type)).toEqual(['d4crystal']);
    const die = b.box._rolls.values().next().value.dice[0];
    expect(die.type).toBe('d4');
    expect(die.shape).toBe(getShape('d4crystal'));
    a.box.clear();
    b.box.clear();
  });

  test('a free (hand) model die follows the face it shows, so it rests on the model’s face for its read value', async () => {
    const model = { geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshStandardMaterial() };
    const loadModel = vi.fn(async () => ({ ...model, rotationFor: dsnModelRotation, followFor }));
    const { renderer, physics, box } = handSetup({ loadModel });
    const r = box.roll([{ type: 'd20', value: 1, dsnType: 'd20', model: 'm/dice_20.glb' }], { free: true, launch: LAUNCH });
    const die = box._rolls.values().next().value.dice[0];
    expect(die.modelRotation).toBe('value');
    await flushMicrotasks();
    expect(die.model).toBeTruthy();
    const shape = getShape('d20');
    // shown at once (the pose at spawn is identity), then a pose showing another face: the model
    // turns to that face's value
    const atRest = shape.values[readTopFace(shape, { x: 0, y: 0, z: 0, w: 1 })];
    expect(Math.abs(die.inner.quaternion.dot(new THREE.Quaternion(...dsnModelRotation('d20', atRest).rotation)))).toBeCloseTo(1, 9);
    const v = atRest === 7 ? 8 : 7;
    const nv = faceNormals(shape)[shape.values.indexOf(v)];
    die.follow(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(nv.x, nv.y, nv.z), new THREE.Vector3(0, 1, 0)));
    expect(Math.abs(die.modelQuat.dot(new THREE.Quaternion(...dsnModelRotation('d20', v).rotation)))).toBeCloseTo(1, 9);
    expect(die.inner.quaternion.equals(die.modelQuat)).toBe(true);
    physics.flush();
    renderer.tick(100);
    renderer.tick(5000);
    const [value] = await r.values;
    // landed at identity: the model's face for the read value lies on Dicer's face for it
    const n = faceNormals(shape)[shape.values.indexOf(value)];
    expect(dsnFaceNormal('d20', value).applyQuaternion(die.inner.quaternion).distanceTo(new THREE.Vector3(n.x, n.y, n.z))).toBeLessThan(1e-6);
    box.clear();
  });

  test('hold shows dice after assets, setPose moves them, release reuses the die objects, drop frees materials and geometries (refcounts back to 0)', async () => {
    let resolveModel;
    const model = {
      geometry: new THREE.BoxGeometry(1, 1, 1),
      material: new THREE.MeshStandardMaterial(),
    };
    const loadModel = vi.fn(() => new Promise((res) => (resolveModel = () => res(model))));
    const { renderer, physics, box } = handSetup({ loadModel });
    expect(box.holding).toBe(false);
    const h = box.hold(
      [
        { type: 'd6', value: 1, dsnType: 'd6', model: 'm/dice_6.glb' },
        { type: 'd8', value: 1 },
      ],
      { area: rect },
    );
    expect(box.holding).toBe(true);
    const ready = settled(h.ready);
    const groups = dieGroups(renderer);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => !g.visible)).toBe(true);
    expect(renderer.isLooping).toBe(false);
    resolveModel();
    await flushMicrotasks();
    expect(ready()).toBe(true);
    expect(groups.every((g) => g.visible)).toBe(true);
    expect(groups[0].children[0].geometry).toBe(model.geometry);
    expect(renderer.tick(16)).toBe(true); // held: the loop runs
    h.setPose(1, { x: 2, y: 3, z: -1 }, { x: 0, y: 0, z: 1, w: 0 });
    expect(groups[1].position.toArray()).toEqual([2, 3, -1]);
    expect(groups[1].quaternion.toArray()).toEqual([0, 0, 1, 0]);
    expect(physics.streams).toHaveLength(0);

    const r = h.release({ free: true, launch: LAUNCH });
    expect(box.holding).toBe(false);
    expect(physics.streams).toHaveLength(1);
    expect(physics.streams[0].req).toMatchObject({ free: true, launch: LAUNCH });
    const after = dieGroups(renderer);
    expect(after).toHaveLength(2);
    after.forEach((g, i) => expect(g).toBe(groups[i]));
    expect(loadModel).toHaveBeenCalledTimes(1);
    physics.flush();
    renderer.tick(100);
    renderer.tick(5000);
    expect(await r.values).toHaveLength(2);
    box.clear();
    expect(liveRefs(box)).toBe(0);

    const h2 = box.hold([
      { type: 'd6', value: 1 },
      { type: 'd12', value: 1 },
    ]);
    await h2.ready;
    expect(liveRefs(box)).toBeGreaterThan(0);
    expect(liveGeo(box)).toBe(2);
    h2.drop();
    expect(box.holding).toBe(false);
    expect(dieGroups(renderer)).toHaveLength(0);
    expect(liveRefs(box)).toBe(0);
    expect(liveGeo(box)).toBe(0);
  });

  test("hold loop stops after drop (renderer stopLoop / 'hold')", async () => {
    const { renderer, box } = handSetup();
    const h = box.hold([{ type: 'd6', value: 1 }]);
    await h.ready;
    expect(renderer.isLooping).toBe(true);
    expect(renderer.tick(0)).toBe(true);
    h.drop();
    expect(renderer.tick(16)).toBe(false);
    expect(renderer.isLooping).toBe(false);
    // with a resting pet the loop holds instead
    const pet = hook({ update: vi.fn(() => 'rest') });
    const other = handSetup({ pet });
    const h2 = other.box.hold([{ type: 'd6', value: 1 }]);
    await h2.ready;
    expect(other.renderer.tick(0)).toBe(true);
    h2.drop();
    expect(other.renderer.tick(16)).toBe('hold');
    // clear() drops a hold too
    const h3 = box.hold([{ type: 'd6', value: 1 }]);
    await h3.ready;
    box.clear();
    expect(box.holding).toBe(false);
    expect(dieGroups(renderer)).toHaveLength(0);
  });

  test('slowLanded: a free roll whose message brings a slow-motion effect slows its landing, while in the air only', async () => {
    const slow = [{ type: 'd20', value: 20, key: '0:0:0', fx: [{ ruleId: 'n', effect: { id: 'celebrate' }, slowMotion: true }] }];
    // the message before the physics is done: the done chunk ramps it
    let { renderer, physics, box } = handSetup();
    let r = box.roll([{ type: 'd20', value: 1, key: '0:0:0' }], { free: true });
    expect(box.slowLanded(r.handle, [{ ...slow[0], fx: [{ ruleId: 'n', slowMotion: false }] }])).toBe(false);
    expect(box.slowLanded(r.handle, slow)).toBe(true);
    expect(r.handle.slowMotion).toBe(true);
    physics.flush();
    expect(r.handle.playback._ramp).not.toBeNull();
    // after the physics is done (the usual case: the values are read then): ramped at once
    ({ renderer, physics, box } = handSetup());
    r = box.roll([{ type: 'd20', value: 1, key: '0:0:0' }], { free: true });
    physics.flush();
    renderer.tick(0);
    expect(r.handle.playback._ramp).toBeNull();
    const before = r.handle.playback.durationMs(r.handle.playback.frames - 1);
    expect(box.slowLanded(r.handle, slow)).toBe(true);
    expect(r.handle.playback._ramp).not.toBeNull();
    expect(r.handle.playback.durationMs(r.handle.playback.frames - 1)).toBeGreaterThan(before);
    expect(box.slowLanded(r.handle, slow)).toBe(false); // once
    // landed: nothing to slow
    renderer.tick(30000);
    await flushMicrotasks();
    const r2 = box.roll([{ type: 'd20', value: 1 }], { free: true });
    physics.flush();
    renderer.tick(31000);
    renderer.tick(60000);
    await flushMicrotasks();
    expect(box.slowLanded(r2.handle, slow)).toBe(false);
  });

  test('decorateLanded plays fx once on lingering dice; false after the fade', async () => {
    const onLandedFx = vi.fn();
    const effects = {
      update: vi.fn(() => false),
      play: vi.fn(),
      clear: vi.fn(),
      releaseDie: vi.fn(),
    };
    const fire = vi.fn();
    const { renderer, physics, box } = handSetup({ onLandedFx, effects, systemFor: () => ({ fire }) });
    const r = box.roll(
      [
        { type: 'd20', value: 1, key: '0:0:0' },
        { type: 'd6', value: 1, key: '1:0:0' },
      ],
      { free: true },
    );
    expect(box.decorateLanded(r.handle, [])).toBe(false); // not landed yet
    physics.flush();
    renderer.tick(0);
    renderer.tick(5000);
    await flushMicrotasks();
    expect(onLandedFx).not.toHaveBeenCalled();
    const fx = [{ ruleId: 'x', effect: { id: 'celebrate' } }];
    // matched by key: the message's plan may order (or number) its dice differently
    const specs = [
      { type: 'd6', value: 4, key: '1:0:0', system: 'sys', dsnType: 'd6' },
      { type: 'd20', value: 20, key: '0:0:0', fx, damageType: 'fire', trail: 2 },
    ];
    expect(box.decorateLanded(r.handle, specs)).toBe(true);
    expect(onLandedFx).toHaveBeenCalledTimes(1);
    const [die, gotFx] = onLandedFx.mock.calls[0];
    expect(die.type).toBe('d20');
    expect(gotFx).toBe(fx);
    expect(die.damageType).toBe('fire');
    expect(die.value).toBe(20);
    expect(die.trail).toBe(2); // a natural 20 of the thrower's own hand roll can burst
    expect(effects.play).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls.map((c) => c[0])).toEqual([0, 2]); // SPAWN, then RESULT
    expect(fire.mock.calls[1][1]).toEqual({ dice: [{ type: 'd6', value: 4 }], system: 'sys' });
    // SPAWN hands the die itself too, as Dice So Nice does (dice.mesh: its outer group)
    expect([...fire.mock.calls[0][1].dice]).toEqual([{ type: 'd6' }]);
    expect(fire.mock.calls[0][1].dice.mesh.isObject3D).toBe(true);
    expect(box.decorateLanded(r.handle, specs)).toBe(false); // once
    expect(onLandedFx).toHaveBeenCalledTimes(1);

    const late = box.roll([{ type: 'd6', value: 1 }], { free: true });
    physics.flush(1);
    renderer.tick(6000);
    renderer.tick(9000);
    await flushMicrotasks();
    vi.advanceTimersByTime(2000);
    renderer.tick(9100); // fading
    expect(box.decorateLanded(late.handle, [{ type: 'd6', value: 2, fx }])).toBe(false);
    box.clear();
    expect(box.decorateLanded(late.handle, [{ type: 'd6', value: 2, fx }])).toBe(false);
    expect(onLandedFx).toHaveBeenCalledTimes(1);
  });

  describe('hand throw crit bursts (land, then decorate)', () => {
    const isBurst = (f) => String(f?.effect?.id).startsWith('burst-');
    /** A layer stub that runs play() through the library's real burst rules and counts bursts. */
    const burstLayer = () => {
      const running = [];
      return {
        running,
        update: vi.fn(() => false),
        clear: vi.fn(),
        releaseDie: vi.fn(),
        play: vi.fn((die, fx) => {
          for (const f of withBursts(die, fx, running, () => undefined)) {
            if (isBurst(f)) running.push({ id: f.effect.id });
          }
        }),
      };
    };
    const landHand = async (spec) => {
      const effects = burstLayer();
      const { renderer, physics, box } = handSetup({ effects });
      // Physics reads a 20 (readFree sets die.value before landing).
      box.hand.read = (dice, data, o) => {
        readFree(dice, data, o);
        for (const d of dice) d.value = 20;
      };
      const r = box.roll([{ type: 'd20', value: 1, key: '0:0:0', damageType: 'fire', ...spec }], { free: true });
      physics.flush();
      renderer.tick(0);
      renderer.tick(5000);
      await flushMicrotasks();
      expect(r.handle.dice[0].value).toBe(20);
      return { effects, box, r };
    };

    test('an active natural 20 bursts exactly once, even when its landing die already could', async () => {
      for (const trail of [1, 2]) {
        const { effects, box, r } = await landHand({ trail });
        expect(box.decorateLanded(r.handle, [{ type: 'd20', value: 20, key: '0:0:0', damageType: 'fire', trail: 2 }])).toBe(true);
        expect(effects.running.map((e) => e.id)).toEqual(['burst-fire']);
      }
    });

    test('a dropped 20 (decorated inactive: trail 1) never bursts', async () => {
      const { effects, box, r } = await landHand({ trail: 1 });
      expect(box.decorateLanded(r.handle, [{ type: 'd20', value: 20, key: '0:0:0', damageType: 'fire', trail: 1 }])).toBe(true);
      expect(effects.running).toEqual([]);
    });
  });

  test('a hand roll passes edge and hand: true to obstaclesFor and begin', () => {
    const seed = [0x40000777, 9, 9, 9]; // edge 1, not the hand throw's 2
    vi.stubGlobal('crypto', { getRandomValues: (a) => (a.set(seed), a) });
    try {
      const pet = hook({ obstaclesFor: vi.fn(() => []) });
      const { renderer, physics, box } = handSetup({ pet });
      box.roll([{ type: 'd6', value: 1 }], { free: true, launch: LAUNCH, edge: 2, pet: PET });
      expect(pet.obstaclesFor.mock.calls[0][0]).toMatchObject({ edge: 2, hand: true });
      physics.flush();
      renderer.tick(16);
      expect(pet.begin.mock.calls[0][1]).toMatchObject({ edge: 2, hand: true });
      // an automatic roll keeps its seeded edge, hand false; a bad edge falls back to the seed
      box.roll([{ type: 'd6', value: 1 }], { pet: PET, edge: 7 });
      expect(pet.obstaclesFor.mock.calls[1][0]).toMatchObject({
        edge: throwEdge(seed),
        hand: false,
      });
      box.clear();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('alignFor passes through to the pet hook; a throwing one warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const alignFor = vi.fn();
    const { box } = handSetup({ pet: hook({ alignFor }) });
    const list = [{ id: 'u', x: 1, z: 1, r: 1, h: 2 }];
    const paths = () => 9;
    alignFor.mockReturnValueOnce(new Set(['u'])); // the ids it aligned come back
    expect(box.alignFor(list, { cx: 0, cz: 0, halfWidth: 4, halfDepth: 3 }, paths)).toEqual(new Set(['u']));
    expect(alignFor).toHaveBeenCalledWith(
      list,
      { cx: 0, cz: 0, halfWidth: 4, halfDepth: 3 },
      paths,
    );
    alignFor.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => box.alignFor(list, {}, paths)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('a hand-read d16 glows on its counted face for RESULT_GLOW_MS', async () => {
    const { renderer, physics, box } = handSetup();
    const r = box.roll(
      [
        { type: 'd16', value: 1 },
        { type: 'd6', value: 1 },
      ],
      { free: true },
    );
    const forced = box.roll([{ type: 'd16', value: 3 }]);
    physics.flush();
    renderer.tick(0);
    renderer.tick(5000); // both land
    const [d16, d6] = r.handle.dice;
    const glow = d16.outer.children.find((c) => c !== d16.inner);
    expect(glow).toBeTruthy();
    expect(d6.outer.children).toHaveLength(1);
    expect(forced.handle.dice[0].outer.children).toHaveLength(1);
    // every glow vertex lies on the counted face's plane (just above it)
    const shape = getShape('d16');
    const n = new THREE.Vector3().copy(faceNormals(shape)[d16.readFace]);
    const plane = new THREE.Vector3(...shape.vertices[shape.faces[d16.readFace][0]]).dot(n);
    const pos = glow.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      expect(new THREE.Vector3().fromBufferAttribute(pos, i).dot(n) - plane).toBeGreaterThan(0);
      expect(new THREE.Vector3().fromBufferAttribute(pos, i).dot(n) - plane).toBeLessThan(0.05);
    }
    expect(renderer.tick(5000 + RESULT_GLOW_MS / 2)).toBe(true); // fading out: the loop runs
    expect(glow.material.opacity).toBeGreaterThan(0);
    expect(renderer.tick(5000 + RESULT_GLOW_MS + 1)).toBe('hold');
    expect(d16.outer.children).toHaveLength(1);
    box.clear();
  });

  test('a glow still lit when the roll is cleared is removed and freed', async () => {
    const { renderer, physics, box } = handSetup();
    const r = box.roll([{ type: 'd16', value: 1 }], { free: true });
    physics.flush();
    renderer.tick(0);
    renderer.tick(5000);
    const [d16] = r.handle.dice;
    const glow = d16.outer.children.find((c) => c !== d16.inner);
    const dispose = vi.spyOn(glow.material, 'dispose');
    box.clear();
    expect(d16.outer.children).toHaveLength(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('the hand chunk is attached once per box and sends the face readers to its worker once', () => {
    const { box, physics } = setup();
    expect(box.hand).toBeFalsy();
    physics.setReaders = vi.fn();
    const h = handFor(box);
    expect(box.hand).toBe(h);
    expect(handFor(box)).toBe(h);
    expect(physics.setReaders).toHaveBeenCalledTimes(1);
    const readers = physics.setReaders.mock.calls[0][0];
    expect(Object.keys(readers)).toEqual(expect.arrayContaining(['d6', 'd16', 'd4crystal', 'd2']));
  });

  test('without the hand chunk a free roll still lands, unread, and values resolves null', async () => {
    const { renderer, physics, box } = setup();
    const r = box.roll([{ type: 'd16', value: 3 }], { free: true, record: vi.fn() });
    physics.flush();
    renderer.tick(0);
    renderer.tick(5000);
    await flushMicrotasks();
    expect(await r.values).toBeNull();
    expect(r.handle.dice[0].readValue).toBeUndefined();
    expect(r.handle.dice[0].outer.children).toHaveLength(1); // no glow
    expect(box.decorateLanded(r.handle, [])).toBe(false);
    box.clear();
  });

  test('a released hold: release again throws nothing more, drop leaves the flying roll alone', async () => {
    const { renderer, physics, box } = handSetup();
    const h = box.hold([{ type: 'd6', value: 1 }]);
    await h.ready;
    const r = h.release({ free: true, launch: LAUNCH });
    expect(h.release({ free: true })).toBe(r);
    expect(physics.streams).toHaveLength(1);
    h.drop();
    expect(box.activeRolls).toBe(1);
    expect(dieGroups(renderer)).toHaveLength(1);
    physics.flush();
    renderer.tick(0);
    renderer.tick(5000);
    expect(await r.values).toEqual([readResult(getShape('d6'), ID)]);
    // dropped first: a later release throws nothing
    const h2 = box.hold([{ type: 'd6', value: 1 }]);
    h2.drop();
    const r2 = h2.release({ free: true });
    expect(physics.streams).toHaveLength(1);
    expect(await r2.values).toBeNull();
    box.clear();
  });
});

describe('living insides: per-die motion (insideMotion)', () => {
  const MOTION = ['uInteriorTime', 'uInteriorSpin', 'uInteriorLag', 'uInteriorFlare', 'uInteriorSwirl'];
  const resinLiquid = {
    body: { type: 'resin', color: '#d9e6f0', color2: '#9fb3c8', roughness: 0.05 },
    interior: { type: 'liquid', colors: ['#3fa7ff', '#1b3a8a'], density: 0.5 },
  };
  const opaque = { body: { type: 'opaque', color: '#b3202a' } };
  const ON = { interiors: true, engraving: true, glow: true, effects: true, interiorSteps: 32, insideMotion: true };

  beforeEach(async () => {
    vi.useRealTimers(); // the chunk import settles through real promise hops
    _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
    expect(await requestLookExtras()).not.toBeNull();
    vi.useFakeTimers();
  });

  function rollWith(flags, specs, opts = {}) {
    let f = flags;
    const made = setup({ appearance: undefined, getAppearance: () => resinLiquid, getFlags: () => f, ...opts });
    made.box.roll(specs);
    made.dice = made.box._rolls.values().next().value.dice;
    made.setFlags = (next) => (f = next);
    return made;
  }

  test('a resin die with an inside is isolated from its first frame when insideMotion is on; an opaque die and a low-tier die are not', () => {
    const { renderer, physics, box, dice } = rollWith(ON, [
      { type: 'd6', value: 1 },
      { type: 'd6', value: 2, appearance: opaque },
    ]);
    physics.flush();
    renderer.tick(0);
    const [inside, plain] = dice;
    expect(inside.isolated).toBeTruthy();
    expect(inside.inner.material).toBe(inside.isolated);
    for (const k of MOTION) expect(inside.isolated.userData.uniforms[k]).toBeDefined();
    expect(plain.isolated).toBeFalsy();
    box.clear();

    const low = rollWith({ ...ON, interiorSteps: 0 }, [{ type: 'd6', value: 1 }]);
    low.physics.flush();
    low.renderer.tick(0);
    expect(low.dice[0].isolated).toBeFalsy();
    low.box.clear();
  });

  test('a die with a built-in shape inside (star) is not isolated for motion, a fantasy shape (sword) is', () => {
    const shaped = (shape) => ({ ...resinLiquid, interior: { type: 'shape', shape, colors: ['#ffd24a', '#c28a00'], density: 0.5 } });
    const { renderer, physics, box, dice } = rollWith(ON, [
      { type: 'd6', value: 1, appearance: shaped('star') },
      { type: 'd6', value: 2, appearance: shaped('sword') },
    ]);
    physics.flush();
    renderer.tick(0);
    expect(dice[0].isolated).toBeFalsy();
    expect(dice[1].isolated).toBeTruthy();
    box.clear();
  });

  test('#frame advances uInteriorTime on an isolated inside die (dt clamped to 0.1 s)', () => {
    const { renderer, physics, box, dice } = rollWith(ON, [{ type: 'd6', value: 1 }]);
    physics.flush();
    renderer.tick(0);
    const u = dice[0].isolated.userData.uniforms;
    expect(u.uInteriorTime.value).toBe(0);
    renderer.tick(50);
    expect(u.uInteriorTime.value).toBeCloseTo(0.05, 6);
    renderer.tick(1050); // a long gap counts as 0.1 s
    expect(u.uInteriorTime.value).toBeCloseTo(0.15, 6);
    expect(u.uInteriorLag.value.length()).toBeCloseTo(1, 6);
    box.clear();
  });

  test("a lingering roll with a moving inside returns true until 10 s after landing, then 'hold'", async () => {
    const { renderer, physics, box } = rollWith(ON, [{ type: 'd6', value: 1 }], { timeBeforeHide: () => 60000 });
    physics.flush();
    renderer.tick(0);
    expect(renderer.tick(2000)).toBe(true); // lands this frame: the inside still moves
    expect(renderer.tick(8000)).toBe(true);
    expect(renderer.tick(11990)).toBe(true);
    expect(renderer.tick(12000)).toBe('hold');
    box.clear();
  });

  test('a look change mid-roll keeps the same uInteriorTime/Spin/Lag/Flare/Swirl objects', () => {
    const { renderer, physics, box, dice } = rollWith(ON, [{ type: 'd6', value: 1 }]);
    physics.flush();
    renderer.tick(0);
    renderer.tick(50);
    const iso = dice[0].isolated;
    const held = MOTION.map((k) => iso.userData.uniforms[k]);
    box.invalidateMaterials({ replaceInFlight: true });
    const now = dice[0].inner.material;
    expect(now).not.toBe(iso);
    expect(now.userData.uniforms).not.toBe(iso.userData.uniforms);
    MOTION.forEach((k, i) => expect(now.userData.uniforms[k]).toBe(held[i]));
    renderer.tick(100);
    expect(now.userData.uniforms.uInteriorTime.value).toBeCloseTo(0.1, 6);
    box.clear();
  });

  test('insideMotion off: nothing isolated for motion, frame result as today', () => {
    const { renderer, physics, box, dice } = rollWith({ ...ON, insideMotion: false }, [{ type: 'd6', value: 1 }], {
      timeBeforeHide: () => 60000,
    });
    physics.flush();
    renderer.tick(0);
    expect(dice[0].isolated).toBeFalsy();
    expect(dice[0].inner.material.userData.uniforms.uInteriorTime).toBeUndefined();
    expect(renderer.tick(2000)).toBe('hold');
    box.clear();
  });
});

describe('mineShown / onLayer (diceAboveWindows)', () => {
  test('a roll thrown with mine is shown as mine until it finishes; others are not', async () => {
    const onLayer = vi.fn();
    const { renderer, physics, box } = setup({ onLayer });
    const theirs = box.roll([{ type: 'd6', value: 3 }]);
    physics.flush();
    renderer.tick(16);
    expect(box.mineShown).toBe(false);
    expect(onLayer).not.toHaveBeenCalled();

    const mine = box.roll([{ type: 'd6', value: 4 }], { mine: true });
    expect(box.mineShown).toBe(true);
    physics.flush();
    renderer.tick(32);
    expect(onLayer).toHaveBeenCalledTimes(1);
    expect(onLayer).toHaveBeenLastCalledWith(true);
    renderer.tick(48); // no change: not told again
    expect(onLayer).toHaveBeenCalledTimes(1);

    box.clear();
    await flushMicrotasks();
    await Promise.all([theirs.finished, mine.finished]);
    expect(box.mineShown).toBe(false);
    box.roll([{ type: 'd6', value: 1 }]);
    physics.flush();
    renderer.tick(64);
    expect(onLayer).toHaveBeenLastCalledWith(false);
  });

  test("a preview roll (mine 'always') shows as 'always' over any other roll, until it finishes", async () => {
    const onLayer = vi.fn();
    const { renderer, physics, box } = setup({ onLayer });
    box.roll([{ type: 'd6', value: 4 }], { mine: true });
    const preview = box.roll([{ type: 'd20', value: 20 }], { mine: 'always' });
    expect(box.mineShown).toBe('always');
    physics.flush();
    renderer.tick(16);
    expect(onLayer).toHaveBeenLastCalledWith('always');
    box.clear();
    await flushMicrotasks();
    await preview.finished;
    expect(box.mineShown).toBe(false);
  });

  test('the last roll ending lowers the layer at once (the loop stops on that frame, no later tick)', async () => {
    const onLayer = vi.fn();
    const { renderer, physics, box } = setup({ onLayer });
    const preview = box.roll([{ type: 'd20', value: 20 }], { mine: 'always' });
    physics.flush();
    renderer.tick(16);
    expect(onLayer).toHaveBeenLastCalledWith('always');
    box.clear(); // no roll after it, no frame after it
    await flushMicrotasks();
    await preview.finished;
    expect(onLayer).toHaveBeenLastCalledWith(false);
  });

  test('a throwing onLayer warns and never breaks the frame', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { renderer, physics, box } = setup({
      onLayer: () => {
        throw new Error('x');
      },
    });
    box.roll([{ type: 'd6', value: 2 }], { mine: true });
    physics.flush();
    expect(() => renderer.tick(16)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('a look’s own face images', () => {
  const ft = () => ({ acquire: vi.fn(() => new Promise(() => {})), release: vi.fn() });
  const look = { ...DEFAULT_APPEARANCE, faces: { d6: { 6: 'worlds/w/six.webp' } } };

  test('a die of that type gets a look face set; other types and relabelled dice do not', () => {
    const faceTextures = ft();
    const { box } = setup({ faceTextures });
    box.roll([
      { type: 'd6', value: 6, appearance: look },
      { type: 'd20', value: 3, appearance: look },
      { type: 'd6', value: 2, appearance: look, variant: 'dF' },
    ]);
    expect(faceTextures.acquire).toHaveBeenCalledTimes(1);
    const set = faceTextures.acquire.mock.calls[0][0];
    expect(set.key.startsWith('look|d6|')).toBe(true);
    expect(set.labels.find((l) => l.kind === 'image')).toEqual({ kind: 'image', url: 'worlds/w/six.webp' });
    box.clear();
  });

  test('presetFaces off drops preset images but never the look’s own', () => {
    const faceTextures = ft();
    const { box } = setup({ faceTextures, faceLayers: () => false });
    const preset = { key: 'sys|d6|x', labels: getShape('d6').values.map(() => ({ kind: 'image', url: 'p.png' })) };
    box.roll([{ type: 'd6', value: 1, faces: preset }]);
    expect(faceTextures.acquire).not.toHaveBeenCalled();
    box.roll([{ type: 'd6', value: 6, appearance: look }]);
    expect(faceTextures.acquire).toHaveBeenCalledTimes(1);
    box.clear();
  });

  test('a ghost never shows them', () => {
    const faceTextures = ft();
    const { box } = setup({ faceTextures });
    box.roll([{ type: 'd6', value: 6, appearance: look, ghost: true }]);
    expect(faceTextures.acquire).not.toHaveBeenCalled();
    box.clear();
  });
});

describe('body images', () => {
  const look = { body: { type: 'opaque', color: '#ffffff' }, bodyImage: { src: 'worlds/w/galaxy.webp' } };
  const dieMeshes = (renderer) => dieGroups(renderer).map((g) => g.children[0]);

  test('the roll loads its body image through the chunk, swaps it onto the die, releases it when it ends', async () => {
    _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
    const x = await requestLookExtras();
    const texture = new THREE.Texture();
    const acquire = vi.spyOn(x.bodyImages, 'acquire').mockResolvedValue({ texture });
    const release = vi.spyOn(x.bodyImages, 'release').mockImplementation(() => {});
    try {
      const { renderer, physics, box } = setup();
      const r = box.roll([
        { type: 'd6', value: 3, appearance: look },
        { type: 'd8', value: 2, appearance: look },
        { type: 'd6', value: 1, appearance: look, ghost: true },
      ]);
      await flushMicrotasks();
      expect(acquire).toHaveBeenCalledTimes(1); // one url, the ghost never
      expect(acquire).toHaveBeenCalledWith('worlds/w/galaxy.webp');
      physics.flush();
      renderer.tick(16);
      const [d6, d8, ghost] = dieMeshes(renderer);
      expect(d6.material.defines.DICER_BODY_IMAGE).toBe('');
      expect(d8.material.userData.programKey).toMatch(/\|bi1$/);
      expect(ghost.material.defines.DICER_BODY_IMAGE).toBeUndefined();
      box.clear();
      await r.finished;
      expect(release).toHaveBeenCalledWith('worlds/w/galaxy.webp');
    } finally {
      acquire.mockRestore();
      release.mockRestore();
    }
  });

  test('an image that fails leaves the plain body', async () => {
    _setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'));
    const x = await requestLookExtras();
    const acquire = vi.spyOn(x.bodyImages, 'acquire').mockResolvedValue(null);
    const release = vi.spyOn(x.bodyImages, 'release').mockImplementation(() => {});
    try {
      const { renderer, physics, box } = setup();
      box.roll([{ type: 'd6', value: 3, appearance: look }]);
      await flushMicrotasks();
      physics.flush();
      renderer.tick(16);
      expect(dieMeshes(renderer)[0].material.defines.DICER_BODY_IMAGE).toBeUndefined();
      box.clear();
    } finally {
      acquire.mockRestore();
      release.mockRestore();
    }
  });
});

test("only a check's d20 may splat a pet: every other die, and a damage d20, is sent with splat: false", () => {
  expect(maySplat('d20')).toBe(true);
  expect(maySplat('d20', 'fire')).toBe(false);
  expect(maySplat('d6')).toBe(false);
  expect(maySplat('d100')).toBe(false);
});

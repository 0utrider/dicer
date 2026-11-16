import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DiceBox } from '../../src/throw/dice-box.js';
import { buildScene } from '../../src/render/scene.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { readTopFace, faceForValue } from '../../src/core/face-reader.js';
import {
  grabFor,
  releaseGrab,
  hitDie,
  overUi,
  HOLD_Y,
  MAX_TOSS_SPEED,
  TOSS_TIMEOUT_MS,
} from '../../src/grab/grab.js';
import { syncGrab, _setGrabImport } from '../../src/grab/grab-loader.js';
import * as handHelpers from '../../src/hand/chunk/overlay.js';

const atlas = {
  ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
  texture: new THREE.Texture(),
};
const appearance = { body: 'opaque', bodyColor: '#fff', fillColor: '#000', fillMetallic: false };
// 960 x 480 px at 48 px per die: halfWidth 10, halfDepth 5, the stage centre at (480, 240).
const rect = { left: 0, top: 0, width: 960, height: 480 };
const LINGER = 2000;

/** Two 30-step chunks: die d rolls in from x = -30 to (0, 0.5, 1.5 d), identity rotation. */
function rollChunks(n) {
  return [0, 1].map((c) => {
    const data = new Float32Array(30 * 7 * n);
    for (let s = 0; s < 30; s++) {
      const x = -30 + (30 * (c * 30 + s)) / 59;
      for (let d = 0; d < n; d++) data.set([x, 0.5, d * 1.5, 0, 0, 0, 1], (s * n + d) * 7);
    }
    return { index: c, steps: 30, data, done: c === 1, events: new Float32Array(0) };
  });
}

/**
 * A toss's two chunks for `n` dice: die 0 flies from its launch pose to (3, 0.5, 0), tipped a
 * quarter turn about x (another face down); the others lie still at their launch poses. One floor
 * impact of die 0 at step 10.
 */
function tossChunks(req) {
  const n = req.dice.length;
  const end = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const start = new THREE.Quaternion(...req.launch[0].quat);
  const p0 = req.launch[0].pos;
  return [0, 1].map((c) => {
    const data = new Float32Array(30 * 7 * n);
    for (let s = 0; s < 30; s++) {
      const u = Math.min(1, (c * 30 + s) / 40);
      const q = start.clone().slerp(end, u);
      data.set([p0[0] + (3 - p0[0]) * u, p0[1] + (0.5 - p0[1]) * u, p0[2] * (1 - u), q.x, q.y, q.z, q.w], s * n * 7);
      for (let d = 1; d < n; d++) data.set([...req.launch[d].pos, ...req.launch[d].quat], (s * n + d) * 7);
    }
    const events = c === 0 ? new Float32Array([10, 0, -1, 5]) : new Float32Array(0);
    return { index: c, steps: 30, data, done: c === 1, events };
  });
}

function fakePhysics() {
  const streams = [];
  return {
    streams,
    resize: vi.fn(),
    recycle: vi.fn(),
    throw(req) {
      const s = { req, cb: null };
      s.done = new Promise((resolve, reject) => ((s.resolve = resolve), (s.reject = reject)));
      s.done.catch(() => {});
      streams.push(s);
      return { onChunk: (cb) => (s.cb = cb), done: s.done };
    },
    /** Emits `chunks` on stream i and resolves it. */
    emit(i, chunks) {
      const s = streams[i];
      for (const c of chunks) s.cb(c);
      s.resolve({ settledStep: 59, nudges: s.req.dice.map(() => 0) });
    },
  };
}

function fakeRenderer() {
  const sceneApi = buildScene();
  const r = {
    sceneApi,
    scene: sceneApi.scene,
    camera: sceneApi.camera,
    canvas: { style: {} },
    setArea: vi.fn(),
    onContextLost: vi.fn(),
    onContextRestored: vi.fn(),
    requestFrame: vi.fn(),
    startLoop: vi.fn((t) => (r.tickFn = t)),
    hide: vi.fn(() => (r.tickFn = null)),
    tickFn: null,
    tick(ms) {
      if (!r.tickFn) return false;
      const again = r.tickFn(ms);
      if (!again) r.hide();
      return again;
    },
  };
  return r;
}

/** A window that records listeners and dispatches to them (capture flags ignored). */
function fakeWin() {
  const map = new Map();
  return {
    map,
    document: { body: { style: {} } },
    addEventListener: vi.fn((type, fn) => {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
    }),
    removeEventListener: vi.fn((type, fn) => map.get(type)?.delete(fn)),
    count: () => [...map.values()].reduce((n, s) => n + s.size, 0),
    fire(type, init = {}) {
      const e = {
        type,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        pointerId: 1,
        pointerType: 'mouse',
        target: { closest: () => null },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...init,
      };
      for (const fn of [...(map.get(type) ?? [])]) fn(e);
      return e;
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

let clock = 0;

/** A DiceBox with a landed, lingering 2d6 (3 and 5) and grab and toss on a fake window. */
async function landed(opts = {}) {
  const renderer = fakeRenderer();
  const physics = fakePhysics();
  const onLandedFx = vi.fn();
  const onImpact = vi.fn();
  const box = new DiceBox({
    renderer,
    physics,
    atlas,
    appearance,
    getArea: () => rect,
    diceScale: () => 1,
    timeBeforeHide: () => LINGER,
    onLandedFx,
    onImpact,
  });
  const result = box.roll([
    { type: 'd6', value: 3, fx: [{ sound: 'chime' }] },
    { type: 'd6', value: 5 },
  ]);
  physics.emit(0, rollChunks(2));
  renderer.tick((clock += 16));
  renderer.tick((clock += 2000));
  await flush();
  const roll = result.handle;
  expect(roll.phase).toBe('lingering');
  const win = fakeWin();
  const grab = grabFor(box, {
    win,
    now: () => clock,
    random: () => 0.5,
    reducedMotion: () => opts.reduced === true,
    hand: () => Promise.resolve(handHelpers),
  });
  return { renderer, physics, box, roll, result, win, grab, onLandedFx, onImpact };
}

/** The client px where die `d` (at rest, y 0.5) is drawn. */
function pxOf(box, die) {
  const h = box._renderer.camera.position.y;
  const p = die.outer.position;
  const s = h / (h - p.y);
  return { clientX: 480 + p.x * s * 48, clientY: 240 + p.z * s * 48 };
}

/** The face a die shows up: its outer rotation, then its inner one. */
const shownFace = (die) =>
  readTopFace(die.shape, die.outer.quaternion.clone().multiply(die.inner.quaternion));

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
});
afterEach(() => {
  releaseGrab();
  vi.useRealTimers();
});

describe('hit-testing', () => {
  test('a lingering die under the pointer is hit, nearest first; empty table and fading rolls are not', async () => {
    const { box, roll } = await landed();
    const [a, b] = roll.dice;
    expect(hitDie(box, pxOf(box, a).clientX, pxOf(box, a).clientY)?.die).toBe(a);
    expect(hitDie(box, pxOf(box, b).clientX, pxOf(box, b).clientY)?.die).toBe(b);
    expect(hitDie(box, pxOf(box, b).clientX + 40, pxOf(box, b).clientY)?.die).toBe(b); // within a radius
    expect(hitDie(box, 100, 100)).toBeNull();
    expect(hitDie(box, -50, 240)).toBeNull(); // off the stage
    roll.phase = 'fading';
    expect(hitDie(box, pxOf(box, a).clientX, pxOf(box, a).clientY)).toBeNull();
  });

  test("Foundry's UI is never the table", () => {
    expect(overUi({ closest: (sel) => (sel.includes('#sidebar') ? {} : null) })).toBe(true);
    expect(overUi({ closest: () => null })).toBe(false);
    expect(overUi(null)).toBe(false);
  });

  test('a press off the dice or over the UI is left alone (Foundry sees it)', async () => {
    const { win, grab } = await landed();
    const off = win.fire('pointerdown', { clientX: 100, clientY: 100 });
    expect(off.stopPropagation).not.toHaveBeenCalled();
    const ui = win.fire('pointerdown', { clientX: 480, clientY: 240, target: { closest: () => ({}) } });
    expect(ui.stopPropagation).not.toHaveBeenCalled();
    expect(grab.holding).toBe(false);
  });
});

describe('holding and tossing', () => {
  test('holding a die pauses the hide timer; it restarts once the toss settles', async () => {
    const { renderer, physics, box, roll, result, win, grab } = await landed();
    let finished = false;
    result.finished.then(() => (finished = true));
    const die = roll.dice[0];
    const down = win.fire('pointerdown', pxOf(box, die));
    expect(down.preventDefault).toHaveBeenCalled();
    expect(down.stopPropagation).toHaveBeenCalled();
    expect(grab.holding).toBe(true);
    expect(win.document.body.style.cursor).toBe('grabbing');
    // Long past timeBeforeHide: the roll still lingers while the die is held.
    vi.advanceTimersByTime(LINGER * 3);
    renderer.tick((clock += 500));
    expect(roll.phase).toBe('lingering');
    expect(die.outer.position.y).toBeCloseTo(HOLD_Y, 5);
    // Drag right, then let go: a toss of both dice, the held one first.
    win.fire('pointermove', { clientX: 520, clientY: 240 });
    clock += 30;
    win.fire('pointermove', { clientX: 600, clientY: 240 });
    clock += 30;
    win.fire('pointerup', { clientX: 680, clientY: 240 });
    expect(grab.holding).toBe(false);
    expect(win.document.body.style.cursor).toBe('');
    await flush();
    expect(physics.streams).toHaveLength(2);
    const req = physics.streams[1].req;
    expect(req.dice).toHaveLength(2);
    expect(req.launch[0].rest).toBeUndefined();
    expect(req.launch[0].linvel[0]).toBeGreaterThan(0); // flung right
    expect(Math.hypot(req.launch[0].linvel[0], req.launch[0].linvel[2])).toBeLessThanOrEqual(
      MAX_TOSS_SPEED + 1e-6,
    );
    expect(req.launch[1]).toMatchObject({ rest: true, linvel: [0, 0, 0], angvel: [0, 0, 0] });
    expect(req.launch[1].pos[2]).toBeCloseTo(1.5, 5);
    physics.emit(1, tossChunks(req));
    await flush();
    vi.advanceTimersByTime(LINGER * 3); // still tossing: no fade
    expect(roll.phase).toBe('lingering');
    for (let i = 0; i < 20 && grab.tossing; i++) renderer.tick((clock += 100));
    expect(grab.tossing).toBe(false);
    expect(die.outer.position.x).toBeCloseTo(3, 4);
    // The hide timer restarted at the settle: a full timeBeforeHide from now.
    vi.advanceTimersByTime(LINGER - 10);
    expect(roll.phase).toBe('lingering');
    vi.advanceTimersByTime(20);
    expect(roll.phase).toBe('fading');
    renderer.tick((clock += 16));
    renderer.tick((clock += 500));
    await flush();
    expect(finished).toBe(true);
    expect(physics.recycle).toHaveBeenCalled(); // the toss's buffers go back to the worker
  });

  test('a toss never changes the result: values, value fields and the face shown stay; no result, fx or chat again', async () => {
    const { renderer, physics, box, roll, result, win, grab, onLandedFx, onImpact } = await landed();
    const values = await result.values;
    const die = roll.dice[0];
    const fields = roll.dice.map((d) => ({
      value: d.value,
      targetValue: d.targetValue,
      readValue: d.readValue,
      fx: d.fx,
      ghost: d.ghost,
    }));
    const faces = roll.dice.map(shownFace);
    expect(faces[0]).toBe(faceForValue(die.shape, 3));
    const fxCalls = onLandedFx.mock.calls.length;
    expect(fxCalls).toBe(1);
    win.fire('pointerdown', pxOf(box, die));
    clock += 20;
    win.fire('pointermove', { clientX: 560, clientY: 260 });
    clock += 20;
    win.fire('pointerup', { clientX: 640, clientY: 280 });
    await flush();
    physics.emit(1, tossChunks(physics.streams[1].req));
    await flush();
    for (let i = 0; i < 20 && grab.tossing; i++) renderer.tick((clock += 100));
    expect(grab.tossing).toBe(false);
    // Another face is down now (a quarter turn), yet the same number shows up.
    expect(readTopFace(die.shape, die.outer.quaternion)).not.toBe(
      readTopFace(die.shape, new THREE.Quaternion()),
    );
    expect(roll.dice.map(shownFace)).toEqual(faces);
    expect(
      roll.dice.map((d) => ({
        value: d.value,
        targetValue: d.targetValue,
        readValue: d.readValue,
        fx: d.fx,
        ghost: d.ghost,
      })),
    ).toEqual(fields);
    expect(await result.values).toEqual(values);
    expect(onLandedFx).toHaveBeenCalledTimes(fxCalls); // no result sound or macro again
    // The toss's floor impact still clicks.
    expect(onImpact).toHaveBeenCalledWith(expect.objectContaining({ other: -1, speed: 5 }));
  });

  test('a release with no movement drops the die (no flick); reduced motion caps the flick lower', async () => {
    const a = await landed();
    a.win.fire('pointerdown', pxOf(a.box, a.roll.dice[0]));
    clock += 400;
    a.win.fire('pointerup', pxOf(a.box, a.roll.dice[0]));
    await flush();
    expect(a.physics.streams[1].req.launch[0]).toMatchObject({ linvel: [0, 0, 0], angvel: [0, 0, 0] });
    releaseGrab();

    const b = await landed({ reduced: true });
    b.win.fire('pointerdown', pxOf(b.box, b.roll.dice[0]));
    clock += 10;
    b.win.fire('pointermove', { clientX: 700, clientY: 240 });
    clock += 10;
    b.win.fire('pointerup', { clientX: 900, clientY: 240 });
    await flush();
    const v = b.physics.streams[1].req.launch[0].linvel;
    expect(Math.hypot(v[0], v[2])).toBeLessThanOrEqual(10 + 1e-6);
  });

  test('a toss whose physics never answers puts the die back and lets the roll fade', async () => {
    const { physics, box, roll, win } = await landed();
    const die = roll.dice[0];
    const from = die.outer.position.clone();
    win.fire('pointerdown', pxOf(box, die));
    win.fire('pointerup', pxOf(box, die));
    await flush();
    expect(physics.streams).toHaveLength(2);
    vi.advanceTimersByTime(TOSS_TIMEOUT_MS + 1);
    expect(die.outer.position.distanceTo(from)).toBeLessThan(1e-6);
    vi.advanceTimersByTime(LINGER + 1);
    expect(roll.phase).toBe('fading');
  });

  test('a roll cleared while its die is held lets go', async () => {
    const { renderer, box, roll, win, grab } = await landed();
    win.fire('pointerdown', pxOf(box, roll.dice[0]));
    box.clear();
    box.wake();
    renderer.tick((clock += 16));
    expect(grab.holding).toBe(false);
    expect(win.document.body.style.cursor).toBe('');
  });
});

describe('the grabDice setting', () => {
  test('off: the chunk is never imported and no listener exists; on, then off again, removes it', async () => {
    const win = fakeWin();
    const prev = globalThis.window;
    globalThis.window = win;
    try {
      const real = await import('../../src/grab/grab.js');
      const load = vi.fn(() => Promise.resolve(real));
      _setGrabImport(load);
      const box = { grab: null, _rolls: new Set(), wake: vi.fn() };
      await syncGrab(box, false);
      expect(load).not.toHaveBeenCalled();
      expect(win.count()).toBe(0);
      await syncGrab(box, true);
      expect(load).toHaveBeenCalledTimes(1);
      expect(win.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function), {
        capture: true,
      });
      expect(box.grab).toBeTruthy();
      await syncGrab(box, false);
      expect(win.count()).toBe(0);
      expect(box.grab).toBeNull();
      await syncGrab(box, true);
      expect(load).toHaveBeenCalledTimes(1); // imported once
      expect(win.count()).toBe(1);
      await syncGrab(null, false);
      expect(win.count()).toBe(0);
    } finally {
      globalThis.window = prev;
      _setGrabImport(() => import('../../src/grab/grab.js'));
    }
  });

  test('a failed import warns once and leaves no listener', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    _setGrabImport(() => Promise.reject(new Error('offline')));
    await syncGrab({ _rolls: new Set() }, true);
    await syncGrab({ _rolls: new Set() }, true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    _setGrabImport(() => import('../../src/grab/grab.js'));
  });
});

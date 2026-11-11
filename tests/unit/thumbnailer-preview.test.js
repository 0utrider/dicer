import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { buildScene } from '../../src/render/scene.js';
import { createThumbnailer } from '../../src/themes/thumbnailer.js';
import { createTurntable, TURN_SECONDS } from '../../src/themes/turntable.js';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';

const atlas = {
  ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
  texture: new THREE.Texture(),
};
class FakePMREM {
  fromScene() {
    return { texture: new THREE.Texture(), dispose() {} };
  }
  dispose() {}
}
const createScene = () => buildScene({ PMREMGenerator: FakePMREM });
const theme = (i = 0) => BUILTIN_THEMES[i];

function rig() {
  const listeners = {};
  const canvas = {
    addEventListener: (t, f) => (listeners[t] = f),
    removeEventListener: vi.fn(),
    toBlob: (cb) => cb({}),
  };
  const poses = [];
  const dice = [];
  const sizes = [];
  const renderer = {
    domElement: canvas,
    toneMapping: 0,
    setPixelRatio: vi.fn(),
    setSize: vi.fn((w) => sizes.push(w)),
    setClearColor: vi.fn(),
    render: vi.fn((scene) => {
      const m = scene.children.find((c) => c.isMesh && c.material.userData?.uniforms);
      poses.push(m ? m.quaternion.toArray() : null);
      dice.push(scene.children.filter((c) => c.isMesh && c.visible && c.material.userData?.uniforms).length);
    }),
    dispose: vi.fn(),
  };
  return { canvas, renderer, listeners, poses, dice, sizes };
}

function target(size = 100) {
  const ctx = { clearRect: vi.fn(), drawImage: vi.fn() };
  const handlers = {};
  return {
    width: size,
    height: size,
    ctx,
    handlers,
    getContext: () => ctx,
    addEventListener: (t, f) => (handlers[t] = f),
    removeEventListener: vi.fn((t) => delete handlers[t]),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };
}

function setup({ reduced = false } = {}) {
  const r = rig();
  let id = 0;
  const pending = new Map();
  const raf = vi.fn((cb) => (pending.set(++id, cb), id));
  const caf = vi.fn((i) => pending.delete(i));
  const docHandlers = {};
  const doc = {
    visibilityState: 'visible',
    addEventListener: (t, f) => (docHandlers[t] = f),
    removeEventListener: vi.fn((t) => delete docHandlers[t]),
  };
  const warn = vi.fn();
  const t = createThumbnailer({
    atlas,
    createRenderer: () => r.renderer,
    idle: (cb) => setTimeout(cb, 0),
    warn,
    createScene,
    raf,
    caf,
    doc,
    reducedMotion: () => reduced,
  });
  let now = 0;
  const step = (ms = 100) => {
    now += ms;
    const cbs = [...pending.entries()];
    pending.clear();
    for (const [, cb] of cbs) cb(now);
  };
  return { t, r, raf, caf, doc, docHandlers, pending, step, warn };
}

const disposeSpies = () => ({
  mat: vi.spyOn(THREE.MeshPhysicalMaterial.prototype, 'dispose'),
  geo: vi.spyOn(THREE.BufferGeometry.prototype, 'dispose'),
});

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

test('the preview draws a first frame at once, then a loop with a changing rotation', () => {
  const s = setup();
  const c = target();
  const p = s.t.preview(c, theme(), 'd20');
  expect(p.active).toBe(true);
  expect(s.r.renderer.render).toHaveBeenCalledTimes(1);
  expect(c.ctx.drawImage).toHaveBeenCalledWith(s.r.canvas, 0, 0, 100, 100);
  expect(s.r.sizes.at(-1)).toBe(100);
  s.step(16);
  s.step(500);
  s.step(500);
  expect(s.r.renderer.render).toHaveBeenCalledTimes(4);
  expect(s.r.poses[1]).not.toEqual(s.r.poses[2]);
  expect(s.r.poses[2]).not.toEqual(s.r.poses[3]);
  p.stop();
  s.t.dispose();
});

test('the preview mesh is in the scene only during its frame', () => {
  const s = setup();
  s.t.preview(target(), theme());
  s.step();
  const scene = s.r.renderer.render.mock.calls[0][0];
  expect(scene.children.some((c) => c.isMesh && c.material.userData?.uniforms)).toBe(false);
  s.t.dispose();
});

test('stop() cancels the frame request, removes listeners and disposes material and geometry', () => {
  const s = setup();
  const { mat, geo } = disposeSpies();
  const c = target();
  const p = s.t.preview(c, theme());
  expect(s.pending.size).toBe(1);
  mat.mockClear();
  geo.mockClear();
  p.stop();
  expect(s.caf).toHaveBeenCalled();
  expect(s.pending.size).toBe(0);
  expect(mat).toHaveBeenCalledTimes(1);
  expect(geo).toHaveBeenCalled();
  expect(Object.keys(c.handlers)).toEqual([]);
  expect(s.doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  expect(p.active).toBe(false);
  p.stop(); // idempotent
  s.t.dispose();
});

test('a selection change (stop old, start new) disposes the old theme resources', () => {
  const s = setup();
  const { mat } = disposeSpies();
  const a = s.t.preview(target(), theme(0));
  mat.mockClear();
  a.stop();
  expect(mat).toHaveBeenCalledTimes(1);
  const b = s.t.preview(target(), theme(1));
  expect(s.r.renderer.render).toHaveBeenCalledTimes(2);
  expect(s.pending.size).toBe(1);
  b.stop();
  s.t.dispose();
});

test('a hidden document pauses the loop and a visible one resumes it', () => {
  const s = setup();
  s.t.preview(target(), theme());
  s.doc.visibilityState = 'hidden';
  s.docHandlers.visibilitychange();
  expect(s.pending.size).toBe(0);
  const n = s.r.renderer.render.mock.calls.length;
  s.step();
  expect(s.r.renderer.render).toHaveBeenCalledTimes(n);
  s.doc.visibilityState = 'visible';
  s.docHandlers.visibilitychange();
  expect(s.pending.size).toBe(1);
  s.step();
  expect(s.r.renderer.render.mock.calls.length).toBe(n + 1);
  s.t.dispose();
});

test('a preview started on a hidden document draws nothing until it is shown', () => {
  const s = setup();
  s.doc.visibilityState = 'hidden';
  s.t.preview(target(), theme());
  expect(s.r.renderer.render).not.toHaveBeenCalled();
  expect(s.raf).not.toHaveBeenCalled();
  s.t.dispose();
});

test('reduced motion renders one still frame and requests no animation frames', () => {
  const s = setup({ reduced: true });
  const p = s.t.preview(target(), theme());
  expect(s.r.renderer.render).toHaveBeenCalledTimes(1);
  expect(s.raf).not.toHaveBeenCalled();
  p.setRotation({ yaw: 1 });
  expect(s.r.renderer.render).toHaveBeenCalledTimes(2);
  expect(s.r.poses[1]).not.toEqual(s.r.poses[0]);
  s.t.dispose();
});

test('dragging turns the die and releasing returns to the slow loop; double-click resets', () => {
  const s = setup();
  const c = target();
  s.t.preview(c, theme());
  s.step(16);
  const before = s.r.renderer.render.mock.calls.length;
  c.handlers.pointerdown({ button: 0, pointerId: 1, timeStamp: 0 });
  c.handlers.pointermove({ pointerId: 1, movementX: 40, movementY: 0, timeStamp: 16 });
  expect(s.r.renderer.render.mock.calls.length).toBe(before); // the running loop draws it
  s.step(16);
  const spun = s.r.poses.at(-1);
  c.handlers.pointermove({ pointerId: 2, movementX: 500, movementY: 0, timeStamp: 32 }); // another pointer: ignored
  c.handlers.pointerup({ pointerId: 1 });
  expect(c.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(s.pending.size).toBe(1);
  c.handlers.dblclick();
  s.step(16);
  expect(s.r.poses.at(-1)).not.toEqual(spun);
  s.t.dispose();
});

test('with reduced motion a drag still redraws', () => {
  const s = setup({ reduced: true });
  const c = target();
  s.t.preview(c, theme());
  c.handlers.pointerdown({ button: 0, pointerId: 1, timeStamp: 0 });
  c.handlers.pointermove({ pointerId: 1, movementX: 30, movementY: 10, timeStamp: 16 });
  expect(s.r.renderer.render).toHaveBeenCalledTimes(2);
  c.handlers.pointerup({ pointerId: 1 });
  expect(s.raf).not.toHaveBeenCalled();
  s.t.dispose();
});

test('thumbnails still resolve while a preview runs, at their own size', async () => {
  const s = setup();
  s.t.preview(target(120), theme(0));
  const url = await s.t.thumbnail(theme(1), 'd20');
  expect(url).toBe('blob:x');
  expect(s.r.sizes.at(-1)).toBe(256);
  expect(s.r.dice.at(-1)).toBe(1); // one die in the thumbnail: the preview die is not in the scene
  s.step(); // the next preview frame goes back to its own size
  expect(s.r.sizes.at(-1)).toBe(120);
  s.t.dispose();
});

test('a preview frame never runs while a thumbnail capture is pending', async () => {
  const s = setup();
  let release;
  s.r.canvas.toBlob = (cb) => (release = () => cb({}));
  s.t.preview(target(), theme(0));
  const p = s.t.thumbnail(theme(1), 'd20');
  while (!release) await new Promise((r) => setTimeout(r, 0));
  const n = s.r.renderer.render.mock.calls.length;
  s.step();
  expect(s.r.renderer.render.mock.calls.length).toBe(n);
  release();
  await p;
  s.step();
  expect(s.r.renderer.render.mock.calls.length).toBe(n + 1);
  s.t.dispose();
});

test('context loss stops the preview without throwing and reports it', () => {
  const s = setup();
  const onLost = vi.fn();
  const p = s.t.preview(target(), theme(), 'd20', { onLost });
  expect(() => s.r.listeners.webglcontextlost({ preventDefault() {} })).not.toThrow();
  expect(onLost).toHaveBeenCalledTimes(1);
  expect(p.active).toBe(false);
  expect(s.pending.size).toBe(0);
  expect(s.t.preview(target(), theme())).toBeNull();
});

test('a render error ends the preview with one warning and onLost', () => {
  const s = setup();
  s.r.renderer.render.mockImplementation(() => {
    throw new Error('boom');
  });
  const onLost = vi.fn();
  const p = s.t.preview(target(), theme(), 'd20', { onLost });
  expect(p.active).toBe(false);
  expect(onLost).toHaveBeenCalledTimes(1);
  expect(s.warn).toHaveBeenCalledTimes(1);
  s.t.dispose();
});

test('dispose of the thumbnailer stops its previews; later previews are refused', () => {
  const s = setup();
  const p = s.t.preview(target(), theme());
  s.t.dispose();
  expect(p.active).toBe(false);
  expect(s.pending.size).toBe(0);
  expect(s.t.preview(target(), theme())).toBeNull();
});

describe('turntable', () => {
  const turns = (t, secs) => {
    let pose;
    for (let i = 0; i < secs * 60; i++) pose = t.update(1 / 60);
    return pose;
  };
  test('one slow turn takes about TURN_SECONDS, tilted', () => {
    const t = createTurntable();
    const pose = turns(t, TURN_SECONDS);
    expect(pose.yaw).toBeCloseTo(2 * Math.PI, 1);
    expect(pose.tilt).toBeGreaterThan(0);
  });
  test('a fling decays back to the slow turn and pitch eases to level', () => {
    const t = createTurntable();
    t.grab();
    t.drag(60, 40, 0.016);
    t.release();
    expect(t.pose().pitch).toBeGreaterThan(0.3);
    turns(t, 6);
    expect(Math.abs(t.pose().pitch)).toBeLessThan(0.01);
    const a = t.pose().yaw;
    turns(t, 1);
    expect(t.pose().yaw - a).toBeCloseTo((2 * Math.PI) / TURN_SECONDS, 1);
  });
  test('reduced motion does not turn by itself and drag has no fling', () => {
    const t = createTurntable({ reducedMotion: true });
    expect(turns(t, 2).yaw).toBe(0);
    t.grab();
    t.drag(50, 0, 0.016);
    t.release();
    const y = t.pose().yaw;
    expect(turns(t, 1).yaw).toBe(y);
  });
});

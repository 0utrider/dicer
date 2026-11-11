import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { buildScene } from '../../src/render/scene.js';
import { createThumbnailer } from '../../src/themes/thumbnailer.js';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';
import { LOOKS } from '../../src/look/looks.js';

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

function fakeRig({ blobKind = 'toBlob' } = {}) {
  const listeners = {};
  const canvas = {
    addEventListener: (t, f) => (listeners[t] = f),
    removeEventListener: vi.fn(),
  };
  const blobs = [];
  const make = () => {
    const b = { id: blobs.length };
    blobs.push(b);
    return b;
  };
  if (blobKind === 'toBlob') canvas.toBlob = (cb) => cb(make());
  else canvas.convertToBlob = async () => make();
  const renders = [];
  const renderer = {
    domElement: canvas,
    toneMapping: 0,
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setClearColor: vi.fn(),
    render: vi.fn((scene) => renders.push(scene.children.filter((c) => c.isMesh && c.visible && c.material.userData?.uniforms).length)),
    dispose: vi.fn(),
  };
  return { canvas, renderer, renders, listeners, blobs };
}

let urlN;
const idle = (cb) => setTimeout(cb, 0);
function make(over = {}) {
  const rig = over.rig ?? fakeRig();
  const warn = vi.fn();
  const createRenderer = over.createRenderer ?? vi.fn(() => rig.renderer);
  const t = createThumbnailer({ atlas, createRenderer, idle, warn, createScene, ...over.opts });
  return { t, rig, warn, createRenderer };
}
const theme = (i = 0) => BUILTIN_THEMES[i];

beforeEach(() => {
  urlN = 0;
  globalThis.URL.createObjectURL = vi.fn(() => `blob:t${++urlN}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});

test('renders a die once and returns an object URL', async () => {
  const { t, rig } = make();
  const url = await t.thumbnail(theme(), 'd20');
  expect(url).toBe('blob:t1');
  expect(rig.renderer.render).toHaveBeenCalledTimes(1);
  expect(rig.renders[0]).toBe(1); // exactly one die visible
  t.dispose();
});

test('works with convertToBlob too', async () => {
  const { t } = make({ rig: fakeRig({ blobKind: 'convertToBlob' }) });
  expect(await t.thumbnail(theme(), 'd6')).toBe('blob:t1');
  t.dispose();
});

test('a repeat request is a cache hit and renders nothing', async () => {
  const { t, rig } = make();
  const a = await t.thumbnail(theme(), 'd20');
  const b = await t.thumbnail(theme(), 'd20');
  expect(b).toBe(a);
  expect(rig.renderer.render).toHaveBeenCalledTimes(1);
  t.dispose();
});

test('cache key is appearance, die type and size: a different type renders again', async () => {
  const { t, rig } = make();
  await t.thumbnail(theme(), 'd20');
  await t.thumbnail(theme(), 'd6');
  expect(rig.renderer.render).toHaveBeenCalledTimes(2);
  t.dispose();
});

test('themes with equal appearances share a thumbnail; perType overrides the appearance', async () => {
  const { t, rig } = make();
  const a = { ...theme(), id: 'a', perType: {} };
  const b = { ...theme(), id: 'b', perType: {} };
  const c = { ...theme(), id: 'c', perType: { d20: LOOKS['dwarven-brass'].appearance } };
  const ua = await t.thumbnail(a, 'd20');
  expect(await t.thumbnail(b, 'd20')).toBe(ua);
  expect(rig.renderer.render).toHaveBeenCalledTimes(1);
  await t.thumbnail(c, 'd20');
  expect(rig.renderer.render).toHaveBeenCalledTimes(2);
  t.dispose();
});

test('two concurrent requests render sequentially, each in its own idle slice', async () => {
  const slices = [];
  const events = [];
  const rig = fakeRig();
  rig.renderer.render = vi.fn(() => events.push('render'));
  const { t } = make({
    rig,
    opts: {
      idle: (cb) => {
        events.push('idle');
        slices.push(cb);
      },
    },
  });
  const p1 = t.thumbnail(theme(0), 'd20');
  const p2 = t.thumbnail(theme(1), 'd20');
  await Promise.resolve();
  expect(events).toEqual(['idle']); // only the first is scheduled
  slices.shift()();
  expect(await p1).toBe('blob:t1');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(events).toEqual(['idle', 'render', 'idle']);
  slices.shift()();
  expect(await p2).toBe('blob:t2');
  t.dispose();
});

test('concurrent requests for the same key share one render', async () => {
  const { t, rig } = make();
  const [a, b] = await Promise.all([t.thumbnail(theme(), 'd20'), t.thumbnail(theme(), 'd20')]);
  expect(a).toBe(b);
  expect(rig.renderer.render).toHaveBeenCalledTimes(1);
  t.dispose();
});

test('materials and geometry are disposed after each render', async () => {
  const mat = vi.spyOn(THREE.MeshPhysicalMaterial.prototype, 'dispose');
  const geo = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
  const { t } = make();
  await t.thumbnail(theme(), 'd20');
  expect(mat).toHaveBeenCalled();
  expect(geo).toHaveBeenCalled();
  mat.mockRestore();
  geo.mockRestore();
  t.dispose();
});

test('dispose revokes every URL and disposes the renderer; later calls resolve null', async () => {
  const { t, rig } = make();
  await t.thumbnail(theme(0), 'd20');
  await t.thumbnail(theme(1), 'd20');
  t.dispose();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:t1');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:t2');
  expect(rig.renderer.dispose).toHaveBeenCalledTimes(1);
  expect(await t.thumbnail(theme(), 'd20')).toBeNull();
});

test('dispose with queued work resolves it null', async () => {
  const { t } = make();
  const p = t.thumbnail(theme(), 'd20');
  t.dispose();
  expect(await p).toBeNull();
});

test('a throwing createRenderer resolves null with one warning and never retries', async () => {
  const createRenderer = vi.fn(() => {
    throw new Error('no webgl');
  });
  const { t, warn } = make({ createRenderer });
  expect(await t.thumbnail(theme(0), 'd20')).toBeNull();
  expect(await t.thumbnail(theme(1), 'd6')).toBeNull();
  expect(createRenderer).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('context loss resolves null with one warning and never retries', async () => {
  const { t, rig, warn, createRenderer } = make();
  expect(await t.thumbnail(theme(0), 'd20')).toBe('blob:t1');
  const ev = { preventDefault: vi.fn() };
  rig.listeners.webglcontextlost(ev);
  expect(ev.preventDefault).toHaveBeenCalled();
  expect(await t.thumbnail(theme(1), 'd20')).toBeNull();
  expect(await t.thumbnail(theme(2), 'd20')).toBeNull();
  expect(createRenderer).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
  t.dispose();
});

test('d100 draws as a d10', async () => {
  const { t, rig } = make();
  expect(await t.thumbnail(theme(), 'd100')).toBe('blob:t1');
  expect(rig.renderer.render).toHaveBeenCalledTimes(1);
  t.dispose();
});

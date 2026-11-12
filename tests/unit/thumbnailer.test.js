import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { buildScene } from '../../src/render/scene.js';
import { createThumbnailer } from '../../src/themes/thumbnailer.js';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';
import { LOOKS } from '../../src/look/looks.js';
import { buildDieGeometry } from '../../src/core/chamfer.js';
import { createDiceMaterial } from '../../src/render/dice-material.js';
import { createFontAtlases } from '../../src/fonts/font-atlas.js';
import { _setLookExtrasImport } from '../../src/render/extras-loader.js';

vi.mock('../../src/core/chamfer.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, buildDieGeometry: vi.fn(mod.buildDieGeometry) };
});
vi.mock('../../src/render/dice-material.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, createDiceMaterial: vi.fn(mod.createDiceMaterial) };
});

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

test('dispose while the blob is pending: null, no warn, everything still disposed', async () => {
  const mat = vi.spyOn(THREE.MeshPhysicalMaterial.prototype, 'dispose');
  const geo = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
  const labelTex = vi.spyOn(THREE.Texture.prototype, 'dispose');
  const rig = fakeRig({ blobKind: 'convertToBlob' });
  let release;
  rig.canvas.convertToBlob = () => new Promise((r) => (release = () => r({})));
  const { t, warn } = make({ rig });
  const p = t.thumbnail(theme(), 'd20');
  while (!release) await new Promise((r) => setTimeout(r, 0));
  t.dispose();
  release();
  expect(await p).toBeNull();
  expect(warn).not.toHaveBeenCalled();
  expect(mat).toHaveBeenCalledTimes(1);
  expect(geo).toHaveBeenCalled();
  expect(labelTex).toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  mat.mockRestore();
  geo.mockRestore();
  labelTex.mockRestore();
});

test('context loss releases the renderer immediately', async () => {
  const { t, rig } = make();
  await t.thumbnail(theme(0), 'd20');
  rig.listeners.webglcontextlost({ preventDefault() {} });
  expect(rig.renderer.dispose).toHaveBeenCalledTimes(1);
  t.dispose();
  expect(rig.renderer.dispose).toHaveBeenCalledTimes(1);
});
describe('geometry per edge step', () => {
  const withRadius = (radius) => ({
    ...theme(),
    appearance: { ...theme().appearance, edges: { radius } },
    perType: {},
  });
  const target = () => ({
    width: 64,
    height: 64,
    getContext: () => ({ clearRect() {}, drawImage() {} }),
    addEventListener() {},
    removeEventListener() {},
  });
  const previewOpts = (frames) => ({
    raf: (cb) => (frames.push(cb), frames.length),
    caf() {},
    reducedMotion: () => true,
    doc: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
  });
  const disposeSpy = () => vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
  // How many of the geometries buildDieGeometry made have been disposed so far.
  const freed = (geo) =>
    buildDieGeometry.mock.results.filter((r) => geo.mock.contexts.includes(r.value)).length;
  beforeEach(() => {
    buildDieGeometry.mockClear();
  });

  test('two previews of one type and step share a geometry, other steps get their own, the last stop frees it', () => {
    buildDieGeometry.mockClear();
    const geo = disposeSpy();
    const frames = [];
    const { t } = make({ opts: previewOpts(frames) });
    const a = t.preview(target(), withRadius(0.5), 'd20');
    const b = t.preview(target(), withRadius(0.6), 'd20'); // snaps to 0.5: same entry
    const c = t.preview(target(), withRadius(1), 'd20');
    for (const cb of frames.splice(0)) cb(0);
    expect(buildDieGeometry).toHaveBeenCalledTimes(2);
    a.stop();
    expect(freed(geo)).toBe(0); // b still holds it
    b.stop();
    expect(freed(geo)).toBe(1);
    c.stop();
    expect(freed(geo)).toBe(2);
    geo.mockRestore();
    t.dispose();
  });

  test('dispose frees every geometry still held', () => {
    const geo = disposeSpy();
    const frames = [];
    const { t } = make({ opts: previewOpts(frames) });
    t.preview(target(), withRadius(0), 'd6');
    t.preview(target(), withRadius(1), 'd6');
    for (const cb of frames.splice(0)) cb(0);
    expect(freed(geo)).toBe(0);
    t.dispose();
    expect(freed(geo)).toBe(2);
    geo.mockRestore();
  });

  test('a throwing createDiceMaterial in a thumbnail acquires no geometry', async () => {
    const geo = disposeSpy();
    createDiceMaterial.mockImplementationOnce(() => {
      throw new Error('shader');
    });
    const { t, warn } = make();
    expect(await t.thumbnail(withRadius(1), 'd20')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(buildDieGeometry).not.toHaveBeenCalled(); // acquired only after the material exists
    await t.thumbnail(withRadius(0.75), 'd20');
    expect(buildDieGeometry).toHaveBeenCalledTimes(1);
    expect(freed(geo)).toBe(1);
    geo.mockRestore();
    t.dispose();
  });

  test('a throwing createDiceMaterial in a preview leaves the cache empty, and a later preview works', () => {
    const geo = disposeSpy();
    createDiceMaterial.mockImplementationOnce(() => {
      throw new Error('shader');
    });
    const frames = [];
    const { t } = make({ opts: previewOpts(frames) });
    t.preview(target(), withRadius(1), 'd20');
    for (const cb of frames.splice(0)) cb(0);
    expect(buildDieGeometry).not.toHaveBeenCalled();
    const p = t.preview(target(), withRadius(1), 'd20');
    for (const cb of frames.splice(0)) cb(0);
    p?.stop();
    expect(buildDieGeometry).toHaveBeenCalledTimes(1);
    expect(freed(geo)).toBe(1); // built fresh and freed on stop
    geo.mockRestore();
    t.dispose();
  });

  test('a throw after the geometry is acquired gives it back (thumbnail and preview)', async () => {
    const geo = disposeSpy();
    const failing = () => {
      const api = createScene();
      api.shadowFor = () => {
        throw new Error('shadow');
      };
      return api;
    };
    const frames = [];
    const { t, warn } = make({ opts: { ...previewOpts(frames), createScene: failing } });
    expect(await t.thumbnail(withRadius(0.25), 'd4')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(buildDieGeometry).toHaveBeenCalledTimes(1);
    expect(freed(geo)).toBe(1);
    t.preview(target(), withRadius(0.25), 'd4');
    for (const cb of frames.splice(0)) cb(0);
    expect(buildDieGeometry).toHaveBeenCalledTimes(2);
    expect(freed(geo)).toBe(2); // the failed preview frame gave its geometry back too
    geo.mockRestore();
    t.dispose();
  });
});

describe('per-look fonts', () => {
  const fontAtlas = {
    ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits-sans.json', 'utf8'))),
    texture: new THREE.Texture(),
  };
  const withFont = (font) => ({ ...theme(), appearance: { ...theme().appearance, numbers: { ...theme().appearance.numbers, font } } });
  beforeEach(() => {
    createDiceMaterial.mockClear();
  });

  test('a thumbnail waits for its font and draws with that atlas', async () => {
    const fonts = { get: vi.fn(() => null), request: vi.fn(async () => fontAtlas) };
    const { t } = make({ opts: { fonts } });
    expect(await t.thumbnail(withFont('css:Comic Neue'), 'd20')).toBe('blob:t1');
    expect(fonts.request).toHaveBeenCalledWith('css:Comic Neue');
    expect(createDiceMaterial.mock.calls.at(-1)[1]).toBe(fontAtlas);
    t.dispose();
  });

  test('a font that cannot be used draws with the serif', async () => {
    const fonts = { get: vi.fn(() => null), request: vi.fn(async () => null) };
    const { t } = make({ opts: { fonts } });
    await t.thumbnail(withFont('css:Nope'), 'd6');
    expect(createDiceMaterial.mock.calls.at(-1)[1]).toBe(atlas);
    t.dispose();
  });
});

describe('per-look fonts: chain, cache and atlas holds', () => {
  const fontAtlas = {
    ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits-sans.json', 'utf8'))),
    texture: new THREE.Texture(),
  };
  const withFont = (font) => ({ ...theme(), appearance: { ...theme().appearance, numbers: { ...theme().appearance.numbers, font } } });

  test('a slow font does not hold up the thumbnail chain', async () => {
    const fonts = { get: () => null, request: vi.fn(() => new Promise(() => {})), hold: () => () => {} };
    const { t, rig } = make({ opts: { fonts } });
    t.thumbnail(withFont('css:Slow'), 'd20');
    expect(await t.thumbnail(theme(1), 'd20')).toBe('blob:t1');
    expect(rig.renderer.render).toHaveBeenCalledTimes(1);
    t.dispose();
  });

  test('a thumbnail drawn with the serif standing in for its font is not cached', async () => {
    const fonts = { get: () => null, request: vi.fn(async () => null), hold: () => () => {} };
    const { t, rig } = make({ opts: { fonts } });
    const a = await t.thumbnail(withFont('css:Nope'), 'd20');
    const b = await t.thumbnail(withFont('css:Nope'), 'd20');
    expect(a).toBeTruthy();
    expect(b).not.toBe(a);
    expect(rig.renderer.render).toHaveBeenCalledTimes(2);
    t.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(a); // the loose URLs are freed too
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(b);
  });

  test('a font thumbnail is cached and holds its atlas only while it renders', async () => {
    const release = vi.fn();
    const fonts = { get: () => null, request: vi.fn(async () => fontAtlas), hold: vi.fn(() => release) };
    const { t, rig } = make({ opts: { fonts } });
    const a = await t.thumbnail(withFont('css:Comic Neue'), 'd20');
    expect(await t.thumbnail(withFont('css:Comic Neue'), 'd20')).toBe(a);
    expect(rig.renderer.render).toHaveBeenCalledTimes(1);
    expect(fonts.hold).toHaveBeenCalledWith(fontAtlas);
    expect(release).toHaveBeenCalledTimes(1);
    t.dispose();
  });
});

test('an atlas evicted and disposed while its thumbnail waits in the chain is disposed again after the render', async () => {
  const fontAtlas = parseAtlas(JSON.parse(readFileSync('assets/fonts/digits-sans.json', 'utf8')));
  const textures = {};
  const fonts = createFontAtlases({
    serif: atlas,
    loadBundled: async () => null,
    build: async (src) => ({ json: { family: src.family }, width: 1, height: 1, field: new Uint8Array(1) }),
    store: { get: async () => undefined, set: async () => {} },
    getRoute: (p) => `/${p}`,
    origin: 'https://vtt.example',
    toAtlas: (b) => (textures[b.json.family] = { ...fontAtlas, texture: new THREE.Texture() }),
    cacheSize: 1,
    warn: () => {},
  });
  const slices = [];
  const { t } = make({ opts: { fonts, idle: (cb) => slices.push(cb) } });
  const withFont = (font) => ({ ...theme(), appearance: { ...theme().appearance, numbers: { ...theme().appearance.numbers, font } } });
  const first = t.thumbnail(theme(1), 'd20'); // a pending render ahead in the chain
  const pa = t.thumbnail(withFont('css:A'), 'd20');
  await vi.waitFor(() => expect(textures.A).toBeTruthy());
  const disposeA = vi.spyOn(textures.A.texture, 'dispose');
  await fonts.request('css:B'); // evicts A while its thumbnail waits: unheld, so disposed now
  expect(disposeA).toHaveBeenCalledTimes(1);
  slices.shift()();
  await first;
  await vi.waitFor(() => expect(slices.length).toBe(1));
  slices.shift()(); // A's render: three re-uploads the disposed texture
  await pa;
  expect(createDiceMaterial.mock.calls.at(-1)[1].texture).toBe(textures.A.texture);
  expect(disposeA).toHaveBeenCalledTimes(2); // freed again once the render let go
  t.dispose();
  expect(disposeA).toHaveBeenCalledTimes(2);
});

describe('look extras chunk', () => {
  const extrasTheme = () => ({
    ...theme(),
    appearance: {
      ...theme().appearance,
      numbers: { ...theme().appearance.numbers, fill: 'holo', relief: 'raised' },
    },
  });
  const keyOf = (i) => createDiceMaterial.mock.results[i].value.userData.programKey;

  test('a thumbnail of a holo look waits for the chunk and is cached once it is drawn with it', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    _setLookExtrasImport(() => gate.then(() => import('../../src/render/extras/look-extras.js')));
    createDiceMaterial.mockClear();
    const { t, rig } = make();
    const p = t.thumbnail(extrasTheme(), 'd20');
    await new Promise((r) => setTimeout(r, 10));
    expect(rig.renderer.render).not.toHaveBeenCalled();
    release();
    const url = await p;
    expect(rig.renderer.render).toHaveBeenCalledTimes(1);
    expect(keyOf(0)).toContain('|n:holo+r');
    expect(await t.thumbnail(extrasTheme(), 'd20')).toBe(url);
    expect(rig.renderer.render).toHaveBeenCalledTimes(1);
    t.dispose();
  });

  test('a failed chunk draws the fallback thumbnail and does not cache it', async () => {
    _setLookExtrasImport(() => Promise.reject(new Error('offline')));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    createDiceMaterial.mockClear();
    const { t, rig } = make();
    const a = await t.thumbnail(extrasTheme(), 'd20');
    expect(a).toBe('blob:t1');
    expect(keyOf(0)).not.toContain('|n:');
    const b = await t.thumbnail(extrasTheme(), 'd20');
    expect(b).not.toBe(a);
    expect(rig.renderer.render).toHaveBeenCalledTimes(2);
    t.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(a);
    vi.restoreAllMocks();
  });
});

// @vitest-environment jsdom
import * as THREE from 'three';
import { DiceRenderer, configureRenderer } from '../../src/render/renderer.js';
import { buildScene } from '../../src/render/scene.js';
import { TIERS } from '../../src/render/quality.js';

function setup() {
  const frames = [];
  const raf = (cb) => (frames.push(cb), frames.length);
  const caf = vi.fn();
  const fake = { setSize: vi.fn(), setPixelRatio: vi.fn(), render: vi.fn(), dispose: vi.fn(), debug: {} };
  const createRenderer = vi.fn(() => fake);
  const container = document.createElement('div');
  const r = new DiceRenderer({ container, createRenderer, raf, caf });
  const step = () => frames.splice(0).forEach((cb) => cb(performance.now()));
  return { r, fake, createRenderer, container, frames, step, caf };
}

test('idle: canvas hidden, no frame pending', () => {
  const { r, container, frames } = setup();
  expect(container.querySelector('#dicer-canvas').style.display).toBe('none');
  expect(container.querySelectorAll('canvas').length).toBe(1);
  expect(frames.length).toBe(0);
  expect(r.isLooping).toBe(false);
});

test('loop runs while tick returns true, then leaves nothing pending', () => {
  const { r, fake, frames, step, container } = setup();
  let n = 3;
  r.startLoop(() => --n > 0);
  expect(container.querySelector('#dicer-canvas').style.display).not.toBe('none');
  step();
  step();
  step();
  expect(fake.render).toHaveBeenCalledTimes(3);
  expect(frames.length).toBe(0);
  expect(r.isLooping).toBe(false);
  expect(container.querySelector('#dicer-canvas').style.display).toBe('none');
});

test('startLoop while looping swaps the tick and schedules no second frame', () => {
  const { r, frames, step } = setup();
  const a = vi.fn(() => true);
  const b = vi.fn(() => false);
  r.startLoop(a);
  r.startLoop(b);
  expect(frames.length).toBe(1);
  step();
  expect(a).not.toHaveBeenCalled();
  expect(b).toHaveBeenCalledTimes(1);
  expect(frames.length).toBe(0);
  expect(r.isLooping).toBe(false);
});

test('resizing 10 times never recreates the renderer', () => {
  const { r, fake, createRenderer } = setup();
  for (let i = 0; i < 10; i++) r.setArea({ left: 0, top: 0, width: 800 + i, height: 600 });
  expect(createRenderer).toHaveBeenCalledTimes(1);
  expect(fake.setSize).toHaveBeenLastCalledWith(809, 600, false);
});

test('pixel ratio is capped at 1.5', () => {
  globalThis.devicePixelRatio = 3;
  const { r, fake } = setup();
  r.setArea({ left: 0, top: 0, width: 100, height: 100 });
  expect(fake.setPixelRatio).toHaveBeenLastCalledWith(1.5);
});

test('context loss stops the loop; restore notifies', () => {
  const { r, container, caf } = setup();
  const lost = vi.fn();
  const restored = vi.fn();
  r.onContextLost(lost);
  r.onContextRestored(restored);
  r.startLoop(() => true);
  const canvas = container.querySelector('#dicer-canvas');
  const ev = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(caf).toHaveBeenCalled();
  expect(lost).toHaveBeenCalled();
  expect(r.isLooping).toBe(false);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(restored).toHaveBeenCalled();
});

test('camera fit: the floor rectangle exactly fills the view', () => {
  const { camera, fitArea } = buildScene();
  fitArea({ halfWidth: 8, halfDepth: 5 });
  expect(camera.aspect).toBeCloseTo(8 / 5);
  for (const [x, z] of [
    [8, 5],
    [-8, 5],
    [8, -5],
    [-8, -5],
  ]) {
    const p = new THREE.Vector3(x, 0, z).project(camera);
    expect(Math.abs(p.x)).toBeCloseTo(1, 5);
    expect(Math.abs(p.y)).toBeCloseTo(1, 5);
  }
  expect(camera.position.y).toBeCloseTo(5 / Math.tan(THREE.MathUtils.degToRad(10)));
});

test('shadowFor reuses released planes', () => {
  const { scene, shadowFor, releaseShadow } = buildScene();
  const die = new THREE.Mesh();
  const a = shadowFor(die);
  const b = shadowFor(die);
  expect(a).not.toBe(b);
  expect(a.material).toBe(b.material);
  releaseShadow(a);
  expect(scene.children).not.toContain(a);
  const c = shadowFor(die);
  expect(c).toBe(a);
  expect(scene.children).toContain(c);
});

test('context restore resets the environment so the next startLoop rebuilds it', () => {
  const { r, fake, container, step } = setup();
  fake.isWebGLRenderer = true;
  const api = r.sceneApi;
  const setEnv = vi.spyOn(api, 'setEnvironment').mockImplementation(() => {});
  const reset = vi.spyOn(api, 'resetEnvironment');
  r.startLoop(() => false);
  step();
  expect(setEnv).toHaveBeenCalledTimes(1);
  container.querySelector('#dicer-canvas').dispatchEvent(new Event('webglcontextrestored'));
  expect(reset).toHaveBeenCalledTimes(1);
  r.startLoop(() => false);
  expect(setEnv).toHaveBeenCalledTimes(2);
});

test('resetEnvironment clears scene.environment and allows regeneration', () => {
  const { scene, resetEnvironment } = buildScene();
  scene.environment = new THREE.Texture();
  resetEnvironment();
  expect(scene.environment).toBeNull();
});

test('dispose clears environment and removes shadow planes', () => {
  const { r } = setup();
  const api = r.sceneApi;
  const a = api.shadowFor(new THREE.Mesh());
  const b = api.shadowFor(new THREE.Mesh());
  api.releaseShadow(b);
  r.scene.environment = new THREE.Texture();
  r.dispose();
  expect(r.scene.environment).toBeNull();
  expect(r.scene.children).not.toContain(a);
  expect(r.scene.children).not.toContain(b);
  expect(r.scene.children.filter((c) => c.userData && 'follow' in c.userData)).toEqual([]);
});

test('startLoop passes the default environment resolution to setEnvironment', () => {
  const { r, fake } = setup();
  fake.isWebGLRenderer = true;
  const setEnv = vi.spyOn(r.sceneApi, 'setEnvironment').mockImplementation(() => {});
  r.startLoop(() => false);
  expect(setEnv).toHaveBeenCalledWith(fake, { resolution: 256 });
});

test('configureRenderer applies NeutralToneMapping with exposure 1', () => {
  const r = { toneMapping: THREE.NoToneMapping, toneMappingExposure: 0 };
  configureRenderer(r);
  expect(r.toneMapping).toBe(THREE.NeutralToneMapping);
  expect(r.toneMappingExposure).toBe(1);
});

describe('quality hooks', () => {
  test('applyTier caps the pixel ratio at pixelRatioCap, sets transmission scale, stores env resolution', () => {
    globalThis.devicePixelRatio = 3;
    const { r, fake } = setup();
    fake.transmissionResolutionScale = 1;
    r.applyTier(TIERS.ultra);
    expect(fake.setPixelRatio).toHaveBeenLastCalledWith(1.5);
    expect(fake.transmissionResolutionScale).toBe(1);
    r.applyTier(TIERS.low);
    expect(fake.setPixelRatio).toHaveBeenLastCalledWith(1);
    expect(fake.transmissionResolutionScale).toBe(0.5);
    r.applyTier(TIERS.medium);
    r.setArea({ left: 0, top: 0, width: 10, height: 10 });
    expect(fake.setPixelRatio).toHaveBeenLastCalledWith(1.25);
  });

  test('onShaderError registers on renderer.debug and forwards program info', () => {
    const { r, fake } = setup();
    const cb = vi.fn();
    r.onShaderError(cb);
    expect(typeof fake.debug.onShaderError).toBe('function');
    fake.debug.onShaderError({}, {}, {}, {});
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('onFrameTime receives a number per frame', () => {
    const { r, step } = setup();
    const cb = vi.fn();
    r.onFrameTime(cb);
    r.startLoop(() => true);
    step();
    step();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(typeof cb.mock.calls[0][0]).toBe('number');
  });

  test('warmup compiles normal and fade variants from a private scene, targeting the real one', async () => {
    const { r, fake, frames } = setup();
    fake.compileAsync = vi.fn(async (scene) => {
      fake.seen = scene.children.filter((c) => c.isMesh).map((c) => c.material);
    });
    const mats = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    const before = r.scene.children.length;
    await r.warmup(mats, new THREE.BoxGeometry());
    expect(fake.compileAsync).toHaveBeenCalledTimes(1);
    expect(fake.compileAsync.mock.calls[0][0]).not.toBe(r.scene);
    expect(fake.compileAsync.mock.calls[0][2]).toBe(r.scene);
    expect(fake.seen.length).toBe(4);
    expect(fake.seen.filter((m) => m.transparent).length).toBe(2);
    expect(r.scene.children.length).toBe(before);
    expect(frames.length).toBe(0);
    expect(r.isLooping).toBe(false);
  });

  test('a frame rendered while the warmup compile is pending never contains a warm-up mesh', async () => {
    const { r, fake, step } = setup();
    let release;
    fake.compileAsync = vi.fn(() => new Promise((res) => (release = res)));
    const rendered = [];
    fake.render.mockImplementation((scene) => rendered.push(scene.children.filter((c) => c.isMesh).length));
    const pending = r.warmup([new THREE.MeshBasicMaterial()], new THREE.BoxGeometry());
    r.startLoop(() => false);
    step();
    expect(rendered.length).toBe(1);
    expect(rendered[0]).toBe(0);
    release();
    await pending;
  });

  test('onFrameTime reports the rAF interval when it exceeds CPU time, none for the first frame', () => {
    const { r, frames } = setup();
    const cb = vi.fn();
    r.onFrameTime(cb);
    r.startLoop(() => true);
    for (const t of [0, 16, 60]) frames.splice(0).forEach((f) => f(t));
    const v = cb.mock.calls.map((c) => c[0]);
    expect(v[0]).toBeLessThan(10); // first frame: CPU time only
    expect(v[1]).toBeGreaterThanOrEqual(16);
    expect(v[2]).toBeGreaterThanOrEqual(44);
    expect(v[2]).toBeLessThan(100);
  });
});

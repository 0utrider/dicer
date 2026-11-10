// @vitest-environment jsdom
import * as THREE from 'three';
import { createWarmup } from '../../src/render/warmup.js';
import { DiceRenderer } from '../../src/render/renderer.js';

function setup() {
  const container = document.createElement('div');
  const fake = {
    setSize() {},
    setPixelRatio() {},
    render() {},
    dispose() {},
    debug: {},
    compileAsync: vi.fn(() => new Promise(() => {})), // hangs like three's poll on a lost context
  };
  const renderer = new DiceRenderer({ container, createRenderer: () => fake, raf: () => 1, caf() {} });
  const released = [];
  let n = 0;
  const box = {
    acquireWarmup: vi.fn(() => {
      const id = n++;
      return {
        materials: [new THREE.MeshBasicMaterial()],
        geometry: new THREE.BoxGeometry(),
        release: () => released.push(id),
      };
    }),
  };
  const onWarmed = vi.fn();
  const warn = vi.fn();
  const warmUp = createWarmup({ getBox: () => box, getRenderer: () => renderer, onWarmed, warn });
  const loseContext = () =>
    container.querySelector('canvas').dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  return { fake, renderer, box, released, onWarmed, warn, warmUp, loseContext };
}

test('a context loss mid-warm-up releases the materials, and a later warm-up still runs', async () => {
  const { fake, box, released, onWarmed, warn, warmUp, loseContext } = setup();
  const first = warmUp();
  expect(box.acquireWarmup).toHaveBeenCalledTimes(1);
  loseContext();
  await first;
  expect(released).toEqual([0]);
  expect(onWarmed).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith('dicer: material warm-up failed', expect.objectContaining({ reason: 'context-lost' }));
  // restore: main.js warms up again on onContextRestored
  fake.compileAsync = vi.fn(async () => {});
  await warmUp();
  expect(box.acquireWarmup).toHaveBeenCalledTimes(2);
  expect(released).toEqual([0, 1]);
  expect(onWarmed).toHaveBeenCalledTimes(1);
});

test('calls during a pass coalesce into one more pass', async () => {
  const { fake, box, warmUp } = setup();
  let release;
  fake.compileAsync = vi.fn(() => new Promise((r) => (release = r)));
  const a = warmUp();
  const b = warmUp();
  const c = warmUp();
  expect(b).toBe(a);
  expect(c).toBe(a);
  fake.compileAsync = vi.fn(async () => {});
  release();
  await a;
  expect(box.acquireWarmup).toHaveBeenCalledTimes(2);
});

test('no box or renderer yet: nothing is acquired', async () => {
  const warmUp = createWarmup({ getBox: () => null, getRenderer: () => null });
  await expect(warmUp()).resolves.toBeUndefined();
});

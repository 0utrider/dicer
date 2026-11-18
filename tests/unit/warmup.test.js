// @vitest-environment jsdom
import * as THREE from 'three';
import { createWarmup, createAppearanceRewarm } from '../../src/render/warmup.js';
import { DiceRenderer } from '../../src/render/renderer.js';

function setup({ getLooks } = {}) {
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
  const warmUp = createWarmup({ getBox: () => box, getRenderer: () => renderer, onWarmed, warn, getLooks });
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

test('other looks (the damage themes) compile in a second pass after the current look', async () => {
  const looks = [{ a: 1 }, { b: 2 }];
  const { fake, box, released, onWarmed, warmUp } = setup({ getLooks: () => looks });
  fake.compileAsync = vi.fn(async () => {});
  await warmUp();
  expect(box.acquireWarmup.mock.calls).toEqual([[], [undefined, looks]]);
  expect(fake.compileAsync).toHaveBeenCalledTimes(2);
  expect(released).toEqual([0, 1]);
  expect(onWarmed).toHaveBeenCalledTimes(1);
});

test('no second pass when the current look failed to compile or there are no other looks', async () => {
  const getLooks = vi.fn(() => [{ a: 1 }]);
  const { fake, box, warmUp } = setup({ getLooks });
  fake.compileAsync = vi.fn(async () => {
    throw new Error('boom');
  });
  await warmUp();
  expect(box.acquireWarmup).toHaveBeenCalledTimes(1);
  expect(getLooks).not.toHaveBeenCalled();
  const empty = setup({ getLooks: () => [] });
  empty.fake.compileAsync = vi.fn(async () => {});
  await empty.warmUp();
  expect(empty.box.acquireWarmup).toHaveBeenCalledTimes(1);
});

test('no box or renderer yet: nothing is acquired', async () => {
  const warmUp = createWarmup({ getBox: () => null, getRenderer: () => null });
  await expect(warmUp()).resolves.toBeUndefined();
});

describe('re-warm after a GM push (M-2 debt)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const rig = () => {
    const { fake, box, released, warmUp } = setup();
    fake.compileAsync = vi.fn(async () => {});
    const rewarm = vi.fn(() => warmUp());
    const rw = createAppearanceRewarm({ rewarm, getUserId: () => 'me' });
    return { rw, rewarm, box, released };
  };
  const push = { flags: { dicer: { appearance: { x: 1 } } } };

  test('two flag updates within 500 ms give one warm-up, acquired and released once', async () => {
    const { rw, box, released } = rig();
    rw.onUpdateUser({ id: 'me' }, push);
    await vi.advanceTimersByTimeAsync(300);
    rw.onUpdateUser({ id: 'me' }, push);
    await vi.advanceTimersByTimeAsync(499);
    expect(box.acquireWarmup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(box.acquireWarmup).toHaveBeenCalledTimes(1);
    expect(released).toEqual([0]);
  });

  test("another user's flag update, or another flag, does nothing", async () => {
    const { rw, rewarm } = rig();
    rw.onUpdateUser({ id: 'other' }, push);
    rw.onUpdateUser({ id: 'me' }, { flags: { dicer: { themes: [] } } });
    rw.onUpdateUser({ id: 'me' }, { name: 'x' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(rewarm).not.toHaveBeenCalled();
  });

  test('clearing the flag counts, and worldDefaultTheme / lockPlayerLooks changes are debounced with it', async () => {
    const { rw, rewarm } = rig();
    rw.onUpdateUser({ id: 'me' }, { flags: { dicer: { '-=appearance': null } } });
    rw.onSettingChange();
    rw.onSettingChange();
    await vi.advanceTimersByTimeAsync(500);
    expect(rewarm).toHaveBeenCalledTimes(1);
  });

  test('a re-warm is skipped when the resolved appearance equals the one last warmed', async () => {
    let look = { a: 1 };
    const rewarm = vi.fn();
    const rw = createAppearanceRewarm({ rewarm, getUserId: () => 'me', getAppearance: () => look });
    rw.markWarmed(); // the player's own theme change already rebuilt for { a: 1 }
    rw.onUpdateUser({ id: 'me' }, push);
    rw.onSettingChange(); // a world-default change that does not affect this user
    await vi.advanceTimersByTimeAsync(500);
    expect(rewarm).not.toHaveBeenCalled();
    look = { a: 2 }; // a GM push that does change it
    rw.onUpdateUser({ id: 'me' }, push);
    await vi.advanceTimersByTimeAsync(500);
    expect(rewarm).toHaveBeenCalledTimes(1);
  });

  test('before anything was warmed, or if the appearance cannot be read, it re-warms', async () => {
    const rewarm = vi.fn();
    const a = createAppearanceRewarm({ rewarm, getUserId: () => 'me', getAppearance: () => ({ a: 1 }) });
    a.onSettingChange();
    const b = createAppearanceRewarm({ rewarm, getUserId: () => 'me', getAppearance: () => { throw new Error('x'); } });
    b.markWarmed();
    b.onSettingChange();
    await vi.advanceTimersByTimeAsync(500);
    expect(rewarm).toHaveBeenCalledTimes(2);
  });

  test('dispose cancels a pending re-warm', async () => {
    const { rw, rewarm } = rig();
    rw.onSettingChange();
    rw.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(rewarm).not.toHaveBeenCalled();
  });
});

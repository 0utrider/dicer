import { startEngine, announceReady } from '../../src/foundry/startup.js';

function parts() {
  const physics = { terminate: vi.fn() };
  const renderer = { dispose: vi.fn() };
  const diceBox = { dispose: vi.fn() };
  return {
    physics,
    renderer,
    diceBox,
    deps: {
      loadAtlas: vi.fn(async () => ({ atlas: true })),
      createPhysics: vi.fn(() => physics),
      createRenderer: vi.fn(() => renderer),
      createDiceBox: vi.fn(() => diceBox),
      activate: vi.fn(async () => {}),
      warn: vi.fn(),
    },
  };
}

test('success: builds everything in order, activates it and returns the parts', async () => {
  const { physics, renderer, diceBox, deps } = parts();
  await expect(startEngine(deps)).resolves.toEqual({ physics, renderer, diceBox });
  expect(deps.createDiceBox).toHaveBeenCalledWith({ atlas: { atlas: true }, physics, renderer });
  expect(deps.activate).toHaveBeenCalledWith({ physics, renderer, diceBox });
  expect(physics.terminate).not.toHaveBeenCalled();
  expect(deps.warn).not.toHaveBeenCalled();
});

test('the renderer throws → the physics worker is terminated, one warning, resolves null', async () => {
  const { physics, deps } = parts();
  deps.createRenderer.mockImplementation(() => {
    throw new Error('no WebGL2');
  });
  await expect(startEngine(deps)).resolves.toBe(null);
  expect(physics.terminate).toHaveBeenCalledTimes(1);
  expect(deps.createDiceBox).not.toHaveBeenCalled();
  expect(deps.warn).toHaveBeenCalledTimes(1);
  expect(deps.warn.mock.calls[0][0]).toMatch(/3D dice are disabled/);
});

test('activation throws → dice box, renderer and worker are all released', async () => {
  const { physics, renderer, diceBox, deps } = parts();
  deps.activate.mockRejectedValue(new Error('boom'));
  await expect(startEngine(deps)).resolves.toBe(null);
  expect(diceBox.dispose).toHaveBeenCalledTimes(1);
  expect(renderer.dispose).toHaveBeenCalledTimes(1);
  expect(physics.terminate).toHaveBeenCalledTimes(1);
  expect(deps.warn).toHaveBeenCalledTimes(1);
});

test('a failing cleanup step does not stop the others or add warnings', async () => {
  const { physics, renderer, diceBox, deps } = parts();
  deps.activate.mockRejectedValue(new Error('boom'));
  diceBox.dispose.mockImplementation(() => {
    throw new Error('dispose boom');
  });
  await expect(startEngine(deps)).resolves.toBe(null);
  expect(renderer.dispose).toHaveBeenCalled();
  expect(physics.terminate).toHaveBeenCalled();
  expect(deps.warn).toHaveBeenCalledTimes(1);
});

test('the atlas fails to load → nothing was created, nothing to release', async () => {
  const { deps } = parts();
  deps.loadAtlas.mockRejectedValue(new Error('404'));
  await expect(startEngine(deps)).resolves.toBe(null);
  expect(deps.createPhysics).not.toHaveBeenCalled();
  expect(deps.warn).toHaveBeenCalledTimes(1);
});

describe('announceReady', () => {
  const hooks = () => ({
    calls: [],
    callAll(name, ...a) {
      this.calls.push([name, ...a]);
    },
  });

  test('fires diceSoNiceInit then diceSoNiceReady only after the api.js promise settles', async () => {
    const h = hooks();
    const api = { id: 'dice3d' };
    let settle;
    const apiReady = new Promise((r) => (settle = r));
    const seen = [];
    h.callAll = (name, a) => seen.push([name, a, globalThis.__loaded === true]);
    const done = announceReady({ hooks: h, api, apiReady });
    await Promise.resolve();
    expect(seen).toEqual([]);
    globalThis.__loaded = true;
    settle({ DiceSystem: class {} });
    await done;
    delete globalThis.__loaded;
    expect(seen).toEqual([
      ['diceSoNiceInit', api, true],
      ['diceSoNiceReady', api, true],
    ]);
  });

  test('still fires both when the promise is missing or rejects, and never rejects itself', async () => {
    for (const make of [() => undefined, () => null, () => Promise.reject(new Error('x'))]) {
      const h = hooks();
      await expect(announceReady({ hooks: h, api: 1, apiReady: make() })).resolves.toBeUndefined();
      expect(h.calls.map((c) => c[0])).toEqual(['diceSoNiceInit', 'diceSoNiceReady']);
    }
  });

  test('a throwing hooks object is logged, never thrown', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = {
      callAll: () => {
        throw new Error('boom');
      },
    };
    await expect(
      announceReady({ hooks: h, api: 1, apiReady: Promise.resolve() }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

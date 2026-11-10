import { createQualityController } from '../../src/render/quality-controller.js';
import { TIERS } from '../../src/render/quality.js';

function fakeRenderer() {
  const r = {
    glRenderer: { isFake: true },
    applyTier: vi.fn(),
    frameCbs: [],
    shaderCbs: [],
    onFrameTime: (cb) => r.frameCbs.push(cb),
    onShaderError: (cb) => r.shaderCbs.push(cb),
    frames(n, ms) {
      for (let i = 0; i < n; i++) for (const cb of r.frameCbs) cb(ms);
    },
    shaderError() {
      for (const cb of r.shaderCbs) cb({ log: 'boom' });
    },
  };
  return r;
}

function setup({ ms = 2, settings = {}, ...opts } = {}) {
  const values = {
    quality: 'auto',
    qualityCap: 'ultra',
    interiors: true,
    engraving: true,
    glow: true,
    ...settings,
  };
  const renderer = fakeRenderer();
  const probe = vi.fn(async () => ({ msPerFrame: ms, gpu: 'test' }));
  const notify = vi.fn();
  const localize = vi.fn((k) => `L:${k}`);
  const atlas = { id: 'atlas' };
  const qc = createQualityController({
    renderer,
    getSetting: (k) => values[k],
    probe,
    notify,
    localize,
    atlas,
    ...opts,
  });
  return { qc, renderer, probe, notify, localize, values, atlas };
}

const lastTier = (renderer) => renderer.applyTier.mock.calls.at(-1)[0];
/** Enough frames over budget to trigger one drop: 10 grace + a 30-frame streak. */
const DROP_FRAMES = 45;
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

test('before the probe finishes, auto uses the medium tier and its flags', () => {
  const { qc, renderer } = setup();
  expect(qc.tier).toBe('medium');
  expect(qc.config).toBe(TIERS.medium);
  expect(lastTier(renderer)).toBe(TIERS.medium);
  expect(qc.flags().interiorSteps).toBe(TIERS.medium.interiorSteps);
});

test('the probe runs once against the WebGLRenderer, and its tier honours the world cap', async () => {
  const { qc, renderer, probe, atlas } = setup({ ms: 2, settings: { qualityCap: 'high' } });
  await qc.ready;
  expect(probe).toHaveBeenCalledTimes(1);
  expect(probe).toHaveBeenCalledWith(renderer.glRenderer, expect.objectContaining({ atlas }));
  expect(qc.tier).toBe('high');
  expect(lastTier(renderer)).toBe(TIERS.high);
  qc.refresh();
  expect(probe).toHaveBeenCalledTimes(1);
});

test('an explicit client choice is still capped by the world cap', async () => {
  const { qc } = setup({ ms: 30, settings: { quality: 'ultra', qualityCap: 'medium' } });
  await qc.ready;
  expect(qc.tier).toBe('medium');
});

test('refresh() after a settings change applies the new tier and calls onChange', async () => {
  const { qc, renderer, values } = setup({ ms: 2 });
  await qc.ready;
  expect(qc.tier).toBe('ultra');
  const cb = vi.fn();
  qc.onChange(cb);
  values.qualityCap = 'low';
  qc.refresh();
  expect(qc.tier).toBe('low');
  expect(lastTier(renderer)).toBe(TIERS.low);
  expect(cb).toHaveBeenCalledWith(expect.objectContaining({ tier: 'low', reason: 'settings' }));
  cb.mockClear();
  qc.refresh(); // no change, no callback
  expect(cb).not.toHaveBeenCalled();
});

test('an adaptive drop re-applies the lower tier and notifies once; a second drop does not notify again', async () => {
  const { qc, renderer, notify } = setup({ ms: 5 }); // high
  await qc.ready;
  expect(qc.tier).toBe('high');
  const cb = vi.fn();
  qc.onChange(cb);
  renderer.frames(DROP_FRAMES, 100);
  expect(qc.tier).toBe('medium');
  expect(lastTier(renderer)).toBe(TIERS.medium);
  expect(cb).toHaveBeenCalledWith(expect.objectContaining({ tier: 'medium', reason: 'drop' }));
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith('L:DICER.Quality.Dropped');

  renderer.frames(DROP_FRAMES, 100);
  expect(qc.tier).toBe('low');
  expect(cb).toHaveBeenCalledTimes(2);
  expect(notify).toHaveBeenCalledTimes(1);
});

test('the session drop survives a settings refresh', async () => {
  const { qc, renderer, values } = setup({ ms: 2 });
  await qc.ready;
  renderer.frames(DROP_FRAMES, 100);
  expect(qc.tier).toBe('high');
  values.quality = 'ultra';
  qc.refresh();
  expect(qc.tier).toBe('high');
});

test('a drop at low changes nothing and does not notify', async () => {
  const { qc, renderer, notify } = setup({ ms: 30 });
  await qc.ready;
  expect(qc.tier).toBe('low');
  renderer.frames(DROP_FRAMES, 100);
  expect(qc.tier).toBe('low');
  expect(notify).not.toHaveBeenCalled();
});

test('warmedUp() resets the adaptive window (P2-R10)', async () => {
  const { qc, renderer } = setup({ ms: 2 });
  await qc.ready;
  renderer.frames(10 + 25, 100); // grace + 25 of the 30-frame streak
  qc.warmedUp();
  renderer.frames(10 + 25, 100); // grace again, then a fresh 25-frame streak
  expect(qc.tier).toBe('ultra');
  renderer.frames(5, 100);
  expect(qc.tier).toBe('high');
});

test('a shader error forces low, calls onChange after the current frame, and logs once', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { qc, renderer } = setup({ ms: 2 });
  await qc.ready;
  const cb = vi.fn();
  qc.onChange(cb);
  renderer.shaderError();
  expect(qc.tier).toBe('low');
  expect(lastTier(renderer)).toBe(TIERS.low);
  expect(cb).not.toHaveBeenCalled(); // deferred: never swap materials mid-render
  await flushMicrotasks();
  expect(cb).toHaveBeenCalledWith(expect.objectContaining({ tier: 'low', reason: 'shader' }));
  renderer.shaderError();
  await flushMicrotasks();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(cb).toHaveBeenCalledTimes(1);
  expect(qc.flags().interiors).toBe(false);
  warn.mockRestore();
});

test('a shader error before the probe resolves still ends at low', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { qc, renderer } = setup({ ms: 2 });
  renderer.shaderError();
  await qc.ready;
  expect(qc.tier).toBe('low');
  warn.mockRestore();
});

test('flags(): interiorSteps comes from the tier; interiors needs the setting AND the tier', async () => {
  const { qc, values, renderer } = setup({ ms: 5 }); // high
  await qc.ready;
  expect(qc.flags()).toEqual({ interiors: true, engraving: true, glow: true, interiorSteps: 32 });
  values.interiors = false;
  values.engraving = false;
  values.glow = false;
  expect(qc.flags()).toEqual({
    interiors: false,
    engraving: false,
    glow: false,
    interiorSteps: 32,
  });
  values.interiors = true;
  values.qualityCap = 'low';
  qc.refresh();
  expect(qc.flags()).toMatchObject({ interiors: false, interiorSteps: 0 });
  expect(renderer.applyTier).toHaveBeenLastCalledWith(TIERS.low);
});

test('a probe that rejects falls back to medium and ready still resolves', async () => {
  const { qc } = setup({ probe: vi.fn(async () => Promise.reject(new Error('x'))) });
  await qc.ready;
  expect(qc.tier).toBe('medium');
});

test('dispose() stops reacting to frames and shader errors', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { qc, renderer } = setup({ ms: 2 });
  await qc.ready;
  qc.dispose();
  renderer.frames(DROP_FRAMES, 100);
  renderer.shaderError();
  expect(qc.tier).toBe('ultra');
  warn.mockRestore();
});

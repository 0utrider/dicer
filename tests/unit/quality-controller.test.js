import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createQualityController } from '../../src/render/quality-controller.js';
import { TIERS, flagsFor } from '../../src/render/quality.js';
import { createDiceMaterial } from '../../src/render/dice-material.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { getShape, labelFor } from '../../src/core/dice-shapes.js';
import { LOOKS } from '../../src/look/looks.js';

function fakeRenderer() {
  const r = {
    glRenderer: { isFake: true },
    applyTier: vi.fn(),
    frameCbs: [],
    shaderCbs: [],
    onFrameTime: (cb) => r.frameCbs.push(cb),
    onShaderError: (cb) => r.shaderCbs.push(cb),
    frames(n, ms, sample) {
      for (let i = 0; i < n; i++) for (const cb of r.frameCbs) cb(ms, sample);
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
/** The GPU judge: 10 grace + a 60-frame p95 window. */
const GPU_DROP_FRAMES = 70;
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

// P9-R8: the benchmark reports why a session dropped.
test('drops logs each adaptive drop: when, from and to, and the judge numbers', async () => {
  let t = 1000;
  const { qc, renderer } = setup({ ms: 5, now: () => t }); // high
  await qc.ready;
  expect(qc.drops).toEqual([]);
  renderer.frames(DROP_FRAMES, 100);
  t = 2500;
  renderer.frames(DROP_FRAMES, 100);
  expect(qc.drops).toEqual([
    expect.objectContaining({ at: 1000, from: 'high', to: 'medium', path: 'ema' }),
    expect.objectContaining({ at: 2500, from: 'medium', to: 'low', path: 'ema' }),
  ]);
  qc.drops.length = 0; // a copy: callers cannot clear the log
  expect(qc.drops).toHaveLength(2);
});

describe('P2-R11: adaptive ceiling and shader-forced low', () => {
  test('auto→high, a drop → medium; the user then picks medium → medium, ultra → ultra', async () => {
    const { qc, renderer, values } = setup({ ms: 5 });
    await qc.ready;
    expect(qc.tier).toBe('high');
    renderer.frames(DROP_FRAMES, 100);
    expect(qc.tier).toBe('medium');
    values.quality = 'medium';
    qc.refresh('quality');
    expect(qc.tier).toBe('medium'); // a ceiling, not a count subtracted from the choice
    values.quality = 'ultra';
    qc.refresh('quality');
    expect(qc.tier).toBe('ultra');
    expect(lastTier(renderer)).toBe(TIERS.ultra);
  });

  test('the drop is a ceiling under the base tier, not a subtraction', async () => {
    const { qc, renderer, values } = setup({ ms: 2 }); // ultra
    await qc.ready;
    renderer.frames(DROP_FRAMES, 100);
    expect(qc.tier).toBe('high'); // ceiling = high
    values.qualityCap = 'medium';
    qc.refresh('qualityCap');
    expect(qc.tier).toBe('medium'); // min(ultra, medium, high)
  });

  test('after a drop, a qualityCap change keeps the ceiling', async () => {
    const { qc, renderer, values } = setup({ ms: 2 }); // ultra
    await qc.ready;
    renderer.frames(DROP_FRAMES, 100);
    expect(qc.tier).toBe('high');
    values.qualityCap = 'high';
    qc.refresh('qualityCap');
    values.qualityCap = 'ultra';
    qc.refresh('qualityCap');
    expect(qc.tier).toBe('high');
  });

  test('a user quality pick resets the adaptive window even when the tier is unchanged', async () => {
    const { qc, renderer } = setup({ ms: 2 });
    await qc.ready;
    renderer.frames(10 + 25, 100);
    qc.refresh('quality'); // same tier: no applyTier, but a fresh window
    renderer.frames(10 + 25, 100);
    expect(qc.tier).toBe('ultra');
  });

  test('a shader error forces low, and a later user pick stays low', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { qc, renderer, values } = setup({ ms: 2 });
    await qc.ready;
    renderer.shaderError();
    expect(qc.tier).toBe('low');
    values.quality = 'ultra';
    qc.refresh('quality');
    expect(qc.tier).toBe('low');
    values.qualityCap = 'ultra';
    qc.refresh('qualityCap');
    expect(qc.tier).toBe('low');
    warn.mockRestore();
  });

  test('the notice fires once across a drop, a user change and a second drop', async () => {
    const { qc, renderer, values, notify } = setup({ ms: 2 });
    await qc.ready;
    renderer.frames(DROP_FRAMES, 100);
    expect(qc.tier).toBe('high');
    expect(notify).toHaveBeenCalledTimes(1);
    values.quality = 'ultra';
    qc.refresh('quality');
    expect(qc.tier).toBe('ultra');
    renderer.frames(DROP_FRAMES, 100);
    expect(qc.tier).toBe('high');
    expect(notify).toHaveBeenCalledTimes(1);
  });
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
  expect(warn).toHaveBeenCalledTimes(1);
  expect(cb).toHaveBeenCalledTimes(1);
  expect(qc.flags().interiorSteps).toBe(0);
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

test('flags(): interiorSteps comes from the tier; interiors is the client setting', async () => {
  const { qc, values, renderer } = setup({ ms: 5 }); // high
  await qc.ready;
  expect(qc.flags()).toEqual({
    interiors: true,
    engraving: true,
    glow: true,
    effects: true,
    interiorSteps: 32,
    safe: false,
    insideMotion: true,
  });
  values.interiors = false;
  values.engraving = false;
  values.glow = false;
  expect(qc.flags()).toEqual({
    interiors: false,
    engraving: false,
    glow: false,
    effects: true,
    interiorSteps: 32,
    safe: false,
    insideMotion: true,
  });
  values.effects = false;
  expect(qc.flags().effects).toBe(false);
  values.insideMotion = false; // the insideMotion client setting feeds flags.insideMotion
  expect(qc.flags().insideMotion).toBe(false);
  values.insideMotion = true;
  values.effects = true;
  values.interiors = true;
  values.qualityCap = 'low';
  qc.refresh();
  expect(qc.flags()).toMatchObject({ interiors: true, interiorSteps: 16 }); // low still marches the insides
  expect(renderer.applyTier).toHaveBeenLastCalledWith(TIERS.low);
});

test('flags() equal flagsFor(tier, settings): the gallery and preview cannot drift', async () => {
  const { qc, values } = setup({ ms: 5 });
  await qc.ready;
  for (const cap of ['low', 'medium', 'high', 'ultra']) {
    values.qualityCap = cap;
    qc.refresh('qualityCap');
    expect(qc.flags()).toEqual(flagsFor(TIERS[qc.tier], values));
  }
});

test('production flags at low march the inside; only a shader failure falls back to the body tint', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { qc, renderer } = setup({ ms: 30 }); // low: a slow probe (it runs while the world loads)
  await qc.ready;
  expect(qc.tier).toBe('low');
  const atlas = {
    ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
    texture: new THREE.Texture(),
  };
  const shape = getShape('d20');
  const labels = shape.values.map((v) => labelFor('d20', v));
  const make = () => createDiceMaterial(LOOKS.default.appearance, atlas, shape, labels, qc.flags());
  const marched = make();
  expect(marched.defines.DICER_INTERIOR).toBeDefined(); // the inside shows at low too
  expect(marched.userData.programKey.split('|')[2]).not.toBe('none');
  renderer.shaderError(); // an inside shader failed to compile: the fake, not a second try
  await flushMicrotasks();
  const faked = make();
  expect(faked.userData.uniforms.uResinTint.value.w).toBeGreaterThan(0);
  expect(faked.defines.DICER_INTERIOR).toBeUndefined();
  expect(faked.userData.programKey.split('|')[2]).toBe('none');
  warn.mockRestore();
});

describe('P2-R12: safe flags after a shader error at low or a second shader error', () => {
  test('a second shader error switches to safe flags, emits after the frame, and logs once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { qc, renderer } = setup({ ms: 2 });
    await qc.ready;
    const cb = vi.fn();
    qc.onChange(cb);
    renderer.shaderError();
    await flushMicrotasks();
    expect(qc.flags().safe).toBe(false);
    renderer.shaderError();
    expect(qc.flags()).toEqual(flagsFor(TIERS.low, {}, { safe: true }));
    expect(cb).toHaveBeenCalledTimes(1); // deferred like the low swap
    await flushMicrotasks();
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({ tier: 'low', reason: 'shader', safe: true }),
    );
    renderer.shaderError();
    await flushMicrotasks();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2); // once for low, once for safe
    warn.mockRestore();
  });

  test('a shader error at low drops the marched inside first (the tint); a second goes to safe', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { qc, renderer } = setup({ ms: 30 });
    await qc.ready;
    expect(qc.tier).toBe('low');
    const cb = vi.fn();
    qc.onChange(cb);
    renderer.shaderError();
    expect(qc.flags()).toMatchObject({ safe: false, interiorSteps: 0 });
    await flushMicrotasks();
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ reason: 'shader', safe: false }));
    renderer.shaderError(); // the tint failed too
    expect(qc.flags().safe).toBe(true);
    await flushMicrotasks();
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'shader', safe: true }));
    warn.mockRestore();
  });

  test('errors from the same failing frame count as one incident', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { qc, renderer } = setup({ ms: 2 });
    await qc.ready;
    renderer.shaderError();
    renderer.shaderError(); // e.g. the fade variant of the same look, same render
    expect(qc.tier).toBe('low');
    expect(qc.flags().safe).toBe(false);
    warn.mockRestore();
  });

  test('safe mode stays for the session, whatever the user picks', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { qc, renderer, values } = setup({ ms: 30 });
    await qc.ready;
    renderer.shaderError();
    await flushMicrotasks();
    renderer.shaderError(); // a second incident: safe
    values.quality = 'ultra';
    qc.refresh('quality');
    expect(qc.tier).toBe('low');
    expect(qc.flags().safe).toBe(true);
    warn.mockRestore();
  });

  test('safe flags build a material with no Dicer body defines', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { qc, renderer } = setup({ ms: 30 });
    await qc.ready;
    renderer.shaderError();
    await flushMicrotasks();
    renderer.shaderError(); // a second incident: safe
    const atlas = { ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))) };
    const shape = getShape('d20');
    const labels = shape.values.map((v) => labelFor('d20', v));
    const m = createDiceMaterial(LOOKS.default.appearance, atlas, shape, labels, qc.flags());
    expect(Object.keys(m.defines).filter((k) => k.startsWith('DICER_'))).toEqual([]);
    warn.mockRestore();
  });
});

test('frame samples reach the adaptive judge: a steady 30 Hz cap never drops (P2-R13)', async () => {
  const { qc, renderer } = setup({ ms: 2 }); // ultra
  await qc.ready;
  for (let i = 0; i < 500; i++) for (const cb of renderer.frameCbs) cb(33.3, { interval: 33.3, cpu: 2 });
  expect(qc.tier).toBe('ultra');
});

describe('P2-R13 debt: GPU-bound from the first roll', () => {
  test('a GPU p95 of 20 ms over a 16.7 ms budget drops a tier, notifying once', async () => {
    const { qc, renderer, notify } = setup({ ms: 5 }); // high
    await qc.ready;
    // rAF interval 16.7 (60 Hz), CPU cheap, GPU 20 ms: the interval baseline never sees it as slow
    renderer.frames(GPU_DROP_FRAMES, 20, { interval: 16.7, cpu: 2, gpu: 20 });
    expect(qc.tier).toBe('medium');
    renderer.frames(GPU_DROP_FRAMES, 20, { interval: 16.7, cpu: 2, gpu: 20 });
    expect(qc.tier).toBe('low');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test('a GPU time under budget does not drop', async () => {
    const { qc, renderer } = setup({ ms: 5 });
    await qc.ready;
    renderer.frames(300, 16, { interval: 16.7, cpu: 2, gpu: 12 });
    expect(qc.tier).toBe('high');
  });

  test('without a timer (no gpu in the sample) the interval-baseline behaviour is unchanged', async () => {
    const { qc, renderer } = setup({ ms: 5 });
    await qc.ready;
    renderer.frames(300, 20, { interval: 16.7, cpu: 2, gpu: null });
    expect(qc.tier).toBe('high'); // 20 ms is not 1.3x a 16.7 ms baseline
    renderer.frames(DROP_FRAMES, 100); // no sample at all: the plain EMA path still drops
    expect(qc.tier).toBe('medium');
  });
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

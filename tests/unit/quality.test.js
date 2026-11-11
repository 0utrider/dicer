import {
  TIERS,
  TIER_ORDER,
  effectiveTier,
  tierFromProbe,
  AdaptiveQuality,
  flagsFor,
} from '../../src/render/quality.js';

test('tier table: exactly four tiers, interiorSteps 0 only at low', () => {
  expect(Object.keys(TIERS)).toEqual(['low', 'medium', 'high', 'ultra']);
  expect(TIER_ORDER).toEqual(['low', 'medium', 'high', 'ultra']);
  for (const t of TIER_ORDER) expect(TIERS[t].interiorSteps === 0).toBe(t === 'low');
  expect(TIERS.high).toEqual({
    pixelRatio: 1.5,
    interiorSteps: 32,
    transmissionScale: 1,
    envResolution: 256,
    anisotropy: true,
    particleScale: 1,
    effectBudget: 8,
  });
  expect(TIERS.low.anisotropy).toBe(false);
});

test('effect tiers: particleScale and effectBudget per tier (Plan 4 Task 8)', () => {
  const pick = (t) => [TIERS[t].particleScale, TIERS[t].effectBudget];
  expect(pick('low')).toEqual([0.25, 2]);
  expect(pick('medium')).toEqual([0.5, 4]);
  expect(pick('high')).toEqual([1, 8]);
  expect(pick('ultra')).toEqual([1.5, 12]);
  for (const t of TIER_ORDER) expect(Object.isFrozen(TIERS[t])).toBe(true);
});

test('effectiveTier: min(choice or auto, cap); the adaptive drop lives in the controller', () => {
  expect(effectiveTier({ choice: 'auto', autoTier: 'ultra', cap: 'high' })).toBe('high');
  expect(effectiveTier({ choice: 'ultra', autoTier: 'low', cap: 'medium' })).toBe('medium');
  expect(effectiveTier({ choice: 'high', autoTier: 'low', cap: 'ultra' })).toBe('high');
  expect(effectiveTier({ choice: 'low', autoTier: 'ultra', cap: 'ultra' })).toBe('low');
  expect(effectiveTier({ choice: 'auto', autoTier: 'medium', cap: 'ultra' })).toBe('medium');
  // the old `dropped` param is gone (P2-R11 keeps the drop as the controller's ceiling)
  expect(effectiveTier({ choice: 'high', autoTier: 'low', cap: 'ultra', dropped: 1 })).toBe('high');
});

test('tierFromProbe boundaries', () => {
  const t = (ms) => tierFromProbe({ msPerFrame: ms });
  expect(t(3.9)).toBe('ultra');
  expect(t(4)).toBe('high');
  expect(t(7.9)).toBe('high');
  expect(t(8)).toBe('medium');
  expect(t(15.9)).toBe('medium');
  expect(t(16)).toBe('low');
});

// P2-R10: the first 10 frames after construction / reset() are ignored.
const grace = (q) => {
  for (let i = 0; i < 10; i++) q.frame(1000);
};

describe('AdaptiveQuality', () => {
  test('29 slow frames do not drop, the 30th does', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    grace(q);
    for (let i = 0; i < 29; i++) q.frame(40);
    expect(onDrop).not.toHaveBeenCalled();
    q.frame(40);
    expect(onDrop).toHaveBeenCalledWith(1);
    expect(q.dropped).toBe(1);
  });

  test('a fast stretch resets the streak', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    grace(q);
    for (let i = 0; i < 20; i++) q.frame(40);
    for (let i = 0; i < 60; i++) q.frame(1); // EMA decays under budget
    for (let i = 0; i < 29; i++) q.frame(40);
    expect(onDrop).not.toHaveBeenCalled();
  });

  test('after a drop the counter restarts', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    grace(q);
    for (let i = 0; i < 30; i++) q.frame(40);
    expect(onDrop).toHaveBeenCalledTimes(1);
    grace(q);
    for (let i = 0; i < 29; i++) q.frame(40);
    expect(onDrop).toHaveBeenCalledTimes(1);
    q.frame(40);
    expect(onDrop).toHaveBeenLastCalledWith(2);
  });

  test('after a drop the grace window applies again before counting restarts', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    grace(q);
    for (let i = 0; i < 30; i++) q.frame(40);
    grace(q); // ignored, even though they are slow
    for (let i = 0; i < 29; i++) q.frame(40);
    expect(onDrop).toHaveBeenCalledTimes(1);
    q.frame(40);
    expect(onDrop).toHaveBeenCalledTimes(2);
  });

  test('a single 1000 ms hitch followed by normal frames causes no drop', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    grace(q);
    q.frame(1000);
    for (let i = 0; i < 200; i++) q.frame(10);
    expect(onDrop).not.toHaveBeenCalled();
  });

  test('frames inside the 10-frame grace window are ignored', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    for (let i = 0; i < 39; i++) q.frame(500);
    expect(onDrop).not.toHaveBeenCalled(); // 10 ignored + 30 slow: the drop is the 40th
  });

  test('a sustained slowdown still drops after grace + window', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    for (let i = 0; i < 39; i++) q.frame(40);
    expect(onDrop).not.toHaveBeenCalled();
    q.frame(40);
    expect(onDrop).toHaveBeenCalledWith(1);
  });

  test('reset clears dropped', () => {
    const q = new AdaptiveQuality({});
    grace(q);
    for (let i = 0; i < 30; i++) q.frame(40);
    q.reset();
    expect(q.dropped).toBe(0);
  });
});

describe('flagsFor (one source for production, gallery and preview)', () => {
  const on = { interiors: true, engraving: true, glow: true };
  test('low keeps interiors on (steps 0 selects the fake), other tiers march', () => {
    expect(flagsFor(TIERS.low, on)).toEqual({
      interiors: true,
      engraving: true,
      glow: true,
      effects: true,
      interiorSteps: 0,
      safe: false,
    });
    expect(flagsFor(TIERS.high, on)).toMatchObject({ interiors: true, interiorSteps: 32 });
  });
  test('client toggles pass through as booleans', () => {
    expect(flagsFor(TIERS.medium, { interiors: 0, engraving: undefined, glow: 'x' })).toEqual({
      interiors: false,
      engraving: false,
      glow: true,
      effects: true,
      interiorSteps: 16,
      safe: false,
    });
  });
  test('effects: on unless the setting is false; never under safe flags', () => {
    expect(flagsFor(TIERS.low, { effects: false }).effects).toBe(false);
    expect(flagsFor(TIERS.low, { effects: undefined }).effects).toBe(true);
    expect(flagsFor(TIERS.low, { effects: true }, { safe: true }).effects).toBe(false);
  });
  test('safe: every feature off (P2-R12)', () => {
    expect(flagsFor(TIERS.ultra, on, { safe: true })).toEqual({
      interiors: false,
      engraving: false,
      glow: false,
      effects: false,
      interiorSteps: 0,
      safe: true,
    });
  });
});

describe('AdaptiveQuality: learned baseline (P2-R13)', () => {
  const run = (q, n, ms, interval = ms) => {
    for (let i = 0; i < n; i++) q.frame(ms, { interval });
  };

  test('a steady 33 ms interval (30 Hz cap) never drops', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    run(q, 1000, 33.3);
    expect(onDrop).not.toHaveBeenCalled();
  });

  test('a heavy host scene (steady 45 ms interval, Dicer itself cheap) never drops', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    run(q, 500, 45);
    q.reset();
    run(q, 500, 45);
    expect(onDrop).not.toHaveBeenCalled();
  });

  test('a 16 ms baseline then sustained 40 ms frames still drops after grace + window', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    run(q, 70, 16.7);
    run(q, 40, 40);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  test('the baseline survives reset(): after a tier change the slow frames are still judged against 16 ms', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    run(q, 70, 16.7);
    q.reset();
    run(q, 10 + 40, 40);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  test('a single hitch on a 16 ms baseline does not drop', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    run(q, 70, 16.7);
    run(q, 1, 400, 100);
    run(q, 300, 16.7);
    expect(onDrop).not.toHaveBeenCalled();
  });

  test('GPU time, when given, is preferred over the rAF interval', () => {
    const capped = vi.fn();
    const q1 = new AdaptiveQuality({ onDrop: capped });
    // 30 Hz cap, but Dicer's GPU work is 2 ms: never slow
    for (let i = 0; i < 300; i++) q1.frame(33.3, { interval: 33.3, cpu: 1, gpu: 2 });
    expect(capped).not.toHaveBeenCalled();
    const heavy = vi.fn();
    const q2 = new AdaptiveQuality({ onDrop: heavy });
    // 60 Hz cadence (the browser drops frames rather than slowing rAF), Dicer's GPU work 30 ms
    for (let i = 0; i < 60; i++) q2.frame(16.7, { interval: 16.7, cpu: 1, gpu: 30 });
    expect(heavy).toHaveBeenCalledTimes(1);
  });

  test('a 60 Hz → 30 Hz cap switch mid-session costs at most one drop', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    run(q, 70, 16.7);
    run(q, 1000, 33.3);
    expect(onDrop.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

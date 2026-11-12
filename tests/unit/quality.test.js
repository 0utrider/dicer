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
    for (let i = 0; i < 70; i++) q2.frame(16.7, { interval: 16.7, cpu: 1, gpu: 30 });
    expect(heavy).toHaveBeenCalledTimes(1);
  });

  describe('GPU p95 judge (60-frame window, samples capped at 3 x budget)', () => {
    const gpuRun = (q, n, gpu) => {
      for (let i = 0; i < n; i++) q.frame(16.7, { interval: 16.7, cpu: 1, gpu });
    };

    test('a p95 of exactly 16.7 ms does not drop', () => {
      const onDrop = vi.fn();
      const q = new AdaptiveQuality({ onDrop });
      gpuRun(q, 10, 1); // grace
      gpuRun(q, 600, 16.7);
      expect(onDrop).not.toHaveBeenCalled();
    });

    test('3 hitches in 60 frames do not drop; 4 do', () => {
      const three = vi.fn();
      const q = new AdaptiveQuality({ onDrop: three });
      gpuRun(q, 10, 1);
      for (let round = 0; round < 5; round++) {
        gpuRun(q, 3, 400); // hitches, also capped at 3 x budget
        gpuRun(q, 57, 10);
      }
      expect(three).not.toHaveBeenCalled();
      const four = vi.fn();
      const q4 = new AdaptiveQuality({ onDrop: four });
      gpuRun(q4, 10, 1);
      for (let round = 0; round < 3; round++) {
        gpuRun(q4, 4, 400);
        gpuRun(q4, 56, 10);
      }
      expect(four).toHaveBeenCalled();
    });

    test('a sustained 20 ms drops', () => {
      const onDrop = vi.fn();
      const q = new AdaptiveQuality({ onDrop });
      gpuRun(q, 10 + 59, 20);
      expect(onDrop).not.toHaveBeenCalled(); // window not full yet
      gpuRun(q, 1, 20);
      expect(onDrop).toHaveBeenCalledTimes(1);
    });

    // P9-R1: the soak dropped an RTX 5070 Ti to low on CPU spikes (dice spawning, GC).
    const cpuRun = (q, n, cpu, gpu = 2) => {
      for (let i = 0; i < n; i++) q.frame(Math.max(cpu, 16.7), { interval: 16.7, cpu, gpu });
    };

    test('CPU spikes with a light GPU do not drop, however many fit in a window', () => {
      const onDrop = vi.fn();
      const q = new AdaptiveQuality({ onDrop });
      cpuRun(q, 10, 1);
      for (let round = 0; round < 20; round++) {
        cpuRun(q, 12, 400); // a spawn or GC spike every few frames
        cpuRun(q, 48, 3);
      }
      expect(onDrop).not.toHaveBeenCalled();
    });

    test('a sustained CPU cost over budget drops', () => {
      const onDrop = vi.fn();
      const q = new AdaptiveQuality({ onDrop });
      cpuRun(q, 10 + 60, 25);
      expect(onDrop).toHaveBeenCalledTimes(1);
    });

    // P9-R8: why a drop fired, for the benchmark report.
    test('lastDrop says which judge fired and the numbers behind it (GPU timer path)', () => {
      const q = new AdaptiveQuality({});
      expect(q.lastDrop).toBeNull();
      cpuRun(q, 10 + 60, 25);
      expect(q.lastDrop).toEqual({ path: 'gpu', gpuP95: 2, cpuMedian: 25, gpuSlow: false, cpuSlow: true });
      const g = new AdaptiveQuality({});
      cpuRun(g, 10 + 60, 1, 30);
      expect(g.lastDrop).toMatchObject({ path: 'gpu', gpuP95: 30, gpuSlow: true, cpuSlow: false });
    });
  });

  test('lastDrop on the EMA path: ema, the frozen baseline and the streak', () => {
    const q = new AdaptiveQuality({});
    grace(q);
    for (let i = 0; i < 30; i++) q.frame(40);
    expect(q.lastDrop).toMatchObject({ path: 'ema', streak: 30, baseline: null });
    expect(q.lastDrop.ema).toBeGreaterThan(20);
    q.reset();
    expect(q.lastDrop).not.toBeNull(); // kept for the report across the tier change
  });

  test('a 60 Hz → 30 Hz cap switch mid-session costs at most one drop', () => {
    const onDrop = vi.fn();
    const q = new AdaptiveQuality({ onDrop });
    run(q, 70, 16.7);
    run(q, 1000, 33.3);
    expect(onDrop.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

// P9-R11: the GPU-path judge keeps running counts instead of sorting two 60-frame windows on
// every frame (13% of Dicer's JS time in the low-end profile). It must decide exactly as the
// sorting judge did: GPU p95 (sorted[56] of 60) over budget, or CPU median (sorted[29]) over it.
describe('GPU-path judge matches the sorting reference', () => {
  /** The pre-P9-R11 judge, frame by frame: the frame index of each drop. */
  function referenceDrops(frames, budget = 16.7) {
    const cap = 3 * budget;
    let g = [];
    let c = [];
    let grace = 10;
    const drops = [];
    frames.forEach(([gpu, cpu], i) => {
      if (grace > 0) {
        grace--;
        return;
      }
      g.push(Math.min(gpu, cap));
      c.push(Math.min(cpu, cap));
      if (g.length > 60) g.shift();
      if (c.length > 60) c.shift();
      if (g.length < 60) return;
      const gs = [...g].sort((a, b) => a - b);
      const cs = [...c].sort((a, b) => a - b);
      if (gs[Math.ceil(0.95 * 60) - 1] > budget || cs[29] > budget) {
        drops.push({ i, gpuP95: gs[56], cpuMedian: cs[29] });
        g = [];
        c = [];
        grace = 10;
      }
    });
    return drops;
  }

  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  test.each([1, 2, 3, 4, 5, 6, 7, 8])('random frame mix %i: same drops, same numbers', (seed) => {
    const rnd = seeded(seed);
    const frames = Array.from({ length: 3000 }, () => {
      const gpu = rnd() < 0.08 ? 10 + rnd() * 60 : rnd() * 16; // a few GPU spikes
      const cpu = rnd() < 0.45 + 0.1 * Math.sin(seed) ? 12 + rnd() * 10 : rnd() * 8; // CPU near budget
      return [gpu, cpu];
    });
    frames.push(...Array.from({ length: 70 }, () => [16.7, 16.7]), ...Array.from({ length: 70 }, () => [16.71, 1])); // exact edges
    const drops = [];
    let i = 0;
    const q = new AdaptiveQuality({});
    const seen = new AdaptiveQuality({
      onDrop: () => drops.push({ i, gpuP95: seen.lastDrop.gpuP95, cpuMedian: seen.lastDrop.cpuMedian }),
    });
    for (; i < frames.length; i++) {
      const [gpu, cpu] = frames[i];
      seen.frame(Math.max(gpu, cpu), { interval: 16.7, cpu, gpu });
    }
    expect(q.dropped).toBe(0);
    const ref = referenceDrops(frames);
    expect(ref.length).toBeGreaterThan(0);
    expect(drops).toEqual(ref);
  });
});

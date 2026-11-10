import { TIERS, TIER_ORDER, effectiveTier, tierFromProbe, AdaptiveQuality } from '../../src/render/quality.js';

test('tier table: exactly four tiers, interiorSteps 0 only at low', () => {
  expect(Object.keys(TIERS)).toEqual(['low', 'medium', 'high', 'ultra']);
  expect(TIER_ORDER).toEqual(['low', 'medium', 'high', 'ultra']);
  for (const t of TIER_ORDER) expect(TIERS[t].interiorSteps === 0).toBe(t === 'low');
  expect(TIERS.high).toEqual({ pixelRatio: 1.5, interiorSteps: 32, transmissionScale: 1, envResolution: 256, anisotropy: true });
  expect(TIERS.low.anisotropy).toBe(false);
});

test('effectiveTier', () => {
  expect(effectiveTier({ choice: 'auto', autoTier: 'ultra', cap: 'high', dropped: 0 })).toBe('high');
  expect(effectiveTier({ choice: 'ultra', autoTier: 'low', cap: 'medium', dropped: 0 })).toBe('medium');
  expect(effectiveTier({ choice: 'high', autoTier: 'low', cap: 'ultra', dropped: 1 })).toBe('medium');
  expect(effectiveTier({ choice: 'high', autoTier: 'low', cap: 'ultra', dropped: 9 })).toBe('low');
  expect(effectiveTier({ choice: 'auto', autoTier: 'medium', cap: 'ultra', dropped: 0 })).toBe('medium');
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

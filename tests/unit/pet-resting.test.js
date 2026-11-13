import { restSpot, fitArea, offPoint, edgeSpot, PET_HEIGHT } from '../../src/pet/chunk/resting.js';
import { CREATURES } from '../../src/pet/chunk/creatures/index.js';
import { mulberry32 } from '../../src/core/rng.js';

const AREA = { cx: 1, cz: -2, halfWidth: 14, halfDepth: 9 };
const H = 1.5;

test('restSpot honours edges, the inner 60% and spacing for 200 seeded tries', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rand = mulberry32(seed);
    const taken = [
      { x: AREA.cx + 12, z: AREA.cz },
      { x: AREA.cx - 11, z: AREA.cz + 6 },
    ];
    const { x, z } = restSpot(AREA, H, taken, rand);
    const dx = Math.abs(x - AREA.cx);
    const dz = Math.abs(z - AREA.cz);
    expect(dx).toBeLessThanOrEqual(AREA.halfWidth - 1.2 * H + 1e-9);
    expect(dz).toBeLessThanOrEqual(AREA.halfDepth - 1.2 * H + 1e-9);
    expect(dx > 0.6 * AREA.halfWidth || dz > 0.6 * AREA.halfDepth).toBe(true);
    for (const o of taken) expect(Math.hypot(x - o.x, z - o.z)).toBeGreaterThanOrEqual(2 * H - 1e-9);
  }
});

test('a crowded area returns the best candidate without throwing', () => {
  const small = { cx: 0, cz: 0, halfWidth: 3, halfDepth: 2 };
  const taken = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }];
  const spot = restSpot(small, H, taken, mulberry32(7));
  expect(Number.isFinite(spot.x) && Number.isFinite(spot.z)).toBe(true);
  // The best candidate is no worse than the first one drawn.
  const first = mulberry32(7);
  const x = (first() * 2 - 1) * 0.6;
  const z = (first() * 2 - 1) * 0.2;
  const d = (p) => Math.min(...taken.map((o) => Math.hypot(p.x - o.x, p.z - o.z)));
  expect(d(spot)).toBeGreaterThanOrEqual(Math.min(d({ x, z }), 2 * H));
  expect(() => restSpot({ cx: 0, cz: 0, halfWidth: 0.5, halfDepth: 0.5 }, H, taken, () => 0.5)).not.toThrow();
});

test('deterministic for a fixed rand', () => {
  const a = restSpot(AREA, H, [], mulberry32(42));
  const b = restSpot(AREA, H, [], mulberry32(42));
  expect(a).toEqual(b);
  expect(restSpot(AREA, H, [], mulberry32(43))).not.toEqual(a);
});

test('fitArea shrinks and shifts an area into the stage', () => {
  const stage = { cx: 0, cz: 0, halfWidth: 10, halfDepth: 6 };
  expect(fitArea({ cx: 9, cz: 0, halfWidth: 4, halfDepth: 3 }, stage)).toEqual({ cx: 6, cz: 0, halfWidth: 4, halfDepth: 3 });
  expect(fitArea({ cx: 0, cz: 0, halfWidth: 30, halfDepth: 30 }, stage)).toEqual({ cx: 0, cz: 0, halfWidth: 10, halfDepth: 6 });
});

test('offPoint leaves through the area edge', () => {
  const o = offPoint({ cx: 0, cz: 0, halfWidth: 10, halfDepth: 6 }, { x: 4, z: 0 }, H);
  expect(o.x).toBeCloseTo(10 + 1.5 * H);
  expect(o.z).toBeCloseTo(0);
});

test('edgeSpot is the inset edge place', () => {
  const s = edgeSpot(0, AREA, H);
  expect(s.base.x).toBeCloseTo(AREA.cx + AREA.halfWidth - 0.6 * H);
});

test('PET_HEIGHT matches every creature', () => {
  for (const make of Object.values(CREATURES)) {
    const c = make('#ffffff');
    expect(c.height).toBe(PET_HEIGHT);
    c.dispose();
  }
});

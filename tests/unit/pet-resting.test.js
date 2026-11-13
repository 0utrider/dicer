import { restSpot, fitArea, offPoint, edgeSpot, PET_HEIGHT, KIND_FOOTPRINT, BODY, RING_IN, RING_OUT } from '../../src/pet/chunk/resting.js';
import { CREATURES } from '../../src/pet/chunk/creatures/index.js';
import { mulberry32 } from '../../src/core/rng.js';

const AREA = { cx: 1, cz: -2, halfWidth: 14, halfDepth: 9 };
const H = 1.5;

/** How far out a spot is, as a share of the area's half size: the larger of the two axes. */
const ringOf = (area, p) => Math.max(Math.abs(p.x - area.cx) / area.halfWidth, Math.abs(p.z - area.cz) / area.halfDepth);

test('the ring is 35% to 60% of the area', () => {
  expect(RING_IN).toBe(0.35);
  expect(RING_OUT).toBe(0.6);
});

test('restSpot honours edges, the 35-60% ring and spacing for 200 seeded tries', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rand = mulberry32(seed);
    const taken = [
      { x: AREA.cx + 6, z: AREA.cz },
      { x: AREA.cx - 5, z: AREA.cz + 3 },
    ];
    const { x, z } = restSpot(AREA, H, taken, rand);
    const dx = Math.abs(x - AREA.cx);
    const dz = Math.abs(z - AREA.cz);
    expect(dx).toBeLessThanOrEqual(AREA.halfWidth - 1.2 * H + 1e-9);
    expect(dz).toBeLessThanOrEqual(AREA.halfDepth - 1.2 * H + 1e-9);
    const r = ringOf(AREA, { x, z });
    expect(r, `seed ${seed}`).toBeGreaterThanOrEqual(RING_IN - 1e-9);
    expect(r, `seed ${seed}`).toBeLessThanOrEqual(RING_OUT + 1e-9);
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
    expect(c.footprint).toBe(KIND_FOOTPRINT[c.root.name]);
    c.dispose();
  }
});

test('a NaN rand never yields null', () => {
  expect(restSpot(AREA, H, [], () => NaN)).toEqual({ x: AREA.cx, z: AREA.cz });
});

// ---- Foundry's UI kept clear (final review I-4) ----
/** Whether a disc of radius pad at p overlaps the rectangle r. */
const overlaps = (p, r, pad) =>
  Math.hypot(Math.max(r.x0 - p.x, 0, p.x - r.x1), Math.max(r.z0 - p.z, 0, p.z - r.z1)) < pad;

test('restSpot keeps the pet body off every exclusion rectangle for 200 seeded tries', () => {
  // the left column and the bottom band of the area are taken by UI
  const avoid = [
    { x0: AREA.cx - AREA.halfWidth, x1: AREA.cx - 8, z0: AREA.cz - AREA.halfDepth, z1: AREA.cz + AREA.halfDepth },
    { x0: AREA.cx - 6, x1: AREA.cx + 6, z0: AREA.cz + 5, z1: AREA.cz + AREA.halfDepth },
  ];
  for (let seed = 1; seed <= 200; seed++) {
    const spot = restSpot(AREA, H, [], mulberry32(seed), avoid);
    for (const r of avoid) expect(overlaps(spot, r, BODY * H - 1e-9), `seed ${seed}`).toBe(false);
    const ring = ringOf(AREA, spot);
    expect(ring, `seed ${seed}`).toBeGreaterThanOrEqual(RING_IN - 1e-9);
    expect(ring, `seed ${seed}`).toBeLessThanOrEqual(RING_OUT + 1e-9);
  }
});

test('without exclusions (or with an empty list) restSpot draws as before', () => {
  for (const seed of [1, 2, 3])
    expect(restSpot(AREA, H, [], mulberry32(seed), [])).toEqual(restSpot(AREA, H, [], mulberry32(seed)));
});

test('an area covered by UI still gives a finite best candidate, in bounded tries', () => {
  const all = [{ x0: -100, x1: 100, z0: -100, z1: 100 }];
  let draws = 0;
  const rand = mulberry32(5);
  const spot = restSpot(AREA, H, [], () => (draws++, rand()), all);
  expect(Number.isFinite(spot.x) && Number.isFinite(spot.z)).toBe(true);
  expect(draws).toBe(2 * 24);
});

// ---- away from the cursor (pet dodge Task 2) ----
test('restSpot honours away.min over 200 seeds, with the farthest fallback', () => {
  const taken = [{ x: AREA.cx + 6, z: AREA.cz }];
  for (let seed = 1; seed <= 200; seed++) {
    // the cursor at a resting spot of the ring
    const away = { x: AREA.cx - 6, z: AREA.cz + 3, min: 4 };
    const spot = restSpot(AREA, H, taken, mulberry32(seed), [], away);
    expect(Math.hypot(spot.x - away.x, spot.z - away.z), `seed ${seed}`).toBeGreaterThanOrEqual(4 - 1e-9);
    const r = ringOf(AREA, spot);
    expect(r, `seed ${seed}`).toBeGreaterThanOrEqual(RING_IN - 1e-9);
    expect(r, `seed ${seed}`).toBeLessThanOrEqual(RING_OUT + 1e-9);
    for (const o of taken) expect(Math.hypot(spot.x - o.x, spot.z - o.z)).toBeGreaterThanOrEqual(2 * H - 1e-9);
  }
  // no spot is far enough: the farthest valid candidate of the 24 drawn
  const ex = Math.min(AREA.halfWidth - 1.2 * H, 0.6 * AREA.halfWidth);
  const ez = Math.min(AREA.halfDepth - 1.2 * H, 0.6 * AREA.halfDepth);
  for (let seed = 1; seed <= 200; seed++) {
    const away = { x: AREA.cx + 1, z: AREA.cz - 1, min: 1000 };
    const spot = restSpot(AREA, H, [], mulberry32(seed), [], away);
    const r = ringOf(AREA, spot);
    expect(r, `seed ${seed}`).toBeGreaterThanOrEqual(RING_IN - 1e-9);
    expect(r, `seed ${seed}`).toBeLessThanOrEqual(RING_OUT + 1e-9);
    const rand = mulberry32(seed);
    let far = -Infinity;
    for (let i = 0; i < 24; i++) {
      const c = { x: AREA.cx + (rand() * 2 - 1) * ex, z: AREA.cz + (rand() * 2 - 1) * ez };
      const cr = ringOf(AREA, c);
      if (cr >= RING_IN && cr <= RING_OUT) far = Math.max(far, Math.hypot(c.x - away.x, c.z - away.z));
    }
    expect(Math.hypot(spot.x - away.x, spot.z - away.z), `seed ${seed}`).toBeCloseTo(far, 9);
  }
});

test('without away restSpot draws as before', () => {
  for (const seed of [1, 2, 3])
    expect(restSpot(AREA, H, [], mulberry32(seed), [], undefined)).toEqual(restSpot(AREA, H, [], mulberry32(seed)));
});

// ---- R7: clear (the thrower-layout case of Task 9: off the replay's die paths) ----
test('restSpot honours away over 200 seeded tries (R7: the `clear` predicate, 7th parameter)', () => {
  const clear = (p) => p.x < AREA.cx; // the paths cover the right half
  for (let seed = 1; seed <= 200; seed++) {
    const spot = restSpot(AREA, H, [], mulberry32(seed), [], null, clear);
    expect(clear(spot), `seed ${seed}`).toBe(true);
    const r = ringOf(AREA, spot);
    expect(r, `seed ${seed}`).toBeGreaterThanOrEqual(RING_IN - 1e-9);
    expect(r, `seed ${seed}`).toBeLessThanOrEqual(RING_OUT + 1e-9);
  }
  // with the cursor dodge too: both hold
  const away = { x: AREA.cx - 6, z: AREA.cz + 3, min: 4 };
  for (let seed = 1; seed <= 200; seed++) {
    const spot = restSpot(AREA, H, [], mulberry32(seed), [], away, clear);
    expect(clear(spot), `seed ${seed}`).toBe(true);
  }
  // a predicate always true draws exactly as without it; one never true still gives a spot
  expect(restSpot(AREA, H, [], mulberry32(5), [], null, () => true)).toEqual(restSpot(AREA, H, [], mulberry32(5)));
  const none = restSpot(AREA, H, [], mulberry32(5), [], null, () => false);
  expect(Number.isFinite(none.x) && Number.isFinite(none.z)).toBe(true);
});

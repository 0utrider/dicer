import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { createSim, initPhysics, prewarm } from '../../src/physics/sim.js';
import { computeHulls } from '../../src/physics/hulls.js';
import { FLOATS_PER_DIE, MAX_STEPS } from '../../src/physics/protocol.js';

const area = { halfWidth: 12, halfDepth: 7 };

const hulls = computeHulls();

beforeAll(async () => {
  await initPhysics(
    readFileSync('node_modules/@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm'),
  );
  // The worker pre-warms every type before it reports ready; do the same here.
  const s = createSim(area, hulls);
  prewarm(s, [...Object.keys(hulls), 'd2']);
  s.dispose();
});

function run(dice, seed) {
  const sim = createSim(area, hulls);
  const chunks = [];
  const res = sim.throw({ dice: dice.map((type) => ({ type })), seed }, (c) =>
    chunks.push({ ...c, data: c.data.slice() }),
  );
  sim.dispose();
  return { res, chunks };
}

test('same seed gives identical frames', () => {
  const a = run(['d20', 'd6', 'd6'], 7);
  const b = run(['d20', 'd6', 'd6'], 7);
  expect(a.chunks.map((c) => Array.from(c.data))).toEqual(b.chunks.map((c) => Array.from(c.data)));
});

test.each([1, 10, 30])('%i dice settle inside the area before MAX_STEPS', (n) => {
  const { res, chunks } = run(Array(n).fill('d6'), 3);
  expect(res.settledStep).toBeLessThan(MAX_STEPS);
  const last = chunks.at(-1);
  expect(last.done).toBe(true);
  const base = (last.steps - 1) * n * FLOATS_PER_DIE;
  for (let d = 0; d < n; d++) {
    const o = base + d * FLOATS_PER_DIE;
    expect(Math.abs(last.data[o])).toBeLessThan(area.halfWidth);
    expect(Math.abs(last.data[o + 2])).toBeLessThan(area.halfDepth);
  }
});

test('dice start outside the area', () => {
  const { chunks } = run(['d20'], 11);
  const [x, , z] = chunks[0].data;
  expect(Math.abs(x) > area.halfWidth || Math.abs(z) > area.halfDepth).toBe(true);
});

test('first chunk arrives in under 50 ms for 30 dice', () => {
  const sim = createSim(area, hulls);
  const t0 = performance.now();
  let first = null;
  sim.throw({ dice: Array(30).fill({ type: 'd6' }), seed: 1 }, () => (first ??= performance.now()));
  sim.dispose();
  expect(first - t0).toBeLessThan(50);
});

test('a transferred (detached) pooled buffer is discarded, a live one is reused', () => {
  const sim = createSim(area, hulls);
  const seen = [];
  const req = { dice: [{ type: 'd6' }], seed: 5 };
  sim.throw(req, (c) => seen.push(c.data));
  const first = seen[0];
  const detached = new Float32Array(first.buffer.slice(0));
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  sim.recycle(detached); // byteLength 0: must be dropped
  sim.recycle(first); // live: pooled
  const again = [];
  sim.throw(req, (c) => again.push(c.data));
  expect(again[0].buffer).toBe(first.buffer);
  expect(again[0].buffer.byteLength).toBeGreaterThan(0);
  sim.dispose();
});

test('coin piles come to rest well before MAX_STEPS', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { res } = run(Array(10).fill('d2'), seed);
    expect(res.settledStep).toBeLessThan(MAX_STEPS);
  }
});

test('every die type settles inside the area', () => {
  for (const type of ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
    const { res, chunks } = run(Array(12).fill(type), 9);
    expect(res.settledStep).toBeLessThan(MAX_STEPS);
    const last = chunks.at(-1);
    const base = (last.steps - 1) * 12 * FLOATS_PER_DIE;
    for (let d = 0; d < 12; d++) {
      expect(Math.abs(last.data[base + d * FLOATS_PER_DIE])).toBeLessThan(area.halfWidth);
      expect(Math.abs(last.data[base + d * FLOATS_PER_DIE + 2])).toBeLessThan(area.halfDepth);
    }
  }
});

test('hulls are round convex hulls: shrunk points plus a border radius (P2-R4)', () => {
  for (const [type, h] of Object.entries(hulls)) {
    expect(h.points, type).toBeInstanceOf(Float32Array);
    expect(h.points.length % 3, type).toBe(0);
    expect(h.radius, type).toBeGreaterThan(0);
    for (let i = 0; i < h.points.length; i += 3)
      expect(Math.hypot(h.points[i], h.points[i + 1], h.points[i + 2]) + h.radius).toBeLessThan(1);
  }
});

test('30 d20 whole throw stays cheap after pre-warm (relative to a same-process baseline)', () => {
  // Best of 7 so a GC pause or a busy parallel test worker doesn't fail a regression guard
  // (measured ~25 ms in isolation; the mesh-vertex hulls of 2189502 took 60-220 ms).
  // The d20 time is compared with a same-process calibration (30 d6 hulls; ~1.1x d20 cost), so
  // CPU contention that slows both equally cancels out. A 2x+ regression still trips it.
  const timeBest = (type, seeds) => {
    const sim = createSim(area, hulls);
    let best = Infinity;
    for (const seed of seeds) {
      const t0 = performance.now();
      sim.throw({ dice: Array(30).fill({ type }), seed }, (c) => sim.recycle(c.data));
      best = Math.min(best, performance.now() - t0);
    }
    sim.dispose();
    return best;
  };
  const seeds = [3, 4, 5, 6, 7, 8, 9];
  const baseline = timeBest('d6', seeds);
  const d20 = timeBest('d20', seeds);
  expect(d20).toBeLessThan(2.5 * baseline);
  expect(d20).toBeLessThan(120);
});

test('a missing hull is an error, not a silent fallback', () => {
  const sim = createSim(area, {});
  expect(() => sim.throw({ dice: [{ type: 'd6' }], seed: 1 }, () => {})).toThrow(/no hull/);
});

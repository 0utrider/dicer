import { beforeAll, expect, test } from 'vitest';
import { createSim, initPhysics } from '../../src/physics/sim.js';
import { FLOATS_PER_DIE, MAX_STEPS } from '../../src/physics/protocol.js';

const area = { halfWidth: 12, halfDepth: 7 };

beforeAll(async () => {
  await initPhysics();
  // Warm up hull building and the WASM paths so the timing test is not measuring a cold start.
  const s = createSim(area);
  s.throw({ dice: [{ type: 'd6' }], seed: 0 }, () => {});
  s.dispose();
});

function run(dice, seed) {
  const sim = createSim(area);
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
  const sim = createSim(area);
  const t0 = performance.now();
  let first = null;
  sim.throw({ dice: Array(30).fill({ type: 'd6' }), seed: 1 }, () => (first ??= performance.now()));
  sim.dispose();
  expect(first - t0).toBeLessThan(50);
});

test('a transferred (detached) pooled buffer is discarded, a live one is reused', () => {
  const sim = createSim(area);
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

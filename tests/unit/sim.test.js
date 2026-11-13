import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeAll, expect, test } from 'vitest';
import { getShape } from '../../src/core/dice-shapes.js';
import { faceNormals, readTopFace } from '../../src/core/face-reader.js';
import { createSim, initPhysics, prewarm } from '../../src/physics/sim.js';
import { computeHulls } from '../../src/physics/hulls.js';
import { throwEdge } from '../../src/core/rng.js';
import { fitDieCapacity } from '../../src/areas/area-model.js';
import { FLOATS_PER_DIE, IMPACT_FLOATS, MAX_STEPS } from '../../src/physics/protocol.js';

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

test('d14, d16 and d4crystal bodies use their hulls and settle inside the area', () => {
  for (const type of ['d14', 'd16', 'd4crystal']) {
    const { res, chunks } = run(Array(12).fill(type), 9);
    expect(res.settledStep, type).toBeLessThan(MAX_STEPS);
    const last = chunks.at(-1);
    const base = (last.steps - 1) * 12 * FLOATS_PER_DIE;
    for (let d = 0; d < 12; d++) {
      expect(Math.abs(last.data[base + d * FLOATS_PER_DIE])).toBeLessThan(area.halfWidth);
      expect(Math.abs(last.data[base + d * FLOATS_PER_DIE + 2])).toBeLessThan(area.halfDepth);
    }
  }
});

test('the worker tells the coin by type: d2 is the only coin shape', () => {
  // sim.js checks type === 'd2' so the worker bundle does not carry dice-shapes.
  for (const t of [...Object.keys(hulls), 'd2']) expect(getShape(t).kind === 'coin', t).toBe(t === 'd2');
  const src = readFileSync('src/physics/sim.js', 'utf8');
  expect(src).not.toMatch(/dice-shapes/);
});

/** Settled up-component of the crystal's read face for one single-die throw. */
function crystalRest(seed, stage) {
  const shape = getShape('d4crystal');
  const { res, chunks } = runEv(['d4crystal'], seed, stage);
  expect(res.settledStep, `seed ${seed}`).toBeLessThan(MAX_STEPS);
  const last = chunks.at(-1);
  const o = (last.steps - 1) * FLOATS_PER_DIE;
  const q = new THREE.Quaternion(...last.data.slice(o + 3, o + 7));
  const top = readTopFace(shape, q);
  expect(shape.readFaces).toContain(top);
  return new THREE.Vector3().copy(faceNormals(shape)[top]).applyQuaternion(q).y;
}

test('a d4crystal dropped from 20 random orientations rests on a long face', () => {
  // A wide stage, so the drop lands in the open: by a wall the long crystal can lean on it.
  const open = { halfWidth: 40, halfDepth: 40 };
  for (let seed = 1; seed <= 20; seed++) expect(crystalRest(seed, open), `seed ${seed}`).toBeGreaterThan(0.99);
  // In the usual stage it never stands on a tip (that would put every long face sideways); a
  // few lean on a wall or are called settled mid-roll between two long faces (like a d8 today).
  for (let seed = 1; seed <= 100; seed++) expect(crystalRest(seed, area), `seed ${seed}`).toBeGreaterThan(0.7);
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

test('30 d6 simulate to rest within the absolute 250 ms budget (best of 7)', () => {
  // Plan 8 H-D: the absolute budget the relative d20/d6 guard cannot give. Best of 7 so a GC
  // pause or a busy parallel worker does not fail it; measured medians are in the Task 7 report.
  const sim = createSim(area, hulls);
  let best = Infinity;
  for (const seed of [3, 4, 5, 6, 7, 8, 9]) {
    const t0 = performance.now();
    const res = sim.throw({ dice: Array(30).fill({ type: 'd6' }), seed }, (c) => sim.recycle(c.data));
    best = Math.min(best, performance.now() - t0);
    expect(res.settledStep).toBeLessThan(MAX_STEPS);
  }
  sim.dispose();
  expect(best).toBeLessThanOrEqual(250);
});

test('a missing hull is an error, not a silent fallback', () => {
  const sim = createSim(area, {});
  expect(() => sim.throw({ dice: [{ type: 'd6' }], seed: 1 }, () => {})).toThrow(/no hull/);
});

const eventsOf = (chunks) => chunks.flatMap((c) => Array.from(c.events ?? []));

test('a throw reports floor impacts', () => {
  const { chunks } = run(['d6', 'd6', 'd6'], 5);
  const ev = eventsOf(chunks);
  expect(ev.length % IMPACT_FLOATS).toBe(0);
  const list = [];
  for (let i = 0; i < ev.length; i += IMPACT_FLOATS) {
    list.push({ step: ev[i], die: ev[i + 1], other: ev[i + 2], speed: ev[i + 3] });
  }
  expect(list.some((e) => e.other === -1)).toBe(true);
  for (const e of list) {
    expect(e.die).toBeGreaterThanOrEqual(0);
    expect(e.die).toBeLessThan(3);
    expect(e.speed).toBeGreaterThanOrEqual(0);
  }
  for (let i = 1; i < list.length; i++) expect(list[i].step).toBeGreaterThanOrEqual(list[i - 1].step);
  for (const c of chunks) expect(c.events.length % IMPACT_FLOATS).toBe(0);
});

test('same seed gives identical events', () => {
  const a = run(['d20', 'd6', 'd6'], 7);
  const b = run(['d20', 'd6', 'd6'], 7);
  expect(eventsOf(a.chunks).length).toBeGreaterThan(0);
  expect(eventsOf(a.chunks)).toEqual(eventsOf(b.chunks));
});

test('impacts fade out', () => {
  const { res, chunks } = run(['d6', 'd6', 'd6'], 5);
  const ev = eventsOf(chunks);
  const floor = [];
  for (let i = 0; i < ev.length; i += IMPACT_FLOATS) {
    if (ev[i] <= res.settledStep) floor.push({ other: ev[i + 2], speed: ev[i + 3] });
  }
  const first = floor.find((e) => e.other === -1);
  expect(first.speed).toBeGreaterThan(4 * floor.at(-1).speed);
});

/** FNV-1a over the raw bytes of every chunk's frames and events. */
function framesHash(chunks) {
  let h = 0x811c9dc5;
  for (const c of chunks) {
    for (const arr of [c.data, c.events ?? new Float32Array(0)]) {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
    }
  }
  return h.toString(16);
}

/** Runs one throw (optionally with a per-throw area) keeping copies of frames and events. */
function runEv(dice, seed, stage, throwArea) {
  const sim = createSim(stage, hulls);
  const chunks = [];
  const req = { dice: dice.map((type) => ({ type })), seed };
  if (throwArea !== undefined) req.area = throwArea;
  const res = sim.throw(req, (c) =>
    chunks.push({ ...c, data: c.data.slice(), events: c.events.slice() }),
  );
  sim.dispose();
  return { res, chunks };
}

// Recorded from the code before per-throw areas existed (commit 19b15a5).
test('no area: frames and events are identical to before per-throw areas', () => {
  expect(framesHash(runEv(['d20', 'd6', 'd6'], 7, area).chunks)).toBe('1118cbd0');
  const small = { halfWidth: 9, halfDepth: 5 };
  expect(framesHash(runEv(['d8', 'd10', 'd12', 'd4', 'd2'], 42, small).chunks)).toBe('1662dbb4');
});

test("throwEdge matches the worker's spawn edge", () => {
  for (const seed of [1, 2, 3, 42, 99, 123456, 2 ** 31]) {
    const edge = throwEdge(seed);
    const [x, , z] = runEv(['d6'], seed, area).chunks[0].data;
    const sign = edge % 2 === 0 ? 1 : -1;
    if (edge < 2) expect(x * sign, `seed ${seed} edge ${edge}`).toBeGreaterThan(area.halfWidth);
    else expect(z * sign, `seed ${seed} edge ${edge}`).toBeGreaterThan(area.halfDepth);
  }
  // The seeds cover more than one edge, or the test proves nothing.
  expect(new Set([1, 2, 3, 42, 99, 123456, 2 ** 31].map(throwEdge)).size).toBeGreaterThan(1);
});

const offset = { cx: 6, cz: 3, halfWidth: 4, halfDepth: 3 };

test('dice settle inside an offset area', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const n = 6;
    const { res, chunks } = runEv(Array(n).fill('d6'), seed, area, offset);
    expect(res.settledStep).toBeLessThan(MAX_STEPS);
    const last = chunks.at(-1);
    const base = (last.steps - 1) * n * FLOATS_PER_DIE;
    for (let d = 0; d < n; d++) {
      const o = base + d * FLOATS_PER_DIE;
      // A die's centre stays at least ~its inradius from the walls; allow its full radius.
      expect(Math.abs(last.data[o] - offset.cx), `seed ${seed} die ${d} x`).toBeLessThan(
        offset.halfWidth + 1,
      );
      expect(Math.abs(last.data[o + 2] - offset.cz), `seed ${seed} die ${d} z`).toBeLessThan(
        offset.halfDepth + 1,
      );
    }
  }
});

test('an offset throw starts outside its own area; its settled die is not left short of it', () => {
  const { chunks } = runEv(['d20'], 11, area, offset);
  const [x, , z] = chunks[0].data;
  expect(Math.abs(x - offset.cx) > offset.halfWidth || Math.abs(z - offset.cz) > offset.halfDepth).toBe(
    true,
  );
  const last = chunks.at(-1);
  const o = (last.steps - 1) * FLOATS_PER_DIE;
  expect(last.data[o]).toBeGreaterThan(offset.cx - offset.halfWidth - 1);
  expect(last.data[o + 2]).toBeGreaterThan(offset.cz - offset.halfDepth - 1);
});

test('same seed + same area gives identical frames and events', () => {
  const a = runEv(['d20', 'd6', 'd6'], 7, area, offset);
  const b = runEv(['d20', 'd6', 'd6'], 7, area, offset);
  expect(framesHash(a.chunks)).toBe(framesHash(b.chunks));
  // ... and a different area changes the throw.
  expect(framesHash(a.chunks)).not.toBe(framesHash(runEv(['d20', 'd6', 'd6'], 7, area).chunks));
});

test('a per-throw area does not change the stage area of later throws', () => {
  const sim = createSim(area, hulls);
  const req = { dice: [{ type: 'd6' }], seed: 7 };
  sim.throw({ ...req, area: offset }, (c) => sim.recycle(c.data));
  const chunks = [];
  sim.throw({ dice: [{ type: 'd20' }, { type: 'd6' }, { type: 'd6' }], seed: 7 }, (c) =>
    chunks.push({ ...c, data: c.data.slice(), events: c.events.slice() }),
  );
  sim.dispose();
  expect(framesHash(chunks)).toBe('1118cbd0');
});

test('a malformed area falls back to the stage', () => {
  for (const bad of [{ cx: NaN, cz: 0, halfWidth: 4, halfDepth: 3 }, { halfWidth: 0 }, 'x', null]) {
    expect(framesHash(runEv(['d20', 'd6', 'd6'], 7, area, bad).chunks)).toBe('1118cbd0');
  }
});

/** Every die's first frame and its settled frame for one throw into `throwArea`. */
function firstAndLast(chunks, n) {
  const first = chunks[0].data;
  const last = chunks.at(-1);
  const base = (last.steps - 1) * n * FLOATS_PER_DIE;
  const out = [];
  for (let d = 0; d < n; d++) {
    const f = d * FLOATS_PER_DIE;
    const o = base + d * FLOATS_PER_DIE;
    out.push({ x0: first[f], z0: first[f + 2], x: last.data[o], z: last.data[o + 2] });
  }
  return out;
}

test('P5-R5: dice spawn off-screen beyond the stage edge and settle inside an inner area', () => {
  const centre = { cx: 0, cz: 0, halfWidth: 4, halfDepth: 3 };
  for (let seed = 1; seed <= 20; seed++) {
    const n = 5;
    const { res, chunks } = runEv(Array(n).fill('d6'), seed, area, centre);
    expect(res.settledStep, `seed ${seed}`).toBeLessThan(MAX_STEPS);
    for (const [d, p] of firstAndLast(chunks, n).entries()) {
      const tag = `seed ${seed} die ${d}`;
      expect(Math.abs(p.x0) > area.halfWidth || Math.abs(p.z0) > area.halfDepth, tag).toBe(true);
      expect(Math.abs(p.x - centre.cx), tag).toBeLessThan(centre.halfWidth + 1);
      expect(Math.abs(p.z - centre.cz), tag).toBeLessThan(centre.halfDepth + 1);
    }
  }
});

test('P5-R5: far corner areas settle inside the area within MAX_STEPS (20 seeds)', () => {
  // The 'corner' preset on a 12 x 7 stage is roughly this; also the opposite corner.
  const corners = [
    { cx: 7.44, cz: 2.45, halfWidth: 4.56, halfDepth: 3.15 },
    { cx: -7.44, cz: -2.45, halfWidth: 4.56, halfDepth: 3.15 },
  ];
  for (const c of corners) {
    for (let seed = 1; seed <= 20; seed++) {
      const n = 5;
      const { res, chunks } = runEv(['d20', 'd6', 'd8', 'd10', 'd4'], seed, area, c);
      expect(res.settledStep, `seed ${seed}`).toBeLessThan(MAX_STEPS);
      for (const [d, p] of firstAndLast(chunks, n).entries()) {
        const tag = `cx ${c.cx} seed ${seed} die ${d}`;
        expect(Math.abs(p.x0) > area.halfWidth || Math.abs(p.z0) > area.halfDepth, tag).toBe(true);
        expect(Math.abs(p.x - c.cx), tag).toBeLessThan(c.halfWidth + 1);
        expect(Math.abs(p.z - c.cz), tag).toBeLessThan(c.halfDepth + 1);
      }
    }
  }
});

test('P5-R6: 12 d6 in a minimum-size area (grown for capacity) settle inside it on >= 19/20 seeds', () => {
  // MIN_AREA_PX (240 x 180) at 48 px per die, centred and in the top-right corner.
  const min = { halfWidth: 2.5, halfDepth: 1.875 };
  const places = [
    { cx: 0, cz: 0, ...min },
    { cx: area.halfWidth - min.halfWidth, cz: -(area.halfDepth - min.halfDepth), ...min },
  ];
  for (const raw of places) {
    const a = fitDieCapacity(raw, 12, area);
    let ok = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { res, chunks } = runEv(Array(12).fill('d6'), seed, area, a);
      const inside = firstAndLast(chunks, 12).every(
        (p) => Math.abs(p.x - a.cx) < a.halfWidth + 1 && Math.abs(p.z - a.cz) < a.halfDepth + 1,
      );
      if (res.settledStep < MAX_STEPS && inside) ok++;
    }
    expect(ok, `area at ${raw.cx}, ${raw.cz}`).toBeGreaterThanOrEqual(19);
  }
});

// --- pet obstacles --------------------------------------------------------------------------

/** runEv with obstacles (and an optional test start) on the request. */
function runObs(dice, seed, extra) {
  const sim = createSim(area, hulls);
  const chunks = [];
  const req = { dice: dice.map((type) => ({ type })), seed, ...extra };
  const res = sim.throw(req, (c) =>
    chunks.push({ ...c, data: c.data.slice(), events: c.events.slice() }),
  );
  sim.dispose();
  return { res, chunks };
}

/** Every impact event [frame, die, other, speed] of a run. */
function impactsOf(chunks) {
  const out = [];
  for (const c of chunks) {
    for (let i = 0; i < c.events.length; i += IMPACT_FLOATS) {
      out.push({ frame: c.events[i], die: c.events[i + 1], other: c.events[i + 2], speed: c.events[i + 3] });
    }
  }
  return out;
}

/** Where a lone d6 of `seed` is on the floor-level part of its flight (a point on its path). */
function pathPoint(seed, below = 1.2) {
  const { chunks } = runObs(['d6'], seed);
  const frames = chunks.flatMap((c) => {
    const rows = [];
    for (let s = 0; s < c.steps; s++) rows.push(Array.from(c.data.slice(s * 7, s * 7 + 3)));
    return rows;
  });
  const hit = frames.slice(20).find((p) => p[1] < below);
  return { x: hit[0], z: hit[2] };
}

const FAR = { x: -11, z: -6, r: 0.3, h: 1 }; // a corner no seed-5 die passes through
test('a throw without obstacles is byte-identical to before', () => {
  expect(framesHash(runObs(['d20', 'd6', 'd6'], 7, { obstacles: [] }).chunks)).toBe('1118cbd0');
});

test('a die aimed at an obstacle reports an impact with other -3', () => {
  const p = pathPoint(5);
  const { chunks } = runObs(['d6'], 5, { obstacles: [{ ...p, r: 0.5, h: 1.5 }] });
  const hits = impactsOf(chunks).filter((e) => e.other === -3);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].speed).toBeGreaterThan(0);
  expect(hits[0].die).toBe(0);
});

test('the second obstacle reports -4', () => {
  const p = pathPoint(5);
  const { chunks } = runObs(['d6'], 5, { obstacles: [FAR, { ...p, r: 0.5, h: 1.5 }] });
  const others = impactsOf(chunks).map((e) => e.other);
  expect(others).toContain(-4);
  expect(others).not.toContain(-3);
});

test("a die dropped onto an obstacle's top slides off", () => {
  // No manual-start seam exists (and adding one costs world-start bytes), so aim: the pet stands
  // under the die's path where it is still 3 units up, so the die comes down on its top.
  const restY = (chunks) => {
    const last = chunks.at(-1);
    return last.data[(last.steps - 1) * FLOATS_PER_DIE + 1];
  };
  const flat = restY(runObs(['d6'], 5).chunks);
  const p = pathPoint(5, 3);
  const onPet = runObs(['d6'], 5, { obstacles: [{ ...p, r: 0.5, h: 1.5 }] });
  const hit = impactsOf(onPet.chunks).find((e) => e.other === -3);
  expect(hit).toBeDefined();
  expect(Math.abs(restY(onPet.chunks) - flat)).toBeLessThan(0.05);
});

test('more than 3 obstacles: only the first 3 exist', () => {
  const p = pathPoint(5);
  const three = [FAR, { ...FAR, x: -10 }, { ...FAR, x: -9 }];
  const withFourth = runObs(['d6'], 5, { obstacles: [...three, { ...p, r: 0.5, h: 1.5 }] });
  expect(impactsOf(withFourth.chunks).some((e) => e.other <= -6)).toBe(false);
  expect(framesHash(withFourth.chunks)).toBe(framesHash(runObs(['d6'], 5, { obstacles: three }).chunks));
});

test('NaN obstacle fields are ignored', () => {
  const base = framesHash(runObs(['d20', 'd6', 'd6'], 7).chunks);
  for (const bad of [{ x: NaN, z: 0, r: 0.5, h: 1.5 }, { x: 0, z: 0, r: Infinity, h: 1.5 }, { x: 0, z: 0, r: 0.5 }, null]) {
    expect(framesHash(runObs(['d20', 'd6', 'd6'], 7, { obstacles: [bad] }).chunks)).toBe(base);
  }
});

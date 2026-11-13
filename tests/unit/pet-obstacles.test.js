import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { createSim, initPhysics, prewarm } from '../../src/physics/sim.js';
import { computeHulls } from '../../src/physics/hulls.js';
import { mulberry32 } from '../../src/core/rng.js';
import { FLOATS_PER_DIE, IMPACT_FLOATS, MAX_STEPS } from '../../src/physics/protocol.js';
import { SPLAT_SPEED } from '../../src/pet/chunk/pets.js';
import { restSpot, obstacle, KIND_FOOTPRINT } from '../../src/pet/chunk/resting.js';

// Pet obstacles against the real sim, placed by the shipped helpers: the roller's pet at its
// rest spot plus two resting pets (final review I-1, M-1, M-5).

const area = { halfWidth: 12, halfDepth: 7 };
const full = { cx: 0, cz: 0, ...area };
const hulls = computeHulls();
const MIX = ['d20', 'd6', 'd6', 'd8'];

beforeAll(async () => {
  await initPhysics(
    readFileSync('node_modules/@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm'),
  );
  const s = createSim(area, hulls);
  prewarm(s, MIX);
  s.dispose();
});

/** The roller's pet (watching from its rest spot) and two resting pets for `seed`, as the pet layer places them. */
function petsFor(seed) {
  const rand = mulberry32(seed * 7919);
  const a = restSpot(full, 1.5, [], rand);
  const own = obstacle(a, 1.5, 'a', KIND_FOOTPRINT.mimic);
  const r1 = restSpot(full, 1.5, [own], rand);
  const r2 = restSpot(full, 1.5, [own, r1], rand);
  return [own, obstacle(r1, 1.5, 'b', KIND_FOOTPRINT.slime), obstacle(r2, 1.5, 'c', KIND_FOOTPRINT.dragonling)];
}

/** Runs a throw: every frame's die centres, every impact, and settledStep. */
function run(dice, seed, extra) {
  const sim = createSim(area, hulls);
  const frames = [];
  const impacts = [];
  const n = dice.length;
  const req = { dice: dice.map((type) => ({ type })), seed, ...extra };
  const { settledStep } = sim.throw(req, (c) => {
    for (let s = 0; s < c.steps; s++) {
      const row = [];
      for (let d = 0; d < n; d++) {
        const o = (s * n + d) * FLOATS_PER_DIE;
        row.push([c.data[o], c.data[o + 1], c.data[o + 2]]);
      }
      frames.push(row);
    }
    for (let i = 0; i < c.events.length; i += IMPACT_FLOATS)
      impacts.push({ frame: c.events[i], die: c.events[i + 1], other: c.events[i + 2], speed: c.events[i + 3] });
  });
  sim.dispose();
  return { frames, impacts, settledStep };
}

// --- I-1: the sim decides the splat --------------------------------------------------------------

test.each([2, 11])(
  'seed %i: after a die splats a pet, no die of the same throw touches that spot again',
  (seed) => {
    const obstacles = petsFor(seed);
    // Without splatSpeed (petSplat off) the pet stays solid: a later die still bumps into it.
    const solid = run(MIX, seed, { obstacles }).impacts;
    const first = solid.find((e) => e.other <= -3 && e.speed >= SPLAT_SPEED);
    expect(first).toBeDefined();
    expect(solid.some((e) => e.other === first.other && e.frame > first.frame)).toBe(true);
    // With it, the same splat happens and that obstacle is gone from the next step on.
    const splat = run(MIX, seed, { obstacles, splatSpeed: SPLAT_SPEED }).impacts;
    const hit = splat.find((e) => e.other <= -3 && e.speed >= SPLAT_SPEED);
    expect(hit).toEqual(first);
    expect(splat.filter((e) => e.other === hit.other && e.frame > hit.frame)).toEqual([]);
  },
);

test('splatSpeed absent, null or with no obstacles changes nothing', () => {
  const obstacles = petsFor(2);
  const base = JSON.stringify(run(MIX, 2, { obstacles }));
  expect(JSON.stringify(run(MIX, 2, { obstacles, splatSpeed: null }))).toBe(base);
  expect(JSON.stringify(run(MIX, 2, { obstacles, splatSpeed: undefined }))).toBe(base);
  const bare = JSON.stringify(run(MIX, 7));
  expect(JSON.stringify(run(MIX, 7, { splatSpeed: SPLAT_SPEED }))).toBe(bare);
});

test('a splatSpeed above every contact leaves the throw as it was', () => {
  const obstacles = petsFor(2);
  expect(JSON.stringify(run(MIX, 2, { obstacles, splatSpeed: 1e9 }))).toBe(
    JSON.stringify(run(MIX, 2, { obstacles })),
  );
});

// --- M-5 (and M-1): nothing spawns in, sticks to or perches on a pet ----------------------------

test('30 seeds with three pets: no spawn inside a pet, every throw settles in the area, no die rests on a pet', () => {
  for (let seed = 31; seed <= 60; seed++) {
    const dice = seed % 2 ? MIX : Array(10).fill('d6');
    const obstacles = petsFor(seed);
    const { frames, settledStep } = run(dice, seed, { obstacles });
    const at = `seed ${seed}`;
    expect(settledStep, at).toBeLessThan(MAX_STEPS);
    for (const [x, , z] of frames[0])
      for (const o of obstacles) expect(Math.hypot(x - o.x, z - o.z), at).toBeGreaterThan(o.r);
    for (const [x, y, z] of frames.at(-1)) {
      expect(Math.abs(x), at).toBeLessThanOrEqual(area.halfWidth);
      expect(Math.abs(z), at).toBeLessThanOrEqual(area.halfDepth);
      for (const o of obstacles)
        if (Math.hypot(x - o.x, z - o.z) < o.r + 0.6) expect(y, `${at}: a die on a pet`).toBeLessThanOrEqual(1.0);
    }
  }
});

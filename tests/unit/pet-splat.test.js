import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeAll, expect, test } from 'vitest';
import { createSplat } from '../../src/pet/chunk/splat.js';
import { SPLAT_SPEED, WOBBLE_SPEED } from '../../src/pet/chunk/pets.js';
import { createSim, initPhysics, prewarm } from '../../src/physics/sim.js';
import { computeHulls } from '../../src/physics/hulls.js';
import { IMPACT_FLOATS } from '../../src/physics/protocol.js';

const KINDS = ['mimic', 'slime', 'dragonling'];
const PHASES = ['burst', 'puddle', 'reform'];
const TS = [0, 0.5, 1, -1, 2, NaN];

const parts = (root) => {
  const out = [];
  root.traverse((o) => o.isMesh && out.push(o));
  return out;
};

test.each(KINDS)('createSplat builds for %s with <= 3 materials, no NaN for every phase x t', (kind) => {
  for (const color of ['#c0392b', '#ffffff', '#000000', undefined]) {
    const s = createSplat(kind, color);
    expect(s.root).toBeInstanceOf(THREE.Object3D);
    const mats = new Set(parts(s.root).flatMap((m) => [].concat(m.material)));
    expect(mats.size).toBeLessThanOrEqual(3);
    for (const m of mats) {
      expect(m.type).toBe('MeshStandardMaterial');
      for (const k of ['r', 'g', 'b']) expect(m.color[k]).toBeLessThanOrEqual(1);
    }
    for (const phase of PHASES)
      for (const t of TS) {
        s.pose(phase, t);
        s.root.updateMatrixWorld(true);
        s.root.traverse((o) => {
          for (const e of o.matrixWorld.elements) expect(Number.isFinite(e)).toBe(true);
          if (o.material) expect(Number.isFinite(o.material.opacity)).toBe(true);
        });
      }
    s.dispose();
  }
});

test('createSplat dispose frees everything', () => {
  const s = createSplat('slime', '#33aa55');
  const geos = new Set();
  const mats = new Set();
  for (const m of parts(s.root)) {
    geos.add(m.geometry);
    for (const x of [].concat(m.material)) mats.add(x);
  }
  const spies = [...geos, ...mats].map((r) => {
    let n = 0;
    r.addEventListener('dispose', () => n++);
    return () => n;
  });
  s.dispose();
  for (const n of spies) expect(n()).toBeGreaterThan(0);
});

// --- the thresholds, pinned against the real sim ----------------------------------------------

const area = { halfWidth: 12, halfDepth: 7 };
beforeAll(async () => {
  await initPhysics(readFileSync('node_modules/@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm'));
  const sim = createSim(area, computeHulls());
  prewarm(sim, ['d6']);
  sim.dispose();
});

/** The first pet impact (other = -3) of a lone d6 thrown with `seed` against `obstacle`, in frame order. */
function firstPetImpact(seed, obstacle) {
  const sim = createSim(area, computeHulls());
  const events = [];
  sim.throw({ dice: [{ type: 'd6' }], seed, obstacles: [obstacle] }, (c) => {
    for (let i = 0; i < c.events.length; i += IMPACT_FLOATS)
      events.push({ frame: c.events[i], other: c.events[i + 2], speed: c.events[i + 3] });
  });
  sim.dispose();
  return events.filter((e) => e.other === -3).sort((a, b) => a.frame - b.frame)[0];
}

test('the thresholds: a full-pace arrival splats, a die tumbling to rest only wobbles', () => {
  expect(SPLAT_SPEED).toBe(10);
  expect(WOBBLE_SPEED).toBe(1.5);
  // Recorded cases (see the task 4 report): seed 5, a mimic-sized obstacle on the die's low flight
  // path (full pace, 20.7), and one just ahead of where the same die has slowed to ~3 (2.9).
  const full = firstPetImpact(5, { x: -6.050136089324951, z: 0.9487465620040894, r: 0.95, h: 1.5 });
  expect(full.speed).toBeGreaterThanOrEqual(SPLAT_SPEED);
  const tumble = firstPetImpact(5, { x: 1.099047846402165, z: -2.149915245914432, r: 0.95, h: 1.5 });
  expect(tumble.speed).toBeGreaterThanOrEqual(WOBBLE_SPEED);
  expect(tumble.speed).toBeLessThan(SPLAT_SPEED);
});

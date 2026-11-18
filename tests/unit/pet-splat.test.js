import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeAll, expect, test } from 'vitest';
import { createSplat } from '../../src/pet/chunk/splat.js';
import { REFORM_IN } from '../../src/pet/chunk/creatures/parts.js';
import { CREATURES } from '../../src/pet/chunk/creatures/index.js';
import { SPLAT_SPEED, WOBBLE_SPEED } from '../../src/pet/chunk/pets.js';
import { createSim, initPhysics, prewarm } from '../../src/physics/sim.js';
import { computeHulls } from '../../src/physics/hulls.js';
import { IMPACT_FLOATS } from '../../src/physics/protocol.js';

const KINDS = ['mimic', 'slime', 'dragonling', 'owl', 'frog', 'ghost', 'mushroom', 'eye', 'golem', 'cat'];
const PHASES = ['burst', 'puddle', 'reform'];
const TS = [0, 0.5, 1, -1, 2, NaN];

const parts = (root) => {
  const out = [];
  root.traverse((o) => o.isMesh && out.push(o));
  return out;
};

test.each(KINDS)(
  'createSplat builds for %s with <= 3 materials, no NaN for every phase x t',
  (kind) => {
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
  },
);

test.each(KINDS)('createSplat dispose frees everything (%s)', (kind) => {
  const s = createSplat(kind, '#33aa55');
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

// --- the reform hand-off and the shine's yaw -----------------------------------------------------

test.each(KINDS)(
  '%s reform hands over at REFORM_IN: the creature pops out of the lump, which then goes',
  (kind) => {
    expect(REFORM_IN).toBeGreaterThan(0.2);
    expect(REFORM_IN).toBeLessThan(0.6);
    const s = createSplat(kind, '#7b4bc4');
    const c = CREATURES[kind]('#7b4bc4');
    const lump = named(s.root, 'splatLump')[0];
    const eyes = named(s.root, 'splatEye');
    const creatureSize = () => {
      c.root.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(c.root).getSize(new THREE.Vector3());
    };
    // just before: the creature is hidden and the gathered lump stands in for it, eyes on top
    const before = REFORM_IN - 0.01;
    s.pose('reform', before);
    c.pose('reform', before, 'plain', { yaw: 0 });
    expect(Math.max(...creatureSize().toArray())).toBeLessThan(0.05);
    expect(lump.visible).toBe(true);
    expect(lump.scale.y).toBeGreaterThan(0.5);
    for (const e of eyes) expect(e.visible).toBe(true);
    // at REFORM_IN: the creature appears, small enough to sit inside the lump
    s.pose('reform', REFORM_IN + 0.005);
    c.pose('reform', REFORM_IN + 0.005, 'plain', { yaw: 0 });
    expect(c.root.scale.y).toBeGreaterThan(0.25);
    expect(creatureSize().y).toBeLessThan(lump.scale.y + 0.2);
    // by the time the creature has popped to full size the lump and the splat's eyes are gone
    s.pose('reform', 0.72);
    c.pose('reform', 0.72, 'plain', { yaw: 0 });
    expect(c.root.scale.y).toBeGreaterThan(0.95);
    expect(lump.visible).toBe(false);
    for (const e of eyes) expect(e.visible).toBe(false);
    s.dispose();
    c.dispose();
  },
);

test('the shine keeps to the light under a turned pet, and a NaN yaw stays finite', () => {
  const s = createSplat('slime', '#2e9e5b');
  const shine = parts(named(s.root, 'splatPuddle')[0]).find((m) => m.name !== 'splatPuddle');
  const group = new THREE.Group();
  group.add(s.root);
  group.rotation.y = 1.0;
  s.pose('puddle', 1);
  expect(shine.rotation.y).toBeCloseTo(-1.0, 6);
  group.updateMatrixWorld(true);
  const w = new THREE.Quaternion();
  shine.getWorldQuaternion(w);
  expect(Math.abs(w.y)).toBeLessThan(1e-6); // net world turn about y is 0
  group.rotation.y = NaN;
  for (const phase of PHASES) {
    s.pose(phase, 0.5);
    expect(shine.rotation.y).toBe(0);
    s.root.updateMatrixWorld(true);
    s.root.traverse((o) => {
      for (const e of o.matrixWorld.elements) expect(Number.isFinite(e)).toBe(true);
    });
  }
  s.dispose();
});

// --- the thresholds, pinned against the real sim ----------------------------------------------

const area = { halfWidth: 12, halfDepth: 7 };
beforeAll(async () => {
  await initPhysics(
    readFileSync('node_modules/@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm'),
  );
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
  const tumble = firstPetImpact(5, {
    x: 1.099047846402165,
    z: -2.149915245914432,
    r: 0.95,
    h: 1.5,
  });
  expect(tumble.speed).toBeGreaterThanOrEqual(WOBBLE_SPEED);
  expect(tumble.speed).toBeLessThan(SPLAT_SPEED);
});

// --- the look's budgets and shape (Task 5) ------------------------------------------------------

const triangles = (root) =>
  parts(root).reduce((n, m) => {
    const g = m.geometry;
    return n + (g.index ? g.index.count : g.attributes.position.count) / 3;
  }, 0);
const named = (root, name) => {
  const out = [];
  root.traverse((o) => o.name === name && out.push(o));
  return out;
};
/** The world-space box of the visible meshes (invisible ones and their children left out). */
function visibleBox(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const walk = (o) => {
    if (!o.visible) return;
    if (o.isMesh) box.expandByObject(o);
    else for (const c of o.children) walk(c);
  };
  walk(root);
  return box;
}

test.each(KINDS)('%s splat: <= 1500 triangles, <= 3 materials, <= 24 draw calls', (kind) => {
  const s = createSplat(kind, '#7b4bc4');
  expect(triangles(s.root)).toBeLessThanOrEqual(1500);
  expect(new Set(parts(s.root).map((m) => m.material)).size).toBeLessThanOrEqual(3);
  expect(parts(s.root).length).toBeLessThanOrEqual(24);
  s.dispose();
});

test.each(KINDS)(
  '%s puddle: two eyes, a wide flat puddle and 6-10 droplets on the floor',
  (kind) => {
    const s = createSplat(kind, '#2e9e5b');
    s.pose('puddle', 1);
    expect(named(s.root, 'splatEye')).toHaveLength(2);
    for (const e of named(s.root, 'splatEye')) expect(e.visible).toBe(true);
    const drops = named(s.root, 'splatDrop');
    expect(drops.length).toBeGreaterThanOrEqual(6);
    expect(drops.length).toBeLessThanOrEqual(10);
    const box = visibleBox(s.root);
    const size = box.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.z)).toBeGreaterThanOrEqual(2); // wider than the pet
    // flat, on the floor: the goo itself is low (eyes, a lid or a wing may stand above it)
    const puddle = new THREE.Box3().setFromObject(named(s.root, 'splatPuddle')[0]);
    expect(Math.abs(puddle.min.y)).toBeLessThan(0.01);
    expect(puddle.max.y).toBeLessThan(0.3);
    for (const d of drops) {
      const b = new THREE.Box3().setFromObject(d);
      expect(b.max.y).toBeLessThan(0.2); // landed
      expect(b.min.y).toBeGreaterThan(-0.01);
    }
    // a lid or wing dips into the goo, never deep under the table (nothing hides it there)
    for (const n of ['splatLid', 'splatWing'])
      for (const o of named(s.root, n))
        expect(new THREE.Box3().setFromObject(o).min.y).toBeGreaterThan(-0.12);
    s.dispose();
  },
);

test('the mimic leaves its lid with teeth, the dragonling a wing, the slime neither', () => {
  const m = createSplat('mimic', '#c0392b');
  expect(named(m.root, 'splatLid')).toHaveLength(1);
  expect(named(m.root, 'splatTooth').length).toBeGreaterThanOrEqual(1);
  expect(named(m.root, 'splatWing')).toHaveLength(0);
  const d = createSplat('dragonling', '#7b4bc4');
  expect(named(d.root, 'splatWing')).toHaveLength(1);
  expect(named(d.root, 'splatLid')).toHaveLength(0);
  const s = createSplat('slime', '#2e9e5b');
  expect(named(s.root, 'splatLid').length + named(s.root, 'splatWing').length).toBe(0);
  for (const x of [m, d, s]) x.dispose();
});

test.each(KINDS)(
  '%s burst starts as a compact blob where the pet stood and ends as the puddle',
  (kind) => {
    const s = createSplat(kind, '#c0392b');
    s.pose('burst', 0);
    const start = visibleBox(s.root).getSize(new THREE.Vector3());
    expect(Math.max(start.x, start.z)).toBeLessThan(1.8);
    expect(start.y).toBeGreaterThan(0.4); // still a lump, about to squash
    s.pose('burst', 1);
    const a = visibleBox(s.root);
    s.pose('puddle', 1);
    const b = visibleBox(s.root);
    // the burst's last frame lands on the puddle's footprint (the eyes may still be blinking)
    expect(a.min.x).toBeCloseTo(b.min.x, 1);
    expect(a.max.z).toBeCloseTo(b.max.z, 1);
    s.dispose();
  },
);

test.each(KINDS)('%s reform pulls everything in and is gone at t = 1', (kind) => {
  const s = createSplat(kind, '#c0392b');
  s.pose('reform', 0);
  const start = visibleBox(s.root).getSize(new THREE.Vector3());
  expect(Math.max(start.x, start.z)).toBeGreaterThanOrEqual(2);
  s.pose('reform', 1);
  const end = visibleBox(s.root);
  expect(end.isEmpty() || Math.max(...end.getSize(new THREE.Vector3()).toArray()) < 0.05).toBe(
    true,
  );
  s.dispose();
});

test('a pose never adds, removes or swaps parts', () => {
  const s = createSplat('dragonling', '#7b4bc4');
  const ids = () =>
    parts(s.root)
      .map((m) => m.geometry.id + ':' + m.material.id)
      .join();
  const before = ids();
  for (const phase of PHASES) for (let t = -0.2; t <= 1.2; t += 0.05) s.pose(phase, t);
  expect(ids()).toBe(before);
  s.dispose();
});

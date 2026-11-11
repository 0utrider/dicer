import * as THREE from 'three';
import { createParticlePool } from '../../src/effects/library/particles.js';
import { TIERS } from '../../src/render/quality.js';

const spec = (o = {}) => ({
  count: 1,
  origin: { x: 0, y: 0, z: 0 },
  speed: 1,
  spread: 0.5,
  gravity: 0,
  life: 1,
  color: '#fff',
  size: 0.2,
  now: 0,
  ...o,
});
const additive = (pool) => pool.layers[0];

test('capacity follows the tier particleScale (round(2048 x scale))', () => {
  for (const [name, t] of Object.entries(TIERS)) {
    const pool = createParticlePool(new THREE.Scene(), Math.round(2048 * t.particleScale));
    expect(pool.capacity, name).toBe(Math.round(2048 * t.particleScale));
    expect(additive(pool).attrs.aOrigin.count).toBe(pool.capacity);
    pool.dispose();
  }
});

test('adds at most two draws (additive + normal) and removes them on dispose', () => {
  const scene = new THREE.Scene();
  const pool = createParticlePool(scene, 64);
  expect(scene.children).toHaveLength(2);
  expect(scene.children.every((c) => c.isPoints)).toBe(true);
  pool.dispose();
  expect(scene.children).toHaveLength(0);
});

test('emitting beyond capacity overwrites the oldest particles', () => {
  const pool = createParticlePool(new THREE.Scene(), 4);
  pool.emit(spec({ count: 4, now: 0, color: '#ff0000' }));
  pool.emit(spec({ count: 2, now: 500, color: '#00ff00' }));
  const { aBirth, aColor } = additive(pool).attrs;
  // Slots 0,1 were overwritten by the newer emission; slots 2,3 are still the oldest.
  expect([0, 1, 2, 3].map((i) => aBirth.getX(i))).toEqual([0.5, 0.5, 0, 0]);
  expect(aColor.getY(0)).toBeCloseTo(1);
  expect(aColor.getY(3)).toBeCloseTo(0);
});

test('update is true while any particle lives and false after the longest life', () => {
  const pool = createParticlePool(new THREE.Scene(), 16);
  expect(pool.update(0)).toBe(false);
  pool.emit(spec({ count: 3, life: 1, now: 1000 }));
  expect(pool.update(1100)).toBe(true);
  expect(additive(pool).points.visible).toBe(true);
  expect(pool.update(1100 + 1200)).toBe(false); // lives are 1 s +-15%
  expect(additive(pool).points.visible).toBe(false);
});

test('only the emitted range is marked for upload (a wrapped emit marks two)', () => {
  const pool = createParticlePool(new THREE.Scene(), 8);
  const o = additive(pool).attrs.aOrigin;
  pool.emit(spec({ count: 3 }));
  expect(o.updateRanges).toEqual([{ start: 0, count: 9 }]);
  pool.update(10);
  expect(o.updateRanges).toEqual([{ start: 0, count: 9 }]); // update writes no attribute
  o.clearUpdateRanges();
  pool.emit(spec({ count: 7 })); // slots 3..7 then 0..1
  expect(o.updateRanges).toEqual([
    { start: 9, count: 15 },
    { start: 0, count: 6 },
  ]);
});

test('normal-blend particles go to the second layer; clear kills everything', () => {
  const pool = createParticlePool(new THREE.Scene(), 16);
  pool.emit(spec({ count: 2, blend: 'normal' }));
  expect(pool.layers[1].points.visible).toBe(true);
  expect(pool.layers[0].points.visible).toBe(false);
  pool.clear();
  expect(pool.update(1)).toBe(false);
  expect(pool.layers[1].points.visible).toBe(false);
});

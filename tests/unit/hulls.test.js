import { HULL_TYPES } from '../../src/physics/hulls.js';
import { computeReaders } from '../../src/physics/readers.js';
import { getShape } from '../../src/core/dice-shapes.js';
import { flatGap } from '../../src/core/physical-read.js';

test('computeReaders covers every hull type and d2, normals unit length, crystal read set [0,1,2,3], d4 mode -1, d16 mode -1', () => {
  const r = computeReaders();
  expect(Object.keys(r).sort()).toEqual([...HULL_TYPES, 'd2'].sort());
  for (const [t, { normals, read, mode, gap }] of Object.entries(r)) {
    const s = getShape(t);
    expect(normals).toBeInstanceOf(Float32Array);
    expect(normals.length).toBe(3 * (s.kind === 'coin' ? 2 : s.faces.length));
    for (let i = 0; i < normals.length; i += 3)
      expect(Math.hypot(normals[i], normals[i + 1], normals[i + 2])).toBeCloseTo(1, 5);
    expect(mode).toBe(t === 'd4' || t === 'd16' ? -1 : 1);
    expect(gap).toBeCloseTo(flatGap(s), 6);
    expect(gap).toBeGreaterThan(0.1);
    if (s.readFaces) {
      expect(read).toBeInstanceOf(Int8Array);
      expect([...read]).toEqual(s.readFaces); // the crystal d4's [0, 1, 2, 3], a long die's sides
    } else expect(read).toBeNull();
  }
  // Plain data only (no three.js objects), so it travels with INIT by structured clone.
  expect(structuredClone(r)).toEqual(r);
  expect(r.d16.gap).toBeCloseTo(0.152, 3);
  expect(r.d4.gap).toBeCloseTo(4 / 3, 6);
  expect(r.d2.gap).toBe(1);
});

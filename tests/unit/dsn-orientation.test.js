import * as THREE from 'three';
import { MODEL_ROTATIONS, modelRotationFor } from '../../src/compat/dsn-orientation.js';
import { getShape } from '../../src/core/dice-shapes.js';
import { faceNormals } from '../../src/core/face-reader.js';

// Observed model face normals per value, copied from docs/research/dsn-model-orientation.md
// (flat-face clusters of the registered GLB/glTF models, numbers read from renders).
const OBSERVED = {
  d2: [
    [1, [0, 0, -1]],
    [2, [0, 0, 1]],
  ],
  d6: [
    [1, [0, -1, 0]],
    [2, [-1, 0, 0]],
    [3, [0, 0, -1]],
    [4, [0, 0, 1]],
    [5, [1, 0, 0]],
    [6, [0, 1, 0]],
  ],
};

const dicerNormal = (type, value) => {
  const shape = getShape(type);
  const n = faceNormals(shape)[shape.values.indexOf(value)];
  return new THREE.Vector3(n.x, n.y, n.z);
};

describe('MODEL_ROTATIONS', () => {
  test('covers the DSN model types; every non-null rotation is a unit quaternion', () => {
    expect(Object.keys(MODEL_ROTATIONS).sort()).toEqual(
      ['d10', 'd100', 'd12', 'd2', 'd20', 'd4', 'd6', 'd8'].sort(),
    );
    for (const q of Object.values(MODEL_ROTATIONS)) {
      if (q === null || q === 'value') continue;
      expect(q).toHaveLength(4);
      expect(Math.hypot(...q)).toBeCloseTo(1, 9);
    }
  });

  test('only the verified types have one rotation; d8-d20 have one per value; d4 and d100 none', () => {
    const fixed = Object.keys(MODEL_ROTATIONS).filter((t) => Array.isArray(MODEL_ROTATIONS[t]));
    expect(fixed.sort()).toEqual(Object.keys(OBSERVED).sort());
    const perValue = Object.keys(MODEL_ROTATIONS).filter((t) => MODEL_ROTATIONS[t] === 'value');
    expect(perValue.sort()).toEqual(['d10', 'd12', 'd20', 'd8']);
    expect(MODEL_ROTATIONS.d4).toBeNull();
    expect(MODEL_ROTATIONS.d100).toBeNull();
  });

  test.each(Object.keys(OBSERVED))(
    '%s: the rotation takes each observed model face normal onto Dicer\'s normal for that value',
    (type) => {
      const q = new THREE.Quaternion(...MODEL_ROTATIONS[type]);
      for (const [value, normal] of OBSERVED[type]) {
        const rotated = new THREE.Vector3(...normal).applyQuaternion(q);
        expect(rotated.distanceTo(dicerNormal(type, value))).toBeLessThan(1e-3);
      }
    },
  );
});

describe('modelRotationFor', () => {
  test('a verified type gets its rotation; an unverified one gets null', () => {
    expect(modelRotationFor({ type: 'd6', dsnType: 'd6' })).toBe(MODEL_ROTATIONS.d6);
    expect(modelRotationFor({ type: 'd6' })).toBe(MODEL_ROTATIONS.d6);
    expect(modelRotationFor({ type: 'd4', dsnType: 'd4', value: 3 })).toBeNull();
  });

  test('a per-value type needs a known value: never a free die, a ghost or a missing value', () => {
    expect(modelRotationFor({ type: 'd20', dsnType: 'd20', value: 17 })).toBe('value');
    expect(modelRotationFor({ type: 'd20', dsnType: 'd20' })).toBeNull();
    expect(modelRotationFor({ type: 'd20', value: 17, free: true })).toBeNull();
    expect(modelRotationFor({ type: 'd12', value: 4, ghost: true })).toBeNull();
  });

  test('a custom DSN type aliased onto a Dicer shape is not verified', () => {
    expect(modelRotationFor({ type: 'd6', dsnType: 'dX' })).toBeNull();
    expect(modelRotationFor({ type: 'd12', dsnType: 'daggerheart.rhombic_d12' })).toBeNull();
  });

  test('a d100 model belongs to the tens die only', () => {
    expect(modelRotationFor({ type: 'd10', variant: 'd100tens', dsnType: 'd100' })).toBe(
      MODEL_ROTATIONS.d100,
    );
    expect(modelRotationFor({ type: 'd10', dsnType: 'd100' })).toBeNull();
    // A tens die never borrows a d10 model (its faces carry 1..0, not tens).
    expect(modelRotationFor({ type: 'd10', variant: 'd100tens' })).toBeNull();
  });

  test('anything else is null and never throws', () => {
    expect(modelRotationFor(undefined)).toBeNull();
    expect(modelRotationFor({})).toBeNull();
    expect(modelRotationFor({ type: 'toString' })).toBeNull();
  });
});

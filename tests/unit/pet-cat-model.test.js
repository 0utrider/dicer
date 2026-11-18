import { build, buildCat } from '../../scripts/pets/build-cat.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The cat model (scripts/pets/build-cat.js, exported as assets/pets/cat.glb) against the pet
// model spec and Dicer's model loader.
petModelChecks('cat', build, {
  bones: ['ear_L', 'ear_R', 'tail_1', 'tail_2', 'tail_3', 'arm_L', 'arm_R'],
  keys: ['squint_L', 'squint_R', 'puff', 'tongue'],
  minBodyTriangles: 4000,
});

test('buildCat is the build alias', () => {
  expect(buildCat).toBe(build);
});

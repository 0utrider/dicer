import { build, buildOwl } from '../../scripts/pets/build-owl.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The owl model (scripts/pets/build-owl.js, exported as assets/pets/owl.glb) against the pet
// model spec and Dicer's model loader.
petModelChecks('owl', build, {
  bones: ['ear_L', 'ear_R', 'wing_L', 'wing_R', 'arm_L', 'arm_R', 'tail_1'],
  keys: ['squint_L', 'squint_R', 'puff'],
  minBodyTriangles: 4000,
});

test('buildOwl is the build alias', () => {
  expect(buildOwl).toBe(build);
});

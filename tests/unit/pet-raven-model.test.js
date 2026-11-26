import { build, buildRaven } from '../../scripts/pets/build-raven.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The raven model (scripts/pets/build-raven.js, exported as assets/pets/raven.glb) against the pet
// model spec and Dicer's model loader.
petModelChecks('raven', build, {
  bones: ['wing_L', 'wing_R', 'arm_L', 'arm_R', 'tail_1', 'tail_2'],
  keys: ['squint_L', 'squint_R', 'puff'],
  minBodyTriangles: 4000,
  color: '#40456a',
});

test('buildRaven is the build alias', () => {
  expect(buildRaven).toBe(build);
});

import { build, buildMushroom } from '../../scripts/pets/build-mushroom.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The mushroom model (scripts/pets/build-mushroom.js, exported as assets/pets/mushroom.glb) against
// the pet model spec and Dicer's model loader.
petModelChecks('mushroom', build, {
  bones: ['arm_L', 'arm_R'],
  keys: ['squint_L', 'squint_R', 'puff', 'tongue'],
  minBodyTriangles: 4000,
  color: '#c0392b',
});

test('buildMushroom is the build alias', () => {
  expect(buildMushroom).toBe(build);
});

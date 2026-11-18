import { build, buildSlime } from '../../scripts/pets/build-slime.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The slime model (scripts/pets/build-slime.js, exported as assets/pets/slime.glb) against the pet
// model spec and Dicer's model loader.
petModelChecks('slime', build, {
  bones: ['tail_1', 'tail_2', 'tail_3'],
  keys: ['squint_L', 'squint_R', 'puff', 'tongue'],
  minBodyTriangles: 4000,
  color: '#2bb3a3',
});

test('buildSlime is the build alias', () => {
  expect(buildSlime).toBe(build);
});

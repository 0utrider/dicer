import { build, buildFox } from '../../scripts/pets/build-fox.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The fox model (scripts/pets/build-fox.js, exported as assets/pets/fox.glb) against the pet
// model spec and Dicer's model loader.
petModelChecks('fox', build, {
  bones: ['ear_L', 'ear_R', 'tail_1', 'tail_2', 'tail_3', 'arm_L', 'arm_R'],
  keys: ['squint_L', 'squint_R', 'puff', 'tongue'],
  minBodyTriangles: 4000,
  color: '#d9682a',
});

test('buildFox is the build alias', () => {
  expect(buildFox).toBe(build);
});

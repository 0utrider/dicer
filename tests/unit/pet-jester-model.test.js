import { build, buildJester } from '../../scripts/pets/build-jester.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The jester model (scripts/pets/build-jester.js, exported as assets/pets/jester.glb) against the
// pet model spec and Dicer's model loader. Its hat points hang on ear_L/R (left, right) and the
// tail chain (back), all under the head.
petModelChecks('jester', build, {
  bones: ['ear_L', 'ear_R', 'tail_1', 'tail_2', 'tail_3', 'arm_L', 'arm_R', 'leg_L', 'leg_R'],
  keys: ['squint_L', 'squint_R', 'puff', 'tongue'],
  minBodyTriangles: 4000,
});

test('buildJester is the build alias', () => {
  expect(buildJester).toBe(build);
});

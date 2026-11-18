import { build, buildMimic } from '../../scripts/pets/build-mimic.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The mimic model (scripts/pets/build-mimic.js, exported as assets/pets/mimic.glb) against the pet
// model spec and Dicer's model loader: a treasure chest whose lid is its upper jaw (opened by the
// mouthOpen key), its front feet arm_L/R.
petModelChecks('mimic', build, {
  bones: ['arm_L', 'arm_R'],
  keys: ['squint_L', 'squint_R', 'puff', 'tongue'],
  minBodyTriangles: 4000,
  color: '#9a6a32',
});

test('buildMimic is the build alias', () => {
  expect(buildMimic).toBe(build);
});

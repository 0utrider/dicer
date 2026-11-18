import { build, buildFrog } from '../../scripts/pets/build-frog.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The frog model (scripts/pets/build-frog.js, exported as assets/pets/frog.glb) against the pet
// model spec and Dicer's model loader.
petModelChecks('frog', build, {
  bones: ['arm_L', 'arm_R', 'leg_L', 'leg_R'],
  keys: ['squint_L', 'squint_R', 'puff', 'tongue'],
  minBodyTriangles: 4000,
  color: '#3f9b3a',
});

test('buildFrog is the build alias', () => {
  expect(buildFrog).toBe(build);
});

test('the tongue flicks well out ahead of the mouth', () => {
  const body = build().getObjectByName('Body');
  const g = body.geometry;
  const pos = g.attributes.position;
  const tongue = g.morphAttributes.position[body.morphTargetDictionary.tongue];
  let restFront = -Infinity;
  let tipFront = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    restFront = Math.max(restFront, pos.getZ(i));
    tipFront = Math.max(tipFront, pos.getZ(i) + tongue.getZ(i));
  }
  expect(tipFront - restFront).toBeGreaterThan(0.6);
}, 60000); // building the model takes seconds

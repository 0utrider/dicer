import { build, buildImp } from '../../scripts/pets/build-imp.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The imp model (scripts/pets/build-imp.js, exported as assets/pets/imp.glb) against the pet
// model spec and Dicer's model loader. It hovers: only its tail's spade touches the floor.
petModelChecks('imp', build, {
  bones: ['ear_L', 'ear_R', 'wing_L', 'wing_R', 'tail_1', 'tail_2', 'tail_3', 'arm_L', 'arm_R'],
  keys: ['squint_L', 'squint_R', 'puff', 'tongue'],
  minBodyTriangles: 4500,
  color: '#b8322f',
  floating: true,
});

test('buildImp is the build alias', () => {
  expect(buildImp).toBe(build);
});

test('the imp flaps its wings while it hovers idle', async () => {
  const { createModelCreature } = await import('../../src/pet/chunk/model-pet.js');
  const c = createModelCreature(build(), '#b8322f', { kind: 'imp', clock: () => 0 });
  const wing = (ms) => {
    c.pose('watch', 0, null, { yaw: 0, now: ms });
    return c.root.getObjectByName('wing_L').quaternion.clone();
  };
  // a quarter beat apart (420 ms per beat): the wing has swung well away
  expect(wing(0).angleTo(wing(105))).toBeGreaterThan(0.25);
  c.dispose();
}, 120000);

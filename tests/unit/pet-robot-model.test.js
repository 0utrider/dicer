import { build, buildRobot } from '../../scripts/pets/build-robot.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The clockwork robot model (scripts/pets/build-robot.js, exported as assets/pets/robot.glb)
// against the pet model spec and Dicer's model loader: its wind-up key is the rigid Extra mesh.
petModelChecks('robot', build, {
  bones: ['neck', 'arm_L', 'arm_R', 'leg_L', 'leg_R'],
  keys: ['squint_L', 'squint_R', 'puff'],
  extra: true,
  minBodyTriangles: 4000,
  color: '#b08d57',
});

test('buildRobot is the build alias', () => {
  expect(buildRobot).toBe(build);
});

test('the lenses and the antenna bulb glow through one shared emissive map; the key is untextured steel', () => {
  const scene = build();
  const body = scene.getObjectByName('Body').material;
  const eyes = scene.getObjectByName('Eyes').material;
  expect(body.emissiveMap).toBeTruthy();
  expect(eyes.emissiveMap).toBe(body.emissiveMap);
  expect(scene.getObjectByName('Eyes').geometry.attributes.uv).toBeDefined();
  const key = scene.getObjectByName('Extra');
  expect(key.material.map).toBeFalsy(); // never tinted
  const kw = key.geometry.attributes.skinIndex;
  const names = key.skeleton.bones.map((b) => b.name);
  for (let i = 0; i < kw.count; i++) expect(names[kw.getX(i)]).toBe('body');
}, 120000);

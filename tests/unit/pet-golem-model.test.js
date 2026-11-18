import { build, buildGolem } from '../../scripts/pets/build-golem.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The pebble golem model (scripts/pets/build-golem.js, exported as assets/pets/golem.glb) against
// the pet model spec and Dicer's model loader.
petModelChecks('golem', build, {
  bones: ['arm_L', 'arm_R'],
  keys: ['squint_L', 'squint_R', 'puff'],
  minBodyTriangles: 4000,
  color: '#7d7f86',
});

test('buildGolem is the build alias', () => {
  expect(buildGolem).toBe(build);
});

test('the runes and eyes glow through one shared emissive map', () => {
  const scene = build();
  const body = scene.getObjectByName('Body').material;
  const eyes = scene.getObjectByName('Eyes').material;
  expect(body.emissiveMap).toBeTruthy();
  expect(eyes.emissiveMap).toBe(body.emissiveMap);
  expect(scene.getObjectByName('Eyes').geometry.attributes.uv).toBeDefined();
  const d = body.emissiveMap.image.data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 128) lit++;
  expect(lit).toBeGreaterThan(500);
}, 120000);

import { build, buildSpider } from '../../scripts/pets/build-spider.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The spider model (scripts/pets/build-spider.js, exported as assets/pets/spider.glb) against the
// pet model spec and Dicer's model loader.
const LEGS = ['arm_L', 'arm_R', 'leg_L1', 'leg_L2', 'leg_L3', 'leg_R1', 'leg_R2', 'leg_R3'];
petModelChecks('spider', build, {
  bones: ['tail_1', ...LEGS],
  keys: ['squint_L', 'squint_R', 'puff', 'tongue'],
  minBodyTriangles: 4000,
  color: '#6b4f8a',
});

test('buildSpider is the build alias', () => {
  expect(buildSpider).toBe(build);
});

test('eight legs: a bone each, mirrored, spread in a star round the body', () => {
  const scene = build();
  scene.updateMatrixWorld(true);
  const at = (name) => scene.getObjectByName(name).getWorldPosition(scene.position.clone());
  const angles = [];
  for (const n of LEGS) {
    const p = at(n);
    const m = at(n.replace(/_(L|R)/, (_, s) => (s === 'L' ? '_R' : '_L')));
    expect(p.x * (n.includes('_L') ? 1 : -1), n).toBeGreaterThan(0.05); // _L is the spider's left (+X)
    expect(m.x).toBeCloseTo(-p.x, 5);
    expect(m.z).toBeCloseTo(p.z, 5);
    angles.push(Math.atan2(p.x, p.z));
  }
  // no two leg bones on one side point the same way
  const left = angles.filter((a) => a > 0).sort((a, b) => a - b);
  expect(left).toHaveLength(4);
  for (let i = 1; i < left.length; i++) expect(left[i] - left[i - 1]).toBeGreaterThan(0.3);
}, 60000); // building the model takes seconds

test('the texture leaves the heart, muzzle and leg tips untinted and tints the fur', () => {
  const img = build().getObjectByName('Body').material.map.image;
  let zero = 0;
  let full = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] === 0) zero++;
    else if (img.data[i] === 255) full++;
  }
  expect(full).toBeGreaterThan(200000); // the fur
  expect(zero).toBeGreaterThan(5000);
}, 60000);

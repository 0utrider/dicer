import { build, buildEye } from '../../scripts/pets/build-eye.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The floating eye model (scripts/pets/build-eye.js, exported as assets/pets/eye.glb) against the
// pet model spec and Dicer's model loader. One eyeball, on eye_L; eye_R is a bone with no geometry.
petModelChecks('eye', build, {
  bones: ['arm_L', 'arm_R', 'tail_1', 'tail_2', 'tail_3'],
  keys: ['squint_L', 'squint_R', 'puff'],
  minBodyTriangles: 4000,
  color: '#7b3fa8',
});

describe('the eye model, its one eye', () => {
  let scene;
  beforeAll(() => {
    scene = build();
  }, 120000);

  test('buildEye is the build alias', () => {
    expect(buildEye).toBe(build);
  });

  test('eye_L and eye_R share the eyeball centre; every eyeball vertex is on eye_L', () => {
    const l = scene.getObjectByName('eye_L');
    const r = scene.getObjectByName('eye_R');
    expect(l.position.distanceTo(r.position)).toBeLessThan(1e-6);
    const eyes = scene.getObjectByName('Eyes');
    const names = eyes.skeleton.bones.map((b) => b.name);
    const ix = eyes.geometry.attributes.skinIndex;
    for (let i = 0; i < ix.count; i++) expect(names[ix.getX(i)]).toBe('eye_L');
  });

  test('either blink key alone shuts the eye (the lids have morph normals)', () => {
    const body = scene.getObjectByName('Body');
    const g = body.geometry;
    const moved = (key) => {
      const a = g.morphAttributes.position[body.morphTargetDictionary[key]];
      let n = 0;
      for (let i = 0; i < a.count; i++) if (Math.hypot(a.getX(i), a.getY(i), a.getZ(i)) > 0.1) n++;
      return n;
    };
    expect(moved('blink_L')).toBeGreaterThan(200);
    expect(moved('blink_R')).toBeGreaterThan(200);
    expect(g.morphAttributes.normal).toHaveLength(g.morphAttributes.position.length);
  });
});

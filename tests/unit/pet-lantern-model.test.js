import { build, buildLantern } from '../../scripts/pets/build-lantern.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The lantern model (scripts/pets/build-lantern.js, exported as assets/pets/lantern.glb) against
// the pet model spec and Dicer's model loader. A flier: it floats over the floor (its tassel just
// brushes it). One big eye, on eye_L; eye_R is a bone at the same centre with no geometry.
petModelChecks('lantern', build, {
  bones: ['tail_1', 'tail_2', 'tail_3'],
  keys: ['squint_L', 'squint_R', 'puff', 'tongue'],
  minBodyTriangles: 4000,
  color: '#e8b04a',
  floating: true,
});

describe('the lantern model, its one eye and its glow', () => {
  let scene;
  beforeAll(() => {
    scene = build();
  }, 120000);

  test('buildLantern is the build alias', () => {
    expect(buildLantern).toBe(build);
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

  test('either blink key alone shuts the eye', () => {
    const body = scene.getObjectByName('Body');
    const g = body.geometry;
    const moved = (key) => {
      const a = g.morphAttributes.position[body.morphTargetDictionary[key]];
      let n = 0;
      for (let i = 0; i < a.count; i++) if (Math.hypot(a.getX(i), a.getY(i), a.getZ(i)) > 0.05) n++;
      return n;
    };
    expect(moved('blink_L')).toBeGreaterThan(40);
    expect(moved('blink_R')).toBeGreaterThan(40);
  });

  test('the paper glows: Body has an emissive map', () => {
    const m = scene.getObjectByName('Body').material;
    expect(m.emissiveMap?.image?.width).toBeGreaterThanOrEqual(512);
    expect(m.emissive.r).toBeGreaterThan(0);
  });
});

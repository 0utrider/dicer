import { build, buildDrone } from '../../scripts/pets/build-drone.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The drone model (scripts/pets/build-drone.js, exported as assets/pets/drone.glb) against the pet
// model spec and Dicer's model loader. It hovers: only its thruster's jet reaches the floor. Its
// engine pods are the ears, its antenna the tail; its face is a screen (patches on the visor).
petModelChecks('drone', build, {
  bones: ['arm_L', 'arm_R', 'ear_L', 'ear_R', 'tail_1'],
  keys: ['squint_L', 'squint_R'],
  minBodyTriangles: 4000,
  color: '#2fa8c9',
  floating: true,
});

describe('the drone model, its screen face', () => {
  let scene;
  beforeAll(() => {
    scene = build();
  }, 120000);

  test('buildDrone is the build alias', () => {
    expect(buildDrone).toBe(build);
  });

  test('the eyes, the lights and the jet glow through one emissive map shared by Body and Eyes', () => {
    const body = scene.getObjectByName('Body').material;
    const eyes = scene.getObjectByName('Eyes').material;
    expect(body.emissiveMap).toBeTruthy();
    expect(eyes.emissiveMap).toBe(body.emissiveMap);
    expect(scene.getObjectByName('Eyes').geometry.attributes.uv).toBeDefined();
    // the patches shade as the glass round them
    expect(eyes.roughness).toBe(body.roughness);
  });

  test('the whole craft rides the head bone; the arms, engine pods and antenna hang on it', () => {
    for (const n of ['arm_L', 'arm_R', 'ear_L', 'ear_R', 'tail_1']) expect(scene.getObjectByName(n).parent.name).toBe('head');
    const body = scene.getObjectByName('Body');
    const names = body.skeleton.bones.map((b) => b.name);
    const ix = body.geometry.attributes.skinIndex;
    const w = body.geometry.attributes.skinWeight;
    const share = {};
    for (let i = 0; i < ix.count; i++) for (let k = 0; k < 4; k++) share[names[ix.getComponent(i, k)]] = (share[names[ix.getComponent(i, k)]] ?? 0) + w.getComponent(i, k);
    for (const n of ['head', 'root', 'arm_L', 'arm_R', 'ear_L', 'ear_R', 'tail_1', 'eye_L', 'eye_R']) expect(share[n], n).toBeGreaterThan(5);
    expect(share.head).toBeGreaterThan(0.5 * ix.count);
  });

  test('it floats: only the jet (on root) is near the floor', () => {
    const body = scene.getObjectByName('Body');
    const names = body.skeleton.bones.map((b) => b.name);
    const pos = body.geometry.attributes.position;
    const ix = body.geometry.attributes.skinIndex;
    let low = 0;
    let lowest = Infinity;
    for (let i = 0; i < pos.count; i++) {
      lowest = Math.min(lowest, pos.getY(i));
      if (pos.getY(i) > 0.05) continue;
      low++;
      expect(names[ix.getX(i)]).toBe('root');
      expect(Math.hypot(pos.getX(i), pos.getZ(i))).toBeLessThan(0.12);
    }
    expect(low).toBeGreaterThan(3);
    expect(Math.abs(lowest)).toBeLessThan(0.03);
  });

  test('the shutters are collapsed at rest and close over the eyes; the keys carry normals', () => {
    const body = scene.getObjectByName('Body');
    const g = body.geometry;
    const moved = (key, min) => {
      const a = g.morphAttributes.position[body.morphTargetDictionary[key]];
      let n = 0;
      for (let i = 0; i < a.count; i++) if (Math.hypot(a.getX(i), a.getY(i), a.getZ(i)) > min) n++;
      return n;
    };
    for (const k of ['blink_L', 'blink_R']) expect(moved(k, 0.04), k).toBeGreaterThanOrEqual(36);
    expect(moved('squint_L', 0.03)).toBeGreaterThan(20);
    expect(g.morphAttributes.normal).toHaveLength(g.morphAttributes.position.length);
    const eyes = scene.getObjectByName('Eyes');
    expect(Object.keys(eyes.morphTargetDictionary).sort()).toEqual(['happy', 'surprised']);
    expect(eyes.geometry.morphAttributes.normal).toHaveLength(2);
  });
});

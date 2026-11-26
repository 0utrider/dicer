import { build, buildSkull } from '../../scripts/pets/build-skull.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The skull model (scripts/pets/build-skull.js, exported as assets/pets/skull.glb) against the pet
// model spec and Dicer's model loader. A floating skull over a wisp of flame whose tip touches the
// floor; its lower jaw is its own shell, rigid on the jaw bone and swung open by mouthOpen.
petModelChecks('skull', build, {
  bones: ['jaw', 'tail_1', 'tail_2', 'tail_3'],
  keys: ['squint_L', 'squint_R', 'puff'],
  minBodyTriangles: 5000,
  color: '#6fd08c',
});

describe('the skull model, its jaw and its glow', () => {
  let scene;
  beforeAll(() => {
    scene = build();
  }, 120000);

  test('buildSkull is the build alias', () => {
    expect(buildSkull).toBe(build);
  });

  test('the jaw hangs on the head; its shell is rigid on it and mouthOpen swings it down', () => {
    const jaw = scene.getObjectByName('jaw');
    expect(jaw.parent.name).toBe('head');
    const body = scene.getObjectByName('Body');
    const g = body.geometry;
    const names = body.skeleton.bones.map((b) => b.name);
    const ix = g.attributes.skinIndex;
    const w = g.attributes.skinWeight;
    const open = g.morphAttributes.position[body.morphTargetDictionary.mouthOpen];
    let rigid = 0;
    let lowest = 0;
    for (let i = 0; i < ix.count; i++) {
      const onJaw = names[ix.getX(i)] === 'jaw' && w.getX(i) > 0;
      if (onJaw) {
        expect(w.getX(i)).toBe(1);
        rigid++;
        lowest = Math.min(lowest, open.getY(i));
      } else expect(Math.hypot(open.getX(i), open.getY(i), open.getZ(i))).toBe(0); // only the jaw opens
    }
    expect(rigid).toBeGreaterThan(400);
    expect(lowest).toBeLessThan(-0.1); // the chin drops
  });

  test('the flame hangs on the tail bones, which hang on root', () => {
    expect(scene.getObjectByName('tail_1').parent.name).toBe('root');
    const body = scene.getObjectByName('Body');
    const names = body.skeleton.bones.map((b) => b.name);
    const ix = body.geometry.attributes.skinIndex;
    const w = body.geometry.attributes.skinWeight;
    const on = { tail_1: 0, tail_2: 0, tail_3: 0 };
    for (let i = 0; i < ix.count; i++)
      for (let k = 0; k < 4; k++) {
        const n = names[ix.getComponent(i, k)];
        if (n in on && w.getComponent(i, k) > 0.5) on[n]++;
      }
    for (const n of Object.keys(on)) expect(on[n], n).toBeGreaterThan(20);
  });

  test('the bone is untinted and the flame tinted: the mask has plenty of both', () => {
    const img = scene.getObjectByName('Body').material.map.image;
    let zero = 0;
    let full = 0;
    for (let i = 3; i < img.data.length; i += 4) {
      if (img.data[i] === 0) zero++;
      else if (img.data[i] === 255) full++;
    }
    expect(zero).toBeGreaterThan(full); // mostly bone
    expect(full).toBeGreaterThan(20000);
  });

  test('the orbs glow: Body and Eyes share an emissive map, and Eyes takes the tint mask', () => {
    const body = scene.getObjectByName('Body').material;
    const eyes = scene.getObjectByName('Eyes').material;
    expect(body.emissiveMap?.image?.width).toBeGreaterThanOrEqual(512);
    expect(body.emissive.r).toBeGreaterThan(0);
    expect(eyes.emissiveMap).toBe(body.emissiveMap);
    expect(eyes.map).toBe(body.map);
    expect(scene.getObjectByName('Eyes').geometry.attributes.uv).toBeDefined();
  });
});

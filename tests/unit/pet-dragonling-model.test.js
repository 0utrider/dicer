import * as THREE from 'three';
import { build, buildDragonling } from '../../scripts/pets/build-dragonling.js';
import { createModelCreature } from '../../src/pet/chunk/model-pet.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

// The dragonling model (scripts/pets/build-dragonling.js, exported as assets/pets/dragonling.glb)
// against the pet model spec and Dicer's model loader.
petModelChecks('dragonling', build, {
  bones: ['ear_L', 'ear_R', 'wing_L', 'wing_R', 'tail_1', 'tail_2', 'tail_3', 'arm_L', 'arm_R'],
  keys: ['squint_L', 'squint_R', 'puff', 'tongue'],
  minBodyTriangles: 5000,
  color: '#c0392b',
});

test('buildDragonling is the build alias', () => {
  expect(buildDragonling).toBe(build);
});

describe('the dragonling wings', () => {
  let template;
  beforeAll(() => {
    template = build();
  }, 120000);

  test('are skinned to wing_L / wing_R, mirrored, and spread up when the loader cheers', () => {
    const c = createModelCreature(template, '#c0392b', { kind: 'dragonling', clock: () => 0 });
    const body = c.root.getObjectByName('Body');
    const names = body.skeleton.bones.map((b) => b.name);
    const si = body.geometry.attributes.skinIndex;
    const sw = body.geometry.attributes.skinWeight;
    const pos = body.geometry.attributes.position;
    const tips = {};
    const count = { wing_L: 0, wing_R: 0 };
    for (let i = 0; i < si.count; i++) {
      const n = names[si.getX(i)];
      if (!(n in count) || sw.getX(i) < 0.99) continue;
      count[n]++;
      if (!tips[n] || Math.abs(pos.getX(i)) > Math.abs(pos.getX(tips[n]))) tips[n] = i;
    }
    expect(count.wing_L).toBeGreaterThan(200);
    expect(count.wing_R).toBe(count.wing_L);
    const tipY = (i) => {
      c.root.updateMatrixWorld(true);
      return body.localToWorld(body.getVertexPosition(i, new THREE.Vector3())).y;
    };
    c.pose('watch', 0, null, { yaw: 0, now: 0 });
    const rest = [tipY(tips.wing_L), tipY(tips.wing_R)];
    c.pose('cheer', 0.5, null, { yaw: 0, now: 0 });
    const up = [tipY(tips.wing_L), tipY(tips.wing_R)];
    expect(up[0] - rest[0]).toBeGreaterThan(0.2);
    expect(up[1] - rest[1]).toBeGreaterThan(0.2);
    c.dispose();
  });
});

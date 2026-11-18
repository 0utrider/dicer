import * as THREE from 'three';
import { createModelCreature } from '../../src/pet/chunk/model-pet.js';
import { safe } from '../../src/pet/chunk/creatures/index.js';
import { buildStandinPet } from '../helpers/standin-pet.js';

const PHASES = ['enter', 'throw', 'watch', 'react', 'exit', 'move', 'pet', 'huff', 'scorch', 'shiver', 'bristle', 'startle', 'proud', 'sulk', 'cheer', 'wobble', 'reform'];
const make = (color = '#c0392b', template = buildStandinPet()) => safe((c) => createModelCreature(template, c, { kind: 'cat', clock: () => 0 }))(color);
const boxOf = (o) => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o, true);
};
const key = (c, name) => {
  let v = null;
  c.root.traverse((o) => {
    if (o.morphTargetDictionary && name in o.morphTargetDictionary) v = o.morphTargetInfluences[o.morphTargetDictionary[name]];
  });
  return v;
};

test('a model pet stands 1.5 tall on the floor, named for its kind, with a footprint', () => {
  const c = make();
  expect(c.root.name).toBe('cat');
  expect(c.height).toBe(1.5);
  c.pose('watch', 0, null, { yaw: 0, now: 0 });
  const b = boxOf(c.root);
  expect(b.max.y - b.min.y).toBeGreaterThan(1.4);
  expect(b.max.y - b.min.y).toBeLessThan(1.65);
  expect(Math.abs(b.min.y)).toBeLessThan(0.06);
  expect(c.footprint).toBeGreaterThan(0.3);
  expect(c.shapeKeys).toEqual(['blink_L', 'blink_R', 'happy', 'sad', 'surprised', 'mouthOpen', 'angry']);
  c.dispose();
});

test('the textured body is tinted through its mask; untextured eyes keep their colour; no colour: painted', () => {
  const template = buildStandinPet();
  const c = make('#2266ff', template);
  const mats = [];
  c.root.traverse((o) => o.isMesh && mats.push([o.name, o.material]));
  const [, body] = mats.find(([n]) => n === 'Body');
  const [, eyes] = mats.find(([n]) => n === 'Eyes');
  expect(body).not.toBe(template.getObjectByName('Body').material); // its own tinted copy
  expect(eyes).toBe(template.getObjectByName('Eyes').material);
  const sh = { uniforms: {}, fragmentShader: 'void main(){\n#include <map_fragment>\n}' };
  body.onBeforeCompile(sh);
  expect(sh.fragmentShader).toContain('mix( diffuseColor.rgb, diffuseColor.rgb * uDicerTint, sampledDiffuseColor.a )');
  expect(sh.uniforms.uDicerTint.value.getHexString()).toBe('2266ff');
  const natural = make(null, template);
  let nb;
  natural.root.traverse((o) => o.name === 'Body' && (nb = o.material));
  const sh2 = { uniforms: {}, fragmentShader: '#include <map_fragment>' };
  nb.onBeforeCompile(sh2);
  expect(sh2.uniforms.uDicerTint.value.getHexString()).toBe('ffffff');
  c.dispose();
  natural.dispose();
});

test('every phase and reaction poses without NaN and never moves the root', () => {
  const c = make();
  const at = c.root.position.clone();
  for (const phase of PHASES)
    for (const r of ['crit', 'fumble', 'mixed', 'plain', null])
      for (const t of [0, 0.3, 0.5, 1, -1, 2, NaN]) {
        c.pose(phase, t, r, { yaw: 0.4, now: 1234 });
        c.root.updateMatrixWorld(true);
        c.root.traverse((o) => o.matrixWorld.elements.forEach((e) => expect(Number.isFinite(e)).toBe(true)));
        expect(c.root.position.equals(at)).toBe(true);
      }
  c.dispose();
});

test('crit, fumble, mixed and plain look different; the face keys follow (happy on a crit, sad on a fumble)', () => {
  const c = make();
  const snap = () => {
    c.root.updateMatrixWorld(true);
    const out = [];
    c.root.traverse((o) => o.isBone && out.push(...o.matrixWorld.elements.map((e) => e.toFixed(3))));
    return out.join() + key(c, 'happy') + key(c, 'sad');
  };
  const poses = ['crit', 'fumble', 'mixed', 'plain'].map((r) => (c.pose('react', 0.5, r, { yaw: 0 }), snap()));
  expect(new Set(poses).size).toBe(4);
  c.pose('react', 0.5, 'crit', { yaw: 0 });
  expect(key(c, 'happy')).toBeGreaterThan(0.5);
  c.pose('react', 0.6, 'fumble', { yaw: 0 });
  expect(key(c, 'sad')).toBeGreaterThan(0.5);
  c.pose('pet', 0.5, null, { yaw: 0 });
  expect(key(c, 'blink_L')).toBeGreaterThan(0.5);
  c.dispose();
});

test('the head and eyes turn with look.yaw whatever way the bones point', () => {
  const c = make();
  const eyeX = (yaw) => {
    c.pose('watch', 0, null, { yaw, now: 0 });
    c.root.updateMatrixWorld(true);
    return c.root.getObjectByName('eye_L').getWorldPosition(new THREE.Vector3()).x;
  };
  expect(eyeX(0.6)).toBeGreaterThan(eyeX(-0.6));
  c.dispose();
});

test('sulk sinks below 0.9 of its standing height, proud stands taller', () => {
  const c = make();
  const h = (phase, t) => (c.pose(phase, t, 'plain', { yaw: 0, now: 0 }), boxOf(c.root).max.y);
  const stand = h('exit', 1);
  expect(h('sulk', 1)).toBeLessThan(0.9 * stand);
  expect(h('proud', 1)).toBeGreaterThan(stand);
  c.dispose();
});

test('a model missing optional bones (no tail, no ears) still poses', () => {
  const template = buildStandinPet();
  for (const n of ['tail_1', 'ear_L', 'ear_R']) template.getObjectByName(n).name = `x_${n}`;
  const c = make('#ffffff', template);
  expect(() => c.pose('react', 0.5, 'crit', { yaw: 0 })).not.toThrow();
  c.dispose();
});

test('dispose frees the tinted copies, not the shared template', () => {
  const template = buildStandinPet();
  const c = make('#123456', template);
  let body;
  c.root.traverse((o) => o.name === 'Body' && (body = o.material));
  const spy = vi.spyOn(body, 'dispose');
  const tmpl = vi.spyOn(template.getObjectByName('Body').material, 'dispose');
  c.dispose();
  expect(spy).toHaveBeenCalled();
  expect(tmpl).not.toHaveBeenCalled();
});

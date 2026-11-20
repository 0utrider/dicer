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

describe('idle (watch) keeps every model pet moving', () => {
  const at = (c, ms, bone) => {
    c.pose('watch', 0, null, { yaw: 0, now: ms });
    return c.root.getObjectByName(bone).quaternion.clone();
  };
  const kindOf = (kind, template) => createModelCreature(template, '#c0392b', { kind, clock: () => 0 });
  test('the head looks round on its own, for any kind', () => {
    const c = kindOf('mushroom', buildStandinPet());
    expect(at(c, 0, 'head').angleTo(at(c, 2500, 'head'))).toBeGreaterThan(0.02);
    c.dispose();
  });
  test('a hoverer bobs up from its rest, never below it', () => {
    const c = kindOf('ghost', buildStandinPet());
    let lo = Infinity;
    let hi = -Infinity;
    for (let ms = 0; ms < 2000; ms += 100) {
      c.pose('watch', 0, null, { yaw: 0, now: ms });
      const y = c.root.getObjectByName('root').position.y;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    const rest = kindOf('ghost', buildStandinPet());
    rest.pose('exit', 1, 'plain', { yaw: 0 });
    const y0 = rest.root.getObjectByName('root').position.y;
    expect(lo).toBeGreaterThanOrEqual(y0 - 1e-9);
    expect(hi).toBeGreaterThan(y0 + 1e-3);
    c.dispose();
    rest.dispose();
  });
});

describe('reactions: each kind its own natural 20 and 1, the elements each their own look', () => {
  const kindOf = (kind) => safe((c) => createModelCreature(buildStandinPet(), c, { kind, clock: () => 0 }))('#c0392b');
  const pose = (c, phase, t, reaction) => {
    c.pose(phase, t, reaction, { yaw: 0, now: 0 });
    c.root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(c.root, true);
  };
  test('a flipper turns all the way over on a natural 20; a spinner turns round; a pouncer does neither', () => {
    const imp = kindOf('imp');
    const lantern = kindOf('lantern');
    const cat = kindOf('cat');
    let flip = 0;
    let spin = 0;
    let catTurn = 0;
    for (let t = 0; t <= 1; t += 0.02) {
      imp.pose('react', t, 'crit', { yaw: 0, now: 0 });
      lantern.pose('react', t, 'crit', { yaw: 0, now: 0 });
      cat.pose('react', t, 'crit', { yaw: 0, now: 0 });
      const w = (c) => c.root.children[0]; // the whirl group: flips and spins
      flip = Math.max(flip, Math.abs(w(imp).rotation.x));
      spin = Math.max(spin, Math.abs(w(lantern).rotation.y));
      catTurn = Math.max(catTurn, Math.abs(w(cat).rotation.x), Math.abs(w(cat).rotation.y));
    }
    expect(flip).toBeGreaterThan(Math.PI);
    expect(spin).toBeGreaterThan(Math.PI);
    expect(catTurn).toBe(0);
    for (const c of [imp, lantern, cat]) c.dispose();
  });
  test('no reaction of any style pushes the pet through the table', () => {
    for (const kind of ['imp', 'cat', 'lantern', 'robot', 'slime', 'frog', 'mimic', 'golem', 'owl']) {
      const c = kindOf(kind);
      for (const [phase, reaction] of [['react', 'crit'], ['react', 'fumble'], ['react', 'plain'], ['scorch'], ['shiver'], ['bristle'], ['startle']]) {
        for (let t = 0; t <= 1; t += 0.05) expect(pose(c, phase, t, reaction ?? null).min.y, `${kind} ${reaction ?? phase} ${t}`).toBeGreaterThan(-0.03);
      }
      c.dispose();
    }
  }, 60000);
  test('startle, scorch, shiver and bristle each look different, and startle is not the natural 20', () => {
    const c = kindOf('mushroom');
    const look = (phase, t, reaction) => {
      pose(c, phase, t, reaction);
      const out = [];
      c.root.traverse((o) => o.isBone && out.push(o.quaternion.x, o.quaternion.y, o.quaternion.z, o.position.y));
      c.root.traverse((o) => o.morphTargetInfluences && out.push(...o.morphTargetInfluences));
      return out;
    };
    const far = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
    const shots = { startle: look('startle', 0.25), scorch: look('scorch', 0.5), shiver: look('shiver', 0.5), bristle: look('bristle', 0.5), crit: look('react', 0.25, 'crit') };
    const names = Object.keys(shots);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) expect(far(shots[names[i]], shots[names[j]]), `${names[i]} vs ${names[j]}`).toBeGreaterThan(0.5);
    c.dispose();
  });
});

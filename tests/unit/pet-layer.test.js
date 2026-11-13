import * as THREE from 'three';
import { createPetLayer } from '../../src/pet/chunk/pets.js';

const AREA = { cx: 1, cz: -2, halfWidth: 6, halfDepth: 4 };
let clockNow = 0;
const make = (settings = {}, over = {}) => {
  clockNow = 0;
  const scene = new THREE.Scene();
  const playSound = vi.fn();
  const warm = vi.fn();
  const deps = {
    scene,
    camera: new THREE.PerspectiveCamera(),
    getTier: () => ({ shadows: true }),
    getSetting: (k) => settings[k],
    playSound,
    warm,
    now: () => clockNow,
    ...over,
  };
  return { layer: createPetLayer(deps), scene, playSound, warm, settings };
};
const spec = (userId = 'u1', ghost = false) => ({ userId, kind: 'mimic', color: '#ff0000', ghost });
const info = (edge = 0, s = spec()) => ({
  spec: s,
  edge,
  area: AREA,
  centre: () => ({ x: AREA.cx, z: AREA.cz }),
});
const pets = (scene) => scene.children.filter((c) => c.userData.dicerPet);
const d20 = (value, ghost) => ({ type: 'd20', value, ghost });

test('begin places the pet inside the named edge, outside the inner 60% of the area', () => {
  for (const edge of [0, 1, 2, 3]) {
    const { layer, scene } = make();
    layer.begin('k', info(edge));
    layer.update((clockNow = 0));
    layer.update((clockNow = 400)); // past the hop in: at its standing place
    const [p] = pets(scene);
    const dx = (p.position.x - AREA.cx) / AREA.halfWidth;
    const dz = (p.position.z - AREA.cz) / AREA.halfDepth;
    const along = edge < 2 ? dx : dz;
    const across = edge < 2 ? dz : dx;
    expect(Math.abs(across)).toBeLessThan(1e-6);
    expect(Math.abs(along)).toBeGreaterThan(0.6);
    expect(Math.abs(along)).toBeLessThan(1);
    expect(Math.sign(along)).toBe(edge % 2 === 0 ? 1 : -1);
    expect(p.position.y).toBe(0);
  }
});

test('same roller twice -> one pet; after both rolls end the layer holds 0 pets', () => {
  const { layer, scene } = make();
  layer.begin('a', info());
  layer.update((clockNow = 0));
  layer.begin('b', info());
  layer.update((clockNow = 100));
  expect(pets(scene)).toHaveLength(1);
  layer.end('a');
  expect(pets(scene)).toHaveLength(1);
  layer.end('b');
  expect(pets(scene)).toHaveLength(0);
  expect(layer.update((clockNow = 200))).toBe(false);
});

test('a re-used pet restarts from the throw, not the enter', () => {
  const { layer, scene } = make();
  layer.begin('a', info());
  layer.update((clockNow = 0));
  layer.update((clockNow = 5000));
  layer.begin('b', info());
  layer.update((clockNow = 5000));
  expect(pets(scene)[0].userData.dicerPet.phase).toBe('throw');
});

test('a fourth roller gets no pet', () => {
  const { layer, scene } = make();
  for (const u of ['u1', 'u2', 'u3', 'u4']) layer.begin(u, info(0, spec(u)));
  layer.update((clockNow = 0));
  expect(pets(scene)).toHaveLength(3);
  layer.landed('u4', [d20(20)]);
  layer.leave('u4', 0);
  layer.end('u4');
  expect(pets(scene)).toHaveLength(3);
});

const reactAndRun = (settings, dice, ghost = false) => {
  const m = make(settings);
  m.layer.begin('k', info(0, spec('u1', ghost)));
  m.layer.update((clockNow = 0));
  m.layer.landed('k', dice);
  m.layer.update((clockNow = 1000));
  m.layer.update((clockNow = 1100));
  return m;
};

test('crit plays petHappy, fumble petSad, mixed/plain silent', () => {
  expect(reactAndRun({}, [d20(20)]).playSound).toHaveBeenCalledWith({ builtin: 'petHappy' });
  expect(reactAndRun({}, [d20(1)]).playSound).toHaveBeenCalledWith({ builtin: 'petSad' });
  expect(reactAndRun({}, [d20(1), d20(20)]).playSound).not.toHaveBeenCalled();
  expect(reactAndRun({}, [{ type: 'd6', value: 6 }]).playSound).not.toHaveBeenCalled();
  expect(reactAndRun({}, [d20(20)]).playSound).toHaveBeenCalledTimes(1);
});

test('petSounds or sounds off, or a ghost roll -> silent', () => {
  expect(reactAndRun({ petSounds: false }, [d20(20)]).playSound).not.toHaveBeenCalled();
  expect(reactAndRun({ sounds: false }, [d20(20)]).playSound).not.toHaveBeenCalled();
  expect(reactAndRun({}, [d20(20)], true).playSound).not.toHaveBeenCalled();
});

const goneAt = (dice, ghost) => {
  const { layer } = make();
  layer.begin('k', info(0, spec('u1', ghost)));
  layer.update((clockNow = 0));
  layer.landed('k', dice);
  layer.update((clockNow = 1000));
  for (let t = 1000; t < 4000; t += 10) if (!layer.update((clockNow = t))) return t;
  return -1;
};

test("a ghost roll's reaction lasts exactly as long as a crit's", () => {
  const crit = goneAt([d20(20)], false);
  expect(crit).toBeGreaterThan(0);
  expect(goneAt([d20(20, true)], true)).toBe(crit);
  expect(goneAt([d20(20)], true)).toBe(crit);
  expect(goneAt([d20(1)], false)).toBe(crit);
});

test('update returns false once every pet is gone, and the scene is clean', () => {
  const { layer, scene } = make();
  layer.begin('k', info());
  expect(layer.update((clockNow = 0))).toBe(true);
  layer.landed('k', [d20(5)]);
  expect(layer.update((clockNow = 1000))).toBe(true);
  expect(layer.update((clockNow = 1000 + 1200 + 450))).toBe(false);
  expect(pets(scene)).toHaveLength(0);
});

test('leave(0) removes the pet at once', () => {
  const { layer, scene } = make();
  layer.begin('k', info());
  layer.update((clockNow = 0));
  layer.leave('k', 0);
  expect(layer.update((clockNow = 10))).toBe(false);
  expect(pets(scene)).toHaveLength(0);
});

test('shadow disc follows the shadows setting only', () => {
  const s = { shadows: true };
  const { layer, scene } = make(s, { getTier: () => ({ shadows: false }) });
  layer.begin('k', info());
  layer.update((clockNow = 0));
  const shadow = pets(scene)[0].getObjectByName('petShadow');
  expect(shadow.visible).toBe(true);
  s.shadows = false;
  layer.update((clockNow = 16));
  expect(shadow.visible).toBe(false);
});

test('warm is called once at creation with one root per creature', () => {
  const { warm } = make();
  expect(warm).toHaveBeenCalledTimes(1);
  expect(warm.mock.calls[0][0]).toHaveLength(3);
});

test('a throwing pet is removed with one warning; others keep going', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { layer, scene } = make();
  layer.begin('a', info(0, spec('u1')));
  layer.begin('b', {
    ...info(1, spec('u2')),
    centre: () => {
      throw new Error('x');
    },
  });
  layer.update((clockNow = 0));
  expect(pets(scene)).toHaveLength(2);
  expect(() => layer.update((clockNow = 700))).not.toThrow();
  expect(pets(scene)).toHaveLength(1);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

test('dispose removes every pet immediately', () => {
  const { layer, scene } = make();
  layer.begin('a', info(0, spec('u1')));
  layer.begin('b', info(1, spec('u2')));
  layer.update((clockNow = 0));
  layer.dispose();
  expect(pets(scene)).toHaveLength(0);
});

test('leave(k, 400) at T: gone and out of the scene by T + 400', () => {
  for (const at of [100, 700, 1000, 1700, 1790, 1850]) {
    const { layer, scene } = make();
    layer.begin('k', info());
    layer.update((clockNow = 0));
    layer.landed('k', [d20(20)]);
    layer.update((clockNow = at - 16));
    clockNow = at;
    layer.leave('k', 400);
    expect(layer.update((clockNow = at + 399))).toBe(true);
    expect(layer.update((clockNow = at + 400))).toBe(false);
    expect(pets(scene)).toHaveLength(0);
  }
});

test('a leave mid-hop exits from where the pet is, without a jump', () => {
  const { layer, scene } = make();
  layer.begin('k', info());
  layer.update((clockNow = 0));
  layer.update((clockNow = 150));
  const p = pets(scene)[0];
  const before = p.position.clone();
  clockNow = 150;
  layer.leave('k', 400);
  layer.update((clockNow = 160));
  expect(p.position.distanceTo(before)).toBeLessThan(0.3);
});

test('a late landed() from an earlier roll does not touch the newer roll', () => {
  const { layer, playSound } = make();
  layer.begin('a', info());
  layer.update((clockNow = 0));
  layer.begin('b', info());
  layer.landed('a', [d20(20)]);
  layer.landed('b', [d20(5)]);
  layer.update((clockNow = 1000));
  layer.update((clockNow = 1100));
  expect(playSound).not.toHaveBeenCalled();
});

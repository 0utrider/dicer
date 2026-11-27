import { afterEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createThemeApi } from '../../src/api/theme-api.js';
import { build as buildFox } from '../../scripts/pets/build-fox.js';
import { createModelCreature } from '../../src/pet/chunk/model-pet.js';
import { ACCESSORIES_HOOK, PET_ACCESSORIES } from '../../src/api/pet-accessories.js';
import { accessoriesFor, undress, wear } from '../../src/pet/chunk/accessories.js';
import { createPetLayer } from '../../src/pet/chunk/pets.js';
import { createMoods } from '../../src/pet/chunk/moods.js';

const MOD = 'hats';
const api = () => createThemeApi({ hooks: { callAll: vi.fn() }, modules: () => ({ get: (id) => (id === MOD ? { id } : undefined) }) });
const hat = (slug, extra = {}) => ({ id: `${MOD}.${slug}`, model: `modules/hats/${slug}.glb`, ...extra });
const box = (w, h, d, y = h / 2) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
  m.position.y = y;
  return m;
};
/** A pet 1.5 tall with a `head` bone near its top, as the model pets have. */
const creature = () => {
  const root = new THREE.Group();
  root.add(box(1, 1.5, 1));
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 1.2, 0.2);
  root.add(head);
  return { root, head, height: 1.5 };
};

afterEach(() => PET_ACCESSORIES.clear());

describe('registerPetAccessory', () => {
  test('needs an installed module, a prefixed id, a model file and a known slot', () => {
    const a = api();
    expect(a.registerPetAccessory('nope', hat('a'))).toBe(false);
    expect(a.registerPetAccessory(MOD, { ...hat('a'), id: 'other.a' })).toBe(false);
    expect(a.registerPetAccessory(MOD, hat('a', { model: 'hat.png' }))).toBe(false);
    expect(a.registerPetAccessory(MOD, hat('a', { slot: 'tail' }))).toBe(false);
    expect(a.registerPetAccessory(MOD, hat('a'))).toBe(true);
    expect(a.unregisterPetAccessory(`${MOD}.a`)).toBe(true);
    expect(a.unregisterPetAccessory(`${MOD}.a`)).toBe(false);
  });

  test('one per slot: the last registered whose when() is not false', () => {
    const a = api();
    a.registerPetAccessory(MOD, hat('santa'));
    a.registerPetAccessory(MOD, hat('witch', { when: (kind) => kind === 'cat' }));
    expect(accessoriesFor('cat').map((x) => x.id)).toEqual([`${MOD}.witch`]);
    expect(accessoriesFor('owl').map((x) => x.id)).toEqual([`${MOD}.santa`]);
  });
});

describe('wear', () => {
  test('on the head bone, over the top of the pet, sized by it; undress takes it off', () => {
    const c = creature();
    const worn = wear(c, box(4, 2, 4), { scale: 1 }, 'cat');
    expect(worn.holder.parent).toBe(c.head);
    c.root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(worn.holder);
    expect(b.max.x - b.min.x).toBeCloseTo(0.55 * 1.5, 5);
    expect(b.min.y).toBeCloseTo(1.5 - 0.08 * 1.5, 5);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0.2, 5);
    c.head.position.y += 1; // it follows the bone
    c.root.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(worn.holder).min.y).toBeCloseTo(2.5 - 0.08 * 1.5, 5);
    undress([worn]);
    expect(c.head.children).toHaveLength(0);
  });

  test("a pet's own scale and offset, and its own copy of the materials", () => {
    const c = creature();
    const template = box(1, 1, 1);
    const worn = wear(c, template, { scale: 1, kinds: { cat: { scale: 2, offset: { y: 0.5 } } } }, 'cat');
    c.root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(worn.holder);
    expect(b.max.x - b.min.x).toBeCloseTo(2 * 0.55 * 1.5, 5);
    expect(b.min.y).toBeCloseTo(1.5 + (0.5 - 0.08) * 1.5, 5);
    expect(worn.materials[0]).not.toBe(template.material);
  });
});

describe('wear, on a pet that is not standing still', () => {
  const place = (c, kinds) => {
    const { holder } = wear(c, box(4, 2, 4), { scale: 1, kinds }, 'cat');
    return [...holder.position.toArray(), holder.scale.x];
  };
  const close = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));

  test('the same place however the pet stands once its rest frame is taken', () => {
    const c = creature();
    const rest = place(c);
    c.root.rotation.x = 0.9; // tiltPet
    c.head.position.y += 0.5; // mid-hop
    const group = new THREE.Group();
    group.scale.setScalar(0.05); // leaving
    group.add(c.root);
    close(place(c), rest);
  });

  test('taken under a shrunk, tilted group, and with the pet size on the root', () => {
    const rest = place(creature());
    const c = creature();
    c.root.scale.setScalar(2);
    c.height *= 2;
    const group = new THREE.Group();
    group.scale.setScalar(0.05);
    group.rotation.x = 0.9;
    group.add(c.root);
    close(place(c), rest);
  });

  test('a tilt leans it about its base, per kind over the accessory', () => {
    const c = creature();
    const { holder } = wear(c, box(1, 2, 1), { scale: 1, tilt: { z: 30 }, kinds: { cat: { tilt: { x: -90 } } } }, 'cat');
    expect(holder.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
    expect(holder.rotation.z).toBeCloseTo(0, 5);
    // leaning back: its tip ends up behind its base (-z), its base still over the head
    c.root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(holder);
    expect(b.min.z).toBeLessThan(0.2 - 0.5);
    expect(b.max.y).toBeLessThan(1.5 + 0.55 * 1.5);
    const other = wear(creature(), box(1, 2, 1), { scale: 1, tilt: { z: 30 } }, 'owl');
    expect(other.holder.rotation.z).toBeCloseTo(Math.PI / 6, 5);
  });

  test('a per-kind bone hangs it there, over that bone; an unknown bone keeps the head', () => {
    const c = creature();
    const tail = new THREE.Bone();
    tail.name = 'tail_1';
    tail.position.set(0, 0.9, -0.4);
    c.root.add(tail);
    const head = new THREE.Bone();
    head.name = 'head';
    c.root.remove(c.head);
    head.position.copy(c.head.position);
    c.root.add(head);
    c.head = head;
    const worn = wear(c, box(1, 1, 1), { scale: 1, kinds: { spider: { bone: 'tail_1' } } }, 'spider');
    expect(worn.holder.parent).toBe(tail);
    c.root.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(worn.holder).getCenter(new THREE.Vector3()).z).toBeCloseTo(-0.4, 5);
    const lost = wear(creature(), box(1, 1, 1), { scale: 1, bone: 'nope' }, 'cat');
    expect(lost.holder.parent.name).toBe('head');
  });

  test('a per-kind scale of 0 or less is ignored', () => {
    const rest = place(creature());
    close(place(creature(), { cat: { scale: 0 } }), rest);
    close(place(creature(), { cat: { scale: -2 } }), rest);
  });

  test('on a loaded model: its head bone, over its top', () => {
    const c = createModelCreature(buildFox(), '#d9682a', { kind: 'fox', clock: () => 0 });
    const worn = wear(c, box(1, 1, 1), { scale: 1 }, 'fox');
    expect(worn.holder.parent).toBe(c.root.getObjectByName('head'));
    c.root.updateMatrixWorld(true);
    const hatBox = new THREE.Box3().setFromObject(worn.holder);
    expect(hatBox.min.y).toBeCloseTo(c.rest.top - 0.08 * 1.5, 2);
    expect(hatBox.max.x - hatBox.min.x).toBeCloseTo(0.55 * 1.5, 2);
    c.dispose();
  }, 120000);
});

test('the setting calls the hook the pet layer listens for', () => {
  expect(readFileSync('src/settings.js', 'utf8')).toContain(`callAll('${ACCESSORIES_HOOK}')`);
});

describe('the pet layer dresses its pets', () => {
  test('a pet gets the accessory once its model is in, and loses it with the setting off', async () => {
    api().registerPetAccessory(MOD, hat('santa'));
    const all = { petStay: 60, petRestSpot: 'bottomRight' };
    const scene = new THREE.Scene();
    let redress;
    const layer = createPetLayer({
      scene,
      getSetting: (k) => all[k],
      playSound: vi.fn(),
      now: () => 0,
      wake: vi.fn(),
      win: new EventTarget(),
      random: () => 0.5,
      moods: createMoods(),
      reducedMotion: () => false,
      setTimer: vi.fn(),
      clearTimer: vi.fn(),
      hooks: { on: (name, fn) => (name === 'dicer.petAccessoriesChanged' && (redress = fn), 1), off: vi.fn() },
      loadPetModel: (url) => (url.includes('santa') ? Promise.resolve(box(1, 1, 1)) : Promise.reject(new Error('no pet model here'))),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    layer.areaChanged({ cx: 0, cz: 0, halfWidth: 13, halfDepth: 8, rect: { left: 0, top: 0, width: 1280, height: 800 } });
    const begin = () =>
      layer.begin('k', {
        spec: { userId: 'u1', kind: 'mimic', color: '#ff0000', ghost: false },
        edge: 0,
        area: { cx: 0, cz: 0, halfWidth: 13, halfDepth: 8 },
        centre: () => ({ x: 0, z: 0 }),
      });
    const worn = () => {
      let n = 0;
      scene.traverse((o) => (n += o.name === 'dicerAccessory' ? 1 : 0));
      return n;
    };
    begin();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
    begin();
    expect(worn()).toBe(1);
    all.petAccessories = false;
    redress();
    expect(worn()).toBe(0);
    layer.dispose();
    warn.mockRestore();
  });

  test('an accessory that cannot be put on is warned about once; a failed model is tried again on a change', async () => {
    api().registerPetAccessory(MOD, hat('santa'));
    api().registerPetAccessory(MOD, hat('santa'));
    const all = { petStay: 60, petRestSpot: 'bottomRight' };
    const scene = new THREE.Scene();
    let redress;
    let loads = 0;
    const broken = box(1, 1, 1);
    broken.clone = () => {
      throw new Error('broken');
    };
    const layer = createPetLayer({
      scene,
      getSetting: (k) => all[k],
      playSound: vi.fn(),
      now: () => 0,
      wake: vi.fn(),
      win: new EventTarget(),
      random: () => 0.5,
      moods: createMoods(),
      reducedMotion: () => false,
      setTimer: vi.fn(),
      clearTimer: vi.fn(),
      hooks: { on: (name, fn) => (name === 'dicer.petAccessoriesChanged' && (redress = fn), 1), off: vi.fn() },
      loadPetModel: (url) => (url.includes('santa') && loads++ ? Promise.resolve(broken) : Promise.reject(new Error('nothing here'))),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    layer.areaChanged({ cx: 0, cz: 0, halfWidth: 13, halfDepth: 8, rect: { left: 0, top: 0, width: 1280, height: 800 } });
    const begin = () =>
      layer.begin('k', {
        spec: { userId: 'u1', kind: 'mimic', color: '#ff0000', ghost: false },
        edge: 0,
        area: { cx: 0, cz: 0, halfWidth: 13, halfDepth: 8 },
        centre: () => ({ x: 0, z: 0 }),
      });
    const settle = async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
    };
    const cannot = () => warn.mock.calls.filter((c) => String(c[0]).includes('cannot be shown')).length;
    begin();
    await settle();
    expect(loads).toBe(1);
    redress(); // the failed load is tried again
    await settle();
    begin();
    begin();
    expect(loads).toBe(2);
    expect(cannot()).toBe(1);
    layer.dispose();
    warn.mockRestore();
  });
});

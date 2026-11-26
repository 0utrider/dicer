import { afterEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { createThemeApi } from '../../src/api/theme-api.js';
import { PET_ACCESSORIES } from '../../src/api/pet-accessories.js';
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
});

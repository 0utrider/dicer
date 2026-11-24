import * as THREE from 'three';
import { loadDieModel, loadForBox, dressModel, materialList, clearModelCache } from '../../src/render/model-loader.js';

/** A box with no material groups (BoxGeometry has one per side). */
const box = (size) => {
  const g = new THREE.BoxGeometry(size, size, size);
  g.clearGroups();
  return g;
};

/**
 * A stub GLTFLoader: one off-centre box mesh (radius sqrt(3) * 10 around (5, 0, 0)) under a
 * node. `split` adds a second mesh; `groups` gives the mesh two material groups.
 */
function stubLoader({ empty = false, split = false, groups = false } = {}) {
  const material = new THREE.MeshStandardMaterial();
  return {
    material,
    loadAsync: vi.fn(async (url) => {
      if (url === 'bad.glb') throw new Error(`404 ${url}`);
      const scene = new THREE.Group();
      if (!empty) {
        const geometry = box(20);
        let mat = material;
        if (groups) {
          geometry.addGroup(0, 18, 0);
          geometry.addGroup(18, 18, 1);
          mat = [material, new THREE.MeshStandardMaterial()];
        }
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.position.set(5, 0, 0);
        const holder = new THREE.Group();
        holder.add(mesh);
        scene.add(holder);
        if (split) scene.add(new THREE.Mesh(box(1), new THREE.MeshStandardMaterial()));
      }
      return { scene };
    }),
  };
}

beforeEach(() => clearModelCache());

test('takes the die mesh, recentres it and scales it to the target radius', async () => {
  const loader = stubLoader();
  const { geometry, material } = await loadDieModel('a.glb', { radius: 0.9, loader });
  expect(material).toBe(loader.material);
  geometry.computeBoundingBox();
  const centre = geometry.boundingBox.getCenter(new THREE.Vector3());
  expect(centre.length()).toBeLessThan(1e-6);
  expect(geometry.boundingSphere.radius).toBeCloseTo(0.9, 6);
  expect(geometry.boundingBox.max.x).toBeCloseTo(0.9 / Math.sqrt(3), 6);
});

test('caches by url: one load per url, whatever the radius', async () => {
  const loader = stubLoader();
  const a = await loadDieModel('a.glb', { radius: 1, loader });
  const b = await loadDieModel('a.glb', { radius: 1, loader });
  const c = await loadDieModel('a.glb', { radius: 0.5, loader });
  expect(b).toBe(a);
  expect(c.geometry.boundingSphere.radius).toBeCloseTo(0.5, 6);
  expect(c.material).toBe(a.material);
  expect(a.geometry.boundingSphere.radius).toBeCloseTo(1, 6); // the shared result is untouched
  await loadDieModel('b.glb', { loader });
  expect(loader.loadAsync).toHaveBeenCalledTimes(2);
});

test('rejects cleanly on a bad url, and a failed load is retried next time', async () => {
  const loader = stubLoader();
  await expect(loadDieModel('bad.glb', { loader })).rejects.toThrow('404 bad.glb');
  await expect(loadDieModel('bad.glb', { loader })).rejects.toThrow('404 bad.glb');
  expect(loader.loadAsync).toHaveBeenCalledTimes(2);
  await expect(loadDieModel('', { loader })).rejects.toThrow(/needs a url/);
  await expect(loadDieModel(undefined, { loader })).rejects.toThrow(/needs a url/);
});

test('rejects a model without a mesh', async () => {
  const loader = stubLoader({ empty: true });
  await expect(loadDieModel('e.glb', { loader })).rejects.toThrow(/no mesh/);
});

// Ember Lunar Dice: a body, its labels (and Cora's ring) are separate glTF primitives or meshes
test('a die split over several meshes becomes one geometry with a group and a material per part', async () => {
  const loader = stubLoader({ split: true });
  const { geometry, material } = await loadDieModel('split.glb', { radius: 1, loader });
  expect(Array.isArray(material)).toBe(true);
  expect(material).toHaveLength(2);
  expect(material[0]).toBe(loader.material);
  expect(geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
  expect(geometry.groups[0].start).toBe(0);
  expect(geometry.groups[1].start).toBe(geometry.groups[0].count);
  expect(geometry.groups[0].count + geometry.groups[1].count).toBe(geometry.index ? geometry.index.count : geometry.attributes.position.count);
});

test('a split die is sized and centred by its smallest part (the die itself): a ring around it sticks out', async () => {
  const body = new THREE.MeshStandardMaterial({ name: 'BODY' });
  const ring = new THREE.MeshStandardMaterial({ name: 'RINGS' });
  const loader = {
    loadAsync: async () => {
      const scene = new THREE.Group();
      const ringMesh = new THREE.Mesh(box(60), ring);
      ringMesh.position.set(5, 0, 0);
      const die = new THREE.Mesh(box(20), body);
      die.position.set(5, 0, 0);
      scene.add(ringMesh, die); // the ring first: the die is found by size, not by order
      return { scene };
    },
  };
  const { geometry, material } = await loadDieModel('ring.glb', { radius: 1, loader });
  expect(material.map((m) => m.name)).toEqual(['RINGS', 'BODY']);
  geometry.computeBoundingBox();
  expect(geometry.boundingBox.getCenter(new THREE.Vector3()).length()).toBeLessThan(1e-6);
  expect(geometry.boundingBox.max.x).toBeCloseTo(3 / Math.sqrt(3), 5); // the ring: three times the die
});

test('a single mesh with several material groups keeps its groups and materials', async () => {
  const loader = stubLoader({ groups: true });
  const { geometry, material } = await loadDieModel('groups.glb', { loader });
  expect(material).toHaveLength(2);
  expect(geometry.groups).toHaveLength(2);
  const oneGroup = stubLoader();
  oneGroup.loadAsync.mockImplementationOnce(async () => {
    const g = box(2);
    g.addGroup(0, Infinity, 0); // a single group is still one surface
    return { scene: new THREE.Mesh(g, oneGroup.material) };
  });
  await expect(loadDieModel('one.glb', { loader: oneGroup })).resolves.toMatchObject({
    material: oneGroup.material,
  });
});

/** A DiceSystem stand-in whose shader callback behaves as Dice So Nice's (reads the material's userData). */
const system = (patch) => ({
  id: 'lunar',
  beforeShaderCompile: vi.fn((shader, mat) => patch(shader, mat, mat.userData.diceType, mat.userData.appearance)),
});

test("a model's materials get the dice system's shader callback, once, with the die type Dice So Nice hands it", () => {
  const body = new THREE.MeshStandardMaterial({ name: 'MAT_d20' });
  const labels = new THREE.MeshStandardMaterial({ name: 'MAT_LABELS_d20' });
  const seen = [];
  const instance = system((shader, mat, type) => {
    seen.push([mat.name, type]);
    shader.fragmentShader += '// lunar';
  });
  const model = { material: [body, labels] };
  dressModel(model, { systemInstance: instance, system: 'lunar', type: 'd10', dsnType: 'd20', appearance: { a: 1 } });
  dressModel(model, { systemInstance: instance, system: 'lunar', type: 'd10', dsnType: 'd20', appearance: { a: 1 } }); // a second die of the roll
  for (const m of [body, labels]) {
    expect(m.userData).toMatchObject({ diceType: 'd20', system: 'lunar', appearance: { a: 1 } });
    const shader = { uniforms: {}, vertexShader: 'v', fragmentShader: 'f' };
    m.onBeforeCompile(shader);
    expect(shader.fragmentShader).toBe('f// lunar');
  }
  expect(seen).toEqual([['MAT_d20', 'd20'], ['MAT_LABELS_d20', 'd20']]); // the Dice So Nice type (a d100's, not its d10 shape)
  // never the program of a plain glTF material, or of another set's with the same options
  expect(body.customProgramCacheKey()).not.toBe(labels.customProgramCacheKey());
  expect(body.customProgramCacheKey()).toContain('lunar');
});

test('a callback that throws leaves the shader as it was and warns once; the die still draws', () => {
  const mat = new THREE.MeshStandardMaterial();
  const warn = vi.fn();
  const instance = system((shader) => {
    shader.fragmentShader = 'broken';
    shader.uniforms.x = { value: 1 };
    throw new Error('boom');
  });
  dressModel({ material: mat }, { systemInstance: instance, system: 'lunar', type: 'd6' }, warn);
  const shader = { uniforms: {}, vertexShader: 'v', fragmentShader: 'f' };
  mat.onBeforeCompile(shader);
  mat.onBeforeCompile(shader);
  expect(shader).toEqual({ uniforms: {}, vertexShader: 'v', fragmentShader: 'f' });
  expect(warn).toHaveBeenCalledTimes(1);
});

test('a shader that reads the clock keeps its dice drawing (mixer), on the material and on a material list', () => {
  const a = new THREE.MeshStandardMaterial();
  const b = new THREE.MeshStandardMaterial();
  const list = materialList([a, b]);
  const instance = system((shader, mat) => {
    if (mat === b) shader.uniforms.time = { value: 0 };
  });
  dressModel({ material: list }, { systemInstance: instance, system: 'lunar', type: 'd6' });
  expect(list.mixer).toBeUndefined();
  a.onBeforeCompile({ uniforms: {}, vertexShader: '', fragmentShader: '' });
  expect(a.mixer).toBeUndefined();
  b.onBeforeCompile({ uniforms: {}, vertexShader: '', fragmentShader: '' });
  expect(b.mixer).toBeTruthy();
  expect(list.mixer).toBeTruthy();
});

test('without a dice system with a shader callback, a model is left as it is', () => {
  const mat = new THREE.MeshStandardMaterial();
  const before = mat.onBeforeCompile;
  dressModel({ material: mat }, { systemInstance: null, system: 'x', type: 'd6' });
  dressModel({ material: mat }, { systemInstance: {}, system: 'x', type: 'd6' });
  expect(mat.onBeforeCompile).toBe(before);
});

// DiceBox fades a die on a clone of its material, then disposes the clone: a split model's list does all of it
test("a split model's material list fades and frees as one material: clones that keep the shader callback", async () => {
  const { material } = await loadDieModel('split.glb', { loader: stubLoader({ split: true }) });
  const instance = system((shader) => {
    shader.fragmentShader += '// lunar';
  });
  dressModel({ material }, { systemInstance: instance, system: 'lunar', type: 'd6' });
  const fade = material.clone();
  expect(Array.isArray(fade)).toBe(true);
  expect(fade).toHaveLength(2);
  fade.transparent = true;
  fade.depthWrite = false;
  fade.opacity = 0.4;
  fade.forEach((m, i) => {
    expect(m).not.toBe(material[i]);
    expect(m).toMatchObject({ transparent: true, depthWrite: false, opacity: 0.4 });
    expect(m.userData).toBe(material[i].userData);
    expect(m.customProgramCacheKey).toBe(material[i].customProgramCacheKey);
    const shader = { uniforms: {}, vertexShader: 'v', fragmentShader: 'f' };
    m.onBeforeCompile(shader);
    expect(shader.fragmentShader).toBe('f// lunar');
  });
  expect(material.every((m) => !m.transparent && m.opacity === 1)).toBe(true);
  const disposed = fade.map((m) => vi.spyOn(m, 'dispose'));
  fade.dispose();
  for (const d of disposed) expect(d).toHaveBeenCalledTimes(1);
  expect(material.map((m) => m.name)).toEqual(['', '']); // map() gives a plain array
});

test('DiceBox gets a model with its rotations, the free-die follower and dressModel', async () => {
  const model = await loadForBox('a.glb', { loader: stubLoader() });
  expect(model).toMatchObject({ dress: dressModel, rotationFor: expect.any(Function), followFor: expect.any(Function) });
  expect(model.geometry).toBeTruthy();
});

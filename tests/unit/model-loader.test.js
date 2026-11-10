import * as THREE from 'three';
import { loadDieModel, clearModelCache } from '../../src/render/model-loader.js';

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

test('rejects a die split over several meshes, or with several material groups', async () => {
  await expect(loadDieModel('split.glb', { loader: stubLoader({ split: true }) })).rejects.toThrow(
    /split over 2 meshes/,
  );
  await expect(loadDieModel('groups.glb', { loader: stubLoader({ groups: true }) })).rejects.toThrow(
    /several material groups/,
  );
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

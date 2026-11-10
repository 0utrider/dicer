import * as THREE from 'three';
import { loadDieModel, clearModelCache } from '../../src/render/model-loader.js';

/** A stub GLTFLoader: one off-centre box mesh (radius sqrt(3) * 10 around (5, 0, 0)). */
function stubLoader({ fail = false, empty = false } = {}) {
  const material = new THREE.MeshStandardMaterial();
  return {
    material,
    loadAsync: vi.fn(async (url) => {
      if (fail || url === 'bad.glb') throw new Error(`404 ${url}`);
      const scene = new THREE.Group();
      if (!empty) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), material);
        mesh.position.set(5, 0, 0);
        const holder = new THREE.Group();
        holder.add(mesh);
        scene.add(holder, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
      }
      return { scene };
    }),
  };
}

beforeEach(() => clearModelCache());

test('takes the first mesh, recentres it and scales it to the target radius', async () => {
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

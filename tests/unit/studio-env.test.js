import * as THREE from 'three';
import { createStudioScene } from '../../src/render/studio-env.js';
import { buildScene } from '../../src/render/scene.js';

function panels(scene) {
  scene.updateMatrixWorld(true);
  return scene.children.filter((c) => c.isMesh && c.userData.panel);
}

test('studio scene has 6 emissive panels plus 1 backdrop', () => {
  const scene = createStudioScene();
  expect(panels(scene).map((p) => p.userData.panel)).toEqual([
    'overhead',
    'key',
    'rim',
    'fill',
    'sweep',
    'table',
  ]);
  const backdrops = scene.children.filter((c) => c.isMesh && !c.userData.panel);
  expect(backdrops.length).toBe(1);
  expect(backdrops[0].material.side).toBe(THREE.BackSide);
  expect(backdrops[0].material.color.getHex()).toBe(new THREE.Color('#0d0f14').getHex());
});

test('the overhead panel has the highest y', () => {
  const ps = panels(createStudioScene());
  const top = ps.reduce((a, b) => (b.position.y > a.position.y ? b : a));
  expect(top.userData.panel).toBe('overhead');
  expect(top.position.y).toBe(8);
});

test('every panel normal faces the origin', () => {
  for (const p of panels(createStudioScene())) {
    const n = new THREE.Vector3(0, 0, 1).transformDirection(p.matrixWorld);
    const toOrigin = p.position.clone().negate();
    expect(n.dot(toOrigin)).toBeGreaterThan(0);
  }
});

test('panels are emissive: colour is multiplied by intensity', () => {
  const byName = Object.fromEntries(panels(createStudioScene()).map((p) => [p.userData.panel, p]));
  expect(byName.key.material.color.r).toBeCloseTo(10);
  expect(byName.overhead.material.color.r).toBeCloseTo(2.5);
  expect(byName.rim.material.color.r).toBeCloseTo(8);
  expect(byName.fill.material.color.r).toBeCloseTo(1.5);
  expect(byName.fill.material.color.b).toBeLessThan(byName.fill.material.color.r);
});

test('metals see a bright studio: a large dim sweep behind and above, and a dim table below', () => {
  const byName = Object.fromEntries(panels(createStudioScene()).map((p) => [p.userData.panel, p]));
  const { sweep, table } = byName;
  // the sweep fills the upper back hemisphere that a 52-degree gallery view mirrors off top faces
  expect(sweep.position.z).toBeLessThan(0);
  expect(sweep.position.y).toBeGreaterThan(0);
  expect(sweep.geometry.parameters.width).toBeGreaterThanOrEqual(12);
  // the table is below the horizon (lower faces of metal dice reflect it instead of black)
  expect(table.position.y).toBeLessThan(0);
  for (const p of [sweep, table])
    expect(p.material.color.r).toBeLessThan(byName.fill.material.color.r);
});

test('no textures are used, so the environment costs zero asset bytes', () => {
  const scene = createStudioScene();
  scene.traverse((o) => {
    if (o.material) expect(o.material.map ?? null).toBeNull();
  });
});

test('setEnvironment: same resolution is a no-op, a new resolution regenerates', () => {
  const targets = [];
  const fromScene = vi.fn(() => {
    const t = { texture: new THREE.Texture(), dispose: vi.fn() };
    targets.push(t);
    return t;
  });
  const gen = vi.fn(function () {
    this.fromScene = fromScene;
    this.dispose = vi.fn();
  });
  const api = buildScene({ PMREMGenerator: gen });
  api.setEnvironment({}, { resolution: 256 });
  api.setEnvironment({}, { resolution: 256 });
  expect(fromScene).toHaveBeenCalledTimes(1);
  expect(fromScene.mock.calls[0].slice(1)).toEqual([0.02, 0.1, 100, { size: 256 }]);
  api.setEnvironment({}, { resolution: 128 });
  expect(fromScene).toHaveBeenCalledTimes(2);
  expect(targets[0].dispose).toHaveBeenCalledTimes(1);
  expect(fromScene.mock.calls[1][4]).toEqual({ size: 128 });
  expect(api.scene.environment).toBe(targets[1].texture);
});

// The "random scene" choice (scene-random): per die, one of the outcome's scenes, picked by where the
// die rests, the same on every screen (the throw is simulated alike for everyone).
import * as THREE from 'three';
import { SCENE_CATALOG, RANDOM_SCENE, pickScene, restSeed } from '../../src/effects/library/scene-catalog.js';
import { SCENE_STUBS, _setSceneImport, loadScenes, sceneOf } from '../../src/effects/library/scene-stubs.js';

const highs = SCENE_CATALOG.filter((s) => s.outcome === 'critical-success').map((s) => s.id);
const lows = SCENE_CATALOG.filter((s) => s.outcome === 'critical-failure').map((s) => s.id);

test("pickScene: always one of the outcome's scenes, the same for the same seed, and every one reachable", () => {
  const seen = new Set();
  for (let seed = -50; seed < 50; seed++) {
    const id = pickScene('critical-success', seed);
    expect(highs).toContain(id);
    expect(pickScene('critical-success', seed)).toBe(id);
    seen.add(id);
    expect(lows).toContain(pickScene('critical-failure', seed));
  }
  expect(seen.size).toBe(highs.length);
  expect(pickScene('critical-success', NaN)).toBe(highs[0]);
  expect(pickScene('nonsense', 3)).toBeNull();
});

test('restSeed: the same spot gives the same seed; spots apart give different picks', () => {
  expect(restSeed({ x: 1.234, z: -2.5 })).toBe(restSeed({ x: 1.2341, z: -2.4999 }));
  const picks = new Set();
  for (let i = 0; i < 40; i++) picks.add(pickScene('critical-success', restSeed({ x: i * 0.37, z: -i * 0.21 })));
  expect(picks.size).toBeGreaterThan(5);
  expect(Number.isInteger(restSeed(undefined))).toBe(true);
});

test("the random scene is a scene id; its stand-in plays the picked scene (a natural 1's from the natural 1s)", async () => {
  expect(sceneOf({ effect: { id: RANDOM_SCENE } })).toBe(RANDOM_SCENE);
  expect(sceneOf({ effect: { id: 'sparkles', scene: RANDOM_SCENE } })).toBe(RANDOM_SCENE);
  const played = [];
  const SCENES = Object.fromEntries(SCENE_CATALOG.map((s) => [s.id, { play: () => (played.push(s.id), { update: () => false, stop() {} }) }]));
  _setSceneImport(async () => ({ SCENES }));
  await loadScenes();
  const play = async (value, x, z) => {
    const outer = new THREE.Group();
    outer.position.set(x, 0.8, z);
    const scene = new THREE.Scene();
    scene.add(outer);
    const die = { outer, inner: new THREE.Mesh(), geometry: new THREE.IcosahedronGeometry(0.9), value, type: 'd20' };
    SCENE_STUBS[RANDOM_SCENE].start({ scene, die, position: outer.position.clone(), color: new THREE.Color(), intensity: 1, duration: 3000, options: { id: RANDOM_SCENE }, tier: { effectBudget: 6 }, shake() {}, reducedMotion: false, setting: () => undefined, box: null });
    await loadScenes();
    await Promise.resolve();
    return played.at(-1);
  };
  const a = await play(20, 1.5, -0.75);
  expect(highs).toContain(a);
  expect(a).toBe(pickScene('critical-success', restSeed({ x: 1.5, z: -0.75 })));
  expect(await play(20, 1.5, -0.75)).toBe(a); // same spot, same scene: what every screen sees
  expect(lows).toContain(await play(1, -2.25, 0.5));
});

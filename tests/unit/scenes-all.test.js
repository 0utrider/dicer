import { SCENES } from '../../src/scenes/scenes.js';
import { SCENE_CATALOG, SCENE_IDS } from '../../src/effects/library/scene-catalog.js';
import { checkScene } from './scene-contract.js';

/**
 * Every crit scene, held to the same contract: the die always ends exactly home (shown, at its rest
 * pose), the scene leaves nothing behind, it ends within its catalogued duration, the reduced form
 * never moves the die, a play is deterministic, and a scene with a mid-roll catch (swallow) hides
 * the die and gives it back.
 */

const entries = Object.values(SCENES);

test('the scenes chunk has exactly the catalogued scenes, each with its catalogued outcome and duration', () => {
  expect(Object.keys(SCENES).sort()).toEqual([...SCENE_IDS].sort());
  for (const c of SCENE_CATALOG) {
    expect(SCENES[c.id], c.id).toBeTruthy();
    expect(SCENES[c.id].id).toBe(c.id);
    expect(SCENES[c.id].outcome, c.id).toBe(c.outcome);
    expect(SCENES[c.id].duration, c.id).toBe(c.duration);
    expect(typeof SCENES[c.id].name).toBe('string');
  }
  expect(SCENE_CATALOG.filter((c) => c.outcome === 'critical-success')).toHaveLength(10);
  expect(SCENE_CATALOG.filter((c) => c.outcome === 'critical-failure')).toHaveLength(10);
});

for (const scene of entries) checkScene(scene);

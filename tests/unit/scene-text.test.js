// @vitest-environment jsdom
// A rule's own words on its crit scene's title card (its effect's sceneText: two lines, a blank one
// keeps the scene's own): written by the trigger and theme editors, carried to the scene, swapped
// into the card's lines with their style kept.
import * as THREE from 'three';
import { SCENE_CATALOG, SCENE_TEXT_MAX, sceneText } from '../../src/effects/library/scene-catalog.js';
import { expandScenes } from '../../src/effects/library/scene-stubs.js';
import { withText } from '../../src/scenes/card.js';
import { SCENES } from '../../src/scenes/scenes.js';
import { borrowDie } from '../../src/effects/library/borrow.js';
import { formFromTheme, themeFromForm } from '../../src/ui/theme-form.js';
import { entryFromRule, rawRuleFromEntry, blankEntry } from '../../src/ui/trigger-form.js';
import { normalizeRule } from '../../src/effects/rules.js';
import { normalizeTheme } from '../../src/themes/themes.js';

test('sceneText: two trimmed lines of at most SCENE_TEXT_MAX characters; all blank or not a list is none', () => {
  expect(sceneText(['  Sneak ', 'Attack!'])).toEqual(['Sneak', 'Attack!']);
  expect(sceneText(['', 'Only the big line'])).toEqual(['', 'Only the big line']);
  expect(sceneText(['x'.repeat(40)])[0]).toHaveLength(SCENE_TEXT_MAX);
  expect(sceneText(['  ', ''])).toBeNull();
  expect(sceneText('Nat 20')).toBeNull();
  expect(sceneText([7, null])).toBeNull();
});

test('withText swaps the card lines’ text, keeping their style; a blank line keeps the scene’s own', () => {
  const spec = { lines: [{ text: 'Natural', size: 0.13, enter: 'slam' }, { text: '20!', size: 0.3, enter: 'pop' }], rays: {} };
  expect(withText(spec, ['Sneak', 'Attack!']).lines).toEqual([
    { text: 'Sneak', size: 0.13, enter: 'slam' },
    { text: 'Attack!', size: 0.3, enter: 'pop' },
  ]);
  expect(withText(spec, ['', 'Backstab']).lines.map((l) => l.text)).toEqual(['Natural', 'Backstab']);
  expect(withText(spec, null)).toBe(spec);
});

/** The text of the card a scene shows (reduced form, quick), with `cardText` as a rule's own words. */
function cardOf(scene, cardText) {
  const three = new THREE.Scene();
  const outer = new THREE.Group();
  outer.position.set(2.5, 0.8, -1.5);
  three.add(outer);
  const geometry = new THREE.IcosahedronGeometry(0.9);
  geometry.computeBoundingSphere();
  const die = { outer, inner: new THREE.Mesh(), geometry, value: 20, type: 'd20', shadow: { follow: { position: outer.position, geometry } } };
  const box = { _rolls: [{ phase: 'lingering', removed: false, dice: [die], timer: 0 }], _linger() {}, _renderer: { requestFrame() {} } };
  const host = document.createElement('div');
  const h = scene.play({ scene: three, die, anchor: outer.position.clone(), restQuat: outer.quaternion.clone(), radius: 0.9, reduced: true, shake() {}, glint() {}, borrow: borrowDie(box, die), cardHost: host, cardText });
  for (let t = 0; t < 2500 && !host.children.length; t += 16) if (!h.update(t)) break;
  const lines = [...(host.querySelector('.dicer-crit-card')?.children ?? [])].map((c) => c.textContent.trim()).filter(Boolean);
  h.stop();
  return lines;
}

test("every scene's catalogued card lines are the ones it shows, and a rule's own words replace them", () => {
  for (const { id, card } of SCENE_CATALOG) {
    expect(cardOf(SCENES[id]), id).toEqual(card);
    expect(cardOf(SCENES[id], ['', 'Sneak Attack']), id).toEqual([card[0], 'Sneak Attack']);
  }
});

test('the trigger editor reads and writes the two lines; no scene, no text', () => {
  const rule = normalizeRule({ id: 'r', outcome: 'critical-success', effect: { id: 'sparkles', scene: 'scene-meteor', sceneText: ['Sneak', 'Attack!'] } }, 'user', () => {});
  const e = entryFromRule(rule);
  expect([e.sceneLine1, e.sceneLine2]).toEqual(['Sneak', 'Attack!']);
  expect(e.effectExtra).toBe(''); // not hidden among the effect's extras
  expect(rawRuleFromEntry(e).effect).toEqual({ id: 'sparkles', scene: 'scene-meteor', sceneText: ['Sneak', 'Attack!'] });
  expect(rawRuleFromEntry({ ...e, sceneLine1: ' ', sceneLine2: '' }).effect).toEqual({ id: 'sparkles', scene: 'scene-meteor' });
  expect(rawRuleFromEntry({ ...e, sceneId: '' }).effect).toEqual({ id: 'sparkles' });
  const only = { ...blankEntry('n'), outcome: 'critical-failure', sceneId: 'scene-anvil', sceneLine2: 'Backstab... not' };
  expect(rawRuleFromEntry(only).effect).toEqual({ id: 'scene-anvil', sceneText: ['', 'Backstab... not'] });
});

test("the theme editor's celebration rows read and write them; changing or clearing the scene keeps them right", () => {
  const bare = { id: 'user.u1.t', name: 'T', appearance: {}, perType: {}, rules: [] };
  const nat20 = (t) => t.rules.find((r) => r.id === 'dicer.nat20');
  const t = themeFromForm({ nat20: { effect: 'sparkles', scene: 'scene-meteor', sceneLine1: 'Sneak', sceneLine2: 'Attack!', sound: '' } }, bare);
  expect(nat20(t).effect).toEqual({ id: 'sparkles', scene: 'scene-meteor', sceneText: ['Sneak', 'Attack!'] });
  expect(formFromTheme(t).nat20).toMatchObject({ sceneLine1: 'Sneak', sceneLine2: 'Attack!' });
  expect(normalizeTheme(t, 'user', () => {})).not.toBeNull();
  const blank = themeFromForm({ nat20: { effect: 'sparkles', scene: 'scene-meteor', sceneLine1: '', sceneLine2: '', sound: '' } }, t);
  expect(nat20(blank).effect).toEqual({ id: 'sparkles', scene: 'scene-meteor' });
  const cleared = themeFromForm({ nat20: { effect: 'sparkles', scene: '', sceneLine1: 'Sneak', sceneLine2: '', sound: '' } }, t);
  expect(nat20(cleared).effect).toEqual({ id: 'sparkles' });
});

test('a scene played beside its effect carries the rule’s own words', () => {
  const list = expandScenes([{ ruleId: 'a', effect: { id: 'sparkles', scene: 'scene-meteor', sceneText: ['Sneak', 'Attack!'] }, value: 20, type: 'd20' }]);
  expect(list[1].effect).toEqual({ id: 'scene-meteor', sceneText: ['Sneak', 'Attack!'] });
  expect(expandScenes([{ ruleId: 'b', effect: { id: 'glint', scene: 'scene-anvil' } }])[1].effect).toEqual({ id: 'scene-anvil' });
});

test("the scene's stand-in hands the rule's words (its effect options) to the scene as cardText", async () => {
  const { SCENE_STUBS, _setSceneImport, loadScenes } = await import('../../src/effects/library/scene-stubs.js');
  let seen;
  _setSceneImport(async () => ({ SCENES: { 'scene-meteor': { play: (c) => ((seen = c.cardText), { update: () => false, stop() {} }) } } }));
  await loadScenes();
  const outer = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(outer);
  const die = { outer, inner: new THREE.Mesh(), geometry: new THREE.IcosahedronGeometry(0.9), value: 20, type: 'd20' };
  const start = (options) =>
    SCENE_STUBS['scene-meteor'].start({ scene, die, position: outer.position.clone(), color: new THREE.Color(), intensity: 1, duration: 2400, options, tier: { effectBudget: 6 }, shake() {}, reducedMotion: false, setting: () => undefined, box: null });
  start({ id: 'scene-meteor', sceneText: [' Sneak ', 'Attack!'] });
  await loadScenes();
  await Promise.resolve();
  expect(seen).toEqual(['Sneak', 'Attack!']);
  start({ id: 'scene-meteor' });
  await loadScenes();
  await Promise.resolve();
  expect(seen).toBeNull();
});

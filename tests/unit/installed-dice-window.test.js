// @vitest-environment jsdom
/** The GM's picker of installed modules' dice (src/ui/installed-dice.js): its list and its saves. */
import { expect, test } from 'vitest';
import { buildList, togglePick, toggleAddon } from '../../src/ui/installed-dice.js';

const found = [
  { id: 'adventure', title: 'An Adventure', scripts: ['modules/adventure/index.js'], status: 'other' },
  { id: 'marble', title: 'Marble Dice', scripts: ['modules/marble/diceset.js'], status: 'ok' },
];

test('a box per module that only adds dice; the others are greyed with why', () => {
  const form = buildList(found, [{ id: 'marble' }]);
  const [adventure, marble] = form.querySelectorAll('li');
  expect(marble.querySelector('input').checked).toBe(true);
  expect(marble.querySelector('input').disabled).toBe(false);
  expect(adventure.classList.contains('is-off')).toBe(true);
  expect(adventure.querySelector('input').disabled).toBe(true);
  expect(adventure.querySelector('small').textContent).toBe('DICER.InstalledDice.Status.other');
});

test('nothing found says so', () => {
  expect(buildList([], []).querySelector('.dicer-empty')).toBeTruthy();
});

test('ticking keeps the module with its title and scripts; unticking drops it', () => {
  const on = togglePick([], found[1], true);
  expect(on).toEqual([{ id: 'marble', title: 'Marble Dice', scripts: ['modules/marble/diceset.js'] }]);
  expect(togglePick(on, found[1], true)).toHaveLength(1); // no duplicates
  expect(togglePick(on, found[1], false)).toEqual([]);
});

test('a Dice So Nice add-on Dicer cannot sandbox gets a box to run it in full, ticked from dsnAddons', () => {
  const list = [
    ...found,
    { id: 'lordudice', title: 'Lordu Dice', scripts: ['modules/lordudice/scripts/a.js'], status: 'other', addon: true },
    { id: 'soup', title: 'Dice Soup', scripts: ['modules/soup/a.js'], status: 'ok', addon: true }, // dice only: sandboxed
  ];
  const [, , lordu, soup] = buildList(list, [], ['lordudice']).querySelectorAll('li');
  const box = lordu.querySelector('input');
  expect(box.disabled).toBe(false);
  expect(box.checked).toBe(true);
  expect(box.hasAttribute('data-addon')).toBe(true);
  expect(lordu.classList.contains('is-off')).toBe(false);
  expect(lordu.querySelector('small').textContent).toBe('DICER.InstalledDice.Addon');
  expect(soup.querySelector('input').hasAttribute('data-addon')).toBe(false);
  expect(buildList(list, [], []).querySelectorAll('li')[2].querySelector('input').checked).toBe(false);
});

test('ticking an add-on adds its id once; unticking drops it', () => {
  expect(toggleAddon([], 'lordudice', true)).toEqual(['lordudice']);
  expect(toggleAddon(['lordudice'], 'lordudice', true)).toEqual(['lordudice']);
  expect(toggleAddon(['soup', 'lordudice'], 'lordudice', false)).toEqual(['soup']);
});

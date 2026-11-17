// @vitest-environment jsdom
/** The GM's picker of installed modules' dice (src/ui/installed-dice.js): its list and its saves. */
import { expect, test } from 'vitest';
import { buildList, togglePick } from '../../src/ui/installed-dice.js';

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

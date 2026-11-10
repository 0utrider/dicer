import { expect, test } from 'vitest';
import { normalizeAppearance } from '../../src/look/appearance.js';
import { LOOKS } from '../../src/look/looks.js';

const REQUIRED = ['default', 'ruby-classic', 'abyss-liquid', 'starlit-glitter', 'galaxy-nebula', 'sharp-crystal',
  'dwarven-brass', 'silver-brushed', 'gold-polished', 'marble-white', 'jade-marble', 'pearl-moon',
  'ember-core', 'frost-crystal', 'void-star'];
test.each(REQUIRED)('%s exists and is already normalized', (id) => {
  expect(LOOKS[id].name).toBeTruthy();
  expect(normalizeAppearance(LOOKS[id].appearance)).toEqual(LOOKS[id].appearance);
});
test('every look is already normalized and LOOKS is frozen', () => {
  expect(Object.isFrozen(LOOKS)).toBe(true);
  for (const l of Object.values(LOOKS)) expect(normalizeAppearance(l.appearance)).toEqual(l.appearance);
});
test('every body type and interior type appears at least once', () => {
  const all = Object.values(LOOKS).map((l) => l.appearance);
  for (const t of ['opaque', 'resin', 'metal', 'marble', 'pearl']) expect(all.some((a) => a.body.type === t)).toBe(true);
  for (const t of ['liquid', 'glitter', 'swirl', 'nebula', 'shape']) expect(all.some((a) => a.interior.type === t)).toBe(true);
});

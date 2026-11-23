// @vitest-environment jsdom
/**
 * Roll by hand, per kind of roll: a kind set to "No" answers the roll automatically, the player's
 * choice over the GM's world default.
 */
import { HAND_KINDS, handOn, handSkipped } from '../../src/hand/chunk/hand-kinds.js';
import { FILTER_KINDS, BIG_DICE } from '../../src/foundry/roll-filters.js';
import { HAND_KINDS as WINDOW_KINDS } from '../../src/ui/roll-filters.js';

class DamageRoll {
  constructor(n = 2) {
    this.dice = [{ number: n }];
  }
}
const roll = (n = 1) => ({ dice: [{ number: n }] });
const init = { flags: { core: { initiativeRoll: true } } };
const mine = { mine: true };

describe('handOn', () => {
  test('the player’s choice wins over the world default; with neither, by hand', () => {
    expect(handOn('damage', {}, {})).toBe(true);
    expect(handOn('damage', {}, { hand: { damage: false } })).toBe(false);
    expect(handOn('damage', { hand: { damage: true } }, { hand: { damage: false } })).toBe(true);
    expect(handOn('damage', { hand: { damage: false } }, {})).toBe(false);
    expect(handOn('damage', undefined, null)).toBe(true);
    // only a real false turns it off
    expect(handOn('damage', { hand: { damage: 'no' } }, {})).toBe(true);
    expect(handOn('damage', { hand: 'junk' }, { hand: { damage: false } })).toBe(false);
  });
});

describe('handSkipped', () => {
  test('a roll of a kind set to No is not thrown by hand; the other kinds still are', () => {
    const off = { hand: { initiative: false } };
    expect(handSkipped(roll(), init, mine, off, {})).toBe(true);
    expect(handSkipped(roll(), null, mine, off, {})).toBe(false);
    expect(handSkipped(new DamageRoll(), null, mine, { hand: { damage: false } }, {})).toBe(true);
    expect(handSkipped(roll(), null, { mine: true, combat: true }, {}, { hand: { combat: false } })).toBe(true);
    expect(handSkipped(roll(), null, { mine: true, combat: true }, { hand: { combat: true } }, { hand: { combat: false } })).toBe(false);
  });

  test('any kind saying No is enough', () => {
    expect(handSkipped(new DamageRoll(), init, mine, { hand: { initiative: true, damage: false } }, {})).toBe(true);
  });

  test('big rolls use the big number of the filters', () => {
    const off = { hand: { big: false } };
    expect(handSkipped(roll(BIG_DICE + 1), null, mine, off, {})).toBe(true);
    expect(handSkipped(roll(BIG_DICE), null, mine, off, {})).toBe(false);
    expect(handSkipped(roll(5), null, mine, { ...off, bigDice: 4 }, {})).toBe(true);
    expect(handSkipped(roll(5), null, mine, off, { bigDice: 6 })).toBe(false);
  });

  test('a kind that cannot be known while rolling is never asked; junk settings roll by hand', () => {
    expect(handSkipped(roll(), { flags: { core: { RollTable: 'x' } } }, { mine: false, secret: true }, { hand: { table: false, others: false, secret: false } }, {})).toBe(false);
    expect(handSkipped(roll(), init, mine, 'junk', null)).toBe(false);
    expect(handSkipped(null, null, mine, undefined, undefined)).toBe(false);
  });

  test('the kinds are roll filter kinds, and the window lists the same ones', () => {
    expect(HAND_KINDS).toEqual(['initiative', 'combat', 'damage', 'big']);
    for (const kind of HAND_KINDS) expect(FILTER_KINDS).toContain(kind);
    expect(WINDOW_KINDS).toEqual(HAND_KINDS);
  });
});

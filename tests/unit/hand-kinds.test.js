// @vitest-environment jsdom
/**
 * Roll by hand, per kind of roll: "All rolls" and the kinds' own choices, the player's over the
 * GM's world default.
 */
import { HAND_KINDS, HAND_MODES, handMode, handExempt } from '../../src/hand/chunk/hand-kinds.js';
import { FILTER_KINDS, BIG_DICE } from '../../src/foundry/roll-filters.js';
import { HAND_KINDS as WINDOW_KINDS, HAND_MODES as WINDOW_MODES } from '../../src/ui/roll-filters.js';

class DamageRoll {
  constructor(n = 2) {
    this.dice = [{ number: n }];
  }
}
const roll = (n = 1) => ({ dice: [{ number: n }] });
const init = { flags: { core: { initiativeRoll: true } } };
const mine = { mine: true };
const hand = (h, more = {}) => ({ hand: h, ...more });

describe('handMode', () => {
  test('"All rolls": the player’s, else the world’s, else off', () => {
    expect(handMode(roll(), null, mine, {}, {}, undefined)).toBe('off');
    expect(handMode(roll(), null, mine, {}, {}, '')).toBe('off');
    expect(handMode(roll(), null, mine, {}, hand({ all: 'ask' }), '')).toBe('ask');
    expect(handMode(roll(), null, mine, {}, hand({ all: 'ask' }), 'always')).toBe('always');
    expect(handMode(roll(), null, mine, {}, hand({ all: 'always' }), 'off')).toBe('off');
    expect(handMode(roll(), null, mine, undefined, null, 'junk')).toBe('off');
  });

  test('a kind’s own choice wins over "All rolls", either way', () => {
    expect(handMode(roll(), init, mine, hand({ initiative: 'off' }), {}, 'always')).toBe('off');
    expect(handMode(roll(), init, mine, hand({ initiative: 'always' }), {}, 'off')).toBe('always');
    expect(handMode(roll(), init, mine, hand({ initiative: 'ask' }), {}, 'always')).toBe('ask');
    // a roll of another kind follows "All rolls"
    expect(handMode(roll(), null, mine, hand({ initiative: 'off' }), {}, 'always')).toBe('always');
    expect(handMode(new DamageRoll(), null, mine, hand({ damage: 'off' }), {}, 'always')).toBe('off');
    expect(handMode(roll(), null, { mine: true, combat: true }, hand({ combat: 'off' }), {}, 'always')).toBe('off');
  });

  test('the player’s choice for a kind wins over the world’s; the world’s kind over the player’s "All rolls"', () => {
    expect(handMode(roll(), init, mine, {}, hand({ initiative: 'off' }), 'always')).toBe('off');
    expect(handMode(roll(), init, mine, hand({ initiative: 'always' }), hand({ initiative: 'off' }), 'off')).toBe('always');
  });

  test('a roll of several kinds takes the most cautious choice made', () => {
    expect(handMode(new DamageRoll(), init, mine, hand({ initiative: 'always', damage: 'off' }), {}, 'always')).toBe('off');
    expect(handMode(new DamageRoll(), init, mine, hand({ initiative: 'always', damage: 'ask' }), {}, 'off')).toBe('ask');
    // a kind with no choice does not vote
    expect(handMode(new DamageRoll(), init, mine, hand({ initiative: 'always' }), {}, 'off')).toBe('always');
  });

  test('big rolls use the big number of the filters', () => {
    const off = hand({ big: 'off' });
    expect(handMode(roll(BIG_DICE + 1), null, mine, off, {}, 'always')).toBe('off');
    expect(handMode(roll(BIG_DICE), null, mine, off, {}, 'always')).toBe('always');
    expect(handMode(roll(5), null, mine, hand({ big: 'off' }, { bigDice: 4 }), {}, 'always')).toBe('off');
    expect(handMode(roll(5), null, mine, off, { bigDice: 6 }, 'always')).toBe('always');
  });

  test('1.4.4’s No reads as off; its Yes still wins over the world’s choice for the kind, as "All rolls"', () => {
    expect(handMode(roll(), init, mine, hand({ initiative: false }), {}, 'always')).toBe('off');
    expect(handMode(roll(), init, mine, hand({ initiative: true }), hand({ initiative: 'off' }), 'always')).toBe('always');
    expect(handMode(roll(), init, mine, hand({ initiative: true }), hand({ initiative: 'off', all: 'ask' }), '')).toBe('ask');
    expect(handMode(roll(), init, mine, hand({ initiative: true }), hand({ initiative: 'always' }), 'off')).toBe('off');
    // the world's own true is no choice
    expect(handMode(roll(), init, mine, {}, hand({ initiative: true }), 'ask')).toBe('ask');
  });

  test('junk and unknown kinds are ignored', () => {
    expect(handMode(roll(), init, mine, hand({ initiative: 'nope' }), {}, 'always')).toBe('always');
    expect(handMode(roll(), init, mine, 'junk', null, 'ask')).toBe('ask');
    expect(handMode(null, null, mine, hand({ big: 'off' }), {}, 'ask')).toBe('ask');
    const table = { flags: { core: { RollTable: 'x' } } };
    expect(handMode(roll(), table, { mine: false, secret: true }, hand({ table: 'off', others: 'off', secret: 'off' }), {}, 'always')).toBe('always');
  });
});

describe('handExempt', () => {
  test('only a kind the world sets to off is exempt from required hand rolls', () => {
    expect(handExempt(roll(), init, mine, hand({ initiative: 'off' }))).toBe(true);
    expect(handExempt(roll(), init, mine, hand({ initiative: false }))).toBe(true);
    expect(handExempt(roll(), init, mine, hand({ initiative: 'ask' }))).toBe(false);
    expect(handExempt(roll(), null, mine, hand({ initiative: 'off' }))).toBe(false);
    // "All rolls" off is not an exemption: the requirement is the point
    expect(handExempt(roll(), init, mine, hand({ all: 'off' }))).toBe(false);
    expect(handExempt(roll(5), null, mine, hand({ big: 'off' }, { bigDice: 4 }))).toBe(true);
    expect(handExempt(roll(), init, mine, 'junk')).toBe(false);
    expect(handExempt(roll(), init, mine, undefined)).toBe(false);
  });
});

test('the kinds are roll filter kinds, and the window lists the same kinds and modes', () => {
  expect(HAND_KINDS).toEqual(['initiative', 'combat', 'damage', 'big']);
  expect(HAND_MODES).toEqual(['off', 'ask', 'always']);
  for (const kind of HAND_KINDS) expect(FILTER_KINDS).toContain(kind);
  expect(WINDOW_KINDS).toEqual(HAND_KINDS);
  expect(WINDOW_MODES).toEqual(HAND_MODES);
});

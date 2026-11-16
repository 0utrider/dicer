// @vitest-environment jsdom
/**
 * Roll filters: which kinds a roll belongs to, the player's choice over the GM's world default,
 * and the window's form.
 */
import { kindsOf, modeOf, filtered, FILTER_KINDS, BIG_DICE } from '../../src/foundry/roll-filters.js';
import { buildForm, applyChange } from '../../src/ui/roll-filters.js';

class DamageRoll {
  constructor(n = 2) {
    this.dice = [{ number: n }];
  }
}
const roll = (n = 1) => ({ dice: [{ number: n }] });
const msg = (flags = {}, whisper = []) => ({ flags, whisper });

describe('kindsOf', () => {
  test('initiative and roll tables from the core flags; damage from the roll class or system flags', () => {
    expect(kindsOf(roll(), msg({ core: { initiativeRoll: true } }), { mine: true })).toEqual(new Set(['initiative']));
    expect(kindsOf(roll(), msg({ core: { RollTable: 'abc' } }), { mine: true })).toEqual(new Set(['table']));
    expect(kindsOf(new DamageRoll(), null, { mine: true })).toEqual(new Set(['damage']));
    expect(kindsOf(roll(), msg({ pf2e: { context: { type: 'damage-roll' } } }), { mine: true }).has('damage')).toBe(true);
    expect(kindsOf(roll(), msg({ dnd5e: { roll: { type: 'damage' } } }), { mine: true }).has('damage')).toBe(true);
  });

  test('combat, other players, secret and big rolls from the context', () => {
    const k = kindsOf(roll(BIG_DICE + 1), null, { mine: false, secret: true, combat: true });
    expect([...k].sort()).toEqual(['big', 'combat', 'others', 'secret']);
    expect(kindsOf(roll(BIG_DICE), null, { mine: true }).has('big')).toBe(false);
    expect(kindsOf(roll(4), null, { mine: true, big: 3 }).has('big')).toBe(true);
    expect(kindsOf(null, null, { mine: true }).size).toBe(0);
  });
});

describe('filtered', () => {
  test('the player’s mode wins over the world default; with neither, show', () => {
    expect(modeOf('damage', {}, {})).toBe('show');
    expect(modeOf('damage', {}, { damage: 'skip' })).toBe('skip');
    expect(modeOf('damage', { damage: 'show' }, { damage: 'skip' })).toBe('show');
  });

  test('skip skips; only-mine skips other players’ rolls of that kind; show shows', () => {
    const init = msg({ core: { initiativeRoll: true } });
    expect(filtered(roll(), init, { mine: true }, { initiative: 'skip' }, {})).toBe(true);
    expect(filtered(roll(), init, { mine: true }, { initiative: 'mine' }, {})).toBe(false);
    expect(filtered(roll(), init, { mine: false }, { initiative: 'mine' }, {})).toBe(true);
    expect(filtered(roll(), init, { mine: false }, {}, {})).toBe(false);
    // the GM's default applies while the player chose nothing
    expect(filtered(roll(), null, { mine: true, combat: true }, {}, { combat: 'skip' })).toBe(true);
    expect(filtered(roll(), null, { mine: true, combat: true }, { combat: 'show' }, { combat: 'skip' })).toBe(false);
  });

  test('the big-roll number comes from the player, else the world, else the default', () => {
    expect(filtered(roll(5), null, { mine: true }, { big: 'skip', bigDice: 4 }, {})).toBe(true);
    expect(filtered(roll(5), null, { mine: true }, { big: 'skip' }, { bigDice: 6 })).toBe(false);
    expect(filtered(roll(BIG_DICE + 1), null, { mine: true }, { big: 'skip' }, {})).toBe(true);
  });

  test('junk filters never hide a roll', () => {
    expect(filtered(roll(), null, { mine: true }, 'junk', null)).toBe(false);
    expect(filtered(roll(), null, { mine: true }, undefined, undefined)).toBe(false);
  });
});

describe('the window', () => {
  beforeEach(() => {
    globalThis.game = { i18n: { localize: (k) => k, format: (k, d) => `${k}:${d.mode}` } };
  });
  afterEach(() => delete globalThis.game);

  test('one row per kind; a player gets one column, a GM a world default column too', () => {
    const player = buildForm({ damage: 'skip' }, { damage: 'mine' }, false);
    expect(player.querySelectorAll('tbody tr')).toHaveLength(FILTER_KINDS.length);
    expect(player.querySelector('[name="mine.damage"]').value).toBe('skip');
    expect(player.querySelector('[name="world.damage"]')).toBeNull();
    // "Default" names the world's mode
    expect(player.querySelector('[name="mine.combat"] option').textContent).toBe('DICER.RollFilters.Default:DICER.RollFilters.Mode.show');
    const gm = buildForm({}, { damage: 'mine' }, true);
    expect(gm.querySelector('[name="world.damage"]').value).toBe('mine');
    expect(gm.querySelector('[name="world.bigDice"]').value).toBe(String(BIG_DICE));
  });

  test('applyChange: a mode sets, Default clears, the big number is clamped; junk changes nothing', () => {
    expect(applyChange('mine.damage', 'skip', {}, {}).mine).toEqual({ damage: 'skip' });
    expect(applyChange('mine.damage', '', { damage: 'skip' }, {}).mine).toEqual({});
    expect(applyChange('world.combat', 'mine', {}, {}).world).toEqual({ combat: 'mine' });
    expect(applyChange('mine.bigDice', '500', {}, {}).mine).toEqual({ bigDice: 200 });
    expect(applyChange('mine.bigDice', '', { bigDice: 6 }, {}).mine).toEqual({});
    expect(applyChange('mine.nope', 'skip', {}, {})).toBeNull();
    expect(applyChange('mine.damage', 'bogus', { damage: 'skip' }, {}).mine).toEqual({});
  });
});

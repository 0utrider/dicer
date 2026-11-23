// @vitest-environment jsdom
/**
 * Roll filters: which kinds a roll belongs to, the player's choice over the GM's world default,
 * and the window's form.
 */
import { kindsOf, modeOf, filtered, FILTER_KINDS, BIG_DICE } from '../../src/foundry/roll-filters.js';
import { buildForm, applyChange, HAND_KINDS, HAND_MODES } from '../../src/ui/roll-filters.js';

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
    expect(player.querySelectorAll('tbody tr')).toHaveLength(FILTER_KINDS.length + 1); // and "All rolls"
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

  test('Roll by hand: an "All rolls" row, and a choice per kind known while rolling; the GM a world default too', () => {
    const player = buildForm({ hand: { damage: 'off', combat: 'always' } }, { hand: { initiative: 'ask' } }, false, 'always');
    expect(player.querySelectorAll('tbody tr')).toHaveLength(FILTER_KINDS.length + 1);
    // "All rolls" comes first and has no 3D dice choice
    const first = player.querySelector('tbody tr');
    expect(first.querySelector('th span').textContent).toBe('DICER.RollFilters.Kind.all.Name');
    expect(first.querySelectorAll('select')).toHaveLength(1);
    expect(player.querySelector('[name="mine.hand.all"]').value).toBe('always');
    for (const kind of HAND_KINDS) expect(player.querySelector(`[name="mine.hand.${kind}"]`)).not.toBeNull();
    for (const kind of FILTER_KINDS.filter((k) => !HAND_KINDS.includes(k))) expect(player.querySelector(`[name="mine.hand.${kind}"]`)).toBeNull();
    expect([...player.querySelectorAll('[name="mine.hand.damage"] option')].map((o) => o.value)).toEqual(['', ...HAND_MODES]);
    expect(player.querySelector('[name="mine.hand.damage"]').value).toBe('off');
    expect(player.querySelector('[name="mine.hand.combat"]').value).toBe('always');
    expect(player.querySelector('[name="mine.hand.big"]').value).toBe('');
    // "Default" names what the row follows: the world's choice for the kind, else this player's "All rolls"
    const label = (form, name) => form.querySelector(`[name="${name}"] option`).textContent;
    expect(label(player, 'mine.hand.initiative')).toBe('DICER.RollFilters.Default:DICER.RollFilters.HandMode.ask');
    expect(label(player, 'mine.hand.big')).toBe('DICER.RollFilters.Default:DICER.RollFilters.HandMode.always');
    // "All rolls" follows the world's, off with nothing chosen; a kind then follows that
    expect(label(player, 'mine.hand.all')).toBe('DICER.RollFilters.Default:DICER.RollFilters.HandMode.off');
    const unset = buildForm({}, { hand: { all: 'ask' } }, false, '');
    expect(unset.querySelector('[name="mine.hand.all"]').value).toBe('');
    expect(label(unset, 'mine.hand.all')).toBe('DICER.RollFilters.Default:DICER.RollFilters.HandMode.ask');
    expect(label(unset, 'mine.hand.big')).toBe('DICER.RollFilters.Default:DICER.RollFilters.HandMode.ask');
    expect(player.querySelector('[name^="world.hand."]')).toBeNull();
    // every row has as many cells as the header
    for (const tr of player.querySelectorAll('tbody tr')) expect(tr.children).toHaveLength(3);
    const gm = buildForm({}, { hand: { initiative: 'off', all: 'ask' } }, true);
    expect(gm.querySelector('[name="world.hand.initiative"]').value).toBe('off');
    expect(gm.querySelector('[name="world.hand.damage"]').value).toBe('');
    expect(label(gm, 'world.hand.damage')).toBe('DICER.RollFilters.HandAsAll');
    // the world's "All rolls" is always a mode
    expect(gm.querySelector('[name="world.hand.all"]').value).toBe('ask');
    expect([...gm.querySelectorAll('[name="world.hand.all"] option')].map((o) => o.value)).toEqual(HAND_MODES);
    expect(buildForm({}, {}, true).querySelector('[name="world.hand.all"]').value).toBe('off');
    for (const tr of gm.querySelectorAll('tbody tr')) expect(tr.children).toHaveLength(5);
    // 1.4.4's saved choices: No is off, Yes is no choice; junk is no choice
    const old = buildForm({ hand: { damage: false, big: true } }, { hand: 'junk' }, true, 'nope');
    expect(old.querySelector('[name="mine.hand.damage"]').value).toBe('off');
    expect(old.querySelector('[name="mine.hand.big"]').value).toBe('');
    expect(old.querySelector('[name="mine.hand.all"]').value).toBe('');
    expect(old.querySelector('[name="world.hand.all"]').value).toBe('off');
  });

  test('applyChange, Roll by hand: a mode sets, Default clears; the player’s "All rolls" is the handRolls setting', () => {
    expect(applyChange('mine.hand.damage', 'off', { damage: 'skip' }, {}).mine).toEqual({ damage: 'skip', hand: { damage: 'off' } });
    expect(applyChange('mine.hand.damage', 'always', { hand: { big: 'off' } }, {}).mine).toEqual({ hand: { big: 'off', damage: 'always' } });
    expect(applyChange('mine.hand.damage', '', { hand: { damage: 'off' } }, {}).mine).toEqual({});
    expect(applyChange('mine.hand.damage', '', { hand: { damage: 'off', big: 'ask' } }, {}).mine).toEqual({ hand: { big: 'ask' } });
    expect(applyChange('world.hand.combat', 'off', {}, { combat: 'mine' }).world).toEqual({ combat: 'mine', hand: { combat: 'off' } });
    expect(applyChange('world.hand.combat', '', {}, { hand: { combat: 'off' } }).world).toEqual({});
    expect(applyChange('world.hand.all', 'ask', {}, { hand: { combat: 'off' } }).world).toEqual({ hand: { all: 'ask', combat: 'off' } });
    // the player's "All rolls": the handRolls setting, the filters untouched
    const mine = { hand: { damage: 'off' } };
    const world = { hand: { all: 'ask' } };
    expect(applyChange('mine.hand.all', 'always', mine, world)).toEqual({ mine, world, handRolls: 'always' });
    expect(applyChange('mine.hand.all', '', mine, world).handRolls).toBe('');
    expect(applyChange('mine.hand.all', 'bogus', mine, world).handRolls).toBe('');
    expect(applyChange('mine.hand.damage', 'ask', mine, world).handRolls).toBeUndefined();
    // a rewrite keeps only real choices: 1.4.4's No becomes off, its Yes and junk go
    expect(applyChange('mine.hand.big', 'ask', { hand: { damage: false, combat: true, initiative: 'x', all: 'always' } }, {}).mine).toEqual({ hand: { damage: 'off', big: 'ask' } });
    expect(applyChange('mine.hand.big', 'off', { hand: 'junk' }, {}).mine).toEqual({ hand: { big: 'off' } });
    applyChange('mine.hand.big', 'off', mine, {});
    expect(mine).toEqual({ hand: { damage: 'off' } });
    // kinds without the choice, and the hand key as a mode, change nothing
    expect(applyChange('mine.hand.table', 'off', {}, {})).toBeNull();
    expect(applyChange('mine.hand.others', 'off', {}, {})).toBeNull();
    expect(applyChange('mine.hand', 'skip', {}, {})).toBeNull();
    expect(applyChange('mine.damage.x', 'skip', {}, {})).toBeNull();
    expect(applyChange('mine.hand.damage', 'bogus', { hand: { damage: 'off' } }, {}).mine).toEqual({});
  });
});

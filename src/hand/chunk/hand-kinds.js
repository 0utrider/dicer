/**
 * Roll by hand, per kind of roll (lazy hand chunk). The Roll filters window is where a player says
 * which rolls are thrown by hand: "All rolls" (off, ask each time or always) and, for the kinds
 * known while a roll is still being evaluated, a choice of their own that wins over it.
 *
 * Stored: the player's "All rolls" in the `handRolls` setting ('' follows the world); the kinds in
 * `rollFilters.hand` (`{ [kind]: 'off' | 'ask' | 'always' }`); the GM's world defaults in
 * `rollFiltersDefault.hand` (`all` and the kinds). For each, the player's choice wins over the
 * world's. A `false` (1.4.4's "No") reads as 'off', the player's `true` (its "Yes") as "All rolls" over
 * the world's choice for the kind; anything else unknown as no choice.
 *
 * Roll tables, secret rolls and other players' rolls have no choice: the first two are only known
 * from the chat message, which does not exist yet, and a hand roll is always one's own.
 * ui/roll-filters.js keeps its own copy of the list (a shared module would be a world-start chunk).
 */
import { filtered } from '../../foundry/roll-filters.js';

/** The kinds with a "Roll by hand" choice, in the window's order. */
export const HAND_KINDS = ['initiative', 'combat', 'damage', 'big'];
/** The choices, the most cautious first: a roll of several kinds takes the first one chosen. */
export const HAND_MODES = ['off', 'ask', 'always'];

const norm = (v) => (v === false ? 'off' : HAND_MODES.includes(v) ? v : undefined);

/** The choice for `key` ('all' or a kind) in one filters object, or undefined. */
const choice = (filters, key) => norm(filters?.hand?.[key]);

/** Whether `roll` is of `kind`: asked of the roll filters, as a filter that skips only that kind. */
const isKind = (roll, message, ctx, kind, bigDice) => filtered(roll, message, ctx, { [kind]: 'skip', bigDice }, {});

/**
 * How `roll` is rolled: 'off' (automatically), 'ask' or 'always' (by hand). The kinds it belongs
 * to that have a choice decide (the player's over the world's; of several, the most cautious);
 * with none, "All rolls": `all` (the player's), else the world's, else 'off'. Never throws.
 */
export function handMode(roll, message, ctx, mine, world, all) {
  const base = norm(all) ?? choice(world, 'all') ?? 'off';
  try {
    const bigDice = mine?.bigDice ?? world?.bigDice;
    const chosen = HAND_KINDS.map((kind) => {
      // 1.4.4's "Yes" (true): the player's "All rolls", whatever the world chose for the kind
      const mode = mine?.hand?.[kind] === true ? base : (choice(mine, kind) ?? choice(world, kind));
      return mode && isKind(roll, message, ctx, kind, bigDice) ? mode : undefined;
    });
    const first = HAND_MODES.find((mode) => chosen.includes(mode));
    if (first) return first;
  } catch {
    /* "All rolls" decides */
  }
  return base;
}

/**
 * While the GM requires hand rolls: whether `roll` is of a kind the world default sets to 'off',
 * which exempts it for everyone (the players' own choices do not count). Never throws.
 */
export function handExempt(roll, message, ctx, world) {
  try {
    return HAND_KINDS.some((kind) => choice(world, kind) === 'off' && isKind(roll, message, ctx, kind, world?.bigDice));
  } catch {
    return false;
  }
}

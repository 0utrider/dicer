/**
 * Roll by hand, per kind of roll (lazy hand chunk). The Roll filters window has a "Roll by hand"
 * choice for the kinds known while a roll is still being evaluated: a roll of a kind set to "No"
 * is answered automatically (resolve.js), its 3D dice shown as for any roll. Stored with the
 * filters: `rollFilters.hand` (the player's: true, false, or absent to follow the world) over
 * `rollFiltersDefault.hand` (the GM's: false, or absent); with neither, by hand.
 *
 * Roll tables, secret rolls and other players' rolls are not here: the first two are only known
 * from the chat message, which does not exist yet, and a hand roll is always one's own.
 * ui/roll-filters.js keeps its own copy of the list (a shared module would be a world-start chunk).
 */
import { filtered } from '../../foundry/roll-filters.js';

/** The kinds with a "Roll by hand" choice, in the window's order. */
export const HAND_KINDS = ['initiative', 'combat', 'damage', 'big'];

const choice = (filters, kind) => {
  const v = filters?.hand?.[kind];
  return typeof v === 'boolean' ? v : undefined;
};

/** Whether rolls of `kind` are thrown by hand: the player's choice, else the world's, else yes. */
export const handOn = (kind, mine, world) => choice(mine, kind) ?? choice(world, kind) ?? true;

/**
 * True when a kind `roll` belongs to is set not to be rolled by hand. Never throws. Asked of the
 * roll filters themselves, as a filter that skips exactly the kinds set to "No": so a roll's
 * kinds (and what counts as big) are read in one place, and world start exports nothing more.
 */
export function handSkipped(roll, message, ctx, mine, world) {
  try {
    const off = { bigDice: mine?.bigDice ?? world?.bigDice };
    for (const kind of HAND_KINDS) if (!handOn(kind, mine, world)) off[kind] = 'skip';
    return filtered(roll, message, ctx, off, {});
  } catch {
    return false; // by hand, as without the choice
  }
}

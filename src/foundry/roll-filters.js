/**
 * Roll filters: which rolls this player sees as 3D dice. Each kind of roll has a mode: 'show' (as
 * today), 'mine' (only this player's own rolls of that kind) or 'skip'. The player's choice
 * (client setting rollFilters) wins over the GM's world default (rollFiltersDefault); with
 * neither, 'show'. A roll is skipped when any kind it belongs to says so; a skipped roll posts at
 * once, as with 3D dice off. World start (showForRoll asks it before every throw): keep it lean.
 */

/** The kinds, in the order the window lists them. */
export const FILTER_KINDS = ['initiative', 'table', 'combat', 'damage', 'others', 'secret', 'big'];
/** A roll with more dice than this counts as big, unless the player or GM chose another number. */
export const BIG_DICE = 10;

/** Which kinds `roll` (in `message`, or none) belongs to; `ctx`: {mine, secret, combat}. */
export function kindsOf(roll, message, ctx = {}) {
  const f = message?.flags ?? {};
  const out = new Set();
  if (f.core?.initiativeRoll) out.add('initiative');
  if (f.core?.RollTable) out.add('table');
  if (ctx.combat) out.add('combat');
  // System damage rolls: their own roll class (pf2e, dnd5e, many more) or the message's flags.
  if (/DamageRoll/.test(roll?.constructor?.name ?? '') || f.pf2e?.context?.type === 'damage-roll' || f.dnd5e?.roll?.type === 'damage')
    out.add('damage');
  if (!ctx.mine) out.add('others');
  if (ctx.secret) out.add('secret');
  if ((roll?.dice ?? []).reduce((n, d) => n + (d?.number ?? 0), 0) > (ctx.big ?? BIG_DICE)) out.add('big');
  return out;
}

/** The mode of `kind`: the player's, else the world default, else 'show'. */
export const modeOf = (kind, mine = {}, world = {}) => mine?.[kind] ?? world?.[kind] ?? 'show';

/** True when the filters keep this roll from being thrown here. Never throws (a bad filter shows). */
export function filtered(roll, message, ctx, mine, world) {
  try {
    const big = Number(mine?.bigDice ?? world?.bigDice) || BIG_DICE;
    for (const kind of kindsOf(roll, message, { ...ctx, big })) {
      const mode = modeOf(kind, mine, world);
      if (mode === 'skip' || (mode === 'mine' && !ctx.mine)) return true;
    }
  } catch {
    /* show it */
  }
  return false;
}

/** What the pet makes of a roll. Only d20s count; ghost dice and ghost rolls never leak a result. */
export function summarize(dice, ghost) {
  if (ghost) return 'plain';
  let crit = false;
  let fumble = false;
  for (const d of dice || []) {
    if (!d || d.ghost || d.type !== 'd20') continue;
    if (d.value === 20) crit = true;
    else if (d.value === 1) fumble = true;
  }
  if (crit && fumble) return 'mixed';
  return crit ? 'crit' : fumble ? 'fumble' : 'plain';
}

/** The builtin sound name for a reaction, or null (mixed and plain are silent). */
export const reactionSound = (reaction) =>
  reaction === 'crit' ? 'petHappy' : reaction === 'fumble' ? 'petSad' : null;

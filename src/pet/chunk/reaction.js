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

/**
 * One reaction for several rolls of one roller (each already summarized with its own ghost flag,
 * so a ghost roll only ever adds 'plain'): crit and fumble together are mixed.
 */
export function merge(summaries) {
  let crit = false;
  let fumble = false;
  for (const s of summaries) {
    if (s === 'crit' || s === 'mixed') crit = true;
    if (s === 'fumble' || s === 'mixed') fumble = true;
  }
  if (crit && fumble) return 'mixed';
  return crit ? 'crit' : fumble ? 'fumble' : 'plain';
}

/** The builtin sound name for a reaction, or null (mixed and plain are silent). */
export const reactionSound = (reaction) =>
  reaction === 'crit' ? 'petHappy' : reaction === 'fumble' ? 'petSad' : null;

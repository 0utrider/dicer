/**
 * The other users' dice looks, for the warm-up. Only the viewer's own look and the damage themes
 * were compiled ahead, so each player's first roll on another screen compiled its shaders on the
 * first frame it drew: a 0.3 to 1.5 s freeze of the whole canvas, once per player look per screen.
 *
 * @param {object} o
 * @param {Iterable<{id: string}>} o.users every user of the world
 * @param {string} [o.viewerId] this screen's user, whose look the warm-up already compiles first
 * @param {(userId: string, term: object) => object|null|undefined} o.lookOf a user's appearance
 *   for a die term (a theme can dress each die type differently)
 * @returns {object[]} distinct appearances, in user order
 */
export function userWarmupLooks({ users, viewerId, lookOf }) {
  const looks = new Map();
  for (const user of users ?? []) {
    const id = user?.id;
    if (!id || id === viewerId) continue;
    for (const term of WARMUP_TERMS) {
      try {
        const look = lookOf(id, term);
        const key = look && typeof look === 'object' ? JSON.stringify(look) : null;
        if (key && !looks.has(key)) looks.set(key, look);
      } catch {
        // one unreadable user or die must not stop the others' warm-up
      }
    }
  }
  return [...looks.values()];
}

/** Plain terms of the standard dice, enough for the look resolver (dsnTypeOf reads `faces`). */
export const WARMUP_TERMS = Object.freeze([4, 6, 8, 10, 12, 20].map((faces) => Object.freeze({ faces, options: {} })));

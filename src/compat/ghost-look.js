/**
 * Themed ghost dice (the themedGhostDice world setting, off by default): a ghost die, shown for a
 * roll this user cannot read, wears the roller's own dice look instead of neutral grey.
 *
 * Privacy outranks looks: the look is the roller's user-level one, asked for with a clean term (the
 * die's size only). Nothing of the roll reaches it (flavor, options, actor, damage type, results),
 * so two hidden rolls of one user never look different because of what was rolled. DiceBox reads
 * `ghostLook` on a ghost only, and changes nothing else about it.
 *
 * @param {object} o
 * @param {(key: string) => unknown} o.getSetting
 * @param {(authorId: string, term: {faces: number, options: {}}) => object|null|undefined} o.lookOf
 * @returns {(authorId?: string) => (term: object) => {ghost: true, ghostLook?: object}}
 */
export function createGhostDecorate({ getSetting, lookOf }) {
  return (authorId) => (term) => {
    try {
      const look = authorId && getSetting('themedGhostDice') === true ? lookOf(authorId, { faces: term?.faces, options: {} }) : null;
      if (look) return { ghost: true, ghostLook: look };
    } catch {
      /* a look that cannot be read: the neutral ghost */
    }
    return { ghost: true };
  };
}

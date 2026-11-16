/**
 * The element a die shows, from its appearance and damage type: shared by the lazy effects chunk
 * (trails, bursts) and the lazy pet chunk (reactions). Pure data, no imports, so neither chunk
 * pulls the other in.
 */

/** Interior types that are elements themselves (they win over the damage type). */
const INSIDE_ELEMENTS = new Set(['fire', 'lava', 'frost', 'storm']);
/** Damage type -> element. */
const DAMAGE_ELEMENTS = Object.freeze({
  fire: 'fire',
  cold: 'frost',
  electricity: 'storm',
  lightning: 'storm',
  acid: 'acid',
  void: 'void',
  necrotic: 'void',
  vitality: 'vitality',
  radiant: 'vitality',
  healing: 'vitality',
  poison: 'poison',
  sonic: 'sonic',
  thunder: 'sonic',
  force: 'force',
  mental: 'mental',
  psychic: 'mental',
  spirit: 'spirit',
  bleed: 'bleed',
  slashing: 'slashing',
  piercing: 'piercing',
  bludgeoning: 'bludgeoning',
});

/**
 * The element a die shows: its elemental inside (fire, lava, frost, storm), else the element of
 * its damage type, else null (no trail: untyped, unknown).
 * @param {object} [appearance] a (normalized) appearance
 * @param {string} [damageType]
 * @returns {string|null}
 */
export function elementOf(appearance, damageType) {
  const inside = appearance?.interior?.type;
  if (INSIDE_ELEMENTS.has(inside)) return inside;
  if (typeof damageType !== 'string') return null;
  const key = damageType.toLowerCase();
  return Object.hasOwn(DAMAGE_ELEMENTS, key) ? DAMAGE_ELEMENTS[key] : null;
}

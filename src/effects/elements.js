/**
 * The element ids, in the order of the design: the one list the lazy trails and bursts
 * (library/trails.js) and the world-start effect id lists (effect-ids.js, themes.js) share.
 */
export const ELEMENTS = Object.freeze(
  'fire lava frost storm acid void vitality poison sonic force mental spirit bleed slashing piercing bludgeoning'.split(' '),
);

/** `burst-<element>` for every element: the crit burst effect ids. */
export const BURST_IDS = ELEMENTS.map((e) => `burst-${e}`);

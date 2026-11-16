/**
 * The dice tray's pure core: its dice, modes, die outlines and formula. Shared by the free-roll
 * tray (./tray.js, which re-exports all of it) and the chat dock (src/ui/chat-tray.js), so the
 * dock never pulls the hand chunk in before a throw. No Foundry state beyond game.settings.
 */

/** The tray's dice, in its order (Foundry denominations: d2 is a two-sided Die, dF Fate). */
export const TRAY_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'd2', 'dF'];
/** The CONFIG.ChatMessage.modes a tray roll can go out in. */
export const TRAY_MODES = ['public', 'gm', 'blind', 'self'];
/** A count above this is clamped (Foundry rolls what the throw cannot hold anyway). */
const MAX_COUNT = 99;
const MAX_MODIFIER = 9999;

/**
 * Each die's outline for its button (inner SVG of a 24x24 viewBox; trusted constants, never user
 * input): a coin for d2, a triangle for d4, a square for d6 and so on, as the dice look in hand.
 */
const poly = (points) => `<polygon points="${points}"/>`;
const KITE = '12,1.5 22,10 12,22.5 2,10';
export const DIE_SHAPES = {
  d4: poly('12,2 22.5,21 1.5,21'),
  d6: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  d8: poly('12,1 23,12 12,23 1,12'),
  d10: poly(KITE),
  d12: poly('12,1.5 22.5,9.2 18.5,21.5 5.5,21.5 1.5,9.2'),
  d20: poly('12,1 21.5,6.5 21.5,17.5 12,23 2.5,17.5 2.5,6.5'),
  d100: poly(KITE),
  d2: '<circle cx="12" cy="12" r="10.5"/>',
  dF: '<rect x="3" y="3" width="18" height="18" rx="5"/>',
};

const int = (v) => Math.trunc(Number(v)) || 0;
/** A die count, an integer within 0..99. */
export const countOf = (v) => Math.min(MAX_COUNT, Math.max(0, int(v)));
/** The modifier, a finite integer within ±MAX_MODIFIER. */
export const modOf = (v) => Math.min(MAX_MODIFIER, Math.max(-MAX_MODIFIER, int(v)));

/** '2d6 + 1d20 + 3' from {d6: 2, d20: 1} and 3: the dice in tray order, then the modifier. */
export function formulaFromCounts(counts, modifier) {
  let f = TRAY_DICE.filter((k) => countOf(counts?.[k]) > 0)
    .map((k) => `${countOf(counts[k])}${k}`)
    .join(' + ');
  const m = modOf(modifier);
  if (m) f = f ? `${f} ${m < 0 ? '-' : '+'} ${Math.abs(m)}` : String(m);
  return f;
}

/** The core chat mode when the tray offers it, else public. */
export function coreMode() {
  try {
    const m = globalThis.game.settings.get('core', 'messageMode');
    if (TRAY_MODES.includes(m)) return m;
  } catch {
    /* not registered */
  }
  return 'public';
}

/** `counts` with one more (delta 1) or one fewer (-1) of `key`, within 0..99; a new object. */
export function stepCount(counts, key, delta) {
  if (!TRAY_DICE.includes(key)) return { ...counts };
  return { ...counts, [key]: countOf(countOf(counts?.[key]) + delta) };
}

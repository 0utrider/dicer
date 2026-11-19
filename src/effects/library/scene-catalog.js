// The crit scenes Dicer has: id, the outcome each is written for, its full duration (ms) and its
// title card's two lines of text (`card`: what a rule's own sceneText replaces, line by line).
// The effects chunk makes a stand-in effect for each (scene-stubs.js); the scenes chunk holds the
// scenes themselves (src/scenes/scenes.js, whose SCENES keys must be exactly these ids); the theme
// editor and the trigger editor list them. Ids are `scene-*`: the world-start code accepts any such
// id by its prefix (effect-ids.js), so adding a scene costs no world-start bytes.

export const SCENE_CATALOG = Object.freeze([
  // natural 20s (critical-success)
  { id: 'scene-shadow-thief', outcome: 'critical-success', duration: 1900, card: ['Nat', '20!'] },
  { id: 'scene-meteor', outcome: 'critical-success', duration: 2400, card: ['Natural', '20!'] },
  { id: 'scene-portal-hop', outcome: 'critical-success', duration: 2000, card: ['Warp', 'Strike!'] },
  { id: 'scene-lightning-verdict', outcome: 'critical-success', duration: 2600, card: ['Critical', 'Hit!'] },
  { id: 'scene-golden-ascension', outcome: 'critical-success', duration: 2400, card: ['Ascended', '20!'] },
  { id: 'scene-dragon-coil', outcome: 'critical-success', duration: 2400, card: ['Legendary', '20!'] },
  { id: 'scene-fireworks', outcome: 'critical-success', duration: 2400, card: ['Spectacular!', 'Natural 20'] },
  { id: 'scene-crown-drop', outcome: 'critical-success', duration: 2800, card: ['Crowned', 'Critical!'] },
  { id: 'scene-phoenix', outcome: 'critical-success', duration: 2200, card: ['Reborn', 'Critical!'] },
  { id: 'scene-rune-circle', outcome: 'critical-success', duration: 2000, card: ['Arcane', 'Mastery'] },
  // natural 1s (critical-failure)
  { id: 'scene-banana-peel', outcome: 'critical-failure', duration: 2600, card: ['Whoops!', 'Nat 1'] },
  { id: 'scene-rain-cloud', outcome: 'critical-failure', duration: 2400, card: ['Gloomy', 'Fail'] },
  { id: 'scene-ghost-out', outcome: 'critical-failure', duration: 2400, card: ['Boo!', 'Critical Miss'] },
  { id: 'scene-anvil', outcome: 'critical-failure', duration: 2600, card: ['Critical', 'Fail'] },
  { id: 'scene-black-hole', outcome: 'critical-failure', duration: 2300, card: ['Void', 'Fail'] },
  { id: 'scene-crack-and-tape', outcome: 'critical-failure', duration: 2400, card: ['Broken', 'Fumble'] },
  { id: 'scene-wilted-flower', outcome: 'critical-failure', duration: 2300, card: ['Wilted', 'Nat 1'] },
  { id: 'scene-tumbleweed', outcome: 'critical-failure', duration: 2000, card: ['Crickets...', 'Nat 1'] },
  { id: 'scene-crows', outcome: 'critical-failure', duration: 2200, card: ['Botched', 'Nat 1'] },
  { id: 'scene-pratfall', outcome: 'critical-failure', duration: 2600, card: ['Splat!', 'Fumble'] },
]);

/** The scene ids, in catalog order. */
export const SCENE_IDS = Object.freeze(SCENE_CATALOG.map((s) => s.id));

/** The "random scene" choice: one of the outcome's scenes, picked per die (pickScene). */
export const RANDOM_SCENE = 'scene-random';

/**
 * The scene a random pick lands on: one of `outcome`'s ('critical-success' / 'critical-failure'),
 * by `seed`, an integer every screen computes the same (the die's rest spot: the throw is
 * simulated alike for everyone), so every player sees the same scene.
 */
export function pickScene(outcome, seed) {
  const list = SCENE_CATALOG.filter((s) => s.outcome === outcome);
  if (!list.length) return null;
  const n = Math.abs(Math.trunc(Number(seed) || 0));
  return list[n % list.length].id;
}

/** A die's rest spot as pickScene's seed: its table position to the hundredth, hashed (well spread). */
export function restSeed(p) {
  let h = Math.imul(Math.round((p?.x ?? 0) * 100), 0x9e3779b1) ^ Math.imul(Math.round((p?.z ?? 0) * 100), 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
}

/** The most characters a line of a rule's own card text keeps. */
export const SCENE_TEXT_MAX = 24;

/**
 * A rule's own title card text (its effect's `sceneText`): two trimmed lines of at most
 * SCENE_TEXT_MAX characters, a blank line keeping the scene's own; null when both are blank or
 * it is not a list.
 */
export function sceneText(value) {
  if (!Array.isArray(value)) return null;
  const lines = [0, 1].map((i) => (typeof value[i] === 'string' ? value[i].trim().slice(0, SCENE_TEXT_MAX) : ''));
  return lines.some(Boolean) ? lines : null;
}

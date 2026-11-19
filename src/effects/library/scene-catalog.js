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

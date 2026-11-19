// The crit scenes Dicer has: id, the outcome each is written for, and its full duration (ms).
// The effects chunk makes a stand-in effect for each (scene-stubs.js); the scenes chunk holds the
// scenes themselves (src/scenes/scenes.js, whose SCENES keys must be exactly these ids); the theme
// editor and the trigger editor list them. Ids are `scene-*`: the world-start code accepts any such
// id by its prefix (effect-ids.js), so adding a scene costs no world-start bytes.

export const SCENE_CATALOG = Object.freeze([
  // natural 20s (critical-success)
  { id: 'scene-shadow-thief', outcome: 'critical-success', duration: 1900 },
  { id: 'scene-meteor', outcome: 'critical-success', duration: 2400 },
  { id: 'scene-portal-hop', outcome: 'critical-success', duration: 2000 },
  { id: 'scene-lightning-verdict', outcome: 'critical-success', duration: 2600 },
  { id: 'scene-golden-ascension', outcome: 'critical-success', duration: 2400 },
  { id: 'scene-dragon-coil', outcome: 'critical-success', duration: 2400 },
  { id: 'scene-fireworks', outcome: 'critical-success', duration: 2400 },
  { id: 'scene-crown-drop', outcome: 'critical-success', duration: 2800 },
  { id: 'scene-phoenix', outcome: 'critical-success', duration: 2200 },
  { id: 'scene-rune-circle', outcome: 'critical-success', duration: 2000 },
  // natural 1s (critical-failure)
  { id: 'scene-banana-peel', outcome: 'critical-failure', duration: 2600 },
  { id: 'scene-rain-cloud', outcome: 'critical-failure', duration: 2400 },
  { id: 'scene-ghost-out', outcome: 'critical-failure', duration: 2400 },
  { id: 'scene-anvil', outcome: 'critical-failure', duration: 2600 },
  { id: 'scene-black-hole', outcome: 'critical-failure', duration: 2300 },
  { id: 'scene-crack-and-tape', outcome: 'critical-failure', duration: 2400 },
  { id: 'scene-wilted-flower', outcome: 'critical-failure', duration: 2300 },
  { id: 'scene-tumbleweed', outcome: 'critical-failure', duration: 2000 },
  { id: 'scene-crows', outcome: 'critical-failure', duration: 2200 },
  { id: 'scene-pratfall', outcome: 'critical-failure', duration: 2600 },
]);

/** The scene ids, in catalog order. */
export const SCENE_IDS = Object.freeze(SCENE_CATALOG.map((s) => s.id));

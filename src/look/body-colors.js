/**
 * The colours and roughness a body preset (iridescent, gem, wood) or an aged metal finish (patina,
 * worn) starts from. Used by the appearance editor (picking a preset applies these; every colour
 * stays editable afterwards) and the look gallery. Editor-only: keep it out of the world-start chunk.
 */
export const PRESET_COLORS = Object.freeze({
  chameleon: Object.freeze({ color: '#1a9e8f', color2: '#6a2bd1', roughness: 0.15 }),
  opal: Object.freeze({ color: '#e8eef0', color2: '#7fd6e8', roughness: 0.2 }),
  dichroic: Object.freeze({ color: '#102030', color2: '#ff6a3d', roughness: 0.05 }),
  amethyst: Object.freeze({ color: '#7b3fb5', color2: '#2a0f45', roughness: 0.1 }),
  malachite: Object.freeze({ color: '#1f8a5a', color2: '#0a3a24', roughness: 0.2 }),
  obsidian: Object.freeze({ color: '#0d0c10', color2: '#4a3f5a', roughness: 0.05 }),
  quartz: Object.freeze({ color: '#e9e4ee', color2: '#b8b0c4', roughness: 0.15 }),
  oak: Object.freeze({ color: '#b98a52', color2: '#6e4a26', roughness: 0.55 }),
  walnut: Object.freeze({ color: '#5a3a22', color2: '#2a170c', roughness: 0.5 }),
  cherry: Object.freeze({ color: '#9c4a2c', color2: '#5a2414', roughness: 0.45 }),
  ebony: Object.freeze({ color: '#1c1714', color2: '#3b302a', roughness: 0.35 }),
  patina: Object.freeze({ color: '#b5653a', color2: '#3fae9a', roughness: 0.4 }),
  worn: Object.freeze({ color: '#9aa0a6', color2: '#3a3d40', roughness: 0.35 }),
});

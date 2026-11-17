/**
 * The diceLighting setting as the dice scene's light (scene.js setLighting). Pure: main.js reads
 * Foundry's canvas environment and passes it in.
 * - studio: the baked product-photo studio, as always;
 * - scene: the Foundry scene's light: its darkness dims the dice (never below a readable floor)
 *   and its ambient colour (daylight towards darkness) tints them;
 * - sun: a warm low sun, whatever the scene.
 */
export const LIGHTING_MODES = ['studio', 'scene', 'sun'];
const SUN = [1, 0.88, 0.7];
const rgb = (c) =>
  Array.isArray(c) && c.length >= 3 && c.every((v) => Number.isFinite(v))
    ? c.slice(0, 3).map((v) => Math.max(0, Math.min(1, v)))
    : null;
// a colour as bright as white at its own hue: a tint, never a dimmer (darkness does the dimming)
const asTint = (c) => {
  const m = Math.max(...c, 1e-3);
  return c.map((v) => v / m);
};

/**
 * @param {string} mode
 * @param {{darkness?: number, daylight?: number[], night?: number[]}} [env] darkness 0..1; the
 *   ambient daylight and darkness colours as [r, g, b] in 0..1
 * @returns {{tint: number[]|null, intensity: number, sun: boolean}}
 */
export function lightingFor(mode, env = {}) {
  if (mode === 'sun') return { tint: SUN, intensity: 1.1, sun: true };
  if (mode !== 'scene') return { tint: null, intensity: 1, sun: false };
  const d = Number.isFinite(env.darkness) ? Math.max(0, Math.min(1, env.darkness)) : 0;
  const day = rgb(env.daylight) ?? [1, 1, 1];
  const night = rgb(env.night) ?? [0.4, 0.45, 0.7];
  const mixed = day.map((v, i) => v + (night[i] - v) * d);
  return { tint: asTint(mixed), intensity: 1 - 0.65 * d, sun: false };
}

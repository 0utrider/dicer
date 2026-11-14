import * as THREE from 'three';

/**
 * Core / mid / edge / rim colours derived from one die colour, so an effect reads with a hot
 * centre, the die's own colour body and a deeper falloff instead of one flat tint.
 *
 *   normal       core = colour lerped 60% to white, mid = colour, edge = colour x 0.55, rim null
 *   near-white   core white, mid a warm tint, edge a cool tint, rim null (white has no hue to deepen)
 *   near-black   core/mid/edge = colour; rim = the same hue lifted to l 0.6 so it shows on a dark
 *                scene (a neutral grey-blue when the colour has almost no hue of its own)
 *
 * `rim` is null unless the colour is near-black. Inputs are never mutated.
 */
const WHITE_MIN_L = 0.85;
const WHITE_MAX_S = 0.15;
const BLACK_MAX_L = 0.1;
// All lightness/saturation checks and the rim are done in sRGB (perceptual), not three.js's linear
// working space, where l <= 0.1 would catch greys up to ~#595959 and dark saturated colours.
// '#141418' (a barely tinted black) has sRGB s ~ 0.09, so the neutral-rim cut sits just above it.
const NO_HUE_S = 0.15;
const WARM = '#fff1d6';
const COOL = '#a9c4ff';
const NEUTRAL_RIM = '#9aa3b5';

export function palette(color) {
  const c = new THREE.Color(color);
  const hsl = c.getHSL({}, THREE.SRGBColorSpace);
  if (hsl.l >= WHITE_MIN_L && hsl.s <= WHITE_MAX_S) {
    return {
      core: new THREE.Color(1, 1, 1),
      mid: new THREE.Color(WARM),
      edge: new THREE.Color(COOL),
      rim: null,
    };
  }
  if (hsl.l <= BLACK_MAX_L) {
    const rim =
      hsl.s < NO_HUE_S
        ? new THREE.Color(NEUTRAL_RIM)
        : new THREE.Color().setHSL(hsl.h, Math.max(hsl.s, 0.5), 0.6, THREE.SRGBColorSpace);
    return { core: c.clone(), mid: c.clone(), edge: c.clone(), rim };
  }
  return {
    core: c.clone().lerp(new THREE.Color(1, 1, 1), 0.6),
    mid: c.clone(),
    edge: c.clone().multiplyScalar(0.55),
    rim: null,
  };
}

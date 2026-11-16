/**
 * A pet's reaction to each element a die can carry (effects/element-of.js: every damage type has
 * one): the creature's pose (one it already has: scorch, shiver, bristle, startle, or petting's
 * happy wiggle) and what shows around it. Pure data and writers into the pet's two point sets, so
 * pets.js only picks and calls. Colours are linear RGB.
 *
 * - smoke: the scorch's grey smoke (pets.js smoke);
 * - sparks: the bristle's crackling sparks (pets.js float, kind bristle);
 * - tint: [filter, glow] laid on the creature's materials, in and out (pets.js tint);
 * - motes: glowing points (additive, the sparkle's star sprite) in a pattern;
 * - puffs: soft discs (normally blended, so dark colours show: dust, a void haze, blood) in a pattern;
 * - sound: the pet's voice for it (audio/sound-names.js PET_SOUNDS: a cough, a shiver, an "eep!",
 *   a happy coo, a dizzy warble), under petSounds.
 */
export const ELEMENT_FX = Object.freeze({
  fire: { pose: 'scorch', sound: 'petCough', smoke: true },
  lava: { pose: 'scorch', sound: 'petCough', smoke: true },
  frost: { pose: 'shiver', sound: 'petShiver', tint: [[0.72, 0.88, 1], [0.02, 0.05, 0.1]] },
  storm: { pose: 'bristle', sound: 'petZap', sparks: true },
  // it shudders as green bubbles fizz off its skin, tinted a sickly green
  acid: { pose: 'shiver', sound: 'petFizz', tint: [[0.72, 1, 0.55], [0.02, 0.07, 0]], motes: { pattern: 'bubble', colors: [[0.45, 1, 0.15], [0.8, 1, 0.35]] } },
  // a green haze hangs about it and it goes queasy green
  poison: { pose: 'shiver', sound: 'petBleh', tint: [[0.78, 0.95, 0.6], [0.01, 0.04, 0]], puffs: { pattern: 'cloud', color: [0.18, 0.42, 0.08] } },
  // dark motes sink into it and it goes dim and violet
  void: { pose: 'shiver', sound: 'petSpooked', tint: [[0.55, 0.45, 0.75], [0.03, 0, 0.06]], puffs: { pattern: 'sink', color: [0.06, 0.01, 0.1] } },
  // healing: a happy wiggle under rising golden motes
  vitality: { pose: 'pet', sound: 'petCoo', motes: { pattern: 'rise', colors: [[1, 0.8, 0.3], [1, 1, 0.85]] } },
  // rings of sound spread out around it as it bristles
  sonic: { pose: 'bristle', sound: 'petRing', motes: { pattern: 'ring', colors: [[0.55, 0.9, 1], [0.9, 1, 1]] } },
  // it is knocked back as violet shards fly out
  force: { pose: 'startle', sound: 'petOof', motes: { pattern: 'burst', colors: [[0.65, 0.35, 1], [0.9, 0.75, 1]] } },
  // pink swirls circle its head, dizzy
  mental: { pose: 'startle', sound: 'petDizzy', motes: { pattern: 'orbit', colors: [[1, 0.4, 0.8], [0.8, 0.5, 1]] } },
  // pale cyan wisps rise off it as it shivers, a ghostly sheen
  spirit: { pose: 'shiver', sound: 'petWoo', tint: [[0.8, 0.95, 1], [0, 0.06, 0.08]], motes: { pattern: 'wisp', colors: [[0.45, 0.95, 1], [0.85, 1, 1]] } },
  // drops of blood fall around it
  bleed: { pose: 'startle', sound: 'petOw', puffs: { pattern: 'drip', color: [0.45, 0.01, 0.02] } },
  // a silver arc sweeps past it
  slashing: { pose: 'startle', sound: 'petWhoa', motes: { pattern: 'arc', colors: [[0.85, 0.9, 1], [1, 1, 1]] } },
  // white needles dart in at it
  piercing: { pose: 'startle', sound: 'petYip', motes: { pattern: 'needle', colors: [[1, 1, 1], [0.8, 0.85, 0.9]] } },
  // dust bursts up around its feet
  bludgeoning: { pose: 'startle', sound: 'petBonk', puffs: { pattern: 'dust', color: [0.38, 0.3, 0.2] } },
});

/** Weapon blows: they set a pet off landing nearby, but a direct hit still splats it. */
export const PHYSICAL = Object.freeze(['slashing', 'piercing', 'bludgeoning']);

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const swell = (s) => Math.sin(Math.PI * s); // 0 -> 1 -> 0, once

/**
 * Writes `n` glowing motes in `pattern` at e (0..1) into position / colour arrays (xyz, rgb; the
 * rest zeroed), in the pet's own space for a pet of height `h`. `spark`: the per-point randoms
 * ({a, reach, rise, ph}). `calm` (reduced motion): slower, smaller movement, no flicker.
 */
export function writeMotes(P, C, total, n, e, pattern, colors, h, spark, calm) {
  for (let i = 0; i < total; i++) {
    const k = i * 3;
    P[k] = P[k + 1] = P[k + 2] = C[k] = C[k + 1] = C[k + 2] = 0;
    if (i >= n) continue;
    const sp = spark[i];
    let x = 0;
    let y = 0;
    let z = 0;
    let b = 0;
    if (pattern === 'bubble') {
      // little bubbles in turn from all over its body, rising a little and popping
      const s = clamp01((e - (i % 4) * 0.15 - 0.02 * i) / 0.3);
      const r = 0.55 * h;
      x = Math.sin(sp.a) * r;
      y = h * (0.25 + 0.6 * sp.rise + 0.25 * s);
      z = Math.cos(sp.a) * r;
      b = swell(s) * (s < 0.85 ? 1 : 0.4);
    } else if (pattern === 'rise' || pattern === 'wisp') {
      // rising from its head one after another; wisps drift wider and slower
      const wisp = pattern === 'wisp';
      const s = clamp01((e - i * 0.07) / (wisp ? 0.75 : 0.6));
      const sway = (calm ? 0.05 : wisp ? 0.2 : 0.1) * h * Math.sin(s * Math.PI * 2 + sp.ph);
      x = Math.sin(sp.a) * (wisp ? 0.45 : 0.35) * h + sway;
      y = h * (0.9 + (wisp ? 0.7 : 0.9) * s);
      z = Math.cos(sp.a) * 0.35 * h;
      b = swell(s);
    } else if (pattern === 'ring') {
      // two rings spreading out from its body at mid height, one after the other
      const wave = i % 2;
      const s = clamp01((e - wave * 0.3) / 0.6);
      const a = (i / n) * Math.PI * 2;
      const r = (0.5 + 1.1 * s) * h;
      x = Math.sin(a) * r;
      y = h * 0.5;
      z = Math.cos(a) * r;
      b = (1 - s) * clamp01(s * 6);
    } else if (pattern === 'burst') {
      // shards flying straight out from its middle, fast, then fading
      const s = clamp01(e / 0.55);
      const r = (0.35 + 1.4 * sp.reach * (1 - (1 - s) ** 2)) * h;
      x = Math.sin(sp.a) * r;
      y = h * (0.5 + 0.5 * (sp.rise - 0.5) * s);
      z = Math.cos(sp.a) * r;
      b = 1 - s;
    } else if (pattern === 'orbit') {
      // swirls circling above its head, dizzy
      const a = sp.a + e * Math.PI * (calm ? 2 : 5);
      const r = 0.42 * h;
      x = Math.sin(a) * r;
      y = h * (1.1 + 0.08 * Math.sin(a * 2));
      z = Math.cos(a) * r * 0.7;
      b = clamp01(e * 6) * clamp01((1 - e) * 4);
    } else if (pattern === 'arc') {
      // a bright arc sweeping across in front of it, its points trailing
      const s = clamp01((e - 0.03 * i) / 0.35);
      const a = -1.3 + 2.6 * s;
      x = Math.sin(a) * 0.9 * h;
      y = h * (0.9 - 0.5 * s);
      z = Math.cos(a) * 0.9 * h * 0.6 + 0.3 * h;
      b = swell(s);
    } else if (pattern === 'needle') {
      // needles darting in at it from all round, in turn
      const s = clamp01((e - (i % 3) * 0.12) / 0.35);
      const r = (1.4 - 0.9 * s) * h;
      x = Math.sin(sp.a) * r;
      y = h * (0.35 + 0.4 * sp.rise);
      z = Math.cos(sp.a) * r;
      b = swell(s);
    }
    if (!calm && pattern === 'bubble') b *= 0.75 + 0.25 * Math.sin(e * 30 + sp.ph);
    const c = colors[i % colors.length];
    P[k] = x;
    P[k + 1] = y;
    P[k + 2] = z;
    C[k] = c[0] * b;
    C[k + 1] = c[1] * b;
    C[k + 2] = c[2] * b;
  }
}

/**
 * Writes `n` soft puffs in `pattern` at e (0..1) into position (xyz) and colour (rgba) arrays, in
 * the pet's own space (`h` its height, `top` the top of its body). `calm`: less drift.
 */
export function writePuffs(P, C, n, e, pattern, color, h, top, spark, calm) {
  for (let i = 0; i < n; i++) {
    const sp = spark[i];
    const k = i * 3;
    const q = i * 4;
    let x = 0;
    let y = 0;
    let z = 0;
    let alpha = 0;
    if (pattern === 'cloud') {
      // a haze swelling around its body and hanging there
      const s = clamp01((e - i * 0.04) / 0.5);
      const r = (0.45 + 0.35 * s) * h;
      const drift = (calm ? 0.03 : 0.1) * h * Math.sin(e * 6 + sp.ph);
      x = Math.sin(sp.a) * r + drift;
      y = h * (0.3 + 0.6 * sp.rise);
      z = Math.cos(sp.a) * r;
      alpha = 0.7 * clamp01(s * 3) * clamp01((1 - e) * 3);
    } else if (pattern === 'sink') {
      // dark motes sinking down into it from above
      const s = clamp01((e - i * 0.06) / 0.55);
      x = Math.sin(sp.a) * (0.5 - 0.3 * s) * h;
      y = top + h * (0.7 - 0.9 * s);
      z = Math.cos(sp.a) * (0.5 - 0.3 * s) * h;
      alpha = 0.85 * swell(s);
    } else if (pattern === 'drip') {
      // drops falling from its sides to the ground, in turn
      const s = clamp01((e - i * 0.08) / 0.45);
      x = Math.sin(sp.a) * 0.55 * h;
      y = h * (0.7 - 0.7 * s * s);
      z = Math.cos(sp.a) * 0.55 * h;
      alpha = 0.95 * clamp01(s * 5) * (s < 1 ? 1 : 0);
    } else if (pattern === 'dust') {
      // a ring of dust bursting up around its feet and settling
      const s = clamp01(e / 0.7);
      const r = (0.45 + 0.7 * s) * h;
      x = Math.sin(sp.a) * r;
      y = h * (0.05 + 0.3 * sp.rise * swell(s));
      z = Math.cos(sp.a) * r;
      alpha = 0.8 * (1 - s) * clamp01(s * 8);
    }
    P[k] = x;
    P[k + 1] = y;
    P[k + 2] = z;
    C[q] = color[0];
    C[q + 1] = color[1];
    C[q + 2] = color[2];
    C[q + 3] = alpha;
  }
}

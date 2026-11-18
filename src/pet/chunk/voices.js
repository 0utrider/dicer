/**
 * Each pet kind's own voice: its pet sounds rendered with its timbre (audio/pet-timbre.js, synth.js
 * renderPetSound), so a frog croaks its "mm-hm" and a golem grinds it out, rather than one voice at
 * two pitches. Rendered when the pet first says a sound (a few ms), then cached.
 * `voiceFor(kind, name)` is a sound's `voice` (sound-engine result): ctx -> its AudioBuffer.
 */
import { renderPetSound } from '../../audio/synth.js';
import { PET_TIMBRES } from '../../audio/pet-timbre.js';

const RATE = 48000; // sound-engine's RENDER_RATE
const MAX = 96; // rendered takes kept (10 kinds x a handful of sounds each, in practice)
const cache = new Map(); // `${kind}:${name}` -> Float32Array

/** `name` in `kind`'s voice, rendered once (the oldest dropped past MAX). */
export function petTake(kind, name) {
  const key = `${kind}:${name}`;
  let s = cache.get(key);
  if (!s) {
    s = renderPetSound(name, kind, RATE);
    cache.set(key, s);
    while (cache.size > MAX) cache.delete(cache.keys().next().value);
  }
  return s;
}

/** The `voice` for `kind` saying `name`, or undefined for a kind with no timbre (the shared take). */
export function voiceFor(kind, name) {
  if (!PET_TIMBRES[kind]) return undefined;
  return (ctx) => {
    const s = petTake(kind, name);
    const b = ctx.createBuffer(1, s.length, RATE);
    b.copyToChannel(s, 0);
    return b;
  };
}

/** Renders `kind`'s takes of `names` ahead (at idle), so its first words need no render. */
export function warmVoice(kind, names) {
  if (PET_TIMBRES[kind]) for (const n of names) petTake(kind, n);
}

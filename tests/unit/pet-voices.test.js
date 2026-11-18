import { PET_TIMBRES } from '../../src/audio/pet-timbre.js';
import { renderPetSound, renderResult } from '../../src/audio/synth.js';
import { PET_SOUNDS } from '../../src/audio/sound-names.js';
import { CREATURES } from '../../src/pet/chunk/creatures/index.js';
import { voiceFor, petTake } from '../../src/pet/chunk/voices.js';

const SR = 8000; // small renders: the shapes, not the fidelity
// how bright (spectral centroid, by zero crossings) and how rough (sample-to-sample change) a take is
const crossings = (a) => {
  let c = 0;
  for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 !== a[i] < 0) c++;
  return c / a.length;
};

test('every pet kind has its own timbre, and no two are alike', () => {
  expect(Object.keys(PET_TIMBRES).sort()).toEqual(Object.keys(CREATURES).sort());
  expect(new Set(Object.values(PET_TIMBRES).map((t) => JSON.stringify(t))).size).toBe(Object.keys(PET_TIMBRES).length);
});

test.each(Object.keys(PET_TIMBRES))('%s: renders every pet sound, finite, normalised, unlike the shared take', (kind) => {
  for (const name of PET_SOUNDS) {
    const a = renderPetSound(name, kind, SR);
    expect(a.length).toBeGreaterThan(0);
    let peak = 0;
    for (const v of a) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThanOrEqual(1);
  }
  const shared = renderResult('petHmm', SR);
  const mine = renderPetSound('petHmm', kind, SR);
  const diff = mine.slice(0, shared.length).reduce((s, v, i) => s + Math.abs(v - shared[i]), 0) / shared.length;
  expect(diff).toBeGreaterThan(0.01);
});

test('the kinds differ in timbre, not only pitch: the same sound has a spread of brightness', () => {
  const zc = Object.keys(PET_TIMBRES).map((k) => crossings(renderPetSound('petHmm', k, SR)));
  expect(Math.max(...zc) / Math.min(...zc)).toBeGreaterThan(2);
});

test('deterministic; a non-pet sound or an unknown kind renders as the shared take', () => {
  expect(renderPetSound('petHuh', 'frog', SR)).toEqual(renderPetSound('petHuh', 'frog', SR));
  expect(renderPetSound('chime', 'frog', SR)).toEqual(renderResult('chime', SR));
  expect(renderPetSound('petHuh', 'dragon-turtle', SR)).toEqual(renderResult('petHuh', SR));
});

test('voiceFor: a buffer of the kind\'s take, rendered once and cached; none for an unknown kind', () => {
  const ctx = { createBuffer: vi.fn((ch, n, rate) => ({ ch, n, rate, copyToChannel: vi.fn() })) };
  const b = voiceFor('owl', 'petHmm')(ctx);
  expect(b.rate).toBe(48000);
  expect(b.n).toBe(petTake('owl', 'petHmm').length);
  expect(b.copyToChannel).toHaveBeenCalledWith(petTake('owl', 'petHmm'), 0);
  expect(petTake('owl', 'petHmm')).toBe(petTake('owl', 'petHmm'));
  expect(voiceFor('dragon-turtle', 'petHmm')).toBeUndefined();
});

import { describe, it, expect } from 'vitest';
import {
  SOUND_MATERIALS,
  SURFACES,
  VARIANTS,
  RESULT_SOUNDS,
  renderImpact,
  renderSurface,
  renderResult,
  renderAll,
} from '../../src/audio/synth.js';

const SR = 48000;

function peak(a) {
  let p = 0;
  for (const v of a) p = Math.max(p, Math.abs(v));
  return p;
}
function rms(a, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
}
function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  let ab = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < n; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb);
}
/** Spectral centroid (Hz) via an in-place radix-2 FFT of the first 8192 samples. */
function centroid(a) {
  const N = 8192;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < Math.min(N, a.length); i++) re[i] = a[i];
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const u = i + k;
        const v = i + k + len / 2;
        const tr = re[v] * wr - im[v] * wi;
        const ti = re[v] * wi + im[v] * wr;
        re[v] = re[u] - tr;
        im[v] = im[u] - ti;
        re[u] += tr;
        im[u] += ti;
      }
    }
  }
  let num = 0,
    den = 0;
  for (let k = 1; k < N / 2; k++) {
    const m = Math.hypot(re[k], im[k]);
    num += m * ((k * SR) / N);
    den += m;
  }
  return num / den;
}

describe('renderImpact', () => {
  for (const m of SOUND_MATERIALS) {
    for (let v = 0; v < VARIANTS; v++) {
      it(`${m} variant ${v} is finite, normalized and short`, () => {
        const a = renderImpact(m, v, SR);
        expect(a).toBeInstanceOf(Float32Array);
        expect(a.every(Number.isFinite)).toBe(true);
        const p = peak(a);
        expect(p).toBeGreaterThanOrEqual(0.85);
        expect(p).toBeLessThanOrEqual(0.95);
        expect(a.length).toBeLessThanOrEqual(0.6 * SR);
      });
    }
  }

  it('variants differ, same inputs are identical', () => {
    for (const m of SOUND_MATERIALS) {
      const a = renderImpact(m, 0, SR);
      const b = renderImpact(m, 1, SR);
      expect(correlation(a, b)).toBeLessThan(0.95);
      expect(Array.from(renderImpact(m, 0, SR))).toEqual(Array.from(a));
    }
  });

  it('spectral centroid order: metal > glass > stone > plastic > wood', () => {
    const c = Object.fromEntries(SOUND_MATERIALS.map((m) => [m, centroid(renderImpact(m, 0, SR))]));
    expect(c.metal).toBeGreaterThan(c.glass);
    expect(c.glass).toBeGreaterThan(c.stone);
    expect(c.stone).toBeGreaterThan(c.plastic);
    expect(c.plastic).toBeGreaterThan(c.wood);
  });

  it('plastic and wood decay', () => {
    for (const m of ['plastic', 'wood']) {
      const a = renderImpact(m, 0, SR);
      const n = Math.floor(a.length / 10);
      expect(rms(a, a.length - n, a.length)).toBeLessThan(0.1 * rms(a, 0, n));
    }
  });
});

describe('renderSurface / renderResult', () => {
  it('renders every surface, finite and non-silent', () => {
    for (const s of SURFACES) {
      const a = renderSurface(s, SR);
      expect(a.every(Number.isFinite)).toBe(true);
      expect(peak(a)).toBeGreaterThan(0.1);
      expect(peak(a)).toBeLessThanOrEqual(1);
    }
    expect(() => renderSurface('lava', SR)).toThrow(RangeError);
  });

  it('renders every result sound within 1.5 s', () => {
    for (const n of RESULT_SOUNDS) {
      const a = renderResult(n, SR);
      expect(a.length).toBeGreaterThan(0);
      expect(a.length).toBeLessThanOrEqual(1.5 * SR);
      expect(a.every(Number.isFinite)).toBe(true);
      expect(peak(a)).toBeGreaterThan(0.1);
      expect(peak(a)).toBeLessThanOrEqual(1);
    }
    expect(() => renderResult('nope', SR)).toThrow(RangeError);
  });
});

describe('renderAll', () => {
  it('renders every sound and yields at least once per sound', async () => {
    let calls = 0;
    const idle = (cb) => {
      calls++;
      Promise.resolve().then(cb);
    };
    const map = await renderAll(SR, { idle });
    const total = SOUND_MATERIALS.length * VARIANTS + SURFACES.length + RESULT_SOUNDS.length;
    expect(map.size).toBe(total);
    expect(map.has('impact:metal:3')).toBe(true);
    expect(map.has('surface:felt')).toBe(true);
    expect(map.has('result:boom')).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(total);
  });
});

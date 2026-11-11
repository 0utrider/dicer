/**
 * Pure-DSP sound synthesis. Renders impact, surface and result sounds as
 * Float32Array buffers; no WebAudio, no three.js (this is the lazy `audio` chunk).
 * Numbers are plausible starting points, to be tuned by ear on the dev page.
 *
 * Every renderer is a generator that yields after each BLOCK samples of work, so
 * renderAll can resume it across idle callbacks and respect its time budget.
 */
import { mulberry32 } from '../core/rng.js';

export const SOUND_MATERIALS = ['plastic', 'metal', 'wood', 'glass', 'stone'];
export const SURFACES = ['felt', 'wood', 'stone', 'metal'];
export const VARIANTS = 4;
export const RESULT_SOUNDS = ['chime', 'fanfare', 'sparkle', 'fizzle', 'thud', 'whoosh', 'crackle', 'zap', 'boom'];

const TAU = Math.PI * 2;
/** Samples of work between yields (mask form: BLOCK - 1). About 0.1 ms of work each. */
const BLOCK_MASK = 2047;

/** FNV-1a string hash, 32-bit. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function normalize(buf, target) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
  if (p > 0) {
    const g = target / p;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  }
  return buf;
}

/** Linear fade over the last `ms` to avoid end clicks. */
function fadeOut(buf, sr, ms = 5) {
  const n = Math.min(buf.length, Math.floor((sr * ms) / 1000));
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n;
  return buf;
}

/** Add damped sinusoids: modes are [freqHz, decayTauSeconds, gain]; `delay` in seconds. */
function* addModes(buf, sr, modes, delay = 0) {
  const start = Math.floor(delay * sr);
  for (const [f, tau, g] of modes) {
    const w = (TAU * f) / sr;
    const k = Math.exp(-1 / (tau * sr));
    let env = g;
    for (let i = start; i < buf.length && env > 1e-5; i++, env *= k) {
      buf[i] += env * Math.sin(w * (i - start));
      if ((i & BLOCK_MASK) === BLOCK_MASK) yield;
    }
  }
}

/** Noise burst through a one-pole lowpass (`bright` is the coefficient, 0..1) with exp decay. */
function* addNoise(buf, sr, rand, { gain, tau, bright, delay = 0 }) {
  let y = 0;
  const start = Math.floor(delay * sr);
  const k = Math.exp(-1 / (tau * sr));
  let env = gain;
  for (let i = start; i < buf.length && env > 1e-5; i++, env *= k) {
    y += bright * (rand() * 2 - 1 - y);
    buf[i] += env * y;
    if ((i & BLOCK_MASK) === BLOCK_MASK) yield;
  }
}

// ---- impacts --------------------------------------------------------------

// modes: [Hz, decay tau s, gain]; noise: burst gain/tau/brightness; dur: seconds
const IMPACT = {
  plastic: { dur: 0.15, modes: [[950, 0.012, 1], [1750, 0.008, 0.7], [2700, 0.005, 0.4]], noise: { gain: 0.5, tau: 0.003, bright: 0.5 } },
  metal: { dur: 0.58, modes: [[4300, 0.14, 1], [6900, 0.1, 0.9], [9300, 0.08, 0.8], [11600, 0.06, 0.6], [5600, 0.12, 0.6]], noise: { gain: 0.5, tau: 0.002, bright: 0.9 } },
  wood: { dur: 0.25, modes: [[340, 0.02, 1], [700, 0.014, 0.7], [1150, 0.009, 0.4]], noise: { gain: 0.3, tau: 0.003, bright: 0.15 } },
  glass: { dur: 0.5, modes: [[3000, 0.12, 1], [5300, 0.08, 0.8], [7700, 0.06, 0.6], [4100, 0.1, 0.5]], noise: { gain: 0.3, tau: 0.002, bright: 0.7 } },
  stone: { dur: 0.2, modes: [[1900, 0.016, 1], [3200, 0.01, 0.8], [4600, 0.006, 0.5]], noise: { gain: 0.5, tau: 0.003, bright: 0.6 } },
};

function* impactGen(material, variant, sampleRate) {
  const spec = IMPACT[material];
  if (!spec) throw new RangeError(`Unknown impact material: ${material}`);
  const rand = mulberry32(hash(`${material}:${variant}`));
  const buf = new Float32Array(Math.floor(spec.dur * sampleRate));
  const modes = spec.modes.map(([f, tau, g]) => [
    f * (1 + (rand() - 0.5) * 0.12),
    tau * (1 + (rand() - 0.5) * 0.3),
    g * (1 + (rand() - 0.5) * 0.5),
  ]);
  yield* addModes(buf, sampleRate, modes);
  yield* addNoise(buf, sampleRate, rand, spec.noise);
  return fadeOut(normalize(buf, 0.9), sampleRate);
}

// ---- surfaces -------------------------------------------------------------

const SURFACE = {
  felt: { dur: 0.15, modes: [[110, 0.035, 1], [190, 0.02, 0.4]], noise: { gain: 0.15, tau: 0.01, bright: 0.08 } },
  wood: { dur: 0.3, modes: [[210, 0.05, 1], [430, 0.035, 0.6], [640, 0.02, 0.3]], noise: { gain: 0.15, tau: 0.004, bright: 0.2 } },
  stone: { dur: 0.12, modes: [[3500, 0.006, 1], [5200, 0.004, 0.6]], noise: { gain: 0.5, tau: 0.002, bright: 0.7 } },
  metal: { dur: 0.6, modes: [[1250, 0.2, 1], [2900, 0.15, 0.7], [4100, 0.1, 0.5]], noise: { gain: 0.2, tau: 0.003, bright: 0.5 } },
};

function* surfaceGen(surface, sampleRate) {
  const spec = SURFACE[surface];
  if (!spec) throw new RangeError(`Unknown surface: ${surface}`);
  const rand = mulberry32(hash(`surface:${surface}`));
  const buf = new Float32Array(Math.floor(spec.dur * sampleRate));
  yield* addModes(buf, sampleRate, spec.modes);
  yield* addNoise(buf, sampleRate, rand, spec.noise);
  return fadeOut(normalize(buf, 0.8), sampleRate);
}

// ---- results --------------------------------------------------------------

/** Note with a short attack and exponential decay, summed into buf. `saw` adds harmonics. */
function* note(buf, sr, freq, delay, dur, gain, saw = 0) {
  const start = Math.floor(delay * sr);
  const n = Math.min(buf.length - start, Math.floor(dur * sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.005) * Math.exp((-3 * t) / dur);
    const ph = TAU * t * freq;
    buf[start + i] += gain * env * (Math.sin(ph) + saw * (0.5 * Math.sin(2 * ph) + 0.33 * Math.sin(3 * ph)));
    if ((i & BLOCK_MASK) === BLOCK_MASK) yield;
  }
}

/** Exponential frequency sweep f0 -> f1 across the buffer with an exponential envelope. */
function* sweep(buf, sr, f0, f1, tau, saw = 0) {
  let ph = 0;
  for (let i = 0; i < buf.length; i++) {
    const f = f0 * Math.pow(f1 / f0, i / buf.length);
    ph += (TAU * f) / sr;
    buf[i] += Math.exp(-i / (tau * sr)) * (Math.sin(ph) + saw * (0.5 * Math.sin(2 * ph) + 0.33 * Math.sin(3 * ph)));
    if ((i & BLOCK_MASK) === BLOCK_MASK) yield;
  }
}

const RESULT = {
  *chime(sr, buf) {
    yield* note(buf, sr, 880, 0, 1.1, 1);
    yield* note(buf, sr, 1320, 0, 0.9, 0.5);
    yield* note(buf, sr, 2217, 0, 0.5, 0.25);
  },
  *fanfare(sr, buf) {
    for (const [i, f] of [523.25, 659.25, 783.99].entries()) yield* note(buf, sr, f, i * 0.13, 0.3, 0.7, 1);
    yield* note(buf, sr, 1046.5, 0.39, 0.9, 0.9, 1);
    yield* note(buf, sr, 784, 0.39, 0.9, 0.5, 1);
  },
  *sparkle(sr, buf, rand) {
    for (let i = 0; i < 14; i++) yield* note(buf, sr, 3000 + rand() * 5000, rand() * 0.7, 0.12 + rand() * 0.1, 0.3 + rand() * 0.5);
  },
  *fizzle(sr, buf, rand) {
    let y = 0;
    for (let i = 0; i < buf.length; i++) {
      const t = i / buf.length;
      y += (0.5 * (1 - t) + 0.02) * (rand() * 2 - 1 - y);
      buf[i] = y * (1 - t) * (1 - t);
      if ((i & BLOCK_MASK) === BLOCK_MASK) yield;
    }
  },
  *thud(sr, buf, rand) {
    yield* sweep(buf, sr, 110, 45, 0.12);
    yield* addNoise(buf, sr, rand, { gain: 0.4, tau: 0.01, bright: 0.12 });
  },
  *whoosh(sr, buf, rand) {
    let y = 0;
    for (let i = 0; i < buf.length; i++) {
      const swell = Math.sin((Math.PI * i) / buf.length);
      y += (0.03 + 0.5 * swell * swell) * (rand() * 2 - 1 - y);
      buf[i] = y * swell;
      if ((i & BLOCK_MASK) === BLOCK_MASK) yield;
    }
  },
  *crackle(sr, buf, rand) {
    for (let i = 0; i < 40; i++) {
      yield* addModes(buf, sr, [[1500 + rand() * 4000, 0.002 + rand() * 0.003, 0.3 + rand() * 0.7]], rand() * 0.9);
    }
  },
  *zap(sr, buf, rand) {
    yield* sweep(buf, sr, 3000, 120, 0.12, 1);
    yield* addNoise(buf, sr, rand, { gain: 0.3, tau: 0.03, bright: 0.6 });
  },
  *boom(sr, buf, rand) {
    yield* sweep(buf, sr, 70, 28, 0.45);
    yield* addNoise(buf, sr, rand, { gain: 0.6, tau: 0.12, bright: 0.05 });
  },
};

const RESULT_DUR = { chime: 1.2, fanfare: 1.3, sparkle: 1.0, fizzle: 0.8, thud: 0.5, whoosh: 0.9, crackle: 1.0, zap: 0.35, boom: 1.4 };

function* resultGen(name, sampleRate) {
  const fn = RESULT[name];
  if (!fn) throw new RangeError(`Unknown result sound: ${name}`);
  const buf = new Float32Array(Math.floor(RESULT_DUR[name] * sampleRate));
  yield* fn(sampleRate, buf, mulberry32(hash(`result:${name}`)));
  return fadeOut(normalize(buf, 0.85), sampleRate, 10);
}

/** Drive a generator to completion and return its Float32Array. */
function finish(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

export const renderImpact = (material, variant, sampleRate) => finish(impactGen(material, variant, sampleRate));
export const renderSurface = (surface, sampleRate) => finish(surfaceGen(surface, sampleRate));
export const renderResult = (name, sampleRate) => finish(resultGen(name, sampleRate));

// ---- batch ----------------------------------------------------------------

/**
 * Render every sound. Work is pumped one block at a time until `budgetMs` has elapsed
 * on `now()` (default performance.now), then control returns via `idle(cb)`; short
 * sounds may share a slice, long ones span several. Unfinished work resumes next slice.
 */
export function renderAll(sampleRate, { budgetMs = 8, idle, now = () => performance.now() } = {}) {
  const schedule = idle || ((cb) => setTimeout(cb, 0));
  const jobs = [];
  for (const m of SOUND_MATERIALS) {
    for (let v = 0; v < VARIANTS; v++) jobs.push([`impact:${m}:${v}`, () => impactGen(m, v, sampleRate)]);
  }
  for (const s of SURFACES) jobs.push([`surface:${s}`, () => surfaceGen(s, sampleRate)]);
  for (const r of RESULT_SOUNDS) jobs.push([`result:${r}`, () => resultGen(r, sampleRate)]);

  const out = new Map();
  return new Promise((resolve, reject) => {
    let i = 0;
    let gen = null;
    const slice = () => {
      try {
        const t0 = now();
        do {
          gen ||= jobs[i][1]();
          const r = gen.next();
          if (r.done) {
            out.set(jobs[i][0], r.value);
            gen = null;
            i++;
          }
        } while (i < jobs.length && now() - t0 < budgetMs);
        if (i >= jobs.length) resolve(out);
        else schedule(slice);
      } catch (e) {
        reject(e);
      }
    };
    schedule(slice);
  });
}

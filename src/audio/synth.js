/**
 * Pure-DSP sound synthesis. Renders impact, surface and result sounds as
 * Float32Array buffers; no WebAudio, no three.js (this is the lazy `audio` chunk).
 * Numbers are plausible starting points, to be tuned by ear on the dev page.
 *
 * Every renderer is a generator that yields after each BLOCK samples of work, so
 * renderAll can resume it across idle callbacks and respect its time budget.
 */
import { mulberry32 } from '../core/rng.js';
import { RESULT_SOUNDS } from './sound-names.js';

export const SOUND_MATERIALS = ['plastic', 'metal', 'wood', 'glass', 'stone'];
export const SURFACES = ['felt', 'wood', 'stone', 'metal'];
export const VARIANTS = 4;
export { RESULT_SOUNDS };

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
//
// P10-S1: the result sounds were bare sine/saw notes with one exponential decay, which read as
// robotic. They are now built from the pieces below: additive voices with detuned copies,
// delayed vibrato, pitch scoops and slides and a brightness swell; inharmonic bells with a strike
// transient; band-pass noise whose centre moves; crackle clicks; FM; soft saturation; and a small
// Schroeder reverb for room. Everything stays deterministic (seeded) and yields every BLOCK.

const soft = (x, drive = 1) => Math.tanh(x * drive) / Math.tanh(drive);

/** 0..1 envelope: sine-shaped attack over `a` s, exponential decay (tau s), linear release over the last `r` s. */
function envAt(t, a, tau, dur, r = 0.03) {
  const att = t < a ? Math.sin((Math.PI / 2) * (t / a)) : 1;
  const dec = Math.exp(-Math.max(0, t - a) / tau);
  const rel = t > dur - r ? Math.max(0, (dur - t) / r) : 1;
  return att * dec * rel;
}

/**
 * Additive voice summed into buf at `start` (s) for `dur` (s). partials: [ratio, gain, decayFactor]
 * (a partial decays with tau x decayFactor); detune: cents per copy; vib: vibrato depth (fraction
 * of the pitch) reached `vibDelay` s in; pitch(t): frequency multiplier over time (default: a
 * scoop from `scoop` x freq up to freq over 40 ms); swell: s for partials above the second to fade in.
 */
function* voice(buf, sr, o) {
  const {
    freq,
    start = 0,
    dur,
    gain = 1,
    attack = 0.01,
    tau = 0.5,
    partials = [[1, 1, 1]],
    detune = [0],
    vib = 0,
    vibRate = 5.5,
    vibDelay = 0.15,
    scoop = 1,
    pitch = null,
    swell = 0,
  } = o;
  const s0 = Math.floor(start * sr);
  const n = Math.min(buf.length - s0, Math.floor(dur * sr));
  const mults = detune.map((c) => Math.pow(2, c / 1200));
  const phases = new Float64Array(mults.length);
  const norm = gain / mults.length;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = envAt(t, attack, tau, dur);
    let p = pitch ? pitch(t) : scoop + (1 - scoop) * Math.min(1, t / 0.04);
    if (vib) p *= 1 + vib * Math.min(1, Math.max(0, (t - vibDelay) / 0.12)) * Math.sin(TAU * vibRate * t);
    const bright = swell ? Math.min(1, t / swell) : 1;
    let s = 0;
    for (let c = 0; c < mults.length; c++) {
      phases[c] += (TAU * freq * p * mults[c]) / sr;
      const ph = phases[c];
      for (let k = 0; k < partials.length; k++) {
        const [ratio, g, df] = partials[k];
        s += g * (k > 1 ? bright : 1) * Math.exp(-t / (tau * df)) * Math.sin(ph * ratio);
      }
    }
    buf[s0 + i] += norm * env * s;
    if ((i & BLOCK_MASK) === BLOCK_MASK) yield;
  }
}

/** Band-pass noise (Chamberlin state-variable filter): centre fc(t) Hz, resonance q, amplitude amp(t). */
function* noiseBand(buf, sr, rand, { start = 0, dur, fc, q = 1, amp, gain = 1 }) {
  const s0 = Math.floor(start * sr);
  const n = Math.min(buf.length - s0, Math.floor(dur * sr));
  let low = 0;
  let band = 0;
  const fmax = sr / 6; // the filter stays stable below about sr/6
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 2 * Math.sin((Math.PI * Math.min(fc(t), fmax)) / sr);
    const high = rand() * 2 - 1 - low - band / q;
    band += f * high;
    low += f * band;
    buf[s0 + i] += gain * amp(t) * band;
    if ((i & BLOCK_MASK) === BLOCK_MASK) yield;
  }
}

/** `count` crackle clicks: 0.5-3 ms high-passed noise ticks at random times in [from, to] s. */
function* clicks(buf, sr, rand, { count, from = 0, to, gain = 1, fade = null }) {
  for (let k = 0; k < count; k++) {
    const t = from + rand() * (to - from);
    const s0 = Math.floor(t * sr);
    const len = Math.floor((0.0005 + rand() * 0.0025) * sr);
    const a = gain * (0.25 + 0.75 * rand() * rand()) * (fade ? fade(t) : 1);
    let prev = 0;
    for (let i = 0; i < len && s0 + i < buf.length; i++) {
      const x = (rand() * 2 - 1) * Math.exp((-4 * i) / len);
      buf[s0 + i] += a * (x - prev);
      prev = x;
    }
    yield;
  }
}

/** Mono Schroeder reverb in place: four damped combs into two all-passes, mixed back at `mix`. */
function* reverb(buf, sr, { mix = 0.2, decay = 0.7, damp = 0.35 } = {}) {
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((s) => {
    const len = Math.max(1, Math.floor(s * sr));
    return { d: new Float32Array(len), i: 0, lp: 0, fb: Math.pow(10, (-3 * s) / decay) };
  });
  const aps = [0.005, 0.0017].map((s) => ({ d: new Float32Array(Math.max(1, Math.floor(s * sr))), i: 0 }));
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    let s = 0;
    for (const c of combs) {
      const y = c.d[c.i];
      c.lp = y * (1 - damp) + c.lp * damp;
      c.d[c.i] = x + c.lp * c.fb;
      c.i = (c.i + 1) % c.d.length;
      s += y;
    }
    s *= 0.25;
    for (const ap of aps) {
      const y = ap.d[ap.i];
      ap.d[ap.i] = s + y * 0.5;
      ap.i = (ap.i + 1) % ap.d.length;
      s = y - s * 0.5;
    }
    buf[i] = x * (1 - 0.5 * mix) + s * mix;
    if ((i & BLOCK_MASK) === BLOCK_MASK) yield;
  }
}

/** Soft saturation in place (warmth; tames peaks before normalizing). */
function* saturate(buf, drive) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
  const g = p > 0 ? 1 / p : 1;
  for (let i = 0; i < buf.length; i++) {
    buf[i] = soft(buf[i] * g, drive);
    if ((i & BLOCK_MASK) === BLOCK_MASK) yield;
  }
}

const SAW = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 1 / n, 1 / Math.sqrt(n)]);
const BELL = [
  [1, 1, 1],
  [2.76, 0.55, 0.6],
  [5.4, 0.3, 0.4],
  [8.93, 0.16, 0.28],
  [0.5, 0.22, 1.4],
];
const PING = [
  [1, 1, 1],
  [2.01, 0.35, 0.5],
  [3.98, 0.14, 0.3],
];
/** A major pentatonic, A6 to B7: sparkles land on a scale instead of random pitches. */
const PENTA = [1760, 1975.5, 2217.5, 2637, 2960, 3520, 3951];

function* bell(buf, sr, rand, freq, start, gain, tau = 0.55) {
  yield* voice(buf, sr, { freq, start, dur: 1.5 - start, gain, attack: 0.002, tau, partials: BELL, detune: [-3, 3] });
  yield* noiseBand(buf, sr, rand, {
    start,
    dur: 0.03,
    fc: () => freq * 3,
    q: 2,
    amp: (t) => Math.exp(-t / 0.006),
    gain: 0.5 * gain,
  });
}

const RESULT = {
  *chime(sr, buf, rand) {
    yield* bell(buf, sr, rand, 1318.5, 0, 1); // E6
    yield* bell(buf, sr, rand, 1975.5, 0.1, 0.7); // B6
    yield* reverb(buf, sr, { mix: 0.3, decay: 1.0 });
  },
  *fanfare(sr, buf, rand) {
    const brass = { partials: SAW, detune: [-7, 0, 6], attack: 0.02, swell: 0.05, scoop: 0.985 };
    for (const [f, at] of [[392, 0], [523.25, 0.12], [659.25, 0.24]]) {
      yield* voice(buf, sr, { ...brass, freq: f, start: at, dur: 0.17, tau: 0.3, gain: 0.8 });
    }
    for (const f of [523.25, 659.25, 783.99, 1046.5]) {
      yield* voice(buf, sr, { ...brass, freq: f, start: 0.38, dur: 1.0, tau: 1.1, gain: 0.55, vib: 0.006, vibDelay: 0.2 });
    }
    yield* noiseBand(buf, sr, rand, { start: 0.38, dur: 0.9, fc: () => 7000, q: 1.5, amp: (t) => envAt(t, 0.04, 0.35, 0.9), gain: 0.08 });
    yield* saturate(buf, 1.4);
    yield* reverb(buf, sr, { mix: 0.28, decay: 1.1 });
  },
  *sparkle(sr, buf, rand) {
    for (let i = 0; i < 20; i++) {
      const at = Math.pow(rand(), 1.4) * 0.85; // denser early, thinning out
      const f = PENTA[Math.floor(rand() * PENTA.length)];
      yield* voice(buf, sr, { freq: f, start: at, dur: 0.35, gain: 0.3 + 0.7 * rand(), attack: 0.001, tau: 0.12 + rand() * 0.13, partials: PING });
    }
    yield* noiseBand(buf, sr, rand, { dur: 1.0, fc: (t) => 8000 + 3000 * t, q: 1, amp: (t) => Math.sin(Math.PI * Math.min(1, t / 0.95)), gain: 0.05 });
    yield* reverb(buf, sr, { mix: 0.35, decay: 0.9 });
  },
  *fizzle(sr, buf, rand) {
    // A sad two-step slide (G4, E-flat4, then sagging below C4) with a growing warble, plus sputter.
    const pitch = (t) => {
      if (t < 0.18) return 1;
      if (t < 0.3) return 1 - (1 - 311.1 / 392) * ((t - 0.18) / 0.12);
      if (t < 0.45) return 311.1 / 392;
      const k = Math.min(1, (t - 0.45) / 0.5);
      return (311.1 / 392) * Math.pow(200 / 311.1, k);
    };
    const muted = [[1, 1, 1], [2, 0.22, 0.8], [3, 0.12, 0.6], [5, 0.04, 0.5]];
    yield* voice(buf, sr, { freq: 392, dur: 1.05, attack: 0.03, tau: 0.9, partials: muted, detune: [-8, 6], pitch, vib: 0.02, vibRate: 6, vibDelay: 0.45 });
    let gate = 1;
    let next = 0;
    yield* noiseBand(buf, sr, rand, {
      start: 0.45,
      dur: 0.6,
      fc: () => 3000,
      q: 3,
      amp: (t) => {
        if (t >= next) {
          gate = rand() < 0.6 ? 1 : 0;
          next = t + 0.02 + rand() * 0.02;
        }
        return gate * (1 - t / 0.6) * (1 - t / 0.6);
      },
      gain: 0.25,
    });
    yield* reverb(buf, sr, { mix: 0.15, decay: 0.6 });
  },
  *thud(sr, buf, rand) {
    yield* voice(buf, sr, { freq: 130, dur: 0.6, attack: 0.002, tau: 0.18, partials: [[1, 1, 1], [2, 0.15, 0.5]], pitch: (t) => Math.pow(46 / 130, Math.min(1, t / 0.25)) });
    yield* addModes(buf, sr, [[240, 0.025, 0.5], [410, 0.015, 0.25]]);
    yield* noiseBand(buf, sr, rand, { dur: 0.25, fc: (t) => 300 - 180 * Math.min(1, t / 0.2), q: 0.8, amp: (t) => Math.exp(-t / 0.04), gain: 0.6 });
    yield* saturate(buf, 1.6);
    yield* reverb(buf, sr, { mix: 0.12, decay: 0.4 });
  },
  *whoosh(sr, buf, rand) {
    const d = 0.95;
    const fc = (t) => 350 + 2200 * Math.pow(Math.sin((Math.PI * t) / d), 2);
    const amp = (t) => (t < 0.35 * d ? Math.pow(t / (0.35 * d), 2) : Math.exp(-(t - 0.35 * d) / 0.18));
    yield* noiseBand(buf, sr, rand, { dur: d, fc, q: 1.8, amp, gain: 1 });
    yield* noiseBand(buf, sr, rand, { start: 0.03, dur: d - 0.03, fc: (t) => 1.5 * fc(t), q: 3, amp, gain: 0.4 });
    yield* reverb(buf, sr, { mix: 0.18, decay: 0.7 });
  },
  *crackle(sr, buf, rand) {
    const fade = (t) => (t < 0.08 ? t / 0.08 : Math.max(0, 1 - (t - 0.08) / 0.95));
    yield* clicks(buf, sr, rand, { count: 55, from: 0, to: 1.0, gain: 1, fade });
    yield* clicks(buf, sr, rand, { count: 18, from: 0.05, to: 0.25, gain: 0.8 }); // an early flurry
    yield* noiseBand(buf, sr, rand, { dur: 1.05, fc: () => 2500, q: 0.7, amp: fade, gain: 0.06 });
    yield* noiseBand(buf, sr, rand, { dur: 1.05, fc: () => 180, q: 0.6, amp: fade, gain: 0.05 });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.4 });
  },
  *zap(sr, buf, rand) {
    const n = Math.min(buf.length, Math.floor(0.42 * sr));
    let pc = 0;
    let pm = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const fcar = 2200 * Math.pow(180 / 2200, Math.min(1, t / 0.3));
      pc += (TAU * fcar) / sr;
      pm += (TAU * fcar * 1.41) / sr;
      const index = 6 * Math.exp(-t / 0.08) + 1;
      const arc = 0.65 + 0.35 * Math.sign(Math.sin(TAU * 90 * t)); // an electric buzz
      buf[i] += 0.8 * envAt(t, 0.003, 0.12, 0.42) * arc * Math.sin(pc + index * Math.sin(pm));
      if ((i & BLOCK_MASK) === BLOCK_MASK) yield;
    }
    yield* clicks(buf, sr, rand, { count: 8, from: 0, to: 0.2, gain: 0.7 });
    yield* noiseBand(buf, sr, rand, { dur: 0.3, fc: () => 4500, q: 1, amp: (t) => Math.exp(-t / 0.05), gain: 0.25 });
    yield* reverb(buf, sr, { mix: 0.14, decay: 0.5 });
  },
  *boom(sr, buf, rand) {
    yield* voice(buf, sr, { freq: 85, dur: 1.4, attack: 0.004, tau: 0.5, partials: [[1, 1, 1], [2, 0.2, 0.6]], pitch: (t) => Math.pow(32 / 85, Math.min(1, t / 0.6)) });
    yield* noiseBand(buf, sr, rand, { dur: 1.2, fc: (t) => 2500 * Math.exp(-t / 0.08) + 150, q: 0.6, amp: (t) => envAt(t, 0.004, 0.25, 1.2), gain: 0.9 });
    yield* noiseBand(buf, sr, rand, { dur: 1.4, fc: () => 90, q: 0.5, amp: (t) => envAt(t, 0.02, 0.6, 1.4), gain: 0.5 });
    yield* saturate(buf, 1.8);
    yield* reverb(buf, sr, { mix: 0.25, decay: 1.2 });
  },
};

const RESULT_DUR = { chime: 1.5, fanfare: 1.5, sparkle: 1.3, fizzle: 1.2, thud: 0.7, whoosh: 1.0, crackle: 1.1, zap: 0.5, boom: 1.5 };

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

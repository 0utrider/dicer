/**
 * Pure-DSP sound synthesis. Renders impact, surface and result sounds as
 * Float32Array buffers; no WebAudio, no three.js (this is the lazy `audio` chunk).
 * Numbers are plausible starting points, to be tuned by ear on the dev page.
 *
 * Every renderer is a generator that yields after each BLOCK samples of work, so
 * renderAll can resume it across idle callbacks and respect its time budget.
 */
import { mulberry32 } from '../core/rng.js';
import { RESULT_SOUNDS, PET_SOUNDS } from './sound-names.js';
import { PET_TIMBRES } from './pet-timbre.js';

export const SOUND_MATERIALS = ['plastic', 'metal', 'wood', 'glass', 'stone', 'squishy'];
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
  // a soft, damped thud with a dull slap: no ring at all
  squishy: { dur: 0.18, jitter: 0.5, modes: [[150, 0.02, 0.6], [260, 0.015, 0.5], [410, 0.01, 0.4], [620, 0.006, 0.3]], noise: { gain: 0.8, tau: 0.01, bright: 0.03 } },
};

function* impactGen(material, variant, sampleRate) {
  const spec = IMPACT[material];
  if (!spec) throw new RangeError(`Unknown impact material: ${material}`);
  const rand = mulberry32(hash(`${material}:${variant}`));
  const buf = new Float32Array(Math.floor(spec.dur * sampleRate));
  const modes = spec.modes.map(([f, tau, g]) => [
    f * (1 + (rand() - 0.5) * (spec.jitter ?? 0.12)),
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
 * scoop from `scoop` x freq up to freq over 40 ms); swell: s for partials above the second to fade in;
 * release: s of linear fade at the end; flutter: [Hz, depth], a loudness flutter (a purr's trill).
 */
// The pet kind's timbre while renderPetSound renders (pet-timbre.js); voice() reads it.
let timbre = null;
let noise = 1; // its breath's noise state (xorshift)

function* voice(buf, sr, o) {
  const T = timbre;
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
    release = 0.03,
    flutter = null,
  } = o;
  // a pet kind's voice: its own source for these notes (the sound keeps its pitch and envelope)
  let parts = partials;
  if (T) {
    parts = T.inharm ?? T.harm.map((g, k) => [k + 1, g, 1]).filter(([, g]) => g > 0);
    if (T.sub) parts = [[0.5, T.sub, 1], ...parts];
    parts = parts.filter(([r]) => freq * r * 1.7 < 0.45 * sr); // no harmonic past Nyquist at the top of a glide
  }
  const tauK = T?.tauMul ?? 1;
  const [fmR, fmI] = T?.fm ?? [0, 0];
  const [amHz, amD] = T?.am ?? [0, 0];
  const [vHz, vD] = T?.vib ?? [0, 0];
  const breath = T?.breath ?? 0;
  let br = 0;
  const s0 = Math.floor(start * sr);
  const n = Math.min(buf.length - s0, Math.floor(dur * sr));
  const mults = detune.map((c) => Math.pow(2, c / 1200));
  const phases = new Float64Array(mults.length);
  const norm = gain / mults.length;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = envAt(t, attack, tau, dur, release);
    let p = pitch ? pitch(t) : scoop + (1 - scoop) * Math.min(1, t / 0.04);
    if (vib) p *= 1 + vib * Math.min(1, Math.max(0, (t - vibDelay) / 0.12)) * Math.sin(TAU * vibRate * t);
    if (vD) p *= 1 + vD * Math.sin(TAU * vHz * t);
    const bright = swell ? Math.min(1, t / swell) : 1;
    let s = 0;
    for (let c = 0; c < mults.length; c++) {
      phases[c] += (TAU * freq * p * mults[c]) / sr;
      const ph = phases[c];
      const mod = fmI ? fmI * Math.sin(ph * fmR) : 0;
      for (let k = 0; k < parts.length; k++) {
        const [ratio, g, df] = parts[k];
        s += g * (k > 1 ? bright : 1) * Math.exp(-t / (tau * df * tauK)) * Math.sin(ph * ratio + mod);
      }
    }
    if (breath) {
      noise ^= noise << 13;
      noise ^= noise >>> 17;
      noise ^= noise << 5;
      br += 0.35 * ((noise >>> 0) / 2147483648 - 1 - br); // a soft, low-passed hiss
      s += breath * br * 6 * mults.length;
    }
    let am = amD ? 1 - amD / 2 + (amD / 2) * Math.sin(TAU * amHz * t) : 1;
    if (flutter) am *= 1 - flutter[1] + flutter[1] * Math.sin(TAU * flutter[0] * t);
    buf[s0 + i] += norm * env * am * s;
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
  // Damage landings (damage-themes.js): one per element, short so they sit under the dice.
  *frost(sr, buf, rand) {
    // Cold: ice cracking, glassy high pings over a cold breath of air.
    yield* clicks(buf, sr, rand, { count: 26, from: 0, to: 0.35, gain: 1, fade: (t) => 1 - t / 0.4 });
    for (let i = 0; i < 9; i++) {
      const at = Math.pow(rand(), 1.6) * 0.45;
      yield* voice(buf, sr, { freq: 2600 + rand() * 2800, start: at, dur: 0.4, gain: 0.25 + 0.4 * rand(), attack: 0.001, tau: 0.07 + rand() * 0.08, partials: BELL });
    }
    yield* noiseBand(buf, sr, rand, { dur: 0.85, fc: (t) => 7500 - 2500 * t, q: 1.2, amp: (t) => envAt(t, 0.03, 0.3, 0.85), gain: 0.14 });
    yield* reverb(buf, sr, { mix: 0.28, decay: 0.8, damp: 0.2 });
  },
  *hiss(sr, buf, rand) {
    // Acid: a corrosive sizzle that sputters, with small bubbles popping in it.
    let gate = 1;
    let next = 0;
    const sputter = (t) => {
      if (t >= next) {
        gate = 0.45 + 0.55 * rand();
        next = t + 0.012 + rand() * 0.03;
      }
      return gate * envAt(t, 0.02, 0.38, 0.9);
    };
    yield* noiseBand(buf, sr, rand, { dur: 0.9, fc: (t) => 6200 - 1800 * t, q: 0.9, amp: sputter, gain: 0.9 });
    for (let i = 0; i < 7; i++) {
      const at = 0.05 + rand() * 0.6;
      const f = 380 + rand() * 420;
      yield* voice(buf, sr, { freq: f, start: at, dur: 0.06, gain: 0.35, attack: 0.002, tau: 0.025, pitch: (t) => 1 + 1.4 * Math.min(1, t / 0.05) });
    }
    yield* reverb(buf, sr, { mix: 0.12, decay: 0.4 });
  },
  *ring(sr, buf, rand) {
    // Sonic: a struck, ringing tone that beats and trembles, after a dull thump.
    yield* noiseBand(buf, sr, rand, { dur: 0.08, fc: () => 220, q: 0.7, amp: (t) => Math.exp(-t / 0.02), gain: 0.8 });
    yield* voice(buf, sr, { freq: 880, dur: 1.05, attack: 0.002, tau: 0.45, partials: [[1, 1, 1], [1.006, 0.85, 1], [2.76, 0.35, 0.5], [5.4, 0.16, 0.3]], vib: 0.004, vibRate: 13, vibDelay: 0.05 });
    yield* reverb(buf, sr, { mix: 0.3, decay: 0.9 });
  },
  *hum(sr, buf, rand) {
    // Force: a deep pulse of pressure, a "whomp" sweeping down over a low hum.
    yield* voice(buf, sr, { freq: 72, dur: 0.85, attack: 0.012, tau: 0.32, partials: [[1, 1, 1], [2, 0.5, 0.7], [3, 0.18, 0.5]], vib: 0.03, vibRate: 7, vibDelay: 0 });
    yield* noiseBand(buf, sr, rand, { dur: 0.5, fc: (t) => 1300 * Math.exp(-t / 0.12) + 160, q: 1.4, amp: (t) => envAt(t, 0.01, 0.16, 0.5), gain: 0.7 });
    yield* saturate(buf, 1.7);
    yield* reverb(buf, sr, { mix: 0.18, decay: 0.6 });
  },
  *shimmer(sr, buf, rand) {
    // Vitality: a warm, rising major arpeggio of soft bells, lifted by a bright breath.
    const soft3 = [[1, 1, 1], [2, 0.3, 0.6], [3, 0.08, 0.4]];
    for (const [f, at] of [[1046.5, 0], [1318.5, 0.07], [1568, 0.14], [2093, 0.21]]) {
      yield* voice(buf, sr, { freq: f, start: at, dur: 0.85 - at, gain: 0.55, attack: 0.012, tau: 0.35, partials: soft3, detune: [-4, 4] });
    }
    yield* noiseBand(buf, sr, rand, { dur: 0.9, fc: (t) => 5000 + 4000 * t, q: 1.1, amp: (t) => envAt(t, 0.12, 0.35, 0.9), gain: 0.06 });
    yield* reverb(buf, sr, { mix: 0.38, decay: 1.0 });
  },
  *rift(sr, buf, rand) {
    // Void: a reversed swoosh that swells and is swallowed, over a sinking sub-bass.
    const d = 0.62;
    const amp = (t) => (t < d ? Math.pow(t / d, 3) : Math.max(0, 1 - (t - d) / 0.03));
    yield* noiseBand(buf, sr, rand, { dur: d + 0.03, fc: (t) => 3200 * Math.pow(250 / 3200, Math.min(1, t / d)), q: 1.6, amp, gain: 1 });
    yield* voice(buf, sr, { freq: 110, dur: 0.95, attack: 0.25, tau: 0.6, partials: [[1, 1, 1], [1.5, 0.2, 0.6]], pitch: (t) => Math.pow(0.4, Math.min(1, t / 0.9)) });
    yield* reverb(buf, sr, { mix: 0.3, decay: 1.1, damp: 0.6 });
  },
  *bubble(sr, buf, rand) {
    // Poison: thick, queasy bubbling ("bloop") over a murky rumble.
    for (let i = 0; i < 11; i++) {
      const at = Math.pow(rand(), 0.9) * 0.7;
      const f = 180 + rand() * 260;
      yield* voice(buf, sr, { freq: f, start: at, dur: 0.09, gain: 0.45 + 0.4 * rand(), attack: 0.004, tau: 0.035, partials: [[1, 1, 1], [2, 0.15, 0.5]], pitch: (t) => 1 + 1.1 * Math.min(1, t / 0.07) });
    }
    yield* noiseBand(buf, sr, rand, { dur: 0.85, fc: () => 380, q: 0.9, amp: (t) => envAt(t, 0.05, 0.35, 0.85), gain: 0.18 });
    yield* reverb(buf, sr, { mix: 0.12, decay: 0.45 });
  },
  *warble(sr, buf) {
    // Mental: an eerie, wobbling tone bending out of tune, with a thin whine above it.
    const wob = { attack: 0.06, tau: 0.55, partials: [[1, 1, 1], [2, 0.2, 0.6]], vib: 0.045, vibRate: 5.5, vibDelay: 0 };
    yield* voice(buf, sr, { ...wob, freq: 520, dur: 0.95, detune: [-14, 12], pitch: (t) => 1 - 0.12 * Math.sin(Math.min(1, t / 0.9) * Math.PI) });
    yield* voice(buf, sr, { freq: 2080, dur: 0.9, gain: 0.12, attack: 0.15, tau: 0.5, vib: 0.02, vibRate: 9, vibDelay: 0 });
    yield* reverb(buf, sr, { mix: 0.35, decay: 0.9 });
  },
  *ethereal(sr, buf, rand) {
    // Spirit: an airy, choir-like "aah" fading in and out, with breath in it.
    const airy = { attack: 0.14, tau: 0.6, partials: [[1, 1, 1], [2, 0.25, 0.7], [3, 0.1, 0.5]], detune: [-6, 0, 7], vib: 0.01, vibRate: 4.5, vibDelay: 0.1 };
    yield* voice(buf, sr, { ...airy, freq: 659.25, dur: 1.0, gain: 0.6 });
    yield* voice(buf, sr, { ...airy, freq: 987.75, start: 0.06, dur: 0.94, gain: 0.4 });
    yield* noiseBand(buf, sr, rand, { dur: 1.0, fc: () => 1300, q: 2.2, amp: (t) => envAt(t, 0.15, 0.55, 1.0), gain: 0.2 });
    yield* reverb(buf, sr, { mix: 0.45, decay: 1.1 });
  },
  *squelch(sr, buf, rand) {
    // Bleed: a wet hit, then a few drips.
    yield* noiseBand(buf, sr, rand, { dur: 0.22, fc: (t) => 1600 * Math.exp(-t / 0.05) + 180, q: 1, amp: (t) => envAt(t, 0.004, 0.07, 0.22), gain: 0.9 });
    yield* voice(buf, sr, { freq: 170, dur: 0.2, gain: 0.55, attack: 0.005, tau: 0.06, partials: [[1, 1, 1], [1.5, 0.3, 0.6]], pitch: (t) => Math.pow(0.45, Math.min(1, t / 0.16)) });
    for (const at of [0.26, 0.41, 0.52]) {
      yield* voice(buf, sr, { freq: 900 + rand() * 400, start: at, dur: 0.06, gain: 0.25, attack: 0.002, tau: 0.02, pitch: (t) => 1 + 0.8 * Math.min(1, t / 0.04) });
    }
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.35 });
  },
  *knock(sr, buf, rand) {
    // Physical: one solid, weighty knock.
    yield* addModes(buf, sr, [[170, 0.06, 1], [410, 0.035, 0.5], [880, 0.016, 0.25]]);
    yield* noiseBand(buf, sr, rand, { dur: 0.08, fc: () => 500, q: 0.8, amp: (t) => Math.exp(-t / 0.015), gain: 0.7 });
    yield* voice(buf, sr, { freq: 95, dur: 0.3, gain: 0.6, attack: 0.002, tau: 0.08, pitch: (t) => Math.pow(0.7, Math.min(1, t / 0.15)) });
    yield* saturate(buf, 1.5);
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.35 });
  },
  // The dice pet's voice: small, soft-attacked and bright without being shrill.
  *petHappy(sr, buf) {
    // Three rising chirps, each with a little upward glide.
    const soft2 = [[1, 1, 1], [2, 0.2, 0.6]];
    for (const [freq, start] of [[880, 0], [1100, 0.14], [1400, 0.28]]) {
      yield* voice(buf, sr, { freq, start, dur: 0.15, gain: 0.8, attack: 0.012, tau: 0.07, partials: soft2, pitch: (t) => 0.9 + 0.2 * Math.min(1, t / 0.08) });
    }
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.3 });
  },
  *petSad(sr, buf) {
    // A falling two-note whimper ("aww") with a slight vibrato.
    const soft2 = [[1, 1, 1], [2, 0.18, 0.6]];
    const o = { attack: 0.03, partials: soft2, vib: 0.012, vibRate: 6, vibDelay: 0.08, gain: 0.8 };
    yield* voice(buf, sr, { ...o, freq: 880, start: 0, dur: 0.3, tau: 0.25, pitch: (t) => 1.03 - 0.06 * Math.min(1, t / 0.3) });
    yield* voice(buf, sr, { ...o, freq: 660, start: 0.28, dur: 0.32, tau: 0.28, pitch: (t) => 1.02 - 0.14 * Math.min(1, t / 0.32) });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.3 });
  },
  // more voices for a natural 20 and a 1: the pet layer picks one at random each time
  *petHappy2(sr, buf) { // a "yaaay!": one big upward swoop with a trill at the top
    yield* voice(buf, sr, { freq: 760, dur: 0.38, gain: 0.8, attack: 0.015, tau: 0.3, partials: [[1, 1, 1], [2, 0.22, 0.6]], vib: 0.03, vibRate: 14, vibDelay: 0.22, pitch: (t) => 0.92 + 0.75 * Math.min(1, t / 0.24) ** 0.8 });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.3 });
  },
  *petHappy3(sr, buf) { // a giggly trill: quick notes bouncing upward
    const soft2 = [[1, 1, 1], [2, 0.2, 0.6]];
    const notes = [[1000, 0], [1250, 0.07], [1060, 0.14], [1330, 0.21], [1500, 0.28]];
    for (const [freq, start] of notes) yield* voice(buf, sr, { freq, start, dur: 0.08, gain: 0.72, attack: 0.008, tau: 0.05, partials: soft2 });
    yield* reverb(buf, sr, { mix: 0.12, decay: 0.3 });
  },
  *petHappy4(sr, buf) { // a "woo-hoo!": a low note gliding up, then a high one
    const o = { gain: 0.8, attack: 0.015, partials: [[1, 1, 1], [2, 0.22, 0.6]] };
    yield* voice(buf, sr, { ...o, freq: 820, start: 0, dur: 0.17, tau: 0.12, pitch: (t) => 0.85 + 0.25 * Math.min(1, t / 0.15) });
    yield* voice(buf, sr, { ...o, freq: 1320, start: 0.2, dur: 0.22, tau: 0.16, pitch: (t) => 1.05 - 0.1 * Math.min(1, t / 0.22) });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.3 });
  },
  *petSad2(sr, buf) { // a long falling "awww"
    yield* voice(buf, sr, { freq: 820, dur: 0.55, gain: 0.8, attack: 0.04, tau: 0.45, partials: [[1, 1, 1], [2, 0.18, 0.6]], vib: 0.018, vibRate: 5.5, vibDelay: 0.15, pitch: (t) => 1.02 - 0.32 * Math.min(1, t / 0.5) ** 1.2 });
    yield* reverb(buf, sr, { mix: 0.12, decay: 0.35 });
  },
  *petSad3(sr, buf) { // a three-note sigh stepping down
    const o = { gain: 0.72, attack: 0.025, partials: [[1, 1, 1], [2, 0.16, 0.6]], vib: 0.01, vibRate: 6, vibDelay: 0.05 };
    for (const [freq, start, dur] of [[760, 0, 0.15], [670, 0.16, 0.15], [540, 0.32, 0.28]])
      yield* voice(buf, sr, { ...o, freq, start, dur, tau: dur * 0.8, pitch: (t) => 1 - 0.05 * Math.min(1, t / dur) });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.3 });
  },
  *petSad4(sr, buf) { // an "uh-oh"
    const o = { gain: 0.78, attack: 0.02, partials: [[1, 1, 1], [2, 0.25, 0.6], [3, 0.08, 0.4]] };
    yield* voice(buf, sr, { ...o, freq: 720, start: 0, dur: 0.14, tau: 0.1 });
    yield* voice(buf, sr, { ...o, freq: 540, start: 0.18, dur: 0.3, tau: 0.24, pitch: (t) => 1 - 0.08 * Math.min(1, t / 0.3) });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.3 });
  },
  *petSplat(sr, buf, rand) {
    // A wet "splorch": a noisy burst whose band falls fast, over a short falling blob of a tone.
    yield* noiseBand(buf, sr, rand, { dur: 0.3, fc: (t) => 2200 * Math.exp(-t / 0.07) + 220, q: 0.8, amp: (t) => envAt(t, 0.004, 0.09, 0.3), gain: 0.8 });
    yield* voice(buf, sr, { freq: 240, dur: 0.25, gain: 0.5, attack: 0.006, tau: 0.07, partials: [[1, 1, 1], [1.5, 0.3, 0.6]], pitch: (t) => Math.pow(0.35, Math.min(1, t / 0.2)) });
  },
  *petPurr(sr, buf) {
    // Petted: a rolling "brrrp" trill (a soft tone fluttering 28 times a second) that lifts at the end.
    yield* voice(buf, sr, { freq: 520, dur: 0.6, gain: 0.7, attack: 0.04, tau: 0.5, release: 0.08, partials: [[1, 1, 1e9], [2, 0.25, 1e9]], flutter: [28, 0.45], pitch: (t) => 1 + 0.35 * Math.max(0, (t - 0.4) / 0.2) ** 2 });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.3 });
  },
  *petHuff(sr, buf, rand) {
    // Fed up: a little nasal "hmph", falling, after a puff of breath.
    yield* noiseBand(buf, sr, rand, { dur: 0.16, fc: () => 1400, q: 0.7, amp: (t) => envAt(t, 0.01, 0.06, 0.16), gain: 0.5 });
    yield* voice(buf, sr, { freq: 420, start: 0.08, dur: 0.3, gain: 0.7, attack: 0.02, tau: 0.15, partials: [[1, 1, 1], [2, 0.45, 0.7], [3, 0.2, 0.5]], pitch: (t) => 1.05 - 0.25 * Math.min(1, t / 0.3) });
  },
  *petYelp(sr, buf) {
    // Startled: a quick rising "eep!".
    yield* voice(buf, sr, { freq: 900, dur: 0.18, gain: 0.8, attack: 0.006, tau: 0.08, partials: [[1, 1, 1], [2, 0.25, 0.6]], pitch: (t) => 0.8 + 0.7 * Math.min(1, t / 0.07) });
    yield* reverb(buf, sr, { mix: 0.08, decay: 0.25 });
  },
  *petShiver(sr, buf, rand) {
    // Cold: teeth chattering (quick clicks) under a wavering little "brrr".
    yield* clicks(buf, sr, rand, { count: 14, from: 0, to: 0.5, gain: 0.5 });
    yield* voice(buf, sr, { freq: 600, dur: 0.55, gain: 0.45, attack: 0.03, tau: 0.4, partials: [[1, 1, 1], [2, 0.2, 0.6]], vib: 0.06, vibRate: 16, vibDelay: 0 });
  },
  *petCough(sr, buf, rand) {
    // Smoke or a foul haze: two small coughs, "kff kff".
    for (const start of [0, 0.2]) {
      yield* noiseBand(buf, sr, rand, { start, dur: 0.12, fc: (t) => 1100 - 400 * t, q: 1.2, amp: (t) => envAt(t, 0.004, 0.04, 0.12), gain: 0.8 });
      yield* voice(buf, sr, { freq: 330, start, dur: 0.1, gain: 0.35, attack: 0.004, tau: 0.04, partials: [[1, 1, 1], [2, 0.4, 0.6]] });
    }
  },
  *petCoo(sr, buf) {
    // Healed: a warm, happy "ooo~" rising and settling, with a gentle vibrato.
    yield* voice(buf, sr, { freq: 660, dur: 0.55, gain: 0.75, attack: 0.05, tau: 0.45, partials: [[1, 1, 1], [2, 0.15, 0.6]], vib: 0.015, vibRate: 6, vibDelay: 0.15, pitch: (t) => 0.92 + 0.18 * Math.sin(Math.min(1, t / 0.4) * Math.PI * 0.6) });
    yield* reverb(buf, sr, { mix: 0.12, decay: 0.35 });
  },
  *petDizzy(sr, buf) {
    // Dazed: a woozy "wooo-ooo" warbling down.
    yield* voice(buf, sr, { freq: 760, dur: 0.6, gain: 0.7, attack: 0.03, tau: 0.5, partials: [[1, 1, 1], [2, 0.15, 0.6]], vib: 0.08, vibRate: 5, vibDelay: 0, pitch: (t) => 1.05 - 0.35 * Math.min(1, t / 0.6) });
    yield* reverb(buf, sr, { mix: 0.12, decay: 0.35 });
  },
  *petZap(sr, buf, rand) {
    // Shocked: a buzzing "bzzt" that jumps into a squeak.
    const n = Math.min(buf.length, Math.floor(0.16 * sr));
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      ph += (TAU * 330) / sr;
      buf[i] += 0.35 * envAt(t, 0.004, 0.1, 0.16) * Math.sign(Math.sin(ph)) * (0.6 + 0.4 * Math.sin(TAU * 60 * t));
      if ((i & BLOCK_MASK) === BLOCK_MASK) yield;
    }
    yield* clicks(buf, sr, rand, { count: 6, from: 0, to: 0.14, gain: 0.5 });
    yield* voice(buf, sr, { freq: 1050, start: 0.14, dur: 0.16, gain: 0.7, attack: 0.005, tau: 0.08, partials: [[1, 1, 1], [2, 0.2, 0.6]], pitch: (t) => 0.85 + 0.4 * Math.min(1, t / 0.06) });
  },
  *petFizz(sr, buf, rand) {
    // Acid: a sizzling "tsss" and a squeal climbing over it.
    yield* noiseBand(buf, sr, rand, { dur: 0.45, fc: () => 5200, q: 1.5, amp: (t) => envAt(t, 0.01, 0.25, 0.45) * (0.7 + 0.3 * Math.sin(TAU * 23 * t)), gain: 0.5 });
    yield* voice(buf, sr, { freq: 820, start: 0.06, dur: 0.3, gain: 0.6, attack: 0.02, tau: 0.2, partials: [[1, 1, 1], [2, 0.2, 0.6]], pitch: (t) => 0.9 + 0.35 * Math.min(1, t / 0.25) });
  },
  *petRing(sr, buf) {
    // Sonic: ears ringing, a thin high "eeee" that trembles and fades.
    yield* voice(buf, sr, { freq: 1700, dur: 0.6, gain: 0.45, attack: 0.01, tau: 0.35, partials: [[1, 1, 1], [1.006, 0.8, 1]], vib: 0.02, vibRate: 11, vibDelay: 0 });
    yield* voice(buf, sr, { freq: 700, dur: 0.12, gain: 0.5, attack: 0.004, tau: 0.05, partials: [[1, 1, 1], [2, 0.3, 0.6]] });
    yield* reverb(buf, sr, { mix: 0.2, decay: 0.5 });
  },
  *petOof(sr, buf, rand) {
    // Force: knocked back, a short low "oof" with a puff of air.
    yield* noiseBand(buf, sr, rand, { dur: 0.12, fc: () => 700, q: 0.7, amp: (t) => envAt(t, 0.004, 0.04, 0.12), gain: 0.6 });
    yield* voice(buf, sr, { freq: 300, dur: 0.22, gain: 0.8, attack: 0.008, tau: 0.09, partials: [[1, 1, 1], [2, 0.5, 0.7], [3, 0.2, 0.5]], pitch: (t) => 1.1 - 0.3 * Math.min(1, t / 0.2) });
  },
  *petOw(sr, buf) {
    // Bleeding: a little hurt "ow-ow", the second lower.
    const o = { attack: 0.015, tau: 0.1, partials: [[1, 1, 1], [2, 0.35, 0.6], [3, 0.12, 0.5]], gain: 0.75 };
    yield* voice(buf, sr, { ...o, freq: 740, start: 0, dur: 0.17, pitch: (t) => 1 + 0.15 * Math.sin(Math.min(1, t / 0.17) * Math.PI) - 0.15 * (t / 0.17) });
    yield* voice(buf, sr, { ...o, freq: 620, start: 0.19, dur: 0.2, pitch: (t) => 1 + 0.1 * Math.sin(Math.min(1, t / 0.2) * Math.PI) - 0.2 * (t / 0.2) });
  },
  *petWhoa(sr, buf, rand) {
    // Slashing: a blade's swish past it, and a startled "whoa!".
    yield* noiseBand(buf, sr, rand, { dur: 0.16, fc: (t) => 1500 + 9000 * (t / 0.16), q: 2, amp: (t) => envAt(t, 0.02, 0.06, 0.16), gain: 0.5 });
    yield* voice(buf, sr, { freq: 560, start: 0.12, dur: 0.3, gain: 0.75, attack: 0.02, tau: 0.18, partials: [[1, 1, 1], [2, 0.3, 0.6]], pitch: (t) => 0.85 + 0.35 * Math.sin(Math.min(1, t / 0.3) * Math.PI) });
  },
  *petYip(sr, buf) {
    // Piercing: a sharp, short "yip!".
    yield* voice(buf, sr, { freq: 1300, dur: 0.1, gain: 0.8, attack: 0.003, tau: 0.04, partials: [[1, 1, 1], [2, 0.3, 0.5]], pitch: (t) => 1.15 - 0.3 * Math.min(1, t / 0.1) });
  },
  *petBonk(sr, buf, rand) {
    // Bludgeoning: a hollow "bonk" on its head and a dazed little "mm".
    yield* addModes(buf, sr, [[520, 0.06, 0.8], [1310, 0.03, 0.35]]);
    yield* noiseBand(buf, sr, rand, { dur: 0.05, fc: () => 900, q: 0.8, amp: (t) => Math.exp(-t / 0.012), gain: 0.5 });
    yield* voice(buf, sr, { freq: 380, start: 0.12, dur: 0.22, gain: 0.5, attack: 0.03, tau: 0.15, partials: [[1, 1, 1], [2, 0.2, 0.6]], pitch: (t) => 1 - 0.15 * Math.min(1, t / 0.22) });
  },
  *petBleh(sr, buf, rand) {
    // Poison: a queasy gag, "bleh", wobbling.
    yield* voice(buf, sr, { freq: 360, dur: 0.38, gain: 0.7, attack: 0.02, tau: 0.25, partials: [[1, 1, 1], [2, 0.6, 0.7], [3, 0.35, 0.5]], vib: 0.05, vibRate: 9, vibDelay: 0.05, pitch: (t) => 1 - 0.2 * Math.min(1, t / 0.38) });
    yield* noiseBand(buf, sr, rand, { dur: 0.3, fc: () => 500, q: 0.9, amp: (t) => envAt(t, 0.02, 0.15, 0.3), gain: 0.25 });
  },
  *petSpooked(sr, buf) {
    // Void: a nervous, wavering low "ooo..." sinking away.
    yield* voice(buf, sr, { freq: 440, dur: 0.6, gain: 0.65, attack: 0.06, tau: 0.5, partials: [[1, 1, 1], [1.5, 0.15, 0.6]], vib: 0.04, vibRate: 7, vibDelay: 0, pitch: (t) => 1 - 0.3 * Math.min(1, t / 0.6) });
    yield* reverb(buf, sr, { mix: 0.3, decay: 0.7 });
  },
  *petHmm(sr, buf) {
    // A plain result: a satisfied little "mm-hm", low then a touch higher, closed and soft.
    const o = { gain: 0.65, attack: 0.025, partials: [[1, 1, 1], [2, 0.12, 0.5]] };
    yield* voice(buf, sr, { ...o, freq: 400, start: 0, dur: 0.16, tau: 0.12, pitch: (t) => 1 - 0.04 * Math.min(1, t / 0.16) });
    yield* voice(buf, sr, { ...o, freq: 500, start: 0.19, dur: 0.22, tau: 0.16, pitch: (t) => 0.96 + 0.06 * Math.min(1, t / 0.12) });
    yield* reverb(buf, sr, { mix: 0.08, decay: 0.25 });
  },
  *petHuh(sr, buf) {
    // A 20 and a 1 together: a puzzled "huh?", a short breath then a tone rising like a question.
    yield* voice(buf, sr, { freq: 520, dur: 0.32, gain: 0.7, attack: 0.03, tau: 0.25, partials: [[1, 1, 1], [2, 0.3, 0.6], [3, 0.1, 0.4]], pitch: (t) => 0.85 + 0.4 * Math.min(1, t / 0.3) ** 1.5 });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.3 });
  },
  // more voices for an ordinary result and a mixed one (picked at random, like the "ooh?"s)
  *petHmm2(sr, buf) { // a short contented "mm."
    yield* voice(buf, sr, { freq: 380, dur: 0.24, gain: 0.65, attack: 0.03, tau: 0.18, partials: [[1, 1, 1], [2, 0.12, 0.5]], pitch: (t) => 1 + 0.05 * Math.sin(Math.min(1, t / 0.24) * Math.PI) });
    yield* reverb(buf, sr, { mix: 0.08, decay: 0.25 });
  },
  *petHmm3(sr, buf) { // an "o-kay": up, then settling down
    const o = { gain: 0.65, attack: 0.02, partials: [[1, 1, 1], [2, 0.2, 0.5]] };
    yield* voice(buf, sr, { ...o, freq: 470, start: 0, dur: 0.12, tau: 0.09 });
    yield* voice(buf, sr, { ...o, freq: 430, start: 0.14, dur: 0.2, tau: 0.15, pitch: (t) => 1.04 - 0.08 * Math.min(1, t / 0.2) });
    yield* reverb(buf, sr, { mix: 0.08, decay: 0.25 });
  },
  *petHmm4(sr, buf) { // a nodding "hm-hm"
    const o = { freq: 440, gain: 0.6, attack: 0.02, partials: [[1, 1, 1], [2, 0.14, 0.5]], dur: 0.11, tau: 0.08 };
    yield* voice(buf, sr, { ...o, start: 0 });
    yield* voice(buf, sr, { ...o, start: 0.15, pitch: () => 0.94 });
    yield* reverb(buf, sr, { mix: 0.08, decay: 0.25 });
  },
  *petHuh2(sr, buf) { // a quick "eh?"
    yield* voice(buf, sr, { freq: 600, dur: 0.2, gain: 0.7, attack: 0.015, tau: 0.15, partials: [[1, 1, 1], [2, 0.32, 0.6], [3, 0.12, 0.4]], pitch: (t) => 0.92 + 0.3 * Math.min(1, t / 0.18) ** 2 });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.28 });
  },
  *petHuh3(sr, buf) { // a puzzled "hmm?": a low hum that rises at the end
    yield* voice(buf, sr, { freq: 400, dur: 0.4, gain: 0.65, attack: 0.03, tau: 0.32, partials: [[1, 1, 1], [2, 0.16, 0.5]], pitch: (t) => 1 + 0.4 * Math.max(0, (t - 0.18) / 0.2) ** 1.5 });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.3 });
  },
  *petHuh4(sr, buf) { // a "wha?": a dip, then up
    yield* voice(buf, sr, { freq: 540, dur: 0.3, gain: 0.7, attack: 0.02, tau: 0.24, partials: [[1, 1, 1], [2, 0.3, 0.6], [3, 0.1, 0.4]], pitch: (t) => 1 - 0.12 * Math.sin(Math.min(1, t / 0.12) * Math.PI * 0.5) + 0.42 * Math.max(0, (t - 0.12) / 0.16) ** 1.4 });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.28 });
  },
  // three curious "ooh?"s while dice fly; the pet layer picks one at random each roll
  *petOooh(sr, buf) { // a rising "ooh?", dipping first
    yield* voice(buf, sr, { freq: 540, dur: 0.42, gain: 0.7, attack: 0.04, tau: 0.34, partials: [[1, 1, 1], [2, 0.28, 0.6], [3, 0.1, 0.45]], pitch: (t) => 0.94 - 0.04 * Math.sin(Math.min(1, t / 0.12) * Math.PI) + 0.5 * Math.max(0, (t - 0.12) / 0.3) ** 2 });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.3 });
  },
  *petOooh2(sr, buf) { // a two-note "oo-ooh?": a little note, then a higher one that lifts
    const o = { gain: 0.65, attack: 0.025, partials: [[1, 1, 1], [2, 0.25, 0.6], [3, 0.08, 0.4]] };
    yield* voice(buf, sr, { ...o, freq: 470, start: 0, dur: 0.13, tau: 0.1 });
    yield* voice(buf, sr, { ...o, freq: 620, start: 0.15, dur: 0.3, tau: 0.24, pitch: (t) => 0.96 + 0.28 * Math.min(1, t / 0.28) ** 1.6 });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.3 });
  },
  *petOooh3(sr, buf) { // a quick bright "hoo?" chirp
    yield* voice(buf, sr, { freq: 600, dur: 0.3, gain: 0.7, attack: 0.02, tau: 0.22, partials: [[1, 1, 1], [2, 0.35, 0.55], [3, 0.12, 0.4]], vib: 0.015, vibRate: 9, vibDelay: 0.05, pitch: (t) => 0.88 + 0.45 * Math.min(1, t / 0.27) ** 1.3 });
    yield* reverb(buf, sr, { mix: 0.1, decay: 0.28 });
  },
  *petWoo(sr, buf) {
    // Spirit: an airy, ghostly "wooo" rising and falling.
    yield* voice(buf, sr, { freq: 600, dur: 0.6, gain: 0.55, attack: 0.08, tau: 0.5, partials: [[1, 1, 1], [3, 0.1, 0.5]], vib: 0.025, vibRate: 4, vibDelay: 0.1, pitch: (t) => 0.9 + 0.3 * Math.sin(Math.min(1, t / 0.6) * Math.PI) });
    yield* reverb(buf, sr, { mix: 0.35, decay: 0.8 });
  },
};

const RESULT_DUR = {
  chime: 1.5,
  fanfare: 1.5,
  sparkle: 1.3,
  fizzle: 1.2,
  thud: 0.7,
  whoosh: 1.0,
  crackle: 1.1,
  zap: 0.5,
  boom: 1.5,
  frost: 0.95,
  hiss: 0.95,
  ring: 1.1,
  hum: 0.9,
  shimmer: 1.1,
  rift: 1.05,
  bubble: 0.9,
  warble: 1.0,
  ethereal: 1.1,
  squelch: 0.65,
  knock: 0.45,
  petHappy: 0.45,
  petSad: 0.6,
  petHappy2: 0.48,
  petHappy3: 0.46,
  petHappy4: 0.52,
  petSad2: 0.65,
  petSad3: 0.7,
  petSad4: 0.58,
  petSplat: 0.35,
  petPurr: 0.7,
  petHuff: 0.42,
  petYelp: 0.3,
  petShiver: 0.6,
  petCough: 0.36,
  petCoo: 0.7,
  petDizzy: 0.7,
  petZap: 0.34,
  petFizz: 0.5,
  petRing: 0.7,
  petOof: 0.3,
  petOw: 0.42,
  petWhoa: 0.46,
  petYip: 0.14,
  petBonk: 0.38,
  petBleh: 0.42,
  petSpooked: 0.8,
  petWoo: 0.85,
  petOooh: 0.5,
  petOooh2: 0.52,
  petOooh3: 0.38,
  petHmm: 0.5,
  petHuh: 0.42,
  petHmm2: 0.34,
  petHmm3: 0.44,
  petHmm4: 0.36,
  petHuh2: 0.3,
  petHuh3: 0.5,
  petHuh4: 0.4,
};

/** Target peak per result sound (default 0.85): the little pet sits well below the fanfare. */
const PET_PEAK = 0.55;
const RESULT_PEAK = {
  ...Object.fromEntries(RESULT_SOUNDS.filter((n) => n.startsWith('pet')).map((n) => [n, PET_PEAK])),
  // the damage landings, levelled to about the zap's loudness (the dense ones peak lower)
  rift: 0.4,
  hum: 0.48,
  warble: 0.52,
  ethereal: 0.53,
  bubble: 0.62,
  knock: 0.7,
  hiss: 0.72,
  shimmer: 0.75,
};

function* resultGen(name, sampleRate) {
  const fn = RESULT[name];
  if (!fn) throw new RangeError(`Unknown result sound: ${name}`);
  const buf = new Float32Array(Math.floor(RESULT_DUR[name] * sampleRate));
  yield* fn(sampleRate, buf, mulberry32(hash(`result:${name}`)));
  return fadeOut(normalize(buf, RESULT_PEAK[name] ?? 0.85), sampleRate, 10);
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

/** A two-pole band-pass (RBJ, 0 dB peak) over `x` at `f` Hz, Q `q`: a new array. */
function bandpass(x, sr, f, q) {
  const w = (TAU * Math.min(f, 0.45 * sr)) / sr;
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  const b0 = al / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - al) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * Pet sound `name` in `kind`'s voice (pet-timbre.js): its notes from the kind's source, then the
 * kind's vowel resonances, grit and echo; normalised like the shared sound. An unknown kind, or a
 * sound that is not a pet's, renders as the shared sound.
 */
export function renderPetSound(name, kind, sampleRate) {
  const T = PET_TIMBRES[kind];
  if (!T || !PET_SOUNDS.includes(name)) return renderResult(name, sampleRate);
  timbre = T;
  noise = hash(`${kind}:${name}`) | 1;
  let buf;
  try {
    const fn = RESULT[name];
    buf = new Float32Array(Math.floor((RESULT_DUR[name] + (T.echo ? 0.25 : 0)) * sampleRate));
    finish(fn(sampleRate, buf, mulberry32(hash(`result:${name}`))));
  } finally {
    timbre = null;
  }
  if (T.formants) {
    const out = buf.map((v) => v * (T.dry ?? 0.5));
    for (const [f, q, g] of T.formants) {
      const y = bandpass(buf, sampleRate, f, q);
      for (let i = 0; i < out.length; i++) out[i] += g * y[i];
    }
    buf = out;
  }
  if (T.grit) {
    normalize(buf, 1);
    for (let i = 0; i < buf.length; i++) buf[i] = soft(buf[i], T.grit);
  }
  if (T.echo) {
    const [time, fb] = T.echo;
    const d = Math.floor(time * sampleRate);
    for (let i = d; i < buf.length; i++) buf[i] += fb * buf[i - d];
  }
  return fadeOut(normalize(buf, RESULT_PEAK[name] ?? 0.85), sampleRate, 10);
}

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

/**
 * Seeded randomness for throws. A throw seed is either a 128-bit seed (four uint32 words, what
 * every live throw uses: see randomSeed) or a legacy 32-bit integer (fixtures, tests, benches).
 * seededRandom picks the generator: xoshiro128** for a 128-bit seed, mulberry32 for an integer, so
 * every integer-seeded fixture keeps its exact trajectory.
 */

const WORDS = 4;

/** A 128-bit seed: an array of four words (the worker reads each as uint32). */
export const isSeed128 = (seed) => Array.isArray(seed) && seed.length === WORDS;

const isWord = (w) => Number.isInteger(w) && w >= 0 && w <= 0xffffffff;

/**
 * A caller's seed in its plain form: four uint32 words (a copy), or an integer as uint32; anything
 * else (a malformed word included) undefined.
 */
export function normalizeSeed(seed) {
  if (isSeed128(seed)) return seed.every(isWord) ? [...seed] : undefined;
  return Number.isInteger(seed) ? seed >>> 0 : undefined;
}

/** A 128-bit seed of four words drawn from `rng` (a () => [0, 1) source). */
export const seedFrom = (rng) => Array.from({ length: WORDS }, () => (rng() * 2 ** 32) >>> 0);

/**
 * A fresh 128-bit seed from the platform's secure random source (crypto.getRandomValues), else
 * (no Web Crypto) from Math.random.
 */
export const randomSeed = (cryptoRef = globalThis.crypto) =>
  cryptoRef?.getRandomValues
    ? [...cryptoRef.getRandomValues(new Uint32Array(WORDS))]
    : seedFrom(Math.random);

/**
 * Another stream's seed from the same throw seed: `seed ^ salt`, word-wise for a 128-bit seed. The
 * default salt is the nudges' (an integer's is the legacy nudge stream).
 */
export const deriveSeed = (seed, salt = 0x9e3779b9) =>
  isSeed128(seed) ? seed.map((w) => (w ^ salt) >>> 0) : (seed ^ salt) >>> 0;

/**
 * The generator for a throw seed, a () => [0, 1) function: xoshiro128** for a 128-bit seed,
 * mulberry32 for an integer.
 */
export function seededRandom(seed) {
  return isSeed128(seed) ? xoshiro128ss(seed) : mulberry32(seed);
}

/**
 * The edge a seeded throw spawns from: 0 = +x, 1 = -x, 2 = +z, 3 = -z; the worker's sim takes it
 * for its spawn side. A 128-bit seed: the top two bits of its first word (so the world-start
 * bundle needs no xoshiro); an integer: the first draw of its mulberry32 stream (legacy).
 */
export function throwEdge(seed) {
  return isSeed128(seed) ? seed[0] >>> 30 : Math.floor(mulberry32(seed)() * 4);
}

/** Deterministic 32-bit PRNG. Returns a function yielding floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Outputs xoshiro128ss drops before its first draw. */
const WARMUP = 16;

const rotl = (x, k) => (x << k) | (x >>> (32 - k));

/**
 * xoshiro128** (Blackman and Vigna, 2018) on a raw state of four uint32 words (not all zero):
 * period 2^128 - 1. Returns a function yielding the next uint32 output.
 */
export function xoshiro128ssRaw([a, b, c, d]) {
  let s0 = a | 0;
  let s1 = b | 0;
  let s2 = c | 0;
  let s3 = d | 0;
  return () => {
    const out = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return out;
  };
}

/**
 * xoshiro128** for a 128-bit seed, floats in [0, 1). The seed words are the state (the all-zero
 * one, which the generator cannot leave, becomes a fixed non-zero state). An output reads only one
 * state word, so the first WARMUP outputs are dropped: by then every seed word has reached every
 * state word, and seeds that differ in one word only (say [k, 0, 0, 0]) diverge from the first draw.
 * The step is a bijection, so distinct seeds keep distinct streams.
 */
export function xoshiro128ss(seed) {
  const next = xoshiro128ssRaw(seed.some((w) => w | 0) ? seed : [0x9e3779b9, 0, 0, 0]);
  for (let i = 0; i < WARMUP; i++) next();
  return () => next() / 4294967296;
}

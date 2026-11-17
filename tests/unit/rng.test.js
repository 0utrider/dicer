import { expect, test } from 'vitest';
import {
  deriveSeed,
  isSeed128,
  mulberry32,
  normalizeSeed,
  randomSeed,
  seedFrom,
  seededRandom,
  throwEdge,
  xoshiro128ss,
  xoshiro128ssRaw,
} from '../../src/core/rng.js';

test('xoshiro128** matches the reference implementation (state 1, 2, 3, 4)', () => {
  const next = xoshiro128ssRaw([1, 2, 3, 4]);
  expect(Array.from({ length: 6 }, next)).toEqual([
    11520, 0, 5927040, 70819200, 2031721883, 1637235492,
  ]);
});

test('a 128-bit seed uses xoshiro128**, an integer keeps mulberry32 (fixtures unchanged)', () => {
  const a = seededRandom(7);
  const b = mulberry32(7);
  for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  const c = seededRandom([7, 0, 0, 0]);
  const d = xoshiro128ss([7, 0, 0, 0]);
  for (let i = 0; i < 5; i++) expect(c()).toBe(d());
  expect(seededRandom([7, 0, 0, 0])()).not.toBe(mulberry32(7)());
});

test('the same 128-bit seed gives the same stream; one bit apart, a different one', () => {
  const take = (seed) => Array.from({ length: 8 }, seededRandom(seed));
  expect(take([1, 2, 3, 4])).toEqual(take([1, 2, 3, 4]));
  for (let w = 0; w < 4; w++) {
    const flipped = [1, 2, 3, 4];
    flipped[w] ^= 1 << 31;
    expect(take(flipped)).not.toEqual(take([1, 2, 3, 4]));
  }
});

test('floats stay in [0, 1), the all-zero seed included', () => {
  for (const seed of [
    [0, 0, 0, 0],
    [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
    [1, 0, 0, 0],
  ]) {
    const r = seededRandom(seed);
    const xs = Array.from({ length: 1000 }, r);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBeGreaterThan(990);
  }
});

test('low-entropy seeds start well mixed (first draws spread over [0, 1))', () => {
  // Raw xoshiro from [k, 0, 0, 0] gives 0 or tiny first outputs; the mixed seeding must not.
  const firsts = Array.from({ length: 4000 }, (_, k) => seededRandom([k, 0, 0, 0])());
  const bins = Array(10).fill(0);
  for (const x of firsts) bins[Math.floor(x * 10)]++;
  for (const b of bins) expect(b).toBeGreaterThan(320);
});

test('throwEdge: first mulberry32 draw of an integer seed, top two bits of a 128-bit one', () => {
  expect(throwEdge(123)).toBe(Math.floor(mulberry32(123)() * 4));
  expect(
    [0, 0x40000000, 0x80000000, 0xc0000000, 0xffffffff].map((w) => throwEdge([w, 1, 2, 3])),
  ).toEqual([0, 1, 2, 3, 3]);
});

test('deriveSeed: legacy xor for an integer, salted words for a 128-bit seed', () => {
  expect(deriveSeed(5)).toBe((5 ^ 0x9e3779b9) >>> 0);
  const d = deriveSeed([1, 2, 3, 4]);
  expect(d).toEqual([1, 2, 3, 4].map((w) => (w ^ 0x9e3779b9) >>> 0));
  expect(d).not.toEqual([1, 2, 3, 4]);
  expect(seededRandom(d)()).not.toBe(seededRandom([1, 2, 3, 4])());
});

test('randomSeed takes four words from crypto (Math.random without it); seedFrom from rng', () => {
  const crypto = { getRandomValues: (a) => (a.set([1, 2, 3, 0xffffffff]), a) };
  expect(randomSeed(crypto)).toEqual([1, 2, 3, 0xffffffff]);
  expect(isSeed128(randomSeed(null))).toBe(true);
  expect(isSeed128(randomSeed())).toBe(true);
  expect(seedFrom(() => 0.5)).toEqual([2 ** 31, 2 ** 31, 2 ** 31, 2 ** 31]);
});

test('seed validation and normalisation', () => {
  expect(isSeed128([1, 2, 3, 4])).toBe(true);
  expect(isSeed128(42)).toBe(false);
  expect(normalizeSeed([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  expect(normalizeSeed(-1)).toBe(0xffffffff);
  for (const bad of [
    [1, 2, 3],
    [1, 2, 3, -1],
    [1, 2, 3, 2 ** 32],
    [1, 2, 3, 0.5],
    '1',
    null,
    1.5,
  ]) {
    expect(normalizeSeed(bad)).toBeUndefined();
  }
  const seed = [1, 2, 3, 4];
  expect(normalizeSeed(seed)).not.toBe(seed);
});

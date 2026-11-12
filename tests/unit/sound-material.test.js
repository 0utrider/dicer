import { describe, it, expect } from 'vitest';
import { soundMaterialOf } from '../../src/audio/sound-material.js';

const look = (type) => ({ body: { type } });

describe('soundMaterialOf', () => {
  it.each([
    ['metal', 'metal'],
    ['marble', 'stone'],
    ['resin', 'glass'],
    ['opaque', 'plastic'],
    ['pearl', 'plastic'],
    ['wood', 'wood'],
    ['gem', 'stone'],
    ['iridescent', 'glass'],
    ['mystery', 'plastic'],
  ])('body %s -> %s', (type, want) => {
    expect(soundMaterialOf(look(type))).toBe(want);
  });

  it.each([
    ['metal', 'metal'],
    ['chrome', 'metal'],
    ['wood', 'wood'],
    ['glass', 'glass'],
    ['pristine', 'glass'],
    ['iridescent', 'glass'],
    ['stone', 'stone'],
    ['plastic', 'plastic'],
    ['unheard-of', 'plastic'],
  ])('preset hint %s wins -> %s', (hint, want) => {
    expect(soundMaterialOf(look('resin'), { material: hint })).toBe(want);
  });

  it('reads a material carried on the appearance', () => {
    expect(soundMaterialOf({ body: { type: 'opaque' }, material: 'wood' })).toBe('wood');
  });

  it('survives junk', () => {
    expect(soundMaterialOf(undefined)).toBe('plastic');
    expect(soundMaterialOf(null, null)).toBe('plastic');
  });
});

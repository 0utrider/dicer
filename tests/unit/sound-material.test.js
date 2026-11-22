import { describe, it, expect } from 'vitest';
import { soundMaterialOf } from '../../src/audio/sound-material.js';

const look = (type) => ({ body: { type } });

describe('soundMaterialOf', () => {
  it.each([
    ['metal', 'metal'],
    ['marble', 'stone'],
    ['resin', 'plastic'],
    ['opaque', 'plastic'],
    ['pearl', 'glass'],
    ['wood', 'wood'],
    ['gem', 'stone'],
    ['iridescent', 'metal'],
    ['stone', 'stone'],
    ['bone', 'wood'],
    ['jelly', 'squishy'],
    ['mystery', 'plastic'],
  ])('body %s -> %s', (type, want) => {
    expect(soundMaterialOf(look(type))).toBe(want);
  });

  it.each([
    ['iridescent', 'dichroic', 'glass'],
    ['iridescent', 'chameleon', 'metal'],
    ['iridescent', 'opal', 'metal'],
    ['bone', 'fossil', 'stone'],
    ['bone', 'ivory', 'wood'],
    ['gem', 'obsidian', 'stone'],
  ])('body %s, style %s -> %s', (type, preset, want) => {
    expect(soundMaterialOf({ body: { type, preset } })).toBe(want);
  });

  it('a DSN material hint still wins over the body style', () => {
    expect(soundMaterialOf({ body: { type: 'iridescent', preset: 'dichroic' } }, { material: 'wood' })).toBe('wood');
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

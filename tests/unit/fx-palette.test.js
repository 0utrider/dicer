import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import { palette } from '../../src/effects/library/palette.js';

describe('fx palette', () => {
  test('normal colour has a lighter core and darker edge, no rim', () => {
    const p = palette('#e02020');
    expect(p.core.getHSL({}).l).toBeGreaterThan(p.mid.getHSL({}).l);
    expect(p.edge.getHSL({}).l).toBeLessThan(p.mid.getHSL({}).l);
    expect(p.rim).toBeNull();
  });

  test('near-white gets a warm mid and cool edge', () => {
    const p = palette('#f4f4f4');
    expect(p.core.getHexString()).toBe('ffffff');
    expect(p.mid.getHexString()).toBe('fff1d6');
    expect(p.edge.getHexString()).toBe('a9c4ff');
    expect(p.rim).toBeNull();
  });

  test('near-black gets a visible rim of its own hue', () => {
    const p = palette('#141418');
    expect(p.rim.getHexString()).toBe('9aa3b5');
    const q = palette('#200808');
    expect(q.rim.getHSL({}).l).toBeCloseTo(0.6, 2);
    expect(q.core.getHexString()).toBe('200808');
  });

  test('accepts a THREE.Color and does not mutate it', () => {
    const c = new THREE.Color('#2060e0');
    const before = c.getHex();
    palette(c);
    expect(c.getHex()).toBe(before);
  });
});

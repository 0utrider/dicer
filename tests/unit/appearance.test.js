import { describe, expect, test } from 'vitest';
import { DEFAULT_APPEARANCE, appearanceKey, normalizeAppearance, programKey } from '../../src/look/appearance.js';

test('default is resin with an interior', () => {
  expect(DEFAULT_APPEARANCE.body.type).toBe('resin');
  expect(DEFAULT_APPEARANCE.interior.type).not.toBe('none');
  expect(Object.isFrozen(DEFAULT_APPEARANCE.body)).toBe(true);
  expect(Object.isFrozen(DEFAULT_APPEARANCE.interior.colors)).toBe(true);
});
test.each([undefined, null, 42, 'x', [], { body: 'nope' }, { body: { type: 'lava', color: 'red' } }])(
  'normalize never throws and returns a full appearance for %j',
  (input) => {
    const a = normalizeAppearance(input);
    expect(a.body.type).toMatch(/^(opaque|resin|metal|marble|pearl)$/);
    expect(a.body.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(a.numbers.fill).toMatch(/^(paint|gold|silver|enamel)$/);
  },
);
test('field-level fallback keeps valid fields', () => {
  const a = normalizeAppearance({ body: { type: 'metal', color: '#ABC', roughness: 7 }, numbers: { fill: 'silver' } });
  expect(a.body).toMatchObject({ type: 'metal', color: '#aabbcc', roughness: DEFAULT_APPEARANCE.body.roughness });
  expect(a.numbers.fill).toBe('silver');
});
test('non-resin bodies have no interior', () => {
  expect(normalizeAppearance({ body: { type: 'metal' }, interior: { type: 'nebula' } }).interior.type).toBe('none');
});
test('legacy Plan 1 flat appearance maps over', () => {
  const a = normalizeAppearance({ body: 'opaque', bodyColor: '#b3202a', fillColor: '#f2f2f2', fillMetallic: false, engraveDepth: 0.4 });
  expect(a.body).toMatchObject({ type: 'opaque', color: '#b3202a' });
  expect(a.numbers).toMatchObject({ fill: 'paint', color: '#f2f2f2', depth: 0.4 });
  const m = normalizeAppearance({ body: 'metal', fillMetallic: true });
  expect(m.numbers.fill).toBe('gold');
});
test('interior colours and unknown keys are sanitised', () => {
  const a = normalizeAppearance({ interior: { colors: ['#fff', 'bad'], density: -1 }, extra: 1 });
  expect(a.interior.colors).toEqual(['#ffffff', DEFAULT_APPEARANCE.interior.colors[1]]);
  expect(a.interior.density).toBe(DEFAULT_APPEARANCE.interior.density);
  expect(a.extra).toBeUndefined();
});
test('appearanceKey is order-independent and colour-sensitive', () => {
  const a = normalizeAppearance({ body: { type: 'opaque', color: '#111111' } });
  const b = JSON.parse(JSON.stringify(a));
  const reordered = { glow: b.glow, edges: b.edges, numbers: b.numbers, interior: b.interior, body: b.body };
  expect(appearanceKey(reordered)).toBe(appearanceKey(a));
  expect(appearanceKey(normalizeAppearance({ body: { type: 'opaque', color: '#222222' } }))).not.toBe(appearanceKey(a));
});
describe('programKey', () => {
  const flags = { interiors: true, engraving: true, glow: true, interiorSteps: 32 };
  const resin = (extra = {}) =>
    normalizeAppearance({ body: { type: 'resin', color: '#111111', roughness: 0.1 }, interior: { type: 'glitter', density: 0.2 }, ...extra });

  test('ignores colours and numbers, honours flags', () => {
    const a = resin();
    const b = normalizeAppearance({ body: { type: 'resin', color: '#999999', roughness: 0.3 }, interior: { type: 'glitter', density: 0.9 } });
    expect(programKey(a, flags)).toBe(programKey(b, flags));
    expect(programKey(a, { ...flags, interiors: false })).not.toBe(programKey(a, flags));
    expect(programKey(a, { ...flags, interiorSteps: 16 })).not.toBe(programKey(a, flags));
  });
  test('P2-R1: interior part is none unless the interior is active', () => {
    const key = (a, f) => programKey(a, f);
    // interiors flag off or steps 0: steps and type do not matter
    expect(key(resin(), { ...flags, interiors: false, interiorSteps: 32 })).toBe(
      key(resin(), { ...flags, interiors: false, interiorSteps: 8 }),
    );
    expect(key(resin(), { ...flags, interiorSteps: 0 })).toBe(key(resin(), { ...flags, interiors: false }));
    // interior.type none: steps do not matter
    const noInt = resin({ interior: { type: 'none' } });
    expect(key(noInt, flags)).toBe(key(noInt, { ...flags, interiorSteps: 8 }));
    expect(key(noInt, flags)).toBe(key(resin(), { ...flags, interiors: false }));
    // non-resin body: interior type/steps do not matter
    const metal = normalizeAppearance({ body: { type: 'metal' } });
    expect(key(metal, flags)).toBe(key(metal, { ...flags, interiorSteps: 8 }));
    // active interior: type, shape and steps matter
    expect(key(resin(), flags)).not.toBe(key(resin({ interior: { type: 'nebula' } }), flags));
    const star = resin({ interior: { type: 'shape', shape: 'star' } });
    const heart = resin({ interior: { type: 'shape', shape: 'heart' } });
    expect(key(star, flags)).not.toBe(key(heart, flags));
    // shape is irrelevant for non-shape types
    expect(key(resin({ interior: { type: 'glitter', shape: 'star' } }), flags)).toBe(
      key(resin({ interior: { type: 'glitter', shape: 'skull' } }), flags),
    );
  });
  test('P2-R2: glow part is flags.glow && intensity > 0', () => {
    const off = resin({ glow: { intensity: 0 } });
    const on1 = resin({ glow: { intensity: 0.5 } });
    const on2 = resin({ glow: { intensity: 1.7, color: '#ff0000' } });
    expect(programKey(on1, flags)).toBe(programKey(on2, flags));
    expect(programKey(off, flags)).not.toBe(programKey(on1, flags));
    expect(programKey(on1, { ...flags, glow: false })).toBe(programKey(off, flags));
    expect(programKey(off, { ...flags, glow: false })).toBe(programKey(off, flags));
  });
  test('engraving, metal finish and edges matter', () => {
    const a = resin();
    expect(programKey(a, { ...flags, engraving: false })).not.toBe(programKey(a, flags));
    expect(programKey(resin({ edges: { style: 'sharp' } }), flags)).not.toBe(programKey(a, flags));
    const m1 = normalizeAppearance({ body: { type: 'metal', finish: 'brushed' } });
    const m2 = normalizeAppearance({ body: { type: 'metal', finish: 'antique' } });
    expect(programKey(m1, flags)).not.toBe(programKey(m2, flags));
    // finish only matters for metal
    const r1 = resin({ body: { type: 'resin', finish: 'brushed' } });
    expect(programKey(r1, flags)).toBe(programKey(a, flags));
  });
});

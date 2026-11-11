import {
  PRESETS,
  MIN_AREA_PX,
  normalizeAreaDef,
  resolveArea,
  toDieArea,
  fitDieCapacity,
  CAPACITY_PER_DIE,
  ONE_DIE_HALF,
} from '../../src/areas/area-model.js';

const U = { left: 0, top: 0, width: 1920, height: 1080 };

function inside(r, u) {
  return (
    r.left >= u.left - 1e-6 &&
    r.top >= u.top - 1e-6 &&
    r.left + r.width <= u.left + u.width + 1e-6 &&
    r.top + r.height <= u.top + u.height + 1e-6
  );
}

describe('presets', () => {
  test('constants', () => {
    expect(MIN_AREA_PX).toEqual({ width: 240, height: 180 });
    expect(Object.isFrozen(PRESETS)).toBe(true);
    expect(PRESETS.centre).toEqual({ x: 0.2, y: 0.15, w: 0.6, h: 0.7 });
  });

  test.each([
    ['full', { left: 0, top: 0, width: 1920, height: 1080 }],
    ['centre', { left: 384, top: 162, width: 1152, height: 756 }],
    ['bottom', { left: 0, top: 669.6, width: 1920, height: 410.4 }],
    ['corner', { left: 1190.4, top: 594, width: 729.6, height: 486 }],
  ])('%s on 1920x1080', (preset, want) => {
    const r = resolveArea({ preset }, U);
    for (const k of Object.keys(want)) expect(r[k]).toBeCloseTo(want[k], 6);
  });

  test('offset usable region is respected', () => {
    const r = resolveArea({ preset: 'full' }, { left: 10, top: 20, width: 500, height: 400 });
    expect(r).toEqual({ left: 10, top: 20, width: 500, height: 400 });
  });
});

describe('normalizeAreaDef', () => {
  test.each([null, undefined, 5, 'x', [], {}, { preset: 'bogus' }])('garbage %j -> full', (raw) => {
    expect(normalizeAreaDef(raw)).toEqual({ preset: 'full' });
  });

  test('known presets pass through without fractions', () => {
    expect(normalizeAreaDef({ preset: 'corner', x: 0.1 })).toEqual({ preset: 'corner' });
  });

  test('custom dragged off the corner is clamped inside', () => {
    const d = normalizeAreaDef({ preset: 'custom', x: 0.95, y: 0.95, w: 0.3, h: 0.3 });
    expect(d.preset).toBe('custom');
    expect(d.w).toBeCloseTo(0.3);
    expect(d.x + d.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(d.y + d.h).toBeLessThanOrEqual(1 + 1e-9);
    expect(d.x).toBeGreaterThanOrEqual(0);
  });

  test('custom with tiny, negative or non-numeric values', () => {
    const d = normalizeAreaDef({ preset: 'custom', x: -2, y: 'a', w: 0, h: -1 });
    expect(d.x).toBe(0);
    expect(d.y).toBe(0);
    expect(d.w).toBeCloseTo(0.05);
    expect(d.h).toBeCloseTo(0.05);
    expect(normalizeAreaDef({ preset: 'custom' })).toEqual({ preset: 'full' });
  });

  test('custom w/h above 1 clamp to 1', () => {
    const d = normalizeAreaDef({ preset: 'custom', x: 0.5, y: 0.5, w: 9, h: 9 });
    expect(d.w).toBe(1);
    expect(d.x).toBe(0);
    expect(d.h).toBe(1);
    expect(d.y).toBe(0);
  });
});

describe('resolveArea safety', () => {
  test('a custom area from a 4K region is on screen and >= minimum on 800x600', () => {
    const def = normalizeAreaDef({ preset: 'custom', x: 0.9, y: 0.9, w: 0.05, h: 0.05 });
    const small = { left: 0, top: 0, width: 800, height: 600 };
    const r = resolveArea(def, small);
    expect(r.width).toBeGreaterThanOrEqual(240);
    expect(r.height).toBeGreaterThanOrEqual(180);
    expect(inside(r, small)).toBe(true);
  });

  test('scale 1.5 on full stays inside', () => {
    const r = resolveArea({ preset: 'full' }, U, { scale: 1.5 });
    expect(r).toEqual(U);
  });

  test('scale 1.5 on a corner area stays inside', () => {
    expect(inside(resolveArea({ preset: 'corner' }, U, { scale: 1.5 }), U)).toBe(true);
  });

  test('scale 0.1 clamps to 0.5', () => {
    const r = resolveArea({ preset: 'full' }, U, { scale: 0.1 });
    expect(r.width).toBeCloseTo(960);
    expect(r.height).toBeCloseTo(540);
    expect(r.left).toBeCloseTo(480);
  });

  test('non-finite scale is 1', () => {
    expect(resolveArea({ preset: 'full' }, U, { scale: NaN })).toEqual(U);
  });

  test('a region smaller than the minimum yields the whole region', () => {
    const tiny = { left: 5, top: 7, width: 200, height: 100 };
    expect(resolveArea({ preset: 'corner' }, tiny)).toEqual(tiny);
  });

  test('growth to minimum is capped per axis', () => {
    const u = { left: 0, top: 0, width: 200, height: 600 };
    const r = resolveArea({ preset: 'corner' }, u);
    expect(r.width).toBe(200);
    expect(r.height).toBeGreaterThanOrEqual(180);
    expect(inside(r, u)).toBe(true);
  });

  test('garbage def resolves like full', () => {
    expect(resolveArea('nope', U)).toEqual(U);
  });
});

describe('toDieArea', () => {
  const stage = { left: 0, top: 0, width: 1600, height: 900 };

  test('full stage', () => {
    expect(toDieArea(stage, stage, 48)).toEqual({
      cx: 0,
      cz: 0,
      halfWidth: 1600 / 2 / 48,
      halfDepth: 900 / 2 / 48,
    });
  });

  test('bottom-right corner is +x, +z', () => {
    const a = toDieArea({ left: 1000, top: 500, width: 600, height: 400 }, stage, 48);
    expect(a.cx).toBeCloseTo((1300 - 800) / 48);
    expect(a.cz).toBeCloseTo((700 - 450) / 48);
    expect(a.cx).toBeGreaterThan(0);
    expect(a.cz).toBeGreaterThan(0);
    expect(a.halfWidth).toBeCloseTo(300 / 48);
    expect(a.halfDepth).toBeCloseTo(200 / 48);
  });

  test('offset stage', () => {
    const s = { left: 100, top: 50, width: 400, height: 300 };
    const a = toDieArea({ left: 100, top: 50, width: 200, height: 150 }, s, 10);
    expect(a.cx).toBeCloseTo(-10);
    expect(a.cz).toBeCloseTo(-7.5);
  });
});

describe('fitDieCapacity (P5-R6)', () => {
  const stage = { halfWidth: 12, halfDepth: 7 };

  test('a large enough area is returned unchanged', () => {
    const a = { cx: 3, cz: -1, halfWidth: 6, halfDepth: 4 };
    expect(fitDieCapacity(a, 5, stage)).toEqual(a);
  });

  test('grows around the centre keeping the aspect until it holds n dice', () => {
    const a = fitDieCapacity({ cx: 0, cz: 0, halfWidth: 2.5, halfDepth: 1.875 }, 12, stage);
    expect(4 * a.halfWidth * a.halfDepth).toBeCloseTo(12 * CAPACITY_PER_DIE, 9);
    expect(a.halfWidth / a.halfDepth).toBeCloseTo(2.5 / 1.875, 9);
    expect(a.cx).toBe(0);
    expect(a.cz).toBe(0);
  });

  test('each half is at least one die, and the result stays inside the stage', () => {
    const one = fitDieCapacity({ cx: 0, cz: 0, halfWidth: 0.1, halfDepth: 0.1 }, 1, stage);
    expect(one.halfWidth).toBeGreaterThanOrEqual(ONE_DIE_HALF);
    expect(one.halfDepth).toBeGreaterThanOrEqual(ONE_DIE_HALF);
    const corner = fitDieCapacity({ cx: 11.9, cz: 6.9, halfWidth: 0.1, halfDepth: 0.1 }, 12, stage);
    expect(corner.cx + corner.halfWidth).toBeCloseTo(12, 9);
    expect(corner.cz + corner.halfDepth).toBeCloseTo(7, 9);
    const wide = fitDieCapacity({ cx: 0, cz: 0, halfWidth: 12, halfDepth: 0.5 }, 30, stage);
    expect(wide.halfWidth).toBe(12);
    expect(4 * wide.halfWidth * wide.halfDepth).toBeGreaterThanOrEqual(30 * CAPACITY_PER_DIE - 1e-9);
    const huge = fitDieCapacity({ cx: 0, cz: 0, halfWidth: 1, halfDepth: 1 }, 1000, stage);
    expect(huge).toEqual({ cx: 0, cz: 0, halfWidth: 12, halfDepth: 7 });
  });
});

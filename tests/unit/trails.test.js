import { describe, test, expect, vi } from 'vitest';
import { ELEMENTS, elementOf, createTrailFx, TRAIL_RECIPES } from '../../src/effects/library/trails.js';
import { KIND } from '../../src/effects/library/particles.js';

/** A pool that records a copy of every emit (the trail fx reuses its spec objects). */
function fakePool() {
  const emits = [];
  return {
    emits,
    emit: (spec) => emits.push({ ...spec, origin: { ...spec.origin } }),
  };
}

function setup({ tier = { effectBudget: 8, particleScale: 1 }, reduced = false, settings = {}, pool = fakePool() } = {}) {
  const warnOnce = vi.fn();
  const fx = createTrailFx({
    getPool: () => pool,
    getTier: () => tier,
    now: () => 0,
    reducedMotion: () => reduced,
    setting: (key) => settings[key],
    warnOnce,
  });
  return { fx, pool, warnOnce };
}

const die = (interior = 'fire', extra = {}) => ({
  trail: 2,
  appearance: { interior: { type: interior } },
  outer: { position: { x: 0, y: 1, z: 0 }, visible: true },
  ...extra,
});

/** Moves the dice `step` along x per 16 ms frame, `frames` times, starting at `t0`. */
function fly(fx, dice, { frames = 10, step = 0.4, t0 = 0 } = {}) {
  let t = t0;
  for (let i = 0; i < frames; i++) {
    t += 16;
    for (const d of dice) d.outer.position.x += step;
    fx.flight(dice, t);
  }
  return t;
}

describe('elementOf', () => {
  test('the eight elements, in order', () => {
    expect(ELEMENTS).toEqual(['fire', 'lava', 'frost', 'storm', 'acid', 'void', 'vitality', 'poison']);
  });

  test('an elemental inside first, then the damage type', () => {
    expect(elementOf({ interior: { type: 'lava' } })).toBe('lava');
    expect(elementOf({ interior: { type: 'frost' } }, 'fire')).toBe('frost');
    expect(elementOf({ interior: { type: 'glitter' } }, 'acid')).toBe('acid');
    expect(elementOf(undefined, 'fire')).toBe('fire');
    expect(elementOf({}, 'cold')).toBe('frost');
    expect(elementOf({}, 'electricity')).toBe('storm');
    expect(elementOf({}, 'lightning')).toBe('storm');
    expect(elementOf({}, 'necrotic')).toBe('void');
    expect(elementOf({}, 'void')).toBe('void');
    expect(elementOf({}, 'healing')).toBe('vitality');
    expect(elementOf({}, 'radiant')).toBe('vitality');
    expect(elementOf({}, 'poison')).toBe('poison');
  });

  test('no element: sonic, an unknown or inherited key, nothing at all', () => {
    expect(elementOf({}, 'sonic')).toBeNull();
    expect(elementOf({}, 'constructor')).toBeNull();
    expect(elementOf({ interior: { type: 'none' } }, undefined)).toBeNull();
    expect(elementOf(undefined, undefined)).toBeNull();
  });
});

describe('createTrailFx', () => {
  test('fire and frost recipes exist', () => {
    expect(typeof TRAIL_RECIPES.fire).toBe('function');
    expect(typeof TRAIL_RECIPES.frost).toBe('function');
  });

  test('a fast fire die emits fire on every frame; standing still it emits nothing', () => {
    const { fx, pool } = setup();
    const d = die('fire');
    fx.flight([d], 0); // first sight: no velocity yet
    let t = 0;
    for (let i = 0; i < 8; i++) {
      const before = pool.emits.length;
      t += 16;
      d.outer.position.x += 0.4; // 25 units/s
      fx.flight([d], t);
      expect(pool.emits.length).toBeGreaterThan(before);
    }
    expect(pool.emits.some((e) => e.kind === KIND.EMBER)).toBe(true);
    const moving = pool.emits.length;
    for (let i = 0; i < 8; i++) fx.flight([d], (t += 16));
    expect(pool.emits.length).toBe(moving);
  });

  test('a frost die emits mist (normal blend) and glints', () => {
    const { fx, pool } = setup();
    const d = die('frost');
    fx.flight([d], 0);
    fly(fx, [d], { frames: 30 });
    expect(pool.emits.some((e) => e.blend === 'normal' && e.kind === KIND.SMOKE)).toBe(true);
    expect(pool.emits.some((e) => e.kind === KIND.GLINT)).toBe(true);
  });

  test('trail 0, a missing trail, or no element emits nothing', () => {
    const { fx, pool } = setup();
    const dice = [die('fire', { trail: 0 }), die('fire', { trail: undefined }), die('fire', { trail: true }), die('glitter')];
    fx.flight(dice, 0);
    fly(fx, dice);
    expect(pool.emits).toHaveLength(0);
  });

  test('trail 1 (a discarded die) still trails; a damage type alone gives the element', () => {
    const { fx, pool } = setup();
    const d = die('none', { trail: 1, damageType: 'fire' });
    fx.flight([d], 0);
    fly(fx, [d]);
    expect(pool.emits.length).toBeGreaterThan(0);
  });

  test('a hidden die (not placed yet) emits nothing', () => {
    const { fx, pool } = setup();
    const d = die('fire');
    d.outer.visible = false;
    fx.flight([d], 0);
    fly(fx, [d]);
    expect(pool.emits).toHaveLength(0);
  });

  test('effectBudget 2 turns trails off', () => {
    const { fx, pool } = setup({ tier: { effectBudget: 2, particleScale: 0.25 } });
    const d = die('fire');
    fx.flight([d], 0);
    fly(fx, [d]);
    expect(pool.emits).toHaveLength(0);
  });

  test('particleScale 0.5 emits fewer particles than 1', () => {
    const total = (particleScale) => {
      const { fx, pool } = setup({ tier: { effectBudget: 8, particleScale } });
      const d = die('fire');
      fx.flight([d], 0);
      fly(fx, [d], { frames: 120, step: 0.3 });
      return pool.emits.reduce((s, e) => s + e.count, 0);
    };
    expect(total(0.5)).toBeLessThan(total(1));
  });

  test('a faster die emits more than a sliding one', () => {
    const total = (step) => {
      const { fx, pool } = setup();
      const d = die('fire');
      fx.flight([d], 0);
      fly(fx, [d], { frames: 120, step });
      return pool.emits.reduce((s, e) => s + e.count, 0);
    };
    expect(total(0.05)).toBeLessThan(total(0.4));
  });

  test('reduced motion reaches the recipe: no flickering kinds, thinner trails', () => {
    for (const element of ['fire', 'frost']) {
      const run = (reduced) => {
        const { fx, pool } = setup({ reduced });
        const d = die(element);
        fx.flight([d], 0);
        fly(fx, [d], { frames: 120, step: 0.3 });
        return pool.emits;
      };
      const reduced = run(true);
      const full = run(false);
      expect(reduced.length).toBeGreaterThan(0);
      const flicker = [KIND.EMBER, KIND.GLINT, KIND.SPIRAL];
      expect(reduced.some((e) => flicker.includes(e.kind))).toBe(false);
      const count = (list) => list.reduce((s, e) => s + e.count, 0);
      expect(count(reduced)).toBeLessThan(count(full));
    }
  });

  test('every emit carries a numeric now', () => {
    const { fx, pool } = setup();
    const dice = [die('fire'), die('frost')];
    fx.flight(dice, 1000);
    fly(fx, dice, { t0: 1000 });
    expect(pool.emits.length).toBeGreaterThan(0);
    for (const e of pool.emits) expect(Number.isFinite(e.now)).toBe(true);
  });

  test('a long gap between frames restarts the die without a burst', () => {
    const { fx, pool } = setup();
    const d = die('fire');
    fx.flight([d], 0);
    d.outer.position.x += 30; // a teleport after a stall
    fx.flight([d], 500);
    expect(pool.emits).toHaveLength(0);
  });

  test('elementalTrails false: no emits', () => {
    const { fx, pool } = setup({ settings: { elementalTrails: false } });
    const d = die('fire');
    fx.flight([d], 0);
    fly(fx, [d]);
    expect(pool.emits).toHaveLength(0);
  });

  test('a throwing recipe is caught and warned once per call, never thrown', () => {
    const err = new Error('boom');
    const pool = {
      emit: () => {
        throw err;
      },
    };
    const { fx, warnOnce } = setup({ pool });
    const d = die('fire');
    expect(() => {
      fx.flight([d], 0);
      fly(fx, [d], { frames: 3 });
    }).not.toThrow();
    expect(warnOnce).toHaveBeenCalledWith('trail', 'trail effect failed', err);
  });

  test('no pool, odd input and clear() are safe', () => {
    const { fx } = setup({ pool: null });
    const d = die('fire');
    expect(() => {
      fx.flight([d], 0);
      fly(fx, [d]);
      fx.flight(undefined, 1);
      fx.flight([null, {}, { trail: 2 }], 2);
      fx.clear();
    }).not.toThrow();
  });

  test('clear() forgets last positions: the next frame is a first sight', () => {
    const { fx, pool } = setup();
    const d = die('fire');
    fx.flight([d], 0);
    fly(fx, [d], { frames: 2 });
    fx.clear();
    const n = pool.emits.length;
    d.outer.position.x += 0.4;
    fx.flight([d], 48);
    expect(pool.emits.length).toBe(n);
  });
});

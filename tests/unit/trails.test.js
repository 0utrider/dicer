import { describe, test, expect, vi } from 'vitest';
import { ELEMENTS, elementOf, createTrailFx, TRAIL_RECIPES } from '../../src/effects/library/trails.js';
import { KIND } from '../../src/effects/library/particles.js';
import { SHAPE } from '../../src/effects/library/shapes.js';

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
  test('the sixteen elements, in order', () => {
    expect(ELEMENTS).toEqual([
      'fire',
      'lava',
      'frost',
      'storm',
      'acid',
      'void',
      'vitality',
      'poison',
      'sonic',
      'force',
      'mental',
      'spirit',
      'bleed',
      'slashing',
      'piercing',
      'bludgeoning',
    ]);
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

  test('every damage type resolves to an element', () => {
    expect(elementOf({}, 'sonic')).toBe('sonic');
    expect(elementOf({}, 'thunder')).toBe('sonic');
    expect(elementOf({}, 'force')).toBe('force');
    expect(elementOf({}, 'mental')).toBe('mental');
    expect(elementOf({}, 'psychic')).toBe('mental');
    expect(elementOf({}, 'Psychic')).toBe('mental');
    expect(elementOf({}, 'spirit')).toBe('spirit');
    expect(elementOf({}, 'bleed')).toBe('bleed');
    expect(elementOf({}, 'slashing')).toBe('slashing');
    expect(elementOf({}, 'piercing')).toBe('piercing');
    expect(elementOf({}, 'bludgeoning')).toBe('bludgeoning');
    const types = ['fire', 'cold', 'electricity', 'acid', 'void', 'vitality', 'poison', 'sonic', 'force', 'mental'];
    for (const type of [...types, 'spirit', 'bleed', 'slashing', 'piercing', 'bludgeoning'])
      expect(ELEMENTS).toContain(elementOf({}, type));
  });

  test('no element: untyped, an unknown or inherited key, nothing at all', () => {
    expect(elementOf({}, 'untyped')).toBeNull();
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

  test('storm, lava and acid recipes exist', () => {
    for (const element of ['storm', 'lava', 'acid'])
      expect(typeof TRAIL_RECIPES[element]).toBe('function');
  });

  test('a moving storm, lava or acid die emits; at rest it stops', () => {
    for (const [interior, damageType] of [['storm'], ['lava'], ['none', 'acid']]) {
      const { fx, pool } = setup();
      const d = die(interior, { damageType });
      fx.flight([d], 0);
      const t = fly(fx, [d], { frames: 20 });
      expect(pool.emits.length).toBeGreaterThan(0);
      for (const e of pool.emits) expect(Number.isFinite(e.now)).toBe(true);
      const moving = pool.emits.length;
      for (let i = 1; i <= 8; i++) fx.flight([d], t + 16 * i);
      expect(pool.emits.length).toBe(moving);
    }
  });

  test('a storm die crackles: flickering sparks and a stretched streak', () => {
    const { fx, pool } = setup();
    const d = die('storm');
    fx.flight([d], 0);
    fly(fx, [d], { frames: 30 });
    expect(pool.emits.some((e) => e.kind === KIND.EMBER || e.kind === KIND.GLINT)).toBe(true);
    expect(pool.emits.some((e) => e.kind === KIND.STREAK)).toBe(true);
  });

  test('storm under reduced motion: constant alpha, no flicker kinds', () => {
    const { fx, pool } = setup({ reduced: true });
    const d = die('storm');
    fx.flight([d], 0);
    fly(fx, [d], { frames: 60 });
    expect(pool.emits.length).toBeGreaterThan(0);
    for (const e of pool.emits) expect([KIND.SPARK, KIND.STREAK, KIND.SMOKE]).toContain(e.kind);
  });

  test('lava drips fall (pulled down) to the pool floor; dark smoke rises', () => {
    const { fx, pool } = setup();
    const d = die('lava');
    fx.flight([d], 0);
    fly(fx, [d], { frames: 30 });
    // The pool's gravity is +y: lava's drips fall hard (-9) and rest a hair above the table.
    const drips = pool.emits.filter((e) => Number.isFinite(e.floor));
    expect(drips.length).toBeGreaterThan(0);
    for (const e of drips) {
      expect(e.gravity).toBe(-9);
      expect(e.floor).toBe(0.02);
    }
    expect(pool.emits.some((e) => e.kind === KIND.SMOKE && e.blend === 'normal')).toBe(true);
  });

  test('acid drips are green and fall to the floor', () => {
    const { fx, pool } = setup();
    const d = die('none', { damageType: 'acid' });
    fx.flight([d], 0);
    fly(fx, [d], { frames: 30 });
    const drips = pool.emits.filter((e) => e.gravity < 0 && Number.isFinite(e.floor));
    expect(drips.length).toBeGreaterThan(0);
    for (const e of drips) expect(e.color.g).toBeGreaterThan(Math.max(e.color.r, e.color.b));
  });

  test('void, vitality and poison recipes exist', () => {
    for (const element of ['void', 'vitality', 'poison'])
      expect(typeof TRAIL_RECIPES[element]).toBe('function');
  });

  test('a moving void, vitality or poison damage die emits; at rest it stops', () => {
    for (const damageType of ['necrotic', 'radiant', 'poison']) {
      const { fx, pool } = setup();
      const d = die('none', { damageType });
      fx.flight([d], 0);
      const t = fly(fx, [d], { frames: 20 });
      expect(pool.emits.length).toBeGreaterThan(0);
      for (const e of pool.emits) expect(Number.isFinite(e.now)).toBe(true);
      const moving = pool.emits.length;
      for (let i = 1; i <= 8; i++) fx.flight([d], t + 16 * i);
      expect(pool.emits.length).toBe(moving);
    }
  });

  test('void: dark normal-blend smoke, and an additive violet rim for the dark table', () => {
    const { fx, pool } = setup();
    const d = die('none', { damageType: 'void' });
    fx.flight([d], 0);
    fly(fx, [d], { frames: 30 });
    const smoke = pool.emits.filter((e) => e.kind === KIND.SMOKE && e.blend === 'normal');
    expect(smoke.length).toBeGreaterThan(0);
    for (const e of smoke) expect(e.color.r + e.color.g + e.color.b).toBeLessThan(0.6);
    const rim = pool.emits.filter((e) => e.blend !== 'normal');
    expect(rim.length).toBeGreaterThan(0);
    for (const e of rim) expect(e.color.b).toBeGreaterThan(e.color.g);
  });

  test('vitality: golden motes, additive and a normal-blend layer for the light table', () => {
    const { fx, pool } = setup();
    const d = die('none', { damageType: 'healing' });
    fx.flight([d], 0);
    fly(fx, [d], { frames: 30 });
    expect(pool.emits.some((e) => e.blend === 'normal')).toBe(true);
    expect(pool.emits.some((e) => e.blend !== 'normal')).toBe(true);
    for (const e of pool.emits) {
      expect(e.color.r).toBeGreaterThan(e.color.b);
      expect(e.color.g).toBeGreaterThan(e.color.b);
      expect(e.kind).not.toBe(KIND.SMOKE);
    }
  });

  test('poison: a green haze that drifts, never drips (unlike acid)', () => {
    const { fx, pool } = setup();
    const d = die('none', { damageType: 'poison' });
    fx.flight([d], 0);
    fly(fx, [d], { frames: 30 });
    const haze = pool.emits.filter((e) => e.kind === KIND.SMOKE);
    expect(haze.length).toBeGreaterThan(0);
    for (const e of haze) expect(e.color.g).toBeGreaterThan(Math.max(e.color.r, e.color.b));
    for (const e of pool.emits) expect(Number.isFinite(e.floor)).toBe(false);
  });

  test('sonic, force, mental and spirit recipes exist', () => {
    for (const element of ['sonic', 'force', 'mental', 'spirit'])
      expect(typeof TRAIL_RECIPES[element]).toBe('function');
  });

  test('a moving sonic, force, mental or spirit damage die emits; at rest it stops', () => {
    for (const damageType of ['thunder', 'force', 'psychic', 'spirit']) {
      const { fx, pool } = setup();
      const d = die('none', { damageType });
      fx.flight([d], 0);
      const t = fly(fx, [d], { frames: 20 });
      expect(pool.emits.length).toBeGreaterThan(0);
      for (const e of pool.emits) expect(Number.isFinite(e.now)).toBe(true);
      const moving = pool.emits.length;
      for (let i = 1; i <= 8; i++) fx.flight([d], t + 16 * i);
      expect(pool.emits.length).toBe(moving);
    }
  });

  /** Every emit of a damage die flown for `frames` frames. */
  const flown = (damageType, { reduced = false, frames = 40 } = {}) => {
    const { fx, pool } = setup({ reduced });
    const d = die('none', { damageType });
    fx.flight([d], 0);
    fly(fx, [d], { frames });
    return pool.emits;
  };

  test('sonic: expanding rings left behind on the path, additive and normal blend', () => {
    const emits = flown('sonic');
    const rings = emits.filter((e) => e.shape === SHAPE.RING);
    expect(rings.length).toBeGreaterThan(0);
    for (const e of rings) {
      expect(e.sizeEnd).toBeGreaterThan(2); // they expand
      expect(e.speed).toBeLessThan(0.5); // they stay where the die left them
    }
    expect(rings.some((e) => e.blend === 'normal')).toBe(true);
    expect(rings.some((e) => e.blend !== 'normal')).toBe(true);
  });

  test('sonic under reduced motion: no flicker kinds', () => {
    const emits = flown('sonic', { reduced: true, frames: 60 });
    expect(emits.length).toBeGreaterThan(0);
    for (const e of emits) expect([KIND.EMBER, KIND.GLINT, KIND.SPIRAL]).not.toContain(e.kind);
  });

  test('force: violet shimmering shards and a faint streak along the path', () => {
    const emits = flown('force');
    const shards = emits.filter((e) => e.shape === SHAPE.SHARD);
    expect(shards.length).toBeGreaterThan(0);
    expect(shards.some((e) => e.kind === KIND.GLINT)).toBe(true); // shimmer
    expect(emits.some((e) => e.kind === KIND.STREAK)).toBe(true);
    for (const e of emits) {
      expect(e.color.b).toBeGreaterThan(e.color.g);
      expect(e.color.r).toBeGreaterThan(e.color.g);
      expect(e.kind).not.toBe(KIND.SMOKE); // not void's smoke
    }
  });

  test('mental: pink swirls that curl (spiral), additive and normal blend', () => {
    const emits = flown('psychic');
    expect(emits.some((e) => e.kind === KIND.SPIRAL)).toBe(true);
    expect(emits.some((e) => e.blend === 'normal')).toBe(true);
    expect(emits.some((e) => e.blend !== 'normal')).toBe(true);
    for (const e of emits) {
      expect(e.color.r).toBeGreaterThan(e.color.g); // pink: red and blue over green
      expect(e.color.b).toBeGreaterThan(e.color.g);
    }
  });

  test('spirit: cyan wisps that drift up (unlike frost, which sinks)', () => {
    const emits = flown('spirit');
    expect(emits.length).toBeGreaterThan(0);
    expect(emits.some((e) => e.blend === 'normal')).toBe(true);
    expect(emits.some((e) => e.blend !== 'normal')).toBe(true);
    for (const e of emits) {
      expect(e.gravity).toBeGreaterThan(0);
      expect(e.color.g).toBeGreaterThan(e.color.r);
      expect(e.color.b).toBeGreaterThan(e.color.r);
    }
  });

  test('an element without a recipe yet (bleed, slashing, bludgeoning) emits nothing and warns nothing', () => {
    const { fx, pool, warnOnce } = setup();
    const dice = ['bleed', 'slashing', 'bludgeoning'].map((damageType) => die('none', { damageType }));
    fx.flight(dice, 0);
    fly(fx, dice);
    expect(pool.emits).toHaveLength(0);
    expect(warnOnce).not.toHaveBeenCalled();
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
    const inside = ['fire', 'frost', 'storm', 'lava'];
    for (const element of [...inside, 'acid', 'void', 'vitality', 'poison', 'sonic', 'force', 'mental', 'spirit']) {
      const run = (reduced) => {
        const { fx, pool } = setup({ reduced });
        const d = inside.includes(element) ? die(element) : die('none', { damageType: element });
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

  test('frames without a pool do not bank emission: no burst when the pool appears', () => {
    // Summed over many dice so the random dithering averages out.
    const firstFrame = (noPoolFrames) => {
      let total = 0;
      for (let n = 0; n < 60; n++) {
        const pool = fakePool();
        let live = false;
        const fx = createTrailFx({
          getPool: () => (live ? pool : null),
          getTier: () => ({ effectBudget: 8, particleScale: 1 }),
          now: () => 0,
          reducedMotion: () => false,
        });
        const d = die('fire');
        fx.flight([d], 0);
        const t = fly(fx, [d], { frames: noPoolFrames });
        live = true;
        fly(fx, [d], { frames: 1, t0: t });
        total += pool.emits.reduce((s, e) => s + e.count, 0);
      }
      return total;
    };
    expect(firstFrame(6)).toBeLessThan(1.6 * firstFrame(0));
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

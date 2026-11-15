import * as THREE from 'three';
import { createEffectLayer } from '../../src/effects/effect-layer.js';
import { TIERS } from '../../src/render/quality.js';
import { EFFECTS, createImpactFx } from '../../src/effects/library/index.js';

/** A cost-c effect that runs for `duration` ms from its first update; records its lifecycle. */
function timed(id, cost = 1, log = []) {
  return {
    id,
    cost,
    defaults: { color: '#ffffff', intensity: 1, duration: 100 },
    start(ctx) {
      log.push(['start', id, ctx.die]);
      let t0 = null;
      return {
        update(now) {
          t0 ??= now;
          return now - t0 < ctx.duration;
        },
        stop() {
          log.push(['stop', id, ctx.die]);
        },
      };
    },
  };
}

const fxOf = (...ids) => ids.map((id, i) => ({ ruleId: `r${i}`, effect: { id }, sound: null }));
const makeDie = () => ({ outer: new THREE.Group(), inner: new THREE.Mesh() });

function setup({ tier = 'low', modules, settings = {}, reduced = false, ...rest } = {}) {
  const log = [];
  const lib = modules ?? { a: timed('a', 1, log), b: timed('b', 1, log), c: timed('c', 1, log) };
  const canvas = { style: { transform: '' } };
  const warn = vi.fn();
  const layer = createEffectLayer({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    canvas,
    getTier: () => TIERS[tier],
    getSetting: (k) => settings[k],
    loadLibrary: async () => ({ EFFECTS: lib }),
    matchMedia: () => ({ matches: reduced }),
    warn,
    debug: () => {},
    ...rest,
  });
  return { layer, log, canvas, warn };
}

test('the effect layer passes ctx.reducedMotion from prefers-reduced-motion', async () => {
  for (const reduced of [false, true]) {
    const seen = [];
    const spy = { ...timed('spy'), start: (ctx) => (seen.push(ctx.reducedMotion), timed('spy').start(ctx)) };
    const { layer } = setup({ modules: { spy }, reduced });
    await layer.prefetch();
    layer.play(makeDie(), fxOf('spy'));
    expect(seen).toEqual([reduced]);
  }
});

test('budget: 30 dice with a cost-1 effect on low start at most 2 (effectBudget)', async () => {
  const { layer, log } = setup();
  await layer.prefetch();
  for (let i = 0; i < 30; i++) layer.play(makeDie(), fxOf('a'));
  expect(log.filter((e) => e[0] === 'start')).toHaveLength(2);
  expect(layer.running).toBe(2);
});

test('budget: when a die’s effects do not all fit, the cheapest are kept, started in rule order', async () => {
  const log = [];
  const modules = { big: timed('big', 3, log), b: timed('b', 1, log), c: timed('c', 1, log) };
  const { layer } = setup({ modules });
  await layer.prefetch();
  layer.play(makeDie(), fxOf('big', 'c', 'b'));
  expect(log.map((e) => e[1])).toEqual(['c', 'b']);
});

test('the budget frees up as effects end', async () => {
  const { layer, log } = setup();
  await layer.prefetch();
  layer.play(makeDie(), fxOf('a'));
  layer.play(makeDie(), fxOf('b'));
  layer.play(makeDie(), fxOf('c'));
  expect(layer.running).toBe(2);
  layer.update(0);
  layer.update(200);
  expect(layer.running).toBe(0);
  layer.play(makeDie(), fxOf('c'));
  expect(log.filter((e) => e[0] === 'start').map((e) => e[1])).toEqual(['a', 'b', 'c']);
});

test('update is true while an effect runs and false once all durations pass', async () => {
  const { layer, log } = setup({ tier: 'high' });
  await layer.prefetch();
  layer.play(makeDie(), [{ effect: { id: 'a', duration: 300 } }]);
  layer.play(makeDie(), fxOf('b')); // default duration 100
  expect(layer.update(1000)).toBe(true);
  expect(layer.update(1150)).toBe(true); // b over, a still running
  expect(log.filter((e) => e[0] === 'stop').map((e) => e[1])).toEqual(['b']);
  expect(layer.update(1300)).toBe(false);
  expect(log.filter((e) => e[0] === 'stop')).toHaveLength(2);
  expect(layer.update(1400)).toBe(false);
});

test('clear() stops every running effect', async () => {
  const { layer, log } = setup({ tier: 'ultra' });
  await layer.prefetch();
  for (let i = 0; i < 5; i++) layer.play(makeDie(), fxOf('a'));
  layer.update(0);
  layer.clear();
  expect(log.filter((e) => e[0] === 'stop')).toHaveLength(5);
  expect(layer.update(10)).toBe(false);
});

test('unloaded library: nothing starts and nothing throws; play() starts the load for later rolls', async () => {
  const loadLibrary = vi.fn(async () => ({ EFFECTS: { a: timed('a') } }));
  const { layer } = setup({ loadLibrary });
  expect(() => layer.play(makeDie(), fxOf('a'))).not.toThrow();
  expect(layer.running).toBe(0);
  expect(layer.update(0)).toBe(false);
  expect(loadLibrary).toHaveBeenCalledTimes(1);
  await layer.prefetch();
  expect(loadLibrary).toHaveBeenCalledTimes(1);
  layer.play(makeDie(), fxOf('a'));
  expect(layer.running).toBe(1);
});

test('a failing library load warns once and leaves effects off; prefetch never rejects', async () => {
  const { layer, warn } = setup({ loadLibrary: () => Promise.reject(new Error('404')) });
  await expect(layer.prefetch()).resolves.toBeUndefined();
  await expect(layer.prefetch()).resolves.toBeUndefined();
  layer.play(makeDie(), fxOf('a'));
  expect(layer.running).toBe(0);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('the effects setting off: play() starts nothing', async () => {
  const { layer } = setup({ settings: { effects: false } });
  await layer.prefetch();
  layer.play(makeDie(), fxOf('a'));
  expect(layer.running).toBe(0);
});

test('unknown ids, null effects and malformed fx are skipped; a throwing start warns once per id', async () => {
  const bad = {
    id: 'bad',
    cost: 1,
    defaults: {},
    start: () => {
      throw new Error('x');
    },
  };
  const { layer, warn } = setup({ tier: 'ultra', modules: { a: timed('a'), bad } });
  await layer.prefetch();
  expect(() => {
    layer.play(makeDie(), [null, { effect: null }, { effect: { id: 'nope' } }, ...fxOf('a')]);
    layer.play(makeDie(), fxOf('bad'));
    layer.play(makeDie(), fxOf('bad'));
    layer.play(makeDie(), null);
  }).not.toThrow();
  expect(layer.running).toBe(1);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('releaseDie stops the effects bound to that die only', async () => {
  const log = [];
  const bound = { ...timed('bound', 1, log), bindsDie: true };
  const free = timed('free', 1, log);
  const { layer } = setup({ tier: 'ultra', modules: { bound, free } });
  await layer.prefetch();
  const d1 = makeDie();
  const d2 = makeDie();
  layer.play(d1, fxOf('bound', 'free'));
  layer.play(d2, fxOf('bound'));
  layer.releaseDie(d1);
  expect(log.filter((e) => e[0] === 'stop').map((e) => [e[1], e[2]])).toEqual([['bound', d1]]);
  expect(layer.running).toBe(2);
});

test('effect options are copies: the shared fx objects are never mutated', async () => {
  let seen = null;
  const spy = { ...timed('spy'), start: (ctx) => ((seen = ctx), timed('spy').start(ctx)) };
  const { layer } = setup({ modules: { spy } });
  await layer.prefetch();
  const fx = Object.freeze([
    Object.freeze({ effect: Object.freeze({ id: 'spy', color: '#ff0000', size: 3 }) }),
  ]);
  layer.play(makeDie(), fx);
  expect(seen.color).toBeInstanceOf(THREE.Color);
  expect(seen.color.getHexString()).toBe('ff0000');
  expect(seen.intensity).toBe(1);
  expect(seen.duration).toBe(100);
  expect(seen.options.size).toBe(3);
  expect(seen.position).toBeInstanceOf(THREE.Vector3);
  expect(seen.tier).toBe(TIERS.low);
});

describe('screen shake (dice canvas only)', () => {
  const shaker = (amount, ms) => ({
    id: 'shake',
    cost: 0,
    defaults: {},
    start(ctx) {
      ctx.shake(amount, ms);
      return { update: () => false, stop() {} };
    },
  });
  test('translates the canvas by at most 6 px x intensity, damps, then resets the transform', async () => {
    const { layer, canvas } = setup({ modules: { shake: shaker(0.5, 300) } });
    await layer.prefetch();
    layer.play(makeDie(), fxOf('shake'));
    let max = 0;
    for (let t = 0; t < 300; t += 16) {
      expect(layer.update(t)).toBe(true);
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(canvas.style.transform);
      expect(m).not.toBeNull();
      max = Math.max(max, Math.hypot(Number(m[1]), Number(m[2])));
    }
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(3 + 0.01); // the transform is toFixed-rounded per axis
    expect(layer.update(400)).toBe(false);
    expect(canvas.style.transform).toBe('');
  });
  test('skipped when screenShake is off or prefers-reduced-motion is set', async () => {
    for (const opts of [{ settings: { screenShake: false } }, { reduced: true }]) {
      const { layer, canvas } = setup({ modules: { shake: shaker(1, 300) }, ...opts });
      await layer.prefetch();
      layer.play(makeDie(), fxOf('shake'));
      expect(layer.update(16)).toBe(false);
      expect(canvas.style.transform).toBe('');
    }
  });
  test('clear() resets the transform mid-shake', async () => {
    const { layer, canvas } = setup({ modules: { shake: shaker(1, 1000) } });
    await layer.prefetch();
    layer.play(makeDie(), fxOf('shake'));
    layer.update(0);
    layer.update(50);
    expect(canvas.style.transform).not.toBe('');
    layer.clear();
    expect(canvas.style.transform).toBe('');
  });
});

describe('die effects (library)', () => {
  const fxUniforms = () => ({
    uFxTint: { value: new THREE.Vector4() },
    uFxFlare: { value: new THREE.Vector3() },
  });
  function run(id, effect = {}) {
    const u = fxUniforms();
    const isolate = vi.fn(() => u);
    const { layer } = setup({ tier: 'ultra', modules: EFFECTS, isolate });
    return layer.prefetch().then(() => {
      const die = makeDie();
      layer.play(die, [{ effect: { id, ...effect } }]);
      return { layer, u, die, isolate };
    });
  }
  test('the catalogue has the three die effects, each cost 1 with defaults', () => {
    for (const id of ['color-shift', 'number-flare', 'glow-pulse']) {
      expect(EFFECTS[id].id).toBe(id);
      expect(EFFECTS[id].cost).toBe(1);
      expect(EFFECTS[id].defaults).toEqual(
        expect.objectContaining({
          color: expect.any(String),
          intensity: expect.any(Number),
          duration: expect.any(Number),
        }),
      );
    }
  });
  test('color-shift: eases the tint in over 150 ms, holds, eases out, ends at zero', async () => {
    const { layer, u, isolate } = await run('color-shift', {
      color: '#ff0000',
      intensity: 1,
      duration: 1000,
    });
    expect(isolate).toHaveBeenCalledTimes(1);
    layer.update(0);
    layer.update(75);
    const mid = u.uFxTint.value.w;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    layer.update(150);
    expect(u.uFxTint.value.w).toBeCloseTo(1, 5);
    expect(u.uFxTint.value.x).toBeGreaterThan(0.9);
    layer.update(500);
    expect(u.uFxTint.value.w).toBeCloseTo(1, 5);
    layer.update(900);
    expect(u.uFxTint.value.w).toBeLessThan(1);
    expect(layer.update(1000)).toBe(false);
    expect(u.uFxTint.value.w).toBe(0);
  });
  test('number-flare: pulses the flare colour and returns it to zero', async () => {
    const { layer, u } = await run('number-flare', { color: '#ffffff', duration: 600 });
    layer.update(0);
    layer.update(150);
    expect(u.uFxFlare.value.length()).toBeGreaterThan(0);
    expect(layer.update(600)).toBe(false);
    expect(u.uFxFlare.value.toArray()).toEqual([0, 0, 0]);
  });
  test('glow-pulse: a back-face additive shell at scale 1.08 on the die, removed when done', async () => {
    const { layer, die } = await run('glow-pulse', { duration: 400 });
    const shell = die.inner.children[0];
    expect(shell).toBeTruthy();
    expect(shell.scale.x).toBeCloseTo(1.08);
    expect(shell.material.side).toBe(THREE.BackSide);
    // additive colour AND alpha: THREE.AdditiveBlending with alpha 1 left black boxes on the canvas
    expect(shell.material.blending).toBe(THREE.CustomBlending);
    expect(shell.material.blendSrcAlpha).toBe(THREE.OneFactor);
    expect(shell.material.blendDstAlpha).toBe(THREE.OneFactor);
    expect(shell.material.depthWrite).toBe(false);
    const dispose = vi.spyOn(shell.material, 'dispose');
    layer.update(0);
    layer.update(100);
    expect(shell.material.uniforms.uStrength.value).toBeGreaterThan(0);
    expect(layer.update(400)).toBe(false);
    expect(die.inner.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalled();
  });
  test('a die effect on a die that cannot be isolated (model, fading) is a no-op', async () => {
    const { layer } = setup({ tier: 'ultra', modules: EFFECTS, isolate: () => null });
    await layer.prefetch();
    layer.play(makeDie(), fxOf('color-shift', 'number-flare'));
    expect(layer.update(0)).toBe(false);
  });
});

test('onPlay is called once per effect that actually started, by effect id', async () => {
  const onPlay = vi.fn();
  const { layer } = setup({ onPlay });
  await layer.prefetch();
  layer.play(makeDie(), fxOf('a', 'nope', 'b'));
  expect(onPlay.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
});

test('a throwing onPlay never stops an effect', async () => {
  const { layer } = setup({
    onPlay: () => {
      throw new Error('x');
    },
  });
  await layer.prefetch();
  layer.play(makeDie(), fxOf('a'));
  expect(layer.running).toBe(1);
});

describe('safe mode', () => {
  test('library effects are skipped while isSafe() is true; DSN effects still run', async () => {
    let safe = true;
    let dsn;
    const { layer, log } = setup({
      isSafe: () => safe,
      dsnSfx: { effectFor: (id) => (id === 'dsn:x' ? dsn : null) },
    });
    dsn = timed('dsn:x', 1, log);
    await layer.prefetch();
    layer.play(makeDie(), fxOf('a', 'dsn:x'));
    expect(log.filter((e) => e[0] === 'start').map((e) => e[1])).toEqual(['dsn:x']);
    safe = false;
    layer.play(makeDie(), fxOf('a'));
    expect(log.filter((e) => e[0] === 'start').map((e) => e[1])).toEqual(['dsn:x', 'a']);
  });
});

describe('elemental trails flight', () => {
  async function trailSetup({ settings = {}, ...rest } = {}) {
    const fx = { flight: vi.fn(), clear: vi.fn() };
    const createTrailFx = vi.fn(() => fx);
    const made = setup({ tier: 'high', settings, particles: { emit() {}, update: () => false, clear() {}, dispose() {} },
      loadLibrary: async () => ({ EFFECTS: {}, createTrailFx }),
      ...rest,
    });
    await made.layer.prefetch();
    return { ...made, fx, createTrailFx };
  }
  const roll = { dice: [{ trail: 2 }] };

  test('flight hands roll.dice to the library trail fx; clear clears it', async () => {
    const { layer, fx, createTrailFx } = await trailSetup();
    expect(Object.keys(createTrailFx.mock.calls[0][0]).sort()).toEqual(['getPool', 'getTier', 'now', 'reducedMotion', 'setting', 'warnOnce']);
    layer.flight(roll, 5);
    expect(fx.flight).toHaveBeenCalledWith(roll.dice, 5);
    layer.clear();
    expect(fx.clear).toHaveBeenCalled();
  });

  test('effects false or a gate that is not on stops flight (elementalTrails is checked by the library)', async () => {
    for (const opts of [{ settings: { effects: false } }, { isSafe: () => true }]) {
      const { layer, fx } = await trailSetup(opts);
      layer.flight(roll, 5);
      expect(fx.flight).not.toHaveBeenCalled();
    }
  });

  test('no library trail fx is a no-op', async () => {
    const bare = setup({ tier: 'high', loadLibrary: async () => ({ EFFECTS: {} }) });
    await bare.layer.prefetch();
    expect(() => bare.layer.flight(roll, 1)).not.toThrow();
  });
});

describe('impact effects (dust and sparks)', () => {
  const KINDS = { SMOKE: 2, STREAK: 6 };
  const RING = 7;
  async function impactSetup({ settings = {}, ...rest } = {}) {
    const emit = vi.fn();
    const clock = { t: 1000 };
    const pool = { emit, update: () => false, clear() {}, dispose() {} };
    const made = setup({ tier: 'high', settings,
      particles: pool,
      now: () => clock.t,
      loadLibrary: async () => ({ EFFECTS: {}, createImpactFx }),
      ...rest,
    });
    await made.layer.prefetch();
    return { ...made, emit, clock };
  }
  const hit = (speed, extra = {}) => ({ position: { x: 1, y: 0.4, z: -2 }, speed, dieKey: 'r:0', ...extra });

  test('impact below speed 11 emits nothing; at 14 a dust ring; at 20 dust and sparks', async () => {
    const { layer, emit } = await impactSetup();
    layer.impact(hit(10.9));
    expect(emit).not.toHaveBeenCalled();
    layer.impact(hit(14, { dieKey: 'a' }));
    expect(emit).toHaveBeenCalledTimes(1);
    const dust = emit.mock.calls[0][0];
    expect(dust).toMatchObject({ kind: KINDS.SMOKE, shape: RING, blend: 'normal', color: '#d8cfc0', alpha: 0.35 });
    expect(dust.count).toBe(Math.round(3 + 5 * (3 / 7)));
    expect(dust.origin).toEqual({ x: 1, y: 0.05, z: -2 });
    layer.impact(hit(20, { dieKey: 'b' }));
    expect(emit).toHaveBeenCalledTimes(3);
    const sparks = emit.mock.calls[2][0];
    expect(sparks).toMatchObject({ kind: KINDS.STREAK, color: '#fff3d0' });
    expect(sparks.count).toBe(Math.round(2 + 4 * 1));
    expect(emit.mock.calls[1][0].count).toBe(8);
  });

  test('counts follow the tier particleScale and a THREE.Vector3 position is copied', async () => {
    const { layer, emit } = await impactSetup({ tier: 'low' });
    const p = new THREE.Vector3(3, 1, 4);
    layer.impact({ position: p, speed: 18 });
    p.set(9, 9, 9);
    expect(emit.mock.calls[0][0].origin).toEqual({ x: 3, y: 0.05, z: 4 });
    expect(emit.mock.calls[0][0].count).toBe(Math.round(8 * TIERS.low.particleScale));
  });

  test('impact debounces per die for 120 ms and caps 12 live emits', async () => {
    const { layer, emit, clock } = await impactSetup();
    layer.impact(hit(14));
    clock.t += 119;
    layer.impact(hit(14));
    expect(emit).toHaveBeenCalledTimes(1);
    clock.t += 2;
    layer.impact(hit(14));
    expect(emit).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 20; i++) layer.impact(hit(14, { dieKey: `k${i}` }));
    expect(emit).toHaveBeenCalledTimes(12); // 2 + 10 more, then capped
    clock.t += 700; // their longest life has passed
    layer.impact(hit(14, { dieKey: 'late' }));
    expect(emit).toHaveBeenCalledTimes(13);
  });

  test('impactEffects false, effects false or reduced motion stops impacts', async () => {
    for (const opts of [{ settings: { impactEffects: false } }, { settings: { effects: false } }, { reduced: true }]) {
      const { layer, emit } = await impactSetup(opts);
      layer.impact(hit(20));
      expect(emit).not.toHaveBeenCalled();
    }
  });

  test('impact does nothing, and creates no pool, while isSafe() is true', async () => {
    const createParticlePool = vi.fn(() => ({ emit: vi.fn(), layers: [], update: () => false, clear() {}, dispose() {} }));
    let safe = true;
    const { layer } = setup({
      tier: 'high',
      isSafe: () => safe,
      now: () => 1000,
      loadLibrary: async () => ({ EFFECTS: {}, createImpactFx, createParticlePool }),
    });
    await layer.prefetch();
    layer.impact(hit(20));
    expect(createParticlePool).not.toHaveBeenCalled();
    // An injected pool sees no emit either.
    const { layer: injected, emit } = await impactSetup({ isSafe: () => true });
    injected.impact(hit(20));
    expect(emit).not.toHaveBeenCalled();
    // Out of safe mode the same impact makes the pool.
    safe = false;
    layer.impact(hit(20, { dieKey: 'later' }));
    expect(createParticlePool).toHaveBeenCalledTimes(1);
  });

  test('a slow impact returns before any setting, safe-mode or matchMedia read', async () => {
    const getSetting = vi.fn(() => undefined);
    const matchMedia = vi.fn(() => ({ matches: false }));
    const isSafe = vi.fn(() => false);
    const { layer, emit } = await impactSetup({ getSetting, matchMedia, isSafe });
    getSetting.mockClear();
    matchMedia.mockClear();
    isSafe.mockClear();
    layer.impact(hit(5));
    expect(getSetting).not.toHaveBeenCalled();
    expect(matchMedia).not.toHaveBeenCalled();
    expect(isSafe).not.toHaveBeenCalled();
    layer.impact(hit(20));
    expect(emit).toHaveBeenCalled();
  });

  test('a throwing isSafe() counts as not safe for impacts', async () => {
    const { layer, emit } = await impactSetup({
      isSafe: () => {
        throw new Error('x');
      },
    });
    layer.impact(hit(20));
    expect(emit).toHaveBeenCalled();
  });

  test('nothing before the library is loaded, and a bad event never throws', async () => {
    const emit = vi.fn();
    const { layer } = setup({
      tier: 'high',
      particles: { emit },
      now: () => 0,
      loadLibrary: async () => ({ EFFECTS: {}, createImpactFx }),
    });
    layer.impact(hit(20));
    expect(emit).not.toHaveBeenCalled();
    await layer.prefetch();
    expect(() => layer.impact(null)).not.toThrow();
    expect(() => layer.impact({ speed: 20 })).not.toThrow();
  });
});

describe('particle pool warm-up (prefetch)', () => {
  function poolSetup({ settings = {}, ...rest } = {}) {
    const meshes = [new THREE.Mesh(), new THREE.Mesh()];
    const pool = {
      emit: vi.fn(),
      layers: meshes.map((mesh) => ({ mesh })),
      update: () => false,
      clear() {},
      dispose() {},
    };
    const createParticlePool = vi.fn(() => pool);
    const made = setup({
      tier: 'high',
      settings,
      now: () => 1000,
      loadLibrary: async () => ({ EFFECTS: {}, createImpactFx, createParticlePool }),
      ...rest,
    });
    return { ...made, meshes, pool, createParticlePool };
  }
  const hit = { position: { x: 0, y: 0.4, z: 0 }, speed: 20, dieKey: 'r:0' };

  test('prefetch creates the pool once the library is in and warms its meshes once', async () => {
    const warm = vi.fn(async () => {});
    const { layer, meshes, pool, createParticlePool } = poolSetup({ warm });
    await layer.prefetch();
    expect(createParticlePool).toHaveBeenCalledTimes(1);
    expect(createParticlePool.mock.calls[0][1]).toBe(Math.round(2048 * TIERS.high.particleScale));
    expect(warm).toHaveBeenCalledTimes(1);
    expect(warm.mock.calls[0][0]).toEqual(meshes);
    // The first impact reuses it: no second pool, no second warm-up.
    layer.impact(hit);
    expect(pool.emit).toHaveBeenCalled();
    expect(createParticlePool).toHaveBeenCalledTimes(1);
    await layer.prefetch();
    expect(warm).toHaveBeenCalledTimes(1);
  });

  test('no pool and no warm-up while effects are off or safe mode is on', async () => {
    for (const opts of [{ settings: { effects: false } }, { isSafe: () => true }]) {
      const warm = vi.fn();
      const { layer, createParticlePool } = poolSetup({ warm, ...opts });
      await layer.prefetch();
      expect(createParticlePool).not.toHaveBeenCalled();
      expect(warm).not.toHaveBeenCalled();
    }
  });

  test('a throwing or rejecting warm hook is swallowed; the pool still works', async () => {
    const throwing = () => {
      throw new Error('lost');
    };
    const rejecting = () => Promise.reject(new Error('timeout'));
    for (const warm of [throwing, rejecting]) {
      const { layer, pool } = poolSetup({ warm });
      await expect(layer.prefetch()).resolves.toBeUndefined();
      await Promise.resolve();
      layer.impact(hit);
      expect(pool.emit).toHaveBeenCalled();
    }
  });

  test('a pool that cannot be created leaves prefetch and the library working', async () => {
    const warm = vi.fn();
    const { layer, warn } = poolSetup({
      warm,
      loadLibrary: async () => ({
        EFFECTS: { a: timed('a') },
        createImpactFx,
        createParticlePool: () => {
          throw new Error('no gl');
        },
      }),
    });
    await layer.prefetch();
    expect(layer.loaded).toBe(true);
    expect(warm).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    layer.play(makeDie(), fxOf('a'));
    expect(layer.running).toBe(1);
  });
});

describe('JB2A animations', () => {
  /** A fake JB2A chunk whose player maps `frost` only; its module logs 'jb2a:frost'. */
  function fakeJb2a({ source = { moduleId: 'JB2A_DnD5e', location: 'modules' } } = {}) {
    const calls = { moduleFor: [], preload: 0, made: 0, disposed: 0 };
    const jb2a = {
      source: vi.fn(() => source),
      load: vi.fn(async () => ({
        createJb2aPlayer: (opts) => {
          calls.made++;
          calls.opts = opts;
          return {
            moduleFor(id, builtin, { safe, file } = {}) {
              calls.moduleFor.push({ id, builtin, safe, file });
              return id === 'frost' ? { ...timed('jb2a:frost', 1, calls.log), cost: builtin?.cost ?? 0 } : null;
            },
            preload() {
              calls.preload++;
            },
            dispose() {
              calls.disposed++;
            },
          };
        },
      })),
    };
    return { jb2a, calls };
  }
  const started = (log) => log.filter((e) => e[0] === 'start').map((e) => e[1]);
  function jb2aSetup({ settings = {}, source, isSafe } = {}) {
    const log = [];
    const { jb2a, calls } = fakeJb2a(source === undefined ? {} : { source });
    calls.log = log;
    const modules = { frost: timed('frost', 1, log), smoke: timed('smoke', 1, log), a: timed('a', 1, log) };
    const made = setup({ modules, settings, jb2a, ...(isSafe ? { isSafe } : {}) });
    return { ...made, log, jb2a, calls, settings };
  }

  test('with the setting on, a mapped effect plays the JB2A module, not the built-in', async () => {
    const { layer, log, calls } = jb2aSetup();
    await layer.prefetch();
    layer.play(makeDie(), fxOf('frost', 'a'));
    expect(started(log)).toEqual(['jb2a:frost', 'a']);
    expect(calls.moduleFor[0]).toMatchObject({ id: 'frost', safe: false });
    expect(calls.moduleFor[0].builtin.id).toBe('frost');
  });

  test("a rule's chosen JB2A file is handed to the player", async () => {
    const { layer, calls } = jb2aSetup();
    await layer.prefetch();
    layer.play(makeDie(), [{ ruleId: 'r', effect: { id: 'frost', jb2a: 'modules/j/x.webm' }, sound: null }]);
    expect(calls.moduleFor[0]).toMatchObject({ id: 'frost', file: 'modules/j/x.webm' });
  });

  test('jb2aEffects false plays the built-in, flipped between two plays with no reload', async () => {
    const { layer, log, settings } = jb2aSetup({ settings: { jb2aEffects: true } });
    await layer.prefetch();
    layer.play(makeDie(), fxOf('frost'));
    settings.jb2aEffects = false;
    layer.play(makeDie(), fxOf('frost'));
    expect(started(log)).toEqual(['jb2a:frost', 'frost']);
  });

  test('with source() null the built-in plays and load is never called', async () => {
    const { layer, log, jb2a } = jb2aSetup({ source: null });
    await layer.prefetch();
    layer.play(makeDie(), fxOf('frost'));
    expect(started(log)).toEqual(['frost']);
    expect(jb2a.load).not.toHaveBeenCalled();
  });

  test('safe mode: a mapped id plays JB2A (safe passed), a non-mapped library id is still filtered out', async () => {
    const { layer, log, calls } = jb2aSetup({ isSafe: () => true });
    await layer.prefetch();
    layer.play(makeDie(), fxOf('frost', 'smoke'));
    expect(started(log)).toEqual(['jb2a:frost']);
    expect(calls.moduleFor.find((c) => c.id === 'frost').safe).toBe(true);
  });

  test('damage-theme landings stay built-in; other rules with the same effect play JB2A', async () => {
    const { layer, log } = jb2aSetup();
    await layer.prefetch();
    layer.play(makeDie(), [{ ruleId: 'damage:fire', effect: { id: 'frost' }, sound: null }]);
    layer.play(makeDie(), [{ ruleId: 'r0', effect: { id: 'frost' }, sound: null }]);
    expect(started(log)).toEqual(['frost', 'jb2a:frost']);
  });

  test('prefetch loads the chunk once, builds the player on jb2a.source and preloads', async () => {
    const { layer, jb2a, calls } = jb2aSetup();
    await layer.prefetch();
    await layer.prefetch();
    expect(jb2a.load).toHaveBeenCalledTimes(1);
    expect(calls.made).toBe(1);
    expect(calls.opts.source).toBe(jb2a.source);
    expect(calls.preload).toBe(1);
  });

  test('prefetch does not load the chunk while jb2aEffects is false', async () => {
    const { layer, jb2a } = jb2aSetup({ settings: { jb2aEffects: false } });
    await layer.prefetch();
    expect(jb2a.load).not.toHaveBeenCalled();
  });

  test('a failing chunk load leaves the built-in effects playing', async () => {
    const { layer, log, jb2a } = jb2aSetup();
    jb2a.load.mockImplementation(() => Promise.reject(new Error('404')));
    await expect(layer.prefetch()).resolves.toBeUndefined();
    layer.play(makeDie(), fxOf('frost'));
    expect(started(log)).toEqual(['frost']);
  });

  test('dispose() disposes the player', async () => {
    const { layer, calls } = jb2aSetup();
    await layer.prefetch();
    layer.dispose();
    expect(calls.disposed).toBe(1);
  });
});

describe('elemental crit bursts (the automatic natural-20 burst)', () => {
  const nat20 = () => ({ ...makeDie(), type: 'd20', value: 20, trail: 2, appearance: { interior: { type: 'fire' } } });
  const library = async () => import('../../src/effects/library/index.js');
  const bursts = (log) => log.filter((e) => e[0] === 'start' && String(e[1]).startsWith('burst-'));
  /** The real library with burst-fire swapped for a logging stand-in (cost 2, 100 ms). */
  async function lib(log) {
    const mod = await library();
    return { ...mod, EFFECTS: { ...mod.EFFECTS, 'burst-fire': timed('burst-fire', 2, log), a: timed('a', 1, log) } };
  }

  test('ten such dice played in one frame start 3 bursts', async () => {
    const log = [];
    const m = await lib(log);
    const { layer } = setup({ tier: 'ultra', loadLibrary: async () => m });
    await layer.prefetch();
    for (let i = 0; i < 10; i++) layer.play(nat20(), fxOf('a'));
    expect(bursts(log)).toHaveLength(3);
    // the other fx still play (the cap skips only bursts)
    expect(log.filter((e) => e[0] === 'start' && e[1] === 'a').length).toBeGreaterThan(3);
  });

  test('the cap frees up when bursts end', async () => {
    const log = [];
    const m = await lib(log);
    const { layer } = setup({ tier: 'ultra', loadLibrary: async () => m });
    await layer.prefetch();
    for (let i = 0; i < 4; i++) layer.play(nat20(), null);
    expect(bursts(log)).toHaveLength(3);
    layer.update(0);
    layer.update(200);
    layer.play(nat20(), null);
    expect(bursts(log)).toHaveLength(4);
  });

  test('elementalCritBursts false: no burst', async () => {
    const log = [];
    const m = await lib(log);
    const { layer } = setup({ tier: 'ultra', loadLibrary: async () => m, settings: { elementalCritBursts: false } });
    await layer.prefetch();
    layer.play(nat20(), fxOf('a'));
    layer.play(nat20(), null);
    expect(bursts(log)).toHaveLength(0);
    expect(log.filter((e) => e[0] === 'start').map((e) => e[1])).toEqual(['a']);
  });

  test('a die with no other fx (null or []) still gets its burst; effects off: none', async () => {
    const log = [];
    const m = await lib(log);
    const { layer } = setup({ tier: 'ultra', loadLibrary: async () => m });
    await layer.prefetch();
    layer.play(nat20(), null);
    layer.play(nat20(), []);
    expect(bursts(log)).toHaveLength(2);
    const off = setup({ tier: 'ultra', loadLibrary: async () => m, settings: { effects: false } });
    await off.layer.prefetch();
    off.layer.play(nat20(), null);
    expect(bursts(log)).toHaveLength(2);
  });

  test('no burst for a die that is not a natural 20 with an element', async () => {
    const log = [];
    const m = await lib(log);
    const { layer } = setup({ tier: 'ultra', loadLibrary: async () => m });
    await layer.prefetch();
    layer.play({ ...nat20(), value: 19 }, null);
    layer.play({ ...nat20(), trail: 1 }, null);
    layer.play({ ...nat20(), type: 'd12', value: 12 }, null);
    layer.play({ ...nat20(), appearance: null }, null);
    expect(log).toEqual([]);
  });

  test('an element whose burst is listed but not built yet starts nothing and never throws', async () => {
    const m = await library();
    const { layer, warn } = setup({ tier: 'ultra', loadLibrary: async () => m });
    await layer.prefetch();
    const bleed = { ...nat20(), appearance: null, damageType: 'bleed' };
    expect(m.EFFECTS['burst-bleed']).toBeUndefined();
    expect(() => layer.play(bleed, null)).not.toThrow();
    expect(layer.running).toBe(0);
    expect(() => layer.play(makeDie(), fxOf('burst-bleed'))).not.toThrow();
    expect(layer.running).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a rule-picked burst respects the cap: skipped while 3 bursts run, other fx still play', async () => {
    const log = [];
    const m = await lib(log);
    const { layer } = setup({ tier: 'ultra', loadLibrary: async () => m });
    await layer.prefetch();
    for (let i = 0; i < 3; i++) layer.play(nat20(), null);
    expect(bursts(log)).toHaveLength(3);
    layer.play(makeDie(), fxOf('burst-fire', 'a'));
    expect(bursts(log)).toHaveLength(3);
    expect(log.filter((e) => e[0] === 'start' && e[1] === 'a')).toHaveLength(1);
  });

  test('no duplicate: a natural 20 whose fx already holds a burst gets no automatic one', async () => {
    const log = [];
    const m = await lib(log);
    const { layer } = setup({ tier: 'ultra', loadLibrary: async () => m });
    await layer.prefetch();
    layer.play(nat20(), fxOf('burst-fire'));
    expect(bursts(log)).toHaveLength(1);
  });

  test('a natural 20 landing before the library is in asks for it, so later bursts play', async () => {
    const log = [];
    const m = await lib(log);
    const loadLibrary = vi.fn(async () => m);
    const { layer } = setup({ tier: 'ultra', loadLibrary });
    layer.play(nat20(), null);
    expect(loadLibrary).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(layer.loaded).toBe(true));
    layer.play(nat20(), null);
    expect(bursts(log)).toHaveLength(1);
    // effects off: nothing is fetched
    const offLoad = vi.fn(async () => m);
    const off = setup({ tier: 'ultra', loadLibrary: offLoad, settings: { effects: false } });
    off.layer.play(nat20(), null);
    expect(offLoad).not.toHaveBeenCalled();
  });

  test('low tier (effectBudget 2): the burst still plays beside a cost-1 celebration', async () => {
    const m = await library();
    const { layer } = setup({ tier: 'low', loadLibrary: async () => m });
    await layer.prefetch();
    layer.play(nat20(), fxOf('celebrate'));
    expect(layer.running).toBe(2);
  });

  test('the real burst-fire plays on an ultra table and ends', async () => {
    const m = await library();
    const { layer } = setup({ tier: 'ultra', loadLibrary: async () => m });
    await layer.prefetch();
    layer.play(nat20(), null);
    expect(layer.running).toBe(1);
    let t = 0;
    while (layer.update(t) && t < 10000) t += 50;
    expect(layer.running).toBe(0);
  });
});

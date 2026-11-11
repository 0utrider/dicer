import * as THREE from 'three';
import { createEffectLayer } from '../../src/effects/effect-layer.js';
import { TIERS } from '../../src/render/quality.js';
import { EFFECTS } from '../../src/effects/library/index.js';

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
  const bad = { id: 'bad', cost: 1, defaults: {}, start: () => { throw new Error('x'); } };
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
  const fx = Object.freeze([Object.freeze({ effect: Object.freeze({ id: 'spy', color: '#ff0000', size: 3 }) })]);
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
    expect(max).toBeLessThanOrEqual(3 + 1e-9);
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
        expect.objectContaining({ color: expect.any(String), intensity: expect.any(Number), duration: expect.any(Number) }),
      );
    }
  });
  test('color-shift: eases the tint in over 150 ms, holds, eases out, ends at zero', async () => {
    const { layer, u, isolate } = await run('color-shift', { color: '#ff0000', intensity: 1, duration: 1000 });
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
    expect(shell.material.blending).toBe(THREE.AdditiveBlending);
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

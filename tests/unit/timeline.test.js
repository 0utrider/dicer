import * as THREE from 'three';
import { composite } from '../../src/effects/library/timeline.js';

/** A fake part: records starts/stops and lives `lives` ms from its own first update. */
function fakePart(id, { cost = 0, lives = Infinity, throws = false } = {}) {
  const log = { stops: 0, ctxs: [] };
  const mod = {
    id,
    cost,
    defaults: { color: '#ffffff', intensity: 1, duration: 1000 },
    start(ctx) {
      log.ctxs.push(ctx);
      if (throws) throw new Error('boom');
      let t0 = null;
      const handle = {
        update(now) {
          t0 ??= now;
          return now - t0 < lives;
        },
        stop() {
          log.stops++;
        },
      };
      return handle;
    },
  };
  return { mod, log };
}

const ctxFor = (mod, over = {}) => ({
  color: new THREE.Color('#ffffff'),
  intensity: 1,
  duration: mod.defaults.duration,
  options: {},
  tier: { effectBudget: 99 },
  ...over,
});

const make = (parts, defaults = { color: '#ffffff', intensity: 1, duration: 1000 }) =>
  composite({ id: 'test', defaults, parts });

describe('timeline composites', () => {
  test('parts without `at` all start immediately', () => {
    const a = fakePart('a');
    const b = fakePart('b');
    const mod = make([{ mod: a.mod }, { mod: b.mod }]);
    mod.start(ctxFor(mod));
    expect(a.log.ctxs).toHaveLength(1);
    expect(b.log.ctxs).toHaveLength(1);
  });

  test('a part with at: 200 starts on the first update at or after 200 ms', () => {
    const a = fakePart('a');
    const b = fakePart('b');
    const mod = make([{ mod: a.mod }, { mod: b.mod, at: 200 }]);
    const h = mod.start(ctxFor(mod));
    expect(b.log.ctxs).toHaveLength(0);
    expect(h.update(0)).toBe(true);
    expect(h.update(150)).toBe(true);
    expect(b.log.ctxs).toHaveLength(0);
    expect(h.update(230)).toBe(true);
    expect(b.log.ctxs).toHaveLength(1);
    h.update(300);
    expect(b.log.ctxs).toHaveLength(1);
  });

  test('at scales with the composite duration', () => {
    const a = fakePart('a');
    const b = fakePart('b');
    const mod = make([{ mod: a.mod }, { mod: b.mod, at: 200 }]);
    const h = mod.start(ctxFor(mod, { duration: 2000 })); // x2: at 400
    h.update(0);
    h.update(399);
    expect(b.log.ctxs).toHaveLength(0);
    h.update(400);
    expect(b.log.ctxs).toHaveLength(1);
  });

  test('a part duration scales like at and overrides the part default', () => {
    const a = fakePart('a');
    const b = fakePart('b');
    const mod = make([{ mod: a.mod }, { mod: b.mod, duration: 300 }]);
    mod.start(ctxFor(mod, { duration: 2000 }));
    expect(b.log.ctxs[0].duration).toBe(600);
    expect(a.log.ctxs[0].duration).toBe(2000); // part default 1000 x 2
  });

  test('a delayed essential part still sets the declared cost and starts at its time', () => {
    const a = fakePart('a', { cost: 2 });
    const mod = make([{ mod: a.mod, at: 100 }]);
    expect(mod.cost).toBe(2);
    const h = mod.start(ctxFor(mod));
    expect(a.log.ctxs).toHaveLength(0);
    expect(h.update(0)).toBe(true);
    h.update(100);
    expect(a.log.ctxs).toHaveLength(1);
  });

  test('a part the budget skips never starts and does not keep the composite alive', () => {
    const a = fakePart('a', { cost: 1, lives: 300 });
    const b = fakePart('b', { cost: 2 });
    const mod = make([{ mod: a.mod }, { mod: b.mod, at: 200 }]);
    const h = mod.start(ctxFor(mod, { tier: { effectBudget: 2 } }));
    expect(h.update(0)).toBe(true);
    expect(h.update(250)).toBe(true);
    expect(h.update(300)).toBe(false);
    expect(b.log.ctxs).toHaveLength(0);
  });

  test('waiting parts keep the composite alive after the started ones end', () => {
    const a = fakePart('a', { lives: 50 });
    const b = fakePart('b', { lives: 50 });
    const mod = make([{ mod: a.mod }, { mod: b.mod, at: 400 }]);
    const h = mod.start(ctxFor(mod));
    expect(h.update(0)).toBe(true);
    expect(h.update(100)).toBe(true); // a ended, b waiting
    expect(h.update(400)).toBe(true);
    expect(h.update(500)).toBe(false);
  });

  test("stop() before a part's start cancels it", () => {
    const a = fakePart('a');
    const b = fakePart('b');
    const mod = make([{ mod: a.mod }, { mod: b.mod, at: 200 }]);
    const h = mod.start(ctxFor(mod));
    h.update(0);
    h.stop();
    expect(a.log.stops).toBe(1);
    expect(h.update(300)).toBe(false);
    expect(b.log.ctxs).toHaveLength(0);
  });

  test('the composite ends at ctx.duration and stops its parts', () => {
    const a = fakePart('a');
    const mod = make([{ mod: a.mod }]);
    const h = mod.start(ctxFor(mod));
    h.update(0);
    expect(h.update(1000)).toBe(false);
    expect(a.log.stops).toBe(1);
  });

  test('an essential part that throws at once makes start() throw', () => {
    const a = fakePart('a', { throws: true });
    const mod = make([{ mod: a.mod }]);
    expect(() => mod.start(ctxFor(mod))).toThrow('boom');
  });

  test('a delayed essential part that throws stops the composite; update returns false', () => {
    const a = fakePart('a', { throws: true });
    const b = fakePart('b');
    const mod = make([{ mod: a.mod, at: 100 }, { mod: b.mod }]);
    const h = mod.start(ctxFor(mod));
    expect(h.update(0)).toBe(true);
    expect(() => h.update(100)).not.toThrow();
    expect(h.update(100)).toBe(false);
    expect(b.log.stops).toBe(1);
  });

  test('a non-essential part that throws is skipped, delayed or not', () => {
    const a = fakePart('a');
    const b = fakePart('b', { throws: true });
    const c = fakePart('c', { throws: true });
    const mod = make([{ mod: a.mod }, { mod: b.mod }, { mod: c.mod, at: 100 }]);
    const h = mod.start(ctxFor(mod));
    h.update(0);
    expect(() => h.update(100)).not.toThrow();
    expect(h.update(150)).toBe(true);
  });
});

import * as THREE from 'three';
import { EFFECTS, createParticlePool } from '../../src/effects/library/index.js';
import { createEffectLayer } from '../../src/effects/effect-layer.js';
import { KIND } from '../../src/effects/library/particles.js';
import { TIERS } from '../../src/render/quality.js';
import { EFFECT_IDS } from '../../src/effects/effect-ids.js';

const IDS = [
  'glow-pulse',
  'color-shift',
  'number-flare',
  'light-burst',
  'sparkles',
  'embers',
  'frost',
  'lightning',
  'smoke',
  'shatter',
  'shockwave',
  'shake',
  'celebrate',
  'fumble',
];
const COSTS = {
  'glow-pulse': 1,
  'color-shift': 1,
  'number-flare': 1,
  'light-burst': 1,
  sparkles: 2,
  embers: 2,
  frost: 2,
  lightning: 2,
  smoke: 2,
  shatter: 3,
  shockwave: 1,
  shake: 0,
};

function makeDie() {
  const outer = new THREE.Group();
  outer.position.set(1, 0.5, -2);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  outer.add(inner);
  return {
    outer,
    inner,
    uniforms: { uFxTint: { value: new THREE.Vector4(0, 0, 0, 0) }, uFxFlare: { value: new THREE.Vector3() } },
  };
}

function ctxFor(mod, { tier = 'ultra', die = makeDie(), scene = new THREE.Scene(), pool, shakes = [], ...over } = {}) {
  const d = mod.defaults;
  const p = pool ?? createParticlePool(scene, Math.round(2048 * TIERS[tier].particleScale));
  return {
    scene,
    camera: new THREE.PerspectiveCamera(),
    die,
    position: die.outer.position.clone(),
    color: new THREE.Color(d.color),
    intensity: d.intensity,
    duration: d.duration,
    options: {},
    particles: p,
    isolate: () => die.uniforms,
    shake: (a, ms) => shakes.push([a, ms]),
    tier: TIERS[tier],
    ...over,
  };
}

test('every catalogue id exists with a cost and defaults; table costs hold', () => {
  for (const id of IDS) {
    const m = EFFECTS[id];
    expect(m, id).toBeTruthy();
    expect(m.id).toBe(id);
    expect(typeof m.cost).toBe('number');
    expect(m.defaults.duration).toBeGreaterThan(0);
    expect(typeof m.start).toBe('function');
    if (id in COSTS) expect(m.cost, id).toBe(COSTS[id]);
  }
  // Composites declare their cheapest essential part (P4-R10).
  expect(EFFECTS.celebrate.cost).toBe(EFFECTS['light-burst'].cost);
  expect(EFFECTS.fumble.cost).toBe(EFFECTS.smoke.cost);
});

describe.each(IDS)('%s', (id) => {
  const mod = EFFECTS[id];
  test('update turns false after duration and stop() leaves no scene objects behind', () => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 256);
    const baseline = scene.children.length; // the pool's two Points, counted once
    const ctx = ctxFor(mod, { scene, pool });
    const h = mod.start(ctx);
    let now = 0;
    h.update(now);
    for (let i = 0; i < 8; i++) {
      now += ctx.duration / 8;
      h.update(now);
    }
    expect(h.update(ctx.duration + 1000)).toBe(false);
    h.stop();
    expect(scene.children.length).toBe(baseline);
    expect(ctx.die.outer.visible).toBe(true);
    pool.dispose();
  });

  test('obeys a custom duration: update(duration) is false and the scene is back as before start', () => {
    for (const duration of [400, 2500]) {
      const scene = new THREE.Scene();
      const pool = createParticlePool(scene, 256);
      const baseline = scene.children.length;
      const ctx = ctxFor(mod, { scene, pool, duration, color: new THREE.Color('#12ab34') });
      const h = mod.start(ctx);
      let alive = h.update(0);
      for (let t = 16; t < duration; t += 16) alive = h.update(t) && alive;
      expect(h.update(duration), `${id} at ${duration}`).toBe(false);
      expect(scene.children.length, `${id} at ${duration}`).toBe(baseline);
      h.stop();
      expect(ctx.die.outer.visible).toBe(true);
      pool.dispose();
    }
  });

  test('no leaks across 100 plays', () => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 256);
    const baseline = scene.children.length;
    const die = makeDie();
    scene.add(die.outer);
    const diceBase = die.outer.children.length;
    const ctx = ctxFor(mod, { scene, pool, die });
    for (let i = 0; i < 100; i++) {
      const h = mod.start(ctx);
      h.update(i * 10);
      h.stop();
      h.stop(); // idempotent
    }
    expect(scene.children.length).toBe(baseline + 1); // + the die
    expect(die.outer.children.length).toBe(diceBase);
    pool.dispose();
  });

  test('obeys color and intensity (runs at intensity 0.3 and 2)', () => {
    for (const intensity of [0.3, 2]) {
      const scene = new THREE.Scene();
      const pool = createParticlePool(scene, 256);
      const ctx = ctxFor(mod, {
        scene,
        pool,
        intensity,
        color: new THREE.Color('#12ab34'),
        options: { color: '#12ab34' },
      });
      const h = mod.start(ctx);
      expect(() => h.update(0)).not.toThrow();
      h.stop();
      pool.dispose();
    }
  });
});

test('particle effects emit into the pool; intensity scales the count', () => {
  const count = (intensity) => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 2048);
    const emit = vi.spyOn(pool, 'emit');
    const ctx = ctxFor(EFFECTS.embers, { scene, pool, intensity });
    const h = EFFECTS.embers.start(ctx);
    for (let t = 0; t <= ctx.duration; t += 100) h.update(t);
    return emit.mock.calls.reduce((n, [s]) => n + s.count, 0);
  };
  expect(count(0.5)).toBeLessThan(count(1));
  expect(count(2)).toBeGreaterThan(count(1));
  expect(count(1)).toBeGreaterThan(0);
});

test('shatter hides the die for the duration and restores it on stop', () => {
  const ctx = ctxFor(EFFECTS.shatter);
  const h = EFFECTS.shatter.start(ctx);
  h.update(0);
  expect(ctx.die.outer.visible).toBe(false);
  h.update(ctx.duration / 2);
  expect(ctx.die.outer.visible).toBe(false);
  h.update(ctx.duration + 1);
  expect(ctx.die.outer.visible).toBe(true);
});

test('shockwave and frost sit on the floor plane (y ~ 0)', () => {
  for (const id of ['shockwave', 'frost']) {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 64);
    const base = scene.children.length;
    const h = EFFECTS[id].start(ctxFor(EFFECTS[id], { scene, pool }));
    h.update(0);
    const added = scene.children.slice(base);
    expect(added.length).toBeGreaterThan(0);
    for (const o of added) {
      const box = new THREE.Box3().setFromObject(o);
      expect(box.max.y, id).toBeLessThan(0.1);
      expect(box.min.y, id).toBeGreaterThanOrEqual(0);
    }
    h.stop();
  }
});

describe('rebuilt looks', () => {
  const isRibbon = (o) => !!o.material?.uniforms?.uWidthPx;
  /** A flat additive decal on the table that is not a ribbon (floorGlow's mesh). */
  const isFloorGlow = (o) =>
    o.isMesh && !isRibbon(o) && Math.abs(o.position.y - 0.02) < 1e-6 && Math.abs(o.rotation.x + Math.PI / 2) < 1e-6
    && o.material?.uniforms?.uAlpha && !o.material.uniforms.uR;
  const run = (id, over = {}, until = 200) => {
    const ctx = ctxFor(EFFECTS[id], over);
    const emit = vi.spyOn(ctx.particles, 'emit');
    const h = EFFECTS[id].start(ctx);
    for (let t = 0; t <= until; t += 20) h.update(t);
    return { ctx, h, emit, specs: emit.mock.calls.map(([s]) => s) };
  };

  test('lightning and frost draw with a ribbon, not LineSegments', () => {
    for (const id of ['lightning', 'frost']) {
      const { ctx, h } = run(id);
      const kids = ctx.scene.children;
      expect(kids.some((c) => c.isLineSegments), id).toBe(false);
      expect(kids.some(isRibbon), id).toBe(true);
      h.stop();
      expect(kids.some(isRibbon), id).toBe(false);
    }
  });

  test('embers, lightning and light-burst add a floor glow', () => {
    for (const id of ['embers', 'lightning', 'light-burst']) {
      const { ctx, h } = run(id, {}, 100);
      const glow = ctx.scene.children.find(isFloorGlow);
      expect(glow, id).toBeTruthy();
      expect(glow.material.uniforms.uAlpha.value, id).toBeGreaterThan(0);
      expect(glow.material.uniforms.uColor.value.getHex(), id).toBe(ctx.color.getHex());
      h.stop();
      expect(ctx.scene.children.some(isFloorGlow), id).toBe(false);
    }
  });

  test('light-burst rays: the halo quad carries a rotating uRays mask', () => {
    const { ctx, h } = run('light-burst', {}, 0);
    const halo = ctx.scene.children.find((c) => c.material?.uniforms?.uRays);
    expect(halo).toBeTruthy();
    expect(halo.material.uniforms.uRays.value).toBe(8);
    const a = halo.material.uniforms.uSpin.value;
    h.update(400);
    expect(halo.material.uniforms.uSpin.value).not.toBe(a);
    h.stop();
  });

  test('shockwave draws two rings, the second 90 ms later and fainter, plus a dust ring', () => {
    const ctx = ctxFor(EFFECTS.shockwave);
    const emit = vi.spyOn(ctx.particles, 'emit');
    const h = EFFECTS.shockwave.start(ctx);
    const quad = ctx.scene.children.find((c) => c.material?.uniforms?.uR2);
    const u = quad.material.uniforms;
    h.update(0);
    h.update(60);
    expect(u.uAlpha2.value).toBe(0);
    h.update(200);
    expect(u.uAlpha2.value).toBeGreaterThan(0);
    expect(u.uAlpha2.value).toBeLessThan(u.uAlpha.value);
    expect(u.uR2.value).toBeLessThan(u.uR.value);
    const dust = emit.mock.calls.map(([s]) => s).filter((s) => s.kind === KIND.SMOKE);
    expect(dust.length).toBeGreaterThan(0);
    expect(dust.every((s) => s.shape === 7 && s.blend === 'normal')).toBe(true);
    h.stop();
  });

  test('sparkles: spinning GLINT stars and spiral DOTs fading to white', () => {
    const { specs, h } = run('sparkles', {}, 800);
    const glints = specs.filter((s) => s.kind === KIND.GLINT);
    const dots = specs.filter((s) => s.kind === KIND.SPIRAL);
    expect(glints.length).toBeGreaterThan(0);
    expect(glints.every((s) => s.shape === 3 && s.spin > 0)).toBe(true);
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.every((s) => s.shape === 0 && new THREE.Color(s.colorEnd).getHex() === 0xffffff)).toBe(true);
    h.stop();
  });

  test('embers: rising FLAME embers to #ff2a00 and streaks', () => {
    const { specs, h } = run('embers', { tier: 'high' }, 1500);
    const flames = specs.filter((s) => s.kind === KIND.EMBER);
    expect(flames.length).toBeGreaterThan(0);
    expect(flames.every((s) => s.shape === 5 && s.sizeEnd === 0.3 && s.colorEnd === '#ff2a00')).toBe(true);
    const streaks = specs.filter((s) => s.kind === KIND.STREAK).reduce((n, s) => n + s.count, 0);
    expect(streaks).toBe(6);
    h.stop();
  });

  test('embers streaks and frost mist follow intensity and the tier particleScale', () => {
    const total = (id, kind, over) => {
      const { specs, h } = run(id, over, 1500);
      h.stop();
      return specs.filter((s) => s.kind === kind).reduce((n, s) => n + s.count, 0);
    };
    expect(total('embers', KIND.STREAK, { tier: 'ultra' })).toBe(9); // 6 x 1.5
    expect(total('embers', KIND.STREAK, { tier: 'high', intensity: 0.5 })).toBe(3);
    expect(total('frost', KIND.SMOKE, { tier: 'ultra' })).toBe(3); // 2 x 1.5
    expect(total('frost', KIND.SMOKE, { tier: 'low' })).toBe(1); // at least 1
  });

  test('smoke: noise puffs growing 2.6x, spinning, normal blend, ending 30% darker than ctx.color', () => {
    const color = new THREE.Color('#12ab34');
    const { specs, h } = run('smoke', { color, options: { color: '#12ab34' } }, 400);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) {
      expect(s.shape).toBe(2);
      expect(s.sizeEnd).toBe(2.6);
      expect(s.spin).toBe(0.6);
      expect(s.blend).toBe('normal');
      expect(new THREE.Color(s.colorEnd).getHex()).toBe(color.clone().multiplyScalar(0.7).getHex());
    }
    h.stop();
  });

  test('frost: spinning SHARD spray and two pale mist puffs', () => {
    const { specs, h } = run('frost', { tier: 'high' }, 400);
    expect(specs.some((s) => s.kind === KIND.SHARD && s.spin > 0)).toBe(true);
    const mist = specs.filter((s) => s.kind === KIND.SMOKE);
    expect(mist.reduce((n, s) => n + s.count, 0)).toBe(2);
    expect(mist.every((s) => s.color === '#e8f8ff' && s.alpha === 0.3)).toBe(true);
    h.stop();
  });

  test('shatter: double-size spinning shards going dark, and a GLINT flash', () => {
    const { specs, ctx, h } = run('shatter', {}, 100);
    const shards = specs.find((s) => s.kind === KIND.SHARD);
    expect(shards.size).toBeCloseTo(0.4);
    expect(shards.spin).toBe(8);
    expect(new THREE.Color(shards.colorEnd).getHex()).toBe(ctx.color.clone().multiplyScalar(0.5).getHex());
    expect(specs.some((s) => s.shape === 3 && s.blend !== 'normal')).toBe(true); // the GLINT flash
    h.stop();
  });

  test('glow-pulse adds a soft halo behind the die that pulses with the shell', () => {
    const ctx = ctxFor(EFFECTS['glow-pulse']);
    const base = ctx.scene.children.length;
    const h = EFFECTS['glow-pulse'].start(ctx);
    const halo = ctx.scene.children[base];
    expect(halo?.isMesh).toBe(true);
    const shell = ctx.die.inner.children[0];
    const ratios = [];
    for (const t of [0, 200, 350, 500, 700]) {
      h.update(t);
      const s = shell.material.uniforms.uStrength.value;
      if (t > 0) ratios.push(halo.material.uniforms.uAlpha.value / s);
    }
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 5); // in phase with the shell
    h.stop();
    expect(ctx.scene.children.length).toBe(base);
  });
});

describe('lightning', () => {
  const ribbonOf = (scene, widthPx) =>
    scene.children.find((c) => c.material?.uniforms?.uWidthPx?.value === widthPx);
  /** Steps update 1 ms at a time; returns the times at which the main bolt's positions were rewritten. */
  const strikes = (over = {}) => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 256);
    const ctx = ctxFor(EFFECTS.lightning, { scene, pool, duration: 1000, ...over });
    const h = EFFECTS.lightning.start(ctx);
    const pos = ribbonOf(scene, 14).geometry.getAttribute('position');
    const at = [];
    let v = pos.version;
    for (let t = 0; t < 1000; t++) {
      h.update(t);
      if (pos.version !== v) at.push(t);
      v = pos.version;
    }
    h.stop();
    pool.dispose();
    return at;
  };

  test('lightning strikes three times: the ribbon geometry is rebuilt at 0, 22% and 48% of duration', () => {
    expect(strikes()).toEqual([0, 220, 480]);
  });

  test('lightning with ctx.reducedMotion strikes once', () => {
    expect(strikes({ reducedMotion: true })).toEqual([0]);
  });

  test('lightning bolt tapers', () => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 256);
    const h = EFFECTS.lightning.start(ctxFor(EFFECTS.lightning, { scene, pool }));
    h.update(0);
    const geo = ribbonOf(scene, 14).geometry;
    const side = geo.getAttribute('aSide').array;
    const idx = geo.index.array.subarray(0, geo.drawRange.count);
    const last = Math.max(...idx); // the main bolt is one line: its last vertex is its tip
    expect(Math.abs(side[0])).toBeCloseTo(1, 5);
    expect(Math.abs(side[last])).toBeCloseTo(0.3, 5);
    expect(ribbonOf(scene, 7), 'branches are a 7 px ribbon').toBeTruthy();
    h.stop();
    pool.dispose();
  });
});

test('shake asks the layer for a shake and is done at once', () => {
  const shakes = [];
  const h = EFFECTS.shake.start(ctxFor(EFFECTS.shake, { shakes }));
  expect(shakes).toEqual([[0.5, 300]]);
  expect(h.update(0)).toBe(false);
});

describe('composites degrade with the tier budget (P4-R10)', () => {
  test('celebrate on low (effectBudget 2) starts light-burst and the flare, not the whole stack', () => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 64);
    const base = scene.children.length;
    const ctx = ctxFor(EFFECTS.celebrate, { scene, pool, tier: 'low' });
    const emit = vi.spyOn(pool, 'emit');
    const h = EFFECTS.celebrate.start(ctx);
    h.update(0);
    h.update(300);
    expect(scene.children.length - base).toBe(3); // light-burst (halo + its floor glow) + the free floor glow
    expect(emit).not.toHaveBeenCalled(); // no sparks, no glitter
    h.stop();
    expect(scene.children.length).toBe(base);
  });
  test('celebrate on ultra starts everything', () => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 2048);
    const base = scene.children.length;
    const shakes = [];
    const ctx = ctxFor(EFFECTS.celebrate, { scene, pool, shakes });
    const emit = vi.spyOn(pool, 'emit');
    const h = EFFECTS.celebrate.start(ctx);
    h.update(0);
    h.update(300);
    expect(scene.children.length - base).toBe(5); // light-burst (halo + floor glow), floor glow, shockwave, glow-pulse halo
    expect(emit).toHaveBeenCalled();
    expect(shakes).toHaveLength(1);
    h.stop();
    expect(scene.children.length).toBe(base);
  });
  test('fumble on low is smoke only; on medium adds the grey shift', () => {
    const low = ctxFor(EFFECTS.fumble, { tier: 'low' });
    const hl = EFFECTS.fumble.start(low);
    hl.update(0);
    hl.update(600);
    expect(low.die.uniforms.uFxTint.value.w).toBe(0);
    hl.stop();
    const med = ctxFor(EFFECTS.fumble, { tier: 'medium' });
    const hm = EFFECTS.fumble.start(med);
    hm.update(0);
    hm.update(600);
    expect(med.die.uniforms.uFxTint.value.w).toBeGreaterThan(0);
    hm.stop();
    expect(med.die.uniforms.uFxTint.value.w).toBe(0);
  });
  test('a composite ends by its duration', () => {
    const ctx = ctxFor(EFFECTS.celebrate);
    const h = EFFECTS.celebrate.start(ctx);
    h.update(0);
    expect(h.update(ctx.duration + 1)).toBe(false);
  });
});

test('standalone smoke fades to its own (custom) colour, not a fixed grey', () => {
  const color = new THREE.Color('#12ab34');
  const ctx = ctxFor(EFFECTS.smoke, { color, options: { color: '#12ab34' } });
  const emit = vi.spyOn(ctx.particles, 'emit');
  const h = EFFECTS.smoke.start(ctx);
  h.update(0);
  h.update(300);
  expect(emit).toHaveBeenCalled();
  expect(new THREE.Color(emit.mock.calls[0][0].colorEnd).getHex()).toBe(color.clone().multiplyScalar(0.7).getHex());
  h.stop();
});

describe('staged celebrate and fumble', () => {
  const kinds = (emit) => emit.mock.calls.map(([s]) => s.kind);
  const meshes = (scene, base) => scene.children.slice(base).filter((c) => c.isMesh);

  test('celebrate stages: flare at 0, burst parts at 120, glitter at 200', () => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 2048);
    const base = scene.children.length;
    const shakes = [];
    const ctx = ctxFor(EFFECTS.celebrate, { scene, pool, shakes });
    const emit = vi.spyOn(pool, 'emit');
    const h = EFFECTS.celebrate.start(ctx);
    h.update(0);
    h.update(100);
    expect(ctx.die.uniforms.uFxFlare.value.length()).toBeGreaterThan(0); // number-flare on the die
    expect(meshes(scene, base)).toHaveLength(1); // only glow-pulse's halo behind the die
    expect(emit).not.toHaveBeenCalled();
    expect(shakes).toHaveLength(0);
    h.update(130);
    expect(meshes(scene, base)).toHaveLength(5); // + light-burst (halo + floor glow), floor glow, shockwave
    expect(kinds(emit)[0]).toBe(KIND.STREAK); // the spark burst, then the shockwave's dust ring
    expect(kinds(emit).every((k) => k === KIND.STREAK || k === KIND.SMOKE)).toBe(true);
    expect(emit.mock.calls[0][0].colorEnd).toBe('#ff9a3c');
    expect(shakes).toEqual([[0.3, 280]]);
    h.update(190);
    expect(kinds(emit)).not.toContain(KIND.FLAKE);
    h.update(260);
    h.update(360);
    expect(kinds(emit)).toContain(KIND.FLAKE);
    h.stop();
    expect(scene.children.length).toBe(base);
  });

  test('fumble stages: smoke at 0, crack at 80, fizzle at 150', () => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 2048);
    const base = scene.children.length;
    const shakes = [];
    const ctx = ctxFor(EFFECTS.fumble, { scene, pool, shakes });
    const emit = vi.spyOn(pool, 'emit');
    const h = EFFECTS.fumble.start(ctx);
    h.update(0);
    h.update(60);
    expect(kinds(emit)).toEqual([KIND.SMOKE]);
    expect(emit.mock.calls[0][0].colorEnd).toBe('#3a3a40');
    expect(meshes(scene, base)).toHaveLength(0);
    expect(shakes).toHaveLength(0);
    h.update(100);
    expect(meshes(scene, base)).toHaveLength(1); // the crack ribbon
    expect(shakes).toEqual([[0.15, 220]]);
    expect(kinds(emit)).not.toContain(KIND.STREAK);
    h.update(200);
    expect(kinds(emit)).toContain(KIND.STREAK); // the fizzle
    h.stop();
    expect(scene.children.length).toBe(base);
  });

  test('on the low tier (effectBudget 2) celebrate still starts light-burst and fumble smoke', () => {
    const c = ctxFor(EFFECTS.celebrate, { tier: 'low' });
    const hc = EFFECTS.celebrate.start(c);
    hc.update(0);
    hc.update(200);
    expect(meshes(c.scene, 0).length).toBeGreaterThan(0);
    expect(c.die.uniforms.uFxFlare.value.length()).toBeGreaterThan(0);
    hc.stop();
    const f = ctxFor(EFFECTS.fumble, { tier: 'low' });
    const emit = vi.spyOn(f.particles, 'emit');
    const hf = EFFECTS.fumble.start(f);
    hf.update(0);
    hf.update(60);
    hf.update(300);
    expect(kinds(emit)).toEqual([KIND.SMOKE]);
    expect(meshes(f.scene, 0).filter((m) => m.material.uniforms?.uWidthPx)).toHaveLength(0);
    hf.stop();
  });

  test('celebrate and fumble end and update() turns false by their duration', () => {
    for (const id of ['celebrate', 'fumble']) {
      const ctx = ctxFor(EFFECTS[id]);
      const h = EFFECTS[id].start(ctx);
      let now = 0;
      let alive = true;
      while (alive && now <= ctx.duration) {
        alive = h.update(now);
        now += 50;
      }
      expect(h.update(ctx.duration + 1), id).toBe(false);
    }
  });
});

describe('through the effect layer', () => {
  function layerFor(tier) {
    const scene = new THREE.Scene();
    const die = makeDie();
    const layer = createEffectLayer({
      scene,
      camera: new THREE.PerspectiveCamera(),
      canvas: { style: { transform: '' } },
      getTier: () => TIERS[tier],
      isolate: () => die.uniforms,
      loadLibrary: async () => ({ EFFECTS, createParticlePool }),
      matchMedia: () => ({ matches: false }),
    });
    return { layer, scene, die };
  }
  const fx = (id) => [{ ruleId: 'r', effect: { id }, sound: null }];

  test('the shared pool is created at prefetch at round(2048 x particleScale) and counted once', async () => {
    const { layer, scene, die } = layerFor('medium');
    await layer.prefetch();
    expect(scene.children.filter((c) => c.geometry?.isInstancedBufferGeometry)).toHaveLength(2);
    layer.play(die, fx('frost'));
    layer.play(die, fx('embers'));
    const points = scene.children.filter((c) => c.geometry?.isInstancedBufferGeometry);
    expect(points).toHaveLength(2);
    expect(points[0].geometry.getAttribute('aOrigin').count).toBe(1024);
    layer.dispose();
    expect(scene.children).toHaveLength(0);
  });

  test('the loop outlives the effect while particles live, then stops; 100 plays leak nothing', async () => {
    const { layer, scene, die } = layerFor('high');
    await layer.prefetch();
    layer.play(die, fx('sparkles'));
    expect(layer.update(0)).toBe(true);
    for (let t = 16; t <= 1450; t += 16) layer.update(t); // past the 1400 ms duration
    expect(layer.running).toBe(0);
    expect(layer.update(1500)).toBe(true); // particles still alive: the loop keeps going
    expect(layer.update(6000)).toBe(false);
    const base = scene.children.length; // the pool's two Points
    for (let i = 0; i < 100; i++) {
      layer.play(die, fx(['frost', 'lightning', 'shockwave', 'celebrate'][i % 4]));
      layer.update(100000 + i * 3000);
      layer.update(100000 + i * 3000 + 2900);
    }
    layer.update(1e7);
    expect(layer.running).toBe(0);
    expect(scene.children.length).toBe(base);
  });

  test("a 30-die pool firing sparkles on every die stays within the low tier's budget and never throws", async () => {
    const { layer, scene } = layerFor('low');
    await layer.prefetch();
    const dice = Array.from({ length: 30 }, (_, i) => {
      const d = makeDie();
      d.outer.position.set((i % 6) - 3, 0.5, Math.floor(i / 6) - 2);
      return d;
    });
    for (const d of dice) expect(() => layer.play(d, fx('sparkles'))).not.toThrow();
    expect(layer.running * EFFECTS.sparkles.cost).toBeLessThanOrEqual(TIERS.low.effectBudget);
    for (let i = 0; i < 120; i++) {
      expect(() => layer.update(i * 16)).not.toThrow();
      if (i % 10 === 0) for (const d of dice) layer.play(d, fx('sparkles'));
      expect(layer.running * EFFECTS.sparkles.cost).toBeLessThanOrEqual(TIERS.low.effectBudget);
    }
    const pool = scene.children.filter((c) => c.geometry?.isInstancedBufferGeometry);
    expect(pool).toHaveLength(2); // still one shared pool: two draw calls
    expect(pool[0].geometry.getAttribute('aOrigin').count).toBe(512);
    layer.dispose();
  });

  test('on low a nat-20 composite is accepted by the budget', async () => {
    const { layer, die } = layerFor('low');
    await layer.prefetch();
    layer.play(die, fx('celebrate'));
    expect(layer.running).toBe(1);
  });
});

test('shader quads add colour and alpha with alpha = brightness, so no black box is left on the canvas', () => {
  for (const id of ['light-burst', 'shockwave']) {
    const ctx = ctxFor(EFFECTS[id]);
    const handle = EFFECTS[id].start(ctx);
    const quad = ctx.scene.children.find((c) => c.isMesh && c.material?.fragmentShader);
    expect(quad.material.blending).toBe(THREE.CustomBlending);
    expect(quad.material.blendSrcAlpha).toBe(THREE.OneFactor);
    expect(quad.material.blendDstAlpha).toBe(THREE.OneFactor);
    expect(quad.material.fragmentShader).toContain('max( max( c.r, c.g ), c.b )');
    handle.stop();
  }
});

test('EFFECT_IDS lists exactly the library catalogue ids', () => {
  expect([...EFFECT_IDS].sort()).toEqual(Object.keys(EFFECTS).sort());
});

test('floorGlow adds one floor mesh coloured and scaled by ctx and removes it at ms', async () => {
  const { floorGlow } = await import('../../src/effects/library/catalogue.js');
  const ctx = ctxFor(EFFECTS.shockwave, { intensity: 2, color: new THREE.Color('#40a0ff') });
  const before = ctx.scene.children.length;
  const handle = floorGlow(ctx, { radius: 2, peak: 0.5, ms: 400 });
  expect(ctx.scene.children.length).toBe(before + 1);
  const mesh = ctx.scene.children[ctx.scene.children.length - 1];
  expect(mesh.position.y).toBeCloseTo(0.02);
  expect(mesh.scale.x).toBeCloseTo(4);
  expect(mesh.material.uniforms.uColor.value.getHex()).toBe(new THREE.Color('#40a0ff').getHex());
  expect(handle.update(1000)).toBe(true);
  expect(handle.update(1100)).toBe(true);
  expect(mesh.material.uniforms.uAlpha.value).toBeGreaterThan(0);
  expect(mesh.material.uniforms.uAlpha.value).toBeLessThanOrEqual(1);
  expect(handle.update(1400)).toBe(false);
  expect(ctx.scene.children.length).toBe(before);
  const again = floorGlow(ctx, { radius: 1, peak: 1, ms: 400 });
  again.stop();
  expect(ctx.scene.children.length).toBe(before);
});

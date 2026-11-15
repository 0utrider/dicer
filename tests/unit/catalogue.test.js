import * as THREE from 'three';
import { EFFECTS, createParticlePool, flareRolls } from '../../src/effects/library/index.js';
import { createEffectLayer } from '../../src/effects/effect-layer.js';
import { KIND } from '../../src/effects/library/particles.js';
import { SHAPE } from '../../src/effects/library/shapes.js';
import { TIERS } from '../../src/render/quality.js';
import { EFFECT_IDS } from '../../src/effects/effect-ids.js';
import { FUMBLE_PARTS } from '../../src/effects/library/catalogue.js';

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
    expect(dust.every((s) => s.shape === SHAPE.SMOKE && s.blend === 'normal')).toBe(true); // PUFF sprites
    h.stop();
  });

  test('ring material has uEdge, uNoise, uTrail', () => {
    const ctx = ctxFor(EFFECTS.shockwave);
    const h = EFFECTS.shockwave.start(ctx);
    const quad = ctx.scene.children.find((c) => c.material?.uniforms?.uR2);
    const u = quad.material.uniforms;
    for (const name of ['uEdge', 'uNoise', 'uTrail']) {
      expect(u[name], name).toBeTruthy();
      expect(u[name].value, name).toBeGreaterThan(0);
      expect(quad.material.fragmentShader, name).toContain(`uniform float ${name};`);
    }
    expect(u.uNoise.value).toBeLessThanOrEqual(1);
    h.stop();
  });

  test('shockwave size at intensity 2 ≤ 1.6 × size at intensity 1', () => {
    const sizeAt = (intensity) => {
      const ctx = ctxFor(EFFECTS.shockwave, { intensity });
      const h = EFFECTS.shockwave.start(ctx);
      const quad = ctx.scene.children.find((c) => c.material?.uniforms?.uR2);
      const s = quad.scale.x;
      h.stop();
      return s;
    };
    const one = sizeAt(1);
    expect(sizeAt(2)).toBeGreaterThan(one);
    expect(sizeAt(2)).toBeLessThanOrEqual(1.6 * one);
    expect(sizeAt(4)).toBeLessThanOrEqual(1.6 * one);
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
    expect(total('frost', KIND.SMOKE, { tier: 'ultra' })).toBe(5); // round(3 x 1.5)
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

  test('frost: spinning SHARD crystals (solid and glowing) and three faint mist puffs', () => {
    const { specs, h } = run('frost', { tier: 'high' }, 1800);
    const shards = specs.filter((s) => s.kind === KIND.SHARD);
    expect(shards.length).toBeGreaterThan(0);
    expect(shards.every((s) => s.spin > 0)).toBe(true);
    expect(shards.some((s) => s.blend === 'normal')).toBe(true);
    expect(shards.some((s) => s.blend !== 'normal')).toBe(true);
    const mist = specs.filter((s) => s.kind === KIND.SMOKE);
    expect(mist.reduce((n, s) => n + s.count, 0)).toBe(3);
    expect(mist.every((s) => s.alpha === 0.32)).toBe(true);
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

  /** Steps a 1000 ms strike every 10 ms; returns each ribbon's uAlpha per frame. */
  const alphas = (over = {}) => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 256);
    const ctx = ctxFor(EFFECTS.lightning, { scene, pool, duration: 1000, ...over });
    const h = EFFECTS.lightning.start(ctx);
    const ribbons = scene.children.filter((c) => c.material?.uniforms?.uWidthPx);
    const frames = [];
    for (let t = 0; t < 1000; t += 10) {
      h.update(t);
      frames.push(ribbons.map((r) => r.material.uniforms.uAlpha.value));
    }
    h.stop();
    pool.dispose();
    return frames;
  };

  test('lightning brightness is capped: at intensity 2 no layer alpha exceeds 1.5; intensity 0.3 still draws', () => {
    for (const color of ['#b9d4ff', '#141418', '#e02020']) {
      const hot = alphas({ intensity: 2, color: new THREE.Color(color) }).flat();
      expect(Math.max(...hot), color).toBeLessThanOrEqual(1.5);
    }
    const dim = alphas({ intensity: 0.3 }).flat();
    expect(Math.max(...dim)).toBeGreaterThan(0.1);
  });

  test('lightning with ctx.reducedMotion holds a constant, flicker-free alpha through its strike', () => {
    const frames = alphas({ reducedMotion: true }).slice(1, 50); // 10..490 ms
    for (const f of frames) expect(f).toEqual(frames[0]);
    expect(Math.max(...frames[0])).toBeGreaterThan(0);
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

describe('frost', () => {
  const play = (over = {}) => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 2048);
    const ctx = ctxFor(EFFECTS.frost, { scene, pool, duration: 1000, ...over });
    const emit = vi.spyOn(pool, 'emit');
    const h = EFFECTS.frost.start(ctx);
    return { scene, pool, ctx, emit, h };
  };

  test('frost grows rays: visible ray length at 30% duration < at 60%', () => {
    const { scene, pool, h } = play();
    const ray = scene.children.find((c) => typeof c.userData?.grow === 'number');
    expect(ray, 'the ray ribbon exposes userData.grow').toBeTruthy();
    for (let t = 0; t <= 300; t += 10) h.update(t);
    const early = ray.userData.grow;
    const earlyCount = ray.geometry.drawRange.count;
    for (let t = 310; t <= 600; t += 10) h.update(t);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(ray.userData.grow);
    expect(earlyCount).toBeLessThanOrEqual(ray.geometry.drawRange.count);
    h.stop();
    pool.dispose();
  });

  test('frost spawns SHARD crystals at the ray tips', () => {
    const { pool, emit, h, ctx } = play();
    for (let t = 0; t <= 1000; t += 10) h.update(t);
    const shards = emit.mock.calls.map(([s]) => s).filter((s) => s.shape === 4);
    expect(shards.length).toBeGreaterThan(0);
    // Out at the tips, beyond the die's footprint, not on the die itself.
    for (const s of shards) {
      const d = Math.hypot(s.origin.x - ctx.position.x, s.origin.z - ctx.position.z);
      expect(d).toBeGreaterThan(0.9);
    }
    h.stop();
    pool.dispose();
  });

  test('frost mist is PUFF smoke with normal blend', () => {
    const { pool, emit, h } = play();
    for (let t = 0; t <= 1000; t += 10) h.update(t);
    const mist = emit.mock.calls.map(([s]) => s).filter((s) => s.kind === KIND.SMOKE);
    expect(mist.length).toBeGreaterThan(0);
    expect(mist.every((s) => s.shape === 2 && s.blend === 'normal')).toBe(true);
    h.stop();
    pool.dispose();
  });

  /** Per drawn layer (scene order): peak uAlpha, colour, width; plus the additive particle colours. */
  const layersAt = (intensity, color) => {
    const { scene, pool, emit, h } = play({ intensity, color: new THREE.Color(color) });
    const layers = scene.children.filter((c) => c.material?.uniforms?.uAlpha);
    const peak = layers.map(() => 0);
    for (let t = 0; t < 1000; t += 10) {
      h.update(t);
      layers.forEach((l, i) => (peak[i] = Math.max(peak[i], l.material.uniforms.uAlpha.value)));
    }
    const out = {
      peak,
      hsl: layers.map((l) => l.material.uniforms.uColor.value.getHSL({})),
      width: layers.map((l) => l.material.uniforms.uWidthPx?.value ?? 0),
      glow: emit.mock.calls.map(([s]) => s).filter((s) => s.blend !== 'normal').map((s) => new THREE.Color(s.color).getHex()),
    };
    h.stop();
    pool.dispose();
    return out;
  };

  test('frost at intensity 2 keeps the die colour: no layer brighter than at intensity 1, same hues, alpha <= 1.5', () => {
    for (const color of ['#e02020', '#2050ff', '#f4f4f4', '#141418']) {
      const one = layersAt(1, color);
      const two = layersAt(2, color);
      expect(two.peak.length, color).toBe(one.peak.length);
      expect(Math.max(...one.peak), color).toBeGreaterThan(0.3);
      two.peak.forEach((p, i) => {
        // Brighter than intensity 1 would push the additive layers toward white: it may only grow.
        expect(p, `${color} layer ${i}`).toBeLessThanOrEqual(one.peak[i] * 1.001);
        expect(p, `${color} layer ${i}`).toBeLessThanOrEqual(1.5);
        expect(two.hsl[i].h, `${color} layer ${i} hue`).toBeCloseTo(one.hsl[i].h, 5);
        expect(two.hsl[i].s, `${color} layer ${i} saturation`).toBeCloseTo(one.hsl[i].s, 5);
        expect(two.width[i], `${color} layer ${i} width`).toBeGreaterThanOrEqual(one.width[i]);
      });
      expect(new Set(two.glow), color).toEqual(new Set(one.glow)); // no whiter additive particles
    }
  });
});

describe('fumble parts', () => {
  const isRibbon = (o) => !!o.material?.uniforms?.uWidthPx;
  const ribbonsOf = (scene) => {
    const out = [];
    scene.traverse((o) => isRibbon(o) && out.push(o));
    return out;
  };
  const play = (part, over = {}) => {
    const mod = FUMBLE_PARTS[part];
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 2048);
    const ctx = ctxFor(mod, { scene, pool, ...over });
    const emit = vi.spyOn(pool, 'emit');
    const h = mod.start(ctx);
    return { scene, pool, ctx, emit, h, specs: () => emit.mock.calls.map(([s]) => s) };
  };
  const lum = (c) => new THREE.Color(c).getHSL({}, THREE.SRGBColorSpace).l;

  test('fumble crack is a tapered ribbon that opens over ~200 ms', () => {
    const { scene, pool, h } = play('crack', { duration: 1000 });
    const ribbons = ribbonsOf(scene);
    expect(ribbons.length).toBeGreaterThanOrEqual(2); // a dark core and an ember edge glow
    const core = ribbons.find((r) => typeof r.userData.open === 'number');
    expect(core, 'the core ribbon exposes userData.open').toBeTruthy();
    // The core is dark: drawn "over" in black (src colour ignored), after (on top of) the glow.
    expect(core.material.blendSrc).toBe(THREE.ZeroFactor);
    const glow = ribbons.find((r) => r !== core && r.material.blendDst === THREE.OneFactor);
    expect(glow, 'an additive edge glow').toBeTruthy();
    expect(core.renderOrder).toBeGreaterThan(glow.renderOrder);
    for (let t = 0; t <= 100; t += 10) h.update(t);
    const half = core.userData.open;
    const halfCount = core.geometry.drawRange.count;
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.97);
    for (let t = 110; t <= 230; t += 10) h.update(t);
    expect(core.userData.open).toBe(1);
    expect(core.geometry.drawRange.count).toBeGreaterThan(halfCount);
    // Tapered: full width at the die, a fine point at each tip.
    const side = core.geometry.getAttribute('aSide').array;
    const drawn = [];
    for (let i = 0; i < core.geometry.drawRange.count; i++) drawn.push(Math.abs(side[core.geometry.index.array[i]]));
    expect(Math.max(...drawn)).toBeGreaterThan(0.9);
    expect(Math.min(...drawn)).toBeLessThan(0.35);
    // Opened: no more geometry rebuilds (CPU) for the rest of the play.
    const version = core.geometry.getAttribute('position').version;
    for (let t = 240; t < 1000; t += 10) h.update(t);
    expect(core.geometry.getAttribute('position').version).toBe(version);
    const planes = () => {
      let n = 0;
      scene.traverse((o) => o.geometry?.type === 'PlaneGeometry' && n++);
      return n;
    };
    expect(planes(), 'the ember underglow plane').toBe(1);
    h.stop();
    expect(ribbonsOf(scene)).toHaveLength(0);
    expect(planes(), 'the underglow is gone after stop()').toBe(0);
    pool.dispose();
  });

  test('fumble smoke uses PUFF, normal blend, at least 8 puffs at intensity 1', () => {
    const { pool, h, specs, ctx } = play('smoke');
    for (let t = 0; t <= ctx.duration; t += 20) h.update(t);
    const puffs = specs();
    expect(puffs.reduce((n, s) => n + s.count, 0)).toBeGreaterThanOrEqual(8);
    expect(puffs.every((s) => s.kind === KIND.SMOKE && s.shape === 2 && s.blend === 'normal')).toBe(true);
    h.stop();
    pool.dispose();
  });

  // What a colour looks like on screen: the pool writes its (linear) colour values straight to the
  // canvas, so a hex's linear components are its displayed sRGB values. Backdrops: the dark studio
  // table (#2b2f36) and the light parchment map (#e6d2a2), as displayed.
  const shown = (c) => {
    const { r, g, b } = new THREE.Color(c);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // A CSS backdrop's hex is already its displayed sRGB.
  const relLum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * ((n >> 16) & 255) / 255 + 0.7152 * ((n >> 8) & 255) / 255 + 0.0722 * (n & 255) / 255;
  };
  const DARK_TABLE = relLum('#2b2f36');
  const LIGHT_MAP = relLum('#e6d2a2');

  test('fumble smoke is a mid-tone plume that contrasts with both a dark table and a light map, in any colour', () => {
    for (const color of [null, '#f4f4f4', '#141418', '#e02020', '#2050ff']) {
      const over = color ? { color: new THREE.Color(color), options: { color } } : {};
      const { h, specs, pool } = play('smoke', over);
      for (let t = 0; t <= 1500; t += 20) h.update(t);
      const body = specs().filter((p) => p.kind === KIND.SMOKE && p.blend === 'normal');
      // The main plume (the first emit): clearly lighter than the dark table, clearly darker than the map.
      const main = body[0];
      expect(shown(main.color) - DARK_TABLE, `${color} vs dark table`).toBeGreaterThan(0.15);
      expect(LIGHT_MAP - shown(main.color), `${color} vs light map`).toBeGreaterThan(0.25);
      // Big, long-lived puffs that grow well past the die's footprint (one edge = 1) and last out
      // the effect; they rise (speed up) and then sag (gravity < 0).
      for (const p of body) {
        expect(p.size * p.sizeEnd, color).toBeGreaterThan(3);
        expect(p.life, color).toBeGreaterThanOrEqual(1.5);
        expect(p.gravity, color).toBeLessThan(0);
      }
      expect(main.speed, color).toBeGreaterThan(1.5);
      // Darker soot at the edges: a second, darker body of puffs.
      expect(body.some((p) => shown(p.color) < shown(main.color) - 0.1), `${color} soot`).toBe(true);
      h.stop();
      pool.dispose();
    }
  });

  test('fumble smoke keeps the die face clear: born outside its footprint, flying outward', () => {
    for (const reducedMotion of [false, true]) {
      const { h, specs, pool, ctx } = play('smoke', { reducedMotion });
      for (let t = 0; t <= 1500; t += 20) h.update(t);
      const puffs = specs().filter((p) => p.kind === KIND.SMOKE);
      expect(puffs.length).toBeGreaterThan(4);
      for (const p of puffs) {
        const ox = p.origin.x - ctx.position.x;
        const oz = p.origin.z - ctx.position.z;
        const r = Math.hypot(ox, oz);
        expect(r, 'born outside the die footprint').toBeGreaterThanOrEqual(0.6);
        // Heading away from the die: the horizontal part of dir points outward, and dominates the
        // cone (spread) so no puff drifts back over the die.
        const out = (p.dir.x * ox + p.dir.z * oz) / r;
        expect(out, 'outward').toBeGreaterThan(0);
        const tilt = Math.atan2(out, p.dir.y); // from vertical, toward outward
        expect(p.spread, 'cone stays outward').toBeLessThan(tilt);
        // Small at birth, so its soft edge does not reach back over the die (half an edge).
        expect(r - p.size / 2, 'edge clear of the die').toBeGreaterThanOrEqual(0.5);
      }
      h.stop();
      pool.dispose();
    }
  });

  test('fumble fizzle: a few sparks that fall and go dark', () => {
    const { pool, h, specs } = play('fizzle');
    h.update(0);
    const sparks = specs().filter((s) => s.blend !== 'normal');
    expect(sparks.length).toBeGreaterThan(0);
    expect(sparks.some((s) => s.kind === KIND.STREAK)).toBe(true);
    const n = sparks.reduce((k, s) => k + s.count, 0);
    expect(n).toBeGreaterThan(2);
    expect(n).toBeLessThanOrEqual(20); // a few, not a burst (ultra scales counts by 1.5)
    for (const s of sparks) {
      expect(s.gravity).toBeLessThan(0);
      expect(lum(s.colorEnd)).toBeLessThan(0.15);
    }
    h.stop();
    pool.dispose();
  });

  /** Crack ribbons and fizzle sparks: peak uAlpha, colour, width per ribbon, and additive spark colours. */
  const layersAt = (intensity, color) => {
    const over = { intensity, duration: 1000, color: new THREE.Color(color), options: { color } };
    const c = play('crack', over);
    const z = play('fizzle', over);
    const ribbons = ribbonsOf(c.scene);
    const peak = ribbons.map(() => 0);
    for (let t = 0; t < 1000; t += 10) {
      c.h.update(t);
      z.h.update(t);
      ribbons.forEach((r, i) => (peak[i] = Math.max(peak[i], r.material.uniforms.uAlpha.value)));
    }
    const out = {
      peak,
      hsl: ribbons.map((r) => r.material.uniforms.uColor.value.getHSL({})),
      width: ribbons.map((r) => r.material.uniforms.uWidthPx.value),
      glow: z.specs().filter((s) => s.blend !== 'normal').map((s) => new THREE.Color(s.color).getHex()),
    };
    c.h.stop();
    z.h.stop();
    return out;
  };

  test('fumble at intensity 2 keeps the die colour: crack and sparks no brighter than at 1, same hues, alpha <= 1.5', () => {
    for (const color of ['#5a5a60', '#e02020', '#2050ff', '#f4f4f4', '#141418']) {
      const one = layersAt(1, color);
      const two = layersAt(2, color);
      expect(two.peak.length, color).toBe(one.peak.length);
      expect(Math.max(...one.peak), color).toBeGreaterThan(0.3);
      two.peak.forEach((p, i) => {
        expect(p, `${color} ribbon ${i}`).toBeLessThanOrEqual(one.peak[i] * 1.001);
        expect(p, `${color} ribbon ${i}`).toBeLessThanOrEqual(1.5);
        expect(two.hsl[i].h, `${color} ribbon ${i} hue`).toBeCloseTo(one.hsl[i].h, 5);
        expect(two.hsl[i].s, `${color} ribbon ${i} saturation`).toBeCloseTo(one.hsl[i].s, 5);
        expect(two.width[i], `${color} ribbon ${i} width`).toBeGreaterThanOrEqual(one.width[i]);
      });
      expect(new Set(two.glow), color).toEqual(new Set(one.glow));
    }
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
    const { color: c0, colorEnd: c1 } = emit.mock.calls[0][0];
    expect(new THREE.Color(c1).getHSL({}).l).toBeLessThan(new THREE.Color(c0).getHSL({}).l); // it darkens as it ages
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

describe('inside flare (living insides round 3)', () => {
  // a die whose look has a moving inside: its material carries uInteriorFlare
  const insideDie = () => {
    const die = makeDie();
    die.uniforms.uInteriorFlare = { value: 0 };
    die.inner.material.userData.uniforms = die.uniforms;
    return die;
  };
  const FLARING = ['lightning', 'frost', 'fumble', 'celebrate', 'light-burst', 'shockwave', 'number-flare'];

  test.each(FLARING)('%s on a die with an inside raises uInteriorFlare, then lets it fall to 0', (id) => {
    const mod = EFFECTS[id];
    const die = insideDie();
    const ctx = ctxFor(mod, { die, setting: () => undefined });
    const base = ctx.scene.children.length;
    const h = mod.start(ctx);
    let peak = 0;
    for (let t = 0; t <= 400; t += 20) {
      h.update(t);
      peak = Math.max(peak, die.uniforms.uInteriorFlare.value);
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(1);
    for (let t = 420; h.update(t); t += 50);
    h.stop();
    expect(die.uniforms.uInteriorFlare.value).toBe(0);
    expect(ctx.scene.children.length).toBe(base);
  });

  test('lightning/frost/fumble on a die with an inside raise uInteriorFlare; off: no write', () => {
    for (const id of ['lightning', 'frost', 'fumble']) {
      const die = insideDie();
      const ctx = ctxFor(EFFECTS[id], { die, setting: (k) => (k === 'insideFlare' ? false : undefined) });
      const h = EFFECTS[id].start(ctx);
      for (let t = 0; t <= 300; t += 20) h.update(t);
      expect(die.uniforms.uInteriorFlare.value, id).toBe(0);
      h.stop();
    }
  });

  test('a die without a moving inside is never isolated for the flare (light-burst, shockwave)', () => {
    for (const id of ['light-burst', 'shockwave']) {
      const die = makeDie();
      const isolate = vi.fn(() => die.uniforms);
      const ctx = ctxFor(EFFECTS[id], { die, isolate, setting: () => undefined });
      const h = EFFECTS[id].start(ctx);
      for (let t = 0; t <= 200; t += 20) h.update(t);
      expect(isolate, id).not.toHaveBeenCalled();
      expect(die.uniforms.uInteriorFlare).toBeUndefined();
      h.stop();
    }
  });

  test('layer.flare (the public hook): shared envelope, true only for dice with an inside, off setting false', async () => {
    for (const on of [true, false]) {
      const die = insideDie();
      const plain = makeDie();
      const layer = createEffectLayer({
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
        canvas: { style: {} },
        getTier: () => TIERS.ultra,
        getSetting: (k) => (k === 'insideFlare' ? on : undefined),
        loadLibrary: async () => ({ EFFECTS, createParticlePool, flareRolls }),
        isolate: (d) => d.uniforms,
        matchMedia: () => ({ matches: false }),
      });
      expect(layer.flare([{ dice: [die] }], { amount: 1, duration: 900 })).toBe(false); // library not in yet
      await layer.prefetch();
      expect(layer.flare([{ dice: [plain] }], { amount: 1, duration: 900 })).toBe(false);
      expect(layer.flare([{ dice: [plain, die] }], { die: 0 })).toBe(false); // the index picks the plain one
      expect(layer.flare([{ dice: [plain, die] }], { die: 7 })).toBe(false);
      expect(layer.flare([{ dice: [plain, die] }])).toBe(on);
      layer.update(0);
      layer.update(100);
      expect(die.uniforms.uInteriorFlare.value).toBeGreaterThan(on ? 0.5 : -1);
      if (!on) expect(die.uniforms.uInteriorFlare.value).toBe(0);
      layer.releaseDie(die);
      expect(die.uniforms.uInteriorFlare.value).toBe(0);
      layer.dispose();
    }
  });

  test('layer.flare (the public hook): null opts do not throw; the master effects setting off returns false', async () => {
    for (const effects of [true, false]) {
      const die = insideDie();
      const layer = createEffectLayer({
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
        canvas: { style: {} },
        getTier: () => TIERS.ultra,
        getSetting: (k) => (k === 'effects' ? effects : undefined),
        loadLibrary: async () => ({ EFFECTS, createParticlePool, flareRolls }),
        isolate: (d) => d.uniforms,
        matchMedia: () => ({ matches: false }),
      });
      await layer.prefetch();
      expect(() => layer.flare([{ dice: [die] }], null)).not.toThrow();
      expect(layer.flare([{ dice: [die] }], undefined)).toBe(effects);
      expect(layer.flare([{ dice: [die] }], null)).toBe(effects);
      layer.dispose();
    }
  });

  test('through the layer: the insideFlare setting reaches the flare (off: no write)', async () => {
    for (const on of [true, false]) {
      const die = insideDie();
      const layer = createEffectLayer({
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
        canvas: { style: {} },
        getTier: () => TIERS.ultra,
        getSetting: (k) => (k === 'insideFlare' ? on : undefined),
        loadLibrary: async () => ({ EFFECTS, createParticlePool }),
        isolate: (d) => d.uniforms,
        matchMedia: () => ({ matches: false }),
      });
      await layer.prefetch();
      layer.play(die, [{ effect: { id: 'lightning' } }]);
      layer.update(0);
      layer.update(100);
      if (on) expect(die.uniforms.uInteriorFlare.value).toBeGreaterThan(0.5);
      else expect(die.uniforms.uInteriorFlare.value).toBe(0);
      layer.dispose();
      expect(die.uniforms.uInteriorFlare.value).toBe(0);
    }
  });
});

test('number-flare (intensity 2.5) under reduced motion: the inside flare still rises softly (< 0.5 at 80 ms)', () => {
  const die = makeDie();
  die.uniforms.uInteriorFlare = { value: 0 };
  die.inner.material.userData.uniforms = die.uniforms;
  const mod = EFFECTS['number-flare'];
  const ctx = ctxFor(mod, { die, reducedMotion: true, setting: () => undefined });
  expect(ctx.intensity).toBe(2.5);
  const h = mod.start(ctx);
  h.update(0);
  h.update(80);
  expect(die.uniforms.uInteriorFlare.value).toBeLessThan(0.5);
  h.update(300);
  expect(die.uniforms.uInteriorFlare.value).toBeGreaterThan(0.9);
  h.update(600);
  expect(die.uniforms.uInteriorFlare.value).toBeLessThan(0.7); // decaying, no plateau at 1
  h.stop();
});

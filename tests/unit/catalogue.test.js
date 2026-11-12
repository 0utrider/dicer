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

test('lightning regenerates its arcs every 60 ms', () => {
  const scene = new THREE.Scene();
  const pool = createParticlePool(scene, 16);
  const base = scene.children.length;
  const h = EFFECTS.lightning.start(ctxFor(EFFECTS.lightning, { scene, pool }));
  const pos = scene.children[base].geometry.getAttribute('position');
  h.update(0);
  const a = Array.from(pos.array);
  h.update(30);
  expect(Array.from(pos.array)).toEqual(a);
  h.update(70);
  expect(Array.from(pos.array)).not.toEqual(a);
  h.stop();
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
    expect(scene.children.length - base).toBe(2); // light-burst + the free floor glow
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
    expect(scene.children.length - base).toBe(3); // light-burst + floor glow + shockwave
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
    expect(meshes(scene, base)).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
    expect(shakes).toHaveLength(0);
    h.update(130);
    expect(meshes(scene, base)).toHaveLength(3); // light-burst, floor glow, shockwave
    expect(kinds(emit)).toEqual([KIND.STREAK]);
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

  test('the shared pool is created lazily at round(2048 x particleScale) and counted once', async () => {
    const { layer, scene, die } = layerFor('medium');
    await layer.prefetch();
    expect(scene.children).toHaveLength(0);
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

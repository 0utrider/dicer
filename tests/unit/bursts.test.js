import * as THREE from 'three';
import { BURSTS, burstFor } from '../../src/effects/library/bursts.js';
import { EFFECTS, createParticlePool } from '../../src/effects/library/index.js';
import { TIERS } from '../../src/render/quality.js';
import { EFFECT_IDS } from '../../src/effects/effect-ids.js';
import { KNOWN_EFFECTS } from '../../src/themes/themes.js';
import { ELEMENTS } from '../../src/effects/elements.js';
import { ELEMENTS as TRAIL_ELEMENTS } from '../../src/effects/library/trails.js';

const BUILT = ['burst-fire', 'burst-frost', 'burst-storm', 'burst-lava'];
const fireInside = { interior: { type: 'fire' } };
const nat20 = (over = {}) => ({ type: 'd20', value: 20, trail: 2, appearance: fireInside, ...over });

describe('burstFor', () => {
  test('a fire-inside d20 landing a 20 with trail 2 bursts in fire', () => {
    expect(burstFor(nat20())).toEqual({
      ruleId: 'element:fire',
      effect: { id: 'burst-fire' },
      sound: null,
      macro: null,
      slowMotion: false,
    });
  });
  test('the element comes from the damage type when the inside has none', () => {
    expect(burstFor(nat20({ appearance: { interior: { type: 'none' } }, damageType: 'cold' }))?.effect.id).toBe('burst-frost');
    expect(burstFor(nat20({ appearance: undefined, damageType: 'acid' }))?.effect.id).toBe('burst-acid');
  });
  test('no burst: trail 1 (a discarded result), trail 0, a d12 on 12, a d20 on 19, no element', () => {
    expect(burstFor(nat20({ trail: 1 }))).toBeNull();
    expect(burstFor(nat20({ trail: 0 }))).toBeNull();
    expect(burstFor(nat20({ type: 'd12', value: 12 }))).toBeNull();
    expect(burstFor(nat20({ value: 19 }))).toBeNull();
    expect(burstFor(nat20({ appearance: { interior: { type: 'none' } } }))).toBeNull();
    expect(burstFor(null)).toBeNull();
  });
  test('elementalCritBursts false: none; three bursts already running: none (the cap)', () => {
    const off = (k) => (k === 'elementalCritBursts' ? false : undefined);
    expect(burstFor(nat20(), [], off)).toBeNull();
    expect(burstFor(nat20(), [], () => undefined)?.effect.id).toBe('burst-fire');
    const two = [{ id: 'burst-fire' }, { id: 'light-burst' }, { id: 'burst-lava' }];
    expect(burstFor(nat20(), two, () => undefined)?.effect.id).toBe('burst-fire');
    const three = [...two, { id: 'burst-storm' }];
    expect(burstFor(nat20(), three, () => undefined)).toBeNull();
  });
});

test('one element list: the world-start list is the trail list', () => {
  expect(TRAIL_ELEMENTS).toBe(ELEMENTS);
  expect(ELEMENTS).toHaveLength(16);
});

test('EFFECT_IDS and KNOWN_EFFECTS contain all sixteen burst ids', () => {
  for (const el of ELEMENTS) {
    expect(EFFECT_IDS).toContain(`burst-${el}`);
    expect(KNOWN_EFFECTS).toContain(`burst-${el}`);
  }
});

test('BURSTS holds the built bursts in the library contract, merged into EFFECTS', () => {
  expect(Object.keys(BURSTS).sort()).toEqual([...BUILT].sort());
  for (const id of BUILT) {
    const m = BURSTS[id];
    expect(m.id).toBe(id);
    expect(m.cost).toBe(1);
    expect(m.defaults.duration).toBeGreaterThan(0);
    expect(typeof m.start).toBe('function');
    expect(EFFECTS[id]).toBe(m);
  }
});

function makeDie(inside = false) {
  const outer = new THREE.Group();
  outer.position.set(1, 0.5, -2);
  const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95), new THREE.MeshBasicMaterial());
  outer.add(inner);
  const uniforms = { uFxTint: { value: new THREE.Vector4() }, uFxFlare: { value: new THREE.Vector3() } };
  if (inside) {
    uniforms.uInteriorFlare = { value: 0 };
    inner.material.userData.uniforms = uniforms;
  }
  return { outer, inner, uniforms };
}

function ctxFor(mod, { tier = 'ultra', reducedMotion = false, die = makeDie(), scene = new THREE.Scene() } = {}) {
  const pool = createParticlePool(scene, 2048);
  return {
    scene,
    camera: new THREE.PerspectiveCamera(),
    die,
    position: die.outer.position.clone(),
    color: new THREE.Color(mod.defaults.color),
    intensity: mod.defaults.intensity,
    duration: mod.defaults.duration,
    options: {},
    particles: pool,
    isolate: () => die.uniforms,
    shake: () => {},
    tier: TIERS[tier],
    reducedMotion,
    setting: () => undefined,
  };
}

/** A flash: an additive particle that sits still (no speed) and is at least one die edge big. */
const isFlash = (s) => s.blend !== 'normal' && !(s.speed > 0) && s.size >= 1;

function emitsOf(id, opts) {
  const mod = BURSTS[id];
  const ctx = ctxFor(mod, opts);
  const emit = vi.spyOn(ctx.particles, 'emit');
  const base = ctx.scene.children.length;
  const h = mod.start(ctx);
  for (let t = 0; t < ctx.duration; t += 16) h.update(t);
  expect(h.update(ctx.duration)).toBe(false);
  h.stop();
  expect(ctx.scene.children.length).toBe(base);
  ctx.particles.dispose();
  return emit.mock.calls.map(([s]) => s);
}

describe.each(BUILT)('%s', (id) => {
  test('the full form flashes and emits plenty, every emit with its now', () => {
    const specs = emitsOf(id);
    expect(specs.some(isFlash)).toBe(true);
    expect(specs.reduce((n, s) => n + s.count, 0)).toBeGreaterThan(60);
    for (const s of specs) expect(Number.isFinite(s.now)).toBe(true);
  });
  test.each([
    ['reduced motion', { reducedMotion: true }],
    ['effectBudget 2 (low)', { tier: 'low' }],
  ])('%s: the reduced form, a soft swell with no flash particle', (_, opts) => {
    expect(TIERS.low.effectBudget).toBeLessThanOrEqual(2);
    const specs = emitsOf(id, opts);
    expect(specs.filter(isFlash)).toEqual([]);
  });
  test('flares the die’s inside (isolate + flare like light-burst), then lets it fall to 0', () => {
    for (const opts of [{}, { reducedMotion: true }]) {
      const die = makeDie(true);
      const ctx = ctxFor(BURSTS[id], { ...opts, die });
      const h = BURSTS[id].start(ctx);
      let peak = 0;
      for (let t = 0; t <= 500; t += 20) {
        h.update(t);
        peak = Math.max(peak, die.uniforms.uInteriorFlare.value);
      }
      expect(peak).toBeGreaterThan(0.5);
      for (let t = 520; h.update(t); t += 50);
      h.stop();
      expect(die.uniforms.uInteriorFlare.value).toBe(0);
    }
  });
  test('the core clears the die face by about 1 s: no particle born after 400 ms within the die', () => {
    // Anything emitted late must be born outside the die's footprint (seen from above).
    const mod = BURSTS[id];
    const ctx = ctxFor(mod);
    const late = [];
    vi.spyOn(ctx.particles, 'emit').mockImplementation((s) => late.push(s));
    const h = mod.start(ctx);
    let t0 = null;
    for (let t = 1000; t < 1000 + ctx.duration; t += 16) {
      t0 ??= t;
      const before = late.length;
      h.update(t);
      if (t - t0 < 400) late.splice(before);
    }
    h.stop();
    for (const s of late) {
      const d = Math.hypot(s.origin.x - ctx.position.x, s.origin.z - ctx.position.z);
      expect(d, JSON.stringify(s.origin)).toBeGreaterThanOrEqual(0.9);
    }
  });
});

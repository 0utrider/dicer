import * as THREE from 'three';
import { BURSTS, BURST_CAP, burstFor, withBursts } from '../../src/effects/library/bursts.js';
import { EFFECTS, createParticlePool } from '../../src/effects/library/index.js';
import { TIERS } from '../../src/render/quality.js';
import { EFFECT_IDS } from '../../src/effects/effect-ids.js';
import { KNOWN_EFFECTS } from '../../src/themes/themes.js';
import { ELEMENTS } from '../../src/effects/elements.js';
import { ELEMENTS as TRAIL_ELEMENTS } from '../../src/effects/library/trails.js';
import { KIND } from '../../src/effects/library/particles.js';
import { SHAPE } from '../../src/effects/library/shapes.js';

const BUILT = ELEMENTS.map((e) => `burst-${e}`);
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

describe('withBursts (the layer\u2019s one burst entry: the cap for every burst, no duplicate)', () => {
  const rule = (id) => ({ ruleId: 'r', effect: { id }, sound: null });
  const runningOf = (n) => Array.from({ length: n }, () => ({ id: 'burst-lava' }));
  test('appends the automatic burst to the die\u2019s fx (null or [] too)', () => {
    expect(withBursts(nat20(), [rule('a')], [], () => undefined).map((f) => f.effect.id)).toEqual(['a', 'burst-fire']);
    expect(withBursts(nat20(), null, [], () => undefined).map((f) => f.effect.id)).toEqual(['burst-fire']);
    expect(withBursts(nat20({ value: 19 }), null, [], () => undefined)).toEqual([]);
  });
  test('no duplicate: fx that already holds a burst-* gets no automatic one', () => {
    const fx = [rule('burst-acid'), rule('a')];
    expect(withBursts(nat20(), fx, [], () => undefined).map((f) => f.effect.id)).toEqual(['burst-acid', 'a']);
  });
  test('a rule-picked burst is skipped while BURST_CAP bursts run; other fx stay', () => {
    expect(BURST_CAP).toBe(3);
    const fx = [rule('burst-acid'), rule('a')];
    expect(withBursts({}, fx, runningOf(2), () => undefined).map((f) => f.effect.id)).toEqual(['burst-acid', 'a']);
    expect(withBursts({}, fx, runningOf(3), () => undefined).map((f) => f.effect.id)).toEqual(['a']);
    // the bursts of one fx list count too
    const many = [rule('burst-acid'), rule('burst-void'), rule('burst-fire')];
    expect(withBursts({}, many, runningOf(1), () => undefined).map((f) => f.effect.id)).toEqual(['burst-acid', 'burst-void']);
  });
  test('never throws: bad input gives the fx back', () => {
    expect(withBursts(null, undefined, null, null)).toEqual([]);
    const odd = [null, { effect: null }, rule('a')];
    expect(withBursts(nat20(), odd, undefined, () => undefined).map((f) => f?.effect?.id)).toEqual([undefined, undefined, 'a', 'burst-fire']);
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

test('every element has its burst: BURSTS holds exactly one burst-<element> per id in ELEMENTS', () => {
  for (const el of ELEMENTS) expect(BURSTS[`burst-${el}`], el).toBeDefined();
  expect(Object.keys(BURSTS)).toHaveLength(ELEMENTS.length);
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

test('catalogue.js shares with bursts.js exactly what bursts.js imports (no unused exports)', async () => {
  const { readFileSync } = await import('node:fs');
  const names = (block) => block.split(',').map((s) => s.trim()).filter(Boolean).sort();
  const src = readFileSync('src/effects/library/bursts.js', 'utf8');
  const imported = names(src.match(/import \{([^}]*)\} from '\.\/catalogue\.js'/)[1]);
  const cat = readFileSync('src/effects/library/catalogue.js', 'utf8');
  const shared = names(cat.match(/\nexport \{([^}]*)\};/)[1]);
  const directly = [...cat.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
  const offered = [...shared, ...directly];
  for (const n of imported) expect(offered, n).toContain(n);
  expect(shared.filter((n) => !imported.includes(n))).toEqual([]);
});

test('the visual trails sheet lands its dice on 19 (no burst); the bursts sheet keeps 20', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('tests/visual/trails.mjs', 'utf8');
  const body = (fn) => src.slice(src.indexOf(`async function ${fn}(`), src.indexOf('\n}\n', src.indexOf(`async function ${fn}(`)));
  expect(body('capture')).toMatch(/value: 19/);
  expect(body('capture')).not.toMatch(/value: 20/);
  expect(body('captureBurst')).toMatch(/value: 20/);
});

describe('each new burst reads as its element', () => {
  const at = { x: 1, z: -2 }; // makeDie's position
  const inward = (s) => s.dir && (at.x - s.origin.x) * s.dir.x + (at.z - s.origin.z) * s.dir.z > 0;
  test('acid: green droplets that land on the table, then hissing smoke', () => {
    const specs = emitsOf('burst-acid');
    expect(specs.some((s) => s.floor !== undefined && s.kind === KIND.SPARK)).toBe(true);
    expect(specs.some((s) => s.kind === KIND.SMOKE && s.blend === 'normal')).toBe(true);
  });
  test('void: smoke pulled in toward the die first, then thrown out', () => {
    const specs = emitsOf('burst-void');
    const smoke = specs.filter((s) => s.shape === SHAPE.SMOKE);
    expect(smoke.some(inward)).toBe(true);
    expect(smoke.some((s) => !inward(s))).toBe(true);
    expect(smoke.findIndex(inward)).toBeLessThan(smoke.findIndex((s) => !inward(s)));
  });
  test('vitality: golden light shafts and rising motes', () => {
    const specs = emitsOf('burst-vitality');
    expect(specs.some((s) => s.kind === KIND.STREAK)).toBe(true);
    expect(specs.some((s) => s.kind === KIND.EMBER && s.gravity > 0)).toBe(true);
  });
  test('poison: a cloud (mostly smoke puffs), no droplets', () => {
    const specs = emitsOf('burst-poison');
    const n = (f) => specs.filter(f).reduce((m, s) => m + s.count, 0);
    expect(n((s) => s.kind === KIND.SMOKE)).toBeGreaterThan(50);
    expect(specs.some((s) => s.floor !== undefined)).toBe(false);
  });
  test('sonic: a thunderclap of sound rings stacked at several heights, and no screen shake', () => {
    const mod = BURSTS['burst-sonic'];
    for (const opts of [{}, { reducedMotion: true }]) {
      const ctx = ctxFor(mod, opts);
      ctx.shake = vi.fn();
      const h = mod.start(ctx);
      for (let t = 0; h.update(t); t += 16);
      h.stop();
      ctx.particles.dispose();
      expect(ctx.shake).not.toHaveBeenCalled();
    }
    const rings = emitsOf('burst-sonic').filter((s) => s.shape === SHAPE.RING);
    expect(new Set(rings.map((s) => s.origin.y.toFixed(2))).size).toBeGreaterThanOrEqual(3);
    expect(rings.reduce((n, s) => n + s.count, 0)).toBeGreaterThanOrEqual(8);
  });
  test('force: a sphere round the die that is gone by about 0.5 s, then shards flung out', () => {
    const mod = BURSTS['burst-force'];
    const ctx = ctxFor(mod);
    const spheres = () => {
      const out = [];
      ctx.scene.traverse((o) => o.geometry?.type === 'SphereGeometry' && o.visible && out.push(o));
      return out;
    };
    const h = mod.start(ctx);
    h.update(0);
    h.update(120);
    expect(spheres().length).toBeGreaterThan(0);
    for (let t = 136; t <= 520; t += 16) h.update(t);
    expect(spheres()).toEqual([]);
    for (let t = 536; h.update(t); t += 16);
    h.stop();
    ctx.particles.dispose();
    const shards = emitsOf('burst-force').filter((s) => s.kind === KIND.SHARD && s.speed > 0);
    expect(shards.reduce((n, s) => n + s.count, 0)).toBeGreaterThan(40);
  });
  test('mental: pink swirls spiralling out, and rings', () => {
    const specs = emitsOf('burst-mental');
    const swirls = specs.filter((s) => s.kind === KIND.SPIRAL && s.speed > 0 && !inward(s));
    expect(swirls.reduce((n, s) => n + s.count, 0)).toBeGreaterThan(30);
    expect(specs.some((s) => s.shape === SHAPE.RING)).toBe(true);
  });
  test('spirit: cyan wisps rising in a spiral', () => {
    const specs = emitsOf('burst-spirit');
    const rising = specs.filter((s) => s.kind === KIND.SPIRAL && s.shape === SHAPE.SMOKE && s.gravity > 0);
    expect(rising.reduce((n, s) => n + s.count, 0)).toBeGreaterThan(20);
  });
  const n = (specs, f) => specs.filter(f).reduce((m, s) => m + s.count, 0);
  const red = (hex) => {
    const c = new THREE.Color(hex);
    return c.r > 2 * c.g && c.r > 2 * c.b;
  };
  test('bleed: red droplets arcing out that land, splats lying still on the table, no smoke', () => {
    const specs = emitsOf('burst-bleed');
    const drops = specs.filter((s) => s.floor !== undefined && s.speed > 0 && s.gravity < 0 && s.dir?.y > 0 && red(s.color));
    expect(n(drops, () => true)).toBeGreaterThan(40);
    // A splat: born on the table, still, red, outliving the spray.
    const splats = specs.filter((s) => !(s.speed > 0) && s.origin.y < 0.15 && red(s.color) && s.life >= 0.6);
    expect(n(splats, () => true)).toBeGreaterThan(10);
    expect(specs.some((s) => s.kind === KIND.SMOKE)).toBe(false);
  });
  test('slashing: two crossed silver arcs over the die (ribbons), gone by about 0.6 s', () => {
    const mod = BURSTS['burst-slashing'];
    const ctx = ctxFor(mod);
    const ribbons = () => {
      const out = [];
      ctx.scene.traverse((o) => o.geometry?.getAttribute?.('aSide') && o.visible && o.geometry.drawRange.count > 0 && o.material.uniforms.uAlpha.value > 0.01 && out.push(o));
      return out;
    };
    const h = mod.start(ctx);
    h.update(0);
    for (let t = 16; t <= 160; t += 16) h.update(t);
    const lit = ribbons();
    expect(lit.length).toBeGreaterThanOrEqual(2);
    // The arcs cross: their lines run in clearly different directions over the table.
    const dirs = new Set();
    ctx.scene.traverse((o) => {
      const p = o.geometry?.getAttribute?.('aSide') && o.geometry.getAttribute('position');
      if (!p || o.geometry.drawRange.count === 0) return;
      const n0 = 0;
      const n1 = o.geometry.drawRange.count > 6 ? 4 : 2;
      dirs.add(Math.round((Math.atan2(p.getZ(n1) - p.getZ(n0), p.getX(n1) - p.getX(n0)) * 4) / Math.PI));
    });
    expect(dirs.size).toBeGreaterThanOrEqual(2);
    for (let t = 176; t <= 620; t += 16) h.update(t);
    expect(ribbons()).toEqual([]);
    for (let t = 636; h.update(t); t += 16);
    h.stop();
    ctx.particles.dispose();
    const specs = emitsOf('burst-slashing');
    expect(specs.some((s) => s.shape === SHAPE.RING)).toBe(false);
  });
  test('piercing: a ring of needle streaks thrust out evenly, flat and straight', () => {
    const specs = emitsOf('burst-piercing');
    const needles = specs.filter((s) => s.kind === KIND.STREAK && s.stretch >= 3 && s.speed > 0 && !(s.gravity < 0) && Math.abs(s.dir.y) < 0.15);
    expect(n(needles, () => true)).toBeGreaterThanOrEqual(24);
    // Evenly round the die: every 45-degree sector holds needles.
    const sectors = new Set(needles.map((s) => Math.floor(((Math.atan2(s.dir.z, s.dir.x) + Math.PI) / (2 * Math.PI)) * 8) % 8));
    expect(sectors.size).toBe(8);
    expect(specs.some((s) => s.kind === KIND.SPIRAL)).toBe(false);
  });
  test('bludgeoning: a ring of dust rolling out low, grit thrown out that falls, no gold sound ring', () => {
    const specs = emitsOf('burst-bludgeoning');
    const dust = specs.filter((s) => s.kind === KIND.SMOKE && s.blend === 'normal' && s.origin.y < 0.5 && Math.abs(s.dir.y) < 0.3);
    expect(n(dust, () => true)).toBeGreaterThan(20);
    const grit = specs.filter((s) => s.kind === KIND.SHARD && s.floor !== undefined && s.gravity < 0);
    expect(n(grit, () => true)).toBeGreaterThan(30);
    // A distinct impact: heavier than the shockwave's twelve faint puffs.
    expect(Math.max(...dust.map((s) => s.alpha ?? 1))).toBeGreaterThan(0.35);
  });
});

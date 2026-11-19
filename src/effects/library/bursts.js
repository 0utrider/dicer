import * as THREE from 'three';
import { timed } from './die-effects.js';
import { KIND } from './particles.js';
import { SHAPE } from './shapes.js';
import { createRibbon } from './ribbon.js';
import { withInsideFlare } from './inside-flare.js';
import { elementOf } from './trails.js';
import { expandScenes } from './scene-stubs.js';
import {
  ALPHA_CAP,
  BURST_FRAGMENT,
  BURST_UNIFORMS,
  DIE_TOP,
  DIE_Y,
  FLOOR_Y,
  RING_FRAGMENT,
  SHADOW_BLEND,
  countFor,
  dieRadius,
  floorGlow,
  frostPatchMaterial,
  jagged,
  quadMaterial,
  scoped,
  sizeK,
  together,
} from './catalogue.js';

/**
 * Elemental crit bursts: when a die with an element lands as a natural 20, a big burst in its
 * element plays at the die, alongside (and bigger than) its other landing effects. Each burst is an
 * ordinary library effect `burst-<element>` (contract in ../effect-layer.js): picked in a trigger
 * rule or a celebration it plays its own element on any die. The automatic one comes from
 * burstFor(), which the effect layer asks on every play().
 *
 * Every burst has two forms. The full one: a flash, the element's big parts (below), a floor glow
 * and the die's inside flaring. The reduced one (reduced motion, or the lowest effect budget): one
 * soft swell of light in the element's colours, no flash, no flicker. Either way the core over the
 * die face is gone by about 1 s; what lasts longer (smoke, embers, frost on the table) is born
 * outside the die's footprint.
 *
 * Bursts use their element's own colours (ctx.color is ignored), intensity scales size and count.
 */

/** At most this many `burst-*` effects run at once; an automatic burst past it is skipped. */
export const BURST_CAP = 3;

/**
 * The automatic crit burst of a landed die, as an Fx for the layer to append, or null. Only a d20
 * whose active result is 20 (trail 2: an active result whose effects this client shows) with an
 * element (elementOf). With `running` (the layer's running effects, each { id }) and `setting`:
 * null when elementalCritBursts is off or BURST_CAP bursts already run. Never throws.
 */
export function burstFor(die, running, setting) {
  try {
    if (die?.trail !== 2 || die.type !== 'd20' || die.value !== 20) return null;
    if (setting?.('elementalCritBursts') === false) return null;
    const el = elementOf(die.appearance, die.damageType);
    if (!el) return null;
    if (running && running.filter((r) => String(r?.id).startsWith('burst-')).length >= BURST_CAP) return null;
    return { ruleId: `element:${el}`, effect: { id: `burst-${el}` }, sound: null, macro: null, slowMotion: false };
  } catch {
    return null;
  }
}

const isBurst = (f) => String(f?.effect?.id).startsWith('burst-');

/** The dice that already got their automatic burst: a hand die is played at landing and again when decorated. */
const autoBurst = new WeakSet();

/**
 * The layer's one burst entry (play() runs every die's fx through it): `fx` (Fx[], null or []) as
 * a new list where every `burst-*` effect, rule-picked or automatic, is dropped once BURST_CAP
 * bursts run (those in `running` plus those kept ahead of it in the list), and the automatic burst
 * (burstFor) is appended unless fx already holds a burst or the die had its automatic burst
 * already (once per die). Never throws: on bad input, fx back.
 */
export function withBursts(die, fx, running, setting) {
  try {
    // a rule's scene picked beside its effect plays as an effect of its own (scene-stubs.js)
    const list = expandScenes(Array.isArray(fx) ? fx : []);
    let n = (running || []).filter((r) => String(r?.id).startsWith('burst-')).length;
    const out = list.filter((f) => !isBurst(f) || n++ < BURST_CAP);
    // a crit scene (scene-*) is the die's show: no automatic burst over it
    const scene = list.some((f) => String(f?.effect?.id).startsWith('scene-'));
    const auto = !scene && !list.some(isBurst) && !autoBurst.has(die) && burstFor(die, running, setting);
    if (auto) out.push(auto), autoBurst.add(die);
    return out;
  } catch {
    return fx;
  }
}

const C = (hex) => new THREE.Color(hex);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) ** 3;
const rand = (a, b) => a + (b - a) * Math.random();
const TAU = Math.PI * 2;

/** The reduced form: reduced motion or the lowest effect budget (the low tier). */
const reducedOf = (ctx) => !!ctx.reducedMotion || (ctx.tier?.effectBudget ?? Infinity) <= 2;

/** Growth with intensity: gentle (sqrt), at most 1.5 x the intensity-1 size. */
const growOf = (ctx) => Math.min(1.5, sizeK(ctx));
/** Brightness with intensity, capped at 1: past it additive layers wash out to white. */
const brightOf = (ctx) => Math.min(1, Math.max(0, ctx.intensity));

/**
 * A billboard bloom halo over the die (catalogue's BURST_FRAGMENT, light-burst's look): `core`
 * at the centre through `color` to `deep` at the rim, `rays` god-rays, `shade` a dark band under
 * it so it reads on a light map. Returns its uniforms and mesh; `scope` removes it.
 */
function halo(ctx, scope, { core, color, deep, rays = 0, shade = 0 }) {
  const material = quadMaterial(BURST_FRAGMENT, C(color), {
    ...BURST_UNIFORMS,
    uBloom: 1,
    uRays: rays,
    uCore: C(core),
    uDeep: C(deep),
    uShade: shade,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.position.set(ctx.position.x, DIE_Y + 0.6, ctx.position.z);
  if (ctx.camera?.quaternion) mesh.quaternion.copy(ctx.camera.quaternion);
  mesh.renderOrder = 3;
  scope.add(mesh);
  return { mesh, u: material.uniforms };
}

/**
 * The halo's burst: it blooms out to `reach` (x the quad) fast, flashes, holds a little and is
 * gone by `gone` ms (the die face is clear again), rays thinning out with it. `level()` scales it
 * (a storm flickers).
 */
function bloom(h, { grow, reach, gone, level = () => 1, from = 0.8 }) {
  return (e) => {
    const k = clamp01(e / gone);
    h.mesh.scale.setScalar(grow * (from + (reach - from) * (1 - Math.exp(-9 * k))));
    const fade = clamp01((k - 0.2) / 0.8);
    h.u.uAlpha.value = Math.min(ALPHA_CAP, 1.25 * level() * (1 - smooth(fade)));
    h.u.uRayAlpha.value = 1.8 * clamp01(e / 60) * (1 - k) ** 2;
    h.u.uSpin.value = 0.0004 * e;
  };
}

/**
 * A crisp ring running out over the table (catalogue's RING_FRAGMENT), quad `size` across: hot
 * edge `hot`, body `color`, trail `deep`; out to its rim over `ms`, fading as it goes. `y`: its
 * height (the table by default; sonic hangs rings in the air over the die).
 */
function floorRing(ctx, scope, { hot, color, deep, size, ms, level = 1, edge = 0.014, noise = 0.5, band = 0.6, blend, y = FLOOR_Y }) {
  const material = quadMaterial(RING_FRAGMENT, C(color), {
    uHot: C(hot),
    uDeep: C(deep),
    uR: 0,
    uAlpha2: 0,
    uR2: 0,
    uEdge: edge,
    uNoise: noise,
    uTrail: 0.35,
    uBand: band,
    uSeed: Math.random() * 50,
  });
  // `blend` (SHADOW_BLEND): the ring darkens the table instead of lighting it (void's dark ring).
  if (blend) Object.assign(material, blend);
  const u = material.uniforms;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(ctx.position.x, y, ctx.position.z);
  mesh.scale.setScalar(size);
  mesh.renderOrder = y > FLOOR_Y ? 2 : 1;
  scope.add(mesh);
  return (e) => {
    const k = clamp01(e / ms);
    u.uR.value = 0.05 + 0.92 * easeOut(k);
    u.uAlpha.value = Math.min(ALPHA_CAP, level * clamp01(e / 40) * (1 - k) ** 1.4);
    const k2 = clamp01((e - 70) / ms);
    u.uR2.value = 0.05 + 0.8 * easeOut(k2);
    u.uAlpha2.value = e > 70 ? Math.min(ALPHA_CAP, 0.5 * level * (1 - k2) ** 1.4) : 0;
  };
}

/** A floor glow decal in `color` (catalogue's floorGlow); `curve(e)` 0..1 shapes it. */
const glowOf = (ctx, color, opts) => floorGlow(Object.create(ctx, { color: { value: C(color) }, intensity: { value: brightOf(ctx) } }), opts);

/**
 * Emits `n` particles one by one, each its own direction: out along a random bearing with an
 * outward share `out` and an upward share `up` (each a [min, max] range), at `speed` (a range, x
 * the die radius R), from the die's centre (inside the opaque die, so seen from above each shows
 * as it bursts out past the die) or, with `ring` ([min, max] x R), from a ring around it.
 */
function fling(ctx, now, n, { out = [1, 1], up = [0, 0], speed, ring, y = DIE_Y + 0.1, R, ...spec }) {
  const { x: cx, z: cz } = ctx.position;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    const r = ring ? rand(ring[0], ring[1]) * R : 0;
    const o = rand(out[0], out[1]);
    ctx.particles.emit({
      ...spec,
      count: 1,
      origin: { x: cx + ux * r, y, z: cz + uz * r },
      dir: { x: ux * o, y: rand(up[0], up[1]), z: uz * o },
      speed: rand(speed[0], speed[1]) * R,
      spread: spec.spread ?? 0.12,
      now,
    });
  }
}

/** The flash: one big still additive point over the die (full form only), gone in `life` s. */
function flash(ctx, now, { color, colorEnd, size, life = 0.16 }) {
  ctx.particles.emit({
    count: 1,
    origin: { x: ctx.position.x, y: DIE_TOP + 0.4, z: ctx.position.z },
    speed: 0,
    life,
    color,
    colorEnd,
    size,
    sizeEnd: 1.5,
    kind: KIND.SPARK,
    shape: SHAPE.DOT,
    halo: 1,
    now,
  });
}

/**
 * `burst-<element>`: `full(ctx)` the full form, `look` the reduced swell's colours
 * ({ core, color, deep, shade }).
 */
function burst(element, { color, duration, look, full }) {
  return Object.freeze({
    id: `burst-${element}`,
    // 1, like light-burst: on the low tier (effectBudget 2) the reduced swell still fits beside a
    // nat 20 celebration (cost 1). The full form's weight is bounded by BURST_CAP instead.
    cost: 1,
    defaults: Object.freeze({ color, intensity: 1, duration }),
    start(ctx) {
      return withInsideFlare(ctx, reducedOf(ctx) || !ctx.particles ? swell(ctx, look) : full(ctx));
    },
  });
}

/**
 * The reduced form: one soft swell of light in the element's colours. The halo grows softly over
 * the die and fades, over a floor glow that rises and falls with it; done by 1.1 s. No particle,
 * no flash, no flicker.
 */
function swell(ctx, look) {
  const scope = scoped(ctx.scene);
  const S = Math.min(1100, ctx.duration);
  const grow = growOf(ctx);
  const level = brightOf(ctx);
  const h = halo(ctx, scope, { ...look, rays: 0 });
  const at = (e) => {
    const t = clamp01(e / S);
    return t < 0.35 ? smooth(t / 0.35) : 1 - smooth((t - 0.35) / 0.65);
  };
  const run = timed(
    S,
    (e) => {
      h.mesh.scale.setScalar(grow * (2 + 3.5 * smooth(clamp01(e / (0.6 * S)))));
      h.u.uAlpha.value = 0.85 * level * at(e);
    },
    () => scope.dispose(),
  );
  return together(run, glowOf(ctx, look.color, { radius: 3.2 * grow, peak: 0.8, ms: S, curve: at }));
}

// --- fire --------------------------------------------------------------------------------------

/**
 * Fire explosion: a white-hot flash, a ball of flame bursting out of the die (licking tongues of
 * light with orange ones in normal blend under them, so it keeps its colour on a light map),
 * glowing embers flung out that keep rising, fast sparks, dark smoke rolling out round the die
 * after it, a ring of heat running out over the table and an orange floor glow.
 */
function fireFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const h = halo(ctx, scope, { core: '#fff6d8', color: '#ff9426', deep: '#b8300a', rays: 10, shade: 0.2 });
  const halo1 = bloom(h, { grow, reach: 8.5, gone: 750 });
  const ring = floorRing(ctx, scope, { hot: '#ffe6a8', color: '#ff7a1a', deep: '#8a2006', size: 11 * grow, ms: 0.45 * D, level: 1.2 * brightOf(ctx) });
  const glow = glowOf(ctx, '#ff6a12', {
    radius: 4 * grow,
    peak: 1.3,
    ms: D,
    curve: (e) => (1 - e / D) ** 2 * (0.85 + 0.15 * Math.sin(e * 0.03) * Math.sin(e * 0.047 + 1)),
  });
  const flame = { kind: KIND.EMBER, shape: SHAPE.FLAME, drag: 3.2, R };
  let fired = false;
  let embered = 0;
  let smoked = 0;
  const EMBERS = countFor(26, ctx);
  const SMOKE = countFor(16, ctx);
  const run = timed(
    D,
    (e, now) => {
      halo1(e);
      ring(e);
      if (!fired) {
        fired = true;
        flash(ctx, now, { color: '#fffbe8', colorEnd: '#ffb040', size: 4.4 * R * k });
        // The flame ball: tongues out and up from the die, slowed (drag) at ~2.3 R, rising (buoyant).
        fling(ctx, now, countFor(70, ctx), {
          ...flame,
          out: [0.6, 1],
          up: [0.1, 0.9],
          speed: [5.5, 8.5],
          gravity: 1.4,
          life: 0.75,
          color: '#fff2b8',
          colorEnd: '#e0400c',
          size: 1.05 * R * k,
          sizeEnd: 0.45,
          halo: 0.3,
        });
        fling(ctx, now, countFor(34, ctx), {
          ...flame,
          out: [0.6, 1],
          up: [0.1, 0.7],
          speed: [4.5, 7.5],
          gravity: 1.2,
          life: 0.7,
          color: '#ff8a1c',
          colorEnd: '#7a1a04',
          size: 0.85 * R * k,
          sizeEnd: 0.4,
          blend: 'normal',
          alpha: 0.85,
        });
        // Embers flung out that keep rising, and fast sparks that arc down.
        fling(ctx, now, countFor(46, ctx), {
          R,
          out: [0.5, 1],
          up: [0.3, 1.2],
          speed: [4, 8],
          drag: 1.6,
          gravity: 0.9,
          life: 1.6,
          color: '#ffd070',
          colorEnd: '#ff3c0a',
          size: 0.17 * k,
          sizeEnd: 0.5,
          kind: KIND.EMBER,
          shape: SHAPE.DOT,
          halo: 0.9,
        });
        fling(ctx, now, countFor(22, ctx), {
          R,
          out: [0.7, 1],
          up: [0.4, 1],
          speed: [9, 13],
          gravity: -7,
          life: 0.55,
          color: '#fff0c0',
          colorEnd: '#ff5a10',
          size: 0.22 * k,
          stretch: 0.25,
          kind: KIND.STREAK,
          halo: 0.6,
        });
        fling(ctx, now, countFor(12, ctx), {
          R,
          out: [0.6, 1],
          up: [0.4, 1],
          speed: [5, 8],
          gravity: -6,
          life: 0.8,
          color: '#3a1206',
          colorEnd: '#140604',
          size: 0.16 * k,
          sizeEnd: 0.6,
          kind: KIND.SPARK,
          shape: SHAPE.DOT,
          blend: 'normal',
          alpha: 0.85,
        });
      }
      // Embers keep drifting up off a ring round the die, and dark smoke rolls out after the flame.
      const wantE = Math.round(EMBERS * clamp01(e / (0.6 * D)));
      if (wantE > embered) {
        fling(ctx, now, wantE - embered, {
          R,
          ring: [1.05, 1.6],
          y: 0.3,
          out: [0.3, 0.7],
          up: [1, 1],
          speed: [0.9, 1.6],
          gravity: 0.8,
          life: 1.2,
          color: '#ffc060',
          colorEnd: '#ff3c0a',
          size: 0.13 * k,
          sizeEnd: 0.5,
          kind: KIND.EMBER,
          shape: SHAPE.DOT,
          halo: 0.8,
        });
        embered = wantE;
      }
      const wantS = Math.round(SMOKE * clamp01((e - 120) / (0.4 * D)));
      if (wantS > smoked) {
        const size = 1.0 * R * k;
        fling(ctx, now, wantS - smoked, {
          R,
          ring: [1.1, 1.5],
          y: 0.7,
          out: [1, 1],
          up: [0.5, 0.8],
          speed: [1.4 + 1.1 * k, 2 + 1.1 * k], // out faster than the puff swells
          gravity: 0.35,
          life: 1.5,
          color: '#4a3020',
          colorEnd: '#120c0a',
          size,
          sizeEnd: 3,
          spin: 0.8,
          kind: KIND.SMOKE,
          shape: SHAPE.SMOKE,
          blend: 'normal',
          alpha: 0.6,
        });
        smoked = wantS;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- frost -------------------------------------------------------------------------------------

/**
 * Ice burst: a cold white flash, ice shards bursting out of the die that fall and skitter on the
 * table (solid ones in normal blend, lit ones haloed), a frost ring spreading over the table (a
 * ragged rime patch, drawn "over" so it shows on a light map, and a crisp cold ring running out
 * past it), cold glints popping round it and a low mist rolling out.
 */
function frostFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const h = halo(ctx, scope, { core: '#ffffff', color: '#9ad8ff', deep: '#2a6ea8', rays: 6, shade: 0.5 });
  const halo1 = bloom(h, { grow, reach: 7.5, gone: 700 });
  const ring = floorRing(ctx, scope, { hot: '#ffffff', color: '#bfe8ff', deep: '#4f8fc0', size: 12 * grow, ms: 0.4 * D, level: 1.1 * brightOf(ctx), noise: 0.7 });
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), frostPatchMaterial(C('#d6f0ff')));
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(ctx.position.x, FLOOR_Y, ctx.position.z);
  patch.scale.setScalar(0.01);
  patch.renderOrder = 1;
  scope.add(patch);
  const reach = 4 * grow; // the rime patch's radius
  const glow = glowOf(ctx, '#8fd3ff', { radius: 4 * grow, peak: 0.9, ms: D });
  let fired = false;
  let glinted = 0;
  let misted = 0;
  const GLINTS = countFor(18, ctx);
  const MIST = countFor(10, ctx);
  const shard = { R, out: [0.8, 1], up: [0.3, 0.9], gravity: -14, floor: FLOOR_Y, spin: 8, kind: KIND.SHARD, shape: SHAPE.SHARD };
  const run = timed(
    D,
    (e, now) => {
      halo1(e);
      ring(e);
      patch.scale.setScalar(2 * (0.6 + reach * easeOut(clamp01(e / 320))));
      patch.material.uniforms.uAlpha.value = 0.95 * brightOf(ctx) * smooth(clamp01(e / 60)) * (1 - clamp01((e - 0.55 * D) / (0.45 * D))) ** 1.5;
      if (!fired) {
        fired = true;
        flash(ctx, now, { color: '#ffffff', colorEnd: '#a8e4ff', size: 4 * R * k });
        fling(ctx, now, countFor(40, ctx), {
          ...shard,
          speed: [6, 10],
          life: 1.3,
          color: '#a8dcff',
          colorEnd: '#3f7fb0',
          size: 0.42 * R * k,
          blend: 'normal',
        });
        fling(ctx, now, countFor(30, ctx), {
          ...shard,
          speed: [7, 11],
          life: 1.1,
          color: '#ffffff',
          colorEnd: '#8fd3ff',
          size: 0.34 * R * k,
          halo: 0.4,
        });
        // A spray of fine ice dust, quick and bright.
        fling(ctx, now, countFor(30, ctx), {
          R,
          out: [0.8, 1],
          up: [0.1, 0.6],
          speed: [8, 12],
          drag: 2.5,
          gravity: -2,
          life: 0.6,
          color: '#ffffff',
          colorEnd: '#9ad8ff',
          size: 0.12 * k,
          kind: KIND.SPARK,
          shape: SHAPE.DOT,
          halo: 0.8,
        });
      }
      // Cold glints pop over the frost as it spreads, a low mist rolls out from the die's foot.
      const wantG = Math.round(GLINTS * clamp01((e - 100) / (0.4 * D)));
      if (wantG > glinted) {
        fling(ctx, now, wantG - glinted, {
          R,
          ring: [1.3, (0.8 * reach) / R],
          y: 0.12,
          speed: [0, 0],
          life: 0.5,
          color: '#ffffff',
          colorEnd: '#8fd3ff',
          size: 0.6 * k,
          spin: 1.5,
          kind: KIND.SPARK,
          shape: SHAPE.GLINT,
          halo: 0.8,
        });
        glinted = wantG;
      }
      const wantM = Math.round(MIST * clamp01(e / (0.35 * D)));
      if (wantM > misted) {
        fling(ctx, now, wantM - misted, {
          R,
          ring: [1.15, 1.4],
          y: 0.25,
          out: [1, 1],
          up: [0.05, 0.15],
          speed: [1.6 + 1.2 * k, 2.2 + 1.2 * k],
          gravity: 0,
          life: 1.5,
          color: '#eaf6ff',
          colorEnd: '#86b8de',
          size: 1.1 * R * k,
          sizeEnd: 2.6,
          spin: 0.4,
          kind: KIND.SMOKE,
          shape: SHAPE.SMOKE,
          blend: 'normal',
          alpha: 0.45,
        });
        misted = wantM;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- storm -------------------------------------------------------------------------------------

const BOLTS = [5, 7]; // bolts per strike (min, max)
const BOLT_LEVELS = 5; // 33 points
const FORK_LEVELS = 3; // 9 points
const STRIKE_AT = [0, 0.12, 0.26]; // re-strikes (fractions of the duration)
const STRIKE_PEAK = [1.35, 1.2, 1.1];
const boltTaper = (t) => 1 - 0.75 * t ** 1.8;

/** One strike: BOLTS forked bolts out from the die's side over the table, each with 1-2 forks. */
function stormPaths(ctx, R, reach) {
  const { x: cx, z: cz } = ctx.position;
  const bolts = [];
  const forks = [];
  const tips = [];
  const n = BOLTS[0] + Math.floor(Math.random() * (BOLTS[1] - BOLTS[0] + 1));
  const turn = Math.random() * TAU;
  for (let i = 0; i < n; i++) {
    const a = turn + (i / n) * TAU + rand(-0.3, 0.3);
    const len = reach * rand(0.7, 1);
    const from = { x: cx + Math.cos(a) * 0.85 * R, y: 0.35, z: cz + Math.sin(a) * 0.85 * R };
    const to = { x: cx + Math.cos(a) * len, y: FLOOR_Y, z: cz + Math.sin(a) * len };
    const bolt = jagged(from, to, BOLT_LEVELS, 0.3);
    bolts.push(bolt);
    tips.push(to);
    const m = 1 + Math.floor(Math.random() * 2);
    for (let f = 0; f < m; f++) {
      const root = bolt[Math.floor(bolt.length * rand(0.3, 0.65))];
      const fa = a + (f % 2 ? 1 : -1) * rand(0.4, 0.9);
      const fl = len * rand(0.25, 0.4);
      const tip = { x: root.x + Math.cos(fa) * fl, y: FLOOR_Y, z: root.z + Math.sin(fa) * fl };
      forks.push(jagged(root, tip, FORK_LEVELS, 0.3));
      tips.push(tip);
    }
  }
  return { bolts, forks, tips };
}

/**
 * Lightning burst: forked bolts crack out from the die over the table in every direction with a
 * blinding flash, re-striking twice on new paths (each with its flash and sparks at the bolt tips),
 * crackling sparks flung off the die and a flickering blue floor glow. A soft dark band under the
 * bolts lets them read on a light map, deep blue arcs (normal blend) too.
 */
function stormFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const kw = Math.min(k, 1.2);
  const bright = brightOf(ctx);
  const reach = 4.6 * grow;
  const boltPts = BOLTS[1] * (2 ** BOLT_LEVELS + 2);
  const forkPts = BOLTS[1] * 2 * (2 ** FORK_LEVELS + 2);
  const ribbon = (widthPx, maxPoints, core, glowK, color) => {
    const r = createRibbon({ maxPoints, widthPx, color: C(color), taper: boltTaper, core, glow: glowK });
    r.alpha = 0;
    scope.add(r.mesh);
    return r;
  };
  const shadow = ribbon(40 * kw, boltPts, 0.02, 0.8, '#ffffff');
  Object.assign(shadow.mesh.material, SHADOW_BLEND);
  shadow.mesh.renderOrder = 2;
  const glowR = ribbon(56 * kw, boltPts, 0.02, 0.42, '#6f8fff');
  const bolt = ribbon(12, boltPts, 0.65, 0.5, '#dfe8ff');
  const fork = ribbon(6, forkPts, 0.5, 0.5, '#c8d8ff');
  const ribbons = [shadow, glowR, bolt, fork];
  const h = halo(ctx, scope, { core: '#ffffff', color: '#8fb4ff', deep: '#3048c8', rays: 12, shade: 0.35 });
  let level = 0;
  const halo1 = bloom(h, { grow, reach: 7.5, gone: 600, level: () => Math.min(1.2, level) });
  const times = STRIKE_AT.map((f) => f * D);
  let struck = 0;
  const strike = (now) => {
    const p = stormPaths(ctx, R, reach);
    shadow.setPolylines(p.bolts);
    glowR.setPolylines(p.bolts);
    bolt.setPolylines(p.bolts);
    fork.setPolylines(p.forks);
    flash(ctx, now, { color: '#ffffff', colorEnd: '#8fb4ff', size: (struck === 1 ? 5 : 3.6) * R * k, life: 0.12 });
    for (const tip of p.tips) {
      ctx.particles.emit({
        count: countFor(3, ctx),
        origin: { x: tip.x, y: 0.15, z: tip.z },
        dir: { x: 0, y: 1, z: 0 },
        speed: 2.4,
        spread: 1.3,
        gravity: -8,
        life: 0.35,
        color: '#ffffff',
        colorEnd: '#7fa8ff',
        size: 0.16 * k,
        kind: KIND.SPARK,
        shape: SHAPE.GLINT,
        halo: 0.8,
        now,
      });
    }
    // Crackling sparks off the die, and the same crackle in deep blue (normal blend) for a light map.
    fling(ctx, now, countFor(20, ctx), {
      R,
      out: [0.8, 1],
      up: [0.2, 0.8],
      speed: [8, 12],
      drag: 3,
      gravity: -3,
      life: 0.4,
      color: '#ffffff',
      colorEnd: '#5a7cff',
      size: 0.24 * k,
      stretch: 0.6,
      kind: KIND.STREAK,
      halo: 0.6,
    });
    fling(ctx, now, countFor(10, ctx), {
      R,
      out: [0.8, 1],
      up: [0.2, 0.8],
      speed: [7, 11],
      drag: 3,
      gravity: -3,
      life: 0.4,
      color: '#3c5cff',
      colorEnd: '#241c9a',
      size: 0.2 * k,
      stretch: 0.6,
      kind: KIND.STREAK,
      blend: 'normal',
      alpha: 0.9,
    });
  };
  const levelAt = (e) => {
    const i = struck - 1;
    const dt = e - times[i];
    const last = i === times.length - 1;
    const tail = last ? (1 - clamp01(dt / Math.max(1, 0.62 * D - times[i]))) ** 1.5 : 1;
    return STRIKE_PEAK[i] * (0.45 + 0.55 * Math.exp(-dt / (0.08 * D))) * tail;
  };
  const glow = glowOf(ctx, '#7fa0ff', { radius: 4.5 * grow, peak: 1.0, ms: D, curve: () => level });
  const run = timed(
    D,
    (e, now) => {
      while (struck < times.length && e >= times[struck]) {
        struck++;
        strike(now);
      }
      level = levelAt(e) * (0.85 + 0.15 * Math.random());
      halo1(e);
      const a = bright * level;
      bolt.alpha = Math.min(ALPHA_CAP, 1.1 * a);
      fork.alpha = Math.min(ALPHA_CAP, a);
      glowR.alpha = Math.min(ALPHA_CAP, 1.3 * a);
      shadow.alpha = Math.min(ALPHA_CAP, 0.85 * a);
    },
    () => {
      for (const r of ribbons) r.dispose();
      scope.dispose();
    },
  );
  return together(run, glow);
}

// --- lava --------------------------------------------------------------------------------------

/**
 * Molten splash: an orange-white flash, glowing molten drops thrown up and out of the die that arc
 * down, splash on the table and lie there cooling from yellow to a dark crust (glowing ones haloed,
 * molten beads in normal blend for a light map), a few big globs, a crimson ring of heat on the
 * table and dark smoke rising round the die after.
 */
function lavaFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const h = halo(ctx, scope, { core: '#ffe2a0', color: '#ff6a10', deep: '#8a1a04', rays: 0, shade: 0.25 });
  const halo1 = bloom(h, { grow, reach: 7, gone: 700 });
  const ring = floorRing(ctx, scope, { hot: '#ffc060', color: '#ff4a0a', deep: '#5a0c02', size: 9 * grow, ms: 0.4 * D, level: 1.1 * brightOf(ctx), band: 1 });
  const glow = glowOf(ctx, '#ff4a0a', { radius: 3.6 * grow, peak: 1.2, ms: D });
  const drop = { R, out: [0.7, 1.2], up: [0.6, 1.1], gravity: -11, floor: FLOOR_Y, kind: KIND.SPARK, shape: SHAPE.DOT };
  let fired = false;
  let smoked = 0;
  const SMOKE = countFor(18, ctx);
  const run = timed(
    D,
    (e, now) => {
      halo1(e);
      ring(e);
      if (!fired) {
        fired = true;
        flash(ctx, now, { color: '#fff0c0', colorEnd: '#ff6a10', size: 3.6 * R * k, life: 0.18 });
        fling(ctx, now, countFor(44, ctx), {
          ...drop,
          speed: [6, 10],
          life: 1.6,
          color: '#ffe27a',
          colorEnd: '#8a1404',
          size: 0.36 * R * k,
          sizeEnd: 0.8,
          halo: 0.7,
        });
        fling(ctx, now, countFor(36, ctx), {
          ...drop,
          speed: [5.5, 9],
          life: 1.6,
          color: '#ff7a1a',
          colorEnd: '#2a0804',
          size: 0.3 * R * k,
          sizeEnd: 0.9,
          blend: 'normal',
          alpha: 0.95,
        });
        fling(ctx, now, countFor(8, ctx), {
          ...drop,
          up: [0.9, 1.4],
          speed: [4.5, 7],
          life: 1.7,
          color: '#ffd25a',
          colorEnd: '#7a1004',
          size: 0.5 * R * k,
          sizeEnd: 0.7,
          halo: 0.5,
        });
      }
      const wantS = Math.round(SMOKE * clamp01((e - 100) / (0.45 * D)));
      if (wantS > smoked) {
        fling(ctx, now, wantS - smoked, {
          R,
          ring: [1.1, 1.5],
          y: 0.6,
          out: [0.8, 1],
          up: [0.6, 0.9],
          speed: [1.3 + 1.1 * k, 1.9 + 1.1 * k],
          gravity: 0.35,
          life: 1.6,
          color: '#3a2218',
          colorEnd: '#0c0806',
          size: 1.0 * R * k,
          sizeEnd: 3.2,
          spin: 0.6,
          kind: KIND.SMOKE,
          shape: SHAPE.SMOKE,
          blend: 'normal',
          alpha: 0.6,
        });
        smoked = wantS;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- acid --------------------------------------------------------------------------------------

/**
 * Acid splash: a lime flash, green droplets thrown up and out of the die that arc down and lie on
 * the table (bright haloed ones, deep green beads in normal blend for a light map), a splash ring,
 * and where they fall the acid hisses: small pale green puffs of smoke rising off a ring round the
 * die, with fizzing glints popping on the table.
 */
function acidFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const h = halo(ctx, scope, { core: '#f4ffd8', color: '#8cff3a', deep: '#2a7a0a', rays: 0, shade: 0.35 });
  const halo1 = bloom(h, { grow, reach: 7, gone: 650 });
  const ring = floorRing(ctx, scope, { hot: '#eaffb0', color: '#7aff2a', deep: '#1a5a06', size: 10 * grow, ms: 0.38 * D, level: 1.1 * brightOf(ctx), noise: 0.8, band: 0.8 });
  const glow = glowOf(ctx, '#6aff1a', { radius: 3.6 * grow, peak: 1.0, ms: D });
  const drop = { R, out: [0.7, 1.2], up: [0.5, 1.1], gravity: -12, floor: FLOOR_Y, kind: KIND.SPARK, shape: SHAPE.DOT };
  let fired = false;
  let hissed = 0;
  let fizzed = 0;
  const HISS = countFor(30, ctx);
  const FIZZ = countFor(26, ctx);
  const run = timed(
    D,
    (e, now) => {
      halo1(e);
      ring(e);
      if (!fired) {
        fired = true;
        flash(ctx, now, { color: '#f4ffd0', colorEnd: '#7aff2a', size: 3.8 * R * k, life: 0.15 });
        fling(ctx, now, countFor(46, ctx), {
          ...drop,
          speed: [6, 10.5],
          life: 1.5,
          color: '#e0ff80',
          colorEnd: '#4ac80e',
          size: 0.3 * R * k,
          sizeEnd: 0.8,
          halo: 0.8,
        });
        fling(ctx, now, countFor(34, ctx), {
          ...drop,
          speed: [5.5, 9.5],
          life: 1.6,
          color: '#4ed80e',
          colorEnd: '#1e5a06',
          size: 0.28 * R * k,
          sizeEnd: 0.9,
          blend: 'normal',
          alpha: 0.95,
        });
        // A fine spray of acid mist, quick.
        fling(ctx, now, countFor(24, ctx), {
          R,
          out: [0.8, 1],
          up: [0.1, 0.6],
          speed: [8, 12],
          drag: 2.5,
          gravity: -3,
          life: 0.5,
          color: '#f0ffb0',
          colorEnd: '#6aff1a',
          size: 0.12 * k,
          kind: KIND.SPARK,
          shape: SHAPE.DOT,
          halo: 0.8,
        });
      }
      // Where the drops land the acid hisses: puffs rise off the table, glints fizz.
      const wantH = Math.round(HISS * clamp01((e - 220) / (0.5 * D)));
      if (wantH > hissed) {
        fling(ctx, now, wantH - hissed, {
          R,
          ring: [1.4, 3.2],
          y: 0.1,
          out: [0, 0.15],
          up: [1, 1],
          speed: [1.1, 1.8],
          gravity: 0.2,
          life: 1.0,
          color: '#b8ff70',
          colorEnd: '#5a9a2a',
          size: 0.55 * R * k,
          sizeEnd: 2.4,
          spin: 0.8,
          kind: KIND.SMOKE,
          shape: SHAPE.SMOKE,
          blend: 'normal',
          alpha: 0.75,
        });
        hissed = wantH;
      }
      const wantF = Math.round(FIZZ * clamp01((e - 200) / (0.55 * D)));
      if (wantF > fizzed) {
        fling(ctx, now, wantF - fizzed, {
          R,
          ring: [1.3, 3.4],
          y: 0.08,
          out: [0, 0.3],
          up: [0.6, 1],
          speed: [0.6, 1.6],
          gravity: -2,
          life: 0.35,
          color: '#f4ffc0',
          colorEnd: '#7aff2a',
          size: 0.32 * k,
          spin: 2,
          kind: KIND.SPARK,
          shape: SHAPE.GLINT,
          halo: 0.7,
        });
        fizzed = wantF;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- void --------------------------------------------------------------------------------------

/** When void's pull-in turns into its push out (ms). */
const VOID_TURN = 340;

/**
 * Void implosion: dark smoke and violet motes swirl in from round the die and vanish into it while
 * a dim violet haze closes on it; then a violet flash and a dark ring runs out over the table (a
 * band that darkens the table, with a violet edge so it reads on a dark one too), dark smoke
 * thrown out with it in a ring, and a few violet motes left drifting.
 */
function voidFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const bright = brightOf(ctx);
  const h = halo(ctx, scope, { core: '#efe4ff', color: '#8a4cff', deep: '#2a0a5a', rays: 8, shade: 0.6 });
  const out = bloom(h, { grow, reach: 7, gone: 620, from: 0.6 });
  const dark = floorRing(ctx, scope, { hot: '#ffffff', color: '#ffffff', deep: '#a0a0a0', size: 11 * grow, ms: 0.42 * D, level: 0.9 * bright, edge: 0.03, noise: 0.6, band: 1, blend: SHADOW_BLEND });
  const edge = floorRing(ctx, scope, { hot: '#d8c0ff', color: '#7a3cff', deep: '#2a0a5a', size: 11 * grow, ms: 0.42 * D, level: 1.1 * bright, noise: 0.6, band: 0.4 });
  const glow = glowOf(ctx, '#7a3cff', {
    radius: 3.6 * grow,
    peak: 1.0,
    ms: D,
    curve: (e) => (e < VOID_TURN ? 0.25 * smooth(e / VOID_TURN) : (1 - (e - VOID_TURN) / (D - VOID_TURN)) ** 2),
  });
  let pulled = false;
  let pushed = false;
  let drifted = 0;
  const DRIFT = countFor(14, ctx);
  // Born on a ring, moving in: they reach the die (and vanish under it) by VOID_TURN.
  const inward = (ring, speedK) => ({ R, ring, out: [-1, -1], up: [0, 0.1], speed: [speedK, speedK * 1.15] });
  const run = timed(
    D,
    (e, now) => {
      if (e < VOID_TURN) {
        // The haze closes in on the die, dim; the burst blooms out at the turn.
        const t = e / VOID_TURN;
        h.mesh.scale.setScalar(grow * (6 - 4.5 * smooth(t)));
        h.u.uAlpha.value = 0.55 * bright * smooth(t);
        h.u.uRayAlpha.value = 0;
      } else out(e - VOID_TURN);
      if (e >= VOID_TURN) {
        dark(e - VOID_TURN);
        edge(e - VOID_TURN);
      }
      if (!pulled) {
        pulled = true;
        fling(ctx, now, countFor(24, ctx), {
          ...inward([2.6, 3.6], 9),
          y: 0.6,
          drag: 0.8,
          gravity: 0,
          life: 0.42,
          color: '#3a2058',
          colorEnd: '#0a0414',
          size: 0.9 * R * k,
          sizeEnd: 0.4,
          spin: 2,
          kind: KIND.SPIRAL,
          shape: SHAPE.SMOKE,
          blend: 'normal',
          alpha: 0.8,
        });
        fling(ctx, now, countFor(36, ctx), {
          ...inward([2.4, 3.8], 9.5),
          y: 0.7,
          drag: 0.6,
          gravity: 0,
          life: 0.4,
          color: '#c8a8ff',
          colorEnd: '#6a2cff',
          size: 0.16 * k,
          sizeEnd: 0.4,
          stretch: 0.5,
          kind: KIND.STREAK,
          halo: 0.6,
        });
      }
      if (!pushed && e >= VOID_TURN) {
        pushed = true;
        flash(ctx, now, { color: '#f0e8ff', colorEnd: '#7a3cff', size: 3.6 * R * k, life: 0.14 });
        // Dark smoke thrown out in a ring with the dark ring, violet sparks with it.
        fling(ctx, now, countFor(30, ctx), {
          R,
          ring: [0.9, 1.1],
          y: 0.35,
          out: [1, 1],
          up: [0, 0.1],
          speed: [7 + 2 * k, 8 + 2 * k],
          drag: 2.2,
          gravity: 0,
          life: 1.0,
          color: '#2a1440',
          colorEnd: '#08040e',
          size: 0.9 * R * k,
          sizeEnd: 2.2,
          spin: 0.6,
          kind: KIND.SMOKE,
          shape: SHAPE.SMOKE,
          blend: 'normal',
          alpha: 0.7,
        });
        fling(ctx, now, countFor(28, ctx), {
          R,
          out: [1, 1],
          up: [0, 0.3],
          speed: [9, 13],
          drag: 2.5,
          gravity: 0,
          life: 0.55,
          color: '#e0d0ff',
          colorEnd: '#6a2cff',
          size: 0.16 * k,
          kind: KIND.SPARK,
          shape: SHAPE.DOT,
          halo: 0.8,
        });
      }
      // A few violet motes left drifting round the die, slowly sinking back toward it.
      const wantD = Math.round(DRIFT * clamp01((e - VOID_TURN - 100) / (0.4 * D)));
      if (wantD > drifted) {
        fling(ctx, now, wantD - drifted, {
          R,
          ring: [1.4, 3],
          y: 0.5,
          out: [-0.25, -0.1],
          up: [0.1, 0.3],
          speed: [0.8, 1.4],
          gravity: 0,
          life: 0.9,
          color: '#b898ff',
          colorEnd: '#4a1aa0',
          size: 0.14 * k,
          kind: KIND.SPIRAL,
          shape: SHAPE.DOT,
          halo: 0.9,
        });
        drifted = wantD;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- vitality ----------------------------------------------------------------------------------

/**
 * Radiance: a warm white flash and a golden bloom thrown wide with long god-rays turning slowly,
 * shafts of light streaking out from the die, a soft gold ring on the table, and golden motes that
 * rise and twinkle round the die after (glowing ones, amber ones in normal blend for a light map).
 */
function vitalityFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const h = halo(ctx, scope, { core: '#fffdf0', color: '#ffd860', deep: '#c0841a', rays: 14, shade: 0.35 });
  const halo1 = bloom(h, { grow, reach: 8.5, gone: 800 });
  const rays = (e) => {
    halo1(e);
    // Rays held longer than the other bursts': they are the look.
    h.u.uRayAlpha.value = 2.4 * clamp01(e / 80) * (1 - clamp01(e / 900)) ** 1.5;
    h.u.uSpin.value = 0.00025 * e;
  };
  const ring = floorRing(ctx, scope, { hot: '#fff6c8', color: '#ffd050', deep: '#a06a10', size: 10 * grow, ms: 0.45 * D, level: 1.0 * brightOf(ctx), noise: 0.3, band: 0.5 });
  const glow = glowOf(ctx, '#ffc840', { radius: 4 * grow, peak: 1.1, ms: D });
  let fired = false;
  let rose = 0;
  let twinkled = 0;
  const MOTES = countFor(34, ctx);
  const TWINKLES = countFor(18, ctx);
  const run = timed(
    D,
    (e, now) => {
      rays(e);
      ring(e);
      if (!fired) {
        fired = true;
        flash(ctx, now, { color: '#fffef4', colorEnd: '#ffd860', size: 4.4 * R * k, life: 0.18 });
        // Shafts of light out from the die.
        fling(ctx, now, countFor(30, ctx), {
          R,
          out: [1, 1],
          up: [0, 0.25],
          speed: [11, 15],
          drag: 2.8,
          gravity: 0,
          life: 0.5,
          color: '#fffbe0',
          colorEnd: '#ffc030',
          size: 0.3 * k,
          stretch: 0.9,
          kind: KIND.STREAK,
          halo: 0.7,
        });
        fling(ctx, now, countFor(14, ctx), {
          R,
          out: [1, 1],
          up: [0, 0.25],
          speed: [10, 14],
          drag: 2.8,
          gravity: 0,
          life: 0.5,
          color: '#e09a10',
          colorEnd: '#a06008',
          size: 0.22 * k,
          stretch: 0.9,
          kind: KIND.STREAK,
          blend: 'normal',
          alpha: 0.9,
        });
        // A first puff of golden motes thrown out.
        fling(ctx, now, countFor(30, ctx), {
          R,
          out: [0.6, 1],
          up: [0.4, 1],
          speed: [4, 7],
          drag: 2.2,
          gravity: 0.6,
          life: 1.4,
          color: '#fff4b0',
          colorEnd: '#ffb020',
          size: 0.15 * k,
          sizeEnd: 0.5,
          kind: KIND.EMBER,
          shape: SHAPE.DOT,
          halo: 0.9,
        });
      }
      // Motes keep rising off a ring round the die (some amber, normal blend), and twinkle.
      const wantM = Math.round(MOTES * clamp01((e - 80) / (0.55 * D)));
      if (wantM > rose) {
        const n = wantM - rose;
        const mote = { R, ring: [1.2, 2.6], y: 0.3, out: [0, 0.3], up: [1, 1], speed: [0.9, 1.7], gravity: 0.5, life: 1.1, kind: KIND.EMBER, shape: SHAPE.DOT };
        fling(ctx, now, Math.ceil(n * 0.7), { ...mote, color: '#fff2a0', colorEnd: '#ffb828', size: 0.14 * k, sizeEnd: 0.5, halo: 0.9 });
        fling(ctx, now, Math.floor(n * 0.3), { ...mote, color: '#e8a010', colorEnd: '#a06008', size: 0.11 * k, sizeEnd: 0.5, blend: 'normal', alpha: 0.9 });
        rose = wantM;
      }
      const wantT = Math.round(TWINKLES * clamp01((e - 150) / (0.5 * D)));
      if (wantT > twinkled) {
        fling(ctx, now, wantT - twinkled, {
          R,
          ring: [1.3, 3],
          y: 0.6,
          speed: [0, 0],
          up: [1, 1],
          life: 0.45,
          color: '#ffffff',
          colorEnd: '#ffd860',
          size: 0.5 * k,
          spin: 1.5,
          kind: KIND.SPARK,
          shape: SHAPE.GLINT,
          halo: 0.8,
        });
        twinkled = wantT;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- poison ------------------------------------------------------------------------------------

/**
 * Poison cloud: a sickly green flash, then a thick murky green cloud billows out from the die in
 * every direction (big puffs in normal blend, darker olive ones under them, a faint toxic glow
 * inside), more rolling out from round the die after, with a few sickly motes drifting in it.
 * No droplets, no ring: a cloud, slower and heavier than acid.
 */
function poisonFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const h = halo(ctx, scope, { core: '#efffc0', color: '#a8d83a', deep: '#3f5a10', rays: 0, shade: 0.4 });
  const halo1 = bloom(h, { grow, reach: 6, gone: 600 });
  const glow = glowOf(ctx, '#8ac82a', { radius: 4.4 * grow, peak: 0.9, ms: D });
  const puff = { R, gravity: 0.15, spin: 0.5, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal' };
  let fired = false;
  let rolled = 0;
  let drifted = 0;
  const ROLL = countFor(22, ctx);
  const DRIFT = countFor(20, ctx);
  const run = timed(
    D,
    (e, now) => {
      halo1(e);
      if (!fired) {
        fired = true;
        flash(ctx, now, { color: '#f2ffc8', colorEnd: '#9acd32', size: 3.4 * R * k, life: 0.15 });
        // The cloud bursts out of the die and billows: out fast, slowed by drag, swelling.
        fling(ctx, now, countFor(30, ctx), {
          ...puff,
          ring: [0.6, 0.9],
          y: 0.6,
          out: [1, 1],
          up: [0.05, 0.35],
          speed: [5 + 1.5 * k, 7 + 1.5 * k],
          drag: 2.2,
          life: 1.6,
          color: '#a8c840',
          colorEnd: '#4a5a1a',
          size: 1.1 * R * k,
          sizeEnd: 3.2,
          alpha: 0.7,
        });
        fling(ctx, now, countFor(18, ctx), {
          ...puff,
          ring: [0.6, 0.9],
          y: 0.45,
          out: [1, 1],
          up: [0, 0.2],
          speed: [4 + 1.5 * k, 6 + 1.5 * k],
          drag: 2.2,
          life: 1.7,
          color: '#5a7018',
          colorEnd: '#2a3008',
          size: 1.0 * R * k,
          sizeEnd: 3,
          alpha: 0.65,
        });
        // A faint toxic glow inside the cloud (additive), so it reads on a dark table.
        fling(ctx, now, countFor(16, ctx), {
          ...puff,
          ring: [0.6, 0.9],
          y: 0.7,
          out: [1, 1],
          up: [0.05, 0.3],
          speed: [4.5, 6.5],
          drag: 2.2,
          life: 1.5,
          color: '#b8f040',
          colorEnd: '#3a6a0a',
          size: 1.0 * R * k,
          sizeEnd: 2.8,
          alpha: 0.6,
        });
      }
      // More cloud rolls out from round the die, low and slow.
      const wantR = Math.round(ROLL * clamp01((e - 150) / (0.45 * D)));
      if (wantR > rolled) {
        fling(ctx, now, wantR - rolled, {
          ...puff,
          ring: [1.1, 1.5],
          y: 0.5,
          out: [1, 1],
          up: [0.1, 0.4],
          speed: [1.6 + 1.1 * k, 2.4 + 1.1 * k],
          life: 1.6,
          color: '#94b836',
          colorEnd: '#3a4612',
          size: 1.0 * R * k,
          sizeEnd: 2.8,
          alpha: 0.6,
        });
        rolled = wantR;
      }
      const wantD = Math.round(DRIFT * clamp01((e - 150) / (0.5 * D)));
      if (wantD > drifted) {
        fling(ctx, now, wantD - drifted, {
          R,
          ring: [1.3, 3.2],
          y: 0.6,
          out: [0.1, 0.4],
          up: [0.2, 0.6],
          speed: [0.5, 1.1],
          gravity: 0.2,
          life: 1.1,
          color: '#d8ff60',
          colorEnd: '#5a8a10',
          size: 0.13 * k,
          kind: KIND.EMBER,
          shape: SHAPE.DOT,
          halo: 0.8,
        });
        drifted = wantD;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- sonic -------------------------------------------------------------------------------------

/** The thunderclap's waves (ms): each sends out a ripple on the table and a ring at every height. */
const SONIC_WAVES = [0, 90, 180, 280];
/** Ring heights over the table, a stacked column; seen from above the higher ones look wider. */
const SONIC_HEIGHTS = [0.35, 0.9, 1.45, 2.0];

/**
 * Thunderclap: a short pale pulse over the die (no flash flicker, no screen shake) and the sound
 * going out in waves: four crisp ripples run over the table one after another (each with its own
 * echo), rings hang stacked in the air over the die (a column of sound rings widening as they
 * fade, cream ones lit and amber ones in normal blend for a light map) and fast flat sound lines
 * streak out. Unlike the plain shockwave (one ring and its echo, dust): many rings, stacked.
 */
function sonicFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const bright = brightOf(ctx);
  const h = halo(ctx, scope, { core: '#fffaf0', color: '#ffe2a0', deep: '#a8782a', rays: 0, shade: 0.4 });
  const pulse = bloom(h, { grow, reach: 6, gone: 480 });
  const ripples = SONIC_WAVES.map((at, i) => ({
    at,
    run: floorRing(ctx, scope, { hot: '#fffaf0', color: '#ffe6a8', deep: '#b0803a', size: (9 + 1.6 * i) * grow, ms: 0.38 * D, level: (1.2 - 0.15 * i) * bright, edge: 0.01, noise: 0.15, band: 0.35 }),
  }));
  const stack = SONIC_HEIGHTS.slice(1).map((y, i) => ({
    at: 40 + 70 * i,
    run: floorRing(ctx, scope, { hot: '#ffffff', color: '#fff0c8', deep: '#c09040', size: (6 - 0.6 * i) * grow, ms: 0.3 * D, level: 0.9 * bright, edge: 0.012, noise: 0.1, band: 0.3, y }),
  }));
  const rings = [...ripples, ...stack];
  const glow = glowOf(ctx, '#ffd890', { radius: 4 * grow, peak: 0.8, ms: D, curve: (e) => (1 - clamp01(e / (0.6 * D))) ** 2 });
  let waved = 0;
  const run = timed(
    D,
    (e, now) => {
      pulse(e);
      for (const r of rings) if (e >= r.at) r.run(e - r.at);
      while (waved < SONIC_WAVES.length && e >= SONIC_WAVES[waved]) {
        if (waved === 0) {
          flash(ctx, now, { color: '#fffdf4', colorEnd: '#ffe2a0', size: 3.4 * R * k, life: 0.14 });
          // Sound lines streak out flat over the table.
          fling(ctx, now, countFor(28, ctx), {
            R,
            out: [1, 1],
            up: [0, 0.08],
            speed: [12, 16],
            drag: 3,
            gravity: 0,
            life: 0.4,
            color: '#fffaf0',
            colorEnd: '#e0a850',
            size: 0.2 * k,
            stretch: 1.2,
            kind: KIND.STREAK,
            halo: 0.5,
          });
          fling(ctx, now, countFor(14, ctx), {
            R,
            out: [1, 1],
            up: [0, 0.08],
            speed: [11, 15],
            drag: 3,
            gravity: 0,
            life: 0.4,
            color: '#a8782a',
            colorEnd: '#6a4610',
            size: 0.16 * k,
            stretch: 1.2,
            kind: KIND.STREAK,
            blend: 'normal',
            alpha: 0.85,
          });
        }
        // A ring at every height, widening as it fades: from above, a burst of concentric rings.
        const w = 1 - 0.12 * waved;
        for (const y of SONIC_HEIGHTS) {
          const ring = { count: 1, origin: { x: ctx.position.x, y, z: ctx.position.z }, speed: 0, gravity: 0, kind: KIND.SPARK, shape: SHAPE.RING, spin: 0, now };
          ctx.particles.emit({ ...ring, life: 0.55, color: '#fff6dc', colorEnd: '#e0a850', size: 1.5 * R * k * w, sizeEnd: 4.2, halo: 0.15 });
          ctx.particles.emit({ ...ring, life: 0.5, color: '#a8782a', colorEnd: '#6a4610', size: 1.3 * R * k * w, sizeEnd: 3.6, blend: 'normal', alpha: 0.7 });
        }
        waved++;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- force -------------------------------------------------------------------------------------

/** When force's sphere bursts (ms). */
const FORCE_POP = 260;

const SPHERE_VERTEX = /* glsl */ `
varying float vRim;
void main() {
	vec4 mv = modelViewMatrix * vec4( position, 1.0 );
	vec3 n = normalize( normalMatrix * normal );
	vRim = 1.0 - abs( dot( n, normalize( - mv.xyz ) ) );
	gl_Position = projectionMatrix * mv;
}
`;
/**
 * A force bubble: a bright rim (fresnel) over a faint fill, `uFlash` 0..1 floods it white. Its
 * premultiplied alpha (x uShade) dims what is behind it, so it reads on a light map too.
 */
const SPHERE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uAlpha;
uniform float uFlash;
uniform float uShade;
varying float vRim;
void main() {
	float rim = pow( vRim, 2.5 );
	float a = ( rim + ( 0.12 + 0.6 * uFlash ) * ( 1.0 - rim ) ) * uAlpha;
	vec3 col = mix( uColor, uCore, clamp( uFlash + 0.5 * pow( vRim, 6.0 ), 0.0, 1.0 ) );
	gl_FragColor = vec4( col * a, min( 1.0, a * uShade ) );
}
`;

function forceSphere(ctx, scope) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: C('#b890ff') }, uCore: { value: C('#ffffff') }, uAlpha: { value: 0 }, uFlash: { value: 0 }, uShade: { value: 0.7 } },
    vertexShader: SPHERE_VERTEX,
    fragmentShader: SPHERE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  mesh.position.set(ctx.position.x, DIE_Y, ctx.position.z);
  mesh.renderOrder = 3;
  mesh.visible = false; // shown by forceFull's first frame (nothing drawn before it is sized)
  scope.add(mesh);
  return { mesh, u: material.uniforms };
}

/**
 * Force: a violet sphere of force snaps up round the die and swells, flashes white and bursts:
 * its shards fly out over the table and fall (pale lit ones, deep violet ones in normal blend), a
 * violet bloom and a crisp violet ring go out with them, and a few shards hang shimmering after.
 * Crisp and bright where void is a dark implosion.
 */
function forceFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const bright = brightOf(ctx);
  const sphere = forceSphere(ctx, scope);
  const h = halo(ctx, scope, { core: '#f6f0ff', color: '#a070ff', deep: '#3a1490', rays: 6, shade: 0.45 });
  const out = bloom(h, { grow, reach: 7, gone: 600, from: 1.4 });
  const ring = floorRing(ctx, scope, { hot: '#f0e8ff', color: '#9a60ff', deep: '#3a1490', size: 11 * grow, ms: 0.4 * D, level: 1.15 * bright, edge: 0.01, noise: 0.1, band: 0.4 });
  const glow = glowOf(ctx, '#8a50ff', {
    radius: 3.8 * grow,
    peak: 1.0,
    ms: D,
    curve: (e) => (e < FORCE_POP ? 0.35 * smooth(e / FORCE_POP) : (1 - (e - FORCE_POP) / (D - FORCE_POP)) ** 2),
  });
  const shard = { R, ring: [1.2, 1.6], y: DIE_Y + 0.3, out: [0.8, 1], up: [0.1, 0.7], gravity: -12, floor: FLOOR_Y, spin: 9, kind: KIND.SHARD, shape: SHAPE.SHARD };
  let popped = false;
  let shimmered = 0;
  const SHIMMER = countFor(16, ctx);
  const run = timed(
    D,
    (e, now) => {
      if (e < FORCE_POP) {
        // The sphere snaps up round the die and swells, brightening to a white flash as it bursts.
        const t = e / FORCE_POP;
        sphere.mesh.visible = true;
        sphere.mesh.scale.setScalar(R * grow * (0.9 + 0.8 * easeOut(t)));
        sphere.u.uAlpha.value = Math.min(ALPHA_CAP, 1.4 * bright * smooth(clamp01(e / 70)));
        sphere.u.uFlash.value = smooth(clamp01((e - FORCE_POP + 70) / 70));
      } else if (sphere.mesh.visible) {
        // It blows out and is gone in 130 ms.
        const t = clamp01((e - FORCE_POP) / 130);
        sphere.mesh.scale.setScalar(R * grow * (1.7 + 0.8 * easeOut(t)));
        sphere.u.uAlpha.value = Math.min(ALPHA_CAP, 1.4 * bright * (1 - t) ** 2);
        sphere.u.uFlash.value = 1 - t;
        if (t >= 1) sphere.mesh.visible = false;
      }
      if (e >= FORCE_POP) {
        out(e - FORCE_POP);
        ring(e - FORCE_POP);
      }
      if (!popped && e >= FORCE_POP) {
        popped = true;
        flash(ctx, now, { color: '#ffffff', colorEnd: '#a070ff', size: 4.2 * R * k, life: 0.15 });
        fling(ctx, now, countFor(44, ctx), {
          ...shard,
          speed: [8, 12],
          life: 1.2,
          color: '#efe4ff',
          colorEnd: '#9a60ff',
          size: 0.4 * R * k,
          halo: 0.4,
        });
        fling(ctx, now, countFor(36, ctx), {
          ...shard,
          speed: [7, 11],
          life: 1.3,
          color: '#7a3de0',
          colorEnd: '#3e1698',
          size: 0.42 * R * k,
          blend: 'normal',
        });
        fling(ctx, now, countFor(22, ctx), {
          R,
          out: [0.8, 1],
          up: [0.1, 0.5],
          speed: [10, 14],
          drag: 2.8,
          gravity: -2,
          life: 0.5,
          color: '#f4eeff',
          colorEnd: '#8a50ff',
          size: 0.13 * k,
          kind: KIND.SPARK,
          shape: SHAPE.DOT,
          halo: 0.8,
        });
      }
      // A few shards left hanging round the die, shimmering.
      const wantS = Math.round(SHIMMER * clamp01((e - FORCE_POP - 150) / (0.35 * D)));
      if (wantS > shimmered) {
        fling(ctx, now, wantS - shimmered, {
          R,
          ring: [1.6, 3.4],
          y: 0.5,
          out: [0.1, 0.3],
          up: [0.2, 0.5],
          speed: [0.3, 0.8],
          gravity: 0,
          life: 0.6,
          color: '#e2ccff',
          colorEnd: '#8a50ff',
          size: 0.32 * k,
          spin: 4,
          kind: KIND.GLINT,
          shape: SHAPE.SHARD,
          halo: 0.6,
        });
        shimmered = wantS;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- mental ------------------------------------------------------------------------------------

/** Mental's pulses (ms): each throws out a wave of swirls; the rings go out on the first three. */
const MENTAL_WAVES = [0, 110, 220, 330];

/**
 * Psychic burst: a pink bloom whose rays wheel round fast, pink swirl strokes spiralling out from
 * the die in waves (lit pink ones, deep magenta ones in normal blend for a light map), pink rings
 * pulsing out from it over two rings running out on the table, and pink motes still curling round
 * it after.
 */
function mentalFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const bright = brightOf(ctx);
  const h = halo(ctx, scope, { core: '#fff0fa', color: '#ff7ac8', deep: '#902a9a', rays: 7, shade: 0.4 });
  const halo1 = bloom(h, { grow, reach: 7, gone: 650 });
  const floor = [0, 170].map((at, i) => ({
    at,
    run: floorRing(ctx, scope, { hot: '#ffe0f4', color: '#ff6ac0', deep: '#7a1a8a', size: (10 + 2 * i) * grow, ms: 0.42 * D, level: (1.1 - 0.2 * i) * bright, noise: 0.3, band: 0.5 }),
  }));
  const glow = glowOf(ctx, '#ff5ab8', { radius: 4 * grow, peak: 1.0, ms: D });
  const swirl = { R, out: [1, 1], up: [0, 0.25], drag: 0.5, gravity: 0, kind: KIND.SPIRAL, shape: SHAPE.STREAK, stretch: 1.4 };
  let waved = 0;
  let curled = 0;
  const MOTES = countFor(16, ctx);
  const run = timed(
    D,
    (e, now) => {
      halo1(e);
      h.u.uSpin.value = 0.0018 * e; // the rays wheel round: a swirl
      for (const r of floor) if (e >= r.at) r.run(e - r.at);
      while (waved < MENTAL_WAVES.length && e >= MENTAL_WAVES[waved]) {
        if (waved === 0) flash(ctx, now, { color: '#fff4fb', colorEnd: '#ff7ac8', size: 3.8 * R * k, life: 0.15 });
        // Swirl strokes spiralling out (SPIRAL turns their path as they go; the streak follows it).
        fling(ctx, now, countFor(14, ctx), { ...swirl, speed: [5, 8], life: 1.1, color: '#ffc0ec', colorEnd: '#b04dff', size: 0.22 * k, halo: 0.6 });
        fling(ctx, now, countFor(8, ctx), { ...swirl, speed: [4.5, 7.5], life: 1.0, color: '#d0308f', colorEnd: '#7a1a9a', size: 0.18 * k, blend: 'normal', alpha: 0.9 });
        if (waved < 3) {
          const ring = { count: 1, origin: { x: ctx.position.x, y: DIE_TOP + 0.2, z: ctx.position.z }, speed: 0, gravity: 0, kind: KIND.SPARK, shape: SHAPE.RING, spin: 0, now };
          ctx.particles.emit({ ...ring, life: 0.65, color: '#ffd0f0', colorEnd: '#e050b0', size: 1.4 * R * k, sizeEnd: 4.6, halo: 0.2 });
          ctx.particles.emit({ ...ring, life: 0.6, color: '#b02080', colorEnd: '#6a1070', size: 1.2 * R * k, sizeEnd: 4.2, blend: 'normal', alpha: 0.7 });
        }
        waved++;
      }
      // Pink motes curling round the die after.
      const wantM = Math.round(MOTES * clamp01((e - 400) / Math.max(1, D - 900 - 400)));
      if (wantM > curled) {
        fling(ctx, now, wantM - curled, {
          R,
          ring: [1.4, 3],
          y: 0.6,
          out: [0.2, 0.5],
          up: [0.1, 0.4],
          speed: [1, 2],
          gravity: 0,
          life: 0.9,
          color: '#ffb0e0',
          colorEnd: '#a03ac0',
          size: 0.14 * k,
          kind: KIND.SPIRAL,
          shape: SHAPE.DOT,
          halo: 0.9,
        });
        curled = wantM;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- spirit ------------------------------------------------------------------------------------

/** Spirit's wisps leave the die in these waves (ms), all before the die face must clear. */
const SPIRIT_WAVES = [0, 70, 140, 210, 280, 350];

/**
 * Spirit release: a soft cyan bloom (no rays), then ghostly cyan wisps come out of the die and
 * rise round it in a spiral (SPIRAL turns their path; drag holds them at about four die radii out
 * while they keep turning and rising), with pale strands tracing the same helix, a faint cyan ring
 * on the table, and more wisps drifting up off the table round it after. Rising and turning,
 * where frost's mist sinks and vitality's motes rise straight.
 */
function spiritFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const h = halo(ctx, scope, { core: '#f0ffff', color: '#8ff0ff', deep: '#1e7a9a', rays: 0, shade: 0.45 });
  const halo1 = bloom(h, { grow, reach: 6.5, gone: 650 });
  const ring = floorRing(ctx, scope, { hot: '#e6ffff', color: '#8ff0ff', deep: '#1e6a8a', size: 9 * grow, ms: 0.45 * D, level: 0.8 * brightOf(ctx), noise: 0.6, band: 0.8 });
  const glow = glowOf(ctx, '#6ae4ff', { radius: 4 * grow, peak: 0.9, ms: D });
  const helix = { R, out: [1, 1], up: [0.3, 0.6], speed: [4.6, 5.6], drag: 1.4, gravity: 1.3, kind: KIND.SPIRAL };
  let waved = 0;
  let drifted = 0;
  const DRIFT = countFor(14, ctx);
  const run = timed(
    D,
    (e, now) => {
      halo1(e);
      ring(e);
      while (waved < SPIRIT_WAVES.length && e >= SPIRIT_WAVES[waved]) {
        if (waved === 0) flash(ctx, now, { color: '#f0ffff', colorEnd: '#8ff0ff', size: 3.6 * R * k, life: 0.16 });
        fling(ctx, now, countFor(5, ctx), {
          ...helix,
          life: 1.25,
          color: '#24a6cc',
          colorEnd: '#a8eefc',
          size: 0.6 * R * k,
          sizeEnd: 1.8,
          spin: 0.9,
          shape: SHAPE.SMOKE,
          blend: 'normal',
          alpha: 0.75,
        });
        fling(ctx, now, countFor(4, ctx), {
          ...helix,
          life: 1.15,
          color: '#8ff0ff',
          colorEnd: '#1e7a9a',
          size: 0.5 * R * k,
          sizeEnd: 1.7,
          spin: 0.9,
          shape: SHAPE.SMOKE,
          alpha: 0.7,
          halo: 0.4,
        });
        fling(ctx, now, countFor(5, ctx), {
          ...helix,
          life: 1.1,
          color: '#e6fdff',
          colorEnd: '#4ec6e0',
          size: 0.16 * k,
          stretch: 2,
          shape: SHAPE.STREAK,
          halo: 0.5,
        });
        waved++;
      }
      // More wisps drift up off the table round the die after.
      const wantD = Math.round(DRIFT * clamp01((e - 450) / Math.max(1, D - 1000 - 450)));
      if (wantD > drifted) {
        fling(ctx, now, wantD - drifted, {
          R,
          ring: [1.3, 2.6],
          y: 0.2,
          out: [0, 0.2],
          up: [1, 1],
          speed: [0.5, 0.9],
          gravity: 1.1,
          life: 1.0,
          color: '#3cc4e4',
          colorEnd: '#a8eefc',
          size: 0.5 * R * k,
          sizeEnd: 2.2,
          spin: 0.9,
          kind: KIND.SMOKE,
          shape: SHAPE.SMOKE,
          blend: 'normal',
          alpha: 0.55,
        });
        drifted = wantD;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- bleed -------------------------------------------------------------------------------------

/** Bleed's splats land on the table between these times (ms), as the drops come down. */
const BLEED_SPLATS = [260, 620];

/**
 * Blood spray: a short crimson flash, red droplets thrown up and out of the die that arc down and
 * lie on the table (deep red beads in normal blend, so they read on a light map, with fewer lit
 * ones haloed for a dark one), a fast fine spray of thin red streaks, and splats: dark red spots
 * that spread flat on the table round the die where the drops come down, and stay a while. Blood
 * does not glow: no smoke (lava), no flame (fire); a faint dark-red floor glow only.
 */
function bleedFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const h = halo(ctx, scope, { core: '#ffd8d8', color: '#e01a2a', deep: '#5a0008', rays: 0, shade: 0.55 });
  const halo1 = bloom(h, { grow, reach: 6.5, gone: 600 });
  const glow = glowOf(ctx, '#c00818', { radius: 3.2 * grow, peak: 0.7, ms: D });
  const drop = { R, out: [0.7, 1.2], up: [0.5, 1.1], gravity: -13, floor: FLOOR_Y, kind: KIND.SPARK, shape: SHAPE.DOT };
  let fired = false;
  let splatted = 0;
  const SPLATS = countFor(26, ctx);
  const run = timed(
    D,
    (e, now) => {
      halo1(e);
      if (!fired) {
        fired = true;
        flash(ctx, now, { color: '#ffe8e8', colorEnd: '#e01a2a', size: 3.4 * R * k, life: 0.14 });
        fling(ctx, now, countFor(48, ctx), {
          ...drop,
          speed: [5.5, 10],
          life: 1.6,
          color: '#c00a1c',
          colorEnd: '#70040c',
          size: 0.3 * R * k,
          sizeEnd: 1.1,
          blend: 'normal',
          alpha: 0.95,
        });
        fling(ctx, now, countFor(34, ctx), {
          ...drop,
          speed: [6, 10.5],
          life: 1.3,
          color: '#ff4050',
          colorEnd: '#c00818',
          size: 0.24 * R * k,
          sizeEnd: 0.8,
          halo: 0.5,
        });
        // A fast fine spray: thin red streaks that arc down.
        fling(ctx, now, countFor(26, ctx), {
          R,
          out: [0.8, 1],
          up: [0.2, 0.7],
          speed: [10, 14],
          drag: 1.8,
          gravity: -9,
          life: 0.45,
          color: '#e0202e',
          colorEnd: '#5a0008',
          size: 0.14 * k,
          stretch: 0.6,
          kind: KIND.STREAK,
          blend: 'normal',
          alpha: 0.9,
        });
      }
      // Splats spread flat on the table where the drops come down (outside the die).
      const [s0, s1] = BLEED_SPLATS;
      const want = Math.round(SPLATS * clamp01((e - s0) / (s1 - s0)));
      if (want > splatted) {
        fling(ctx, now, want - splatted, {
          R,
          ring: [1.5, 4.2],
          y: FLOOR_Y + 0.03,
          speed: [0, 0],
          gravity: 0,
          life: 0.9,
          color: '#c0101e',
          colorEnd: '#80060f',
          size: 0.2 * R * k,
          sizeEnd: 2.4,
          kind: KIND.SPARK,
          shape: SHAPE.DOT,
          blend: 'normal',
          alpha: 0.95,
        });
        splatted = want;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- slashing ----------------------------------------------------------------------------------

/** Each slash: its sweep starts at `at` ms; its bearing (rad) across the table; it is gone by SLASH_GONE. */
const SLASHES = [
  { at: 0, turn: Math.PI / 4 },
  { at: 90, turn: -Math.PI / 4 },
];
const SLASH_SWEEP = 120; // the blade's head runs the arc in this long
const SLASH_TAIL = 300; // the tail follows it, so the arc is wiped away from its start
const SLASH_GONE = 520;
const SLASH_POINTS = 24;
const slashTaper = (t) => Math.sin(Math.PI * clamp01(t)) ** 0.6;

/**
 * Slash: two crossed silver arcs flash over the die, one after the other (an X): each is a bowed
 * blade stroke swept across from end to end (a bright white core over a cool silver glow, with a
 * dark steel shadow under it so it reads on a light map) that is wiped away behind its head and
 * gone by about 0.5 s. Silver sparks fly off each stroke and a few steel glints hang after. No
 * ring: it cuts, where piercing thrusts out round the die.
 */
function slashingFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const kw = Math.min(k, 1.2);
  const { x: cx, z: cz } = ctx.position;
  const y = DIE_TOP + 0.35;
  const half = 2.6 * R * grow; // half the arc's chord
  const bow = 0.55 * R * grow;
  const arcs = SLASHES.map(({ at, turn }) => {
    const ux = Math.cos(turn);
    const uz = Math.sin(turn);
    const pts = [];
    for (let i = 0; i < SLASH_POINTS; i++) {
      const t = i / (SLASH_POINTS - 1);
      const s = 2 * t - 1;
      const b = bow * (1 - s * s); // bowed out to one side
      pts.push({ x: cx + ux * half * s - uz * b, y: y + 0.25 * (1 - s * s), z: cz + uz * half * s + ux * b });
    }
    const ribbon = (widthPx, core, glowK, color) => {
      const r = createRibbon({ maxPoints: SLASH_POINTS, widthPx, color: C(color), taper: slashTaper, core, glow: glowK });
      r.alpha = 0;
      scope.add(r.mesh);
      return r;
    };
    const shadow = ribbon(30 * kw, 0.05, 0.7, '#ffffff');
    Object.assign(shadow.mesh.material, SHADOW_BLEND);
    shadow.mesh.renderOrder = 2;
    return { at, pts, ux, uz, sparked: false, parts: [shadow, ribbon(34 * kw, 0.05, 0.45, '#9ab4d8'), ribbon(9 * kw, 0.7, 0.5, '#f4f8ff')], levels: [0.55, 1.1, 1.3] };
  });
  const h = halo(ctx, scope, { core: '#ffffff', color: '#c8d4e8', deep: '#4a5668', rays: 4, shade: 0.5 });
  const halo1 = bloom(h, { grow, reach: 5.5, gone: 480 });
  const glow = glowOf(ctx, '#b8c8e0', { radius: 3 * grow, peak: 0.6, ms: 0.6 * D });
  let fired = false;
  let glinted = 0;
  const GLINTS = countFor(14, ctx);
  const run = timed(
    D,
    (e, now) => {
      halo1(e);
      if (!fired) {
        fired = true;
        flash(ctx, now, { color: '#ffffff', colorEnd: '#c8d4e8', size: 3.2 * R * k, life: 0.12 });
      }
      for (const a of arcs) {
        const t = e - a.at;
        if (t < 0) continue;
        if (t >= SLASH_GONE) {
          for (const r of a.parts) r.mesh.visible = false;
          continue;
        }
        const head = Math.ceil(SLASH_POINTS * easeOut(clamp01(t / SLASH_SWEEP)));
        const tail = Math.floor((SLASH_POINTS - 2) * smooth(clamp01((t - 60) / SLASH_TAIL)));
        const line = a.pts.slice(tail, Math.max(tail + 2, head));
        const level = brightOf(ctx) * clamp01(t / 30) * (1 - smooth(clamp01((t - 160) / (SLASH_GONE - 160))));
        a.parts.forEach((r, i) => {
          r.setPolylines([line]);
          r.alpha = Math.min(ALPHA_CAP, a.levels[i] * level);
        });
        if (!a.sparked) {
          a.sparked = true;
          // Sparks fly off the stroke, out and along it (its sweep runs from its first point on).
          for (let i = 0; i < 2; i++) {
            const silver = i === 0;
            const n = countFor(silver ? 30 : 16, ctx);
            for (let j = 0; j < n; j++) {
              const p = a.pts[Math.floor(Math.random() * SLASH_POINTS)];
              const ox = p.x - cx;
              const oz = p.z - cz;
              const d = Math.hypot(ox, oz) || 1;
              ctx.particles.emit({
                count: 1,
                origin: p,
                dir: { x: (ox / d) * 0.8 + a.ux * 0.6, y: rand(0.1, 0.5), z: (oz / d) * 0.8 + a.uz * 0.6 },
                speed: rand(5, 10) * R,
                spread: 0.3,
                drag: 2.4,
                gravity: -6,
                life: silver ? 0.45 : 0.4,
                color: silver ? '#ffffff' : '#4a5462',
                colorEnd: silver ? '#8aa0c0' : '#2a3038',
                size: (silver ? 0.16 : 0.13) * k,
                stretch: 0.5,
                kind: KIND.STREAK,
                ...(silver ? { halo: 0.6 } : { blend: 'normal', alpha: 0.9 }),
                now,
              });
            }
          }
        }
      }
      // A few steel glints hang round the die after the cuts.
      const want = Math.round(GLINTS * clamp01((e - 200) / 400));
      if (want > glinted) {
        fling(ctx, now, want - glinted, {
          R,
          ring: [1.4, 3],
          y: 0.5,
          out: [0.1, 0.3],
          up: [0.1, 0.3],
          speed: [0.2, 0.6],
          gravity: 0,
          life: 0.5,
          color: '#ffffff',
          colorEnd: '#9ab4d8',
          size: 0.45 * k,
          spin: 2,
          kind: KIND.SPARK,
          shape: SHAPE.GLINT,
          halo: 0.7,
        });
        glinted = want;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- piercing ----------------------------------------------------------------------------------

/** Piercing's thrusts (ms): each sends out a ring of needles, turned half a step from the last. */
const PIERCE_WAVES = [0, 110];
const PIERCE_NEEDLES = 16; // per ring (at full count)

/**
 * Pierce: a sharp white flash and needles thrust out from the die in an even ring, flat and
 * straight (long thin white streaks, dark steel ones in normal blend beside them for a light map),
 * a second ring turned half a step thrusting out after it, a thin crisp white ring running out on
 * the table and small glints where the needles stop. Straight and even, where slashing's arcs are
 * curved and sonic's sound lines are warm and scattered.
 */
function piercingFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const bright = brightOf(ctx);
  const h = halo(ctx, scope, { core: '#ffffff', color: '#dce6ff', deep: '#56627a', rays: 16, shade: 0.5 });
  const halo1 = bloom(h, { grow, reach: 5.5, gone: 460 });
  const ring = floorRing(ctx, scope, { hot: '#ffffff', color: '#e4ecff', deep: '#6a7690', size: 10 * grow, ms: 0.32 * D, level: 1.1 * bright, edge: 0.006, noise: 0.05, band: 0.2 });
  const glow = glowOf(ctx, '#d0dcff', { radius: 3 * grow, peak: 0.6, ms: 0.6 * D });
  const N = Math.max(8, countFor(PIERCE_NEEDLES, ctx));
  let waved = 0;
  let glinted = 0;
  const GLINTS = countFor(16, ctx);
  const thrust = (now, wave) => {
    const turn = (wave * Math.PI) / N + Math.random() * 0.1;
    const y = DIE_Y + (wave === 0 ? 0.1 : 0.45);
    for (let i = 0; i < N; i++) {
      const a = turn + (i / N) * TAU;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      const base = { count: 1, origin: { x: ctx.position.x + ux * 0.4 * R, y, z: ctx.position.z + uz * 0.4 * R }, dir: { x: ux, y: 0, z: uz }, spread: 0.01, gravity: 0, kind: KIND.STREAK, now };
      ctx.particles.emit({ ...base, speed: rand(15, 19) * R, drag: 3.6, life: 0.42, color: '#ffffff', colorEnd: '#b8c8ff', size: 0.16 * k, stretch: 4.5, halo: 0.6 });
      ctx.particles.emit({ ...base, speed: rand(14, 17) * R, drag: 3.6, life: 0.4, color: '#3a4250', colorEnd: '#1e2430', size: 0.12 * k, stretch: 4.5, blend: 'normal', alpha: 0.95 });
    }
  };
  const run = timed(
    D,
    (e, now) => {
      halo1(e);
      ring(e);
      while (waved < PIERCE_WAVES.length && e >= PIERCE_WAVES[waved]) {
        if (waved === 0) flash(ctx, now, { color: '#ffffff', colorEnd: '#dce6ff', size: 3.2 * R * k, life: 0.1 });
        thrust(now, waved);
        waved++;
      }
      // Small glints where the needles stop, out round the die.
      const want = Math.round(GLINTS * clamp01((e - 180) / 320));
      if (want > glinted) {
        fling(ctx, now, want - glinted, {
          R,
          ring: [3.2, 4.4],
          y: 0.35,
          speed: [0, 0],
          gravity: 0,
          life: 0.4,
          color: '#ffffff',
          colorEnd: '#b8c8ff',
          size: 0.4 * k,
          spin: 2,
          kind: KIND.SPARK,
          shape: SHAPE.GLINT,
          halo: 0.8,
        });
        glinted = want;
      }
    },
    () => scope.dispose(),
  );
  return together(run, glow);
}

// --- bludgeoning -------------------------------------------------------------------------------

/**
 * Impact: a warm dusty flash and a short thump (a small screen shake), a dark crater pressed into
 * the table round the die with a small hot glow in it, a thick ring of brown dust rolling out low
 * over the table (heavy brown puffs, pale ones over them for a dark map), grit and stone chips
 * thrown up and out that fall and skitter, and dust hanging round the crater after. Brown, heavy
 * and dark where the plain shockwave is a pale gold ring with a few faint puffs.
 */
function bludgeoningFull(ctx) {
  const scope = scoped(ctx.scene);
  const D = ctx.duration;
  const R = dieRadius(ctx);
  const k = sizeK(ctx);
  const grow = growOf(ctx);
  const bright = brightOf(ctx);
  const h = halo(ctx, scope, { core: '#fff2dc', color: '#d8a868', deep: '#6a4a28', rays: 0, shade: 0.55 });
  const halo1 = bloom(h, { grow, reach: 5.5, gone: 460 });
  // The crater: a soft dark disc pressed into the table round the die (white "over" in
  // SHADOW_BLEND darkens what is under it), held, then fading out; it does not run out like a ring.
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), quadMaterial(BURST_FRAGMENT, C('#ffffff'), BURST_UNIFORMS));
  Object.assign(pit.material, SHADOW_BLEND);
  pit.rotation.x = -Math.PI / 2;
  pit.position.set(ctx.position.x, FLOOR_Y, ctx.position.z);
  pit.renderOrder = 1;
  scope.add(pit);
  const crater = (e) => {
    pit.scale.setScalar(2 * grow * R * (1.4 + 0.9 * easeOut(clamp01(e / 90))));
    pit.material.uniforms.uAlpha.value = 0.7 * bright * smooth(clamp01(e / 60)) * (1 - smooth(clamp01((e - 0.35 * D) / (0.5 * D))));
  };
  const heat = glowOf(ctx, '#ff8a2a', { radius: 1.7 * grow, peak: 1.1, ms: 0.7 * D, curve: (e) => (1 - clamp01(e / (0.7 * D))) ** 1.5 });
  const dustGlow = glowOf(ctx, '#c89a60', { radius: 3.6 * grow, peak: 0.45, ms: 0.6 * D });
  const grit = { R, out: [0.7, 1], up: [0.4, 1.1], gravity: -15, floor: FLOOR_Y, spin: 10, kind: KIND.SHARD, shape: SHAPE.SHARD };
  let fired = false;
  let hung = 0;
  const HANG = countFor(10, ctx);
  const run = timed(
    D,
    (e, now) => {
      halo1(e);
      crater(e);
      if (!fired) {
        fired = true;
        ctx.shake?.(0.5 * bright, 220);
        flash(ctx, now, { color: '#fff6e8', colorEnd: '#d8a868', size: 3.2 * R * k, life: 0.12 });
        // The dust ring: puffs out from the die's foot evenly round it, low and fast, slowed by drag.
        const n = countFor(26, ctx);
        const turn = Math.random() * TAU;
        for (let i = 0; i < n; i++) {
          const a = turn + (i / n) * TAU + rand(-0.08, 0.08);
          const ux = Math.cos(a);
          const uz = Math.sin(a);
          const base = { count: 1, origin: { x: ctx.position.x + ux * 0.9 * R, y: 0.15, z: ctx.position.z + uz * 0.9 * R }, dir: { x: ux, y: 0.06, z: uz }, spread: 0.15, gravity: 0.1, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', now };
          ctx.particles.emit({ ...base, speed: rand(7, 9) * R, drag: 2.6, life: 1.3, color: '#8a7058', colorEnd: '#5a4838', size: 0.8 * R * k, sizeEnd: 3, spin: 0.7, alpha: 0.75 });
          ctx.particles.emit({ ...base, speed: rand(5.5, 7) * R, drag: 2.4, life: 1.1, color: '#e8d8bc', colorEnd: '#a8927a', size: 0.6 * R * k, sizeEnd: 2.6, spin: 0.6, alpha: 0.55 });
        }
        // Grit and chips thrown up and out, falling to the table: dark stone, pale lit chips.
        fling(ctx, now, countFor(40, ctx), { ...grit, speed: [6, 10], life: 1.2, color: '#5a4a38', colorEnd: '#2e2418', size: 0.24 * R * k, blend: 'normal' });
        fling(ctx, now, countFor(20, ctx), { ...grit, speed: [6.5, 10.5], life: 1.0, color: '#f0dcc0', colorEnd: '#8a7050', size: 0.18 * R * k, halo: 0.3 });
        // Fine dust motes kicked up, catching the light.
        fling(ctx, now, countFor(24, ctx), {
          R,
          out: [0.6, 1],
          up: [0.3, 0.9],
          speed: [5, 9],
          drag: 2.4,
          gravity: -3,
          life: 0.7,
          color: '#f4e6cc',
          colorEnd: '#8a6a48',
          size: 0.12 * k,
          kind: KIND.SPARK,
          shape: SHAPE.DOT,
          halo: 0.5,
        });
      }
      // Dust hanging round the crater after, settling.
      const want = Math.round(HANG * clamp01((e - 250) / 400));
      if (want > hung) {
        fling(ctx, now, want - hung, {
          R,
          ring: [1.6, 3.2],
          y: 0.3,
          out: [0.3, 0.6],
          up: [0.1, 0.3],
          speed: [0.3, 0.7],
          gravity: -0.1,
          life: 1.0,
          color: '#a08a70',
          colorEnd: '#6a5a48',
          size: 0.7 * R * k,
          sizeEnd: 2.4,
          spin: 0.5,
          kind: KIND.SMOKE,
          shape: SHAPE.SMOKE,
          blend: 'normal',
          alpha: 0.45,
        });
        hung = want;
      }
    },
    () => scope.dispose(),
  );
  return together(run, heat, dustGlow);
}

export const BURSTS = Object.freeze(
  Object.fromEntries(
    [
      burst('fire', {
        color: '#ff8a1c',
        duration: 1800,
        look: { core: '#fff2c8', color: '#ff8a1c', deep: '#a02a08', shade: 0.2 },
        full: fireFull,
      }),
      burst('frost', {
        color: '#a8e4ff',
        duration: 1800,
        look: { core: '#ffffff', color: '#9ad8ff', deep: '#2a6ea8', shade: 0.5 },
        full: frostFull,
      }),
      burst('storm', {
        color: '#8fb4ff',
        duration: 1300,
        look: { core: '#ffffff', color: '#8fb4ff', deep: '#3048c8', shade: 0.35 },
        full: stormFull,
      }),
      burst('lava', {
        color: '#ff5a10',
        duration: 1800,
        look: { core: '#ffd890', color: '#ff5a10', deep: '#7a1404', shade: 0.25 },
        full: lavaFull,
      }),
      burst('acid', {
        color: '#8cff3a',
        duration: 1800,
        look: { core: '#f2ffd0', color: '#8cff3a', deep: '#2a7a0a', shade: 0.35 },
        full: acidFull,
      }),
      burst('void', {
        color: '#8a4cff',
        duration: 1700,
        look: { core: '#e6d8ff', color: '#7a3cff', deep: '#24084a', shade: 0.6 },
        full: voidFull,
      }),
      burst('vitality', {
        color: '#ffd860',
        duration: 1800,
        look: { core: '#fffbe8', color: '#ffd860', deep: '#c0841a', shade: 0.35 },
        full: vitalityFull,
      }),
      burst('poison', {
        color: '#9acd32',
        duration: 2000,
        look: { core: '#eaffb0', color: '#9acd32', deep: '#3f5a10', shade: 0.4 },
        full: poisonFull,
      }),
      burst('sonic', {
        color: '#ffe6a8',
        duration: 1400,
        look: { core: '#fffaf0', color: '#ffe2a0', deep: '#a8782a', shade: 0.4 },
        full: sonicFull,
      }),
      burst('force', {
        color: '#a070ff',
        duration: 1500,
        look: { core: '#f6f0ff', color: '#a070ff', deep: '#3a1490', shade: 0.45 },
        full: forceFull,
      }),
      burst('mental', {
        color: '#ff7ac8',
        duration: 1700,
        look: { core: '#fff0fa', color: '#ff7ac8', deep: '#902a9a', shade: 0.4 },
        full: mentalFull,
      }),
      burst('spirit', {
        color: '#8ff0ff',
        duration: 1900,
        look: { core: '#f0ffff', color: '#8ff0ff', deep: '#1e7a9a', shade: 0.45 },
        full: spiritFull,
      }),
      burst('bleed', {
        color: '#d0101e',
        duration: 1600,
        look: { core: '#ffd8d8', color: '#d0101e', deep: '#4a0006', shade: 0.55 },
        full: bleedFull,
      }),
      burst('slashing', {
        color: '#c8d4e8',
        duration: 1200,
        look: { core: '#ffffff', color: '#c8d4e8', deep: '#4a5668', shade: 0.5 },
        full: slashingFull,
      }),
      burst('piercing', {
        color: '#dce6ff',
        duration: 1200,
        look: { core: '#ffffff', color: '#dce6ff', deep: '#56627a', shade: 0.5 },
        full: piercingFull,
      }),
      burst('bludgeoning', {
        color: '#c89a60',
        duration: 1700,
        look: { core: '#fff2dc', color: '#c89a60', deep: '#5a3e22', shade: 0.55 },
        full: bludgeoningFull,
      }),
    ].map((m) => [m.id, m]),
  ),
);

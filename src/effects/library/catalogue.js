import * as THREE from 'three';
import { DIE_EFFECTS, NOOP, envelope, timed } from './die-effects.js';
import { KIND } from './particles.js';
import { SHAPE } from './shapes.js';
import { composite } from './timeline.js';
import { createRibbon } from './ribbon.js';
import { palette } from './palette.js';

/**
 * The particle and mesh effects. World units: one die edge is 1 (so a size of 0.2 is a fifth
 * of a die at any diceScale); the table is y = 0 and the camera looks straight down at it.
 * Every effect obeys ctx.color, ctx.intensity (count, size and brightness) and ctx.duration,
 * and returns a handle whose update turns false at `duration`. Particle effects emit into the
 * shared pool (ctx.particles) and are not die-bound, so their particles outlive the die; the
 * pool itself is advanced by the layer. Meshes are removed and disposed by stop().
 */

const FLOOR_Y = 0.02; // a hair above the table: no z-fight with a floor plane
const DIE_Y = 0.5; // a landed die's centre
// Just above a landed die's top face. The camera looks straight down, so particles born lower
// stay hidden under the (opaque) die until they have flown out past its footprint.
const DIE_TOP = 1.05;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOut = (t) => 1 - (1 - t) * (1 - t);

/** A size factor that follows intensity gently (sqrt), never below that of intensity 0.2. */
const sizeK = (ctx) => Math.sqrt(Math.max(0.2, ctx.intensity));
/** ctx.color scaled toward black: `k` 0.7 is "30% darker". */
const darker = (ctx, k) => ctx.color.clone().multiplyScalar(k);
const WHITE = '#ffffff';

/** Runs several effect handles as one: alive while any is; stop() stops them all. */
function together(...handles) {
  return {
    update(now) {
      let alive = false;
      for (const h of handles) alive = h.update(now) === true || alive;
      return alive;
    },
    stop() {
      for (const h of handles) h.stop();
    },
  };
}

/** Particle count: base x intensity x the tier's particle scale (at least 1). */
const countFor = (base, ctx) => Math.max(1, Math.round(base * Math.max(0, ctx.intensity) * (ctx.tier?.particleScale ?? 1)));

const originOf = (ctx, y = DIE_Y) => ({ x: ctx.position.x, y, z: ctx.position.z });

/** Tracks what an effect adds to the scene so stop() leaves nothing behind. */
function scoped(scene) {
  const added = [];
  return {
    add(object) {
      scene.add(object);
      added.push(object);
      return object;
    },
    dispose() {
      for (const o of added) {
        scene.remove(o);
        o.geometry?.dispose();
        o.material?.dispose();
      }
      added.length = 0;
    },
  };
}

/**
 * Emits `total` particles evenly over the first `window` (0..1) of the duration. With
 * `jitter` (world units), each batch is born at a random point of that radius around the origin
 * on the table plane: seen from above, the effect then fills the die's face, not one spot.
 */
function trickle(ctx, total, window, { jitter = 0, ...spec }) {
  let emitted = 0;
  return (e, now) => {
    const pool = ctx.particles;
    if (!pool) return;
    const want = Math.round(total * clamp01(e / Math.max(1, ctx.duration * window)));
    if (want > emitted) {
      let origin = spec.origin;
      if (jitter > 0 && origin) {
        const a = Math.random() * Math.PI * 2;
        const r = jitter * Math.sqrt(Math.random());
        origin = { x: origin.x + Math.cos(a) * r, y: origin.y, z: origin.z + Math.sin(a) * r };
      }
      pool.emit({ ...spec, origin, count: want - emitted, now });
      emitted = want;
    }
  };
}

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/**
 * Additive blending for shader quads on the (premultiplied-alpha) dice canvas: colour and alpha
 * both add, and the shaders write alpha = their brightest channel, so a transparent corner adds
 * nothing. THREE.AdditiveBlending with alpha 1 would leave an opaque black rectangle over the board.
 */
export const ADDITIVE_PREMULTIPLIED = Object.freeze({
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
});

/** A shader quad: uColor and uAlpha, plus `extra` uniforms ({ name: value }). */
function quadMaterial(fragment, color, extra = {}) {
  const uniforms = { uColor: { value: color.clone() }, uAlpha: { value: 0 } };
  for (const [name, value] of Object.entries(extra)) uniforms[name] = { value };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: QUAD_VERTEX,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    ...ADDITIVE_PREMULTIPLIED,
  });
}

/**
 * A soft radial halo (a gaussian that reaches zero at the quad's edge) with a small white core,
 * and optionally `uRays` thin light rays turned by `uSpin` (radians): each ray keeps a constant
 * angular-independent width (distance from its axis) and tapers out at its own length.
 */
const BURST_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uRays;
uniform float uSpin;
uniform float uRayAlpha;
varying vec2 vUv;
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length( p );
	float glow = exp( - r * r * 5.0 ) * ( 1.0 - smoothstep( 0.6, 1.0, r ) );
	float core = exp( - r * r * 60.0 );
	float rays = 0.0;
	if ( uRays > 0.5 ) {
		float sector = 6.2831853 / uRays;
		float a = atan( p.y, p.x + 0.00001 ) + uSpin;
		float idx = floor( a / sector + 0.5 );
		float d = r * abs( sin( a - idx * sector ) );
		float len = 0.6 + 0.4 * fract( sin( mod( idx, uRays ) * 12.9898 + 1.0 ) * 43758.5453 );
		float thin = 1.0 - smoothstep( 0.0, 0.01 + 0.02 * r, d );
		rays = thin * ( 1.0 - smoothstep( 0.05, len, r ) ) * smoothstep( 0.03, 0.15, r ) * uRayAlpha;
	}
	vec3 c = ( uColor * ( glow + rays ) + vec3( core + 0.4 * rays * ( 1.0 - r ) ) ) * uAlpha;
	gl_FragColor = vec4( c, clamp( max( max( c.r, c.g ), c.b ), 0.0, 1.0 ) );
}
`;
const BURST_UNIFORMS = Object.freeze({ uRays: 0, uSpin: 0, uRayAlpha: 0 });

/**
 * Two expanding rings (radius uR / uR2 in quad units 0..1, brightness uAlpha / uAlpha2): each
 * soft on its inner edge (a quadratic fade-in that widens as the ring grows) and sharp outside,
 * with a hint of white where the band is brightest.
 */
const RING_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uR;
uniform float uAlpha2;
uniform float uR2;
varying vec2 vUv;
float ring( float r, float R ) {
	float inner = smoothstep( R - ( 0.08 + 0.25 * R ), R, r );
	return inner * inner * ( 1.0 - smoothstep( R, R + 0.012, r ) );
}
void main() {
	float r = length( vUv * 2.0 - 1.0 );
	float band = ring( r, uR ) * uAlpha + ring( r, uR2 ) * uAlpha2;
	vec3 c = uColor * band + vec3( 0.3 * band * band );
	gl_FragColor = vec4( c, clamp( max( max( c.r, c.g ), c.b ), 0.0, 1.0 ) );
}
`;

/**
 * An additive radial glow decal on the table: colour ctx.color, brightness peak x intensity,
 * eased in over 60 ms, then shaped by `curve(elapsed)` (0..1; default: a quadratic fade-out over
 * `ms`). Returns an effect handle (a composite part or a self-contained effect); stop() or
 * reaching `ms` removes and disposes the mesh.
 */
export function floorGlow(ctx, { radius, peak, ms, curve = (e) => (1 - e / ms) ** 2 }) {
  const scope = scoped(ctx.scene);
  const material = quadMaterial(BURST_FRAGMENT, ctx.color, BURST_UNIFORMS);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(ctx.position.x, FLOOR_Y, ctx.position.z);
  mesh.scale.setScalar(2 * Math.max(0.01, radius));
  mesh.renderOrder = 1;
  scope.add(mesh);
  const level = Math.max(0, peak) * Math.max(0, ctx.intensity);
  material.uniforms.uAlpha.value = 0;
  return timed(
    ms,
    (e) => {
      const rise = clamp01(e / 60);
      material.uniforms.uAlpha.value = level * rise * rise * (3 - 2 * rise) * Math.max(0, curve(e));
    },
    () => scope.dispose(),
  );
}

export const lightBurst = Object.freeze({
  id: 'light-burst',
  cost: 1,
  defaults: Object.freeze({ color: '#fff0b0', intensity: 1, duration: 700 }),
  start(ctx) {
    const scope = scoped(ctx.scene);
    const material = quadMaterial(BURST_FRAGMENT, ctx.color, { ...BURST_UNIFORMS, uRays: 8 });
    const u = material.uniforms;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.position.set(ctx.position.x, DIE_Y + 0.6, ctx.position.z);
    if (ctx.camera?.quaternion) mesh.quaternion.copy(ctx.camera.quaternion); // a billboard
    mesh.scale.setScalar(0.01);
    mesh.renderOrder = 3;
    scope.add(mesh);
    const reach = 4.5 * Math.max(0.1, ctx.intensity);
    const spin0 = Math.random() * Math.PI * 2;
    const halo = timed(
      ctx.duration,
      (e) => {
        const k = e / ctx.duration;
        mesh.scale.setScalar(0.3 + reach * easeOut(k));
        u.uAlpha.value = Math.max(0, ctx.intensity) * (1 - k) ** 2;
        // The rays (scaled by uAlpha too) come in over the first 80 ms and thin out at the end.
        u.uRayAlpha.value = 1.4 * clamp01(e / 80) * (1 - k * k * k);
        u.uSpin.value = spin0 + 0.5 * (e / 1000); // a slow turn: ~20 degrees in 700 ms
      },
      () => scope.dispose(),
    );
    return together(halo, floorGlow(ctx, { radius: 2.5, peak: 0.7, ms: ctx.duration }));
  },
});

export const shockwave = Object.freeze({
  id: 'shockwave',
  cost: 1,
  defaults: Object.freeze({ color: '#ffe9a8', intensity: 1, duration: 800 }),
  start(ctx) {
    const scope = scoped(ctx.scene);
    const material = quadMaterial(RING_FRAGMENT, ctx.color, { uR: 0, uAlpha2: 0, uR2: 0 });
    const u = material.uniforms;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.rotation.x = -Math.PI / 2; // on the floor plane
    mesh.position.set(ctx.position.x, FLOOR_Y, ctx.position.z);
    const size = 7 * Math.max(0.2, ctx.intensity);
    mesh.scale.setScalar(size);
    mesh.renderOrder = 1;
    scope.add(mesh);
    const level = Math.max(0, ctx.intensity) * 1.3;
    const LAG = Math.min(90, ctx.duration / 4); // the second ring follows 90 ms behind
    const ringAt = (e, span) => {
      const k = clamp01(e / span);
      return { r: 0.08 + 0.9 * easeOut(k), a: 1 - k };
    };
    let dusted = false;
    const dust = (now) => {
      dusted = true;
      const pool = ctx.particles;
      if (!pool) return;
      // A ring of dust puffs rolling out along the table (one emit per direction).
      const n = countFor(12, ctx);
      const speed = 0.75 * size; // with drag 2.2 they settle ~0.34 x size out: behind the rings
      const tint = ctx.color.clone().lerp(new THREE.Color('#d8cfc0'), 0.6);
      const turn = Math.random() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const ang = turn + (i / n) * Math.PI * 2;
        pool.emit({
          count: 1,
          origin: { x: ctx.position.x, y: 0.08, z: ctx.position.z },
          dir: { x: Math.cos(ang), y: 0.08, z: Math.sin(ang) },
          speed,
          spread: 0.2,
          gravity: 0,
          drag: 2.2,
          life: Math.max(0.2, ctx.duration / 1000) * 0.8,
          size: 0.45 * sizeK(ctx),
          sizeEnd: 2.6,
          kind: KIND.SMOKE,
          shape: SHAPE.RING,
          blend: 'normal',
          color: tint,
          alpha: 0.35,
          now,
        });
      }
    };
    return timed(
      ctx.duration,
      (e, now) => {
        if (!dusted) dust(now);
        const one = ringAt(e, ctx.duration);
        u.uR.value = one.r;
        u.uAlpha.value = level * one.a;
        if (e < LAG) {
          u.uAlpha2.value = 0;
          return;
        }
        const two = ringAt(e - LAG, ctx.duration - LAG);
        u.uR2.value = two.r * 0.92;
        u.uAlpha2.value = 0.5 * level * two.a;
      },
      () => scope.dispose(),
    );
  },
});

export const sparkles = Object.freeze({
  id: 'sparkles',
  cost: 2,
  defaults: Object.freeze({ color: '#ffe27a', intensity: 1, duration: 1400 }),
  start(ctx) {
    if (!ctx.particles) return NOOP;
    // Spiralling motes in the effect's colour, burning out to white.
    const emit = trickle(ctx, countFor(40, ctx), 0.6, {
      origin: originOf(ctx, DIE_TOP),
      jitter: 0.35,
      dir: { x: 0, y: 1, z: 0 },
      speed: 1.8,
      spread: 1.1,
      gravity: 0.2,
      life: 1.0,
      color: ctx.color,
      colorEnd: WHITE,
      size: 0.2 * sizeK(ctx),
      kind: KIND.SPIRAL,
      shape: SHAPE.DOT,
    });
    // Four-point stars that spin and twinkle (KIND.GLINT's alpha flicker), white-hot to colour.
    const glints = trickle(ctx, countFor(14, ctx), 0.7, {
      origin: originOf(ctx, DIE_TOP),
      jitter: 0.45,
      dir: { x: 0, y: 1, z: 0 },
      speed: 1.5,
      spread: 1.5,
      gravity: -0.6,
      life: 0.8,
      color: ctx.color.clone().lerp(new THREE.Color(WHITE), 0.7),
      colorEnd: ctx.color,
      size: 0.4 * sizeK(ctx),
      kind: KIND.GLINT,
      shape: SHAPE.GLINT,
      spin: 2.5,
    });
    return timed(
      ctx.duration,
      (e, now) => {
        emit(e, now);
        glints(e, now);
      },
      () => {},
    );
  },
});

const EMBER_END = '#ff2a00';

export const embers = Object.freeze({
  id: 'embers',
  cost: 2,
  defaults: Object.freeze({ color: '#ff7a1a', intensity: 1, duration: 1600 }),
  start(ctx) {
    if (!ctx.particles) return NOOP;
    // Flame tongues rising off the die, cooling to deep red as they shrink.
    const flames = trickle(ctx, countFor(34, ctx), 0.7, {
      origin: originOf(ctx, DIE_TOP - 0.1),
      jitter: 0.55,
      dir: { x: 0, y: 1, z: 0 },
      speed: 1.8,
      spread: 1.3,
      gravity: 0.5, // buoyancy: they accelerate upward
      life: 1.1,
      color: ctx.color,
      colorEnd: EMBER_END,
      size: 0.32 * sizeK(ctx),
      sizeEnd: 0.3,
      kind: KIND.EMBER,
      shape: SHAPE.FLAME,
    });
    // Six quick sparks shooting up through them (at intensity 1, full particle scale).
    const streaks = trickle(ctx, countFor(6, ctx), 0.6, {
      origin: originOf(ctx, DIE_TOP),
      dir: { x: 0, y: 1, z: 0 },
      speed: 3.2,
      spread: 0.8,
      gravity: 1,
      life: 0.5,
      color: ctx.color.clone().lerp(new THREE.Color('#fff0c0'), 0.5),
      colorEnd: EMBER_END,
      size: 0.08 * sizeK(ctx),
      kind: KIND.STREAK,
      shape: SHAPE.STREAK,
    });
    const ms = ctx.duration;
    const glow = floorGlow(ctx, {
      radius: 1.6,
      peak: 0.5,
      ms,
      // Held for the duration (eased in and out), flickering like a fire.
      curve: (e) => envelope(e, ms) * (0.8 + 0.2 * Math.sin(e * 0.023) * Math.sin(e * 0.037 + 1)),
    });
    const fire = timed(
      ms,
      (e, now) => {
        flames(e, now);
        streaks(e, now);
      },
      () => {},
    );
    return together(fire, glow);
  },
});

/** Noise puffs that grow, turn and fade to `endColor` (default: 30% darker than ctx.color). */
const smokeStart = (endColor) => (ctx) => {
  if (!ctx.particles) return NOOP;
  const emit = trickle(ctx, countFor(16, ctx), 0.5, {
    origin: originOf(ctx, DIE_TOP),
    jitter: 0.35,
    dir: { x: 0, y: 1, z: 0 },
    speed: 2.2,
    spread: 1.4,
    gravity: 0.15,
    life: 1.3,
    color: ctx.color,
    colorEnd: endColor ?? darker(ctx, 0.7),
    size: 0.7 * sizeK(ctx),
    sizeEnd: 2.6,
    spin: 0.6,
    kind: KIND.SMOKE,
    shape: SHAPE.SMOKE,
    blend: 'normal',
  });
  return timed(ctx.duration, emit, () => {});
};

export const smoke = Object.freeze({
  id: 'smoke',
  cost: 2,
  defaults: Object.freeze({ color: '#8c8c92', intensity: 1, duration: 1500 }),
  start: smokeStart(),
});

/** Fumble's own smoke: same puffs, but they always darken to grey (not in CATALOGUE). */
const fumbleSmoke = Object.freeze({ ...smoke, id: 'fumble-smoke', start: smokeStart('#3a3a40') });

/**
 * Frost cracks on the floor: `rays` nearly straight crystalline rays, each with a side branch
 * or two. Every line carries `t0` (0..1): when, in the spread, it starts to grow (a branch
 * starts when the ray reaches its root).
 */
function frostLines(cx, cz, radius, rays) {
  const lines = [];
  const at = (ang, r) => ({ x: cx + Math.cos(ang) * r, y: FLOOR_Y, z: cz + Math.sin(ang) * r });
  const STEPS = 5;
  for (let i = 0; i < rays; i++) {
    let ang = (i / rays) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const reach = radius * (0.7 + Math.random() * 0.3);
    const ray = [at(ang, 0.3)];
    for (let s = 1; s <= STEPS; s++) {
      ang += (Math.random() - 0.5) * 0.18;
      const r = 0.3 + ((reach - 0.3) * s) / STEPS;
      const p = at(ang, r);
      ray.push(p);
      if (s < STEPS - 1 && (s === 2 || Math.random() < 0.35)) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const len = reach * (0.18 + Math.random() * 0.14);
        const ba = ang + side * (0.5 + Math.random() * 0.3);
        const mid = { x: p.x + Math.cos(ba) * len * 0.5, y: FLOOR_Y, z: p.z + Math.sin(ba) * len * 0.5 };
        const tip = { x: p.x + Math.cos(ba + side * 0.15) * len, y: FLOOR_Y, z: p.z + Math.sin(ba + side * 0.15) * len };
        lines.push({ pts: [p, mid, tip], t0: s / STEPS });
      }
    }
    lines.unshift({ pts: ray, t0: 0 });
  }
  return lines;
}

const FROST_SPREAD_MS = 300;

export const frost = Object.freeze({
  id: 'frost',
  cost: 2,
  defaults: Object.freeze({ color: '#a8e4ff', intensity: 1, duration: 1800 }),
  start(ctx) {
    const power = Math.max(0.2, ctx.intensity);
    const lines = frostLines(ctx.position.x, ctx.position.z, 1.6 * power, 9);
    const ribbon = createRibbon({
      maxPoints: lines.reduce((n, l) => n + l.pts.length, 0),
      widthPx: 2.5,
      color: ctx.color,
    });
    ribbon.alpha = 0;
    ctx.scene.add(ribbon.mesh); // ribbon.dispose() removes it
    const spread = Math.min(FROST_SPREAD_MS, ctx.duration / 2);
    const shards = trickle(ctx, countFor(22, ctx), 0.2, {
      origin: originOf(ctx, DIE_TOP),
      dir: { x: 0, y: 1, z: 0 },
      speed: 2,
      spread: 1.35,
      gravity: -5,
      life: 0.9,
      color: ctx.color.clone().lerp(new THREE.Color(WHITE), 0.4),
      colorEnd: ctx.color,
      size: 0.15 * Math.sqrt(power),
      kind: KIND.SHARD,
      shape: SHAPE.SHARD,
      spin: 7,
    });
    // A pale, low mist over the cracks (normal blend: it veils rather than glows).
    const mist = trickle(ctx, countFor(2, ctx), 0.1, {
      origin: originOf(ctx, DIE_TOP),
      jitter: 0.5,
      dir: { x: 0, y: 1, z: 0 },
      speed: 0.25,
      spread: 1.4,
      gravity: 0,
      life: Math.max(0.3, ctx.duration / 1000) * 0.85,
      color: '#e8f8ff',
      size: 1.3 * Math.sqrt(power),
      sizeEnd: 2.6,
      spin: 0.4,
      kind: KIND.SMOKE,
      shape: SHAPE.SMOKE,
      blend: 'normal',
      alpha: 0.3,
    });
    return timed(
      ctx.duration,
      (e, now) => {
        shards(e, now);
        mist(e, now);
        const k = e / spread;
        ribbon.setPolylines(lines.map((l) => prefixOf(l.pts, (k - l.t0) / Math.max(0.01, 1 - l.t0))));
        ribbon.alpha = Math.max(0, ctx.intensity) * envelope(e, ctx.duration);
      },
      () => {
        ribbon.dispose();
      },
    );
  },
});

/**
 * A jagged line from a to b by midpoint displacement: `levels` halvings, each midpoint pushed
 * sideways (along the horizontal perpendicular of a->b) and a little up or down, by `rough` x the
 * segment length, the roughness shrinking per level so the bolt has big kinks and fine crackle.
 */
function jagged(a, b, levels, rough) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dl = Math.hypot(dx, dz) || 1;
  const px = -dz / dl;
  const pz = dx / dl;
  let pts = [a, b];
  for (let l = 0; l < levels; l++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1];
      const q = pts[i];
      const len = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      const off = (Math.random() - 0.5) * 2 * rough * len;
      const up = (Math.random() - 0.5) * 0.5 * rough * len;
      out.push({
        x: (p.x + q.x) / 2 + px * off,
        y: Math.max(FLOOR_Y, (p.y + q.y) / 2 + up),
        z: (p.z + q.z) / 2 + pz * off,
      });
      out.push(q);
    }
    pts = out;
    rough *= 0.7;
  }
  return pts;
}

const BOLT_LEVELS = 6; // 65 points
const BRANCH_LEVELS = 4; // 17 points
const MAX_BRANCHES = 4;
const STRIKES = [0, 0.22, 0.48]; // fractions of the duration
const STRIKE_PEAK = [1.35, 1.2, 1.1];
const ALPHA_CAP = 1.5; // per additive layer: brighter saturates to white and loses the colour // each re-strike flashes above the fading previous one
// Width factor along a line: full at t = 0 (the impact end of the bolt, the root of a branch),
// 30% at the tip. Held near full for the first stretch so the strike reads thick where it lands.
// Black "over" (premultiplied): colour = dst x (1 - a), a = the ribbon's glow profile.
const SHADOW_BLEND = Object.freeze({
  blendSrc: THREE.ZeroFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
});
const boltTaper = (t) => 1 - 0.7 * t ** 2.2;

/**
 * One strike: the main bolt from the impact (beside the die, on the table) up to a point high
 * above and out to one side (the camera looks straight down, so a vertical bolt would be a dot),
 * listed impact-first so the taper thins it toward the sky; plus 2-4 branches that leave its
 * upper half and fork down and outward.
 */
function strikePath(ctx, ang, reach) {
  const { x: cx, z: cz } = ctx.position;
  const ux = Math.cos(ang);
  const uz = Math.sin(ang);
  const impact = { x: cx + ux * 0.45, y: FLOOR_Y, z: cz + uz * 0.45 };
  const sky = { x: cx + ux * reach, y: 5, z: cz + uz * reach };
  const bolt = jagged(impact, sky, BOLT_LEVELS, 0.3);
  const branches = [];
  const n = 2 + Math.floor(Math.random() * (MAX_BRANCHES - 1));
  for (let i = 0; i < n; i++) {
    const root = bolt[Math.floor(bolt.length * (0.3 + Math.random() * 0.45))];
    const side = i % 2 === 0 ? 1 : -1;
    const fa = ang + side * (0.45 + Math.random() * 0.7);
    const len = reach * (0.3 + Math.random() * 0.3);
    const tip = {
      x: root.x - Math.cos(fa) * len * 0.2 + Math.cos(fa + side * 1.2) * len * 0.5,
      y: Math.max(FLOOR_Y, root.y * (0.15 + Math.random() * 0.35)),
      z: root.z - Math.sin(fa) * len * 0.2 + Math.sin(fa + side * 1.2) * len * 0.5,
    };
    branches.push(jagged(root, tip, BRANCH_LEVELS, 0.3));
  }
  return { bolt, branches, impact };
}

export const lightning = Object.freeze({
  id: 'lightning',
  cost: 2,
  defaults: Object.freeze({ color: '#b9d4ff', intensity: 1, duration: 700 }),
  start(ctx) {
    const pal = palette(ctx.color);
    const glowColor = pal.rim ?? pal.mid; // a near-black die glows in its rim colour
    const sparkColor = pal.rim ? pal.rim.clone().lerp(new THREE.Color(WHITE), 0.5) : pal.core;
    const k = sizeK(ctx);
    // Above intensity 1 the bolt grows (k) but not brighter: additive layers past ~1.5 saturate to
    // white and lose the die colour. Halo and shadow widths stop growing at k 1.2.
    const kw = Math.min(k, 1.2);
    const bright = Math.min(1, Math.max(0, ctx.intensity));
    // Pale glows (near-white, the near-black rim) get a stronger dark band so they read on a light
    // map; the near-black rim gets a wider, stronger halo so the die's glow is unmistakable.
    const lum = glowColor.getHSL({}, THREE.SRGBColorSpace).l;
    const shadowGain = 0.2 + 0.9 * lum;
    const haloGain = pal.rim ? 1.5 : 1.2;
    const D = Math.max(1, ctx.duration);
    const ribbon = (widthPx, maxPoints, core = 0.3, glow = 0.55, color = glowColor) => {
      const r = createRibbon({ maxPoints, widthPx, color, taper: boltTaper, core, glow });
      r.alpha = 0;
      ctx.scene.add(r.mesh); // r.dispose() removes it
      return r;
    };
    const pts = 2 ** BOLT_LEVELS + 1;
    // A soft dark band under the bolt (drawn first, normal "over" in black): invisible on a dark
    // table, it gives a pale bolt contrast on a light map.
    // White, so its alpha (the brightest channel) is the full glow profile whatever the die colour.
    const shadow = ribbon(52 * kw, pts, 0.02, 0.8, new THREE.Color(WHITE));
    Object.assign(shadow.mesh.material, SHADOW_BLEND);
    shadow.mesh.renderOrder = 2;
    const halo = ribbon((pal.rim ? 80 : 64) * kw, pts, 0.02, pal.rim ? 0.5 : 0.4); // a wide soft bloom around the bolt
    const bolt = ribbon(14, pts, 0.65, 0.5);
    const branches = ribbon(7, MAX_BRANCHES * (2 ** BRANCH_LEVELS + 1), 0.5, 0.5);
    const ribbons = [shadow, halo, bolt, branches];
    const times = ctx.reducedMotion ? [0] : STRIKES.map((f) => f * D);
    const base = Math.random() * Math.PI * 2;
    const reach = 4.6 * Math.max(0.5, k);
    let struck = 0;
    let level = 0; // the current flash, shared by the ribbons and the floor glow
    const strike = (now) => {
      const p = strikePath(ctx, base + (Math.random() - 0.5) * 0.7, reach);
      shadow.setPolylines([p.bolt]);
      halo.setPolylines([p.bolt]);
      bolt.setPolylines([p.bolt]);
      branches.setPolylines(p.branches);
      // Born above the die top: the impact itself is beside the die, partly under it from above.
      const origin = { x: p.impact.x, y: DIE_TOP, z: p.impact.z };
      ctx.particles?.emit({
        count: countFor(18, ctx),
        origin,
        dir: { x: 0, y: 1, z: 0 },
        speed: 3.2,
        spread: 1.4,
        gravity: -9,
        life: 0.35,
        color: sparkColor,
        colorEnd: glowColor,
        size: 0.14 * k,
        kind: KIND.SPARK,
        shape: SHAPE.GLINT,
        halo: 0.8,
        now,
      });
      ctx.particles?.emit({
        count: 1,
        origin,
        speed: 0,
        life: 0.2,
        color: sparkColor,
        colorEnd: glowColor,
        size: 1.5 * k,
        sizeEnd: 1.8,
        shape: SHAPE.DOT,
        halo: 1,
        now,
      });
    };
    const flashAt = (e) => {
      const i = struck - 1;
      const dt = e - times[i];
      const last = i === times.length - 1;
      // A sharp spike that settles to an afterglow; the last strike fades out by the duration.
      if (ctx.reducedMotion) {
        // One steady strike: held at its peak, then a single smooth fade over the last 40%.
        return STRIKE_PEAK[0] * (1 - clamp01((e - 0.6 * D) / (0.4 * D))) ** 1.5;
      }
      const tail = last ? (1 - clamp01(dt / Math.max(1, D - times[i]))) ** 1.5 : 1;
      return STRIKE_PEAK[i] * (0.5 + 0.5 * Math.exp(-dt / (0.12 * D))) * tail;
    };
    const glow = floorGlow({ ...ctx, color: glowColor, intensity: bright }, { radius: 1.8 * k, peak: 0.9, ms: D, curve: () => level });
    const strikes = timed(
      D,
      (e, now) => {
        while (struck < times.length && e >= times[struck]) {
          struck++;
          strike(now);
        }
        const flicker = ctx.reducedMotion ? 1 : 0.85 + 0.15 * Math.random();
        level = flashAt(e) * flicker;
        const a = bright * level;
        bolt.alpha = Math.min(ALPHA_CAP, 1.1 * a);
        branches.alpha = Math.min(ALPHA_CAP, a);
        halo.alpha = Math.min(ALPHA_CAP, haloGain * a);
        shadow.alpha = Math.min(ALPHA_CAP, shadowGain * a);
      },
      () => {
        for (const r of ribbons) r.dispose();
      },
    );
    return together(strikes, glow);
  },
});

export const shatter = Object.freeze({
  id: 'shatter',
  cost: 3,
  bindsDie: true, // it hides the die: released with it
  defaults: Object.freeze({ color: '#e8efff', intensity: 1, duration: 900 }),
  start(ctx) {
    const outer = ctx.die?.outer;
    const pool = ctx.particles;
    if (!outer || !pool) return NOOP;
    const was = outer.visible;
    outer.visible = false;
    const life = Math.max(0.2, ctx.duration / 1000);
    pool.emit({
      count: countFor(36, ctx),
      origin: originOf(ctx, DIE_Y),
      dir: { x: 0, y: 1, z: 0 },
      speed: 2.6,
      spread: 1.5,
      gravity: -7,
      life: life * 0.85,
      color: ctx.color,
      colorEnd: darker(ctx, 0.5), // they dim as they settle (and KIND.SHARD fades out at the end)
      size: 0.4 * sizeK(ctx),
      spin: 8,
      kind: KIND.SHARD,
      shape: SHAPE.SHARD,
      blend: 'normal',
    });
    // A brief star-flash where the die was (KIND.SPARK: a plain fade, no twinkle to dim it).
    pool.emit({
      count: countFor(2, ctx),
      origin: originOf(ctx, DIE_Y),
      speed: 0,
      life: Math.min(0.25, life * 0.3),
      color: WHITE,
      colorEnd: ctx.color,
      size: 1.1 * sizeK(ctx),
      sizeEnd: 1.6,
      spin: 1.5,
      kind: KIND.SPARK,
      shape: SHAPE.GLINT,
    });
    return timed(ctx.duration, () => {}, () => {
      outer.visible = was;
    });
  },
});

export const shake = Object.freeze({
  id: 'shake',
  cost: 0,
  defaults: Object.freeze({ color: '#ffffff', intensity: 0.5, duration: 300 }),
  start(ctx) {
    ctx.shake(ctx.intensity, ctx.duration); // the layer runs (and bounds) the shake itself
    return { update: () => false, stop() {} };
  },
});

const tinyShake = (id, amount, ms) =>
  Object.freeze({ ...shake, id, defaults: Object.freeze({ ...shake.defaults, intensity: amount, duration: ms }) });

/**
 * Private composite parts (not in CATALOGUE / EFFECT_IDS): { id, cost, defaults, start(ctx) }.
 * Everything they add to the scene is removed at their end and on stop().
 */

/** The floor glow as a free (cost 0) part: it only lights the table under the die. */
const floorGlowPart = Object.freeze({
  id: 'floor-glow',
  cost: 0,
  defaults: Object.freeze({ color: '#ffe27a', intensity: 1, duration: 700 }),
  start: (ctx) => floorGlow(ctx, { radius: 3, peak: 1.2, ms: ctx.duration }),
});

/** A one-off burst of streak sparks flying out of the die. */
const sparkBurstPart = Object.freeze({
  id: 'spark-burst',
  cost: 1,
  defaults: Object.freeze({ color: '#ffe27a', intensity: 1, duration: 600 }),
  start(ctx) {
    ctx.particles?.emit({
      count: countFor(24, ctx),
      origin: originOf(ctx, DIE_Y),
      dir: { x: 0, y: 1, z: 0 },
      speed: 5,
      spread: 1.2,
      life: 0.6,
      color: ctx.color,
      colorEnd: '#ff9a3c',
      size: 0.1 * Math.sqrt(Math.max(0.2, ctx.intensity)),
      kind: KIND.STREAK,
    });
    return NOOP;
  },
});

/** Glitter flakes drifting down from above the die. */
const glitterPart = Object.freeze({
  id: 'glitter',
  cost: 1,
  defaults: Object.freeze({ color: '#ffe27a', intensity: 1, duration: 1200 }),
  start(ctx) {
    if (!ctx.particles) return NOOP;
    const emit = trickle(ctx, countFor(30, ctx), 0.5, {
      origin: originOf(ctx, DIE_Y + 2.5),
      dir: { x: 0, y: -1, z: 0 },
      speed: 0.4,
      spread: 1.3,
      gravity: -2.5,
      life: 1.4,
      color: '#ffffff',
      colorEnd: ctx.color,
      size: 0.12 * Math.sqrt(Math.max(0.2, ctx.intensity)),
      kind: KIND.FLAKE,
      spin: 4,
    });
    return timed(ctx.duration, emit, () => {});
  },
});

/** Grey cracks spreading over the table from the die: a ribbon of random jagged rays. */
function crackLines(cx, cz, radius, rays) {
  const lines = [];
  const at = (ang, r) => ({ x: cx + Math.cos(ang) * r, y: FLOOR_Y, z: cz + Math.sin(ang) * r });
  for (let i = 0; i < rays; i++) {
    let ang = (i / rays) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const line = [at(ang, 0.25)];
    const steps = 4;
    for (let s = 1; s <= steps; s++) {
      ang += (Math.random() - 0.5) * 0.35;
      const r = 0.25 + (((radius - 0.25) * s) / steps) * (0.85 + Math.random() * 0.3);
      const p = at(ang, r);
      line.push(p);
      if (s === 2) {
        const ba = ang + (Math.random() < 0.5 ? -0.7 : 0.7);
        lines.push([p, { x: p.x + Math.cos(ba) * radius * 0.3, y: FLOOR_Y, z: p.z + Math.sin(ba) * radius * 0.3 }]);
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The first `k` (0..1) of a polyline, by point: whole points plus one interpolated tip. */
function prefixOf(line, k) {
  const f = clamp01(k) * (line.length - 1);
  const whole = Math.floor(f);
  const out = line.slice(0, whole + 1);
  const frac = f - whole;
  if (frac > 0 && whole + 1 < line.length) {
    const a = line[whole];
    const b = line[whole + 1];
    out.push({ x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac, z: a.z + (b.z - a.z) * frac });
  }
  return out;
}

const crackPart = Object.freeze({
  id: 'crack',
  cost: 1,
  defaults: Object.freeze({ color: '#5a5a60', intensity: 1, duration: 1000 }),
  start(ctx) {
    const lines = crackLines(ctx.position.x, ctx.position.z, 1.5 * Math.max(0.3, ctx.intensity), 6);
    const ribbon = createRibbon({
      maxPoints: lines.reduce((n, l) => n + l.length, 0),
      widthPx: 3,
      color: ctx.color,
    });
    ribbon.alpha = 0;
    ctx.scene.add(ribbon.mesh); // ribbon.dispose() removes it
    const spread = Math.min(250, ctx.duration / 2);
    return timed(
      ctx.duration,
      (e) => {
        ribbon.setPolylines(lines.map((l) => prefixOf(l, e / spread)));
        ribbon.alpha = Math.max(0, ctx.intensity) * envelope(e, ctx.duration);
      },
      () => {
        ribbon.dispose();
      },
    );
  },
});

/** A few dim embers dropping off the die once it has gone cold. */
const fizzlePart = Object.freeze({
  id: 'fizzle',
  cost: 1,
  defaults: Object.freeze({ color: '#c8a070', intensity: 1, duration: 600 }),
  start(ctx) {
    ctx.particles?.emit({
      count: countFor(8, ctx),
      origin: originOf(ctx, DIE_Y + 0.3),
      dir: { x: 0, y: 1, z: 0 },
      speed: 1.2,
      spread: 1.3,
      gravity: -6,
      life: 0.6,
      color: ctx.color,
      colorEnd: '#402010',
      size: 0.08 * Math.sqrt(Math.max(0.2, ctx.intensity)),
      kind: KIND.STREAK,
      alpha: 0.6,
    });
    return NOOP;
  },
});

// Parts are in budget priority order after the essential one (index 0).
export const celebrate = composite({
  id: 'celebrate',
  defaults: { color: '#ffe27a', intensity: 1, duration: 1400 },
  parts: [
    { mod: lightBurst, at: 120 },
    { mod: DIE_EFFECTS['number-flare'], at: 0 },
    { mod: floorGlowPart, at: 120 },
    { mod: shockwave, at: 120 },
    { mod: sparkBurstPart, at: 120 },
    { mod: glitterPart, at: 200 },
    { mod: DIE_EFFECTS['glow-pulse'], at: 0 },
    { mod: tinyShake('celebrate-shake', 0.3, 280), at: 120 },
  ],
});

export const fumble = composite({
  id: 'fumble',
  defaults: { color: '#8c8c92', intensity: 1, duration: 1500 },
  parts: [
    { mod: fumbleSmoke, at: 0 },
    { mod: DIE_EFFECTS['color-shift'], at: 0, color: '#3a3a40', intensity: 0.8 },
    { mod: crackPart, at: 80 },
    { mod: fizzlePart, at: 150 },
    { mod: tinyShake('fumble-shake', 0.15, 220), at: 80 },
  ],
});

export const CATALOGUE = Object.freeze({
  [lightBurst.id]: lightBurst,
  [sparkles.id]: sparkles,
  [embers.id]: embers,
  [frost.id]: frost,
  [lightning.id]: lightning,
  [smoke.id]: smoke,
  [shatter.id]: shatter,
  [shockwave.id]: shockwave,
  [shake.id]: shake,
  [celebrate.id]: celebrate,
  [fumble.id]: fumble,
});

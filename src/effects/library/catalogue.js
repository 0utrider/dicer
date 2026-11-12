import * as THREE from 'three';
import { DIE_EFFECTS, NOOP, envelope, timed } from './die-effects.js';
import { KIND } from './particles.js';
import { composite } from './timeline.js';

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
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOut = (t) => 1 - (1 - t) * (1 - t);

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

/** Emits `total` particles evenly over the first `window` (0..1) of the duration. */
function trickle(ctx, total, window, spec) {
  let emitted = 0;
  return (e, now) => {
    const pool = ctx.particles;
    if (!pool) return;
    const want = Math.round(total * clamp01(e / Math.max(1, ctx.duration * window)));
    if (want > emitted) {
      pool.emit({ ...spec, count: want - emitted, now });
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

function quadMaterial(fragment, color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uAlpha: { value: 0 }, uR: { value: 0 } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    ...ADDITIVE_PREMULTIPLIED,
  });
}

const BURST_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
	float r = length( vUv * 2.0 - 1.0 );
	float glow = pow( max( 0.0, 1.0 - r ), 2.0 );
	float core = pow( max( 0.0, 1.0 - r * 2.5 ), 2.0 );
	vec3 c = ( uColor * glow + vec3( core ) ) * uAlpha;
	gl_FragColor = vec4( c, clamp( max( max( c.r, c.g ), c.b ), 0.0, 1.0 ) );
}
`;
const RING_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uR;
varying vec2 vUv;
void main() {
	float r = length( vUv * 2.0 - 1.0 );
	float band = smoothstep( uR - 0.22, uR, r ) * ( 1.0 - smoothstep( uR, uR + 0.035, r ) );
	vec3 c = uColor * ( band * uAlpha );
	gl_FragColor = vec4( c, clamp( max( max( c.r, c.g ), c.b ), 0.0, 1.0 ) );
}
`;

/**
 * An additive radial glow decal on the table: colour ctx.color, brightness peak x intensity,
 * eased in over 60 ms then fading out over `ms`. Returns an effect handle (a composite part or
 * a self-contained effect); stop() or reaching `ms` removes and disposes the mesh.
 */
export function floorGlow(ctx, { radius, peak, ms }) {
  const scope = scoped(ctx.scene);
  const material = quadMaterial(BURST_FRAGMENT, ctx.color);
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
      material.uniforms.uAlpha.value = level * rise * rise * (3 - 2 * rise) * (1 - e / ms) ** 2;
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
    const material = quadMaterial(BURST_FRAGMENT, ctx.color);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.position.set(ctx.position.x, DIE_Y + 0.6, ctx.position.z);
    mesh.quaternion.copy(ctx.camera.quaternion); // a billboard: always faces the camera
    mesh.scale.setScalar(0.01);
    mesh.renderOrder = 3;
    scope.add(mesh);
    const reach = 4 * Math.max(0.1, ctx.intensity);
    return timed(
      ctx.duration,
      (e) => {
        const k = e / ctx.duration;
        mesh.scale.setScalar(0.3 + reach * easeOut(k));
        material.uniforms.uAlpha.value = Math.max(0, ctx.intensity) * (1 - k) ** 2;
      },
      () => scope.dispose(),
    );
  },
});

export const shockwave = Object.freeze({
  id: 'shockwave',
  cost: 1,
  defaults: Object.freeze({ color: '#ffe9a8', intensity: 1, duration: 800 }),
  start(ctx) {
    const scope = scoped(ctx.scene);
    const material = quadMaterial(RING_FRAGMENT, ctx.color);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.rotation.x = -Math.PI / 2; // on the floor plane
    mesh.position.set(ctx.position.x, FLOOR_Y, ctx.position.z);
    mesh.scale.setScalar(7 * Math.max(0.2, ctx.intensity));
    mesh.renderOrder = 1;
    scope.add(mesh);
    return timed(
      ctx.duration,
      (e) => {
        const k = e / ctx.duration;
        material.uniforms.uR.value = 0.08 + 0.9 * easeOut(k);
        material.uniforms.uAlpha.value = Math.max(0, ctx.intensity) * 1.6 * (1 - k);
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
    const emit = trickle(ctx, countFor(40, ctx), 0.6, {
      origin: originOf(ctx, 0.3),
      dir: { x: 0, y: 1, z: 0 },
      speed: 1.6,
      spread: 0.9,
      gravity: 0.2,
      life: 1.0,
      color: ctx.color,
      size: 0.16 * Math.sqrt(Math.max(0.2, ctx.intensity)),
      kind: KIND.SPIRAL,
    });
    const glints = trickle(ctx, countFor(14, ctx), 0.7, {
      origin: originOf(ctx, 0.5),
      speed: 1.2,
      spread: Math.PI,
      life: 0.7,
      color: '#ffffff',
      size: 0.12 * Math.sqrt(Math.max(0.2, ctx.intensity)),
      kind: KIND.GLINT,
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

export const embers = Object.freeze({
  id: 'embers',
  cost: 2,
  defaults: Object.freeze({ color: '#ff7a1a', intensity: 1, duration: 1600 }),
  start(ctx) {
    if (!ctx.particles) return NOOP;
    const emit = trickle(ctx, countFor(34, ctx), 0.7, {
      origin: originOf(ctx, 0.2),
      dir: { x: 0, y: 1, z: 0 },
      speed: 1.1,
      spread: 0.7,
      gravity: 0.5, // buoyancy: they accelerate upward
      life: 1.1,
      color: ctx.color,
      size: 0.14 * Math.sqrt(Math.max(0.2, ctx.intensity)),
      kind: KIND.EMBER,
    });
    return timed(ctx.duration, emit, () => {});
  },
});

export const smoke = Object.freeze({
  id: 'smoke',
  cost: 2,
  defaults: Object.freeze({ color: '#8c8c92', intensity: 1, duration: 1500 }),
  start(ctx) {
    if (!ctx.particles) return NOOP;
    const emit = trickle(ctx, countFor(16, ctx), 0.5, {
      origin: originOf(ctx, 0.3),
      dir: { x: 0, y: 1, z: 0 },
      speed: 0.7,
      spread: 1.2,
      gravity: 0.15,
      life: 1.3,
      color: ctx.color,
      size: 0.55 * Math.sqrt(Math.max(0.2, ctx.intensity)),
      kind: KIND.SMOKE,
      blend: 'normal',
    });
    return timed(ctx.duration, emit, () => {});
  },
});

/** Radial crack lines on the floor: a jagged ray per sector with a branch halfway out. */
function crackGeometry(cx, cz, radius, rays) {
  const pts = [];
  const seg = (a, b) => pts.push(a[0], FLOOR_Y, a[1], b[0], FLOOR_Y, b[1]);
  for (let i = 0; i < rays; i++) {
    let ang = (i / rays) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    let r = 0.25;
    let prev = [cx + Math.cos(ang) * r, cz + Math.sin(ang) * r];
    const steps = 4;
    for (let s = 1; s <= steps; s++) {
      ang += (Math.random() - 0.5) * 0.35;
      r = 0.25 + ((radius - 0.25) * s) / steps * (0.85 + Math.random() * 0.3);
      const next = [cx + Math.cos(ang) * r, cz + Math.sin(ang) * r];
      seg(prev, next);
      if (s === 2) {
        const ba = ang + (Math.random() < 0.5 ? -0.7 : 0.7);
        seg(next, [next[0] + Math.cos(ba) * radius * 0.3, next[1] + Math.sin(ba) * radius * 0.3]);
      }
      prev = next;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

export const frost = Object.freeze({
  id: 'frost',
  cost: 2,
  defaults: Object.freeze({ color: '#a8e4ff', intensity: 1, duration: 1800 }),
  start(ctx) {
    const scope = scoped(ctx.scene);
    const power = Math.max(0.2, ctx.intensity);
    const geometry = crackGeometry(ctx.position.x, ctx.position.z, 1.6 * power, 9);
    const material = new THREE.LineBasicMaterial({
      color: ctx.color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    scope.add(new THREE.LineSegments(geometry, material));
    const total = geometry.getAttribute('position').count;
    const shards = trickle(ctx, countFor(22, ctx), 0.2, {
      origin: originOf(ctx, 0.3),
      dir: { x: 0, y: 1, z: 0 },
      speed: 1.5,
      spread: 1.35,
      gravity: -4,
      life: 0.9,
      color: ctx.color,
      size: 0.13 * Math.sqrt(power),
      kind: KIND.SHARD,
    });
    return timed(
      ctx.duration,
      (e, now) => {
        shards(e, now);
        // The cracks spread out in the first 300 ms (segments are stored ray by ray), then fade.
        geometry.setDrawRange(0, Math.ceil((total * Math.min(1, e / 300)) / 2) * 2);
        material.opacity = clamp01(ctx.intensity) * envelope(e, ctx.duration);
      },
      () => scope.dispose(),
    );
  },
});

export const lightning = Object.freeze({
  id: 'lightning',
  cost: 2,
  defaults: Object.freeze({ color: '#b9d4ff', intensity: 1, duration: 700 }),
  start(ctx) {
    const scope = scoped(ctx.scene);
    const arcs = ctx.intensity >= 1 ? 3 : 2;
    const SEGS = 9;
    const positions = new Float32Array(arcs * SEGS * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.LineBasicMaterial({
      color: ctx.color,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const lines = scope.add(new THREE.LineSegments(geometry, material));
    lines.frustumCulled = false;
    const reach = 2.4 * Math.max(0.4, Math.sqrt(ctx.intensity));
    const { x: cx, z: cz } = ctx.position;
    const y = DIE_Y;
    const regenerate = () => {
      let o = 0;
      for (let a = 0; a < arcs; a++) {
        const ang = Math.random() * Math.PI * 2;
        const len = reach * (0.6 + Math.random() * 0.4);
        const ex = Math.cos(ang) * len;
        const ez = Math.sin(ang) * len;
        const px = -Math.sin(ang);
        const pz = Math.cos(ang);
        let lx = cx;
        let ly = y;
        let lz = cz;
        for (let s = 1; s <= SEGS; s++) {
          const f = s / SEGS;
          const jit = s === SEGS ? 0 : (Math.random() - 0.5) * 0.45 * reach * 0.5;
          const nx = cx + ex * f + px * jit;
          const nz = cz + ez * f + pz * jit;
          const ny = y + (Math.random() - 0.5) * 0.25 - f * 0.4;
          positions.set([lx, ly, lz, nx, ny, nz], o);
          o += 6;
          lx = nx;
          ly = ny;
          lz = nz;
        }
      }
      geometry.getAttribute('position').needsUpdate = true;
    };
    regenerate();
    let last = 0;
    return timed(
      ctx.duration,
      (e) => {
        if (e - last >= 60) {
          last = e;
          regenerate();
        }
        material.opacity = clamp01(ctx.intensity) * (0.6 + 0.4 * Math.random()) * (1 - (e / ctx.duration) ** 2);
      },
      () => scope.dispose(),
    );
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
    pool.emit({
      count: countFor(36, ctx),
      origin: originOf(ctx, DIE_Y),
      dir: { x: 0, y: 1, z: 0 },
      speed: 2.6,
      spread: 1.5,
      gravity: -7,
      life: Math.max(0.2, ctx.duration / 1000) * 0.85,
      color: ctx.color,
      size: 0.2 * Math.sqrt(Math.max(0.2, ctx.intensity)),
      kind: KIND.SHARD,
      blend: 'normal',
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

export const celebrate = composite({
  id: 'celebrate',
  defaults: { color: '#ffe27a', intensity: 1, duration: 1400 },
  parts: [
    { mod: lightBurst },
    { mod: shockwave },
    { mod: DIE_EFFECTS['number-flare'] },
    { mod: sparkles },
    { mod: tinyShake('celebrate-shake', 0.3, 280) },
  ],
});

export const fumble = composite({
  id: 'fumble',
  defaults: { color: '#8c8c92', intensity: 1, duration: 1500 },
  parts: [
    { mod: smoke },
    { mod: DIE_EFFECTS['color-shift'], color: '#3a3a40', intensity: 0.8 },
    { mod: tinyShake('fumble-shake', 0.15, 220) },
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

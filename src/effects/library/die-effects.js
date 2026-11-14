import * as THREE from 'three';
import { withInsideFlare } from './inside-flare.js';

/**
 * Die effects: they change the landed die itself. color-shift and number-flare write the fx
 * uniform block (uFxTint, uFxFlare) of the die's isolated material; glow-pulse adds a shell
 * mesh around it. All three are bound to their die (released with it) and cost 1.
 */

export const EASE_IN_MS = 150;
const EASE_OUT_MAX_MS = 300;
const GLOW_SCALE = 1.08;
const GLOW_PERIOD_MS = 600;

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** 0..1: eases in over 150 ms, holds, eases out over the last min(300 ms, a third). */
export function envelope(elapsed, duration) {
  if (!(elapsed < duration)) return 0;
  const tin = Math.min(EASE_IN_MS, duration / 2);
  const tout = Math.min(EASE_OUT_MAX_MS, duration / 3);
  if (elapsed < tin) return smooth(elapsed / tin);
  if (elapsed > duration - tout) return smooth((duration - elapsed) / tout);
  return 1;
}

export const NOOP = Object.freeze({ update: () => false, stop() {} });

/** Runs `frame(elapsed, nowMs)` from the first update until `duration`, then `end()`. */
export function timed(duration, frame, end) {
  let t0 = null;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    end();
  };
  return {
    update(now) {
      if (done) return false;
      t0 ??= now;
      const e = now - t0;
      if (e >= duration) {
        finish();
        return false;
      }
      frame(e, now);
      return true;
    },
    stop: finish,
  };
}

export const colorShift = Object.freeze({
  id: 'color-shift',
  cost: 1,
  bindsDie: true,
  defaults: Object.freeze({ color: '#ffd34d', intensity: 0.65, duration: 1600 }),
  start(ctx) {
    const u = ctx.isolate(ctx.die);
    const tint = u?.uFxTint?.value;
    if (!tint) return NOOP;
    const { r, g, b } = ctx.color;
    const share = clamp01(ctx.intensity);
    return timed(
      ctx.duration,
      (e) => tint.set(r, g, b, share * envelope(e, ctx.duration)),
      () => tint.set(0, 0, 0, 0),
    );
  },
});

/** Flare strength over time: a fast 80 ms rise, then a quadratic decay to zero at the end. */
const FLARE_RISE_MS = 80;
function flare(e, duration) {
  const rise = Math.min(FLARE_RISE_MS, duration / 4);
  if (e < rise) return smooth(e / rise);
  const k = 1 - (e - rise) / Math.max(1, duration - rise);
  return Math.max(0, k) ** 2;
}

export const numberFlare = Object.freeze({
  id: 'number-flare',
  cost: 1,
  bindsDie: true,
  defaults: Object.freeze({ color: '#fff1b8', intensity: 2.5, duration: 900 }),
  start(ctx) {
    const u = ctx.isolate(ctx.die);
    const out = u?.uFxFlare?.value;
    if (!out) return NOOP;
    const { r, g, b } = ctx.color;
    const strength = Math.max(0, ctx.intensity);
    // the number flares and so does the die's living inside, if it has one (inside-flare.js)
    return withInsideFlare(
      ctx,
      timed(
        ctx.duration,
        (e) => {
          const s = strength * flare(e, ctx.duration);
          out.set(r * s, g * s, b * s);
        },
        () => out.set(0, 0, 0),
      ),
    );
  },
});

const GLOW_VERTEX = /* glsl */ `
varying vec3 vDcN;
varying vec3 vDcV;
void main() {
	vec4 mv = modelViewMatrix * vec4( position, 1.0 );
	vDcN = normalize( normalMatrix * normal );
	vDcV = normalize( - mv.xyz );
	gl_Position = projectionMatrix * mv;
}
`;
// Back faces of the shell: brightest where they graze the view, i.e. a rim around the die.
const GLOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec3 vDcN;
varying vec3 vDcV;
void main() {
	float f = 1.0 - abs( dot( normalize( vDcN ), normalize( vDcV ) ) );
	vec3 c = uColor * ( uStrength * f * f );
	gl_FragColor = vec4( c, clamp( max( max( c.r, c.g ), c.b ), 0.0, 1.0 ) );
}
`;

// A soft round halo on a camera-facing quad (alpha = brightest channel, as for the shell).
const HALO_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;
const HALO_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
	float r = length( vUv * 2.0 - 1.0 );
	float glow = exp( - r * r * 4.0 ) * ( 1.0 - smoothstep( 0.55, 1.0, r ) );
	vec3 c = uColor * ( glow * uAlpha );
	gl_FragColor = vec4( c, clamp( max( max( c.r, c.g ), c.b ), 0.0, 1.0 ) );
}
`;
const HALO_SIZE = 3.2; // die edges across
const HALO_BEHIND = 0.7; // pushed this far away from the camera, so the die covers its centre
const HALO_SHARE = 0.45; // halo brightness relative to the shell's strength

// Additive colour and alpha on the premultiplied canvas: see catalogue.js ADDITIVE_PREMULTIPLIED.
const ADDITIVE = Object.freeze({
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
});

/** The halo mesh behind a die at `position`, facing `camera`; null without a scene. */
function haloBehind(ctx) {
  if (!ctx.scene?.add || !ctx.position) return null;
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: ctx.color.clone() }, uAlpha: { value: 0 } },
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    ...ADDITIVE,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.position.copy(ctx.position);
  const cam = ctx.camera;
  if (cam?.quaternion) {
    mesh.quaternion.copy(cam.quaternion);
    const away = mesh.position.clone().sub(cam.getWorldPosition?.(new THREE.Vector3()) ?? cam.position);
    if (away.lengthSq() > 1e-8) mesh.position.addScaledVector(away.normalize(), HALO_BEHIND);
  }
  mesh.scale.setScalar(HALO_SIZE);
  mesh.renderOrder = 0;
  ctx.scene.add(mesh);
  return mesh;
}

export const glowPulse = Object.freeze({
  id: 'glow-pulse',
  cost: 1,
  bindsDie: true,
  defaults: Object.freeze({ color: '#ffcf5a', intensity: 0.9, duration: 1800 }),
  start(ctx) {
    const parent = ctx.die?.inner;
    const geometry = parent?.geometry;
    if (!parent?.add || !geometry) return NOOP;
    const material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: ctx.color.clone() }, uStrength: { value: 0 } },
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      ...ADDITIVE,
    });
    const shell = new THREE.Mesh(geometry, material); // the die's geometry: never disposed here
    shell.scale.setScalar(GLOW_SCALE);
    shell.renderOrder = 1;
    parent.add(shell);
    const halo = haloBehind(ctx);
    const strength = material.uniforms.uStrength;
    const base = Math.max(0, ctx.intensity);
    return timed(
      ctx.duration,
      (e) => {
        const pulse = 1 + 0.5 * Math.sin((2 * Math.PI * e) / GLOW_PERIOD_MS);
        strength.value = base * pulse * envelope(e, ctx.duration);
        if (halo) halo.material.uniforms.uAlpha.value = HALO_SHARE * strength.value; // in phase
      },
      () => {
        parent.remove(shell);
        material.dispose();
        if (halo) {
          halo.removeFromParent();
          halo.geometry.dispose();
          halo.material.dispose();
        }
      },
    );
  },
});

export const DIE_EFFECTS = Object.freeze({
  [colorShift.id]: colorShift,
  [numberFlare.id]: numberFlare,
  [glowPulse.id]: glowPulse,
});

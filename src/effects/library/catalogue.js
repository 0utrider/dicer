import * as THREE from 'three';
import { DIE_EFFECTS, NOOP, envelope, timed } from './die-effects.js';
import { KIND } from './particles.js';
import { SHAPE } from './shapes.js';
import { composite } from './timeline.js';
import { createRibbon } from './ribbon.js';
import { palette } from './palette.js';
import { insideFlarePart, withInsideFlare } from './inside-flare.js';

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
 * A radial halo on a quad, in one of two looks:
 * - uBloom 0 (floorGlow): a soft gaussian of uColor that reaches zero at the quad's edge, with a
 *   small white core.
 * - uBloom 1 (light-burst): a layered bloom (a tight hot core, a mid glow and a wide faint haze)
 *   graded from uCore at the centre through uColor to uDeep at the rim, plus `uRays` soft
 *   god-rays turned by `uSpin` (radians), with a second set of shorter, fainter rays between
 *   them turning the other way. Each ray is a soft wedge (a gaussian off its axis that widens
 *   outward) fading out at its own length, so no two neighbours match.
 * No noise: the corners are discarded and the rest is a few exps; the rays only cost when
 * uRayAlpha > 0.
 */
const BURST_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform vec3 uDeep;
uniform float uAlpha;
uniform float uBloom;
uniform float uRays;
uniform float uSpin;
uniform float uRayAlpha;
varying vec2 vUv;
float rayHash( float n ) {
	return fract( sin( n * 12.9898 + 1.0 ) * 43758.5453 );
}
// One set of n rays at angle a (already spun): a soft wedge per ray, lengths 0.4..1 of lenMax.
float raySet( float a, float r, float n, float lenMax, float seed ) {
	float sector = 6.2831853 / n;
	float idx = floor( a / sector + 0.5 );
	float d = r * abs( sin( a - idx * sector ) );
	float h = rayHash( mod( idx, n ) + seed );
	float len = lenMax * ( 0.4 + 0.6 * h );
	float w = 0.012 + 0.07 * r;
	float soft = exp( - ( d * d ) / ( w * w ) );
	return soft * ( 1.0 - smoothstep( 0.25 * len, len, r ) ) * smoothstep( 0.04, 0.16, r ) * ( 0.6 + 0.4 * h );
}
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length( p );
	if ( r >= 1.0 ) discard; // the corners: every layer is zero there
	vec3 c;
	if ( uBloom < 0.5 ) {
		float glow = exp( - r * r * 5.0 ) * ( 1.0 - smoothstep( 0.6, 1.0, r ) );
		float core = exp( - r * r * 60.0 );
		c = ( uColor * glow + vec3( core ) ) * uAlpha;
	} else {
		float fade = 1.0 - smoothstep( 0.55, 1.0, r );
		float hot = exp( - r * r * 70.0 );
		float mid = exp( - r * r * 9.0 );
		float haze = exp( - r * r * 2.0 ) * fade;
		vec3 grad = mix( mix( uCore, uColor, smoothstep( 0.0, 0.3, r ) ), uDeep, smoothstep( 0.25, 0.8, r ) );
		c = grad * ( 0.9 * mid + 0.6 * haze ) + uCore * ( 0.6 * mid * mid ) + vec3( 0.9 * hot );
		if ( uRays > 0.5 && uRayAlpha > 0.0 ) {
			float a = atan( p.y, p.x + 0.00001 );
			float rays = raySet( a + uSpin, r, uRays, 1.0, 0.0 )
				+ 0.55 * raySet( a - 0.6 * uSpin + 3.14159265 / uRays, r, uRays, 0.7, 7.0 );
			vec3 rayCol = mix( uCore, uColor, smoothstep( 0.05, 0.6, r ) );
			c += rayCol * rays * 1.6 * uRayAlpha * fade;
		}
		c *= uAlpha;
	}
	gl_FragColor = vec4( c, clamp( max( max( c.r, c.g ), c.b ), 0.0, 1.0 ) );
}
`;
const BURST_UNIFORMS = Object.freeze({ uBloom: 0, uRays: 0, uSpin: 0, uRayAlpha: 0 });

/** Value noise for shader quads: a sin-free hash (Hoskins), cheap and stable on mediump GPUs. */
const NOISE_GLSL = /* glsl */ `
float hash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float noise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ),
		mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// Two octaves, the second turned ~37 degrees so no lattice shows.
float fbm2( vec2 p ) {
	return ( 2.0 * noise( p ) + noise( mat2( 0.8, 0.6, -0.6, 0.8 ) * p * 2.03 + 17.0 ) ) / 3.0;
}
`;

/**
 * Two expanding rings on one quad (radius uR / uR2 in quad units 0..1, brightness uAlpha /
 * uAlpha2), each a gradient band: a thin hot leading edge (uHot, width uEdge) sharp on the
 * outside, the body colour (uColor) easing into a deeper tint (uDeep) behind it with a soft inner
 * glow, and a faint trail (uDeep) fading back toward the centre over uTrail (a fraction of the
 * radius). uNoise (0..1) breaks the edges: the radius wobbles with the angle, the leading edge
 * frays into pieces and the band and trail are mottled, so it is never a perfect circle. uSeed
 * picks the pattern. Cost: the corners and the area past the outer ring are discarded before any
 * noise; a pixel on a ring takes 4 value-noise calls (an fbm2 and a noise of the angle, shared
 * by both rings, plus a mottle).
 */
const RING_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform vec3 uDeep;
uniform float uAlpha;
uniform float uR;
uniform float uAlpha2;
uniform float uR2;
uniform float uEdge;
uniform float uNoise;
uniform float uTrail;
uniform float uSeed;
varying vec2 vUv;
${NOISE_GLSL}
// One ring at radius R: its colour (not yet scaled by the ring's alpha). wobble and fray are the
// angle's noise (0..1); mottle is the position's.
vec3 ring( float r, float R, float wobble, float fray, float mottle ) {
	if ( R <= 0.0 ) return vec3( 0.0 );
	float Rn = R * ( 1.0 + uNoise * 0.12 * ( wobble - 0.5 ) );
	float d = Rn - r; // > 0 behind the leading edge, < 0 ahead of it
	float ahead = 1.0 - smoothstep( 0.0, 0.35 * uEdge, -d ); // sharp on the outside
	float edge = exp( - ( d * d ) / ( uEdge * uEdge ) ) * ahead;
	edge *= mix( 1.0, 0.1 + 0.9 * smoothstep( 0.3, 0.65, fray ), uNoise );
	float w = 0.05 + 0.12 * R; // the band widens as the ring grows
	float behind = max( d, 0.0 );
	float band = ( 1.0 - smoothstep( 0.0, w, behind ) ) * ahead;
	float glow = exp( - behind / ( 1.6 * w ) ) * ahead; // the soft inner glow
	float trail = exp( - behind / max( 0.001, uTrail * R ) ) * ahead * smoothstep( 0.0, 0.3, r / R );
	float m = mix( 1.0, 0.45 + 1.1 * mottle, uNoise );
	vec3 body = mix( uColor, uDeep, smoothstep( 0.0, w, behind ) );
	return uHot * edge * 1.3 + body * ( 0.8 * band * band + 0.35 * glow ) * m + uDeep * trail * 0.3 * m;
}
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length( p );
	float reach = max( uR * step( 0.001, uAlpha ), uR2 * step( 0.001, uAlpha2 ) ) * ( 1.0 + 0.06 * uNoise ) + uEdge;
	if ( r >= 1.0 || r > reach ) discard; // the corners and the floor beyond the outer ring
	vec2 dir = p / max( r, 0.0001 );
	float wobble = fbm2( dir * 2.5 + uSeed );
	float fray = noise( dir * 15.0 - uSeed );
	float mottle = noise( p * 7.0 + uSeed );
	vec3 c = ring( r, uR, wobble, fray, mottle ) * uAlpha + ring( r, uR2, wobble, 1.0 - fray, mottle ) * uAlpha2;
	gl_FragColor = vec4( c, clamp( max( max( c.r, c.g ), c.b ), 0.0, 1.0 ) );
}
`;

/** A ring's body colour (RING_FRAGMENT's uColor): the die colour, or a near-black die's rim. */
const ringBody = (color) => {
  const pal = palette(color);
  return pal.rim ?? pal.mid;
};

/**
 * RING_FRAGMENT's extra uniforms for a die colour (pass ringBody(color) as quadMaterial's colour):
 * the hot edge is the palette core halfway to white, the deep tint its edge (a near-black die's
 * rim, darkened). `edge`, `noise` and `trail` set uEdge, uNoise and uTrail; both rings start
 * hidden (radius and alpha 0) and uSeed is random.
 */
function ringUniforms(color, { edge = 0.018, noise = 0.6, trail = 0.5 } = {}) {
  const pal = palette(color);
  const white = new THREE.Color(WHITE);
  return {
    uHot: (pal.rim ?? pal.core).clone().lerp(white, 0.5),
    uDeep: pal.rim ? pal.rim.clone().multiplyScalar(0.55) : pal.edge.clone(),
    uR: 0,
    uAlpha2: 0,
    uR2: 0,
    uEdge: edge,
    uNoise: noise,
    uTrail: trail,
    uSeed: Math.random() * 50,
  };
}

/**
 * An additive radial glow decal on the table: colour ctx.color, brightness peak x intensity,
 * eased in over 60 ms, then shaped by `curve(elapsed)` (0..1; default: a quadratic fade-out over
 * `ms`). Returns an effect handle (a composite part or a self-contained effect); stop() or
 * reaching `ms` removes and disposes the mesh.
 */
export function floorGlow(ctx, { radius, peak, ms, curve = (e) => (1 - e / ms) ** 2 }) {
  const scope = scoped(ctx.scene);
  // uCore / uDeep are unused by the plain (uBloom 0) look, but every declared uniform needs a value.
  const material = quadMaterial(BURST_FRAGMENT, ctx.color, { ...BURST_UNIFORMS, uCore: ctx.color.clone(), uDeep: ctx.color.clone() });
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
  /**
   * A short anticipation (the halo gathers in, shrinking over ~60 ms), then the burst: a layered
   * bloom halo graded core -> edge with soft god-rays of varied lengths slowly turning, a thin
   * ring-kit ring running out on the floor, and the floor glow under it all.
   */
  start(ctx) {
    const scope = scoped(ctx.scene);
    const D = ctx.duration;
    const pal = palette(ctx.color);
    const body = ringBody(ctx.color); // the die colour, or a near-black die's rim
    const material = quadMaterial(BURST_FRAGMENT, body, {
      ...BURST_UNIFORMS,
      uBloom: 1,
      uRays: 8,
      uCore: (pal.rim ?? pal.core).clone().lerp(new THREE.Color(WHITE), pal.rim ? 0.45 : 0.25),
      uDeep: pal.rim ? pal.rim.clone().multiplyScalar(0.6) : pal.edge.clone(),
    });
    const u = material.uniforms;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.position.set(ctx.position.x, DIE_Y + 0.6, ctx.position.z);
    if (ctx.camera?.quaternion) mesh.quaternion.copy(ctx.camera.quaternion); // a billboard
    mesh.renderOrder = 3;
    scope.add(mesh);
    // Grows gently with intensity (sqrt), and at most 1.6 x its intensity-1 size on a big table.
    const grow = Math.min(1.6, sizeK(ctx));
    const level = Math.min(ALPHA_CAP, Math.max(0, ctx.intensity));
    const reach = 5.6 * grow;
    const PRE = Math.min(60, D * 0.1); // the anticipation
    const from = 1.3 * grow; // the gathering glow shrinks from here...
    const gathered = 0.55 * grow; // ...to here, then bursts out
    mesh.scale.setScalar(from);
    u.uAlpha.value = 0.3 * level;
    const spin0 = Math.random() * Math.PI * 2;

    const ringMat = quadMaterial(RING_FRAGMENT, body, ringUniforms(ctx.color, { edge: 0.009, noise: 0.35, trail: 0.3 }));
    const ru = ringMat.uniforms;
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat);
    ring.rotation.x = -Math.PI / 2; // on the floor plane
    ring.position.set(ctx.position.x, FLOOR_Y, ctx.position.z);
    ring.scale.setScalar(6 * grow);
    ring.renderOrder = 1;
    scope.add(ring);
    const ringLevel = Math.min(ALPHA_CAP, 1.1 * Math.max(0, ctx.intensity));

    const halo = timed(
      D,
      (e) => {
        if (e < PRE) {
          const g = e / PRE;
          mesh.scale.setScalar(from + (gathered - from) * g * g * (3 - 2 * g));
          u.uAlpha.value = level * (0.3 + 0.3 * g);
          u.uRayAlpha.value = 0;
          return;
        }
        const k = (e - PRE) / Math.max(1, D - PRE);
        mesh.scale.setScalar(gathered + (reach - gathered) * (1 - Math.exp(-8 * k))); // a fast bloom
        u.uAlpha.value = 1.2 * level * (1 - k) ** 1.6; // the flash, easing out
        // The rays (scaled by uAlpha too) come in over the first 80 ms and thin out at the end.
        u.uRayAlpha.value = 1.3 * clamp01((e - PRE) / 80) * (1 - k * k * k);
        u.uSpin.value = spin0 + 0.5 * (e / 1000); // a slow turn: ~20 degrees in 700 ms
        const rk = clamp01((e - PRE) / Math.max(1, 0.8 * (D - PRE)));
        ru.uR.value = 0.06 + 0.9 * easeOut(rk);
        ru.uAlpha.value = ringLevel * clamp01((e - PRE) / 40) * (1 - rk) ** 1.5;
      },
      () => scope.dispose(),
    );
    return withInsideFlare(ctx, together(halo, floorGlow(ctx, { radius: 2.5, peak: 0.7, ms: D })));
  },
});

export const shockwave = Object.freeze({
  id: 'shockwave',
  cost: 1,
  defaults: Object.freeze({ color: '#ffe9a8', intensity: 1, duration: 800 }),
  start(ctx) {
    const scope = scoped(ctx.scene);
    const material = quadMaterial(RING_FRAGMENT, ringBody(ctx.color), ringUniforms(ctx.color));
    const u = material.uniforms;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.rotation.x = -Math.PI / 2; // on the floor plane
    mesh.position.set(ctx.position.x, FLOOR_Y, ctx.position.z);
    // Grows gently with intensity (sqrt), and at most 1.6 x its intensity-1 size on a big table.
    const size = 7 * Math.min(1.6, sizeK(ctx));
    mesh.scale.setScalar(size);
    mesh.renderOrder = 1;
    scope.add(mesh);
    const level = Math.min(ALPHA_CAP, Math.max(0, ctx.intensity) * 1.3);
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
          shape: SHAPE.SMOKE, // the PUFF sprite
          blend: 'normal',
          color: tint,
          alpha: 0.35,
          now,
        });
      }
    };
    const rings = timed(
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
    return withInsideFlare(ctx, rings);
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

/**
 * Fumble's own smoke (not in CATALOGUE): a heavy, curling plume that heaves up off the die and
 * sags back. Pool colours reach the screen as their linear values, so the greys below are set as
 * displayed values (setRGB in the linear working space): a smoky mid-grey (~0.5 on screen) that
 * is lighter than a dark table and darker than a light map, tinted 18% toward the die (a near-black
 * die's rim), darkening as it ages; then, from a quarter of the way in, bigger darker soot puffs
 * low around it give the plume dark edges on either backdrop. Later than `smoke`'s rise and fall:
 * slower to clear, and it sinks (gravity < 0) as it spreads. Normal blend, no halo.
 */
const FUMBLE_SMOKE_GREY = new THREE.Color().setRGB(0.5, 0.49, 0.51);
const FUMBLE_SOOT = new THREE.Color().setRGB(0.1, 0.095, 0.1);

const fumbleSmoke = Object.freeze({
  ...smoke,
  id: 'fumble-smoke',
  start(ctx) {
    if (!ctx.particles) return NOOP;
    const pal = palette(ctx.color);
    const k = sizeK(ctx);
    const D = Math.max(1, ctx.duration);
    const body = FUMBLE_SMOKE_GREY.clone().lerp(pal.rim ?? ctx.color, 0.18);
    const calm = ctx.reducedMotion;
    const { x: cx, z: cz } = ctx.position;
    /**
     * Like trickle(), but each batch is born on a ring around the die's foot, just clear of its
     * footprint (the puff's soft edge too), heading outward and up: a fumble's die shows its 1,
     * so no smoke may cover its face. `angle()` picks each batch's bearing.
     */
    const ring = (total, window, angle, { y, up, ...spec }) => {
      let emitted = 0;
      const r = 0.55 + spec.size / 2;
      return (e, now) => {
        const want = Math.round(total * clamp01(e / Math.max(1, D * window)));
        if (want <= emitted) return;
        const a = angle();
        const ux = Math.cos(a);
        const uz = Math.sin(a);
        ctx.particles.emit({
          ...spec,
          origin: { x: cx + ux * r, y, z: cz + uz * r },
          dir: { x: ux, y: up, z: uz },
          count: want - emitted,
          now,
        });
        emitted = want;
      };
    };
    // The plume billows out to one side (a random draught per play), the soot all around.
    const lean = Math.random() * Math.PI * 2;
    const puff = {
      spin: calm ? 0.25 : 0.9,
      kind: KIND.SMOKE,
      shape: SHAPE.SMOKE,
      blend: 'normal',
    };
    const plume = ring(countFor(24, ctx), 0.55, () => lean + (Math.random() - 0.5) * 2.6, {
      ...puff,
      y: DIE_TOP,
      up: 0.7,
      speed: calm ? 0.5 : 2.4, // up and out, away from the die...
      spread: 0.45,
      gravity: -0.55, // ...then it sags back as it slows
      life: 1.7,
      color: body,
      colorEnd: body.clone().multiplyScalar(0.55),
      size: 1.0 * k,
      sizeEnd: 3.2,
    });
    const soot = ring(countFor(8, ctx), 0.4, () => Math.random() * Math.PI * 2, {
      ...puff,
      y: DIE_Y,
      up: 0.35, // rolling out low around the plume
      speed: calm ? 0.4 : 1.4,
      spread: 0.45,
      gravity: -0.6,
      life: 1.6,
      color: FUMBLE_SOOT.clone().lerp(body, 0.15),
      colorEnd: FUMBLE_SOOT,
      size: 1.0 * k,
      sizeEnd: 3.2,
      alpha: 0.8,
    });
    const sootAt = 0.25 * D;
    return timed(D, (e, now) => {
      plume(e, now);
      soot(e - sootAt, now); // nothing until a quarter of the way in
    }, () => {});
  },
});

// Per additive layer: brighter saturates to white and loses the die colour (frost, lightning).
const ALPHA_CAP = 1.5;
// Black "over" (premultiplied): colour = dst x (1 - a), a = the ribbon's glow profile.
const SHADOW_BLEND = Object.freeze({
  blendSrc: THREE.ZeroFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
});

/** A point `f` (0..1) of the way along a polyline whose points are evenly spaced. */
function alongLine(line, f) {
  const x = clamp01(f) * (line.length - 1);
  const i = Math.min(line.length - 2, Math.floor(x));
  const a = line[i];
  const b = line[i + 1];
  const u = x - i;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
}

/**
 * The frost patch on the table: a pale, matte disc of value-noise rime with a ragged outline and
 * a few brighter flecks, drawn "over" (premultiplied normal blend) rather than added, so it reads
 * as a white frost on a light map as well as on a dark table. uAlpha is its opacity.
 * Cost: the quad's corners (r > 1) are discarded at once; a pixel past the ragged outline after
 * the 3 outline noise calls; one inside takes 4 more (7 value-noise calls, sin-free hashes).
 */
const FROST_PATCH_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uSeed;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
	if ( uAlpha <= 0.0 ) discard;
	vec2 p = vUv * 2.0 - 1.0;
	float r = length( p );
	if ( r >= 1.0 ) discard; // the quad's corners: the outline never reaches past r = 1
	vec2 dir = p / max( r, 0.0001 );
	// A ragged outline: two lobed octaves around the circle plus a finer fringe.
	float outline = 0.66 + 0.24 * fbm2( dir * 2.2 + uSeed ) + 0.1 * noise( dir * 14.0 + uSeed );
	if ( r >= outline ) discard;
	float inside = 1.0 - smoothstep( outline - 0.12, outline, r );
	// Frost feathers: fibres that run outward (noise mostly of the angle), over a fine rime grain.
	float fibre = fbm2( dir * 7.0 + vec2( r * 1.6, -r * 1.1 ) + uSeed );
	float grain = fbm2( p * 9.0 - uSeed );
	float n = 0.55 * fibre + 0.45 * grain;
	float rim = smoothstep( outline - 0.3, outline - 0.06, r ) * inside; // the denser growing edge
	float fleck = smoothstep( 0.62, 0.78, grain );
	float a = clamp( inside * ( 0.45 + 0.55 * n + 0.3 * rim ) * uAlpha, 0.0, 1.0 );
	gl_FragColor = vec4( mix( uColor, vec3( 1.0 ), 0.25 + 0.5 * max( fleck, rim ) ) * a, a );
}
`;

function frostPatchMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uAlpha: { value: 0 }, uSeed: { value: Math.random() * 50 } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: FROST_PATCH_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

const FROST_STEPS = 6; // segments per ray
const FROST_SPIKES = [0.28, 0.48, 0.68]; // where a ray's side-spike pairs root (fraction of its length)
const FROST_BASE = 0.45; // rays start at the die's base: half an edge out from its centre

/**
 * The ice crystal: 6-8 nearly straight rays out from the die's base, evenly spaced with a little
 * jitter, each with a pair of forward-swept side spikes at every FROST_SPIKES root (longer near
 * the root, like a frost dendrite). Every spike carries `at`: the share of its ray's growth at
 * which it sprouts.
 */
function frostCrystal(cx, cz, reach) {
  const rays = [];
  const spikes = [];
  const n = 6 + Math.floor(Math.random() * 3);
  const turn = Math.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    let ang = turn + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const len = reach * (0.72 + Math.random() * 0.28);
    const pts = [];
    for (let s = 0; s <= FROST_STEPS; s++) {
      if (s > 0) ang += (Math.random() - 0.5) * 0.05;
      const r = FROST_BASE + ((len - FROST_BASE) * s) / FROST_STEPS;
      pts.push({ x: cx + Math.cos(ang) * r, y: FLOOR_Y, z: cz + Math.sin(ang) * r });
    }
    rays.push(pts);
    for (const f0 of FROST_SPIKES) {
      const f = f0 + (Math.random() - 0.5) * 0.06;
      const root = alongLine(pts, f);
      const a = pts.at(-1);
      const dir = Math.atan2(a.z - pts[0].z, a.x - pts[0].x);
      for (const side of [-1, 1]) {
        const sl = (len - FROST_BASE) * 0.34 * (1 - 0.6 * f) * (0.8 + Math.random() * 0.4);
        const sa = dir + side * (0.9 + (Math.random() - 0.5) * 0.2);
        const tip = { x: root.x + Math.cos(sa) * sl, y: FLOOR_Y, z: root.z + Math.sin(sa) * sl };
        spikes.push({ pts: [root, tip], ray: rays.length - 1, at: f });
      }
    }
  }
  // A short minor ray between each pair of rays, sprouting a little later: it fills the crystal.
  for (let i = 0; i < n; i++) {
    const ang = turn + ((i + 0.5) / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
    const r1 = FROST_BASE + (reach - FROST_BASE) * (0.3 + Math.random() * 0.15);
    const at = (r) => ({ x: cx + Math.cos(ang) * r, y: FLOOR_Y, z: cz + Math.sin(ang) * r });
    spikes.push({ pts: [at(FROST_BASE), at((FROST_BASE + r1) / 2), at(r1)], at: 0.12 });
  }
  return { rays, spikes };
}

// Width along a ray or spike: full at its root, a needle point at its (growing) tip.
const rayTaper = (t) => 1 - 0.9 * t ** 1.4;
const spikeTaper = (t) => 1 - 0.92 * t;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const GROW_STEP = 0.008; // the smallest growth step worth a ribbon rebuild (under a pixel per step)

export const frost = Object.freeze({
  id: 'frost',
  cost: 2,
  defaults: Object.freeze({ color: '#a8e4ff', intensity: 1, duration: 1800 }),
  start(ctx) {
    const pal = palette(ctx.color);
    const white = new THREE.Color(WHITE);
    // A near-white die has a warm mid; ice wants its cool edge. A near-black die glows in its rim.
    const nearWhite = !pal.rim && pal.core.equals(white);
    const glowColor = pal.rim ?? (nearWhite ? pal.edge : pal.mid);
    const k = sizeK(ctx);
    // Above intensity 1 the crystal grows (k) but not brighter; widths stop growing at k 1.2.
    const kw = Math.min(k, 1.2);
    const bright = Math.min(1, Math.max(0, ctx.intensity));
    const lum = glowColor.getHSL({}, THREE.SRGBColorSpace).l;
    // Pale ice gets a stronger dark band (it must read on a light map); the near-black rim a wider halo.
    const shadowGain = 0.25 + 0.95 * lum;
    const haloGain = pal.rim ? 1.4 : 1.0;
    const D = Math.max(1, ctx.duration);
    const reach = 2.3 * Math.max(0.5, k);
    const { rays, spikes } = frostCrystal(ctx.position.x, ctx.position.z, reach);
    const rayPts = rays.length * (FROST_STEPS + 2);
    const allPts = rayPts + spikes.length * 3;

    const ribbon = (widthPx, maxPoints, taper, core, glow, color = glowColor) => {
      const r = createRibbon({ maxPoints, widthPx, color, taper, core, glow });
      r.alpha = 0;
      ctx.scene.add(r.mesh); // r.dispose() removes it
      return r;
    };
    // Drawn in this order: a soft dark band (pale ice on a light map), a wide coloured halo, then
    // the crystal itself (rays and their side spikes, each with a whitened core).
    const shadow = ribbon(36 * kw, allPts, rayTaper, 0.02, 0.8, white);
    Object.assign(shadow.mesh.material, SHADOW_BLEND);
    shadow.mesh.renderOrder = 2;
    const halo = ribbon((pal.rim ? 60 : 42) * kw, allPts, rayTaper, 0.02, pal.rim ? 0.55 : 0.42);
    const ray = ribbon(13 * kw, rayPts, rayTaper, 0.42, 0.5);
    const spike = ribbon(7 * kw, spikes.length * 3, spikeTaper, 0.45, 0.5);
    const ribbons = [shadow, halo, ray, spike];
    ray.mesh.userData.grow = 0;

    // The frost disc: a pale glow in the palette's edge tint, spreading out under the crystal.
    const scope = scoped(ctx.scene);
    // The edge tint, lifted halfway to the die colour (an edge alone is a dull grey) then paled.
    const discBase = pal.rim ?? (nearWhite ? pal.edge : pal.edge.clone().lerp(pal.mid, 0.6));
    const discColor = discBase.clone().lerp(white, 0.5);
    // (A plane: its corners, past r = 1, are discarded before any noise. THREE.CircleGeometry would
    // split into a shared chunk and grow the world-start download.)
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), frostPatchMaterial(discColor));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(ctx.position.x, FLOOR_Y, ctx.position.z);
    disc.scale.setScalar(0.01);
    disc.renderOrder = 1;
    scope.add(disc);

    // Growth: eased out over the first 55% (a quick start, a slow settle into place), then held.
    const G = 0.55 * D;
    const growAt = (e) => easeOutCubic(clamp01(e / G));
    // Brightness: in over 80 ms, a glint as the crystal locks in, held, faded over the last 40%.
    const levelAt = (e) => {
      const rise = clamp01(e / 80);
      const fade = (1 - clamp01((e - 0.6 * D) / (0.4 * D))) ** 1.5;
      const glint = ctx.reducedMotion ? 0 : 0.25 * Math.exp(-(((e - G) / (0.08 * D)) ** 2));
      return rise * rise * (3 - 2 * rise) * fade * (1 + glint);
    };

    const cold = glowColor.clone().lerp(white, 0.55);
    // A near-black die's crystals are dark ice tinted toward its rim, not black triangles.
    const shardBody = pal.rim ? pal.mid.clone().lerp(pal.rim, 0.45) : nearWhite ? pal.edge : pal.mid;
    const shardEnd = pal.rim ? pal.mid.clone().lerp(pal.rim, 0.25) : pal.edge;
    const mistColor = glowColor.clone().lerp(white, pal.rim ? 0.45 : 0.7);
    let popped = false;
    let drawn = -1; // the growth the ribbons were last built at
    const pop = (e, now) => {
      popped = true;
      const pool = ctx.particles;
      if (!pool) return;
      const life = Math.max(0.25, ((D - e) / 1000) * 0.95);
      for (const pts of rays) {
        const tip = pts.at(-1);
        const origin = { x: tip.x, y: 0.06, z: tip.z };
        // Solid ice crystals (normal blend: they read on a light map too), then a cold glint of light.
        pool.emit({
          count: countFor(2, ctx),
          origin,
          dir: { x: 0, y: 1, z: 0 },
          speed: ctx.reducedMotion ? 0.2 : 1.1,
          spread: 0.9,
          gravity: -4,
          life,
          color: shardBody,
          colorEnd: shardEnd,
          size: 0.3 * k,
          spin: 2,
          kind: KIND.SHARD,
          shape: SHAPE.SHARD,
          blend: 'normal',
          now,
        });
        pool.emit({
          count: countFor(2, ctx),
          origin,
          dir: { x: 0, y: 1, z: 0 },
          speed: ctx.reducedMotion ? 0.2 : 1.4,
          spread: 1.1,
          gravity: -4,
          life,
          color: cold,
          colorEnd: glowColor,
          size: 0.22 * k,
          spin: 3,
          kind: KIND.SHARD,
          shape: SHAPE.SHARD,
          halo: 0.5,
          now,
        });
        pool.emit({
          count: 1,
          origin: { x: tip.x, y: 0.12, z: tip.z },
          speed: 0,
          life: 0.45,
          color: cold,
          colorEnd: glowColor,
          size: 0.55 * k,
          spin: 1.5,
          kind: KIND.SPARK,
          shape: SHAPE.GLINT,
          halo: 0.8,
          now,
        });
      }
    };
    // A low cold mist rolling out over the crystal (normal blend: it veils rather than glows).
    const mist = trickle(ctx, countFor(3, ctx), 0.3, {
      origin: originOf(ctx, 0.25),
      jitter: 1.2 * k,
      dir: { x: 0, y: 0.15, z: 0 },
      speed: ctx.reducedMotion ? 0 : 0.35,
      spread: 1.5,
      gravity: 0,
      life: Math.max(0.3, D / 1000) * 0.8,
      color: mistColor,
      size: 1.4 * k,
      sizeEnd: 2.2,
      spin: 0.3,
      kind: KIND.SMOKE,
      shape: SHAPE.SMOKE,
      blend: 'normal',
      alpha: 0.32,
    });

    const run = timed(
      D,
      (e, now) => {
        mist(e, now);
        const g = growAt(e);
        // Rebuild (and re-upload) the four ribbons only when the growth has visibly moved: at most
        // ~1/GROW_STEP times per play whatever the frame rate, and never once the crystal is grown.
        if (g - drawn >= GROW_STEP || (g === 1 && drawn < 1)) {
          drawn = g;
          ray.mesh.userData.grow = g;
          const rayLines = rays.map((pts) => prefixOf(pts, g));
          const spikeLines = spikes.map((s) => prefixOf(s.pts, (g - s.at) / (1 - s.at)));
          ray.setPolylines(rayLines);
          spike.setPolylines(spikeLines);
          const all = rayLines.concat(spikeLines);
          halo.setPolylines(all);
          shadow.setPolylines(all);
        }
        if (!popped && g >= 0.9) pop(e, now);
        const a = bright * levelAt(e);
        ray.alpha = Math.min(ALPHA_CAP, 1.15 * a);
        spike.alpha = Math.min(ALPHA_CAP, a);
        halo.alpha = Math.min(ALPHA_CAP, haloGain * a);
        shadow.alpha = Math.min(ALPHA_CAP, shadowGain * a);
        disc.scale.setScalar(2 * (0.7 + reach * 0.95 * easeOutCubic(clamp01(e / (0.8 * G)))));
        disc.material.uniforms.uAlpha.value = Math.min(1, 0.9 * a); // an opacity, not a light
      },
      () => {
        for (const r of ribbons) r.dispose();
        scope.dispose();
      },
    );
    return withInsideFlare(ctx, run); // the frost flashes inside the die too
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
const STRIKE_PEAK = [1.35, 1.2, 1.1]; // each re-strike flashes above the fading previous one
// Width factor along a line: full at t = 0 (the impact end of the bolt, the root of a branch),
// 30% at the tip. Held near full for the first stretch so the strike reads thick where it lands.
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
    return withInsideFlare(ctx, together(strikes, glow)); // the strike reaches inside the die
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

// Fumble's ember: a die colour with little hue of its own (grey, near-white, near-black, or muted
// like fizzle's default tan) glows in EMBER; a vivid die glows in its own colour. EMBER_HOT is a
// spark's white-hot start, EMBER_DEAD what it cools to.
const EMBER = '#ff3a12';
const EMBER_HOT = '#ffb060';
const EMBER_DEAD = '#1a0602';
/** The palette of a vivid colour (sRGB saturation >= 0.5, not near-white/black), else null. */
const vividPalette = (color) => {
  const pal = palette(color);
  const s = color.getHSL({}, THREE.SRGBColorSpace).s;
  return pal.rim || s < 0.5 || pal.core.equals(new THREE.Color(WHITE)) ? null : pal;
};

const CRACK_BASE = 0.3; // fissures start under the die
const CRACK_LEVELS = 3; // 9 points per fissure: a few sharp kinks, not a wriggle
const CRACK_BRANCH_LEVELS = 2; // 5 points per branch
const CRACK_TWIG_LEVELS = 2; // 5 points per twig
// Width along a fissure: full where it leaves the die, a hairline at its (growing) tip.
const crackTaper = (t) => 1 - 0.88 * t ** 1.1;

/** A jagged line flat on the floor (jagged() also kinks up and down, which a crack must not). */
const floorJagged = (a, b, levels, rough) => jagged(a, b, levels, rough).map((p) => ({ x: p.x, y: FLOOR_Y, z: p.z }));

/**
 * The cracked floor: 5-7 jagged fissures out from under the die, each with 1-2 branches forking
 * off its middle, and a twig off about half the branches. Every branch and twig carries `at`, the share of the
 * opening at which it starts to split off its parent, and `pts` (fissures have at 0).
 */
function crackWeb(cx, cz, reach) {
  const lines = [];
  const n = 5 + Math.floor(Math.random() * 3);
  const turn = Math.random() * Math.PI * 2;
  const at = (ang, r) => ({ x: cx + Math.cos(ang) * r, y: FLOOR_Y, z: cz + Math.sin(ang) * r });
  for (let i = 0; i < n; i++) {
    const ang = turn + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const len = reach * (0.65 + Math.random() * 0.35);
    const pts = floorJagged(at(ang, CRACK_BASE), at(ang + (Math.random() - 0.5) * 0.3, len), CRACK_LEVELS, 0.42);
    lines.push({ pts, at: 0 });
    const forks = 1 + Math.floor(Math.random() * 2);
    for (let f = 0; f < forks; f++) {
      const rootAt = 0.3 + Math.random() * 0.35;
      const root = pts[Math.round(rootAt * (pts.length - 1))];
      const side = (f % 2 === 0 ? 1 : -1) * (Math.random() < 0.5 ? 1 : -1);
      const ba = ang + side * (0.45 + Math.random() * 0.5);
      const bl = (len - CRACK_BASE) * (0.3 + Math.random() * 0.2);
      const bTip = { x: root.x + Math.cos(ba) * bl, y: FLOOR_Y, z: root.z + Math.sin(ba) * bl };
      const branch = floorJagged(root, bTip, CRACK_BRANCH_LEVELS, 0.4);
      lines.push({ pts: branch, at: rootAt });
      if (Math.random() < 0.5) continue; // a twig off every other branch
      const tRoot = branch[Math.round(branch.length * 0.5)];
      const ta = ba - side * (0.6 + Math.random() * 0.4);
      const tl = bl * (0.35 + Math.random() * 0.2);
      const tTip = { x: tRoot.x + Math.cos(ta) * tl, y: FLOOR_Y, z: tRoot.z + Math.sin(ta) * tl };
      lines.push({ pts: floorJagged(tRoot, tTip, CRACK_TWIG_LEVELS, 0.3), at: rootAt + (1 - rootAt) * 0.5 });
    }
  }
  return lines;
}

/**
 * The floor cracking open under the die: a dark-cored, tapered, jagged crack web with a dim ember
 * glow at its edges. It opens (spreads and widens) over about 200 ms with a flare of heat, then
 * smoulders, and fades over the last third. Two ribbons: the additive ember glow, and the dark
 * core drawn over it ("over" in black), so the glow shows only at the edges. One scene child: the
 * glow and a dim ember floor glow are children of the core. The geometry is rebuilt only while
 * the crack spreads. As it splits, ember-lit haze breathes out of the fissures.
 * (Perf: the glow ribbon's width is fill-rate bound; 54 px failed the perf probe, 36 px passes.)
 */
const crackPart = Object.freeze({
  id: 'crack',
  cost: 1,
  defaults: Object.freeze({ color: '#5a5a60', intensity: 1, duration: 1000 }),
  start(ctx) {
    const pal = vividPalette(ctx.color);
    const emberColor = pal ? pal.mid.clone().lerp(pal.core, 0.25) : new THREE.Color(EMBER);
    const k = sizeK(ctx);
    const kw = Math.min(k, 1.2); // widths stop growing at k 1.2
    const bright = Math.min(1, Math.max(0, ctx.intensity)); // and brightness at intensity 1
    const D = Math.max(1, ctx.duration);
    const OPEN = Math.min(200, 0.4 * D);
    const web = crackWeb(ctx.position.x, ctx.position.z, 3.2 * Math.max(0.5, k));
    const points = web.reduce((n, l) => n + l.pts.length + 1, 0);
    const glowPx = 36 * kw;
    const corePx = 13 * kw;
    const glow = createRibbon({ maxPoints: points, widthPx: glowPx, color: emberColor, taper: crackTaper, core: 0.02, glow: 0.55 });
    const core = createRibbon({ maxPoints: points, widthPx: corePx, color: new THREE.Color(WHITE), taper: crackTaper, core: 0.45, glow: 0.35 });
    Object.assign(core.mesh.material, SHADOW_BLEND);
    glow.mesh.renderOrder = 3;
    core.mesh.renderOrder = 4; // on top: it darkens the glow's middle
    glow.alpha = 0;
    core.alpha = 0;
    core.mesh.userData.open = 0;
    core.mesh.add(glow.mesh); // both are placed in world space by their shaders
    ctx.scene.add(core.mesh); // core.dispose() removes it
    let drawn = -1;
    const fade = (e) => (1 - clamp01((e - 0.65 * D) / (0.35 * D))) ** 1.5;
    let heat = 0;
    // A dim ember pool of light on the floor under the web (also a child of the core, so the part
    // stays one scene object), at the crack's heat.
    // (Object.create: a composite part's ctx keeps its fields on its prototype, which a spread drops.)
    const underglow = floorGlow(
      Object.create(ctx, { scene: { value: core.mesh }, color: { value: emberColor }, intensity: { value: bright } }),
      { radius: 1.5 * Math.max(0.5, k), peak: 0.4, ms: D, curve: () => heat },
    );
    // Smoke lit by the embers below, breathed out of the fissures as they split (additive: it is
    // what makes the fumble's smoke read on a dark table).
    let breathed = false;
    const breathe = (e, now) => {
      breathed = true;
      const life = Math.max(0.3, (D - e) / 1000) * 0.7;
      const haze = emberColor.clone().multiplyScalar(0.6);
      for (const l of web) {
        if (l.at > 0) continue;
        for (const f of [0.45, 0.85]) {
          const p = alongLine(l.pts, f);
          ctx.particles?.emit({
            now,
            count: countFor(1, ctx),
            origin: { x: p.x, y: 0.15, z: p.z },
            dir: { x: 0, y: 1, z: 0 },
            speed: ctx.reducedMotion ? 0.1 : 0.6,
            spread: 0.8,
            life,
            color: haze,
            colorEnd: EMBER_DEAD,
            size: 0.8 * k,
            sizeEnd: 2,
            spin: 0.6,
            kind: KIND.SMOKE,
            shape: SHAPE.SMOKE,
            halo: 0,
            alpha: 0.4,
          });
        }
      }
    };
    const cracking = timed(
      D,
      (e, now) => {
        const g = easeOutCubic(clamp01(e / OPEN));
        if (!breathed && g >= 0.5) breathe(e, now);
        if (g - drawn >= GROW_STEP || (g === 1 && drawn < 1)) {
          drawn = g;
          core.mesh.userData.open = g;
          const lines = web.map((l) => prefixOf(l.pts, (g - l.at) / (1 - l.at)));
          core.setPolylines(lines);
          glow.setPolylines(lines);
        }
        // It widens as it opens (a uniform: no rebuild).
        const wide = 0.45 + 0.55 * g;
        core.mesh.material.uniforms.uWidthPx.value = corePx * wide;
        glow.mesh.material.uniforms.uWidthPx.value = glowPx * wide;
        const f = fade(e);
        // Heat: a flare as the floor splits, settling to a smoulder (a slow uneven pulse).
        const flare = Math.exp(-(((e - OPEN) / (0.7 * OPEN)) ** 2));
        const pulse = ctx.reducedMotion ? 1 : 1 + 0.12 * Math.sin(e * 0.021) * Math.sin(e * 0.013 + 1);
        heat = Math.min(1, g * 2) * (0.75 + 0.5 * flare) * pulse * f;
        glow.alpha = Math.min(ALPHA_CAP, bright * heat);
        core.alpha = Math.min(ALPHA_CAP, (0.3 + 0.65 * g) * f);
      },
      () => {
        glow.dispose();
        core.dispose();
      },
    );
    return together(underglow, cracking);
  },
});

/**
 * A few dying sparks: they spit out sideways from the die's foot, arc, fall and go dark; with a
 * couple of flickering embers, and a few dark cinders (normal blend) that show on a light map.
 * Each particle is its own emit, born on a ring just outside the die (seen from above, anything
 * born over the die is hidden by it) and flying outward from it.
 */
const fizzlePart = Object.freeze({
  id: 'fizzle',
  cost: 1,
  defaults: Object.freeze({ color: '#c8a070', intensity: 1, duration: 600 }),
  start(ctx) {
    const pool = ctx.particles;
    if (!pool) return NOOP;
    const pal = vividPalette(ctx.color);
    const hot = pal ? pal.core : new THREE.Color(EMBER_HOT);
    const ember = pal ? pal.mid : new THREE.Color(EMBER);
    const dead = pal ? pal.mid.clone().multiplyScalar(0.015) : new THREE.Color(EMBER_DEAD); // (linear: very dark)
    const cinder = ember.clone().multiplyScalar(0.5);
    const k = sizeK(ctx);
    const life = Math.max(0.3, ctx.duration / 1000) * 1.4;
    const calm = ctx.reducedMotion;
    const { x: cx, z: cz } = ctx.position;
    const spit = (now, n, spec) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const ux = Math.cos(a);
        const uz = Math.sin(a);
        pool.emit({
          ...spec,
          now,
          count: 1,
          origin: { x: cx + ux * 0.55, y: 0.8, z: cz + uz * 0.55 },
          dir: { x: ux, y: 0.9, z: uz },
          spread: 0.35,
        });
      }
    };
    // Emitted on the first update, with its `now`: the pool's clock is the render loop's, so a
    // particle born at start() on performance.now() could be off that clock (and never show).
    const burst = (now) => {
      spit(now, countFor(8, ctx), {
        speed: calm ? 1.2 : 3.4,
        gravity: -8,
        life,
        color: hot,
        colorEnd: dead,
        size: 0.26 * k,
        kind: KIND.STREAK,
        shape: SHAPE.DOT, // a round hot point (the streak sprite reads as a square this small)
        halo: 0.7,
      });
      spit(now, countFor(3, ctx), {
        speed: calm ? 0.8 : 1.8,
        gravity: -3,
        life: life * 1.15,
        color: ember,
        colorEnd: dead,
        size: 0.3 * k,
        kind: KIND.EMBER,
        shape: SHAPE.DOT,
        halo: 0.6,
        alpha: 0.85,
      });
      spit(now, countFor(4, ctx), {
        speed: calm ? 1 : 2.6,
        gravity: -8,
        life,
        color: cinder,
        colorEnd: '#0c0a0a',
        size: 0.12 * k,
        kind: KIND.SPARK,
        shape: SHAPE.DOT,
        blend: 'normal',
      });
    };
    let fired = false;
    return timed(
      ctx.duration,
      (e, now) => {
        if (fired) return;
        fired = true;
        burst(now);
      },
      () => {},
    );
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

/** Fumble's private parts, exported for tests only (not effect ids). */
export const FUMBLE_PARTS = Object.freeze({ smoke: fumbleSmoke, crack: crackPart, fizzle: fizzlePart });

export const fumble = composite({
  id: 'fumble',
  defaults: { color: '#8c8c92', intensity: 1, duration: 1500 },
  parts: [
    { mod: fumbleSmoke, at: 0 },
    { mod: DIE_EFFECTS['color-shift'], at: 0, color: '#3a3a40', intensity: 0.8 },
    { mod: crackPart, at: 80, duration: 1400 }, // the cracked floor stays until near the end
    { mod: fizzlePart, at: 150 },
    { mod: tinyShake('fumble-shake', 0.15, 220), at: 80 },
    { mod: insideFlarePart, at: 0 }, // free: the inside flares with the fumble on every tier
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

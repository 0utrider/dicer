import * as THREE from 'three';
import { SHAPE, SHAPE_GLSL } from './shapes.js';

/**
 * The shared GPU particle pool. Two instanced meshes (additive and normal blending), one draw
 * each: a unit quad drawn once per particle slot, its motion, size, colour and fade computed in
 * the vertex shader from per-instance attributes, so the CPU only writes the ranges of newly
 * emitted particles (never every particle per frame):
 *
 *   position = origin + v * (1 - e^(-k t)) / k + 1/2 g t^2   (k = drag of the particle)
 *
 * Each quad faces the camera (it is built in screen space around the projected centre), takes a
 * procedural shape (shapes.js, no textures), lerps colour and size from birth to death, spins,
 * and a STREAK is stretched along its on-screen motion.
 *
 * Capacity (additive layer) is the constructor argument, normally round(2048 x particleScale);
 * the normal-blend layer is a quarter of it. A full layer overwrites its oldest particles.
 * World units: one die edge is 1; times in `spec.life` are seconds; `spec.now` is a ms clock
 * (performance.now() by default, the same clock as the render loop's update(nowMs)).
 */

/** Particle kinds (aKind): the motion and fade behaviour. */
export const KIND = Object.freeze({
  SPARK: 0,
  EMBER: 1,
  SMOKE: 2,
  SHARD: 3,
  SPIRAL: 4,
  GLINT: 5,
  STREAK: 6,
  FLAKE: 7,
});
const DRAG = [0.6, 0.9, 1.6, 0.25, 0.8, 0.5, 0.6, 1.4];
/** Each kind's default shape. */
const KIND_SHAPE = [SHAPE.DOT, SHAPE.FLAME, SHAPE.SMOKE, SHAPE.SHARD, SHAPE.DOT, SHAPE.GLINT, SHAPE.STREAK, SHAPE.FLAKE];
/** Per-shape defaults: size multiplier at death and spin (rad/s). */
const SIZE_END = { [SHAPE.SMOKE]: 2.6, [SHAPE.FLAME]: 0.3 };
const SPIN = { [SHAPE.SHARD]: 6, [SHAPE.SMOKE]: 0.6, [SHAPE.FLAKE]: 3 };
const STRETCH = 0.06;
const SHAPES = Object.values(SHAPE);

/**
 * Additive blending on the premultiplied-alpha dice canvas (the same factors as catalogue.js's
 * ADDITIVE_PREMULTIPLIED; the shader writes alpha = its brightest channel).
 */
const ADDITIVE = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
};

/**
 * Per-instance data, packed four floats per GPU attribute (iA..iF + aCorner = 7 vertex
 * attributes: one per field would be 15, and ANGLE's D3D11 backend fails to link past ~15).
 * Each packed buffer also carries named views (aOrigin, aBirth, ...) for the CPU side.
 */
const PACKED = [
  ['iA', [['aOrigin', 3], ['aBirth', 1]]],
  ['iB', [['aVelocity', 3], ['aLife', 1]]],
  ['iC', [['aColor', 3], ['aSize', 1]]],
  ['iD', [['aColorEnd', 3], ['aSizeEnd', 1]]],
  ['iE', [['aKind', 1], ['aGravity', 1], ['aShape', 1], ['aStretch', 1]]],
  ['iF', [['aSpin', 1], ['aDrag', 1], ['aSeed', 1], ['aSpare', 1]]],
];

const VERTEX = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 iA; // origin.xyz, birth
attribute vec4 iB; // velocity.xyz, life
attribute vec4 iC; // color.rgb, size
attribute vec4 iD; // colorEnd.rgb, sizeEnd
attribute vec4 iE; // kind, gravity, shape, stretch
attribute vec4 iF; // spin, drag, seed, -
#define aOrigin iA.xyz
#define aBirth iA.w
#define aVelocity iB.xyz
#define aLife iB.w
#define aColor iC.rgb
#define aSize iC.w
#define aColorEnd iD.rgb
#define aSizeEnd iD.w
#define aKind iE.x
#define aGravity iE.y
#define aShape iE.z
#define aStretch iE.w
#define aSpin iF.x
#define aDrag iF.y
#define aSeed iF.z
uniform float uTime;
uniform vec2 uViewport;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vQ;
varying float vShape;
varying float vSeed;
vec3 travel( float t, int kind ) {
	float d = max( aDrag, 0.0001 );
	vec3 disp = aVelocity * ( ( 1.0 - exp( - d * t ) ) / d );
	if ( kind == 4 ) {
		float a = 3.2 * t;
		float c = cos( a );
		float s = sin( a );
		disp.xz = vec2( disp.x * c - disp.z * s, disp.x * s + disp.z * c );
	}
	vec3 p = aOrigin + disp;
	p.y += 0.5 * aGravity * t * t;
	if ( kind == 3 ) p.y = max( p.y, 0.03 );
	return p;
}
void main() {
	float t = uTime - aBirth;
	vec4 mv = vec4( 0.0 );
	int kind = int( aKind + 0.5 );
	if ( t >= 0.0 && t < aLife ) mv = modelViewMatrix * vec4( travel( t, kind ), 1.0 );
	if ( mv.z > -0.0001 ) {
		// Unborn, dead or behind the camera: all four corners on one point, so no fragments.
		gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
		return;
	}
	float k = t / aLife;
	int shape = int( aShape + 0.5 );
	float seed = aSeed;
	vec4 clip = projectionMatrix * mv;
	vec2 halfPx = vec2( max( 0.5, aSize * mix( 1.0, aSizeEnd, k ) * projectionMatrix[1][1] * uViewport.y * 0.25 / - mv.z ) );
	vec2 axis = vec2( 1.0, 0.0 );
	if ( shape == 1 ) {
		// STREAK: the long axis follows the on-screen motion over the last 16 ms.
		vec4 prev = projectionMatrix * ( modelViewMatrix * vec4( travel( max( t - 0.016, 0.0 ), kind ), 1.0 ) );
		vec2 delta = ( clip.xy / clip.w - prev.xy / max( prev.w, 0.0001 ) ) * 0.5 * uViewport;
		float px = length( delta );
		if ( px > 0.001 ) axis = delta / px;
		halfPx.x *= 1.0 + aStretch * px;
	} else if ( aSpin != 0.0 ) {
		float a = aSpin * t + seed * 6.2831853;
		axis = vec2( cos( a ), sin( a ) );
	}
	vec2 offPx = axis * ( aCorner.x * halfPx.x ) + vec2( - axis.y, axis.x ) * ( aCorner.y * halfPx.y );
	clip.xy += offPx / ( 0.5 * uViewport ) * clip.w;
	gl_Position = clip;
	float alpha = 1.0 - k;
	if ( kind == 1 ) alpha *= 0.65 + 0.35 * sin( t * 38.0 + aBirth * 17.0 );
	else if ( kind == 2 ) alpha *= 0.55;
	else if ( kind == 3 ) alpha = 1.0 - smoothstep( 0.7, 1.0, k );
	else if ( kind == 5 ) alpha *= 0.5 + 0.5 * sin( t * 30.0 + aBirth * 11.0 );
	vAlpha = alpha;
	vColor = mix( aColor, aColorEnd, k );
	vQ = aCorner;
	vShape = aShape;
	vSeed = seed;
}
`;
const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying vec2 vQ;
varying float vShape;
varying float vSeed;
${SHAPE_GLSL}
void main() {
	float a = shapeAlpha( int( vShape + 0.5 ), vQ, vSeed ) * vAlpha;
#ifdef ADDITIVE
	vec3 c = vColor * a;
	gl_FragColor = vec4( c, clamp( max( max( c.r, c.g ), c.b ), 0.0, 1.0 ) );
#else
	gl_FragColor = vec4( vColor, a );
#endif
}
`;

function makeLayer(scene, capacity, additive) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  geometry.instanceCount = capacity;
  // The shader places every vertex; the mesh is never culled, so the bounds are only bookkeeping.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const attrs = {};
  const buffers = [];
  for (const [packed, fields] of PACKED) {
    const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * 4), 4, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    buffers.push(buffer);
    geometry.setAttribute(packed, new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    let offset = 0;
    for (const [name, size] of fields) {
      // Views share the packed buffer (one GL buffer); unused by the shader, so never bound.
      const view = new THREE.InterleavedBufferAttribute(buffer, size, offset);
      offset += size;
      geometry.setAttribute(name, view);
      attrs[name] = view;
    }
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uViewport: { value: new THREE.Vector2(800, 600) },
    },
    defines: additive ? { ADDITIVE: '' } : {},
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    ...(additive ? ADDITIVE : { blending: THREE.NormalBlending }),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 2;
  mesh.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(material.uniforms.uViewport.value);
  };
  scene.add(mesh);
  return { capacity, attrs, buffers, geometry, material, mesh, head: 0 };
}

const rand = (a, b) => a + Math.random() * (b - a);
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

function setColor(target, value, fallback) {
  try {
    target.set(value ?? fallback);
  } catch {
    target.set(fallback);
  }
}

/**
 * @param {THREE.Object3D} scene
 * @param {number} capacity additive-layer capacity (the normal layer gets a quarter)
 */
export function createParticlePool(scene, capacity) {
  const cap = Math.max(1, Math.round(capacity));
  const layers = [makeLayer(scene, cap, true), makeLayer(scene, Math.max(1, Math.ceil(cap / 4)), false)];
  let epoch = null; // ms; aBirth/uTime are seconds since it, so float32 stays precise
  let deathMs = -Infinity; // the latest death time over every live particle
  let disposed = false;
  const tint = new THREE.Color();
  const tintEnd = new THREE.Color();

  const mark = (layer, start, count) => {
    for (const b of layer.buffers) {
      b.addUpdateRange(start * b.stride, count * b.stride);
      b.needsUpdate = true;
    }
  };

  /**
   * Emits `spec.count` particles. v1 fields: count, origin, dir, speed, spread, life, size,
   * kind, gravity, color, blend ('normal' for the second layer), now. v2 fields (each defaults
   * from the kind, then the shape): shape, colorEnd, sizeEnd, stretch, spin (rad/s, random sign),
   * drag.
   */
  function emit(spec = {}) {
    if (disposed) return;
    const n = Math.max(0, Math.floor(Number(spec.count) || 0));
    if (!n) return;
    const layer = layers[spec.blend === 'normal' ? 1 : 0];
    const nowMs = Number.isFinite(spec.now) ? spec.now : performance.now();
    epoch ??= nowMs;
    const birth = (nowMs - epoch) / 1000;
    const o = spec.origin ?? { x: 0, y: 0, z: 0 };
    const dir = spec.dir ?? { x: 0, y: 1, z: 0 };
    const speed = Number(spec.speed) || 0;
    const spread = Number(spec.spread) || 0;
    const life = Math.max(0.05, Number(spec.life) || 1);
    const size = Number(spec.size) || 0.2;
    const kind = spec.kind ?? KIND.SPARK;
    const gravity = Number(spec.gravity) || 0;
    const shape = SHAPES.includes(spec.shape) ? spec.shape : (KIND_SHAPE[kind] ?? SHAPE.DOT);
    const sizeEnd = num(spec.sizeEnd, SIZE_END[shape] ?? 1);
    const stretch = num(spec.stretch, STRETCH);
    const spin = num(spec.spin, SPIN[shape] ?? 0);
    const drag = Math.max(0, num(spec.drag, DRAG[kind] ?? DRAG[0]));
    setColor(tint, spec.color, '#ffffff');
    setColor(tintEnd, spec.colorEnd, tint);
    const a = layer.attrs;
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / dl;
    const dy = dir.y / dl;
    const dz = dir.z / dl;
    // Two unit vectors perpendicular to dir, to tilt it by the spread.
    let ux = dy;
    let uy = -dx;
    let uz = 0;
    if (Math.abs(dx) + Math.abs(dy) < 1e-6) {
      ux = 1;
      uy = 0;
    }
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;

    let first = layer.head;
    let run = 0;
    for (let i = 0; i < n; i++) {
      const idx = layer.head;
      layer.head = (layer.head + 1) % layer.capacity;
      if (idx === 0 && run > 0) {
        mark(layer, first, run);
        first = 0;
        run = 0;
      }
      run++;
      const tilt = Math.acos(1 - Math.random() * (1 - Math.cos(Math.min(Math.PI, spread)))); // cone-uniform
      const az = Math.random() * Math.PI * 2;
      const st = Math.sin(tilt);
      const ct = Math.cos(tilt);
      const ca = Math.cos(az) * st;
      const sa = Math.sin(az) * st;
      const sp = speed * rand(0.7, 1.3);
      const l = life * rand(0.85, 1.15);
      a.aOrigin.setXYZ(idx, o.x, o.y, o.z);
      a.aVelocity.setXYZ(
        idx,
        (dx * ct + ux * ca + vx * sa) * sp,
        (dy * ct + uy * ca + vy * sa) * sp,
        (dz * ct + uz * ca + vz * sa) * sp,
      );
      a.aBirth.setX(idx, birth);
      a.aLife.setX(idx, l);
      a.aColor.setXYZ(idx, tint.r, tint.g, tint.b);
      a.aSize.setX(idx, size * rand(0.7, 1.2));
      a.aKind.setX(idx, kind);
      a.aGravity.setX(idx, gravity);
      a.aShape.setX(idx, shape);
      a.aColorEnd.setXYZ(idx, tintEnd.r, tintEnd.g, tintEnd.b);
      a.aSizeEnd.setX(idx, sizeEnd);
      a.aStretch.setX(idx, stretch);
      a.aSpin.setX(idx, Math.random() < 0.5 ? -spin : spin);
      a.aDrag.setX(idx, drag);
      a.aSeed.setX(idx, Math.random());
      deathMs = Math.max(deathMs, nowMs + l * 1000);
    }
    mark(layer, first, run);
    layer.dirty = true;
    layer.mesh.visible = true;
  }

  /** Makes every slot of a layer dead for any future epoch (once: skipped if already dead). */
  function kill(layer) {
    if (!layer.dirty) return;
    layer.dirty = false;
    const life = layer.attrs.aLife;
    for (let i = 0; i < layer.capacity; i++) life.setX(i, 0);
    life.data.addUpdateRange(0, life.data.array.length);
    life.data.needsUpdate = true;
  }

  // A new epoch restarts the shader clock at 0, so stale births would otherwise come alive again.
  function idle() {
    epoch = null;
    deathMs = -Infinity;
    for (const l of layers) {
      kill(l);
      l.mesh.visible = false;
    }
  }

  return {
    capacity: cap,
    layers,
    emit,
    /** Advances the shader clock; true while any particle is still alive. */
    update(nowMs) {
      if (disposed || epoch === null) return false;
      if (nowMs >= deathMs) {
        idle();
        return false;
      }
      const t = (nowMs - epoch) / 1000;
      for (const l of layers) l.material.uniforms.uTime.value = t;
      return true;
    },
    /** Kills every particle at once (the layer's clear()). */
    clear() {
      idle();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const l of layers) {
        scene.remove(l.mesh);
        l.geometry.dispose();
        l.material.dispose();
      }
    },
  };
}

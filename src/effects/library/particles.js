import * as THREE from 'three';

/**
 * The shared GPU particle pool. Two THREE.Points (additive and normal blending) whose motion
 * and fade are computed in the vertex shader from per-particle attributes, so the CPU only
 * writes the ranges of newly emitted particles (never every particle per frame):
 *
 *   position = origin + v * (1 - e^(-k t)) / k + 1/2 g t^2   (k = drag of the particle's kind)
 *
 * Capacity (additive layer) is the constructor argument, normally round(2048 x particleScale);
 * the normal-blend layer is a quarter of it. A full layer overwrites its oldest particles.
 * World units: one die edge is 1; times in `spec.life` are seconds; `spec.now` is a ms clock
 * (performance.now() by default, the same clock as the render loop's update(nowMs)).
 */

/** Particle kinds (aKind). */
export const KIND = Object.freeze({ SPARK: 0, EMBER: 1, SMOKE: 2, SHARD: 3, SPIRAL: 4, GLINT: 5 });
const DRAG = [0.6, 0.9, 1.6, 0.25, 0.8, 0.5];

const ATTRS = [
  ['aOrigin', 3],
  ['aVelocity', 3],
  ['aBirth', 1],
  ['aLife', 1],
  ['aColor', 3],
  ['aSize', 1],
  ['aKind', 1],
  ['aGravity', 1],
];

const VERTEX = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aVelocity;
attribute float aBirth;
attribute float aLife;
attribute vec3 aColor;
attribute float aSize;
attribute float aKind;
attribute float aGravity;
uniform float uTime;
uniform float uHeightPx;
uniform float uDrag[6];
varying vec3 vColor;
varying float vAlpha;
varying float vKind;
void main() {
	float t = uTime - aBirth;
	float k = clamp( t / aLife, 0.0, 1.0 );
	if ( t < 0.0 || t >= aLife ) {
		gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
		gl_PointSize = 0.0;
		return;
	}
	int kind = int( aKind + 0.5 );
	float d = max( uDrag[ kind ], 0.0001 );
	float travel = ( 1.0 - exp( - d * t ) ) / d;
	vec3 disp = aVelocity * travel;
	if ( kind == 4 ) {
		float a = 3.2 * t;
		float c = cos( a );
		float s = sin( a );
		disp.xz = vec2( disp.x * c - disp.z * s, disp.x * s + disp.z * c );
	}
	vec3 p = aOrigin + disp;
	p.y += 0.5 * aGravity * t * t;
	if ( kind == 3 ) p.y = max( p.y, 0.03 );
	vec4 mv = modelViewMatrix * vec4( p, 1.0 );
	gl_Position = projectionMatrix * mv;
	float size = aSize;
	float alpha = 1.0 - k;
	if ( kind == 1 ) alpha *= 0.65 + 0.35 * sin( t * 38.0 + aBirth * 17.0 );
	else if ( kind == 2 ) { size *= 1.0 + 1.6 * k; alpha *= 0.55; }
	else if ( kind == 3 ) alpha = 1.0 - smoothstep( 0.7, 1.0, k );
	else if ( kind == 5 ) alpha *= 0.5 + 0.5 * sin( t * 30.0 + aBirth * 11.0 );
	vAlpha = alpha;
	vColor = aColor;
	vKind = aKind;
	gl_PointSize = max( 1.0, size * projectionMatrix[1][1] * uHeightPx * 0.5 / - mv.z );
}
`;
const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vKind;
void main() {
	vec2 q = gl_PointCoord * 2.0 - 1.0;
	float a;
	if ( vKind > 2.5 && vKind < 3.5 ) {
		a = step( max( abs( q.x ), abs( q.y ) ), 0.8 );
	} else {
		a = 1.0 - smoothstep( 0.35, 1.0, length( q ) );
	}
	gl_FragColor = vec4( vColor, a * vAlpha );
}
`;

function makeLayer(scene, capacity, additive) {
  const geometry = new THREE.BufferGeometry();
  const attrs = {};
  for (const [name, size] of ATTRS) {
    const a = new THREE.BufferAttribute(new Float32Array(capacity * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, a);
    attrs[name] = a;
  }
  // The shader places every vertex itself; `position` only has to exist for three's bookkeeping.
  geometry.setAttribute('position', attrs.aOrigin);
  geometry.setDrawRange(0, capacity);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHeightPx: { value: 600 },
      uDrag: { value: DRAG.slice() },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 2;
  const size = new THREE.Vector2();
  points.onBeforeRender = (renderer) => {
    material.uniforms.uHeightPx.value = renderer.getDrawingBufferSize(size).y;
  };
  scene.add(points);
  return { capacity, attrs, geometry, material, points, head: 0 };
}

const rand = (a, b) => a + Math.random() * (b - a);

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

  const mark = (layer, start, count) => {
    for (const [name] of ATTRS) {
      const a = layer.attrs[name];
      a.addUpdateRange(start * a.itemSize, count * a.itemSize);
      a.needsUpdate = true;
    }
  };

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
    try {
      tint.set(spec.color ?? '#ffffff');
    } catch {
      tint.set('#ffffff');
    }
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
      deathMs = Math.max(deathMs, nowMs + l * 1000);
    }
    mark(layer, first, run);
    layer.points.visible = true;
  }

  function idle() {
    epoch = null;
    deathMs = -Infinity;
    for (const l of layers) l.points.visible = false;
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
      for (const l of layers) l.attrs.aLife.array.fill(0);
      for (const l of layers) mark(l, 0, l.capacity);
      idle();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const l of layers) {
        scene.remove(l.points);
        l.geometry.dispose();
        l.material.dispose();
      }
    },
  };
}

// The crit scenes' light: soft additive glows, light pools on the table and tapering light
// ribbons, drawn the way the dice effects draw light (premultiplied additive on the dice canvas:
// the fragment writes alpha = its brightest channel, catalogue.js ADDITIVE_PREMULTIPLIED), so a
// glow brightens what is under it instead of painting a disc over it. The camera looks straight
// down: glows and pools lie flat, facing it.
import * as THREE from 'three';

const ADDITIVE = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
};

const GLOW_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// A soft glow: a hot core (uCore) falling off to the colour, gaussian with a long faint tail,
// optionally a ring (uRing > 0: the light sits on a circle of that radius, e.g. a shockwave rim).
const GLOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uRing;
uniform float uWidth;
varying vec2 vUv;
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float x = uRing > 0.0 ? (d - uRing) / uWidth : d / uWidth;
  float body = exp(-x * x * 2.2);
  float tail = exp(-abs(x) * 3.0) * 0.35;
  float a = (body + tail) * (1.0 - smoothstep(0.92, 1.0, d));
  float core = uRing > 0.0 ? 0.0 : exp(-d * d * 30.0);
  vec3 col = (uColor * a + uCore * core) * uOpacity;
  gl_FragColor = vec4(col, max(col.r, max(col.g, col.b)));
}`;

/** The material of a glow or pool: `color`, `core` (the hot centre; default near white), ring options. */
function glowMaterial(color, { core = '#fff6e0', ring = 0, width = 0.5 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uCore: { value: new THREE.Color(core) },
      uOpacity: { value: 0 },
      uRing: { value: ring },
      uWidth: { value: width },
    },
    transparent: true,
    depthWrite: false,
    ...ADDITIVE,
  });
}

/**
 * A flat soft light of radius 1 (scale it). `set(opacity, radius, x, y, z)` places it in one call.
 * `ring` makes a soft ring of light (a rim, a shockwave) instead of a disc; `width` its softness.
 */
export function makeGlow(kit, root, color, opts = {}) {
  const mesh = new THREE.Mesh(kit.add(new THREE.PlaneGeometry(2, 2)), kit.add(glowMaterial(color, opts)));
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = opts.renderOrder ?? 2;
  mesh.frustumCulled = false;
  root.add(mesh);
  const u = mesh.material.uniforms;
  mesh.set = (opacity, radius, x, y, z) => {
    u.uOpacity.value = Math.max(0, opacity);
    mesh.visible = opacity > 0.002;
    if (radius !== undefined) mesh.scale.setScalar(Math.max(1e-3, radius));
    if (x !== undefined) mesh.position.set(x, y, z);
    return mesh;
  };
  mesh.tint = (c) => (u.uColor.value.set(c), mesh);
  mesh.ring = (r, w) => ((u.uRing.value = r), w !== undefined && (u.uWidth.value = w), mesh);
  mesh.set(0);
  return mesh;
}

const RIBBON_FRAGMENT = /* glsl */ `
uniform vec3 uHead;
uniform vec3 uTail;
uniform float uOpacity;
varying float vT;
varying float vSide;
void main() {
  float edge = 1.0 - vSide * vSide;
  float fade = pow(1.0 - vT, 1.6);
  vec3 col = mix(uHead, uTail, smoothstep(0.0, 0.7, vT)) * edge * edge * fade * uOpacity;
  gl_FragColor = vec4(col, max(col.r, max(col.g, col.b)));
}`;
const RIBBON_VERTEX = /* glsl */ `
attribute float aT;
attribute float aSide;
varying float vT;
varying float vSide;
void main() {
  vT = aT;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * A ribbon of light following a moving point (a comet tail, a phoenix's wake): `push(p)` each
 * frame adds the newest point; it keeps `length` points, widest (`width`) at the head, tapering,
 * white-hot `head` colour cooling to `tail`. Laid flat across its motion, facing up (the camera).
 * `reset()` forgets the points; `opacity(v)` fades it.
 */
export function makeRibbon(kit, root, { head = '#fff2c0', tail = '#ff5a1e', width = 0.6, length = 28 } = {}) {
  const n = length;
  const pos = new Float32Array(n * 2 * 3);
  const t = new Float32Array(n * 2);
  const side = new Float32Array(n * 2);
  const index = [];
  for (let i = 0; i < n; i++) {
    t[i * 2] = t[i * 2 + 1] = i / (n - 1);
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
    if (i < n - 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = kit.add(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setIndex(index);
  const mat = kit.add(
    new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERTEX,
      fragmentShader: RIBBON_FRAGMENT,
      uniforms: { uHead: { value: new THREE.Color(head) }, uTail: { value: new THREE.Color(tail) }, uOpacity: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...ADDITIVE,
    }),
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  root.add(mesh);
  const pts = [];
  const d = new THREE.Vector3();
  const s = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const X = new THREE.Vector3(1, 0, 0);
  return {
    mesh,
    push(p) {
      pts.unshift(p.clone());
      if (pts.length > n) pts.length = n;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.min(i, pts.length - 1)];
        const b = pts[Math.min(i + 1, pts.length - 1)];
        d.subVectors(a, b);
        if (d.lengthSq() < 1e-8) d.set(0, 0, 1);
        d.normalize();
        s.crossVectors(d, UP);
        if (s.lengthSq() < 1e-6) s.copy(X); // straight up or down: across the screen
        s.normalize().multiplyScalar(width * 0.5 * (1 - i / n) ** 0.8);
        pos.set([a.x - s.x, a.y - s.y, a.z - s.z, a.x + s.x, a.y + s.y, a.z + s.z], i * 6);
      }
      geo.attributes.position.needsUpdate = true;
    },
    reset() {
      pts.length = 0;
    },
    opacity(v) {
      mat.uniforms.uOpacity.value = Math.max(0, v);
      mesh.visible = v > 0.002 && pts.length > 1;
    },
  };
}

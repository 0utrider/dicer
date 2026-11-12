import * as THREE from 'three';

/**
 * A screen-space glow ribbon: any number of polylines drawn as one mesh (one draw call), each
 * a triangle strip of constant on-screen width, so lightning and frost cracks keep their
 * thickness at any camera distance. Width is in CSS px at a 1080 px tall drawing buffer and
 * scales with the real buffer height (uHeightPx / 1080).
 *
 * Vertex attributes are kept to four (position, aPrev, aNext, aSide): ANGLE's D3D11 backend
 * fails to link a program with too many. Every point is emitted twice (side -1 and +1); the
 * vertex shader projects prev/this/next, takes the screen-space tangent and extrudes along its
 * perpendicular. Lines are joined into one strip by repeating the last vertex of a line and the
 * first of the next (degenerate triangles), then the strip is expanded to a triangle list
 * (three.js meshes have no strip draw mode).
 */

const REFERENCE_HEIGHT = 1080;

// The same factors as catalogue.js's ADDITIVE_PREMULTIPLIED, redefined here so ribbon.js does
// not depend on (or risk a cycle with) catalogue.js; the shader writes alpha = brightest channel.
const ADDITIVE = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
};

const VERTEX = /* glsl */ `
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide;
uniform vec2 uViewport;
uniform float uHeightPx;
uniform float uWidthPx;
varying float vW;
vec4 project( vec3 p ) {
	return projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}
vec2 toPx( vec4 c ) {
	return c.xy / max( c.w, 0.0001 ) * 0.5 * uViewport;
}
void main() {
	vec4 cur = project( position );
	vec2 a = toPx( cur );
	vec2 t = toPx( project( aNext ) ) - toPx( project( aPrev ) );
	float len = length( t );
	t = len > 0.0001 ? t / len : vec2( 1.0, 0.0 );
	vec2 n = vec2( - t.y, t.x );
	float offPx = aSide * 0.5 * uWidthPx * uHeightPx / ${REFERENCE_HEIGHT.toFixed(1)};
	cur.xy += n * offPx / ( 0.5 * uViewport ) * cur.w;
	gl_Position = cur;
	vW = aSide;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uGlow;
varying float vW;
void main() {
	float w = abs( vW );
	float core = smoothstep( 0.35, 0.0, w );
	float halo = pow( 1.0 - w, 2.0 ) * uGlow;
	vec3 c = ( uColor * ( core + halo ) + vec3( core * 0.6 ) ) * uAlpha;
	gl_FragColor = vec4( c, clamp( max( max( c.r, c.g ), c.b ), 0.0, 1.0 ) );
}
`;

/**
 * @param {{ maxPoints: number, widthPx: number, color: THREE.Color, glow?: number }} spec
 */
export function createRibbon({ maxPoints, widthPx, color, glow = 0.6 }) {
  const cap = Math.max(2, Math.floor(maxPoints));
  const geometry = new THREE.BufferGeometry();
  const pos = new Float32Array(cap * 2 * 3);
  const prev = new Float32Array(cap * 2 * 3);
  const next = new Float32Array(cap * 2 * 3);
  const side = new Float32Array(cap * 2);
  // Strip length <= 2 points per point + 2 joins per extra line (>= 2 points each) < 3 per point.
  const indices = new Uint32Array(3 * (3 * cap));
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aPrev = new THREE.BufferAttribute(prev, 3).setUsage(THREE.DynamicDrawUsage);
  const aNext = new THREE.BufferAttribute(next, 3).setUsage(THREE.DynamicDrawUsage);
  const aSide = new THREE.BufferAttribute(side, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', aPos);
  geometry.setAttribute('aPrev', aPrev);
  geometry.setAttribute('aNext', aNext);
  geometry.setAttribute('aSide', aSide);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  // The shader places every vertex; the mesh is never culled, so the bounds are only bookkeeping.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uAlpha: { value: 1 },
      uGlow: { value: glow },
      uWidthPx: { value: widthPx },
      uHeightPx: { value: REFERENCE_HEIGHT },
      uViewport: { value: new THREE.Vector2(800, 600) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide, // strip winding flips along the strip
    ...ADDITIVE,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  const size = new THREE.Vector2();
  mesh.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(size);
    material.uniforms.uViewport.value.copy(size);
    material.uniforms.uHeightPx.value = size.y;
  };

  let disposed = false;

  /** Replaces the lines (each an array of {x, y, z}); points past maxPoints are dropped. */
  function setPolylines(lines) {
    if (disposed) return;
    let v = 0; // vertices written
    let left = cap;
    const strip = [];
    for (const line of lines ?? []) {
      const n = Math.min(line?.length ?? 0, left);
      if (n < 2) continue;
      left -= n;
      const base = v;
      for (let i = 0; i < n; i++) {
        const p = line[i];
        const a = line[Math.max(0, i - 1)];
        const b = line[Math.min(n - 1, i + 1)];
        for (let k = 0; k < 2; k++) {
          const o = v * 3;
          pos[o] = p.x;
          pos[o + 1] = p.y;
          pos[o + 2] = p.z;
          prev[o] = a.x;
          prev[o + 1] = a.y;
          prev[o + 2] = a.z;
          next[o] = b.x;
          next[o + 1] = b.y;
          next[o + 2] = b.z;
          side[v] = k === 0 ? -1 : 1;
          v++;
        }
      }
      if (strip.length) strip.push(strip[strip.length - 1], base); // degenerate join
      for (let i = base; i < v; i++) strip.push(i);
      if (left < 2) break;
    }
    const s = strip.length;
    let count = 0;
    for (let i = 0; i + 2 < s; i++) {
      const flip = i & 1;
      indices[count++] = strip[i];
      indices[count++] = strip[i + 1 + flip];
      indices[count++] = strip[i + 2 - flip];
    }
    geometry.setDrawRange(0, count);
    geometry.index.needsUpdate = true;
    for (const attr of [aPos, aPrev, aNext, aSide]) attr.needsUpdate = true;
  }

  return {
    mesh,
    setPolylines,
    set alpha(value) {
      material.uniforms.uAlpha.value = value;
    },
    get alpha() {
      return material.uniforms.uAlpha.value;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}

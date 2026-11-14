import * as THREE from 'three';
import { createRibbon } from '../../src/effects/library/ribbon.js';

const line = (n, z = 0) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0.5, z }));

test('setPolylines writes 2 vertices per point and degenerate joins between lines', () => {
  const r = createRibbon({ maxPoints: 16, widthPx: 6, color: new THREE.Color('#fff') });
  r.setPolylines([line(3), line(3, 2)]);
  const g = r.mesh.geometry;
  const pos = g.attributes.position.array;
  // 6 points -> 12 vertices: the second line starts at vertex 6, both sides of a point share a position.
  expect(pos.slice(0, 3)).toEqual(pos.slice(3, 6));
  expect(pos[6 * 3 + 2]).toBe(2);
  expect(Array.from(g.attributes.aSide.array.slice(0, 4))).toEqual([-1, 1, -1, 1]);
  // Strip: 6 + 2 (join) + 6 = 14 indices -> 12 triangles -> 36 indices; the join triangles are degenerate.
  expect(g.drawRange).toEqual({ start: 0, count: 36 });
  const idx = g.index.array;
  const tri = (i) => [idx[i * 3], idx[i * 3 + 1], idx[i * 3 + 2]];
  const degenerate = Array.from({ length: 12 }, (_, i) => tri(i)).filter((t) => new Set(t).size < 3);
  expect(degenerate.length).toBe(4); // the two repeated vertices touch 4 strip triangles
  expect(Math.max(...idx.slice(0, 36))).toBe(11);
  expect(r.mesh.frustumCulled).toBe(false);
  // Neighbours: line 2's first vertex has prev = itself, next = the following point; ends mirror.
  const prev = g.attributes.aPrev.array;
  const next = g.attributes.aNext.array;
  expect(Array.from(prev.slice(18, 21))).toEqual(Array.from(pos.slice(18, 21)));
  expect(Array.from(next.slice(18, 21))).toEqual([1, 0.5, 2]);
  expect(Array.from(prev.slice(24, 27))).toEqual([0, 0.5, 2]); // interior point (vertex 8): prev
  expect(Array.from(next.slice(24, 27))).toEqual([2, 0.5, 2]);
  expect(Array.from(next.slice(15, 18))).toEqual(Array.from(pos.slice(15, 18))); // line 1 last point
  r.dispose();
});

test('fragment uses defined GLSL (ordered smoothstep edges, exponential glow, whitened core)', () => {
  const r = createRibbon({ maxPoints: 4, widthPx: 6, color: new THREE.Color('#fff') });
  const f = r.mesh.material.fragmentShader;
  expect(f).toContain('1.0 - smoothstep( uCore * 0.6, uCore, d )');
  expect(f).toContain('exp( - d / uGlow )');
  expect(f).toContain('mix( uColor, vec3( 1.0 ), 0.7 )');
  expect(f).not.toContain('pow(');
  r.dispose();
});

test('lines shorter than 2 points are skipped and points past maxPoints are dropped', () => {
  const r = createRibbon({ maxPoints: 4, widthPx: 6, color: new THREE.Color('#fff') });
  r.setPolylines([line(1), line(3), line(5)]);
  // line(1) skipped; line(3) -> 6 vertices; 1 point left -> nothing more. Strip of 6 -> 4 triangles.
  expect(r.mesh.geometry.drawRange.count).toBe(12);
  r.setPolylines([]);
  expect(r.mesh.geometry.drawRange.count).toBe(0);
  r.dispose();
});

test('width scales with the drawing buffer height', () => {
  const r = createRibbon({ maxPoints: 4, widthPx: 6, color: new THREE.Color('#fff') });
  const renderer = { getDrawingBufferSize: (v) => v.set(3840, 2160) };
  r.mesh.onBeforeRender(renderer);
  const u = r.mesh.material.uniforms;
  expect(u.uHeightPx.value).toBe(2160);
  expect(u.uViewport.value.x).toBe(3840);
  expect(u.uWidthPx.value).toBe(6);
  expect(r.mesh.material.vertexShader).toContain('uHeightPx / 1080.0');
  r.dispose();
});

test('alpha setter drives the material and dispose frees geometry and material', () => {
  const r = createRibbon({ maxPoints: 4, widthPx: 6, color: new THREE.Color('#fff') });
  const scene = new THREE.Scene();
  scene.add(r.mesh);
  r.alpha = 0.4;
  expect(r.mesh.material.uniforms.uAlpha.value).toBe(0.4);
  const g = vi.fn();
  const m = vi.fn();
  r.mesh.geometry.addEventListener('dispose', g);
  r.mesh.material.addEventListener('dispose', m);
  r.dispose();
  expect(g).toHaveBeenCalled();
  expect(m).toHaveBeenCalled();
  expect(scene.children.length).toBe(0);
});

test('the vertex stage uses few attributes (ANGLE limit)', () => {
  const r = createRibbon({ maxPoints: 4, widthPx: 6, color: new THREE.Color('#fff') });
  expect(Object.keys(r.mesh.geometry.attributes).length).toBeLessThanOrEqual(4);
  r.dispose();
});

test('taper is written into |aSide| along the line', () => {
  const r = createRibbon({ maxPoints: 8, widthPx: 6, color: new THREE.Color('#fff'), taper: (t) => 1 - t });
  r.setPolylines([line(3)]);
  const side = Array.from(r.mesh.geometry.attributes.aSide.array.slice(0, 6));
  expect(side.map(Math.abs)).toEqual([1, 1, 0.5, 0.5, 0, 0]);
  r.dispose();
});

test('taper t is the cumulative length fraction, not the index fraction', () => {
  const r = createRibbon({ maxPoints: 8, widthPx: 6, color: new THREE.Color('#fff'), taper: (t) => t });
  r.setPolylines([[{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }]]);
  const side = Array.from(r.mesh.geometry.attributes.aSide.array.slice(0, 6)).map(Math.abs);
  expect(side).toEqual([0, 0, 0.25, 0.25, 1, 1]);
  r.dispose();
});

test('the across-stroke side comes from gl_VertexID, not from aSide', () => {
  const r = createRibbon({ maxPoints: 4, widthPx: 6, color: new THREE.Color('#fff') });
  expect(r.mesh.material.vertexShader).toContain('gl_VertexID & 1');
  r.dispose();
});

test('ribbon geometry still has exactly four attributes', () => {
  const r = createRibbon({ maxPoints: 4, widthPx: 6, color: new THREE.Color('#fff'), taper: () => 0.5 });
  r.setPolylines([line(3)]);
  expect(Object.keys(r.mesh.geometry.attributes).sort()).toEqual(['aNext', 'aPrev', 'aSide', 'position']);
  r.dispose();
});

test('core and glow are uniforms', () => {
  const r = createRibbon({ maxPoints: 4, widthPx: 6, color: new THREE.Color('#fff'), core: 0.4, glow: 0.7 });
  const u = r.mesh.material.uniforms;
  expect(u.uCore.value).toBe(0.4);
  expect(u.uGlow.value).toBe(0.7);
  const d = createRibbon({ maxPoints: 4, widthPx: 6, color: new THREE.Color('#fff') });
  expect(d.mesh.material.uniforms.uCore.value).toBe(0.25);
  expect(d.mesh.material.uniforms.uGlow.value).toBe(0.5);
  r.dispose();
  d.dispose();
});

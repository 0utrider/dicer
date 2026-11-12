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

test('glow fragment uses defined GLSL (ordered smoothstep edges, clamped pow base)', () => {
  const r = createRibbon({ maxPoints: 4, widthPx: 6, color: new THREE.Color('#fff') });
  const f = r.mesh.material.fragmentShader;
  expect(f).toContain('1.0 - smoothstep( 0.0, 0.35, w )');
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

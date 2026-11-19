import * as THREE from 'three';
import { KIND as SCENE_KIND, SHAPE as SCENE_SHAPE, stage } from '../../src/scenes/kit.js';
import { KIND } from '../../src/effects/library/particles.js';
import { SHAPE } from '../../src/effects/library/shapes.js';

// The scenes' light toolkit (src/scenes/vfx.js through the kit's stage).

test("the kit's particle kinds and shapes are the pool's (scenes cannot import them: a shared chunk)", () => {
  expect(SCENE_KIND).toEqual(KIND);
  expect(SCENE_SHAPE).toEqual(SHAPE);
});

function stageFor(extra = {}) {
  const scene = new THREE.Scene();
  const s = stage({ scene, anchor: new THREE.Vector3(1, 0.8, 1), restQuat: new THREE.Quaternion(), radius: 0.9, borrow: { moving: true, pose() {}, hide() {} }, ...extra });
  return { scene, s };
}

test('glows are additive soft lights placed in one call; hidden at zero; freed with the scene', () => {
  const { scene, s } = stageFor();
  const g = s.glow('#ffb347', { core: '#fff4d6' });
  expect(g.visible).toBe(false);
  g.set(0.8, 2, 1, 0.02, -1);
  expect(g.visible).toBe(true);
  expect(g.scale.x).toBe(2);
  expect(g.position.toArray()).toEqual([1, 0.02, -1]);
  expect(g.material.blending).toBe(THREE.CustomBlending);
  expect(g.material.depthWrite).toBe(false);
  g.ring(0.6, 0.2).tint('#ff0000');
  expect(g.material.uniforms.uRing.value).toBe(0.6);
  const dispose = vi.spyOn(g.material, 'dispose');
  s.dispose();
  expect(dispose).toHaveBeenCalled();
  expect(scene.children).toHaveLength(0);
});

test('a ribbon follows the pushed points, tapering, and copes with straight-up motion', () => {
  const { s } = stageFor();
  const rb = s.ribbon({ width: 1, length: 8 });
  for (let i = 0; i < 10; i++) rb.push(new THREE.Vector3(0, i, 0)); // straight up
  rb.opacity(1);
  const pos = rb.mesh.geometry.attributes.position.array;
  expect([...pos].every(Number.isFinite)).toBe(true);
  const width = (i) => Math.hypot(pos[i * 6 + 3] - pos[i * 6], pos[i * 6 + 5] - pos[i * 6 + 2]);
  expect(width(0)).toBeGreaterThan(width(6)); // widest at the head
  expect(rb.mesh.visible).toBe(true);
  rb.opacity(0);
  expect(rb.mesh.visible).toBe(false);
  s.dispose();
});

test('particles and library effects pass through to the stand-in; nothing breaks without them', () => {
  const emit = vi.fn();
  const effect = vi.fn(() => ({ update: () => true, stop() {} }));
  const { s } = stageFor({ particles: { emit }, effect });
  s.emit({ count: 3 });
  expect(emit).toHaveBeenCalledWith({ count: 3 });
  expect(s.effect('shockwave', { color: '#fff' })).toBeTruthy();
  expect(effect).toHaveBeenCalledWith('shockwave', { color: '#fff' });
  const bare = stageFor().s;
  expect(() => bare.emit({ count: 1 })).not.toThrow();
  expect(bare.effect('shockwave')).toBeNull();
});

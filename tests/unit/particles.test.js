import * as THREE from 'three';
import { createParticlePool, KIND } from '../../src/effects/library/particles.js';
import { SHAPE, SHAPE_GLSL } from '../../src/effects/library/shapes.js';
import { TIERS } from '../../src/render/quality.js';

const spec = (o = {}) => ({
  count: 1,
  origin: { x: 0, y: 0, z: 0 },
  speed: 1,
  spread: 0.5,
  gravity: 0,
  life: 1,
  color: '#fff',
  size: 0.2,
  now: 0,
  ...o,
});
const additive = (pool) => pool.layers[0];

test('capacity follows the tier particleScale (round(2048 x scale))', () => {
  for (const [name, t] of Object.entries(TIERS)) {
    const pool = createParticlePool(new THREE.Scene(), Math.round(2048 * t.particleScale));
    expect(pool.capacity, name).toBe(Math.round(2048 * t.particleScale));
    expect(additive(pool).attrs.aOrigin.count).toBe(pool.capacity);
    pool.dispose();
  }
});

test('adds at most two draws (additive + normal) and removes them on dispose', () => {
  const scene = new THREE.Scene();
  const pool = createParticlePool(scene, 64);
  expect(scene.children).toHaveLength(2);
  expect(scene.children.every((c) => c.isMesh)).toBe(true);
  pool.dispose();
  expect(scene.children).toHaveLength(0);
});

test('emitting beyond capacity overwrites the oldest particles', () => {
  const pool = createParticlePool(new THREE.Scene(), 4);
  pool.emit(spec({ count: 4, now: 0, color: '#ff0000' }));
  pool.emit(spec({ count: 2, now: 500, color: '#00ff00' }));
  const { aBirth, aColor } = additive(pool).attrs;
  // Slots 0,1 were overwritten by the newer emission; slots 2,3 are still the oldest.
  expect([0, 1, 2, 3].map((i) => aBirth.getX(i))).toEqual([0.5, 0.5, 0, 0]);
  expect(aColor.getY(0)).toBeCloseTo(1);
  expect(aColor.getY(3)).toBeCloseTo(0);
});

test('update is true while any particle lives and false after the longest life', () => {
  const pool = createParticlePool(new THREE.Scene(), 16);
  expect(pool.update(0)).toBe(false);
  pool.emit(spec({ count: 3, life: 1, now: 1000 }));
  expect(pool.update(1100)).toBe(true);
  expect(additive(pool).mesh.visible).toBe(true);
  expect(pool.update(1100 + 1200)).toBe(false); // lives are 1 s +-15%
  expect(additive(pool).mesh.visible).toBe(false);
});

test('only the emitted range is marked for upload (a wrapped emit marks two)', () => {
  const pool = createParticlePool(new THREE.Scene(), 8);
  // aOrigin is a view of a packed buffer of 4 floats per particle (origin.xyz, birth).
  const o = additive(pool).attrs.aOrigin.data;
  pool.emit(spec({ count: 3 }));
  expect(o.updateRanges).toEqual([{ start: 0, count: 12 }]);
  pool.update(10);
  expect(o.updateRanges).toEqual([{ start: 0, count: 12 }]); // update writes no attribute
  o.clearUpdateRanges();
  pool.emit(spec({ count: 7 })); // slots 3..7 then 0..1
  expect(o.updateRanges).toEqual([
    { start: 12, count: 20 },
    { start: 0, count: 8 },
  ]);
});

test('normal-blend particles go to the second layer; clear kills everything', () => {
  const pool = createParticlePool(new THREE.Scene(), 16);
  pool.emit(spec({ count: 2, blend: 'normal' }));
  expect(pool.layers[1].mesh.visible).toBe(true);
  expect(pool.layers[0].mesh.visible).toBe(false);
  pool.clear();
  expect(pool.update(1)).toBe(false);
  expect(pool.layers[1].mesh.visible).toBe(false);
});

test('regression: after the pool goes idle, no stale slot is live in the next epoch', () => {
  const pool = createParticlePool(new THREE.Scene(), 64);
  const live = (layer, uTime) => {
    const { aBirth, aLife } = layer.attrs;
    let n = 0;
    for (let i = 0; i < layer.capacity; i++) {
      const t = uTime - aBirth.getX(i);
      if (t >= 0 && t < aLife.getX(i)) n++;
    }
    return n;
  };
  pool.emit(spec({ count: 40, life: 1, now: 5000 }));
  pool.emit(spec({ count: 5, life: 1, now: 5000, blend: 'normal' }));
  expect(pool.update(5100)).toBe(true);
  expect(live(pool.layers[0], pool.layers[0].material.uniforms.uTime.value)).toBe(40);
  expect(pool.update(9000)).toBe(false); // idle: the epoch is dropped
  pool.emit(spec({ count: 3, life: 1, now: 20000 })); // new epoch: birth 0
  pool.update(20200);
  expect(live(pool.layers[0], pool.layers[0].material.uniforms.uTime.value)).toBe(3);
  expect(live(pool.layers[1], pool.layers[1].material.uniforms.uTime.value)).toBe(0);
});

describe('v2 renderer: instanced quads with procedural shapes', () => {
  test('each layer is one draw: an InstancedBufferGeometry quad with instanceCount = capacity', () => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 64);
    expect(scene.children).toHaveLength(2);
    for (const layer of pool.layers) {
      expect(layer.geometry.isInstancedBufferGeometry).toBe(true);
      expect(layer.geometry.instanceCount).toBe(layer.capacity);
      expect(layer.geometry.getAttribute('aCorner').count).toBe(4);
      expect(layer.geometry.index.count).toBe(6);
      expect(layer.attrs.aOrigin.data.isInstancedInterleavedBuffer).toBe(true);
      expect(layer.geometry.getAttribute('aOrigin').count).toBe(layer.capacity);
      expect(layer.mesh.isMesh).toBe(true);
      expect(layer.mesh.frustumCulled).toBe(false);
      expect(layer.mesh.renderOrder).toBe(2);
      expect(layer.mesh.visible).toBe(false);
    }
    expect(pool.layers[1].capacity).toBe(16);
    pool.dispose();
  });

  test('emit writes shape, colorEnd, sizeEnd, stretch and spin into the instance attributes', () => {
    const pool = createParticlePool(new THREE.Scene(), 16);
    pool.emit(
      spec({
        count: 1,
        kind: KIND.SPARK,
        shape: SHAPE.RING,
        color: '#ff0000',
        colorEnd: '#0000ff',
        sizeEnd: 0.5,
        stretch: 0.2,
        spin: 4,
        drag: 2.5,
      }),
    );
    const a = additive(pool).attrs;
    expect(a.aShape.getX(0)).toBe(SHAPE.RING);
    expect([a.aColorEnd.getX(0), a.aColorEnd.getY(0), a.aColorEnd.getZ(0)]).toEqual([0, 0, 1]);
    expect(a.aSizeEnd.getX(0)).toBeCloseTo(0.5);
    expect(a.aStretch.getX(0)).toBeCloseTo(0.2);
    expect(Math.abs(a.aSpin.getX(0))).toBeCloseTo(4);
    expect(a.aDrag.getX(0)).toBeCloseTo(2.5);
  });

  test('omitted v2 fields take the defaults of the kind and shape', () => {
    const pool = createParticlePool(new THREE.Scene(), 64);
    const cases = [
      [KIND.SPARK, SHAPE.DOT, 1, 0],
      [KIND.EMBER, SHAPE.FLAME, 0.3, 0],
      [KIND.SMOKE, SHAPE.SMOKE, 2.6, 0.6],
      [KIND.SHARD, SHAPE.SHARD, 1, 6],
      [KIND.SPIRAL, SHAPE.DOT, 1, 0],
      [KIND.GLINT, SHAPE.GLINT, 1, 0],
      [KIND.STREAK, SHAPE.STREAK, 1, 0],
      [KIND.FLAKE, SHAPE.FLAKE, 1, 3],
    ];
    cases.forEach(([kind, shape, sizeEnd, spin], i) => {
      pool.emit(spec({ kind }));
      const a = additive(pool).attrs;
      expect(a.aShape.getX(i), `kind ${kind}`).toBe(shape);
      expect(a.aSizeEnd.getX(i), `kind ${kind}`).toBeCloseTo(sizeEnd);
      expect(Math.abs(a.aSpin.getX(i)), `kind ${kind}`).toBeCloseTo(spin);
      expect(a.aStretch.getX(i), `kind ${kind}`).toBeCloseTo(0.06);
    });
    // An explicit shape picks that shape's defaults (a FLAME-shaped spark shrinks to 0.3).
    pool.emit(spec({ kind: KIND.SPARK, shape: SHAPE.FLAME }));
    expect(additive(pool).attrs.aSizeEnd.getX(cases.length)).toBeCloseTo(0.3);
    expect(KIND.STREAK).toBe(6);
    expect(KIND.FLAKE).toBe(7);
  });

  test('old specs still work: the kind default shape and colorEnd = color', () => {
    const pool = createParticlePool(new THREE.Scene(), 16);
    pool.emit(spec({ count: 2, kind: KIND.GLINT, color: '#00ff00' }));
    const a = additive(pool).attrs;
    for (const i of [0, 1]) {
      expect(a.aShape.getX(i)).toBe(SHAPE.GLINT);
      expect([a.aColorEnd.getX(i), a.aColorEnd.getY(i), a.aColorEnd.getZ(i)]).toEqual([
        a.aColor.getX(i),
        a.aColor.getY(i),
        a.aColor.getZ(i),
      ]);
      expect(a.aColor.getY(i)).toBeCloseTo(1);
      expect(a.aDrag.getX(i)).toBeCloseTo(0.5); // GLINT's v1 drag
    }
    expect(pool.update(100)).toBe(true);
  });

  test('every v2 attribute of an emitted run is marked for upload', () => {
    const pool = createParticlePool(new THREE.Scene(), 8);
    pool.emit(spec({ count: 3 }));
    const a = additive(pool).attrs;
    for (const n of ['aColorEnd', 'aShape', 'aSizeEnd', 'aStretch', 'aSpin', 'aDrag'])
      expect(a[n].data.updateRanges, n).toEqual([{ start: 0, count: 12 }]);
  });

  test('the vertex shader stays within 8 vertex attributes (ANGLE/D3D11 fails to link at ~16)', () => {
    const pool = createParticlePool(new THREE.Scene(), 8);
    const declared = pool.layers[0].material.vertexShader.match(/^attribute /gm) ?? [];
    expect(declared.length).toBeLessThanOrEqual(8);
    expect(pool.layers[0].material.vertexShader).not.toContain('gl_InstanceID'); // ANGLE emulates it with an attribute
  });

  test('the fragment shader uses the shape chunk', () => {
    const pool = createParticlePool(new THREE.Scene(), 8);
    for (const layer of pool.layers) expect(layer.material.fragmentShader.includes('shapeAlpha(')).toBe(true);
    expect(SHAPE_GLSL).toContain('float shapeAlpha(');
    expect(Object.keys(SHAPE)).toEqual(['DOT', 'STREAK', 'SMOKE', 'GLINT', 'SHARD', 'FLAME', 'FLAKE', 'RING']);
    // The additive layer writes premultiplied colour (never THREE.AdditiveBlending: a black quad).
    expect(pool.layers[0].material.blending).toBe(THREE.CustomBlending);
    expect(pool.layers[1].material.blending).toBe(THREE.NormalBlending);
  });

  test('a context restore leaves the pool usable; no texture is used', () => {
    const pool = createParticlePool(new THREE.Scene(), 16);
    pool.emit(spec({ count: 2, now: 0 }));
    for (const layer of pool.layers) {
      for (const attr of Object.values(layer.geometry.attributes)) attr.needsUpdate = true;
      for (const u of Object.values(layer.material.uniforms)) expect(u.value?.isTexture).not.toBe(true);
    }
    pool.emit(spec({ count: 2, now: 10 }));
    expect(pool.update(20)).toBe(true);
  });
});

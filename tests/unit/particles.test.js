import * as THREE from 'three';
import { createParticlePool, KIND } from '../../src/effects/library/particles.js';
import { SHAPE, SHAPE_GLSL } from '../../src/effects/library/shapes.js';
import { TIERS } from '../../src/render/quality.js';
import { EFFECTS } from '../../src/effects/library/index.js';
import * as textures from '../../src/effects/library/textures.js';

vi.mock('../../src/effects/library/textures.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getTexture: vi.fn(real.getTexture), disposeTextures: vi.fn(real.disposeTextures) };
});

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

  test('alpha is stored per particle (0..1) and defaults to 1', () => {
    const pool = createParticlePool(new THREE.Scene(), 16);
    pool.emit(spec({ alpha: 0.35 }));
    pool.emit(spec());
    pool.emit(spec({ alpha: 7 }));
    const a = additive(pool).attrs;
    expect(a.aAlpha.getX(0)).toBeCloseTo(0.35);
    expect(a.aAlpha.getX(1)).toBe(1);
    expect(a.aAlpha.getX(2)).toBe(1);
    expect(additive(pool).material.vertexShader).toContain('aAlpha');
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

  test('a context restore leaves the pool usable; its only texture keeps its CPU data', () => {
    const pool = createParticlePool(new THREE.Scene(), 16);
    pool.emit(spec({ count: 2, now: 0 }));
    for (const layer of pool.layers) {
      for (const attr of Object.values(layer.geometry.attributes)) attr.needsUpdate = true;
      for (const u of Object.values(layer.material.uniforms))
        if (u.value?.isTexture) expect(u.value.image.data?.length, 'texture CPU data').toBeGreaterThan(0);
    }
    pool.emit(spec({ count: 2, now: 10 }));
    expect(pool.update(20)).toBe(true);
  });
});

describe('textured soft sprites with halos', () => {
  test('additive particles get a default halo of 0.6 and normal ones 0', () => {
    const pool = createParticlePool(new THREE.Scene(), 16);
    pool.emit(spec({ count: 2 }));
    pool.emit(spec({ count: 2, blend: 'normal' }));
    pool.emit(spec({ count: 1, halo: 0.25 }));
    pool.emit(spec({ count: 1, halo: 9 }));
    const add = pool.layers[0].attrs.aHalo;
    const nor = pool.layers[1].attrs.aHalo;
    expect(add.getX(0)).toBeCloseTo(0.6);
    expect(add.getX(1)).toBeCloseTo(0.6);
    expect(nor.getX(0)).toBe(0);
    expect(nor.getX(1)).toBe(0);
    expect(add.getX(2)).toBeCloseTo(0.25);
    expect(add.getX(3)).toBe(1); // clamped to 0..1
    expect(add.data.updateRanges.length).toBeGreaterThan(0);
    pool.dispose();
  });

  test('the pool samples one atlas texture per layer', () => {
    const pool = createParticlePool(new THREE.Scene(), 16);
    for (const layer of pool.layers) {
      const u = layer.material.uniforms.uAtlas;
      expect(u?.value).toBeInstanceOf(THREE.Texture);
      expect(u.value).toBe(pool.layers[0].material.uniforms.uAtlas.value); // one atlas shared
      // 5 masks side by side at height 128; the CPU copy is kept for a context restore.
      expect(u.value.image.height).toBe(128);
      expect(u.value.image.width).toBe(64 + 128 + 64 + 64 + 64);
      expect(u.value.image.data).toBeInstanceOf(Uint8Array);
    }
    pool.dispose();
  });

  test('a DOT at the default halo is at least as wide and as bright overall as the old procedural DOT', () => {
    // The shader draws, at rho (in units of the particle size, 0 = centre):
    //   glow(rho) [the shape, in the inner 1 / 1.9 of the 1.9x quad] + 0.6 * 0.35 * glow(rho / 1.9) [the halo]
    // with glow() the GLOW mask, sampled here bilinearly along its centre row.
    textures.disposeTextures();
    const { width: w, data } = textures.getTexture(textures.TEX.GLOW).image;
    const c = w / 2;
    const texel = (x) => (data[((c - 1) * w + x) * 4] + data[(c * w + x) * 4]) / 2 / 255;
    const glow = (r) => {
      if (r >= 1) return 0;
      const f = (r + 1) * c - 0.5;
      const i = Math.min(Math.floor(f), w - 2);
      return texel(i) + (texel(i + 1) - texel(i)) * (f - i);
    };
    const drawn = (rho) => glow(rho) + 0.6 * 0.35 * glow(rho / 1.9);
    const clamp = (x) => Math.min(1, Math.max(0, x));
    const sm = (a, b, x) => {
      const t = clamp((x - a) / (b - a));
      return t * t * (3 - 2 * t);
    };
    // The old procedural DOT over its 1x quad: 0.6 soft disc + 0.5 hot core.
    const old = (r) => (r > 1 ? 0 : clamp(0.6 * (1 - sm(0.2, 1, r)) + 0.5 * (1 - sm(0, 0.4, r))));
    const profile = (f) => {
      let half = 0;
      let energy = 0;
      const N = 2000;
      for (let k = 0; k < N; k++) {
        const r = ((k + 0.5) / N) * 2;
        const v = f(r);
        energy += v * 2 * Math.PI * r * (2 / N);
        if (v >= 0.5 * f(0)) half = r;
      }
      return { half, energy };
    };
    const before = profile(old);
    const now = profile(drawn);
    const shapeOnly = profile(glow);
    expect(now.half).toBeGreaterThanOrEqual(before.half);
    expect(shapeOnly.half).toBeGreaterThanOrEqual(0.55); // the review's 0.55 x size, even without the halo
    expect(now.energy).toBeGreaterThanOrEqual(before.energy);
  });

  test('10 sparkles share one atlas: getTexture is called once per kind', () => {
    textures.disposeTextures();
    textures.getTexture.mockClear(); // counted across pool creation and all 10 starts
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 2048);
    const atlas = pool.layers[0].material.uniforms.uAtlas.value;
    const mod = EFFECTS.sparkles;
    const die = new THREE.Group();
    die.position.set(0, 0.5, 0);
    for (let i = 0; i < 10; i++) {
      const handle = mod.start({
        scene,
        camera: new THREE.PerspectiveCamera(),
        die: { outer: die, inner: die, uniforms: {} },
        position: die.position.clone(),
        color: new THREE.Color(mod.defaults.color),
        intensity: 1,
        duration: mod.defaults.duration,
        options: {},
        particles: pool,
        isolate: () => ({}),
        shake: () => {},
        tier: TIERS.ultra,
      });
      handle.update(1000 * i); // the first update starts its clock
      handle.update(1000 * i + 500); // half-way: it emits
    }
    const kinds = textures.getTexture.mock.calls.map((c) => c[0]);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.length).toBeLessThanOrEqual(5);
    expect(new Set(kinds).size).toBe(kinds.length); // once per kind
    for (const layer of pool.layers) expect(layer.material.uniforms.uAtlas.value).toBe(atlas); // never rebuilt
    expect(pool.layers[0].mesh.visible).toBe(true); // the starts really emitted into this pool
    pool.dispose();
  });

  test('dispose calls disposeTextures', () => {
    const pool = createParticlePool(new THREE.Scene(), 16);
    textures.disposeTextures.mockClear();
    pool.dispose();
    expect(textures.disposeTextures).toHaveBeenCalledTimes(1);
  });

  test('the halo and the atlas stay within one extra vertex attribute and one draw per layer', () => {
    const scene = new THREE.Scene();
    const pool = createParticlePool(scene, 16);
    expect(scene.children).toHaveLength(2);
    const vs = pool.layers[0].material.vertexShader;
    expect((vs.match(/^attribute /gm) ?? []).length).toBeLessThanOrEqual(8);
    expect(vs).toContain('aHalo');
    expect(pool.layers[0].material.fragmentShader).toContain('uAtlas');
    pool.dispose();
  });
});

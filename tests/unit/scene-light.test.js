import * as THREE from 'three';
import { lightingFor } from '../../src/render/scene-light.js';
import { buildScene } from '../../src/render/scene.js';

test('studio is the baked studio; sun is warm and low', () => {
  expect(lightingFor('studio')).toEqual({ tint: null, intensity: 1, sun: false });
  expect(lightingFor('junk')).toEqual({ tint: null, intensity: 1, sun: false });
  const sun = lightingFor('sun');
  expect(sun.sun).toBe(true);
  expect(sun.tint[0]).toBeGreaterThan(sun.tint[2]); // warm
});

test('scene light: darkness dims (never below a floor the insides still show at) and leans the tint to the night colour', () => {
  const day = lightingFor('scene', { darkness: 0, daylight: [1, 1, 1], night: [0.2, 0.3, 0.8] });
  expect(day).toEqual({ tint: [1, 1, 1], intensity: 1, sun: false });
  const night = lightingFor('scene', { darkness: 1, daylight: [1, 1, 1], night: [0.2, 0.3, 0.8] });
  expect(night.intensity).toBeCloseTo(0.6);
  expect(night.tint[2]).toBe(1); // a tint at full brightness: darkness does the dimming
  // half way to white: a deep blue night must not drown a green or red die's inside
  expect(night.tint[0]).toBeGreaterThan(0.55);
  expect(night.tint[0]).toBeLessThan(0.7);
  expect(lightingFor('scene', { darkness: 9, daylight: 'x' }).intensity).toBeCloseTo(0.6); // clamped, defaults
});

test('setLighting drives the environment intensity, key light and fill', () => {
  const api = buildScene();
  const key = api.scene.children.find((c) => c.isDirectionalLight);
  const fill = api.scene.children.find((c) => c.isHemisphereLight);
  api.setLighting(lightingFor('scene', { darkness: 1, night: [0, 0, 1] }));
  expect(api.scene.environmentIntensity).toBeCloseTo(0.6);
  expect(key.color.equals(new THREE.Color().setRGB(0.5, 0.5, 1))).toBe(true);
  expect(fill.intensity).toBeGreaterThan(0);
  api.setLighting(lightingFor('sun'));
  expect(key.position.y).toBeLessThan(8);
  api.setLighting();
  expect([api.scene.environmentIntensity, key.intensity, fill.intensity]).toEqual([1, 2.2, 0]);
});

describe('light pools', () => {
  test('a clear die gets a pool in its colour, at full brightness; opaque, dark and ghost-free looks none', async () => {
    const { poolColor } = await import('../../src/throw/dice-box.js');
    const { normalizeAppearance } = await import('../../src/look/appearance.js');
    const blue = poolColor(
      normalizeAppearance({
        body: { type: 'resin', color: '#10306a' },
        interior: { type: 'none' },
      }),
    );
    expect(blue.b).toBeCloseTo(1);
    expect(blue.r).toBeLessThan(0.3);
    expect(
      poolColor(
        normalizeAppearance({
          body: { type: 'resin', color: '#10306a' },
          interior: { type: 'nebula', colors: ['#ff0000', '#00ff00'] },
        }),
      ).getHexString(),
    ).toBe('ff0000');
    expect(
      poolColor(normalizeAppearance({ body: { type: 'jelly', color: '#e8264f' } })).r,
    ).toBeCloseTo(1);
    expect(poolColor(normalizeAppearance({ body: { type: 'metal' } }))).toBeNull();
    // a glowing die gives off its glow's light (any body), stronger with the glow
    const lit = poolColor(
      normalizeAppearance({ body: { type: 'metal' }, glow: { color: '#00ff40', intensity: 2 } }),
    );
    expect(lit.g).toBeCloseTo(1);
    expect(lit.r).toBeCloseTo(0);
    const dim = poolColor(
      normalizeAppearance({ body: { type: 'opaque' }, glow: { color: '#00ff40', intensity: 0.5 } }),
    );
    expect(dim.g).toBeCloseTo(0.5);
    expect(
      poolColor(
        normalizeAppearance({
          body: { type: 'opaque' },
          glow: { color: '#00ff40', intensity: 0.2 },
        }),
      ),
    ).toBeNull(); // a faint glow: none
    expect(
      poolColor(
        normalizeAppearance({
          body: { type: 'resin', color: '#000000' },
          interior: { type: 'none' },
        }),
      ),
    ).toBeNull();
  });

  test('shadowFor with a pool adds a coloured additive quad that follows the die and leaves with it', () => {
    const api = buildScene();
    const mesh = {
      position: new THREE.Vector3(1, 0.5, 2),
      geometry: { boundingSphere: { radius: 1 } },
    };
    const plain = api.shadowFor({ position: new THREE.Vector3(), geometry: mesh.geometry });
    const h = api.shadowFor(mesh, { pool: new THREE.Color(0, 0, 1) });
    const pools = () => api.scene.children.find((c) => c.userData.dicerPools);
    expect(pools()).toBeTruthy();
    expect(pools().material.blending).toBe(THREE.AdditiveBlending);
    expect(pools().geometry.drawRange.count).toBe(6);
    const col = pools().geometry.attributes.color.array;
    expect(col[2]).toBeGreaterThan(0);
    expect(col[0]).toBe(0);
    api.releaseShadow(h);
    expect(pools()).toBeUndefined();
    api.releaseShadow(plain);
    api.dispose();
  });
});

import * as THREE from 'three';
import { createModelCreature } from '../../src/pet/chunk/model-pet.js';
import { safe } from '../../src/pet/chunk/creatures/index.js';

/**
 * The standard checks for a built pet model (docs/reference/pet-model-spec.md + Dicer's loader),
 * as vitest tests. In a test file:
 *
 *   import { build } from '../../scripts/pets/build-owl.js';
 *   import { petModelChecks } from '../helpers/pet-model-checks.js';
 *   petModelChecks('owl', build, { bones: ['wing_L', 'wing_R'] });
 *
 * Checks: the required bones (+ o.bones) in one tree from `root`; the 7 required shape keys on
 * Body (+ o.keys) and found by the loader; Body and Eyes (+ Extra if o.extra) skinned meshes, at
 * most o.maxTriangles (10,000) triangles and at least o.minBodyTriangles on Body; Body textured,
 * opaque, its map alpha (the tint mask) with both 0 and 255 areas; skin weights normalised, <= 4
 * influences, on real bones, eyes rigid on eye_L / eye_R; every phase and reaction poses without
 * NaN; 1.5 tall standing on y = 0; sulk below 0.9x standing height, proud taller; every required
 * shape key moves some vertices.
 */

export const REQUIRED_BONES = ['root', 'body', 'head', 'eye_L', 'eye_R'];
export const REQUIRED_KEYS = ['blink_L', 'blink_R', 'happy', 'sad', 'surprised', 'mouthOpen', 'angry'];
export const PHASES = ['enter', 'throw', 'watch', 'react', 'exit', 'move', 'pet', 'huff', 'scorch', 'shiver', 'bristle', 'startle', 'proud', 'sulk', 'cheer'];
export const REACTIONS = ['crit', 'fumble', 'mixed', 'plain'];

/**
 * @param {string} kind the pet kind (the creature's name)
 * @param {(o?: object) => THREE.Object3D} build the build script's build()
 * @param {{bones?: string[], keys?: string[], extra?: boolean, maxTriangles?: number,
 *   minBodyTriangles?: number, color?: string, floating?: boolean, buildOptions?: object}} [o]
 *   floating: a hovering pet (ghost, eye) need not touch y = 0 at rest (its lowest point may sit
 *   above the floor), but the loader still fits it 1.5 tall
 */
export function petModelChecks(kind, build, o = {}) {
  const { bones = [], keys = [], extra = false, maxTriangles = 10000, minBodyTriangles = 3000, color = '#e08a2c', floating = false, buildOptions } = o;
  let template;
  beforeAll(() => {
    template = build(buildOptions);
  }, 120000);

  const make = (c = color) => safe((col) => createModelCreature(template, col, { kind, clock: () => 0 }))(c);
  const boxOf = (obj) => {
    obj.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(obj, true);
  };
  const meshes = (root) => {
    const out = [];
    root.traverse((m) => m.isMesh && out.push(m));
    return out;
  };

  describe(`the ${kind} model`, () => {
    test('has the spec bones, in one tree from root', () => {
      for (const name of [...REQUIRED_BONES, ...bones]) expect(template.getObjectByName(name)?.isBone, name).toBe(true);
      const root = template.getObjectByName('root');
      expect(root.parent?.isBone).toBeFalsy();
      expect(root.position.length()).toBeLessThan(1e-6);
      expect(template.getObjectByName('head').parent.name).toMatch(/^(body|neck)$/);
      for (const e of ['eye_L', 'eye_R']) expect(template.getObjectByName(e).parent.name).toBe('head');
      for (const n of bones) {
        let p = template.getObjectByName(n);
        while (p && p !== root) p = p.parent;
        expect(p, `${n} under root`).toBe(root);
      }
    });

    test('Body has the required shape keys and the loader finds them', () => {
      const body = template.getObjectByName('Body');
      for (const k of [...REQUIRED_KEYS, ...keys]) expect(body.morphTargetDictionary, k).toHaveProperty(k);
      const c = make();
      expect(c.shapeKeys).toEqual(expect.arrayContaining([...REQUIRED_KEYS, ...keys]));
      c.dispose();
    });

    test(`Body and Eyes skinned meshes, at most ${maxTriangles} triangles`, () => {
      const ms = meshes(template);
      expect(ms.map((m) => m.name).sort()).toEqual(extra ? ['Body', 'Extra', 'Eyes'] : ['Body', 'Eyes']);
      for (const m of ms) expect(m.isSkinnedMesh, m.name).toBe(true);
      const tris = ms.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
      expect(tris).toBeLessThanOrEqual(maxTriangles);
      expect(template.getObjectByName('Body').geometry.index.count / 3).toBeGreaterThan(minBodyTriangles);
    });

    test('Body is textured and opaque; its map alpha (the tint mask) has 0 and 255 areas', () => {
      const body = template.getObjectByName('Body');
      expect(Array.isArray(body.material)).toBe(false);
      expect(body.material.isMeshStandardMaterial).toBe(true);
      expect(body.material.transparent).toBe(false);
      const img = body.material.map?.image;
      expect(img?.width).toBeGreaterThanOrEqual(512);
      expect(img.width).toBeLessThanOrEqual(2048);
      let zero = 0;
      let full = 0;
      for (let i = 3; i < img.data.length; i += 4) {
        if (img.data[i] === 0) zero++;
        else if (img.data[i] === 255) full++;
      }
      expect(zero).toBeGreaterThan(1000);
      expect(full).toBeGreaterThan(1000);
      expect(body.geometry.attributes.uv).toBeDefined();
    });

    test('skin weights: <= 4 influences, normalised, on real bones; eyes rigid on their bones', () => {
      for (const m of meshes(template)) {
        const w = m.geometry.attributes.skinWeight;
        const ix = m.geometry.attributes.skinIndex;
        expect(w.itemSize).toBe(4);
        for (let i = 0; i < w.count; i++) {
          const s = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
          expect(Math.abs(s - 1)).toBeLessThan(1e-3);
          for (let k = 0; k < 4; k++) expect(ix.getComponent(i, k)).toBeLessThan(m.skeleton.bones.length);
        }
      }
      const eyes = template.getObjectByName('Eyes');
      const names = eyes.skeleton.bones.map((b) => b.name);
      const w = eyes.geometry.attributes.skinWeight;
      const ix = eyes.geometry.attributes.skinIndex;
      for (let i = 0; i < w.count; i++) {
        expect(w.getX(i)).toBe(1);
        expect(['eye_L', 'eye_R']).toContain(names[ix.getX(i)]);
      }
    });

    test('every phase and reaction poses without NaN', () => {
      const c = make();
      for (const phase of PHASES)
        for (const reaction of phase === 'react' ? REACTIONS : [null])
          for (const t of [0, 0.3, 0.5, 0.8, 1]) {
            c.pose(phase, t, reaction, { yaw: 0.4, now: 1234 });
            c.root.traverse((n) => {
              for (const v of [n.position, n.scale]) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
              expect(Number.isFinite(n.quaternion.x + n.quaternion.y + n.quaternion.z + n.quaternion.w)).toBe(true);
              if (n.morphTargetInfluences) for (const v of n.morphTargetInfluences) expect(Number.isFinite(v)).toBe(true);
            });
          }
      const b = boxOf(c.root);
      expect(Number.isFinite(b.min.x + b.max.y)).toBe(true);
      c.dispose();
    });

    test('stands 1.5 tall on the floor; sulks smaller, stands proud taller', () => {
      const c = make();
      c.pose('watch', 0, null, { yaw: 0, now: 0 });
      const b = boxOf(c.root);
      const h = b.max.y - b.min.y;
      expect(h).toBeGreaterThan(1.4);
      expect(h).toBeLessThan(1.65);
      if (!floating) expect(Math.abs(b.min.y)).toBeLessThan(0.04);
      c.pose('sulk', 1, null, { yaw: 0, now: 0 });
      expect(boxOf(c.root).max.y).toBeLessThan(0.9 * b.max.y);
      c.pose('proud', 1, null, { yaw: 0, now: 0 });
      expect(boxOf(c.root).max.y).toBeGreaterThan(b.max.y);
      c.dispose();
    });

    test('the required shape keys move the face', () => {
      const body = template.getObjectByName('Body');
      const g = body.geometry;
      for (const k of REQUIRED_KEYS) {
        const a = g.morphAttributes.position[body.morphTargetDictionary[k]];
        let n = 0;
        for (let i = 0; i < a.count; i++) if (Math.hypot(a.getX(i), a.getY(i), a.getZ(i)) > 0.01) n++;
        expect(n, k).toBeGreaterThan(20);
      }
    });
  });
}

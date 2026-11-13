import * as THREE from 'three';
import { CREATURES } from '../../src/pet/chunk/creatures/index.js';

// The chosen standing height (die units) and its tolerance: see the Task 4 report (the pet reads
// as a creature beside a d20 from the top-down camera at 1.5; a d20 rests ~1.6 tall).
const HEIGHT = 1.5;
const TOL = 0.15;
const PHASES = ['enter', 'throw', 'watch', 'react', 'exit', 'wobble', 'reform'];
const REACTIONS = ['crit', 'fumble', 'mixed', 'plain', null];
const KINDS = ['mimic', 'slime', 'dragonling'];
// The watch pose's measured height. The mimic's height is its closed chest, and its open jaw
// rises above it (see creatures/index.js), so its open pose may stand up to 2.5.
const WATCH_MAX = { mimic: 2.5 };

const meshes = (root) => {
  const out = [];
  root.traverse((o) => o.isMesh && out.push(o));
  return out;
};
const triangles = (root) =>
  meshes(root).reduce((n, m) => {
    const g = m.geometry;
    return n + (g.index ? g.index.count : g.attributes.position.count) / 3;
  }, 0);
const materialsOf = (root) => {
  const set = new Set();
  for (const m of meshes(root)) for (const mat of [].concat(m.material)) set.add(mat);
  return [...set];
};

test('CREATURES has exactly the three kinds', () => {
  expect(Object.keys(CREATURES).sort()).toEqual([...KINDS].sort());
});

describe.each(KINDS)('%s', (kind) => {
  test(`builds a root with height ~${HEIGHT} (${HEIGHT - TOL}..${HEIGHT + TOL})`, () => {
    const c = CREATURES[kind]('#c0392b');
    expect(c.root).toBeInstanceOf(THREE.Object3D);
    expect(c.height).toBeGreaterThanOrEqual(HEIGHT - TOL);
    expect(c.height).toBeLessThanOrEqual(HEIGHT + TOL);
    c.pose('watch', 0, null, { yaw: 0 });
    c.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c.root);
    const size = box.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThanOrEqual(HEIGHT - TOL);
    expect(size.y).toBeLessThanOrEqual(WATCH_MAX[kind] ?? HEIGHT + TOL);
    expect(Math.abs(box.min.y)).toBeLessThan(0.06); // stands on the floor
    c.dispose();
  });

  test('its top-down footprint is about a d20 wide (>= 1.6)', () => {
    const c = CREATURES[kind]('#c0392b');
    c.pose('watch', 0, null, { yaw: 0, now: 0 });
    c.root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(c.root).getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.z)).toBeGreaterThanOrEqual(1.6);
    c.dispose();
  });

  test('<= 2500 triangles', () => {
    const c = CREATURES[kind]('#c0392b');
    expect(triangles(c.root)).toBeLessThanOrEqual(2500);
    c.dispose();
  });

  test('<= 3 distinct materials, all MeshStandardMaterial, colours clamped', () => {
    for (const color of ['#c0392b', '#1b2340', '#ffffff', '#f4f1de', undefined]) {
      const c = CREATURES[kind](color);
      const mats = materialsOf(c.root);
      expect(mats.length).toBeLessThanOrEqual(3);
      for (const m of mats) {
        expect(m.type).toBe('MeshStandardMaterial');
        for (const k of ['r', 'g', 'b']) {
          expect(m.color[k]).toBeLessThanOrEqual(1);
          expect(m.color[k]).toBeGreaterThanOrEqual(0);
        }
      }
      c.dispose();
    }
  });

  test('the body is the user colour and an accent is it lightened 30%', () => {
    const c = CREATURES[kind]('#c0392b');
    const want = new THREE.Color('#c0392b');
    const light = want.clone().lerp(new THREE.Color(1, 1, 1), 0.3);
    const mats = materialsOf(c.root);
    const near = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 1e-3;
    expect(mats.some((m) => near(m.color, want))).toBe(true);
    expect(mats.some((m) => near(m.color, light))).toBe(true);
    c.dispose();
  });

  test('pose() for every phase and reaction leaves no NaN in any matrix', () => {
    const c = CREATURES[kind]('#c0392b');
    const pos = c.root.position.clone();
    for (const phase of PHASES)
      for (const reaction of REACTIONS)
        for (const t of [0, 0.5, 1, -0.3, 1.4, NaN])
          for (const yaw of [-1.2, 0, 1.2]) {
            c.pose(phase, t, reaction, { yaw });
            c.root.updateMatrixWorld(true);
            c.root.traverse((o) => {
              for (const e of o.matrixWorld.elements) expect(Number.isFinite(e)).toBe(true);
            });
            expect(c.root.position.equals(pos)).toBe(true); // the layer owns the root
          }
    c.dispose();
  });

  test('crit, fumble, mixed and plain give different poses', () => {
    const c = CREATURES[kind]('#c0392b');
    const snap = () => {
      c.root.updateMatrixWorld(true);
      return meshes(c.root).flatMap((m) => m.matrixWorld.elements.map((e) => e.toFixed(3)));
    };
    const poses = ['crit', 'fumble', 'mixed', 'plain'].map((r) => {
      c.pose('react', 0.45, r, { yaw: 0 });
      return snap().join(',');
    });
    expect(new Set(poses).size).toBe(4);
    c.dispose();
  });

  test('pupils follow look.yaw', () => {
    const c = CREATURES[kind]('#c0392b');
    const at = (yaw) => {
      c.pose('watch', 0, null, { yaw, now: 1000 });
      c.root.updateMatrixWorld(true);
      return meshes(c.root)
        .filter((m) => m.name === 'pupil')
        .map((m) => m.getWorldPosition(new THREE.Vector3()).x);
    };
    const left = at(-0.6);
    const right = at(0.6);
    expect(left.length).toBe(2);
    for (let i = 0; i < left.length; i++) expect(right[i]).toBeGreaterThan(left[i]);
    c.dispose();
  });

  test('dispose frees every geometry and material', () => {
    const c = CREATURES[kind]('#c0392b');
    const geos = new Set(meshes(c.root).map((m) => m.geometry));
    const mats = materialsOf(c.root);
    const spies = [...geos, ...mats].map((x) => vi.spyOn(x, 'dispose'));
    c.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });
});

// --- wobble and reform (Task 5) -----------------------------------------------------------------

describe.each(KINDS)('%s wobble and reform', (kind) => {
  const sizeOf = (c) => {
    c.root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(c.root).getSize(new THREE.Vector3());
  };
  const isRest = (c) => {
    for (const k of ['x', 'y', 'z']) {
      expect(c.root.scale[k]).toBeCloseTo(1, 3);
      expect(c.root.rotation[k]).toBeCloseTo(0, 3);
    }
  };

  test('wobble starts and ends on the standing pose (no pop into or out of it)', () => {
    const c = CREATURES[kind]('#c0392b');
    c.pose('wobble', 0, 'plain', { yaw: 0, leanX: 1, leanZ: 0 });
    isRest(c);
    c.pose('wobble', 1, 'plain', { yaw: 0, leanX: 1, leanZ: 0 });
    isRest(c);
    c.dispose();
  });

  test('wobble squashes, then leans away from the hit (look.leanX/leanZ, local)', () => {
    const c = CREATURES[kind]('#c0392b');
    let minY = 1;
    for (let t = 0; t <= 1; t += 0.02) {
      c.pose('wobble', t, 'plain', { yaw: 0, leanX: 0, leanZ: 0 });
      minY = Math.min(minY, c.root.scale.y);
    }
    expect(minY).toBeLessThan(0.85);
    // the top goes toward +x when pushed toward +x, toward -z when pushed toward -z
    const top = (lx, lz) => {
      c.pose('wobble', 0.2, 'plain', { yaw: 0, leanX: lx, leanZ: lz });
      c.root.updateMatrixWorld(true);
      return new THREE.Vector3(0, 1.5, 0).applyMatrix4(c.root.matrixWorld);
    };
    expect(top(1, 0).x).toBeGreaterThan(0.1);
    expect(top(0, -1).z).toBeLessThan(-0.1);
    // no lean given: a plain squash and jiggle
    const still = top(undefined, undefined);
    expect(Math.abs(still.x) + Math.abs(still.z)).toBeLessThan(1e-6);
    c.dispose();
  });

  test('reform grows from (almost) nothing, overshoots, and lands on the standing pose', () => {
    const c = CREATURES[kind]('#c0392b');
    c.pose('reform', 0, 'plain', { yaw: 0 });
    const s0 = sizeOf(c);
    expect(Math.max(s0.x, s0.y, s0.z)).toBeLessThan(0.2); // hidden in the goo, also from above
    let peak = 0;
    for (let t = 0.3; t <= 0.95; t += 0.01) {
      c.pose('reform', t, 'plain', { yaw: 0 });
      peak = Math.max(peak, c.root.scale.y);
    }
    expect(peak).toBeGreaterThan(1.05); // the pop
    c.pose('reform', 1, 'plain', { yaw: 0 });
    isRest(c);
    c.pose('exit', 1, 'plain', { yaw: 0 });
    isRest(c); // and a normal pose resets whatever the wobble or reform left
    c.dispose();
  });
});

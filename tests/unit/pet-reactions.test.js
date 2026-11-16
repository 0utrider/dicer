import * as THREE from 'three';
import { elementReactions, reactionOf, REACT_REACH } from '../../src/pet/chunk/reactions.js';
import {
  createPetLayer,
  DIE_WIDTH,
  SCORCH_MS,
  SHIVER_MS,
  BRISTLE_MS,
  STARTLE_MS,
} from '../../src/pet/chunk/pets.js';
import { CREATURES } from '../../src/pet/chunk/creatures/index.js';
import { elementOf as trailsElementOf } from '../../src/effects/library/trails.js';
import { elementOf } from '../../src/effects/element-of.js';
import { HUFF_HITS } from '../../src/pet/chunk/petting.js';
import { buildScene } from '../../src/render/scene.js';

const FIRE = { appearance: { interior: { type: 'fire' } } };

// ---- reactions.js on its own ----
describe('elementReactions', () => {
  const resting = (x = 0, z = 0) => ({ state: 'rest', px: x, pz: z });
  const W = 1;

  test('a fire die one die width from a resting pet: it scorches', () => {
    const pet = resting();
    const r = elementReactions([{ x: W, z: 0, ...FIRE }], [pet], { dieWidth: W });
    expect(r).toEqual([{ pet, element: 'fire', from: { x: W, z: 0 } }]);
    expect(reactionOf(r[0].element)).toBe('scorch');
  });

  test('three die widths off: nothing (the reach is 2 die widths, scaled by dieWidth)', () => {
    expect(REACT_REACH).toBe(2);
    expect(elementReactions([{ x: 3, z: 0, ...FIRE }], [resting()], { dieWidth: 1 })).toEqual([]);
    expect(elementReactions([{ x: 0, z: 3, ...FIRE }], [resting()], { dieWidth: 2 })).toHaveLength(
      1,
    );
  });

  test('Review Focus 3: a ghost die never sets a pet off, stripped (as Task 1 sends it) or not', () => {
    const pet = resting();
    expect(elementReactions([{ x: 0.5, z: 0, ghost: true }], [pet], { dieWidth: 1 })).toEqual([]);
    // even if an element somehow rode along, a ghost die does not count
    expect(
      elementReactions([{ x: 0.5, z: 0, ghost: true, damageType: 'fire', ...FIRE }], [pet], {
        dieWidth: 1,
      }),
    ).toEqual([]);
  });

  test('a pet that is hopping, throwing, down, wobbling, huffy or gone: nothing', () => {
    const die = [{ x: 0.5, z: 0, ...FIRE }];
    for (const pet of [
      { state: 'hop', px: 0, pz: 0 },
      { state: 'routine', px: 0, pz: 0 },
      { state: 'splat', px: 0, pz: 0 },
      { ...resting(), wobble: { at: 0 } },
      { ...resting(), huff: { backAt: 1 } },
      { ...resting(), gone: true },
    ])
      expect(elementReactions(die, [pet], { dieWidth: 1 })).toEqual([]);
    // a pet mid-petting may react (the reaction replaces its wiggle)
    expect(
      elementReactions(die, [{ ...resting(), anim: { kind: 'pet' } }], { dieWidth: 1 }),
    ).toHaveLength(1);
  });

  test('two dice by one pet: one reaction, to the nearer', () => {
    const pet = resting();
    const r = elementReactions(
      [
        { x: 1.5, z: 0, damageType: 'fire' },
        { x: 0, z: -0.8, damageType: 'cold' },
      ],
      [pet],
      { dieWidth: 1 },
    );
    expect(r).toEqual([{ pet, element: 'frost', from: { x: 0, z: -0.8 } }]);
  });

  test('dice with no element, or unplaced, are ignored; each nearby pet reacts once', () => {
    const a = resting(0, 0);
    const b = resting(3, 0);
    const dice = [
      { x: 0.1, z: 0, damageType: 'untyped' },
      { x: 0.2, z: 0 },
      { z: 0, damageType: 'fire' },
      { x: 1.5, z: 0, damageType: 'electricity' },
    ];
    expect(elementReactions(dice, [a, b], { dieWidth: 1 }).map((r) => [r.pet, r.element])).toEqual([
      [a, 'storm'],
      [b, 'storm'],
    ]);
  });

  test('the element sets the pose: fire and lava scorch, frost shivers, storm bristles, the rest startle', () => {
    expect(['fire', 'lava', 'frost', 'storm', 'acid', 'void', 'sonic'].map(reactionOf)).toEqual([
      'scorch',
      'scorch',
      'shiver',
      'bristle',
      'startle',
      'startle',
      'startle',
    ]);
  });

  test('elementOf moved to element-of.js; trails.js re-exports the same function', () => {
    expect(trailsElementOf).toBe(elementOf);
    expect(elementOf({ interior: { type: 'lava' } }, 'cold')).toBe('lava');
    expect(elementOf(undefined, 'Lightning')).toBe('storm');
    expect(elementOf(undefined, 'untyped')).toBeNull();
  });
});

// ---- the pet layer ----
const PX = 48;
const STAGE = {
  cx: 0,
  cz: 0,
  halfWidth: 640 / PX,
  halfDepth: 400 / PX,
  rect: { left: 0, top: 0, width: 1280, height: 800 },
};
let clockNow = 0;
const make = (settings = {}, over = {}) => {
  clockNow = 0;
  const all = { petStay: 60, petRestSpot: 'bottomRight', ...settings };
  const scene = new THREE.Scene();
  const win = new EventTarget();
  const deps = {
    scene,
    getSetting: (k) => all[k],
    playSound: vi.fn(),
    now: () => clockNow,
    wake: vi.fn(),
    win,
    random: () => 0.5,
    ...over,
  };
  const layer = createPetLayer(deps);
  layer.areaChanged(STAGE);
  return { layer, scene, win, deps, settings: all };
};
const runTo = (m, ms) => {
  let r;
  while (clockNow < ms) r = m.layer.update((clockNow += 16));
  return r;
};
const AREA = { cx: 0, cz: 0, halfWidth: STAGE.halfWidth, halfDepth: STAGE.halfDepth };
const spec = (userId = 'u1', kind = 'mimic') => ({ userId, kind, color: '#ff0000' });
/** A whole roll of `user`'s pet, to its rest at its petRestSpot. */
const rollToRest = (m, user = 'u1', kind = 'mimic') => {
  const key = `k-${user}-${clockNow}`;
  m.layer.begin(key, {
    spec: spec(user, kind),
    edge: 0,
    area: AREA,
    centre: () => ({ x: 0, z: 0 }),
  });
  runTo(m, clockNow + 400);
  m.layer.landed(key, [{ type: 'd20', value: 5 }]);
  runTo(m, clockNow + 2500);
  m.layer.leave(key, 0);
  m.layer.end(key);
  expect(runTo(m, clockNow + 1000)).toBe('rest');
};
const group = (m, i = 0) => m.scene.children.filter((c) => c.userData.dicerPet)[i];
/** Another user's roll lands `dice` (each placed `dx` die widths beside u1's resting pet unless it has x). */
const landBeside = (m, dice) => {
  const g = group(m);
  const key = `other-${clockNow}`;
  m.layer.begin(key, {
    spec: spec('u2', 'slime'),
    edge: 1,
    area: AREA,
    centre: () => ({ x: 0, z: 0 }),
  });
  m.layer.update((clockNow += 16));
  m.deps.wake.mockClear();
  m.layer.landed(
    key,
    dice.map((d) => ({
      type: 'd6',
      value: 3,
      x: g.position.x + (d.dx ?? 0) * DIE_WIDTH,
      z: g.position.z,
      ...d,
    })),
  );
  return key;
};
const phase = (m) => group(m).userData.dicerPet.phase;

describe('reactions in the layer', () => {
  test('a fire die by a resting pet: it scorches with a smoke puff, the loop runs only for it, then idles', () => {
    const m = make();
    rollToRest(m);
    landBeside(m, [{ dx: 1, damageType: 'fire' }]);
    expect(m.deps.wake).toHaveBeenCalled();
    m.layer.update((clockNow += 16));
    expect(phase(m)).toBe('scorch');
    const smoke = group(m).children.find((c) => c.name === 'petSmoke');
    expect(smoke.visible).toBe(true);
    runTo(m, clockNow + SCORCH_MS);
    expect(phase(m)).not.toBe('scorch');
    expect(smoke.visible).toBe(false);
  });

  /** A roll by a player with no pet lands `die` beside u1's resting pet (DiceBox: landed with no key). */
  const landNoPet = (m, die) => {
    const g = group(m);
    m.deps.wake.mockClear();
    m.layer.landed(undefined, [{ type: 'd6', value: 3, x: g.position.x + DIE_WIDTH, z: g.position.z, ...die }]);
  };

  test('a roll whose roller has no pet: a fire die by a resting pet scorches it', () => {
    const m = make();
    rollToRest(m);
    landNoPet(m, { damageType: 'fire' });
    expect(m.deps.wake).toHaveBeenCalled();
    m.layer.update((clockNow += 16));
    expect(phase(m)).toBe('scorch');
  });

  test('a roll whose roller has no pet: a ghost die (stripped, as DiceBox sends it) does nothing', () => {
    const m = make();
    rollToRest(m);
    landNoPet(m, { ghost: true });
    expect(m.deps.wake).not.toHaveBeenCalled();
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    expect(phase(m)).toBe('exit');
  });

  test('a keyless landing with no pets on screen wakes nothing', () => {
    const m = make();
    m.layer.landed(null, [{ type: 'd6', value: 3, x: 0, z: 0, damageType: 'fire' }]);
    expect(m.deps.wake).not.toHaveBeenCalled();
    expect(m.layer.update((clockNow += 16))).toBe(false);
  });

  test('scorch smoke: grey puffs, normally blended (not a glow), rising above the top of the pet', () => {
    for (const kind of ['mimic', 'slime', 'dragonling']) {
      const m = make();
      rollToRest(m, 'u1', kind);
      const g = group(m);
      const top = new THREE.Box3().setFromObject(g.children.find((c) => c.name === kind)).max.y;
      landBeside(m, [{ dx: 1, damageType: 'fire' }]);
      runTo(m, clockNow + SCORCH_MS * 0.45);
      const smoke = g.children.find((c) => c.name === 'petSmoke');
      expect(smoke.material.blending).toBe(THREE.NormalBlending);
      const col = smoke.geometry.attributes.color;
      expect(col.itemSize).toBe(4); // each puff its own alpha
      const pos = smoke.geometry.attributes.position;
      let shown = 0;
      for (let i = 0; i < col.count; i++) {
        if (col.getW(i) < 0.05) continue;
        shown++;
        expect(col.getX(i)).toBe(col.getZ(i)); // grey
        expect(col.getX(i)).toBeLessThan(0.5); // never a bright glow
        expect(pos.getY(i)).toBeGreaterThan(top - 0.05); // clear of the body (the mimic's lid too)
      }
      expect(shown, kind).toBeGreaterThanOrEqual(3);
    }
  });

  test('bristle sparks: several bright yellow-white sparks lit through the reaction', () => {
    const m = make();
    rollToRest(m);
    landBeside(m, [{ dx: 1, damageType: 'electricity' }]);
    const pts = group(m).children.find((c) => c.name === 'petSparkle');
    const t0 = clockNow;
    for (const at of [0.2, 0.5, 0.8]) {
      runTo(m, t0 + BRISTLE_MS * at);
      const col = pts.geometry.attributes.color;
      let lit = 0;
      for (let i = 0; i < col.count; i++) if (col.getX(i) > 0.5 && col.getY(i) > 0.45) lit++;
      expect(lit, `t ${at}`).toBeGreaterThanOrEqual(2);
      expect(pts.material.size).toBeGreaterThan(3); // bigger than the crit sparkle's
    }
  });

  test('frost on a light pet: a gentle icy tint, its own colour still shows', () => {
    const m = make();
    const key = 'light';
    m.layer.begin(key, { spec: { userId: 'u1', kind: 'slime', color: '#f4e04d' }, edge: 0, area: AREA, centre: () => ({ x: 0, z: 0 }) });
    runTo(m, 400);
    m.layer.landed(key, [{ type: 'd20', value: 5 }]);
    runTo(m, clockNow + 2500);
    m.layer.leave(key, 0);
    m.layer.end(key);
    runTo(m, clockNow + 1000);
    let mat;
    group(m).traverse((o) => (mat ??= o.material?.emissive ? o.material : undefined));
    const was = mat.color.clone();
    landBeside(m, [{ dx: 1, damageType: 'cold' }]);
    runTo(m, clockNow + SHIVER_MS * 0.2); // the tint at its fullest
    // cooler: the warm channels damped more than blue
    expect(mat.color.r / was.r).toBeLessThan(0.85);
    expect(mat.color.b / was.b).toBeGreaterThan(0.95);
    // but not washed out toward white: the yellow body still has clearly more red than blue
    expect(mat.color.r - mat.color.b).toBeGreaterThan(0.5 * (was.r - was.b));
    expect(mat.color.r + mat.color.g + mat.color.b).toBeLessThanOrEqual(was.r + was.g + was.b + 1e-6);
  });

  test('each element its pose', () => {
    for (const [damageType, pose] of [
      ['cold', 'shiver'],
      ['electricity', 'bristle'],
      ['acid', 'startle'],
    ]) {
      const m = make();
      rollToRest(m);
      landBeside(m, [{ dx: 1, damageType }]);
      m.layer.update((clockNow += 16));
      expect(phase(m)).toBe(pose);
    }
  });

  test('a resting pet is idle again once its reaction is over', () => {
    const m = make();
    rollToRest(m);
    const key = landBeside(m, [{ dx: 1, damageType: 'acid' }]);
    m.layer.leave(key, 0);
    m.layer.end(key); // the other roller's pet rests too
    runTo(m, clockNow + 2500);
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    expect(STARTLE_MS).toBeLessThan(2500);
  });

  test('three die widths off, a ghost die, petElemental off or pets hidden: no reaction', () => {
    const cases = [
      [{}, [{ dx: 3, damageType: 'fire' }]],
      [{}, [{ dx: 0.5, ghost: true }]],
      [{ petElemental: false }, [{ dx: 1, damageType: 'fire' }]],
    ];
    for (const [settings, dice] of cases) {
      const m = make(settings);
      rollToRest(m);
      landBeside(m, dice);
      m.layer.update((clockNow += 16));
      expect(phase(m)).toBe('exit'); // still its standing pose
    }
    const m = make();
    rollToRest(m);
    m.settings.showPets = false;
    landBeside(m, [{ dx: 1, damageType: 'fire' }]);
    expect(m.deps.wake).not.toHaveBeenCalled();
  });

  test('a huffy pet does not react; a pet being petted does (the reaction replaces the wiggle)', () => {
    const { camera: cam, fitArea } = buildScene();
    fitArea(STAGE);
    const click = (m) => {
      const g = group(m);
      const v = new THREE.Vector3(g.position.x, 0.75, g.position.z).project(cam);
      const x = ((v.x + 1) / 2) * 1280;
      const y = ((1 - v.y) / 2) * 800;
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        const e = new Event(type, { cancelable: true });
        Object.defineProperties(e, {
          button: { value: 0 },
          clientX: { value: x },
          clientY: { value: y },
        });
        m.win.dispatchEvent(e);
      }
    };
    let m = make();
    rollToRest(m);
    click(m);
    m.layer.update((clockNow += 16));
    expect(phase(m)).toBe('pet');
    landBeside(m, [{ dx: 1, damageType: 'cold' }]);
    m.layer.update((clockNow += 16));
    expect(phase(m)).toBe('shiver');

    m = make();
    rollToRest(m);
    for (let i = 0; i < HUFF_HITS; i++) click(m);
    m.layer.update((clockNow += 16));
    expect(phase(m)).toBe('huff');
    landBeside(m, [{ dx: 1, damageType: 'fire' }]);
    m.layer.update((clockNow += 16));
    expect(phase(m)).toBe('huff');
  });

  test('frost: a frosty tint that fades, and the colours come back exactly', () => {
    const m = make();
    rollToRest(m);
    const mats = [];
    group(m).traverse((o) => o.material?.emissive && mats.push(o.material));
    const before = mats.map((x) => [x.color.getHex(), x.emissive.getHex()]);
    landBeside(m, [{ dx: 1, damageType: 'cold' }]);
    runTo(m, clockNow + SHIVER_MS * 0.15);
    // the red body is cooler (its red damped) under a faint cold sheen
    const was = new THREE.Color(before[0][0]);
    expect(mats[0].color.r).toBeLessThan(was.r * 0.85);
    expect(mats[0].emissive.b).toBeGreaterThan(mats[0].emissive.r);
    runTo(m, clockNow + SHIVER_MS);
    expect(mats.map((x) => [x.color.getHex(), x.emissive.getHex()])).toEqual(before);
  });

  test('a die hit knocks a shiver out, tint and all', () => {
    const m = make();
    rollToRest(m);
    const mat = (() => {
      let f;
      group(m).traverse((o) => (f ??= o.material?.emissive ? o.material : f));
      return f;
    })();
    const was = mat.color.getHex();
    landBeside(m, [{ dx: 1, damageType: 'cold' }]);
    runTo(m, clockNow + 200);
    expect(mat.color.getHex()).not.toBe(was);
    m.layer.hit('u1', { speed: 3, position: { x: 0, z: 0 } });
    expect(mat.color.getHex()).toBe(was);
  });

  test('reduced motion: a gentler shiver, and storm sparks that fade without flashing', () => {
    const shake = (calm) => {
      const m = make({}, { reducedMotion: () => calm });
      rollToRest(m);
      landBeside(m, [{ dx: 1, damageType: 'cold' }]);
      let most = 0;
      const root = group(m).children[0];
      const end = clockNow + SHIVER_MS;
      while (clockNow < end) {
        m.layer.update((clockNow += 16));
        root.traverse((o) => (most = Math.max(most, Math.abs(o.rotation.z))));
      }
      return most;
    };
    expect(shake(true)).toBeLessThan(shake(false));
    /** How many times a spark's brightness turns from falling back to rising (0: it fades in and out once). */
    const flashes = (calm) => {
      const m = make({}, { reducedMotion: () => calm });
      rollToRest(m);
      landBeside(m, [{ dx: 1, damageType: 'electricity' }]);
      const pts = group(m).children.find((c) => c.name === 'petSparkle');
      const seen = [];
      const end = clockNow + BRISTLE_MS;
      while (clockNow < end) {
        m.layer.update((clockNow += 8));
        seen.push(pts.visible ? pts.geometry.attributes.color.array[1] : 0);
      }
      let turns = 0;
      for (let i = 2; i < seen.length; i++)
        if (seen[i - 1] < seen[i - 2] - 1e-6 && seen[i] > seen[i - 1] + 1e-6) turns++;
      return turns;
    };
    expect(flashes(true)).toBe(0);
    expect(flashes(false)).toBeGreaterThan(0);
  });
});

describe.each(['mimic', 'slime', 'dragonling'])(
  '%s poses scorch, shiver, bristle and startle',
  (kind) => {
    test('finite, moving, and starting and ending on the standing pose', () => {
      const c = CREATURES[kind]('#3080ff');
      const snap = () => {
        c.root.updateMatrixWorld(true);
        const out = [];
        c.root.traverse((o) => out.push(...o.matrixWorld.elements));
        return out;
      };
      c.pose('exit', 1, 'plain', { yaw: 0, now: 0 });
      const stand = snap();
      for (const phase of ['scorch', 'shiver', 'bristle', 'startle'])
        for (const calm of [false, true]) {
          let moved = 0;
          for (let t = 0; t <= 1; t += 0.05) {
            c.pose(phase, t, 'plain', { yaw: 0, now: 0, calm });
            const m = snap();
            expect(m.every(Number.isFinite)).toBe(true);
            moved = Math.max(moved, ...m.map((v, i) => Math.abs(v - stand[i])));
          }
          expect(moved).toBeGreaterThan(0.01);
          for (const t of [0, 1]) {
            c.pose(phase, t, 'plain', { yaw: 0, now: 0, calm });
            const m = snap();
            expect(
              Math.max(...m.map((v, i) => Math.abs(v - stand[i]))),
              `${phase} t=${t}`,
            ).toBeLessThan(0.08);
          }
        }
      c.dispose();
    });
  },
);

import * as THREE from 'three';
import { createPetLayer } from '../../src/pet/chunk/pets.js';
import { createMoods } from '../../src/pet/chunk/moods.js';
import { eligible, slowing, dashMs, spitPath, CATCH, DASH_MS, SPIT_MS } from '../../src/pet/chunk/catch.js';

// ---- a pet catches its owner's natural 20 mid-roll and spits it back out (dicer.pet flag `catch`) ----
const PX = 48;
const STAGE = { cx: 0, cz: 0, halfWidth: 640 / PX, halfDepth: 400 / PX, rect: { left: 0, top: 0, width: 1280, height: 800 } };
const AREA = { cx: 0, cz: 0, halfWidth: STAGE.halfWidth, halfDepth: STAGE.halfDepth };
let clockNow = 0;

function make({ catches = true, settings = {}, over = {} } = {}) {
  clockNow = 0;
  const all = { petStay: 60, petRestSpot: 'bottomRight', timeBeforeHide: 2000, ...settings };
  const scene = new THREE.Scene();
  const deps = {
    scene,
    getSetting: (k) => all[k],
    getTier: () => ({ effectBudget: 6 }),
    playSound: vi.fn(),
    now: () => clockNow,
    wake: vi.fn(),
    win: new EventTarget(),
    random: () => 0.5,
    moods: createMoods(),
    reducedMotion: () => false,
    setTimer: vi.fn(() => 1),
    clearTimer: vi.fn(),
    userOf: () => ({ getFlag: (s, k) => (k === 'pet' ? { catch: catches } : undefined) }),
    ...over,
  };
  const layer = createPetLayer(deps);
  layer.areaChanged(STAGE);
  return { layer, scene, deps };
}

/** A d20 group in the scene (as DiceBox makes it), with its blob shadow handle. */
function d20(scene, value = 20) {
  const outer = new THREE.Group();
  outer.userData.dicerDie = true;
  outer.position.set(-4, 0.8, 0);
  scene.add(outer);
  const geometry = new THREE.IcosahedronGeometry(0.9);
  geometry.computeBoundingSphere();
  const follow = { position: outer.position, geometry };
  return { outer, inner: new THREE.Mesh(), type: 'd20', value, ghost: false, fx: null, geometry, shadow: { follow }, follow };
}

/** Runs to `ms`, moving the die by `step` x units per 16 ms frame. */
function fly(m, die, ms, step) {
  while (clockNow < ms) {
    die.outer.position.x += step;
    m.layer.update((clockNow += 16));
  }
}
const phaseOf = (m) => m.scene.children.find((c) => c.userData.dicerPet)?.userData.dicerPet.phase;

/** Begins `user`'s roll with `die`, flies it fast past the catch's minimum flight, then slow. */
function throwAndCatch(m, die, { key = 'r1', hand = false, ghost = false } = {}) {
  m.layer.begin(key, { spec: { userId: 'u1', kind: 'mimic', color: '#ff0000', ghost }, edge: 1, area: AREA, dice: [die], hand });
  fly(m, die, 600 + CATCH.minFlight + 80, 0.4); // 25 units/s: tumbling fast
  fly(m, die, clockNow + DASH_MS[1] + 400, 0.04); // 2.5 units/s: slowing, caught
  return key;
}

describe('catch.js', () => {
  it('eligible: a visible, unborrowed d20 landing on 20 without a crit scene', () => {
    const die = (more) => ({ outer: { visible: true }, type: 'd20', value: 20, ghost: false, ...more });
    expect(eligible(die())).toBe(true);
    expect(eligible(die({ value: 19 }))).toBe(false);
    expect(eligible(die({ type: 'd12' }))).toBe(false);
    expect(eligible(die({ ghost: true }))).toBe(false);
    expect(eligible(die({ borrowed: true }))).toBe(false);
    expect(eligible(die({ outer: { visible: false } }))).toBe(false);
    expect(eligible(die({ fx: [{ effect: { id: 'scene-shadow-thief' } }] }))).toBe(false);
    expect(eligible(die({ fx: [{ effect: { id: 'celebrate' } }] }))).toBe(true);
  });

  it('slowing: after the minimum flight, once fast, when it drops under the slow speed', () => {
    const tracks = new Map();
    const die = { outer: { position: new THREE.Vector3() } };
    let t = 0;
    expect(slowing(tracks, die, t)).toBe(false);
    for (; t < CATCH.minFlight; t += 16) {
      die.outer.position.x += 0.3;
      expect(slowing(tracks, die, t + 16)).toBe(false);
    }
    die.outer.position.x += 0.01;
    expect(slowing(tracks, die, (t += 32))).toBe(true);
  });

  it('dashMs is clamped; spitPath keeps the die in the mouth first, then arcs it onto its rest', () => {
    expect(dashMs(0)).toBe(DASH_MS[0]);
    expect(dashMs(1000)).toBe(DASH_MS[1]);
    const mouth = new THREE.Vector3(0, 1, 0);
    const rest = new THREE.Vector3(2, 0.8, 0);
    expect(spitPath(0.1, mouth, rest, 0.9)).toBeNull();
    const mid = spitPath(0.6, mouth, rest, 0.9);
    expect(mid.position.y).toBeGreaterThan(1); // arcing up
    const end = spitPath(1, mouth, rest, 0.9);
    expect(end.position.distanceTo(rest)).toBeLessThan(1e-9);
    expect(end.turns).toBeCloseTo(0);
    expect(end.done).toBe(true);
  });
});

describe('the pet layer', () => {
  it('dashes to the slowing 20, gulps it (hidden, physics goes on), spits it back onto its rest, then celebrates', () => {
    const m = make();
    const die = d20(m.scene);
    const key = throwAndCatch(m, die);
    expect(die.outer.visible).toBe(false); // in its mouth
    expect(die.borrowed).toBe(true);
    expect(die.shadow.follow).not.toBe(die.follow);
    const pet = m.scene.children.find((c) => c.userData.dicerPet);
    expect(Math.hypot(pet.position.x - die.outer.position.x, pet.position.z - die.outer.position.z)).toBeLessThan(2.5);
    // it lands: the die is not moved in landed() (the effects fire right after, at its rest)
    const rest = die.outer.position.clone();
    const restQ = die.outer.quaternion.clone();
    m.layer.landed(key, [{ type: 'd20', value: 20, x: rest.x, z: rest.z }]);
    expect(die.outer.position.equals(rest)).toBe(true);
    const landed = clockNow;
    m.layer.update((clockNow += 16));
    expect(die.outer.visible).toBe(false); // drawing breath
    while (clockNow < landed + SPIT_MS * 0.3) m.layer.update((clockNow += 16));
    expect(die.outer.visible).toBe(true); // out it comes
    expect(die.outer.scale.x).toBe(1);
    while (clockNow < landed + SPIT_MS + 32) m.layer.update((clockNow += 16));
    expect(die.outer.position.distanceTo(rest)).toBeLessThan(1e-9);
    expect(die.outer.quaternion.angleTo(restQ)).toBeLessThan(1e-6);
    expect(die.shadow.follow).toBe(die.follow);
    expect(die.borrowed).toBe(false);
    expect(phaseOf(m)).toBe('react'); // its crit reaction, after the spit
  });

  it('no catch when the owner left it off, for a 19, a blind roll, a hand throw, reduced motion or short lingering', () => {
    const cases = [
      { m: { catches: false } },
      { value: 19 },
      { roll: { ghost: true } },
      { roll: { hand: true } },
      { m: { over: { reducedMotion: () => true } } },
      { m: { settings: { timeBeforeHide: 500 } } },
    ];
    for (const c of cases) {
      const m = make(c.m);
      const die = d20(m.scene, c.value ?? 20);
      throwAndCatch(m, die, c.roll);
      expect(die.outer.visible, JSON.stringify(c)).toBe(true);
      expect(die.borrowed, JSON.stringify(c)).toBeFalsy();
    }
  });

  it('the roll ending mid-catch, or the layer going away, gives the die back', () => {
    const m = make();
    const die = d20(m.scene);
    const key = throwAndCatch(m, die);
    expect(die.outer.visible).toBe(false);
    m.layer.end(key);
    expect(die.outer.visible).toBe(true);
    expect(die.outer.scale.x).toBe(1);
    expect(die.borrowed).toBe(false);
    const m2 = make();
    const die2 = d20(m2.scene);
    throwAndCatch(m2, die2);
    m2.layer.dispose();
    expect(die2.outer.visible).toBe(true);
    expect(die2.borrowed).toBe(false);
  });

  it('a die hitting the empty spot the pet left does not splat it', () => {
    const m = make({ settings: { petSplat: true } });
    const die = d20(m.scene);
    throwAndCatch(m, die);
    m.layer.hit('u1', { speed: 50, position: { x: 0, z: 0 }, die: { type: 'd20' } });
    m.layer.update((clockNow += 16));
    expect(phaseOf(m)).not.toBe('splat');
    expect(die.outer.visible).toBe(false); // still carrying it
  });
});

import * as THREE from 'three';
import { createMoods, MOOD_KEEP, MOOD_MIN } from '../../src/pet/chunk/moods.js';
import { createPetLayer, MOOD_MS, DIE_WIDTH, SCORCH_MS } from '../../src/pet/chunk/pets.js';
import { CREATURES } from '../../src/pet/chunk/creatures/index.js';

// ---- moods.js on its own ----
describe('createMoods', () => {
  const moodAfter = (values) => {
    const m = createMoods();
    m.record('u', values);
    return m.moodOf('u');
  };

  test('two 20s in three: proud; two 1s in three: sulk; both: neutral; one value: neutral', () => {
    expect(moodAfter([20, 20, 4])).toBe('proud');
    expect(moodAfter([1, 1, 18])).toBe('sulk');
    expect(moodAfter([20, 20, 1, 1, 10])).toBe('neutral');
    expect(moodAfter([20])).toBe('neutral');
    expect(moodAfter([20, 20])).toBe('neutral'); // fewer than MOOD_MIN
    expect(MOOD_MIN).toBe(3);
  });

  test('averages: 15.4 over 5 is proud, 6 or less is sulk, in between neutral', () => {
    expect(moodAfter([15, 16, 15, 16, 15])).toBe('proud'); // 77 / 5 = 15.4
    expect(moodAfter([14, 15, 15])).toBe('neutral'); // 14.67
    expect(moodAfter([6, 6, 6])).toBe('sulk');
    expect(moodAfter([7, 6, 6])).toBe('neutral'); // 6.33
  });

  test('keeps the last 5: a sixth value drops the oldest', () => {
    expect(MOOD_KEEP).toBe(5);
    const m = createMoods();
    m.record('u', [20, 20, 10, 10, 10]);
    expect(m.moodOf('u')).toBe('proud'); // two 20s
    m.record('u', [10]); // the first 20 goes
    expect(m.moodOf('u')).toBe('neutral'); // one 20, average 12
  });

  test('recorded one call at a time or several values at once (advantage): the same', () => {
    const m = createMoods();
    m.record('u', [20, 20]); // one roll with advantage: both dice
    m.record('u', [4]);
    expect(m.moodOf('u')).toBe('proud');
  });

  test('per user; non-numbers ignored; clear() forgets everything', () => {
    const m = createMoods();
    m.record('a', [20, 20, 20]);
    m.record('b', [1, 'x', null, NaN, 1, 1]);
    m.record(null, [20, 20, 20]);
    expect(m.moodOf('a')).toBe('proud');
    expect(m.moodOf('b')).toBe('sulk');
    expect(m.moodOf('c')).toBe('neutral');
    m.clear();
    expect(m.moodOf('a')).toBe('neutral');
    expect(m.moodOf('b')).toBe('neutral');
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
const AREA = { cx: 0, cz: 0, halfWidth: STAGE.halfWidth, halfDepth: STAGE.halfDepth };
let clockNow = 0;
const make = (settings = {}, over = {}) => {
  clockNow = 0;
  const all = { petStay: 60, petRestSpot: 'bottomRight', ...settings };
  const scene = new THREE.Scene();
  const timers = [];
  const deps = {
    scene,
    getSetting: (k) => all[k],
    playSound: vi.fn(),
    now: () => clockNow,
    wake: vi.fn(),
    win: new EventTarget(),
    random: () => 0.5,
    moods: createMoods(),
    reducedMotion: () => false,
    setTimer: vi.fn((fn, ms) => (timers.push({ fn, ms }), timers.length)),
    clearTimer: vi.fn(),
    ...over,
  };
  const layer = createPetLayer(deps);
  layer.areaChanged(STAGE);
  return { layer, scene, deps, settings: all, timers };
};
const runTo = (m, ms) => {
  let r;
  while (clockNow < ms) r = m.layer.update((clockNow += 16));
  return r;
};
const spec = (userId = 'u1', kind = 'mimic', ghost = false) => ({
  userId,
  kind,
  color: '#ff0000',
  ghost,
});
const d20s = (...values) => values.map((value) => ({ type: 'd20', value }));
/** A whole roll of `user`'s pet landing `dice`, run until the layer is idle again ('rest' or false). */
const roll = (m, dice, { user = 'u1', kind = 'mimic', ghost = false } = {}) => {
  const key = `k-${user}-${clockNow}`;
  m.layer.begin(key, {
    spec: spec(user, kind, ghost),
    edge: 0,
    area: AREA,
    centre: () => ({ x: 0, z: 0 }),
  });
  runTo(m, clockNow + 400);
  m.layer.landed(key, dice);
  runTo(m, clockNow + 2500);
  m.layer.leave(key, 0);
  m.layer.end(key);
  return runTo(m, clockNow + 1000 + MOOD_MS);
};
const group = (m, i = 0) => m.scene.children.filter((c) => c.userData.dicerPet)[i];
const phase = (m) => group(m).userData.dicerPet.phase;
const sparkle = (m) => group(m).children.find((c) => c.name === 'petSparkle');

describe('moods in the layer', () => {
  test('three good rolls: the resting pet settles into proud, with a twinkle, then holds it', () => {
    const m = make();
    roll(m, d20s(20));
    roll(m, d20s(20));
    expect(phase(m)).toBe('exit'); // two values: still neutral
    const key = 'k3';
    m.layer.begin(key, { spec: spec(), edge: 0, area: AREA, centre: () => ({ x: 0, z: 0 }) });
    runTo(m, clockNow + 400);
    m.layer.landed(key, d20s(12));
    runTo(m, clockNow + 2500);
    m.layer.leave(key, 0);
    m.layer.end(key);
    // to its rest spot, then the settle
    let seen = false;
    let lit = false;
    for (let i = 0; i < 200 && !seen; i++) {
      m.layer.update((clockNow += 16));
      seen = phase(m) === 'proud';
    }
    expect(seen).toBe(true);
    for (let t = clockNow + MOOD_MS; clockNow < t;) {
      m.layer.update((clockNow += 16));
      if (sparkle(m).visible) lit = true;
    }
    expect(lit).toBe(true); // the twinkle showed while it settled
    m.layer.update((clockNow += 16));
    expect(phase(m)).toBe('proud');
    expect(sparkle(m).visible).toBe(false); // static after settling
  });

  test('Review Focus 5: a resting proud pet requests no frames once settled', () => {
    const m = make();
    for (let i = 0; i < 3; i++) roll(m, d20s(20));
    expect(phase(m)).toBe('proud');
    m.deps.wake.mockClear();
    const timers = m.timers.length;
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    expect(m.layer.update((clockNow += 5000))).toBe('rest');
    expect(m.deps.wake).not.toHaveBeenCalled();
    // the only timer is the idle leave (petStay), never a frame loop for the mood
    for (const t of m.timers.slice(timers)) expect(t.ms).toBeGreaterThan(MOOD_MS * 10);
    expect(phase(m)).toBe('proud');
  });

  test('a resting sulking pet: sulk, and no frames once settled', () => {
    const m = make();
    for (let i = 0; i < 3; i++) roll(m, d20s(1), { kind: 'slime' });
    expect(phase(m)).toBe('sulk');
    expect(m.layer.update((clockNow += 16))).toBe('rest');
  });

  test('advantage: both d20s count', () => {
    const m = make();
    roll(m, d20s(20, 20)); // two values
    roll(m, d20s(3));
    expect(m.deps.moods.moodOf('u1')).toBe('proud');
    expect(phase(m)).toBe('proud');
  });

  test('Review Focus 3: a ghost roll is never recorded, nor a ghost die in a visible roll', () => {
    const m = make();
    for (let i = 0; i < 3; i++) roll(m, d20s(20, 20), { ghost: true });
    expect(m.deps.moods.moodOf('u1')).toBe('neutral');
    expect(phase(m)).toBe('exit');
    // ghost dice (DiceBox sends them valueless, but even a value must not count)
    for (let i = 0; i < 3; i++)
      roll(m, [
        { type: 'd20', value: 20, ghost: true },
        { type: 'd20', ghost: true },
      ]);
    expect(m.deps.moods.moodOf('u1')).toBe('neutral');
    // a keyless landing (a roller with no pet) records nothing for anyone
    m.layer.landed(null, d20s(20, 20, 20));
    expect(m.deps.moods.moodOf('u1')).toBe('neutral');
  });

  test('only d20s count; a roll landing twice counts once', () => {
    const m = make();
    const key = 'once';
    m.layer.begin(key, { spec: spec(), edge: 0, area: AREA, centre: () => ({ x: 0, z: 0 }) });
    m.layer.landed(key, [
      { type: 'd6', value: 1 },
      { type: 'd20', value: 20 },
      { type: 'd100', value: 1 },
    ]);
    m.layer.landed(key, d20s(20, 20));
    m.deps.moods.record('u1', [20]);
    expect(m.deps.moods.moodOf('u1')).toBe('neutral'); // two values: the 20 and the extra one
  });

  test("petMoods off: a proud owner's resting pet stands neutral", () => {
    const m = make({ petMoods: false });
    for (let i = 0; i < 3; i++) roll(m, d20s(20));
    expect(m.deps.moods.moodOf('u1')).toBe('proud'); // the history is still kept
    expect(phase(m)).toBe('exit');
    expect(m.layer.update((clockNow += 16))).toBe('rest');
  });

  test('history survives the pet leaving (and a rebuilt layer): its next rest is proud again', () => {
    const moods = createMoods();
    const m = make({ petStay: 0 }, { moods });
    for (let i = 0; i < 3; i++) expect(roll(m, d20s(20))).toBe(false); // no resting: gone each time
    expect(moods.moodOf('u1')).toBe('proud');
    m.layer.dispose();
    const n = make({}, { moods });
    roll(n, d20s(10)); // [20, 20, 20, 10]: still proud
    expect(phase(n)).toBe('proud');
  });

  test("a roll whose pet found no room still counts toward its owner's mood", () => {
    const m = make();
    for (const u of ['a', 'b', 'c']) roll(m, d20s(10), { user: u });
    // the cap is full of resting pets... make them all mid-roll so none can give its place up
    const keys = ['a', 'b', 'c'].map((u) => {
      const key = `busy-${u}`;
      m.layer.begin(key, { spec: spec(u), edge: 0, area: AREA, centre: () => ({ x: 0, z: 0 }) });
      return key;
    });
    m.layer.begin('d1', { spec: spec('d'), edge: 0, area: AREA, centre: () => ({ x: 0, z: 0 }) });
    m.layer.landed('d1', d20s(1, 1, 1));
    expect(m.scene.children.filter((c) => c.userData.dicerPet)).toHaveLength(3);
    expect(m.deps.moods.moodOf('d')).toBe('sulk');
    for (const k of keys) m.layer.end(k);
  });

  test('a reaction overrides the mood pose; the pet settles back into it at rest', () => {
    const m = make();
    for (let i = 0; i < 3; i++) roll(m, d20s(20));
    expect(phase(m)).toBe('proud');
    const g = group(m);
    m.layer.landed(null, [
      { type: 'd6', value: 3, x: g.position.x + DIE_WIDTH, z: g.position.z, damageType: 'fire' },
    ]);
    m.layer.update((clockNow += 16));
    expect(phase(m)).toBe('scorch');
    runTo(m, clockNow + SCORCH_MS + MOOD_MS + 100);
    expect(phase(m)).toBe('proud');
    expect(m.layer.update((clockNow += 16))).toBe('rest');
  });

  test('reduced motion: the proud twinkle swells and fades once per star, never flickering', () => {
    for (const calm of [false, true]) {
      const m = make({}, { reducedMotion: () => calm });
      for (let i = 0; i < 2; i++) roll(m, d20s(20));
      const key = 'k3';
      m.layer.begin(key, { spec: spec(), edge: 0, area: AREA, centre: () => ({ x: 0, z: 0 }) });
      runTo(m, clockNow + 400);
      m.layer.landed(key, d20s(20));
      // from the landing (the crit's burst is over by its rest) until well after it settles
      const series = [[], [], []];
      let proud = 0;
      let ended = false;
      for (let t = clockNow + 5000; clockNow < t;) {
        if (!ended && clockNow > t - 2000) {
          ended = true;
          m.layer.leave(key, 0);
          m.layer.end(key);
        }
        m.layer.update((clockNow += 4));
        const pts = sparkle(m);
        const col = pts.geometry.attributes.color;
        const mine = pts.visible && phase(m) === 'proud';
        if (mine) proud++;
        for (let i = 0; i < 3; i++) series[i].push(mine ? col.getX(i) : 0);
      }
      expect(proud).toBeGreaterThan(0);
      expect(phase(m)).toBe('proud');
      for (const s of series) {
        // rises to one peak, then falls: no second rise
        let peak = s.indexOf(Math.max(...s));
        expect(s[peak]).toBeGreaterThan(0.3);
        for (let i = 1; i <= peak; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1] - 1e-6);
        for (let i = peak + 1; i < s.length; i++) expect(s[i]).toBeLessThanOrEqual(s[i - 1] + 1e-6);
        if (calm) expect(Math.max(...s)).toBeLessThan(0.75); // dimmer when calm
      }
    }
  });
});

// ---- the creatures' mood poses ----
describe('mood poses', () => {
  const box = (c) => {
    c.root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(c.root);
  };
  const matrices = (c) => {
    c.root.updateMatrixWorld(true);
    const out = [];
    c.root.traverse((o) => out.push(...o.matrixWorld.elements));
    return out;
  };

  test('every kind: proud and sulk start on the standing pose and hold, static, from t 1', () => {
    for (const kind of Object.keys(CREATURES)) {
      const c = CREATURES[kind]('#3080c0');
      c.pose('exit', 1, 'plain', { yaw: 0, now: 0 });
      const stand = matrices(c);
      for (const mood of ['proud', 'sulk']) {
        c.pose(mood, 0, 'plain', { yaw: 0, now: 0 });
        const m0 = matrices(c);
        m0.forEach((v, i) => expect(v).toBeCloseTo(stand[i], 5));
        c.pose(mood, 1, 'plain', { yaw: 0, now: 0 });
        const a = matrices(c);
        c.pose(mood, 1, 'plain', { yaw: 0, now: 98765 }); // later: no idle motion
        const b = matrices(c);
        expect(b).toEqual(a);
        expect(a.some((v, i) => Math.abs(v - stand[i]) > 1e-3)).toBe(true); // it is a pose
      }
      c.dispose();
    }
  });

  test("sulk: the mimic's lid shut (it stands lower) and the slime flattened; proud stands taller", () => {
    for (const kind of ['mimic', 'slime', 'dragonling', 'owl', 'frog', 'ghost', 'mushroom', 'eye', 'golem', 'cat', 'fox', 'lantern', 'imp', 'robot', 'jester', 'raven', 'spider', 'skull', 'drone']) {
      const c = CREATURES[kind]('#3080c0');
      c.pose('exit', 1, 'plain', { yaw: 0, now: 0 });
      const stand = box(c).max.y;
      c.pose('sulk', 1, 'plain', { yaw: 0, now: 0 });
      const sulk = box(c).max.y;
      c.pose('proud', 1, 'plain', { yaw: 0, now: 0 });
      const proud = box(c).max.y;
      expect(sulk).toBeLessThan(stand * (kind === 'dragonling' ? 0.95 : 0.9)); // its horns and wings stay high
      if (kind !== 'mimic') expect(proud).toBeGreaterThan(stand); // the mimic's lid lifts less
      c.dispose();
    }
    const m = CREATURES.mimic('#3080c0');
    m.pose('sulk', 1, 'plain', { yaw: 0, now: 0 });
    expect(box(m).max.y).toBeLessThan(m.height * 1.05); // the closed chest's height: lid down
    m.dispose();
  });
});

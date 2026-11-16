import * as THREE from 'three';
import { createPetting, HUFF_HITS, HUFF_WINDOW_MS, HUFF_IGNORE_MS } from '../../src/pet/chunk/petting.js';
import { createPetLayer, PET_MS, HUFF_MS } from '../../src/pet/chunk/pets.js';
import { CREATURES } from '../../src/pet/chunk/creatures/index.js';
import { buildScene } from '../../src/render/scene.js';
import { KIND_FOOTPRINT } from '../../src/pet/chunk/resting.js';
import { REST_HOP_MS } from '../../src/pet/chunk/timeline.js';

/** A pointer event: cancelable, with a button and page coordinates. */
const ev = (type, x = 0, y = 0, button = 0) => {
  const e = new Event(type, { cancelable: true });
  Object.defineProperties(e, { button: { value: button }, clientX: { value: x }, clientY: { value: y } });
  return e;
};
/** Foundry's side: a listener added after Dicer's, which sees only what Dicer lets through. */
const foundry = (win) => {
  const got = [];
  for (const t of ['pointerdown', 'pointerup', 'click']) win.addEventListener(t, (e) => got.push(t + ':' + e.defaultPrevented));
  return got;
};
/** A full left click at (x, y): pointerdown, pointerup, click. */
const clickAt = (win, x, y, button = 0) => {
  const es = [ev('pointerdown', x, y, button), ev('pointerup', x, y, button), ev('click', x, y, button)];
  for (const e of es) win.dispatchEvent(e);
  return es;
};

// ---- petting.js on its own ----
describe('createPetting', () => {
  const PET = { id: 'p' };
  const setup = (over = {}) => {
    const win = new EventTarget();
    let t = 0;
    const settings = { petClick: true };
    const onPet = vi.fn();
    const onHuff = vi.fn();
    const p = createPetting({
      win,
      pickPet: (x, y) => (Math.hypot(x - 100, y - 100) <= 30 ? PET : null),
      onPet,
      onHuff,
      now: () => t,
      setting: (k) => settings[k],
      ...over,
    });
    const got = foundry(win);
    return { win, p, onPet, onHuff, got, settings, tick: (ms) => (t += ms) };
  };

  test('a left click on a pet: onPet, and pointerdown, pointerup and click all stopped', () => {
    const m = setup();
    const es = clickAt(m.win, 100, 100);
    expect(m.onPet).toHaveBeenCalledWith(PET);
    expect(m.got).toEqual([]); // Foundry saw none of the three
    expect(es.every((e) => e.defaultPrevented)).toBe(true);
  });

  test('a miss, another button or petClick off: untouched', () => {
    const m = setup();
    clickAt(m.win, 200, 100);
    clickAt(m.win, 100, 100, 2);
    m.settings.petClick = false;
    clickAt(m.win, 100, 100);
    expect(m.onPet).not.toHaveBeenCalled();
    expect(m.got).toEqual(Array(3).fill(['pointerdown:false', 'pointerup:false', 'click:false']).flat());
  });

  test('a click after a pet click is not swallowed (the claim ends with its own click)', () => {
    const m = setup();
    clickAt(m.win, 100, 100);
    clickAt(m.win, 300, 300);
    expect(m.got).toEqual(['pointerdown:false', 'pointerup:false', 'click:false']);
  });

  test(`${HUFF_HITS} hits within ${HUFF_WINDOW_MS} ms: onHuff once, then clicks reach Foundry for ${HUFF_IGNORE_MS} ms`, () => {
    const m = setup();
    for (let i = 0; i < HUFF_HITS; i++) {
      clickAt(m.win, 100, 100);
      m.tick(500);
    }
    expect(m.onPet).toHaveBeenCalledTimes(HUFF_HITS - 1);
    expect(m.onHuff).toHaveBeenCalledTimes(1);
    expect(m.onHuff).toHaveBeenCalledWith(PET);
    expect(m.got).toEqual([]);
    m.tick(HUFF_IGNORE_MS - 1000); // still within the ignore window
    clickAt(m.win, 100, 100);
    expect(m.got).toEqual(['pointerdown:false', 'pointerup:false', 'click:false']);
    expect(m.onPet).toHaveBeenCalledTimes(HUFF_HITS - 1);
    m.tick(1000); // over
    clickAt(m.win, 100, 100);
    expect(m.onPet).toHaveBeenCalledTimes(HUFF_HITS);
    expect(m.onHuff).toHaveBeenCalledTimes(1);
  });

  test('hits spread wider than the window never huff', () => {
    const m = setup();
    for (let i = 0; i < 12; i++) {
      clickAt(m.win, 100, 100);
      m.tick(HUFF_WINDOW_MS / (HUFF_HITS - 1) + 10);
    }
    expect(m.onHuff).not.toHaveBeenCalled();
    expect(m.onPet).toHaveBeenCalledTimes(12);
  });

  test('dispose() removes the listeners', () => {
    const m = setup();
    m.p.dispose();
    clickAt(m.win, 100, 100);
    expect(m.onPet).not.toHaveBeenCalled();
    expect(m.got).toHaveLength(3);
  });
});

// ---- the pet layer: hit-testing real pets and their poses ----
const PX = 48;
const STAGE = { cx: 0, cz: 0, halfWidth: 640 / PX, halfDepth: 400 / PX, rect: { left: 0, top: 0, width: 1280, height: 800 } };
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
const spec = (userId = 'u1', kind = 'mimic') => ({ userId, kind, color: '#ff0000' });
/** A whole roll of `user`'s pet, to its rest at its petRestSpot. */
const rollToRest = (m, user = 'u1', kind = 'mimic') => {
  const key = `k-${user}-${clockNow}`;
  const area = { cx: 0, cz: 0, halfWidth: STAGE.halfWidth, halfDepth: STAGE.halfDepth };
  m.layer.begin(key, { spec: spec(user, kind), edge: 0, area, centre: () => ({ x: 0, z: 0 }) });
  runTo(m, clockNow + 400);
  m.layer.landed(key, [{ type: 'd20', value: 5 }]);
  runTo(m, clockNow + 2500);
  m.layer.leave(key, 0);
  m.layer.end(key);
  expect(runTo(m, clockNow + 1000)).toBe('rest');
};
const group = (m, i = 0) => m.scene.children.filter((c) => c.userData.dicerPet)[i];
/** Where the real camera draws the point half the pet's height up over its spot, in page px. */
const camera = (() => {
  const { camera: cam, fitArea } = buildScene();
  fitArea(STAGE);
  return cam;
})();
const screenOf = (g, up = 0.75) => {
  const v = new THREE.Vector3(g.position.x, up, g.position.z).project(camera);
  return { x: ((v.x + 1) / 2) * 1280, y: ((1 - v.y) / 2) * 800 };
};

describe('petting a pet in the layer', () => {
  test('a left click on a resting pet pets it: stopped, the pet wiggles, a chirp, the loop runs only for it', () => {
    const m = make();
    rollToRest(m);
    const got = foundry(m.win);
    const at = screenOf(group(m));
    m.deps.wake.mockClear();
    const es = clickAt(m.win, at.x, at.y);
    expect(got).toEqual([]);
    expect(es.every((e) => e.defaultPrevented)).toBe(true);
    expect(m.deps.wake).toHaveBeenCalled();
    expect(m.deps.playSound).toHaveBeenCalledWith({ builtin: 'petHappy' });
    expect(m.layer.update((clockNow += 16))).toBe(true);
    expect(group(m).userData.dicerPet.phase).toBe('pet');
    const hearts = group(m).children.find((c) => c.name === 'petSparkle');
    expect(hearts.visible).toBe(true);
    expect(runTo(m, clockNow + PET_MS - 50)).toBe(true);
    expect(group(m).userData.dicerPet.phase).toBe('pet');
    let frames = 0;
    while (m.layer.update((clockNow += 16)) === true) frames++;
    expect(frames).toBeLessThanOrEqual(5); // the wiggle ends on time, on the standing pose
    expect(group(m).userData.dicerPet.phase).toBe('exit');
    expect(m.layer.update((clockNow += 16))).toBe('rest'); // idle again
    expect(hearts.visible).toBe(false);
  });

  test('Review Focus 1: a click two footprints beside a resting pet reaches Foundry', () => {
    const m = make();
    rollToRest(m);
    const got = foundry(m.win);
    const at = screenOf(group(m));
    const off = 2 * KIND_FOOTPRINT.mimic * PX;
    for (const [dx, dy] of [
      [off, 0],
      [-off, 0],
      [0, off],
      [0, -off],
    ])
      clickAt(m.win, at.x + dx, at.y + dy);
    expect(got.every((s) => s.endsWith(':false'))).toBe(true);
    expect(got).toHaveLength(12);
    expect(m.deps.playSound).not.toHaveBeenCalled();
  });

  test('Review Focus 2: with petClick off a click right on the pet reaches Foundry', () => {
    const m = make({ petClick: false });
    rollToRest(m);
    const got = foundry(m.win);
    const at = screenOf(group(m));
    clickAt(m.win, at.x, at.y);
    expect(got).toEqual(['pointerdown:false', 'pointerup:false', 'click:false']);
    expect(m.layer.update((clockNow += 16))).toBe('rest');
  });

  test('a right click on the pet, or a pet that is hopping, is left alone', () => {
    const m = make();
    rollToRest(m);
    const got = foundry(m.win);
    let at = screenOf(group(m));
    clickAt(m.win, at.x, at.y, 2);
    expect(got).toHaveLength(3);
    // its owner rolls again: it hops out to watch, and is no longer resting
    const area = { cx: 0, cz: 0, halfWidth: STAGE.halfWidth, halfDepth: STAGE.halfDepth };
    m.layer.begin('again', { spec: spec(), edge: 0, area, centre: () => ({ x: 0, z: 0 }) });
    m.layer.update((clockNow += 16));
    at = screenOf(group(m));
    clickAt(m.win, at.x, at.y);
    expect(got).toHaveLength(6);
    expect(got.every((s) => s.endsWith(':false'))).toBe(true);
  });

  test('pets hidden: nothing is intercepted, and the listeners go', () => {
    const m = make();
    rollToRest(m);
    const remove = vi.spyOn(m.win, 'removeEventListener');
    m.settings.showPets = false;
    m.layer.update((clockNow += 16)); // the setting's onChange wakes the loop
    expect(remove).toHaveBeenCalledTimes(3);
  });

  test('dispose() removes the click listeners', () => {
    const m = make();
    rollToRest(m);
    const remove = vi.spyOn(m.win, 'removeEventListener');
    m.layer.dispose();
    expect(remove).toHaveBeenCalledTimes(3);
  });

  test('petSounds off: a silent pet', () => {
    const m = make({ petSounds: false });
    rollToRest(m);
    const at = screenOf(group(m));
    clickAt(m.win, at.x, at.y);
    expect(m.deps.playSound).not.toHaveBeenCalled();
  });

  test('5 clicks: it huffs, hops a short way off with its back turned, ignores clicks, then hops back', () => {
    const m = make();
    rollToRest(m);
    const got = foundry(m.win);
    const g = group(m);
    const home = { x: g.position.x, z: g.position.z };
    const yaw = g.rotation.y;
    let huffAt = 0;
    for (let i = 0; i < HUFF_HITS; i++) {
      const at = screenOf(g);
      huffAt = clockNow;
      clickAt(m.win, at.x, at.y);
      runTo(m, clockNow + 100);
    }
    expect(got).toEqual([]);
    expect(g.userData.dicerPet.phase).toBe('huff');
    runTo(m, clockNow + HUFF_MS + REST_HOP_MS + 100);
    expect(m.layer.update((clockNow += 16))).toBe('rest'); // it sits off, idle
    const away = Math.hypot(g.position.x - home.x, g.position.z - home.z);
    expect(away).toBeGreaterThan(0.5);
    expect(away).toBeLessThan(2 * 1.5 + 1e-6);
    expect(Math.abs(Math.cos(g.rotation.y - yaw) + 1)).toBeLessThan(1e-6); // its back to where it faced
    // clicks on it now reach Foundry
    const at = screenOf(g);
    clickAt(m.win, at.x, at.y);
    expect(got).toEqual(['pointerdown:false', 'pointerup:false', 'click:false']);
    // the idle timer wakes it when the ignore window is over: it hops home
    expect(runTo(m, huffAt + HUFF_IGNORE_MS - 50)).toBe('rest'); // not before the window is over
    expect(Math.hypot(g.position.x - home.x, g.position.z - home.z)).toBeCloseTo(away, 6);
    runTo(m, huffAt + HUFF_IGNORE_MS + REST_HOP_MS + 200);
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    expect(g.position.x).toBeCloseTo(home.x, 6);
    expect(g.position.z).toBeCloseTo(home.z, 6);
    expect(Math.cos(g.rotation.y - yaw)).toBeCloseTo(1, 6);
  });

  test('the huff timer only wakes the loop: no frames while it sits off', () => {
    const timers = [];
    const m = make({}, { setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearTimer: () => {} });
    rollToRest(m);
    const g = group(m);
    for (let i = 0; i < HUFF_HITS; i++) {
      const at = screenOf(g);
      clickAt(m.win, at.x, at.y);
    }
    runTo(m, clockNow + HUFF_MS + REST_HOP_MS + 100);
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    expect(timers.at(-1).ms).toBeLessThanOrEqual(HUFF_IGNORE_MS);
  });

  test('reduced motion: a smaller wiggle', () => {
    const tilt = (calm) => {
      const m = make({}, { reducedMotion: () => calm });
      rollToRest(m);
      const at = screenOf(group(m));
      clickAt(m.win, at.x, at.y);
      let most = 0;
      const root = group(m).children[0];
      while (clockNow < 9000 + PET_MS) {
        m.layer.update((clockNow += 16));
        root.traverse((o) => (most = Math.max(most, Math.abs(o.rotation.z))));
        if (group(m).userData.dicerPet.phase !== 'pet') break;
      }
      return most;
    };
    expect(tilt(true)).toBeLessThan(tilt(false));
  });
});

describe.each(['mimic', 'slime', 'dragonling'])('%s poses pet and huff', (kind) => {
  test('finite, and starting and ending on the standing pose', () => {
    const c = CREATURES[kind]('#3080ff');
    const snap = () => {
      c.root.updateMatrixWorld(true);
      const out = [];
      c.root.traverse((o) => out.push(...o.matrixWorld.elements));
      return out;
    };
    c.pose('exit', 1, 'plain', { yaw: 0, now: 0 });
    const stand = snap();
    for (const phase of ['pet', 'huff'])
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
          expect(Math.max(...m.map((v, i) => Math.abs(v - stand[i])))).toBeLessThan(0.08);
        }
      }
    c.dispose();
  });
});

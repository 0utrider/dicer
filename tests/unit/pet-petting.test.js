import * as THREE from 'three';
import { PET_MODELS } from '../../src/pet/chunk/creatures/index.js';
import { buildStandinPet } from '../helpers/standin-pet.js';
import { createPetting, petClickable, HUFF_HITS, HUFF_WINDOW_MS, HUFF_IGNORE_MS } from '../../src/pet/chunk/petting.js';
import { createPetLayer, PET_MS, HUFF_MS } from '../../src/pet/chunk/pets.js';
import { CREATURES } from '../../src/pet/chunk/creatures/index.js';
import { buildScene } from '../../src/render/scene.js';
import { KIND_FOOTPRINT } from '../../src/pet/chunk/resting.js';
import { REST_HOP_MS } from '../../src/pet/chunk/timeline.js';
import { createMoods } from '../../src/pet/chunk/moods.js';

/** The element a click lands on: Foundry's board canvas (the open table) unless said otherwise. */
const BOARD = { id: 'board' };
/** A pointer event: cancelable, with a button, page coordinates and the element it lands on. */
const ev = (type, x = 0, y = 0, button = 0, target = BOARD) => {
  const e = new Event(type, { cancelable: true });
  Object.defineProperties(e, {
    button: { value: button },
    clientX: { value: x },
    clientY: { value: y },
    target: { value: target },
  });
  return e;
};
/** Foundry's side: a listener added after Dicer's, which sees only what Dicer lets through. */
const foundry = (win) => {
  const got = [];
  for (const t of ['pointerdown', 'pointerup', 'click']) win.addEventListener(t, (e) => got.push(t + ':' + e.defaultPrevented));
  return got;
};
/** A full left click at (x, y): pointerdown, pointerup, click. */
const clickAt = (win, x, y, button = 0, target = BOARD) => {
  const es = ['pointerdown', 'pointerup', 'click'].map((t) => ev(t, x, y, button, target));
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
    moods: createMoods(), // each layer its own mood history (the page-wide one would carry over)
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
  m.deps.playSound.mockClear(); // the roll's own sounds (its oooh, its result): tests count what follows
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

describe('pets made from a model (PET_MODELS)', () => {
  const skinned = (g) => {
    let n = 0;
    g.traverse((o) => o.isSkinnedMesh && n++);
    return n;
  };
  afterEach(() => delete PET_MODELS.cat);
  test('a kind with a model is hidden while the model loads (never the code-built pet), then shows the model', async () => {
    PET_MODELS.cat = 'modules/dicer/assets/pets/cat.glb';
    let resolve;
    const loadPetModel = vi.fn(() => new Promise((r) => (resolve = r)));
    const m = make({}, { loadPetModel });
    rollToRest(m, 'u1', 'cat');
    await new Promise((r) => setTimeout(r, 0));
    expect(loadPetModel).toHaveBeenCalledWith('modules/dicer/assets/pets/cat.glb');
    expect(group(m).visible).toBe(false); // no flash of the code-built cat meanwhile
    resolve(buildStandinPet());
    await new Promise((r) => setTimeout(r, 0));
    expect(group(m).visible).toBe(true);
    expect(skinned(group(m))).toBe(2); // Body and Eyes
    expect(group(m).children[0].getObjectByName('cat')).toBeTruthy();
    expect(loadPetModel).toHaveBeenCalledTimes(1);
  });

  test("the layer loads every connected player's pet model at once, and preloadModel loads a picked one", async () => {
    PET_MODELS.cat = 'modules/dicer/assets/pets/cat.glb';
    PET_MODELS.owl = 'modules/dicer/assets/pets/owl.glb';
    const had = globalThis.game;
    globalThis.game = { users: [{ active: true, getFlag: () => ({ kind: 'cat' }) }, { active: false, getFlag: () => ({ kind: 'owl' }) }] };
    const loadPetModel = vi.fn(() => new Promise(() => {}));
    const m = make({}, { loadPetModel });
    await new Promise((r) => setTimeout(r, 0));
    expect(loadPetModel.mock.calls.map((c) => c[0])).toEqual(['modules/dicer/assets/pets/cat.glb']); // not the offline player's owl
    m.layer.preloadModel('owl');
    m.layer.preloadModel('owl');
    await new Promise((r) => setTimeout(r, 0));
    expect(loadPetModel).toHaveBeenCalledTimes(2);
    globalThis.game = had;
    delete PET_MODELS.owl;
  });

  test('a model that fails to load leaves the code-built pet', async () => {
    PET_MODELS.cat = 'broken.glb';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = make({}, { loadPetModel: () => Promise.reject(new Error('404')) });
    rollToRest(m, 'u1', 'cat');
    await new Promise((r) => setTimeout(r, 0));
    expect(skinned(group(m))).toBe(0);
    expect(group(m).visible).toBe(true); // the code-built pet shows after all
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('grabbing at dice flying past', () => {
  const die = (m) => {
    const d = new THREE.Group();
    d.userData.dicerDie = true;
    m.scene.add(d);
    return d;
  };
  test('a die flying past within reach makes a resting pet turn and grab at it, then not again until the cooldown', () => {
    const m = make();
    rollToRest(m, 'u1', 'frog');
    const g = group(m);
    const d = die(m);
    d.position.set(g.position.x + 1.9, 0.5, g.position.z); // a die-width away, not beside it: nothing
    m.layer.update((clockNow += 16));
    d.position.x -= 0.5;
    m.layer.update((clockNow += 16));
    expect(g.userData.dicerPet.phase).not.toBe('grab');
    m.deps.playSound.mockClear();
    d.position.set(g.position.x + 1.1, 0.5, g.position.z + 0.2); // right beside it, moving fast
    m.layer.update((clockNow += 16));
    d.position.x -= 0.4;
    m.layer.update((clockNow += 16));
    m.layer.update((clockNow += 16));
    expect(g.userData.dicerPet.phase).toBe('grab');
    expect(m.deps.playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petYip' }));
    runTo(m, clockNow + 900);
    expect(g.userData.dicerPet.phase).toBe('exit'); // back on its standing pose
    // still inside the cooldown: no second grab
    d.position.x += 0.4;
    m.layer.update((clockNow += 16));
    d.position.x -= 0.4;
    m.layer.update((clockNow += 16));
    expect(g.userData.dicerPet.phase).not.toBe('grab');
  });

  test('a die sitting still next to it is not grabbed', () => {
    const m = make();
    rollToRest(m, 'u1', 'cat');
    const g = group(m);
    const d = die(m);
    d.position.set(g.position.x + 1, 0.5, g.position.z);
    for (let i = 0; i < 5; i++) m.layer.update((clockNow += 16));
    expect(g.userData.dicerPet.phase).not.toBe('grab');
  });
});

describe('pet view (petView)', () => {
  const upOf = (o) => new THREE.Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
  test('angled and front lean the pet back toward the camera whatever way it faces; shadow stays flat', () => {
    for (const [view, a] of [['top', 0], ['angled', 0.7], ['front', 1.15]]) {
      const m = make({ petView: view });
      rollToRest(m);
      const g = group(m);
      g.updateMatrixWorld(true);
      const up = upOf(g.children[0]); // the creature
      expect(up.y).toBeCloseTo(Math.cos(a), 4);
      expect(up.z).toBeCloseTo(-Math.sin(a), 4); // its top tips up the screen (-Z)
      const shadow = g.children.find((c) => c.name === 'petShadow') ?? g.children.find((c) => c !== g.children[0] && c.isMesh);
      if (shadow) expect(upOf(shadow).y).toBeCloseTo(upOf(g).y, 4);
    }
  });

  test('a view change leans resting pets at once, and a click on the leaning pet still pets it', () => {
    const m = make({ petView: 'top' });
    rollToRest(m);
    m.settings.petView = 'front';
    m.layer.update((clockNow += 16));
    const g = group(m);
    g.updateMatrixWorld(true);
    expect(upOf(g.children[0]).z).toBeCloseTo(-Math.sin(1.15), 4);
    // drawn leaning back: its middle is up the screen from its spot
    const h = 1.5;
    const mid = new THREE.Vector3(0, h / 2, 0).applyQuaternion(g.children[0].getWorldQuaternion(new THREE.Quaternion()));
    const v = new THREE.Vector3(g.position.x + mid.x, mid.y, g.position.z + mid.z).project(camera);
    m.deps.playSound.mockClear();
    clickAt(m.win, ((v.x + 1) / 2) * 1280, ((1 - v.y) / 2) * 800);
    expect(m.deps.playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petPurr' }));
  });
});

describe('pet voice pitch', () => {
  test("a pet speaks at its kind's pitch times its owner's pick", () => {
    const flags = { u1: { pitch: 1.5 }, u2: {} };
    const m = make({}, { userOf: (id) => ({ getFlag: () => flags[id] }) });
    rollToRest(m, 'u1', 'golem');
    const at = screenOf(group(m));
    m.deps.playSound.mockClear();
    clickAt(m.win, at.x, at.y);
    expect(m.deps.playSound.mock.calls[0][0].rate).toBeCloseTo(0.7 * 1.5, 5);
    const n = make({}, { userOf: (id) => ({ getFlag: () => flags[id] }) });
    rollToRest(n, 'u2', 'slime');
    const at2 = screenOf(group(n));
    n.deps.playSound.mockClear();
    clickAt(n.win, at2.x, at2.y);
    expect(n.deps.playSound.mock.calls[0][0].rate).toBe(1);
  });
});

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
    expect(m.deps.playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petPurr' })); // a purring trill
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
    expect(remove).toHaveBeenCalledTimes(5);
    const got = foundry(m.win);
    const es = clickAt(m.win, screenOf(group(m)).x, screenOf(group(m)).y);
    expect(got).toEqual(['pointerdown:false', 'pointerup:false', 'click:false']);
    expect(es.some((e) => e.defaultPrevented)).toBe(false);
    expect(m.deps.playSound).not.toHaveBeenCalled();
  });

  test('a window, sheet or menu over a resting pet gets its clicks: nothing is intercepted', () => {
    const m = make();
    rollToRest(m);
    const got = foundry(m.win);
    const at = screenOf(group(m));
    // a button in an application window (z-index 100+, above the dice canvas), the context menu,
    // the hand-throw overlay, and a click with no element at all
    for (const target of [{ id: '', className: 'button' }, { id: 'context-menu' }, { id: '', className: 'dicer-hand-overlay' }, null])
      clickAt(m.win, at.x, at.y, 0, target);
    expect(got).toHaveLength(12);
    expect(got.every((s) => s.endsWith(':false'))).toBe(true);
    expect(m.deps.playSound).not.toHaveBeenCalled();
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    // Dicer's own canvas or layer count as the table
    for (const id of ['dicer-canvas', 'dicer-layer']) clickAt(m.win, at.x, at.y, 0, { id });
    expect(got).toHaveLength(12);
  });

  test('a click on the interface under the dice canvas (the player list, a module HUD bar) over a resting pet pets it', () => {
    const m = make();
    rollToRest(m);
    const got = foundry(m.win);
    const at = screenOf(group(m));
    // an element that matches none of the "above the dice" selectors: Foundry's interface (z 30)
    const ui = { id: 'players-active', closest: () => null };
    clickAt(m.win, at.x, at.y, 0, ui);
    expect(got).toEqual([]); // the pet's: Foundry never sees it
    expect(m.deps.playSound).toHaveBeenCalled();
  });

  test('petClickable: windows, dialogs and menus are above the dice; "Dice above windows" lifts the dice over windows only', () => {
    const el = (...matches) => ({ closest: (sel) => (sel.split(', ').some((s) => matches.includes(s)) ? {} : null) });
    expect(petClickable(el())).toBe(true); // the board or the interface under the canvas
    expect(petClickable(el('.application'))).toBe(false);
    expect(petClickable(el('.window-app'))).toBe(false);
    expect(petClickable(el('#context-menu'))).toBe(false);
    expect(petClickable(el('.application'), true)).toBe(true); // the dice drawn over windows
    expect(petClickable(el('.dicer-hand-overlay'), true)).toBe(false);
    expect(petClickable(el('#tooltip'), true)).toBe(false);
    expect(petClickable(null)).toBe(false);
    expect(petClickable({ id: 'board' })).toBe(false); // no DOM: only the table ids count
  });

  test('while dice are held for a hand throw, a pointerdown over a pet reaches the overlay', () => {
    let held = true;
    const m = make({}, { holding: () => held });
    held = false;
    rollToRest(m);
    held = true;
    const got = foundry(m.win);
    const at = screenOf(group(m));
    clickAt(m.win, at.x, at.y);
    expect(got).toEqual(['pointerdown:false', 'pointerup:false', 'click:false']);
    held = false;
    clickAt(m.win, at.x, at.y);
    expect(got).toHaveLength(3); // the same click, dice let go: the pet's
  });

  test('petting a pet mid-scorch or mid-shiver ends the smoke and the frost tint at once', () => {
    for (const damageType of ['fire', 'cold']) {
      const m = make();
      rollToRest(m);
      const g = group(m);
      const colours = [];
      g.traverse((o) => o.isMesh && colours.push(o.material.color.getHex()));
      m.layer.landed(null, [{ type: 'd6', value: 3, x: g.position.x, z: g.position.z, damageType }]);
      runTo(m, clockNow + 200); // mid-reaction: smoke up, or the tint on
      expect(g.userData.dicerPet.phase).toBe(damageType === 'fire' ? 'scorch' : 'shiver');
      const at = screenOf(g);
      clickAt(m.win, at.x, at.y);
      m.layer.update((clockNow += 16));
      expect(g.userData.dicerPet.phase).toBe('pet');
      const smoke = g.children.find((c) => c.name === 'petSmoke');
      expect(smoke?.visible ?? false).toBe(false);
      const now = [];
      g.traverse((o) => o.isMesh && now.push(o.material.color.getHex()));
      expect(now).toEqual(colours);
    }
  });

  test('petting a pet mid-cheer turns it back to where it faced', () => {
    const m = make();
    rollToRest(m);
    const g = group(m);
    const yaw = g.rotation.y;
    // someone with no pet rolls a natural 20 up the table: u1's pet turns to cheer
    m.layer.landed(null, [{ type: 'd20', value: 20, x: g.position.x, z: g.position.z - 5 }]); // straight up the screen
    runTo(m, clockNow + 300);
    expect(g.userData.dicerPet.phase).toBe('cheer');
    expect(Math.abs(Math.cos(g.rotation.y - yaw) - 1)).toBeGreaterThan(1e-3);
    const at = screenOf(g);
    clickAt(m.win, at.x, at.y);
    m.layer.update((clockNow += 16));
    expect(g.userData.dicerPet.phase).toBe('pet');
    expect(Math.cos(g.rotation.y - yaw)).toBeCloseTo(1, 6);
  });

  test('dispose() removes the click listeners', () => {
    const m = make();
    rollToRest(m);
    const remove = vi.spyOn(m.win, 'removeEventListener');
    m.layer.dispose();
    expect(remove).toHaveBeenCalledTimes(5);
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
    expect(m.deps.playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petHuff' })); // "hmph"
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

describe.each(['mimic', 'slime', 'dragonling', 'owl', 'frog', 'ghost', 'mushroom', 'eye', 'golem', 'cat', 'fox', 'lantern', 'imp', 'robot', 'jester'])('%s poses pet and huff', (kind) => {
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

// ---- drag to place ----
/** A press at `from`, moves through `path`, and a release at the last point (or a cancel). */
const dragAlong = (win, from, path, { cancel = false } = {}) => {
  win.dispatchEvent(ev('pointerdown', from.x, from.y));
  for (const p of path) win.dispatchEvent(ev('pointermove', p.x, p.y));
  const end = path.at(-1) ?? from;
  if (cancel) win.dispatchEvent(ev('pointercancel', end.x, end.y));
  else {
    win.dispatchEvent(ev('pointerup', end.x, end.y));
    win.dispatchEvent(ev('click', end.x, end.y));
  }
};

describe('createPetting: a drag', () => {
  const PET = { id: 'p' };
  const setup = (over = {}) => {
    const win = new EventTarget();
    const calls = [];
    const p = createPetting({
      win,
      pickPet: (x, y) => (Math.hypot(x - 100, y - 100) <= 30 ? PET : null),
      onPet: () => calls.push('pet'),
      onHuff: () => calls.push('huff'),
      onDragStart: () => (calls.push('start'), true),
      onDrag: (pet, x, y) => calls.push(`drag ${x},${y}`),
      onDrop: (pet, x, y) => calls.push(`drop ${x},${y}`),
      setting: () => true,
      ...over,
    });
    const got = foundry(win);
    return { win, p, calls, got };
  };

  test('a press that moves past DRAG_PX drags: start, each move, drop where released; no pat, all stopped', () => {
    const m = setup();
    dragAlong(m.win, { x: 100, y: 100 }, [{ x: 102, y: 101 }, { x: 140, y: 100 }, { x: 300, y: 200 }]);
    expect(m.calls).toEqual(['start', 'drag 140,100', 'drag 300,200', 'drop 300,200']);
    expect(m.got).toEqual([]); // Foundry never saw the press
  });

  test('a press that stays within DRAG_PX is a pat', () => {
    const m = setup();
    dragAlong(m.win, { x: 100, y: 100 }, [{ x: 103, y: 102 }]);
    expect(m.calls).toEqual(['pet']);
  });

  test('a cancelled drag drops nowhere; pointer moves with no press are left alone', () => {
    const m = setup();
    dragAlong(m.win, { x: 100, y: 100 }, [{ x: 200, y: 100 }], { cancel: true });
    expect(m.calls).toEqual(['start', 'drag 200,100', 'drop null,null']);
    const e = ev('pointermove', 100, 100);
    m.win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  test('onDragStart false: the press is let go, no drag and no pat', () => {
    const m = setup({ onDragStart: () => false });
    dragAlong(m.win, { x: 100, y: 100 }, [{ x: 200, y: 100 }, { x: 250, y: 100 }]);
    expect(m.calls).toEqual([]);
  });
});

describe('dragging a pet in the layer', () => {
  const pageToTable = (p) => ({ x: (p.x - 640) / PX, z: (p.y - 400) / PX });

  test('dropped anywhere, it rests there: petRestSpot "placed" and petRestAt saved, and it stays after', async () => {
    const saved = {};
    const setSetting = vi.fn((k, v) => {
      saved[k] = v;
      return Promise.resolve(v);
    });
    const m = make({}, { setSetting });
    rollToRest(m);
    const from = screenOf(group(m));
    const to = { x: 400, y: 300 };
    dragAlong(m.win, from, [{ x: from.x + 20, y: from.y }, to]);
    expect(m.deps.playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petWhoa' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(saved.petRestSpot).toBe('placed');
    const want = pageToTable(to);
    expect(saved.petRestAt.x).toBeCloseTo(want.x / STAGE.halfWidth, 6);
    expect(saved.petRestAt.z).toBeCloseTo(want.z / STAGE.halfDepth, 6);
    Object.assign(m.settings, saved);
    expect(runTo(m, clockNow + 1500)).toBe('rest');
    const g = group(m);
    expect(g.position.x).toBeCloseTo(want.x, 6);
    expect(g.position.z).toBeCloseTo(want.z, 6);
    // its next roll brings it back to that spot
    rollToRest(m);
    expect(group(m).position.x).toBeCloseTo(want.x, 6);
  });

  test('while held it hangs under the pointer, lifted; a second pet stays where it rests', () => {
    const m = make({}, { setSetting: () => Promise.resolve() });
    rollToRest(m, 'u1');
    rollToRest(m, 'u2');
    const g1 = group(m, 0);
    const g2 = group(m, 1);
    const stay = { x: g2.position.x, z: g2.position.z };
    const from = screenOf(g1);
    m.win.dispatchEvent(ev('pointerdown', from.x, from.y));
    m.win.dispatchEvent(ev('pointermove', 500, 500));
    m.layer.update((clockNow += 16));
    expect(g1.position.x).toBeCloseTo(pageToTable({ x: 500, y: 500 }).x, 6);
    expect(g1.position.y).toBeGreaterThan(0);
    m.win.dispatchEvent(ev('pointerup', 500, 500));
    expect(runTo(m, clockNow + 1500)).toBe('rest');
    expect(g1.position.x).toBeCloseTo(pageToTable({ x: 500, y: 500 }).x, 6);
    expect(g2.position.x).toBeCloseTo(stay.x, 6);
    expect(g2.position.z).toBeCloseTo(stay.z, 6);
  });

  test('a pet arriving after a drop lines up beside the last dropped pet, never on it', () => {
    const m = make({}, { setSetting: () => Promise.resolve() });
    rollToRest(m, 'u1');
    const g1 = group(m, 0);
    dragAlong(m.win, screenOf(g1), [{ x: screenOf(g1).x + 20, y: screenOf(g1).y }, { x: 500, y: 500 }]);
    expect(runTo(m, clockNow + 1500)).toBe('rest');
    rollToRest(m, 'u2');
    const g2 = group(m, 1);
    expect(g2.position.z).toBeCloseTo(g1.position.z, 6);
    expect(Math.abs(g2.position.x - g1.position.x)).toBeGreaterThan(1);
  });

  test('each pet moves on its own: dropping the second leaves the first where it was put', async () => {
    const saved = {};
    const m = make({}, { setSetting: (k, v) => ((saved[k] = v), Promise.resolve()) });
    rollToRest(m, 'u1');
    rollToRest(m, 'u2');
    const g1 = group(m, 0);
    const g2 = group(m, 1);
    dragAlong(m.win, screenOf(g1), [{ x: screenOf(g1).x + 20, y: screenOf(g1).y }, { x: 300, y: 250 }]);
    expect(runTo(m, clockNow + 1500)).toBe('rest');
    const one = { x: g1.position.x, z: g1.position.z };
    dragAlong(m.win, screenOf(g2), [{ x: screenOf(g2).x + 20, y: screenOf(g2).y }, { x: 1000, y: 600 }]);
    expect(runTo(m, clockNow + 1500)).toBe('rest');
    expect(g1.position.x).toBeCloseTo(one.x, 6); // the first stayed put
    expect(g1.position.z).toBeCloseTo(one.z, 6);
    const two = pageToTable({ x: 1000, y: 600 });
    expect(g2.position.x).toBeCloseTo(two.x, 6);
    expect(g2.position.z).toBeCloseTo(two.z, 6);
    await Promise.resolve();
    await Promise.resolve();
    // both saved, each under its user
    expect(saved.petRestAt.pets.u1.x).toBeCloseTo(one.x / STAGE.halfWidth, 6);
    expect(saved.petRestAt.pets.u2.x).toBeCloseTo(two.x / STAGE.halfWidth, 6);
  });

  test('a pet dropped on another lands beside it, never inside it', () => {
    const m = make({}, { setSetting: () => Promise.resolve() });
    rollToRest(m, 'u1');
    rollToRest(m, 'u2');
    const g1 = group(m, 0);
    const g2 = group(m, 1);
    const onto = screenOf(g2);
    dragAlong(m.win, screenOf(g1), [{ x: screenOf(g1).x + 20, y: screenOf(g1).y }, onto]);
    expect(runTo(m, clockNow + 1500)).toBe('rest');
    const d = Math.hypot(g1.position.x - g2.position.x, g1.position.z - g2.position.z);
    expect(d).toBeGreaterThanOrEqual(2 * 1.5 - 1e-6); // SPACING x height apart
  });

  test('two saved spots on top of each other (from before): the pets still stand apart', () => {
    const at = { x: 0, z: 0, pets: { u1: { x: 0.1, z: 0.1 }, u2: { x: 0.1, z: 0.1 } } };
    const m = make({ petRestSpot: 'placed', petRestAt: at });
    rollToRest(m, 'u1');
    rollToRest(m, 'u2');
    const a = group(m, 0).position;
    const b = group(m, 1).position;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(2 * 1.5 - 1e-6);
  });

  test('after a reload, each pet rests at its own saved spot', () => {
    const at = { x: -0.6, z: 0.5, pets: { u1: { x: -0.6, z: 0.5 }, u2: { x: 0.5, z: -0.4 } } };
    const m = make({ petRestSpot: 'placed', petRestAt: at });
    rollToRest(m, 'u1');
    rollToRest(m, 'u2');
    expect(group(m, 0).position.x).toBeCloseTo(-0.6 * STAGE.halfWidth, 6);
    expect(group(m, 1).position.x).toBeCloseTo(0.5 * STAGE.halfWidth, 6);
    expect(group(m, 1).position.z).toBeCloseTo(-0.4 * STAGE.halfDepth, 6);
  });

  test("a 0.2 corner choice ('bottomRight') becomes a placed spot where its first slot was", async () => {
    const saved = {};
    const m = make({ petRestSpot: 'bottomRight' }, { setSetting: (k, v) => ((saved[k] = v), Promise.resolve()) });
    rollToRest(m);
    await Promise.resolve();
    await Promise.resolve();
    expect(saved.petRestSpot).toBe('placed');
    const g = group(m);
    expect(g.position.x).toBeCloseTo(saved.petRestAt.x * STAGE.halfWidth, 6);
    expect(g.position.z).toBeCloseTo(saved.petRestAt.z * STAGE.halfDepth, 6);
    expect(g.position.x).toBeGreaterThan(0); // still at the bottom right
    expect(g.position.z).toBeGreaterThan(0);
  });

  test("a placed pet watches its owner's next roll from its spot: it never leaves it", () => {
    const saved = {};
    const m = make({}, { setSetting: (k, v) => ((saved[k] = v), Promise.resolve()) });
    rollToRest(m);
    dragAlong(m.win, screenOf(group(m)), [{ x: 700, y: 300 }, { x: 300, y: 250 }]);
    expect(runTo(m, clockNow + 1500)).toBe('rest');
    const g = group(m);
    const home = { x: g.position.x, z: g.position.z };
    const key = `k-again-${clockNow}`;
    const area = { cx: 0, cz: 0, halfWidth: STAGE.halfWidth, halfDepth: STAGE.halfDepth };
    m.layer.begin(key, { spec: spec('u1'), edge: 0, area, centre: () => ({ x: 0, z: 0 }) });
    let far = 0;
    const track = (ms) => {
      while (clockNow < ms) {
        m.layer.update((clockNow += 16));
        far = Math.max(far, Math.hypot(g.position.x - home.x, g.position.z - home.z));
      }
    };
    track(clockNow + 400);
    m.layer.landed(key, [{ type: 'd20', value: 12 }]);
    track(clockNow + 2500);
    m.layer.leave(key, 0);
    m.layer.end(key);
    track(clockNow + 1500);
    expect(far).toBeLessThan(0.05);
    expect(g.position.x).toBeCloseTo(home.x, 6);
  });

  test('after a reload, a placed pet watches its first roll from its spot, not the roll area', () => {
    const at = { x: -0.6, z: 0.5 }; // saved earlier: petRestAt, in stage fractions
    const m = make({ petRestSpot: 'placed', petRestAt: at });
    const home = { x: at.x * STAGE.halfWidth, z: at.z * STAGE.halfDepth };
    const key = 'first';
    const area = { cx: 3, cz: -2, halfWidth: 2, halfDepth: 2 }; // a roll area (the tray) far from it
    const own = m.layer.obstaclesFor({ spec: spec('u1'), edge: 0, area }).find((o) => o.id === 'u1');
    m.layer.begin(key, { spec: spec('u1'), edge: 0, area, centre: () => ({ x: 3, z: -2 }) });
    let inTray = false;
    const track = (ms) => {
      while (clockNow < ms) {
        m.layer.update((clockNow += 16));
        const g = group(m);
        if (g && Math.abs(g.position.x - 3) < 2 && Math.abs(g.position.z + 2) < 2) inTray = true;
      }
    };
    track(400);
    m.layer.landed(key, [{ type: 'd20', value: 12 }]);
    track(clockNow + 2500);
    m.layer.leave(key, 0);
    m.layer.end(key);
    track(clockNow + 1500);
    expect(inTray).toBe(false); // it hops in to its spot, never into the tray
    expect(group(m).position.x).toBeCloseTo(home.x, 6);
    expect(group(m).position.z).toBeCloseTo(home.z, 6);
    if (own) expect(Math.hypot(own.x - home.x, own.z - home.z)).toBeLessThan(1e-6); // the physics knows too
  });

  test('a pet mid-hop, or any while a roll flies, is not picked up', () => {
    const m = make({ petRestSpot: 'dice' }, { setSetting: vi.fn(), activeRolls: () => 1 });
    rollToRest(m);
    const from = screenOf(group(m));
    dragAlong(m.win, from, [{ x: 600, y: 600 }]);
    expect(m.deps.setSetting).not.toHaveBeenCalled();
  });
});

// ---- looking at the cursor ----
describe('a resting pet looks at the cursor', () => {
  const pageToTable = (p) => ({ x: (p.x - 640) / PX, z: (p.y - 400) / PX });
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  test('the cursor moves: it turns to face it, then holds still (no frames) until it moves again', () => {
    const m = make();
    rollToRest(m);
    const g = group(m);
    const at = { x: 1250, y: 60 }; // up and to its side: well off where it faces now
    m.deps.wake.mockClear();
    const e = ev('pointermove', at.x, at.y);
    m.win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false); // Foundry still gets it
    expect(m.deps.wake).toHaveBeenCalledTimes(1);
    let frames = 0;
    while (m.layer.update((clockNow += 16)) === true) frames++;
    expect(frames).toBeGreaterThan(3); // it turns, not snaps
    expect(frames).toBeLessThan(200);
    const c = pageToTable(at);
    const want = Math.atan2(c.x - g.position.x, c.z - g.position.z);
    expect(Math.abs(wrapA(g.rotation.y - want))).toBeLessThan(0.02);
    m.deps.wake.mockClear();
    m.win.dispatchEvent(ev('pointermove', at.x, at.y)); // no new spot: nothing to do
    for (let i = 0; i < 20; i++) expect(m.layer.update((clockNow += 16))).toBe('rest');
  });

  test('a pet busy with a reaction, or a mood, does not turn; one a cursor sits right over does not spin', () => {
    const m = make();
    rollToRest(m);
    const g = group(m);
    const yaw = g.rotation.y;
    const over = screenOf(g, 0); // the cursor right on top of it
    m.win.dispatchEvent(ev('pointermove', over.x, over.y));
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    expect(g.rotation.y).toBe(yaw);
  });
});

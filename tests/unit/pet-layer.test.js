import * as THREE from 'three';
import { createPetLayer, SPLAT_SPEED, WOBBLE_SPEED, PUDDLE_LEAVE_MS, WALL_FLINCH_SPEED, WALL_REACH } from '../../src/pet/chunk/pets.js';
import { mulberry32 as mulberry } from '../../src/core/rng.js';
import { REST_HOP_MS } from '../../src/pet/chunk/timeline.js';
import { createMoods } from '../../src/pet/chunk/moods.js';
import { spotFor as restSpotFor } from '../../src/pet/chunk/rest-spots.js';

const AREA = { cx: 1, cz: -2, halfWidth: 6, halfDepth: 4 };
let clockNow = 0;
const make = (settings = {}, over = {}) => {
  settings.petStay ??= 0; // resting has its own tests below
  clockNow = 0;
  const scene = new THREE.Scene();
  const playSound = vi.fn();
  const warm = vi.fn();
  const deps = {
    scene,
    camera: new THREE.PerspectiveCamera(),
    getTier: () => ({ shadows: true }),
    getSetting: (k) => settings[k],
    playSound,
    warm,
    now: () => clockNow,
    wake: vi.fn(),
    moods: createMoods(), // each layer its own mood history (the page-wide one would carry over)
    ...over,
  };
  return { layer: createPetLayer(deps), scene, playSound, warm, settings, deps };
};
const spec = (userId = 'u1', ghost = false) => ({ userId, kind: 'mimic', color: '#ff0000', ghost });
const info = (edge = 0, s = spec()) => ({
  spec: s,
  edge,
  area: AREA,
  centre: () => ({ x: AREA.cx, z: AREA.cz }),
});
const pets = (scene) => scene.children.filter((c) => c.userData.dicerPet);
const d20 = (value, ghost) => ({ type: 'd20', value, ghost });

test('begin places the pet inside the named edge, outside the inner 60% of the area', () => {
  for (const edge of [0, 1, 2, 3]) {
    const { layer, scene } = make();
    layer.begin('k', info(edge));
    layer.update((clockNow = 0));
    layer.update((clockNow = 400)); // past the hop in: at its standing place
    const [p] = pets(scene);
    const dx = (p.position.x - AREA.cx) / AREA.halfWidth;
    const dz = (p.position.z - AREA.cz) / AREA.halfDepth;
    const along = edge < 2 ? dx : dz;
    const across = edge < 2 ? dz : dx;
    expect(Math.abs(across)).toBeLessThan(1e-6);
    expect(Math.abs(along)).toBeGreaterThan(0.6);
    expect(Math.abs(along)).toBeLessThan(1);
    expect(Math.sign(along)).toBe(edge % 2 === 0 ? 1 : -1);
    expect(p.position.y).toBe(0);
  }
});

test('same roller twice -> one pet; after both rolls end the layer holds 0 pets', () => {
  const { layer, scene } = make();
  layer.begin('a', info());
  layer.update((clockNow = 0));
  layer.begin('b', info());
  layer.update((clockNow = 100));
  expect(pets(scene)).toHaveLength(1);
  layer.end('a');
  expect(pets(scene)).toHaveLength(1);
  layer.end('b');
  expect(pets(scene)).toHaveLength(0);
  expect(layer.update((clockNow = 200))).toBe(false);
});

test('a re-used pet restarts from the throw, not the enter', () => {
  const { layer, scene } = make();
  layer.begin('a', info());
  layer.update((clockNow = 0));
  layer.update((clockNow = 5000));
  layer.begin('b', info());
  layer.update((clockNow = 5000));
  expect(pets(scene)[0].userData.dicerPet.phase).toBe('throw');
});

test('a fourth roller gets no pet', () => {
  const { layer, scene } = make();
  for (const u of ['u1', 'u2', 'u3', 'u4']) layer.begin(u, info(0, spec(u)));
  layer.update((clockNow = 0));
  expect(pets(scene)).toHaveLength(3);
  layer.landed('u4', [d20(20)]);
  layer.leave('u4', 0);
  layer.end('u4');
  expect(pets(scene)).toHaveLength(3);
});

const reactAndRun = (settings, dice, ghost = false) => {
  const m = make(settings);
  m.layer.begin('k', info(0, spec('u1', ghost)));
  m.layer.update((clockNow = 0));
  m.layer.landed('k', dice);
  m.layer.update((clockNow = 1000));
  m.layer.update((clockNow = 1100));
  return m;
};

test('crit plays petHappy, fumble petSad, mixed/plain silent', () => {
  expect(reactAndRun({}, [d20(20)]).playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petHappy' }));
  expect(reactAndRun({}, [d20(1)]).playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petSad' }));
  expect(reactAndRun({}, [d20(1), d20(20)]).playSound).not.toHaveBeenCalled();
  expect(reactAndRun({}, [{ type: 'd6', value: 6 }]).playSound).not.toHaveBeenCalled();
  expect(reactAndRun({}, [d20(20)]).playSound).toHaveBeenCalledTimes(1);
});

test('petSounds or sounds off, or a ghost roll -> silent', () => {
  expect(reactAndRun({ petSounds: false }, [d20(20)]).playSound).not.toHaveBeenCalled();
  expect(reactAndRun({ sounds: false }, [d20(20)]).playSound).not.toHaveBeenCalled();
  expect(reactAndRun({}, [d20(20)], true).playSound).not.toHaveBeenCalled();
});

const goneAt = (dice, ghost) => {
  const { layer } = make();
  layer.begin('k', info(0, spec('u1', ghost)));
  layer.update((clockNow = 0));
  layer.landed('k', dice);
  layer.update((clockNow = 1000));
  for (let t = 1000; t < 4000; t += 10) if (!layer.update((clockNow = t))) return t;
  return -1;
};

test("a ghost roll's reaction lasts exactly as long as a crit's", () => {
  const crit = goneAt([d20(20)], false);
  expect(crit).toBeGreaterThan(0);
  expect(goneAt([d20(20, true)], true)).toBe(crit);
  expect(goneAt([d20(20)], true)).toBe(crit);
  expect(goneAt([d20(1)], false)).toBe(crit);
});

test('update returns false once every pet is gone, and the scene is clean', () => {
  const { layer, scene } = make();
  layer.begin('k', info());
  expect(layer.update((clockNow = 0))).toBe(true);
  layer.landed('k', [d20(5)]);
  expect(layer.update((clockNow = 1000))).toBe(true);
  expect(layer.update((clockNow = 1000 + 1200 + 450))).toBe(false);
  expect(pets(scene)).toHaveLength(0);
});

test('leave(0) removes the pet at once', () => {
  const { layer, scene } = make();
  layer.begin('k', info());
  layer.update((clockNow = 0));
  layer.leave('k', 0);
  expect(layer.update((clockNow = 10))).toBe(false);
  expect(pets(scene)).toHaveLength(0);
});

test('shadow disc follows the shadows setting only', () => {
  const s = { shadows: true };
  const { layer, scene } = make(s, { getTier: () => ({ shadows: false }) });
  layer.begin('k', info());
  layer.update((clockNow = 0));
  const shadow = pets(scene)[0].getObjectByName('petShadow');
  expect(shadow.visible).toBe(true);
  s.shadows = false;
  layer.update((clockNow = 16));
  expect(shadow.visible).toBe(false);
});

test('warm gets the meshes of one creature of each kind, the shadow and the sparkle; kept until dispose', () => {
  const { layer, warm } = make();
  expect(warm).toHaveBeenCalledTimes(1);
  const objs = warm.mock.calls[0][0];
  expect(objs.length).toBeGreaterThan(6);
  expect(objs.every((o) => o.isMesh || o.isPoints)).toBe(true);
  expect(objs.some((o) => o.isMesh && o.name === 'petShadow' && o.material.map)).toBe(true);
  expect(objs.filter((o) => o.isPoints).map((o) => o.name).sort()).toEqual(['petSmoke', 'petSparkle']); // a scorch's smoke has RGBA colours: another program
  const mats = new Set(objs.flatMap((o) => (Array.isArray(o.material) ? o.material : [o.material])));
  let disposed = 0;
  for (const m of mats) m.addEventListener('dispose', () => disposed++);
  layer.begin('k', info());
  layer.update((clockNow = 0));
  layer.end('k');
  expect(disposed).toBe(0); // a pet coming and going leaves the warmed samples alone
  layer.dispose();
  expect(disposed).toBe(mats.size);
});

test('a rejecting or throwing warm is caught', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  make({}, { warm: () => Promise.reject(new Error('lost')) });
  expect(() => make({}, { warm: () => { throw new Error('x'); } })).not.toThrow();
  await new Promise((r) => setTimeout(r, 0));
  process.off('unhandledRejection', unhandled);
  expect(unhandled).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('a throwing pet is removed with one warning; others keep going', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { layer, scene } = make();
  layer.begin('a', info(0, spec('u1')));
  layer.begin('b', {
    ...info(1, spec('u2')),
    centre: () => {
      throw new Error('x');
    },
  });
  layer.update((clockNow = 0));
  expect(pets(scene)).toHaveLength(2);
  expect(() => layer.update((clockNow = 700))).not.toThrow();
  expect(pets(scene)).toHaveLength(1);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

test('dispose removes every pet immediately', () => {
  const { layer, scene } = make();
  layer.begin('a', info(0, spec('u1')));
  layer.begin('b', info(1, spec('u2')));
  layer.update((clockNow = 0));
  layer.dispose();
  expect(pets(scene)).toHaveLength(0);
});

test('leave(k, 400) at T: gone and out of the scene by T + 400', () => {
  for (const at of [100, 700, 1000, 1700, 1790, 1850]) {
    const { layer, scene } = make();
    layer.begin('k', info());
    layer.update((clockNow = 0));
    layer.landed('k', [d20(20)]);
    layer.update((clockNow = at - 16));
    clockNow = at;
    layer.leave('k', 400);
    expect(layer.update((clockNow = at + 399))).toBe(true);
    expect(layer.update((clockNow = at + 400))).toBe(false);
    expect(pets(scene)).toHaveLength(0);
  }
});

test('a leave mid-hop exits from where the pet is, without a jump', () => {
  const { layer, scene } = make();
  layer.begin('k', info());
  layer.update((clockNow = 0));
  layer.update((clockNow = 150));
  const p = pets(scene)[0];
  const before = p.position.clone();
  clockNow = 150;
  layer.leave('k', 400);
  layer.update((clockNow = 160));
  expect(p.position.distanceTo(before)).toBeLessThan(0.3);
});


describe('overlapping rolls by one roller (reaction per roll key)', () => {
  const phaseOf = (scene) => pets(scene)[0]?.userData.dicerPet.phase;
  const run = (m, from, to) => {
    for (let t = from; t <= to; t += 16) m.layer.update((clockNow = t));
  };

  test('an attack 20 landing while the damage roll is in flight: the crit plays once, when both landed', () => {
    const m = make();
    m.layer.begin('attack', info(0, spec('u1')));
    run(m, 0, 300);
    m.layer.begin('damage', info(0, spec('u1')));
    run(m, 300, 900);
    clockNow = 900;
    m.layer.landed('attack', [d20(20)]);
    run(m, 900, 1300);
    expect(phaseOf(m.scene)).toBe('watch'); // the damage dice still roll
    expect(m.playSound).not.toHaveBeenCalled();
    clockNow = 1300;
    m.layer.landed('damage', [{ type: 'd8', value: 3 }]);
    run(m, 1300, 4000);
    expect(m.playSound).toHaveBeenCalledTimes(1);
    expect(m.playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petHappy' }));
  });

  test('a multi-roll message: a 20 and a 1 in two rolls -> mixed (silent puzzlement)', () => {
    const m = make();
    m.layer.begin('r1', info(0, spec('u1')));
    m.layer.begin('r2', info(0, spec('u1')));
    run(m, 0, 700);
    m.layer.landed('r1', [d20(20)]);
    m.layer.landed('r2', [d20(1)]);
    run(m, 700, 1000);
    expect(phaseOf(m.scene)).toBe('react');
    expect(m.playSound).not.toHaveBeenCalled();
  });

  test('a ghost key and a real crit key -> crit, from the real key only', () => {
    const m = make();
    m.layer.begin('g', info(0, spec('u1', true)));
    m.layer.begin('r', info(0, spec('u1', false)));
    run(m, 0, 700);
    m.layer.landed('g', [d20(undefined, true)]);
    m.layer.landed('r', [d20(20)]);
    run(m, 700, 1000);
    expect(m.playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petHappy' }));
  });


  test("a ghost key's 20 never counts: ghost 20 + real plain -> plain, silent", () => {
    const m = make();
    m.layer.begin('g', info(0, spec('u1', true)));
    m.layer.begin('r', info(0, spec('u1', false)));
    run(m, 0, 700);
    m.layer.landed('g', [d20(20)]);
    m.layer.landed('r', [d20(7)]);
    run(m, 700, 1000);
    expect(phaseOf(m.scene)).toBe('react');
    expect(m.playSound).not.toHaveBeenCalled();
  });

  test('ghost-only overlapping rolls -> plain, silent, and exactly as long as a crit', () => {
    const goneAfter = (ghost, value) => {
      const m = make();
      m.layer.begin('a', info(0, spec('u1', ghost)));
      m.layer.begin('b', info(0, spec('u1', ghost)));
      run(m, 0, 700);
      clockNow = 700;
      m.layer.landed('a', [d20(value, ghost)]);
      m.layer.landed('b', [d20(value, ghost)]);
      for (let t = 700; t < 5000; t += 10) if (!m.layer.update((clockNow = t))) return [t, m.playSound];
      return [-1, m.playSound];
    };
    const [crit, critSound] = goneAfter(false, 20);
    const [ghost, ghostSound] = goneAfter(true, 20);
    expect(crit).toBeGreaterThan(0);
    expect(ghost).toBe(crit);
    expect(critSound).toHaveBeenCalledTimes(1);
    expect(ghostSound).not.toHaveBeenCalled();
  });

  test('a key that ends unlanded no longer holds the reaction back', () => {
    const m = make();
    m.layer.begin('a', info(0, spec('u1')));
    m.layer.begin('b', info(0, spec('u1')));
    run(m, 0, 700);
    m.layer.landed('a', [d20(20)]);
    m.layer.end('b');
    run(m, 700, 1000);
    expect(m.playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petHappy' }));
  });
});

test('a re-used pet whose kind or colour changed gets the new creature; the old one is disposed', () => {
  const { layer, scene } = make();
  layer.begin('a', info(0, { ...spec('u1'), kind: 'mimic' }));
  layer.update((clockNow = 0));
  const group = pets(scene)[0];
  const creatureRoot = () => group.children.find((c) => c.name !== 'petShadow' && !c.isPoints);
  const oldRoot = creatureRoot();
  const oldMats = [];
  oldRoot.traverse((o) => o.material && oldMats.push(o.material));
  let disposed = 0;
  for (const mat of new Set(oldMats)) mat.addEventListener('dispose', () => disposed++);
  layer.begin('b', info(0, { ...spec('u1'), kind: 'slime' }));
  layer.update((clockNow = 16));
  expect(pets(scene)).toHaveLength(1);
  expect(group.children).not.toContain(oldRoot);
  expect(disposed).toBe(new Set(oldMats).size);
  const slimeRoot = creatureRoot();
  expect(slimeRoot).toBeTruthy();
  expect(slimeRoot).not.toBe(oldRoot);
  layer.begin('c', info(0, { ...spec('u1'), kind: 'slime', color: '#00ff00' }));
  layer.update((clockNow = 32));
  expect(group.children).not.toContain(slimeRoot);
  // the same pick again keeps the creature
  const greenRoot = creatureRoot();
  layer.begin('d', info(0, { ...spec('u1'), kind: 'slime', color: '#00ff00' }));
  expect(creatureRoot()).toBe(greenRoot);
});

test('the shadows setting is read once per update, not per pet', () => {
  const getSetting = vi.fn(() => undefined);
  const { layer } = make({}, { getSetting });
  for (const u of ['u1', 'u2', 'u3']) layer.begin(u, info(0, spec(u)));
  layer.update((clockNow = 0));
  getSetting.mockClear();
  layer.update((clockNow = 16));
  expect(getSetting.mock.calls.filter(([k]) => k === 'shadows')).toHaveLength(1);
});

describe('a re-used pet hops to its new spot', () => {
  const maxStep = (layer, scene, from, to) => {
    const p = pets(scene)[0];
    let prev = p.position.clone();
    let max = 0;
    for (let t = from; t <= to; t += 16) {
      layer.update((clockNow = t));
      max = Math.max(max, p.position.distanceTo(prev));
      prev = p.position.clone();
    }
    return { max, end: p.position.clone() };
  };

  test('from another edge: no frame moves it more than a hop step, and it ends at the new spot', () => {
    const { layer, scene } = make();
    layer.begin('a', info(0));
    for (let t = 0; t <= 1000; t += 16) layer.update((clockNow = t));
    const start = pets(scene)[0].position.clone();
    clockNow = 1000;
    layer.begin('b', info(1));
    const { max, end } = maxStep(layer, scene, 1000, 2000);
    const travel = start.distanceTo(end);
    expect(travel).toBeGreaterThan(5);
    expect(max).toBeLessThan(travel / 8);
    expect(end.x).toBeLessThan(AREA.cx); // on edge 1 (-x)
  });

  test('mid-exit: it hops back from where it is', () => {
    const { layer, scene } = make();
    layer.begin('a', info(0));
    for (let t = 0; t <= 700; t += 16) layer.update((clockNow = t));
    clockNow = 700;
    layer.leave('a', 1000);
    for (let t = 700; t <= 1600; t += 16) layer.update((clockNow = t)); // well into the exit
    clockNow = 1600;
    layer.begin('b', info(0));
    const { max } = maxStep(layer, scene, 1600, 2600);
    expect(max).toBeLessThan(0.3);
  });

  test('standing at the same spot it still restarts from the throw (no re-enter)', () => {
    const { layer, scene } = make();
    layer.begin('a', info(0));
    for (let t = 0; t <= 1000; t += 16) layer.update((clockNow = t));
    layer.begin('b', info(0));
    layer.update((clockNow = 1008));
    expect(pets(scene)[0].userData.dicerPet.phase).toBe('throw');
  });
});

test('a pet whose roll never lands or leaves is force-exited after the lifetime cap', () => {
  const { layer, scene } = make();
  layer.begin('k', info());
  layer.update((clockNow = 0));
  expect(layer.update((clockNow = 14000))).toBe(true);
  expect(layer.update((clockNow = 15000))).toBe(false);
  expect(pets(scene)).toHaveLength(0);
});

describe('the crit sparkle burst', () => {
  const sparkleOf = (scene) => pets(scene)[0]?.children.find((c) => c.isPoints);
  const lit = (pts) => {
    let s = 0;
    for (const v of pts.geometry.getAttribute('color').array) s += v;
    return s;
  };

  test('shows at the start of a crit reaction, allocation-free, and is gone by its end', () => {
    const m = make();
    m.layer.begin('k', info());
    m.layer.update((clockNow = 0));
    m.layer.update((clockNow = 700));
    const pts = sparkleOf(m.scene);
    expect(pts).toBeTruthy();
    expect(pts.visible).toBe(false);
    const pos = pts.geometry.getAttribute('position').array;
    const col = pts.geometry.getAttribute('color').array;
    clockNow = 700;
    m.layer.landed('k', [d20(20)]);
    m.layer.update((clockNow = 800));
    expect(pts.visible).toBe(true);
    expect(lit(pts)).toBeGreaterThan(0);
    const v1 = pts.geometry.getAttribute('position').version;
    m.layer.update((clockNow = 900));
    expect(pts.geometry.getAttribute('position').version).toBeGreaterThan(v1);
    expect(pts.geometry.getAttribute('position').array).toBe(pos);
    expect(pts.geometry.getAttribute('color').array).toBe(col);
    for (const v of col) expect(v).toBeLessThanOrEqual(1);
    expect(pts.material.blending).toBe(THREE.AdditiveBlending);
    m.layer.update((clockNow = 700 + 1150));
    expect(pts.visible).toBe(false);
  });

  test('no burst for a plain, fumble, mixed or ghost reaction', () => {
    for (const [dice, ghost] of [
      [[d20(7)], false],
      [[d20(1)], false],
      [[d20(1), d20(20)], false],
      [[d20(20)], true],
    ]) {
      const m = make();
      m.layer.begin('k', info(0, spec('u1', ghost)));
      m.layer.update((clockNow = 0));
      m.layer.update((clockNow = 700));
      m.layer.landed('k', dice);
      m.layer.update((clockNow = 800));
      expect(sparkleOf(m.scene).visible).toBe(false);
    }
  });

  test('one shared sparkle material; each pet geometry is disposed with the pet', () => {
    const { layer, scene } = make();
    layer.begin('a', info(0, spec('u1')));
    layer.begin('b', info(1, spec('u2')));
    layer.update((clockNow = 0));
    const [p1, p2] = pets(scene).map((g) => g.children.find((c) => c.isPoints));
    expect(p1.material).toBe(p2.material);
    let geoDisposed = 0;
    let matDisposed = 0;
    p1.geometry.addEventListener('dispose', () => geoDisposed++);
    p1.material.addEventListener('dispose', () => matDisposed++);
    layer.end('a');
    expect(geoDisposed).toBe(1);
    expect(matDisposed).toBe(0);
    layer.dispose();
    expect(matDisposed).toBe(1);
  });
});

describe('a reaction plays once per roll', () => {
  const run = (m, from, to) => {
    for (let t = from; t <= to; t += 16) m.layer.update((clockNow = t));
  };
  const phaseOf = (scene) => pets(scene)[0]?.userData.dicerPet.phase;

  test('A crit reacted, then B begins and lands plain (A still on screen): B is plain, no second cheer', () => {
    const m = make();
    m.layer.begin('A', info(0, spec('u1')));
    run(m, 0, 700);
    clockNow = 700;
    m.layer.landed('A', [d20(20)]);
    run(m, 700, 1000);
    expect(m.playSound).toHaveBeenCalledTimes(1);
    clockNow = 1000;
    m.layer.begin('B', info(0, spec('u1')));
    run(m, 1000, 1700);
    clockNow = 1700;
    m.layer.landed('B', [d20(7)]);
    run(m, 1700, 2000);
    expect(phaseOf(m.scene)).toBe('react');
    expect(m.playSound).toHaveBeenCalledTimes(1);
    expect(pets(m.scene)[0].children.find((c) => c.isPoints).visible).toBe(false);
  });

  test('A crit reacted, then a ghost B (a blind roll) lands: plain and silent', () => {
    const m = make();
    m.layer.begin('A', info(0, spec('u1')));
    run(m, 0, 700);
    clockNow = 700;
    m.layer.landed('A', [d20(20)]);
    run(m, 700, 1000);
    m.playSound.mockClear();
    clockNow = 1000;
    m.layer.begin('B', info(0, spec('u1', true)));
    run(m, 1000, 1700);
    clockNow = 1700;
    m.layer.landed('B', [d20(undefined, true)]);
    run(m, 1700, 2000);
    expect(phaseOf(m.scene)).toBe('react');
    expect(m.playSound).not.toHaveBeenCalled();
    expect(pets(m.scene)[0].children.find((c) => c.isPoints).visible).toBe(false);
  });

  test('a consumed key still keeps the pet until its end', () => {
    const m = make();
    m.layer.begin('A', info(0, spec('u1')));
    m.layer.begin('B', info(0, spec('u1')));
    m.layer.landed('A', [d20(5)]);
    m.layer.landed('B', [d20(5)]);
    m.layer.end('B');
    expect(pets(m.scene)).toHaveLength(1);
    m.layer.end('A');
    expect(pets(m.scene)).toHaveLength(0);
  });
});

// ---- resting pets ----
const BIG = { cx: 0, cz: 0, halfWidth: 14, halfDepth: 9 };
const bigInfo = (s, edge = 0) => ({ spec: s, edge, area: BIG, centre: () => ({ x: 0, z: 0 }) });
const runTo = (m, ms) => {
  let r;
  while (clockNow < ms) r = m.layer.update((clockNow += 16));
  return r;
};
/** Runs a whole roll of `user`'s pet to its rest. */
const rollToRest = (m, user) => {
  const key = `k-${user}-${clockNow}`;
  m.layer.begin(key, bigInfo(spec(user)));
  m.layer.update(clockNow);
  runTo(m, clockNow + 400);
  m.layer.landed(key, [d20(5)]);
  const end = clockNow + 3000;
  let r;
  while (clockNow < end && r !== 'rest') r = m.layer.update((clockNow += 16));
  m.layer.leave(key, 0);
  m.layer.end(key);
  return key;
};
const at = (scene, i = 0) => pets(scene)[i].position;
const ids = (m) =>
  m.layer
    .obstaclesFor({ spec: null, edge: 0, area: BIG })
    .map((o) => o.id)
    .sort();

test("with petsStay a pet rests after its roll and update returns 'rest'", () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  expect(pets(m.scene)).toHaveLength(1);
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  const p = pets(m.scene)[0];
  const dx = Math.abs(p.position.x - BIG.cx);
  const dz = Math.abs(p.position.z - BIG.cz);
  expect(dx).toBeLessThanOrEqual(BIG.halfWidth - 1.8 + 1e-6);
  expect(dz).toBeLessThanOrEqual(BIG.halfDepth - 1.8 + 1e-6);
  const ring = Math.max(dx / BIG.halfWidth, dz / BIG.halfDepth);
  expect(ring).toBeGreaterThanOrEqual(0.35 - 1e-9);
  expect(ring).toBeLessThanOrEqual(0.6 + 1e-9);
  expect(p.position.y).toBe(0);
  // a resting pet is not posed again
  p.position.x = 99;
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  expect(p.position.x).toBe(99);
});

test("petsStay off keeps today's hop-off", () => {
  const m = make({ petStay: 0 });
  m.layer.begin('k', bigInfo(spec()));
  m.layer.update(clockNow);
  m.layer.landed('k', [d20(5)]);
  expect(runTo(m, 4000)).toBe(false);
  expect(pets(m.scene)).toHaveLength(0);
});

const ringOf = (p) => Math.max(Math.abs(p.x) / BIG.halfWidth, Math.abs(p.z) / BIG.halfDepth);
const outside = (p) => Math.abs(p.x) > BIG.halfWidth || Math.abs(p.z) > BIG.halfDepth;
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const inRing = (p) => {
  expect(ringOf(p)).toBeGreaterThanOrEqual(0.35 - 1e-9);
  expect(ringOf(p)).toBeLessThanOrEqual(0.6 + 1e-9);
};

test("the owner's roll is watched from the resting spot: no movement, the obstacle is that spot", () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  const rest = { x: at(m.scene).x, z: at(m.scene).z };
  const own = m.layer.obstaclesFor({ spec: spec('u1'), edge: 0, area: BIG });
  expect(own).toHaveLength(1);
  expect(own[0].id).toBe('u1');
  expect(own[0].x).toBeCloseTo(rest.x, 6);
  expect(own[0].z).toBeCloseTo(rest.z, 6);
  m.layer.begin('again', bigInfo(spec('u1'), 0));
  m.layer.update(clockNow);
  const seen = new Set();
  const start = clockNow;
  while (clockNow < start + 1500) {
    m.layer.update((clockNow += 16));
    expect(at(m.scene).x).toBeCloseTo(rest.x, 6);
    expect(at(m.scene).z).toBeCloseTo(rest.z, 6);
    expect(at(m.scene).y).toBe(0);
    seen.add(phaseOf(m));
  }
  expect(seen.has('throw')).toBe(true);
  expect(seen.has('watch')).toBe(true);
  expect(seen.has('enter')).toBe(false);
  // it has turned toward the dice (the middle of BIG)
  const want = Math.atan2(0 - rest.x, 0 - rest.z);
  expect(Math.abs(wrapA(pets(m.scene)[0].rotation.y - want))).toBeLessThan(0.1);
  m.layer.landed('again', [d20(5)]);
  m.layer.leave('again', 0);
  m.layer.end('again');
  expect(runTo(m, clockNow + 3000)).toBe('rest');
  expect(at(m.scene).x).toBeCloseTo(rest.x, 6); // still at the same spot
  expect(at(m.scene).z).toBeCloseTo(rest.z, 6);
  expect(at(m.scene).y).toBe(0);
  expect(m.layer.obstaclesFor({ spec: null, edge: 0, area: BIG })[0].x).toBeCloseTo(rest.x, 6);
});

test('a first appearance hops in from outside the edge to a rest spot, and the obstacle sent is that spot', () => {
  const m = make({ petStay: 60 }, { random: mulberry(11) });
  const sent = m.layer.obstaclesFor({ spec: spec('u1'), edge: 0, area: BIG });
  expect(sent).toHaveLength(1);
  const spot = { x: sent[0].x, z: sent[0].z };
  inRing(spot);
  // asking again changes nothing
  const again = m.layer.obstaclesFor({ spec: spec('u1'), edge: 0, area: BIG });
  expect(again[0].x).toBe(spot.x);
  expect(again[0].z).toBe(spot.z);
  m.layer.begin('k', bigInfo(spec('u1'), 0));
  m.layer.update(clockNow);
  expect(outside(at(m.scene))).toBe(true); // it starts just outside the area
  runTo(m, clockNow + 400);
  expect(at(m.scene).x).toBeCloseTo(spot.x, 6);
  expect(at(m.scene).z).toBeCloseTo(spot.z, 6);
  m.layer.landed('k', [d20(5)]);
  m.layer.leave('k', 0);
  m.layer.end('k');
  expect(runTo(m, clockNow + 3000)).toBe('rest');
  expect(at(m.scene).x).toBeCloseTo(spot.x, 6);
  expect(at(m.scene).z).toBeCloseTo(spot.z, 6);
});

test('a first appearance with no prior obstaclesFor still rests in the ring', () => {
  const m = make({ petStay: 60 }, { random: mulberry(12) });
  m.layer.begin('k', bigInfo(spec('u1'), 3));
  m.layer.update(clockNow);
  runTo(m, clockNow + 400);
  inRing(at(m.scene));
  const ob = m.layer.obstaclesFor({ spec: null, edge: 0, area: BIG })[0];
  expect(ob.x).toBeCloseTo(at(m.scene).x, 6);
});

test('petsStay off: the obstacle is the edge spot and the pet stands there', () => {
  const m = make({ petStay: 0 });
  const list = m.layer.obstaclesFor({ spec: spec('u1'), edge: 0, area: BIG });
  expect(list[0].x).toBeCloseTo(BIG.halfWidth - 0.9);
  expect(list[0].z).toBeCloseTo(0);
  m.layer.begin('k', bigInfo(spec('u1'), 0));
  m.layer.update(clockNow);
  runTo(m, clockNow + 400);
  expect(at(m.scene).x).toBeCloseTo(BIG.halfWidth - 0.9, 3);
});

test("obstaclesFor lists resting pets and the roller's upcoming rest spot", () => {
  const m = make({ petStay: 60 }, { random: mulberry(21) });
  rollToRest(m, 'u1');
  const rest = { x: at(m.scene).x, z: at(m.scene).z };
  const list = m.layer.obstaclesFor({ spec: spec('u2'), edge: 1, area: BIG });
  expect(list).toHaveLength(2);
  const resting = list.find((o) => o.id === 'u1');
  expect(resting.x).toBeCloseTo(rest.x, 6);
  expect(resting.z).toBeCloseTo(rest.z, 6);
  expect(resting.h).toBe(1.5);
  expect(resting.r).toBeCloseTo(0.95);
  const own = list.find((o) => o.id === 'u2');
  inRing(own);
  expect(Math.hypot(own.x - rest.x, own.z - rest.z)).toBeGreaterThanOrEqual(3 - 1e-9); // 2 x height apart
  // no spec: only the standing pets; the owner: its own rest spot replaces nothing else
  expect(m.layer.obstaclesFor({ spec: null, edge: 0, area: BIG })).toHaveLength(1);
  const mine = m.layer.obstaclesFor({ spec: spec('u1'), edge: 0, area: BIG });
  expect(mine).toHaveLength(1);
  expect(mine[0].x).toBeCloseTo(rest.x, 6);
  // a rolling pet is listed at the spot it rests at during its roll
  m.layer.begin('r', bigInfo(spec('u2'), 2));
  const rolling = m.layer.obstaclesFor({ spec: null, edge: 0, area: BIG }).find((o) => o.id === 'u2');
  expect(rolling.x).toBeCloseTo(own.x, 6);
  expect(rolling.z).toBeCloseTo(own.z, 6);
});

test('a 4th roller replaces the longest-idle resting pet, never one mid-routine; all 3 mid-routine -> no pet', () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  clockNow += 500;
  rollToRest(m, 'u2');
  m.layer.begin('r3', bigInfo(spec('u3'), 2)); // mid-routine
  m.layer.update(clockNow);
  m.layer.begin('r4', bigInfo(spec('u4'), 3)); // replaces u1, idle the longest
  m.layer.update(clockNow);
  runTo(m, clockNow + 600);
  expect(pets(m.scene)).toHaveLength(3);
  expect(ids(m)).toEqual(['u2', 'u3', 'u4']);
  m.layer.begin('r5', bigInfo(spec('u5'), 0)); // u2 is the only resting one: replaced
  runTo(m, clockNow + 600);
  expect(ids(m)).toEqual(['u3', 'u4', 'u5']);
  m.layer.begin('r6', bigInfo(spec('u6'), 0)); // all three mid-routine: no pet
  runTo(m, clockNow + 600);
  expect(pets(m.scene)).toHaveLength(3);
  expect(m.layer.obstaclesFor({ spec: spec('u6'), edge: 0, area: BIG }).map((o) => o.id)).not.toContain('u6');
  expect(ids(m)).toEqual(['u3', 'u4', 'u5']);
});

test('userGone hops that pet off and the layer ends empty', () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  m.deps.wake.mockClear();
  m.layer.userGone('u1');
  expect(m.deps.wake).toHaveBeenCalled();
  expect(ids(m)).toHaveLength(0);
  expect(runTo(m, clockNow + 1000)).toBe(false);
  expect(pets(m.scene)).toHaveLength(0);
  m.layer.userGone('nobody'); // harmless
});

test('areaChanged re-places resting pets validly', () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  rollToRest(m, 'u2');
  m.deps.wake.mockClear();
  const next = { cx: 0, cz: 0, halfWidth: 11, halfDepth: 7 };
  m.layer.areaChanged(next);
  expect(m.deps.wake).toHaveBeenCalled();
  expect(runTo(m, clockNow + 600)).toBe('rest');
  const ps = pets(m.scene);
  expect(ps).toHaveLength(2);
  for (const p of ps) {
    const dx = Math.abs(p.position.x);
    const dz = Math.abs(p.position.z);
    expect(dx).toBeLessThanOrEqual(next.halfWidth - 1.8 + 1e-6);
    expect(dz).toBeLessThanOrEqual(next.halfDepth - 1.8 + 1e-6);
    const ring = Math.max(dx / next.halfWidth, dz / next.halfDepth);
    expect(ring).toBeGreaterThanOrEqual(0.35 - 1e-9);
    expect(ring).toBeLessThanOrEqual(0.6 + 1e-9);
  }
  const gap = Math.hypot(ps[0].position.x - ps[1].position.x, ps[0].position.z - ps[1].position.z);
  expect(gap).toBeGreaterThanOrEqual(3 - 1e-6);
});

test('a stage smaller than the remembered roll area keeps the pet inside the stage', () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  m.layer.areaChanged({ cx: 0, cz: 0, halfWidth: 8, halfDepth: 6 });
  runTo(m, clockNow + 600);
  const p = at(m.scene);
  expect(Math.abs(p.x)).toBeLessThanOrEqual(8 - 1.8 + 1e-6);
  expect(Math.abs(p.z)).toBeLessThanOrEqual(6 - 1.8 + 1e-6);
});

test('petsStay switched off mid-rest -> all hop off, update false at the end', () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  rollToRest(m, 'u2');
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  m.settings.petStay = 0;
  expect(m.layer.update((clockNow += 16))).toBe(true);
  expect(runTo(m, clockNow + 1000)).toBe(false);
  expect(pets(m.scene)).toHaveLength(0);
});

test('petsAllowed or showPets off makes resting pets hop off too', () => {
  for (const key of ['petsAllowed', 'showPets']) {
    const m = make({ petStay: 60 });
    rollToRest(m, 'u1');
    m.settings[key] = false;
    expect(runTo(m, clockNow + 1000)).toBe(false);
  }
});

test('a pet whose user is gone mid-roll leaves instead of resting', () => {
  const m = make({ petStay: 60 });
  m.layer.begin('k', bigInfo(spec('u1')));
  m.layer.update(clockNow);
  m.layer.userGone('u1');
  m.layer.landed('k', [d20(5)]);
  expect(runTo(m, clockNow + 4000)).toBe(false);
});

test('a pet mid-routine when the stage shrinks rests inside the smaller stage', () => {
  const m = make({ petStay: 60 });
  m.layer.begin('k', bigInfo(spec('u1')));
  m.layer.update(clockNow);
  m.layer.areaChanged({ cx: 0, cz: 0, halfWidth: 8, halfDepth: 6 });
  m.layer.landed('k', [d20(5)]);
  let r;
  while (clockNow < 5000 && r !== 'rest') r = m.layer.update((clockNow += 16));
  expect(r).toBe('rest');
  const p = at(m.scene);
  expect(Math.abs(p.x)).toBeLessThanOrEqual(8 - 1.8 + 1e-6);
  expect(Math.abs(p.z)).toBeLessThanOrEqual(6 - 1.8 + 1e-6);
});

test('obstacle radii use each creature footprint; the mimic is at least 0.85', () => {
  const m = make({ petStay: 60 });
  expect(m.layer.obstaclesFor({ spec: spec('u1'), edge: 0, area: BIG })[0].r).toBeGreaterThanOrEqual(0.85);
  m.layer.begin('k', bigInfo(spec('u1')));
  const o = m.layer.obstaclesFor({ spec: null, edge: 0, area: BIG });
  expect(o[0].r).toBeGreaterThanOrEqual(0.85);
  expect(o[0].h).toBe(1.5);
});

// ---- hits, splats, puddles ----
const HARD = SPLAT_SPEED + 5;
const SOFT = (WOBBLE_SPEED + SPLAT_SPEED) / 2;
const phaseOf = (m, i = 0) => pets(m.scene)[i].userData.dicerPet.phase;
const hitFrom = (m, id, speed, dx = 1) => {
  const p = at(m.scene);
  m.layer.hit(id, { speed, position: { x: p.x + dx, y: 1, z: p.z }, dieKey: 'd0' });
};
const splatCalls = (m) => m.playSound.mock.calls.filter(([a]) => a.builtin === 'petSplat').length;
/** A pet at rest, then splatted into a puddle (the clock after the burst). */
const puddled = (settings = {}, user = 'u1') => {
  const m = make({ petStay: 60, ...settings });
  rollToRest(m, user);
  hitFrom(m, user, HARD);
  runTo(m, clockNow + 1300);
  return m;
};

test('a hard hit splats: one petSplat sound, then a puddle', () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  m.deps.wake.mockClear();
  hitFrom(m, 'u1', HARD);
  expect(m.deps.wake).toHaveBeenCalled();
  expect(m.layer.update((clockNow += 16))).toBe(true);
  expect(phaseOf(m)).toBe('splat');
  expect(splatCalls(m)).toBe(1);
  runTo(m, clockNow + 1300);
  expect(phaseOf(m)).toBe('puddle');
  expect(m.layer.update((clockNow += 16))).toBe('rest'); // a puddle costs nothing
  expect(splatCalls(m)).toBe(1);
  expect(pets(m.scene)[0].children[0].visible).toBe(false); // the creature is hidden
});

test('a soft hit wobbles: pushed away from the die, back at rest after WOBBLE_MS, no sound', () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  const rest = { x: at(m.scene).x, z: at(m.scene).z };
  hitFrom(m, 'u1', SOFT, 1); // the die is on the +x side
  let minX = Infinity;
  let r;
  for (let i = 0; i < 12; i++) {
    r = m.layer.update((clockNow += 16));
    minX = Math.min(minX, at(m.scene).x);
  }
  expect(r).toBe(true);
  expect(minX).toBeLessThan(rest.x - 0.01);
  runTo(m, clockNow + 500);
  expect(at(m.scene).x).toBeCloseTo(rest.x, 6);
  expect(at(m.scene).z).toBeCloseTo(rest.z, 6);
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  expect(phaseOf(m)).not.toBe('puddle');
  expect(splatCalls(m)).toBe(0);
});

test('a wobble restarts on a new hit; a hit below WOBBLE_SPEED does nothing', () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  hitFrom(m, 'u1', WOBBLE_SPEED / 2);
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  hitFrom(m, 'u1', SOFT);
  runTo(m, clockNow + 300);
  hitFrom(m, 'u1', SOFT); // restarts: still wobbling 300 ms later
  runTo(m, clockNow + 300);
  expect(m.layer.update((clockNow += 16))).toBe(true);
  runTo(m, clockNow + 300);
  expect(m.layer.update((clockNow += 16))).toBe('rest');
});

test('petSplat off -> wobble only, and no sound', () => {
  const m = make({ petStay: 60, petSplat: false });
  rollToRest(m, 'u1');
  hitFrom(m, 'u1', HARD);
  expect(m.layer.update((clockNow += 16))).toBe(true);
  runTo(m, clockNow + 900);
  expect(phaseOf(m)).not.toMatch(/splat|puddle/);
  expect(splatCalls(m)).toBe(0);
  expect(m.layer.update((clockNow += 16))).toBe('rest');
});

test('three hits in one frame -> one splat', () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  for (let i = 0; i < 3; i++) hitFrom(m, 'u1', HARD + i);
  m.layer.update((clockNow += 16));
  runTo(m, clockNow + 1300);
  expect(splatCalls(m)).toBe(1);
  expect(phaseOf(m)).toBe('puddle');
});

test('hits on a puddle, or on one that is splatting, are ignored; unknown ids are harmless', () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  hitFrom(m, 'u1', HARD);
  runTo(m, clockNow + 200);
  hitFrom(m, 'u1', HARD); // mid-burst
  runTo(m, clockNow + 1000);
  const pos = { ...at(m.scene) };
  hitFrom(m, 'u1', HARD);
  hitFrom(m, 'u1', SOFT);
  m.layer.hit('nobody', { speed: HARD, position: { x: 0, y: 0, z: 0 }, dieKey: 'x' });
  m.layer.hit('u1', { speed: NaN, position: { x: 0, y: 0, z: 0 }, dieKey: 'x' });
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  expect(at(m.scene).x).toBe(pos.x);
  expect(phaseOf(m)).toBe('puddle');
  expect(splatCalls(m)).toBe(1);
});

test('a splat mid-routine gives no reaction and no chirp', () => {
  const m = make({ petStay: 60 });
  m.layer.begin('k', bigInfo(spec('u1')));
  m.layer.update(clockNow);
  runTo(m, clockNow + 700); // watching
  hitFrom(m, 'u1', HARD, 0.5);
  m.layer.update((clockNow += 16));
  m.layer.landed('k', [d20(20)]); // would be a crit
  runTo(m, clockNow + 1500);
  m.layer.leave('k', 0);
  m.layer.end('k');
  runTo(m, clockNow + 1500);
  expect(m.playSound.mock.calls.map(([a]) => a.builtin)).toEqual(['petSplat']);
  expect(pets(m.scene)).toHaveLength(1);
  expect(phaseOf(m)).toBe('puddle');
});

test("the owner's next roll reforms the puddle in place and plays the routine", () => {
  const m = puddled();
  const spot = { x: at(m.scene).x, z: at(m.scene).z };
  m.layer.begin('again', bigInfo(spec('u1'), 0));
  m.layer.update(clockNow);
  expect(phaseOf(m)).toBe('reform');
  const start = clockNow;
  while (clockNow < start + 350) {
    m.layer.update((clockNow += 16));
    expect(phaseOf(m)).toBe('reform');
    expect(at(m.scene).x).toBeCloseTo(spot.x, 6); // in place
    expect(at(m.scene).z).toBeCloseTo(spot.z, 6);
  }
  const seen = new Set();
  while (clockNow < start + 1500) {
    m.layer.update((clockNow += 16));
    seen.add(phaseOf(m));
  }
  expect(seen.has('enter') || seen.has('throw')).toBe(true);
  expect(seen.has('watch')).toBe(true);
  expect(pets(m.scene)[0].children[0].visible).toBe(true);
  m.layer.landed('again', [d20(20)]);
  runTo(m, clockNow + 1400);
  expect(m.playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petHappy' }));
  m.layer.leave('again', 0);
  m.layer.end('again');
  expect(runTo(m, clockNow + 3000)).toBe('rest'); // rests again
});

test("a puddle owner's roll reforms in place, stays there, and its obstacle is the puddle spot", () => {
  const m = puddled();
  const spot = { x: at(m.scene).x, z: at(m.scene).z };
  const ob = m.layer.obstaclesFor({ spec: spec('u1'), edge: 0, area: BIG });
  expect(ob).toHaveLength(1);
  expect(ob[0].x).toBeCloseTo(spot.x, 6);
  expect(ob[0].z).toBeCloseTo(spot.z, 6);
  m.layer.begin('again', bigInfo(spec('u1'), 0));
  const start = clockNow;
  while (clockNow < start + 2000) {
    m.layer.update((clockNow += 16));
    expect(at(m.scene).x).toBeCloseTo(spot.x, 6);
    expect(at(m.scene).z).toBeCloseTo(spot.z, 6);
  }
  expect(phaseOf(m)).toBe('watch');
  m.layer.landed('again', [d20(5)]);
  m.layer.leave('again', 0);
  m.layer.end('again');
  expect(runTo(m, clockNow + 3000)).toBe('rest');
  expect(at(m.scene).x).toBeCloseTo(spot.x, 6);
  expect(at(m.scene).z).toBeCloseTo(spot.z, 6);
});

test('a puddle counts toward the cap and is not in obstaclesFor', () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  hitFrom(m, 'u1', HARD); // u1 is splatted at once, so idle the longest
  runTo(m, clockNow + 1300);
  // within the puddle's 5 s: two other rollers' pets arrive (still mid-routine)
  m.layer.begin('r2', bigInfo(spec('u2'), 0));
  m.layer.begin('r3', bigInfo(spec('u3'), 1));
  runTo(m, clockNow + 400);
  expect(pets(m.scene)).toHaveLength(3); // the puddle holds a place ...
  expect(ids(m)).not.toContain('u1'); // ... but stands in nobody's way
  m.layer.begin('r4', bigInfo(spec('u4'), 2)); // the 4th replaces the puddle, not a pet mid-routine
  runTo(m, clockNow + 900);
  expect(pets(m.scene)).toHaveLength(3);
  expect(ids(m)).toEqual(expect.arrayContaining(['u2', 'u3', 'u4']));
  expect(ids(m)).not.toContain('u1');
});

test('petsStay off with a puddle -> it fades and the layer ends empty', () => {
  const m = puddled();
  m.settings.petStay = 0;
  m.layer.update((clockNow += 16));
  expect(runTo(m, clockNow + 1000)).toBe(false);
  expect(pets(m.scene)).toHaveLength(0);
});

test('a puddle fades when its user leaves', () => {
  const m = puddled();
  m.layer.userGone('u1');
  expect(runTo(m, clockNow + 1000)).toBe(false);
  expect(pets(m.scene)).toHaveLength(0);
});

test("a roll that begins mid-burst reforms the puddle once the burst ends", () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  hitFrom(m, 'u1', HARD);
  runTo(m, clockNow + 200);
  m.layer.begin('again', bigInfo(spec('u1'), 0));
  expect(phaseOf(m)).toBe('splat');
  const seen = new Set();
  const end = clockNow + 1800;
  while (clockNow < end) {
    m.layer.update((clockNow += 16));
    seen.add(phaseOf(m));
  }
  expect([...seen]).toEqual(expect.arrayContaining(['splat', 'reform', 'watch']));
  expect(seen.has('puddle')).toBe(false);
  expect(splatCalls(m)).toBe(1);
});

test('a puddle is moved inside the smaller stage, and its old spot keeps nobody away', () => {
  const m = puddled();
  const next = { cx: 0, cz: 0, halfWidth: 8, halfDepth: 6 };
  m.deps.wake.mockClear();
  m.layer.areaChanged(next);
  expect(m.deps.wake).toHaveBeenCalled();
  m.layer.update((clockNow += 16)); // drawn at the new spot, then held
  const p = at(m.scene);
  expect(Math.abs(p.x)).toBeLessThanOrEqual(next.halfWidth - 1.8 + 1e-6);
  expect(Math.abs(p.z)).toBeLessThanOrEqual(next.halfDepth - 1.8 + 1e-6);
  expect(phaseOf(m)).toBe('puddle');
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  // a pet resting afterwards is spaced from the puddle's new spot, not its old one
  rollToRest(m, 'u2');
  const q = at(m.scene, 1);
  expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeGreaterThanOrEqual(3 - 1e-6);
});

test('a splat becoming a puddle after a stage change lands inside the new stage', () => {
  const m = make({ petStay: 60 });
  rollToRest(m, 'u1');
  hitFrom(m, 'u1', HARD);
  m.layer.update((clockNow += 16));
  const next = { cx: 0, cz: 0, halfWidth: 8, halfDepth: 6 };
  m.layer.areaChanged(next);
  runTo(m, clockNow + 1300);
  const p = at(m.scene);
  expect(phaseOf(m)).toBe('puddle');
  expect(Math.abs(p.x)).toBeLessThanOrEqual(next.halfWidth - 1.8 + 1e-6);
  expect(Math.abs(p.z)).toBeLessThanOrEqual(next.halfDepth - 1.8 + 1e-6);
});

// ---- final review fixes: the sim's splat speed, UI kept clear, area edits, unchanged resizes ----

test('splatSpeed is SPLAT_SPEED while petSplat is on, null when it is off', () => {
  const m = make({ petStay: 60 });
  expect(m.layer.splatSpeed).toBe(SPLAT_SPEED);
  m.settings.petSplat = false;
  expect(m.layer.splatSpeed).toBeNull();
  m.settings.petSplat = true;
  expect(m.layer.splatSpeed).toBe(SPLAT_SPEED);
});

test('areaChanged with an unchanged stage does not move resting pets or puddles', () => {
  const m = make({ petStay: 60 });
  const stage = { cx: 0, cz: 0, halfWidth: 14, halfDepth: 9 };
  m.layer.areaChanged(stage);
  rollToRest(m, 'u1');
  const before = { ...at(m.scene) };
  m.deps.wake.mockClear();
  m.layer.areaChanged({ ...stage }); // a resize event with the same size
  expect(m.deps.wake).not.toHaveBeenCalled();
  expect(runTo(m, clockNow + 600)).toBe('rest');
  expect(at(m.scene).x).toBe(before.x);
  expect(at(m.scene).z).toBe(before.z);
});

/** A fake document: getElementById answers px rects for the named ids. */
const fakeDoc = (rects) => ({
  getElementById: (id) =>
    rects[id] ? { getBoundingClientRect: () => ({ ...rects[id], right: rects[id].left + rects[id].width, bottom: rects[id].top + rects[id].height }) } : null,
});

test("resting pets keep off Foundry's UI (measured in px, turned into die units)", () => {
  // stage 1400 x 900 px at 50 px per die: 14 x 9 half units. The left 400 px and the bottom 250 px are UI.
  const rects = {
    'ui-left': { left: 0, top: 0, width: 400, height: 900 },
    hotbar: { left: 400, top: 650, width: 1000, height: 250 },
    navigation: { left: 0, top: 0, width: 0, height: 0 }, // hidden: ignored
  };
  for (let seed = 1; seed <= 20; seed++) {
    const r = mulberry(seed);
    const m = make({ petStay: 60 }, { doc: fakeDoc(rects), random: r });
    m.layer.areaChanged({ cx: 0, cz: 0, halfWidth: 14, halfDepth: 9, rect: { left: 0, top: 0, width: 1400, height: 900 } });
    rollToRest(m, 'u1');
    const p = at(m.scene);
    // the left UI ends at x = 400 px = -6 units; the hotbar starts at z = 650 px = +4 units
    expect(p.x > -6 + 0.9 || p.z < -9, `seed ${seed}`).toBe(true);
    expect(p.z < 4 - 0.9 || p.x < -6, `seed ${seed}`).toBe(true);
  }
});

test('an area edit re-places the resting pets whose owner area changed, and dispose stops listening', () => {
  const handlers = new Map();
  const hooks = {
    on: vi.fn((name, fn) => (handlers.set(name, fn), 7)),
    off: vi.fn((name) => handlers.delete(name)),
  };
  const areas = { u1: BIG, u2: BIG };
  const m = make({ petStay: 60 }, { hooks, areaOf: (id) => areas[id] });
  rollToRest(m, 'u1');
  rollToRest(m, 'u2');
  const u2 = { ...at(m.scene, 1) };
  // u1's area becomes the top-right corner of the stage
  const corner = { cx: 8, cz: -5, halfWidth: 6, halfDepth: 4 };
  areas.u1 = corner;
  m.deps.wake.mockClear();
  handlers.get('dicerRollAreasChanged')({});
  expect(m.deps.wake).toHaveBeenCalled();
  expect(runTo(m, clockNow + 600)).toBe('rest');
  const p = at(m.scene, 0);
  expect(Math.abs(p.x - corner.cx)).toBeLessThanOrEqual(corner.halfWidth);
  expect(Math.abs(p.z - corner.cz)).toBeLessThanOrEqual(corner.halfDepth);
  expect(at(m.scene, 1).x).toBe(u2.x); // u2's area did not change: it stays
  expect(at(m.scene, 1).z).toBe(u2.z);
  m.layer.dispose();
  expect(hooks.off).toHaveBeenCalledWith('dicerRollAreasChanged', 7);
});

test('an area edit moves a puddle into its owner new area', () => {
  const handlers = new Map();
  const hooks = { on: (name, fn) => (handlers.set(name, fn), 1), off: () => {} };
  const areas = { u1: BIG };
  const m = make({ petStay: 60 }, { hooks, areaOf: (id) => areas[id] });
  rollToRest(m, 'u1');
  hitFrom(m, 'u1', HARD);
  runTo(m, clockNow + 1300);
  expect(phaseOf(m)).toBe('puddle');
  const corner = { cx: -8, cz: 5, halfWidth: 6, halfDepth: 4 };
  areas.u1 = corner;
  handlers.get('dicerRollAreasChanged')({});
  m.layer.update((clockNow += 16));
  const p = at(m.scene);
  expect(phaseOf(m)).toBe('puddle');
  expect(Math.abs(p.x - corner.cx)).toBeLessThanOrEqual(corner.halfWidth);
  expect(Math.abs(p.z - corner.cz)).toBeLessThanOrEqual(corner.halfDepth);
});

// petStay: how long a resting pet or puddle stays after its owner's last roll.
const fakeTimers = () => {
  const list = [];
  return {
    list,
    live: () => list.filter((t) => t.live),
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      list.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.live = false;
    },
  };
};
const stayMake = (petStay, timers = fakeTimers()) => ({
  m: make({ petStay }, { setTimer: timers.setTimer, clearTimer: timers.clearTimer }),
  timers,
});

test('petStay 60: a resting pet leaves 60 s after its reaction; update false afterwards', () => {
  const { m } = stayMake(60);
  rollToRest(m, 'u1');
  const idle = clockNow;
  expect(runTo(m, idle + 58000)).toBe('rest');
  expect(pets(m.scene)).toHaveLength(1);
  expect(runTo(m, idle + 62000)).toBe(false);
  expect(pets(m.scene)).toHaveLength(0);
});

test.each([60, 120, -1])('a puddle fades 5 s after its splat (petStay %i)', (petStay) => {
  const m = puddled({ petStay }); // the splat was 1300 ms ago
  const splatAt = clockNow - 1300;
  expect(runTo(m, splatAt + PUDDLE_LEAVE_MS - 500)).toBe('rest');
  expect(pets(m.scene)).toHaveLength(1);
  expect(runTo(m, splatAt + PUDDLE_LEAVE_MS + 3000)).toBe(false);
  expect(pets(m.scene)).toHaveLength(0);
});

test('-1 never leaves', () => {
  const { m, timers } = stayMake(-1);
  rollToRest(m, 'u1');
  expect(runTo(m, clockNow + 20 * 60000)).toBe('rest');
  expect(pets(m.scene)).toHaveLength(1);
  expect(timers.live()).toHaveLength(0);
});

test('0 behaves like the old petsStay off', () => {
  const { m } = stayMake(0);
  rollToRest(m, 'u1');
  expect(runTo(m, clockNow + 1500)).toBe(false);
  expect(pets(m.scene)).toHaveLength(0);
});

test('a roll by the owner before the timer resets it', () => {
  const { m } = stayMake(60);
  rollToRest(m, 'u1');
  const t0 = clockNow;
  runTo(m, t0 + 50000);
  rollToRest(m, 'u1');
  const t1 = clockNow;
  expect(runTo(m, t0 + 70000)).toBe('rest'); // past the first deadline
  expect(pets(m.scene)).toHaveLength(1);
  expect(runTo(m, t1 + 62000)).toBe(false);
});

test('a pet that left on the timer returns as a first appearance on its next roll', () => {
  const { m } = stayMake(30);
  rollToRest(m, 'u1');
  expect(runTo(m, clockNow + 32000)).toBe(false);
  rollToRest(m, 'u1');
  expect(pets(m.scene)).toHaveLength(1);
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  // the physics sees it where it now rests (a fresh spot), not where it was before it left
  const [ob] = m.layer.obstaclesFor({ spec: null, edge: 0, area: BIG });
  expect(ob.id).toBe('u1');
  expect(ob.x).toBeCloseTo(at(m.scene).x, 6);
  expect(ob.z).toBeCloseTo(at(m.scene).z, 6);
  inRing(at(m.scene));
});

test('changing petStay mid-wait re-arms the timer', () => {
  const { m, timers } = stayMake(60);
  rollToRest(m, 'u1');
  const idle = clockNow;
  m.layer.update((clockNow += 16));
  const first = timers.live();
  expect(first).toHaveLength(1);
  expect(first[0].ms).toBeGreaterThan(50000);
  m.settings.petStay = 30;
  m.layer.update((clockNow += 16));
  const now = timers.live();
  expect(now).toHaveLength(1);
  expect(now[0]).not.toBe(first[0]);
  expect(first[0].live).toBe(false);
  expect(now[0].ms).toBeLessThanOrEqual(30000);
  expect(runTo(m, idle + 32000)).toBe(false);
});

test('dispose clears the timer (no wake after dispose)', () => {
  const { m, timers } = stayMake(60);
  rollToRest(m, 'u1');
  m.layer.update((clockNow += 16));
  expect(timers.live()).toHaveLength(1);
  m.layer.dispose();
  expect(timers.live()).toHaveLength(0);
  m.deps.wake.mockClear();
  for (const t of timers.list) if (t.live) t.fn();
  expect(m.deps.wake).not.toHaveBeenCalled();
});

test('the timer fires through a held loop (deps.wake called)', () => {
  const { m, timers } = stayMake(60);
  rollToRest(m, 'u1');
  const idle = clockNow;
  expect(m.layer.update((clockNow += 16))).toBe('rest'); // held: nothing redraws
  const [t] = timers.live();
  m.deps.wake.mockClear();
  clockNow = idle + 60000;
  t.fn();
  expect(m.deps.wake).toHaveBeenCalled();
  expect(m.layer.update(clockNow)).toBe(true); // the wake runs update: it hops off
  expect(runTo(m, clockNow + 1000)).toBe(false);
});

// ---- where pets rest (petRestSpot), with no dodging ----
const PX = 48; // px per die unit on the fake stage
const STAGE_BIG = {
  cx: 0,
  cz: 0,
  halfWidth: BIG.halfWidth,
  halfDepth: BIG.halfDepth,
  rect: { left: 0, top: 0, width: BIG.halfWidth * 2 * PX, height: BIG.halfDepth * 2 * PX },
};
const fakeWin = () => {
  const handlers = new Map();
  return {
    handlers,
    addEventListener: vi.fn((type, fn, opts) => handlers.set(type, { fn, opts })),
    removeEventListener: vi.fn((type, fn) => {
      if (handlers.get(type)?.fn === fn) handlers.delete(type);
    }),
  };
};
const posOf = (m, i = 0) => ({ x: at(m.scene, i).x, z: at(m.scene, i).z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const slotAt = (choice, k) => restSpotFor(choice, k, STAGE_BIG, 1.5, []);
const spotMake = (petRestSpot, over = {}) => {
  const rolls = { n: 0 };
  const timers = fakeTimers();
  const m = make(
    { petStay: 60, petRestSpot },
    { activeRolls: () => rolls.n, random: mulberry(5), setTimer: timers.setTimer, clearTimer: timers.clearTimer, ...over },
  );
  m.layer.areaChanged(STAGE_BIG);
  return { m, rolls, timers };
};
const near = (p, q) => {
  expect(p.x).toBeCloseTo(q.x, 6);
  expect(p.z).toBeCloseTo(q.z, 6);
};

test("dodging is gone: only petting's listeners on the window, and a resting pet never moves however long it sits", () => {
  // the global window (the layer's old default) is watched: the layer must not listen to it
  const win = fakeWin();
  vi.stubGlobal('window', win);
  try {
    const m = make({ petStay: -1 }, { activeRolls: () => 0, random: mulberry(5) });
    m.layer.areaChanged(STAGE_BIG);
    rollToRest(m, 'u1');
    const was = posOf(m);
    // only petting's listeners (pet-petting.test.js: a pat or a drag), never the old pointerout one
    const types = win.addEventListener.mock.calls.map((c) => c[0]);
    expect(types.every((t) => ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click'].includes(t))).toBe(true);
    m.deps.wake.mockClear();
    for (let i = 0; i < 200; i++) expect(m.layer.update((clockNow += 16))).toBe('rest');
    expect(posOf(m)).toEqual(was);
    expect(m.deps.wake).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("petRestSpot 'dice' (or unset) rests in the roll-area ring as before", () => {
  for (const choice of ['dice', undefined]) {
    const { m } = spotMake(choice);
    rollToRest(m, 'u1');
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    inRing(posOf(m));
  }
});

test("v14's mostly empty #ui-left / #ui-top boxes are not UI: a top-left pet rests at the top, clear of the widgets", () => {
  const W = STAGE_BIG.rect.width;
  const H = STAGE_BIG.rect.height;
  const rects = {
    // v14: the boxes span the left third and the top half; the widgets inside are small
    'ui-left': { left: 0, top: 0, width: W / 3, height: H },
    'ui-top': { left: W / 3, top: 0, width: W / 2, height: H / 2 },
    'scene-controls': { left: 0, top: 0, width: 2 * PX, height: H * 0.75 },
    players: { left: 0, top: H * 0.85, width: 2 * PX, height: H * 0.15 },
  };
  const { m } = spotMake('topLeft', { doc: fakeDoc(rects) });
  rollToRest(m, 'u1');
  const p = posOf(m);
  expect(p.z).toBeLessThan(0); // the top half
  expect(p.x).toBeLessThan(0); // the left half
  expect(p.x).toBeGreaterThan(-BIG.halfWidth + 2); // right of the controls column
});

test("petRestSpot 'bottomRight': pets rest at its slots in the order they arrive", () => {
  const { m } = spotMake('bottomRight');
  rollToRest(m, 'u1');
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  near(posOf(m, 0), slotAt('bottomRight', 0));
  near(m.layer.obstaclesFor({ spec: null, edge: 0, area: BIG }).find((o) => o.id === 'u1'), slotAt('bottomRight', 0));
  clockNow += 500;
  rollToRest(m, 'u3');
  clockNow += 500;
  rollToRest(m, 'u2');
  near(posOf(m, 1), slotAt('bottomRight', 1)); // u3 came second
  near(posOf(m, 2), slotAt('bottomRight', 2));
  expect(m.layer.update((clockNow += 16))).toBe('rest');
});

test("the owner's roll: the pet hops out to the roll area, watches from there, then goes back to its slot", () => {
  const { m } = spotMake('topLeft');
  rollToRest(m, 'u1');
  const home = slotAt('topLeft', 0);
  near(posOf(m), home);
  const [own] = m.layer.obstaclesFor({ spec: spec('u1'), edge: 0, area: BIG });
  inRing(own); // the physics has it in the roll area, not in its corner
  m.layer.begin('again', bigInfo(spec('u1'), 0));
  m.layer.update(clockNow);
  runTo(m, clockNow + 800);
  near(posOf(m), own);
  expect(phaseOf(m)).toBe('watch');
  m.layer.landed('again', [d20(5)]);
  m.layer.leave('again', 0);
  m.layer.end('again');
  expect(runTo(m, clockNow + 3000)).toBe('rest');
  near(posOf(m), home);
});

test('a slot freed by a pet that left goes to the next pet to arrive', () => {
  const { m } = spotMake('bottomLeft');
  rollToRest(m, 'u1');
  clockNow += 500;
  rollToRest(m, 'u2');
  m.layer.userGone('u1');
  runTo(m, clockNow + 1000);
  expect(pets(m.scene)).toHaveLength(1);
  near(posOf(m, 0), slotAt('bottomLeft', 1)); // u2 keeps its slot
  rollToRest(m, 'u3');
  near(posOf(m, 1), slotAt('bottomLeft', 0)); // u3 takes the free one
});

test('Review Focus 4: changing petRestSpot while resting hops the pets to the new spot, then the layer is idle', () => {
  const { m, timers } = spotMake('dice');
  rollToRest(m, 'u1');
  clockNow += 500;
  rollToRest(m, 'u2');
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  // the settings onChange is DiceBox's wake: the next update sees the new choice
  m.settings.petRestSpot = 'bottomCentre';
  expect(m.layer.update((clockNow += 16))).toBe(true);
  expect(runTo(m, clockNow + REST_HOP_MS + 50)).toBe('rest');
  near(posOf(m, 0), slotAt('bottomCentre', 0)); // in the order they came to rest
  near(posOf(m, 1), slotAt('bottomCentre', 1));
  // idle: nothing redraws, only the idle-leave timer is armed
  for (let i = 0; i < 20; i++) expect(m.layer.update((clockNow += 16))).toBe('rest');
  expect(timers.live()).toHaveLength(1);
  // corner to corner keeps each pet's slot; back to 'dice' rests in the ring
  m.settings.petRestSpot = 'topRight';
  expect(runTo(m, clockNow + REST_HOP_MS + 50)).toBe('rest');
  near(posOf(m, 0), slotAt('topRight', 0));
  near(posOf(m, 1), slotAt('topRight', 1));
  m.settings.petRestSpot = 'dice';
  expect(runTo(m, clockNow + REST_HOP_MS + 50)).toBe('rest');
  inRing(posOf(m, 0));
  inRing(posOf(m, 1));
  // the same choice again moves nobody
  const was = posOf(m, 0);
  m.layer.restSpotChanged();
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  expect(posOf(m, 0)).toEqual(was);
});

test('a change while a roll is in flight waits for it (the physics has the old spots)', () => {
  const { m, rolls } = spotMake('dice');
  rollToRest(m, 'u1');
  const was = posOf(m);
  rolls.n = 1;
  m.settings.petRestSpot = 'bottomLeft';
  runTo(m, clockNow + 1000);
  expect(posOf(m)).toEqual(was);
  rolls.n = 0;
  expect(runTo(m, clockNow + REST_HOP_MS + 50)).toBe('rest');
  near(posOf(m), slotAt('bottomLeft', 0));
});

test('a puddle at a corner moves with the setting; a corner pet keeps off the UI', () => {
  const { m } = spotMake('bottomRight');
  rollToRest(m, 'u1');
  hitFrom(m, 'u1', HARD);
  runTo(m, clockNow + 1300);
  expect(phaseOf(m)).toBe('puddle');
  m.settings.petRestSpot = 'topLeft';
  runTo(m, clockNow + 100);
  near(posOf(m), slotAt('topLeft', 0));
  // the macro bar along the bottom (px): the slot sits above it
  const rects = { hotbar: { left: 0, top: BIG.halfDepth * 2 * PX - 200, width: BIG.halfWidth * 2 * PX, height: 200 } };
  const n = make({ petStay: 60, petRestSpot: 'bottomCentre' }, { doc: fakeDoc(rects), activeRolls: () => 0 });
  n.layer.areaChanged(STAGE_BIG);
  rollToRest(n, 'u1');
  expect(posOf(n).z).toBeLessThan(BIG.halfDepth - 200 / PX - 0.9);
});

test('after an alignFor replay the pet returns to this viewer\'s spot', () => {
  const { m, rolls } = spotMake('bottomLeft');
  rollToRest(m, 'u1');
  const home = slotAt('bottomLeft', 0);
  near(posOf(m), home);
  const to = { x: 4, z: -3 };
  m.layer.alignFor([{ id: 'u1', x: to.x, z: to.z, r: 0.95, h: 1.5 }], BIG, () => 100);
  rolls.n = 1; // the replay's roll() follows alignFor at once
  expect(runTo(m, clockNow + 2000)).toBe('rest');
  near(posOf(m), to); // the thrower's layout while it flies
  rolls.n = 0; // the replay is over
  expect(m.layer.update((clockNow += 16))).toBe(true);
  expect(runTo(m, clockNow + REST_HOP_MS + 50)).toBe('rest');
  near(posOf(m), home);
});

test('fix 3: a pet that comes to rest after a change already sits by the new choice: no second hop', () => {
  const { m, rolls } = spotMake('dice');
  m.layer.begin('k', bigInfo(spec('u1')));
  rolls.n = 1; // another player's dice fly all along: the change waits
  m.layer.update(clockNow);
  m.settings.petRestSpot = 'bottomLeft'; // changed mid-roll
  runTo(m, clockNow + 400);
  m.layer.landed('k', [d20(5)]);
  m.layer.leave('k', 0);
  m.layer.end('k');
  expect(runTo(m, clockNow + 3000)).toBe('rest');
  near(posOf(m), slotAt('bottomLeft', 0)); // it came to rest by the new choice
  rolls.n = 0; // the other roll is over: nothing is left to move
  for (let i = 0; i < 40; i++) expect(m.layer.update((clockNow += 16))).toBe('rest');
  // a second pet coming to rest while the first sits at the old choice still moves the first
  const n = spotMake('dice');
  rollToRest(n.m, 'u1');
  n.m.layer.begin('k2', bigInfo(spec('u2')));
  n.m.layer.update(clockNow);
  n.rolls.n = 1; // u2's roll flies: the change waits
  n.m.settings.petRestSpot = 'topRight';
  runTo(n.m, clockNow + 400);
  n.m.layer.landed('k2', [d20(5)]);
  n.m.layer.leave('k2', 0);
  n.rolls.n = 0;
  n.m.layer.end('k2');
  expect(runTo(n.m, clockNow + 3000)).toBe('rest');
  near(posOf(n.m, 0), slotAt('topRight', 1)); // u1 moved after u2 came to rest (by when it rested)
  near(posOf(n.m, 1), slotAt('topRight', 0));
});

test("fix 2: under 'dice' a replayed pet off its own ring hops back to a ring spot when the replay ends", () => {
  const { m, rolls } = spotMake('dice');
  rollToRest(m, 'u1');
  const to = { x: 1, z: 0.5 }; // the thrower's layout: near the middle, off this pet's ring
  m.layer.alignFor([{ id: 'u1', x: to.x, z: to.z, r: 0.95, h: 1.5 }], BIG, () => 100);
  rolls.n = 1;
  expect(runTo(m, clockNow + 2000)).toBe('rest');
  near(posOf(m), to);
  rolls.n = 0;
  expect(m.layer.update((clockNow += 16))).toBe(true);
  expect(runTo(m, clockNow + REST_HOP_MS + 50)).toBe('rest');
  inRing(posOf(m));
  for (let i = 0; i < 10; i++) expect(m.layer.update((clockNow += 16))).toBe('rest');
  // one already on a valid ring spot stays there (no hop for nothing)
  const ring = posOf(m);
  const mirror = { x: -ring.x, z: -ring.z };
  m.layer.alignFor([{ id: 'u1', x: mirror.x, z: mirror.z, r: 0.95, h: 1.5 }], BIG, () => 100);
  rolls.n = 1;
  runTo(m, clockNow + 1000);
  rolls.n = 0;
  expect(runTo(m, clockNow + 1000)).toBe('rest');
  near(posOf(m), mirror);
});

// ---- final review fixes ----
const busyMake = () => {
  const timers = fakeTimers();
  const rolls = { n: 0 };
  const m = make(
    { petStay: 60 },
    { setTimer: timers.setTimer, clearTimer: timers.clearTimer, activeRolls: () => rolls.n, random: mulberry(5) },
  );
  m.layer.areaChanged(STAGE_BIG);
  return { m, timers, rolls };
};

test('an overdue idle leave waits while any roll is in flight, with no timer aimed at it', () => {
  const { m, timers, rolls } = busyMake();
  rollToRest(m, 'u1');
  const idle = clockNow;
  rolls.n = 1; // someone's dice are flying: the pet is their obstacle
  expect(runTo(m, idle + 62000)).toBe('rest');
  expect(pets(m.scene)).toHaveLength(1);
  expect(timers.live()).toHaveLength(0); // nothing spins the loop while it is held
  rolls.n = 0;
  expect(m.layer.update((clockNow += 16))).toBe(true); // the first frame with no roll: it hops off
  expect(runTo(m, clockNow + 1000)).toBe(false);
});

test("the owner's roll between obstaclesFor and begin keeps the pet's spot past its leave time", () => {
  const { m, rolls } = busyMake();
  rollToRest(m, 'u1');
  const idle = clockNow;
  const rest = posOf(m);
  clockNow = idle + 61000; // past leaveAt
  rolls.n = 1; // the roll is in DiceBox's list from the start
  const [own] = m.layer.obstaclesFor({ spec: spec('u1'), edge: 0, area: BIG });
  expect(own.x).toBeCloseTo(rest.x, 6);
  m.layer.update(clockNow); // a frame before the dice first show
  m.layer.begin('late', bigInfo(spec('u1'), 0));
  m.layer.update(clockNow);
  runTo(m, clockNow + 1000);
  expect(posOf(m).x).toBeCloseTo(own.x, 6);
  expect(posOf(m).z).toBeCloseTo(own.z, 6);
});

// ---- rolling by hand: pets hold still while dice are held (H-8) ----
const heldMake = () => {
  const timers = fakeTimers();
  const held = { on: false };
  const m = make(
    { petStay: 60 },
    {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      activeRolls: () => 0,
      holding: () => held.on,
      random: mulberry(5),
    },
  );
  m.layer.areaChanged(STAGE_BIG);
  return { m, timers, held };
};

test('no idle leave while holding(); the timer re-arms after release', () => {
  const { m, timers, held } = heldMake();
  rollToRest(m, 'u1');
  const idle = clockNow;
  m.layer.update((clockNow += 16));
  expect(timers.live()).toHaveLength(1); // aimed at idle + 60 s
  held.on = true;
  m.layer.update((clockNow += 16));
  expect(timers.live()).toHaveLength(0); // nothing armed while dice are held
  expect(runTo(m, idle + 62000)).toBe('rest');
  expect(pets(m.scene)).toHaveLength(1); // overdue, but it stays while held
  expect(timers.live()).toHaveLength(0);
  held.on = false;
  expect(m.layer.update((clockNow += 16))).toBe(true); // released: the overdue leave goes now
  expect(runTo(m, clockNow + 1000)).toBe(false);
  // a leave not yet due is armed again on release
  const n = heldMake();
  rollToRest(n.m, 'u1');
  n.held.on = true;
  n.m.layer.update((clockNow += 16));
  expect(n.timers.live()).toHaveLength(0);
  n.held.on = false;
  n.m.layer.update((clockNow += 16));
  expect(n.timers.live()).toHaveLength(1);
});

// ---- Task 9: pets in hand throws (H-5), the thrower's layout on receivers (H-6) ----
describe('Task 9: hand throws and alignFor', () => {
  const MIMIC_R = 0.95;
  const userOf = (id) => ({ id, flags: { dicer: { pet: { kind: id === 'nopet' ? 'none' : 'slime', color: '#00ff00' } } } });
  const obOf = (m, id) => m.layer.obstaclesFor({ spec: null, edge: 0, area: BIG }).find((o) => o.id === id);
  const listed = (id, x, z) => ({ id, x, z, r: MIMIC_R, h: 1.5 });
  const far = () => 100; // no die passes near anything

  test("a hand begin never poses 'throw'", () => {
    // a pet that hops in (petStay 0) and one watching from its resting spot
    for (const settings of [{ petStay: 0 }, { petStay: 60 }]) {
      const m = make(settings);
      if (settings.petStay) rollToRest(m, 'u1');
      const poses = [];
      m.layer.begin('h', { ...bigInfo(spec('u1'), 2), hand: true });
      m.layer.update(clockNow);
      const first = phaseOf(m);
      const start = clockNow;
      while (clockNow < start + 2000) {
        m.layer.update((clockNow += 16));
        poses.push(phaseOf(m));
      }
      expect(poses).not.toContain('throw');
      expect(poses).toContain('watch');
      if (settings.petStay) expect(first).toBe('watch'); // from rest: at once
    }
  });

  test('alignFor moves a listed resting pet to its spot', () => {
    const m = make({ petStay: 60 });
    rollToRest(m, 'u1');
    const from = { x: at(m.scene).x, z: at(m.scene).z };
    const to = { x: -from.x, z: -from.z };
    m.layer.alignFor([listed('u1', to.x, to.z)], BIG, far);
    // the physics' view is the destination at once; the pet moves there over REST_HOP_MS
    expect(obOf(m, 'u1')).toMatchObject({ x: to.x, z: to.z });
    m.layer.update((clockNow += 100));
    const mid = at(m.scene);
    expect(Math.hypot(mid.x - from.x, mid.z - from.z)).toBeGreaterThan(0);
    expect(Math.hypot(mid.x - to.x, mid.z - to.z)).toBeGreaterThan(0);
    runTo(m, clockNow + REST_HOP_MS + 50);
    expect(at(m.scene).x).toBeCloseTo(to.x, 6);
    expect(at(m.scene).z).toBeCloseTo(to.z, 6);
    expect(m.layer.update((clockNow += 16))).toBe('rest');
  });

  test('alignFor places an absent listed pet at rest within the cap', () => {
    // the replay flies throughout (its roll follows alignFor at once): placed pets stay placed
    const m = make({ petStay: 60 }, { userOf, random: mulberry(3), activeRolls: () => 1 });
    rollToRest(m, 'u1');
    clockNow += 500;
    rollToRest(m, 'u2');
    m.layer.alignFor([listed('u3', 4, 3)], BIG, far);
    runTo(m, clockNow + REST_HOP_MS + 50);
    expect(pets(m.scene)).toHaveLength(3);
    expect(obOf(m, 'u3')).toMatchObject({ x: 4, z: 3, r: 1.0 }); // a slime, its own footprint
    expect(at(m.scene, 2).x).toBeCloseTo(4, 6);
    expect(at(m.scene, 2).z).toBeCloseTo(3, 6);
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    // the cap is full: the longest-idle resting pet (u1) gives its place up
    m.layer.alignFor([listed('u4', -4, -3)], BIG, far);
    runTo(m, clockNow + REST_HOP_MS + 50);
    expect(ids(m)).toEqual(['u2', 'u3', 'u4']);
    // all three mid-routine: no place, nothing placed (its die passes through empty air here)
    for (const u of ['u2', 'u3', 'u4']) m.layer.begin(`r-${u}`, bigInfo(spec(u)));
    m.layer.alignFor([listed('u5', 4, -3)], BIG, far);
    runTo(m, clockNow + 100);
    expect(ids(m)).toEqual(['u2', 'u3', 'u4']);
    // a user whose pet is 'none', or an unknown user: nothing placed
    const n = make({ petStay: 60 }, { userOf: (id) => (id === 'ghost' ? null : userOf(id)) });
    n.layer.alignFor([listed('nopet', 4, 3), listed('ghost', -4, 3)], BIG, far);
    expect(pets(n.scene)).toHaveLength(0);
    // showPets or petsAllowed off: nothing placed (H-6)
    for (const off of [{ showPets: false }, { petsAllowed: false }]) {
      const o = make({ petStay: 60, ...off }, { userOf });
      o.layer.alignFor([listed('u1', 4, 3)], BIG, far);
      expect(pets(o.scene)).toHaveLength(0);
    }
  });

  test('alignFor with petStay 0 keeps the placed pet while the replay is in flight, then it leaves', () => {
    let active = 0;
    const m = make({ petStay: 0 }, { userOf, activeRolls: () => active });
    active = 1; // the replay's roll() follows alignFor at once
    m.layer.alignFor([listed('u3', 4, 3)], BIG, far);
    runTo(m, clockNow + 2000);
    expect(pets(m.scene)).toHaveLength(1);
    expect(at(m.scene).x).toBeCloseTo(4, 6);
    // the roller's own (aligned) pet watches its hand replay from the recorded spot
    m.layer.begin('h', { ...bigInfo(spec('u3'), 1), hand: true });
    runTo(m, clockNow + 500);
    expect(at(m.scene).x).toBeCloseTo(4, 6);
    expect(at(m.scene).z).toBeCloseTo(3, 6);
    m.layer.landed('h', [d20(5)]);
    m.layer.leave('h', 0);
    m.layer.end('h');
    active = 0;
    expect(runTo(m, clockNow + 3000)).toBe(false);
    expect(pets(m.scene)).toHaveLength(0);
  });

  test('alignFor moves an unlisted pet off the die paths', () => {
    const m = make({ petStay: 60 }, { random: mulberry(9) });
    rollToRest(m, 'u1');
    const s = { x: at(m.scene).x, z: at(m.scene).z };
    // a pet no die passes near stays put
    m.layer.alignFor([], BIG, far);
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    expect(at(m.scene).x).toBe(s.x);
    // the recorded dice rolled straight across its spot
    const paths = (x, z) => Math.abs(z - s.z);
    m.layer.alignFor([], BIG, paths);
    runTo(m, clockNow + REST_HOP_MS + 50);
    const p = at(m.scene);
    expect(paths(p.x, p.z)).toBeGreaterThan(MIMIC_R + 1);
    inRing(p);
    expect(m.layer.update((clockNow += 16))).toBe('rest');
  });

  test('alignFor never moves a pet mid-routine or a puddle', () => {
    const m = puddled({}, 'u1');
    const puddle = { x: at(m.scene).x, z: at(m.scene).z };
    m.layer.begin('r2', bigInfo(spec('u2'), 2));
    runTo(m, clockNow + 600);
    const routine = { x: at(m.scene, 1).x, z: at(m.scene, 1).z };
    const paths = (x, z) => Math.min(Math.hypot(x - puddle.x, z - puddle.z), Math.hypot(x - routine.x, z - routine.z));
    m.layer.alignFor([listed('u1', 5, 4), listed('u2', -5, -4)], BIG, paths);
    runTo(m, clockNow + REST_HOP_MS + 50);
    expect(phaseOf(m, 0)).toBe('puddle'); // a listed puddle stays a puddle, where it lies
    expect(at(m.scene, 0).x).toBeCloseTo(puddle.x, 6);
    expect(at(m.scene, 0).z).toBeCloseTo(puddle.z, 6);
    expect(at(m.scene, 1).x).toBeCloseTo(routine.x, 6);
    expect(at(m.scene, 1).z).toBeCloseTo(routine.z, 6);
    // unlisted: the same
    m.layer.alignFor([], BIG, paths);
    runTo(m, clockNow + REST_HOP_MS + 50);
    expect(at(m.scene, 0).x).toBeCloseTo(puddle.x, 6);
    expect(at(m.scene, 1).x).toBeCloseTo(routine.x, 6);
  });

  test("Review Focus 5: a replayed -3 impact over SPLAT_SPEED splats the listed pet on the receiver; the owner's next roll reforms it", () => {
    // The receiver had no pet of u1: the thrower's layout places it, the replay's impact
    // (-3 - i mapped to u1 by DiceBox) hits it at the recorded speed, and it splats here too.
    const m = make({ petStay: 60 }, { userOf, activeRolls: () => 1 }); // the replay flies
    m.layer.alignFor([listed('u1', 4, 3)], BIG, far);
    runTo(m, clockNow + REST_HOP_MS + 50);
    m.layer.hit('u1', { speed: SPLAT_SPEED + 1, position: { x: 4.5, y: 1, z: 3 }, dieKey: '0:0:0' });
    runTo(m, clockNow + 1300);
    expect(phaseOf(m)).toBe('puddle');
    expect(splatCalls(m)).toBe(1);
    expect(at(m.scene).x).toBeCloseTo(4, 6); // where the dice met it
    expect(at(m.scene).z).toBeCloseTo(3, 6);
    expect(obOf(m, 'u1')).toBeUndefined(); // a puddle is no obstacle
    m.layer.begin('again', bigInfo(spec('u1'), 0));
    m.layer.update(clockNow);
    expect(phaseOf(m)).toBe('reform');
    runTo(m, clockNow + 1500);
    expect(phaseOf(m)).not.toMatch(/puddle|reform|splat/);
    expect(pets(m.scene)[0].children[0].visible).toBe(true);
  });
});

describe('Task 9 review fixes', () => {
  const userOf = (id) => ({ id, flags: { dicer: { pet: { kind: 'slime', color: '#00ff00' } } } });
  const listed = (id, x, z) => ({ id, x, z, r: 0.95, h: 1.5 });
  const far = () => 100;

  test('fix 1 (H-8): alignFor moves and places nothing while dice are held', () => {
    let held = true;
    const m = make({ petStay: 60 }, { userOf, holding: () => held });
    held = false;
    rollToRest(m, 'u1');
    held = true;
    const s = { x: at(m.scene).x, z: at(m.scene).z };
    const got = m.layer.alignFor([listed('u1', -s.x, -s.z), listed('u2', 4, 3)], BIG, (x, z) => Math.hypot(x - s.x, z - s.z));
    expect(got.size).toBe(0);
    runTo(m, clockNow + REST_HOP_MS + 50);
    expect(pets(m.scene)).toHaveLength(1);
    expect(at(m.scene).x).toBe(s.x);
    expect(at(m.scene).z).toBe(s.z);
  });

  test('fix 2: alignFor returns the ids it aligned; a mid-routine or puddle listed pet is not one', () => {
    const m = puddled({ petStay: 60 }, 'u1');
    m.layer.begin('r2', bigInfo(spec('u2'), 2));
    runTo(m, clockNow + 600);
    rollToRest(m, 'u3');
    const got = m.layer.alignFor([listed('u1', 5, 4), listed('u2', -5, -4), listed('u3', 5, -4)], BIG, far);
    expect([...got].sort()).toEqual(['u3']);
    // pets hidden: nothing aligned
    m.settings.showPets = false;
    expect(m.layer.alignFor([listed('u3', 5, -4)], BIG, far).size).toBe(0);
  });

  test('fix 6: a pet whose owner is gone is not re-aligned', () => {
    const m = make({ petStay: 60 }, { userOf });
    rollToRest(m, 'u1');
    m.layer.userGone('u1');
    m.layer.update((clockNow += 16));
    const got = m.layer.alignFor([listed('u1', 4, 3)], BIG, far);
    expect(got.has('u1')).toBe(false);
    expect(runTo(m, clockNow + 2000)).toBe(false); // it hops off and is gone
    expect(pets(m.scene)).toHaveLength(0);
  });
});

describe('pet size (petScale, independent of diceScale)', () => {
  const sizeOf = (scene) => pets(scene)[0].children[0].scale.x; // the creature's sizer
  const radius = (layer) => layer.obstaclesFor({ spec: spec(), edge: 0, area: AREA })[0].r;

  test('petScale over diceScale sizes the creature, its height and its obstacle', () => {
    const base = make();
    const r1 = radius(base.layer);
    base.layer.begin('k', info());
    expect(sizeOf(base.scene)).toBeCloseTo(1);
    const h1 = base.layer.obstaclesFor({ spec: spec('u2'), edge: 0, area: AREA }).find((o) => o.id === 'u1').h;

    const big = make({ petScale: 2, diceScale: 1 });
    expect(radius(big.layer)).toBeCloseTo(r1 * 2);
    big.layer.begin('k', info());
    expect(sizeOf(big.scene)).toBeCloseTo(2);
    const h2 = big.layer.obstaclesFor({ spec: spec('u2'), edge: 0, area: AREA }).find((o) => o.id === 'u1').h;
    expect(h2).toBeCloseTo(h1 * 2);

    // bigger dice alone no longer grow the pets on screen: they shrink in die units
    const dice = make({ diceScale: 2 });
    dice.layer.begin('k', info());
    expect(sizeOf(dice.scene)).toBeCloseTo(0.5);
  });

  test('a changed setting re-sizes the pets on the next areaChanged', () => {
    const m = make();
    m.layer.areaChanged(AREA);
    m.layer.begin('k', info());
    expect(sizeOf(m.scene)).toBeCloseTo(1);
    m.settings.petScale = 1.5;
    m.layer.areaChanged(AREA); // same stage: settings changes come through resizeDice too
    expect(sizeOf(m.scene)).toBeCloseTo(1.5);
    expect(pets(m.scene)[0].children[0].children).toHaveLength(1); // wrapped once, not again
  });
});

// ---- the dice tray's rim (petTray 'rim': deps.perch) ----
describe('pets on the dice tray rim', () => {
  const RIM = { cx: 0, cz: -8, halfWidth: 6, halfDepth: 0.3 };
  const onRim = (settings = {}) => make({ petStay: 60, ...settings }, { perch: () => RIM });

  test('a pet watches its roll from the rim and rests there, out of the dice area', () => {
    const m = onRim();
    m.layer.begin('k', bigInfo(spec('u1')));
    // the physics sees it on the rim (outside the walls: no die reaches it)
    const [o] = m.layer.obstaclesFor({ spec: spec('u2'), edge: 0, area: BIG }).filter((x) => x.id === 'u1');
    expect(o.z).toBeCloseTo(RIM.cz, 6);
    m.layer.end('k');
    rollToRest(m, 'u1');
    expect(at(m.scene).z).toBeCloseTo(RIM.cz, 6);
    expect(Math.abs(at(m.scene).x - RIM.cx)).toBeLessThanOrEqual(RIM.halfWidth);
  });

  test('two pets sit apart along the rim', () => {
    const m = onRim();
    rollToRest(m, 'u1');
    rollToRest(m, 'u2');
    const xs = pets(m.scene).map((g) => g.position.x);
    expect(Math.abs(xs[0] - xs[1])).toBeGreaterThan(2);
    for (const g of pets(m.scene)) expect(g.position.z).toBeCloseTo(RIM.cz, 6);
  });

  test('a hard wall hit beside a pet on the rim wobbles it; a soft or far one does not', () => {
    const m = onRim();
    rollToRest(m, 'u1');
    const p = { x: at(m.scene).x, z: at(m.scene).z };
    m.layer.wall({ x: p.x, y: 0.5, z: p.z + WALL_REACH + 1 }, WALL_FLINCH_SPEED * 3); // too far
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    m.layer.wall({ x: p.x + 0.5, y: 0.5, z: p.z + 1 }, WALL_FLINCH_SPEED / 2); // too soft
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    m.layer.wall({ x: p.x + 0.5, y: 0.5, z: p.z + 1 }, WALL_FLINCH_SPEED * 3);
    expect(m.layer.update((clockNow += 16))).toBe(true); // wobbling
    runTo(m, clockNow + 600);
    expect(m.layer.update((clockNow += 16))).toBe('rest');
    expect(at(m.scene).z).toBeCloseTo(RIM.cz, 6); // back on the rim
  });

  test("a pet resting on the rim reacts to someone's fire die landing anywhere in the tray, with its sound", () => {
    const m = onRim();
    rollToRest(m, 'u1');
    m.playSound.mockClear();
    // far from the rim (z -8): beyond the 2 die widths a pet on the floor needs
    m.layer.landed(null, [{ type: 'd6', value: 3, x: 4, z: 6, damageType: 'fire' }]);
    m.layer.update((clockNow += 16));
    expect(phaseOf(m)).toBe('scorch');
    expect(m.playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petCough' }));
  });

  test("its own pet, watching from the rim, reacts to its roll's element at once: no nod first", () => {
    const m = onRim();
    const key = 'own';
    m.layer.begin(key, bigInfo(spec('u1')));
    m.layer.update(clockNow);
    runTo(m, clockNow + 700); // past its throw: watching
    m.playSound.mockClear();
    m.layer.landed(key, [{ type: 'd8', value: 5, x: 3, z: 4, damageType: 'fire' }]);
    const seen = [];
    for (let i = 0; i < 20; i++) {
      m.layer.update((clockNow += 16));
      seen.push(phaseOf(m));
    }
    expect(seen[0]).toBe('scorch'); // straight into it
    expect(seen).not.toContain('react'); // never the plain nod
    expect(m.playSound).toHaveBeenCalledWith(expect.objectContaining({ builtin: 'petCough' }));
    // the roll ends and the pet stays on the rim, resting
    m.layer.leave(key, 0);
    m.layer.end(key);
    runTo(m, clockNow + 2500);
    expect(pets(m.scene)).toHaveLength(1);
    expect(at(m.scene).z).toBeCloseTo(RIM.cz, 6);
  });

  test('without a rim a far fire die leaves a resting pet be (it must land within reach)', () => {
    const m = make({ petStay: 60 });
    rollToRest(m, 'u1');
    const p = at(m.scene);
    m.layer.landed(null, [{ type: 'd6', value: 3, x: p.x + 10, z: p.z, damageType: 'fire' }]);
    m.layer.update((clockNow += 16));
    expect(phaseOf(m)).not.toBe('scorch');
  });

  /** A document with the table tray in it (shown), whose slide-outs the pets hear. */
  const trayDoc = () => {
    const classes = new Set();
    const tray = { classList: { contains: (c) => classes.has(c) } };
    const listeners = new Map();
    return {
      getElementById: (id) => (id === 'dicer-table-tray' ? tray : null),
      querySelectorAll: () => [],
      addEventListener: (t, fn) => listeners.set(t, fn),
      removeEventListener: (t) => listeners.delete(t),
      slide(hidden) {
        if (hidden) classes.add('is-hidden');
        else classes.delete('is-hidden');
        listeners.get('dicertray')?.();
      },
    };
  };

  test('a tray that slides away takes its rim pets with it; the next roll brings them back onto the rim', () => {
    const doc = trayDoc();
    const m = make({ petStay: 60 }, { perch: () => RIM, doc });
    rollToRest(m, 'u1');
    expect(at(m.scene).z).toBeCloseTo(RIM.cz, 6);
    doc.slide(true);
    runTo(m, clockNow + 2000);
    expect(pets(m.scene)).toHaveLength(0); // hopped off with the tray
    doc.slide(false); // dice coming: the tray slides in
    rollToRest(m, 'u1');
    expect(pets(m.scene)).toHaveLength(1);
    expect(at(m.scene).z).toBeCloseTo(RIM.cz, 6);
  });

  test('a pet whose routine ends after the tray slid away leaves too, rather than rest on the floor', () => {
    const doc = trayDoc();
    const m = make({ petStay: 60 }, { perch: () => RIM, doc });
    const key = 'late';
    m.layer.begin(key, bigInfo(spec('u1')));
    m.layer.update(clockNow);
    runTo(m, clockNow + 400);
    m.layer.landed(key, [d20(5)]);
    doc.slide(true); // the dice fade: the tray slides away before the pet is done
    runTo(m, clockNow + 3000);
    m.layer.leave(key, 0);
    m.layer.end(key);
    runTo(m, clockNow + 2000);
    expect(pets(m.scene)).toHaveLength(0);
  });

  test('a slide-out with pets not on the rim (petTray in the tray) leaves them be', () => {
    const doc = trayDoc();
    const m = make({ petStay: 60, petTray: 'in' }, { doc });
    rollToRest(m, 'u1');
    doc.slide(true);
    runTo(m, clockNow + 2000);
    expect(pets(m.scene)).toHaveLength(1);
  });

  test('without a rim (no tray, or petTray not rim) wall hits do nothing and pets rest as before', () => {
    const m = make({ petStay: 60 });
    rollToRest(m, 'u1');
    const p = { x: at(m.scene).x, z: at(m.scene).z };
    m.layer.wall({ x: p.x, y: 0.5, z: p.z }, WALL_FLINCH_SPEED * 3);
    expect(m.layer.update((clockNow += 16))).toBe('rest');
  });
});

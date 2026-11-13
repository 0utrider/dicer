import * as THREE from 'three';
import { createPetLayer, SPLAT_SPEED, WOBBLE_SPEED } from '../../src/pet/chunk/pets.js';
import { mulberry32 as mulberry } from '../../src/core/rng.js';

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
  expect(reactAndRun({}, [d20(20)]).playSound).toHaveBeenCalledWith({ builtin: 'petHappy' });
  expect(reactAndRun({}, [d20(1)]).playSound).toHaveBeenCalledWith({ builtin: 'petSad' });
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
  expect(objs.filter((o) => o.isPoints)).toHaveLength(1);
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
    expect(m.playSound).toHaveBeenCalledWith({ builtin: 'petHappy' });
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
    expect(m.playSound).toHaveBeenCalledWith({ builtin: 'petHappy' });
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
    expect(m.playSound).toHaveBeenCalledWith({ builtin: 'petHappy' });
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
  expect(m.playSound).toHaveBeenCalledWith({ builtin: 'petHappy' });
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
  clockNow += 500;
  rollToRest(m, 'u2');
  clockNow += 500;
  rollToRest(m, 'u3');
  expect(ids(m)).toEqual(['u2', 'u3']); // the puddle stands in nobody's way
  expect(pets(m.scene)).toHaveLength(3); // ... but holds a place
  m.layer.begin('r4', bigInfo(spec('u4'), 2)); // so the 4th replaces it
  runTo(m, clockNow + 900);
  expect(pets(m.scene)).toHaveLength(3);
  expect(ids(m)).toEqual(['u2', 'u3', 'u4']);
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

test('a puddle fades after petStay', () => {
  const m = puddled({ petStay: 60 });
  const idle = clockNow;
  expect(runTo(m, idle + 50000)).toBe('rest');
  expect(pets(m.scene)).toHaveLength(1);
  expect(runTo(m, idle + 62000)).toBe(false);
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

// ---- dodging the cursor ----
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
/** A pointer event at stage point (x, z) (die units from the stage centre). */
const pointAt = (win, x, z, target = null) =>
  win.handlers.get('pointermove')?.fn({
    clientX: STAGE_BIG.rect.width / 2 + x * PX,
    clientY: STAGE_BIG.rect.height / 2 + z * PX,
    target,
  });
const dodgeMake = (over = {}) => {
  const win = fakeWin();
  const rolls = { n: 0 };
  const m = make({ petStay: 60 }, { win, activeRolls: () => rolls.n, random: mulberry(5), ...over });
  m.layer.areaChanged(STAGE_BIG);
  return { m, win, rolls };
};
const posOf = (m, i = 0) => ({ x: at(m.scene, i).x, z: at(m.scene, i).z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('pointer near a resting pet: it moves to a spot >= 4 away; wake called', () => {
  const { m, win } = dodgeMake();
  rollToRest(m, 'u1');
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  const was = posOf(m);
  const p = { x: was.x + 0.5, z: was.z + 0.3 };
  m.deps.wake.mockClear();
  pointAt(win, p.x, p.z);
  expect(m.deps.wake).toHaveBeenCalled(); // the held loop is woken to dodge
  expect(m.layer.update((clockNow += 16))).toBe(true);
  expect(phaseOf(m)).toBe('move');
  expect(runTo(m, clockNow + 800)).toBe('rest');
  const now = posOf(m);
  expect(dist(now, p)).toBeGreaterThanOrEqual(4 - 1e-9);
  inRing(now);
  expect(at(m.scene).y).toBe(0);
});

test('a far pointer does not wake the loop or move the pet', () => {
  const { m, win } = dodgeMake();
  rollToRest(m, 'u1');
  const was = posOf(m);
  m.deps.wake.mockClear();
  pointAt(win, was.x + 6, was.z);
  expect(m.deps.wake).not.toHaveBeenCalled();
  expect(m.layer.update((clockNow += 16))).toBe('rest');
  expect(posOf(m)).toEqual(was);
});

test('no dodge while activeRolls > 0, dodges after', () => {
  const { m, win, rolls } = dodgeMake();
  rollToRest(m, 'u1');
  const was = posOf(m);
  rolls.n = 1;
  pointAt(win, was.x, was.z);
  for (let i = 0; i < 20; i++) m.layer.update((clockNow += 16));
  expect(phaseOf(m)).not.toBe('move');
  expect(posOf(m)).toEqual(was);
  rolls.n = 0;
  m.layer.update((clockNow += 16)); // the pointer has not moved since, but it was never checked
  expect(phaseOf(m)).toBe('move');
  runTo(m, clockNow + 800);
  expect(dist(posOf(m), was)).toBeGreaterThanOrEqual(4 - 1e-9);
});

test('still pointer on the new spot: no second dodge within the cooldown', () => {
  const { m, win } = dodgeMake();
  rollToRest(m, 'u1');
  const was = posOf(m);
  pointAt(win, was.x, was.z);
  m.layer.update((clockNow += 16));
  expect(runTo(m, clockNow + 700)).toBe('rest'); // arrived (the mimic moves in 450 ms)
  const spot = posOf(m);
  pointAt(win, spot.x, spot.z); // the cursor follows it there at once
  for (let i = 0; i < 10; i++) m.layer.update((clockNow += 16)); // within the 600 ms cooldown
  expect(posOf(m)).toEqual(spot);
  expect(m.layer.update((clockNow += 16))).toBe('rest'); // nothing moves (its last pose stays 'move')
  // the cursor stays still there: nothing moves, however long it waits
  expect(runTo(m, clockNow + 3000)).toBe('rest');
  expect(posOf(m)).toEqual(spot);
  // it moves again once the cursor moves, after the cooldown
  pointAt(win, spot.x + 0.1, spot.z);
  m.layer.update((clockNow += 16));
  expect(phaseOf(m)).toBe('move');
});

test('a corner with no far spot: the farthest spot, then no ping-pong', () => {
  const { m, win } = dodgeMake({ random: mulberry(9) });
  const tiny = { cx: 0, cz: 0, halfWidth: 4, halfDepth: 3 }; // no spot is 4 from its middle
  m.layer.begin('k', { spec: spec('u1'), edge: 0, area: tiny, centre: () => ({ x: 0, z: 0 }) });
  m.layer.update(clockNow);
  runTo(m, clockNow + 400);
  m.layer.landed('k', [d20(5)]);
  m.layer.leave('k', 0);
  m.layer.end('k');
  expect(runTo(m, clockNow + 3000)).toBe('rest');
  const was = posOf(m);
  pointAt(win, 0, 0);
  let moves = 0;
  let last = 'rest';
  const spots = [];
  for (let i = 0; i < 400; i++) {
    if (i % 6 === 0) pointAt(win, 0.1 * Math.sin(i), 0.1 * Math.cos(i)); // a jittery, near-still cursor
    const r = m.layer.update((clockNow += 16));
    if (r === true && last !== true) moves++; // a move starts (a resting pet draws nothing)
    if (r === 'rest') spots.push(posOf(m));
    last = r;
  }
  expect(moves).toBeLessThanOrEqual(1);
  const final = posOf(m);
  expect(dist(final, { x: 0, z: 0 })).toBeGreaterThanOrEqual(dist(was, { x: 0, z: 0 }) - 1e-9);
  // once it has moved it stays
  expect(spots.slice(-200).every((s) => s.x === final.x && s.z === final.z)).toBe(true);
});

test('puddles never dodge', () => {
  const win = fakeWin();
  const m = make({ petStay: 60 }, { win, activeRolls: () => 0 });
  m.layer.areaChanged(STAGE_BIG);
  rollToRest(m, 'u1');
  hitFrom(m, 'u1', HARD);
  runTo(m, clockNow + 1300);
  expect(phaseOf(m)).toBe('puddle');
  const was = posOf(m);
  m.deps.wake.mockClear();
  pointAt(win, was.x, was.z);
  expect(m.deps.wake).not.toHaveBeenCalled();
  for (let i = 0; i < 20; i++) m.layer.update((clockNow += 16));
  expect(phaseOf(m)).toBe('puddle');
  expect(posOf(m)).toEqual(was);
});

test('pointer outside the stage, or over the sidebar, is ignored', () => {
  const { m, win } = dodgeMake();
  rollToRest(m, 'u1');
  const was = posOf(m);
  // the latest pointer is what counts: near the pet, then out over the sidebar (off the stage)
  pointAt(win, was.x, was.z);
  win.handlers.get('pointermove').fn({ clientX: STAGE_BIG.rect.width + 40, clientY: 100, target: null });
  for (let i = 0; i < 20; i++) m.layer.update((clockNow += 16));
  expect(posOf(m)).toEqual(was);
  // an element of the sidebar or chat drawn over the stage
  const overChat = { closest: (sel) => (sel.includes('#chat') ? {} : null) };
  m.deps.wake.mockClear();
  pointAt(win, was.x, was.z, overChat);
  expect(m.deps.wake).not.toHaveBeenCalled();
  for (let i = 0; i < 20; i++) m.layer.update((clockNow += 16));
  expect(posOf(m)).toEqual(was);
  // no stage rect yet: ignored, never a throw
  const bare = make({ petStay: 60 }, { win: fakeWin() });
  expect(() => bare.deps.win.handlers.get('pointermove').fn({ clientX: 5, clientY: 5 })).not.toThrow();
});

test('obstaclesFor reports a moving pet at its destination; a throw mid-dodge keeps it', () => {
  const { m, win } = dodgeMake();
  rollToRest(m, 'u1');
  const was = posOf(m);
  pointAt(win, was.x, was.z);
  m.layer.update((clockNow += 16));
  m.layer.update((clockNow += 100));
  expect(phaseOf(m)).toBe('move');
  const [other] = m.layer.obstaclesFor({ spec: spec('u2'), edge: 1, area: BIG }).filter((o) => o.id === 'u1');
  const [own] = m.layer.obstaclesFor({ spec: spec('u1'), edge: 0, area: BIG });
  expect(dist(other, was)).toBeGreaterThanOrEqual(4 - 1e-9);
  expect(own.x).toBe(other.x);
  expect(own.z).toBe(other.z);
  // the owner's throw starts mid-dodge: the pet watches it from that destination
  m.layer.begin('mid', bigInfo(spec('u1'), 0));
  m.layer.update(clockNow);
  runTo(m, clockNow + 500);
  expect(posOf(m).x).toBeCloseTo(own.x, 6);
  expect(posOf(m).z).toBeCloseTo(own.z, 6);
});

test('dispose removes the listener', () => {
  const { m, win } = dodgeMake();
  const added = win.addEventListener.mock.calls.find(([type]) => type === 'pointermove');
  expect(added).toBeTruthy();
  expect(added[2]).toEqual(expect.objectContaining({ passive: true }));
  const fn = added[1];
  m.layer.dispose();
  expect(win.removeEventListener).toHaveBeenCalledWith('pointermove', fn, expect.anything());
  m.deps.wake.mockClear();
  expect(() => fn({ clientX: 10, clientY: 10, target: null })).not.toThrow();
  expect(m.deps.wake).not.toHaveBeenCalled();
});

// ---- dodge polish (Task 2 review) ----
test('a pointer in reach during a roll wakes nothing per move', () => {
  const { m, win, rolls } = dodgeMake();
  rollToRest(m, 'u1');
  const was = posOf(m);
  rolls.n = 1;
  m.deps.wake.mockClear();
  for (let i = 0; i < 5; i++) pointAt(win, was.x + 0.1 * i, was.z);
  expect(m.deps.wake).not.toHaveBeenCalled();
});

test('the last roll ending wakes the loop for a dodge held back by it (a still cursor)', () => {
  const { m, win, rolls } = dodgeMake();
  rollToRest(m, 'u1');
  const was = posOf(m);
  rolls.n = 1;
  pointAt(win, was.x, was.z);
  m.layer.update((clockNow += 16)); // held back by the roll, then the loop holds
  rolls.n = 0; // DiceBox takes the roll off its list, then ends it
  m.deps.wake.mockClear();
  m.layer.end('some-roll');
  expect(m.deps.wake).toHaveBeenCalled();
  expect(m.layer.update((clockNow += 16))).toBe(true);
  runTo(m, clockNow + 800);
  expect(dist(posOf(m), was)).toBeGreaterThanOrEqual(4 - 1e-9);
  // nothing pending: a roll ending wakes nothing
  rolls.n = 0;
  m.deps.wake.mockClear();
  m.layer.end('another');
  expect(m.deps.wake).not.toHaveBeenCalled();
});

test('the pointer target is asked about the sidebar or chat only when a pet would dodge', () => {
  const { m, win } = dodgeMake();
  rollToRest(m, 'u1');
  const was = posOf(m);
  const target = { closest: vi.fn(() => null) };
  pointAt(win, was.x + 7, was.z, target); // far: no DOM call
  expect(target.closest).not.toHaveBeenCalled();
  pointAt(win, was.x, was.z, target);
  expect(target.closest).toHaveBeenCalledTimes(1);
});

// ---- final review fixes ----
const busyMake = () => {
  const timers = fakeTimers();
  const win = fakeWin();
  const rolls = { n: 0 };
  const m = make(
    { petStay: 60 },
    { setTimer: timers.setTimer, clearTimer: timers.clearTimer, activeRolls: () => rolls.n, win, random: mulberry(5) },
  );
  m.layer.areaChanged(STAGE_BIG);
  return { m, timers, rolls, win };
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

test('a pet that comes to rest beside a parked cursor gets out of its way', () => {
  const first = dodgeMake();
  rollToRest(first.m, 'u1');
  const spot = posOf(first.m); // the same seed rests the next pet here
  const { m, win } = dodgeMake();
  pointAt(win, spot.x, spot.z); // the cursor waits where the pet will sit, and never moves again
  rollToRest(m, 'u1');
  runTo(m, clockNow + 800);
  expect(dist(posOf(m), spot)).toBeGreaterThanOrEqual(4 - 1e-9);
});

test('the cursor leaving the window, or the window losing focus, drops the pointer', () => {
  for (const leave of [
    (win) => win.handlers.get('pointerout').fn({ relatedTarget: null }),
    (win) => win.handlers.get('blur').fn({}),
  ]) {
    const { m, win, rolls } = dodgeMake();
    rollToRest(m, 'u1');
    const was = posOf(m);
    rolls.n = 1;
    pointAt(win, was.x, was.z); // held back by the roll
    win.handlers.get('pointerout').fn({ relatedTarget: {} }); // moving between elements: still there
    leave(win);
    rolls.n = 0;
    for (let i = 0; i < 20; i++) m.layer.update((clockNow += 16));
    expect(posOf(m)).toEqual(was);
    m.layer.dispose();
    for (const type of ['pointermove', 'pointerout', 'blur'])
      expect(win.removeEventListener).toHaveBeenCalledWith(type, expect.any(Function), expect.anything());
  }
});

test('pointerout to another element keeps the pointer (a held-back dodge still happens)', () => {
  const { m, win, rolls } = dodgeMake();
  rollToRest(m, 'u1');
  const was = posOf(m);
  rolls.n = 1;
  pointAt(win, was.x, was.z);
  win.handlers.get('pointerout').fn({ relatedTarget: {} });
  rolls.n = 0;
  m.layer.update((clockNow += 16));
  runTo(m, clockNow + 800);
  expect(dist(posOf(m), was)).toBeGreaterThanOrEqual(4 - 1e-9);
});

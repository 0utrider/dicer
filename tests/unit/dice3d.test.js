import { createDice3dApi, materialReadyNotifier } from '../../src/api/dice3d.js';
import { planThrow } from '../../src/throw/throw-planner.js';
import { createRegistry } from '../../src/compat/registry.js';
import { buildScene } from '../../src/render/scene.js';

function fakeDiceBox() {
  const rolls = [];
  return {
    rolls,
    get activeRolls() {
      return rolls.length;
    },
    roll: vi.fn((specs) => {
      let resolve;
      const landed = new Promise((r) => (resolve = r));
      rolls.push({ specs, resolve });
      return { landed, finished: landed };
    }),
  };
}

const roll = (faces, result) => ({ dice: [{ faces, results: [{ result, active: true }] }] });

let diceBox, gate, api, settings;
beforeEach(() => {
  diceBox = fakeDiceBox();
  gate = { disabled: false, waitFor: vi.fn(async () => true) };
  settings = { enabled: true, maxDice: 20 };
  api = createDice3dApi({
    diceBox,
    gate,
    planThrow,
    getSetting: (k) => settings[k],
    renderer: { isLooping: true },
  });
});

test('showExtraDiceByDefault follows the showExtraDice setting (unset counts as on)', () => {
  expect(api.showExtraDiceByDefault()).toBe(true);
  settings.showExtraDice = false;
  expect(api.showExtraDiceByDefault()).toBe(false);
  settings.showExtraDice = true;
  expect(api.showExtraDiceByDefault()).toBe(true);
});

test('isEnabled follows the enabled setting', () => {
  expect(api.isEnabled()).toBe(true);
  settings.enabled = false;
  expect(api.isEnabled()).toBe(false);
});

test('showForRoll resolves true after landing', async () => {
  let result = null;
  api.showForRoll(roll(20, 12)).then((v) => (result = v));
  await Promise.resolve();
  expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 12 }]);
  expect(result).toBe(null);
  diceBox.rolls[0].resolve();
  await new Promise((r) => setTimeout(r, 0));
  expect(result).toBe(true);
});

test('showForRoll decorates with the given user (or the local user) as author', async () => {
  const decorateFor = vi.fn(() => () => ({ appearance: { tag: 'x' } }));
  globalThis.game = { user: { id: 'me' } };
  try {
    const a = createDice3dApi({
      diceBox,
      gate,
      planThrow,
      getSetting: (k) => settings[k],
      decorateFor,
    });
    const r = roll(20, 4);
    a.showForRoll(r, { id: 'remote' });
    expect(decorateFor).toHaveBeenLastCalledWith(null, r, 'remote');
    expect(diceBox.roll).toHaveBeenLastCalledWith([
      { type: 'd20', value: 4, appearance: { tag: 'x' } },
    ]);
    a.showForRoll(r);
    expect(decorateFor).toHaveBeenLastCalledWith(null, r, 'me');
  } finally {
    delete globalThis.game;
  }
});

test('showForRoll resolves false for blind', async () => {
  await expect(api.showForRoll(roll(20, 12), {}, false, null, true)).resolves.toBe(false);
  expect(diceBox.roll).not.toHaveBeenCalled();
});

test('showForRoll resolves false for a roll with only d7s', async () => {
  await expect(api.showForRoll(roll(7, 3))).resolves.toBe(false);
  expect(diceBox.roll).not.toHaveBeenCalled();
});

test('showForRoll resolves false when diceBox.roll throws', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  diceBox.roll.mockImplementation(() => {
    throw new Error('boom');
  });
  await expect(api.showForRoll(roll(20, 1))).resolves.toBe(false);
  spy.mockRestore();
});

test('waitFor3DAnimationByMessageID delegates to gate.waitFor', async () => {
  await expect(api.waitFor3DAnimationByMessageID('m1')).resolves.toBe(true);
  expect(gate.waitFor).toHaveBeenCalledWith('m1');
});

test('messageHookDisabled proxies gate.disabled', () => {
  expect(api.messageHookDisabled).toBe(false);
  api.messageHookDisabled = true;
  expect(gate.disabled).toBe(true);
  gate.disabled = false;
  expect(api.messageHookDisabled).toBe(false);
});

test('_debug exposes isLooping and activeRolls', () => {
  expect(api._debug.isLooping).toBe(true);
  expect(api._debug.activeRolls).toBe(0);
  api.showForRoll(roll(6, 2));
  expect(api._debug.activeRolls).toBe(1);
});

test('showForRoll resolves false without rolling when the enabled setting is off', async () => {
  settings.enabled = false;
  await expect(api.showForRoll(roll(20, 12))).resolves.toBe(false);
  expect(diceBox.roll).not.toHaveBeenCalled();
});

describe('Task 12: the full game.dice3d surface', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const METHODS = [
    'addSystem',
    'addDicePreset',
    'addDiceShape',
    'addColorset',
    'addTexture',
    'addDamageTypeDefaults',
    'addRole',
    'getRole',
    'getRoles',
    'addSFXTrigger',
    'addSFXDefaults',
    'addSFXMode',
    'getSFXModes',
    'preloadPresets',
    'loadSaveFile',
    'getLoadedDiceSystems',
    'setMessageUpdateHideSelector',
    'showForRoll',
    'animateRoll',
    'show',
    'showExtraDiceByDefault',
    'waitFor3DAnimationByMessageID',
    'getScreenPosition',
    'isEnabled',
    'enableDebugMode',
  ];
  const OBJECTS = ['DiceFactory', 'box', 'uniforms', 'config', 'exports'];

  let registry, hooks, me, renderer, faceTextures, facesFor, importMigration, a;
  const make = (extra = {}) =>
    createDice3dApi({
      diceBox,
      gate,
      planThrow,
      getSetting: (k) => settings[k],
      renderer,
      registry,
      hooks,
      currentUser: () => me,
      gmIds: () => ['gm'],
      faceTextures,
      facesFor,
      importMigration,
      ...extra,
    });
  beforeEach(() => {
    registry = createRegistry({ warn: () => {}, loadModel: vi.fn(async () => ({})) });
    hooks = { callAll: vi.fn(), on: vi.fn() };
    me = { id: 'p1', isGM: false };
    const canvas = { id: 'dicer-canvas' };
    renderer = { isLooping: false, startLoop: vi.fn(), canvas, camera: null };
    faceTextures = { acquire: vi.fn(async () => ({ texture: {} })), release: vi.fn() };
    facesFor = vi.fn((preset) => ({
      key: `faces:${preset.type}`,
      labels: preset.labels.map((l) => ({ kind: 'image', url: l })),
    }));
    importMigration = undefined;
    a = make();
  });

  test('contract: every G1 member exists with the right kind', () => {
    for (const name of METHODS) expect(typeof a[name], name).toBe('function');
    for (const name of OBJECTS) expect(a[name], name).toEqual(expect.any(Object));
    expect(typeof a.messageHookDisabled).toBe('boolean');
    expect(a.canvas).toBe(renderer.canvas);
    expect(a.DiceSystem).toBeNull();
    // Positional callers: DSN code calls these with at least their first argument.
    expect(a.showForRoll.length).toBeGreaterThanOrEqual(1);
    expect(a.addDicePreset.length).toBeGreaterThanOrEqual(1);
  });

  test("the ready argument passes pf2e's duck-type check", () => {
    for (const name of ['addSystem', 'addDicePreset', 'addTexture', 'addColorset']) {
      expect(name in a).toBe(true);
    }
  });

  test('the registration stubs are gone: add* and get* delegate to the registry', async () => {
    a.addSystem({ id: 'pf2e', name: 'PF2e' }, 'preferred');
    expect(a.getLoadedDiceSystems()).toBe(registry.systems);
    expect(registry.systems.get('pf2e').mode).toBe('preferred');
    await expect(a.addDicePreset({ type: 'd20', labels: [], system: 'pf2e' })).resolves.toBeUndefined();
    expect(registry.presetFor('pf2e', 'd20')).not.toBeNull();
    await a.addColorset({ name: 'mine', foreground: '#fff', background: '#000' });
    expect(registry.colorsets.has('mine')).toBe(true);
    await a.addTexture('stone', { name: 'Stone', source: 'x.webp' });
    expect(registry.textures.has('stone')).toBe(true);
    a.addDiceShape({ name: 'dh.r', faces: new Array(12).fill([]) });
    expect(registry.baseShape('dh.r')).toBe('d12');
    a.addRole({ id: 'boss' }, { package: 'p' });
    expect(a.getRole('boss')).toMatchObject({ id: 'boss', package: 'p' });
    expect(a.getRoles()).toHaveLength(1);
    a.addDamageTypeDefaults({ fire: 'fire' });
    expect(registry.damageTypeDefaults.fire).toBe('fire');
    a.addSFXTrigger('t', 'T', ['20']);
    expect(registry.sfxTriggers.has('t')).toBe(true);
    class Boom {
      static id = 'Boom';
    }
    a.addSFXMode(Boom);
    expect(a.getSFXModes()).toEqual({ Boom: 'Boom' });
    a.addSFXDefaults(['x']);
    expect(registry.getSFXDefaults()).toEqual(['x']);
    expect(a.DiceFactory).toBe(registry.diceFactory);
    expect(a.exports).toBe(registry.exports);
  });

  test('malformed registration calls never throw; async members still resolve', async () => {
    const throwing = new Proxy({}, { get: () => () => { throw new Error('boom'); } });
    a = make({ registry: throwing });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => a.addSystem(null)).not.toThrow();
    await expect(a.addDicePreset(null)).resolves.toBeUndefined();
    await expect(a.addColorset(null)).resolves.toBeUndefined();
    expect(() => a.getRoles()).not.toThrow();
    warn.mockRestore();
  });

  test('config is a live read-only view of the settings', () => {
    settings.timeBeforeHide = 2000;
    settings.showGhostDice = false;
    settings.immediatelyDisplayChatMessages = true;
    expect(a.config).toMatchObject({
      enabled: true,
      maxDice: 20,
      hideAfterRoll: true,
      showGhostDice: false,
      immediatelyDisplayChatMessages: true,
    });
    settings.enabled = false;
    settings.timeBeforeHide = 0;
    expect(a.config.enabled).toBe(false);
    expect(a.config.hideAfterRoll).toBe(false);
    expect(() => (a.config.enabled = true)).not.toThrow();
    expect(a.config.enabled).toBe(false);
  });

  test('uniforms accepts any write; moonPhase defaults to 0', () => {
    expect(a.uniforms.moonPhase).toBe(0);
    expect(() => (a.uniforms.foo = 1)).not.toThrow();
    expect(a.uniforms.foo).toBe(1);
    expect(a.box).toEqual({});
  });

  test('DiceSystem reads globalThis.DicerAPI lazily', () => {
    class DiceSystem {}
    globalThis.DicerAPI = { DiceSystem };
    try {
      expect(a.DiceSystem).toBe(DiceSystem);
    } finally {
      delete globalThis.DicerAPI;
    }
    expect(a.DiceSystem).toBeNull();
  });

  test("loadSaveFile('missing') warns and resolves while migration.js is absent", async () => {
    a = make({ importMigration: undefined });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(a.loadSaveFile('missing')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('loadSaveFile delegates to migration.loadSaveFile(user, name); a failure warns', async () => {
    const loadSaveFile = vi.fn(async () => {});
    a = make({ importMigration: async () => ({ loadSaveFile }) });
    await expect(a.loadSaveFile('Old dice')).resolves.toBeUndefined();
    expect(loadSaveFile).toHaveBeenCalledWith(me, 'Old dice');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    a = make({ importMigration: async () => ({}) }); // no such export yet
    await expect(a.loadSaveFile('x')).resolves.toBeUndefined();
    a = make({ importMigration: async () => ({ loadSaveFile: () => Promise.reject(new Error('x')) }) });
    await expect(a.loadSaveFile('x')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  test('getScreenPosition maps the area centre to the area-rect centre', () => {
    const sceneApi = buildScene();
    sceneApi.fitArea({ halfWidth: 10, halfDepth: 5 });
    renderer.camera = sceneApi.camera;
    const rect = { left: 100, top: 50, width: 960, height: 480 };
    a = make({ getArea: () => rect });
    const centre = a.getScreenPosition({ x: 0, y: 0, z: 0 });
    expect(centre.x).toBeCloseTo(580);
    expect(centre.y).toBeCloseTo(290);
    // The floor's right and bottom edges (screen-up is -Z).
    const corner = a.getScreenPosition({ x: 10, y: 0, z: 5 });
    expect(corner.x).toBeCloseTo(1060);
    expect(corner.y).toBeCloseTo(530);
  });

  test('getScreenPosition with a malformed vector warns once and returns a point', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderer.camera = buildScene().camera;
    a = make({ getArea: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    expect(a.getScreenPosition(null)).toEqual({ x: 0, y: 0 });
    expect(a.getScreenPosition('x')).toEqual({ x: 0, y: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  describe('preloadPresets', () => {
    const userWith = (flag) => ({ id: 'p1', isGM: false, flags: { dicer: { appearance: flag } } });
    beforeEach(async () => {
      await registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: ['a.png'], modelFile: 'm.glb' });
      await registry.addDicePreset({ type: 'd6', system: 'other', labels: ['b.png'] });
    });

    test('loads the faces and models of a referenced preset and never starts the loop', async () => {
      me = userWith({ global: { system: 'pf2e' } });
      a = make();
      await expect(a.preloadPresets()).resolves.toBeUndefined();
      expect(faceTextures.acquire).toHaveBeenCalledTimes(1);
      const [faces] = faceTextures.acquire.mock.calls[0];
      expect(faces.key).toBe('faces:d20');
      expect(faces.labels[0]).toEqual({ kind: 'image', url: 'a.png' });
      expect(facesFor).toHaveBeenCalledWith(registry.presetFor('pf2e', 'd20'));
      expect(registry.presetFor('pf2e', 'd20').modelLoaded).toBe(true);
      expect(renderer.startLoop).not.toHaveBeenCalled();
    });

    test('holds the preloaded faces until the next look change', async () => {
      me = userWith({ global: { system: 'pf2e' } });
      a = make();
      await a.preloadPresets();
      await a.preloadPresets(); // already held: not acquired twice
      expect(faceTextures.acquire).toHaveBeenCalledTimes(1);
      expect(faceTextures.release).not.toHaveBeenCalled();
      a._releasePreloads();
      expect(faceTextures.release).toHaveBeenCalledTimes(1);
      a._releasePreloads();
      expect(faceTextures.release).toHaveBeenCalledTimes(1);
    });

    test('a later preload releases faces no look references any more', async () => {
      me = userWith({ global: { system: 'pf2e' } });
      a = make();
      await a.preloadPresets();
      me.flags.dicer.appearance = { global: { system: 'other' } };
      await a.preloadPresets();
      expect(faceTextures.acquire).toHaveBeenCalledTimes(2);
      expect(faceTextures.release).toHaveBeenCalledWith(expect.objectContaining({ key: 'faces:d20' }));
    });

    test('withTextures false loads models only; presetFaces/presetModels off skip theirs', async () => {
      me = userWith({ global: { system: 'pf2e' } });
      a = make();
      await a.preloadPresets(false);
      expect(faceTextures.acquire).not.toHaveBeenCalled();
      expect(registry.presetFor('pf2e', 'd20').modelLoaded).toBe(true);
      settings.presetFaces = false;
      await a.preloadPresets(true);
      expect(faceTextures.acquire).not.toHaveBeenCalled();
    });

    test('a user with no system refs preloads the standard system only', async () => {
      await registry.addDicePreset({ type: 'd8', labels: ['c.png'] });
      me = userWith(undefined);
      a = make();
      await a.preloadPresets();
      expect(faceTextures.acquire).toHaveBeenCalledTimes(1);
      expect(faceTextures.acquire.mock.calls[0][0].key).toBe('faces:d8');
    });

    test('a throwing loader never rejects', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      me = userWith({ global: { system: 'pf2e' } });
      faceTextures.acquire = vi.fn(() => {
        throw new Error('gpu');
      });
      a = make({ facesFor: () => ({ key: 'k', labels: [{ kind: 'image', url: 'a.png' }] }) });
      await expect(a.preloadPresets()).resolves.toBeUndefined();
      warn.mockRestore();
    });
  });

  test('enableDebugMode sets _debug.verbose and logs gate decisions', () => {
    const log = vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(a._debug.verbose).toBe(false);
    a.enableDebugMode();
    expect(a._debug.verbose).toBe(true);
    const listened = hooks.on.mock.calls.map(([name]) => name);
    expect(listened).toEqual(
      expect.arrayContaining(['diceSoNiceMessageProcessed', 'diceSoNiceRollStart', 'diceSoNiceRollComplete']),
    );
    const processed = hooks.on.mock.calls.find(([n]) => n === 'diceSoNiceMessageProcessed')[1];
    processed('m1', { willTrigger3DRoll: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('dicer'), 'diceSoNiceMessageProcessed', 'm1', {
      willTrigger3DRoll: true,
    });
    a.enableDebugMode(); // idempotent: listeners registered once
    expect(hooks.on.mock.calls.filter(([n]) => n === 'diceSoNiceMessageProcessed')).toHaveLength(1);
    log.mockRestore();
  });

  test('verbose mode logs the showForRoll view decision', async () => {
    const log = vi.spyOn(console, 'debug').mockImplementation(() => {});
    a.enableDebugMode();
    await a.showForRoll(roll(20, 3), me, false, null, true);
    expect(log.mock.calls.some((args) => args.includes('none'))).toBe(true);
    log.mockRestore();
    await flush();
  });
});

describe('materialReadyNotifier (P3-R3)', () => {
  test('fires diceSoNiceOnMaterialReady only for a preset of a non-standard system', () => {
    const hooks = { callAll: vi.fn() };
    const notify = materialReadyNotifier(hooks);
    const material = {};
    const appearance = { tag: 'a' };
    notify(material, 'd20', appearance, { system: 'pf2e', type: 'd20' });
    notify(material, 'd20', appearance, { system: 'standard', type: 'd20' });
    notify(material, 'd20', appearance, null);
    expect(hooks.callAll.mock.calls).toEqual([['diceSoNiceOnMaterialReady', material, 'd20', appearance]]);
  });

  test('a throwing listener never reaches the die', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notify = materialReadyNotifier({
      callAll: () => {
        throw new Error('x');
      },
    });
    expect(() => notify({}, 'd20', {}, { system: 'pf2e' })).not.toThrow();
    err.mockRestore();
  });
});

describe('setMessageUpdateHideSelector', () => {
  test('passes the selector to the gate and returns nothing', () => {
    gate.setUpdateHideSelector = vi.fn(() => true);
    expect(api.setMessageUpdateHideSelector('.dice-roll')).toBeUndefined();
    expect(api.setMessageUpdateHideSelector(null)).toBeUndefined();
    expect(gate.setUpdateHideSelector.mock.calls).toEqual([['.dice-roll'], [null]]);
  });

  test('a rejected selector logs one warning per member and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gate.setUpdateHideSelector = vi.fn(() => false);
    expect(() => api.setMessageUpdateHideSelector(42)).not.toThrow();
    gate.setUpdateHideSelector = vi.fn(() => {
      throw new Error('x');
    });
    expect(() => api.setMessageUpdateHideSelector('div[')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('Task 11: showForRoll privacy, hooks, show and animateRoll', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  let hooks, me, a;
  const make = (extra = {}) =>
    createDice3dApi({
      diceBox,
      gate,
      planThrow,
      getSetting: (k) => settings[k],
      hooks,
      currentUser: () => me,
      gmIds: () => ['gm'],
      ...extra,
    });
  beforeEach(() => {
    hooks = { callAll: vi.fn() };
    me = { id: 'p1', isGM: false };
    a = make();
  });
  const calls = (name) => hooks.callAll.mock.calls.filter(([n]) => n === name);

  test('a blind showForRoll on a player client throws nothing when showGhostDice is off', async () => {
    await expect(a.showForRoll(roll(20, 12), me, false, null, true)).resolves.toBe(false);
    expect(diceBox.roll).not.toHaveBeenCalled();
  });

  test('a blind showForRoll on a player client throws ghosts when showGhostDice is on', async () => {
    settings.showGhostDice = true;
    const decorateFor = vi.fn(() => () => ({ appearance: { tag: 'real' } }));
    a = make({ decorateFor });
    const p = a.showForRoll(roll(20, 12), me, false, null, true);
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 12, ghost: true }]);
    expect(decorateFor).not.toHaveBeenCalled(); // a ghost never resolves its real look
    diceBox.rolls[0].resolve();
    await expect(p).resolves.toBe(true);
  });

  test('a blind showForRoll on the GM client shows the real dice', async () => {
    me = { id: 'gm', isGM: true };
    a.showForRoll(roll(20, 12), me, false, null, true);
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 12 }]);
  });

  test('options.ghost and roll.ghost throw ghosts; options.secret hides from a player', async () => {
    a.showForRoll(roll(6, 2), me, false, null, false, null, null, { ghost: true });
    a.animateRoll({ ...roll(6, 3), ghost: true });
    await Promise.resolve();
    expect(diceBox.roll.mock.calls).toEqual([
      [[{ type: 'd6', value: 2, ghost: true }]],
      [[{ type: 'd6', value: 3, ghost: true }]],
    ]);
    await expect(a.animateRoll(roll(6, 4), { secret: true })).resolves.toBe(false);
    expect(diceBox.roll).toHaveBeenCalledTimes(2);
  });

  test('showExtra follows the showExtraDice setting', async () => {
    settings.showExtraDice = false;
    const r = {
      dice: [
        {
          faces: 20,
          results: [
            { result: 3, active: true },
            { result: 17, active: false, discarded: true },
          ],
        },
      ],
    };
    a.showForRoll(r, me);
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 3 }]);
  });

  test('animateRoll animates locally like showForRoll without sync', async () => {
    const p = a.animateRoll(roll(8, 5));
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd8', value: 5 }]);
    diceBox.rolls[0].resolve();
    await expect(p).resolves.toBe(true);
  });

  test('show(legacy) throws 2 dice for a 2-die legacy payload', async () => {
    const p = a.show(
      { throws: [{ dice: [{ type: 'd20', result: 7, resultLabel: '7' }, { type: 'd6', result: 2 }] }] },
      me,
    );
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([
      { type: 'd20', value: 7 },
      { type: 'd6', value: 2 },
    ]);
    diceBox.rolls[0].resolve();
    await expect(p).resolves.toBe(true);
  });

  test('show(legacy) maps d100 and dc', async () => {
    a.show({ throws: [{ dice: [{ type: 'd100', result: 42 }] }, { dice: [{ type: 'dc', result: 2 }] }] }, me);
    await Promise.resolve();
    const [specs] = diceBox.roll.mock.calls[0];
    expect(specs.map((d) => d.type)).toEqual(['d10', 'd10', 'd2']);
  });

  test('show() with a malformed payload warns once and resolves false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(a.show(null)).resolves.toBe(false);
    await expect(a.show({ throws: 'x' })).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(diceBox.roll).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('showForRoll with a malformed roll warns once and resolves false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(a.showForRoll(null)).resolves.toBe(false);
    await expect(a.showForRoll('1d20')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('waitFor3DAnimationByMessageID("m1") resolves only after a showForRoll with m1 lands', async () => {
    a.showForRoll(roll(20, 12), me, false, null, false, 'm1');
    let done = false;
    a.waitFor3DAnimationByMessageID('m1').then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    diceBox.rolls[0].resolve();
    await flush();
    expect(done).toBe(true);
    // settled: a later wait on m1 resolves at once (only the gate's promise remains)
    await expect(a.waitFor3DAnimationByMessageID('m1')).resolves.toBe(true);
  });

  test('waitFor3DAnimationByMessageID also waits on the gate', async () => {
    let release;
    gate.waitFor = vi.fn(() => new Promise((r) => (release = r)));
    let done = false;
    a.waitFor3DAnimationByMessageID('m2').then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    release(true);
    await flush();
    expect(done).toBe(true);
  });

  test('without a messageID no hooks fire', async () => {
    const p = a.showForRoll(roll(20, 1), me);
    await Promise.resolve();
    diceBox.rolls[0].resolve();
    await p;
    expect(hooks.callAll).not.toHaveBeenCalled();
  });

  test('with a messageID RollStart fires before the throw and RollComplete once after landing', async () => {
    const r = roll(20, 1);
    let thrownBeforeStart = null;
    hooks.callAll.mockImplementation((name) => {
      if (name === 'diceSoNiceRollStart') thrownBeforeStart = diceBox.roll.mock.calls.length > 0;
    });
    const p = a.showForRoll(r, me, false, ['p1'], false, 'm1');
    expect(calls('diceSoNiceRollStart')).toEqual([
      ['diceSoNiceRollStart', 'm1', { roll: r, user: me, users: ['p1'], blind: false, dsnRoll: r }],
    ]);
    expect(thrownBeforeStart).toBe(false);
    await Promise.resolve();
    expect(calls('diceSoNiceRollComplete')).toHaveLength(0);
    diceBox.rolls[0].resolve();
    await p;
    expect(calls('diceSoNiceRollComplete')).toEqual([['diceSoNiceRollComplete', 'm1', []]]);
  });

  test('RollComplete fires once when nothing animated or the throw fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await a.showForRoll(roll(7, 3), me, false, null, false, 'none');
    diceBox.roll.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await a.showForRoll(roll(20, 3), me, false, null, false, 'fail');
    diceBox.roll.mockImplementationOnce(() => ({ landed: Promise.reject(new Error('lost')) }));
    await a.showForRoll(roll(20, 3), me, false, null, false, 'reject');
    expect(calls('diceSoNiceRollComplete').map(([, id]) => id)).toEqual(['none', 'fail', 'reject']);
    err.mockRestore();
  });

  test('a RollStart listener setting context.blind makes the call blind (P3-R13)', async () => {
    const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    hooks.callAll.mockImplementation((name, id, ctx) => {
      if (name === 'diceSoNiceRollStart') ctx.blind = true;
    });
    // a player: nothing drawn locally; the payload carries blind and goes to the GMs only
    a = make({ socket });
    await expect(a.showForRoll(roll(20, 3), me, true, null, false, 'm1')).resolves.toBe(false);
    expect(diceBox.roll).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit.mock.calls[0][1]).toMatchObject({ blind: true });
    expect(socket.emit.mock.calls[0][2]).toEqual({ recipients: ['gm'] });
    expect(calls('diceSoNiceRollComplete')).toHaveLength(1);
    // a GM: the real dice
    me = { id: 'gm', isGM: true };
    a.showForRoll(roll(20, 4), me, false, null, false, 'm2');
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 4 }]);
  });

  test('a RollStart listener can only narrow users (P3-R13)', async () => {
    const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    a = make({ socket });
    const sentUsers = () => socket.emit.mock.calls.at(-1)[1].users;
    const listen = (fn) =>
      hooks.callAll.mockImplementation((name, id, ctx) => {
        if (name === 'diceSoNiceRollStart') fn(ctx);
      });

    listen((ctx) => (ctx.users = ['b', 'c'])); // intersected
    a.showForRoll(roll(6, 1), me, true, ['a', 'b'], false, 'm1');
    expect(sentUsers()).toEqual(['b']);
    expect(socket.emit.mock.calls.at(-1)[2]).toEqual({ recipients: ['gm', 'b'] });

    listen((ctx) => (ctx.users = ['b'])); // null -> array narrows
    a.showForRoll(roll(6, 1), me, true, null, false, 'm2');
    expect(sentUsers()).toEqual(['b']);

    listen((ctx) => (ctx.users = null)); // never widens to everyone
    a.showForRoll(roll(6, 1), me, true, ['a'], false, 'm3');
    expect(sentUsers()).toEqual(['a']);

    listen((ctx) => ctx.users.push('z')); // an in-place push cannot widen either
    a.showForRoll(roll(6, 1), me, true, ['a'], false, 'm4');
    expect(sentUsers()).toEqual(['a']);

    listen((ctx) => (ctx.users = ['q'])); // disjoint: nobody, not everyone
    a.showForRoll(roll(6, 1), me, true, ['a'], false, 'm5');
    expect(sentUsers()).toEqual([]);
  });

  test('a disabled sender emits, fires both hooks once and draws nothing (P3-R11)', async () => {
    const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    a = make({ socket });
    settings.enabled = false;
    await expect(a.showForRoll(roll(20, 3), me, true, null, false, 'm1')).resolves.toBe(false);
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(calls('diceSoNiceRollStart')).toHaveLength(1);
    expect(calls('diceSoNiceRollComplete')).toEqual([['diceSoNiceRollComplete', 'm1', []]]);
    expect(diceBox.roll).not.toHaveBeenCalled();
  });

  test('a RollStart listener waiting on the messageID waits for this showForRoll', async () => {
    let done = false;
    hooks.callAll.mockImplementation((name, id) => {
      if (name === 'diceSoNiceRollStart') a.waitFor3DAnimationByMessageID(id).then(() => (done = true));
    });
    a.showForRoll(roll(20, 3), me, false, null, false, 'm1');
    await flush();
    expect(done).toBe(false);
    diceBox.rolls[0].resolve();
    await flush();
    expect(done).toBe(true);
  });

  test('restricted payloads with no GM to receive them are not sent', () => {
    const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    a = make({ socket, gmIds: () => [] });
    a.showForRoll(roll(20, 3), me, true, null, false, null, null, { secret: true });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  test('a RollStart listener cannot un-blind a blind roll', async () => {
    hooks.callAll.mockImplementation((name, id, ctx) => {
      if (name === 'diceSoNiceRollStart') ctx.blind = false;
    });
    await expect(a.showForRoll(roll(20, 3), me, false, null, true, 'm1')).resolves.toBe(false);
    expect(diceBox.roll).not.toHaveBeenCalled();
  });

  test('a ghost or secret flag set during RollStart applies to the whole showForRoll', async () => {
    const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    me = { id: 'gm', isGM: true };
    a = make({ socket });
    hooks.callAll.mockImplementation((name, id, ctx) => {
      if (name === 'diceSoNiceRollStart') ctx.roll.ghost = true;
    });
    a.showForRoll(roll(20, 3), me, true, null, false, 'm1');
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd20', value: 3, ghost: true }]);
    expect(socket.emit.mock.calls[0][1]).toMatchObject({ ghost: true });

    me = { id: 'p1', isGM: false };
    hooks.callAll.mockImplementation((name, id, ctx) => {
      if (name === 'diceSoNiceRollStart') ctx.dsnRoll = { ...ctx.roll, secret: true };
    });
    await expect(a.showForRoll(roll(20, 4), me, true, null, false, 'm2')).resolves.toBe(false);
    expect(socket.emit.mock.calls[1][1]).toMatchObject({ secret: true });
  });

  test('a RollStart listener can replace the thrown roll through dsnRoll', async () => {
    hooks.callAll.mockImplementation((name, id, ctx) => {
      if (name === 'diceSoNiceRollStart') ctx.dsnRoll = roll(12, 9);
    });
    a.showForRoll(roll(20, 3), me, false, null, false, 'm1');
    await Promise.resolve();
    expect(diceBox.roll).toHaveBeenCalledWith([{ type: 'd12', value: 9 }]);
  });

  test('a throwing RollStart listener still throws the dice and fires RollComplete', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    hooks.callAll.mockImplementation((name) => {
      if (name === 'diceSoNiceRollStart') throw new Error('listener');
    });
    const p = a.showForRoll(roll(20, 3), me, false, null, false, 'm1');
    await Promise.resolve();
    diceBox.rolls[0].resolve();
    await expect(p).resolves.toBe(true);
    expect(calls('diceSoNiceRollComplete')).toHaveLength(1);
    err.mockRestore();
  });
});

test('_debug.lastRollViews reads the gate record and survives a gate without it', () => {
  gate.recentViews = () => ({ m1: ['ghost'] });
  expect(api._debug.lastRollViews).toEqual({ m1: ['ghost'] });
  gate.recentViews = () => {
    throw new Error('x');
  };
  expect(api._debug.lastRollViews).toEqual({});
});

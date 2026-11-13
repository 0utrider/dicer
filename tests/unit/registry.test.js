import { createRegistry } from '../../src/compat/registry.js';

const labels = (n) => Array.from({ length: n }, (_, i) => String(i + 1));
const make = () => {
  const warn = vi.fn();
  // loadModel is injected: the default would import the GLTF chunk and fetch for real.
  return { reg: createRegistry({ warn, loadModel: async () => ({}) }), warn };
};

describe('registry', () => {
  test('the standard system exists with no presets', () => {
    const { reg } = make();
    const std = reg.getLoadedDiceSystems().get('standard');
    expect(std.dice.size).toBe(0);
  });

  test('addDicePreset creates the system implicitly', async () => {
    const { reg } = make();
    await reg.addDicePreset({ type: 'd20', labels: labels(20), system: 'pf2e' });
    const sys = reg.getLoadedDiceSystems().get('pf2e');
    expect(sys.name).toBe('pf2e');
    expect(reg.presetFor('pf2e', 'd20').labels).toHaveLength(20);
    expect(reg.presetFor('pf2e', 'd8')).toBeNull();
    expect(reg.presetFor('nope', 'd20')).toBeNull();
  });

  test('values default to 1..faces; system defaults to standard', async () => {
    const { reg } = make();
    await reg.addDicePreset({ type: 'd12', labels: labels(12) });
    expect(reg.presetFor('standard', 'd12').values).toEqual({ min: 1, max: 12 });
  });

  test('addSystem modes', () => {
    const { reg } = make();
    reg.addSystem({ id: 'x', name: 'X' }, 'preferred');
    expect(reg.getLoadedDiceSystems().get('x').mode).toBe('preferred');
    reg.addSystem({ id: 'y', name: 'Y' }, 'bogus');
    expect(reg.getLoadedDiceSystems().get('y').mode).toBe('default');
    reg.addSystem({ id: 'z', name: 'Z', group: 'G' }, 'exclusive');
    expect(reg.systems.get('z')).toMatchObject({ mode: 'exclusive', group: 'G', instance: null });
  });

  test('addSystem with a DiceSystem-like instance registers its presets', () => {
    const { reg } = make();
    const inst = {
      id: 'dh',
      name: 'DH',
      dice: new Map([['d12', { type: 'd12', labels: labels(12), system: 'dh' }]]),
    };
    reg.addSystem(inst);
    const entry = reg.systems.get('dh');
    expect(entry.instance).toBe(inst);
    expect(entry.dice.get('d12').labels).toHaveLength(12);
  });

  test('colorsets, textures, damage defaults', async () => {
    const { reg } = make();
    await reg.addColorset({ name: 'fire', foreground: '#fff', background: '#f00' });
    expect(reg.exports.COLORSETS.fire.background).toBe('#f00');
    expect(Object.keys(reg.exports.COLORSETS)).toEqual(['fire']);
    const p = reg.addTexture('t1', { name: 'T', composite: 'source-over', source: 'a.png' });
    expect(p).toBeInstanceOf(Promise);
    await p;
    expect(reg.textures.get('t1').name).toBe('T');
    reg.addDamageTypeDefaults({ fire: 'fire' });
    reg.addDamageTypeDefaults({ cold: 'ice' });
    expect(reg.damageTypeDefaults).toEqual({ fire: 'fire', cold: 'ice' });
  });

  test('diceFactory view', async () => {
    const { reg } = make();
    await reg.addDicePreset({ type: 'd20', labels: labels(20), system: 'pf2e', modelFile: 'm.glb' });
    const p = reg.diceFactory.systems.get('pf2e').dice.get('d20');
    expect(p.modelLoaded).toBe(false);
    expect(p.modelFile).toBe('m.glb');
    await expect(p.loadModel(null)).resolves.toBeUndefined();
    await expect(p.loadTextures()).resolves.toBeUndefined();
    expect(reg.diceFactory.get('d20')).toMatchObject({ shape: 'd20' });
  });

  test('onChange fires once per registration and can unsubscribe', async () => {
    const { reg } = make();
    const cb = vi.fn();
    const off = reg.onChange(cb);
    reg.addSystem({ id: 'a', name: 'A' });
    expect(cb).toHaveBeenCalledTimes(1);
    await reg.addDicePreset({ type: 'd6', labels: labels(6), system: 'a' });
    expect(cb).toHaveBeenCalledTimes(2);
    await reg.addColorset({ name: 'c' });
    await reg.addTexture('t', { name: 'T' });
    expect(cb).toHaveBeenCalledTimes(4);
    off();
    reg.addSystem({ id: 'b', name: 'B' });
    expect(cb).toHaveBeenCalledTimes(4);
  });

  test('exports.Utils', async () => {
    const { reg } = make();
    const U = reg.exports.Utils;
    expect(U.contrastOf('#ffffff')).toBe('#000000');
    expect(U.contrastOf('#000000')).toBe('#ffffff');
    reg.addSystem({ id: 'x', name: 'X' });
    await reg.addColorset({ name: 'fire', description: 'Fire' });
    await reg.addTexture('t', { name: 'Tex' });
    expect(U.prepareSystemList()).toMatchObject({ standard: expect.any(String), x: 'X' });
    expect(U.prepareColorsetList()).toHaveProperty('fire');
    expect(U.prepareTextureList()).toEqual({ t: 'Tex' });
    expect(U.prepareFontList()).toEqual(expect.any(Object));
    expect(U.sanitizeAppearance({ background: 'red', foreground: 'junk', colorset: 'fire', evil: 1 })).toEqual({
      background: '#ff0000',
      colorset: 'fire',
    });
    expect(U.sanitizeAppearance(null)).toEqual({});
  });

  test('roles and SFX storage', () => {
    const { reg } = make();
    reg.addRole({ id: 'basic', name: 'Basic' }, { package: 'pkg' });
    expect(reg.getRole('basic')).toMatchObject({ id: 'basic', package: 'pkg' });
    expect(reg.getRoles()).toHaveLength(1);
    reg.addSFXTrigger('t', 'Trig', ['a']);
    class Boom {
      static id = 'Boom';
      static specialEffectName = 'Boom FX';
    }
    reg.addSFXMode(Boom);
    reg.addSFXDefaults(['x']);
    expect(reg.getSFXModes()).toEqual({ Boom: 'Boom FX' });
  });

  test('baseShape and addDiceShape aliases', async () => {
    const { reg, warn } = make();
    expect(reg.baseShape('d20')).toBe('d20');
    expect(reg.baseShape('dz')).toBeNull();
    await reg.addDicePreset({ type: 'dc', labels: labels(10), system: 'x' }, 'd10');
    expect(reg.baseShape('dc')).toBe('d10');
    expect(reg.presetFor('x', 'dc').shape).toBe('d10');
    reg.addDiceShape({ name: 'dh.rhombic', type: 'ConvexPolyhedron', vertices: [], faces: new Array(12).fill([]) });
    expect(reg.baseShape('dh.rhombic')).toBe('d12');
    expect(warn).not.toHaveBeenCalled();
    reg.addDiceShape(42);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('registry tolerates malformed input', async () => {
    const { reg, warn } = make();
    expect(() => reg.addSystem('pf2e')).not.toThrow();
    expect(() => reg.addSystem('other')).not.toThrow();
    const p1 = reg.addDicePreset({ type: 'd20', labels: [1, 2] });
    const p2 = reg.addDicePreset(null);
    const p3 = reg.addColorset({});
    const p4 = reg.addTexture(undefined);
    await expect(Promise.all([p1, p2, p3, p4])).resolves.toBeDefined();
    const names = warn.mock.calls.map((c) => String(c[0]));
    for (const m of ['addSystem', 'addDicePreset', 'addColorset', 'addTexture']) {
      expect(names.filter((n) => n.includes(m))).toHaveLength(1);
    }
    const preset = reg.presetFor('standard', 'd20');
    expect(preset.labels).toHaveLength(20);
    expect(preset.labels.slice(0, 3)).toEqual(['1', '2', '3']);
    expect(preset.labels.every((l) => typeof l === 'string')).toBe(true);
  });
});

describe('model presets (P3-R2)', () => {
  const setup = (loadModel) => {
    const warn = vi.fn();
    const hooks = { callAll: vi.fn() };
    const reg = createRegistry({ warn, hooks, loadModel });
    return { reg, warn, hooks };
  };
  const modelPreset = { type: 'd6', labels: '', modelFile: 'modules/x/dice_6.glb', system: 'x' };

  test('loadModel() loads once, sets modelLoaded, then fires diceSoNiceModelLoaded(preset)', async () => {
    const loadModel = vi.fn(async () => ({ geometry: {}, material: {} }));
    const { reg, hooks } = setup(loadModel);
    await reg.addDicePreset(modelPreset);
    const preset = reg.presetFor('x', 'd6');
    expect(preset.modelLoaded).toBe(false);
    hooks.callAll.mockImplementation(() => expect(preset.modelLoaded).toBe(true));
    await preset.loadModel();
    await preset.loadModel();
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(loadModel).toHaveBeenCalledWith('modules/x/dice_6.glb');
    expect(hooks.callAll).toHaveBeenCalledTimes(1);
    expect(hooks.callAll).toHaveBeenCalledWith('diceSoNiceModelLoaded', preset);
  });

  test('a failed load warns, resolves, and fires nothing', async () => {
    const { reg, hooks, warn } = setup(async () => {
      throw new Error('404');
    });
    await reg.addDicePreset(modelPreset);
    const preset = reg.presetFor('x', 'd6');
    await expect(preset.loadModel()).resolves.toBeUndefined();
    expect(preset.modelLoaded).toBe(false);
    expect(hooks.callAll).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a throwing hook listener never reaches the caller', async () => {
    const { reg, hooks } = setup(async () => ({}));
    hooks.callAll.mockImplementation(() => {
      throw new Error('listener');
    });
    await reg.addDicePreset(modelPreset);
    await expect(reg.presetFor('x', 'd6').loadModel()).resolves.toBeUndefined();
  });

  test('a preset without a model loads nothing; loadTextures() loads a model preset', async () => {
    const loadModel = vi.fn(async () => ({}));
    const { reg, hooks } = setup(loadModel);
    await reg.addDicePreset({ type: 'd6', labels: labels(6), system: 'x' });
    await reg.presetFor('x', 'd6').loadModel();
    await reg.presetFor('x', 'd6').loadTextures();
    expect(loadModel).not.toHaveBeenCalled();
    await reg.addDicePreset({ ...modelPreset, system: 'y' });
    await reg.presetFor('y', 'd6').loadTextures();
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(hooks.callAll).toHaveBeenCalledTimes(1);
  });

  test('hooks default to a no-op', async () => {
    const reg = createRegistry({ warn: vi.fn(), loadModel: async () => ({}) });
    await reg.addDicePreset(modelPreset);
    await expect(reg.presetFor('x', 'd6').loadModel()).resolves.toBeUndefined();
    expect(reg.presetFor('x', 'd6').modelLoaded).toBe(true);
  });
});

describe('model preset urls and DiceBox loads (fix round 1)', () => {
  const route = (url) => `/prefix/${url}`;
  const setup = () => {
    const hooks = { callAll: vi.fn() };
    const loadModel = vi.fn(async () => ({}));
    const reg = createRegistry({ warn: vi.fn(), hooks, loadModel, routeUrl: route });
    return { reg, hooks, loadModel };
  };
  const preset = (system, file = 'modules/x/dice_6.glb') => ({ type: 'd6', labels: '', modelFile: file, system });

  test('the model url is routed once; modelFile stays as the module gave it', async () => {
    const { reg, loadModel } = setup();
    await reg.addDicePreset(preset('x'));
    const p = reg.presetFor('x', 'd6');
    expect(p.modelFile).toBe('modules/x/dice_6.glb');
    expect(p.modelUrl).toBe('/prefix/modules/x/dice_6.glb');
    await p.loadModel();
    expect(loadModel).toHaveBeenCalledWith('/prefix/modules/x/dice_6.glb');
  });

  test('a throwing router keeps the url as given', async () => {
    const reg = createRegistry({
      warn: vi.fn(),
      loadModel: async () => ({}),
      routeUrl: () => {
        throw new Error('no foundry');
      },
    });
    await reg.addDicePreset(preset('x'));
    expect(reg.presetFor('x', 'd6').modelUrl).toBe('modules/x/dice_6.glb');
  });

  test('noteModelLoaded(url) marks every preset of that model loaded and fires once per preset', async () => {
    const { reg, hooks, loadModel } = setup();
    await reg.addDicePreset(preset('x'));
    await reg.addDicePreset(preset('y'));
    await reg.addDicePreset(preset('z', 'modules/x/dice_8.glb'));
    const [x, y, z] = ['x', 'y', 'z'].map((s) => reg.presetFor(s, 'd6'));
    reg.noteModelLoaded('/prefix/modules/x/dice_6.glb');
    reg.noteModelLoaded('/prefix/modules/x/dice_6.glb');
    expect([x.modelLoaded, y.modelLoaded, z.modelLoaded]).toEqual([true, true, false]);
    expect(hooks.callAll.mock.calls).toEqual([
      ['diceSoNiceModelLoaded', x],
      ['diceSoNiceModelLoaded', y],
    ]);
    // A third party's loadModel() afterwards neither reloads nor fires again.
    await x.loadModel();
    expect(loadModel).not.toHaveBeenCalled();
    expect(hooks.callAll).toHaveBeenCalledTimes(2);
  });

  test('after loadModel(), noteModelLoaded fires nothing more; unknown urls fire nothing', async () => {
    const { reg, hooks } = setup();
    await reg.addDicePreset(preset('x'));
    await reg.presetFor('x', 'd6').loadModel();
    reg.noteModelLoaded('/prefix/modules/x/dice_6.glb');
    reg.noteModelLoaded('nope.glb');
    reg.noteModelLoaded(undefined);
    expect(hooks.callAll).toHaveBeenCalledTimes(1);
  });
});

describe('hardening (Task 12)', () => {
  test.each(['d99999999999', 'd1e9', 'd1001', 'd4294967296'])(
    'an absurd face count (%s) warns and skips, never throws',
    async (type) => {
      const { reg, warn } = make();
      await expect(reg.addDicePreset({ type, labels: [] })).resolves.toBeUndefined();
      const dice = new Map([[type, { type, labels: ['1'] }]]);
      expect(() => reg.addSystem({ id: 'big', name: 'Big', dice })).not.toThrow();
      // 'd1e9' is not a dN type at all: stored as a label-counted custom die, still no throw.
      if (type === 'd1e9') return;
      expect(reg.presetFor('standard', type)).toBeNull();
      expect(reg.presetFor('big', type)).toBeNull();
      expect(warn).toHaveBeenCalled();
    },
  );

  test('a custom type with more than 1000 labels warns and is skipped', async () => {
    const { reg, warn } = make();
    await expect(reg.addDicePreset({ type: 'dx', labels: labels(1001) })).resolves.toBeUndefined();
    expect(reg.presetFor('standard', 'dx')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1000'));
    await reg.addDicePreset({ type: 'dy', labels: labels(1000) });
    expect(reg.presetFor('standard', 'dy').labels).toHaveLength(1000);
    // A rejected preset leaves no alias behind.
    await reg.addDicePreset({ type: 'dz', labels: labels(1001) }, 'd6');
    expect(reg.presetFor('standard', 'dz')).toBeNull();
    expect(reg.baseShape('dz')).toBeNull();
  });

  test('a 1000-face die is still accepted', async () => {
    const { reg } = make();
    await reg.addDicePreset({ type: 'd1000', labels: [] });
    expect(reg.presetFor('standard', 'd1000').labels).toHaveLength(1000);
  });

  test('a throwing dice map in addSystem never reaches the caller', () => {
    const { reg } = make();
    const dice = { forEach() { throw new Error('evil'); } };
    expect(() => reg.addSystem({ id: 'evil', name: 'Evil', dice })).not.toThrow();
    const preset = { get type() { throw new Error('evil getter'); } };
    expect(() => reg.addSystem({ id: 'evil2', name: 'E', dice: new Map([['x', preset]]) })).not.toThrow();
  });

  test('a preset shape alias may only target a built-in shape', async () => {
    const { reg, warn } = make();
    reg.addDiceShape({ name: 'dh.r', faces: new Array(12).fill([]) });
    await reg.addDicePreset({ type: 'dq', labels: labels(12) }, 'dh.r'); // custom shape: refused
    expect(reg.baseShape('dq')).toBeNull();
    await reg.addDicePreset({ type: 'dz', labels: labels(6) }, 'd7'); // not a shape at all
    expect(reg.baseShape('dz')).toBeNull();
    expect(warn).toHaveBeenCalled();
    await reg.addDicePreset({ type: 'dy', labels: labels(6) }, 'd6');
    expect(reg.baseShape('dy')).toBe('d6');
  });

  test('a built-in die type is never re-aliased', async () => {
    const { reg, warn } = make();
    await reg.addDicePreset({ type: 'd20', labels: labels(20) }, 'd6');
    expect(reg.baseShape('d20')).toBe('d20');
    reg.addDiceShape({ name: 'd20', faces: new Array(12).fill([]) });
    reg.addDiceShape({ name: 'd6', baseShape: 'd4' });
    expect(reg.baseShape('d20')).toBe('d20');
    expect(reg.baseShape('d6')).toBe('d6');
    expect(warn).toHaveBeenCalled();
  });

  test('d14 and d16 are built-in shapes', async () => {
    const { reg } = make();
    expect(reg.baseShape('d14')).toBe('d14');
    expect(reg.baseShape('d16')).toBe('d16');
    reg.addDiceShape({ name: 'dspindle', baseShape: 'd14' });
    expect(reg.baseShape('dspindle')).toBe('d14');
    await reg.addDicePreset({ type: 'd16', labels: labels(16) }, 'd20');
    expect(reg.baseShape('d16')).toBe('d16');
  });
});

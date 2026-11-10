import { createRegistry } from '../../src/compat/registry.js';

const labels = (n) => Array.from({ length: n }, (_, i) => String(i + 1));
const make = () => {
  const warn = vi.fn();
  return { reg: createRegistry({ warn }), warn };
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

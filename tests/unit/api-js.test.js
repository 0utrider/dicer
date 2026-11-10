import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DiceSystem, DiceSFX, DiceMap } from '../../api.js';
import { createRegistry } from '../../src/compat/registry.js';
import { DiceBox } from '../../src/throw/dice-box.js';
import { buildScene } from '../../src/render/scene.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';

describe('DiceSystem constants', () => {
  test('match the DSN public values', () => {
    expect(DiceSystem.SETTING_SCOPE).toEqual({ LOCAL: 0, SHARED: 1 });
    expect(DiceSystem.SETTING_TYPE).toEqual({
      BOOLEAN: 'boolean',
      SELECT: 'select',
      COLOR: 'color',
      FILE: 'file',
      RANGE: 'range',
      STRING: 'string',
    });
    expect(DiceSystem.SETTING_FORMATING).toEqual({ SEPARATOR: 'separator', HTML: 'html' });
    expect(DiceSystem.DICE_EVENT_TYPE).toEqual({
      SPAWN: 0,
      CLICK: 1,
      RESULT: 2,
      COLLIDE: 3,
      DESPAWN: 4,
    });
    expect(DiceSFX.PLAY_ONLY_ONCE_PER_MESH).toBe(false);
  });

  test('generateHash is a stable integer that tells strings apart', () => {
    const h = DiceSystem.generateHash('abc');
    expect(Number.isInteger(h)).toBe(true);
    expect(DiceSystem.generateHash('abc')).toBe(h);
    expect(DiceSystem.generateHash('abd')).not.toBe(h);
  });
});

describe('DiceSystem instance', () => {
  test('constructor and getters', () => {
    const sys = new DiceSystem('mine', 'Mine', 'preferred', 'Group');
    expect(sys.id).toBe('mine');
    expect(sys.name).toBe('Mine');
    expect(sys.mode).toBe('preferred');
    expect(sys.group).toBe('Group');
    expect(sys.dice).toBeInstanceOf(DiceMap);
    expect(sys.dice).toBeInstanceOf(Map);
    const plain = new DiceSystem('p', 'P');
    expect(plain.mode).toBe('default');
    expect(plain.group).toBeNull();
    expect(sys.getSettingsDialogContent()).toBe('');
  });

  test('on with an invalid type throws; fire -> on round trip; off stops it', () => {
    const sys = new DiceSystem('mine', 'Mine');
    expect(() => sys.on(99, () => {})).toThrow();
    expect(() => sys.on('result', () => {})).toThrow();
    const cb = vi.fn();
    sys.on(DiceSystem.DICE_EVENT_TYPE.RESULT, cb);
    const event = { dice: [{ type: 'd20', value: 7 }], system: 'mine' };
    sys.fire(DiceSystem.DICE_EVENT_TYPE.RESULT, event);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject(event);
    sys.fire(DiceSystem.DICE_EVENT_TYPE.SPAWN, {});
    expect(cb).toHaveBeenCalledTimes(1);
    sys.off(DiceSystem.DICE_EVENT_TYPE.RESULT, cb);
    sys.fire(DiceSystem.DICE_EVENT_TYPE.RESULT, event);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('a throwing listener does not stop the others', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sys = new DiceSystem('mine', 'Mine');
    const after = vi.fn();
    sys.on(DiceSystem.DICE_EVENT_TYPE.SPAWN, () => {
      throw new Error('listener');
    });
    sys.on(DiceSystem.DICE_EVENT_TYPE.SPAWN, after);
    expect(() => sys.fire(DiceSystem.DICE_EVENT_TYPE.SPAWN, {})).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('value settings appear in settings; formatting entries do not', () => {
    const sys = new DiceSystem('mine', 'Mine');
    sys.addSettingSeparator({ name: 'Colours' });
    sys.addSettingHTML({ name: '<p>hi</p>' });
    sys.addSettingColor({ id: 'tint', name: 'Tint', defaultValue: '#ff0000' });
    sys.addSettingBoolean({ id: 'shiny', name: 'Shiny' });
    sys.addSettingRange({ id: 'glow', name: 'Glow', defaultValue: 5, min: 0, max: 10, step: 1 });
    expect(sys.settings.map((s) => s.id)).toEqual(['tint', 'shiny', 'glow']);
    const tint = sys.settings[0];
    expect(tint.type).toBe(DiceSystem.SETTING_TYPE.COLOR);
    expect(tint.scope).toBe(DiceSystem.SETTING_SCOPE.SHARED);
    expect(sys.settings.some((s) => s.type === DiceSystem.SETTING_FORMATING.SEPARATOR)).toBe(false);
    expect(sys.getDefaultSettings()).toEqual({ tint: '#ff0000', shiny: false, glow: 5 });
  });

  test('settings by dice type: defaults, then global, then the type', () => {
    const sys = new DiceSystem('mine', 'Mine');
    sys.addSettingColor({ id: 'tint', name: 'Tint' });
    sys.addSettingString({ id: 'label', name: 'Label', defaultValue: 'x' });
    sys.updateSettings('global', { tint: '#000000' });
    sys.updateSettings('d20', { label: 'twenty' });
    expect(sys.getSettingsByDiceType('d20')).toEqual({ tint: '#000000', label: 'twenty' });
    expect(sys.getSettingsByDiceType('d6')).toEqual({ tint: '#000000', label: 'x' });
    expect(sys.getScopedSettingValue('d20', 'label')).toBe('twenty');
  });

  test('loadSettings reads dicer.appearance[*].systemSettings for this system', () => {
    const sys = new DiceSystem('mine', 'Mine');
    sys.addSettingColor({ id: 'tint', name: 'Tint' });
    const flag = {
      global: { look: 'default', systemSettings: { mine: { tint: '#123456' } } },
      d6: { systemSettings: { mine: { tint: '#abcdef' }, other: { tint: '#000000' } } },
    };
    vi.stubGlobal('game', {
      user: { getFlag: (s, k) => (s === 'dicer' && k === 'appearance' ? flag : undefined) },
    });
    try {
      sys.loadSettings();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(sys.getScopedSettingValue('d20', 'tint')).toBe('#123456');
    expect(sys.getScopedSettingValue('d6', 'tint')).toBe('#abcdef');
  });

  test('a malformed setting call warns once and returns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sys = new DiceSystem('mine', 'Mine');
    expect(() => sys.addSettingColor({ name: 'no id' })).not.toThrow();
    expect(() => sys.addSettingColor()).not.toThrow();
    expect(sys.settings).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('addSetting*(null) or a non-object warns once per member and returns (P3-R21)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sys = new DiceSystem('mine', 'Mine');
    const members = [
      'addSettingSeparator',
      'addSettingHTML',
      'addSettingBoolean',
      'addSettingColor',
      'addSettingRange',
      'addSettingFile',
      'addSettingSelect',
      'addSettingString',
    ];
    for (const m of members) {
      expect(() => sys[m](null)).not.toThrow();
      expect(sys[m](null)).toBeUndefined();
      expect(() => sys[m]('nope')).not.toThrow();
    }
    expect(sys.settings).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(members.length);
    warn.mockRestore();
  });

  test('an explicit undefined defaultValue still gets the member default', () => {
    const sys = new DiceSystem('mine', 'Mine');
    sys.addSettingRange({ id: 'r', defaultValue: undefined, max: undefined });
    expect(sys.settings[0]).toMatchObject({ id: 'r', defaultValue: 0, min: 0, max: 100, step: 1 });
  });

  test('roles', () => {
    const sys = new DiceSystem('mine', 'Mine');
    expect(sys.isAvailableForRole('dmg')).toBe(true);
    sys.excludeRoles('dmg');
    expect(sys.isAvailableForRole('dmg')).toBe(false);
    sys.includeRoles('atk', ['heal']);
    expect(sys.isAvailableForRole('atk')).toBe(true);
    expect(sys.isAvailableForRole('heal')).toBe(true);
    expect(sys.isAvailableForRole('other')).toBe(false);
    sys.setRoleDefaults('atk', { colorset: 'fire' });
    expect(sys.roleDefaults).toEqual({ atk: { colorset: 'fire' } });
  });

  test('DiceMap.set stamps the owning system', () => {
    const sys = new DiceSystem('mine', 'Mine');
    const preset = { type: 'd20', labels: [] };
    sys.dice.set('d20', preset);
    expect(preset.system).toBe('mine');
    expect(sys.dice.get('d20')).toBe(preset);
  });

  test('getDiceByShapeAndValues finds a preset by shape and values', () => {
    const sys = new DiceSystem('mine', 'Mine');
    const a = { type: 'dx', shape: 'd6', values: { min: 1, max: 6 } };
    const b = { type: 'dy', shape: 'd6', values: { min: 0, max: 5 } };
    sys.dice.set('dx', a);
    sys.dice.set('dy', b);
    expect(sys.getDiceByShapeAndValues('d6', { min: 0, max: 5 })).toBe(b);
    expect(sys.getDiceByShapeAndValues('d8', { min: 1, max: 8 })).toBeUndefined();
  });

  test('getDiceByShapeAndValues matches a shapeless preset on its values alone', () => {
    const sys = new DiceSystem('mine', 'Mine');
    const shaped = { type: 'dx', shape: 'd8', values: { min: 1, max: 4 } };
    const shapeless = { type: 'dz', values: { min: 1, max: 4 } };
    sys.dice.set('dx', shaped);
    sys.dice.set('dz', shapeless);
    expect(sys.getDiceByShapeAndValues('d4', { min: 1, max: 4 })).toBe(shapeless);
    expect(sys.getDiceByShapeAndValues('d8', { min: 1, max: 4 })).toBe(shaped);
    expect(sys.getDiceByShapeAndValues('d4', { min: 0, max: 3 })).toBeUndefined();
  });

  test('getCacheString differs for different appearances and settings', () => {
    const sys = new DiceSystem('mine', 'Mine');
    sys.addSettingColor({ id: 'tint', name: 'Tint' });
    const a = sys.getCacheString({ body: { color: '#ff0000' } });
    expect(typeof a).toBe('string');
    expect(sys.getCacheString({ body: { color: '#ff0000' } })).toBe(a);
    expect(sys.getCacheString({ body: { color: '#00ff00' } })).not.toBe(a);
    sys.updateSettings('global', { tint: '#000000' });
    expect(sys.getCacheString({ body: { color: '#ff0000' } })).not.toBe(a);
  });

  test('processMaterial and beforeShaderCompile run the registered callbacks', () => {
    const sys = new DiceSystem('mine', 'Mine');
    const pm = vi.fn();
    const bsc = vi.fn();
    sys.registerProcessMaterialCallback(pm);
    sys.registerBeforeShaderCompileCallback(bsc);
    const material = {};
    sys.processMaterial('d20', material, { x: 1 });
    expect(pm).toHaveBeenCalledWith('d20', material, { x: 1 });
    const shader = {};
    sys.beforeShaderCompile(shader, material);
    expect(bsc).toHaveBeenCalledWith(shader, material);
  });
});

describe('DiceSFX', () => {
  test('base behaviour', async () => {
    class Boom extends DiceSFX {
      static id = 'boom';
      static specialEffectName = 'Boom';
    }
    const box = {};
    const mesh = {};
    const sfx = new Boom(box, mesh, { volume: 1 });
    expect(sfx.box).toBe(box);
    expect(sfx.dicemesh).toBe(mesh);
    expect(sfx.options).toEqual({ volume: 1 });
    expect(sfx.nameLocalized).toBe('Boom');
    expect(typeof sfx.computeScale()).toBe('number');
    await expect(sfx.play()).resolves.toBeUndefined();
    await expect(Boom.init()).resolves.toBeDefined();
    expect(Boom.getDialogContent()).toBe('');
    const loader = { load: (url, ok) => ok(`loaded ${url}`) };
    await expect(Boom.loadAsset(loader, 'a.glb')).resolves.toBe('loaded a.glb');
    const failing = { load: (url, ok, progress, fail) => fail(new Error('nope')) };
    await expect(Boom.loadAsset(failing, 'b.glb')).rejects.toThrow('nope');
  });
});

describe('DiceBox applies a registered DiceSystem', () => {
  const atlas = {
    ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
    texture: new THREE.Texture(),
  };
  const rect = { left: 0, top: 0, width: 960, height: 480 };
  const labels = Array.from({ length: 20 }, (_, i) => String(i + 1));

  function fakePhysics() {
    const streams = [];
    return {
      resize() {},
      recycle() {},
      throw(req) {
        const s = { req };
        s.done = new Promise((r) => (s.resolve = r));
        streams.push(s);
        return { onChunk: (cb) => (s.cb = cb), done: s.done };
      },
      flush() {
        for (const s of streams.splice(0)) {
          const n = s.req.dice.length;
          for (let c = 0; c < 2; c++) {
            const data = new Float32Array(30 * 7 * n);
            for (let st = 0; st < 30; st++) {
              const x = -30 + (30 * (c * 30 + st)) / 59;
              for (let d = 0; d < n; d++) data.set([x, 0.5, d * 1.5, 0, 0, 0, 1], (st * n + d) * 7);
            }
            s.cb({ index: c, steps: 30, data, done: c === 1 });
          }
          s.resolve({ settledStep: 59 });
        }
      },
    };
  }

  function fakeRenderer() {
    const sceneApi = buildScene();
    const r = {
      sceneApi,
      scene: sceneApi.scene,
      setArea() {},
      onContextLost() {},
      startLoop: (t) => (r.tickFn = t),
      hide: () => (r.tickFn = null),
      tickFn: null,
      tick(ms) {
        if (!r.tickFn) return false;
        const again = r.tickFn(ms);
        if (!again) r.hide();
        return again;
      },
    };
    return r;
  }

  function setup(...systems) {
    const registry = createRegistry({ warn: () => {} });
    for (const system of systems) {
      system.dice.set('d20', { type: 'd20', labels });
      registry.addSystem(system);
    }
    const renderer = fakeRenderer();
    const physics = fakePhysics();
    const box = new DiceBox({
      renderer,
      physics,
      atlas,
      getArea: () => rect,
      timeBeforeHide: () => 1000,
      presetFor: registry.presetFor,
      systemFor: (id) => registry.systems.get(id)?.instance ?? null,
    });
    return { registry, renderer, physics, box };
  }

  const spec = (value) => ({ type: 'd20', value, system: 'mine', dsnType: 'd20' });
  const meshes = (renderer) =>
    renderer.scene.children
      .filter((o) => o.isGroup && o.userData.dicerDie)
      .map((g) => g.children[0]);

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('processMaterial runs once per new material; the key carries the cache string', () => {
    const calls = [];
    class Mine extends DiceSystem {
      processMaterial(type, material, appearance) {
        calls.push({ type, material, appearance });
        material.userData.tagged = true;
        return material;
      }
      getCacheString() {
        return 'MINE-CS';
      }
    }
    const { renderer, box } = setup(new Mine('mine', 'Mine'));
    box.roll([spec(3), spec(4)]);
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('d20');
    const [a, b] = meshes(renderer).map((m) => m.material);
    expect(a).toBe(b);
    expect(a).toBe(calls[0].material);
    expect(a.userData.tagged).toBe(true);
    expect(a.customProgramCacheKey()).toContain('MINE-CS');
    expect(a.customProgramCacheKey()).toContain(`dicer-${a.userData.programKey}`);
    box.roll([spec(5)]); // cached
    expect(calls).toHaveLength(1);
    box.clear();
  });

  test('a different cache string builds a different material', () => {
    let cs = 'one';
    class Mine extends DiceSystem {
      getCacheString() {
        return cs;
      }
    }
    const { renderer, box } = setup(new Mine('mine', 'Mine'));
    box.roll([spec(3)]);
    const first = meshes(renderer)[0].material;
    cs = 'two';
    box.roll([spec(4)]);
    const second = meshes(renderer)[1].material;
    expect(second).not.toBe(first);
    box.clear();
  });

  test('two systems with the same cache string never share a program', () => {
    class Same extends DiceSystem {
      getCacheString() {
        return 'SAME';
      }
    }
    const { renderer, box } = setup(new Same('mine', 'Mine'), new Same('yours', 'Yours'));
    box.roll([spec(3), { ...spec(4), system: 'yours' }]);
    const [a, b] = meshes(renderer).map((m) => m.material);
    expect(a.customProgramCacheKey()).toBe(`sys:mine|SAME|dicer-${a.userData.programKey}`);
    expect(b.customProgramCacheKey()).toBe(`sys:yours|SAME|dicer-${b.userData.programKey}`);
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    box.clear();
  });

  test('beforeShaderCompile runs after Dicer’s own patch', () => {
    const seen = [];
    class Mine extends DiceSystem {
      beforeShaderCompile(shader, material) {
        seen.push({ patched: shader.fragmentShader.includes('uFillColor'), material });
      }
    }
    const { renderer, box } = setup(new Mine('mine', 'Mine'));
    box.roll([spec(3)]);
    const mat = meshes(renderer)[0].material;
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    mat.onBeforeCompile(shader, null);
    expect(seen).toHaveLength(1);
    expect(seen[0].patched).toBe(true);
    expect(seen[0].material).toBe(mat);
    box.clear();
  });

  test('a throwing processMaterial falls back to the plain material and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    class Mine extends DiceSystem {
      processMaterial(type, material) {
        material.userData.broken = true;
        throw new Error('bad system');
      }
    }
    const { renderer, box } = setup(new Mine('mine', 'Mine'));
    box.roll([spec(3)]);
    box.roll([{ ...spec(4), type: 'd20' }]);
    const mats = meshes(renderer).map((m) => m.material);
    expect(mats).toHaveLength(2);
    for (const m of mats) {
      expect(m).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect(m.userData.broken).toBeUndefined();
      expect(m.customProgramCacheKey()).toBe(`dicer-${m.userData.programKey}`);
    }
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('mine'))).toHaveLength(1);
    box.clear();
    warn.mockRestore();
  });

  test('a throwing beforeShaderCompile restores Dicer’s shader and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    class Mine extends DiceSystem {
      beforeShaderCompile(shader) {
        shader.fragmentShader = 'broken';
        throw new Error('bad shader');
      }
    }
    const { renderer, box } = setup(new Mine('mine', 'Mine'));
    box.roll([spec(3)]);
    const mat = meshes(renderer)[0].material;
    const shader = () => ({
      uniforms: {},
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    });
    const s1 = shader();
    expect(() => mat.onBeforeCompile(s1, null)).not.toThrow();
    expect(s1.fragmentShader).toContain('uFillColor');
    mat.onBeforeCompile(shader(), null);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('mine'))).toHaveLength(1);
    box.clear();
    warn.mockRestore();
  });

  test('a throwing getCacheString falls back and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pm = vi.fn();
    class Mine extends DiceSystem {
      getCacheString() {
        throw new Error('no key');
      }
      processMaterial(...args) {
        pm(...args);
      }
    }
    const { renderer, box } = setup(new Mine('mine', 'Mine'));
    box.roll([spec(3)]);
    box.roll([spec(4)]);
    const mat = meshes(renderer)[0].material;
    expect(pm).not.toHaveBeenCalled();
    expect(mat.customProgramCacheKey()).toBe(`dicer-${mat.userData.programKey}`);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('mine'))).toHaveLength(1);
    box.clear();
    warn.mockRestore();
  });

  test('SPAWN, RESULT and DESPAWN events fire for the system’s dice', async () => {
    const sys = new DiceSystem('mine', 'Mine');
    const events = [];
    const T = DiceSystem.DICE_EVENT_TYPE;
    for (const [name, type] of Object.entries(T)) sys.on(type, (e) => events.push([name, e]));
    const { renderer, physics, box } = setup(sys);
    const { finished } = box.roll([spec(7), { type: 'd6', value: 2 }]);
    physics.flush();
    renderer.tick(16);
    expect(events.filter(([n]) => n === 'SPAWN')).toHaveLength(1);
    // No value before landing.
    expect(events[0][1]).toEqual({ system: 'mine', dice: [{ type: 'd20' }] });
    expect(events.some(([n]) => n === 'RESULT')).toBe(false);
    renderer.tick(500); // still rolling
    expect(events.some(([n]) => n === 'RESULT')).toBe(false);
    renderer.tick(2000);
    const results = events.filter(([n]) => n === 'RESULT');
    expect(results).toHaveLength(1);
    expect(results[0][1]).toEqual({ system: 'mine', dice: [{ type: 'd20', value: 7 }] });
    box.clear();
    await finished;
    const despawns = events.filter(([n]) => n === 'DESPAWN');
    expect(despawns).toHaveLength(1);
    expect(despawns[0][1]).toEqual({ system: 'mine', dice: [{ type: 'd20' }] });
    expect(events.some(([n]) => n === 'CLICK' || n === 'COLLIDE')).toBe(false);
  });

  test('a roll that fails after its dice spawned still fires DESPAWN, and no RESULT', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sys = new DiceSystem('mine', 'Mine');
    const events = [];
    const T = DiceSystem.DICE_EVENT_TYPE;
    for (const [name, type] of Object.entries(T)) sys.on(type, (e) => events.push([name, e]));
    const { renderer, physics, box } = setup(sys);
    const { finished } = box.roll([spec(7)]);
    physics.flush();
    renderer.tick(16); // revealed: SPAWN
    // No more frames: the landing guard fails the roll.
    await vi.advanceTimersByTimeAsync(30000); // async: the guard is armed after physics done
    await finished;
    expect(error).toHaveBeenCalledWith('dicer: roll failed', expect.any(Error));
    expect(events.map(([n]) => n)).toEqual(['SPAWN', 'DESPAWN']);
    expect(events[1][1]).toEqual({ system: 'mine', dice: [{ type: 'd20' }] });
    error.mockRestore();
  });

  test('a throwing event listener or fire never breaks the roll; ghosts fire nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    class Mine extends DiceSystem {
      fire() {
        throw new Error('fire');
      }
    }
    const { renderer, physics, box } = setup(new Mine('mine', 'Mine'));
    const { landed } = box.roll([spec(7)]);
    physics.flush();
    renderer.tick(16);
    renderer.tick(2000);
    await landed;
    expect(meshes(renderer)).toHaveLength(1);
    box.clear();

    const sys = new DiceSystem('mine', 'Mine');
    const cb = vi.fn();
    sys.on(DiceSystem.DICE_EVENT_TYPE.RESULT, cb);
    sys.on(DiceSystem.DICE_EVENT_TYPE.SPAWN, cb);
    const g = setup(sys);
    g.box.roll([{ ...spec(7), ghost: true }]);
    g.physics.flush();
    g.renderer.tick(16);
    g.renderer.tick(2000);
    expect(cb).not.toHaveBeenCalled();
    g.box.clear();
    warn.mockRestore();
  });
});

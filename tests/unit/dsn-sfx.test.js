import * as THREE from 'three';
import { createEffectLayer } from '../../src/effects/effect-layer.js';
import { createDsnSfx, SFX_INIT_TIMEOUT_MS, SFX_TIMEOUT_MS } from '../../src/effects/dsn-sfx.js';
import { createRegistry } from '../../src/compat/registry.js';
import { moduleRulesOf } from '../../src/effects/fx-resolver.js';
import { matchRule } from '../../src/effects/rules.js';
import { TIERS } from '../../src/render/quality.js';

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
const makeDie = () => ({
  outer: new THREE.Group(),
  inner: new THREE.Mesh(),
  value: 17,
  type: 'd20',
});
const fx = (name, extra = {}) => [{ ruleId: 'r', effect: { id: `dsn:${name}`, ...extra }, sound: null }];

function setup(classes) {
  const registry = { sfxModes: new Map(classes.map((c) => [c.id, { id: c.id, sfxClass: c }])) };
  const warn = vi.fn();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const glRenderer = { gl: true };
  const dsnSfx = createDsnSfx({ registry, getBox: () => ({ scene, camera, glRenderer }), warn });
  const layer = createEffectLayer({
    scene,
    camera,
    canvas: { style: { transform: '' } },
    getTier: () => TIERS.high,
    loadLibrary: async () => ({ EFFECTS: {} }),
    dsnSfx,
    warn,
    debug: () => {},
  });
  return { layer, warn, scene, camera, glRenderer };
}

describe('DSN special effects', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('play resolves: observed contract, destroyed once, layer idle', async () => {
    const seen = {};
    class Fx {
      static id = 'Fx';
      static init = vi.fn(async () => {});
      constructor(box, mesh, options) {
        seen.args = [box, mesh, options];
        this.destroy = vi.fn();
        seen.inst = this;
      }
      async play() {
        seen.type = seen.args[1].type;
        seen.result = seen.args[1].result;
      }
    }
    const { layer, scene, camera, glRenderer } = setup([Fx]);
    const die = makeDie();
    layer.play(die, fx('Fx', { speed: 2, color: '#f00' }));
    expect(layer.running).toBe(1);
    expect(layer.update(0)).toBe(true);
    await flush();
    const [box, mesh, options] = seen.args;
    expect(box).toMatchObject({ scene, camera, renderer: glRenderer, dicer: true });
    expect(() => box.renderScene()).not.toThrow();
    expect(mesh).toBe(die.outer);
    expect(options).toEqual({ speed: 2, color: '#f00' });
    expect([seen.type, seen.result]).toEqual(['d20', 17]);
    expect(seen.inst.destroy).toHaveBeenCalledTimes(1);
    expect(layer.update(16)).toBe(false);
    expect(layer.running).toBe(0);
    expect(seen.inst.destroy).toHaveBeenCalledTimes(1);
    expect(die.outer.type).toBe('Group'); // the mesh is left as it was found
    expect('result' in die.outer).toBe(false);
    expect(Fx.init).toHaveBeenCalledTimes(1);
  });

  test('never mutates the rule effect; the lazy library is not needed', async () => {
    class Fx {
      static id = 'Fx';
      async play() {}
    }
    const { layer } = setup([Fx]);
    const f = fx('Fx', { n: 1 });
    const snap = JSON.stringify(f);
    layer.play(makeDie(), f);
    await flush();
    expect(JSON.stringify(f)).toBe(snap);
    expect(layer.loaded).toBe(false);
  });

  test('play throws: one warning, destroy called, layer idle', async () => {
    const insts = [];
    class Bad {
      static id = 'Bad';
      constructor() {
        this.destroy = vi.fn();
        insts.push(this);
      }
      async play() {
        throw new Error('boom');
      }
    }
    const { layer, warn } = setup([Bad]);
    layer.play(makeDie(), fx('Bad'));
    await flush();
    layer.play(makeDie(), fx('Bad'));
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(insts).toHaveLength(2);
    expect(insts.every((i) => i.destroy.mock.calls.length === 1)).toBe(true);
    expect(layer.update(0)).toBe(false);
  });

  test('play never resolves: the handle ends at SFX_TIMEOUT_MS and destroy is called', async () => {
    let inst;
    class Hang {
      static id = 'Hang';
      constructor() {
        inst = this;
        this.destroy = vi.fn();
      }
      play() {
        return new Promise(() => {});
      }
    }
    const { layer } = setup([Hang]);
    layer.play(makeDie(), fx('Hang'));
    await flush();
    expect(layer.update(0)).toBe(true);
    vi.advanceTimersByTime(SFX_TIMEOUT_MS - 1);
    expect(layer.update(1)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(layer.update(2)).toBe(false);
    expect(inst.destroy).toHaveBeenCalledTimes(1);
  });

  test('init rejects: class disabled, one warning, later plays skipped', async () => {
    const ctor = vi.fn();
    class NoInit {
      static id = 'NoInit';
      static init = vi.fn(async () => {
        throw new Error('no assets');
      });
      constructor() {
        ctor();
      }
      async play() {}
    }
    const { layer, warn } = setup([NoInit]);
    layer.play(makeDie(), fx('NoInit'));
    await flush();
    expect(layer.update(0)).toBe(false);
    layer.play(makeDie(), fx('NoInit'));
    expect(layer.running).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(ctor).not.toHaveBeenCalled();
    expect(NoInit.init).toHaveBeenCalledTimes(1);
  });

  test('an init that never settles is capped at SFX_INIT_TIMEOUT_MS', async () => {
    class Slow {
      static id = 'Slow';
      static init = () => new Promise(() => {});
      async play() {}
    }
    const { layer, warn } = setup([Slow]);
    layer.play(makeDie(), fx('Slow'));
    await flush();
    expect(layer.update(0)).toBe(true);
    vi.advanceTimersByTime(SFX_INIT_TIMEOUT_MS);
    await flush();
    expect(layer.update(1)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('PLAY_ONLY_ONCE_PER_MESH: once per die even when several rules match', async () => {
    const play = vi.fn(async () => {});
    class Once {
      static id = 'Once';
      static PLAY_ONLY_ONCE_PER_MESH = true;
      play = play;
    }
    class Many {
      static id = 'Many';
      play = play;
    }
    const { layer } = setup([Once, Many]);
    layer.play(makeDie(), [...fx('Once'), ...fx('Once'), ...fx('Many'), ...fx('Many')]);
    await flush();
    expect(play).toHaveBeenCalledTimes(3);
    layer.play(makeDie(), fx('Once'));
    await flush();
    expect(play).toHaveBeenCalledTimes(4);
  });

  test('stopping before init finishes never constructs; unknown classes are skipped', async () => {
    const ctor = vi.fn();
    class Late {
      static id = 'Late';
      static init = async () => {};
      constructor() {
        ctor();
      }
      async play() {}
    }
    const { layer } = setup([Late]);
    layer.play(makeDie(), [...fx('Late'), ...fx('Missing')]);
    expect(layer.running).toBe(1);
    layer.clear();
    await flush();
    expect(ctor).not.toHaveBeenCalled();
  });
});

describe('registry and module rules', () => {
  const make = () => createRegistry({ hooks: { callAll() {}, call() {} }, routeUrl: (u) => u });

  test('addSFXMode name is specialEffectName when a string, else the id', () => {
    const reg = make();
    class A {
      static id = 'A';
      static specialEffectName = 'Pretty A';
    }
    class B {
      static id = 'B';
      static sfxName = 'ignored';
    }
    reg.addSFXMode(A);
    reg.addSFXMode(B);
    expect(reg.getSFXModes()).toEqual({ A: 'Pretty A', B: 'B' });
    expect(reg.sfxModes.get('A').sfxClass).toBe(A);
  });

  test('a daggerheart addSFXDefaults entry becomes a module rule matching a critical die', () => {
    const warn = vi.fn();
    const reg = make();
    const getModuleRules = moduleRulesOf(reg, warn);
    expect(getModuleRules()).toEqual([]);
    reg.addSFXDefaults([
      { diceType: 'daggerheart-duality-trigger', onResult: ['critical'], specialEffect: 'PlayAnimationConvergence' },
    ]);
    const rules = getModuleRules(); // recomputed after the registry changed
    expect(rules).toHaveLength(1);
    expect(rules[0].effect).toEqual({ id: 'dsn:PlayAnimationConvergence' });
    const die = { type: 'd12', dsnType: 'daggerheart-duality-trigger', value: 12, outcome: 'critical-success' };
    expect(matchRule(rules[0], die)).toBe(true);
    expect(matchRule(rules[0], { ...die, outcome: 'failure' })).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

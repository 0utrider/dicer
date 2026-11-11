import {
  createFxResolver,
  composeDecorateFor,
  createLandedFx,
  FX_SLOW_EFFECTS,
  moduleRulesOf,
} from '../../src/effects/fx-resolver.js';
import { DEFAULT_RULES } from '../../src/effects/rules.js';
import { planThrow } from '../../src/throw/throw-planner.js';
import { getShape } from '../../src/core/dice-shapes.js';

const d20 = (result, extra = {}) => ({
  formula: '1d20',
  dice: [{ faces: 20, results: [{ result, active: true }] }],
  ...extra,
});
const d100 = (result) => ({
  formula: '1d100',
  dice: [{ faces: 100, results: [{ result, active: true }] }],
});

let settings, flags, warn, me;
function make(extra = {}) {
  return createFxResolver({
    getWorldRules: () => structuredClone(DEFAULT_RULES),
    getUserRules: (id) => flags[id],
    getModuleRules: () => [],
    currentUser: () => me,
    getSetting: (k) => settings[k],
    warn,
    ...extra,
  });
}
const plan = (resolver, roll, message = null, authorId) =>
  planThrow(roll, { decorate: resolver.decorate(message, roll, authorId) }).dice;

beforeEach(() => {
  settings = { effects: true, showOthersEffects: true, slowMotion: true, triggerMacros: true };
  flags = {};
  warn = vi.fn();
  me = { id: 'alice', isGM: false };
});

test('a nat 20 on a d20 carries the celebrate fx (sound fanfare, slow motion)', () => {
  const [die] = plan(make(), d20(20), { author: { id: 'alice' } });
  expect(die.fx).toHaveLength(1);
  expect(die.fx[0]).toMatchObject({
    ruleId: 'dicer.nat20',
    effect: { id: 'celebrate' },
    sound: { builtin: 'fanfare' },
    slowMotion: true,
    value: 20,
    type: 'd20',
  });
});

test('a nat 1 carries fumble; a d20 rolling 19 carries no fx', () => {
  expect(plan(make(), d20(1), { author: { id: 'alice' } })[0].fx[0].effect.id).toBe('fumble');
  expect(plan(make(), d20(19), { author: { id: 'alice' } })[0]).toEqual({ type: 'd20', value: 19 });
});

test('slowMotion is false when the slowMotion setting is off, and true for an effect asking for it', () => {
  settings.slowMotion = false;
  expect(plan(make(), d20(20), { author: { id: 'alice' } })[0].fx[0].slowMotion).toBe(false);
  settings.slowMotion = true;
  const world = [
    { id: 'w', die: 'd6', result: { kind: 'max' }, effect: { id: 'spark', slowMotion: true } },
  ];
  const [die] = plan(make({ getWorldRules: () => world }), {
    dice: [{ faces: 6, results: [{ result: 6 }] }],
  });
  expect(die.fx[0].slowMotion).toBe(true);
  expect(FX_SLOW_EFFECTS).toEqual(['celebrate', 'fumble']);
});

test("another user's roll with showOthersEffects off: no fx; effects off: no fx at all", () => {
  settings.showOthersEffects = false;
  expect(plan(make(), d20(20), { author: { id: 'bob' } })[0].fx).toBeUndefined();
  expect(plan(make(), d20(20), { author: { id: 'alice' } })[0].fx).toHaveLength(1);
  settings.effects = false;
  expect(plan(make(), d20(20), { author: { id: 'alice' } })[0].fx).toBeUndefined();
});

test('the roller is the message author, else authorId', () => {
  settings.showOthersEffects = false;
  expect(plan(make(), d20(20), null, 'bob')[0].fx).toBeUndefined();
  expect(plan(make(), d20(20), null, 'alice')[0].fx).toHaveLength(1);
});

test("a user rule applies only to that user's own rolls (the roller's flag)", () => {
  flags.bob = [
    {
      id: 'bob.d20.7',
      die: 'd20',
      result: { kind: 'value', value: 7 },
      sound: { builtin: 'chime' },
    },
  ];
  const r = make();
  expect(plan(r, d20(7), { author: { id: 'bob' } })[0].fx.map((f) => f.ruleId)).toEqual([
    'bob.d20.7',
  ]);
  expect(plan(r, d20(7), { author: { id: 'alice' } })[0].fx).toBeUndefined();
});

test('a malformed user flag is ignored with one warning, however many rolls read it', () => {
  flags.bob = 'not-an-array';
  const r = make();
  plan(r, d20(20), { author: { id: 'bob' } });
  plan(r, d20(20), { author: { id: 'bob' } });
  expect(warn).toHaveBeenCalledTimes(1);
  // World rules still apply.
  expect(plan(r, d20(20), { author: { id: 'bob' } })[0].fx[0].ruleId).toBe('dicer.nat20');

  flags.carol = [{ id: 'bad', die: 'd20' }]; // no effect, sound or macro
  plan(r, d20(20), { author: { id: 'carol' } });
  plan(r, d20(20), { author: { id: 'carol' } });
  expect(warn).toHaveBeenCalledTimes(2);
});

test('world rules are normalized once per value, not per roll', () => {
  const world = [{ id: 'x', die: 'd20', result: { kind: 'bogus' }, sound: { builtin: 'a' } }];
  const r = make({ getWorldRules: () => world.map((o) => ({ ...o })) });
  plan(r, d20(20));
  plan(r, d20(20));
  expect(warn).toHaveBeenCalledTimes(1);
});

test('macros are kept only for the roller with triggerMacros on', () => {
  const world = [{ id: 'm', die: 'd20', result: { kind: 'value', value: 20 }, macro: 'Macro.abc' }];
  const r = make({ getWorldRules: () => world });
  expect(plan(r, d20(20), { author: { id: 'alice' } })[0].fx[0].macro).toBe('Macro.abc');
  expect(plan(r, d20(20), { author: { id: 'bob' } })[0].fx[0].macro).toBeNull();
  settings.triggerMacros = false;
  expect(plan(r, d20(20), { author: { id: 'alice' } })[0].fx[0].macro).toBeNull();
});

test('context: outcome from roll.options, role from flags, formula, actor id, damage type', () => {
  const world = [
    { id: 'crit', outcome: 'critical-success', effect: { id: 'celebrate' } },
    {
      id: 'atk',
      context: { role: 'attack', actorId: 'A1', formula: 'd20' },
      sound: { builtin: 'x' },
    },
  ];
  const r = make({ getWorldRules: () => world });
  const msg = {
    author: { id: 'alice' },
    speaker: { actor: 'A1' },
    flags: { pf2e: { context: { type: 'attack-roll' } } },
  };
  const [die] = plan(r, d20(14, { options: { degreeOfSuccess: 3 } }), msg);
  expect(die.fx.map((f) => f.ruleId)).toEqual(['crit', 'atk']);

  const fireTerm = { faces: 6, options: { flavor: 'fire' }, results: [{ result: 3 }] };
  const fire = { formula: '2d6', dice: [fireTerm], terms: [fireTerm] };
  expect(plan(r, fire, msg)[0].damageType).toBe('fire');
});

test("the actor id falls back to the term's dsnActorId", () => {
  const world = [{ id: 'a', context: { actorId: 'A2' }, sound: { builtin: 'x' } }];
  const roll = { dice: [{ faces: 20, options: { dsnActorId: 'A2' }, results: [{ result: 3 }] }] };
  expect(plan(make({ getWorldRules: () => world }), roll)[0].fx).toHaveLength(1);
});

test('a d100 matches on its full result with 100 faces; fx merges into both dice', () => {
  const world = [
    { id: 'hi', die: 'd100', result: { kind: 'value', value: 97 }, sound: { builtin: 'x' } },
  ];
  const dice = plan(make({ getWorldRules: () => world }), d100(97));
  expect(dice).toHaveLength(2);
  expect(dice[0].variant).toBe('d100tens');
  for (const d of dice) expect(d.fx[0]).toMatchObject({ ruleId: 'hi', value: 97, type: 'd100' });
  const max = [{ id: 'max', die: 'd100', result: { kind: 'max' }, sound: { builtin: 'x' } }];
  expect(plan(make({ getWorldRules: () => max }), d100(100))[1].fx).toHaveLength(1);
});

test('label rules read the face label of the look partial (index of the value in the shape values)', () => {
  const mod = [
    {
      id: 'lbl',
      enabled: true,
      source: 'module',
      die: 'any',
      result: { kind: 'label', label: 'skull' },
      context: {},
      outcome: 'any',
      effect: { id: 'dsn:x' },
      sound: null,
      macro: null,
    },
  ];
  const r = make({ getWorldRules: () => [], getModuleRules: () => mod });
  // FaceSet labels are indexed like getShape(type).values: only value 4's face reads 'skull'.
  const values = getShape('d6').values;
  const labels = values.map((v) => ({ kind: 'text', text: v === 4 ? 'skull' : 'blank' }));
  const look = () => () => ({ faces: { key: 'k', labels } });
  const decorateFor = composeDecorateFor({ looks: { decorate: look }, fx: r });
  const rollOf = (v) => ({ dice: [{ faces: 6, results: [{ result: v }] }] });
  const throwOf = (roll) => planThrow(roll, { decorate: decorateFor(null, roll) }).dice[0];
  expect(throwOf(rollOf(4)).fx[0].ruleId).toBe('lbl');
  expect(throwOf(rollOf(values.find((v) => v !== 4))).fx).toBeUndefined();
  // Without a look's face set there is no label to match.
  expect(plan(r, rollOf(4))[0].fx).toBeUndefined();
});

test('composeDecorateFor: looks first, fx never overrides a look field; a throwing fx keeps the look', () => {
  const looks = {
    decorate: () => () => ({ appearance: { tag: 'look' }, damageType: 'look-wins' }),
  };
  const fx = {
    decorate: () => () => ({ fx: [{ ruleId: 'r' }], damageType: 'fire', appearance: 'nope' }),
  };
  const decorateFor = composeDecorateFor({ looks, fx });
  expect(decorateFor(null, {})({}, {}, 0)).toEqual({
    appearance: { tag: 'look' },
    damageType: 'look-wins',
    fx: [{ ruleId: 'r' }],
  });
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const bad = composeDecorateFor({
    looks,
    fx: {
      decorate: () => () => {
        throw new Error('boom');
      },
    },
  });
  expect(bad(null, {})({}, {}, 0)).toEqual({
    appearance: { tag: 'look' },
    damageType: 'look-wins',
  });
  bad(null, {})({}, {}, 0);
  expect(warnSpy).toHaveBeenCalledTimes(1);
  warnSpy.mockRestore();
});

test('composeDecorateFor: the roller id (4th arg) wins for fx; looks get the author', () => {
  const looks = { decorate: vi.fn(() => () => ({})) };
  const fx = { decorate: vi.fn(() => () => ({})) };
  const roll = {};
  composeDecorateFor({ looks, fx })(null, roll, 'author', 'sender');
  expect(looks.decorate).toHaveBeenCalledWith(null, roll, 'author');
  expect(fx.decorate).toHaveBeenCalledWith(null, roll, 'sender');
  composeDecorateFor({ looks, fx })(null, roll, 'author');
  expect(fx.decorate).toHaveBeenLastCalledWith(null, roll, 'author');
});

describe('createLandedFx', () => {
  let result, macros, fromUuid, landed;
  const die = { type: 'd20', value: 20 };
  const fx = (o = {}) => ({
    ruleId: 'r1',
    effect: null,
    sound: { builtin: 'fanfare' },
    macro: null,
    slowMotion: false,
    value: 20,
    type: 'd20',
    ...o,
  });
  const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  beforeEach(() => {
    result = vi.fn(async () => {});
    macros = { 'Macro.m': { execute: vi.fn() } };
    fromUuid = vi.fn(async (uuid) => macros[uuid] ?? null);
    landed = createLandedFx({ playSound: result, fromUuid, warn });
  });

  test('plays each fx sound once and never awaits it', () => {
    result.mockReturnValue(new Promise(() => {}));
    const token = {};
    landed(die, [fx(), fx({ ruleId: 'r2', sound: null })], token);
    expect(result).toHaveBeenCalledTimes(1);
    expect(result).toHaveBeenCalledWith({ builtin: 'fanfare' });
  });

  test('runs a macro with {dicer: {value, type, ruleId}}, at most once per rule per roll', async () => {
    const token = {};
    landed(die, [fx({ macro: 'Macro.m' })], token);
    landed(die, [fx({ macro: 'Macro.m' })], token);
    await flush();
    expect(macros['Macro.m'].execute).toHaveBeenCalledTimes(1);
    expect(macros['Macro.m'].execute).toHaveBeenCalledWith({
      dicer: { value: 20, type: 'd20', ruleId: 'r1' },
    });
    landed(die, [fx({ macro: 'Macro.m' })], {});
    await flush();
    expect(macros['Macro.m'].execute).toHaveBeenCalledTimes(2);
  });

  test('no macro (null: not the roller, or triggerMacros off) runs nothing', async () => {
    landed(die, [fx({ macro: null })], {});
    await flush();
    expect(fromUuid).not.toHaveBeenCalled();
  });

  test('a failing or missing macro warns once and never throws', async () => {
    macros['Macro.bad'] = {
      execute: vi.fn(() => {
        throw new Error('x');
      }),
    };
    expect(() => landed(die, [fx({ macro: 'Macro.bad' })], {})).not.toThrow();
    landed(die, [fx({ macro: 'Macro.bad' })], {});
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    landed(die, [fx({ macro: 'Macro.none' })], {});
    await flush();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('a throwing sound player is warned, never thrown', () => {
    landed = createLandedFx({
      playSound: () => {
        throw new Error('x');
      },
      fromUuid,
      warn,
    });
    expect(() => landed(die, [fx()], {})).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

test('moduleRulesOf converts the DSN defaults once per change, warning once', async () => {
  const { createRegistry } = await import('../../src/compat/registry.js');
  const registry = createRegistry();
  const getModule = moduleRulesOf(registry, warn);
  expect(getModule()).toEqual([]);
  registry.addSFXDefaults([
    { diceType: 'd20', onResult: ['20'], specialEffect: 'PlayAnimationBright' },
    { diceType: 'd20', onResult: ['weird'], specialEffect: 'X' },
  ]);
  const first = getModule();
  expect(first.map((r) => r.effect.id)).toEqual(['dsn:PlayAnimationBright']);
  expect(getModule()).toBe(first);
  expect(warn).toHaveBeenCalledTimes(1);
  registry.addSFXTrigger('d20', 'D20', []);
  getModule();
  expect(warn).toHaveBeenCalledTimes(1);
});

test('module rules named by getDisabledModuleRules do not fire (P4-R12)', async () => {
  const { normalizeRule } = await import('../../src/effects/rules.js');
  const modRule = (id) =>
    normalizeRule({ id, die: 'd20', result: { kind: 'value', value: 20 }, effect: { id: 'dsn:X' } }, 'module', warn);
  let disabled = [];
  const resolver = make({
    getWorldRules: () => [],
    getModuleRules: () => [modRule('dsn:a'), modRule('dsn:b')],
    getDisabledModuleRules: () => disabled,
  });
  const ids = () => (plan(resolver, d20(20))[0].fx ?? []).map((f) => f.ruleId);
  expect(ids()).toEqual(['dsn:a', 'dsn:b']);
  disabled = ['dsn:a'];
  expect(ids()).toEqual(['dsn:b']);
  disabled = 'junk';
  expect(ids()).toEqual(['dsn:a', 'dsn:b']);
});

describe('damageTypeSounds (world custom landing sounds)', () => {
  const fireTerm = { faces: 6, options: { flavor: 'fire' }, results: [{ result: 3 }] };
  const fire = { formula: '1d6', dice: [fireTerm], terms: [fireTerm] };
  const msg = { author: { id: 'alice' } };
  const themed = (theme) => ({ damageThemeFor: () => () => theme });
  const FIRE = { id: 'fire', landing: { effect: { id: 'embers' }, sound: { builtin: 'crackle' } } };

  test('a custom sound replaces the theme landing sound and keeps its effect', () => {
    settings.damageTypeSounds = { fire: { src: 'sounds/whoosh.ogg', volume: 0.4 } };
    const [die] = plan(make(themed(FIRE)), fire, msg);
    expect(die.fx[0]).toMatchObject({
      ruleId: 'damage:fire',
      effect: { id: 'embers' },
      sound: { src: 'sounds/whoosh.ogg', volume: 0.4 },
    });
  });

  test('without an entry the built-in landing sound stays', () => {
    settings.damageTypeSounds = { cold: { src: 'x.ogg' } };
    expect(plan(make(themed(FIRE)), fire, msg)[0].fx[0].sound).toEqual({ builtin: 'crackle' });
    settings.damageTypeSounds = undefined;
    expect(plan(make(themed(FIRE)), fire, msg)[0].fx[0].sound).toEqual({ builtin: 'crackle' });
  });

  test('a themed type with no landing (or a colorset theme) still plays its custom sound', () => {
    settings.damageTypeSounds = { fire: { src: 'sounds/whoosh.ogg' } };
    const [die] = plan(make(themed({ appearance: {} })), fire, msg);
    expect(die.fx[0]).toMatchObject({ effect: null, sound: { src: 'sounds/whoosh.ogg' } });
  });

  test('no theme (type switched off) means no custom sound; a malformed entry is ignored', () => {
    settings.damageTypeSounds = { fire: { src: 'sounds/whoosh.ogg' } };
    expect(plan(make(themed(null)), fire, msg)[0].fx).toBeUndefined();
    settings.damageTypeSounds = { fire: { src: 5 }, fire2: 'x' };
    expect(plan(make(themed(FIRE)), fire, msg)[0].fx[0].sound).toEqual({ builtin: 'crackle' });
    settings.damageTypeSounds = 'junk';
    expect(plan(make(themed(FIRE)), fire, msg)[0].fx[0].sound).toEqual({ builtin: 'crackle' });
  });

  test('effects off: no custom sound either (the sound is part of the fx)', () => {
    settings.damageTypeSounds = { fire: { src: 'sounds/whoosh.ogg' } };
    settings.effects = false;
    expect(plan(make(themed(FIRE)), fire, msg)[0].fx).toBeUndefined();
  });
});

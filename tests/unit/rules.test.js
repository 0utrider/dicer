import { describe, it, expect, vi } from 'vitest';
import { normalizeRule, matchRule, DEFAULT_RULES, dsnDefaultsToRules, effectiveRules } from '../../src/effects/rules.js';

const base = { id: 'r', effect: { id: 'celebrate' } };
const rule = (over, source = 'world') => normalizeRule({ ...base, ...over }, source, vi.fn());
const die = (over = {}) => ({
  type: 'd20',
  dsnType: 'd20',
  value: 10,
  faces: 20,
  label: undefined,
  formula: '1d20+5',
  role: 'attack',
  damageType: undefined,
  actorId: 'a1',
  userId: 'u1',
  outcome: null,
  ...over,
});

describe('normalizeRule', () => {
  it('fills defaults and clamps', () => {
    const r = normalizeRule({ effect: { id: 'x', intensity: 9, duration: 1 } }, 'user', vi.fn());
    expect(r).toMatchObject({
      enabled: true,
      source: 'user',
      die: 'any',
      result: { kind: 'any' },
      outcome: 'any',
      macro: null,
      sound: null,
    });
    expect(r.effect).toEqual({ id: 'x', intensity: 2, duration: 100 });
    expect(r.id).toBeTruthy();
    expect(rule({ effect: { id: 'x', intensity: -1, duration: 99999 } }).effect).toEqual({
      id: 'x',
      intensity: 0,
      duration: 5000,
    });
    expect(rule({ effect: { id: 'x' } }).effect).toEqual({ id: 'x' });
  });

  it('accepts sound and macro only rules', () => {
    expect(rule({ effect: null, sound: { builtin: 'chime' } }).sound).toEqual({ builtin: 'chime' });
    expect(rule({ effect: null, sound: { src: 'a.ogg', volume: 0.5 } }).sound).toEqual({ src: 'a.ogg', volume: 0.5 });
    expect(rule({ effect: null, macro: 'Macro.abc' }).macro).toBe('Macro.abc');
  });

  it('rejects with exactly one warning', () => {
    const cases = [
      null,
      'str',
      { id: 'a' },
      { id: 'b', effect: { id: 'x' }, result: { kind: 'bogus' } },
      { id: 'c', effect: { id: 'x' }, context: { formula: '/(/' } },
      { id: 'd', effect: { id: 'x' }, result: { kind: 'range', from: NaN, to: 3 } },
      { id: 'e', effect: { id: 'x' }, result: { kind: 'value', value: Infinity } },
      { id: 'f', effect: { id: 'x' }, result: { kind: 'label', label: 'x' } },
      { id: 'g', effect: { id: 'x' }, outcome: 'meh' },
    ];
    for (const raw of cases) {
      const warn = vi.fn();
      expect(normalizeRule(raw, 'world', warn)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    }
  });

  it('allows label only from modules', () => {
    const raw = { id: 'l', effect: { id: 'x' }, result: { kind: 'label', label: 'Hope' } };
    expect(normalizeRule(raw, 'module', vi.fn()).result).toEqual({ kind: 'label', label: 'Hope' });
    expect(normalizeRule({ ...raw, result: { kind: 'label', label: '' } }, 'module', vi.fn())).toBeNull();
  });

  it('swaps reversed ranges', () => {
    expect(rule({ result: { kind: 'range', from: 5, to: 2 } }).result).toEqual({ kind: 'range', from: 2, to: 5 });
  });
});

describe('matchRule', () => {
  it('result kinds', () => {
    expect(matchRule(rule({}), die())).toBe(true);
    expect(matchRule(rule({ result: { kind: 'value', value: 20 } }), die({ value: 20 }))).toBe(true);
    expect(matchRule(rule({ result: { kind: 'value', value: 20 } }), die({ value: 19 }))).toBe(false);
    const rng = rule({ result: { kind: 'range', from: 3, to: 5 } });
    expect([2, 3, 5, 6].map((value) => matchRule(rng, die({ value })))).toEqual([false, true, true, false]);
    const max = rule({ result: { kind: 'max' } });
    expect(matchRule(max, die({ value: 20 }))).toBe(true);
    expect(matchRule(max, die({ value: 19 }))).toBe(false);
    const min = rule({ result: { kind: 'min' } });
    expect(matchRule(min, die({ value: 1 }))).toBe(true);
    expect(matchRule(min, die({ value: 2 }))).toBe(false);
  });

  it('label kind matches exact label', () => {
    const r = rule({ result: { kind: 'label', label: 'Hope' } }, 'module');
    expect(matchRule(r, die({ label: 'Hope' }))).toBe(true);
    expect(matchRule(r, die({ label: 'hope' }))).toBe(false);
    expect(matchRule(r, die({ label: undefined }))).toBe(false);
  });

  it('d100 uses the full result and faces', () => {
    const max = rule({ die: 'd10', result: { kind: 'max' } });
    expect(matchRule(max, die({ type: 'd10', dsnType: 'd10', faces: 100, value: 100 }))).toBe(true);
    expect(matchRule(max, die({ type: 'd10', dsnType: 'd10', faces: 100, value: 10 }))).toBe(false);
  });

  it('die any, type, dsnType', () => {
    expect(matchRule(rule({ die: 'any' }), die({ type: 'd6' }))).toBe(true);
    expect(matchRule(rule({ die: 'd20' }), die({ type: 'd6', dsnType: 'd6' }))).toBe(false);
    expect(matchRule(rule({ die: 'dc' }), die({ type: 'd6', dsnType: 'dc' }))).toBe(true);
  });

  it('formula substring and regex', () => {
    expect(matchRule(rule({ context: { formula: '+5' } }), die())).toBe(true);
    expect(matchRule(rule({ context: { formula: '1D20' } }), die())).toBe(true);
    expect(matchRule(rule({ context: { formula: '+9' } }), die())).toBe(false);
    expect(matchRule(rule({ context: { formula: '/^1d\\d+\\+5$/i' } }), die())).toBe(true);
    expect(matchRule(rule({ context: { formula: '/^2d/' } }), die())).toBe(false);
    expect(matchRule(rule({ context: { formula: '+5' } }), die({ formula: undefined }))).toBe(false);
  });

  it('other context fields', () => {
    expect(matchRule(rule({ context: { role: 'attack' } }), die())).toBe(true);
    expect(matchRule(rule({ context: { role: 'save' } }), die())).toBe(false);
    expect(matchRule(rule({ context: { damageType: 'fire' } }), die({ damageType: 'fire' }))).toBe(true);
    expect(matchRule(rule({ context: { damageType: 'fire' } }), die())).toBe(false);
    expect(matchRule(rule({ context: { actorId: 'a2' } }), die())).toBe(false);
    expect(matchRule(rule({ context: { userId: 'u1' } }), die())).toBe(true);
  });

  it('outcome', () => {
    const r = rule({ outcome: 'critical-success' });
    expect(matchRule(r, die({ outcome: null }))).toBe(false);
    expect(matchRule(r, die({ outcome: 'success' }))).toBe(false);
    expect(matchRule(r, die({ outcome: 'critical-success' }))).toBe(true);
    expect(matchRule(rule({}), die({ outcome: null }))).toBe(true);
  });
});

describe('DEFAULT_RULES', () => {
  it('has nat20 and nat1 world rules that normalize', () => {
    expect(DEFAULT_RULES.map((r) => r.id)).toEqual(['dicer.nat20', 'dicer.nat1']);
    for (const r of DEFAULT_RULES) {
      expect(r.source).toBe('world');
      expect(normalizeRule(r, 'world', vi.fn())).toEqual(r);
    }
    expect(DEFAULT_RULES[0]).toMatchObject({ die: 'd20', result: { kind: 'value', value: 20 }, sound: { builtin: 'fanfare' } });
    expect(DEFAULT_RULES[0].effect.id).toBe('celebrate');
    expect(DEFAULT_RULES[1]).toMatchObject({ result: { kind: 'value', value: 1 }, sound: { builtin: 'fizzle' } });
    expect(DEFAULT_RULES[1].effect.id).toBe('fumble');
  });
});

describe('dsnDefaultsToRules', () => {
  it('converts the daggerheart entry', () => {
    const rules = dsnDefaultsToRules(
      [{ diceType: 'daggerheart-duality-trigger', onResult: ['critical'], specialEffect: 'PlayAnimationConvergence' }],
      new Map(),
      vi.fn(),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      source: 'module',
      die: 'daggerheart-duality-trigger',
      outcome: 'critical-success',
      result: { kind: 'any' },
      effect: { id: 'dsn:PlayAnimationConvergence' },
    });
  });

  it('maps every onResult form and passes options', () => {
    const warn = vi.fn();
    const triggers = new Map([['dc', { id: 'dc', name: 'DC', results: ['Hope', 3] }]]);
    const rules = dsnDefaultsToRules(
      [
        {
          diceType: 'd20',
          onResult: ['20', 'max', 'min', 'success', 'failure', 'fumble'],
          specialEffect: 'Fx',
          options: { intensity: 1.5 },
        },
        { diceType: 'dc', onResult: ['Hope'], specialEffect: 'Fx2' },
      ],
      triggers,
      warn,
    );
    expect(warn).not.toHaveBeenCalled();
    expect(rules.map((r) => r.result.kind)).toEqual(['value', 'max', 'min', 'any', 'any', 'any', 'label']);
    expect(rules[0].result.value).toBe(20);
    expect(rules.slice(3, 6).map((r) => r.outcome)).toEqual(['success', 'failure', 'critical-failure']);
    expect(rules[0].effect).toEqual({ id: 'dsn:Fx', intensity: 1.5 });
    expect(rules[6].result.label).toBe('Hope');
  });

  it('warns once per unknown onResult and drops it', () => {
    const warn = vi.fn();
    const list = [
      { diceType: 'd6', onResult: ['bogus', 'max'], specialEffect: 'A' },
      { diceType: 'd8', onResult: ['bogus'], specialEffect: 'B' },
    ];
    const rules = dsnDefaultsToRules(list, new Map(), warn);
    expect(rules).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('gives stable unique ids and tolerates junk', () => {
    const list = [
      { diceType: 'd6', onResult: ['1', '2'], specialEffect: 'A' },
      { diceType: 'd6', onResult: ['1'], specialEffect: 'A' },
    ];
    const a = dsnDefaultsToRules(list, new Map(), vi.fn());
    const b = dsnDefaultsToRules(list, new Map(), vi.fn());
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(new Set(a.map((r) => r.id)).size).toBe(3);
    expect(dsnDefaultsToRules(null, null, vi.fn())).toEqual([]);
  });

  it('warns once per malformed entry', () => {
    const warn = vi.fn();
    expect(dsnDefaultsToRules([null, { diceType: 'd6' }, 'x'], undefined, warn)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('keeps extra option keys and drops non-JSON values', () => {
    const [r] = dsnDefaultsToRules(
      [{ diceType: 'd20', onResult: ['20'], specialEffect: 'X', options: { foo: 1, color: '#f00', fn: () => 1, nest: { a: [1, 'b'] } } }],
      new Map(),
      vi.fn(),
    );
    expect(r.effect).toEqual({ id: 'dsn:X', foo: 1, color: '#f00', nest: { a: [1, 'b'] } });
  });
});

describe('effectiveRules', () => {
  it('drops disabled, keeps world, roller, module order', () => {
    const mk = (id, source, enabled = true) => ({ ...rule({ id }), source, enabled });
    const out = effectiveRules({
      world: [mk('w1', 'world'), mk('w2', 'world', false)],
      roller: [mk('u1', 'user')],
      module: [mk('m1', 'module'), mk('m2', 'module', false)],
    });
    expect(out.map((r) => r.id)).toEqual(['w1', 'u1', 'm1']);
    expect(effectiveRules({})).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { Die } from './foundry-roll.js';
import { outcomeOf, roleOf, damageTypesByTerm, KNOWN_DAMAGE_TYPES } from '../../src/effects/roll-context.js';

const d = (n, faces, extra = {}) => new Die({ number: n, faces, results: [], ...extra });

class DamageInstance {
  constructor(type, terms, extra = {}) {
    this.type = type;
    this.terms = terms;
    Object.assign(this, extra);
  }
}
class InstancePool {
  constructor(rolls) {
    this.rolls = rolls;
  }
}
const pf2eDamage = (...instances) => ({
  options: {},
  terms: [new InstancePool(instances)],
  instances,
});

const throwing = (name) => {
  const o = {};
  Object.defineProperty(o, name, {
    get() {
      throw new Error('boom');
    },
  });
  return o;
};

describe('outcomeOf', () => {
  it('maps PF2e degreeOfSuccess 0..3', () => {
    const names = ['critical-failure', 'failure', 'success', 'critical-success'];
    for (let i = 0; i < 4; i++) expect(outcomeOf({ options: { degreeOfSuccess: i } })).toBe(names[i]);
  });
  it('falls back to the PF2e message flag', () => {
    const m = (outcome) => ({ flags: { pf2e: { context: { outcome } } } });
    expect(outcomeOf({ options: {} }, m('criticalSuccess'))).toBe('critical-success');
    expect(outcomeOf({}, m('success'))).toBe('success');
    expect(outcomeOf({}, m('failure'))).toBe('failure');
    expect(outcomeOf({}, m('criticalFailure'))).toBe('critical-failure');
    expect(outcomeOf({}, m('bogus'))).toBeNull();
  });
  it('degree on the roll wins over the flag', () => {
    const msg = { flags: { pf2e: { context: { outcome: 'failure' } } } };
    expect(outcomeOf({ options: { degreeOfSuccess: 3 } }, msg)).toBe('critical-success');
  });
  it('reads dnd5e crit and fumble', () => {
    expect(outcomeOf({ isCritical: true })).toBe('critical-success');
    expect(outcomeOf({ isFumble: true })).toBe('critical-failure');
    expect(outcomeOf({ isCritical: false, isFumble: false, isSuccess: true })).toBe('success');
    expect(outcomeOf({ isSuccess: false, isFailure: true })).toBe('failure');
    expect(outcomeOf({ isSuccess: undefined, isFailure: undefined })).toBeNull();
  });
  it('dnd5e damage roll with options.isCritical', () => {
    expect(outcomeOf({ options: { isCritical: true } })).toBe('critical-success');
  });
  it('survives throwing getters', () => {
    expect(outcomeOf(throwing('isCritical'))).toBeNull();
    expect(outcomeOf(throwing('options'))).toBeNull();
    const r = throwing('isCritical');
    Object.defineProperty(r, 'isFumble', { value: true });
    expect(outcomeOf(r)).toBe('critical-failure');
    expect(outcomeOf({}, throwing('flags'))).toBeNull();
  });
  it('unknown systems give null', () => {
    expect(outcomeOf(null)).toBeNull();
    expect(outcomeOf({})).toBeNull();
    expect(outcomeOf({ options: {} }, { flags: {} })).toBeNull();
  });
});

describe('roleOf', () => {
  const pf2e = (type) => ({ flags: { pf2e: { context: { type } } } });
  it('maps PF2e context types', () => {
    expect(roleOf(pf2e('attack-roll'))).toBe('attack');
    expect(roleOf(pf2e('damage-roll'))).toBe('damage');
    expect(roleOf(pf2e('saving-throw'))).toBe('save');
    expect(roleOf(pf2e('skill-check'))).toBe('skill');
    expect(roleOf(pf2e('perception-check'))).toBe('perception');
    expect(roleOf(pf2e('initiative'))).toBe('initiative');
    expect(roleOf(pf2e('flat-check'))).toBe('flat');
    expect(roleOf(pf2e('spell-attack-roll'))).toBe('spell-attack-roll');
  });
  it('passes dnd5e roll types through', () => {
    for (const t of ['attack', 'damage', 'save', 'skill', 'ability', 'tool', 'initiative', 'death'])
      expect(roleOf({ flags: { dnd5e: { roll: { type: t } } } })).toBe(t);
  });
  it('null otherwise, never throws', () => {
    expect(roleOf()).toBeNull();
    expect(roleOf({})).toBeNull();
    expect(roleOf({ flags: {} })).toBeNull();
    expect(roleOf(pf2e(''))).toBeNull();
    expect(roleOf(throwing('flags'))).toBeNull();
  });
});

describe('damageTypesByTerm', () => {
  const known = new Set(KNOWN_DAMAGE_TYPES);
  it('exports the union lists', () => {
    for (const t of ['fire', 'radiant', 'electricity', 'bleed', 'healing', 'spirit', 'thunder'])
      expect(KNOWN_DAMAGE_TYPES.has(t)).toBe(true);
    expect(KNOWN_DAMAGE_TYPES.has('untyped')).toBe(false);
  });
  it('maps each PF2e instance die to its type', () => {
    const fire = d(2, 6);
    const cold = d(1, 4);
    const roll = pf2eDamage(new DamageInstance('fire', [fire]), new DamageInstance('cold', [cold]));
    const map = damageTypesByTerm(roll, known);
    expect(map.get(fire)).toBe('fire');
    expect(map.get(cold)).toBe('cold');
  });
  it('handles persistent bleed and skips untyped', () => {
    const bleed = d(1, 6);
    const plain = d(1, 8);
    const roll = pf2eDamage(
      new DamageInstance('bleed', [bleed], { persistent: true }),
      new DamageInstance('untyped', [plain]),
    );
    const map = damageTypesByTerm(roll, known);
    expect(map.get(bleed)).toBe('bleed');
    expect(map.has(plain)).toBe(false);
  });
  it('walks nested groupings and operands', () => {
    const a = d(1, 6);
    const b = d(1, 6);
    const inst = new DamageInstance('sonic', [{ term: { operands: [a, { term: b }] } }]);
    const map = damageTypesByTerm(pf2eDamage(inst), known);
    expect(map.get(a)).toBe('sonic');
    expect(map.get(b)).toBe('sonic');
  });
  it('reads dnd5e options.type and single-element options.types', () => {
    const x = d(2, 8);
    expect(damageTypesByTerm({ options: { type: 'radiant' }, terms: [x] }, known).get(x)).toBe('radiant');
    const y = d(1, 6);
    expect(damageTypesByTerm({ options: { types: ['acid'] }, terms: [y] }, known).get(y)).toBe('acid');
    const z = d(1, 6);
    expect(damageTypesByTerm({ options: { types: ['acid', 'fire'] }, terms: [z] }, known).has(z)).toBe(false);
  });
  it('reads flavor, split on commas and spaces, lowercased', () => {
    const a = d(2, 6, { flavor: 'Fire' });
    const b = d(1, 6, { options: { flavor: 'slashing, magical' } });
    const c = d(1, 6, { flavor: 'nonsense' });
    const map = damageTypesByTerm({ terms: [a, b, c] }, known);
    expect(map.get(a)).toBe('fire');
    expect(map.get(b)).toBe('slashing');
    expect(map.has(c)).toBe(false);
  });
  it('nearest ancestor wins: term flavor over roll type', () => {
    const a = d(1, 6, { flavor: 'cold' });
    const b = d(1, 6);
    const map = damageTypesByTerm({ options: { type: 'fire' }, terms: [a, b] }, known);
    expect(map.get(a)).toBe('cold');
    expect(map.get(b)).toBe('fire');
  });
  it('nested rolls: inner instance beats outer roll type', () => {
    const a = d(1, 6);
    const inner = new DamageInstance('void', [a]);
    const map = damageTypesByTerm({ options: { type: 'fire' }, terms: [], rolls: [inner] }, known);
    expect(map.get(a)).toBe('void');
  });
  it('respects extra known types and ignores unknown ones', () => {
    const a = d(1, 6, { flavor: 'ichor' });
    expect(damageTypesByTerm({ terms: [a] }, known).has(a)).toBe(false);
    expect(damageTypesByTerm({ terms: [a] }, new Set(['ichor'])).get(a)).toBe('ichor');
  });
  it('survives throwing getters, cycles and null input', () => {
    const a = d(1, 6);
    const bad = throwing('terms');
    const cyc = { terms: [a] };
    cyc.terms.push(cyc);
    expect(() => damageTypesByTerm(bad, known)).not.toThrow();
    expect(() => damageTypesByTerm(cyc, known)).not.toThrow();
    expect(damageTypesByTerm(null, known)).toBeInstanceOf(WeakMap);
    expect(damageTypesByTerm({}, known)).toBeInstanceOf(WeakMap);
  });
  it('bounds depth at 32', () => {
    const leaf = d(1, 6);
    let node = { type: 'fire', terms: [leaf] };
    const deep = { terms: [] };
    let cur = deep;
    for (let i = 0; i < 40; i++) {
      const next = { terms: [] };
      cur.terms.push(next);
      cur = next;
    }
    cur.terms.push(node);
    expect(() => damageTypesByTerm(deep, known)).not.toThrow();
    expect(damageTypesByTerm(deep, known).has(leaf)).toBe(false);
  });
});

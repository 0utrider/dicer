// PF2e precision damage (Sneak Attack, Precise Strike, ...): its dice nest inside the weapon's
// DamageInstance with flavor `precision`, and take the Precision look while the weapon die keeps its own.
import { DAMAGE_THEMES, DEFAULT_DAMAGE_MAP, createDamageThemer, resolveDamageTheme } from '../../src/effects/damage-themes.js';
import { damageTypesByTerm, PF2E_TYPES, DND5E_TYPES, KNOWN_DAMAGE_TYPES } from '../../src/effects/roll-context.js';
import { damageTypeList } from '../../src/ui/damage-map-form.js';
import { elementOf } from '../../src/effects/element-of.js';
import { createRegistry } from '../../src/compat/registry.js';
import { findTheme } from '../../src/themes/themes.js';

// PF2e 8.x roll shapes (DamageRoll > InstancePool > DamageInstance > Grouping > ArithmeticExpression)
class DamageInstance {
  constructor(type, terms) {
    this.type = type;
    this.terms = terms;
  }
}
class InstancePool {
  constructor(rolls) {
    this.rolls = rolls;
  }
}
class Grouping {
  constructor(term, flavor) {
    this.term = term;
    if (flavor) this.flavor = flavor;
  }
}
class Arith {
  constructor(operator, operands) {
    this.operator = operator;
    this.operands = operands;
  }
}
class Die {
  constructor(number, faces, flavor) {
    this.number = number;
    this.faces = faces;
    this.options = flavor ? { flavor } : {};
    this.results = [];
  }
  get flavor() {
    return this.options.flavor ?? '';
  }
}
const num = (n) => ({ number: n, options: {} });
const damageRoll = (...instances) => ({ options: {}, terms: [new InstancePool(instances)], instances });

/** `{(1d6 + 4 + (2d6[precision]))[piercing]}` (sneakFaces 6), or `{(2 * (...))[piercing]}` doubled. */
function strike({ sneakFaces = 6, flavor = 'precision', doubled = false } = {}) {
  const weapon = new Die(1, 6);
  const sneak = new Die(2, sneakFaces, flavor);
  let expr = new Arith('+', [new Arith('+', [weapon, num(4)]), new Grouping(sneak)]);
  if (doubled) expr = new Arith('*', [num(2), new Grouping(expr)]);
  return { roll: damageRoll(new DamageInstance('piercing', [new Grouping(expr, 'piercing')])), weapon, sneak };
}
/** PF2e's "double the dice" crit option: `{(2d6 + 8 + (4d6[precision]))[piercing]}`. */
function doubledDice() {
  const weapon = new Die(2, 6);
  const sneak = new Die(4, 6, 'precision');
  const expr = new Arith('+', [new Arith('+', [weapon, num(8)]), new Grouping(sneak)]);
  return { roll: damageRoll(new DamageInstance('piercing', [new Grouping(expr, 'piercing')])), weapon, sneak };
}

function themer(settings = {}) {
  const s = { damagePresets: true, elementalDamageInsides: false, ...settings };
  return createDamageThemer({ registry: createRegistry({ warn: () => {} }), getSetting: (k) => s[k], warn: () => {} });
}
const P = DAMAGE_THEMES.precision;

describe('precision is a PF2e damage type', () => {
  test('known, mapped to its own theme, and absent from dnd5e', () => {
    expect(PF2E_TYPES).toContain('precision');
    expect(KNOWN_DAMAGE_TYPES.has('precision')).toBe(true);
    expect(DND5E_TYPES).not.toContain('precision');
    expect(DEFAULT_DAMAGE_MAP.precision).toBe('precision');
  });

  test('the look: bloody black marble, sharp edges, crystal d4, white glow numbers, stone', () => {
    const a = P.appearance;
    expect(a.body).toMatchObject({ type: 'marble', color: '#000000', color2: '#e31c1c' });
    expect(a.edges).toMatchObject({ radius: 0, style: 'sharp' });
    expect(a.shapes.d4).toBe('crystal');
    expect(a.numbers).toMatchObject({ color: '#ffffff', fill: 'glow', relief: 'engraved', pips: false });
    expect(a.glow).toEqual({ color: '#ffffff', intensity: 0.1 });
    expect(P.soundMaterial).toBe('stone');
    expect(P.landing).toEqual({ effect: null, sound: { builtin: 'thud' } });
  });

  test('the other built-in looks keep their rounded edges and classic d4', () => {
    for (const t of Object.values(DAMAGE_THEMES)) {
      if (t.id === 'precision') continue;
      expect(t.appearance.edges.radius).toBeGreaterThan(0);
      expect(t.appearance.shapes).toEqual({ d4: 'classic' });
    }
  });

  test('its trail and crit burst are the bleed ones', () => {
    expect(elementOf(P.appearance, 'precision')).toBe('bleed');
  });
});

describe('detection inside the weapon instance', () => {
  test('the weapon d6 stays piercing, the sneak attack 2d6 are precision', () => {
    const { roll, weapon, sneak } = strike();
    const types = damageTypesByTerm(roll);
    expect(types.get(weapon)).toBe('piercing');
    expect(types.get(sneak)).toBe('precision');
  });

  test('a mixed flavor label still matches', () => {
    const { roll, sneak } = strike({ flavor: 'precision,piercing' });
    expect(damageTypesByTerm(roll).get(sneak)).toBe('precision');
  });

  test('the themer: physical for the weapon die, Precision for the sneak dice', () => {
    const { roll, weapon, sneak } = strike();
    const of = themer().forRoll(roll);
    expect(of(weapon, 0).id).toBe('physical');
    expect(of(sneak, 1)).toMatchObject({ id: 'precision', appearance: P.appearance, soundMaterial: 'stone' });
  });

  test('a crit keeps the Precision look on the doubled precision dice (both doubling styles)', () => {
    for (const { roll, weapon, sneak } of [strike({ doubled: true }), doubledDice()]) {
      const of = themer().forRoll(roll);
      expect(of(weapon, 0).id).toBe('physical');
      expect(of(sneak, 1).id).toBe('precision');
    }
  });

  test('a d4 sneak attack rolls crystal d4s', () => {
    const { roll, sneak } = strike({ sneakFaces: 4 });
    expect(themer().forRoll(roll)(sneak, 0).appearance.shapes.d4).toBe('crystal');
  });

  test('a roll without precision resolves exactly as before', () => {
    const weapon = new Die(1, 8);
    const roll = damageRoll(new DamageInstance('slashing', [new Grouping(new Arith('+', [weapon, num(4)]), 'slashing')]));
    expect(damageTypesByTerm(roll).get(weapon)).toBe('slashing');
    expect(themer().forRoll(roll)(weapon, 0)).toBe(DAMAGE_THEMES.physical);
  });

  test('outside PF2e: a dnd5e-style piercing die is unchanged', () => {
    const d = { faces: 6, results: [], options: { flavor: 'piercing' } };
    const roll = { options: {}, terms: [d] };
    expect(damageTypesByTerm(roll).get(d)).toBe('piercing');
    expect(themer().forRoll(roll)(d, 0)).toBe(DAMAGE_THEMES.physical);
  });
});

describe('overrides', () => {
  const theme = findTheme('dragon-hoard');

  test('a world damageTypeMap entry swaps in a theme', () => {
    expect(theme).toBeTruthy();
    const { roll, weapon, sneak } = strike();
    const of = themer({ damageTypeMap: { precision: 'dragon-hoard' } }).forRoll(roll);
    expect(of(sneak, 0).themeId).toBe('dragon-hoard');
    expect(of(weapon, 0).id).toBe('physical');
  });

  test("the user's damageThemeOverrides beats the world entry", () => {
    const { roll, sneak } = strike();
    const of = themer({ damageTypeMap: { precision: 'dragon-hoard' }, damageThemeOverrides: { precision: 'bleed' } }).forRoll(roll);
    expect(of(sneak, 0)).toBe(DAMAGE_THEMES.bleed);
    expect(resolveDamageTheme('precision', { userOverrides: { precision: 'none' }, worldMap: { precision: 'fire' } })).toBeNull();
  });
});

describe('the damage map editor', () => {
  test('lists precision among the PF2e rows, and among the others elsewhere', () => {
    const pf2e = damageTypeList({ systemId: 'pf2e' });
    expect(pf2e.slice(0, PF2E_TYPES.length)).toContain('precision');
    expect(damageTypeList({ systemId: 'dnd5e' })).toContain('precision');
  });
});

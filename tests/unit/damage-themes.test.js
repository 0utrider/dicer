import {
  DAMAGE_THEMES,
  DEFAULT_DAMAGE_MAP,
  resolveDamageTheme,
  createDamageThemer,
} from '../../src/effects/damage-themes.js';
import { createRegistry } from '../../src/compat/registry.js';
import { createLookResolver } from '../../src/compat/resolve-looks.js';
import { createFxResolver } from '../../src/effects/fx-resolver.js';
import { composeDecorateFor } from '../../src/effects/fx-resolver.js';
import { planThrow } from '../../src/throw/throw-planner.js';
import { DEFAULT_APPEARANCE } from '../../src/look/appearance.js';
import { colorsetToAppearance, BUILTIN_COLORSETS } from '../../src/compat/colorset-map.js';
import { RESULT_SOUNDS } from '../../src/audio/synth.js';
import { findTheme } from '../../src/themes/themes.js';

const IDS = [
  'fire', 'cold', 'acid', 'electricity', 'sonic', 'poison', 'force',
  'vitality', 'void', 'mental', 'bleed', 'spirit', 'physical',
];

function ctx(extra = {}) {
  const registry = createRegistry({ warn: () => {} });
  return { registry, warn: vi.fn(), ...extra };
}
const idOf = (type, c = ctx()) => {
  const t = resolveDamageTheme(type, c);
  return t ? Object.values(DAMAGE_THEMES).find((x) => x.appearance === t.appearance)?.id : null;
};

describe('DAMAGE_THEMES', () => {
  test('13 frozen themes with a full appearance, a sound material and a landing', () => {
    expect(Object.keys(DAMAGE_THEMES).sort()).toEqual([...IDS].sort());
    expect(Object.isFrozen(DAMAGE_THEMES)).toBe(true);
    for (const id of IDS) {
      const t = DAMAGE_THEMES[id];
      expect(t.id).toBe(id);
      expect(t.appearance.body.type).toBeTruthy();
      expect(['plastic', 'metal', 'wood', 'glass', 'stone']).toContain(t.soundMaterial);
      if (t.landing) {
        expect(typeof t.landing.effect.id).toBe('string');
        if (t.landing.sound) expect(RESULT_SOUNDS).toContain(t.landing.sound.builtin);
      }
    }
    expect(DAMAGE_THEMES.bleed.landing).toBeNull();
    expect(DAMAGE_THEMES.physical.landing).toBeNull();
    expect(DAMAGE_THEMES.fire.landing).toMatchObject({
      effect: { id: 'embers' },
      sound: { builtin: 'crackle' },
    });
    expect(DAMAGE_THEMES.electricity.landing.sound.builtin).toBe('zap');
    expect(DAMAGE_THEMES.void.soundMaterial).toBe('stone');
    expect(DAMAGE_THEMES.physical.soundMaterial).toBe('metal');
    expect(DAMAGE_THEMES.sonic.soundMaterial).toBe('plastic');
  });
});

describe('default mapping', () => {
  test('PF2e types', () => {
    for (const t of ['acid', 'cold', 'electricity', 'fire', 'force', 'mental', 'poison', 'sonic', 'spirit', 'vitality', 'void', 'bleed'])
      expect(DEFAULT_DAMAGE_MAP[t]).toBe(t);
    for (const t of ['bludgeoning', 'piercing', 'slashing']) expect(DEFAULT_DAMAGE_MAP[t]).toBe('physical');
  });
  test('dnd5e types', () => {
    expect(DEFAULT_DAMAGE_MAP).toMatchObject({
      lightning: 'electricity',
      thunder: 'sonic',
      radiant: 'vitality',
      necrotic: 'void',
      psychic: 'mental',
      healing: 'vitality',
      acid: 'acid',
      cold: 'cold',
      fire: 'fire',
      force: 'force',
      poison: 'poison',
      bludgeoning: 'physical',
    });
    expect(DEFAULT_DAMAGE_MAP.untyped).toBeUndefined();
  });
  test('each type resolves to its theme', () => {
    expect(idOf('slashing')).toBe('physical');
    expect(idOf('thunder')).toBe('sonic');
    expect(idOf('necrotic')).toBe('void');
    expect(idOf('fire')).toBe('fire');
    expect(resolveDamageTheme('untyped', ctx())).toBeNull();
  });
  test('a type with no mapping anywhere is no theme, silently', () => {
    const c = ctx();
    expect(resolveDamageTheme('ichor', c)).toBeNull();
    expect(resolveDamageTheme('constructor', c)).toBeNull();
    expect(c.warn).not.toHaveBeenCalled();
  });
  test('the result carries appearance, soundMaterial and landing', () => {
    expect(resolveDamageTheme('fire', ctx())).toEqual({
      appearance: DAMAGE_THEMES.fire.appearance,
      soundMaterial: 'glass',
      landing: DAMAGE_THEMES.fire.landing,
      id: 'fire',
    });
  });
});

describe('resolution chain', () => {
  test("a user override 'none' disables the theme, beating every level", () => {
    const c = ctx({ userOverrides: { fire: 'none' }, worldMap: { fire: 'acid' } });
    expect(resolveDamageTheme('fire', c)).toBeNull();
  });
  test('a user override names a theme and beats the world map', () => {
    const c = ctx({ userOverrides: { fire: 'cold' }, worldMap: { fire: 'acid' } });
    expect(idOf('fire', c)).toBe('cold');
  });
  test('the world map remaps a type to a theme', () => {
    expect(idOf('fire', ctx({ worldMap: { fire: 'acid' } }))).toBe('acid');
  });
  test('a world map colorset name gives the look only', () => {
    const t = resolveDamageTheme('fire', ctx({ worldMap: { fire: 'fire' } }));
    // 'fire' names a theme id first, so use a pure colorset name
    expect(t.id).toBe('fire');
    const c = ctx({ worldMap: { fire: 'ice' } });
    const ice = resolveDamageTheme('fire', c);
    expect(ice.appearance).toEqual(colorsetToAppearance(BUILTIN_COLORSETS.ice, { index: 0 }));
    expect(ice.soundMaterial).toBeUndefined();
    expect(ice.landing).toBeUndefined();
  });
  test('addDamageTypeDefaults beats the built-in map but loses to the world map', () => {
    const c = ctx();
    c.registry.addDamageTypeDefaults({ fire: 'ice' });
    const viaDsn = resolveDamageTheme('fire', c);
    expect(viaDsn.appearance).toEqual(colorsetToAppearance(BUILTIN_COLORSETS.ice, { index: 0 }));
    expect(viaDsn.landing).toBeUndefined();
    expect(idOf('fire', { ...c, worldMap: { fire: 'acid' } })).toBe('acid');
  });
  test('a colorset-typed damage type from a module resolves with no theme fx', () => {
    const c = ctx();
    c.registry.addDamageTypeDefaults({ ichor: 'ice' });
    expect(resolveDamageTheme('ichor', c).appearance).toBeTruthy();
  });
  test('an unknown mapping value warns once and gives no theme', () => {
    const warned = new Set();
    const c = ctx({ worldMap: { fire: 'no-such-thing' }, warned });
    expect(resolveDamageTheme('fire', c)).toBeNull();
    expect(resolveDamageTheme('fire', c)).toBeNull();
    expect(c.warn).toHaveBeenCalledTimes(1);
  });
  test('malformed inputs never throw', () => {
    const c = ctx({ userOverrides: 'x', worldMap: [1], registry: null });
    expect(() => resolveDamageTheme('fire', c)).not.toThrow();
    expect(idOf('fire', c)).toBe('fire');
  });
});

// ---- integration through the look + fx resolvers --------------------------------------

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
const die = (faces, results, extra = {}) => ({ faces, options: {}, results, ...extra });
const pf2e = (...instances) => ({
  options: {},
  terms: [new InstancePool(instances)],
  instances,
  get dice() {
    return instances.flatMap((i) => i.terms);
  },
});

function setup({ settings = {}, extra = {}, me = 'alice' } = {}) {
  const s = { damagePresets: true, effects: true, showOthersEffects: true, ...settings };
  const registry = createRegistry({ warn: () => {} });
  const warn = vi.fn();
  const themer = createDamageThemer({ registry, getSetting: (k) => s[k], warn });
  const looks = createLookResolver({
    registry,
    getUser: () => undefined,
    warn,
    damageThemeFor: (roll) => themer.forRoll(roll),
    ...extra,
  });
  const fx = createFxResolver({
    getWorldRules: () => [],
    getUserRules: () => undefined,
    currentUser: () => ({ id: me }),
    getSetting: (k) => s[k],
    getKnownDamageTypes: () => themer.knownTypes(),
    damageThemeFor: (roll) => themer.forRoll(roll),
    warn,
  });
  const decorateFor = composeDecorateFor({ looks, fx, warn });
  const plan = (roll, msg = { author: { id: 'alice' } }) =>
    planThrow(roll, { decorate: decorateFor(msg, roll) }).dice;
  return { s, registry, plan, themer, warn };
}

describe('PF2e damage roll through the resolvers', () => {
  const roll = () => {
    const d6a = die(6, [{ result: 3 }, { result: 4 }]);
    const d4 = die(4, [{ result: 2 }]);
    return pf2e(new DamageInstance('fire', [d6a]), new DamageInstance('cold', [d4]));
  };
  test('2d6 fire + 1d4 cold: fire looks on the d6s, cold on the d4', () => {
    const { plan } = setup();
    const dice = plan(roll());
    expect(dice).toHaveLength(3);
    expect(dice[0].appearance).toBe(DAMAGE_THEMES.fire.appearance);
    expect(dice[1].appearance).toBe(DAMAGE_THEMES.fire.appearance);
    expect(dice[2].appearance).toBe(DAMAGE_THEMES.cold.appearance);
    expect(dice.map((d) => d.damageType)).toEqual(['fire', 'fire', 'cold']);
    expect(dice.map((d) => d.soundMaterial)).toEqual(['glass', 'glass', 'glass']);
    expect(dice[0].fx.map((f) => f.ruleId)).toEqual(['damage:fire']);
    expect(dice[0].fx[0]).toMatchObject({
      effect: { id: 'embers' },
      sound: { builtin: 'crackle' },
      macro: null,
      slowMotion: false,
    });
    expect(dice[2].fx[0].ruleId).toBe('damage:cold');
  });
  test('damagePresets off: no theme look, sound material or landing', () => {
    const { plan } = setup({ settings: { damagePresets: false } });
    const dice = plan(roll());
    for (const d of dice) {
      expect(d.appearance).toEqual(DEFAULT_APPEARANCE);
      expect(d.soundMaterial).toBeUndefined();
      expect(d.damageType).toBeUndefined();
      expect(d.fx).toBeUndefined();
    }
  });
  test('P4-R7: effects off keeps the damage type, theme look and sound material, drops landing fx', () => {
    const { plan } = setup({ settings: { effects: false } });
    const dice = plan(roll());
    expect(dice[0].appearance).toBe(DAMAGE_THEMES.fire.appearance);
    expect(dice[0].soundMaterial).toBe('glass');
    expect(dice[0].damageType).toBe('fire');
    expect(dice[0].fx).toBeUndefined();
  });
  test("P4-R7: another roller with showOthersEffects off keeps look/sound/damage type, no landing fx", () => {
    const { plan } = setup({ settings: { showOthersEffects: false } });
    const dice = plan(roll(), { author: { id: 'bob' } });
    expect(dice[2].appearance).toBe(DAMAGE_THEMES.cold.appearance);
    expect(dice[2].damageType).toBe('cold');
    expect(dice[2].fx).toBeUndefined();
    // my own roll still lands its fx
    expect(plan(roll())[2].fx).toHaveLength(1);
  });
  test('an explicit options.colorset beats the theme (and its sound material)', () => {
    const { plan } = setup();
    const d6 = die(6, [{ result: 3 }], { options: { colorset: 'ice' } });
    const dice = plan(pf2e(new DamageInstance('fire', [d6])));
    expect(dice[0].appearance).toEqual(colorsetToAppearance(BUILTIN_COLORSETS.ice, { index: 0 }));
    expect(dice[0].soundMaterial).toBeUndefined();
  });
  test('the theme beats the actor flag', () => {
    const actors = { a1: { flags: { dicer: { appearance: { look: 'ruby-classic' } } } } };
    const { plan } = setup({ extra: { getActor: (id) => actors[id] } });
    const d6 = die(6, [{ result: 3 }], { options: { dsnActorId: 'a1' } });
    expect(plan(pf2e(new DamageInstance('fire', [d6])))[0].appearance).toBe(DAMAGE_THEMES.fire.appearance);
  });
  test('a raw instance type with no mapping is no theme and no warning', () => {
    const { plan, warn } = setup();
    const d = die(6, [{ result: 3 }]);
    const [out] = plan(pf2e(new DamageInstance('ichor', [d])));
    expect(out.appearance).toEqual(DEFAULT_APPEARANCE);
    expect(out.fx).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
  test('knownTypes is the union of the systems, the DSN defaults and the world map', () => {
    const { themer, registry, s } = setup();
    expect(themer.knownTypes().has('fire')).toBe(true);
    expect(themer.knownTypes().has('ichor')).toBe(false);
    registry.addDamageTypeDefaults({ ichor: 'ice' });
    s.damageTypeMap = { goo: 'acid' };
    const k = themer.knownTypes();
    expect(k.has('ichor') && k.has('goo') && k.has('thunder')).toBe(true);
  });
});

describe('a damage-map value naming a Plan 5 theme', () => {
  const hoard = findTheme('dragon-hoard');
  test('gives its look for the die type, its sound material, no landing and its id', () => {
    const d20 = resolveDamageTheme('fire', ctx({ worldMap: { fire: 'dragon-hoard' }, dieType: 'd20' }));
    expect(d20).toEqual({ appearance: hoard.perType.d20, soundMaterial: 'metal', landing: null, themeId: 'dragon-hoard' });
    const d6 = resolveDamageTheme('fire', ctx({ userOverrides: { fire: 'dragon-hoard' }, dieType: 'd6' }));
    expect(d6.appearance).toBe(hoard.appearance);
  });
  test('a damage theme id still wins, and world themes are found', () => {
    expect(idOf('fire', ctx({ worldMap: { fire: 'cold' } }))).toBe('cold');
    const w = { id: 'world.w', name: 'W', appearance: { body: { type: 'opaque', color: '#0a0b0c' } } };
    const out = resolveDamageTheme('fire', ctx({ worldMap: { fire: 'world.w' }, themes: { worldThemes: [w] } }));
    expect(out.appearance.body.color).toBe('#0a0b0c');
    expect(out.themeId).toBe('world.w');
  });
  test('through the resolvers: the d20 of a fire roll takes the theme look, no landing fx', () => {
    const { plan } = setup({ settings: { damageTypeMap: { fire: 'dragon-hoard' } } });
    const dice = plan(pf2e(new DamageInstance('fire', [die(20, [{ result: 7 }]), die(6, [{ result: 2 }])])));
    expect(dice[0].appearance).toBe(hoard.perType.d20);
    expect(dice[1].appearance).toBe(hoard.appearance);
    expect(dice[0].soundMaterial).toBe('metal');
    expect(dice[0].themeId).toBe('dragon-hoard');
    expect(dice[0].fx).toBeUndefined();
  });
  test("a user override may name the roller's own theme", () => {
    const mine = { id: 'user.mine', name: 'Mine', appearance: { body: { type: 'opaque', color: '#0c0b0a' } } };
    const registry = createRegistry({ warn: () => {} });
    const s = { damagePresets: true, damageThemeOverrides: { fire: 'user.mine' } };
    const themer = createDamageThemer({
      registry,
      getSetting: (k) => s[k],
      getUserThemes: (id) => (id === 'alice' ? [mine] : undefined),
      warn: () => {},
    });
    const d6 = die(6, [{ result: 2 }]);
    const roll = pf2e(new DamageInstance('fire', [d6]));
    expect(themer.forRoll(roll, 'alice')(d6, 0).appearance.body.color).toBe('#0c0b0a');
    expect(themer.forRoll(roll, 'bob')(d6, 0)).toBeNull();
  });
  test('a world theme named in the map is read from the worldThemes setting', () => {
    const w = { id: 'world.w', name: 'W', appearance: { body: { type: 'opaque', color: '#0a0b0c' } } };
    const { plan } = setup({ settings: { damageTypeMap: { fire: 'world.w' }, worldThemes: [w] } });
    const [d] = plan(pf2e(new DamageInstance('fire', [die(6, [{ result: 2 }])])));
    expect(d.appearance.body.color).toBe('#0a0b0c');
  });
});

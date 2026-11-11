import { createLookResolver } from '../../src/compat/resolve-looks.js';
import { facesFor } from '../../src/compat/faces.js';
import { createRegistry } from '../../src/compat/registry.js';
import { LOOKS } from '../../src/look/looks.js';
import { findTheme } from '../../src/themes/themes.js';
import { themeRef } from '../../src/compat/user-looks.js';
import { slotPatch } from '../../src/ui/theme-form.js';
import { DEFAULT_APPEARANCE } from '../../src/look/appearance.js';
import { colorsetToAppearance, BUILTIN_COLORSETS } from '../../src/compat/colorset-map.js';

const user = (flag) => ({
  getFlag: (s, k) => (s === 'dicer' && k === 'appearance' ? flag : undefined),
});
const term = (faces, extra = {}) => ({ faces, options: {}, results: [{ result: 1 }], ...extra });
const RES = { result: 1 };
const CRYSTAL = LOOKS['sharp-crystal'].appearance;
const RUBY = LOOKS['ruby-classic'].appearance;

function make({ users = {}, actors = {}, facesFor, worldDefault = '', lock = false } = {}) {
  const registry = createRegistry({ warn: () => {} });
  const warn = vi.fn();
  const resolver = createLookResolver({
    registry,
    getUser: (id) => users[id],
    getActor: (id) => actors[id],
    warn,
    facesFor,
    getWorldDefaultTheme: () => worldDefault,
    getLockPlayerLooks: () => lock,
  });
  return { registry, warn, resolver };
}
const look = (resolver, t, authorId, i = 0) => resolver.decorate(null, {}, authorId)(t, RES, i);
const fire = colorsetToAppearance(BUILTIN_COLORSETS.fire, { index: 0 });

describe('rule precedence', () => {
  test('1. options.appearance wins over everything', () => {
    const { resolver } = make();
    const options = { appearance: { body: { type: 'opaque', color: '#123456' } }, colorset: 'fire' };
    const t = term(20, { options, flavor: 'ice' });
    expect(look(resolver, t, 'u').appearance.body.color).toBe('#123456');
  });
  test('2. options.colorset beats a matching flavor', () => {
    const { resolver } = make();
    const t = term(20, { options: { colorset: 'fire' }, flavor: 'ice' });
    expect(look(resolver, t, 'u').appearance).toEqual(fire);
  });
  test('3. a die:fire flavor and a bare case-insensitive flavor name a colorset', () => {
    const { resolver } = make();
    expect(look(resolver, term(20, { flavor: 'die:fire' }), 'u').appearance).toEqual(fire);
    expect(look(resolver, term(20, { flavor: 'Fire' }), 'u').appearance).toEqual(fire);
    const other = look(resolver, term(20, { flavor: 'fire and brimstone' }), 'u');
    expect(other.appearance).toEqual(DEFAULT_APPEARANCE);
  });
  test('4. dsnActorId reads the actor flag LookRef', () => {
    const actors = { a1: { flags: { dicer: { appearance: { look: 'ruby-classic' } } } } };
    const { resolver } = make({ actors });
    expect(look(resolver, term(20, { options: { dsnActorId: 'a1' } }), 'u').appearance).toBe(RUBY);
    const missing = term(20, { options: { dsnActorId: 'nobody' } });
    expect(look(resolver, missing, 'u').appearance).toEqual(DEFAULT_APPEARANCE);
  });
  test('5. the author: per-type entry, else global', () => {
    const flag = { d20: { look: 'sharp-crystal' }, global: { look: 'ruby-classic' } };
    const { resolver } = make({ users: { u: user(flag) } });
    expect(look(resolver, term(20), 'u').appearance).toBe(CRYSTAL);
    expect(look(resolver, term(6), 'u').appearance).toBe(RUBY);
  });
  test('6. an unknown author gets the default', () => {
    const { resolver } = make();
    expect(look(resolver, term(6), 'ghost').appearance).toEqual(DEFAULT_APPEARANCE);
  });
});

test('two authors in one roll resolve independently', () => {
  const { resolver } = make({
    users: {
      a: user({ global: { look: 'ruby-classic' } }),
      b: user({ global: { look: 'sharp-crystal' } }),
    },
  });
  expect(look(resolver, term(20), 'a').appearance).toBe(RUBY);
  expect(look(resolver, term(20), 'b').appearance).toBe(CRYSTAL);
});

describe('systems and presets', () => {
  test('a pf2e preset attaches its model and consults the faces seam', async () => {
    const facesFor = vi.fn(() => undefined);
    const users = { u: user({ global: { look: 'default', system: 'pf2e' } }) };
    const { registry, resolver } = make({ facesFor, users });
    await registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    const out = look(resolver, term(20), 'u');
    expect(out.model).toBe('m.glb');
    expect(out).not.toHaveProperty('faces');
    expect(facesFor).toHaveBeenCalledWith(registry.presetFor('pf2e', 'd20'));
  });
  test('the system can come from options.appearance.system', async () => {
    const { registry, resolver } = make();
    await registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    const t = term(20, { options: { appearance: { system: 'pf2e' } } });
    expect(look(resolver, t, 'u').model).toBe('m.glb');
    expect(look(resolver, term(20), 'u').model).toBeUndefined();
  });
  test('the preset colorset replaces the author look but not an explicit colorset', async () => {
    const users = { u: user({ global: { look: 'ruby-classic', system: 'pf2e' } }) };
    const { registry, resolver } = make({ users });
    const preset = { type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb', colorset: 'fire' };
    await registry.addDicePreset(preset);
    expect(look(resolver, term(20), 'u').appearance).toEqual(fire);
    const explicit = look(resolver, term(20, { options: { colorset: 'ice' } }), 'u');
    expect(explicit.appearance).not.toEqual(fire);
  });
});

describe('model urls', () => {
  test('a die gets the routed model url, the one the registry loads', async () => {
    const registry = createRegistry({ warn: () => {}, routeUrl: (u) => `/prefix/${u}` });
    const resolver = createLookResolver({ registry, getUser: () => undefined, warn: vi.fn() });
    await registry.addDicePreset({ type: 'd20', system: 'standard', labels: '', modelFile: 'm.glb' });
    expect(look(resolver, term(20), 'u').model).toBe('/prefix/m.glb');
  });
});

describe('dsnType and system resolution', () => {
  test('dsnType carries the DSN die type; custom dice use d + denomination', () => {
    const { resolver } = make();
    class Coin {
      static DENOMINATION = 'c';
    }
    expect(look(resolver, term(20), 'u').dsnType).toBe('d20');
    expect(look(resolver, term(2, { constructor: Coin }), 'u').dsnType).toBe('dc');
  });
  test('the decorated spec carries the preset system, else the resolved one, else standard', async () => {
    const users = { u: user({ global: { system: 'pf2e' } }), v: user(undefined) };
    const { registry, resolver } = make({ users });
    await registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    expect(look(resolver, term(20), 'u').system).toBe('pf2e');
    expect(look(resolver, term(6), 'u').system).toBe('pf2e'); // no d6 preset: the resolved system
    expect(look(resolver, term(20), 'v').system).toBe('standard');
  });
  test('a custom die finds its per-type flag and preset by d + denomination', async () => {
    class Coin {
      static DENOMINATION = 'c';
    }
    const users = { u: user({ dc: { look: 'sharp-crystal', system: 'coins' } }) };
    const { registry, resolver } = make({ users });
    await registry.addDicePreset({ type: 'dc', system: 'coins', labels: ['H', 'T'], modelFile: 'c.glb' });
    const out = look(resolver, term(2, { constructor: Coin }), 'u');
    expect(out.appearance).toBe(CRYSTAL);
    expect(out.model).toBe('c.glb');
  });
  test('a system-only d20 ref keeps the global look as its colour source', async () => {
    const flag = { d20: { system: 'pf2e' }, global: { look: 'ruby-classic' } };
    const { registry, resolver } = make({ users: { u: user(flag) } });
    await registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    const out = look(resolver, term(20), 'u');
    expect(out.model).toBe('m.glb');
    expect(out.appearance).toBe(RUBY);
    expect(look(resolver, term(6), 'u').model).toBeUndefined();
  });
  test('a die:fire flavor keeps the author preset model', async () => {
    const { registry, resolver } = make({ users: { u: user({ global: { system: 'pf2e' } }) } });
    await registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    const out = look(resolver, term(20, { flavor: 'die:fire' }), 'u');
    expect(out.appearance).toEqual(fire);
    expect(out.model).toBe('m.glb');
  });
  test('options.appearance.system beats the author system', async () => {
    const { registry, resolver } = make({ users: { u: user({ global: { system: 'a' } }) } });
    await registry.addDicePreset({ type: 'd20', system: 'a', labels: [], modelFile: 'a.glb' });
    await registry.addDicePreset({ type: 'd20', system: 'b', labels: [], modelFile: 'b.glb' });
    const t = term(20, { options: { appearance: { system: 'b' } } });
    expect(look(resolver, t, 'u').model).toBe('b.glb');
  });
  test('faces is absent when the seam returns undefined, present otherwise', async () => {
    const users = { u: user({ global: { system: 'pf2e' } }) };
    const a = make({ users });
    await a.registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    expect(look(a.resolver, term(20), 'u')).not.toHaveProperty('faces');
    const set = { key: 'k', labels: [] };
    const b = make({ users, facesFor: () => set });
    await b.registry.addDicePreset({ type: 'd20', system: 'pf2e', labels: [], modelFile: 'm.glb' });
    expect(look(b.resolver, term(20), 'u').faces).toBe(set);
  });
  test('a throwing facesFor drops the faces but keeps the look', async () => {
    const users = { u: user({ global: { system: 'pf2e' } }) };
    const facesFor = () => {
      throw new Error('bad preset');
    };
    const { registry, resolver, warn } = make({ users, facesFor });
    await registry.addDicePreset({
      type: 'd20',
      system: 'pf2e',
      labels: [],
      modelFile: 'm.glb',
      colorset: 'fire',
    });
    const out = look(resolver, term(20), 'u');
    expect(out).not.toHaveProperty('faces');
    expect(out.model).toBe('m.glb');
    expect(out.appearance).toEqual(fire);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  test('the real facesFor turns a Fate preset into text and blank faces', async () => {
    const users = { u: user({ global: { system: 'fate' } }) };
    const digits = (t) => /^[0-9]{1,2}$/.test(t);
    const { registry, resolver } = make({ users, facesFor: (p) => facesFor(p, digits) });
    await registry.addDicePreset({ type: 'df', system: 'fate', labels: ['-', '-', '', '', '+', '+'] }, 'd6');
    class Fate {
      static DENOMINATION = 'f';
    }
    const t = Object.assign(new Fate(), { faces: 3, options: {}, results: [RES] });
    const out = look(resolver, t, 'u');
    expect(out.faces.key.startsWith('fate|df|')).toBe(true);
    expect(new Set(out.faces.labels.map((l) => l.kind))).toEqual(new Set(['text', 'blank']));
  });
});

describe('shapeFor', () => {
  test('built-in dN types, aliases and custom denominations; d100 and unknown give null', async () => {
    const { registry, resolver } = make();
    await registry.addDicePreset({ type: 'dc', labels: ['1', '2', '3', '4', '5', '6'] }, 'd6');
    await registry.addDicePreset({ type: 'df', labels: ['-', '-', '0', '0', '+', '+'] }, 'd6');
    class Coin {
      static DENOMINATION = 'c';
    }
    class Fate {
      static DENOMINATION = 'f';
    }
    expect(resolver.shapeFor(term(20))).toBe('d20');
    expect(resolver.shapeFor(term(6, { constructor: Coin }))).toBe('d6');
    expect(resolver.shapeFor(term(3, { constructor: Fate }))).toBe('d6');
    expect(resolver.shapeFor(term(100))).toBeNull();
    expect(resolver.shapeFor(term(7))).toBeNull();
    expect(resolver.shapeFor({})).toBeNull();
    expect(resolver.shapeFor(null)).toBeNull();
  });
});

test('resolver survives garbage flags', () => {
  const flag = { global: { appearance: 'nope' }, d20: null };
  const { resolver } = make({
    users: { u: { getFlag: () => flag, flags: { dicer: { appearance: flag } } } },
    actors: { a: { flags: { dicer: { appearance: 5 } } } },
  });
  const options = { dsnActorId: 'a', appearance: 7, colorset: {} };
  expect(look(resolver, term(20, { options, flavor: 42 }), 'u').appearance).toEqual(
    DEFAULT_APPEARANCE,
  );
  expect(look(resolver, term(20), 'u').appearance).toEqual(DEFAULT_APPEARANCE);
});

test('a throwing user lookup warns once and falls back to the default look', () => {
  const warn = vi.fn();
  const getUser = () => {
    throw new Error('x');
  };
  const resolver = createLookResolver({
    registry: createRegistry({ warn: () => {} }),
    getUser,
    warn,
  });
  const dec = resolver.decorate(null, {}, 'u');
  expect(dec(term(20), RES, 0)).toEqual({ appearance: DEFAULT_APPEARANCE });
  expect(() => dec(term(20), RES, 0)).not.toThrow();
  expect(warn).toHaveBeenCalledTimes(1);
});

describe('damage theme (P4-D3)', () => {
  const THEME = { appearance: LOOKS['jade-marble'].appearance, soundMaterial: 'stone' };
  const themed = (users = {}, actors = {}) => {
    const registry = createRegistry({ warn: () => {} });
    return createLookResolver({
      registry,
      getUser: (id) => users[id],
      getActor: (id) => actors[id],
      damageThemeFor: () => () => THEME,
      warn: () => {},
    });
  };
  test('beats the actor flag and the user look; carries soundMaterial', () => {
    const actors = { a1: { flags: { dicer: { appearance: { look: 'ruby-classic' } } } } };
    const users = { u: user({ global: { look: 'sharp-crystal' } }) };
    const out = look(themed(users, actors), term(6, { options: { dsnActorId: 'a1' } }), 'u');
    expect(out.appearance).toBe(THEME.appearance);
    expect(out.soundMaterial).toBe('stone');
  });
  test('loses to options.colorset and to a flavor colorset, with no soundMaterial', () => {
    const r = themed();
    expect(look(r, term(6, { options: { colorset: 'fire' } }), 'u').appearance).toEqual(fire);
    const byFlavor = look(r, term(6, { flavor: 'Fire' }), 'u');
    expect(byFlavor.appearance).toEqual(fire);
    expect(byFlavor.soundMaterial).toBeUndefined();
  });
  test('a throwing damageThemeFor leaves the normal chain', () => {
    const registry = createRegistry({ warn: () => {} });
    const r = createLookResolver({
      registry,
      getUser: () => undefined,
      damageThemeFor: () => {
        throw new Error('x');
      },
      warn: () => {},
    });
    expect(look(r, term(6), 'u').appearance).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('themes in the look chain (Plan 5)', () => {
  const hoard = findTheme('dragon-hoard');
  const obsidian = findTheme('obsidian');
  /** A user whose dicer.appearance and dicer.themes flags are given. */
  const userT = (appearance, themes) => ({
    getFlag: (s, k) => (s !== 'dicer' ? undefined : k === 'appearance' ? appearance : k === 'themes' ? themes : undefined),
  });
  const makeT = ({ users = {}, actors = {}, worldThemes = [] } = {}) => {
    const warn = vi.fn();
    const resolver = createLookResolver({
      registry: createRegistry({ warn: () => {} }),
      getUser: (id) => users[id],
      getActor: (id) => actors[id],
      getWorldThemes: () => worldThemes,
      warn,
    });
    return { resolver, warn };
  };
  const msg = (pf2eType) => ({ flags: { pf2e: { context: { type: pf2eType } } } });
  const lookOn = (resolver, message, t, authorId) => resolver.decorate(message, {}, authorId)(t, RES, 0);

  test('a global theme ref resolves per die type, with its id and sound material', () => {
    const { resolver } = makeT({ users: { u: userT({ global: { theme: 'dragon-hoard' } }) } });
    const d20 = look(resolver, term(20), 'u');
    expect(d20.appearance).toBe(hoard.perType.d20);
    expect(d20.themeId).toBe('dragon-hoard');
    expect(d20.soundMaterial).toBe('metal');
    expect(look(resolver, term(6), 'u').appearance).toBe(hoard.appearance);
  });
  test('a role ref beats a type ref on an attack roll and is ignored on a damage roll', () => {
    const flag = { 'role:attack': { theme: 'obsidian' }, d20: { look: 'ruby-classic' } };
    const { resolver } = makeT({ users: { u: userT(flag) } });
    const attack = lookOn(resolver, msg('attack-roll'), term(20), 'u');
    expect(attack.appearance).toBe(obsidian.appearance);
    expect(attack.themeId).toBe('obsidian');
    expect(lookOn(resolver, msg('damage-roll'), term(20), 'u').appearance).toBe(RUBY);
    expect(lookOn(resolver, null, term(20), 'u').appearance).toBe(RUBY); // showForRoll: no role
  });
  test("an actor's theme ref beats the user's", () => {
    const actors = { a1: { flags: { dicer: { appearance: { theme: 'obsidian' } } } } };
    const users = { u: userT({ global: { theme: 'dragon-hoard' } }) };
    const { resolver } = makeT({ users, actors });
    const out = look(resolver, term(20, { options: { dsnActorId: 'a1' } }), 'u');
    expect(out.appearance).toBe(obsidian.appearance);
    expect(out.themeId).toBe('obsidian');
  });
  test("a damage theme's sound material wins over the theme's", () => {
    const users = { u: userT({ global: { theme: 'dragon-hoard' } }) };
    const resolver = createLookResolver({
      registry: createRegistry({ warn: () => {} }),
      getUser: (id) => users[id],
      damageThemeFor: () => () => ({ appearance: RUBY, soundMaterial: 'stone' }),
      warn: () => {},
    });
    const out = look(resolver, term(6), 'u');
    expect(out).toMatchObject({ appearance: RUBY, soundMaterial: 'stone' });
    expect(out.themeId).toBeUndefined();
  });
  test("the roller's own and the world's themes resolve; bad stored entries are skipped", () => {
    const mine = { id: 'user.mine', name: 'Mine', appearance: { body: { type: 'opaque', color: '#0000aa' } } };
    const world = { id: 'world.ours', name: 'Ours', appearance: { body: { type: 'opaque', color: '#00aa00' } } };
    const users = {
      u: userT({ global: { theme: 'user.mine' } }, [5, mine]),
      v: userT({ global: { theme: 'world.ours' } }),
    };
    const { resolver } = makeT({ users, worldThemes: [world, null] });
    expect(look(resolver, term(6), 'u').appearance.body.color).toBe('#0000aa');
    expect(look(resolver, term(6), 'v').appearance.body.color).toBe('#00aa00');
    expect(look(resolver, term(6), 'v').themeId).toBe('world.ours');
  });
  test('a ref to a deleted user theme falls back to the default look, one warning per roller', () => {
    const users = {
      u: userT({ global: { theme: 'user.gone' } }, []),
      v: userT({ global: { theme: 'user.gone' } }, []),
    };
    const { resolver, warn } = makeT({ users });
    expect(look(resolver, term(20), 'u').appearance).toEqual(DEFAULT_APPEARANCE);
    expect(look(resolver, term(6), 'u').appearance).toEqual(DEFAULT_APPEARANCE);
    expect(look(resolver, term(20), 'u').themeId).toBeUndefined();
    const missing = () => warn.mock.calls.filter((c) => String(c[0]).includes('user.gone'));
    expect(missing()).toHaveLength(1);
    look(resolver, term(20), 'v');
    expect(missing()).toHaveLength(2);
  });
});

describe('actor theme assignment (the theme browser write)', () => {
  const actorWith = (appearance) => ({ a1: { flags: { dicer: { appearance } } } });
  const t20 = { options: { dsnActorId: 'a1' } };

  test("{global: {theme}} as written by the browser's slotPatch resolves to the theme", () => {
    const { resolver } = make({ actors: actorWith(slotPatch('global', 'dragon-hoard')) });
    const out = look(resolver, term(20, t20), 'u');
    expect(out.themeId).toBe('dragon-hoard');
    expect(out.appearance).toBe(findTheme('dragon-hoard').perType.d20);
  });
  test('assigning a theme via global beats an old flat look on the same actor; the flat form still works alone', () => {
    const merged = { look: 'ruby-classic', ...slotPatch('global', 'dragon-hoard') };
    const { resolver } = make({ actors: actorWith(merged) });
    expect(look(resolver, term(20, t20), 'u').themeId).toBe('dragon-hoard');
    const flat = make({ actors: actorWith({ look: 'ruby-classic' }) }).resolver;
    expect(look(flat, term(20, t20), 'u').appearance).toBe(RUBY);
  });
  test('Clear removes only the global slot (what remains is the flat flag)', () => {
    const { resolver } = make({ actors: actorWith({ look: 'ruby-classic' }) });
    expect(look(resolver, term(20, t20), 'u').appearance).toBe(RUBY);
  });
  test("a viewer-sourced damage theme's source is carried on the partial", () => {
    const registry = createRegistry({ warn: () => {} });
    const resolver = createLookResolver({
      registry,
      getUser: () => undefined,
      warn: () => {},
      damageThemeFor: () => () => ({ appearance: RUBY, themeId: 'dragon-hoard', themeSource: 'viewer' }),
    });
    expect(look(resolver, term(20), 'u')).toMatchObject({ themeId: 'dragon-hoard', themeSource: 'viewer' });
  });
});

describe('GM controls: world default theme and the player lock (P7-D4)', () => {
  const T = (id) => ({ global: { theme: id } });
  const dieOf = (id) => findTheme(id).appearance;
  const plain = term(20);
  test('without the lock the world default is the fallback for a player with no choice of their own', () => {
    const { resolver } = make({ users: { p: user(undefined) }, worldDefault: 'verdant' });
    const got = look(resolver, plain, 'p');
    expect(got.themeId).toBe('verdant');
    expect(got.appearance).toBe(dieOf('verdant'));
  });
  test('without the lock a player choice (global, per-type) beats the world default; the default beats DEFAULT_APPEARANCE only when unset', () => {
    const users = { p: user({ ...T('ruby-classic'), d6: T('obsidian').global }) };
    const { resolver } = make({ users, worldDefault: 'verdant' });
    expect(look(resolver, plain, 'p').themeId).toBe('ruby-classic');
    expect(look(resolver, term(6), 'p').themeId).toBe('obsidian');
    const none = make({ users: { p: user(undefined) } });
    expect(look(none.resolver, plain, 'p').appearance).toEqual(DEFAULT_APPEARANCE);
  });
  test('an unset or missing world default falls through to the next look; a missing theme warns once', () => {
    const { resolver, warn } = make({ users: { p: user(undefined) }, worldDefault: 'world.gone' });
    expect(look(resolver, plain, 'p').appearance).toEqual(DEFAULT_APPEARANCE);
    look(resolver, plain, 'p');
    expect(warn.mock.calls.filter((c) => /world\.gone/.test(c[0]))).toHaveLength(1);
  });
  test("a mirrored 'never chose' global (the real themeRef shape, or none) lets the world default apply", () => {
    for (const flag of [{ global: themeRef('default') }, { global: { look: 'default' } }, { global: { theme: 'default' } }]) {
      const { resolver } = make({ users: { p: user(flag) }, worldDefault: 'verdant' });
      expect(look(resolver, plain, 'p').themeId).toBe('verdant');
    }
    // a real choice, even of another theme or a colorset on top of default, still wins
    const keep = make({ users: { p: user({ global: themeRef('obsidian') }) }, worldDefault: 'verdant' });
    expect(look(keep.resolver, plain, 'p').themeId).toBe('obsidian');
    const cs = make({ users: { p: user({ global: { theme: 'default', colorset: 'fire' } }) }, worldDefault: 'verdant' });
    expect(look(cs.resolver, plain, 'p').appearance).toEqual(fire);
    // without a world default the built-in default is unchanged
    const none = make({ users: { p: user({ global: themeRef('default') }) } });
    expect(look(none.resolver, plain, 'p').appearance).toEqual(LOOKS.default.appearance);
  });
  test('the lock makes the world default win over a player own refs (global, type, role) and actor flags', () => {
    const users = { p: user({ ...T('ruby-classic'), d20: T('obsidian').global, 'role:attack': T('obsidian').global }) };
    const actors = { a1: { flags: { dicer: { appearance: T('obsidian') } } } };
    const { resolver } = make({ users, actors, worldDefault: 'verdant', lock: true });
    const t = term(20, { options: { dsnActorId: 'a1' } });
    const got = resolver.decorate({ flags: { dicer: { role: 'attack' } } }, {}, 'p')(t, RES, 0);
    expect(got.themeId).toBe('verdant');
    expect(look(resolver, term(6), 'p').themeId).toBe('verdant');
  });
  test('the lock never applies to a GM, and does nothing without a world default', () => {
    const users = { g: { isGM: true, ...user(T('ruby-classic')) }, p: user(T('ruby-classic')) };
    const locked = make({ users, worldDefault: 'verdant', lock: true });
    expect(look(locked.resolver, plain, 'g').themeId).toBe('ruby-classic');
    const noDefault = make({ users, worldDefault: '', lock: true });
    expect(look(noDefault.resolver, plain, 'p').themeId).toBe('ruby-classic');
  });
  test('explicit roll colorsets and appearances and damage themes keep their precedence under the lock', () => {
    const damageThemeFor = () => (t) => ({ appearance: CRYSTAL, themeId: 'obsidian', soundMaterial: 'metal' });
    const registry = createRegistry({ warn: () => {} });
    const resolver = createLookResolver({
      registry,
      getUser: () => user(T('ruby-classic')),
      damageThemeFor,
      warn: () => {},
      getWorldDefaultTheme: () => 'verdant',
      getLockPlayerLooks: () => true,
    });
    const via = (t) => resolver.decorate(null, {}, 'p')(t, RES, 0);
    expect(via(plain).themeId).toBe('obsidian'); // the damage theme
    expect(via(term(20, { options: { colorset: 'fire' } })).appearance).toEqual(fire);
    const explicit = { appearance: { body: { type: 'opaque', color: '#123456' } } };
    expect(via(term(20, { options: explicit })).appearance.body.color).toBe('#123456');
  });
  test('a locked player with a throwing user lookup still gets a look', () => {
    const { resolver } = make({ users: {}, worldDefault: 'verdant', lock: true });
    expect(look(resolver, plain, 'nobody').themeId).toBe('verdant');
  });
});

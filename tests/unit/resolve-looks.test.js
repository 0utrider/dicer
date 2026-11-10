import { createLookResolver } from '../../src/compat/resolve-looks.js';
import { createRegistry } from '../../src/compat/registry.js';
import { LOOKS } from '../../src/look/looks.js';
import { DEFAULT_APPEARANCE } from '../../src/look/appearance.js';
import { colorsetToAppearance, BUILTIN_COLORSETS } from '../../src/compat/colorset-map.js';

const user = (flag) => ({
  getFlag: (s, k) => (s === 'dicer' && k === 'appearance' ? flag : undefined),
});
const term = (faces, extra = {}) => ({ faces, options: {}, results: [{ result: 1 }], ...extra });
const RES = { result: 1 };
const CRYSTAL = LOOKS['sharp-crystal'].appearance;
const RUBY = LOOKS['ruby-classic'].appearance;

function make({ users = {}, actors = {}, facesFor } = {}) {
  const registry = createRegistry({ warn: () => {} });
  const warn = vi.fn();
  const resolver = createLookResolver({
    registry,
    getUser: (id) => users[id],
    getActor: (id) => actors[id],
    warn,
    facesFor,
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
    expect(out.faces).toBeUndefined();
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

describe('shapeFor', () => {
  test('built-in dN types, aliases and custom denominations; d100 and unknown give null', async () => {
    const { registry, resolver } = make();
    await registry.addDicePreset({ type: 'dc', labels: ['1', '2', '3', '4', '5', '6'] }, 'd6');
    class Coin {
      static DENOMINATION = 'dc';
    }
    expect(resolver.shapeFor(term(20))).toBe('d20');
    expect(resolver.shapeFor(term(6, { constructor: Coin }))).toBe('d6');
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

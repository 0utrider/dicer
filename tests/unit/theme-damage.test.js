// A theme's own damage dice looks (theme.damage: damage type -> theme id, colorset or 'none'),
// ranked: the viewer's own override > the die's theme's damage looks > the world's choice.
import { normalizeTheme } from '../../src/themes/themes.js';
import { DAMAGE_THEMES, resolveDamageTheme } from '../../src/effects/damage-themes.js';
import { createLookResolver } from '../../src/compat/resolve-looks.js';
import { createRegistry } from '../../src/compat/registry.js';
import { formFromTheme, themeFromForm } from '../../src/ui/theme-form.js';

const rogue = { id: 'user.u1.rogue', name: 'Rogue', appearance: {}, damage: { precision: 'void', fire: 'none', bad: 7 } };

test('a theme keeps its damage looks (string values only); one without them has none', () => {
  const t = normalizeTheme(rogue, 'user', () => {});
  expect(t.damage).toEqual({ precision: 'void', fire: 'none' });
  expect(normalizeTheme({ ...rogue, damage: undefined }, 'user', () => {})).not.toHaveProperty('damage');
});

test("ranking: the viewer's override, then the theme's damage looks, then the world's; 'none' keeps the theme's look", () => {
  const worldMap = { precision: 'fire' };
  const themeMap = { precision: 'void', cold: 'none' };
  expect(resolveDamageTheme('precision', { worldMap })).toBe(DAMAGE_THEMES.fire);
  expect(resolveDamageTheme('precision', { worldMap, themeMap })).toBe(DAMAGE_THEMES.void);
  expect(resolveDamageTheme('precision', { worldMap, themeMap, userOverrides: { precision: 'acid' } })).toBe(DAMAGE_THEMES.acid);
  expect(resolveDamageTheme('cold', { worldMap, themeMap })).toBeNull(); // the die wears its theme's own look
  expect(resolveDamageTheme('acid', { worldMap, themeMap })).toBe(DAMAGE_THEMES.acid); // unset in the theme: the built-in
});

/** A resolver whose damage themer records the theme map it is handed per die. */
function resolverWith({ userFlags = {}, actors = {} } = {}) {
  const seen = [];
  const user = { getFlag: (s, k) => (s === 'dicer' ? userFlags[k] : undefined) };
  const resolver = createLookResolver({
    registry: createRegistry({ warn: () => {} }),
    getUser: () => user,
    getActor: (id) => actors[id],
    damageThemeFor: () => (_term, _i, themeMap) => (seen.push(themeMap ?? null), null),
    warn: () => {},
  });
  return { resolver, seen };
}
const term = (options = {}) => ({ faces: 6, options, results: [{ result: 3 }] });

test("the die's theme (the roller's own, else the actor's) hands its damage looks to the damage themer", () => {
  const mine = { ...rogue, damage: { precision: 'void' } };
  const { resolver, seen } = resolverWith({ userFlags: { themes: [mine], appearance: { global: { theme: mine.id } } } });
  resolver.decorate(null, {}, 'u1')(term(), { result: 3 }, 0);
  expect(seen.at(-1)).toEqual({ precision: 'void' });
  // the actor's theme comes first
  const actorTheme = { ...rogue, id: 'user.u1.assassin', damage: { precision: 'acid' } };
  const withActor = resolverWith({
    userFlags: { themes: [mine, actorTheme], appearance: { global: { theme: mine.id } } },
    actors: { a1: { flags: { dicer: { appearance: { global: { theme: actorTheme.id } } } } } },
  });
  withActor.resolver.decorate(null, {}, 'u1')(term({ dsnActorId: 'a1' }), { result: 3 }, 0);
  expect(withActor.seen.at(-1)).toEqual({ precision: 'acid' });
  // a look (no theme) has no damage looks
  const plain = resolverWith({ userFlags: { appearance: { global: { look: 'default' } } } });
  plain.resolver.decorate(null, {}, 'u1')(term(), { result: 3 }, 0);
  expect(plain.seen.at(-1)).toBeNull();
});

test('the theme editor reads and writes them; a form without them keeps the theme’s', () => {
  const t = normalizeTheme({ ...rogue, damage: { precision: 'void' } }, 'user', () => {});
  const form = formFromTheme(t);
  expect(form.damage).toEqual({ precision: 'void' });
  expect(themeFromForm({ ...form, damage: { precision: 'acid', fire: '', cold: 'none' } }, t).damage).toEqual({ precision: 'acid', cold: 'none' });
  expect(themeFromForm({ name: 'R' }, t).damage).toEqual({ precision: 'void' });
  expect(themeFromForm({ ...form, damage: { precision: '' } }, t)).not.toHaveProperty('damage');
});

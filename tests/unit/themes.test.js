import { EFFECTS } from '../../src/effects/library/index.js';
import { KNOWN_EFFECTS, BUILTIN_THEMES, normalizeTheme, findTheme, readThemeList } from '../../src/themes/themes.js';
import { normalizeAppearance, appearanceKey } from '../../src/look/appearance.js';
import { normalizeRule } from '../../src/effects/rules.js';
import { LOOKS } from '../../src/look/looks.js';

const good = () => ({
  id: 'user.u1.mine',
  name: 'Mine',
  appearance: LOOKS.default.appearance,
  soundMaterial: 'wood',
  rules: [
    {
      id: 'dicer.nat20',
      die: 'd20',
      result: { kind: 'value', value: 20 },
      effect: { id: 'sparkles' },
    },
  ],
});

describe('built-in themes', () => {
  it('has at least 20 themes with unique ids, including every look', () => {
    expect(BUILTIN_THEMES.length).toBe(22);
    const ids = BUILTIN_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of Object.keys(LOOKS)) {
      const t = findTheme(id);
      expect(t.name).toBe(LOOKS[id].name);
      expect(t.appearance).toBe(LOOKS[id].appearance);
    }
    for (const id of [
      'dragon-hoard',
      'stormcaller',
      'blood-moon',
      'celestial',
      'obsidian',
      'verdant',
    ]) {
      expect(findTheme(id)).toBeTruthy();
    }
  });
  it('every appearance normalizes to itself and every rule is valid and themed', () => {
    for (const t of BUILTIN_THEMES) {
      expect(t.source).toBe('builtin');
      expect(['plastic', 'metal', 'wood', 'glass', 'stone']).toContain(t.soundMaterial);
      for (const a of [t.appearance, ...Object.values(t.perType)]) {
        expect(appearanceKey(normalizeAppearance(a))).toBe(appearanceKey(a));
      }
      for (const r of t.rules) {
        expect(r.source).toBe('theme');
        expect(normalizeRule(r, 'theme', () => {})).toEqual(r);
      }
    }
  });
  it('is deeply frozen', () => {
    for (const t of BUILTIN_THEMES) {
      expect(Object.isFrozen(t)).toBe(true);
      expect(Object.isFrozen(t.appearance.body)).toBe(true);
      expect(Object.isFrozen(t.appearance.interior.colors)).toBe(true);
      expect(Object.isFrozen(t.rules)).toBe(true);
      for (const r of t.rules) expect(Object.isFrozen(r.effect)).toBe(true);
    }
  });
  it('per-type themes give different d20 and d6 appearances', () => {
    for (const id of ['dragon-hoard', 'celestial']) {
      const t = findTheme(id);
      expect(appearanceKey(t.perType.d20)).not.toBe(appearanceKey(t.appearance));
      expect(t.perType.d6).toBeUndefined();
    }
  });
  it('celebrations use the world rule ids so they replace them (P5-D4)', () => {
    expect(findTheme('dragon-hoard').rules[0]).toMatchObject({
      id: 'dicer.nat20',
      effect: { id: 'embers' },
      sound: { builtin: 'fanfare' },
    });
    expect(findTheme('stormcaller').rules[0].effect.id).toBe('lightning');
    expect(findTheme('obsidian').rules[0]).toMatchObject({
      id: 'dicer.nat1',
      effect: { id: 'shatter' },
    });
    expect(findTheme('verdant').soundMaterial).toBe('wood');
  });
});

describe('normalizeTheme', () => {
  it('accepts a good theme, normalizes and deep-freezes it', () => {
    const warn = vi.fn();
    const t = normalizeTheme(
      {
        ...good(),
        appearance: { body: { color: '#123456' } },
        perType: { d6: { body: { type: 'metal' } }, d9: {}, d20: 5, d7: {} },
      },
      'world',
      warn,
    );
    expect(warn).not.toHaveBeenCalled();
    expect(t.source).toBe('world');
    expect(t.appearance.body.color).toBe('#123456');
    expect(Object.keys(t.perType)).toEqual(['d6', 'd7']); // a d7 (plan 4) is kept, a d9 dropped
    expect(t.rules[0].source).toBe('theme');
    expect(Object.isFrozen(t.appearance.interior.colors)).toBe(true);
    expect(Object.isFrozen(t.perType.d6.body)).toBe(true);
  });
  it.each([
    ['null', null],
    ['no id', { name: 'x', appearance: {} }],
    ['no name', { id: 'a', appearance: {} }],
    ['no appearance', { id: 'a', name: 'x' }],
  ])('rejects %s with one warning', (_n, raw) => {
    const warn = vi.fn();
    expect(normalizeTheme(raw, 'user', warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('drops unknown fields and warns on a bad sound material', () => {
    const warn = vi.fn();
    const t = normalizeTheme({ ...good(), evil: 1, soundMaterial: 'jelly' }, 'user', warn);
    expect(t.soundMaterial).toBeNull();
    expect(t.evil).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('drops invalid rules individually, one warning each', () => {
    const warn = vi.fn();
    const t = normalizeTheme({ ...good(), rules: [{ id: 'bad' }, good().rules[0]] }, 'user', warn);
    expect(t.rules.map((r) => r.id)).toEqual(['dicer.nat20']);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('Review Focus 3: unknown fields plus an unknown effect id load, with the rule dropped and one warning', () => {
    const warn = vi.fn();
    const raw = {
      ...good(),
      extra: { a: 1 },
      rules: [
        { id: 'r', effect: { id: 'meteor-storm' } },
        ...good().rules,
        { id: 'd', effect: { id: 'dsn:fire' } },
      ],
    };
    const t = normalizeTheme(raw, 'user', warn);
    expect(t.rules.map((r) => r.id)).toEqual(['dicer.nat20', 'd']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('meteor-storm');
  });
});

describe('findTheme', () => {
  it('finds built-in, then world, then user themes; missing is null', () => {
    const w = normalizeTheme({ ...good(), id: 'world.x' }, 'world');
    const u = normalizeTheme(good(), 'user');
    const lists = { worldThemes: [w], userThemes: [u] };
    expect(findTheme('obsidian', lists).source).toBe('builtin');
    expect(findTheme('world.x', lists)).toBe(w);
    expect(findTheme('user.u1.mine', lists)).toBe(u);
    expect(findTheme('user.u2.gone', lists)).toBeNull();
    expect(findTheme('nope')).toBeNull();
    expect(findTheme(undefined, lists)).toBeNull();
  });
});

describe('readThemeList', () => {
  test('valid themes only; a bad entry warns once per stored value, even across fresh copies', () => {
    const warn = vi.fn();
    const stored = () => [{ id: 'world.a', name: 'A', appearance: { body: { type: 'opaque', color: '#111111' } } }, 7];
    const first = readThemeList(stored(), 'world', warn);
    expect(first.map((t) => [t.id, t.source])).toEqual([['world.a', 'world']]);
    expect(readThemeList(stored(), 'world', warn)).toBe(first);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(readThemeList('nope', 'world', warn)).toEqual([]);
  });
});

describe('KNOWN_EFFECTS', () => {
  // The library chunk is lazy, so themes.js keeps its own list; this keeps it honest.
  // ids KNOWN_EFFECTS intentionally has beyond the catalogue: the crit bursts a later task builds
  const NON_CATALOGUE = ['bleed', 'slashing', 'piercing', 'bludgeoning'].map((e) => `burst-${e}`);
  test('lists the effects catalogue ids (plus the documented extras), no more', () => {
    expect([...KNOWN_EFFECTS].sort()).toEqual([...Object.keys(EFFECTS), ...NON_CATALOGUE].sort());
  });
});

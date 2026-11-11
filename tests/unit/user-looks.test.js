import {
  readUserLooks,
  lookRefToAppearance,
  mirrorLookSetting,
  mirrorLookIfMissing,
} from '../../src/compat/user-looks.js';
import { createRegistry } from '../../src/compat/registry.js';
import { findTheme, normalizeTheme } from '../../src/themes/themes.js';
import { LOOKS } from '../../src/look/looks.js';
import { DEFAULT_APPEARANCE } from '../../src/look/appearance.js';
import { colorsetToAppearance, BUILTIN_COLORSETS } from '../../src/compat/colorset-map.js';

const userWith = (flag) => ({
  getFlag: (s, k) => (s === 'dicer' && k === 'appearance' ? flag : undefined),
});
const DEFAULT = { global: { look: 'default' } };

describe('readUserLooks', () => {
  test.each([[undefined], ['x'], [{ global: 5 }], [null], [[1]]])('%j gives the default', (flag) => {
    expect(readUserLooks(userWith(flag))).toEqual(DEFAULT);
  });
  test('no user, or a throwing getFlag, gives the default', () => {
    expect(readUserLooks(undefined)).toEqual(DEFAULT);
    const throwing = {
      getFlag: () => {
        throw new Error('x');
      },
    };
    expect(readUserLooks(throwing)).toEqual(DEFAULT);
  });
  test('keeps object entries, drops the rest, and always has a global', () => {
    const out = readUserLooks(userWith({ d20: { look: 'sharp-crystal' }, d6: 'no', d8: null }));
    expect(out).toEqual({ d20: { look: 'sharp-crystal' }, global: { look: 'default' } });
  });
});

describe('lookRefToAppearance', () => {
  const reg = createRegistry({ warn: () => {} });
  const app = (ref, r = reg, i = 0, o) => lookRefToAppearance(ref, r, i, o)?.appearance;
  test('appearance beats colorset beats look', () => {
    const a = { body: { type: 'opaque', color: '#123456' } };
    const all = { appearance: a, colorset: 'fire', look: 'ruby-classic' };
    expect(app(all).body.color).toBe('#123456');
    expect(app({ colorset: 'fire', look: 'ruby-classic' })).toEqual(
      colorsetToAppearance(BUILTIN_COLORSETS.fire, { textures: reg.textures }),
    );
    expect(app({ look: 'ruby-classic' })).toBe(LOOKS['ruby-classic'].appearance);
  });
  test('a registry colorset beats the built-in of the same name', async () => {
    const r = createRegistry({ warn: () => {} });
    await r.addColorset({ name: 'fire', background: '#00ff00', foreground: '#000000' });
    expect(app({ colorset: 'fire' }, r).body.color).toBe('#00ff00');
  });
  test('unusable refs give null', () => {
    const bad = [null, 'x', {}, { look: 'nope' }, { look: '__proto__' }, { colorset: 'nope' }, { appearance: 'nope' }, { theme: 5 }];
    for (const ref of bad) expect(lookRefToAppearance(ref, reg)).toBeNull();
    expect(app({ look: 'default' })).toBe(DEFAULT_APPEARANCE);
  });
});

describe('lookRefToAppearance with themes', () => {
  const reg = createRegistry({ warn: () => {} });
  const hoard = findTheme('dragon-hoard');
  test('a theme ref gives the die type look, its sound material and its id', () => {
    const d20 = lookRefToAppearance({ theme: 'dragon-hoard' }, reg, 0, { dieType: 'd20' });
    expect(d20).toEqual({ appearance: hoard.perType.d20, themeId: 'dragon-hoard', soundMaterial: 'metal' });
    const d6 = lookRefToAppearance({ theme: 'dragon-hoard' }, reg, 0, { dieType: 'd6' });
    expect(d6.appearance).toBe(hoard.appearance);
    expect(lookRefToAppearance({ theme: 'dragon-hoard' }, reg).appearance).toBe(hoard.appearance);
  });
  test('precedence: appearance > colorset > theme > look', () => {
    const fire = colorsetToAppearance(BUILTIN_COLORSETS.fire, { textures: reg.textures });
    const out = lookRefToAppearance({ colorset: 'fire', theme: 'dragon-hoard' }, reg);
    expect(out.appearance).toEqual(fire);
    expect(out.themeId).toBeUndefined();
    const t = lookRefToAppearance({ theme: 'obsidian', look: 'ruby-classic' }, reg);
    expect(t.themeId).toBe('obsidian');
  });
  test('world and user themes are found through opts.themes', () => {
    const w = normalizeTheme({ id: 'world.w', name: 'W', appearance: { body: { type: 'opaque', color: '#010203' } } }, 'world');
    const out = lookRefToAppearance({ theme: 'world.w' }, reg, 0, { themes: { worldThemes: [w] } });
    expect(out.appearance.body.color).toBe('#010203');
    expect(out.themeId).toBe('world.w');
    expect('soundMaterial' in out).toBe(false);
  });
  test('a missing theme reports itself and falls through to look, else null', () => {
    const onMissingTheme = vi.fn();
    expect(lookRefToAppearance({ theme: 'user.gone' }, reg, 0, { onMissingTheme })).toBeNull();
    const fallback = lookRefToAppearance({ theme: 'user.gone', look: 'ruby-classic' }, reg, 0, { onMissingTheme });
    expect(fallback).toEqual({ appearance: LOOKS['ruby-classic'].appearance });
    expect(onMissingTheme.mock.calls).toEqual([['user.gone'], ['user.gone']]);
  });
});

/** A user whose setFlag merges like Foundry's document update: objects merge, other values (null too) overwrite. */
function mergingUser(flag) {
  const user = { flags: { dicer: { appearance: structuredClone(flag) } } };
  const merge = (into, patch) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && into[k] && typeof into[k] === 'object') merge(into[k], v);
      else into[k] = v;
    }
  };
  user.getFlag = (scope, key) => user.flags[scope]?.[key];
  user.setFlag = vi.fn(async (scope, key, value) => {
    user.flags[scope] ??= {};
    if (user.flags[scope][key] && typeof user.flags[scope][key] === 'object') merge(user.flags[scope][key], value);
    else user.flags[scope][key] = value;
  });
  return user;
}

describe('mirrorLookSetting', () => {
  test('a theme beats a colorset or appearance a Dice So Nice import left in the same slot', async () => {
    const user = mergingUser({ global: { colorset: 'fire', appearance: { body: { type: 'metal' } }, look: 'old' } });
    await mirrorLookSetting(user, 'ruby-classic');
    const looks = readUserLooks(user);
    expect(lookRefToAppearance(looks.global, null)).toMatchObject({ themeId: 'ruby-classic' });
  });
  test('a setting change marks the global slot as a deliberate choice, which the look reader ignores', async () => {
    const user = mergingUser(undefined);
    await mirrorLookSetting(user, 'default');
    const { global } = readUserLooks(user);
    expect(global.chosen).toBe(true);
    expect(lookRefToAppearance(global, null)).toMatchObject({ themeId: 'default' });
  });
  test('the new default reaches every die: stale per-type non-theme entries are dropped, theme entries kept', async () => {
    const user = mergingUser({
      global: { look: 'old' },
      d20: { colorset: 'fire' },
      d6: { appearance: { body: { type: 'metal' } } },
      d8: { theme: 'dragon-hoard' },
      'role:attack': { theme: 'celestial' },
    });
    await mirrorLookSetting(user, 'ruby-classic');
    const looks = readUserLooks(user);
    expect(looks.d20).toBeUndefined();
    expect(looks.d6).toBeUndefined();
    expect(looks.d8).toEqual({ theme: 'dragon-hoard' });
    expect(looks['role:attack']).toEqual({ theme: 'celestial' });
    expect(lookRefToAppearance(looks.global, null)).toMatchObject({ themeId: 'ruby-classic' });
  });
  test('mirrorLookIfMissing does not write while the theme is still the registered default', async () => {
    const setFlag = vi.fn();
    await mirrorLookIfMissing({ ...userWith(undefined), setFlag }, 'default');
    await mirrorLookIfMissing({ ...userWith(undefined), setFlag }, '');
    expect(setFlag).not.toHaveBeenCalled();
  });
  test('mirrorLookIfMissing writes only when the flag is absent', async () => {
    const setFlag = vi.fn(async () => {});
    await mirrorLookIfMissing({ ...userWith({ global: { look: 'x' } }), setFlag }, 'ruby-classic');
    expect(setFlag).not.toHaveBeenCalled();
    await mirrorLookIfMissing({ ...userWith(undefined), setFlag }, 'ruby-classic');
    expect(setFlag).toHaveBeenCalledTimes(1);
    await mirrorLookIfMissing({ ...userWith('x'), setFlag }, 'ruby-classic');
    expect(setFlag).toHaveBeenCalledTimes(2);
  });
});

describe('My default Clear and the own-default chain (I-1, M-2)', () => {
  test('neverChoseRef is a never-chose slot, even merged over a chosen one', async () => {
    const { neverChoseRef, chosenRef, isNeverChose } = await import('../../src/compat/user-looks.js');
    expect(isNeverChose(neverChoseRef())).toBe(true);
    expect(isNeverChose({ ...chosenRef('ruby-classic'), ...neverChoseRef() })).toBe(true);
  });
  test('shouldMirror skips only the default over a never-chose global', async () => {
    const { shouldMirror, neverChoseRef, chosenRef } = await import('../../src/compat/user-looks.js');
    expect(shouldMirror(userWith({ global: neverChoseRef() }), 'default')).toBe(false);
    expect(shouldMirror(userWith({ global: neverChoseRef() }), 'verdant')).toBe(true);
    expect(shouldMirror(userWith({ global: chosenRef('verdant') }), 'default')).toBe(true); // a real switch back
    expect(shouldMirror(userWith(undefined), 'default')).toBe(true);
  });
  test('ownDefaultRefs follows the resolver: lock, stored choice, world default, setting', async () => {
    const { ownDefaultRefs, neverChoseRef, chosenRef } = await import('../../src/compat/user-looks.js');
    const s = { theme: 'ember-core', worldDefaultTheme: 'verdant', lock: false };
    expect(ownDefaultRefs(userWith({ global: chosenRef('obsidian') }), s)).toEqual([
      chosenRef('obsidian'),
      { theme: 'verdant' },
      { theme: 'ember-core' },
    ]);
    expect(ownDefaultRefs(userWith({ global: neverChoseRef() }), s)).toEqual([{ theme: 'verdant' }, { theme: 'ember-core' }]);
    expect(ownDefaultRefs(userWith({ global: chosenRef('obsidian') }), { ...s, lock: true })).toEqual([{ theme: 'verdant' }]);
    const gm = { ...userWith({ global: chosenRef('obsidian') }), isGM: true };
    expect(ownDefaultRefs(gm, { ...s, lock: true })[0]).toEqual(chosenRef('obsidian')); // the lock never binds a GM
    expect(ownDefaultRefs(userWith(undefined), { theme: 'ember-core', worldDefaultTheme: '' })).toEqual([{ theme: 'ember-core' }]);
  });
});

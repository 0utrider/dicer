import {
  readUserLooks,
  lookRefToAppearance,
  mirrorLookSetting,
  mirrorLookIfMissing,
} from '../../src/compat/user-looks.js';
import { createRegistry } from '../../src/compat/registry.js';
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
  test('appearance beats colorset beats look', () => {
    const a = { body: { type: 'opaque', color: '#123456' } };
    const all = { appearance: a, colorset: 'fire', look: 'ruby-classic' };
    expect(lookRefToAppearance(all, reg).body.color).toBe('#123456');
    expect(lookRefToAppearance({ colorset: 'fire', look: 'ruby-classic' }, reg)).toEqual(
      colorsetToAppearance(BUILTIN_COLORSETS.fire, { textures: reg.textures }),
    );
    expect(lookRefToAppearance({ look: 'ruby-classic' }, reg)).toBe(LOOKS['ruby-classic'].appearance);
  });
  test('a registry colorset beats the built-in of the same name', async () => {
    const r = createRegistry({ warn: () => {} });
    await r.addColorset({ name: 'fire', background: '#00ff00', foreground: '#000000' });
    expect(lookRefToAppearance({ colorset: 'fire' }, r).body.color).toBe('#00ff00');
  });
  test('unusable refs give null', () => {
    const bad = [null, 'x', {}, { look: 'nope' }, { look: '__proto__' }, { colorset: 'nope' }, { appearance: 'nope' }];
    for (const ref of bad) expect(lookRefToAppearance(ref, reg)).toBeNull();
    expect(lookRefToAppearance({ look: 'default' }, reg)).toBe(DEFAULT_APPEARANCE);
  });
});

describe('mirrorLookSetting', () => {
  test('sets global and keeps per-type entries', async () => {
    const setFlag = vi.fn(async () => {});
    const flag = { d20: { look: 'sharp-crystal' }, global: { look: 'old' } };
    await mirrorLookSetting({ ...userWith(flag), setFlag }, 'ruby-classic');
    expect(setFlag).toHaveBeenCalledWith('dicer', 'appearance', {
      d20: { look: 'sharp-crystal' },
      global: { look: 'ruby-classic' },
    });
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

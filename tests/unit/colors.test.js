import { cssToHex } from '../../src/compat/colors.js';

describe('cssToHex', () => {
  test('hex forms', () => {
    expect(cssToHex('#ABC')).toBe('#aabbcc');
    expect(cssToHex('#112233')).toBe('#112233');
    expect(cssToHex('#11223344')).toBe('#112233');
  });
  test('rgb / rgba', () => {
    expect(cssToHex('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(cssToHex('rgba(0, 128, 255, 0.5)')).toBe('#0080ff');
    expect(cssToHex('rgb(300, -5, 0)')).toBe('#ff0000');
  });
  test('named colours', () => {
    expect(cssToHex('white')).toBe('#ffffff');
    expect(cssToHex(' Orange ')).toBe('#ffa500');
    expect(cssToHex('pink')).toBe('#ffc0cb');
    expect(cssToHex('purple')).toBe('#800080');
  });
  test('anything else returns the fallback', () => {
    expect(cssToHex('nonsense')).toBeNull();
    expect(cssToHex('nonsense', '#000000')).toBe('#000000');
    expect(cssToHex('#12')).toBeNull();
    expect(cssToHex(undefined, '#fff')).toBe('#fff');
    expect(cssToHex(42)).toBeNull();
  });
});

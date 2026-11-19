import { describe, it, expect } from 'vitest';
import { colorsetToAppearance, BUILTIN_COLORSETS, GHOST_APPEARANCE } from '../../src/compat/colorset-map.js';
import { normalizeAppearance } from '../../src/look/appearance.js';

describe('colorsetToAppearance', () => {
  it('picks array colours by die index and maps metal', () => {
    const a = colorsetToAppearance({ foreground: '#000', background: ['#f00', '#0f0'], material: 'metal' }, { index: 1 });
    expect(a.body.type).toBe('metal');
    expect(a.body.roughness).toBe(0.6); // Dice So Nice's metal is satin (roughness 0.6), not a mirror
    // Dice So Nice's numbers: a third of the face (in points) and outlined, so bigger and bolder
    expect(a.numbers).toMatchObject({ size: 1.35, weight: 0.3 });
    expect(a.body.finish).toBe('polished');
    expect(a.body.color).toBe('#00ff00');
    expect(a.numbers.color).toBe('#000000');
    expect(a.numbers.fill).toBe('paint');
  });

  it('wraps the index around the array', () => {
    const a = colorsetToAppearance({ background: ['#f00', '#0f0'] }, { index: 2 });
    expect(a.body.color).toBe('#ff0000');
  });

  it('uses edge, else outline, for color2', () => {
    expect(colorsetToAppearance({ edge: '#111111', outline: '#222222' }).body.color2).toBe('#111111');
    expect(colorsetToAppearance({ outline: ['#222222', '#333333'] }, { index: 1 }).body.color2).toBe('#333333');
  });

  it('maps materials', () => {
    const glass = colorsetToAppearance({ material: 'glass' });
    expect(glass.body.type).toBe('resin');
    expect(glass.interior.type).toBe('none');
    expect(colorsetToAppearance({ material: 'stone' }).body.type).toBe('marble');
    expect(colorsetToAppearance({ material: 'iridescent' }).body.type).toBe('pearl');
    expect(colorsetToAppearance({ material: 'pristine' }).body.roughness).toBe(0.1);
    expect(colorsetToAppearance({ material: 'wood' }).body.roughness).toBe(0.75);
    expect(colorsetToAppearance({ material: 'chrome' }).body.roughness).toBe(0.05);
    for (const m of ['plastic', 'auto', 'none', undefined]) {
      const a = colorsetToAppearance({ material: m });
      expect(a.body.type).toBe('opaque');
      expect(a.body.roughness).toBe(0.35);
    }
  });

  it('maps an unknown material to opaque', () => {
    expect(colorsetToAppearance({ material: 'unobtainium' }).body.type).toBe('opaque');
  });

  it('uses gold fill for yellowish foreground on metal or chrome only', () => {
    expect(colorsetToAppearance({ foreground: '#ffd700', material: 'chrome' }).numbers.fill).toBe('gold');
    expect(colorsetToAppearance({ foreground: '#ffd700', material: 'metal' }).numbers.fill).toBe('gold');
    expect(colorsetToAppearance({ foreground: '#ffd700', material: 'plastic' }).numbers.fill).toBe('paint');
    expect(colorsetToAppearance({ foreground: '#ffffff', material: 'metal' }).numbers.fill).toBe('paint');
  });

  it('lets texture names override the body', () => {
    const textures = new Map([
      ['t1', { name: 'Cracked Marble' }],
      ['t2', { name: 'Old Bronze' }],
      ['t3', { name: 'Leather' }],
    ]);
    expect(colorsetToAppearance({ texture: 't1' }, { textures }).body.type).toBe('marble');
    const bronze = colorsetToAppearance({ texture: 't2' }, { textures });
    expect(bronze.body.type).toBe('metal');
    expect(bronze.body.finish).toBe('antique');
    expect(colorsetToAppearance({ texture: 't3' }, { textures }).body.type).toBe('opaque');
    expect(colorsetToAppearance({ texture: 'granite-stone' }).body.type).toBe('marble');
  });

  it('sets glow from emissive', () => {
    const a = colorsetToAppearance({ emissive: '#ff0000', emissiveIntensity: 1.5 });
    expect(a.glow.color).toBe('#ff0000');
    expect(a.glow.intensity).toBe(1.5);
    expect(colorsetToAppearance({}).glow.intensity).toBe(0);
  });

  it('survives garbage input', () => {
    expect(() => colorsetToAppearance(null)).not.toThrow();
    expect(() => colorsetToAppearance({ background: [] })).not.toThrow();
  });
});

describe('BUILTIN_COLORSETS', () => {
  const names = [
    'white', 'black', 'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'grey', 'gold', 'silver',
    'bronze', 'glass', 'fire', 'ice', 'poison', 'acid', 'lightning', 'thunder', 'force', 'radiant', 'necrotic',
    'psychic', 'bludgeoning', 'piercing', 'slashing',
  ];
  it('defines every required name', () => {
    for (const n of names) expect(BUILTIN_COLORSETS[n], n).toBeTruthy();
  });
  it('round-trips through normalizeAppearance unchanged', () => {
    for (const [name, cs] of Object.entries(BUILTIN_COLORSETS)) {
      const a = colorsetToAppearance(cs);
      expect(normalizeAppearance(a), name).toEqual(a);
    }
  });
});

describe('GHOST_APPEARANCE', () => {
  it('is a plain resin body with matching numbers', () => {
    expect(GHOST_APPEARANCE.body.type).toBe('resin');
    expect(GHOST_APPEARANCE.body.color).toBe('#c8ccd4');
    expect(GHOST_APPEARANCE.interior.type).toBe('none');
    expect(GHOST_APPEARANCE.numbers.fill).toBe('paint');
    expect(GHOST_APPEARANCE.numbers.color).toBe(GHOST_APPEARANCE.body.color);
    expect(GHOST_APPEARANCE.glow.intensity).toBe(0);
    expect(normalizeAppearance(GHOST_APPEARANCE)).toEqual(GHOST_APPEARANCE);
  });
});

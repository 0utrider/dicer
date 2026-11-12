import { describe, expect, test } from 'vitest';
import {
  BODY_PRESETS,
  DEFAULT_APPEARANCE,
  EDGE_STEPS,
  FONT_IDS_BUILTIN,
  appearanceKey,
  fallbackLook,
  needsLookExtras,
  normalizeAppearance,
  programKey,
} from '../../src/look/appearance.js';
import { LOOKS } from '../../src/look/looks.js';
import { DAMAGE_THEMES } from '../../src/effects/damage-themes.js';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';

test('default is resin with an interior', () => {
  expect(DEFAULT_APPEARANCE.body.type).toBe('resin');
  expect(DEFAULT_APPEARANCE.interior.type).not.toBe('none');
  expect(Object.isFrozen(DEFAULT_APPEARANCE.body)).toBe(true);
  expect(Object.isFrozen(DEFAULT_APPEARANCE.interior.colors)).toBe(true);
});
test.each([undefined, null, 42, 'x', [], { body: 'nope' }, { body: { type: 'lava', color: 'red' } }])(
  'normalize never throws and returns a full appearance for %j',
  (input) => {
    const a = normalizeAppearance(input);
    expect(a.body.type).toMatch(/^(opaque|resin|metal|marble|pearl)$/);
    expect(a.body.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(a.numbers.fill).toMatch(/^(paint|gold|silver|enamel)$/);
  },
);
test('field-level fallback keeps valid fields', () => {
  const a = normalizeAppearance({ body: { type: 'metal', color: '#ABC', roughness: 7 }, numbers: { fill: 'silver' } });
  expect(a.body).toMatchObject({ type: 'metal', color: '#aabbcc', roughness: DEFAULT_APPEARANCE.body.roughness });
  expect(a.numbers.fill).toBe('silver');
});
test('non-resin bodies have no interior', () => {
  expect(normalizeAppearance({ body: { type: 'metal' }, interior: { type: 'nebula' } }).interior.type).toBe('none');
});
test('legacy Plan 1 flat appearance maps over', () => {
  const a = normalizeAppearance({ body: 'opaque', bodyColor: '#b3202a', fillColor: '#f2f2f2', fillMetallic: false, engraveDepth: 0.4 });
  expect(a.body).toMatchObject({ type: 'opaque', color: '#b3202a' });
  expect(a.numbers).toMatchObject({ fill: 'paint', color: '#f2f2f2', depth: 0.4 });
  const m = normalizeAppearance({ body: 'metal', fillMetallic: true });
  expect(m.numbers.fill).toBe('gold');
});
test('interior colours and unknown keys are sanitised', () => {
  const a = normalizeAppearance({ interior: { colors: ['#fff', 'bad'], density: -1 }, extra: 1 });
  expect(a.interior.colors).toEqual(['#ffffff', DEFAULT_APPEARANCE.interior.colors[1]]);
  expect(a.interior.density).toBe(DEFAULT_APPEARANCE.interior.density);
  expect(a.extra).toBeUndefined();
});
test('appearanceKey is order-independent and colour-sensitive', () => {
  const a = normalizeAppearance({ body: { type: 'opaque', color: '#111111' } });
  const b = JSON.parse(JSON.stringify(a));
  const reordered = { glow: b.glow, edges: b.edges, numbers: b.numbers, interior: b.interior, body: b.body };
  expect(appearanceKey(reordered)).toBe(appearanceKey(a));
  expect(appearanceKey(normalizeAppearance({ body: { type: 'opaque', color: '#222222' } }))).not.toBe(appearanceKey(a));
});
describe('programKey', () => {
  const flags = { interiors: true, engraving: true, glow: true, interiorSteps: 32 };
  const resin = (extra = {}) =>
    normalizeAppearance({ body: { type: 'resin', color: '#111111', roughness: 0.1 }, interior: { type: 'glitter', density: 0.2 }, ...extra });

  test('ignores colours and numbers, honours flags', () => {
    const a = resin();
    const b = normalizeAppearance({ body: { type: 'resin', color: '#999999', roughness: 0.3 }, interior: { type: 'glitter', density: 0.9 } });
    expect(programKey(a, flags)).toBe(programKey(b, flags));
    expect(programKey(a, { ...flags, interiors: false })).not.toBe(programKey(a, flags));
    expect(programKey(a, { ...flags, interiorSteps: 16 })).not.toBe(programKey(a, flags));
  });
  test('P2-R1: interior part is none unless the interior is active', () => {
    const key = (a, f) => programKey(a, f);
    // interiors flag off or steps 0: steps and type do not matter
    expect(key(resin(), { ...flags, interiors: false, interiorSteps: 32 })).toBe(
      key(resin(), { ...flags, interiors: false, interiorSteps: 8 }),
    );
    expect(key(resin(), { ...flags, interiorSteps: 0 })).toBe(key(resin(), { ...flags, interiors: false }));
    // interior.type none: steps do not matter
    const noInt = resin({ interior: { type: 'none' } });
    expect(key(noInt, flags)).toBe(key(noInt, { ...flags, interiorSteps: 8 }));
    expect(key(noInt, flags)).toBe(key(resin(), { ...flags, interiors: false }));
    // non-resin body: interior type/steps do not matter
    const metal = normalizeAppearance({ body: { type: 'metal' } });
    expect(key(metal, flags)).toBe(key(metal, { ...flags, interiorSteps: 8 }));
    // active interior: type, shape and steps matter
    expect(key(resin(), flags)).not.toBe(key(resin({ interior: { type: 'nebula' } }), flags));
    const star = resin({ interior: { type: 'shape', shape: 'star' } });
    const heart = resin({ interior: { type: 'shape', shape: 'heart' } });
    expect(key(star, flags)).not.toBe(key(heart, flags));
    // shape is irrelevant for non-shape types
    expect(key(resin({ interior: { type: 'glitter', shape: 'star' } }), flags)).toBe(
      key(resin({ interior: { type: 'glitter', shape: 'skull' } }), flags),
    );
  });
  test('P2-R2: glow part is flags.glow && intensity > 0', () => {
    const off = resin({ glow: { intensity: 0 } });
    const on1 = resin({ glow: { intensity: 0.5 } });
    const on2 = resin({ glow: { intensity: 1.7, color: '#ff0000' } });
    expect(programKey(on1, flags)).toBe(programKey(on2, flags));
    expect(programKey(off, flags)).not.toBe(programKey(on1, flags));
    expect(programKey(on1, { ...flags, glow: false })).toBe(programKey(off, flags));
    expect(programKey(off, { ...flags, glow: false })).toBe(programKey(off, flags));
  });
  test('engraving and metal finish matter; edge style does not (no define depends on it)', () => {
    const a = resin();
    expect(programKey(a, { ...flags, engraving: false })).not.toBe(programKey(a, flags));
    expect(programKey(resin({ edges: { style: 'sharp' } }), flags)).toBe(programKey(a, flags));
    expect(programKey(a, flags)).not.toMatch(/rounded|sharp/);
    const m1 = normalizeAppearance({ body: { type: 'metal', finish: 'brushed' } });
    const m2 = normalizeAppearance({ body: { type: 'metal', finish: 'antique' } });
    expect(programKey(m1, flags)).not.toBe(programKey(m2, flags));
    // finish only matters for metal
    const r1 = resin({ body: { type: 'resin', finish: 'brushed' } });
    expect(programKey(r1, flags)).toBe(programKey(a, flags));
  });
  test('P2-R12: safe is a boolean part of the key; every safe body shares one program', () => {
    const safe = { ...flags, safe: true };
    expect(programKey(resin(), safe)).not.toBe(programKey(resin(), flags));
    expect(programKey(resin(), flags)).toMatch(/\|safe0$/);
    expect(programKey(resin(), { ...flags, safe: undefined })).toBe(programKey(resin(), flags));
    const keys = new Set(
      ['opaque', 'resin', 'metal', 'marble', 'pearl'].map((type) =>
        programKey(normalizeAppearance({ body: { type, finish: 'brushed' }, glow: { intensity: 1 } }), safe),
      ),
    );
    expect(keys.size).toBe(1);
    expect([...keys][0]).toMatch(/\|safe1$/);
  });
});

describe('Plan 7: edge sharpness and font', () => {
  test('defaults: radius 0.5, style rounded, font serif', () => {
    expect(DEFAULT_APPEARANCE.edges).toEqual({ radius: 0.5, style: 'rounded' });
    expect(DEFAULT_APPEARANCE.numbers.font).toBe('serif');
    expect(Object.isFrozen(DEFAULT_APPEARANCE.edges)).toBe(true);
    expect(Object.isFrozen(DEFAULT_APPEARANCE.numbers)).toBe(true);
    expect(normalizeAppearance({}).edges).toEqual({ radius: 0.5, style: 'rounded' });
    expect(normalizeAppearance({}).numbers.font).toBe('serif');
    expect(EDGE_STEPS).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  test('FONT_IDS_BUILTIN lists the eight built-in fonts and each normalises to itself', () => {
    expect(FONT_IDS_BUILTIN).toEqual([
      'serif', 'sans', 'blackletter', 'norse', 'uncial', 'scifi', 'handwritten', 'deco',
    ]);
    for (const id of FONT_IDS_BUILTIN) {
      expect(normalizeAppearance({ numbers: { font: id } }).numbers.font).toBe(id);
    }
  });
  test.each([
    [0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1],
    [0.1, 0], [0.13, 0.25], [0.4, 0.5], [0.9, 1], [2, 1], [-3, 0],
  ])('radius %s snaps to %s', (input, want) => {
    expect(normalizeAppearance({ edges: { radius: input } }).edges.radius).toBe(want);
  });
  test.each([NaN, Infinity, '0.5', null, {}])('non-numeric radius %j falls back to the default', (v) => {
    expect(normalizeAppearance({ edges: { radius: v } }).edges.radius).toBe(0.5);
  });
  test('style is derived from radius', () => {
    expect(normalizeAppearance({ edges: { radius: 0 } }).edges.style).toBe('sharp');
    expect(normalizeAppearance({ edges: { radius: 0.25 } }).edges.style).toBe('rounded');
    expect(normalizeAppearance({ edges: { radius: 1 } }).edges.style).toBe('rounded');
  });
  test('legacy edges.style maps to a radius; radius wins when both are given', () => {
    expect(normalizeAppearance({ edges: { style: 'sharp' } }).edges).toEqual({ radius: 0, style: 'sharp' });
    expect(normalizeAppearance({ edges: { style: 'rounded' } }).edges).toEqual({ radius: 0.5, style: 'rounded' });
    expect(normalizeAppearance({ edges: { style: 'bogus' } }).edges).toEqual({ radius: 0.5, style: 'rounded' });
    expect(normalizeAppearance({ edges: { style: 'sharp', radius: 0.75 } }).edges).toEqual({ radius: 0.75, style: 'rounded' });
  });
  test('a normalized appearance normalizes to itself', () => {
    const a = normalizeAppearance({ edges: { radius: 0.25 }, numbers: { font: 'sans' } });
    expect(normalizeAppearance(a)).toEqual(a);
  });
  test.each([
    ['serif', 'serif'],
    ['sans', 'sans'],
    ['css:Comic Neue', 'css:Comic Neue'],
    ['css:Fira-Sans 2', 'css:Fira-Sans 2'],
    ['css:' + 'a'.repeat(64), 'css:' + 'a'.repeat(64)],
    ['css:' + 'a'.repeat(65), 'serif'],
    ['css:', 'serif'],
    ['css:Bad;Family', 'serif'],
    ['css:a"b', 'serif'],
    ['css:a(b)', 'serif'],
    ['file:worlds/w/fonts/a.woff2', 'file:worlds/w/fonts/a.woff2'],
    ['file:modules/x/F.TTF', 'file:modules/x/F.TTF'],
    ['file:a.woff', 'file:a.woff'],
    ['file:a.otf', 'file:a.otf'],
    ['file:a.exe', 'serif'],
    ['file:.woff2', 'serif'],
    ['file:', 'serif'],
    ['file:../a.woff2', 'serif'],
    ['file:a/../b.woff2', 'serif'],
    ['file:/etc/a.woff2', 'serif'],
    ['file:http://evil/a.woff2', 'serif'],
    ['file:a\b.woff2', 'serif'],
    ['file:worlds/עולם/fonts/גופן.woff2', 'file:worlds/עולם/fonts/גופן.woff2'],
    ['file:worlds/café/Tom\'s & Jerry [v2]=~!$;.ttf', 'file:worlds/café/Tom\'s & Jerry [v2]=~!$;.ttf'],
    ['file:worlds/w/%D7%90.woff2', 'file:worlds/w/%D7%90.woff2'],
    ['file:%2e%2e/a.woff2', 'serif'],
    ['file:a/%2E%2E/b.woff2', 'serif'],
    ['file:a%2Fb.woff2', 'serif'],
    ['file:a?x=1.woff2', 'serif'],
    ['file:a#x.woff2', 'serif'],
    ['file:C:/a.woff2', 'serif'],
    ['file:data:font/woff2.woff2', 'serif'],
    ['file:a\nb.woff2', 'serif'],
    ['file: a.woff2', 'serif'],
    ['file:a.woff2 ', 'serif'],
    [' serif', 'serif'],
    ['serif ', 'serif'],
    [' file:a.woff2', 'serif'],
    ['comic', 'serif'],
    ['', 'serif'],
    [42, 'serif'],
    [null, 'serif'],
  ])('font %j -> %j', (input, want) => {
    expect(normalizeAppearance({ numbers: { font: input } }).numbers.font).toBe(want);
  });
  test('appearanceKey differs when radius or font differ', () => {
    const base = normalizeAppearance({});
    const k = appearanceKey(base);
    expect(appearanceKey(normalizeAppearance({ edges: { radius: 0.25 } }))).not.toBe(k);
    expect(appearanceKey(normalizeAppearance({ edges: { radius: 0 } }))).not.toBe(k);
    expect(appearanceKey(normalizeAppearance({ numbers: { font: 'sans' } }))).not.toBe(k);
    expect(appearanceKey(normalizeAppearance({ numbers: { font: 'css:Arial' } }))).not.toBe(k);
  });
  test('programKey ignores radius and font (geometry and atlas texture, not the program)', () => {
    const flags = { interiors: true, engraving: true, glow: true, interiorSteps: 32 };
    const k = programKey(normalizeAppearance({}), flags);
    expect(programKey(normalizeAppearance({ edges: { radius: 0 }, numbers: { font: 'sans' } }), flags)).toBe(k);
  });
  test('every LOOK and builtin theme appearance normalizes to itself plus the new defaults', () => {
    const all = [];
    for (const l of Object.values(LOOKS)) all.push(l.appearance ?? l);
    for (const t of BUILTIN_THEMES) {
      if (t.look?.appearance) all.push(t.look.appearance);
      for (const v of Object.values(t.perType ?? t.looks ?? {})) all.push(v?.appearance ?? v);
    }
    expect(all.length).toBeGreaterThan(5);
    for (const raw of all) {
      const n = normalizeAppearance(raw);
      expect(n.numbers.font).toBe('serif');
      expect(n.edges.radius).toBe(raw?.edges?.style === 'sharp' ? 0 : 0.5);
      expect(n.edges.style).toBe(n.edges.radius === 0 ? 'sharp' : 'rounded');
      expect(normalizeAppearance(n)).toEqual(n);
    }
  });
});

const F = { interiors: true, engraving: true, glow: true, effects: true, interiorSteps: 32, safe: false };
test('numbers.relief: engraved | raised, anything else engraved', () => {
  expect(normalizeAppearance({ numbers: { relief: 'raised' } }).numbers.relief).toBe('raised');
  for (const r of [undefined, 'emboss', 3, null]) expect(normalizeAppearance({ numbers: { relief: r } }).numbers.relief).toBe('engraved');
});
test('numbers.icons: known ids kept, anything else null', () => {
  expect(normalizeAppearance({ numbers: { icons: { crit: 'crown', fumble: 'skull' } } }).numbers.icons).toEqual({ crit: 'crown', fumble: 'skull' });
  expect(normalizeAppearance({ numbers: { icons: { crit: 'dragon', fumble: 7 } } }).numbers.icons).toEqual({ crit: null, fumble: null });
  expect(normalizeAppearance({ numbers: { icons: 'crown' } }).numbers.icons).toEqual({ crit: null, fumble: null });
  expect(normalizeAppearance({}).numbers.icons).toEqual({ crit: null, fumble: null });
});
test('the new fills normalise; an unknown fill still falls back to gold', () => {
  for (const f of ['outline', 'holo', 'glow']) expect(normalizeAppearance({ numbers: { fill: f } }).numbers.fill).toBe(f);
  expect(normalizeAppearance({ numbers: { fill: 'neon' } }).numbers.fill).toBe('gold');
});
test('old looks keep their program key: no n: part for any curated look or old fill', () => {
  for (const { appearance } of Object.values(LOOKS)) expect(programKey(normalizeAppearance(appearance), F)).not.toMatch(/\|n:/);
  expect(programKey(normalizeAppearance({}), F)).toBe('resin|-|nebula:32|eng1|glow0|fx1|safe0');
  expect(programKey(normalizeAppearance({ body: 'metal', fillMetallic: true }), F)).not.toMatch(/\|n:/); // legacy flat
});
test('programKey gets n:<fill>[+r] only for outline/holo/glow or raised; icons never', () => {
  const k = (numbers) => programKey(normalizeAppearance({ numbers }), F);
  expect(k({ fill: 'holo' })).toMatch(/\|safe0\|n:holo$/);
  expect(k({ fill: 'paint', relief: 'raised' })).toMatch(/\|n:paint\+r$/);
  expect(k({ fill: 'glow', relief: 'raised' })).toMatch(/\|n:glow\+r$/);
  expect(k({ fill: 'gold', icons: { crit: 'crown' } })).toBe(k({ fill: 'gold' }));
  expect(appearanceKey(normalizeAppearance({ numbers: { icons: { crit: 'crown' } } }))).not.toBe(appearanceKey(normalizeAppearance({})));
  expect(programKey(normalizeAppearance({ numbers: { fill: 'holo', relief: 'raised' } }), { ...F, safe: true })).toBe(programKey(normalizeAppearance({}), { ...F, safe: true }));
});
test('needsLookExtras and fallbackLook', () => {
  const plain = normalizeAppearance({});
  expect(needsLookExtras(plain)).toBe(false);
  expect(fallbackLook(plain)).toBe(plain);
  const fancy = normalizeAppearance({ numbers: { fill: 'holo', relief: 'raised', icons: { crit: 'crown' }, color: '#123456', depth: 0.7, font: 'sans' } });
  expect(needsLookExtras(fancy)).toBe(true);
  expect(fallbackLook(fancy).numbers).toEqual({ fill: 'gold', relief: 'engraved', icons: { crit: null, fumble: null }, color: '#123456', depth: 0.7, font: 'sans' });
  expect(fallbackLook(normalizeAppearance({ numbers: { fill: 'outline' } })).numbers.fill).toBe('paint');
  expect(fallbackLook(normalizeAppearance({ numbers: { fill: 'glow' } })).numbers.fill).toBe('paint');
  expect(needsLookExtras(normalizeAppearance({ numbers: { icons: { fumble: 'skull' } } }))).toBe(true);
  expect(fancy.numbers.fill).toBe('holo'); // not mutated
});

// Dice designs plan 2: bodies. Program keys of every built-in look and damage theme at the
// plan-2 base commit; none may change.
const BASE_KEYS = {
  'look:default': 'resin|-|nebula:32|eng1|glow0|fx1|safe0',
  'look:ruby-classic': 'opaque|-|none|eng1|glow0|fx1|safe0',
  'look:abyss-liquid': 'resin|-|liquid:32|eng1|glow0|fx1|safe0',
  'look:starlit-glitter': 'resin|-|glitter:32|eng1|glow0|fx1|safe0',
  'look:galaxy-nebula': 'resin|-|nebula:32|eng1|glow0|fx1|safe0',
  'look:sharp-crystal': 'resin|-|none|eng1|glow0|fx1|safe0',
  'look:dwarven-brass': 'metal|antique|none|eng1|glow0|fx1|safe0',
  'look:silver-brushed': 'metal|brushed|none|eng1|glow0|fx1|safe0',
  'look:gold-polished': 'metal|polished|none|eng1|glow0|fx1|safe0',
  'look:marble-white': 'marble|-|none|eng1|glow0|fx1|safe0',
  'look:jade-marble': 'marble|-|none|eng1|glow0|fx1|safe0',
  'look:pearl-moon': 'pearl|-|none|eng1|glow0|fx1|safe0',
  'look:ember-core': 'resin|-|liquid:32|eng1|glow1|fx1|safe0',
  'look:frost-crystal': 'resin|-|glitter:32|eng1|glow0|fx1|safe0',
  'look:void-star': 'resin|-|shape:star:32|eng1|glow0|fx1|safe0',
  'look:smoke-swirl': 'resin|-|swirl:32|eng1|glow0|fx1|safe0',
  'dmg:fire': 'resin|-|liquid:32|eng1|glow1|fx1|safe0',
  'dmg:cold': 'resin|-|glitter:32|eng1|glow0|fx1|safe0',
  'dmg:acid': 'resin|-|liquid:32|eng1|glow0|fx1|safe0',
  'dmg:electricity': 'resin|-|nebula:32|eng1|glow1|fx1|safe0',
  'dmg:sonic': 'pearl|-|none|eng1|glow0|fx1|safe0',
  'dmg:poison': 'opaque|-|none|eng1|glow0|fx1|safe0',
  'dmg:force': 'resin|-|swirl:32|eng1|glow0|fx1|safe0',
  'dmg:vitality': 'pearl|-|none|eng1|glow1|fx1|safe0',
  'dmg:void': 'opaque|-|none|eng1|glow1|fx1|safe0',
  'dmg:mental': 'resin|-|nebula:32|eng1|glow0|fx1|safe0',
  'dmg:bleed': 'resin|-|liquid:32|eng1|glow0|fx1|safe0',
  'dmg:spirit': 'resin|-|swirl:32|eng1|glow0|fx1|safe0',
  'dmg:physical': 'metal|antique|none|eng1|glow0|fx1|safe0',
};
const body = (b) => normalizeAppearance({ body: b });
describe('dice designs plan 2: bodies', () => {
  test("new body types, finishes and presets normalise; a preset not of its type falls back to the type's first; types without presets store null", () => {
    expect(body({ type: 'gem', preset: 'malachite' }).body).toMatchObject({ type: 'gem', preset: 'malachite' });
    expect(body({ type: 'iridescent', preset: 'dichroic' }).body.preset).toBe('dichroic');
    expect(body({ type: 'wood', preset: 'ebony' }).body.preset).toBe('ebony');
    expect(body({ type: 'wood', preset: 'opal' }).body.preset).toBe('oak');
    expect(body({ type: 'wood' }).body.preset).toBe('oak');
    expect(body({ type: 'gem', preset: 'oak' }).body.preset).toBe('amethyst');
    expect(body({ type: 'iridescent', preset: 7 }).body.preset).toBe('chameleon');
    for (const t of ['opaque', 'resin', 'metal', 'marble', 'pearl']) expect(body({ type: t, preset: 'oak' }).body.preset).toBeNull();
    expect(BODY_PRESETS.gem).toEqual(['amethyst', 'malachite', 'obsidian', 'quartz']);
    for (const f of ['patina', 'worn']) expect(body({ type: 'metal', finish: f }).body.finish).toBe(f);
    expect(body({ type: 'metal', finish: 'rusty' }).body.finish).toBe('polished');
    const w = normalizeAppearance({ body: { type: 'wood', preset: 'cherry' } });
    expect(normalizeAppearance(w)).toEqual(w);
  });
  test('luminous is 0..1, default 0', () => {
    expect(DEFAULT_APPEARANCE.body.luminous).toBe(0);
    expect(DEFAULT_APPEARANCE.body.preset).toBeNull();
    expect(body({ luminous: 0.5 }).body.luminous).toBe(0.5);
    expect(body({ luminous: 1 }).body.luminous).toBe(1);
    for (const v of [-0.1, 1.1, 'x', null, NaN]) expect(body({ luminous: v }).body.luminous).toBe(0);
  });
  test('programKey gains lum only for luminous > 0 and never under safe flags', () => {
    const lit = body({ type: 'wood', luminous: 0.4 });
    expect(programKey(lit, F)).toBe('wood|-|none|eng1|glow0|fx1|safe0|lum');
    expect(programKey(body({ type: 'wood', luminous: 0 }), F)).not.toContain('lum');
    expect(programKey(body({ type: 'gem', preset: 'quartz' }), F)).toBe(programKey(body({ type: 'gem', preset: 'amethyst' }), F));
    expect(programKey(lit, { ...F, safe: true })).toBe(programKey(normalizeAppearance({}), { ...F, safe: true }));
  });
  test('every look in LOOKS and DAMAGE_THEMES keeps its programKey and needsLookExtras false', () => {
    const keys = {};
    for (const [k, l] of Object.entries(LOOKS)) {
      const a = normalizeAppearance(l.appearance ?? l);
      keys[`look:${k}`] = programKey(a, F);
      expect(needsLookExtras(a)).toBe(false);
    }
    for (const [k, t] of Object.entries(DAMAGE_THEMES)) {
      keys[`dmg:${k}`] = programKey(t.appearance, F);
      expect(needsLookExtras(t.appearance)).toBe(false);
    }
    expect(keys).toEqual(BASE_KEYS);
  });
  test("patina or worn on a non-metal body: key part '-', needsLookExtras false", () => {
    for (const t of ['opaque', 'resin', 'marble', 'pearl']) {
      const a = body({ type: t, finish: 'patina' });
      expect(programKey(a, F).split('|')[1]).toBe('-');
      expect(needsLookExtras(a)).toBe(false);
      expect(fallbackLook(a)).toBe(a);
    }
    expect(needsLookExtras(body({ type: 'metal', finish: 'worn' }))).toBe(true);
    expect(needsLookExtras(body({ type: 'metal', finish: 'patina' }))).toBe(true);
    expect(needsLookExtras(body({ type: 'metal', finish: 'brushed' }))).toBe(false);
    expect(needsLookExtras(body({ type: 'gem' }))).toBe(true);
    expect(needsLookExtras(body({ type: 'opaque', luminous: 0.2 }))).toBe(true);
  });
  test('fallbackLook maps iridescent→pearl, gem→marble, wood→opaque, patina/worn→antique, luminous→0, preset→null', () => {
    const fb = (b) => fallbackLook(body(b)).body;
    expect(fb({ type: 'iridescent', preset: 'opal' })).toMatchObject({ type: 'pearl', preset: null });
    expect(fb({ type: 'gem' })).toMatchObject({ type: 'marble', preset: null });
    expect(fb({ type: 'wood', color: '#aa5500' })).toMatchObject({ type: 'opaque', preset: null, color: '#aa5500' });
    expect(fb({ type: 'metal', finish: 'patina' }).finish).toBe('antique');
    expect(fb({ type: 'metal', finish: 'worn' }).finish).toBe('antique');
    expect(fb({ type: 'metal', finish: 'brushed', luminous: 0.5 })).toMatchObject({ finish: 'brushed', luminous: 0 });
    expect(fb({ type: 'resin', luminous: 0.5 }).luminous).toBe(0);
    expect(needsLookExtras(fallbackLook(body({ type: 'gem', luminous: 1 })))).toBe(false);
  });
});

const ins = (i, b) => normalizeAppearance({ body: { type: 'resin', ...b }, interior: i });
describe('dice designs plan 3: insides', () => {
  test('new interior types, inclusion, bubble and sand normalise; unknown values fall back', () => {
    for (const type of ['foil', 'eye', 'botanical', 'smoke']) expect(ins({ type }).interior.type).toBe(type);
    expect(ins({ type: 'jelly' }).interior.type).toBe(DEFAULT_APPEARANCE.interior.type);
    expect(DEFAULT_APPEARANCE.interior).toMatchObject({ inclusion: 'flower', bubble: false, sand: false });
    for (const inclusion of ['flower', 'moss', 'butterfly']) expect(ins({ inclusion }).interior.inclusion).toBe(inclusion);
    for (const inclusion of ['fern', 3, null]) expect(ins({ inclusion }).interior.inclusion).toBe('flower');
    expect(ins({ bubble: true, sand: true }).interior).toMatchObject({ bubble: true, sand: true });
    for (const v of [1, 'true', null, {}]) expect(ins({ bubble: v, sand: v }).interior).toMatchObject({ bubble: false, sand: false });
    // stored whatever the type
    expect(ins({ type: 'nebula', bubble: true, inclusion: 'moss' }).interior).toMatchObject({ bubble: true, inclusion: 'moss' });
    const a = ins({ type: 'eye', inclusion: 'butterfly', sand: true });
    expect(normalizeAppearance(a)).toEqual(a);
  });
  test('liquid with bubble/sand gets liquid+b / +s / +bs in programKey; non-liquid insides ignore them', () => {
    const k = (i) => programKey(ins({ type: 'liquid', ...i }), F);
    expect(k({})).toBe('resin|-|liquid:32|eng1|glow0|fx1|safe0');
    expect(k({ bubble: true })).toBe('resin|-|liquid+b:32|eng1|glow0|fx1|safe0');
    expect(k({ sand: true })).toBe('resin|-|liquid+s:32|eng1|glow0|fx1|safe0');
    expect(k({ bubble: true, sand: true })).toBe('resin|-|liquid+bs:32|eng1|glow0|fx1|safe0');
    for (const type of ['nebula', 'glitter', 'swirl', 'shape', 'foil', 'eye', 'botanical', 'smoke']) {
      expect(programKey(ins({ type, bubble: true, sand: true }), F)).toBe(programKey(ins({ type }), F));
    }
    expect(needsLookExtras(ins({ type: 'nebula', bubble: true, sand: true }))).toBe(false);
    expect(programKey(ins({ type: 'foil' }), F)).toContain('|foil:32|');
    expect(programKey(ins({ type: 'liquid', bubble: true }), { ...F, interiors: false })).toContain('|none|');
    expect(programKey(ins({ type: 'liquid', bubble: true }), { ...F, safe: true })).toBe(programKey(normalizeAppearance({}), { ...F, safe: true }));
  });
  test('a new inside on a non-resin body is none and needs no extras', () => {
    for (const type of ['opaque', 'metal', 'marble', 'pearl']) {
      const a = normalizeAppearance({ body: { type }, interior: { type: 'foil', bubble: true, sand: true } });
      expect(a.interior.type).toBe('none');
      expect(needsLookExtras(a)).toBe(false);
      expect(programKey(a, F)).toContain('|none|');
      expect(fallbackLook(a)).toBe(a);
    }
  });
  test('needsLookExtras: resin with a new inside, or liquid with bubble or sand', () => {
    for (const type of ['foil', 'eye', 'botanical', 'smoke']) expect(needsLookExtras(ins({ type }))).toBe(true);
    expect(needsLookExtras(ins({ type: 'liquid' }))).toBe(false);
    expect(needsLookExtras(ins({ type: 'liquid', bubble: true }))).toBe(true);
    expect(needsLookExtras(ins({ type: 'liquid', sand: true }))).toBe(true);
    expect(needsLookExtras(ins({ type: 'glitter', inclusion: 'moss' }))).toBe(false);
  });
  test('fallbackLook maps foil→glitter, eye→shape:sphere, botanical→swirl, smoke→swirl, bubble/sand→false', () => {
    const fb = (i) => fallbackLook(ins(i)).interior;
    expect(fb({ type: 'foil' }).type).toBe('glitter');
    expect(fb({ type: 'eye', shape: 'star' })).toMatchObject({ type: 'shape', shape: 'sphere' });
    expect(fb({ type: 'botanical' }).type).toBe('swirl');
    expect(fb({ type: 'smoke' }).type).toBe('swirl');
    expect(fb({ type: 'liquid', bubble: true, sand: true })).toMatchObject({ type: 'liquid', bubble: false, sand: false });
    expect(fb({ type: 'foil', colors: ['#112233', '#445566'], density: 0.3 })).toMatchObject({ colors: ['#112233', '#445566'], density: 0.3 });
    for (const type of ['foil', 'eye', 'botanical', 'smoke']) expect(needsLookExtras(fallbackLook(ins({ type })))).toBe(false);
    // a look that needs the chunk only for another reason keeps its shape and today's type
    const holo = normalizeAppearance({ interior: { type: 'shape', shape: 'heart' }, numbers: { fill: 'holo' } });
    expect(fallbackLook(holo).interior).toMatchObject({ type: 'shape', shape: 'heart' });
  });
});

describe('dice designs plan 3b: fantasy shapes', () => {
  const NEW = ['sword', 'axe', 'shield', 'dragon', 'runes'];
  const sh = (shape, b) => normalizeAppearance({ body: { type: 'resin', ...b }, interior: { type: 'shape', shape } });
  test('the five fantasy shapes normalise; unknown shapes still fall back', () => {
    for (const shape of [...NEW, 'star', 'heart', 'skull', 'sphere']) expect(sh(shape).interior.shape).toBe(shape);
    for (const shape of ['bow', 3, null]) expect(sh(shape).interior.shape).toBe(DEFAULT_APPEARANCE.interior.shape);
  });
  test('programKey shape:<name> for each; every look in LOOKS and DAMAGE_THEMES keeps its programKey', () => {
    for (const shape of NEW) expect(programKey(sh(shape), F)).toBe(`resin|-|shape:${shape}:32|eng1|glow0|fx1|safe0`);
    expect(programKey(sh('sword'), { ...F, safe: true })).toBe(programKey(normalizeAppearance({}), { ...F, safe: true }));
    const keys = {};
    for (const [id, l] of Object.entries(LOOKS)) keys[`look:${id}`] = programKey(l.appearance, F);
    for (const [k, t] of Object.entries(DAMAGE_THEMES)) keys[`dmg:${k}`] = programKey(t.appearance, F);
    expect(keys).toEqual(BASE_KEYS);
  });
  test('needsLookExtras true only for the new shapes on resin; fallbackLook maps them to star', () => {
    for (const shape of NEW) {
      expect(needsLookExtras(sh(shape))).toBe(true);
      expect(fallbackLook(sh(shape)).interior).toMatchObject({ type: 'shape', shape: 'star' });
      expect(needsLookExtras(fallbackLook(sh(shape)))).toBe(false);
      expect(needsLookExtras(normalizeAppearance({ body: { type: 'opaque' }, interior: { type: 'shape', shape } }))).toBe(false);
      expect(needsLookExtras(normalizeAppearance({ body: { type: 'resin' }, interior: { type: 'glitter', shape } }))).toBe(false);
    }
    for (const shape of ['star', 'heart', 'skull', 'sphere']) {
      const a = sh(shape);
      expect(needsLookExtras(a)).toBe(false);
      expect(fallbackLook(a)).toBe(a);
    }
    expect(fallbackLook(sh('sword', { luminous: 0.5 })).interior.shape).toBe('star');
    expect(fallbackLook(normalizeAppearance({ body: { type: 'resin' }, interior: { type: 'eye', shape: 'sword' } })).interior.shape).toBe('sphere');
  });
});

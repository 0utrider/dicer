// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import Handlebars from 'handlebars';
import { duplicateKeys, usedKeys, resolve } from './lang-check.js';
import { normalizeAppearance, EDGE_STEPS, ICON_IDS, FONT_IDS_BUILTIN, BODY_PRESETS } from '../../src/look/appearance.js';
import { PRESET_COLORS } from '../../src/look/body-colors.js';
import { BUILTIN_THEMES, normalizeTheme, readThemeList, findTheme } from '../../src/themes/themes.js';
import {
  BODY_TYPES,
  FINISHES,
  BODY_PRESET_LISTS,
  FILLS,
  RELIEFS,
  ICON_CHOICES,
  INTERIOR_TYPES,
  INCLUSION_LIST,
  EXTRA_LIST,
  SHAPES,
  D4_SHAPES,
  COIN_CHOICES,
  FONT_KINDS,
  formFromAppearance,
  appearanceFromForm,
  visibleSections,
  fontInvalid,
  setField,
  METAL_FILL_COLORS,
  addOverride,
  removeOverride,
  looksFromForms,
  formsFromTheme,
  exportLook,
  parseLook,
  planSave,
  canUpdate,
  createPreviewScheduler,
} from '../../src/ui/appearance-form.js';

vi.mock('../../src/themes/thumbnailer.js', () => ({ createThumbnailer: vi.fn() }));

const NINE_SHAPES = ['star', 'heart', 'skull', 'sphere', 'sword', 'axe', 'shield', 'dragon', 'runes'];

const resinNebula = {
  body: { type: 'resin', color: '#203040', color2: '#405060', finish: 'polished', roughness: 0.2 },
  interior: { type: 'nebula', colors: ['#aa00ff', '#00ffaa'], density: 0.8, shape: 'heart' },
  numbers: { fill: 'gold', color: '#e2b04a', depth: 0.7, font: 'serif' },
  edges: { radius: 0.75 },
  glow: { color: '#ff8800', intensity: 1.25 },
};
const metal = {
  body: { type: 'metal', color: '#8a7a5a', color2: '#111111', finish: 'antique', roughness: 0.45 },
  numbers: { fill: 'enamel', color: '#102030', depth: 0.3, font: 'sans' },
  edges: { radius: 0 },
  glow: { color: '#ffffff', intensity: 0 },
};

describe('relief, icons, new fills and fonts in the form', () => {
  const FILL7 = ['paint', 'gold', 'silver', 'enamel', 'outline', 'holo', 'glow'];
  it('form round-trips relief, icons, every fill and every built-in font', () => {
    for (const fill of FILL7)
      for (const relief of ['engraved', 'raised']) {
        const a = normalizeAppearance({ numbers: { fill, relief, icons: { crit: 'crown', fumble: 'skull' } } });
        expect(appearanceFromForm(formFromAppearance(a))).toEqual(a);
      }
    for (const font of FONT_IDS_BUILTIN) {
      const a = normalizeAppearance({ numbers: { font } });
      expect(appearanceFromForm(formFromAppearance(a))).toEqual(a);
    }
    for (const icon of ICON_IDS) {
      const a = normalizeAppearance({ numbers: { icons: { crit: icon, fumble: icon } } });
      expect(appearanceFromForm(formFromAppearance(a))).toEqual(a);
    }
  });
  it("'none' icon picks give null icons", () => {
    const f = formFromAppearance({});
    expect(f.numbers.critIcon).toBe('none');
    expect(f.numbers.fumbleIcon).toBe('none');
    expect(appearanceFromForm(f).numbers.icons).toEqual({ crit: null, fumble: null });
    const picked = setField(setField(f, 'numbers.critIcon', 'flame'), 'numbers.relief', 'raised');
    const a = appearanceFromForm(picked);
    expect(a.numbers.icons).toEqual({ crit: 'flame', fumble: null });
    expect(a.numbers.relief).toBe('raised');
  });
  it("the form's option lists are exactly what normalisation accepts", () => {
    const num = (k, v) => normalizeAppearance({ numbers: { [k]: v } }).numbers[k];
    for (const id of FILLS) expect(num('fill', id)).toBe(id);
    for (const id of RELIEFS) expect(num('relief', id)).toBe(id);
    for (const id of FONT_IDS_BUILTIN) expect(num('font', id)).toBe(id);
    for (const id of ICON_IDS) expect(normalizeAppearance({ numbers: { icons: { crit: id } } }).numbers.icons.crit).toBe(id);
    expect(num('fill', 'nope')).not.toBe('nope');
    expect(num('relief', 'nope')).not.toBe('nope');
    expect(num('font', 'nope')).not.toBe('nope');
    expect(normalizeAppearance({ numbers: { icons: { crit: 'nope' } } }).numbers.icons.crit).toBeNull();
    expect(FILLS).toEqual(FILL7);
    expect(ICON_CHOICES).toEqual(['none', ...ICON_IDS]);
    expect(FONT_KINDS).toEqual([...FONT_IDS_BUILTIN, 'css', 'file']);
  });
  it('the glow ink brightness shows only for the glow ink fill (the number colour shows for every fill, metals tinted by it)', () => {
    for (const fill of FILL7) expect(visibleSections({ numbers: { fill } }).inkGlow).toBe(fill === 'glow');
    expect(visibleSections({ numbers: { fill: 'gold' } })).not.toHaveProperty('numberColor');
  });
  it('picking a number colour keeps it as picked (readability off); the toggle round-trips', () => {
    const f0 = formFromAppearance(normalizeAppearance({}));
    expect(f0.numbers.contrast).toBe(true);
    const picked = setField(f0, 'numbers.color', '#336699');
    expect(appearanceFromForm(picked).numbers).toMatchObject({ color: '#336699', contrast: false });
    expect(appearanceFromForm(setField(picked, 'numbers.contrast', true)).numbers.contrast).toBe(true);
    // a metal fill's own colour is not a pick: readability stays on
    expect(appearanceFromForm(setField(f0, 'numbers.fill', 'silver')).numbers.contrast).toBe(true);
  });
  it('the glow ink brightness round-trips through the form; outside 0..200 % it is 100 %', () => {
    const f = setField(formFromAppearance(normalizeAppearance({ numbers: { fill: 'glow' } })), 'numbers.inkGlow', '1.5');
    expect(appearanceFromForm(f).numbers.inkGlow).toBe(1.5);
    expect(normalizeAppearance({ numbers: { inkGlow: 9 } }).numbers.inkGlow).toBe(1);
    expect(normalizeAppearance({}).numbers.inkGlow).toBe(1);
  });
  it('a built-in font is a valid kind, not a computer font', () => {
    const f = setField(formFromAppearance({}), 'numbers.fontKind', 'norse');
    expect(appearanceFromForm(f).numbers.font).toBe('norse');
    expect(fontInvalid(f)).toBe(false);
  });
});

describe('crystal d4, pips and coin faces in the form', () => {
  it('round trip of shapes.d4, pips, coin', () => {
    for (const d4 of ['classic', 'crystal'])
      for (const pips of [false, true])
        for (const coin of ['numbers', 'heads-tails', 'sun-moon']) {
          const a = normalizeAppearance({ shapes: { d4 }, numbers: { pips, coin } });
          expect(a.shapes.d4).toBe(d4);
          expect(a.numbers).toMatchObject({ pips, coin });
          const f = formFromAppearance(a);
          expect(f.shapes.d4).toBe(d4);
          expect(f.numbers).toMatchObject({ pips, coin });
          expect(appearanceFromForm(f)).toEqual(a);
        }
    const f = setField(setField(setField(formFromAppearance({}), 'shapes.d4', 'crystal'), 'numbers.pips', true), 'numbers.coin', 'sun-moon');
    expect(appearanceFromForm(f)).toMatchObject({ shapes: { d4: 'crystal' }, numbers: { pips: true, coin: 'sun-moon' } });
  });
  it('lists pinned to normalisation', () => {
    expect(D4_SHAPES).toEqual(['classic', 'crystal']);
    expect(COIN_CHOICES).toEqual(['numbers', 'heads-tails', 'sun-moon']);
    for (const id of D4_SHAPES) expect(normalizeAppearance({ shapes: { d4: id } }).shapes.d4).toBe(id);
    for (const id of COIN_CHOICES) expect(normalizeAppearance({ numbers: { coin: id } }).numbers.coin).toBe(id);
    expect(normalizeAppearance({ shapes: { d4: 'nope' } }).shapes.d4).toBe('classic');
    expect(normalizeAppearance({ numbers: { coin: 'nope' } }).numbers.coin).toBe('numbers');
  });
  it('saving keeps the per-type looks of dice the editor has no tab for', () => {
    const d7 = { body: { type: 'metal' }, numbers: { fill: 'paint' }, weird: 1 };
    const df = { glow: { color: '#112233', intensity: 0.5 } };
    const theme = { id: 'x', name: 'X', appearance: {}, perType: { d7, df, d6: { body: { type: 'wood' } } } };
    const out = looksFromForms(formsFromTheme(theme), theme);
    expect(JSON.stringify(out.perType.d7)).toBe(JSON.stringify(d7));
    expect(JSON.stringify(out.perType.df)).toBe(JSON.stringify(df));
    expect(out.perType.d6.body.type).toBe('wood');
    expect(looksFromForms(formsFromTheme(theme)).perType.d7).toBeUndefined();
  });
});

describe('bodies, presets and finishes in the form', () => {
  it('form round-trips every new body type, preset and finish', () => {
    for (const [type, presets] of Object.entries(BODY_PRESETS))
      for (const preset of presets) {
        const a = normalizeAppearance({ body: { type, preset } });
        expect(a.body).toMatchObject({ type, preset });
        expect(appearanceFromForm(formFromAppearance(a))).toEqual(a);
      }
    for (const finish of ['patina', 'worn']) {
      const a = normalizeAppearance({ body: { type: 'metal', finish } });
      expect(a.body.finish).toBe(finish);
      expect(appearanceFromForm(formFromAppearance(a))).toEqual(a);
    }
    // string slider values read as numbers
    expect(setField(formFromAppearance({}), 'edges.stripStrength', '0.4').edges.stripStrength).toBe(0.4);
  });
  it('picking a preset applies its PRESET_COLORS; picking a new type picks its first preset', () => {
    let f = setField(formFromAppearance({}), 'body.type', 'wood');
    expect(f.body).toMatchObject({ type: 'wood', preset: 'oak', ...PRESET_COLORS.oak });
    f = setField(f, 'body.preset', 'ebony');
    expect(f.body).toMatchObject({ preset: 'ebony', ...PRESET_COLORS.ebony });
    // re-clicking the active preset keeps edited colours; 'patina' is not a preset id
    expect(setField(setField(f, 'body.color', '#abcdef'), 'body.preset', 'ebony').body.color).toBe('#abcdef');
    expect(setField(f, 'body.preset', 'patina').body.color).toBe(f.body.color);
    // the user can still change every colour afterwards
    f = setField(setField(f, 'body.color', '#123456'), 'body.roughness', '0.9');
    expect(appearanceFromForm(f).body).toMatchObject({ type: 'wood', preset: 'ebony', color: '#123456', roughness: 0.9 });
    // re-picking the same type keeps the chosen preset and edited colours
    f = setField(f, 'body.type', 'wood');
    expect(f.body).toMatchObject({ preset: 'ebony', color: '#123456' });
    // a type without presets has none
    f = setField(f, 'body.type', 'opaque');
    expect(appearanceFromForm(f).body.preset).toBeNull();
    for (const [type, presets] of Object.entries(BODY_PRESETS))
      expect(setField(formFromAppearance({}), 'body.type', type).body).toMatchObject({ preset: presets[0], ...PRESET_COLORS[presets[0]] });
    // the aged finishes apply their colours (a change of finish only)
    f = setField(formFromAppearance({ body: { type: 'metal' } }), 'body.finish', 'patina');
    expect(f.body).toMatchObject({ finish: 'patina', ...PRESET_COLORS.patina });
    f = setField(setField(f, 'body.color', '#010203'), 'body.finish', 'patina');
    expect(f.body.color).toBe('#010203');
    expect(setField(f, 'body.finish', 'worn').body).toMatchObject({ finish: 'worn', ...PRESET_COLORS.worn });
    expect(setField(f, 'body.finish', 'brushed').body.color).toBe('#010203');
  });
  it("the form's body lists are exactly what normalisation accepts", () => {
    expect(BODY_PRESET_LISTS).toEqual(BODY_PRESETS);
    expect(BODY_TYPES).toEqual(['opaque', 'resin', 'metal', 'marble', 'pearl', 'iridescent', 'gem', 'wood', 'stone', 'bone', 'jelly']);
    expect(FINISHES).toEqual(['polished', 'brushed', 'antique', 'patina', 'worn', 'mirror']);
    for (const type of BODY_TYPES) expect(normalizeAppearance({ body: { type } }).body.type).toBe(type);
    for (const finish of FINISHES) expect(normalizeAppearance({ body: { type: 'metal', finish } }).body.finish).toBe(finish);
    for (const id of [...Object.values(BODY_PRESETS).flat(), 'patina', 'worn']) expect(PRESET_COLORS[id]).toBeTruthy();
  });
  it('visibleSections: presets for the new bodies, a second colour for them', () => {
    for (const type of BODY_TYPES) {
      const v = visibleSections({ body: { type } });
      expect(v.preset).toBe(Object.hasOwn(BODY_PRESETS, type));
      expect(v.color2).toBe(['marble', 'pearl', 'iridescent', 'gem', 'wood', 'stone', 'bone', 'jelly'].includes(type));
    }
    // a metal's second colour: only for the aged finishes
    for (const finish of FINISHES) {
      expect(visibleSections({ body: { type: 'metal', finish } }).color2).toBe(finish === 'patina' || finish === 'worn');
    }
    expect(visibleSections({ body: { type: 'opaque', finish: 'patina' } }).color2).toBe(false);
  });
});

describe('the new insides in the form', () => {
  const NEW_TYPES = ['foil', 'eye', 'botanical', 'smoke', 'fire', 'lava', 'storm', 'frost'];
  it('form round-trips every new inside, inclusion, bubble and sand', () => {
    for (const type of NEW_TYPES)
      for (const inclusion of ['flower', 'moss', 'butterfly']) {
        const look = { body: { type: 'resin' }, interior: { type, inclusion } };
        const a = normalizeAppearance(look);
        expect(a.interior).toMatchObject({ type, inclusion });
        expect(appearanceFromForm(formFromAppearance(look))).toEqual(a);
      }
    for (const bubble of [false, true])
      for (const sand of [false, true]) {
        const look = { body: { type: 'resin' }, interior: { type: 'liquid', bubble, sand } };
        const a = normalizeAppearance(look);
        expect(a.interior).toMatchObject({ bubble, sand });
        expect(appearanceFromForm(formFromAppearance(look))).toEqual(a);
        // real booleans through setField, not strings
        let f = setField(formFromAppearance(look), 'interior.bubble', !bubble);
        f = setField(f, 'interior.sand', !sand);
        expect(f.interior).toMatchObject({ bubble: !bubble, sand: !sand });
        expect(appearanceFromForm(f).interior).toMatchObject({ bubble: !bubble, sand: !sand });
      }
  });
  it("the form's lists are exactly what normalisation accepts", () => {
    expect(INTERIOR_TYPES).toEqual(['none', 'liquid', 'glitter', 'swirl', 'nebula', 'shape', ...NEW_TYPES]);
    for (const type of INTERIOR_TYPES) expect(normalizeAppearance({ body: { type: 'resin' }, interior: { type } }).interior.type).toBe(type);
    expect(INCLUSION_LIST).toEqual(['flower', 'moss', 'butterfly']);
    for (const inclusion of INCLUSION_LIST) expect(normalizeAppearance({ interior: { inclusion } }).interior.inclusion).toBe(inclusion);
    expect(normalizeAppearance({ interior: { inclusion: 'bogus' } }).interior.inclusion).toBe('flower');
  });
  it('keeps the new fields through a non-resin body (resin -> metal -> resin)', () => {
    const look = { body: { type: 'resin' }, interior: { type: 'liquid', bubble: true, sand: true } };
    let f = setField(formFromAppearance(look), 'body.type', 'metal');
    expect(f.interior).toMatchObject({ bubble: true, sand: true });
    f = setField(setField(formFromAppearance({ body: { type: 'metal' }, interior: { type: 'botanical', inclusion: 'moss' } }), 'body.type', 'metal'), 'body.type', 'resin');
    expect(appearanceFromForm(f).interior).toMatchObject({ type: 'botanical', inclusion: 'moss' });
  });
  it('visibleSections: inclusion chips only for botanical; bubble and sand only for liquid', () => {
    for (const type of INTERIOR_TYPES) {
      const v = visibleSections({ body: { type: 'resin' }, interior: { type } });
      expect(v.inclusion, type).toBe(type === 'botanical');
      expect(v.liquidOptions, type).toBe(type === 'liquid');
    }
    expect(visibleSections({ body: { type: 'metal' }, interior: { type: 'botanical' } })).toMatchObject({ inclusion: false, liquidOptions: false });
  });
});

describe('form <-> appearance', () => {
  it('round-trips every layer (resin with an inside, metal with a finish)', () => {
    for (const look of [resinNebula, metal]) {
      expect(appearanceFromForm(formFromAppearance(look))).toEqual(normalizeAppearance(look));
    }
  });
  it("the form's shape list equals SHAPES in the look module (that list is not exported)", () => {
    const src = readFileSync('src/look/appearance.js', 'utf8');
    const literal = /^const SHAPES = (\[[^\]]*\]);/m.exec(src)[1];
    expect(SHAPES).toEqual(JSON.parse(literal.replace(/'/g, '"')));
    expect(SHAPES).toEqual(NINE_SHAPES);
  });
  it('round-trips every edge step, fill, inside type, shape and font kind', () => {
    for (const radius of EDGE_STEPS) expect(appearanceFromForm(formFromAppearance({ edges: { radius } })).edges.radius).toBe(radius);
    for (const fill of ['paint', 'gold', 'silver', 'enamel'])
      expect(appearanceFromForm(formFromAppearance({ numbers: { fill } })).numbers.fill).toBe(fill);
    for (const type of ['none', 'liquid', 'glitter', 'swirl', 'nebula', 'shape'])
      for (const shape of NINE_SHAPES) {
        const look = { body: { type: 'resin' }, interior: { type, shape } };
        expect(appearanceFromForm(formFromAppearance(look)).interior).toEqual(normalizeAppearance(look).interior);
      }
    for (const font of ['serif', 'sans', 'css:Georgia', 'file:fonts/My Font.ttf'])
      expect(appearanceFromForm(formFromAppearance({ numbers: { font } })).numbers.font).toBe(font);
  });
  it('reads string input values (sliders, text) as numbers', () => {
    const f = setField(setField(formFromAppearance(resinNebula), 'body.roughness', '0.9'), 'edges.radius', '0.25');
    const a = appearanceFromForm(f);
    expect([a.body.roughness, a.edges.radius]).toEqual([0.9, 0.25]);
  });
  it('round-trips the edge strip, reading a string strength from an input', () => {
    const strip = { style: 'metal', color: '#c0c0c0', strength: 0.6 };
    const look = { edges: { radius: 0.5, strip } };
    expect(appearanceFromForm(formFromAppearance(look)).edges.strip).toEqual(normalizeAppearance(look).edges.strip);
    expect(appearanceFromForm(formFromAppearance(look)).edges.strip).toEqual(strip);
    const f = setField(formFromAppearance(look), 'edges.stripStrength', '0.6');
    expect(appearanceFromForm(f).edges.strip.strength).toBe(0.6);
  });
  it('shows the strip controls only on rounded edges, and the details only for a non-body style', () => {
    const v = (radius, style) => visibleSections(formFromAppearance({ edges: { radius, strip: { style } } }));
    expect([v(0, 'paint').strip, v(0, 'paint').stripDetails]).toEqual([false, false]);
    expect([v(0.5, 'body').strip, v(0.5, 'body').stripDetails]).toEqual([true, false]);
    expect([v(0.5, 'paint').strip, v(0.5, 'paint').stripDetails]).toEqual([true, true]);
  });
  it('a metal fill gets its own colour (the colour picker is hidden for metals)', () => {
    let f = setField(formFromAppearance({ numbers: { fill: 'gold', color: '#e2b04a' } }), 'numbers.fill', 'silver');
    expect(appearanceFromForm(f).numbers).toMatchObject({ fill: 'silver', color: METAL_FILL_COLORS.silver });
    f = setField(f, 'numbers.fill', 'gold');
    expect(appearanceFromForm(f).numbers.color).toBe(METAL_FILL_COLORS.gold);
    // paint and enamel keep whatever colour is there (their picker shows)
    f = setField(setField(f, 'numbers.color', '#ff0000'), 'numbers.fill', 'enamel');
    expect(appearanceFromForm(f).numbers.color).toBe('#ff0000');
  });
  it('re-picking the same metal fill keeps a saved colour (old looks keep their tint)', () => {
    const f = setField(formFromAppearance({ numbers: { fill: 'silver', color: '#e2b04a' } }), 'numbers.fill', 'silver');
    expect(appearanceFromForm(f).numbers).toMatchObject({ fill: 'silver', color: '#e2b04a' });
  });
  it('keeps the inside through a non-resin body (resin -> metal -> resin)', () => {
    let f = formFromAppearance(resinNebula);
    f = setField(f, 'body.type', 'metal');
    expect(appearanceFromForm(f).interior.type).toBe('none'); // a metal die has no inside
    f = setField(f, 'body.type', 'resin');
    expect(appearanceFromForm(f).interior).toEqual(normalizeAppearance(resinNebula).interior);
  });
  it('flags a computer font or file that is not a usable id', () => {
    const f = formFromAppearance({});
    expect(fontInvalid(setField(setField(f, 'numbers.fontKind', 'css'), 'numbers.fontFamily', 'Georgia'))).toBe(false);
    expect(fontInvalid(setField(setField(f, 'numbers.fontKind', 'css'), 'numbers.fontFamily', 'url(x)'))).toBe(true);
    expect(fontInvalid(setField(setField(f, 'numbers.fontKind', 'file'), 'numbers.fontFile', 'http://x/a.ttf'))).toBe(true);
    expect(fontInvalid(setField(f, 'numbers.fontKind', 'sans'))).toBe(false);
  });
});

describe('visibleSections', () => {
  it('shows the inside only for clear resin', () => {
    for (const type of ['opaque', 'metal', 'marble', 'pearl']) expect(visibleSections(normalizeAppearance({ body: { type } })).inside).toBe(false);
    expect(visibleSections(normalizeAppearance(resinNebula))).toMatchObject({ inside: true, insideDetails: true, insideShape: false });
    expect(visibleSections(normalizeAppearance({ body: { type: 'resin' }, interior: { type: 'none' } })).insideDetails).toBe(false);
    expect(visibleSections(normalizeAppearance({ body: { type: 'resin' }, interior: { type: 'shape' } })).insideShape).toBe(true);
  });
  it('the finish only for metal; the second colour for marble and pearl (not resin); fonts by kind', () => {
    const v = (body, numbers) => visibleSections(normalizeAppearance({ body, numbers }));
    expect(['opaque', 'resin', 'metal', 'marble', 'pearl'].map((type) => v({ type }).finish)).toEqual([false, false, true, false, false]);
    expect(['opaque', 'resin', 'metal', 'marble', 'pearl'].map((type) => v({ type }).color2)).toEqual([false, false, false, true, true]);
    expect(visibleSections(formFromAppearance({ numbers: { font: 'css:Impact' } }))).toMatchObject({ fontFamily: true, fontFile: false });
    expect(visibleSections(normalizeAppearance({ numbers: { font: 'file:a/b.ttf' } }))).toMatchObject({ fontFamily: false, fontFile: true });
  });
});

describe('per die type overrides', () => {
  it('add copies the default; remove ("Same as default") drops it; a theme maps both ways', () => {
    let forms = { default: formFromAppearance(resinNebula) };
    forms = addOverride(forms, 'd20');
    expect(forms.d20).toEqual(forms.default);
    forms.d20 = setField(forms.d20, 'body.type', 'metal');
    expect(addOverride(forms, 'd20')).toBe(forms); // already there: unchanged
    expect(addOverride(forms, 'd3')).toBe(forms);
    const { appearance, perType } = looksFromForms(forms);
    expect(appearance.body.type).toBe('resin');
    expect(Object.keys(perType)).toEqual(['d20']);
    expect(perType.d20.body.type).toBe('metal');
    expect(formsFromTheme({ appearance, perType }).d20.body.type).toBe('metal');
    forms = removeOverride(forms, 'd20');
    expect(Object.keys(forms)).toEqual(['default']);
    expect(removeOverride(forms, 'default')).toBe(forms);
  });
});

describe('look file / clipboard', () => {
  it('export -> parse round-trips; a theme or a bare appearance also parses', () => {
    const a = normalizeAppearance(resinNebula);
    expect(parseLook(exportLook(a))).toEqual({ appearance: a });
    expect(parseLook(JSON.stringify({ id: 'x', name: 'X', appearance: metal })).appearance).toEqual(normalizeAppearance(metal));
    expect(parseLook(JSON.stringify(metal)).appearance).toEqual(normalizeAppearance(metal));
  });
  it('rejects malformed input', () => {
    for (const bad of ['not json', '42', '[1,2]', '{"hello":1}', 'null', '{"appearance":"x"}'])
      expect(parseLook(bad).error, bad).toBeTruthy();
  });
});

describe('planSave', () => {
  const theme = { id: 'x', name: ' Night ', appearance: resinNebula, perType: {}, source: 'user' };
  const stored = [{ id: 'user.u1.night', name: 'Old', future: 1, appearance: {} }, 'junk', { id: 'broken' }];
  it('mine: a new id in My themes, unreadable entries kept', () => {
    const p = planSave({ mode: 'mine', theme, userId: 'u1', userList: stored });
    expect(p).toMatchObject({ ok: true, scope: 'user', id: 'user.u1.night-2' });
    expect(p.list.slice(0, 3)).toEqual(stored);
    expect(p.list[3]).toMatchObject({ id: 'user.u1.night-2', name: 'Night' });
    expect(p.list[3].source).toBeUndefined();
  });
  it('world: GM only', () => {
    expect(planSave({ mode: 'world', theme, isGM: false, worldList: [] })).toEqual({ ok: false, reason: 'gm-only' });
    expect(planSave({ mode: 'world', theme, isGM: true, worldList: ['odd'] })).toMatchObject({ ok: true, scope: 'world', id: 'world.night' });
  });
  it('update: own user theme in place (unknown fields kept), world theme for the GM only, others refused', () => {
    const p = planSave({ mode: 'update', theme, originalId: 'user.u1.night', userId: 'u1', userList: stored });
    expect(p.list[0]).toMatchObject({ id: 'user.u1.night', name: 'Night', future: 1 });
    expect(p.list.slice(1)).toEqual(stored.slice(1));
    expect(planSave({ mode: 'update', theme, originalId: 'world.a', userId: 'u1', isGM: false, worldList: [] }).ok).toBe(false);
    expect(planSave({ mode: 'update', theme, originalId: 'world.a', userId: 'u1', isGM: true, worldList: [] }).scope).toBe('world');
    expect(planSave({ mode: 'update', theme, originalId: 'user.u2.x', userId: 'u1', userList: [] }).reason).toBe('not-yours');
    expect(planSave({ mode: 'update', theme, originalId: 'default', userId: 'u1', userList: [] }).ok).toBe(false);
  });
  it('refuses an empty name and a stored list of the wrong shape', () => {
    expect(planSave({ mode: 'mine', theme: { ...theme, name: '  ' }, userId: 'u1', userList: [] }).reason).toBe('name');
    expect(planSave({ mode: 'mine', theme, userId: 'u1', userList: null }).reason).toBe('unreadable');
  });
  it('canUpdate', () => {
    expect(canUpdate('user.u1.a', { userId: 'u1' })).toBe(true);
    expect(canUpdate('user.u2.a', { userId: 'u1' })).toBe(false);
    expect(canUpdate('world.a', { userId: 'u1' })).toBe(false);
    expect(canUpdate('world.a', { userId: 'u1', isGM: true })).toBe(true);
    expect(canUpdate('default', { userId: 'u1', isGM: true })).toBe(false);
  });
});

describe('createPreviewScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('20 rapid changes render at most 3 times, the last with the final value', async () => {
    const render = vi.fn();
    const s = createPreviewScheduler(render, { delay: 80 });
    for (let i = 1; i <= 20; i++) {
      s.schedule(i);
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(render.mock.calls.length).toBeLessThanOrEqual(3);
    expect(render.mock.calls.at(-1)[0]).toBe(20);
  });
  it('one render in flight; changes during it queue one more with the latest value', async () => {
    let finish;
    const render = vi.fn(() => new Promise((r) => (finish = r)));
    const s = createPreviewScheduler(render, { delay: 80 });
    s.schedule('a');
    await vi.advanceTimersByTimeAsync(80);
    expect(render).toHaveBeenCalledTimes(1);
    for (const v of ['b', 'c', 'd']) {
      s.schedule(v);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(render).toHaveBeenCalledTimes(1); // still in flight
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1][0]).toBe('d');
    finish();
    await vi.advanceTimersByTimeAsync(200);
    expect(render).toHaveBeenCalledTimes(2);
  });
  it('cancel stops a pending render', async () => {
    const render = vi.fn();
    const s = createPreviewScheduler(render);
    s.schedule(1);
    s.cancel();
    await vi.advanceTimersByTimeAsync(200);
    expect(render).not.toHaveBeenCalled();
  });
});

// --- the editor window ---------------------------------------------------------------------------
describe('the appearance editor', () => {
  let mod;
  let flags;
  let store;
  let user;
  let thumbs;
  let handles;
  let fonts;
  let foundryStub;
  const lang = JSON.parse(readFileSync('lang/en.json', 'utf8'));
  const localize = (k) => {
    const v = resolve(lang, k);
    return typeof v === 'string' ? v : k;
  };
  const H = Handlebars.create();
  H.registerHelper('localize', (k) => localize(k));
  H.registerHelper('selectOptions', (choices, options) => {
    const sel = String(options.hash.selected ?? '');
    let html = '';
    for (const [v, l] of Object.entries(choices ?? {}))
      html += `<option value="${H.escapeExpression(v)}"${v === sel ? ' selected' : ''}>${H.escapeExpression(l)}</option>`;
    return new H.SafeString(html);
  });
  const template = H.compile(readFileSync('templates/appearance-editor.hbs', 'utf8'));

  beforeAll(async () => {
    class FakeApp {
      static DEFAULT_OPTIONS = {};
      constructor(options = {}) {
        this.options = options;
      }
      get element() {
        return this._el;
      }
      async render() {
        this._el ??= document.createElement('div');
        document.body.appendChild(this._el);
        const ctx = await this._prepareContext();
        this._el.innerHTML = `<section class="window-content">${template(ctx)}</section>`;
        this._onRender(ctx, {});
        return this;
      }
      async close() {
        this._el?.remove();
      }
    }
    foundryStub = {
      applications: {
        api: { ApplicationV2: FakeApp, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: { confirm: vi.fn(async () => true) } },
      },
      utils: { saveDataToFile: vi.fn(), readTextFromFile: vi.fn() },
    };
    vi.stubGlobal('foundry', foundryStub);
    mod = await import('../../src/ui/appearance-editor.js');
  });

  beforeEach(async () => {
    flags = { themes: [{ id: 'user.u1.mine', name: 'Mine', appearance: resinNebula, future: 'kept' }, 'junk'] };
    store = { worldThemes: [{ id: 'world.table', name: 'Table', appearance: metal }] };
    user = { id: 'u1', isGM: false, getFlag: (s, k) => flags[k], setFlag: vi.fn(async (s, k, v) => (flags[k] = v)) };
    vi.stubGlobal('foundry', foundryStub);
    handles = [];
    fonts = { request: vi.fn(async () => ({})), get: vi.fn() };
    thumbs = {
      dispose: vi.fn(),
      preview: vi.fn((canvas, theme, type, hooks) => {
        // a stand-in that "owns" one material per look, freed on update and stop
        const live = new Set();
        const make = () => {
          const m = { disposed: false };
          live.add(m);
          return m;
        };
        let current = make();
        const h = {
          active: true,
          live,
          theme,
          type,
          hooks,
          updates: [],
          update: vi.fn((t, d) => {
            current.disposed = true;
            live.delete(current);
            current = make();
            h.updates.push([t, d]);
          }),
          stop: vi.fn(() => {
            current.disposed = true;
            live.delete(current);
            h.active = false;
          }),
        };
        handles.push(h);
        return h;
      }),
    };
    const { createThumbnailer } = await import('../../src/themes/thumbnailer.js');
    createThumbnailer.mockReset();
    createThumbnailer.mockReturnValue(thumbs);
    vi.stubGlobal('game', {
      user,
      i18n: { localize },
      settings: { get: (_n, k) => store[k], set: vi.fn(async (_n, k, v) => (store[k] = v)) },
      dice3d: { _themeContext: () => ({ atlas: {}, fonts }) },
    });
    vi.stubGlobal('ui', { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });
  afterAll(() => vi.unstubAllGlobals());

  const open = async (opts) => {
    const app = new mod.AppearanceEditor(opts);
    await app.render();
    return app;
  };
  const q = (app, sel) => app.element.querySelector(sel);
  const click = (app, sel) => {
    const el = q(app, sel);
    if (!el) throw new Error(`no ${sel}`);
    return mod.AppearanceEditor.DEFAULT_OPTIONS.actions[el.dataset.action].call(app, { target: el }, el);
  };
  const type = (app, name, value, evt = 'input') => {
    const el = q(app, `[name="${name}"]`);
    el.value = value;
    el.dispatchEvent(new Event(evt, { bubbles: true }));
  };

  it('the numbers section renders relief, icon and font chips with their labels', async () => {
    const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
    const labels = (sel) => [...app.element.querySelectorAll(sel)].map((e) => e.textContent.trim());
    const L = (k) => localize(`DICER.Appearance.${k}`);
    expect(labels('[data-field="numbers.relief"]')).toEqual([L('Relief.engraved'), L('Relief.raised')]);
    for (const field of ['numbers.critIcon', 'numbers.fumbleIcon'])
      expect(labels(`[data-field="${field}"]`)).toEqual(['none', ...ICON_IDS].map((i) => L(`Icon.${i}`)));
    expect(labels('[data-field="numbers.fontKind"]')).toHaveLength(10);
    expect(labels('[data-field="numbers.fontKind"]')).toContain(L('FontKind.norse'));
    expect(labels('[data-field="numbers.fill"]')).toHaveLength(7);
    expect(app.element.textContent).toContain(L('Numbers.IconsHint'));
    await click(app, '[data-field="numbers.critIcon"][data-value="crown"]');
    expect(app.theme().appearance.numbers.icons.crit).toBe('crown');
    await app.close();
  });

  it('the size and weight sliders edit the look live', async () => {
    const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
    expect(q(app, 'input[name="numbers.size"]').value).toBe('1');
    expect(q(app, 'input[name="numbers.weight"]').value).toBe('0');
    type(app, 'numbers.size', '1.2');
    type(app, 'numbers.weight', '-0.5');
    expect(app.theme().appearance.numbers).toMatchObject({ size: 1.2, weight: -0.5 });
    expect(q(app, 'output[data-for="numbers.size"]').textContent).toBe('120%');
    expect(q(app, 'output[data-for="numbers.weight"]').textContent).toBe('-50%');
    await app.close();
  });

  it('controls render with their labels', async () => {
    const L = (k) => localize(`DICER.Appearance.${k}`);
    const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: { d7: { body: { type: 'wood' } }, df: { numbers: { fill: 'paint' } } }, rules: [] } });
    const labels = (sel) => [...app.element.querySelectorAll(sel)].map((e) => e.textContent.trim());
    expect(labels('[data-field="shapes.d4"]')).toEqual([L('Shapes.classic'), L('Shapes.crystal')]);
    expect(labels('[data-field="shapes.d6"]')).toEqual([L('Shapes.classic'), L('Shapes.bullet')]);
    expect(labels('[data-field="shapes.d10"]')).toEqual([L('Shapes.classic'), L('Shapes.crystal')]);
    expect(labels('[data-field="numbers.coin"]')).toEqual(COIN_CHOICES.map((c) => L(`Coin.${c}`)));
    expect(app.element.textContent).toContain(L('Numbers.Pips'));
    expect(q(app, 'input[name="numbers.pips"]')).toBeTruthy();
    // real booleans from the checkbox, chips set the look
    const pips = q(app, 'input[name="numbers.pips"]');
    pips.checked = true;
    pips.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.theme().appearance.numbers.pips).toBe(true);
    await click(app, '[data-field="numbers.coin"][data-value="sun-moon"]');
    await click(app, '[data-field="shapes.d4"][data-value="crystal"]');
    const t = app.theme();
    expect(t.appearance.numbers.coin).toBe('sun-moon');
    expect(t.appearance.shapes.d4).toBe('crystal');
    // dice with no tab keep their looks through a save
    expect(t.perType.d7).toEqual({ body: { type: 'wood' } });
    expect(t.perType.df).toEqual({ numbers: { fill: 'paint' } });
    await app.close();
  });

  it('add-on fonts: a row of radio chips per module that sets the font, refreshed when a module registers another while the editor is open', async () => {
    const { ADDON_FONTS } = await import('../../src/api/addon-fonts.js');
    const hooks = new Map();
    let n = 0;
    globalThis.Hooks = { on: (name, fn) => (hooks.set(++n, [name, fn]), n), off: (name, id) => hooks.delete(id) };
    ADDON_FONTS.set('m.a', { id: 'm.a', moduleId: 'm', label: 'Alpha', file: 'modules/m/a.woff2' });
    const app = await open({});
    try {
      const group = app.element.querySelector('[role="radiogroup"] [data-action="addonFont"]').closest('[role="radiogroup"]');
      expect(group).not.toBeNull();
      const chip = () => app.element.querySelector('[data-action="addonFont"]');
      expect(chip().getAttribute('role')).toBe('radio');
      expect(chip().getAttribute('aria-checked')).toBe('false');
      expect(chip().hasAttribute('aria-pressed')).toBe(false);
      // the listener is registered once and re-renders the window with a font registered later
      const ours = [...hooks.values()].filter(([name]) => name === 'dicer.fontsChanged');
      expect(ours).toHaveLength(1);
      ADDON_FONTS.set('m.b', { id: 'm.b', moduleId: 'm', label: 'Beta', file: 'modules/m/b.woff2' });
      ours[0][1]();
      const labels = () => [...app.element.querySelectorAll('[data-action="addonFont"]')].map((b) => b.textContent.trim());
      for (let i = 0; i < 100 && labels().length < 2; i++) await new Promise((r) => setTimeout(r, 10));
      expect(labels()).toEqual(['Alpha', 'Beta']);
    } finally {
      await app.close();
      ADDON_FONTS.clear();
    }
    expect([...hooks.values()].filter(([name]) => name === 'dicer.fontsChanged')).toHaveLength(0); // removed on close
    delete globalThis.Hooks;
  });

  it('the shape chips list nine shapes with their labels', async () => {
    const L = (k) => localize(`DICER.Appearance.${k}`);
    const app = await open({ base: { id: 't', name: 'T', appearance: { body: { type: 'resin' }, interior: { type: 'shape', shape: 'sword' } }, perType: {}, rules: [] } });
    const chips = [...app.element.querySelectorAll('[data-field="interior.shape"]')];
    expect(chips.map((e) => e.dataset.value)).toEqual(NINE_SHAPES);
    expect(chips.map((e) => e.textContent.trim())).toEqual(
      ['Star', 'Heart', 'Skull', 'Sphere', 'Sword', 'Axe', 'Shield', 'Dragon', 'Magic circle'],
    );
    expect(chips.map((e) => e.textContent.trim())).toEqual(NINE_SHAPES.map((s) => L(`Shape.${s}`)));
    expect(q(app, '[data-field="interior.shape"][data-value="sword"]').getAttribute('aria-pressed')).toBe('true');
    await click(app, '[data-field="interior.shape"][data-value="runes"]');
    expect(app.theme().appearance.interior.shape).toBe('runes');
    await app.close();
  });

  it('inclusion chips only for botanical; bubble and sand only for liquid; iris label for the eye', async () => {
    const L = (k) => localize(`DICER.Appearance.${k}`);
    const resin = { body: { type: 'resin' }, interior: { type: 'liquid' } };
    const app = await open({ base: { id: 't', name: 'T', appearance: resin, perType: {}, rules: [] } });
    const labels = (sel) => [...app.element.querySelectorAll(sel)].map((e) => e.textContent.trim());
    expect(labels('[data-field="interior.type"]')).toEqual(INTERIOR_TYPES.map((t) => L(`InsideType.${t}`)));
    expect(q(app, '[data-field="interior.inclusion"]')).toBeNull();
    expect(q(app, 'input[name="interior.bubble"]')).toBeTruthy();
    expect(q(app, 'input[name="interior.sand"]')).toBeTruthy();
    expect(labels('[data-section="inside"] .dicer-ae-color > span:first-child')[0]).toBe(L('Inside.MainColor'));
    // the toggles round-trip as real booleans
    const bubble = q(app, 'input[name="interior.bubble"]');
    bubble.checked = true;
    bubble.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.theme().appearance.interior.bubble).toBe(true);
    await click(app, '[data-field="interior.type"][data-value="botanical"]');
    expect(q(app, 'input[name="interior.bubble"]')).toBeNull();
    expect(labels('[data-field="interior.inclusion"]')).toEqual(INCLUSION_LIST.map((i) => L(`Inclusion.${i}`)));
    await click(app, '[data-field="interior.inclusion"][data-value="moss"]');
    expect(app.theme().appearance.interior.inclusion).toBe('moss');
    expect(q(app, '[data-field="interior.inclusion"][data-value="moss"]').getAttribute('aria-checked')).toBe('true');
    await click(app, '[data-field="interior.type"][data-value="eye"]');
    expect(q(app, '[data-field="interior.inclusion"]')).toBeNull();
    expect(labels('[data-section="inside"] .dicer-ae-color > span:first-child')[0]).toBe(L('Inside.IrisColor'));
    await app.close();
  });

  it('the Throw button throws the working look (appearance + perType as edited) on the table', async () => {
    const _throwLook = vi.fn(async () => {});
    globalThis.game.dice3d._throwLook = _throwLook;
    const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
    await click(app, '[data-action="throwLook"]');
    expect(_throwLook).toHaveBeenCalledTimes(1);
    const theme = _throwLook.mock.calls[0][0];
    expect(theme.appearance.body.type).toBe(metal.body.type);
    expect(theme.perType).toBeDefined();
    delete globalThis.game.dice3d._throwLook;
    await click(app, '[data-action="throwLook"]');
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith('The live preview needs the 3D dice to be running.');
    await app.close();
  });

  it('the Sound and celebrations play buttons throw a local test d20 with the unsaved choices', async () => {
    const _preview = vi.fn(async () => {});
    globalThis.game.dice3d._preview = _preview;
    const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
    const pick = (name, value) => {
      const el = q(app, `select[name="${name}"]`);
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    pick('extras.soundMaterial', 'wood');
    pick('extras.nat20.effect', 'shockwave');
    pick('extras.nat20.sound', 'fanfare');
    await click(app, '[data-action="previewExtra"][data-key="impact"]');
    expect(_preview).toHaveBeenLastCalledWith(null, expect.objectContaining({ type: 'd20', soundMaterial: 'wood' }));
    await click(app, '[data-action="previewExtra"][data-key="nat20"]');
    const [fx, options] = _preview.mock.calls.at(-1);
    expect(fx).toMatchObject({ effect: { id: 'shockwave' }, sound: { builtin: 'fanfare' }, value: 20 });
    expect(options).toMatchObject({ type: 'd20', value: 20, soundMaterial: 'wood' });
    expect(options.appearance.body.type).toBe(metal.body.type);
    await click(app, '[data-action="previewExtra"][data-key="nat1"]');
    expect(_preview).toHaveBeenLastCalledWith(null, expect.objectContaining({ value: 1 }));
    delete globalThis.game.dice3d._preview;
    await click(app, '[data-action="previewExtra"][data-key="nat20"]');
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith('The live preview needs the 3D dice to be running.');
    await app.close();
  });

  it('picks a sound file and a JB2A animation for a celebration; the theme and preview carry them', async () => {
    const opened = [];
    class FakePicker {
      constructor(opts) {
        this.opts = opts;
        opened.push(this);
      }
      render() {}
    }
    const apps = (globalThis.foundry.applications.apps ??= {});
    const oldPicker = apps.FilePicker;
    apps.FilePicker = { implementation: FakePicker };
    const oldModules = globalThis.game.modules;
    globalThis.game.modules = new Map([['JB2A_DnD5e', { active: true }]]);
    const _preview = vi.fn(async () => {});
    globalThis.game.dice3d._preview = _preview;
    try {
      const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
      const choose = async (selector, path) => {
        const clicked = click(app, selector);
        await vi.waitFor(() => expect(opened.length).toBeGreaterThan(0));
        const picker = opened.shift();
        picker.opts.callback(path);
        await clicked;
        await vi.waitFor(() => expect(q(app, '.window-content')).not.toBeNull());
        return picker;
      };
      const snd = await choose('[data-action="pickSoundFile"][data-key="nat20"]', 'sounds/My%20Yay.ogg');
      expect(snd.opts.type).toBe('audio');
      await vi.waitFor(() => expect(q(app, 'select[name="extras.nat20.sound"]').value).toBe('file'));
      expect(q(app, 'select[name="extras.nat20.sound"] option[value="file"]').textContent).toBe('My Yay.ogg');
      const film = await choose('[data-action="pickJb2a"][data-key="nat20"]', 'modules/JB2A_DnD5e/Library/Generic/Impact/A.webm');
      expect(film.opts.type).toBe('imagevideo');
      expect(film.opts.current).toBe('modules/JB2A_DnD5e/Library/');
      await vi.waitFor(() => expect(q(app, '.dicer-ae-picked')?.textContent).toContain('A.webm'));
      const rule = app.theme().rules.find((r) => r.id === 'dicer.nat20');
      expect(rule).toMatchObject({ effect: { id: 'light-burst', jb2a: 'modules/JB2A_DnD5e/Library/Generic/Impact/A.webm' }, sound: { src: 'sounds/My%20Yay.ogg' } });
      await click(app, '[data-action="previewExtra"][data-key="nat20"]');
      expect(_preview.mock.calls.at(-1)[0]).toMatchObject({ effect: { jb2a: 'modules/JB2A_DnD5e/Library/Generic/Impact/A.webm' }, sound: { src: 'sounds/My%20Yay.ogg' } });
      await choose('[data-action="pickJb2a"][data-key="nat20"]', 'x/not-a-video.png');
      expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith('Pick a JB2A animation file (.webm).');
      await click(app, '[data-action="clearJb2a"][data-key="nat20"]');
      await vi.waitFor(() => expect(q(app, '.dicer-ae-picked')).toBeNull());
      expect(app.theme().rules.find((r) => r.id === 'dicer.nat20').effect).toEqual({ id: 'light-burst' });
      await app.close();
    } finally {
      apps.FilePicker = oldPicker;
      globalThis.game.modules = oldModules;
      delete globalThis.game.dice3d._preview;
    }
  });

  it('face images: one slot per face of the previewed die; picked, cleared, tinted, carried by the theme', async () => {
    const opened = [];
    class FakePicker {
      constructor(opts) {
        this.opts = opts;
        opened.push(this);
      }
      render() {}
    }
    const apps = (globalThis.foundry.applications.apps ??= {});
    const oldPicker = apps.FilePicker;
    apps.FilePicker = { implementation: FakePicker };
    try {
      const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
      expect(app.element.querySelectorAll('.dicer-ae-face')).toHaveLength(20); // d20 previewed
      await click(app, '.dicer-ae-dice [data-type="d6"]');
      await vi.waitFor(() => expect(app.element.querySelectorAll('.dicer-ae-face')).toHaveLength(6));
      const clicked = click(app, '[data-action="pickFace"][data-value="6"]');
      await vi.waitFor(() => expect(opened.length).toBe(1));
      expect(opened[0].opts.type).toBe('image');
      opened[0].opts.callback('worlds/w/six.webp');
      await clicked;
      await vi.waitFor(() => expect(q(app, '.dicer-ae-face.has-image img')?.getAttribute('src')).toBe('worlds/w/six.webp'));
      expect(app.theme().appearance.faces).toEqual({ d6: { 6: 'worlds/w/six.webp' } });
      const tint = q(app, '[name="facesTint"]');
      tint.checked = true;
      tint.dispatchEvent(new Event('change', { bubbles: true }));
      expect(app.theme().appearance.facesTint).toBe(true);
      await click(app, '[data-action="clearFace"][data-value="6"]');
      await vi.waitFor(() => expect(q(app, '.dicer-ae-face.has-image')).toBeNull());
      expect(app.theme().appearance.faces).toBeUndefined();
      // the d100's tens die (10 ... 00), the coin (heads, tails) and the Fate die (+, blank, −) have slots too
      await click(app, '.dicer-ae-dice [data-type="d100"]');
      await vi.waitFor(() => expect(app.element.querySelectorAll('.dicer-ae-face')).toHaveLength(10));
      await click(app, '.dicer-ae-dice [data-type="dc"]');
      await vi.waitFor(() => expect(app.element.querySelectorAll('.dicer-ae-face')).toHaveLength(2));
      await click(app, '.dicer-ae-dice [data-type="df"]');
      await vi.waitFor(() => expect(app.element.querySelectorAll('.dicer-ae-face')).toHaveLength(3));
      const minus = click(app, '[data-action="pickFace"][data-value="-1"]');
      await vi.waitFor(() => expect(opened.length).toBe(2));
      opened[1].opts.callback('worlds/w/minus.webp');
      await minus;
      await vi.waitFor(() => expect(app.theme().appearance.faces).toEqual({ df: { '-1': 'worlds/w/minus.webp' } }));
      await app.close();
    } finally {
      apps.FilePicker = oldPicker;
    }
  });

  it('body image: picked, its mode and sliders reach the look, cleared again', async () => {
    const opened = [];
    class FakePicker {
      constructor(opts) {
        this.opts = opts;
        opened.push(this);
      }
      render() {}
    }
    const apps = (globalThis.foundry.applications.apps ??= {});
    const oldPicker = apps.FilePicker;
    apps.FilePicker = { implementation: FakePicker };
    try {
      const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
      expect(q(app, '[data-field="bodyImage.mode"]')).toBeNull(); // no image yet: only the picker
      const clicked = click(app, '[data-action="pickBodyImage"]');
      await vi.waitFor(() => expect(opened.length).toBe(1));
      expect(opened[0].opts.type).toBe('image');
      opened[0].opts.callback('worlds/w/galaxy.webp');
      await clicked;
      await vi.waitFor(() => expect(q(app, '[data-field="bodyImage.mode"][data-value="face"]')).not.toBeNull());
      expect(app.theme().appearance.bodyImage).toMatchObject({ src: 'worlds/w/galaxy.webp', mode: 'wrap', blend: 1 });
      await click(app, '[data-field="bodyImage.mode"][data-value="face"]');
      type(app, 'bodyImage.blend', '0.4');
      type(app, 'bodyImage.scale', '2');
      expect(app.theme().appearance.bodyImage).toMatchObject({ mode: 'face', blend: 0.4, scale: 2 });
      expect(q(app, 'output[data-for="bodyImage.blend"]').textContent).toBe('40%');
      await click(app, '[data-action="clearBodyImage"]');
      await vi.waitFor(() => expect(q(app, '[data-field="bodyImage.mode"]')).toBeNull());
      expect(app.theme().appearance.bodyImage).toBeUndefined();
      await app.close();
    } finally {
      apps.FilePicker = oldPicker;
    }
  });

  it('with Sequencer active, the film button opens the JB2A picker over its database', async () => {
    const oldModules = globalThis.game.modules;
    globalThis.game.modules = new Map([
      ['jb2a_patreon', { active: true }],
      ['sequencer', { active: true }],
    ]);
    const file = 'modules/jb2a_patreon/Library/Generic/Explosion/Explosion_01_Blue_400x400.webm';
    globalThis.Sequencer = { Database: { publicFlattenedEntries: ['jb2a.explosion.01.blue'], getEntry: () => ({ file }) } };
    try {
      const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
      const clicked = click(app, '[data-action="pickJb2a"][data-key="nat1"]');
      await vi.waitFor(() => expect(document.querySelector('.dicer-jp-tile')).not.toBeNull());
      document.querySelector('.dicer-jp-tile[data-key="jb2a.explosion.01"]').click();
      document.querySelector('.dicer-jp-choose').click();
      await clicked;
      await vi.waitFor(() => expect(app.theme().rules.find((r) => r.id === 'dicer.nat1')?.effect).toEqual({ id: 'light-burst', jb2a: file }));
      await app.close();
    } finally {
      globalThis.game.modules = oldModules;
      delete globalThis.Sequencer;
      document.querySelectorAll('.dicer-jp').forEach((n) => n.remove());
    }
  });

  it('hides the JB2A button without an active JB2A module', async () => {
    const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
    expect(q(app, '[data-action="pickJb2a"]')).toBeNull();
    expect(q(app, '[data-action="pickSoundFile"][data-key="nat1"]')).not.toBeNull();
    await app.close();
  });

  it('renders one root with the layer sections; the inside is a note for a non-resin body', async () => {
    const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
    const root = q(app, '.window-content');
    expect(root.children).toHaveLength(1);
    const sections = [...app.element.querySelectorAll('details[data-section]')].map((d) => d.dataset.section);
    expect(sections).toEqual(['body', 'inside', 'numbers', 'edges', 'glow', 'perType', 'damage', 'extras']);
    expect(q(app, '[data-section="inside"] .dicer-ae-note')).toBeTruthy();
    expect(q(app, '[data-field="interior.type"]')).toBeNull();
    expect(q(app, '[data-field="body.finish"]')).toBeTruthy(); // metal shows the finish
    expect(app.element.querySelectorAll('.dicer-ae-edges button')).toHaveLength(5);
    expect(q(app, '.dicer-ae-edges button.active').dataset.value).toBe('0');
    await app.close();
  });

  it('the edges section offers four strip styles (body active), live colour and strength, and a summary', async () => {
    const L = (k) => localize(`DICER.Appearance.${k}`);
    const round = { ...metal, edges: { radius: 0.5 } };
    const app = await open({ base: { id: 't', name: 'T', appearance: round, perType: {}, rules: [] } });
    const labels = [...app.element.querySelectorAll('[data-field="edges.strip"]')].map((e) => e.textContent.trim());
    expect(labels).toEqual(['body', 'paint', 'metal', 'glow'].map((s) => L(`Strip.${s}`)));
    expect(q(app, '[data-field="edges.strip"].active').dataset.value).toBe('body');
    expect(q(app, 'input[name="edges.stripStrength"]')).toBeNull();
    expect(q(app, '[data-section="edges"] summary em').textContent).toBe(L('Edge.soft'));
    await click(app, '[data-field="edges.strip"][data-value="metal"]');
    expect(q(app, '[data-field="edges.strip"].active').dataset.value).toBe('metal');
    expect(q(app, 'input[name="edges.stripColor"]')).toBeTruthy();
    expect(q(app, '[data-color-for="edges.stripColor"]')).toBeTruthy();
    const range = q(app, 'input[name="edges.stripStrength"]');
    expect([range.getAttribute('min'), range.getAttribute('max'), range.getAttribute('step')]).toEqual(['0', '1', '0.05']);
    expect(q(app, 'output[data-for="edges.stripStrength"]')).toBeTruthy();
    expect(q(app, '[data-section="edges"] summary em').textContent).toBe(`${L('Edge.soft')} · ${L('Strip.metal')}`);
    await app.close();
    const sharp = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
    expect(q(sharp, '[data-field="edges.strip"]')).toBeNull();
    expect(sharp.element.textContent).toContain(L('Edges.StripNeedsRound'));
    await sharp.close();
  });

  it('the material section renders preset chips only for types with presets, and six finishes for metal', async () => {
    const L = (k) => localize(`DICER.Appearance.${k}`);
    const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
    const labels = (sel) => [...app.element.querySelectorAll(sel)].map((e) => e.textContent.trim());
    expect(labels('[data-field="body.type"]')).toHaveLength(11);
    expect(labels('[data-field="body.finish"]')).toEqual(['polished', 'brushed', 'antique', 'patina', 'worn', 'mirror'].map((f) => L(`Finish.${f}`)));
    expect(q(app, '[data-field="body.preset"]')).toBeNull();
    expect(q(app, 'input[name="body.luminous"]')).toBeNull();
    await click(app, '[data-field="body.type"][data-value="wood"]');
    expect(labels('[data-field="body.preset"]')).toEqual(BODY_PRESETS.wood.map((p) => L(`Preset.${p}`)));
    expect(q(app, '[data-field="body.preset"][data-value="oak"]').getAttribute('aria-checked')).toBe('true');
    expect(q(app, '[data-field="body.finish"]')).toBeNull();
    expect(app.element.textContent).toContain(L('Body.Preset'));
    await click(app, '[data-field="body.preset"][data-value="cherry"]');
    expect(app.theme().appearance.body).toMatchObject({ type: 'wood', preset: 'cherry', ...PRESET_COLORS.cherry });
    expect(q(app, 'input[name="body.color"]').value).toBe(PRESET_COLORS.cherry.color);
    await click(app, '[data-field="body.type"][data-value="opaque"]');
    expect(q(app, '[data-field="body.preset"]')).toBeNull();
    await app.close();
  });

  it('a body chip switches the stack (resin shows the inside, hides the finish) and previews the change', async () => {
    vi.useFakeTimers();
    const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
    await click(app, '[data-field="body.type"][data-value="resin"]');
    expect(q(app, '[data-field="interior.type"]')).toBeTruthy();
    expect(q(app, '[data-field="body.finish"]')).toBeNull();
    expect(q(app, '[data-field="body.type"][data-value="resin"]').classList.contains('active')).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(handles).toHaveLength(1); // the same preview, updated in place
    expect(handles[0].updates.at(-1)[0].appearance.body.type).toBe('resin');
    await app.close();
  });

  it('20 rapid slider moves give at most 3 preview renders, the last with the final value', async () => {
    vi.useFakeTimers();
    const app = await open({ themeId: 'user.u1.mine' });
    await vi.advanceTimersByTimeAsync(200);
    const before = handles[0].update.mock.calls.length;
    for (let i = 1; i <= 20; i++) {
      type(app, 'body.roughness', String(i / 20));
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(200);
    const calls = handles[0].update.mock.calls.slice(before);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(calls.at(-1)[0].appearance.body.roughness).toBe(1);
    expect(q(app, 'output[data-for="body.roughness"]').textContent).toBe('100%');
    await app.close();
  });

  it('200 edits leave no undisposed preview material; close stops the preview and disposes the thumbnailer', async () => {
    vi.useFakeTimers();
    const app = await open({ themeId: 'user.u1.mine' });
    for (let i = 0; i < 200; i++) {
      if (i % 10 === 0) await click(app, `[data-field="body.type"][data-value="${['metal', 'resin', 'pearl'][i % 3]}"]`);
      else type(app, 'body.color', `#${String(i).padStart(6, '0')}`);
      await vi.advanceTimersByTimeAsync(i % 2 ? 90 : 5);
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(handles).toHaveLength(1);
    expect(handles[0].live.size).toBe(1); // only the die on screen
    await app.close();
    expect(handles[0].stop).toHaveBeenCalledTimes(1);
    expect(handles[0].live.size).toBe(0);
    expect(thumbs.dispose).toHaveBeenCalledTimes(1);
    expect(handles[0].stop.mock.invocationCallOrder[0]).toBeLessThan(thumbs.dispose.mock.invocationCallOrder[0]);
  });

  it('a re-render keeps the same turning canvas', async () => {
    const app = await open({ themeId: 'user.u1.mine' });
    const canvas = q(app, 'canvas.dicer-live');
    await click(app, '[data-field="numbers.fill"][data-value="silver"]');
    expect(q(app, 'canvas.dicer-live')).toBe(canvas);
    expect(thumbs.preview).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('the coin previews (a d2 button) but is no per-type look', async () => {
    const app = await open({ themeId: 'user.u1.mine' });
    expect(q(app, '.dicer-ae-dice button[data-type="d2"]')).toBeTruthy();
    expect(q(app, '[data-action="editType"][data-type="d2"]')).toBeNull();
    await click(app, '.dicer-ae-dice button[data-type="d2"]');
    expect(q(app, '.dicer-ae-dice button.active').dataset.type).toBe('d2');
    expect(thumbs.preview.mock.calls[0][2]).toBe('d20');
    expect(app.theme().perType).toEqual({});
    await app.close();
  });

  it('per die type: "use a different look for" a type edits its own copy; "same as default" removes it', async () => {
    const app = await open({ themeId: 'user.u1.mine' });
    await click(app, '[data-action="editType"][data-type="d20"]');
    expect(q(app, '.dicer-ae-banner')).toBeTruthy();
    expect(q(app, '.dicer-ae-dice button.active').dataset.type).toBe('d20');
    await click(app, '[data-field="body.type"][data-value="metal"]');
    let t = app.theme();
    expect(t.appearance.body.type).toBe('resin');
    expect(t.perType.d20.body.type).toBe('metal');
    expect(q(app, '.dicer-ae-dice button[data-type="d20"]').classList.contains('has-own')).toBe(true);
    await click(app, '[data-action="editType"][data-type="default"]');
    expect(q(app, '.dicer-ae-banner')).toBeNull();
    await click(app, '[data-action="sameAsDefault"][data-type="d20"]');
    t = app.theme();
    expect(t.perType).toEqual({});
    await app.close();
  });

  it('update writes the own theme in place, keeping unknown fields and unreadable entries', async () => {
    const app = await open({ themeId: 'user.u1.mine' });
    expect(q(app, '[data-action="update"]')).toBeTruthy();
    expect(q(app, '[data-action="saveWorld"]')).toBeNull(); // a player sees no world save
    type(app, 'name', 'Mine 2');
    await click(app, '[data-field="edges.radius"][data-value="0.25"]');
    await click(app, '[data-action="update"]');
    expect(flags.themes).toHaveLength(2);
    expect(flags.themes[1]).toBe('junk');
    expect(flags.themes[0]).toMatchObject({ id: 'user.u1.mine', name: 'Mine 2', future: 'kept' });
    expect(normalizeTheme(flags.themes[0], 'user').appearance.edges.radius).toBe(0.25);
    await app.close();
  });

  it('save as my theme adds a new theme; a player cannot world-save even through the handler', async () => {
    const onSave = vi.fn();
    const app = await open({ base: 'default', onSave });
    expect(q(app, '[data-action="update"]')).toBeNull();
    await click(app, '[data-action="saveMine"]');
    expect(flags.themes).toHaveLength(3);
    expect(flags.themes[2].id).toMatch(/^user\.u1\./);
    expect(onSave).toHaveBeenCalledWith(flags.themes[2].id);
    expect(q(app, '[data-action="update"]')).toBeTruthy(); // now editing what was saved
    await mod.AppearanceEditor.DEFAULT_OPTIONS.actions.saveWorld.call(app);
    expect(store.worldThemes).toHaveLength(1);
    expect(game.settings.set).not.toHaveBeenCalled();
    expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('the GM saves a world theme; every client reads the edit on its next roll', async () => {
    user.isGM = true;
    const app = await open({ themeId: 'world.table' });
    expect(q(app, '[data-action="saveWorld"]')).toBeTruthy();
    expect(q(app, '[data-action="update"]')).toBeTruthy();
    await click(app, '[data-field="body.finish"][data-value="brushed"]');
    await click(app, '[data-action="update"]');
    expect(store.worldThemes).toHaveLength(1);
    // the resolver reads the setting's new list: the edited look, same id
    const theme = readThemeList(store.worldThemes, 'world', () => {}).find((t) => t.id === 'world.table');
    expect(theme.appearance.body.finish).toBe('brushed');
    expect(findTheme('world.table', { worldThemes: store.worldThemes }).appearance.body.finish).toBe('brushed');
    await click(app, '[data-action="saveWorld"]');
    expect(store.worldThemes.map((t) => t.id)).toEqual(['world.table', 'world.table-2']);
    await app.close();
  });

  it('import / paste a look; malformed input is rejected with one warning; copy / export write the look JSON', async () => {
    const app = await open({ themeId: 'user.u1.mine' });
    let clip = '';
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async (t) => (clip = t)), readText: vi.fn(async () => clip) } });
    await click(app, '[data-action="copyLook"]');
    expect(parseLook(clip).appearance).toEqual(normalizeAppearance(resinNebula));
    clip = 'definitely not a look';
    await click(app, '[data-action="pasteLook"]');
    expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
    expect(app.theme().appearance).toEqual(normalizeAppearance(resinNebula)); // unchanged
    clip = exportLook(metal);
    await click(app, '[data-action="pasteLook"]');
    expect(app.theme().appearance).toEqual(normalizeAppearance(metal));
    await click(app, '[data-action="exportLook"]');
    const [json, mime] = foundry.utils.saveDataToFile.mock.calls[0];
    expect(mime).toBe('application/json');
    expect(parseLook(json).appearance).toEqual(normalizeAppearance(metal));
    expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    vi.stubGlobal('foundry', foundryStub);
    await app.close();
  });

  it('a font that fails to load shows a message in the font field', async () => {
    fonts.request = vi.fn(async () => null);
    const app = await open({ themeId: 'user.u1.mine' });
    await click(app, '[data-field="numbers.fontKind"][data-value="css"]');
    type(app, 'numbers.fontFamily', 'No Such Font', 'change');
    await vi.waitFor(() => expect(q(app, '.dicer-ae-font-msg').hidden).toBe(false));
    expect(q(app, '.dicer-ae-font-msg').textContent).toContain(localize('DICER.Appearance.Numbers.FontFailed'));
    fonts.request = vi.fn(async () => ({}));
    await click(app, '[data-field="numbers.fontFamily"][data-value="Georgia"]');
    await vi.waitFor(() => expect(q(app, '.dicer-ae-font-msg').hidden).toBe(true));
    await app.close();
  });

  it('a font that never loads does not hold up the preview: a later edit still updates within ~100 ms', async () => {
    vi.useFakeTimers();
    fonts.request = vi.fn(() => new Promise(() => {})); // never resolves (a hung font)
    const app = await open({ themeId: 'user.u1.mine' });
    await click(app, '[data-field="numbers.fontKind"][data-value="css"]');
    type(app, 'numbers.fontFamily', 'Slow Font', 'change');
    await vi.advanceTimersByTimeAsync(100);
    expect(fonts.request).toHaveBeenCalledWith('css:Slow Font');
    const n = handles[0].update.mock.calls.length;
    type(app, 'body.color', '#123456');
    await vi.advanceTimersByTimeAsync(100);
    expect(handles[0].update.mock.calls.length).toBe(n + 1);
    expect(handles[0].update.mock.calls.at(-1)[0].appearance.body.color).toBe('#123456');
    await app.close();
  });

  it('"Default look" moves the preview off a die type that has its own look', async () => {
    const app = await open({ themeId: 'user.u1.mine' });
    await click(app, '[data-action="editType"][data-type="d20"]');
    expect(q(app, '.dicer-ae-dice button.active').dataset.type).toBe('d20');
    await click(app, '[data-action="editType"][data-type="default"]');
    expect(q(app, '.dicer-ae-dice button.active').dataset.type).toBe('d4'); // d20 has its own look
    await click(app, '[data-action="sameAsDefault"][data-type="d20"]');
    await click(app, '[data-action="editType"][data-type="d8"]');
    await click(app, '[data-action="editType"][data-type="default"]');
    expect(q(app, '.dicer-ae-dice button.active').dataset.type).toBe('d20');
    await app.close();
  });

  it('a cleared name is refused (no save under the base theme name)', async () => {
    const app = await open({ themeId: 'user.u1.mine' });
    type(app, 'name', '   ');
    await click(app, '[data-action="saveMine"]');
    await click(app, '[data-action="update"]');
    expect(user.setFlag).not.toHaveBeenCalled();
    expect(ui.notifications.warn).toHaveBeenCalledTimes(2);
    expect(ui.notifications.warn.mock.calls[0][0]).toBe(localize('DICER.Appearance.NeedName'));
    await app.close();
  });

  it('opening another look asks first only when the current editor has unsaved changes', async () => {
    const confirm = foundry.applications.api.DialogV2.confirm;
    confirm.mockClear();
    const first = await mod.openAppearanceEditor({ themeId: 'user.u1.mine' });
    await mod.openAppearanceEditor({ themeId: 'world.table' }); // clean: no prompt
    expect(confirm).not.toHaveBeenCalled();
    const current = await mod.openAppearanceEditor({ themeId: 'user.u1.mine' });
    expect(current).not.toBe(first);
    await click(current, '[data-field="body.type"][data-value="pearl"]');
    expect(current.dirty).toBe(true);
    confirm.mockResolvedValueOnce(false); // keep editing
    expect(await mod.openAppearanceEditor({ themeId: 'world.table' })).toBe(current);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(current.theme().appearance.body.type).toBe('pearl');
    confirm.mockResolvedValueOnce(true); // discard
    const next = await mod.openAppearanceEditor({ themeId: 'world.table' });
    expect(next).not.toBe(current);
    expect(confirm).toHaveBeenCalledTimes(2);
    // saving makes it clean again
    await click(next, '[data-action="saveMine"]');
    expect(next.dirty).toBe(false);
    await next.close();
  });

  it('closing a dirty editor (window X, Escape, Cancel) asks first; no keeps it open (M-8)', async () => {
    const confirm = foundry.applications.api.DialogV2.confirm;
    confirm.mockClear();
    const app = await mod.openAppearanceEditor({ themeId: 'user.u1.mine' });
    await app.close(); // clean: closes without a question
    expect(confirm).not.toHaveBeenCalled();
    expect(thumbs.dispose).toHaveBeenCalledTimes(1);
    const dirty = await mod.openAppearanceEditor({ themeId: 'user.u1.mine' });
    await click(dirty, '[data-field="body.type"][data-value="pearl"]');
    confirm.mockResolvedValueOnce(false);
    expect(await dirty.close()).toBe(dirty); // the X: kept open, still editing
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].content).toContain(localize('DICER.Appearance.DiscardChanges'));
    expect(dirty.element.isConnected).toBe(true);
    confirm.mockResolvedValueOnce(true);
    await click(dirty, '[data-action="cancel"]');
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(dirty.element.isConnected).toBe(false);
  });

  it('a duplicate of a built-in theme starts as an unsaved copy named "(copy)"', async () => {
    const app = await open({ base: BUILTIN_THEMES[0] });
    expect(q(app, 'input[name="name"]').value).toBe(`${BUILTIN_THEMES[0].name} (copy)`);
    expect(q(app, '[data-action="update"]')).toBeNull();
    expect(flags.themes).toHaveLength(2);
    await app.close();
  });

  it('has no pet section: the pet is the player’s own, in its own window (ui/pet-window.js)', async () => {
    const app = await open({ themeId: 'user.u1.mine' });
    expect(q(app, 'details[data-section="pet"]')).toBeNull();
    expect(q(app, '[data-action="setPet"]')).toBeNull();
    await app.close();
  });
});

describe('lang/en.json', () => {
  it('resolves every DICER.Appearance key the editor and its template use', () => {
    expect(duplicateKeys()).toEqual([]);
    const lang = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Appearance;
    const keys = usedKeys('Appearance', ['src/ui/appearance-editor.js', 'templates/appearance-editor.hbs'], {
      'BodyType.': BODY_TYPES,
      'Finish.': FINISHES,
      'Preset.': Object.values(BODY_PRESETS).flat(),
      'InsideType.': INTERIOR_TYPES,
      'Inclusion.': INCLUSION_LIST,
      'Extra.': EXTRA_LIST,
      'Shape.': NINE_SHAPES,
      'Fill.': ['paint', 'gold', 'silver', 'enamel', 'outline', 'holo', 'glow'],
      'FontKind.': [...FONT_IDS_BUILTIN, 'css', 'file'],
      'Relief.': ['engraved', 'raised'],
      'Shapes.': ['D4', 'classic', 'crystal'],
      'Coin.': ['numbers', 'heads-tails', 'sun-moon'],
      'Icon.': ['none', ...ICON_IDS],
      'BodyImage.Mode.': ['wrap', 'face'],
      'BodyImage.ModeHint.': ['wrap', 'face'],
      'Edge.': ['sharp', 'crisp', 'soft', 'round', 'veryRound'],
      'Strip.': ['body', 'paint', 'metal', 'glow'],

    });
    expect(keys.length).toBeGreaterThan(30);
    expect([BODY_TYPES.length, Object.values(BODY_PRESETS).flat().length, FINISHES.length]).toEqual([11, 19, 6]);
    expect(keys).toEqual(expect.arrayContaining(['Body.Preset']));
    for (const k of keys) expect(typeof resolve(lang, k), `DICER.Appearance.${k}`).toBe('string');
    // dynamic keys built from lists
    for (const [group, ids] of Object.entries({
      BodyType: BODY_TYPES,
      Finish: FINISHES,
      Preset: Object.values(BODY_PRESETS).flat(),
      Section: ['body', 'inside', 'numbers', 'edges', 'glow', 'perType', 'extras'],
      Pet: ['Title', 'Hint', 'None', 'Mimic', 'Slime', 'Dragonling', 'Color', 'Hidden', 'SaveFailed'],
    }))
      for (const id of ids) expect(typeof lang[group][id], `${group}.${id}`).toBe('string');
  });
  it('has the appearanceEditor menu keys', () => {
    const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Settings.appearanceEditor;
    expect(Object.keys(en).sort()).toEqual(['Hint', 'Label', 'Name']);
  });
});

describe('number size and weight in the form', () => {
  it('round-trips size and weight; old looks get the defaults', () => {
    const a = normalizeAppearance({ numbers: { size: 1.35, weight: -0.4 } });
    const f = formFromAppearance(a);
    expect(f.numbers).toMatchObject({ size: 1.35, weight: -0.4 });
    expect(appearanceFromForm(f)).toEqual(a);
    expect(formFromAppearance({ numbers: { fill: 'paint' } }).numbers).toMatchObject({ size: 1, weight: 0 });
  });
  it('slider strings become numbers', () => {
    let f = setField(formFromAppearance({}), 'numbers.size', '0.75');
    f = setField(f, 'numbers.weight', '0.6');
    expect(f.numbers).toMatchObject({ size: 0.75, weight: 0.6 });
    expect(appearanceFromForm(f).numbers).toMatchObject({ size: 0.75, weight: 0.6 });
  });
  it('the numbers section has both sliders, with live outputs and labels', () => {
    const lang = JSON.parse(readFileSync('lang/en.json', 'utf8'));
    expect(resolve(lang, 'DICER.Appearance.Numbers.Size')).toBeTypeOf('string');
    expect(resolve(lang, 'DICER.Appearance.Numbers.Weight')).toBeTypeOf('string');
    const hbs = readFileSync('templates/appearance-editor.hbs', 'utf8');
    expect(hbs).toMatch(/<input type="range" name="numbers\.size" min="0\.6" max="1\.4" step="0\.05" value="\{\{form\.numbers\.size\}\}">/);
    expect(hbs).toMatch(/<input type="range" name="numbers\.weight" min="-1" max="1" step="0\.05" value="\{\{form\.numbers\.weight\}\}">/);
    expect(hbs).toContain('<output data-for="numbers.size">{{pct.size}}</output>');
    expect(hbs).toContain('<output data-for="numbers.weight">{{pct.weight}}</output>');
  });
});

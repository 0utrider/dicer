// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import Handlebars from 'handlebars';
import { duplicateKeys, usedKeys, resolve } from './lang-check.js';
import { normalizeAppearance, EDGE_STEPS } from '../../src/look/appearance.js';
import { BUILTIN_THEMES, normalizeTheme, readThemeList, findTheme } from '../../src/themes/themes.js';
import {
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

describe('form <-> appearance', () => {
  it('round-trips every layer (resin with an inside, metal with a finish)', () => {
    for (const look of [resinNebula, metal]) {
      expect(appearanceFromForm(formFromAppearance(look))).toEqual(normalizeAppearance(look));
    }
  });
  it('round-trips every edge step, fill, inside type, shape and font kind', () => {
    for (const radius of EDGE_STEPS) expect(appearanceFromForm(formFromAppearance({ edges: { radius } })).edges.radius).toBe(radius);
    for (const fill of ['paint', 'gold', 'silver', 'enamel'])
      expect(appearanceFromForm(formFromAppearance({ numbers: { fill } })).numbers.fill).toBe(fill);
    for (const type of ['none', 'liquid', 'glitter', 'swirl', 'nebula', 'shape'])
      for (const shape of ['star', 'heart', 'skull', 'sphere']) {
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
  it('the finish only for metal; the second colour for marble, pearl and resin; number colour for paint and enamel', () => {
    const v = (body, numbers) => visibleSections(normalizeAppearance({ body, numbers }));
    expect(['opaque', 'resin', 'metal', 'marble', 'pearl'].map((type) => v({ type }).finish)).toEqual([false, false, true, false, false]);
    expect(['opaque', 'resin', 'metal', 'marble', 'pearl'].map((type) => v({ type }).color2)).toEqual([false, true, false, true, true]);
    expect(['paint', 'gold', 'silver', 'enamel'].map((fill) => v({}, { fill }).numberColor)).toEqual([true, false, false, true]);
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

  it('renders one root with the layer sections; the inside is a note for a non-resin body', async () => {
    const app = await open({ base: { id: 't', name: 'T', appearance: metal, perType: {}, rules: [] } });
    const root = q(app, '.window-content');
    expect(root.children).toHaveLength(1);
    const sections = [...app.element.querySelectorAll('details[data-section]')].map((d) => d.dataset.section);
    expect(sections).toEqual(['body', 'inside', 'numbers', 'edges', 'glow', 'perType', 'extras']);
    expect(q(app, '[data-section="inside"] .dicer-ae-note')).toBeTruthy();
    expect(q(app, '[data-field="interior.type"]')).toBeNull();
    expect(q(app, '[data-field="body.finish"]')).toBeTruthy(); // metal shows the finish
    expect(app.element.querySelectorAll('.dicer-ae-edges button')).toHaveLength(5);
    expect(q(app, '.dicer-ae-edges button.active').dataset.value).toBe('0');
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
});

describe('lang/en.json', () => {
  it('resolves every DICER.Appearance key the editor and its template use', () => {
    expect(duplicateKeys()).toEqual([]);
    const lang = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Appearance;
    const keys = usedKeys('Appearance', ['src/ui/appearance-editor.js', 'templates/appearance-editor.hbs'], {
      'BodyType.': ['opaque', 'resin', 'metal', 'marble', 'pearl'],
      'Finish.': ['polished', 'brushed', 'antique'],
      'InsideType.': ['none', 'liquid', 'glitter', 'swirl', 'nebula', 'shape'],
      'Shape.': ['star', 'heart', 'skull', 'sphere'],
      'Fill.': ['paint', 'gold', 'silver', 'enamel'],
      'FontKind.': ['serif', 'sans', 'css', 'file'],
      'Edge.': ['sharp', 'crisp', 'soft', 'round', 'veryRound'],
    });
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect(typeof resolve(lang, k), `DICER.Appearance.${k}`).toBe('string');
    // dynamic keys built from lists
    for (const [group, ids] of Object.entries({
      BodyType: ['opaque', 'resin', 'metal', 'marble', 'pearl'],
      Section: ['body', 'inside', 'numbers', 'edges', 'glow', 'perType', 'extras'],
    }))
      for (const id of ids) expect(typeof lang[group][id], `${group}.${id}`).toBe('string');
  });
  it('has the appearanceEditor menu keys', () => {
    const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Settings.appearanceEditor;
    expect(Object.keys(en).sort()).toEqual(['Hint', 'Label', 'Name']);
  });
});

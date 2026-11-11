/** Module-load hook wiring of src/main.js (the parts that need no engine). */
let hooks;

beforeAll(async () => {
  hooks = { on: [], once: [] };
  globalThis.Hooks = {
    on: (name, fn) => hooks.on.push([name, fn]),
    once: (name, fn) => hooks.once.push([name, fn]),
    callAll: () => {},
  };
  await import('../../src/main.js');
});

afterAll(() => {
  delete globalThis.Hooks;
  delete globalThis.game;
});

const chatCommandsListener = () => hooks.on.find(([n]) => n === 'chatCommandsReady')?.[1];

test('chatCommandsReady is registered at module load, before init runs', () => {
  expect(chatCommandsListener()).toBeTypeOf('function');
  expect(hooks.once.map(([n]) => n)).toContain('init');
});

test('it registers /dice3d, /d3d and /dsn when Dice So Nice is not active', () => {
  globalThis.game = { modules: new Map(), i18n: { localize: (k) => k } };
  const register = vi.fn();
  chatCommandsListener()({ register });
  expect(register.mock.calls.map(([c]) => c.name)).toEqual(['/dice3d', '/d3d', '/dsn']);
});

test('it registers nothing while Dice So Nice is active (dormant), even before init', () => {
  globalThis.game = {
    modules: new Map([['dice-so-nice', { active: true }]]),
    i18n: { localize: (k) => k },
  };
  const register = vi.fn();
  chatCommandsListener()({ register });
  expect(register).not.toHaveBeenCalled();
});

describe('soundSurface', () => {
  test("the client's override wins over the world surface; 'world' falls back to it", async () => {
    const { soundSurface } = await import('../../src/main.js');
    const get = (o) => (k) => o[k];
    expect(soundSurface(get({ soundSurface: 'stone', soundSurfaceOverride: 'wood' }))).toBe('wood');
    expect(soundSurface(get({ soundSurface: 'stone', soundSurfaceOverride: 'world' }))).toBe('stone');
    expect(soundSurface(get({}))).toBe('felt');
  });
});

describe('preloadEditors', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('schedules both editor imports in an idle callback, not immediately', async () => {
    const { preloadEditors } = await import('../../src/main.js');
    let idle;
    vi.stubGlobal('requestIdleCallback', (cb) => (idle = cb));
    const a = vi.fn(async () => ({}));
    const b = vi.fn(async () => ({}));
    preloadEditors([a, b]);
    expect(a).not.toHaveBeenCalled();
    idle();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  test('a failing import is swallowed and the next one still loads', async () => {
    const { preloadEditors } = await import('../../src/main.js');
    let idle;
    vi.stubGlobal('requestIdleCallback', (cb) => (idle = cb));
    const b = vi.fn(async () => ({}));
    preloadEditors([() => Promise.reject(new Error('x')), () => { throw new Error('y'); }, b]);
    expect(() => idle()).not.toThrow();
    expect(b).toHaveBeenCalled();
  });

  test('the ready hook schedules it, and the default loaders name both editor chunks', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/main.js', 'utf8');
    expect(src).toMatch(/preloadEffects\(\);\s*preloadEditors\(\);/);
    expect(src).toContain("import('./ui/trigger-editor.js')");
    expect(src).toContain("import('./ui/damage-map-editor.js')");
  });
});

describe('the Dice look header control on actor sheets', () => {
  const sheet = (isOwner, documentName = 'Actor') => ({ document: { documentName, id: 'a1', isOwner }, actor: { id: 'a1', isOwner } });
  const listener = (name) => hooks.on.find(([n]) => n === name)?.[1];
  const openThemeBrowser = vi.fn();

  beforeAll(() => {
    vi.doMock('../../src/ui/theme-browser.js', () => ({ openThemeBrowser }));
  });
  beforeEach(() => {
    openThemeBrowser.mockClear();
    globalThis.game = { modules: new Map(), i18n: { localize: (k) => k } };
  });

  test('both header hooks are registered at module load (v14 ApplicationV2 sheets and legacy v1 sheets)', () => {
    expect(listener('getHeaderControlsApplicationV2')).toBeTypeOf('function');
    expect(listener('getActorSheetHeaderButtons')).toBeTypeOf('function');
  });

  test('an owned actor sheet gets a Dice look control, labelled and with the d20 icon', () => {
    const controls = [{ action: 'configure' }];
    listener('getHeaderControlsApplicationV2')(sheet(true), controls);
    expect(controls).toHaveLength(2);
    expect(controls[1]).toMatchObject({ icon: 'fa-solid fa-dice-d20', label: 'DICER.ThemeBrowser.DiceLook' });
  });

  test('an unowned actor sheet, and a sheet of another document type, get nothing', () => {
    const a = [];
    listener('getHeaderControlsApplicationV2')(sheet(false), a);
    listener('getHeaderControlsApplicationV2')(sheet(true, 'Item'), a);
    listener('getHeaderControlsApplicationV2')({}, a);
    expect(a).toEqual([]);
    const b = [];
    listener('getActorSheetHeaderButtons')(sheet(false), b);
    expect(b).toEqual([]);
  });

  test('clicking it opens the theme browser on that actor (lazy import)', async () => {
    const controls = [];
    listener('getHeaderControlsApplicationV2')(sheet(true), controls);
    await controls[0].onClick();
    await vi.waitFor(() => expect(openThemeBrowser).toHaveBeenCalledWith({ target: 'actor:a1' }));
  });

  test('the legacy v1 hook adds the same control as a header button', async () => {
    const buttons = [];
    listener('getActorSheetHeaderButtons')(sheet(true), buttons);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatchObject({ class: 'dicer-dice-look', icon: 'fa-solid fa-dice-d20', label: 'DICER.ThemeBrowser.DiceLook' });
    await buttons[0].onclick();
    await vi.waitFor(() => expect(openThemeBrowser).toHaveBeenCalledWith({ target: 'actor:a1' }));
  });

  test('it is added once even if the hook fires twice, and not while Dice So Nice is active', () => {
    const controls = [];
    listener('getHeaderControlsApplicationV2')(sheet(true), controls);
    listener('getHeaderControlsApplicationV2')(sheet(true), controls);
    expect(controls).toHaveLength(1);
    globalThis.game.modules = new Map([['dice-so-nice', { active: true }]]);
    const other = [];
    listener('getHeaderControlsApplicationV2')(sheet(true), other);
    expect(other).toEqual([]);
  });
});

describe('the Dice look button setting, guards and v1 dedupe', () => {
  const sheet = () => ({ document: { documentName: 'Actor', id: 'a1', isOwner: true } });
  const listener = (name) => hooks.on.find(([n]) => n === name)?.[1];
  const withSetting = (value) => {
    globalThis.game = { modules: new Map(), i18n: { localize: (k) => k }, settings: { get: (ns, k) => (k === 'diceLookButton' ? value : undefined) } };
  };

  test('present when the setting is on, absent when off (both hooks)', () => {
    withSetting(true);
    const on = [];
    const onV1 = [];
    listener('getHeaderControlsApplicationV2')(sheet(), on);
    listener('getActorSheetHeaderButtons')(sheet(), onV1);
    expect([on.length, onV1.length]).toEqual([1, 1]);
    withSetting(false);
    const off = [];
    const offV1 = [];
    listener('getHeaderControlsApplicationV2')(sheet(), off);
    listener('getActorSheetHeaderButtons')(sheet(), offV1);
    expect([off.length, offV1.length]).toEqual([0, 0]);
  });

  test('the v1 button is added once, and not while Dice So Nice is active', () => {
    withSetting(true);
    const buttons = [];
    listener('getActorSheetHeaderButtons')(sheet(), buttons);
    listener('getActorSheetHeaderButtons')(sheet(), buttons);
    expect(buttons).toHaveLength(1);
    globalThis.game.modules = new Map([['dice-so-nice', { active: true }]]);
    const other = [];
    listener('getActorSheetHeaderButtons')(sheet(), other);
    expect(other).toEqual([]);
  });

  test('a failure inside the handlers is swallowed (warned once), never thrown into Foundry', () => {
    withSetting(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = { get document() { throw new Error('boom'); } };
    expect(() => listener('getHeaderControlsApplicationV2')(bad, [])).not.toThrow();
    expect(() => listener('getActorSheetHeaderButtons')(bad, [])).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('engine start failure: the appearance re-warm', () => {
  test('its pending timer is cancelled and its updateUser hook removed', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/main.js', 'utf8');
    const failed = src.slice(src.indexOf('if (!started) {'), src.indexOf('announceReady({'));
    expect(failed).toContain('appearanceRewarm.dispose()');
    expect(failed).toMatch(/Hooks\.off\('updateUser'/);
  });
});

describe('engine start failure (M-8)', () => {
  test('the font layer is disposed with the rest when the engine cannot start', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/main.js', 'utf8');
    const failed = src.slice(src.indexOf('if (!started) {'), src.indexOf('announceReady({'));
    expect(failed).toMatch(/fontAtlases\?\.dispose\(\);[^\n]*\n\s*fontAtlases = null;/);
  });
});

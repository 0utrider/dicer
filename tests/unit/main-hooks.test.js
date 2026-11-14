// @vitest-environment jsdom
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

test('an engine (re)creation releases the old pet layer, then requests one for the new scene', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('src/main.js', 'utf8').replace(/\r\n/g, '\n');
  expect(src).toMatch(/releasePets\(\);[^\n]*\n\s*effectLayer = createEffectLayer\(/);
  expect(src).toMatch(/petDeps = \{\s*scene: renderer\.scene,[\s\S]*?\};\s*preloadPets\(\);/);
  // preloadPets requests with the current deps and honours both switches
  expect(src).toMatch(/function preloadPets\(\) \{\s*if \(!petDeps \|\| getSetting\('petsAllowed'\) === false \|\| getSetting\('showPets'\) === false\) return;\s*const run = \(\) => petDeps && requestPets\(petDeps\);/);
});

test('pet layer wiring: wake dep, userConnected disconnect -> userGone, settings wake the box', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('src/main.js', 'utf8').replace(/\r\n/g, '\n');
  expect(src).toMatch(/petDeps = \{[\s\S]*?wake: \(\) => box\?\.wake\(\),[\s\S]*?\};\s*preloadPets\(\);/);
  expect(src).toMatch(
    /Hooks\.on\('userConnected', \(user, connected\) => \{\s*if \(!connected\) getPets\(\)\?\.userGone\?\.\(user\.id\);\s*\}\);/,
  );
  expect(src).toMatch(/onPetStayChange: \(\) => diceBox\?\.wake\(\)/);
  // the old petsStay=false moves to petStay 0 once, on ready
  expect(src).toMatch(/migratePetStay\(game\.settings\.storage\.get\('client'\), \(k, v\) => game\.settings\.set\('dicer', k, v\)\)/);
  // the area change reaches the hook from DiceBox.onResize, which main's resize path calls
  const box = readFileSync('src/throw/dice-box.js', 'utf8');
  expect(box).toMatch(/areaChanged/);
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
    expect(src).toMatch(/preloadEffects\(\);\s*preloadPets\(\);\s*preloadEditors\(\);/);
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

describe('rolling by hand: the chat card mark', () => {
  const listener = () => hooks.on.find(([n]) => n === 'renderChatMessageHTML')?.[1];
  const card = () => {
    const li = document.createElement('li');
    li.innerHTML =
      '<header class="message-header"><h4 class="message-sender">A</h4><span class="message-metadata"><time class="message-timestamp">now</time></span></header><div class="message-content"></div>';
    return li;
  };
  const roll = (dicerHand) => ({ options: dicerHand ? { dicerHand } : {} });
  const marks = (html) => [...html.querySelectorAll('.dicer-card-mark')];

  beforeEach(() => {
    globalThis.game = {
      modules: new Map(),
      i18n: {
        localize: (k) => k,
        format: (k, d) => `${k}|${JSON.stringify(d)}`,
      },
    };
  });

  test('markFor: hand, partial, fallback, no throw and normal rolls', async () => {
    const { markFor } = await import('../../src/hand/gate-hand.js');
    expect(markFor(roll({ id: 'a', by: 'u', n: 2 }))).toEqual({ icon: 'fa-hand', tip: 'DICER.Hand.Mark' });
    expect(markFor(roll({ id: 'a', by: 'u', n: 2, partial: 3 }))).toEqual({
      icon: 'fa-hand',
      tip: 'DICER.Hand.MarkPartial|{"n":3}',
    });
    for (const fallback of ['timeout', 'cancel', 'auto']) {
      expect(markFor(roll({ id: 'a', by: 'u', n: 2, fallback }))).toEqual({ icon: 'fa-hand', tip: 'DICER.Hand.MarkAuto' });
    }
    // nothing thrown (every die dropped): automatic, even with a partial count
    expect(markFor(roll({ id: 'a', by: 'u', n: 0, partial: 2 })).tip).toBe('DICER.Hand.MarkAuto');
    expect(markFor(roll())).toBeNull();
    // a follow-up thrown automatically after a hand throw (unless a fallback or partial)
    expect(markFor(roll({ id: 'a', by: 'u', n: 1, follow: true })).tip).toBe('DICER.Hand.MarkFollow');
    expect(markFor(roll({ id: 'a', by: 'u', n: 1, follow: true, fallback: 'timeout' })).tip).toBe('DICER.Hand.MarkAuto');
    // a forged flag never puts markup into the tooltip: only a number, or no count at all
    expect(markFor(roll({ id: 'a', by: 'u', n: 2, partial: '<img src=x onerror=alert(1)>' })).tip).toBe('DICER.Hand.Mark');
    expect(markFor(roll({ id: 'a', by: 'u', n: 2, partial: '2.7' })).tip).toBe('DICER.Hand.MarkPartial|{"n":2}');
    expect(markFor(roll({ id: 'a', by: 'u', n: 2, partial: { toString: () => '<b>' } })).tip).toBe('DICER.Hand.Mark');
    expect(markFor(null)).toBeNull();
    expect(markFor({ options: {} })).toBeNull();
    const en = JSON.parse((await import('node:fs')).readFileSync('lang/en.json', 'utf8')).DICER.Hand;
    expect([en.Mark, en.MarkPartial, en.MarkAuto]).toEqual([
      'Rolled by hand',
      'Rolled by hand ({n} dice rolled automatically)',
      'Rolled automatically (no throw)',
    ]);
  });

  test('the card mark for hand / partial / fallback / normal rolls, once per render', () => {
    expect(listener()).toBeTypeOf('function');
    const cases = [
      [[roll({ id: 'a', by: 'u', n: 1 })], 'DICER.Hand.Mark'],
      [[roll({ id: 'a', by: 'u', n: 3, partial: 1 })], 'DICER.Hand.MarkPartial|{"n":1}'],
      [[roll({ id: 'a', by: 'u', n: 1, fallback: 'timeout' })], 'DICER.Hand.MarkAuto'],
      // several hand rolls on one card: one mark, each different note once
      [
        [roll({ id: 'a', by: 'u', n: 1 }), roll(), roll({ id: 'b', by: 'u', n: 1, fallback: 'cancel' }), roll({ id: 'c', by: 'u', n: 2 })],
        'DICER.Hand.Mark; DICER.Hand.MarkAuto',
      ],
    ];
    for (const [rolls, tip] of cases) {
      const html = card();
      listener()({ rolls }, html);
      listener()({ rolls }, html); // a second call on the same element adds nothing
      expect(marks(html)).toHaveLength(1);
      const [mark] = marks(html);
      expect(mark.dataset.tooltip).toBe(tip);
      expect(mark.getAttribute('aria-label')).toBe(tip);
      expect(mark.className).toContain('fa-hand');
      expect(mark.parentElement.className).toBe('message-metadata');
    }
    // a normal roll card, a card without rolls or header: nothing, never a throw
    for (const m of [{ rolls: [roll()] }, {}, { rolls: [null] }]) {
      const html = card();
      listener()(m, html);
      expect(marks(html)).toEqual([]);
    }
    expect(() => listener()({ rolls: [roll({ id: 'a', by: 'u', n: 1 })] }, null)).not.toThrow();
    expect(() => listener()({ rolls: [roll({ id: 'a', by: 'u', n: 1 })] }, document.createElement('li'))).not.toThrow();
  });
});

describe('rolling by hand: the Dice tray scene control', () => {
  const listener = () => hooks.on.find(([n]) => n === 'getSceneControlButtons')?.[1];
  const withSettings = (s, user = { id: 'u1', role: 1, isGM: false }) => {
    globalThis.game = {
      modules: new Map(),
      i18n: { localize: (k) => k },
      user,
      settings: { get: (ns, k) => s[k] },
    };
  };
  const controls = () => ({ tokens: { name: 'tokens', tools: { select: { name: 'select' } } } });

  test('the tray tool appears only when diceTray and allowed', () => {
    expect(listener()).toBeTypeOf('function');
    withSettings({ diceTray: true, handRollsAllowed: 'all' });
    const on = controls();
    listener()(on);
    expect(on.tokens.tools.dicerTray).toMatchObject({
      name: 'dicerTray',
      title: 'DICER.Tray.Title',
      icon: 'fa-solid fa-dice',
      button: true,
    });
    expect(on.tokens.tools.dicerTray.onChange).toBeTypeOf('function');
    expect(Object.keys(on.tokens.tools)).toEqual(['select', 'dicerTray']);
    // the client switch off
    withSettings({ diceTray: false, handRollsAllowed: 'all' });
    const off = controls();
    listener()(off);
    expect(off.tokens.tools.dicerTray).toBeUndefined();
    // not allowed: a player under 'trusted' / 'gm' / 'none'; a GM under 'gm'
    for (const allowed of ['trusted', 'gm', 'none']) {
      withSettings({ diceTray: true, handRollsAllowed: allowed });
      const c = controls();
      listener()(c);
      expect(c.tokens.tools.dicerTray).toBeUndefined();
    }
    withSettings({ diceTray: true, handRollsAllowed: 'gm' }, { id: 'g', role: 4, isGM: true });
    const gm = controls();
    listener()(gm);
    expect(gm.tokens.tools.dicerTray).toBeDefined();
  });

  test('no token controls, or unregistered settings (Dice So Nice active): nothing, never a throw', () => {
    withSettings({ diceTray: true, handRollsAllowed: 'all' });
    expect(() => listener()({})).not.toThrow();
    globalThis.game.settings.get = () => {
      throw new Error('not registered');
    };
    const c = controls();
    expect(() => listener()(c)).not.toThrow();
    expect(c.tokens.tools.dicerTray).toBeUndefined();
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

describe('pet settings', () => {
  test('a petsAllowed or showPets change wakes the box, so resting pets leave', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/main.js', 'utf8');
    expect(src).toMatch(/onPetChange: \(\) => \(preloadPets\(\), diceBox\?\.wake\(\)\)/);
  });
});

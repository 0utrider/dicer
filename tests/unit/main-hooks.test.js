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

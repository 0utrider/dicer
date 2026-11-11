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

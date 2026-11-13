import {
  registerHandMethod,
  handAllowed,
  syncDiceConfiguration,
  dicerResolver,
  setHandDeps,
  HAND_DICE,
} from '../../src/hand/shell.js';
import { _setHandImport } from '../../src/hand/hand-loader.js';

const RESOLVERS = new Map();

/** Foundry's RollResolver as far as the shell relies on it (close is safe unrendered). */
class FakeBase {
  constructor(roll) {
    this.roll = roll;
    this.rendered = false;
  }
  async awaitFulfillment() {
    return 'base-await';
  }
  async addTerm() {
    return 'base-add';
  }
  async resolveResult() {
    return 'base-resolve';
  }
  async close() {
    if (this.rendered) throw new Error('only unrendered here');
    RESOLVERS.delete(this.roll);
    return this;
  }
}

afterEach(() => {
  delete globalThis.CONFIG;
  _setHandImport(() => import('../../src/hand/hand.js'));
});

test('the method is registered with the resolver', () => {
  globalThis.CONFIG = { Dice: { fulfillment: { methods: { manual: { interactive: true } } } } };
  registerHandMethod(FakeBase);
  const m = globalThis.CONFIG.Dice.fulfillment.methods.dicer;
  expect(m).toMatchObject({
    label: 'DICER.Hand.Method',
    icon: '<i class="fa-solid fa-hand"></i>',
    interactive: true,
  });
  expect(m.resolver).toBe(dicerResolver(FakeBase));
  expect(Object.getPrototypeOf(m.resolver)).toBe(FakeBase);
  expect(globalThis.CONFIG.Dice.fulfillment.methods.manual).toEqual({ interactive: true });
});

test('main.js registers at init, syncs at ready and on the hand settings, and injects the deps', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('src/main.js', 'utf8').replace(/\r\n/g, '\n');
  const init = src.slice(src.indexOf("Hooks.once('init'"), src.indexOf("Hooks.once('ready'"));
  // re-syncs, and re-prepares the scene controls (the Dice tray tool follows handRollsAllowed)
  expect(init).toContain('onHandChange: () => (syncHand(), ui.controls.render({ reset: true })),');
  expect(init).toContain('registerHandMethod();');
  const ready = src.slice(src.indexOf("Hooks.once('ready'"));
  expect(ready).toContain('syncHand();');
  expect(ready).toMatch(/setHandDeps\(\{\s*diceBox: box,\s*areas,\s*decorateFor,\s*plan,/);
  expect(ready).toContain('setHandDeps(null);');
  expect(src).toContain("const getCore = () => game.settings.get('core', 'diceConfiguration');");
});

describe('handAllowed', () => {
  const user = (role, isGM = role >= 3) => ({ role, isGM });
  const get = (v) => (k) => (k === 'handRollsAllowed' ? v : undefined);
  test.each([
    ['all', 1, true],
    ['trusted', 1, false],
    ['trusted', 2, true],
    ['gm', 2, false],
    ['gm', 4, true],
    ['none', 4, false],
  ])('%s, role %i -> %s', (v, role, out) => expect(handAllowed(user(role), get(v))).toBe(out));
  test('an unreadable setting is the default (all); no user is never allowed', () => {
    expect(
      handAllowed(user(1), () => {
        throw new Error('unregistered');
      }),
    ).toBe(true);
    expect(handAllowed(null, get('all'))).toBe(false);
  });
});

describe('syncDiceConfiguration', async () => {
  const run = async (settings, core, user = { role: 1, isGM: false }) => {
    const setCore = vi.fn(async () => {});
    const get = (k) => settings[k];
    await syncDiceConfiguration({ getSetting: get, user, getCore: () => core, setCore });
    return setCore;
  };
  const on = { handRolls: 'always', handRollTypes: [], handRollsAllowed: 'all', handRollsRequired: false };

  test('writes/removes only dicer entries; honours handRollTypes, allowed, required, default', async () => {
    // all types: every per-die denomination plus default
    let set = await run(on, {});
    expect(set.mock.calls[0][0]).toEqual(Object.fromEntries([...HAND_DICE, 'default'].map((k) => [k, 'dicer'])));
    expect(HAND_DICE).toEqual(['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'c', 'f']);
    // another method keeps its entries (default included); '' counts as free
    set = await run(on, { d20: 'manual', default: 'bluetooth', d6: '' });
    expect(set.mock.calls[0][0]).toMatchObject({ d20: 'manual', default: 'bluetooth', d6: 'dicer', d4: 'dicer' });
    // chosen types only: no default, stale dicer entries removed
    set = await run({ ...on, handRollTypes: ['d20', 'f'] }, { d6: 'dicer', default: 'dicer', d8: 'manual' });
    expect(set.mock.calls[0][0]).toEqual({ d20: 'dicer', f: 'dicer', d8: 'manual' });
    // off: only dicer entries go
    set = await run({ ...on, handRolls: 'off' }, { d6: 'dicer', d8: 'manual', default: 'dicer', d4: '' });
    expect(set.mock.calls[0][0]).toEqual({ d8: 'manual', d4: '' });
    // not allowed: removed even when on
    set = await run({ ...on, handRollsAllowed: 'gm' }, { d6: 'dicer' });
    expect(set.mock.calls[0][0]).toEqual({});
    // required forces it for allowed users even with handRolls off, over another method per die
    set = await run({ ...on, handRolls: 'off', handRollsRequired: true }, { d20: 'manual', default: 'manual' });
    expect(set.mock.calls[0][0]).toMatchObject({ d20: 'dicer', d6: 'dicer', default: 'manual' });
    // required but not allowed: nothing of Dicer's
    set = await run({ ...on, handRollsRequired: true, handRollsAllowed: 'none' }, { d6: 'dicer' });
    expect(set.mock.calls[0][0]).toEqual({});
    // nothing changes: no write
    set = await run({ ...on, handRollTypes: ['d6'] }, { d6: 'dicer' });
    expect(set).not.toHaveBeenCalled();
    set = await run({ ...on, handRolls: 'off' }, null);
    expect(set).not.toHaveBeenCalled();
  });

  test('required stashes the entries it takes from another method and restores them when it ends', async () => {
    const store = { ...on, handRollTypes: ['d20', 'd6'], handRollsRequired: true, handRollStash: {} };
    let core = { d20: 'manual', d8: 'manual' };
    const sync = () =>
      syncDiceConfiguration({
        getSetting: (k) => store[k],
        user: { role: 1 },
        getCore: () => core,
        setCore: (v) => (core = v),
        setSetting: (k, v) => (store[k] = v),
      });
    await sync();
    expect(core).toEqual({ d20: 'dicer', d6: 'dicer', d8: 'manual' });
    expect(store.handRollStash).toEqual({ d20: 'manual' });
    await sync(); // idempotent
    expect(core).toEqual({ d20: 'dicer', d6: 'dicer', d8: 'manual' });
    expect(store.handRollStash).toEqual({ d20: 'manual' });
    store.handRollsRequired = false; // still on by the user's own choice: d20 is manual's again
    await sync();
    expect(core).toEqual({ d20: 'manual', d6: 'dicer', d8: 'manual' });
    expect(store.handRollStash).toEqual({});
    store.handRollsRequired = true;
    await sync();
    store.handRolls = 'off';
    store.handRollsAllowed = 'none'; // required, but no longer allowed
    await sync();
    expect(core).toEqual({ d20: 'manual', d8: 'manual' });
    expect(store.handRollStash).toEqual({});
  });

  test('the gate: an "off" world never loads the chunk; a dicer entry, a stash or an allowed "on" does', async () => {
    const load = vi.fn(() => import('../../src/hand/hand.js'));
    _setHandImport(load);
    const setCore = vi.fn();
    const sync = (settings, core) =>
      syncDiceConfiguration({ getSetting: (k) => settings[k], user: { role: 1 }, getCore: () => core, setCore });
    await sync({ ...on, handRolls: 'off' }, { d20: 'manual' });
    await sync({ ...on, handRollsRequired: true, handRollsAllowed: 'none' }, {});
    await sync({ ...on, handRollsAllowed: 'trusted' }, null);
    expect(load).not.toHaveBeenCalled();
    expect(setCore).not.toHaveBeenCalled();
    await sync({ ...on, handRolls: 'off' }, { d6: 'dicer' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(setCore).toHaveBeenLastCalledWith({});
    await sync({ ...on, handRolls: 'off', handRollStash: { d20: 'manual' } }, { d20: 'dicer' });
    expect(setCore).toHaveBeenLastCalledWith({ d20: 'manual' });
    await sync(on, {});
    expect(setCore).toHaveBeenCalledTimes(3);
  });

  test('a failed stash write rejects before the configuration is written (nothing lost)', async () => {
    const setCore = vi.fn();
    const store = { ...on, handRollTypes: ['d20'], handRollsRequired: true, handRollStash: {} };
    await expect(
      syncDiceConfiguration({
        getSetting: (k) => store[k],
        user: { role: 1 },
        getCore: () => ({ d20: 'manual' }),
        setCore,
        setSetting: async () => {
          throw new Error('storage full');
        },
      }),
    ).rejects.toThrow('storage full');
    expect(setCore).not.toHaveBeenCalled();
  });

  test('another interactive method (not manual) configured: nothing mapped, one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.CONFIG = { Dice: { fulfillment: { methods: { manual: { interactive: true }, bt: { interactive: true }, mersenne: {} } } } };
    let set = await run(on, { d20: 'bt', d6: 'dicer' });
    expect(set.mock.calls[0][0]).toEqual({ d20: 'bt' });
    set = await run(on, { d20: 'bt' });
    expect(set).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    // manual and non-interactive methods do not block it
    set = await run(on, { d20: 'manual', d8: 'mersenne' });
    expect(set.mock.calls[0][0]).toMatchObject({ d20: 'manual', d8: 'mersenne', d6: 'dicer' });
    warn.mockRestore();
  });
});

describe('DicerResolver (shell)', () => {
  const chunk = () => ({
    handFor: () => {},
    fulfill: vi.fn(async () => 'f'),
    fulfillTerm: vi.fn(async () => 't'),
    extraResult: vi.fn(async () => 4),
  });

  test('delegates to the chunk; the deps travel on the resolver; _base reaches the base class', async () => {
    const m = chunk();
    _setHandImport(async () => m);
    const deps = { diceBox: {} };
    setHandDeps(deps);
    const R = dicerResolver(FakeBase);
    const r = new R({ id: 1 });
    await r.awaitFulfillment();
    expect(m.fulfill).toHaveBeenCalledWith(r);
    expect(r.dicer).toBe(deps);
    const term = {};
    expect(await r.addTerm(term)).toBe('t');
    expect(m.fulfillTerm).toHaveBeenCalledWith(r, term);
    expect(await r.resolveResult(term, 'dicer', { explode: true })).toBe(4);
    expect(m.extraResult).toHaveBeenCalledWith(r, term, 'dicer', { explode: true });
    expect(await r._base('resolveResult', term, 'manual', {})).toBe('base-resolve');
    expect(await r._base('addTerm', term)).toBe('base-add');
  });

  test('close() unrendered resolves the pending promise', async () => {
    const m = chunk();
    let abort;
    m.fulfill = vi.fn((r) => new Promise((res) => (abort = r._abort = vi.fn(res)))); // a throw in progress
    _setHandImport(async () => m);
    const R = dicerResolver(FakeBase);
    const roll = { id: 2 };
    const r = new R(roll);
    RESOLVERS.set(roll, r);
    let done = false;
    const p = r.awaitFulfillment().then(() => (done = true));
    await new Promise((res) => setTimeout(res, 0));
    expect(done).toBe(false);
    await r.close();
    await p;
    expect(done).toBe(true);
    expect(r._closed).toBe(true);
    expect(abort).toHaveBeenCalled();
    expect(RESOLVERS.has(roll)).toBe(false);
  });

  test('never rejects: a throwing chunk resolves undefined, and close() still clears RESOLVERS', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boom = () => {
      throw new Error('bug');
    };
    _setHandImport(async () => ({ handFor: () => {}, fulfill: boom, fulfillTerm: async () => boom(), extraResult: boom }));
    const R = dicerResolver(FakeBase);
    const roll = { id: 3 };
    const r = new R(roll);
    RESOLVERS.set(roll, r);
    await expect(r.awaitFulfillment()).resolves.toBeUndefined();
    await expect(r.addTerm({})).resolves.toBeUndefined();
    await expect(r.resolveResult({}, 'dicer', {})).resolves.toBeUndefined();
    await r.close();
    expect(RESOLVERS.has(roll)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('a failed chunk import never hangs: no fulfilment, no extra result', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    _setHandImport(() => Promise.reject(new Error('offline')));
    const R = dicerResolver(FakeBase);
    const r = new R({});
    await expect(r.awaitFulfillment()).resolves.toBeUndefined();
    await expect(r.resolveResult({}, 'dicer', {})).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});

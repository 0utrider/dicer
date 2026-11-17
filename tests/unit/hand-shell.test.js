import {
  registerHandMethod,
  handAllowed,
  syncDiceConfiguration,
  dicerResolver,
  setHandDeps,
  HAND_DICE,
} from '../../src/hand/shell.js';
import { patchResolverChoice } from '../../src/hand/chunk/config.js';
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
  expect(init).toContain('onHandChange: () => (syncHand(), resetControls()),');
  expect(init).toContain('registerHandMethod();');
  const ready = src.slice(src.indexOf("Hooks.once('ready'"));
  expect(ready).toContain('syncHand();');
  // hand throws land in the dice tray too: the areas the hand gets go through areaFor
  expect(ready).toMatch(/setHandDeps\(\{\s*diceBox: box,[^}]*areas: \{ \.\.\.areas, rectFor: areaFor \},\s*decorateFor,\s*plan,/);
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
    // chosen types only: no default, stale entries Dicer wrote removed
    set = await run(
      { ...on, handRollTypes: ['d20', 'f'], handRollMapped: ['d6', 'default'] },
      { d6: 'dicer', default: 'dicer', d8: 'manual' },
    );
    expect(set.mock.calls[0][0]).toEqual({ d20: 'dicer', f: 'dicer', d8: 'manual' });
    // off: only the dicer entries Dicer wrote go
    set = await run(
      { ...on, handRolls: 'off', handRollMapped: ['d6', 'default'] },
      { d6: 'dicer', d8: 'manual', default: 'dicer', d4: '' },
    );
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
    await sync({ ...on, handRolls: 'off', handRollMapped: ['d6'] }, { d6: 'dicer' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(setCore).toHaveBeenLastCalledWith({});
    await sync({ ...on, handRolls: 'off', handRollStash: { d20: 'manual' } }, { d20: 'dicer' });
    expect(setCore).toHaveBeenLastCalledWith({ d20: 'manual' });
    await sync(on, {});
    expect(setCore).toHaveBeenCalledTimes(3);
  });

  describe("I2: Foundry's Configure Dice is the per-die choice", () => {
    /** A client: the stored settings (handRollMapped written through setSetting) and the core config. */
    const client = (settings, core) => {
      const c = { store: { ...on, handRollStash: {}, ...settings }, core };
      c.sync = () =>
        syncDiceConfiguration({
          getSetting: (k) => c.store[k],
          user: { role: 1 },
          getCore: () => c.core,
          setCore: (v) => (c.core = v),
          setSetting: (k, v) => (c.store[k] = v),
        });
      return c;
    };
    const ALL = [...HAND_DICE, 'default'];

    test('Dicer records the entries it writes, and removes only those when hand rolls turn off', async () => {
      const c = client({}, { d8: 'manual' });
      await c.sync();
      expect(c.core).toEqual({ ...Object.fromEntries(ALL.map((k) => [k, 'dicer'])), d8: 'manual' });
      expect([...c.store.handRollMapped].sort()).toEqual(ALL.filter((k) => k !== 'd8').sort());
      c.store.handRolls = 'off';
      await c.sync();
      expect(c.core).toEqual({ d8: 'manual' });
      expect(c.store.handRollMapped).toEqual([]);
    });

    test('a dicer entry the user picked survives a sync (off, ask, always) and is the type choice', async () => {
      // picked in Foundry's window with Roll by hand off: kept, nothing else mapped
      const c = client({ handRolls: 'off' }, { d20: 'dicer', d6: 'manual' });
      await c.sync();
      expect(c.core).toEqual({ d20: 'dicer', d6: 'manual' });
      // Ask / Always: the user's own pick is the die-type choice (no other die is mapped)
      for (const mode of ['ask', 'always']) {
        c.store.handRolls = mode;
        await c.sync();
        expect(c.core).toEqual({ d20: 'dicer', d6: 'manual' });
        expect(c.store.handRollMapped ?? []).toEqual([]);
      }
      // turning it off again keeps the user's pick
      c.store.handRolls = 'off';
      await c.sync();
      expect(c.core).toEqual({ d20: 'dicer', d6: 'manual' });
    });

    test('after Always mapped every die, a die set back in Foundry\'s window stays as the user set it', async () => {
      const c = client({}, {});
      await c.sync();
      c.core = { ...c.core, d6: '', d8: 'manual' }; // the user's Configure Dice submission
      await c.sync();
      expect(c.core).toMatchObject({ d6: '', d8: 'manual', d20: 'dicer', d4: 'dicer' });
      expect(c.store.handRollMapped).not.toContain('d6');
      expect(c.store.handRollMapped).not.toContain('d8');
      c.store.handRolls = 'off'; // Dicer's own entries go; the user's choices stay
      await c.sync();
      expect(c.core).toEqual({ d6: '', d8: 'manual' });
    });

    test('a user pick next to Dicer-written entries: both kept while on; off removes only Dicer\'s', async () => {
      const c = client({ handRollMapped: ['d4'] }, { d4: 'dicer', d20: 'dicer' });
      await c.sync();
      expect(c.core).toEqual({ d4: 'dicer', d20: 'dicer' });
      expect(c.store.handRollMapped).toEqual(['d4']);
      c.store.handRolls = 'off';
      await c.sync();
      expect(c.core).toEqual({ d20: 'dicer' });
    });

    test('handRollTypes still limits what Dicer maps; Require still maps every die over the user', async () => {
      const c = client({ handRollTypes: ['d20'] }, { d6: 'dicer' });
      await c.sync();
      expect(c.core).toEqual({ d6: 'dicer', d20: 'dicer' }); // d6: the user's, d20: Dicer's
      expect(c.store.handRollMapped).toEqual(['d20']);
      const r = client({ handRolls: 'off', handRollsRequired: true }, { d20: 'dicer', d8: 'manual' });
      await r.sync();
      expect(r.core).toEqual({ ...Object.fromEntries(ALL.map((k) => [k, 'dicer'])) });
      expect(r.store.handRollStash).toEqual({ d8: 'manual' });
      expect(r.store.handRollMapped).not.toContain('d20'); // the user's own: not stashed, not Dicer's
      r.store.handRollsRequired = false; // off again: Dicer's entries go, the stash comes back
      await r.sync();
      expect(r.core).toEqual({ d20: 'dicer', d8: 'manual' });
    });

    test('a user who may not roll by hand (or another interactive method) loses every dicer entry', async () => {
      const c = client({ handRollsAllowed: 'gm' }, { d20: 'dicer' });
      await c.sync();
      expect(c.core).toEqual({});
    });
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

  test('an interactive method without its own resolver (Pixels) keeps its dice; Dicer takes the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.CONFIG = { Dice: { fulfillment: { methods: { manual: { interactive: true }, pixels: { interactive: true } } } } };
    let set = await run(on, { d20: 'pixels' });
    const out = set.mock.calls[0][0];
    expect(out.d20).toBe('pixels');
    expect(out).toMatchObject({ d4: 'dicer', d6: 'dicer', d12: 'dicer', default: 'dicer' });
    // Require never takes a die from it either
    set = await run({ ...on, handRollsRequired: true }, { d20: 'pixels', d8: 'manual' });
    expect(set.mock.calls[0][0]).toMatchObject({ d20: 'pixels', d8: 'dicer', d6: 'dicer' });
    // it holds default: every die is meant for it, nothing is mapped automatically...
    set = await run(on, { default: 'pixels' });
    expect(set).not.toHaveBeenCalled();
    // ...except the dice handRollTypes names
    set = await run({ ...on, handRollTypes: ['d6'] }, { default: 'pixels' });
    expect(set.mock.calls[0][0]).toEqual({ default: 'pixels', d6: 'dicer' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('another interactive method with its own resolver configured: nothing mapped, one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.CONFIG = { Dice: { fulfillment: { methods: { manual: { interactive: true }, bt: { interactive: true, resolver: class {} }, mersenne: {} } } } };
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

describe('patchResolverChoice: Dicer next to Pixels keeps its own resolver', () => {
  const Dicer = class DicerR {};
  const Own = class OwnR {};
  let core;
  const makeRoll = () => {
    const generic = class Generic {};
    function Roll() {}
    Roll.DICE_CONFIGURATION_SETTING = 'diceConfiguration';
    // Foundry's own choice: one interactive method -> its resolver, more -> the generic one
    Roll.resolverImplementation = vi.fn(function () {
      const m = globalThis.CONFIG.Dice.fulfillment.methods;
      const used = new Set(Object.values(core).filter((x) => x && x !== 'manual' && m[x]?.interactive));
      return used.size === 1 ? (m[[...used][0]].resolver ?? generic) : generic;
    });
    Roll.generic = generic;
    return Roll;
  };
  beforeEach(() => {
    globalThis.CONFIG = {
      Dice: {
        fulfillment: {
          methods: {
            manual: { interactive: true },
            dicer: { interactive: true, resolver: Dicer },
            pixels: { interactive: true },
            own: { interactive: true, resolver: Own },
          },
        },
      },
    };
    globalThis.game = { settings: { get: () => core } };
  });
  afterEach(() => delete globalThis.game);

  test('dicer + Pixels (no resolver of its own): the DicerResolver', () => {
    const Roll = makeRoll();
    patchResolverChoice(Roll);
    core = { d20: 'pixels', d6: 'dicer', d8: 'manual' };
    expect(Roll.resolverImplementation({})).toBe(Dicer);
  });

  test('anything else is the choice Foundry makes; patching twice wraps once', () => {
    const Roll = makeRoll();
    patchResolverChoice(Roll);
    const once = Roll.resolverImplementation;
    patchResolverChoice(Roll);
    expect(Roll.resolverImplementation).toBe(once);
    core = { d20: 'own', d6: 'dicer' }; // a method with its own resolver: generic, as Foundry decides
    expect(Roll.resolverImplementation({})).toBe(Roll.generic);
    core = { d20: 'pixels' }; // Pixels alone: Foundry's (generic) form
    expect(Roll.resolverImplementation({})).toBe(Roll.generic);
    core = { d6: 'dicer' };
    expect(Roll.resolverImplementation({})).toBe(Dicer);
  });

  test("Foundry v14's static getter is wrapped, never assigned (assigning it threw and stopped the dice configuration sync)", () => {
    class Roll {
      static DICE_CONFIGURATION_SETTING = 'diceConfiguration';
      static get resolverImplementation() {
        const m = globalThis.CONFIG.Dice.fulfillment.methods;
        const used = new Set(Object.values(core).filter((x) => x && x !== 'manual' && m[x]?.interactive));
        return used.size === 1 ? (m[[...used][0]].resolver ?? Roll.generic) : Roll.generic;
      }
    }
    Roll.generic = class Generic {};
    class DamageRoll extends Roll {} // a system's subclass reads it through the class chain
    expect(() => patchResolverChoice(Roll)).not.toThrow();
    expect(() => patchResolverChoice(Roll)).not.toThrow(); // twice: wraps once
    core = { d20: 'pixels', d6: 'dicer' };
    expect(Roll.resolverImplementation).toBe(Dicer);
    expect(DamageRoll.resolverImplementation).toBe(Dicer);
    core = { d20: 'own', d6: 'dicer' };
    expect(Roll.resolverImplementation).toBe(Roll.generic);
    core = { d6: 'dicer' };
    expect(Roll.resolverImplementation).toBe(Dicer);
  });
});

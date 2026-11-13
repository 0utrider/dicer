/**
 * The resolver body (lazy hand chunk). Foundry's terms, Roll statics and RollResolver base are
 * stubbed as far as Roll#_evaluate / DiceTerm#roll use them (v14 client: dice/roll.mjs,
 * dice/terms/dice.mjs, applications/dice/roll-resolver.mjs); the overlay and DiceBox are fakes.
 */
import { resultOf } from '../../src/core/dice-shapes.js';
import { planThrow } from '../../src/throw/throw-planner.js';

const overlay = vi.hoisted(() => ({ open: null }));
vi.mock('../../src/hand/chunk/overlay.js', () => ({ openThrowOverlay: (o) => overlay.open(o) }));
const unfair = vi.hoisted(() => []);
vi.mock('../../src/hand/unfair.js', () => ({ HAND_UNFAIR: unfair }));

const { fulfill, fulfillTerm, extraResult, handThrows } = await import('../../src/hand/chunk/resolve.js');

// ---- Foundry stubs ----
class DiceTerm {
  static DENOMINATION = '';
  constructor({ number = 1, faces = 6, modifiers = [], minValue = 1 } = {}) {
    Object.assign(this, { number, faces, modifiers, minValue, results: [], options: {} });
  }
  get denomination() {
    return this.constructor.DENOMINATION;
  }
  get minResult() {
    return this.minValue;
  }
  get maxResult() {
    return this.minValue + this.faces - 1;
  }
}
class Die extends DiceTerm {
  static DENOMINATION = 'd';
  get denomination() {
    return `d${this.faces}`;
  }
}
class Coin extends DiceTerm {
  static DENOMINATION = 'c';
  constructor(d = {}) {
    super({ ...d, faces: 2, minValue: 0 });
  }
}
class FateDie extends DiceTerm {
  static DENOMINATION = 'f';
  constructor(d = {}) {
    super({ ...d, faces: 3, minValue: -1 });
  }
}

let config; // the core diceConfiguration
const methodOf = (t) => config[t.denomination] || config.default || '';
const interactive = (m) => !!globalThis.CONFIG.Dice.fulfillment.methods[m]?.interactive;
const FakeRoll = {
  RESOLVERS: new Map(),
  // As Roll.identifyFulfillableTerms (manual allowed).
  identifyFulfillableTerms(terms) {
    const out = [];
    const walk = (list = []) =>
      list.forEach((t) => {
        if (t instanceof DiceTerm && t.number && t.faces && interactive(methodOf(t))) out.push(t);
        if ('dice' in t) walk(t.dice);
      });
    walk(terms);
    return out;
  },
};

const rollOf = (...terms) => ({
  terms,
  get dice() {
    return terms.filter((t) => t instanceof DiceTerm);
  },
  options: {},
  formula: 'formula',
});

/** The shell + Foundry's base class, as far as the chunk calls them. */
class Resolver {
  constructor(roll, deps) {
    this.roll = roll;
    this.dicer = deps;
    this.form = null; // the terms Foundry's form was rendered for
  }
  async _base(name, ...args) {
    if (name === 'awaitFulfillment') {
      // As RollResolver#awaitFulfillment: terms with an _id are skipped.
      const fresh = FakeRoll.identifyFulfillableTerms(this.roll.terms).filter((t) => !t._id);
      fresh.forEach((t) => ((t._id = 'm'), (t.method = methodOf(t))));
      this.form = fresh;
      return undefined;
    }
    if (name === 'addTerm') return void (this.form = [...(this.form ?? []), args[0]]);
    if (name === 'resolveResult') return 5; // the user typed 5
    throw new Error(name);
  }
}

/** Foundry's evaluation after awaitFulfillment: missing dice, then x explosions. */
async function evalTerm(r, t) {
  const m = methodOf(t);
  const one = async (options) => {
    const v = interactive(m) ? await extraResult(r, t, m, options) : undefined;
    t.results.push({ result: v ?? t.minResult, active: true, ...(v === undefined ? { random: true } : {}) });
  };
  for (let n = t.results.length; n < t.number; n++) await one({});
  if (t.modifiers.includes('x')) {
    for (let i = 0; i < t.results.length; i++) {
      if (t.results[i].active && t.results[i].result === t.maxResult) {
        t.results[i].exploded = true;
        await one({ explode: true });
      }
    }
  }
}
async function evaluate(r) {
  await fulfill(r);
  for (const t of r.roll.dice) await evalTerm(r, t);
}
const total = (t) => t.results.reduce((s, x) => s + (x.active ? x.result : 0), 0);

let settings;
let deps;
let shapes; // term -> preset shape (shapeFor)
let boxValues; // DiceBox free throws: values to return, in order
const RECT = { left: 10, top: 20, width: 300, height: 200 };

beforeEach(() => {
  config = { d4: 'dicer', d6: 'dicer', d8: 'dicer', d10: 'dicer', d12: 'dicer', d20: 'dicer', d100: 'dicer', c: 'dicer', f: 'dicer', default: 'dicer' };
  settings = { handRolls: 'always', handRollsAllowed: 'all', handRollsRequired: false, handRollTimeout: 60, maxDice: 20 };
  shapes = new Map();
  boxValues = [];
  let id = 0;
  globalThis.foundry = { dice: { Roll: { defaultImplementation: FakeRoll } }, utils: { randomID: () => `id${++id}` } };
  globalThis.CONFIG = {
    Dice: { fulfillment: { methods: { manual: { interactive: true }, dicer: { interactive: true } }, defaultMethod: '' } },
  };
  FakeRoll.RESOLVERS.clear();
  handThrows.clear();
  unfair.length = 0;
  const diceBox = {
    hand: {}, // the hand chunk is attached
    _getAppearance: () => ({}),
    roll: vi.fn((specs) => ({
      values: Promise.resolve(specs.map((s) => (s.variant === 'd100tens' ? null : boxValues.shift()))),
      handle: {},
      landed: Promise.resolve(),
      finished: Promise.resolve(),
    })),
  };
  deps = {
    diceBox,
    areas: { rectFor: vi.fn(() => RECT) },
    decorateFor: vi.fn(() => undefined),
    plan: (roll, o) => planThrow(roll, { shapeFor: (t) => shapes.get(t) ?? null, ...o }),
    getSetting: (k) => settings[k],
    getCore: () => config,
    hooks: { callAll: vi.fn() },
    user: () => ({ id: 'u1', role: 1, isGM: false }),
    ask: vi.fn(async () => true),
  };
  // The overlay "lands" each die on `faces` (Foundry results, by spec; a d100's tens slot null).
  overlay.open = vi.fn(async ({ specs }) => ({
    values: specs.map((s, i) => overlay.values[i]),
    handle: { h: 1 },
    recording: { rec: 1 },
  }));
  overlay.values = [];
});

afterEach(() => {
  delete globalThis.foundry;
  delete globalThis.CONFIG;
});

test('2d6 + 1d20: term.results filled from overlay values in order', async () => {
  const d6 = new Die({ number: 2, faces: 6 });
  const d20 = new Die({ number: 1, faces: 20 });
  const roll = rollOf(d6, d20);
  const r = new Resolver(roll, deps);
  overlay.values = [3, 5, 17];
  await evaluate(r);
  expect(d6.results).toEqual([
    { result: 3, active: true },
    { result: 5, active: true },
  ]);
  expect(d20.results).toEqual([{ result: 17, active: true }]);
  const { specs, rect, timeoutMs, ghostOnRelease, getRect } = overlay.open.mock.calls[0][0];
  expect(specs.map((s) => [s.type, s.key, s.free, s.shapeType])).toEqual([
    ['d6', '0:0:0', true, 'd6'],
    ['d6', '0:1:0', true, 'd6'],
    ['d20', '1:0:0', true, 'd20'],
  ]);
  expect(rect).toBe(RECT);
  expect(deps.areas.rectFor).toHaveBeenCalledWith({ rollerId: 'u1' });
  expect(getRect()).toBe(RECT);
  expect(timeoutMs).toBe(60000);
  expect(ghostOnRelease).toBe(false);
  // H-15 and the store for Task 8
  const hand = roll.options.dicerHand;
  expect(hand).toEqual({ id: hand.id, by: 'u1', n: 3 });
  expect(handThrows.get(hand.id)).toEqual({ recording: { rec: 1 }, handle: { h: 1 }, specs });
  // Foundry's terms got the method and an id (its form skips them)
  expect([d6.method, d20.method]).toEqual(['dicer', 'dicer']);
  expect(d6._id).toBeTruthy();
  expect(FakeRoll.RESOLVERS.get(roll)).toBe(r);
  expect(r.form).toBeNull(); // no manual terms: Foundry's form never rendered
});

test('d100 combines tens and ones', async () => {
  const d100 = new Die({ number: 1, faces: 100 });
  const r = new Resolver(rollOf(d100), deps);
  overlay.values = [null, 47]; // DiceBox: the tens slot null, the ones slot the combined d100
  await evaluate(r);
  const { specs } = overlay.open.mock.calls[0][0];
  expect(specs.map((s) => [s.type, s.variant, s.key])).toEqual([
    ['d10', 'd100tens', '0:0:0'],
    ['d10', undefined, '0:0:1'],
  ]);
  expect(d100.results).toEqual([{ result: 47, active: true }]);
  expect(r.roll.options.dicerHand.n).toBe(2); // dice in the throw
});

test('dF and c results come from resultOf', async () => {
  const df = new FateDie({ number: 2 });
  const dc = new Coin({ number: 1 });
  const r = new Resolver(rollOf(df, dc), deps);
  // The faces that landed, read through resultOf by DiceBox
  overlay.open = vi.fn(async ({ specs }) => ({
    values: specs.map((s, i) => resultOf([1, 6, 2][i], s.variant)),
    handle: {},
    recording: {},
  }));
  await evaluate(r);
  const { specs } = overlay.open.mock.calls[0][0];
  expect(specs.map((s) => [s.type, s.variant])).toEqual([
    ['d6', 'dF'],
    ['d6', 'dF'],
    ['d2', 'dc'],
  ]);
  expect(df.results).toEqual([
    { result: 1, active: true, success: true },
    { result: -1, active: true, failure: true },
  ]);
  expect(dc.results).toEqual([{ result: 0, active: true }]);
});

test("crystal d4 spec carries shapeType d4crystal from the author's look", async () => {
  const d4 = new Die({ number: 1, faces: 4 });
  const roll = rollOf(d4);
  const look = { shapes: { d4: 'crystal' } };
  deps.decorateFor = vi.fn(() => () => ({ appearance: look, fx: [{ id: 'boom' }], damageType: 'fire' }));
  overlay.values = [2];
  await evaluate(new Resolver(roll, deps));
  expect(deps.decorateFor).toHaveBeenCalledWith(null, roll, 'u1', 'u1');
  const [spec] = overlay.open.mock.calls[0][0].specs;
  expect(spec.shapeType).toBe('d4crystal');
  expect(spec.appearance).toBe(look);
  expect(spec).not.toHaveProperty('fx'); // result-dependent: stripped (look only)
  expect(spec).not.toHaveProperty('damageType');
  expect(spec.value).toBe(1); // the placeholder: the minimum face
  expect(d4.results).toEqual([{ result: 2, active: true }]);
});

test('ask + Roll automatically: no overlay, resolveResult -> undefined', async () => {
  settings.handRolls = 'ask';
  deps.ask = vi.fn(async () => false);
  const d6 = new Die({ number: 2, faces: 6, modifiers: ['x'] });
  const r = new Resolver(rollOf(d6), deps);
  await evaluate(r);
  expect(deps.ask).toHaveBeenCalledTimes(1);
  expect(overlay.open).not.toHaveBeenCalled();
  expect(deps.diceBox.roll).not.toHaveBeenCalled();
  expect(d6.results.every((x) => x.random)).toBe(true);
  expect(r.roll.options.dicerHand).toMatchObject({ by: 'u1', fallback: 'auto' });
  expect(await extraResult(r, d6, 'dicer', { explode: true })).toBeUndefined();
  // "Throw by hand" opens the overlay
  deps.ask = vi.fn(async () => true);
  overlay.values = [4];
  const d8 = new Die({ number: 1, faces: 8 });
  await evaluate(new Resolver(rollOf(d8), deps));
  expect(overlay.open).toHaveBeenCalledTimes(1);
  expect(d8.results).toEqual([{ result: 4, active: true }]);
});

test('required skips the ask; a user not allowed never throws by hand', async () => {
  settings.handRolls = 'ask';
  settings.handRollsRequired = true;
  overlay.values = [4];
  await evaluate(new Resolver(rollOf(new Die({ faces: 8 })), deps));
  expect(deps.ask).not.toHaveBeenCalled();
  expect(overlay.open).toHaveBeenCalledTimes(1);
  settings.handRollsAllowed = 'gm';
  const d8 = new Die({ faces: 8 });
  const r = new Resolver(rollOf(d8), deps);
  await evaluate(r);
  expect(overlay.open).toHaveBeenCalledTimes(1);
  expect(d8.results[0].random).toBe(true);
  expect(r.roll.options.dicerHand.fallback).toBe('auto');
});

describe('Review Focus 2', () => {
  test.each([
    [{ timedOut: true }, 'timeout'],
    [{ cancelled: true }, 'cancel'],
    [{ values: null, handle: {}, recording: null }, 'cancel'],
  ])('timeout and cancel -> nothing pushed, fallback set, every later resolveResult undefined (%o)', async (outcome, fallback) => {
    overlay.open = vi.fn(async () => outcome);
    const d6 = new Die({ number: 3, faces: 6, modifiers: ['x'] });
    const d20 = new Die({ number: 1, faces: 20 });
    const roll = rollOf(d6, d20);
    const r = new Resolver(roll, deps);
    await fulfill(r);
    expect(d6.results).toEqual([]);
    expect(d20.results).toEqual([]);
    expect(roll.options.dicerHand).toEqual({ id: roll.options.dicerHand.id, by: 'u1', n: 4, fallback });
    expect(handThrows.size).toBe(0);
    const spy = vi.fn(extraResult);
    for (const t of [d6, d20]) for (const o of [{}, { explode: true }, { reroll: true }]) expect(await spy(r, t, 'dicer', o)).toBeUndefined();
    for (const t of roll.dice) await evalTerm(r, t);
    expect([...d6.results, ...d20.results].every((x) => x.random)).toBe(true);
    expect(deps.diceBox.roll).not.toHaveBeenCalled();
    // a later dynamic term resolves at once, counted in partial
    const late = new Die({ number: 2, faces: 6 });
    await fulfillTerm(r, late);
    expect(late.results).toEqual([]);
    expect(roll.options.dicerHand.partial).toBe(2);
  });

  test('the resolver closed while the overlay was open: nothing pushed', async () => {
    let land;
    overlay.open = vi.fn(() => new Promise((res) => (land = res)));
    const d6 = new Die({ number: 1, faces: 6 });
    const r = new Resolver(rollOf(d6), deps);
    const p = fulfill(r);
    await new Promise((res) => setTimeout(res, 0));
    expect(typeof r._abort).toBe('function');
    r._closed = true;
    land({ values: [6], handle: {}, recording: {} });
    await p;
    expect(d6.results).toEqual([]);
    expect(r.roll.options.dicerHand.fallback).toBe('cancel');
    expect(await extraResult(r, d6, 'dicer', {})).toBeUndefined();
  });
});

test('3d6x: explosions throw one free die each and totals match read values', async () => {
  const d6 = new Die({ number: 3, faces: 6, modifiers: ['x'] });
  const r = new Resolver(rollOf(d6), deps);
  overlay.values = [6, 2, 4];
  boxValues = [6, 3]; // the first explosion explodes again
  await evaluate(r);
  expect(d6.results.map((x) => x.result)).toEqual([6, 2, 4, 6, 3]);
  expect(total(d6)).toBe(21);
  expect(d6.results.some((x) => x.random)).toBe(false);
  expect(deps.diceBox.roll).toHaveBeenCalledTimes(2);
  for (const [specs, opts] of deps.diceBox.roll.mock.calls) {
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ type: 'd6', free: true, shapeType: 'd6' });
    expect(opts).toMatchObject({ area: RECT, free: true });
    expect(opts.launch).toBeUndefined(); // "throw for me"
  }
  expect(deps.diceBox.roll.mock.calls.map(([s]) => s[0].key)).toEqual(['0:3:0', '0:4:0']);
  // a dropped die (no explode/reroll) is never thrown here: Foundry's random
  expect(await extraResult(r, d6, 'dicer', {})).toBeUndefined();
});

test('a reroll throws one free die; a manual term delegates to Foundry', async () => {
  const d20 = new Die({ number: 1, faces: 20 });
  const r = new Resolver(rollOf(d20), deps);
  overlay.values = [1];
  await fulfill(r);
  boxValues = [14];
  expect(await extraResult(r, d20, 'dicer', { reroll: true })).toBe(14);
  expect(await extraResult(r, d20, 'manual', { reroll: true })).toBe(5);
});

test('(1d4)d6: addTerm throws the inner and outer dice', async () => {
  const inner = new Die({ number: 1, faces: 4 });
  const outer = new Die({ faces: 6 });
  outer.number = undefined; // dynamic: no number before its inner roll is evaluated
  const roll = rollOf(outer);
  const r = new Resolver(roll, deps);
  await fulfill(r); // nothing fulfillable yet (Foundry skips a term without a number)
  expect(overlay.open).not.toHaveBeenCalled();
  boxValues = [3];
  await fulfillTerm(r, inner); // DiceTerm#_evaluateAsync: the inner roll's term has no _id
  expect(inner.results).toEqual([{ result: 3, active: true }]);
  expect([inner.method, !!inner._id]).toEqual(['dicer', true]);
  outer.number = 3;
  boxValues = [2, 4, 6];
  await fulfillTerm(r, outer);
  expect(outer.results.map((x) => x.result)).toEqual([2, 4, 6]);
  expect(deps.diceBox.roll).toHaveBeenCalledTimes(2);
  expect(deps.diceBox.roll.mock.calls[1][0].map((s) => [s.type, s.free])).toEqual([
    ['d6', true],
    ['d6', true],
    ['d6', true],
  ]);
  // a manual dynamic term goes to Foundry's form; a non-interactive one is left alone
  config.d8 = 'manual';
  const m = new Die({ number: 1, faces: 8 });
  await fulfillTerm(r, m);
  expect(r.form).toEqual([m]);
});

test('over maxDice and an aliased 30-face preset -> partial counted, those dice undefined', async () => {
  settings.maxDice = 3;
  const d6 = new Die({ number: 5, faces: 6 });
  const d30 = new Die({ number: 1, faces: 30 });
  shapes.set(d30, 'd20'); // a DSN preset throws the d30 on a d20: unreadable
  config.d30 = undefined; // follows default (dicer)
  const roll = rollOf(d6, d30);
  const r = new Resolver(roll, deps);
  overlay.values = [1, 2, 3];
  await fulfill(r);
  const { specs } = overlay.open.mock.calls[0][0];
  expect(specs.map((s) => s.key)).toEqual(['0:0:0', '0:1:0', '0:2:0']);
  expect(d6.results.map((x) => x.result)).toEqual([1, 2, 3]);
  expect(d30.results).toEqual([]);
  expect(roll.options.dicerHand).toMatchObject({ n: 3, partial: 3 });
  for (const t of roll.dice) await evalTerm(r, t);
  expect(d6.results.slice(3).every((x) => x.random)).toBe(true);
  expect(d30.results[0].random).toBe(true);
  // an extra of the unreadable term is not thrown either
  expect(await extraResult(r, d30, 'dicer', { explode: true })).toBeUndefined();
});

test('a shape in HAND_UNFAIR is not thrown by hand: Foundry rolls it (partial)', async () => {
  unfair.push('d20');
  const d20 = new Die({ number: 2, faces: 20 });
  const d6 = new Die({ number: 1, faces: 6 });
  const roll = rollOf(d20, d6);
  overlay.values = [4];
  await fulfill(new Resolver(roll, deps));
  expect(overlay.open.mock.calls[0][0].specs.map((s) => s.type)).toEqual(['d6']);
  expect(roll.options.dicerHand).toMatchObject({ n: 1, partial: 2 });
  // only unfair dice: no overlay at all
  overlay.open.mockClear();
  const only = rollOf(new Die({ number: 1, faces: 20 }));
  await fulfill(new Resolver(only, deps));
  expect(overlay.open).not.toHaveBeenCalled();
  expect(only.options.dicerHand).toMatchObject({ n: 0, partial: 1 });
});

test("manual terms render Foundry's form only for them", async () => {
  config = { d6: 'dicer', d8: 'manual' };
  const d6 = new Die({ number: 1, faces: 6 });
  const d8 = new Die({ number: 2, faces: 8 });
  const r = new Resolver(rollOf(d6, d8), deps);
  overlay.values = [4];
  await evaluate(r);
  expect(r.form).toEqual([d8]);
  expect(overlay.open.mock.calls[0][0].specs.map((s) => s.type)).toEqual(['d6']);
  expect(d6.results).toEqual([{ result: 4, active: true }]);
  expect(d8.results.map((x) => x.result)).toEqual([5, 5]); // through Foundry's own resolveResult
  // only manual terms: no overlay, the form as before
  overlay.open.mockClear();
  const m = new Die({ number: 1, faces: 8 });
  const r2 = new Resolver(rollOf(m), deps);
  await fulfill(r2);
  expect(overlay.open).not.toHaveBeenCalled();
  expect(r2.form).toEqual([m]);
});

test('pending-throw hooks fire once each', async () => {
  const roll = rollOf(new Die({ number: 2, faces: 6, modifiers: ['x'] }));
  overlay.values = [6, 1];
  boxValues = [2];
  await evaluate(new Resolver(roll, deps));
  expect(deps.hooks.callAll.mock.calls).toEqual([
    ['diceSoNicePendingThrowOpened', roll],
    ['diceSoNicePendingThrowClosed', roll],
  ]);
  // also when the throw times out
  deps.hooks.callAll.mockClear();
  overlay.open = vi.fn(async () => ({ timedOut: true }));
  const r2 = rollOf(new Die({ faces: 6 }));
  await fulfill(new Resolver(r2, deps));
  expect(deps.hooks.callAll.mock.calls.map((c) => c[0])).toEqual([
    'diceSoNicePendingThrowOpened',
    'diceSoNicePendingThrowClosed',
  ]);
});

test("a roll with options.messageMode 'blind' opens with ghostOnRelease", async () => {
  const d6 = new Die({ number: 1, faces: 6, modifiers: ['x'] });
  const roll = rollOf(d6);
  roll.options.messageMode = 'blind';
  overlay.values = [6];
  boxValues = [2];
  await evaluate(new Resolver(roll, deps));
  expect(overlay.open.mock.calls[0][0].ghostOnRelease).toBe(true);
  expect(deps.diceBox.roll.mock.calls[0][0][0].ghost).toBe(true); // its extra ghosts too
  // the other secret hints; a public or self roll and a GM's own roll do not ghost
  const ghostFor = async (opts, user) => {
    overlay.open.mockClear();
    if (user) deps.user = () => user;
    const r = rollOf(new Die({ faces: 6 }));
    Object.assign(r, opts);
    overlay.values = [1];
    await fulfill(new Resolver(r, deps));
    return overlay.open.mock.calls[0][0].ghostOnRelease;
  };
  expect(await ghostFor({ options: { messageMode: 'gm' } })).toBe(true);
  expect(await ghostFor({ options: { rollMode: 'blindroll' } })).toBe(true);
  expect(await ghostFor({ secret: true, options: {} })).toBe(true);
  expect(await ghostFor({ ghost: true, options: {} })).toBe(true);
  expect(await ghostFor({ options: { messageMode: 'public' } })).toBe(false);
  expect(await ghostFor({ options: { messageMode: 'self' } })).toBe(false);
  expect(await ghostFor({ options: { messageMode: 'blind' } }, { id: 'g', isGM: true, role: 4 })).toBe(false);
});

test('a malformed read value is never pushed (Foundry rolls that die)', async () => {
  const d6 = new Die({ number: 2, faces: 6 });
  const roll = rollOf(d6);
  overlay.values = [9, 3];
  await fulfill(new Resolver(roll, deps));
  expect(d6.results).toEqual([{ result: 3, active: true }]);
  expect(roll.options.dicerHand.partial).toBe(1);
});

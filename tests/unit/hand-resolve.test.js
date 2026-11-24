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
  randomFace() {
    return this.maxResult; // deterministic stand-in for Foundry's PRNG
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
    roll: vi.fn((specs, opts) => {
      opts?.record?.({ rec: specs.length }); // DiceBox records at physics done, before landing
      return {
        values: Promise.resolve(specs.map((s) => (s.variant === 'd100tens' ? null : boxValues.shift()))),
        handle: { free: specs.length },
        landed: Promise.resolve(),
        finished: Promise.resolve(),
      };
    }),
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
  delete globalThis.game;
  vi.restoreAllMocks();
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
  expect(handThrows.get(hand.id)).toEqual({ recording: { rec: 1 }, handle: { h: 1 }, specs, extras: [] });
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
  expect(spec.damageType).toBe('fire'); // the term's, not the result's: its trail element
  expect(spec.value).toBe(1); // the placeholder: the minimum face
  expect(d4.results).toEqual([{ result: 2, active: true }]);
});

test('placeholder specs trail but never burst (trail 2 -> 1); no trail mark stays none', async () => {
  const d20 = new Die({ number: 1, faces: 20 });
  deps.decorateFor = vi.fn(() => () => ({ trail: 2 }));
  overlay.values = [20];
  await evaluate(new Resolver(rollOf(d20), deps));
  expect(overlay.open.mock.calls[0][0].specs[0].trail).toBe(1);
  overlay.open.mockClear();
  deps.decorateFor = vi.fn(() => () => ({ appearance: {} }));
  overlay.values = [20];
  await evaluate(new Resolver(rollOf(new Die({ number: 1, faces: 20 })), deps));
  expect(overlay.open.mock.calls[0][0].specs[0]).not.toHaveProperty('trail');
});

test('a hand-thrown acid damage die carries its damage type (its trail element)', async () => {
  const { damageTypesByTerm } = await import('../../src/effects/roll-context.js');
  const d6 = new Die({ number: 1, faces: 6 });
  d6.options.flavor = 'acid';
  // As the fx resolver: the damage type is looked up by the roll's own term objects.
  deps.decorateFor = vi.fn((_m, roll) => {
    const types = damageTypesByTerm(roll);
    return (term) => ({ damageType: types.get(term), trail: 2 });
  });
  overlay.values = [4];
  await evaluate(new Resolver(rollOf(d6), deps));
  const [spec] = overlay.open.mock.calls[0][0].specs;
  expect(spec).toMatchObject({ damageType: 'acid', trail: 1 });
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
  expect(await ghostFor({ options: { rollMode: 'blindroll' } })).toBe(true);
  // I1: a "Private GM Roll" is visible to its author in v14 (CONFIG.ChatMessage.modes.gm): real dice
  expect(await ghostFor({ options: { messageMode: 'gm' } })).toBe(false);
  expect(await ghostFor({ options: { rollMode: 'gmroll' } })).toBe(false);
  expect(await ghostFor({ secret: true, options: {} })).toBe(true);
  expect(await ghostFor({ ghost: true, options: {} })).toBe(true);
  expect(await ghostFor({ options: { messageMode: 'public' } })).toBe(false);
  expect(await ghostFor({ options: { messageMode: 'self' } })).toBe(false);
  expect(await ghostFor({ options: { messageMode: 'blind' } }, { id: 'g', isGM: true, role: 4 })).toBe(false);
});


test('I1: a gm-mode hand roll throws real dice (and its extras) for the thrower; blind still ghosts', async () => {
  const d6 = new Die({ number: 1, faces: 6, modifiers: ['x'] });
  const roll = rollOf(d6);
  roll.options.messageMode = 'gm';
  overlay.values = [6];
  boxValues = [3];
  await evaluate(new Resolver(roll, deps));
  expect(overlay.open.mock.calls[0][0].ghostOnRelease).toBe(false);
  expect(deps.diceBox.roll.mock.calls[0][0][0].ghost).toBeUndefined(); // the explosion is real too
  expect(d6.results.map((x) => x.result)).toEqual([6, 3]);
  // the core chat mode "gm" (no mode on the roll) does not ghost either
  globalThis.game = { settings: { get: (ns, k) => (k === 'messageMode' ? 'gm' : undefined) } };
  overlay.values = [2];
  await fulfill(new Resolver(rollOf(new Die({ faces: 6 })), deps));
  expect(overlay.open.mock.calls[1][0].ghostOnRelease).toBe(false);
  const blind = rollOf(new Die({ faces: 6 }));
  blind.options.messageMode = 'blind';
  await fulfill(new Resolver(blind, deps));
  expect(overlay.open.mock.calls[2][0].ghostOnRelease).toBe(true);
});

test('an out-of-range read takes randomFace() in its slot (counted in partial), so keys stay aligned', async () => {
  const d6 = new Die({ number: 2, faces: 6 });
  const roll = rollOf(d6);
  overlay.values = [9, 3];
  await fulfill(new Resolver(roll, deps));
  expect(d6.results).toEqual([
    { result: 6, active: true }, // randomFace() for the unreadable value, in the recorded slot 0:0:0
    { result: 3, active: true },
  ]);
  expect(roll.options.dicerHand.partial).toBe(1);
});

describe('fix round 1', () => {
  test('rolls never reject: a throwing planner -> the roll evaluates with random results', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deps.plan = () => {
      throw new Error('planner bug');
    };
    const d6 = new Die({ number: 2, faces: 6, modifiers: ['x'] });
    const roll = rollOf(d6);
    const r = new Resolver(roll, deps);
    await expect(evaluate(r)).resolves.toBeUndefined();
    expect(d6.results.every((x) => x.random)).toBe(true);
    expect(overlay.open).not.toHaveBeenCalled();
    expect(roll.options.dicerHand.fallback).toBe('cancel');
    // the dynamic and extra paths too
    const late = new Die({ number: 1, faces: 6 });
    const r2 = new Resolver(rollOf(new Die({ faces: 8 })), deps);
    await expect(fulfillTerm(r2, late)).resolves.toBeUndefined();
    expect(late.results).toEqual([]);
    await expect(extraResult(r2, late, 'dicer', { explode: true })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  test('rolls never reject: a throwing decorateFor -> the same; manual terms still get the form', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    deps.decorateFor = () => {
      throw new Error('look bug');
    };
    config.d8 = 'manual';
    const d6 = new Die({ number: 1, faces: 6 });
    const d8 = new Die({ number: 1, faces: 8 });
    const r = new Resolver(rollOf(d6, d8), deps);
    await expect(evaluate(r)).resolves.toBeUndefined();
    expect(d6.results[0].random).toBe(true);
    expect(r.form).toEqual([d8]);
    // an extra failing after a landed hand throw: undefined, and the landed throw keeps its dicerHand
    deps.decorateFor = vi.fn(() => undefined);
    const d20 = new Die({ number: 1, faces: 20 });
    const roll = rollOf(d20);
    const r3 = new Resolver(roll, deps);
    overlay.values = [20];
    await fulfill(r3);
    deps.diceBox._getAppearance = () => {
      throw new Error('look gone');
    };
    expect(await extraResult(r3, d20, 'dicer', { explode: true })).toBeUndefined();
    expect(roll.options.dicerHand.fallback).toBeUndefined();
  });

  test('ghost by chat mode: no messageMode on the roll + core messageMode blind -> ghostOnRelease', async () => {
    const core = { messageMode: 'blind' };
    globalThis.game = {
      settings: {
        get: (ns, k) => {
          if (k in core) return core[k];
          throw new Error('not a registered setting');
        },
      },
    };
    overlay.values = [1];
    await fulfill(new Resolver(rollOf(new Die({ faces: 6 })), deps));
    expect(overlay.open.mock.calls[0][0].ghostOnRelease).toBe(true);
    core.messageMode = 'public';
    await fulfill(new Resolver(rollOf(new Die({ faces: 6 })), deps));
    expect(overlay.open.mock.calls[1][0].ghostOnRelease).toBe(false);
    // the roll's own mode wins over the core one
    core.messageMode = 'blind';
    const r = rollOf(new Die({ faces: 6 }));
    r.options.messageMode = 'public';
    await fulfill(new Resolver(r, deps));
    expect(overlay.open.mock.calls[2][0].ghostOnRelease).toBe(false);
  });

  test('two rolls evaluated concurrently are both thrown by hand, in order', async () => {
    const landers = [];
    overlay.open = vi.fn(
      ({ specs }) =>
        new Promise((res) => landers.push(() => res({ values: specs.map(() => 4), handle: {}, recording: {} }))),
    );
    const a = new Die({ number: 1, faces: 6 });
    const b = new Die({ number: 2, faces: 8 });
    const pa = evaluate(new Resolver(rollOf(a), deps));
    const pb = evaluate(new Resolver(rollOf(b), deps));
    await flush();
    expect(overlay.open).toHaveBeenCalledTimes(1); // the second roll waits for the first overlay
    expect(overlay.open.mock.calls[0][0].specs[0].type).toBe('d6');
    landers[0]();
    await flush();
    expect(overlay.open).toHaveBeenCalledTimes(2);
    expect(overlay.open.mock.calls[1][0].specs[0].type).toBe('d8');
    landers[1]();
    await Promise.all([pa, pb]);
    expect(a.results).toEqual([{ result: 4, active: true }]);
    expect(b.results.map((x) => x.result)).toEqual([4, 4]);
  });

  test('a queued roll whose resolver closes while waiting falls back without an overlay', async () => {
    let land;
    overlay.open = vi.fn(
      ({ specs }) => new Promise((res) => (land = () => res({ values: specs.map(() => 2), handle: {}, recording: {} }))),
    );
    const pa = fulfill(new Resolver(rollOf(new Die({ faces: 6 })), deps));
    const b = new Die({ faces: 6 });
    const rb = new Resolver(rollOf(b), deps);
    const pb = fulfill(rb);
    await flush();
    rb._closed = true;
    land();
    await Promise.all([pa, pb]);
    expect(overlay.open).toHaveBeenCalledTimes(1);
    expect(b.results).toEqual([]);
    expect(rb.roll.options.dicerHand.fallback).toBe('cancel');
  });

  test('the ask prompt races handRollTimeout (then automatic); no prompt when no die can be thrown', async () => {
    settings.handRolls = 'ask';
    settings.handRollTimeout = 0.02; // 20 ms
    deps.ask = vi.fn(() => new Promise(() => {})); // never answered
    const d6 = new Die({ faces: 6 });
    const r = new Resolver(rollOf(d6), deps);
    await fulfill(r);
    expect(deps.ask).toHaveBeenCalledWith(r.roll, 20, expect.any(Boolean)); // M6: and whether in a burst
    expect(overlay.open).not.toHaveBeenCalled();
    expect(r.roll.options.dicerHand.fallback).toBe('auto');
    // only unfair dice: nothing to throw, so nothing to ask
    deps.ask.mockClear();
    unfair.push('d20');
    const only = rollOf(new Die({ faces: 20 }));
    await fulfill(new Resolver(only, deps));
    expect(deps.ask).not.toHaveBeenCalled();
    expect(only.options.dicerHand).toMatchObject({ n: 0, partial: 1 });
  });

  test('extras and dynamic-term free throws are stored under the hand throw id', async () => {
    const d6 = new Die({ number: 2, faces: 6, modifiers: ['x'] });
    const roll = rollOf(d6);
    const r = new Resolver(roll, deps);
    overlay.values = [6, 2];
    boxValues = [3];
    await evaluate(r);
    const late = new Die({ number: 2, faces: 4 });
    boxValues = [1, 4];
    await fulfillTerm(r, late);
    const entry = handThrows.get(roll.options.dicerHand.id);
    expect(entry.extras).toHaveLength(2);
    expect(entry.extras[0]).toMatchObject({ handle: { free: 1 }, recording: { rec: 1 } });
    expect(entry.extras[0].specs.map((s) => s.key)).toEqual(['0:2:0']);
    expect(entry.extras[1]).toMatchObject({ handle: { free: 2 }, recording: { rec: 2 } });
    expect(entry.handle).toEqual({ h: 1 }); // the hand throw's own handle stays
  });
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('fix round 2', () => {
  afterEach(() => vi.useRealTimers());

  test('a throw whose values never settle falls back after the bound, and the next queued roll proceeds', async () => {
    vi.useFakeTimers();
    settings.handRollTimeout = 0.01; // 10 ms: the bound is 10 ms + HAND_GRACE_MS
    const { HAND_GRACE_MS } = await import('../../src/hand/chunk/resolve.js');
    expect(HAND_GRACE_MS).toBe(20000); // M4: a 13 s free throw plus DiceBox's 3 s landing grace, with room
    overlay.open = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {})) // released, then the dice never land
      .mockImplementationOnce(async ({ specs }) => ({ values: specs.map(() => 5), handle: {}, recording: {} }));
    const a = new Die({ faces: 6 });
    const b = new Die({ faces: 6 });
    const ra = new Resolver(rollOf(a), deps);
    const pa = fulfill(ra);
    const pb = fulfill(new Resolver(rollOf(b), deps));
    await vi.advanceTimersByTimeAsync(HAND_GRACE_MS); // not yet: 10 ms short
    expect(overlay.open).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20);
    await Promise.all([pa, pb]);
    expect(a.results).toEqual([]);
    expect(ra.roll.options.dicerHand.fallback).toBe('timeout');
    expect(handThrows.has(ra.roll.options.dicerHand.id)).toBe(false);
    expect(await extraResult(ra, a, 'dicer', { explode: true })).toBeUndefined();
    expect(overlay.open).toHaveBeenCalledTimes(2);
    expect(b.results).toEqual([{ result: 5, active: true }]);
  });

  test('a failure while pushing a landed throw marks the dicerHand a fallback and stores nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d6 = new Die({ number: 1, faces: 6 });
    d6.results = Object.freeze([]); // push throws
    const roll = rollOf(d6);
    overlay.values = [4];
    await expect(fulfill(new Resolver(roll, deps))).resolves.toBeUndefined();
    expect(roll.options.dicerHand.fallback).toBe('cancel');
    expect(handThrows.size).toBe(0);
  });
});

describe('final review fixes', () => {
  afterEach(() => vi.useRealTimers());

  test('M4: the throw is bounded from its release, so a release near the time limit is never cut', async () => {
    vi.useFakeTimers();
    const { HAND_GRACE_MS } = await import('../../src/hand/chunk/resolve.js');
    settings.handRollTimeout = 10; // 10 s
    // released 5 ms before the limit; the dice land 18 s later (a long free throw + landing grace)
    overlay.open = vi.fn(
      ({ specs, onRelease }) =>
        new Promise((res) =>
          setTimeout(() => {
            onRelease();
            setTimeout(() => res({ values: specs.map(() => 4), handle: {}, recording: {} }), 18000);
          }, 9995),
        ),
    );
    const d6 = new Die({ faces: 6 });
    const r = new Resolver(rollOf(d6), deps);
    const p = fulfill(r);
    await vi.advanceTimersByTimeAsync(9995 + 18000);
    await p;
    expect(d6.results).toEqual([{ result: 4, active: true }]);
    expect(r.roll.options.dicerHand.fallback).toBeUndefined();
    // released early, the dice never land: the roll falls back HAND_GRACE_MS after the release
    overlay.open = vi.fn(({ onRelease }) => new Promise(() => setTimeout(onRelease, 1000)));
    const r2 = new Resolver(rollOf(new Die({ faces: 6 })), deps);
    let done = false;
    const p2 = fulfill(r2).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1000 + HAND_GRACE_MS - 10);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    await p2;
    expect(r2.roll.options.dicerHand.fallback).toBe('timeout');
  });

  test('M3: stored throws expire after THROW_TTL_MS and at most THROW_LIMIT are kept (oldest first)', async () => {
    vi.useFakeTimers();
    const { THROW_TTL_MS, THROW_LIMIT } = await import('../../src/hand/chunk/resolve.js');
    expect([THROW_TTL_MS, THROW_LIMIT]).toEqual([120000, 16]);
    const throwOne = async () => {
      const roll = rollOf(new Die({ faces: 6 }));
      overlay.values = [2];
      await fulfill(new Resolver(roll, deps));
      return roll.options.dicerHand.id;
    };
    const ids = [];
    for (let i = 0; i < THROW_LIMIT + 2; i++) ids.push(await throwOne());
    expect(handThrows.size).toBe(THROW_LIMIT);
    expect(handThrows.has(ids[0])).toBe(false);
    expect(handThrows.has(ids[1])).toBe(false);
    expect(handThrows.has(ids[2])).toBe(true);
    // a roll that never became a chat message: swept once it is older than the TTL
    await vi.advanceTimersByTimeAsync(THROW_TTL_MS + 1);
    const fresh = await throwOne();
    expect([...handThrows.keys()]).toEqual([fresh]);
  });

  test('M3: nothing expires while other throws are still queued (a long burst keeps its first throws)', async () => {
    vi.useFakeTimers({ now: Date.now() + 7200e3 });
    const { THROW_TTL_MS } = await import('../../src/hand/chunk/resolve.js');
    handThrows.clear();
    overlay.values = [3];
    // a burst of rolls thrown one after another over more than THROW_TTL_MS in all
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const r = rollOf(new Die({ faces: 6 }));
      await fulfill(new Resolver(r, deps));
      ids.push(r.options.dicerHand.id);
      await vi.advanceTimersByTimeAsync(THROW_TTL_MS / 2);
    }
    // the burst's first throws are all still there for their messages
    for (const id of ids) expect(handThrows.has(id)).toBe(true);
    // after THROW_TTL_MS with no throw at all, the leftovers go with the next one
    await vi.advanceTimersByTimeAsync(THROW_TTL_MS + 1);
    const late = rollOf(new Die({ faces: 6 }));
    await fulfill(new Resolver(late, deps));
    expect([...handThrows.keys()]).toEqual([late.options.dicerHand.id]);
  });

  test('M6: the ask prompt names the roll, and "Throw the rest automatically" covers the rest of the burst', async () => {
    vi.useFakeTimers({ now: Date.now() + 3600e3 }); // after every earlier test's rolls
    settings.handRolls = 'ask';
    const answers = ['rest'];
    deps.ask = vi.fn(async () => answers.shift() ?? true);
    const roll = rollOf(new Die({ faces: 6 }));
    await fulfill(new Resolver(roll, deps));
    expect(roll.options.dicerHand.fallback).toBe('auto');
    // the next rolls of the same burst are not asked: automatic
    for (let i = 0; i < 3; i++) {
      const next = rollOf(new Die({ faces: 6 }));
      await fulfill(new Resolver(next, deps));
      expect(next.options.dicerHand.fallback).toBe('auto');
    }
    expect(deps.ask).toHaveBeenCalledTimes(1);
    expect(overlay.open).not.toHaveBeenCalled();
    // once the burst is over (no roll for a while), the prompt is back
    await vi.advanceTimersByTimeAsync(5000);
    overlay.values = [3];
    const later = rollOf(new Die({ faces: 6 }));
    await fulfill(new Resolver(later, deps));
    expect(deps.ask).toHaveBeenCalledTimes(2);
    expect(later.options.dicerHand.fallback).toBeUndefined();
  });

  test("M6: the default prompt shows the roll's flavor and formula as text, with the burst choice when it applies", async () => {
    settings.handRolls = 'ask';
    delete deps.ask;
    const waits = [];
    globalThis.foundry.applications = {
      api: { DialogV2: { wait: vi.fn(async (cfg) => (waits.push(cfg), 'no')) } },
    };
    const roll = rollOf(new Die({ faces: 20 }));
    roll.formula = '1d20 + 7';
    roll.options.flavor = '<b>Longsword</b> & <i>Strike</i>';
    vi.useFakeTimers({ now: Date.now() + 7200e3 }); // no burst before it
    await fulfill(new Resolver(roll, deps));
    const [first] = waits;
    expect(first.content).toContain('Longsword &amp; Strike: 1d20 + 7');
    expect(first.content).not.toContain('<b>');
    expect(first.buttons.map((b) => b.action)).toEqual(['yes', 'no']);
    expect(roll.options.dicerHand.fallback).toBe('auto');
    // right after another roll: part of a burst, so the third choice is offered
    await fulfill(new Resolver(rollOf(new Die({ faces: 6 })), deps));
    expect(waits[1].buttons.map((b) => b.action)).toEqual(['yes', 'no', 'rest']);
    expect(waits[1].buttons[2].label).toBe('DICER.Hand.ThrowRestAuto');
  });
});

describe('follow-up rolls', () => {
  let t0 = Date.now() + 30 * 3600e3;
  beforeEach(() => {
    t0 += 3600e3; // clear of every earlier throw's window
    vi.useFakeTimers({ now: t0 });
    settings.handFollowUps = true;
  });
  afterEach(() => vi.useRealTimers());

  /** One d20 roll through fulfill; its roll. */
  const rollD20 = async (prep) => {
    const roll = rollOf(new Die({ faces: 20 }));
    prep?.(roll);
    await fulfill(new Resolver(roll, deps));
    return roll;
  };

  describe('live hand throws (handLiveShare)', () => {
    /** The overlay resolves at the read; its dice land when `land()` is called. */
    const flying = () => {
      let land;
      const landed = new Promise((r) => (land = r));
      overlay.open = vi.fn(async ({ specs }) => ({
        values: specs.map(() => 12),
        handle: { h: 1 },
        recording: { rec: 1 },
        landed,
      }));
      return () => land();
    };

    test('the overlay is opened early, and the roll resolves before its dice land', async () => {
      const land = flying();
      const roll = await rollD20(); // not landed yet: the roll is already done
      expect(overlay.open.mock.calls[0][0].early).toBe(true);
      expect(roll.terms[0].results).toEqual([{ result: 12, active: true }]);
      land(); // frees the module-level queue for the next test
      await vi.advanceTimersByTimeAsync(0);
    });

    test('handLiveShare off: the overlay waits for landing (no early)', async () => {
      settings.handLiveShare = false;
      overlay.values = [12];
      await rollD20();
      expect(overlay.open.mock.calls[0][0].early).toBe(false);
    });

    test('the next throw waits for the flying dice to land', async () => {
      const land = flying();
      await rollD20();
      boxValues = [4];
      let done = false;
      const next = rollD20().then((r) => ((done = true), r));
      await vi.advanceTimersByTimeAsync(1000);
      expect(deps.diceBox.roll).not.toHaveBeenCalled();
      expect(done).toBe(false);
      land();
      const r = await next;
      expect(deps.diceBox.roll).toHaveBeenCalledTimes(1); // a follow-up, thrown after landing
      expect(r.options.dicerHand.follow).toBe(true);
    });

    test('a roll started mid-flight is a follow-up even past FOLLOW_MS after the read', async () => {
      const land = flying();
      await rollD20();
      await vi.advanceTimersByTimeAsync(3500); // still flying 3.5 s after the read
      boxValues = [4];
      const next = rollD20();
      await vi.advanceTimersByTimeAsync(500);
      land();
      expect((await next).options.dicerHand.follow).toBe(true);
    });

    test('the follow-up window closes FOLLOW_MS after the landing', async () => {
      const land = flying();
      await rollD20();
      await vi.advanceTimersByTimeAsync(2000);
      land();
      await vi.advanceTimersByTimeAsync(3500); // 3.5 s after the landing
      overlay.open = vi.fn(async ({ specs }) => ({ values: specs.map(() => 9), handle: {}, recording: {} }));
      const next = await rollD20();
      expect(overlay.open).toHaveBeenCalledTimes(1);
      expect(next.options.dicerHand.follow).toBeUndefined();
    });

    test('dice that never land hold the queue at most HAND_GRACE_MS', async () => {
      const { HAND_GRACE_MS } = await import('../../src/hand/chunk/resolve.js');
      flying(); // never landed
      await rollD20();
      boxValues = [4];
      let done = false;
      rollD20().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(HAND_GRACE_MS - 10);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(20);
      expect(done).toBe(true);
    });

    test('an explosion is thrown only after the hand throw has landed (no early extra die)', async () => {
      let land;
      const landed = new Promise((r) => (land = r));
      overlay.open = vi.fn(async ({ specs }) => ({
        values: specs.map(() => 6),
        handle: { h: 1 },
        recording: { rec: 1 },
        landed,
      }));
      const d6 = new Die({ number: 1, faces: 6, modifiers: ['x'] });
      const r = new Resolver(rollOf(d6), deps);
      boxValues = [2];
      let done = false;
      const p = evaluate(r).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(1000);
      expect(deps.diceBox.roll).not.toHaveBeenCalled(); // the first die still flies
      expect(done).toBe(false);
      land();
      await p;
      expect(deps.diceBox.roll).toHaveBeenCalledTimes(1);
      expect(d6.results.map((x) => x.result)).toEqual([6, 2]);
    });

    test('a live follow-up resolves on its read; the next waits for its landing', async () => {
      overlay.values = [12];
      await rollD20(); // lands at once (no landed in the fake overlay result)
      let land;
      deps.diceBox.roll.mockImplementationOnce((specs, opts) => {
        opts.record({ rec: 1 });
        return {
          read: Promise.resolve([3]),
          values: new Promise(() => {}),
          handle: {},
          landed: new Promise((r) => (land = r)),
          finished: new Promise(() => {}),
        };
      });
      const follow = await rollD20();
      expect(follow.terms[0].results[0].result).toBe(3);
      boxValues = [5];
      let done = false;
      rollD20().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(100);
      expect(done).toBe(false);
      land();
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
    });
  });

  test('FOLLOW_MS is 3 s', async () => {
    const { FOLLOW_MS } = await import('../../src/hand/chunk/resolve.js');
    expect(FOLLOW_MS).toBe(3000);
  });

  test('a roll 1 s after a hand throw lands is thrown free: no overlay, values from DiceBox, follow flag, stored recording', async () => {
    overlay.values = [12];
    await rollD20();
    await vi.advanceTimersByTimeAsync(1000);
    boxValues = [2];
    const next = await rollD20();
    expect(overlay.open).toHaveBeenCalledTimes(1);
    const [specs, opts] = deps.diceBox.roll.mock.calls.at(-1);
    expect(specs.map((s) => s.type)).toEqual(['d20']);
    expect(opts).toMatchObject({ free: true, area: RECT });
    expect(next.terms[0].results).toEqual([{ result: 2, active: true }]);
    const h = next.options.dicerHand;
    expect(h).toMatchObject({ follow: true, n: 1 });
    expect(h.fallback).toBeUndefined();
    expect(handThrows.get(h.id).recording).toEqual({ rec: 1 });
  });

  test('physics decides (Roll by hand off): every roll is thrown for the roller, no screen, no prompt, the read faces are its result', async () => {
    settings.handRolls = 'off';
    settings.physicsResults = true;
    boxValues = [17];
    const a = await rollD20();
    await vi.advanceTimersByTimeAsync(10000); // long after: still thrown for the roller
    boxValues = [4];
    const b = await rollD20();
    expect(overlay.open).not.toHaveBeenCalled();
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.diceBox.roll.mock.calls.at(-1)[1]).toMatchObject({ free: true, area: RECT });
    expect(a.terms[0].results).toEqual([{ result: 17, active: true }]);
    expect(b.terms[0].results).toEqual([{ result: 4, active: true }]);
    const h = b.options.dicerHand;
    expect(h).toMatchObject({ physics: true, n: 1 });
    expect(h.follow).toBeUndefined();
    expect(handThrows.get(h.id).recording).toEqual({ rec: 1 }); // replayed for the others
  });

  test('physics decides with Ask: answered automatically, the physics decides; by hand, the throw screen', async () => {
    settings.handRolls = 'ask';
    settings.physicsResults = true;
    deps.ask = vi.fn(async () => false);
    boxValues = [11];
    const auto = await rollD20();
    expect(overlay.open).not.toHaveBeenCalled();
    expect(auto.terms[0].results).toEqual([{ result: 11, active: true }]);
    expect(auto.options.dicerHand).toMatchObject({ physics: true });
    await vi.advanceTimersByTimeAsync(10000);
    deps.ask = vi.fn(async () => true);
    overlay.values = [8];
    const byHand = await rollD20();
    expect(overlay.open).toHaveBeenCalledTimes(1);
    expect(byHand.options.dicerHand.physics).toBeUndefined();
  });

  test('physics decides, but PF2e Workbench cancels the untargeted attack: nothing thrown, Foundry rolls', async () => {
    settings.handRolls = 'off';
    settings.physicsResults = true;
    globalThis.game = {
      user: { targets: new Set() },
      modules: { get: (id) => (id === 'xdy-pf2e-workbench' ? { active: true } : undefined) },
      settings: { get: (ns, k) => (ns === 'xdy-pf2e-workbench' && k === 'reminderTargeting' ? 'mustTarget' : undefined) },
    };
    const attack = await rollD20((r) => (r.options = { type: 'attack-roll' }));
    expect(deps.diceBox.roll).not.toHaveBeenCalled();
    expect(attack.options.dicerHand.fallback).toBe('auto');
    // a skill check is not cancelled: physics throws it
    boxValues = [6];
    const skill = await rollD20((r) => (r.options = { type: 'skill-check' }));
    expect(deps.diceBox.roll).toHaveBeenCalledTimes(1);
    expect(skill.terms[0].results).toEqual([{ result: 6, active: true }]);
  });

  test('physics decides, but the roll filters hide initiative: physics decides it unseen, at once; others are thrown', async () => {
    settings.handRolls = 'off';
    settings.physicsResults = true;
    settings.rollFilters = { initiative: 'skip' };
    deps.throwUnseen = vi.fn(async (box, specs) => specs.map(() => 13));
    const pf2e = await rollD20((r) => (r.options = { type: 'initiative' }));
    expect(deps.diceBox.roll).not.toHaveBeenCalled(); // nothing on screen
    expect(deps.throwUnseen).toHaveBeenCalledWith(deps.diceBox, [expect.objectContaining({ type: 'd20' })]);
    expect(pf2e.terms[0].results).toEqual([{ result: 13, active: true }]);
    // physics decided; no throw for the others' screens to wait for
    expect(pf2e.options.dicerHand).toMatchObject({ physics: true, n: 0 });
    expect(pf2e.options.dicerHand.fallback).toBeUndefined();
    const core = await rollD20((r) => (r.options = { dicerInitiative: true }));
    expect(deps.diceBox.roll).not.toHaveBeenCalled();
    expect(core.terms[0].results).toEqual([{ result: 13, active: true }]);
    // the unseen throw failing: Foundry's random
    deps.throwUnseen = vi.fn(async () => null);
    const failed = await rollD20((r) => (r.options = { type: 'initiative' }));
    expect(failed.options.dicerHand.fallback).toBe('auto');
    boxValues = [9];
    const check = await rollD20((r) => (r.options = { type: 'skill-check' }));
    expect(deps.diceBox.roll).toHaveBeenCalledTimes(1);
    expect(check.terms[0].results).toEqual([{ result: 9, active: true }]);
    // without physics deciding, a hidden roll is Foundry's random (no throw at all)
    settings.physicsResults = false;
    settings.handRolls = 'always';
    deps.throwUnseen = vi.fn();
    const random = await rollD20((r) => (r.options = { type: 'initiative' }));
    expect(deps.throwUnseen).not.toHaveBeenCalled();
    expect(overlay.open).not.toHaveBeenCalled();
    expect(random.options.dicerHand.fallback).toBe('auto');
    // a GM's required hand roll is still thrown
    settings.handRollsRequired = true;
    overlay.values = [4];
    await rollD20((r) => (r.options = { type: 'initiative' }));
    expect(overlay.open).toHaveBeenCalledTimes(1);
  });

  test('a kind set not to be rolled by hand: answered automatically, at once; the other kinds are thrown', async () => {
    settings.handRolls = 'always';
    settings.rollFilters = { hand: { initiative: false } };
    const init = (r) => (r.options = { type: 'initiative' });
    const auto = await rollD20(init);
    expect(overlay.open).not.toHaveBeenCalled();
    expect(deps.diceBox.roll).not.toHaveBeenCalled();
    expect(auto.options.dicerHand).toBeUndefined();
    // Foundry's own initiative roll too
    const core = await rollD20((r) => (r.options = { dicerInitiative: true }));
    expect(core.options.dicerHand).toBeUndefined();
    expect(overlay.open).not.toHaveBeenCalled();
    // another kind of roll is still thrown by hand
    overlay.values = [7];
    const check = await rollD20((r) => (r.options = { type: 'skill-check' }));
    expect(overlay.open).toHaveBeenCalledTimes(1);
    expect(check.options.dicerHand.fallback).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10000);
    // Ask: no prompt for it
    settings.handRolls = 'ask';
    deps.ask = vi.fn(async () => true);
    await rollD20(init);
    expect(deps.ask).not.toHaveBeenCalled();
    expect(overlay.open).toHaveBeenCalledTimes(1);
  });

  test('not by hand, with physics deciding: thrown for the roller, on screen', async () => {
    settings.handRolls = 'always';
    settings.physicsResults = true;
    settings.rollFiltersDefault = { hand: { initiative: false } };
    boxValues = [12];
    const roll = await rollD20((r) => (r.options = { type: 'initiative' }));
    expect(overlay.open).not.toHaveBeenCalled();
    expect(deps.diceBox.roll).toHaveBeenCalledTimes(1);
    expect(roll.terms[0].results).toEqual([{ result: 12, active: true }]);
    expect(roll.options.dicerHand).toMatchObject({ physics: true });
  });

  test('not by hand: the player’s choice for a kind wins over the world’s', async () => {
    settings.handRolls = 'always';
    settings.rollFiltersDefault = { hand: { initiative: 'off' } };
    settings.rollFilters = { hand: { initiative: 'always' } };
    overlay.values = [5];
    await rollD20((r) => (r.options = { type: 'initiative' }));
    expect(overlay.open).toHaveBeenCalledTimes(1);
  });

  test('"All rolls" off, one kind by hand: only that kind is thrown; the rest roll automatically, unmarked by a throw', async () => {
    settings.handRolls = 'off';
    settings.rollFilters = { hand: { initiative: 'always' } };
    const check = await rollD20((r) => (r.options = { type: 'skill-check' }));
    expect(overlay.open).not.toHaveBeenCalled();
    expect(deps.diceBox.roll).not.toHaveBeenCalled();
    expect(check.options.dicerHand).toBeUndefined();
    overlay.values = [9];
    const init = await rollD20((r) => (r.options = { type: 'initiative' }));
    expect(overlay.open).toHaveBeenCalledTimes(1);
    expect(init.terms[0].results).toEqual([{ result: 9, active: true }]);
    await vi.advanceTimersByTimeAsync(10000);
    // a kind set to Ask asks, whatever "All rolls" says
    settings.rollFilters = { hand: { initiative: 'ask' } };
    deps.ask = vi.fn(async () => false);
    const asked = await rollD20((r) => (r.options = { type: 'initiative' }));
    expect(deps.ask).toHaveBeenCalledTimes(1);
    expect(asked.options.dicerHand.fallback).toBe('auto');
  });

  test('"All rolls": unset follows the world default; the player’s own wins', async () => {
    settings.handRolls = '';
    settings.rollFiltersDefault = { hand: { all: 'always' } };
    overlay.values = [3];
    await rollD20();
    expect(overlay.open).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    settings.handRolls = 'off';
    const auto = await rollD20();
    expect(overlay.open).toHaveBeenCalledTimes(1);
    expect(auto.options.dicerHand).toBeUndefined();
  });

  test('required hand rolls: a player’s own No is ignored, the world’s No exempts the kind for everyone', async () => {
    const init = (r) => (r.options = { type: 'initiative' });
    settings.handRolls = 'off';
    settings.handRollsRequired = true;
    // the player cannot opt out alone
    settings.rollFilters = { hand: { initiative: false } };
    overlay.values = [5];
    await rollD20(init);
    expect(overlay.open).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    // the GM's world default does, whatever the player chose
    settings.rollFilters = { hand: { initiative: true } };
    settings.rollFiltersDefault = { hand: { initiative: false } };
    const auto = await rollD20(init);
    expect(overlay.open).toHaveBeenCalledTimes(1);
    expect(deps.diceBox.roll).not.toHaveBeenCalled();
    expect(auto.options.dicerHand).toBeUndefined();
    // the other kinds are still required
    await rollD20((r) => (r.options = { type: 'skill-check' }));
    expect(overlay.open).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10000);
    // the exempt kind with physics deciding: thrown for the roller
    settings.physicsResults = true;
    boxValues = [14];
    const phys = await rollD20(init);
    expect(overlay.open).toHaveBeenCalledTimes(2);
    expect(deps.diceBox.roll).toHaveBeenCalledTimes(1);
    expect(phys.terms[0].results).toEqual([{ result: 14, active: true }]);
    expect(phys.options.dicerHand).toMatchObject({ physics: true });
  });

  test('required hand rolls, an exempt kind the filters hide: decided unseen, as without the requirement', async () => {
    settings.handRollsRequired = true;
    settings.physicsResults = true;
    settings.rollFiltersDefault = { hand: { initiative: 'off' } };
    settings.rollFilters = { initiative: 'skip' };
    deps.throwUnseen = vi.fn(async (box, specs) => specs.map(() => 13));
    const hidden = await rollD20((r) => (r.options = { type: 'initiative' }));
    expect(deps.throwUnseen).toHaveBeenCalledTimes(1);
    expect(deps.diceBox.roll).not.toHaveBeenCalled(); // nothing on screen
    expect(hidden.terms[0].results).toEqual([{ result: 13, active: true }]);
    // a kind that is not exempt is still thrown, hidden or not
    settings.rollFiltersDefault = {};
    overlay.values = [4];
    await rollD20((r) => (r.options = { type: 'initiative' }));
    expect(overlay.open).toHaveBeenCalledTimes(1);
  });

  test('without physics decides, Ask answered automatically is the random of Foundry', async () => {
    settings.handRolls = 'ask';
    deps.ask = vi.fn(async () => false);
    const r = await rollD20();
    expect(deps.diceBox.roll).not.toHaveBeenCalled();
    expect(r.options.dicerHand.fallback).toBe('auto');
  });

  test('physics decides, but hand rolls required: the throw screen still opens', async () => {
    settings.physicsResults = true;
    settings.handRollsRequired = true;
    overlay.values = [9];
    const r = await rollD20();
    expect(overlay.open).toHaveBeenCalledTimes(1);
    expect(r.options.dicerHand.physics).toBeUndefined();
  });

  test('a roll 3.5 s after the landing opens the throw screen', async () => {
    overlay.values = [12];
    await rollD20();
    await vi.advanceTimersByTimeAsync(3500);
    const next = await rollD20();
    expect(overlay.open).toHaveBeenCalledTimes(2);
    expect(next.options.dicerHand.follow).toBeUndefined();
  });

  test('a follow-up does not extend the window', async () => {
    overlay.values = [12];
    await rollD20();
    await vi.advanceTimersByTimeAsync(2000);
    boxValues = [5];
    await rollD20(); // follow-up, 2 s after
    await vi.advanceTimersByTimeAsync(2000); // 4 s after the hand throw
    await rollD20();
    expect(overlay.open).toHaveBeenCalledTimes(2);
  });

  test('handFollowUps off opens the throw screen', async () => {
    settings.handFollowUps = false;
    overlay.values = [12];
    await rollD20();
    await vi.advanceTimersByTimeAsync(500);
    await rollD20();
    expect(overlay.open).toHaveBeenCalledTimes(2);
  });

  test('hand rolls required: a follow-up still throws itself', async () => {
    settings.handRollsRequired = true;
    overlay.values = [12];
    await rollD20();
    await vi.advanceTimersByTimeAsync(500);
    boxValues = [6];
    const next = await rollD20();
    expect(overlay.open).toHaveBeenCalledTimes(1);
    expect(next.options.dicerHand.follow).toBe(true);
    expect(next.terms[0].results[0].result).toBe(6);
  });

  test('ask mode: a follow-up is not asked', async () => {
    settings.handRolls = 'ask';
    overlay.values = [12];
    await rollD20();
    await vi.advanceTimersByTimeAsync(500);
    boxValues = [7];
    const next = await rollD20();
    expect(deps.ask).toHaveBeenCalledTimes(1);
    expect(next.options.dicerHand.follow).toBe(true);
    expect(next.terms[0].results[0].result).toBe(7);
  });

  test('a fallback does not open the window', async () => {
    overlay.open = vi.fn(async () => ({ values: null, handle: null, recording: null })); // cancelled
    await rollD20();
    overlay.open = vi.fn(async ({ specs }) => ({ values: specs.map(() => 9), handle: {}, recording: {} }));
    await vi.advanceTimersByTimeAsync(500);
    await rollD20();
    expect(overlay.open).toHaveBeenCalledTimes(1);
  });

  test("a follow-up whose dice never settle falls back 'timeout' after HAND_GRACE_MS", async () => {
    const { HAND_GRACE_MS } = await import('../../src/hand/chunk/resolve.js');
    overlay.values = [12];
    await rollD20();
    await vi.advanceTimersByTimeAsync(500);
    deps.diceBox.roll.mockImplementationOnce(() => ({
      values: new Promise(() => {}),
      handle: {},
      landed: new Promise(() => {}),
      finished: new Promise(() => {}),
    }));
    const roll = rollOf(new Die({ faces: 20 }));
    let done = false;
    const p = fulfill(new Resolver(roll, deps)).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(HAND_GRACE_MS - 10);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    await p;
    expect(roll.options.dicerHand.fallback).toBe('timeout');
  });

  test('a closed resolver falls back as cancelled', async () => {
    overlay.values = [12];
    await rollD20();
    await vi.advanceTimersByTimeAsync(500);
    const roll = rollOf(new Die({ faces: 20 }));
    const r = new Resolver(roll, deps);
    r._closed = true;
    const calls = deps.diceBox.roll.mock.calls.length;
    await fulfill(r);
    expect(roll.options.dicerHand.fallback).toBe('cancel');
    expect(deps.diceBox.roll.mock.calls.length).toBe(calls);
  });

  test('rolls queued behind a throw screen are not its follow-ups', async () => {
    // three rolls start at once (a GM's group save); the first is held for 5 s on the throw screen
    overlay.open = vi.fn(
      ({ specs }) => new Promise((res) => setTimeout(() => res({ values: specs.map(() => 8), handle: {}, recording: {} }), 5000)),
    );
    const rolls = [0, 1, 2].map(() => rollOf(new Die({ faces: 20 })));
    const done = Promise.all(rolls.map((r) => fulfill(new Resolver(r, deps))));
    await vi.advanceTimersByTimeAsync(3 * 5000 + 10);
    await done;
    expect(overlay.open).toHaveBeenCalledTimes(3);
    for (const r of rolls) expect(r.options.dicerHand.follow).toBeUndefined();
  });

  test('a blind follow-up throws ghost dice for the roller', async () => {
    overlay.values = [12];
    await rollD20();
    await vi.advanceTimersByTimeAsync(500);
    boxValues = [4];
    await rollD20((r) => (r.ghost = true));
    const [specs] = deps.diceBox.roll.mock.calls.at(-1);
    expect(specs.every((s) => s.ghost === true)).toBe(true);
  });
});

describe('initiative for several combatants at once (Roll All, Roll NPCs)', () => {
  let t0 = Date.now() + 90 * 3600e3;
  let lands;
  let Combat;
  let watchRollInitiative;
  let unseen; // the values the unseen physics decides, in order
  const init = (r) => (r.options = { type: 'initiative' });
  const rollD20 = async (prep) => {
    const roll = rollOf(new Die({ faces: 20 }));
    prep?.(roll);
    await fulfill(new Resolver(roll, deps));
    return roll;
  };
  /** Every pending landing, and the queue's bookkeeping after them. */
  const landAll = async () => {
    for (const land of lands.splice(0)) land();
    await vi.advanceTimersByTimeAsync(0);
  };
  const sideBySide = () => {
    Combat.prototype.rollInitiative = async function (ids) {
      this.rolls = await Promise.all(ids.map(() => rollD20(init)));
      return this;
    };
    watchRollInitiative(Combat.prototype);
  };

  beforeEach(async () => {
    t0 += 3600e3; // clear of every earlier throw's window
    vi.useFakeTimers({ now: t0 });
    settings.handRolls = 'off';
    settings.physicsResults = true;
    lands = [];
    unseen = [];
    deps.throwUnseen = vi.fn(async (box, specs) => specs.map(() => unseen.shift()));
    // DiceBox as it is live: the values are read at physics done, the dice land later.
    deps.diceBox.roll.mockImplementation((specs, opts) => {
      opts?.record?.({ rec: specs.length });
      return {
        read: Promise.resolve(specs.map(() => boxValues.shift())),
        values: new Promise(() => {}),
        handle: {},
        landed: new Promise((r) => lands.push(r)),
        finished: new Promise(() => {}),
      };
    });
    // Foundry's Combat#rollInitiative: one roll after the other, each awaited.
    Combat = class {
      rolls = [];
      async rollInitiative(ids, prep = init) {
        for (const id of typeof ids === 'string' ? [ids] : ids) this.rolls.push(await rollD20(prep));
        return this;
      }
    };
    ({ watchRollInitiative } = await import('../../src/hand/chunk/resolve.js'));
    watchRollInitiative(Combat.prototype);
  });
  afterEach(async () => {
    await landAll(); // frees the module-level queue for the next test
    vi.useRealTimers();
  });

  test('physics decides: every combatant is decided unseen, at once; nothing is thrown here, the messages show the dice', async () => {
    unseen = [3, 11, 19];
    const combat = new Combat();
    expect(await combat.rollInitiative(['a', 'b', 'c'])).toBe(combat);
    expect(deps.throwUnseen).toHaveBeenCalledTimes(3);
    expect(deps.diceBox.roll).not.toHaveBeenCalled();
    expect(combat.rolls.map((r) => r.terms[0].results[0].result)).toEqual([3, 11, 19]);
    for (const r of combat.rolls) {
      // n 0: no hand throw to replay, every screen shows the roll from its message
      expect(r.options.dicerHand).toMatchObject({ physics: true, n: 0 });
      expect(r.options.dicerHand.fallback).toBeUndefined();
      expect(handThrows.has(r.options.dicerHand.id)).toBe(false);
    }
  });

  test('rolls started side by side (PF2e) are decided unseen too', async () => {
    unseen = [5, 6, 7];
    sideBySide();
    const combat = await new Combat().rollInitiative(['a', 'b', 'c']);
    expect(deps.diceBox.roll).not.toHaveBeenCalled();
    expect(combat.rolls.map((r) => r.terms[0].results[0].result).sort()).toEqual([5, 6, 7]);
  });

  test('the unseen physics failing: Foundry rolls that combatant', async () => {
    deps.throwUnseen = vi.fn(async () => null);
    const combat = await new Combat().rollInitiative(['a', 'b']);
    expect(combat.rolls.map((r) => r.options.dicerHand.fallback)).toEqual(['auto', 'auto']);
    expect(deps.diceBox.roll).not.toHaveBeenCalled();
  });

  test('one combatant alone is rolled as before: thrown for the roller, a second single roll once the first has landed', async () => {
    boxValues = [3, 11];
    const combat = new Combat();
    await combat.rollInitiative(['a']);
    expect(deps.throwUnseen).not.toHaveBeenCalled();
    expect(combat.rolls[0].options.dicerHand).toMatchObject({ physics: true, n: 1 });
    let done = false;
    combat.rollInitiative('b').then(() => (done = true)); // a single id, as the tracker's die button sends
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    expect(deps.diceBox.roll).toHaveBeenCalledTimes(1);
    await landAll();
    expect(done).toBe(true);
    expect(deps.diceBox.roll).toHaveBeenCalledTimes(2);
  });

  test('other rolls made while the initiative is rolled are thrown as ever', async () => {
    unseen = [3];
    boxValues = [9];
    let i = 0;
    const combat = await new Combat().rollInitiative(['a', 'b'], (r) => (r.options = { type: i++ ? 'skill-check' : 'initiative' }));
    expect(deps.throwUnseen).toHaveBeenCalledTimes(1);
    expect(deps.diceBox.roll).toHaveBeenCalledTimes(1);
    expect(combat.rolls[1].options.dicerHand).toMatchObject({ physics: true, n: 1 });
  });

  test('without physics deciding nothing changes: Foundry rolls, no unseen throw', async () => {
    settings.physicsResults = false;
    settings.handRolls = 'always';
    settings.rollFilters = { hand: { initiative: 'off' } };
    const combat = await new Combat().rollInitiative(['a', 'b']);
    expect(deps.throwUnseen).not.toHaveBeenCalled();
    expect(deps.diceBox.roll).not.toHaveBeenCalled();
    expect(combat.rolls.map((r) => r.options.dicerHand)).toEqual([undefined, undefined]);
  });

  test('thrown by hand: still one throw screen at a time', async () => {
    settings.handRolls = 'always';
    let land;
    overlay.open = vi.fn(
      ({ specs }) => new Promise((res) => (land = () => res({ values: specs.map(() => 2), handle: {}, recording: {} }))),
    );
    sideBySide();
    const p = new Combat().rollInitiative(['a', 'b']);
    await vi.advanceTimersByTimeAsync(100);
    expect(overlay.open).toHaveBeenCalledTimes(1);
    land();
    await vi.advanceTimersByTimeAsync(0);
    expect(overlay.open).toHaveBeenCalledTimes(2);
    land();
    await p;
    expect(deps.throwUnseen).not.toHaveBeenCalled();
  });

  test('Ask: answered "automatically" or "the rest automatically", they are decided unseen; by hand, the throw screen', async () => {
    settings.handRolls = 'ask';
    const answers = ['yes', 'rest'];
    deps.ask = vi.fn(async () => answers.shift());
    overlay.values = [4];
    unseen = [8, 15];
    sideBySide();
    const combat = await new Combat().rollInitiative(['a', 'b', 'c']);
    expect(overlay.open).toHaveBeenCalledTimes(1);
    expect(deps.ask).toHaveBeenCalledTimes(2); // the third rolls with the rest
    expect(deps.throwUnseen).toHaveBeenCalledTimes(2);
    expect(deps.diceBox.roll).not.toHaveBeenCalled();
    expect(combat.rolls.map((r) => r.terms[0].results[0].result)).toEqual([4, 8, 15]);
  });

  test('the watch is set once per class and keeps the answer and a failure of the roll', async () => {
    const own = Combat.prototype.rollInitiative;
    watchRollInitiative(Combat.prototype);
    expect(Combat.prototype.rollInitiative).toBe(own);
    Combat.prototype.rollInitiative = async () => {
      throw new Error('no combat');
    };
    watchRollInitiative(Combat.prototype);
    await expect(new Combat().rollInitiative(['a', 'b'])).rejects.toThrow('no combat');
    // the failed call is over: a single roll after it is thrown for the roller as before
    boxValues = [3];
    await rollD20(init);
    expect(deps.diceBox.roll).toHaveBeenCalledTimes(1);
    expect(deps.throwUnseen).not.toHaveBeenCalled();
  });
});

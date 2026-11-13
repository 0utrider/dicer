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
    expect(deps.ask).toHaveBeenCalledWith(r.roll, 20);
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

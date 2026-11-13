// @vitest-environment jsdom
/**
 * The free-roll dice tray (lazy hand chunk). H-14: a real Roll is built from the formula, the
 * read results are pushed into its DiceTerms, then evaluate({allowInteractive: false}) rolls
 * what is missing and computes the total; toMessage posts it in the chosen message mode. The
 * overlay and DiceBox are fakes; Foundry's Roll is a small stand-in that parses tray formulas.
 */
import { planThrow } from '../../src/throw/throw-planner.js';

const overlay = vi.hoisted(() => ({ open: null }));
vi.mock('../../src/hand/chunk/overlay.js', () => ({ openThrowOverlay: (o) => overlay.open(o) }));

const { formulaFromCounts, throwTray, trayContext, TRAY_DICE, TRAY_MODES } = await import(
  '../../src/hand/chunk/tray.js'
);
const { handThrows } = await import('../../src/hand/chunk/resolve.js');

// ---- Foundry stand-ins (dice/terms/dice.mjs, dice/roll.mjs as far as the tray uses them) ----
class DiceTerm {
  constructor({ number = 1, faces = 6, minValue = 1 } = {}) {
    Object.assign(this, { number, faces, minValue, modifiers: [], results: [], options: {} });
  }
  get denomination() {
    return `d${this.faces}`;
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
class FateDie extends DiceTerm {
  static DENOMINATION = 'f';
  constructor(d = {}) {
    super({ ...d, faces: 3, minValue: -1 });
  }
  get denomination() {
    return 'f';
  }
}

/** Parses 'NdX + NdF + M' / '... - M' (what formulaFromCounts makes). */
class FakeRoll {
  static made = [];
  constructor(formula) {
    this.formula = formula;
    this.options = {};
    this.terms = [];
    this.mod = 0;
    for (const m of formula.replace(/\s+/g, '').matchAll(/([+-]?)(\d+)(?:d(\d+|F))?/g)) {
      if (m[3] === 'F') this.terms.push(new FateDie({ number: +m[2] }));
      else if (m[3]) this.terms.push(new DiceTerm({ number: +m[2], faces: +m[3] }));
      else this.mod += (m[1] === '-' ? -1 : 1) * +m[2];
    }
    this.evaluated = 0;
    this.toMessage = vi.fn(async () => ({ id: 'msg1' }));
    FakeRoll.made.push(this);
  }
  get dice() {
    return this.terms;
  }
  async evaluate(options) {
    this.evaluated++;
    this.evalOptions = options;
    for (const t of this.terms) {
      for (let n = t.results.length; n < t.number; n++) t.results.push({ result: t.randomFace(), active: true });
    }
    this.total = this.terms.flatMap((t) => t.results).reduce((s, r) => s + r.result, 0) + this.mod;
    return this;
  }
}

let settings;
let deps;
let user;
const RECT = { left: 10, top: 20, width: 300, height: 200 };

beforeEach(() => {
  settings = { handRolls: 'off', handRollsAllowed: 'all', handRollTimeout: 60, maxDice: 20 };
  user = { id: 'u1', role: 1, isGM: false };
  let id = 0;
  globalThis.foundry = { utils: { randomID: () => `id${++id}` } };
  handThrows.clear();
  FakeRoll.made = [];
  deps = {
    diceBox: { hand: {}, _getAppearance: () => ({}) },
    areas: { rectFor: vi.fn(() => RECT) },
    decorateFor: vi.fn(() => undefined),
    plan: (roll, o) => planThrow(roll, o),
    getSetting: (k) => settings[k],
    hooks: { callAll: vi.fn() },
    user: () => user,
  };
  overlay.values = [];
  overlay.open = vi.fn(async ({ specs }) => ({
    values: specs.map((_, i) => overlay.values[i]),
    handle: { h: 1 },
    recording: { rec: 1 },
  }));
});

afterEach(() => {
  delete globalThis.foundry;
  delete globalThis.game;
});

const tray = (choice) => throwTray(choice, { deps, Roll: FakeRoll });

test("formulaFromCounts({d6: 2, d20: 1}, 3) -> '2d6 + 1d20 + 3'; dF -> '1dF'", () => {
  expect(formulaFromCounts({ d6: 2, d20: 1 }, 3)).toBe('2d6 + 1d20 + 3');
  expect(formulaFromCounts({ dF: 1 }, 0)).toBe('1dF');
  // tray order, negatives, junk and a modifier alone
  expect(formulaFromCounts({ d20: 1, d4: 3, d100: 1, d2: 2 }, -2)).toBe('3d4 + 1d20 + 1d100 + 2d2 - 2');
  expect(formulaFromCounts({ d6: -1, d8: 'x', d12: 1.7 }, 'y')).toBe('1d12');
  expect(formulaFromCounts({}, 4)).toBe('4');
  expect(formulaFromCounts({}, 0)).toBe('');
  // the modifier is a finite integer within ±9999
  expect(formulaFromCounts({ d6: 1 }, 1e9)).toBe('1d6 + 9999');
  expect(formulaFromCounts({ d6: 1 }, -Infinity)).toBe('1d6 - 9999');
  expect(formulaFromCounts({ d6: 1 }, Infinity)).toBe('1d6 + 9999');
  expect(formulaFromCounts({ d6: 1 }, NaN)).toBe('1d6');
  expect(trayContext({ modifier: '123456' }).modifier).toBe(9999);
  expect(TRAY_DICE).toEqual(['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'd2', 'dF']);
});

test("the tray Roll's dice results equal the thrown values and its total is right (pre-filled evaluate)", async () => {
  overlay.values = [3, 5, 17];
  const msg = await tray({ counts: { d6: 2, d20: 1 }, modifier: 3, mode: 'public' });
  expect(msg).toEqual({ id: 'msg1' });
  const [roll] = FakeRoll.made;
  expect(roll.formula).toBe('2d6 + 1d20 + 3');
  const [d6, d20] = roll.dice;
  expect(d6.results).toEqual([
    { result: 3, active: true },
    { result: 5, active: true },
  ]);
  expect(d20.results).toEqual([{ result: 17, active: true }]);
  expect(roll.evaluated).toBe(1);
  expect(roll.evalOptions).toEqual({ allowInteractive: false });
  expect(roll.total).toBe(28);
  // posted once, in the chosen mode, and never re-evaluated by toMessage
  expect(roll.toMessage).toHaveBeenCalledTimes(1);
  expect(roll.toMessage).toHaveBeenCalledWith({}, { messageMode: 'public' });
  // thrown in the user's area, as a normal hand throw, and stored for Task 8 (R10)
  const o = overlay.open.mock.calls[0][0];
  expect(o.rect).toBe(RECT);
  expect(o.getRect()).toBe(RECT);
  expect(deps.areas.rectFor).toHaveBeenCalledWith({ rollerId: 'u1' });
  expect(o.ghostOnRelease).toBe(false);
  expect(o.timeoutMs).toBe(60000);
  expect(o.specs.map((s) => [s.type, s.key, s.free])).toEqual([
    ['d6', '0:0:0', true],
    ['d6', '0:1:0', true],
    ['d20', '1:0:0', true],
  ]);
  const hand = roll.options.dicerHand;
  expect(hand).toEqual({ id: hand.id, by: 'u1', n: 3 });
  expect(handThrows.get(hand.id)).toEqual({ recording: { rec: 1 }, handle: { h: 1 }, specs: o.specs, extras: [] });
});

test('dice the throw cannot hold are rolled by Foundry and counted in partial; dF and d100 read', async () => {
  settings.maxDice = 3;
  // d100 (tens + ones) and one dF fit; the second dF is past maxDice
  overlay.values = [null, 47, -1];
  await tray({ counts: { d100: 1, dF: 2 }, modifier: 0, mode: 'public' });
  const [roll] = FakeRoll.made;
  const [d100, df] = roll.dice;
  expect(d100.results).toEqual([{ result: 47, active: true }]);
  expect(df.results).toEqual([
    { result: -1, active: true, failure: true },
    { result: 1, active: true }, // Foundry's random face (the stand-in's max)
  ]);
  expect(roll.options.dicerHand).toMatchObject({ n: 3, partial: 1 });
  expect(roll.total).toBe(47);
});

test('blind opens the overlay with ghostOnRelease', async () => {
  overlay.values = [9];
  await tray({ counts: { d20: 1 }, mode: 'blind' });
  expect(overlay.open.mock.calls[0][0].ghostOnRelease).toBe(true);
  expect(FakeRoll.made[0].toMessage).toHaveBeenCalledWith({}, { messageMode: 'blind' });
  // the roller sees the dice in every other mode; a GM sees blind rolls too
  for (const mode of ['public', 'gm', 'self']) {
    overlay.open.mockClear();
    await tray({ counts: { d20: 1 }, mode });
    expect(overlay.open.mock.calls[0][0].ghostOnRelease).toBe(false);
  }
  user = { id: 'g1', role: 4, isGM: true };
  overlay.open.mockClear();
  await tray({ counts: { d20: 1 }, mode: 'blind' });
  expect(overlay.open.mock.calls[0][0].ghostOnRelease).toBe(false);
});

test('cancel posts nothing', async () => {
  for (const out of [{ cancelled: true }, { timedOut: true }, { values: null }]) {
    overlay.open = vi.fn(async () => out);
    FakeRoll.made = [];
    expect(await tray({ counts: { d6: 2 }, mode: 'public' })).toBeNull();
    expect(FakeRoll.made.every((r) => r.toMessage.mock.calls.length === 0 && r.evaluated === 0)).toBe(true);
  }
  expect(handThrows.size).toBe(0);
});

test('no dice, no engine or a user not allowed posts nothing and opens nothing', async () => {
  expect(await tray({ counts: {}, modifier: 5 })).toBeNull();
  settings.handRollsAllowed = 'gm';
  expect(await tray({ counts: { d6: 1 } })).toBeNull();
  expect(await throwTray({ counts: { d6: 1 } }, { deps: null, Roll: FakeRoll })).toBeNull();
  expect(overlay.open).not.toHaveBeenCalled();
  expect(FakeRoll.made).toEqual([]);
});

test('the picker offers the nine dice, a modifier and the four message modes', () => {
  globalThis.game = {
    i18n: { localize: (k) => k },
    settings: { get: (s, k) => (k === 'messageMode' ? 'gm' : undefined) },
  };
  globalThis.CONFIG = {
    ChatMessage: {
      modes: {
        public: { label: 'CHAT.MODES.public' },
        gm: { label: 'CHAT.MODES.gm' },
        blind: { label: 'CHAT.MODES.blind' },
        self: { label: 'CHAT.MODES.self' },
        ic: { label: 'CHAT.MODES.ic' },
      },
    },
  };
  try {
    const ctx = trayContext({ counts: { d6: 2 }, modifier: 1 });
    expect(ctx.dice.map((d) => [d.key, d.count])).toEqual(TRAY_DICE.map((k) => [k, k === 'd6' ? 2 : 0]));
    expect(ctx.modifier).toBe(1);
    expect(TRAY_MODES).toEqual(['public', 'gm', 'blind', 'self']);
    expect(ctx.modes).toEqual([
      { value: 'public', label: 'CHAT.MODES.public', selected: false },
      { value: 'gm', label: 'CHAT.MODES.gm', selected: true }, // the core chat mode
      { value: 'blind', label: 'CHAT.MODES.blind', selected: false },
      { value: 'self', label: 'CHAT.MODES.self', selected: false },
    ]);
    expect(ctx.formula).toBe('2d6 + 1');
    expect(trayContext({ counts: {}, mode: 'blind' }).modes.find((m) => m.selected).value).toBe('blind');
  } finally {
    delete globalThis.CONFIG;
  }
});

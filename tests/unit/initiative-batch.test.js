import { join, mark, watchRollInitiative, rollingMany, GAP_MS, MAX_DICE } from '../../src/foundry/initiative-batch.js';

const AREA = { left: 0, top: 0, width: 300, height: 200 };
const d20 = (value) => ({ type: 'd20', value });
const initiativeMessage = (flags = {}) => ({
  flags: { core: { initiativeRoll: true }, ...flags },
  updateSource(change) {
    this.flags = { ...this.flags, ...change.flags };
  },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  delete globalThis.foundry;
});

describe('join', () => {
  test('the rolls of one batch in one area are thrown together, once, GAP_MS after the last came in', async () => {
    const landed = Promise.resolve('landed');
    const casts = [0, 1, 2].map(() => vi.fn(() => landed));
    const opts = { area: AREA, capacityDice: 2, pet: { kind: 'cat' } };
    const waits = casts.map((cast, i) => join('b1', [d20(i + 1)], i ? { area: { ...AREA } } : opts, cast));
    await vi.advanceTimersByTimeAsync(GAP_MS - 1);
    for (const cast of casts) expect(cast).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(casts[0]).toHaveBeenCalledTimes(1);
    // every die, the area and pet of the first roll, sized by the throw itself
    expect(casts[0]).toHaveBeenCalledWith([d20(1), d20(2), d20(3)], { area: AREA, pet: { kind: 'cat' } });
    expect(casts[1]).not.toHaveBeenCalled();
    expect(casts[2]).not.toHaveBeenCalled();
    expect(await Promise.all(waits)).toEqual(['landed', 'landed', 'landed']);
    expect(opts.capacityDice).toBe(2); // the gate's options are not changed
  });

  test('a message that comes in within the gap keeps the batch open', async () => {
    const cast = vi.fn(() => Promise.resolve());
    join('b2', [d20(1)], null, cast);
    await vi.advanceTimersByTimeAsync(GAP_MS - 10);
    join('b2', [d20(2)], null, cast);
    await vi.advanceTimersByTimeAsync(GAP_MS - 10);
    expect(cast).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(cast).toHaveBeenCalledWith([d20(1), d20(2)], null); // no area: the whole stage
  });

  test('PF2e posts its cards one by one, up to 150 ms apart on a busy machine: still one throw', async () => {
    const cast = vi.fn(() => Promise.resolve());
    join('b2b', [d20(1)], null, cast);
    await vi.advanceTimersByTimeAsync(150);
    join('b2b', [d20(2)], null, cast);
    await vi.advanceTimersByTimeAsync(GAP_MS);
    expect(cast).toHaveBeenCalledTimes(1);
    expect(cast).toHaveBeenCalledWith([d20(1), d20(2)], null);
  });

  test('one roll alone is thrown as the gate would have', async () => {
    const cast = vi.fn(() => Promise.resolve('own'));
    const wait = join('b3', [d20(9)], { area: AREA }, cast);
    await vi.advanceTimersByTimeAsync(GAP_MS);
    expect(cast).toHaveBeenCalledWith();
    expect(await wait).toBe('own');
  });

  test('other batches and other areas (the GM corner) are thrown apart', async () => {
    const cast = vi.fn(() => Promise.resolve());
    join('b4', [d20(1)], { area: AREA }, cast);
    join('b4', [d20(2)], { area: AREA }, cast);
    join('b4', [d20(3)], { area: { ...AREA, left: 500 } }, cast);
    join('b5', [d20(4)], { area: AREA }, cast);
    await vi.advanceTimersByTimeAsync(GAP_MS);
    expect(cast.mock.calls.map(([specs]) => specs?.map((s) => s.value))).toEqual([[1, 2], undefined, undefined]);
  });

  test('a throw holds MAX_DICE at most: a larger batch is thrown in several', async () => {
    const cast = vi.fn(() => Promise.resolve());
    for (let i = 0; i < MAX_DICE + 5; i++) join('b6', [d20(i)], null, cast);
    expect(cast).toHaveBeenCalledTimes(1); // the full one at once
    expect(cast.mock.calls[0][0]).toHaveLength(MAX_DICE);
    await vi.advanceTimersByTimeAsync(GAP_MS);
    expect(cast).toHaveBeenCalledTimes(2);
    expect(cast.mock.calls[1][0]).toHaveLength(5);
  });

  test('a throw that fails rejects every roll in it', async () => {
    const cast = () => {
      throw new Error('no box');
    };
    const waits = [join('b7', [d20(1)], null, cast), join('b7', [d20(2)], null, cast)];
    const seen = Promise.allSettled(waits);
    await vi.advanceTimersByTimeAsync(GAP_MS);
    expect((await seen).map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });
});

describe('watchRollInitiative', () => {
  let Combat;
  let created;
  beforeEach(() => {
    let n = 0;
    globalThis.foundry = { utils: { randomID: () => `batch${++n}` } };
    created = [];
    Combat = class {
      async rollInitiative(ids) {
        for (const id of typeof ids === 'string' ? [ids] : ids) {
          await null;
          const message = initiativeMessage({ id });
          mark(message); // preCreateChatMessage
          created.push(message);
        }
        return this;
      }
    };
    watchRollInitiative(Combat.prototype, null);
  });

  test('the initiative messages of a call for several combatants carry its batch id', async () => {
    const combat = new Combat();
    const p = combat.rollInitiative(['a', 'b', 'c']);
    expect(rollingMany()).toBe(1);
    expect(await p).toBe(combat);
    expect(rollingMany()).toBe(0);
    const ids = created.map((m) => m.flags.dicer?.batch);
    expect(ids[0]).toBeTruthy();
    expect(ids).toEqual([ids[0], ids[0], ids[0]]);
    // the next call is another batch
    await combat.rollInitiative(['d', 'e']);
    expect(created[3].flags.dicer.batch).not.toBe(ids[0]);
  });

  test('a call for one combatant marks nothing', async () => {
    const combat = new Combat();
    await combat.rollInitiative(['a']);
    await combat.rollInitiative('b');
    expect(created.map((m) => m.flags.dicer)).toEqual([undefined, undefined]);
  });

  test('only initiative messages are marked, and never twice; a message that cannot be marked is left', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const other = { flags: {}, updateSource: vi.fn() };
    const marked = initiativeMessage({ dicer: { batch: 'theirs' } });
    const broken = { flags: { core: { initiativeRoll: true } } };
    Combat.prototype.rollInitiative = async () => {
      for (const m of [other, marked, broken, null]) mark(m);
    };
    watchRollInitiative(Combat.prototype, null);
    await new Combat().rollInitiative(['a', 'b']);
    expect(other.updateSource).not.toHaveBeenCalled();
    expect(marked.flags.dicer.batch).toBe('theirs');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    // outside a call nothing is marked
    const late = initiativeMessage();
    mark(late);
    expect(late.flags.dicer).toBeUndefined();
  });

  test('set once per method; a failing roll ends the batch; the listener is registered once and cannot return false', async () => {
    const own = Combat.prototype.rollInitiative;
    const hooks = { on: vi.fn() };
    watchRollInitiative(Combat.prototype, hooks);
    watchRollInitiative(Combat.prototype, hooks);
    expect(Combat.prototype.rollInitiative).toBe(own);
    expect(hooks.on).toHaveBeenCalledTimes(1);
    const [name, listener] = hooks.on.mock.calls[0];
    expect(name).toBe('preCreateChatMessage');
    expect(listener(initiativeMessage())).toBeUndefined();
    Combat.prototype.rollInitiative = async () => {
      throw new Error('no combat');
    };
    watchRollInitiative(Combat.prototype, hooks);
    await expect(new Combat().rollInitiative(['a', 'b'])).rejects.toThrow('no combat');
    expect(rollingMany()).toBe(0);
    expect(() => watchRollInitiative(undefined, hooks)).not.toThrow();
    expect(() => watchRollInitiative({}, hooks)).not.toThrow();
  });
});

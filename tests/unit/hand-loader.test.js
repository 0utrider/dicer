import { readFileSync } from 'node:fs';
import { loadHand, prefetchHand, handNow, _setHandImport } from '../../src/hand/hand-loader.js';

afterEach(() => vi.restoreAllMocks());

test('the loader is the only world-start seam: no static import, the chunk only by import()', () => {
  const src = readFileSync('src/hand/hand-loader.js', 'utf8');
  expect(src).not.toMatch(/^\s*import\s/m);
  expect(src).toContain("import('./hand.js')");
});

test('imports the chunk once, on demand, and attaches it to the box', async () => {
  const handFor = vi.fn();
  const mod = { handFor };
  const load = vi.fn(async () => mod);
  _setHandImport(load);
  expect(load).not.toHaveBeenCalled();
  const box = {};
  const [a, b] = await Promise.all([loadHand(box), loadHand(box)]);
  expect(a).toBe(mod);
  expect(b).toBe(mod);
  expect(await loadHand()).toBe(mod); // no box: the module only
  expect(load).toHaveBeenCalledTimes(1);
  expect(handFor).toHaveBeenCalledTimes(2);
  expect(handFor).toHaveBeenCalledWith(box);
});

test('a failing import warns once and resolves null; never retried', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const load = vi.fn(() => Promise.reject(new Error('offline')));
  _setHandImport(load);
  expect(await loadHand({})).toBeNull();
  expect(await loadHand({})).toBeNull();
  expect(load).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('the real chunk is marked and carries the hand code', async () => {
  _setHandImport(() => import('../../src/hand/hand.js'));
  const m = await loadHand();
  expect(m.CHUNK).toBe('dicer-hand-chunk');
  for (const k of [
    'handFor',
    'readFree',
    'handEdge',
    'encodeTrajectory',
    'decodeTrajectory',
    'placeTrajectory',
    'replaySource',
    'sendHand',
    'replayFor',
  ])
    expect(typeof m[k]).toBe('function');
});

test('handNow: the chunk synchronously once a load resolved, else null', async () => {
  const mod = { handFor: () => {} };
  _setHandImport(async () => mod);
  expect(handNow()).toBeNull();
  const p = loadHand();
  expect(handNow()).toBeNull();
  await p;
  expect(handNow()).toBe(mod);
  _setHandImport(async () => mod);
  expect(handNow()).toBeNull();
});

describe('H-20: the chunk is prefetched at idle after ready', () => {
  test('prefetchHand loads the chunk for the box', async () => {
    const handFor = vi.fn();
    const load = vi.fn(async () => ({ handFor }));
    _setHandImport(load);
    const box = {};
    prefetchHand(box, () => true);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(handFor).toHaveBeenCalledWith(box);
  });

  test('M8: only when this user could throw by hand (want() true); a failing want() fetches nothing', async () => {
    const load = vi.fn(async () => ({ handFor: () => {} }));
    _setHandImport(load);
    prefetchHand({}, () => false);
    prefetchHand({}, () => {
      throw new Error('not a registered game setting');
    });
    await flush();
    expect(load).not.toHaveBeenCalled();
    prefetchHand({}, () => true);
    prefetchHand({}, () => true);
    await flush();
    expect(load).toHaveBeenCalledTimes(1); // imported once
  });

  test('M8: wantsHand: allowed and (on, required, or a die on dicer)', async () => {
    const { wantsHand } = await import('../../src/hand/shell.js');
    const player = { role: 1, isGM: false };
    const get = (s) => (k) => ({ handRolls: 'off', handRollsAllowed: 'all', handRollsRequired: false, ...s })[k];
    expect(wantsHand(player, get({}), {})).toBe(false); // a default world: hand rolls off, no dicer die
    expect(wantsHand(player, get({}), null)).toBe(false);
    expect(wantsHand(player, get({}), { d20: 'manual' })).toBe(false);
    expect(wantsHand(player, get({ handRolls: 'ask' }), {})).toBe(true);
    expect(wantsHand(player, get({ handRolls: 'always' }), {})).toBe(true);
    expect(wantsHand(player, get({ handRollsRequired: true }), {})).toBe(true);
    expect(wantsHand(player, get({}), { d20: 'dicer' })).toBe(true); // picked in Foundry's window
    // not allowed: never
    expect(wantsHand(player, get({ handRolls: 'always', handRollsAllowed: 'gm' }), { d20: 'dicer' })).toBe(false);
    expect(wantsHand(player, get({ handRollsRequired: true, handRollsAllowed: 'none' }), {})).toBe(false);
  });

  test('diceOnDicer: "All rolls" or any kind by hand (the player’s choice over the world’s), required, or physics', async () => {
    const { diceOnDicer } = await import('../../src/hand/shell.js');
    const get = (s) => (k) => ({ handRolls: '', handRollsRequired: false, physicsResults: false, rollFilters: {}, rollFiltersDefault: {}, ...s })[k];
    expect(diceOnDicer(get({}))).toBe(false);
    expect(diceOnDicer(get({ handRolls: 'off' }))).toBe(false);
    expect(diceOnDicer(get({ handRolls: 'ask' }))).toBe(true);
    expect(diceOnDicer(get({ handRollsRequired: true }))).toBe(true);
    expect(diceOnDicer(get({ physicsResults: true }))).toBe(true);
    // "All rolls" off, one kind by hand
    expect(diceOnDicer(get({ handRolls: 'off', rollFilters: { hand: { initiative: 'always' } } }))).toBe(true);
    expect(diceOnDicer(get({ handRolls: 'off', rollFilters: { hand: { initiative: 'off' } } }))).toBe(false);
    // the world's "All rolls" where the player left the default; the player's own off wins
    expect(diceOnDicer(get({ rollFiltersDefault: { hand: { all: 'always' } } }))).toBe(true);
    expect(diceOnDicer(get({ handRolls: 'off', rollFiltersDefault: { hand: { all: 'always' } } }))).toBe(false);
    // the world's kind, unless the player turned that kind off
    expect(diceOnDicer(get({ handRolls: 'off', rollFiltersDefault: { hand: { damage: 'ask' } } }))).toBe(true);
    expect(diceOnDicer(get({ handRolls: 'off', rollFilters: { hand: { damage: 'off' } }, rollFiltersDefault: { hand: { damage: 'ask' } } }))).toBe(false);
    // junk and missing settings: off
    expect(diceOnDicer(get({ rollFilters: 'junk', rollFiltersDefault: null }))).toBe(false);
    expect(diceOnDicer(get({ rollFilters: undefined, rollFiltersDefault: undefined, handRolls: undefined }))).toBe(false);
  });

  test('main.js prefetches in an idle callback at ready, and the pets read DiceBox.holding', () => {
    const src = readFileSync('src/main.js', 'utf8');
    const ready = src.slice(src.indexOf("Hooks.once('ready'"));
    expect(ready).toContain('idle(() => prefetchHand(diceBox, () => wantsHand(game.user, getSetting, getCore())));');
    expect(src).toContain(
      "const idle = (run) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 200));",
    );
    expect(src).toContain('holding: () => box?.holding');
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

// @vitest-environment jsdom
/** Roll stats: the record (src/stats/stats.js), the recorder (src/stats/recorder.js) and the window's content (src/ui/roll-stats.js). */
import { describe, expect, test, vi } from 'vitest';
import {
  RECENT_KEEP,
  addRolls,
  cleanLabel,
  d20sOf,
  dayKey,
  emptyStats,
  isPublicRoll,
  readStats,
} from '../../src/stats/stats.js';
import {
  SESSION_MAX_MS,
  luckOf,
  mergeStats,
  sessionFrom,
  summarize,
} from '../../src/stats/summary.js';
import { DELAY, createStatsRecorder } from '../../src/stats/recorder.js';
import { buildStats, clearUser, luckiest, moodFor, statRows } from '../../src/ui/roll-stats.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 10, 17, 21, 0).getTime();
const d20 = (...results) => ({
  faces: 20,
  results: results.map((r) => (typeof r === 'number' ? { result: r, active: true } : r)),
});
const roll = (...dice) => ({ dice });

describe('reading d20s from rolls', () => {
  test('active d20 results only, in order; other dice and dropped results skipped', () => {
    const adv = d20(17, { result: 4, active: false, discarded: true });
    expect(
      d20sOf([roll(adv, { faces: 6, results: [{ result: 6, active: true }] }), roll(d20(1))]),
    ).toEqual([17, 1]);
  });
  test('a roll whose dice getter throws is skipped', () => {
    const bad = {
      get dice() {
        throw new Error('no');
      },
    };
    expect(d20sOf([bad, roll(d20(20))])).toEqual([20]);
  });
  test('flavour becomes a short plain label', () => {
    expect(cleanLabel('<h4 class="x">Fortitude&nbsp;Save</h4>  <span>DC 18</span>')).toBe(
      'Fortitude Save DC 18',
    );
    expect(cleanLabel('x'.repeat(80))).toHaveLength(48);
    expect(cleanLabel(undefined)).toBe('');
  });
});

describe('the record', () => {
  test('counts by day, keeps the latest 20 and 1 labels, the longest run of 15+', () => {
    let r = addRolls(emptyStats(), [15, 16, 20], { ts: NOW, label: 'Attack' });
    r = addRolls(r, [1, 18], { ts: NOW + 1000, label: 'Reflex' });
    const day = r.days[dayKey(NOW)];
    expect(day.c[19]).toBe(1);
    expect(day.c[0]).toBe(1);
    expect(day.run).toBe(3);
    expect(day.hi).toBe('Attack');
    expect(day.lo).toBe('Reflex');
    expect(r.streak).toBe(1);
    expect(r.recent.map((e) => e[1])).toEqual([15, 16, 20, 1, 18]);
    expect(r.recent[2]).toEqual([NOW, 20, 'Attack']);
    expect(r.recent[0]).toHaveLength(2); // only a 20 or a 1 carries a label
  });
  test('a run carries over into the next roll', () => {
    const r = addRolls(addRolls(emptyStats(), [19, 18], { ts: NOW }), [17], { ts: NOW + 1 });
    expect(r.days[dayKey(NOW)].run).toBe(3);
  });
  test('recent stays capped', () => {
    const r = addRolls(emptyStats(), Array(RECENT_KEEP + 7).fill(10), { ts: NOW });
    expect(r.recent).toHaveLength(RECENT_KEEP);
    expect(r.days[dayKey(NOW)].c[9]).toBe(RECENT_KEEP + 7);
  });
  test('a malformed flag reads as empty pieces, never throws', () => {
    const r = readStats({
      days: { nope: { c: [1] }, '2026-11-17': { c: Array(20).fill(1), run: 'x' } },
      recent: [[1, 25], [2, 3], 'x'],
      streak: -1,
    });
    expect(Object.keys(r.days)).toEqual(['2026-11-17']);
    expect(r.days['2026-11-17'].run).toBe(0);
    expect(r.recent).toEqual([[2, 3]]);
    expect(r.streak).toBe(0);
    expect(readStats(null)).toEqual(emptyStats());
  });
  test('adding returns a new record and leaves the stored one alone', () => {
    const stored = addRolls(emptyStats(), [5], { ts: NOW });
    const copy = structuredClone(stored);
    addRolls(stored, [6], { ts: NOW });
    expect(stored).toEqual(copy);
  });
  test('merging sums counts and interleaves recent by time', () => {
    const a = addRolls(emptyStats(), [20], { ts: NOW, label: 'A' });
    const b = addRolls(emptyStats(), [1, 2], { ts: NOW - 5, label: 'B' });
    const m = mergeStats(a, b);
    expect(m.days[dayKey(NOW)].c.reduce((x, y) => x + y)).toBe(3);
    expect(m.recent.map((e) => e[1])).toEqual([1, 2, 20]);
  });
});

describe('scopes', () => {
  const rec = () => {
    let r = addRolls(emptyStats(), [20, 20], { ts: NOW - 40 * DAY, label: 'Old crit' });
    r = addRolls(r, [1], { ts: NOW - 10 * DAY, label: 'Last week' });
    return addRolls(r, [12, 8], { ts: NOW - 60 * 1000 });
  };
  test('Tonight counts only recent rolls since the session start', () => {
    const s = summarize(rec(), 'session', { now: NOW, from: sessionFrom(NOW, 0) });
    expect(s.n).toBe(2);
    expect(s.avg).toBe(10);
    expect(s.best).toBeNull();
  });
  test('Tonight never reaches back past 12 hours, and a New session cuts it shorter', () => {
    expect(sessionFrom(NOW, 0)).toBe(NOW - SESSION_MAX_MS);
    expect(sessionFrom(NOW, NOW - 1000)).toBe(NOW - 1000);
    expect(summarize(rec(), 'session', { now: NOW, from: NOW - 1000 }).n).toBe(0);
  });
  test('the last 30 days and all time read the day buckets', () => {
    const month = summarize(rec(), 'month', { now: NOW });
    expect(month.n).toBe(3);
    expect(month.worst).toBe('Last week');
    expect(month.best).toBeNull();
    const all = summarize(rec(), 'all', { now: NOW });
    expect(all.n).toBe(5);
    expect(all.twenties).toBe(2);
    expect(all.best).toBe('Old crit');
    expect(all.run).toBe(2);
  });
  test('luck is judged from 10 d20s, 0.8 either side of 10.5', () => {
    expect(luckOf({ n: 9, avg: 20 })).toBe('few');
    expect(luckOf({ n: 10, avg: 11.4 })).toBe('hot');
    expect(luckOf({ n: 10, avg: 9.6 })).toBe('cursed');
    expect(luckOf({ n: 10, avg: 11 })).toBe('fair');
  });
});

test('a roll is public unless blind or whispered', () => {
  expect(isPublicRoll({ whisper: [] })).toBe(true);
  expect(isPublicRoll({ whisper: ['gm'] })).toBe(false);
  expect(isPublicRoll({ whisper: [], blind: true })).toBe(false);
  expect(isPublicRoll({ whisper: new Set(['a']) })).toBe(false);
});

describe('the recorder', () => {
  const user = (id, flag) => {
    const flags = { stats: flag };
    return {
      id,
      getFlag: (m, k) => flags[k],
      setFlag: vi.fn(async (m, k, v) => (flags[k] = v)),
      flags,
    };
  };
  const setup = ({ me = user('p1'), gm = false, stored = {}, on = true } = {}) => {
    const settings = { rollStats: on, rollStatsHidden: stored };
    const setSetting = vi.fn(async (k, v) => (settings[k] = v));
    const rec = createStatsRecorder({
      getSetting: (k) => settings[k],
      setSetting,
      currentUser: () => me,
      isActiveGM: () => gm,
      now: () => NOW,
      schedule: () => 1,
      cancel: () => {},
    });
    return { rec, me, settings, setSetting };
  };
  const msg = (o) => ({
    isRoll: true,
    rolls: [roll(d20(20))],
    whisper: [],
    author: { id: 'p1' },
    flavor: 'Strike',
    isContentVisible: true,
    ...o,
  });

  test("leaves out a GM's roll flagged noStats, and counts a player's flagged roll all the same", async () => {
    const flags = { dicer: { noStats: true } };
    const gm = setup();
    gm.rec.onCreate(msg({ flags, author: { id: gm.me.id, isGM: true } }));
    await gm.rec.flush();
    expect(gm.me.setFlag).not.toHaveBeenCalled();
    const player = setup();
    player.rec.onCreate(msg({ flags, author: { id: player.me.id, isGM: false } }));
    await player.rec.flush();
    expect(player.me.setFlag).toHaveBeenCalledTimes(1);
  });

  test("a public roll goes to its author's flag, after the delay, added to what is stored", async () => {
    const me = user('p1', addRolls(emptyStats(), [3], { ts: NOW - 1 }));
    const { rec } = setup({ me });
    rec.onCreate(msg());
    expect(me.setFlag).not.toHaveBeenCalled();
    await rec.flush();
    expect(me.setFlag).toHaveBeenCalledTimes(1);
    expect(me.flags.stats.recent.map((e) => e[1])).toEqual([3, 20]);
    expect(me.flags.stats.recent[1][2]).toBe('Strike');
    expect(DELAY).toBeGreaterThan(0);
  });
  test("another author's public roll is theirs to record, not this client's", async () => {
    const { rec, me } = setup();
    rec.onCreate(msg({ author: { id: 'p2' } }));
    await rec.flush();
    expect(me.setFlag).not.toHaveBeenCalled();
  });
  test('a private roll is kept only by the active GM, in its client setting, never a flag', async () => {
    const player = setup();
    player.rec.onCreate(msg({ whisper: ['gm'] }));
    await player.rec.flush();
    expect(player.me.setFlag).not.toHaveBeenCalled();
    expect(player.setSetting).not.toHaveBeenCalled();

    const gm = setup({ me: user('gm'), gm: true });
    gm.rec.onCreate(msg({ blind: true }));
    await gm.rec.flush();
    expect(gm.me.setFlag).not.toHaveBeenCalled();
    expect(gm.settings.rollStatsHidden.p1.recent).toEqual([[NOW, 20, 'Strike']]);
  });
  test('nothing is counted with roll stats off, or without d20s', async () => {
    const off = setup({ on: false });
    off.rec.onCreate(msg());
    const none = setup();
    none.rec.onCreate(msg({ rolls: [roll({ faces: 6, results: [{ result: 2, active: true }] })] }));
    await off.rec.flush();
    await none.rec.flush();
    expect(off.me.setFlag).not.toHaveBeenCalled();
    expect(none.me.setFlag).not.toHaveBeenCalled();
  });
  test('a flag cleared meanwhile is not brought back: the write starts from what is stored', async () => {
    const me = user('p1', addRolls(emptyStats(), [3, 4, 5], { ts: NOW - 1 }));
    const { rec } = setup({ me });
    rec.onCreate(msg());
    me.flags.stats = undefined; // the GM's Clear
    await rec.flush();
    expect(me.flags.stats.recent.map((e) => e[1])).toEqual([20]);
  });
});

describe('the window', () => {
  const u = (id, name, values, o = {}) => {
    const flag = values
      ? addRolls(emptyStats(), values, { ts: NOW - 1000, label: 'Hit' })
      : undefined;
    return {
      id,
      name,
      color: '#ff0000',
      isGM: false,
      flags: { dicer: { pet: { kind: 'slime' } } },
      getFlag: (m, k) =>
        k === 'stats' ? flag : k === 'pet' ? { kind: o.pet ?? 'slime' } : undefined,
      unsetFlag: vi.fn(async () => {}),
      ...o,
    };
  };
  const users = [
    u('a', 'Ann', [12, 13, 14, 15, 16, 17, 18, 19, 20, 20]),
    u('b', 'Bo', [1, 2, 3]),
    u('c', 'Cy', null),
    u('g', 'GM', Array(12).fill(20), { isGM: true, pet: 'none' }),
  ];
  const rows = () => statRows(users, 'session', { now: NOW, from: NOW - DAY });

  test('rows only for players with d20s in scope, most rolled first', () => {
    expect(rows().map((r) => r.user.name)).toEqual(['GM', 'Ann', 'Bo']);
  });
  test("the GM's private rolls join a row only when given", () => {
    const hidden = { b: addRolls(emptyStats(), [7, 7], { ts: NOW - 10 }) };
    const bo = statRows(users, 'session', { now: NOW, from: NOW - DAY, hidden }).find(
      (r) => r.user.id === 'b',
    );
    expect(bo.sum.n).toBe(5);
  });
  test('the luckiest is never the GM, and needs enough d20s', () => {
    expect(luckiest(rows()).user.name).toBe('Ann');
    expect(luckiest(rows().filter((r) => r.user.id === 'b'))).toBeNull();
  });
  test("a pet's mood follows its owner's last five d20s", () => {
    expect(moodFor([20, 20, 5])).toBe('proud');
    expect(moodFor([1, 1, 12])).toBe('sulk');
    expect(moodFor([10, 11])).toBe('neutral');
  });
  test('a player sees a clear button on their own row only; no GM tools', () => {
    const el = buildStats(
      { scope: 'session', selected: null, blind: false },
      { rows: rows(), isGM: false, meId: 'b', canBlind: false },
    );
    expect([...el.querySelectorAll('[data-clear]')].map((b) => b.dataset.clear)).toEqual(['b']);
    expect(el.querySelector('[data-action-stats]')).toBeNull();
    expect(el.querySelector('[data-blind]')).toBeNull();
  });
  test('the GM clears any row, clears all, starts a session, and counts private rolls when there are some', () => {
    const el = buildStats(
      { scope: 'session', selected: 'a', blind: true },
      { rows: rows(), isGM: true, meId: 'g', canBlind: true },
    );
    expect(el.querySelectorAll('[data-clear]')).toHaveLength(3);
    expect(
      [...el.querySelectorAll('[data-action-stats]')].map((b) => b.dataset.actionStats),
    ).toEqual(['session', 'clearAll']);
    expect(el.querySelector('[data-blind]').checked).toBe(true);
  });
  test("the picked player's chart has 20 bars, the 20 and the 1 marked, and their pet's line", () => {
    const el = buildStats(
      { scope: 'session', selected: 'a', blind: false },
      { rows: rows(), isGM: false, meId: 'a', canBlind: false },
    );
    expect(el.querySelector('.dicer-stats-row.active').dataset.user).toBe('a');
    expect(el.querySelectorAll('.dicer-stats-bar')).toHaveLength(20);
    expect(el.querySelector('.dicer-stats-bar.is-twenty')).toBeTruthy();
    expect(el.querySelector('.dicer-stats-petline').textContent).toContain(
      'DICER.Stats.Mood.proud',
    );
  });
  test('no pet line for a player without a pet', () => {
    const el = buildStats(
      { scope: 'session', selected: 'g', blind: false },
      { rows: rows(), isGM: true, meId: 'g', canBlind: false },
    );
    expect(el.querySelector('.dicer-stats-petline')).toBeNull();
  });
  test('nothing rolled says so for the scope', () => {
    const el = buildStats(
      { scope: 'month', selected: null, blind: false },
      { rows: [], isGM: false, meId: 'a', canBlind: false },
    );
    expect(el.querySelector('.dicer-stats-empty').textContent).toBe('DICER.Stats.Empty.month');
  });
  test("clearing a user drops their flag, and on the GM's client their private record", async () => {
    const user = u('b', 'Bo', [1]);
    const stored = { b: emptyStats(), a: emptyStats() };
    const setSetting = vi.fn(async () => {});
    await clearUser(user, { isGM: true, getSetting: () => stored, setSetting });
    expect(user.unsetFlag).toHaveBeenCalledWith('dicer', 'stats');
    expect(setSetting).toHaveBeenCalledWith('rollStatsHidden', { a: emptyStats() });
    setSetting.mockClear();
    await clearUser(user, { isGM: false, setSetting });
    expect(setSetting).not.toHaveBeenCalled();
  });
});

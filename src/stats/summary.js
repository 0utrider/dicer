/**
 * Roll stats over a scope, for the Roll stats window (lazy chunk only: the recorder at world start
 * needs none of this). Pure: no Foundry globals. Records are stats.js's.
 */
import { HIGH, RECENT_KEEP, dayKey, readStats } from './stats.js';

/** "Tonight" never reaches back further than this, even without a GM's New session. */
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
/** Fewer d20s than this and a player's luck is not judged. */
export const LUCK_MIN = 10;
/** How far an average may stray from a fair die's 10.5 and still be called fair. */
export const LUCK_SPREAD = 0.8;

/** Two records as one (public rolls and the GM's private ones): counts summed, recent interleaved by time. */
export function mergeStats(a, b) {
  const x = readStats(a);
  const y = readStats(b);
  for (const [k, d] of Object.entries(y.days)) {
    const e = x.days[k];
    if (!e) x.days[k] = d;
    else
      x.days[k] = {
        c: e.c.map((n, i) => n + d.c[i]),
        run: Math.max(e.run, d.run),
        hi: d.hi ?? e.hi,
        lo: d.lo ?? e.lo,
      };
  }
  x.recent = [...x.recent, ...y.recent].sort((p, q) => p[0] - q[0]).slice(-RECENT_KEEP);
  return x;
}

/** When "Tonight" starts: the GM's New session, or SESSION_MAX_MS ago, whichever is later. */
export const sessionFrom = (now, sessionStart) =>
  Math.max(now - SESSION_MAX_MS, Number(sessionStart) || 0);

function longestHigh(values) {
  let best = 0;
  let run = 0;
  for (const v of values) {
    run = v >= HIGH ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** The latest moment of a value in `recent` entries: its label, '' when unlabelled, null when none. */
function latest(entries, value) {
  for (let i = entries.length - 1; i >= 0; i--)
    if (entries[i][1] === value) return entries[i][2] ?? '';
  return null;
}

/**
 * A record over one scope: 'session' (since `from`), 'month' (the last 30 days) or 'all'.
 * Returns { counts, n, avg, twenties, ones, run, best, worst, last } where `best` / `worst` are the
 * labels of the latest 20 and 1 (null: none in scope) and `last` the latest five values (moods).
 */
export function summarize(record, scope, { now, from = 0 } = {}) {
  const r = readStats(record);
  let counts = Array(20).fill(0);
  let run = 0;
  let best = null;
  let worst = null;
  if (scope === 'session') {
    const inScope = r.recent.filter((e) => e[0] >= from);
    for (const e of inScope) counts[e[1] - 1]++;
    run = longestHigh(inScope.map((e) => e[1]));
    best = latest(inScope, 20);
    worst = latest(inScope, 1);
  } else {
    const cutoff = scope === 'month' ? dayKey(now - 29 * 24 * 60 * 60 * 1000) : '';
    const keys = Object.keys(r.days)
      .filter((k) => k >= cutoff)
      .sort();
    for (const k of keys) {
      const d = r.days[k];
      counts = counts.map((n, i) => n + d.c[i]);
      run = Math.max(run, d.run);
      if (d.c[19] > 0) best = d.hi ?? '';
      if (d.c[0] > 0) worst = d.lo ?? '';
    }
  }
  const n = counts.reduce((a, b) => a + b, 0);
  const avg = n ? counts.reduce((a, c, i) => a + c * (i + 1), 0) / n : 0;
  return {
    counts,
    n,
    avg,
    twenties: counts[19],
    ones: counts[0],
    run,
    best,
    worst,
    last: r.recent.slice(-5).map((e) => e[1]),
  };
}

/** 'hot', 'cursed' or 'fair' from an average; 'few' under LUCK_MIN d20s. */
export function luckOf({ n, avg }) {
  if (n < LUCK_MIN) return 'few';
  if (avg - 10.5 > LUCK_SPREAD) return 'hot';
  if (10.5 - avg > LUCK_SPREAD) return 'cursed';
  return 'fair';
}

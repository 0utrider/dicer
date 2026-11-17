/**
 * Roll stats: each player's d20 results, kept small enough to live in a user flag. Pure: no Foundry
 * globals. A record is
 *   { v: 1, days: { 'YYYY-MM-DD': { c: [20 counts], run, hi, lo } }, recent: [[ts, value, label?]], streak }
 * `days` holds every d20 ever counted, one bucket per local day, so a record stays a few KB however
 * long a campaign runs. `recent` keeps the latest RECENT_KEEP values in order, for "Tonight". `run`
 * is the day's longest run of 15+ and `streak` the run still going; `hi` / `lo` name the day's latest
 * natural 20 and 1 ("1 on Fortitude save"). Only a 20 or a 1 carries a label in `recent`.
 */

export const RECENT_KEEP = 500;
/** A run counts d20s of this or more. */
export const HIGH = 15;
const LABEL_MAX = 48;

export const emptyStats = () => ({ v: 1, days: {}, recent: [], streak: 0 });

const pad = (n) => String(n).padStart(2, '0');
/** The local calendar day of a timestamp, as 'YYYY-MM-DD'. */
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const isCounts = (c) =>
  Array.isArray(c) && c.length === 20 && c.every((n) => Number.isInteger(n) && n >= 0);

/** A stored record, checked: anything malformed is dropped, so a bad flag never breaks the window. */
export function readStats(raw) {
  const out = emptyStats();
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, d] of Object.entries(raw.days ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !isCounts(d?.c)) continue;
    out.days[k] = {
      c: [...d.c],
      run: Number.isInteger(d.run) ? d.run : 0,
      hi: typeof d.hi === 'string' ? d.hi : null,
      lo: typeof d.lo === 'string' ? d.lo : null,
    };
  }
  if (Array.isArray(raw.recent))
    out.recent = raw.recent
      .filter(
        (e) =>
          Array.isArray(e) &&
          Number.isFinite(e[0]) &&
          Number.isInteger(e[1]) &&
          e[1] >= 1 &&
          e[1] <= 20,
      )
      .slice(-RECENT_KEEP);
  out.streak = Number.isInteger(raw.streak) && raw.streak > 0 ? raw.streak : 0;
  return out;
}

/** A roll's flavour as a short moment label: tags stripped, whitespace folded, cut at LABEL_MAX. */
export function cleanLabel(flavor) {
  if (typeof flavor !== 'string') return '';
  const text = flavor
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1).trimEnd()}…` : text;
}

/**
 * The kept d20 results of a message's rolls, in order: every d20 term's active results (advantage
 * counts both kept dice, as the pets' moods do; a dropped die is not counted). Never throws.
 */
export function d20sOf(rolls) {
  const out = [];
  for (const roll of rolls ?? []) {
    let dice;
    try {
      dice = roll?.dice ?? [];
    } catch {
      continue;
    }
    for (const die of dice) {
      if (die?.faces !== 20) continue;
      for (const r of die.results ?? []) {
        if (r?.active === false || r?.discarded) continue;
        if (Number.isInteger(r?.result) && r.result >= 1 && r.result <= 20) out.push(r.result);
      }
    }
  }
  return out;
}

/** `record` with `values` (d20 results rolled at `ts`, labelled `label`) added. Returns a new record. */
export function addRolls(record, values, { ts, label = '' }) {
  const out = readStats(record);
  if (!values?.length) return out;
  const key = dayKey(ts);
  const day = (out.days[key] ??= { c: Array(20).fill(0), run: 0, hi: null, lo: null });
  for (const v of values) {
    day.c[v - 1]++;
    out.streak = v >= HIGH ? out.streak + 1 : 0;
    day.run = Math.max(day.run, out.streak);
    const moment = v === 20 || v === 1 ? label || '' : null;
    if (v === 20) day.hi = moment;
    if (v === 1) day.lo = moment;
    out.recent.push(moment === null ? [ts, v] : [ts, v, moment]);
  }
  if (out.recent.length > RECENT_KEEP) out.recent.splice(0, out.recent.length - RECENT_KEEP);
  return out;
}

/**
 * Whether a roll message counts toward everyone's visible stats: neither whispered nor blind.
 * Anything else (blind, GM, self and whispered rolls) only the GM's private record may hold.
 */
export function isPublicRoll(message) {
  const whisper = message?.whisper;
  return !message?.blind && !(Array.isArray(whisper) ? whisper.length : whisper?.size);
}

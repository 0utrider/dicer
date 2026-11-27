/**
 * Records each roll message's d20s into roll stats (stats.js), once per message:
 *   - a public roll, on its author's client, into the author's own user flag (dicer.stats), which
 *     every player can read;
 *   - a blind, GM, self or whispered roll, on the active GM's client only, into that client's
 *     rollStatsHidden setting ({userId: record}), which never leaves the GM's computer.
 * Writes wait DELAY ms after the last roll, then read the stored record fresh and add what is
 * pending, so a Clear made meanwhile (by the GM, on another client) is never undone by an old copy.
 * A GM's message flagged `flags.dicer.noStats` (a module's test roll) is not counted.
 */
import { addRolls, cleanLabel, d20sOf, isPublicRoll } from './stats.js';

export const DELAY = 1500;
export const FLAG = 'stats';
export const HIDDEN = 'rollStatsHidden';

/**
 * @param {{ getSetting: (k: string) => unknown, setSetting: (k: string, v: unknown) => Promise<unknown>,
 *   currentUser: () => object, isActiveGM: () => boolean, now?: () => number,
 *   schedule?: (fn: () => void, ms: number) => unknown, cancel?: (h: unknown) => void }} deps
 */
export function createStatsRecorder({
  getSetting,
  setSetting,
  currentUser,
  isActiveGM,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let own = []; // [{values, ts, label}] for this user's flag
  let hidden = []; // [{userId, values, ts, label}] for the GM's private record
  let timer = null;
  let flushing = Promise.resolve();

  async function writeOwn(batch) {
    const user = currentUser();
    let rec = user.getFlag('dicer', FLAG);
    for (const b of batch) rec = addRolls(rec, b.values, b);
    await user.setFlag('dicer', FLAG, rec);
  }

  async function writeHidden(batch) {
    const all = { ...(getSetting(HIDDEN) ?? {}) };
    for (const b of batch) all[b.userId] = addRolls(all[b.userId], b.values, b);
    await setSetting(HIDDEN, all);
  }

  /** Writes what is pending now (the timer's job; tests and teardown call it directly). */
  function flush() {
    if (timer !== null) cancel(timer);
    timer = null;
    const a = own;
    const b = hidden;
    own = [];
    hidden = [];
    flushing = flushing.then(async () => {
      try {
        if (a.length) await writeOwn(a);
        if (b.length) await writeHidden(b);
      } catch (err) {
        console.warn('dicer: cannot save roll stats', err);
      }
    });
    return flushing;
  }

  return {
    flush,
    /** createChatMessage: counts the message's d20s where this client is the one to keep them. `ts`: when it came (default now). */
    onCreate(message, ts = now()) {
      try {
        if (getSetting('rollStats') === false || !message?.isRoll) return;
        // only a GM may leave a roll out, so a player cannot hide a bad one
        if (message.flags?.dicer?.noStats && message.author?.isGM) return;
        const values = d20sOf(message.rolls);
        if (!values.length) return;
        const me = currentUser();
        const authorId = message.author?.id ?? message.user?.id ?? null;
        const entry = { values, ts, label: cleanLabel(message.flavor) };
        if (isPublicRoll(message)) {
          if (!authorId || authorId !== me?.id) return;
          own.push(entry);
        } else {
          if (!authorId || !isActiveGM() || !message.isContentVisible) return;
          hidden.push({ ...entry, userId: authorId });
        }
        if (timer !== null) cancel(timer);
        timer = schedule(flush, DELAY);
      } catch (err) {
        console.warn('dicer: cannot count a roll for roll stats', err);
      }
    },
  };
}

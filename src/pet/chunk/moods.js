/** How many of an owner's most recent active d20 values count toward their pet's mood. */
export const MOOD_KEEP = 5;
/** Fewer values than this and the pet stays neutral. */
export const MOOD_MIN = 3;

/**
 * Pet moods from each owner's recent rolls on this screen: their last MOOD_KEEP active d20 values
 * (each d20 counts, so advantage adds two). Proud with at least MOOD_MIN values and two or more 20s
 * or an average of 15 or more; sulk with two or more 1s or an average of 6 or less; both, or too few
 * values, neutral. Only ever fed visible dice (the layer never records a ghost). Kept by user id,
 * not by pet, so the history outlives a hidden or departed pet; nothing clears it but clear().
 */
export function createMoods() {
  const history = new Map(); // userId -> the last MOOD_KEEP values, oldest first
  return {
    record(userId, values) {
      if (userId == null) return;
      let h = history.get(userId);
      for (const v of values || []) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        if (!h) history.set(userId, (h = []));
        h.push(v);
      }
      if (h && h.length > MOOD_KEEP) h.splice(0, h.length - MOOD_KEEP);
    },
    moodOf(userId) {
      const h = history.get(userId);
      if (!h || h.length < MOOD_MIN) return 'neutral';
      let sum = 0;
      let twenties = 0;
      let ones = 0;
      for (const v of h) {
        sum += v;
        if (v === 20) twenties++;
        else if (v === 1) ones++;
      }
      const avg = sum / h.length;
      const proud = twenties >= 2 || avg >= 15;
      const sulk = ones >= 2 || avg <= 6;
      return proud === sulk ? 'neutral' : proud ? 'proud' : 'sulk';
    },
    clear() {
      history.clear();
    },
  };
}

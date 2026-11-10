/** Quality tiers: the table, tier resolution, the probe mapping and the adaptive drop. */

export const TIER_ORDER = Object.freeze(['low', 'medium', 'high', 'ultra']);

export const TIERS = Object.freeze({
  low: Object.freeze({
    pixelRatio: 1,
    interiorSteps: 0,
    transmissionScale: 0.5,
    envResolution: 128,
    anisotropy: false,
  }),
  medium: Object.freeze({
    pixelRatio: 1.25,
    interiorSteps: 16,
    transmissionScale: 0.5,
    envResolution: 256,
    anisotropy: true,
  }),
  high: Object.freeze({
    pixelRatio: 1.5,
    interiorSteps: 32,
    transmissionScale: 1,
    envResolution: 256,
    anisotropy: true,
  }),
  ultra: Object.freeze({
    pixelRatio: 2,
    interiorSteps: 48,
    transmissionScale: 1,
    envResolution: 512,
    anisotropy: true,
  }),
});

const index = (tier) => Math.max(0, TIER_ORDER.indexOf(tier));

/**
 * min(choice or autoTier, cap). The session's adaptive drop is a ceiling the quality
 * controller applies on top (P2-R11).
 * @param {{choice: 'auto'|string, autoTier: string, cap: string}} o
 */
export function effectiveTier({ choice, autoTier, cap }) {
  const base = choice === 'auto' ? autoTier : choice;
  return TIER_ORDER[Math.min(index(base), index(cap))];
}

/** Maps the probe's ms per frame to a tier. */
export function tierFromProbe({ msPerFrame }) {
  if (msPerFrame < 4) return 'ultra';
  if (msPerFrame < 8) return 'high';
  if (msPerFrame < 16) return 'medium';
  return 'low';
}

const GRACE_FRAMES = 10;

/**
 * Drops a tier (session only) when frame time stays over budget. Call frame(ms) once per
 * rendered frame while a roll animates. EMA alpha 0.1, seeded by the first sample.
 */
export class AdaptiveQuality {
  #budget;
  #window;
  #onDrop;
  #ema = null;
  #streak = 0;
  #dropped = 0;
  #grace = GRACE_FRAMES;

  constructor({ budgetMs = 20, window = 30, onDrop } = {}) {
    this.#budget = budgetMs;
    this.#window = window;
    this.#onDrop = onDrop;
  }

  get dropped() {
    return this.#dropped;
  }

  frame(ms) {
    if (this.#grace > 0) {
      this.#grace--; // P2-R10: ignore the frames right after construction, reset() or a tier change
      return;
    }
    ms = Math.min(ms, 3 * this.#budget); // one hitch must not count as a sustained slowdown
    this.#ema = this.#ema === null ? ms : this.#ema + 0.1 * (ms - this.#ema);
    if (this.#ema <= this.#budget) {
      this.#streak = 0;
      return;
    }
    if (++this.#streak < this.#window) return;
    this.#dropped++;
    this.#ema = null;
    this.#streak = 0;
    this.#grace = GRACE_FRAMES;
    this.#onDrop?.(this.#dropped);
  }

  /** Clears the EMA, the streak and the dropped count. */
  reset() {
    this.#ema = null;
    this.#streak = 0;
    this.#dropped = 0;
    this.#grace = GRACE_FRAMES;
  }
}

/** Quality tiers: the table, tier resolution, the probe mapping and the adaptive drop. */

export const TIER_ORDER = Object.freeze(['low', 'medium', 'high', 'ultra']);

/**
 * particleScale scales particle counts (Task 9); effectBudget caps the summed `cost` of the
 * effects running at once (effect-layer.js).
 */
export const TIERS = Object.freeze({
  low: Object.freeze({
    pixelRatio: 1,
    interiorSteps: 0,
    transmissionScale: 0.5,
    envResolution: 128,
    anisotropy: false,
    particleScale: 0.25,
    effectBudget: 2,
  }),
  medium: Object.freeze({
    pixelRatio: 1.25,
    interiorSteps: 16,
    transmissionScale: 0.5,
    envResolution: 256,
    anisotropy: true,
    particleScale: 0.5,
    effectBudget: 4,
  }),
  high: Object.freeze({
    pixelRatio: 1.5,
    interiorSteps: 32,
    transmissionScale: 1,
    envResolution: 256,
    anisotropy: true,
    particleScale: 1,
    effectBudget: 8,
  }),
  ultra: Object.freeze({
    pixelRatio: 2,
    interiorSteps: 48,
    transmissionScale: 1,
    envResolution: 512,
    anisotropy: true,
    particleScale: 1.5,
    effectBudget: 12,
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

/**
 * Material feature flags for a tier and the client toggles: the one definition shared by the
 * quality controller, the look gallery and the preview, so they cannot drift apart.
 * `interiors` is the client setting alone: at low (interiorSteps 0) createDiceMaterial then
 * draws the interior fake (a body tint) and programKey maps it to the 'none' program.
 * P2-R12 `safe`: every feature off and the body drawn as plain opaque physical material.
 * @param {{interiorSteps: number}} tierConfig a TIERS entry
 * @param {{interiors?: unknown, engraving?: unknown, glow?: unknown, effects?: unknown}} settings
 * @param {{safe?: boolean}} [o]
 */
export function flagsFor(tierConfig, settings, { safe = false } = {}) {
  if (safe) {
    return { interiors: false, engraving: false, glow: false, effects: false, interiorSteps: 0, safe: true };
  }
  return {
    interiors: !!settings.interiors,
    engraving: !!settings.engraving,
    glow: !!settings.glow,
    // Trigger effects (the die fx uniform block): on unless the client setting is off.
    effects: settings.effects !== false,
    interiorSteps: tierConfig.interiorSteps,
    safe: false,
  };
}

const GRACE_FRAMES = 10;
/** P2-R13: rAF intervals kept for the learned baseline (about a second of loop frames). */
const BASELINE_FRAMES = 60;
/** P2-R13: a frame is slow only above this multiple of the baseline (and above the budget). */
const BASELINE_FACTOR = 1.3;
const MAX_INTERVAL_MS = 100;
/** P2-R13 debt: the frame budget a GPU timer is judged against (TARGETS.frameP95Ms, 60 Hz). */
const GPU_BUDGET_MS = 16.7;
/** Frames in the GPU p95 window: three hitches in a window are tolerated, four are not. */
const GPU_WINDOW = 60;

/**
 * Drops a tier (session only) when frame time stays over budget. Call frame(ms, sample) once
 * per rendered frame while a roll animates. EMA alpha 0.1, seeded by the first sample.
 *
 * P2-R13 learned baseline: the median rAF interval over the last ~60 loop frames. The EMA
 * counts as slow only when it is over budgetMs AND over 1.3 x that baseline, so a display or
 * battery frame cap (steady 33 ms) or a heavy host scene (Foundry's own PIXI cost) is not
 * blamed on Dicer. The baseline in force when a slow streak starts is frozen for that streak,
 * so a real sustained slowdown cannot normalise itself away mid-streak; the ring keeps
 * learning, so a cadence change costs at most one drop. The baseline survives reset() (it
 * describes the display and host, not the tier). With a GPU time (timer query) the frame
 * cost is judged directly, with no baseline, over the last 60 post-grace frames: the GPU p95
 * (each sample capped at 3 x the budget, like the EMA path) over gpuBudgetMs (16.7) drops a
 * tier, so a machine that is GPU-bound from its first roll (a steady 20 ms GPU frame at a
 * 60 Hz cadence the baseline would excuse) still drops. The CPU time is judged on the window's
 * median, not its p95 (P9-R1): CPU spikes (a roll spawning its dice, a garbage collection, a
 * host hook) are one-off frames a lower tier would not remove, and counting them in the p95
 * dropped an RTX 5070 Ti to low during the 500-roll soak. Only a sustained CPU cost drops.
 */
export class AdaptiveQuality {
  #budget;
  #window;
  #onDrop;
  #ema = null;
  #streak = 0;
  #dropped = 0;
  #grace = GRACE_FRAMES;
  #ring = new Float64Array(BASELINE_FRAMES);
  #ringSize = 0;
  #ringNext = 0;
  #frozen = null;
  #gpuBudget;
  #gpuFrames = [];
  #cpuFrames = [];

  constructor({ budgetMs = 20, window = 30, gpuBudgetMs = GPU_BUDGET_MS, onDrop } = {}) {
    this.#budget = budgetMs;
    this.#gpuBudget = gpuBudgetMs;
    this.#window = window;
    this.#onDrop = onDrop;
  }

  get dropped() {
    return this.#dropped;
  }

  /** The learned baseline (median rAF interval, ms), or null before any interval. */
  get baseline() {
    if (this.#ringSize === 0) return null;
    const s = Array.from(this.#ring.subarray(0, this.#ringSize)).sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * @param {number} ms frame time: max(CPU tick+render, rAF interval)
   * @param {{interval?: number, cpu?: number, gpu?: number|null}} [sample] the parts: the
   *   rAF interval feeds the baseline; a GPU time replaces ms with max(cpu, gpu)
   */
  frame(ms, { interval, cpu, gpu } = {}) {
    if (Number.isFinite(interval) && interval > 0) {
      this.#ring[this.#ringNext] = Math.min(interval, MAX_INTERVAL_MS);
      this.#ringNext = (this.#ringNext + 1) % BASELINE_FRAMES;
      this.#ringSize = Math.min(this.#ringSize + 1, BASELINE_FRAMES);
    }
    const timed = Number.isFinite(gpu) && gpu >= 0;
    if (this.#grace > 0) {
      this.#grace--; // P2-R10: ignore the frames right after construction, reset() or a tier change
      return;
    }
    if (timed) {
      this.#gpuFrame(gpu, Number.isFinite(cpu) ? cpu : 0);
      return;
    }
    this.#gpuFrames.length = 0;
    this.#cpuFrames.length = 0;
    ms = Math.min(ms, 3 * this.#budget); // one hitch must not count as a sustained slowdown
    this.#ema = this.#ema === null ? ms : this.#ema + 0.1 * (ms - this.#ema);
    const base = this.#streak > 0 ? this.#frozen : this.baseline;
    const slow = this.#ema > this.#budget && (base === null || this.#ema > BASELINE_FACTOR * base);
    if (!slow) {
      this.#streak = 0;
      this.#frozen = null;
      return;
    }
    if (this.#streak === 0) this.#frozen = base;
    if (++this.#streak < this.#window) return;
    this.#dropNow();
  }

  /** GPU-timer path: GPU p95 and CPU median of the last 60 frames against the budget. */
  #gpuFrame(gpu, cpu) {
    const cap = 3 * this.#gpuBudget;
    this.#gpuFrames.push(Math.min(gpu, cap));
    this.#cpuFrames.push(Math.min(cpu, cap));
    if (this.#gpuFrames.length > GPU_WINDOW) this.#gpuFrames.shift();
    if (this.#cpuFrames.length > GPU_WINDOW) this.#cpuFrames.shift();
    if (this.#gpuFrames.length < GPU_WINDOW) return;
    const g = [...this.#gpuFrames].sort((a, b) => a - b);
    const c = [...this.#cpuFrames].sort((a, b) => a - b);
    const gpuSlow = g[Math.ceil(0.95 * g.length) - 1] > this.#gpuBudget;
    const cpuSlow = c[(c.length >> 1) - 1] > this.#gpuBudget;
    if (gpuSlow || cpuSlow) this.#dropNow();
  }

  #dropNow() {
    this.#dropped++;
    this.#ema = null;
    this.#streak = 0;
    this.#frozen = null;
    this.#gpuFrames.length = 0;
    this.#cpuFrames.length = 0;
    this.#grace = GRACE_FRAMES;
    this.#onDrop?.(this.#dropped);
  }

  /** Clears the EMA, the streak and the dropped count; the learned baseline is kept. */
  reset() {
    this.#ema = null;
    this.#streak = 0;
    this.#frozen = null;
    this.#dropped = 0;
    this.#gpuFrames.length = 0;
    this.#cpuFrames.length = 0;
    this.#grace = GRACE_FRAMES;
  }
}

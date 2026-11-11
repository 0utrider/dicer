/**
 * The Dicer side of the benchmark (a ProductAdapter, see scenarios.js) and the in-game runner.
 * Bench import rule: only ./ bench files, no top-level Hooks/game/Roll. Everything host-specific
 * (the Roll class, the user, the clock) is read inside functions, so the file loads anywhere.
 */
import { SCENARIOS, runSuite } from './scenarios.js';
import { summaryText, checkTargets } from './report.js';
import { createRecorder } from './recorder.js';
import { summarize } from './stats.js';

export { summaryText, checkTargets };

/** Scenarios `game.dice3d.benchmark()` runs when none are named. */
export const DEFAULT_SCENARIOS = Object.freeze(['d20', 'mixed10', 'pool30', 'burst20']);

const START_TIMEOUT_MS = 2000;
/** Idle rAF sampled before the first scenario, and the median interval that means "below 60 Hz". */
const IDLE_SAMPLE_MS = 1000;
const REFRESH_LIMIT_MS = 17;
export const REFRESH_NOTE = 'display refresh below 60 Hz: frame checks n/a';

/** Median idle rAF interval over `ms` (null when no frame came). */
async function idleFrameMedian(win, ms) {
  const rec = createRecorder({ win });
  rec.start();
  await new Promise((r) => setTimeout(r, ms));
  return summarize(rec.stop().intervals)?.p50 ?? null;
}

/** "Chrome 131" from a user agent string; the raw string (trimmed) when it is not a known browser. */
function browserName(ua) {
  const s = String(ua ?? '');
  for (const [re, name] of [
    [/Edg\/(\d+)/, 'Edge'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+)[\d.]* .*Safari/, 'Safari'],
  ]) {
    const m = re.exec(s);
    if (m) return `${name} ${m[1]}`;
  }
  return s.slice(0, 60) || 'unknown';
}

/** Dice in a plain formula such as 1d20+2d6 (the sum of the counts). */
function diceIn(formula) {
  let n = 0;
  for (const m of String(formula ?? '').matchAll(/(\d+)d\d+/g)) n += Number(m[1]);
  return n;
}

/**
 * @param {object} api `game.dice3d` (showForRoll and the `_debug` probes).
 * @param {object} [opts]
 * @param {(formula: string) => Promise<object>} [opts.roll] Replaces the default roll, which
 *   evaluates `new Roll(formula)` and calls `api.showForRoll(roll, game.user, false)`: local, no
 *   chat message, nothing sent. A caller may return `{messageId}` (a chat roll) instead.
 * @param {string | (() => string)} [opts.gpu] The GPU renderer string, for `info()`.
 * @param {string} [opts.version] The Dicer version, for `info()`.
 * @param {object} [opts.win] The window (default globalThis), for tests.
 * @param {number} [opts.startTimeoutMs] Bound on the wait for the first frame.
 */
export function createDicerAdapter(api, { roll, gpu, version, win = globalThis, startTimeoutMs = START_TIMEOUT_MS } = {}) {
  const debug = () => api?._debug ?? {};

  /**
   * Resolves at THIS roll's first drawn frame: diceBox.armFirstFrame (through api._benchArmFirstFrame)
   * is armed right before showForRoll, whose dice are thrown synchronously, so a renderer still
   * looping for an earlier roll cannot resolve it. `showForRoll` without a message fires no
   * diceSoNiceRollStart, so there is no hook. Bounded: a roll that never draws resolves anyway
   * (the runner then times the first frame late, never hangs). Without the seam (an api that
   * lacks it) the renderer's global frame counter stands in.
   */
  function armStarted() {
    let resolveStarted;
    let timer = null;
    const started = new Promise((resolve) => {
      resolveStarted = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    timer = setTimeout(resolveStarted, startTimeoutMs);
    const arm = typeof api?._benchArmFirstFrame === 'function' ? (cb) => api._benchArmFirstFrame(cb) : null;
    if (arm) {
      arm(resolveStarted);
      return { started, disarm: () => arm(null) };
    }
    const frames0 = debug().frameCount ?? 0;
    const step = () => {
      if ((debug().frameCount ?? 0) > frames0) resolveStarted();
      else if (win.requestAnimationFrame) win.requestAnimationFrame(step);
    };
    win.requestAnimationFrame?.(step);
    return { started, disarm() {} };
  }

  async function defaultRoll(formula) {
    const r = new globalThis.Roll(formula);
    await r.evaluate();
    const { started, disarm } = armStarted();
    let shown;
    try {
      shown = api.showForRoll(r, globalThis.game.user, false);
    } finally {
      disarm(); // a roll that threw no dice must not leave the next one armed
    }
    const done = Promise.resolve(shown).then((ok) => {
      if (ok === false) throw new Error('showForRoll showed nothing');
    });
    return { done, started };
  }

  return {
    product: 'dicer',
    roll: roll ?? defaultRoll,
    isBusy: () => (debug().activeRolls ?? 0) > 0 || debug().isLooping === true,
    resources: () => debug().resources ?? null,
    async heap() {
      const used = win.performance?.memory?.usedJSHeapSize;
      return typeof used === 'number' ? used : null;
    },
    dicerFirstFrame: () => null,
    async perturb(kind) {
      if (kind !== 'resize') return;
      win.dispatchEvent(new (win.Event ?? globalThis.Event)('resize'));
    },
    info() {
      let gpuName = 'unknown';
      try {
        gpuName = String(typeof gpu === 'function' ? gpu() : (gpu ?? 'unknown'));
      } catch {
        /* keep unknown */
      }
      return {
        browser: browserName(win.navigator?.userAgent),
        gpu: gpuName,
        tier: debug().tier ?? null,
        version: version ?? null,
      };
    },
  };
}

/**
 * Runs scenarios against `api` and returns `{suite, text}`. `onProgress({index, total, id})` is
 * called before each scenario. Used by `game.dice3d.benchmark()` and the benchmark window.
 */
export async function runDicerBenchmark(
  api,
  { scenarios = DEFAULT_SCENARIOS, onProgress, hooks, win = globalThis, maxDice, idleSampleMs = IDLE_SAMPLE_MS, ...adapterOpts } = {},
) {
  const adapter = createDicerAdapter(api, { win, ...adapterOpts });
  const ids = [...scenarios];
  const results = [];
  let meta = null;
  // A display capped below 60 Hz (a 30 Hz panel, a power saver) cannot meet a 16.7 ms frame p95
  // whatever Dicer does: the frame checks are then n/a, not FAIL.
  const notes = [];
  let refreshLimited = false;
  if (idleSampleMs > 0) {
    const median = await idleFrameMedian(win, idleSampleMs);
    refreshLimited = median != null && median > REFRESH_LIMIT_MS;
    if (refreshLimited) notes.push(REFRESH_NOTE);
  }
  for (const [index, id] of ids.entries()) {
    try {
      onProgress?.({ index, total: ids.length, id });
    } catch {
      /* a progress listener never stops the run */
    }
    const part = await runSuite([id], adapter, { hooks, win, profile: 'in-game' });
    const cap = Number(typeof maxDice === 'function' ? maxDice() : maxDice);
    const dice = diceIn(SCENARIOS.find((sc) => sc.id === id)?.formula);
    if (Number.isFinite(cap) && cap > 0 && dice > cap) {
      for (const r of part.results) (r.notes ??= []).push(`${id} threw ${cap} of ${dice} dice (maxDice)`);
    }
    if (refreshLimited) for (const r of part.results) r.refreshLimited = true;
    results.push(...part.results);
    meta = part;
  }
  const suite = {
    browser: meta?.browser ?? null,
    gpu: meta?.gpu ?? null,
    tier: meta?.tier ?? null,
    version: meta?.version ?? null,
    profile: 'in-game',
    notes,
    results,
  };
  return { suite, text: summaryText(suite) };
}

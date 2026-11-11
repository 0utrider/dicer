/**
 * The Dicer side of the benchmark (a ProductAdapter, see scenarios.js) and the in-game runner.
 * Bench import rule: only ./ bench files, no top-level Hooks/game/Roll. Everything host-specific
 * (the Roll class, the user, the clock) is read inside functions, so the file loads anywhere.
 */
import { runSuite } from './scenarios.js';
import { summaryText, checkTargets } from './report.js';

export { summaryText, checkTargets };

/** Scenarios `game.dice3d.benchmark()` runs when none are named. */
export const DEFAULT_SCENARIOS = Object.freeze(['d20', 'mixed10', 'pool30', 'burst20']);

const START_TIMEOUT_MS = 2000;

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
   * Resolves at the first rendered frame after the call: `_debug.frameCount` (the renderer's own
   * counter) is watched from a requestAnimationFrame loop. `showForRoll` without a message fires
   * no diceSoNiceRollStart, so there is no hook to wait for. Bounded: a frame that never comes
   * resolves anyway (the runner then times the first frame as a late one, never hangs).
   */
  function firstFrameAfter(frames0) {
    return new Promise((resolve) => {
      const end = Date.now() + startTimeoutMs;
      const step = () => {
        if ((debug().frameCount ?? 0) > frames0 || Date.now() >= end) resolve();
        else win.requestAnimationFrame(step);
      };
      win.requestAnimationFrame(step);
    });
  }

  async function defaultRoll(formula) {
    const frames0 = debug().frameCount ?? 0;
    const r = new globalThis.Roll(formula);
    await r.evaluate();
    const shown = api.showForRoll(r, globalThis.game.user, false);
    const done = Promise.resolve(shown).then((ok) => {
      if (ok === false) throw new Error('showForRoll showed nothing');
    });
    return { done, started: firstFrameAfter(frames0) };
  }

  return {
    product: 'dicer',
    roll: roll ?? defaultRoll,
    isBusy: () => (debug().activeRolls ?? 0) > 0,
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
export async function runDicerBenchmark(api, { scenarios = DEFAULT_SCENARIOS, onProgress, hooks, win = globalThis, ...adapterOpts } = {}) {
  const adapter = createDicerAdapter(api, { win, ...adapterOpts });
  const ids = [...scenarios];
  const results = [];
  let meta = null;
  for (const [index, id] of ids.entries()) {
    try {
      onProgress?.({ index, total: ids.length, id });
    } catch {
      /* a progress listener never stops the run */
    }
    const part = await runSuite([id], adapter, { hooks, win, profile: 'in-game' });
    results.push(...part.results);
    meta = part;
  }
  const suite = {
    browser: meta?.browser ?? null,
    gpu: meta?.gpu ?? null,
    tier: meta?.tier ?? null,
    version: meta?.version ?? null,
    profile: 'in-game',
    results,
  };
  return { suite, text: summaryText(suite) };
}

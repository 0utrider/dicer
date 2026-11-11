import { summarize } from './stats.js';
import { createRecorder } from './recorder.js';

const MIXED = '1d4+2d6+2d8+2d10+2d12+1d20';

export const SCENARIOS = Object.freeze(
  [
    { id: 'd20', kind: 'typical', formula: '1d20', rolls: 1 },
    { id: 'mixed10', kind: 'typical', formula: MIXED, rolls: 1 },
    { id: 'pool30', kind: 'bigPool', formula: '30d6', rolls: 1 },
    { id: 'burst100', kind: 'burst', formula: '1d20+2d6', rolls: 100 },
    { id: 'soak500', kind: 'soak', formula: '1d20+2d6', rolls: 500 },
    { id: 'resize', kind: 'typical', formula: MIXED, rolls: 1 },
    { id: 'contextLoss', kind: 'typical', formula: MIXED, rolls: 1 },
    { id: 'hidden', kind: 'typical', formula: MIXED, rolls: 1 },
  ].map((s) => Object.freeze(s)),
);

/** Mid-roll disturbances: milliseconds handed to adapter.perturb. */
const PERTURB = Object.freeze({
  resize: 400,
  contextLoss: 500,
  hidden: 3000,
});
const PERTURB_DELAY_MS = 300;
const SOAK_MARKS = Object.freeze([50, 500]);

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @typedef {object} ProductAdapter
 * @property {'dicer'|'dice-so-nice'} product
 * @property {(formula: string) => Promise<{messageId?: string} | {done: Promise<unknown>, started?: Promise<unknown>}>} roll
 *   Chat path: resolves {messageId}; start/completion arrive via the diceSoNiceRollStart/Complete hooks.
 *   No-message path: resolves {done, started?}; done settles at animation completion, started at roll start
 *   (without it firstFrame is null for that roll). A result with neither messageId nor done is a failure.
 * @property {() => boolean} isBusy
 * @property {() => ({geometries: number, textures: number, programs: number} | null)} resources
 * @property {() => Promise<number | null>} heap
 * @property {(messageId: string) => number | null} dicerFirstFrame
 * @property {(kind: 'resize'|'contextLoss'|'hidden', ms: number) => Promise<void>} perturb
 * @property {() => ({browser: string, gpu: string, tier: string, version: string} | Promise<object>)} [info]
 */

/** Run one scenario against a product adapter. Never throws on a failed roll. */
export async function runScenario(scenario, adapter, opts = {}) {
  const hooks = opts.hooks ?? globalThis.Hooks;
  const win = opts.win ?? globalThis;
  const timeoutMs = opts.timeoutMs ?? 16000;
  const now = opts.now ?? (() => (win.performance?.now ? win.performance.now() : Date.now()));
  const recorder = opts.recorder ?? createRecorder({ win });

  const notes = [];
  const firstFrames = [];
  const dicerFrames = [];
  let failures = 0;
  let completed = 0;
  let heapBefore = null;
  let heapAfter = null;
  let resBefore = null;
  let resAfter = null;

  // Hook state, only for tracked message ids (or any id while a roll() call is still pending).
  const state = new Map();
  const tracked = new Set();
  const waiters = new Map();
  let pendingRoll = false;
  const accepts = (id) => tracked.has(id) || pendingRoll;
  const get = (id) => {
    if (!state.has(id)) state.set(id, { started: false, frameAt: null, done: false });
    return state.get(id);
  };
  const onStart = (id) => {
    if (!accepts(id)) return;
    const s = get(id);
    if (s.started) return;
    s.started = true;
    win.requestAnimationFrame(() => {
      s.frameAt = now();
    });
    waiters.get(id)?.start?.();
  };
  const onComplete = (id) => {
    if (!accepts(id)) return;
    get(id).done = true;
    waiters.get(id)?.done?.();
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Race a value or promise against a timer that is always cleared. Resolves to TIMEOUT on expiry. */
  const TIMEOUT = Symbol('timeout');
  const raced = (fn, ms) => {
    let timer = null;
    const t = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), ms);
    });
    const work = Promise.resolve().then(fn);
    return Promise.race([work, t]).finally(() => clearTimeout(timer));
  };
  const guarded = async (label, fn) => {
    try {
      const v = await raced(fn, timeoutMs);
      if (v === TIMEOUT) {
        notes.push(`${label} timed out after ${timeoutMs} ms`);
        return null;
      }
      return v ?? null;
    } catch (e) {
      notes.push(`${label} failed: ${e?.message ?? e}`);
      return null;
    }
  };

  async function waitIdle() {
    let waited = 0;
    while (adapter.isBusy?.() && waited < timeoutMs) {
      await sleep(50);
      waited += 50;
    }
    if (adapter.isBusy?.()) notes.push('adapter still busy before roll');
  }

  async function oneRoll() {
    await waitIdle();
    const t0 = now();
    // One deadline for the whole roll: covers roll() itself and the wait for completion.
    let timer = null;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
    });
    let perturbTimer = null;
    let perturbed = false;
    let settled = false;
    let id = null;
    try {
      pendingRoll = true;
      let res;
      try {
        res = await Promise.race([Promise.resolve().then(() => adapter.roll(scenario.formula)), deadline]);
      } catch (e) {
        failures++;
        notes.push(`roll threw: ${e?.message ?? e}`);
        return;
      } finally {
        pendingRoll = false;
      }
      if (res === TIMEOUT) {
        failures++;
        notes.push(`roll ${completed + 1} timed out after ${timeoutMs} ms (roll call)`);
        return;
      }
      id = res?.messageId ?? null;
      const doneP = id == null && res?.done && typeof res.done.then === 'function' ? res.done : null;
      if (id == null && !doneP) {
        failures++;
        notes.push('roll returned neither a message id nor done');
        return;
      }
      for (const k of [...state.keys()]) if (k !== id) state.delete(k);
      if (id != null) tracked.add(id);
      const s = id != null ? get(id) : { started: false, frameAt: null, done: false };
      const kind = PERTURB[scenario.id] != null ? scenario.id : null;
      const schedulePerturb = () => {
        if (!kind || perturbed || settled) return;
        perturbed = true;
        perturbTimer = setTimeout(() => {
          try {
            Promise.resolve(adapter.perturb(kind, PERTURB[kind])).catch((e) => notes.push(`perturb failed: ${e?.message ?? e}`));
          } catch (e) {
            notes.push(`perturb failed: ${e?.message ?? e}`);
          }
        }, PERTURB_DELAY_MS);
      };
      const finished = new Promise((resolve) => {
        if (doneP) {
          doneP.then(() => resolve(true), () => resolve(false));
          if (typeof res.started?.then === 'function') {
            res.started.then(() => {
              if (s.started || settled) return;
              s.started = true;
              win.requestAnimationFrame(() => {
                s.frameAt = now();
              });
              schedulePerturb();
            }, () => {});
          }
          return;
        }
        waiters.set(id, { start: schedulePerturb, done: () => resolve(true) });
        if (s.started) schedulePerturb();
        if (s.done) resolve(true);
      });
      const ok = (await Promise.race([finished, deadline])) === true;
      settled = true;
      if (s.started && s.frameAt != null) firstFrames.push(s.frameAt - t0);
      else if (s.started) firstFrames.push(null);
      if (!ok) {
        failures++;
        notes.push(`roll ${completed + 1} timed out after ${timeoutMs} ms`);
      }
      try {
        dicerFrames.push(id != null ? (adapter.dicerFirstFrame?.(id) ?? null) : null);
      } catch {
        dicerFrames.push(null);
      }
    } finally {
      settled = true;
      clearTimeout(timer);
      clearTimeout(perturbTimer);
      if (id != null) {
        waiters.delete(id);
        tracked.delete(id);
        state.delete(id);
      }
    }
  }

  let rec = null;
  try {
    hooks?.on('diceSoNiceRollStart', onStart);
    hooks?.on('diceSoNiceRollComplete', onComplete);
    recorder.start();
    for (let i = 1; i <= scenario.rolls; i++) {
      await oneRoll();
      completed = i;
      if (scenario.kind === 'soak' && (i === SOAK_MARKS[0] || i === SOAK_MARKS[1])) {
        const h = await guarded('heap', () => adapter.heap?.());
        const r = await guarded('resources', () => adapter.resources?.());
        if (i === SOAK_MARKS[0]) {
          heapBefore = h;
          resBefore = r;
        } else {
          heapAfter = h;
          resAfter = r;
        }
      }
    }
  } finally {
    try {
      hooks?.off('diceSoNiceRollStart', onStart);
    } catch {
      /* ignore */
    }
    try {
      hooks?.off('diceSoNiceRollComplete', onComplete);
    } catch {
      /* ignore */
    }
    try {
      rec = recorder.stop();
    } catch {
      rec = null;
    }
  }

  const lt = rec?.longTasks;
  return {
    scenario: scenario.id,
    kind: scenario.kind,
    product: adapter.product,
    profile: opts.profile ?? null,
    rolls: scenario.rolls,
    failures,
    frame: summarize(rec?.intervals ?? []),
    longTasks: Array.isArray(lt) ? { count: lt.length, maxMs: lt.length ? Math.max(...lt) : 0 } : null,
    firstFrame: summarize(firstFrames),
    dicerFirstFrame: summarize(dicerFrames.filter(finite)),
    heap: finite(heapBefore) && finite(heapAfter) ? { before: heapBefore, after: heapAfter } : null,
    resources: resBefore && resAfter ? { before: resBefore, after: resAfter } : null,
    notes,
  };
}

/** Run scenarios by id, in order, and shape a SuiteResult. */
export async function runSuite(ids, adapter, opts = {}) {
  const results = [];
  for (const id of ids) {
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc) throw new Error(`unknown scenario: ${id}`);
    results.push(await runScenario(sc, adapter, opts));
  }
  let info = null;
  try {
    info = (await adapter.info?.()) ?? null;
  } catch {
    info = null;
  }
  return {
    browser: info?.browser ?? null,
    gpu: info?.gpu ?? null,
    tier: info?.tier ?? null,
    version: info?.version ?? null,
    profile: opts.profile ?? null,
    results,
  };
}

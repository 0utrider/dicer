/**
 * The warm-up coordinator main.js uses: compiles the current look's materials (one per die
 * type, current tier) without starting the render loop. Calls made while one runs are
 * coalesced into one more pass afterwards. Every pass releases what it acquired, also when
 * the compile fails: DiceRenderer.warmup rejects on a context loss or a 10 s timeout
 * (compileGuarded), so a lost context can no longer block every later warm-up.
 *
 * @param {object} o
 * @param {() => object|null} o.getBox the DiceBox (acquireWarmup), or null before activation
 * @param {() => object|null} o.getRenderer the DiceRenderer (warmup), or null
 * @param {() => void} [o.onWarmed] after a pass compiled (quality.warmedUp, P2-R10)
 * @param {() => object[]} [o.getLooks] other looks to compile once the current one is done
 *   (main: the damage themes), so the first fire or electricity roll does not freeze the canvas
 *   compiling them; compiled after the current look, LOOK_BATCH at a time, so the current look is
 *   ready first and the 10 s guard covers a few programs, not all of them (a slow GPU timed out)
 * @param {(message: string, err: unknown) => void} [o.warn]
 * @returns {() => Promise<void>} warmUp(); resolves when no pass is left
 */
/** Damage looks compiled together in one guarded compile (each also compiles its fade). */
export const LOOK_BATCH = 3;

export function createWarmup({
  getBox,
  getRenderer,
  onWarmed = () => {},
  getLooks = () => [],
  warn = (message, err) => console.warn(message, err),
  info = (message) => console.info(message),
  // between damage-look batches: the page gets a turn (`slow`: 2 s, then an idle moment)
  breathe = (slow) =>
    new Promise((r) => setTimeout(() => (globalThis.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 2000 }) : r()), slow ? 2000 : 0)),
}) {
  let warming = null;
  let again = false;
  /** Compiles one acquired set and releases it; false when the compile failed. */
  const pass = async (renderer, warm) => {
    try {
      await renderer.warmup(warm.materials, warm.geometry, warm.fades);
      return true;
    } catch (err) {
      // a timeout is not a failure: three keeps compiling, and the programs are ready a bit later
      if (err?.reason === 'timeout') info('dicer: dice shaders are still compiling in the background');
      else warn('dicer: material warm-up failed', err);
      return false;
    } finally {
      warm.release();
    }
  };
  return function warmUp() {
    if (warming) {
      again = true;
      return warming;
    }
    warming = (async () => {
      do {
        again = false;
        const box = getBox();
        const renderer = getRenderer();
        if (!box || !renderer) return;
        if (!(await pass(renderer, box.acquireWarmup()))) continue;
        onWarmed();
        let looks = [];
        try {
          looks = getLooks() ?? [];
        } catch (err) {
          warn('dicer: cannot list the damage looks to warm up', err);
        }
        // Where compiling blocks the page (no parallel compile: Firefox on Windows) each look is a
        // short freeze: one at a time, in idle moments after loading, never with dice on screen.
        const slow = renderer.parallelCompile === false;
        const n = slow ? 1 : LOOK_BATCH;
        for (let i = 0; i < looks.length && !again; i += n) {
          await breathe(slow);
          while (slow && box.activeRolls > 0 && !again) await breathe(slow);
          if (again || !(await pass(renderer, box.acquireWarmup(undefined, looks.slice(i, i + n))))) break;
        }
      } while (again);
    })().finally(() => {
      warming = null;
    });
    return warming;
  };
}

/**
 * Re-runs the warm-up after a GM push (M-2): when the current user's `dicer.appearance` flag
 * changes (updateUser, own user only) or the world default / lock settings change. Calls are
 * debounced (500 ms), so a burst gives one pass; each pass is createWarmup's own acquire and
 * release pair, so nothing is acquired here and the reference counting stays balanced.
 *
 * @param {object} o
 * @param {() => unknown} o.rewarm what to run once the burst settles (main: refreshMaterials)
 * @param {() => string|undefined} o.getUserId the current user's id
 * @param {() => unknown} [o.getAppearance] the user's resolved appearance; a pass whose result
 *   (compared as JSON) equals the one at markWarmed() is skipped (the player's own theme change
 *   already rebuilt, or a world-default change that does not affect this user)
 * @param {number} [o.delay]
 * @returns {{onUpdateUser: Function, onSettingChange: Function, markWarmed: Function, dispose: Function}}
 */
export function createAppearanceRewarm({ rewarm, getUserId, getAppearance, delay = 500 }) {
  let timer = null;
  let warmedLook = null;
  const lookKey = () => {
    try {
      return getAppearance ? JSON.stringify(getAppearance()) : null;
    } catch {
      return null;
    }
  };
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const key = lookKey();
      if (key !== null && key === warmedLook) return;
      try {
        rewarm();
      } catch (err) {
        console.warn('dicer: re-warm after an appearance change failed', err);
      }
    }, delay);
  };
  return {
    onUpdateUser(user, changes) {
      const id = getUserId();
      if (!id || user?.id !== id) return;
      const dicer = changes?.flags?.dicer;
      if (dicer && ('appearance' in dicer || '-=appearance' in dicer)) schedule();
    },
    onSettingChange: schedule,
    /** Records the appearance the materials were just rebuilt for. */
    markWarmed() {
      warmedLook = lookKey();
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

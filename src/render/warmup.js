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
 * @param {(message: string, err: unknown) => void} [o.warn]
 * @returns {() => Promise<void>} warmUp(); resolves when no pass is left
 */
export function createWarmup({
  getBox,
  getRenderer,
  onWarmed = () => {},
  warn = (message, err) => console.warn(message, err),
}) {
  let warming = null;
  let again = false;
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
        const warm = box.acquireWarmup();
        try {
          await renderer.warmup(warm.materials, warm.geometry);
          onWarmed();
        } catch (err) {
          warn('dicer: material warm-up failed', err);
        } finally {
          warm.release();
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
 * @param {number} [o.delay]
 * @returns {{onUpdateUser: Function, onSettingChange: Function, dispose: Function}}
 */
export function createAppearanceRewarm({ rewarm, getUserId, delay = 500 }) {
  let timer = null;
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
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
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

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

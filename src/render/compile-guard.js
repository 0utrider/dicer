/**
 * compileAsync with an exit. three r184's compileAsync polls program.isReady() every 10 ms
 * with no timeout and no context-loss check: isReady() caches only `true`, and on a lost
 * context getProgramParameter answers null (only the KHR_parallel_shader_compile query is
 * specified to report true on loss, and the extension is optional), so a context lost
 * mid-compile can leave the promise pending forever, and every `finally` that releases
 * materials, fade clones and label textures behind it never runs.
 *
 * compileGuarded races it against the canvas' webglcontextlost event and a timeout, and
 * rejects on either. It rejects at once (without compiling) on an already lost context.
 * three's own poll is not ours to stop; on a restored context it ends as soon as
 * isReady() answers.
 */
export const COMPILE_TIMEOUT_MS = 10000;

export class CompileAbortedError extends Error {
  constructor(reason) {
    super(`dicer: shader compile aborted (${reason})`);
    this.name = 'CompileAbortedError';
    this.reason = reason;
  }
}

/**
 * @param {object} renderer THREE.WebGLRenderer (compileAsync, getContext, domElement)
 * @param {object} scene
 * @param {object} camera
 * @param {object|null} [targetScene]
 * @param {{canvas?: EventTarget, timeoutMs?: number}} [o] canvas defaults to renderer.domElement
 * @returns {Promise<unknown>} compileAsync's value; rejects with CompileAbortedError
 *   (reason 'context-lost' or 'timeout') or with compileAsync's own error
 */
export function compileGuarded(
  renderer,
  scene,
  camera,
  targetScene = null,
  { canvas = renderer.domElement, timeoutMs = COMPILE_TIMEOUT_MS } = {},
) {
  return new Promise((resolve, reject) => {
    let lost = false;
    try {
      lost = !!renderer.getContext?.()?.isContextLost?.();
    } catch {
      lost = false;
    }
    if (lost) {
      reject(new CompileAbortedError('context-lost'));
      return;
    }
    let settled = false;
    let timer = null;
    const onLost = () => settle(new CompileAbortedError('context-lost'));
    function settle(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      canvas?.removeEventListener?.('webglcontextlost', onLost);
      if (err) reject(err);
      else resolve(value);
    }
    canvas?.addEventListener?.('webglcontextlost', onLost);
    timer = setTimeout(() => settle(new CompileAbortedError('timeout')), timeoutMs);
    let pending;
    try {
      pending = renderer.compileAsync(scene, camera, targetScene);
    } catch (err) {
      settle(err);
      return;
    }
    Promise.resolve(pending).then(
      (v) => settle(null, v),
      (err) => settle(err),
    );
  });
}

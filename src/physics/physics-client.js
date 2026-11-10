import { MSG, READY } from './protocol.js';

/**
 * Create the physics worker: a separate (non-inlined) module chunk. Vite rewrites this exact
 * `new Worker(new URL(...))` form into an emitted chunk next to dicer.js.
 */
export function createPhysicsWorker() {
  return new Worker(new URL('./physics.worker.js', import.meta.url), { type: 'module' });
}

/** Main-thread handle to the single physics worker. */
export class PhysicsClient {
  /**
   * @param {() => Worker} createWorker
   * @param {{ hulls?: Record<string, { points: Float32Array, radius: number }>, area?: object }} [options] hulls come from
   *   `computeHulls()` (main thread); the worker never builds geometry.
   */
  constructor(createWorker, { hulls, area } = {}) {
    this._worker = createWorker();
    this._isReady = false;
    this._failed = null;
    this._queue = [];
    this._streams = new Map();
    this._nextId = 1;
    this._ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    this._ready.catch(() => {}); // surfaced via ready(); avoid unhandled rejection noise
    this._worker.onmessage = (e) => this._onMessage(e.data);
    // A crashed or unreadable worker never answers again: fail everything pending.
    this._worker.onerror = (e) => {
      e?.preventDefault?.();
      this._fail(new Error(`dicer: physics worker error: ${e?.message ?? 'unknown error'}`));
    };
    this._worker.onmessageerror = () =>
      this._fail(new Error('dicer: physics worker message could not be deserialized'));
    this._worker.postMessage({ type: MSG.INIT, hulls, area });
  }

  ready() {
    return this._ready;
  }

  resize(area) {
    this._send({ type: MSG.RESIZE, area });
  }

  /** @returns {{ onChunk(cb): void, done: Promise<{settledStep:number}> }} */
  throw(req) {
    const s = { cb: null, pending: [], resolve: null, reject: null };
    const done = new Promise((resolve, reject) => {
      s.resolve = resolve;
      s.reject = reject;
    });
    const stream = {
      onChunk: (cb) => {
        s.cb = cb;
        for (const c of s.pending.splice(0)) cb(c);
      },
      done,
    };
    done.catch(() => {}); // callers that only await onChunk must not trigger unhandled rejections
    if (this._failed) {
      s.reject(this._failed);
      return stream;
    }
    const id = this._nextId++;
    this._streams.set(id, s);
    this._send({ type: MSG.THROW, id, dice: req.dice, seed: req.seed });
    return stream;
  }

  /** Hand a consumed chunk buffer back to the worker's pool (transferred). */
  recycle(buffer) {
    if (this._failed) return;
    this._worker.postMessage({ type: MSG.RECYCLE, buffer }, [buffer.buffer]);
  }

  terminate() {
    this._worker.terminate();
    this._fail(new Error('dicer: physics worker terminated'));
  }

  /** Throws and resizes keep their relative order: both wait for ready, in one queue. */
  _send(msg) {
    if (this._isReady) this._worker.postMessage(msg);
    else this._queue.push(msg);
  }

  /** Permanently fail: reject ready and every pending stream, drop queued messages. */
  _fail(err) {
    if (this._failed) return;
    this._failed = err;
    this._rejectReady(err);
    for (const s of this._streams.values()) s.reject(err);
    this._streams.clear();
    this._queue.length = 0;
  }

  _onMessage(m) {
    if (m.type === READY) {
      this._isReady = true;
      this._resolveReady();
      for (const q of this._queue.splice(0)) this._worker.postMessage(q);
      return;
    }
    const s = this._streams.get(m.id);
    if (m.type === MSG.CHUNK && s) {
      const chunk = { index: m.index, steps: m.steps, data: m.data, done: m.done };
      if (s.cb) s.cb(chunk);
      else s.pending.push(chunk);
    } else if (m.type === MSG.DONE && s) {
      this._streams.delete(m.id);
      s.resolve({ settledStep: m.settledStep });
    } else if (m.type === MSG.ERROR) {
      const err = new Error(m.message);
      if (s) {
        this._streams.delete(m.id);
        s.reject(err);
      } else if (!this._isReady) {
        this._fail(err); // init failed: nothing queued can ever run
      }
    }
  }
}

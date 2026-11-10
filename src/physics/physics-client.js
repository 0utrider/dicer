import { MSG, READY } from './protocol.js';

/** Main-thread handle to the single physics worker. */
export class PhysicsClient {
  /** @param {() => Worker} createWorker */
  constructor(createWorker) {
    this._worker = createWorker();
    this._isReady = false;
    this._queue = [];
    this._streams = new Map();
    this._nextId = 1;
    this._ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    this._ready.catch(() => {}); // surfaced via ready(); avoid unhandled rejection noise
    this._worker.onmessage = (e) => this._onMessage(e.data);
    this._worker.postMessage({ type: MSG.INIT });
  }

  ready() {
    return this._ready;
  }

  resize(area) {
    this._worker.postMessage({ type: MSG.RESIZE, area });
  }

  /** @returns {{ onChunk(cb): void, done: Promise<{settledStep:number}> }} */
  throw(req) {
    const id = this._nextId++;
    const s = { cb: null, pending: [], resolve: null, reject: null };
    const done = new Promise((resolve, reject) => {
      s.resolve = resolve;
      s.reject = reject;
    });
    this._streams.set(id, s);
    const msg = { type: MSG.THROW, id, dice: req.dice, seed: req.seed };
    if (this._isReady) this._worker.postMessage(msg);
    else this._queue.push(msg);
    return {
      onChunk: (cb) => {
        s.cb = cb;
        for (const c of s.pending.splice(0)) cb(c);
      },
      done,
    };
  }

  /** Hand a consumed chunk buffer back to the worker's pool (transferred). */
  recycle(buffer) {
    this._worker.postMessage({ type: MSG.RECYCLE, buffer }, [buffer.buffer]);
  }

  terminate() {
    this._worker.terminate();
    const err = new Error('dicer: physics worker terminated');
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
        this._rejectReady(err);
      }
    }
  }
}

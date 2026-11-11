// Builds runtime digit atlases (lazy chunk, loaded on the first css: / file: font).
//
// Where each half of the work runs:
//  - file: fonts are loaded (FontFace on self.fonts), drawn on an OffscreenCanvas and
//    distance-transformed entirely in the font worker.
//  - css: fonts (installed on the computer, or loaded by the page's CSS) are drawn on the main
//    thread, one glyph per idle slice, and only the distance transform runs in the worker. A
//    worker sees neither document fonts nor, reliably across browsers, locally installed
//    families, and drawing eleven glyphs is cheap; the distance transform is the expensive part.
//  - With no usable worker (none given, it failed to start or crashed, or it has no
//    OffscreenCanvas / FontFace for a file font) the missing work runs on the main thread in
//    idle slices of at most 8 ms.
import {
  rasterSteps,
  buildAtlasSteps,
  runSliced,
  cssString,
  RASTER_PX,
  FontError,
} from './sdf-builder.js';

const defaultIdle = (cb) =>
  typeof globalThis.requestIdleCallback === 'function'
    ? globalThis.requestIdleCallback(cb, { timeout: 500 })
    : setTimeout(cb, 0);

function defaultMakeCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  return Object.assign(globalThis.document.createElement('canvas'), { width: w, height: h });
}

/** Loads a file font on the page (main-thread fallback) under its synthetic family. */
async function defaultLoadFace({ family, url }) {
  const face = new FontFace(family, `url("${cssString(url)}")`);
  globalThis.document.fonts.add(await face.load());
}

/** Lets document.fonts fetch a family the page's CSS declares; an installed one needs nothing. */
async function defaultLoadFamily(family) {
  try {
    await globalThis.document?.fonts?.load?.(`${RASTER_PX}px "${cssString(family)}"`);
  } catch {
    /* not a CSS font: drawn as installed (or found missing by the raster's coverage check) */
  }
}

const strip = ({ json, width, height, field }) => ({ json, width, height, field });

/**
 * @param {object} o
 * @param {(() => Worker) | null} [o.createWorker]
 * @param {(cb: Function) => void} [o.idle]
 * @param {() => number} [o.now]
 * @param {(w: number, h: number) => object} [o.makeCanvas] main-thread canvas
 * @param {(source: object) => Promise<void>} [o.loadFace] main-thread FontFace load (file fonts)
 * @param {(family: string) => Promise<void>} [o.loadFamily] main-thread CSS family load
 */
export function createFontBuilder({
  createWorker = null,
  idle = defaultIdle,
  now = () => globalThis.performance.now(),
  makeCanvas = defaultMakeCanvas,
  loadFace = defaultLoadFace,
  loadFamily = defaultLoadFamily,
} = {}) {
  let worker = null;
  let dead = !createWorker;
  let seq = 0;
  const pending = new Map(); // id -> { resolve, reject }

  function kill(err) {
    dead = true;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    try {
      worker?.terminate();
    } catch {
      /* gone */
    }
    worker = null;
  }

  function getWorker() {
    if (dead) return null;
    if (worker) return worker;
    try {
      worker = createWorker();
    } catch {
      worker = null;
    }
    if (!worker) {
      dead = true;
      return null;
    }
    worker.onmessage = (e) => {
      const m = e.data;
      const p = pending.get(m?.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(strip(m));
      else p.reject(new FontError(m.code ?? 'error', m.message ?? 'font worker error'));
    };
    worker.onerror = (e) => {
      e?.preventDefault?.();
      kill(new FontError('worker', `font worker error: ${e?.message ?? 'unknown'}`));
    };
    worker.onmessageerror = () => kill(new FontError('worker', 'font worker message unreadable'));
    return worker;
  }

  /** Posts a job; null when no worker can take it. */
  function call(msg) {
    const w = getWorker();
    if (!w) return null;
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      try {
        w.postMessage({ ...msg, id });
      } catch (err) {
        pending.delete(id);
        reject(new FontError('worker', err?.message ?? String(err)));
      }
    });
  }

  const sliced = (gen) => runSliced(gen, { idle, now });

  async function fieldOf(glyphs, family) {
    // The glyphs are copied (not transferred): if the worker dies, the main thread still has them.
    const job = call({ type: 'sdf', glyphs, family });
    if (job) {
      try {
        return await job;
      } catch (err) {
        if (err?.code !== 'worker') throw err;
      }
    }
    return sliced(buildAtlasSteps(glyphs, { face: family }));
  }

  /** @param {{kind: 'css'|'file', family: string, url?: string}} source from fontSource() */
  async function build(source) {
    if (source.kind === 'file') {
      const job = call({ type: 'build', family: source.family, url: source.url });
      if (job) {
        try {
          return await job;
        } catch (err) {
          // a font that cannot load or lacks digits fails; a worker that cannot draw falls back
          if (err?.code !== 'unsupported' && err?.code !== 'worker') throw err;
        }
      }
      await loadFace(source);
    } else {
      await loadFamily(source.family);
    }
    const glyphs = await sliced(rasterSteps({ family: source.family, makeCanvas }));
    return fieldOf(glyphs, source.family);
  }

  function dispose() {
    kill(new FontError('worker', 'disposed'));
  }

  return { build, dispose };
}

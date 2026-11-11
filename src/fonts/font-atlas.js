// The font layer: which digit atlas a look's numbers.font draws with (P7-D3, P7-D5).
//
//   serif        the bundled MSDF atlas loaded at world start (always ready)
//   sans         the bundled Atkinson Hyperlegible MSDF atlas, loaded on first use
//   css:<family> a font installed on the computer (or one the page's CSS loaded), built at runtime
//   file:<path>  a font file on the Foundry server, built at runtime
//
// Runtime atlases are single-channel SDFs (sdf-builder.js) built by the lazy font-builder chunk,
// mostly in the font worker. Nothing waits for them: get() is null until a font is ready, the
// caller draws with the serif meanwhile, and onReady tells it to rebuild its materials.
import * as THREE from 'three';
import { parseAtlas } from '../render/sdf-atlas.js';
import { normalizeAppearance } from '../look/appearance.js';

/** A font that is not ready this long after it was requested is given up on (null, one warning). */
export const FONT_TIMEOUT_MS = 8000;
/** Bump when sdf-builder's output changes: stored atlases of another version are not reused. */
export const GENERATOR_VERSION = 1;
/** A stored-atlas lookup slower than this counts as "not stored" (a hung IndexedDB). */
export const STORE_TIMEOUT_MS = 500;
const CSS_FAMILY = /^[A-Za-z0-9 -]{1,64}$/;

/**
 * The font worker: its own lazy chunk (Vite rewrites this exact `new Worker(new URL(...))` form).
 */
export function createFontWorker() {
  return new Worker(new URL('./font-worker.js', import.meta.url), { type: 'module' });
}

const validId = (id) => normalizeAppearance({ numbers: { font: id } }).numbers.font === id;

/**
 * The URL of a `file:` font path, or null. This is the security boundary for file fonts: the
 * path must pass normalizeAppearance's check, is routed with Foundry's getRoute and percent-
 * encoded with encodeURI (never decoded), and must resolve on the page's own origin.
 * @param {string} path the part after "file:"
 * @param {{getRoute: (p: string) => string, origin: string}} env
 */
export function fontFileUrl(path, { getRoute, origin }) {
  if (typeof path !== 'string' || !validId(`file:${path}`)) return null;
  try {
    const route = getRoute(path);
    if (typeof route !== 'string') return null;
    const url = new URL(encodeURI(route), origin);
    return url.origin === new URL(origin).origin ? url.href : null;
  } catch {
    return null;
  }
}

/** FNV-1a, base 36: a stable synthetic family name per font file. */
function hashOf(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * What the builder needs for a runtime font id, or null when the id is not a usable css: / file:
 * id. A file font is loaded under a synthetic family name, so no user text reaches CSS as a name.
 * @returns {{kind: 'css', family: string} | {kind: 'file', family: string, url: string} | null}
 */
export function fontSource(id, env) {
  if (typeof id !== 'string' || !validId(id)) return null;
  if (id.startsWith('css:')) {
    const family = id.slice(4);
    return CSS_FAMILY.test(family) ? { kind: 'css', family } : null;
  }
  if (id.startsWith('file:')) {
    const url = fontFileUrl(id.slice(5), env);
    return url ? { kind: 'file', family: `dicer-font-${hashOf(id)}`, url } : null;
  }
  return null;
}

/**
 * A built atlas ({json, width, height, field}) as the atlas object createDiceMaterial takes: the
 * one-channel field copied into R, G and B of an RGBA DataTexture (P7-D3). The field's rows are
 * already bottom-up, so flipY stays false.
 */
export function dataTextureAtlas(built) {
  const { width, height, field } = built;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = field[i];
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(
    rgba,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  // Distances must not be filtered across glyphs or gamma-decoded.
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.flipY = false;
  texture.needsUpdate = true;
  return { ...parseAtlas(built.json), texture };
}

/**
 * IndexedDB store of built atlases (one small single-channel field each). The database version
 * is the generator version: an upgrade drops atlases built by an older generator. Every failure
 * reads as "not stored".
 */
export function idbStore({ name = 'dicer-fonts', idb = globalThis.indexedDB } = {}) {
  if (!idb?.open) return { get: async () => undefined, set: async () => {} };
  let db = null;
  const open = () =>
    (db ??= new Promise((resolve, reject) => {
      const req = idb.open(name, GENERATOR_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (d.objectStoreNames.contains('atlases')) d.deleteObjectStore('atlases');
        d.createObjectStore('atlases');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    }));
  const run = (mode, fn) =>
    open().then(
      (d) =>
        new Promise((resolve, reject) => {
          const tx = d.transaction('atlases', mode);
          const req = fn(tx.objectStore('atlases'));
          tx.oncomplete = () => resolve(req.result);
          tx.onerror = tx.onabort = () => reject(tx.error);
        }),
    );
  return {
    get: (key) => run('readonly', (s) => s.get(key)),
    set: (key, value) => run('readwrite', (s) => s.put(value, key)),
  };
}

const isBuilt = (v) =>
  v &&
  typeof v === 'object' &&
  v.json &&
  Number.isInteger(v.width) &&
  Number.isInteger(v.height) &&
  v.field instanceof Uint8Array &&
  v.field.length === v.width * v.height;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`not ready after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} o
 * @param {object} o.serif the bundled serif atlas (loadDigitAtlas), always ready
 * @param {(name: 'sans') => Promise<object>} o.loadBundled loads a bundled prebuilt atlas
 * @param {() => Worker} [o.createWorker] the font worker (createFontWorker); without it every
 *   runtime font is built on the main thread in idle slices
 * @param {(source: object) => Promise<{json, width, height, field}>} [o.build] test seam: replaces
 *   the lazy font-builder chunk
 * @param {(msg: string, err?: unknown) => void} [o.warn]
 * @param {number} [o.cacheSize] runtime atlases kept in memory (least recently used evicted and
 *   its texture disposed); serif and sans are never evicted
 * @param {{get: Function, set: Function}} [o.store] persistent cache (IndexedDB)
 * @param {(p: string) => string} [o.getRoute] Foundry's getRoute
 * @param {string} [o.origin] the page origin file fonts must stay on
 * @param {(built: object) => object} [o.toAtlas] built atlas -> material atlas (dataTextureAtlas)
 */
export function createFontAtlases({
  serif,
  loadBundled,
  createWorker = null,
  build = null,
  warn = console.warn,
  cacheSize = 6,
  timeoutMs = FONT_TIMEOUT_MS,
  store = idbStore(),
  getRoute = (p) => globalThis.foundry.utils.getRoute(p),
  origin = globalThis.location?.origin,
  toAtlas = dataTextureAtlas,
} = {}) {
  const pinned = new Map(); // 'sans' -> atlas
  const lru = new Map(); // runtime id -> atlas, least recently used first
  const inflight = new Map(); // id -> Promise<atlas | null>
  const failed = new Set();
  const holds = new Map(); // runtime atlas -> materials binding it
  const retired = new Set(); // evicted atlases still held: disposed on their last release
  const evictedDisposed = new WeakSet(); // evicted atlases whose texture is already disposed
  let storeDead = false;
  const listeners = new Set();
  let disposed = false;
  let builder = null;

  const buildFont =
    build ??
    ((source) =>
      (builder ??= import('./font-builder.js').then((m) =>
        m.createFontBuilder({ createWorker }),
      )).then((b) => b.build(source)));

  async function fromStore(key) {
    if (storeDead) return null;
    try {
      const v = await withTimeout(
        Promise.resolve().then(() => store.get(key)),
        STORE_TIMEOUT_MS,
      );
      return isBuilt(v) ? v : null;
    } catch (err) {
      // a hung store (timeout) is skipped from now on; a failed read just misses
      if (/^not ready after/.test(err?.message ?? '')) storeDead = true;
      return null;
    }
  }

  async function produce(id) {
    if (id === 'sans') return loadBundled('sans');
    const source = fontSource(id, { getRoute, origin });
    if (!source) throw new Error('not a usable font id');
    const key = `${GENERATOR_VERSION}|${id}`;
    const stored = await fromStore(key);
    if (stored) {
      try {
        return toAtlas(stored);
      } catch {
        /* unreadable: build it again */
      }
    }
    const built = await buildFont(source);
    if (!isBuilt(built)) throw new Error('the builder gave no atlas');
    Promise.resolve()
      .then(() => store.set(key, built))
      .catch(() => {});
    return toAtlas(built);
  }

  function keep(id, atlas) {
    if (id === 'sans') return void pinned.set(id, atlas);
    lru.set(id, atlas);
    for (const [old, a] of lru) {
      if (lru.size <= cacheSize) break;
      lru.delete(old);
      // a material may still bind it: dispose when the last hold is released
      if ((holds.get(a) ?? 0) > 0) retired.add(a);
      else disposeEvicted(a);
    }
  }

  /**
   * Marks `atlas` as bound by a material until the returned release() is called (idempotent).
   * An evicted atlas keeps its texture while held and is disposed on the last release.
   * The serif and sans atlases are never disposed by eviction: their holds are no-ops.
   */
  /** Disposes an evicted atlas's texture and remembers it, in case something binds it later. */
  function disposeEvicted(a) {
    a.texture?.dispose?.();
    evictedDisposed.add(a);
  }

  function hold(atlas) {
    if (!atlas || atlas === serif || [...pinned.values()].includes(atlas)) return () => {};
    // Already evicted and disposed (unheld at eviction, e.g. a thumbnail still waiting to render):
    // binding it makes three re-upload it, so it is retired again and freed on the last release.
    if (evictedDisposed.delete(atlas)) retired.add(atlas);
    holds.set(atlas, (holds.get(atlas) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (holds.get(atlas) ?? 1) - 1;
      if (n > 0) return void holds.set(atlas, n);
      holds.delete(atlas);
      if (retired.delete(atlas)) disposeEvicted(atlas);
    };
  }

  function fail(id, err) {
    failed.add(id);
    warn(
      `dicer: font ${JSON.stringify(id)} cannot be used (${err?.message ?? err}); its numbers use the serif`,
      err,
    );
  }

  function get(id) {
    if (!id || id === 'serif') return serif;
    if (disposed) return null;
    const p = pinned.get(id);
    if (p) return p;
    const a = lru.get(id);
    if (!a) return null;
    lru.delete(id); // most recently used now
    lru.set(id, a);
    return a;
  }

  function request(id) {
    const ready = get(id);
    if (ready) return Promise.resolve(ready);
    if (disposed || failed.has(id)) return Promise.resolve(null);
    if (inflight.has(id)) return inflight.get(id);
    const p = withTimeout(
      Promise.resolve().then(() => produce(id)),
      timeoutMs,
    ).then(
      (atlas) => {
        inflight.delete(id);
        if (disposed) {
          atlas?.texture?.dispose?.();
          return null;
        }
        keep(id, atlas);
        for (const cb of [...listeners]) {
          try {
            cb(id);
          } catch (err) {
            console.warn('dicer: a font-ready listener threw', err);
          }
        }
        return atlas;
      },
      (err) => {
        inflight.delete(id);
        if (!disposed) fail(id, err);
        return null;
      },
    );
    inflight.set(id, p);
    return p;
  }

  /** cb(fontId) each time a font becomes ready; returns an unsubscribe. */
  function onReady(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  function dispose() {
    disposed = true;
    for (const a of [...lru.values(), ...pinned.values(), ...retired]) a.texture?.dispose?.();
    lru.clear();
    pinned.clear();
    retired.clear();
    holds.clear();
    listeners.clear();
    builder?.then((b) => b.dispose?.()).catch(() => {});
  }

  return { get, request, onReady, hold, dispose };
}

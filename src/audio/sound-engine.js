// WebAudio sound engine: lazy AudioContext, pre-rendered synth buffers, voice cap, gains and
// cached custom files. Nothing here touches the dice box; callers feed it impact/result events.

export const MIN_IMPACT_SPEED = 4; // sim units/s; settling taps (p90 ~3.9) are silent
export const LOUD_IMPACT_SPEED = 24; // first floor impact median ~24 is full volume
export const MIN_GAIN = 0.03;
export const DIE_DEBOUNCE_MS = 40;
export const MAX_VOICES = 8;
export const IDLE_SUSPEND_MS = 30000;
export const CUSTOM_CACHE_SIZE = 32;
export const UNFOCUSED_GAIN = 0.25;
export const RATE_JITTER = 0.04;
// Buffers are rendered at a fixed rate and tagged with it; WebAudio resamples on playback,
// so the context's own rate never needs to be known before the first sound is due.
export const RENDER_RATE = 48000;

export function impactGain(speed) {
  if (!(speed > MIN_IMPACT_SPEED)) return 0;
  if (speed >= LOUD_IMPACT_SPEED) return 1;
  const t = (speed - MIN_IMPACT_SPEED) / (LOUD_IMPACT_SPEED - MIN_IMPACT_SPEED);
  return t * t;
}

const defaultIdle = (cb) => {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(() => cb(), { timeout: 1000 });
  return setTimeout(cb, 0);
};

export function createSoundEngine({
  createContext = () => new AudioContext(),
  loadSynth = () => import('./synth.js'),
  getSetting = () => undefined,
  hasFocus = () => (typeof document !== 'undefined' ? document.hasFocus() : true),
  fetchSound = (...a) => fetch(...a),
  idle = defaultIdle,
  warn = (...a) => console.warn(...a),
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
} = {}) {
  let ctx = null;
  let ctxFailed = false;
  let disposed = false;
  let rendered = null; // Map<key, Float32Array>
  let variants = 4;
  let preloading = null;
  let gestured = false;
  let gestureHooked = false;
  let idleTimer = null;
  const buffers = new Map(); // key -> AudioBuffer (built once a context exists)
  const cursor = new Map(); // material -> next variant
  const lastHit = new Map(); // dieKey -> time
  const custom = new Map(); // src -> AudioBuffer (LRU, insertion order)
  const failed = new Set();
  const inflight = new Map();
  let voices = []; // { src, gain, end }
  let warnedCtx = false;

  const setting = (k, fallback) => {
    try {
      return getSetting(k) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const volume = (k) => {
    const v = Number(setting(k, 1));
    return Number.isFinite(v) ? Math.max(0, v) : 1;
  };
  const focusFactor = () => {
    if (!setting('quietWhenUnfocused', true)) return 1;
    let f = true;
    try {
      f = hasFocus();
    } catch {
      /* assume focused */
    }
    return f ? 1 : UNFOCUSED_GAIN;
  };

  function ensureContext() {
    if (ctx) return ctx;
    if (ctxFailed || disposed) return null;
    try {
      ctx = createContext();
    } catch (e) {
      ctxFailed = true;
      if (!warnedCtx) {
        warnedCtx = true;
        warn('Dicer: WebAudio unavailable, sounds disabled', e);
      }
      return null;
    }
    return ctx;
  }

  function hookGesture() {
    if (gestureHooked) return;
    gestureHooked = true;
    const go = () => {
      gestured = true;
      resume();
    };
    try {
      if (typeof document !== 'undefined') document.addEventListener('pointerdown', go, { once: true });
    } catch {
      /* no DOM */
    }
    try {
      const p = globalThis.game?.audio?.awaitFirstGesture?.();
      if (p && typeof p.then === 'function') p.then(go, () => {});
    } catch {
      /* helper missing or throwing */
    }
  }

  function resume() {
    try {
      const r = ctx?.resume?.();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /** True when the context can play right now; otherwise arranges a resume and says no. */
  function running() {
    if (ctx.state === 'running') return true;
    if (ctx.state === 'closed') return false;
    if (gestured) resume();
    else hookGesture();
    return false;
  }

  function bufferFor(key) {
    let b = buffers.get(key);
    if (b) return b;
    const data = rendered?.get(key);
    if (!data) return null;
    b = ctx.createBuffer(1, data.length, RENDER_RATE);
    b.copyToChannel(data, 0);
    buffers.set(key, b);
    return b;
  }

  function prune() {
    const t = ctx.currentTime;
    voices = voices.filter((v) => v.end > t);
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function check() {
      if (!ctx || disposed) return;
      prune();
      if (voices.length) {
        idleTimer = setTimeout(check, IDLE_SUSPEND_MS);
        return;
      }
      if (ctx.state === 'running') {
        try {
          const r = ctx.suspend();
          if (r && typeof r.catch === 'function') r.catch(() => {});
        } catch {
          /* ignore */
        }
      }
    }, IDLE_SUSPEND_MS);
  }

  function start(buffer, gain, rate = 1) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(ctx.destination);
    const voice = { src, gain, end: ctx.currentTime + buffer.duration / rate };
    voices.push(voice);
    src.onended = () => {
      voices = voices.filter((v) => v !== voice);
    };
    src.start(0);
    armIdle();
    return voice;
  }

  /** Make room for a voice of `gain`; false when it should be dropped instead. */
  function admit(gain, slots) {
    prune();
    while (voices.length + slots > MAX_VOICES) {
      let q = voices[0];
      for (const v of voices) if (v.gain < q.gain) q = v;
      if (!q || q.gain >= gain) return false;
      try {
        q.src.stop();
      } catch {
        /* already ended */
      }
      voices = voices.filter((v) => v !== q);
    }
    return true;
  }

  function impact({ material, surface, speed, other, dieKey } = {}) {
    try {
      if (disposed || !setting('sounds', true)) return;
      const gain = impactGain(speed) * volume('soundVolume') * focusFactor();
      if (gain < MIN_GAIN) return;
      const t = now();
      if (dieKey !== undefined) {
        const last = lastHit.get(dieKey);
        if (last !== undefined && t - last < DIE_DEBOUNCE_MS) return;
      }
      if (!rendered) return; // synth not ready yet; a late clatter is worse than none
      if (!ensureContext() || !running()) return;

      const mat = material ?? 'plastic';
      const n = cursor.get(mat) ?? 0;
      let buf = null;
      for (let i = 0; i < variants && !buf; i++) buf = bufferFor(`impact:${mat}:${(n + i) % variants}`);
      if (!buf) return;
      const floor = other === -1;
      const surf = floor ? bufferFor(`surface:${surface}`) : null;
      if (!admit(gain, surf ? 2 : 1)) return;

      cursor.set(mat, (n + 1) % variants);
      if (dieKey !== undefined) lastHit.set(dieKey, t);
      if (lastHit.size > 256) for (const [k, v] of lastHit) if (t - v > 1000) lastHit.delete(k);
      start(buf, gain, 1 + (Math.random() * 2 - 1) * RATE_JITTER);
      if (surf) start(surf, gain, 1 + (Math.random() * 2 - 1) * RATE_JITTER);
    } catch (e) {
      warn('Dicer: impact sound failed', e);
    }
  }

  async function customBuffer(src) {
    if (custom.has(src)) {
      const b = custom.get(src);
      custom.delete(src);
      custom.set(src, b);
      return b;
    }
    if (failed.has(src)) return null;
    if (inflight.has(src)) return inflight.get(src);
    const p = (async () => {
      try {
        const res = await fetchSound(src);
        if (res && res.ok === false) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(bytes);
        custom.set(src, buf);
        while (custom.size > CUSTOM_CACHE_SIZE) custom.delete(custom.keys().next().value);
        return buf;
      } catch (e) {
        failed.add(src);
        warn(`Dicer: sound file ${src} could not be loaded`, e);
        return null;
      } finally {
        inflight.delete(src);
      }
    })();
    inflight.set(src, p);
    return p;
  }

  async function result(sound) {
    try {
      if (disposed || !sound || !setting('sounds', true)) return;
      let vol = volume('effectsVolume') * volume('soundVolume') * focusFactor();
      if (sound.src === undefined && sound.builtin === undefined) return;
      if (sound.src !== undefined) vol *= sound.volume ?? 1;
      if (vol < MIN_GAIN / 10) return;
      if (sound.builtin !== undefined && !rendered && preloading) await preloading;
      if (disposed || !ensureContext() || !running()) return;
      let buf;
      if (sound.src !== undefined) buf = await customBuffer(String(sound.src));
      else buf = rendered ? bufferFor(`result:${sound.builtin}`) : null;
      if (!buf || disposed) return;
      if (ctx.state !== 'running') return;
      start(buf, vol, 1);
    } catch (e) {
      warn('Dicer: result sound failed', e);
    }
  }

  function preload() {
    if (preloading) return preloading;
    preloading = (async () => {
      try {
        const mod = await loadSynth();
        if (Number.isInteger(mod.VARIANTS) && mod.VARIANTS > 0) variants = mod.VARIANTS;
        rendered = await mod.renderAll(RENDER_RATE, { idle });
      } catch (e) {
        warn('Dicer: sound synthesis failed', e);
      }
    })();
    return preloading;
  }

  function dispose() {
    disposed = true;
    clearTimeout(idleTimer);
    voices = [];
    buffers.clear();
    custom.clear();
    try {
      const r = ctx?.close?.();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  return { impact, result, preload, dispose };
}

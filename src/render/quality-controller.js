import { TIERS, TIER_ORDER, effectiveTier, tierFromProbe, AdaptiveQuality } from './quality.js';
import { runProbe } from './gpu-probe.js';

/** The tier used for `auto` until the probe has answered (rolls never wait for it). */
const PENDING_AUTO_TIER = 'medium';
const NOTIFIED_KEY = 'dicer.quality.dropNotified';

/** In-memory Storage stand-in: "once per session" means once per page load by default. */
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

/**
 * Owns the quality tier: runs the GPU probe once, applies min(choice or autoTier, worldCap)
 * minus the session drops to the renderer, drops a tier when frames stay over budget, and
 * forces `low` when a shader fails to compile.
 *
 * onChange(cb) listeners get `{ tier, config, reason }` whenever the effective tier changes
 * after ready: reason is 'settings' (refresh()), 'drop' (adaptive) or 'shader' (deferred to a
 * microtask so materials are never swapped in the middle of a render).
 *
 * @param {object} o
 * @param {object} o.renderer DiceRenderer (glRenderer, applyTier, onFrameTime, onShaderError)
 * @param {(key: string) => unknown} o.getSetting
 * @param {Function} [o.probe] runProbe(glRenderer, { atlas })
 * @param {object} [o.atlas] digit atlas for the probe's material
 * @param {(message: string) => void} [o.notify] shows the localized drop notice
 * @param {(key: string) => string} [o.localize]
 * @param {{getItem, setItem}} [o.storage] remembers that the drop notice was shown
 */
export function createQualityController({
  renderer,
  getSetting,
  probe = runProbe,
  atlas,
  notify = () => {},
  localize = (k) => globalThis.game?.i18n?.localize?.(k) ?? k,
  storage = memoryStorage(),
}) {
  let autoTier = null;
  // P2-R11: an adaptive drop sets a ceiling (tier index; null = none) that a user quality pick
  // clears; a shader failure forces low for the rest of the session.
  let adaptiveCeiling = null;
  let shaderForcedLow = false;
  let tier = null;
  let disposed = false;
  let shaderLogged = false;
  let notified = false;
  const listeners = new Set();

  function compute() {
    if (shaderForcedLow) return 'low';
    const base = effectiveTier({
      choice: String(getSetting('quality') ?? 'auto'),
      autoTier: autoTier ?? PENDING_AUTO_TIER,
      cap: String(getSetting('qualityCap') ?? 'ultra'),
    });
    const ceiling = adaptiveCeiling ?? TIER_ORDER.length - 1;
    return TIER_ORDER[Math.min(TIER_ORDER.indexOf(base), ceiling)];
  }

  const adaptive = new AdaptiveQuality({ onDrop: () => onDrop() });

  /** Re-applies the tier if it changed; returns whether it did. */
  function apply() {
    const next = compute();
    if (next === tier) return false;
    tier = next;
    renderer.applyTier(TIERS[tier]);
    adaptive.reset(); // P2-R10: a new tier gets a fresh window and grace
    return true;
  }

  function emit(reason) {
    const event = { tier, config: TIERS[tier], reason };
    for (const cb of [...listeners]) {
      try {
        cb(event);
      } catch (err) {
        console.error('dicer: quality listener failed', err);
      }
    }
  }

  function onDrop() {
    if (disposed || tier === 'low') return;
    adaptiveCeiling = Math.max(0, TIER_ORDER.indexOf(tier) - 1);
    if (!apply()) return;
    emit('drop');
    notifyOnce();
  }

  function notifyOnce() {
    if (notified) return;
    notified = true;
    try {
      if (storage.getItem(NOTIFIED_KEY) === '1') return;
      storage.setItem(NOTIFIED_KEY, '1');
    } catch {
      // storage unavailable: once per controller still holds
    }
    try {
      notify(localize('DICER.Quality.Dropped'));
    } catch {
      // a notice is best effort
    }
  }

  function onShaderError(info) {
    if (disposed) return;
    if (!shaderLogged) {
      shaderLogged = true;
      console.warn(
        'dicer: a dice shader failed to compile; falling back to the low tier',
        info?.log,
      );
    }
    shaderForcedLow = true; // for the session, whatever the user picks
    if (!apply()) return;
    // The error fires inside renderer.render(): swap materials after this frame, before the next.
    queueMicrotask(() => {
      if (!disposed) emit('shader');
    });
  }

  apply(); // pre-probe tier, so early rolls use consistent flags and pixel ratio
  renderer.onFrameTime?.((ms) => {
    if (!disposed) adaptive.frame(ms);
  });
  renderer.onShaderError?.(onShaderError);

  const ready = (async () => {
    let result = null;
    try {
      result = await probe(renderer.glRenderer, { atlas });
    } catch {
      result = null;
    }
    if (disposed) return;
    const ms = result?.msPerFrame;
    autoTier =
      Number.isFinite(ms) && ms > 0 ? tierFromProbe({ msPerFrame: ms }) : PENDING_AUTO_TIER;
    apply(); // the probe result is part of ready: main warms up after it, no onChange here
  })();

  return {
    ready,
    get tier() {
      return tier;
    },
    get config() {
      return TIERS[tier];
    },
    /** Material feature flags: client toggles combined with the tier. */
    flags() {
      const steps = TIERS[tier].interiorSteps;
      return {
        interiors: !!getSetting('interiors') && steps > 0,
        engraving: !!getSetting('engraving'),
        glow: !!getSetting('glow'),
        interiorSteps: steps,
      };
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    /**
     * Re-reads quality and qualityCap (settings onChange); emits 'settings' on a change.
     * @param {'quality'|'qualityCap'} [key] the setting that changed. A user `quality` pick
     *   clears the adaptive ceiling and restarts the adaptive window (P2-R11); a qualityCap
     *   change keeps the ceiling.
     */
    refresh(key) {
      if (disposed) return;
      if (key === 'quality') {
        adaptiveCeiling = null;
        adaptive.reset(); // also when the tier is unchanged: the user asked for a fresh try
      }
      if (apply()) emit('settings');
    },
    /** Call when the warm-up for the current tier/look has compiled (P2-R10). */
    warmedUp() {
      if (!disposed) adaptive.reset();
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

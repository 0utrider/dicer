/**
 * Inside flare: crit and fumble effects make a resin die's living inside flare up (liquid boils,
 * glitter scatters, fire roars, storm strikes, frost flashes, lava cracks wide, the others
 * brighten). The level, 0..1, goes to the die's uInteriorFlare uniform; every inside's moving GLSL
 * reads it (src/render/extras/insides/*), glitter's swirl too (motion.js, through live.js).
 *
 * uInteriorFlare exists only on a material whose look has a moving inside (resin, an inside,
 * a marched tier, insideMotion on: live.js MOTION_PARS). Without it the flare is a no-op: nothing
 * is isolated, nothing is written, so a plain die never gets its own material for a flare.
 *
 * Effects run only where they are shown, so a hidden or blind roll that shows no effect never
 * flares an inside either.
 */

export const FLARE_RISE_MS = 80;
/** Under reduced motion the flare rises once, softly, then only falls: nothing pulses. */
export const FLARE_RISE_CALM_MS = 300;

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * The envelope at `e` ms of `duration`: a smooth rise over 80 ms (300 ms reduced; at most half
 * the duration), then a linear decay to 0 at `duration`. Monotonic up then down, never above 1.
 */
export function flareLevel(e, duration, reduced) {
  if (!(e > 0) || !(e < duration)) return 0;
  const rise = Math.min(reduced ? FLARE_RISE_CALM_MS : FLARE_RISE_MS, duration / 2);
  if (e < rise) return smooth(e / rise);
  return 1 - (e - rise) / (duration - rise);
}

// the uInteriorFlare uniform object -> the levels of the flares running on it. Keyed by the
// uniform, not the die: DiceBox's #reisolate carries the same uniform object to a new material.
const active = new WeakMap();

function write(uniform) {
  let v = 0;
  for (const f of active.get(uniform) ?? []) v = Math.max(v, f.v);
  uniform.value = Math.min(1, v);
}

const NOOP = Object.freeze({ update: () => false, stop() {} });

/**
 * Flares `die`'s inside for `duration` ms (default ctx.duration), `amount` (0..1, higher is
 * capped) times the envelope. Overlapping flares on one die take the max, capped at 1.
 * Returns an effect handle { update(nowMs) -> boolean, stop() }: the envelope's clock starts at
 * the first update, update turns false at `duration`, and stop() (or the end) takes this flare
 * away (the die keeps the max of the others, 0 without). A no-op handle when the insideFlare
 * setting is off (ctx.setting), the die has no moving inside or ctx.isolate gives nothing.
 */
export function flareInside(ctx, die, { amount = 1, duration = ctx?.duration } = {}) {
  let on = true;
  try {
    on = ctx.setting?.('insideFlare') !== false;
  } catch {
    // unreadable: the default (on)
  }
  if (!on || !die?.inner?.material?.userData?.uniforms?.uInteriorFlare) return NOOP;
  const uniform = ctx.isolate?.(die)?.uInteriorFlare;
  if (!uniform) return NOOP;
  const D = Math.max(0, Number(duration) || 0);
  const k = Math.max(0, Number(amount) || 0);
  const reduced = !!ctx.reducedMotion;
  const me = { v: 0 };
  let set = active.get(uniform);
  if (!set) active.set(uniform, (set = new Set()));
  set.add(me);
  let t0 = null;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    set.delete(me);
    write(uniform);
  };
  return {
    update(now) {
      if (done) return false;
      t0 ??= now;
      const e = now - t0;
      if (!(e < D)) {
        stop();
        return false;
      }
      me.v = k * flareLevel(e, D, reduced);
      write(uniform);
      return true;
    },
    stop,
  };
}

/**
 * `handle` with an inside flare on ctx.die alongside it (amount ctx.intensity, ctx.duration):
 * alive while either is, stop() stops both. Just `handle` when the flare is a no-op.
 */
export function withInsideFlare(ctx, handle) {
  const flare = flareInside(ctx, ctx.die, { amount: ctx.intensity });
  if (flare === NOOP) return handle;
  return {
    update(now) {
      const alive = handle.update(now) === true;
      return flare.update(now) || alive;
    },
    stop() {
      flare.stop();
      handle.stop();
    },
  };
}

/** The flare as a free composite part (fumble): the part's duration and intensity. */
export const insideFlarePart = Object.freeze({
  id: 'inside-flare',
  cost: 0,
  defaults: Object.freeze({ color: '#ffffff', intensity: 1, duration: 1000 }),
  start: (ctx) => flareInside(ctx, ctx.die, { amount: ctx.intensity }),
});

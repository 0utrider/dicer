import * as THREE from 'three';

/**
 * Timeline composites: an effect made of parts, each starting `at` ms after the composite
 * (default 0). Kept apart from catalogue.js so staged effects can build on it without a cycle.
 */

/**
 * A part's context: the composite's, with the part's own colour, intensity and duration. A part
 * `duration` (ms at the composite's default duration) scales like `at`; without one the part's
 * default scaled the same way applies, never longer than the composite.
 */
function partContext(ctx, composite, part) {
  const d = part.mod.defaults;
  const color = ctx.options.color ? ctx.color : new THREE.Color(part.color ?? d.color);
  const scale = ctx.duration / composite.defaults.duration;
  return Object.create(ctx, {
    color: { value: color },
    intensity: { value: (part.intensity ?? d.intensity) * ctx.intensity },
    duration: { value: Math.min(ctx.duration, (part.duration ?? d.duration) * scale) },
    options: { value: { ...ctx.options, color: ctx.options.color } },
  });
}

/**
 * A composite starts its parts directly (not through the layer), so the layer budgets it as a
 * single effect whose declared cost is its essential part (P4-R10): on low a nat 20 or a fumble
 * still shows something. Extra parts, in priority order, run only while
 * essential + extras <= ctx.tier.effectBudget (decided when the composite starts, so a skipped
 * part never starts later); free (cost 0) parts always run. A part starts at `at` ms (scaled
 * with ctx.duration / defaults.duration). It ends when every started part has and none is still
 * waiting, or at ctx.duration.
 *
 * parts: [{ mod, at?, color?, intensity?, duration? }]; parts[0] is the essential one.
 */
export function composite({ id, defaults, parts }) {
  const [essential] = parts;
  const mod = {
    id,
    cost: essential.mod.cost,
    defaults: Object.freeze(defaults),
    start(ctx) {
      const budget = Number.isFinite(ctx.tier?.effectBudget) ? ctx.tier.effectBudget : Infinity;
      const scale = ctx.duration / mod.defaults.duration;
      let used = essential.mod.cost;
      const handles = [];
      const waiting = []; // { part, i, at } in part order
      let done = false;
      let starting = true; // true while composite.start() runs (an essential throw propagates)

      const begin = (part, i) => {
        let handle;
        try {
          handle = part.mod.start(partContext(ctx, mod, part));
        } catch (err) {
          if (i === 0) {
            if (starting) throw err; // started at once: composite.start() throws, as before
            stop(); // a delayed essential part failed: end the composite quietly
          }
          return false;
        }
        if (!handle) return false;
        handles.push(handle);
        return true;
      };

      const stop = () => {
        if (done) return;
        done = true;
        waiting.length = 0;
        for (const h of handles) {
          try {
            h.stop?.();
          } catch {
            /* a part failing to stop must not leave the others running */
          }
        }
      };

      parts.forEach((part, i) => {
        const c = part.mod.cost;
        if (i > 0 && c > 0 && used + c > budget) return;
        const at = Math.max(0, part.at ?? 0) * scale;
        if (at > 0) {
          if (i > 0) used += c;
          waiting.push({ part, i, at });
        } else if (begin(part, i) && i > 0) {
          used += c;
        }
      });
      waiting.sort((a, b) => a.at - b.at); // stable: equal times keep part order
      starting = false;

      let t0 = null;
      return {
        update(now) {
          if (done) return false;
          t0 ??= now;
          const elapsed = now - t0;
          if (elapsed >= ctx.duration) {
            stop();
            return false;
          }
          while (waiting.length && waiting[0].at <= elapsed) {
            const { part, i } = waiting.shift();
            begin(part, i);
            if (done) return false;
          }
          let alive = waiting.length > 0;
          for (const h of handles) alive = h.update(now) === true || alive;
          if (!alive) stop();
          return alive;
        },
        stop,
      };
    },
  };
  return Object.freeze(mod);
}

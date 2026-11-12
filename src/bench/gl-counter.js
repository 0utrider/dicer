/**
 * P9-R12: counts WebGL work per canvas while running, for the benchmark's GPU-work table. It wraps
 * the draw, bindFramebuffer and clear methods on the WebGL context prototypes (every context on the
 * page: the dice canvas, Foundry's board, anything else) and counts animation frames, so the
 * report can say what each canvas draws per frame. Bench import rule: no top-level host globals.
 */

const TRIANGLES = 4;
const TRIANGLE_STRIP = 5;
const TRIANGLE_FAN = 6;
const DRAWS = Object.freeze({
  // method -> (args) => [mode, vertex count, instances]
  drawArrays: (a) => [a[0], a[2], 1],
  drawElements: (a) => [a[0], a[1], 1],
  drawArraysInstanced: (a) => [a[0], a[2], a[3]],
  drawElementsInstanced: (a) => [a[0], a[1], a[4]],
  drawRangeElements: (a) => [a[0], a[3], 1],
});

function triangles(mode, count, instances) {
  const n = Number(count) || 0;
  const per = mode === TRIANGLES ? Math.floor(n / 3) : mode === TRIANGLE_STRIP || mode === TRIANGLE_FAN ? Math.max(0, n - 2) : 0;
  return per * (Number(instances) || 1);
}

/**
 * @param {object} [o]
 * @param {object[]} [o.protos] the context prototypes to wrap (default WebGL2 and WebGL)
 * @param {(canvas: object) => string} o.classify a canvas -> 'dice' | 'foundry' | 'other'
 * @param {(cb: Function) => unknown} [o.raf] requestAnimationFrame
 */
export function createGlCounter({ protos, classify, raf } = {}) {
  const targets = (
    protos ?? [globalThis.WebGL2RenderingContext?.prototype, globalThis.WebGLRenderingContext?.prototype]
  ).filter(Boolean);
  const schedule = raf ?? ((cb) => globalThis.requestAnimationFrame(cb));
  const saved = [];
  let byCanvas = {};
  let canvases = {};
  let frames = 0;
  let running = false;

  const tally = (canvas) => {
    let kind = 'other';
    try {
      kind = classify(canvas) ?? 'other';
    } catch {
      kind = 'other';
    }
    canvases[kind] ??= canvas;
    return (byCanvas[kind] ??= { draws: 0, triangles: 0, fbBinds: 0, clears: 0 });
  };

  function wrap(proto, name, count) {
    const original = proto[name];
    if (typeof original !== 'function') return;
    saved.push([proto, name, original]);
    proto[name] = function counted(...args) {
      try {
        count(tally(this.canvas), args);
      } catch {
        // counting never breaks a draw
      }
      return original.apply(this, args);
    };
  }

  const tick = () => {
    if (!running) return;
    frames++;
    schedule(tick);
  };

  return {
    start() {
      if (running) return;
      byCanvas = {};
      canvases = {};
      frames = 0;
      for (const proto of targets) {
        for (const [name, parts] of Object.entries(DRAWS)) {
          wrap(proto, name, (t, a) => {
            const [mode, count, instances] = parts(a);
            t.draws++;
            t.triangles += triangles(mode, count, instances);
          });
        }
        wrap(proto, 'bindFramebuffer', (t, a) => {
          if (a[1] != null) t.fbBinds++; // a render target; null is the canvas itself
        });
        wrap(proto, 'clear', (t) => {
          t.clears++;
        });
      }
      running = true;
      schedule(tick);
    },
    /** Restores the methods; resolves {frames, byCanvas: {kind: {draws, triangles, fbBinds, clears, width, height}}}. */
    stop() {
      running = false;
      for (const [proto, name, original] of saved.splice(0).reverse()) proto[name] = original;
      const out = {};
      for (const [kind, t] of Object.entries(byCanvas)) {
        const c = canvases[kind];
        out[kind] = { ...t, width: c?.width ?? null, height: c?.height ?? null };
      }
      return { frames, byCanvas: out };
    },
  };
}

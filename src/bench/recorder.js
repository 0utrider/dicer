/** In-page frame and long-task sampler. Product-neutral; no imports. */

export function createRecorder({ win = globalThis } = {}) {
  let rafId = null;
  let observer = null;
  let running = false;
  let last = null;
  let intervals = [];
  let longTasks = null;
  let longTaskAt = null;
  let startedAt = 0;
  let marks = {};

  const clock = () => (win.performance?.now ? win.performance.now() : Date.now());

  function tick(ts) {
    if (!running) return;
    const t = typeof ts === 'number' ? ts : clock();
    if (last !== null) intervals.push(t - last);
    last = t;
    rafId = win.requestAnimationFrame(tick);
  }

  /** A long task: its duration, and when it started (ms after start()) for tracing a stall. */
  function record(e) {
    if (!longTasks) return;
    longTasks.push(e.duration);
    const at = typeof e.startTime === 'number' ? e.startTime - startedAt : null;
    longTaskAt.push({ at, ms: e.duration });
  }

  function start() {
    if (running) return;
    running = true;
    intervals = [];
    marks = {};
    last = null;
    longTasks = null;
    longTaskAt = null;
    startedAt = clock();
    const PO = win.PerformanceObserver;
    if (PO && (!PO.supportedEntryTypes || PO.supportedEntryTypes.includes('longtask'))) {
      try {
        longTasks = [];
        longTaskAt = [];
        observer = new PO((list) => {
          for (const e of list.getEntries()) record(e);
        });
        observer.observe({ type: 'longtask' });
      } catch {
        observer = null;
        longTasks = null;
        longTaskAt = null;
      }
    }
    rafId = win.requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId !== null) win.cancelAnimationFrame(rafId);
    rafId = null;
    if (observer) {
      try {
        for (const e of observer.takeRecords?.() ?? []) record(e);
      } catch {
        /* ignore */
      }
      observer.disconnect();
      observer = null;
    }
    return { intervals, longTasks, longTaskAt, marks };
  }

  function mark(name) {
    marks[name] = clock() - startedAt;
  }

  return { start, stop, mark };
}

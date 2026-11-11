/** In-page frame and long-task sampler. Product-neutral; no imports. */

export function createRecorder({ win = globalThis } = {}) {
  let rafId = null;
  let observer = null;
  let running = false;
  let last = null;
  let intervals = [];
  let longTasks = null;
  let marks = {};

  const clock = () => (win.performance?.now ? win.performance.now() : Date.now());

  function tick(ts) {
    if (!running) return;
    const t = typeof ts === 'number' ? ts : clock();
    if (last !== null) intervals.push(t - last);
    last = t;
    rafId = win.requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    running = true;
    intervals = [];
    marks = {};
    last = null;
    longTasks = null;
    const PO = win.PerformanceObserver;
    if (PO && (!PO.supportedEntryTypes || PO.supportedEntryTypes.includes('longtask'))) {
      try {
        const lt = [];
        observer = new PO((list) => {
          for (const e of list.getEntries()) lt.push(e.duration);
        });
        observer.observe({ type: 'longtask' });
        longTasks = lt;
      } catch {
        observer = null;
        longTasks = null;
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
        for (const e of observer.takeRecords?.() ?? []) longTasks?.push(e.duration);
      } catch {
        /* ignore */
      }
      observer.disconnect();
      observer = null;
    }
    return { intervals, longTasks, marks };
  }

  function mark(name) {
    marks[name] = clock();
  }

  return { start, stop, mark };
}

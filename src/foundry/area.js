/** Debounce for area changes (window resize, #sidebar resize/transition). */
export const AREA_DEBOUNCE_MS = 150;

/**
 * The play area: the window minus the sidebar's rendered width. A collapsed v14 sidebar keeps
 * its tab strip, so the width is measured, never assumed to be 0.
 */
export function measureUsable({ doc = globalThis.document, win = globalThis.window } = {}) {
  const sidebar = doc?.getElementById?.('sidebar');
  const sidebarWidth = sidebar ? sidebar.getBoundingClientRect().width || 0 : 0;
  return {
    left: 0,
    top: 0,
    width: Math.max(1, win.innerWidth - sidebarWidth),
    height: win.innerHeight,
  };
}

/** Alias kept for existing callers. */
export const measureArea = measureUsable;

/**
 * Calls onResize (debounced) after the window resizes or #sidebar's size changes. v14 fires
 * collapseSidebar before its 250 ms transition ends, so the sidebar is observed directly.
 * @returns {() => void} stop watching
 */
export function watchArea(
  onResize,
  {
    doc = globalThis.document,
    win = globalThis.window,
    ResizeObserverCtor = globalThis.ResizeObserver,
    debounceMs = AREA_DEBOUNCE_MS,
  } = {},
) {
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(onResize, debounceMs);
  };
  win?.addEventListener?.('resize', schedule);
  const sidebar = doc?.getElementById?.('sidebar');
  let observer = null;
  if (sidebar && typeof ResizeObserverCtor === 'function') {
    observer = new ResizeObserverCtor(schedule);
    observer.observe(sidebar);
  }
  return () => {
    clearTimeout(timer);
    win?.removeEventListener?.('resize', schedule);
    observer?.disconnect();
  };
}

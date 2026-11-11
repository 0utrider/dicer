// @vitest-environment jsdom
import { measureArea, measureUsable, watchArea, AREA_DEBOUNCE_MS } from '../../src/foundry/area.js';

function sidebar(width) {
  const el = document.createElement('div');
  el.id = 'sidebar';
  el.getBoundingClientRect = () => ({ width, height: 900, left: 1600 - width, top: 0 });
  document.body.appendChild(el);
  return el;
}

class FakeResizeObserver {
  static instances = [];
  constructor(cb) {
    this.cb = cb;
    this.observed = [];
    this.disconnect = vi.fn();
    FakeResizeObserver.instances.push(this);
  }
  observe(el) {
    this.observed.push(el);
  }
  fire() {
    this.cb([]);
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
  FakeResizeObserver.instances = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('measureUsable', () => {
  test('is the canonical name and measureArea is an alias', () => {
    expect(measureArea).toBe(measureUsable);
    sidebar(300);
    expect(measureUsable({ doc: document, win: { innerWidth: 1600, innerHeight: 900 } })).toEqual({
      left: 0,
      top: 0,
      width: 1300,
      height: 900,
    });
  });
});

describe('measureArea', () => {
  test("subtracts the sidebar's rendered width, even when collapsed (the tab strip stays)", () => {
    sidebar(48); // collapsed: only the tab strip
    globalThis.ui = { sidebar: { expanded: false } };
    expect(measureArea({ doc: document, win: { innerWidth: 1600, innerHeight: 900 } })).toEqual({
      left: 0,
      top: 0,
      width: 1552,
      height: 900,
    });
    delete globalThis.ui;
  });

  test('uses the full window without a sidebar, and never returns a width under 1', () => {
    expect(measureArea({ doc: document, win: { innerWidth: 1200, innerHeight: 700 } }).width).toBe(
      1200,
    );
    sidebar(5000);
    expect(measureArea({ doc: document, win: { innerWidth: 1200, innerHeight: 700 } }).width).toBe(
      1,
    );
  });
});

describe('watchArea', () => {
  function makeWin() {
    const target = new EventTarget();
    target.innerWidth = 1600;
    target.innerHeight = 900;
    return target;
  }

  test(`observes #sidebar and calls onResize once, ${150} ms after the last size change`, () => {
    const el = sidebar(300);
    const onResize = vi.fn();
    watchArea(onResize, { doc: document, win: makeWin(), ResizeObserverCtor: FakeResizeObserver });
    const ro = FakeResizeObserver.instances[0];
    expect(ro.observed).toEqual([el]);
    // A 250 ms collapse transition reports several sizes.
    ro.fire();
    vi.advanceTimersByTime(100);
    ro.fire();
    vi.advanceTimersByTime(100);
    ro.fire();
    vi.advanceTimersByTime(AREA_DEBOUNCE_MS - 1);
    expect(onResize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  test('window resize goes through the same debounce', () => {
    sidebar(300);
    const w = makeWin();
    const onResize = vi.fn();
    watchArea(onResize, { doc: document, win: w, ResizeObserverCtor: FakeResizeObserver });
    w.dispatchEvent(new Event('resize'));
    FakeResizeObserver.instances[0].fire();
    vi.advanceTimersByTime(AREA_DEBOUNCE_MS);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  test('stop() disconnects the observer and removes the resize listener', () => {
    sidebar(300);
    const w = makeWin();
    const onResize = vi.fn();
    const stop = watchArea(onResize, {
      doc: document,
      win: w,
      ResizeObserverCtor: FakeResizeObserver,
    });
    stop();
    expect(FakeResizeObserver.instances[0].disconnect).toHaveBeenCalled();
    w.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(AREA_DEBOUNCE_MS);
    expect(onResize).not.toHaveBeenCalled();
  });

  test('without ResizeObserver or #sidebar, only the window resize is watched', () => {
    const w = makeWin();
    const onResize = vi.fn();
    const stop = watchArea(onResize, { doc: document, win: w, ResizeObserverCtor: undefined });
    w.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(AREA_DEBOUNCE_MS);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(() => stop()).not.toThrow();
  });
});

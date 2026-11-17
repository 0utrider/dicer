// @vitest-environment jsdom
/**
 * The dice tray in a window of its own (src/tray/popout.js): the tray it draws there, and the dice
 * canvas moving over and back. A second document stands in for the window (jsdom has no real one).
 */
import { afterEach, expect, test, vi } from 'vitest';
import { trayDepsFor, popOut, popIn, poppedOut } from '../../src/tray/popout.js';

/** A stand-in window: its own document, a size, listeners, close(). */
function fakeWindow(width = 900, height = 600) {
  const doc = document.implementation.createHTMLDocument('tray');
  const listeners = new Map();
  return {
    document: doc,
    innerWidth: width,
    innerHeight: height,
    closed: false,
    focus: vi.fn(),
    close() {
      this.closed = true;
    },
    addEventListener: (t, fn) => listeners.set(t, fn),
    fire: (t) => listeners.get(t)?.(),
  };
}

afterEach(() => {
  popIn();
  vi.restoreAllMocks();
});

test("the window's tray fills it, always shown, the table's when chosen and set, else the player's own", () => {
  const win = fakeWindow();
  const settings = {
    trayMode: 'table',
    tableTray: null,
    trayShow: 'rolls',
    trayRect: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
  };
  const deps = trayDepsFor(win, {
    getSetting: (k) => settings[k],
    route: (p) => p,
    activeRolls: () => 0,
  });
  expect(deps.getSetting('trayRect')).toEqual({ x: 0, y: 0, w: 1, h: 1 }); // fills the window
  expect(deps.getSetting('trayShow')).toBe('always');
  expect(deps.getSetting('trayMode')).toBe('mine'); // no table tray in the world: the player's own
  settings.tableTray = { surface: 'wood' };
  expect(deps.getSetting('trayMode')).toBe('table');
  settings.trayMode = 'none'; // trays off on the table: the window is still a tray
  expect(deps.getSetting('trayMode')).toBe('mine');
  expect(deps.measure()).toEqual({ left: 0, top: 0, width: 900, height: 600 });
  expect(deps.doc).toBe(win.document);
});

test('popping out moves the dice canvas into the window with a tray filling it; closing brings it back', () => {
  const win = fakeWindow();
  vi.spyOn(globalThis, 'open').mockReturnValue(win);
  const home = document.createElement('div');
  document.body.append(home);
  const canvas = document.createElement('canvas');
  canvas.id = 'dicer-canvas';
  home.append(canvas);
  const set = vi.fn();
  const resize = vi.fn();
  popOut({
    canvas,
    resize,
    set,
    getSetting: () => undefined,
    route: (p) => p,
    activeRolls: () => 0,
  });
  expect(poppedOut()).toBe(true);
  expect(win.document.getElementById('dicer-canvas')).toBe(canvas); // the same canvas (one renderer)
  expect(win.document.getElementById('dicer-table-tray')).toBeTruthy();
  const popped = set.mock.calls.at(-1)[0];
  expect(popped.stage()).toEqual({ left: 0, top: 0, width: 900, height: 600 });
  expect(popped.tray.area()).toMatchObject({ strict: true }); // rolls land in it
  expect(resize).toHaveBeenCalled();
  win.fire('pagehide'); // the window closed
  expect(poppedOut()).toBe(false);
  expect(canvas.parentNode).toBe(home);
  expect(set).toHaveBeenLastCalledWith(null);
  home.remove();
});

test('a blocked pop-up warns and changes nothing', () => {
  vi.spyOn(globalThis, 'open').mockReturnValue(null);
  const warn = vi.fn();
  globalThis.ui = { notifications: { warn } };
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const set = vi.fn();
  expect(
    popOut({ canvas, resize: vi.fn(), set, getSetting: () => undefined, route: (p) => p }),
  ).toBeNull();
  expect(warn).toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
  expect(canvas.ownerDocument).toBe(document);
  canvas.remove();
  delete globalThis.ui;
});

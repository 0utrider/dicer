/**
 * The dice tray in a window of its own (lazy chunk), for another screen: the tray fills the
 * window, and the dice canvas moves into it, so every roll this screen shows lands there (the main
 * screen stays clear of dice; one renderer, moved, not a second one). Rolling by hand follows the
 * canvas (hand/chunk/overlay.js opens on the page the dice are drawn on). Closing the window, or
 * the main one, brings the canvas back.
 */
import { createTray } from './tray.js';

const NAME = 'dicer-dice-tray';
const FEATURES = 'popup,width=960,height=640';
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

let state = null; // { win, back } while the window is open

/** The tray filling the window: the player's own look (or the table's), always shown, never dragged. */
export function trayDepsFor(win, { getSetting, route, activeRolls }) {
  const full = () => ({ left: 0, top: 0, width: win.innerWidth, height: win.innerHeight });
  return {
    getSetting: (k) => {
      if (k === 'trayRect') return { x: 0, y: 0, w: 1, h: 1 };
      if (k === 'trayShow') return 'always';
      // the window is always a tray: the table's when there is one and it is chosen, else the
      // player's own look (or the default)
      if (k === 'trayMode')
        return getSetting('trayMode') === 'table' && getSetting('tableTray') ? 'table' : 'mine';
      return getSetting(k);
    },
    setSetting: () => {}, // nothing to save: it always fills the window
    measure: full,
    route,
    activeRolls,
    doc: win.document,
  };
}

/** The window's page: Dicer's stylesheet, a dark table, the tray's grips hidden (it cannot be moved). */
function dress(win, route) {
  const doc = win.document;
  doc.title = loc('DICER.DiceTray.WindowTitle');
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL(route('modules/dicer/styles/dicer.css'), globalThis.location.href).href;
  const style = doc.createElement('style');
  style.textContent =
    'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#141218}' +
    '.dicer-tt-edge,.dicer-tt-grip,.dicer-tt-popout{display:none}';
  doc.head.append(link, style);
}

/**
 * Opens the window (or brings it forward). deps: main's tray deps (getSetting, route,
 * activeRolls), `canvas` (the dice canvas), `resize` (DiceBox re-measures its stage) and `set`
 * (main's popped state: {win, tray, stage()} or null).
 */
export function popOut({ canvas, resize, set, getSetting, route, activeRolls }) {
  if (state && !state.win.closed) {
    state.win.focus();
    return state.win;
  }
  const win = globalThis.open('', NAME, FEATURES);
  if (!win) {
    globalThis.ui?.notifications?.warn(loc('DICER.DiceTray.WindowBlocked'));
    return null;
  }
  dress(win, route);
  const tray = createTray(trayDepsFor(win, { getSetting, route, activeRolls }));
  tray.refresh();
  // the dice canvas moves over (the same WebGL context, the same scene)
  const home = { parent: canvas.parentNode, next: canvas.nextSibling };
  win.document.body.append(win.document.adoptNode(canvas));
  const stage = () => ({ left: 0, top: 0, width: win.innerWidth, height: win.innerHeight });
  set({ win, tray, stage });
  resize();
  const onResize = () => {
    tray.refresh();
    resize();
  };
  win.addEventListener('resize', onResize);

  let gone = false;
  /** The canvas back on the main page, the table's tray back, the window closed. */
  function back() {
    if (gone) return;
    gone = true;
    state = null;
    globalThis.removeEventListener('beforeunload', closeIt);
    try {
      const doc = home.parent?.ownerDocument ?? globalThis.document;
      const node = doc.adoptNode(canvas);
      if (home.parent?.isConnected)
        home.parent.insertBefore(node, home.next?.parentNode === home.parent ? home.next : null);
      else doc.body.append(node);
    } catch (err) {
      console.warn('dicer: could not bring the dice back from the tray window', err);
    }
    tray.dispose();
    set(null);
    resize();
    if (!win.closed) win.close();
  }
  const closeIt = () => back();
  win.addEventListener('pagehide', back);
  globalThis.addEventListener('beforeunload', closeIt); // the main page going: the window goes too
  state = { win, back };
  return win;
}

/** Closes the window, if open (the canvas comes back). */
export function popIn() {
  state?.back();
}

/** Whether the tray window is open. */
export const poppedOut = () => !!state && !state.win.closed;

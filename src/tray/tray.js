/**
 * The dice tray on this screen (tray-model.js has the rules): an element just under the dice
 * canvas, drawn from the tray look, that every roll this screen shows lands in. Its rim drags it,
 * its corner grip resizes it (the place is saved to the client `trayRect`); with trayShow 'rolls'
 * it slides in while dice are on screen and out once they clear.
 */
import {
  trayLookFor,
  trayPixels,
  trayFractions,
  trayStyle,
  traySound,
  trayArea,
  perchRect,
} from './tray-model.js';

/** The table tray element's id, and the event the document gets when it slides in or out. */
export const TRAY_ID = 'dicer-table-tray';
export const TRAY_EVENT = 'dicertray';

/** How often a tray that shows only during rolls checks that the dice have started fading. */
const HIDE_POLL_MS = 100;

/**
 * @param {object} deps
 * @param {(key: string) => unknown} deps.getSetting
 * @param {(key: string, value: unknown) => unknown} deps.setSetting
 * @param {() => {left, top, width, height}} deps.measure the stage
 * @param {(path: string) => string} [deps.route] a data path as a url
 * @param {() => number} [deps.activeRolls] dice rolls on screen (trayShow 'rolls')
 * @param {Document} [deps.doc]
 */
export function createTray({
  getSetting,
  setSetting,
  measure,
  route = (p) => p,
  activeRolls = () => 0,
  doc = globalThis.document,
}) {
  let el = null;
  let look = null;
  let px = null;
  let poll = null;
  let previewing = false; // the Dice tray window is open: shown whatever trayShow says

  const lookNow = () =>
    trayLookFor({
      mode: getSetting('trayMode'),
      mine: getSetting('myTray'),
      table: getSetting('tableTray'),
    });
  const showMode = () => (getSetting('trayShow') === 'rolls' ? 'rolls' : 'always');

  function place() {
    if (!el) return;
    px = trayPixels(getSetting('trayRect'), measure());
    Object.assign(el.style, {
      left: `${px.left}px`,
      top: `${px.top}px`,
      width: `${px.width}px`,
      height: `${px.height}px`,
    });
  }

  /** Drags the tray (`mode` 'move') or its corner ('size') with the pointer; the place is saved on release. */
  function drag(event, mode) {
    if (event.button !== 0 || !px) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, ...px };
    const stage = measure();
    el.classList.add('is-dragging');
    const move = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const next =
        mode === 'move'
          ? { ...start, left: start.left + dx, top: start.top + dy }
          : {
              ...start,
              width: Math.max(120, start.width + dx),
              height: Math.max(90, start.height + dy),
            };
      // the same rules as a stored place (kept inside the stage, never too small), shown live
      const fr = trayFractions(next, stage);
      const shown = trayPixels(fr, stage);
      Object.assign(el.style, {
        left: `${shown.left}px`,
        top: `${shown.top}px`,
        width: `${shown.width}px`,
        height: `${shown.height}px`,
      });
      px = shown;
    };
    const up = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      el?.classList.remove('is-dragging');
      if (px) Promise.resolve(setSetting('trayRect', trayFractions(px, stage))).catch(() => {});
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  }

  function build() {
    el = doc.createElement('div');
    el.id = TRAY_ID;
    el.className = 'dicer-tt';
    el.setAttribute('aria-hidden', 'true');
    // the hexagon and octagon draw their rim and floor here (clipped to the shape)
    const skin = doc.createElement('div');
    skin.className = 'dicer-tt-skin';
    el.append(skin);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const edge = doc.createElement('div');
      edge.className = `dicer-tt-edge dicer-tt-edge-${side}`;
      edge.addEventListener('pointerdown', (e) => drag(e, 'move'));
      el.append(edge);
    }
    const grip = doc.createElement('div');
    grip.className = 'dicer-tt-grip';
    grip.addEventListener('pointerdown', (e) => drag(e, 'size'));
    el.append(grip);
    // just under the dice canvas: after the board, as the canvas's layer is
    const board = doc.getElementById('board');
    if (board) board.after(el);
    else doc.body.append(el);
  }

  /**
   * Slides the tray out (true) or back in, and says so: a TRAY_EVENT on the document (the pets on
   * its rim leave with it, pets.js). Nothing when it already is.
   */
  function setHidden(on) {
    if (!el || el.classList.contains('is-hidden') === on) return;
    el.classList.toggle('is-hidden', on);
    doc.dispatchEvent?.(new Event(TRAY_EVENT));
  }

  function hideWhenClear() {
    clearInterval(poll);
    poll = setInterval(() => {
      if (activeRolls() > 0) return;
      clearInterval(poll);
      poll = null;
      if (showMode() === 'rolls' && !previewing) setHidden(true);
    }, HIDE_POLL_MS);
  }

  return {
    /** Re-reads the settings: draws, restyles, moves or removes the tray. */
    refresh() {
      look = lookNow();
      if (!look) {
        el?.remove();
        el = null;
        px = null;
        return;
      }
      if (!el) build();
      el.dataset.surface = look.surface;
      el.dataset.rim = look.rim.style;
      el.dataset.shape = look.shape;
      for (const [k, v] of Object.entries(trayStyle(look, route))) el.style.setProperty(k, v);
      setHidden(showMode() === 'rolls' && !previewing && !(activeRolls() > 0));
      place();
    },
    /**
     * The px rect dice land in, or null with no tray (the roll area decides): the floor, its edges
     * at the rim's inner edge, so the dice's walls are the tray's own sides (no gap before them).
     */
    area() {
      if (!el || !look || !px) return null;
      return { ...trayArea(px, look), strict: true }; // strict: never grown past the tray
    },
    /** Dice are coming: a tray that shows only during rolls slides in, and out once they clear. */
    rolling() {
      if (!el || showMode() !== 'rolls') return;
      setHidden(false);
      hideWhenClear();
    },
    /** The Dice tray window opened (true) or closed: while open the tray shows, so its look can be seen. */
    preview(on) {
      previewing = !!on;
      if (!el) return;
      if (previewing) setHidden(false);
      else if (showMode() === 'rolls' && !(activeRolls() > 0)) setHidden(true);
    },
    /** Over windows with the dice (diceAboveWindows). */
    raise(on) {
      el?.classList.toggle('dicer-above', !!on);
    },
    /** The px strip along the tray's top rim the pets sit on, or null (no tray, or one slid away). */
    perch() {
      if (!el || !look || !px || el.classList.contains('is-hidden')) return null;
      return perchRect(px, look);
    },
    /** The table sound of the tray's surface, or null with no tray. */
    sound: () => (look ? traySound(look) : null),
    get element() {
      return el;
    },
    dispose() {
      clearInterval(poll);
      el?.remove();
      el = null;
    },
  };
}

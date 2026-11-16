/** Click to pet and drag to place (the client setting petClick): the pointer listeners and the click count, no drawing. */

/** This many hits on one pet within HUFF_WINDOW_MS and it huffs. */
export const HUFF_HITS = 5;
export const HUFF_WINDOW_MS = 3000;
/** A huffy pet ignores clicks this long (its clicks reach Foundry). */
export const HUFF_IGNORE_MS = 4000;
/** A press on a pet that moves this far (page px) before its release is a drag, not a pat. */
export const DRAG_PX = 6;
const EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click'];

// Drawn above the dice canvas, so a click there is never a pet's: Foundry's windows (z 100 and up;
// v2 .application, v1 .window-app) and dialogs, menus and tooltips, and the hand-throw overlay.
const ABOVE_WINDOWS = '.application, .window-app, dialog, #context-menu, .context-menu';
const ABOVE_ALWAYS = '#tooltip, .locked-tooltip, .dicer-hand-overlay';
/**
 * Whether a click on `target` may be a pet's: the pet is drawn there. The dice canvas (z 60) is above
 * the board and Foundry's interface (z 30: the controls, player list, hotbar, HUD bars of other
 * modules), so a pet resting over them takes the click; it is below windows, unless "Dice above
 * windows" lifted it (`above`), and below menus, tooltips and the hand overlay.
 */
export function petClickable(target, above = false) {
  if (!target?.closest) return false;
  if (target.closest(ABOVE_ALWAYS)) return false;
  return above || !target.closest(ABOVE_WINDOWS);
}

/**
 * Capture-phase pointer and click listeners on `win`. A left-button pointerdown that
 * `pickPet(clientX, clientY, target)` says hits a resting pet (null: none; it also says null when
 * `target`, the element clicked, is not the table but a window over it) is the pet's, and so are
 * the pointermoves, pointerup and click after it: all stopped (preventDefault +
 * stopImmediatePropagation), so Foundry neither selects nor drags. Released within DRAG_PX of where
 * it was pressed, it is a pat: onPet(pet), or onHuff(pet) on its HUFF_HITS-th pat within
 * HUFF_WINDOW_MS (then that pet's clicks are ignored for HUFF_IGNORE_MS). Moved farther, it is a
 * drag: onDragStart(pet) (false: not draggable after all, and the press is let go), onDrag(pet, x,
 * y) on each move, and onDrop(pet, x, y) on release (onDrop(pet, null, null) when the browser
 * cancels the pointer). Everything else (a miss, another button, an ignored pet,
 * `setting('petClick')` false) is left untouched. Any other pointermove goes to onPointer(x, y),
 * untouched (the pets look at the cursor). `now()` is the clock. dispose() removes the listeners.
 */
export function createPetting({ win, pickPet, onPet, onHuff, onDragStart, onDrag, onDrop, onPointer, now = () => performance.now(), setting }) {
  const hits = new Map(); // pet -> times of its recent hits
  const ignore = new Map(); // pet -> until when its clicks are ignored
  let claimUp = false; // the pointerdown was a pet's: stop the pointerup after it
  let claimClick = false; // ... and the click
  let press = null; // {pet, x, y, drag}: the pet pressed, where, and whether it became a drag
  const on = () => {
    try {
      return setting?.('petClick') !== false;
    } catch {
      return true;
    }
  };
  const stop = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  function down(e) {
    claimUp = claimClick = false; // a click always follows its own pointerdown
    press = null;
    if (e.button !== 0 || !on()) return;
    let pet = null;
    try {
      pet = pickPet(e.clientX, e.clientY, e.target);
    } catch {
      /* no pet: the click is Foundry's */
    }
    if (!pet) return;
    const t = now();
    if (t < (ignore.get(pet) ?? -Infinity)) return;
    ignore.delete(pet);
    stop(e);
    claimUp = claimClick = true;
    press = { pet, x: e.clientX, y: e.clientY, drag: false };
  }
  /** A pat: counted toward a huff. */
  function pat(pet) {
    const t = now();
    const recent = (hits.get(pet) ?? []).filter((at) => t - at < HUFF_WINDOW_MS);
    recent.push(t);
    if (recent.length >= HUFF_HITS) {
      hits.delete(pet);
      ignore.set(pet, t + HUFF_IGNORE_MS);
      onHuff?.(pet);
    } else {
      hits.set(pet, recent);
      onPet?.(pet);
    }
  }
  function move(e) {
    if (!press) {
      try {
        onPointer?.(e.clientX, e.clientY); // the pets look at it (never claimed: Foundry's too)
      } catch {
        /* no pet looks */
      }
      return;
    }
    stop(e);
    if (!press.drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_PX) return;
      let ok = false;
      try {
        ok = onDragStart?.(press.pet) !== false && !!onDragStart;
      } catch {
        /* not draggable */
      }
      if (!ok) {
        press = null; // let go: the rest of this press is nobody's, the click is still swallowed
        return;
      }
      press.drag = true;
    }
    try {
      onDrag?.(press.pet, e.clientX, e.clientY);
    } catch {
      /* the drag goes on */
    }
  }
  function up(e) {
    if (!claimUp || e.button !== 0) return;
    claimUp = false;
    stop(e);
    const p = press;
    press = null;
    if (!p) return;
    try {
      if (p.drag) onDrop?.(p.pet, e.clientX, e.clientY);
      else pat(p.pet);
    } catch {
      /* the pet's own trouble */
    }
  }
  function cancel() {
    const p = press;
    press = null;
    claimUp = false;
    if (p?.drag)
      try {
        onDrop?.(p.pet, null, null);
      } catch {
        /* nothing to undo */
      }
  }
  function click(e) {
    if (!claimClick) return;
    claimClick = false;
    stop(e);
  }
  const handlers = [down, move, up, cancel, click];
  const opts = { capture: true }; // an object, not `true`: Node's EventTarget (tests) only matches that on remove
  EVENTS.forEach((type, i) => win.addEventListener(type, handlers[i], opts));
  return {
    dispose() {
      EVENTS.forEach((type, i) => win.removeEventListener(type, handlers[i], opts));
      hits.clear();
      ignore.clear();
      press = null;
    },
  };
}

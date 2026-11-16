/** Click to pet (the client setting petClick): the pointer listeners and the click count, no drawing. */

/** This many hits on one pet within HUFF_WINDOW_MS and it huffs. */
export const HUFF_HITS = 5;
export const HUFF_WINDOW_MS = 3000;
/** A huffy pet ignores clicks this long (its clicks reach Foundry). */
export const HUFF_IGNORE_MS = 4000;
const EVENTS = ['pointerdown', 'pointerup', 'click'];

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
 * Capture-phase pointerdown, pointerup and click listeners on `win`. A left-button pointerdown
 * that `pickPet(clientX, clientY, target)` says hits a resting pet (null: none; it also says null
 * when `target`, the element clicked, is not the table but a window over it) is the pet's: onPet(pet),
 * or onHuff(pet) on its HUFF_HITS-th hit within HUFF_WINDOW_MS (then that pet's clicks are ignored
 * for HUFF_IGNORE_MS), and that pointerdown and the pointerup and click after it are stopped
 * (preventDefault + stopImmediatePropagation), so Foundry neither selects nor drags. Everything
 * else (a miss, another button, an ignored pet, `setting('petClick')` false) is left untouched.
 * `now()` is the clock. dispose() removes the listeners.
 */
export function createPetting({ win, pickPet, onPet, onHuff, now = () => performance.now(), setting }) {
  const hits = new Map(); // pet -> times of its recent hits
  const ignore = new Map(); // pet -> until when its clicks are ignored
  let claimUp = false; // the pointerdown was a pet's: stop the pointerup after it
  let claimClick = false; // ... and the click
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
  function up(e) {
    if (!claimUp || e.button !== 0) return;
    claimUp = false;
    stop(e);
  }
  function click(e) {
    if (!claimClick) return;
    claimClick = false;
    stop(e);
  }
  const handlers = [down, up, click];
  const opts = { capture: true }; // an object, not `true`: Node's EventTarget (tests) only matches that on remove
  EVENTS.forEach((type, i) => win.addEventListener(type, handlers[i], opts));
  return {
    dispose() {
      EVENTS.forEach((type, i) => win.removeEventListener(type, handlers[i], opts));
      hits.clear();
      ignore.clear();
    },
  };
}

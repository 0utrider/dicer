/** DOM helpers for hiding chat messages while their dice fly (used by the message gate). */

/** The class that hides an element (styled display:none by the module stylesheet). */
export const HIDE = 'dsn-hide';

const NOTIFICATIONS = '#chat-notifications';
/**
 * Foundry v14 ChatLog keeps each notification card's age in an expando property on the card
 * element itself: #postNotification sets `element._lifeSpan = 0`, #checkNotificationLifeSpan
 * adds NOTIFY_TICKER (500) to it and dismisses the card at NOTIFY_DURATION (5000), and
 * #rerenderMessage copies it to the replacement element (client/applications/sidebar/tabs/
 * chat.mjs). There is no public API for it.
 */
const LIFESPAN = '_lifeSpan';

const pinnedLifespan = (el) => Boolean(Object.getOwnPropertyDescriptor(el, LIFESPAN)?.get);

/**
 * While a notification card is hidden its lifespan is held at 0 (an own accessor on that one
 * element that reads 0 and ignores writes), so Foundry cannot dismiss a card nobody has seen.
 */
export function pinCard(el) {
  if (!el?.isConnected || !el.closest?.(NOTIFICATIONS) || pinnedLifespan(el)) return;
  Object.defineProperty(el, LIFESPAN, {
    configurable: true,
    enumerable: true,
    get: () => 0,
    set() {},
  });
}

/** On reveal: drop the pin and give the card a fresh NOTIFY_DURATION from now. */
export function refreshCard(el) {
  const pinned = pinnedLifespan(el);
  if (pinned) delete el[LIFESPAN];
  if (pinned || (LIFESPAN in el && el.closest?.(NOTIFICATIONS))) el[LIFESPAN] = 0;
}

/** The elements inside `root` matching `selector`, or null when the selector cannot be used. */
export function matchesIn(root, selector) {
  try {
    const found = root?.querySelectorAll?.(selector);
    return found ? [...found] : null;
  } catch {
    return null;
  }
}

/** The hidden elements inside `root` (not `root` itself). */
export const hiddenIn = (root) => matchesIn(root, `.${HIDE}`) ?? [];

/** A non-empty string that parses as a CSS selector (any string when no document is known). */
export function isSelector(selector, documentRef) {
  if (typeof selector !== 'string' || selector === '') return false;
  try {
    documentRef?.createDocumentFragment?.().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

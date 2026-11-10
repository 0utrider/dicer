import { viewFor } from '../compat/privacy.js';

/** The latest a hidden message stays hidden, measured from the start of its animation. */
export const WATCHDOG_MS = 15000;

const HIDE = 'dsn-hide';
const DSN_SCOPE = 'dice-so-nice';
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
function pinCard(el) {
  if (!el?.isConnected || !el.closest?.(NOTIFICATIONS) || pinnedLifespan(el)) return;
  Object.defineProperty(el, LIFESPAN, {
    configurable: true,
    enumerable: true,
    get: () => 0,
    set() {},
  });
}

/** On reveal: drop the pin and give the card a fresh NOTIFY_DURATION from now. */
function refreshCard(el) {
  const pinned = pinnedLifespan(el);
  if (pinned) delete el[LIFESPAN];
  if (pinned || (LIFESPAN in el && el.closest?.(NOTIFICATIONS))) el[LIFESPAN] = 0;
}

/**
 * The chat message gate: hides an eligible roll message, throws its dice, and reveals it when
 * they land (or the watchdog fires), firing the Dice So Nice hooks. Pure: every Foundry
 * dependency is injected, so it is unit-tested without Foundry.
 *
 * Guarantee: diceSoNiceRollComplete fires exactly once per animated message (reveal is
 * idempotent per id), whether the dice land, the watchdog fires, the roll throws, a RollStart
 * listener makes it blind, or the message is deleted mid-roll.
 *
 * @param {object} deps
 * @param {{ roll(specs): { landed: Promise<void> } }} deps.diceBox
 * @param {(roll, opts: { maxDice: number, decorate?: Function }) => { dice: object[] }} deps.planThrow
 * @param {(message, roll) => Function | undefined} [deps.decorateFor] the per-die decorator for a
 *   roll of this message (its author's looks); a throwing one is ignored
 * @param {{ callAll(name: string, ...args): void }} deps.hooks
 * @param {(key: string) => any} deps.getSetting
 * @param {{ isAtBottom: boolean, scrollBottom(opts): Promise<void> } | null} [deps.chatUi]
 *   the ChatLog (`ui.chat`, read lazily when omitted); null disables scrolling
 * @param {() => string | undefined} [deps.currentUserId]
 * @param {() => { id?: string, isGM?: boolean } | undefined} [deps.currentUser] the viewing user,
 *   for the privacy matrix (none known: not a GM, not an author)
 */
export function createMessageGate({
  diceBox,
  planThrow,
  decorateFor = () => undefined,
  hooks,
  getSetting,
  chatUi,
  currentUserId = () => globalThis.game?.user?.id,
  currentUser = () => globalThis.game?.user,
  setTimeoutFn = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutFn = (h) => globalThis.clearTimeout(h),
  documentRef = globalThis.document,
}) {
  /** id -> { elements: Set<HTMLElement>, timer, resolve, promise, own } */
  const animating = new Map();
  let disabled = false;
  const chat = () => (chatUi === undefined ? globalThis.ui?.chat : chatUi);

  /**
   * Foundry scrolls the log only when it appends a message (ChatLog#postOne: if isAtBottom or
   * the author is this user), and then the message is still display:none. Mirror that rule
   * at reveal time; read isAtBottom before the message grows the log.
   */
  function shouldScroll(entry) {
    try {
      const ui = chat();
      return Boolean(ui && (ui.isAtBottom || entry.own));
    } catch {
      return false;
    }
  }

  function scrollToBottom() {
    try {
      Promise.resolve(chat()?.scrollBottom({ popout: true })).catch((err) =>
        console.error('dicer: cannot scroll the chat log', err),
      );
    } catch (err) {
      console.error('dicer: cannot scroll the chat log', err);
    }
  }

  function elementsFor(id) {
    const safe = String(id).replace(/["\\]/g, '\\$&');
    const found = documentRef?.querySelectorAll?.(`[data-message-id="${safe}"]`);
    return found ? [...found] : [];
  }

  function decoratorFor(message, roll) {
    try {
      return decorateFor(message, roll) || undefined;
    } catch (err) {
      console.error('dicer: cannot resolve the dice looks', err);
      return undefined;
    }
  }

  /** How each of the message's own rolls shows to the current user (privacy matrix). */
  function viewsOf(message) {
    let user;
    try {
      user = currentUser();
    } catch {
      user = undefined;
    }
    const base = {
      contentVisible: Boolean(message.isContentVisible),
      isGM: user?.isGM === true,
      isAuthor: user?.id != null && message.author?.id === user.id,
      blind: Boolean(message.blind),
      whispered: (message.whisper?.length ?? 0) > 0,
      showGhostDice: getSetting('showGhostDice') === true,
    };
    return message.rolls.map((roll) =>
      viewFor({ ...base, rollGhost: Boolean(roll?.ghost), rollSecret: Boolean(roll?.secret) }),
    );
  }

  const ghostDecorator = () => () => ({ ghost: true });

  /**
   * Plans every roll against one shared maxDice budget. `views` are decided from the message's own
   * rolls, never from a listener's replacement, so a replaced roll cannot change what is shown.
   * A 'none' roll is not planned; a 'ghost' roll never resolves its real look.
   */
  function planAll(rolls, message, views) {
    let budget = Number(getSetting('maxDice')) || 20;
    return rolls.map((roll, i) => {
      const view = views[i] ?? 'none';
      if (view === 'none' || budget <= 0) return [];
      const decorate = view === 'ghost' ? ghostDecorator() : decoratorFor(message, roll);
      const { dice } = planThrow(roll, { maxDice: budget, decorate });
      budget -= dice.length;
      return dice;
    });
  }

  function isEligible(message) {
    if (disabled || !getSetting('enabled')) return false;
    if (message.flags?.[DSN_SCOPE]?.skip) return false;
    return planAll(message.rolls, message, viewsOf(message)).some((specs) => specs.length > 0);
  }

  function reveal(id, { scroll = true } = {}) {
    const entry = animating.get(id);
    if (!entry) return;
    animating.delete(id);
    clearTimeoutFn(entry.timer);
    const scrollAfter = scroll && shouldScroll(entry);
    for (const el of new Set([...entry.elements, ...elementsFor(id)])) {
      el.classList.remove(HIDE);
      try {
        refreshCard(el);
      } catch (err) {
        console.error('dicer: cannot refresh a chat notification card', err);
      }
    }
    if (scrollAfter) scrollToBottom();
    entry.resolve(true);
    try {
      // DSN's signature: (messageId, companionIds). Plan 1 has no companion messages.
      hooks.callAll('diceSoNiceRollComplete', id, []);
    } catch (err) {
      console.error('dicer: a diceSoNiceRollComplete listener failed', err);
    }
  }

  function onCreate(message) {
    const id = message?.id;
    if (!id || !message.rolls?.length) return;
    try {
      if (!isEligible(message)) {
        hooks.callAll('diceSoNiceMessageProcessed', id, { willTrigger3DRoll: false });
        return;
      }
      if (animating.has(id)) return;

      let resolve;
      const promise = new Promise((r) => (resolve = r));
      const userId = currentUserId();
      const own = userId != null && message.author?.id === userId;
      const entry = { elements: new Set(), timer: null, resolve, promise, own };
      animating.set(id, entry);
      for (const el of elementsFor(id)) {
        el.classList.add(HIDE);
        entry.elements.add(el);
        pinCard(el);
      }
      entry.timer = setTimeoutFn(() => reveal(id), WATCHDOG_MS);

      hooks.callAll('diceSoNiceMessageProcessed', id, { willTrigger3DRoll: true });
      const first = message.rolls[0];
      const context = {
        roll: first,
        user: message.author, // a v14 ChatMessage exposes its User as `author`, not `user`
        users: message.whisper ?? [],
        blind: false,
        dsnRoll: first,
      };
      hooks.callAll('diceSoNiceRollStart', id, context);
      if (!animating.has(id)) return; // a listener deleted the message
      // A blind context forces every view to none: nothing is thrown, the message shows at once.
      if (context.blind) {
        reveal(id);
        return;
      }

      const rolls = [context.dsnRoll ?? first, ...message.rolls.slice(1)];
      const landed = planAll(rolls, message, viewsOf(message))
        .filter((specs) => specs.length > 0)
        .map((specs) => diceBox.roll(specs).landed);
      Promise.all(landed).then(
        () => reveal(id),
        (err) => {
          console.error('dicer: roll failed', err);
          reveal(id);
        },
      );
    } catch (err) {
      console.error('dicer: chat message gate failed', err);
      reveal(id);
    }
  }

  function onRender(message, html) {
    try {
      const entry = animating.get(message?.id);
      if (!entry || !html?.classList) return;
      html.classList.add(HIDE);
      entry.elements.add(html);
      // renderChatMessageHTML fires before ChatLog connects the element. Its placement is known
      // one macrotask later (only microtasks separate the hook from replaceWith/append).
      const id = message.id;
      setTimeoutFn(() => {
        try {
          if (animating.get(id)?.elements.has(html)) pinCard(html);
        } catch (err) {
          console.error('dicer: cannot pin a chat notification card', err);
        }
      }, 0);
    } catch (err) {
      console.error('dicer: chat render gate failed', err);
      html?.classList?.remove(HIDE);
    }
  }

  function onDelete(message) {
    try {
      reveal(message?.id, { scroll: false });
    } catch (err) {
      console.error('dicer: chat delete gate failed', err);
    }
  }

  return {
    onCreate,
    onRender,
    onDelete,
    isAnimating: (id) => animating.has(id),
    waitFor: (id) => animating.get(id)?.promise ?? Promise.resolve(true),
    get disabled() {
      return disabled;
    },
    set disabled(value) {
      disabled = Boolean(value);
    },
  };
}

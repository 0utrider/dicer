import { viewFor } from '../compat/privacy.js';

/** The latest a hidden message stays hidden, measured from the start of its animation. */
export const WATCHDOG_MS = 15000;

const HIDE = 'dsn-hide';
const DSN_SCOPE = 'dice-so-nice';
const MODULE_SCOPE = 'dicer';
const NOTIFICATIONS = '#chat-notifications';
/**
 * Foundry v14 ChatLog keeps each notification card's age in an expando property on the card
 * element itself: #postNotification sets `element._lifeSpan = 0`, #checkNotificationLifeSpan
 * adds NOTIFY_TICKER (500) to it and dismisses the card at NOTIFY_DURATION (5000), and
 * #rerenderMessage copies it to the replacement element (client/applications/sidebar/tabs/
 * chat.mjs). There is no public API for it.
 */
const LIFESPAN = '_lifeSpan';

/**
 * A message flag from `flags['dice-so-nice']`, else `flags.dicer`. An absent or malformed scope
 * reads undefined.
 */
function flagOf(message, key) {
  const scoped = (scope) => {
    const flags = message.flags?.[scope];
    return flags && typeof flags === 'object' ? flags[key] : undefined;
  };
  return scoped(DSN_SCOPE) ?? scoped(MODULE_SCOPE);
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** `roll.options.rollOrder`, else the lowest `term.options.rollOrder`, else 0. */
function rollOrderOf(roll) {
  const own = finite(roll?.options?.rollOrder);
  if (own !== undefined) return own;
  const terms = Array.isArray(roll?.terms) ? roll.terms : [];
  const orders = terms.map((t) => finite(t?.options?.rollOrder)).filter((o) => o !== undefined);
  return orders.length ? Math.min(...orders) : 0;
}

/**
 * The planned dice grouped by ascending rollOrder, in roll order inside a group. Empty plans are
 * dropped, so every group throws something.
 */
function groupsOf(rolls, plan) {
  const byOrder = new Map();
  plan.forEach((specs, i) => {
    if (!specs.length) return;
    const order = rollOrderOf(rolls[i]);
    if (!byOrder.has(order)) byOrder.set(order, []);
    byOrder.get(order).push(specs);
  });
  return [...byOrder.keys()].sort((a, b) => a - b).map((order) => byOrder.get(order));
}

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
 * listener makes it blind, or the message is deleted mid-roll. A message's rolls are thrown in
 * rollOrder groups; privacy views and RollStart happen once, before the first group.
 *
 * Message flags (`flags['dice-so-nice']`, else `flags.dicer`): `skip` and `pendingCard` are not
 * animated; `linkedTo: <id>` makes the message a companion of `<id>` (see linkCompanion);
 * `persistent` and `interactiveThrow` animate normally. Settings read through getSetting:
 * enabled, maxDice, showGhostDice, showExtraDice, immediatelyDisplayChatMessages.
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
  /**
   * id -> { elements: Set<HTMLElement>, companions: Map<id, { elements }>, timer, resolve,
   * promise, own, hide }
   */
  const animating = new Map();
  /** companion id -> the id of the animating message it is linked to */
  const companionOf = new Map();
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
  function viewsOf(message, { before, ghostAll = false, secretAll = false } = {}) {
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
    return message.rolls.map((roll, i) => {
      // Flags are OR-ed: a flag seen before RollStart is never dropped by a later change.
      const view = viewFor({
        ...base,
        rollGhost: Boolean(roll?.ghost || before?.[i]?.ghost),
        rollSecret: secretAll || Boolean(roll?.secret || before?.[i]?.secret),
      });
      return ghostAll && view !== 'none' ? 'ghost' : view;
    });
  }

  /**
   * A RollStart listener (pf2e) flags `ctx.roll` or `ctx.dsnRoll` to mean the whole message, while
   * only that one roll carries it. A ghost/secret flag that appeared there during RollStart, on
   * the roll itself or on a replacement object, applies to every roll of the message.
   */
  function appearedFlags(context, before, message) {
    const prior = new Map(message.rolls.map((r, i) => [r, before[i]]));
    const out = { ghostAll: false, secretAll: false };
    for (const candidate of new Set([context.roll, context.dsnRoll])) {
      if (!candidate || typeof candidate !== 'object') continue;
      const was = prior.get(candidate);
      if (candidate.ghost && !was?.ghost) out.ghostAll = true;
      if (candidate.secret && !was?.secret) out.secretAll = true;
    }
    return out;
  }

  const ghostDecorator = () => () => ({ ghost: true });

  /**
   * Plans every roll against one shared maxDice budget. `views` are decided from the message's own
   * rolls, never from a listener's replacement, so a replaced roll cannot change what is shown.
   * A 'none' roll is not planned; a 'ghost' roll never resolves its real look.
   */
  function planAll(rolls, message, views) {
    let budget = Number(getSetting('maxDice')) || 20;
    const showExtra = getSetting('showExtraDice') !== false;
    return rolls.map((roll, i) => {
      const view = views[i] ?? 'none';
      if (view === 'none' || budget <= 0) return [];
      const decorate = view === 'ghost' ? ghostDecorator() : decoratorFor(message, roll);
      const { dice } = planThrow(roll, { maxDice: budget, showExtra, decorate });
      budget -= dice.length;
      return dice;
    });
  }

  /**
   * The eligibility plan, or null when the message is not animated. The plan is kept for the
   * throw, so planAll runs once per message unless RollStart changes what it depends on.
   */
  function eligiblePlan(message) {
    if (disabled || !getSetting('enabled') || !message.rolls?.length) return null;
    if (flagOf(message, 'skip') || flagOf(message, 'pendingCard')) return null;
    const views = viewsOf(message);
    const plan = planAll(message.rolls, message, views);
    return plan.some((specs) => specs.length > 0) ? { views, plan } : null;
  }

  /** Hides a message's element (and pins its notification card) for a hiding holder. */
  function hideInto(holder, el) {
    el.classList.add(HIDE);
    holder.elements.add(el);
    pinCard(el);
  }

  function showElements(id, elements) {
    for (const el of new Set([...elements, ...elementsFor(id)])) {
      el.classList.remove(HIDE);
      try {
        refreshCard(el);
      } catch (err) {
        console.error('dicer: cannot refresh a chat notification card', err);
      }
    }
  }

  function reveal(id, { scroll = true } = {}) {
    const entry = animating.get(id);
    if (!entry) return;
    animating.delete(id);
    clearTimeoutFn(entry.timer);
    const companionIds = [...entry.companions.keys()];
    for (const companionId of companionIds) companionOf.delete(companionId);
    if (entry.hide) {
      const scrollAfter = scroll && shouldScroll(entry);
      showElements(id, entry.elements);
      // Companions are released with their target, before RollComplete names them.
      for (const [companionId, companion] of entry.companions) {
        showElements(companionId, companion.elements);
      }
      if (scrollAfter) scrollToBottom();
    }
    entry.resolve(true);
    try {
      hooks.callAll('diceSoNiceRollComplete', id, companionIds);
    } catch (err) {
      console.error('dicer: a diceSoNiceRollComplete listener failed', err);
    }
  }

  /**
   * `linkedTo`: the message is not animated itself. While its target animates it is hidden and
   * released with the target, which lists it in RollComplete's companion ids.
   */
  function linkCompanion(id, targetId) {
    const target = animating.get(targetId);
    if (!target || targetId === id || target.companions.has(id)) return;
    const companion = { elements: new Set() };
    target.companions.set(id, companion);
    companionOf.set(id, targetId);
    if (target.hide) for (const el of elementsFor(id)) hideInto(companion, el);
  }

  /**
   * Throws the rolls in ascending rollOrder groups, each after the previous one lands. Each group
   * gets its own watchdog. A watchdog, a failure or a delete reveals the message once, and the
   * remaining groups are never thrown.
   */
  function throwGroups(id, entry, groups) {
    const next = (i) => {
      if (animating.get(id) !== entry) return; // revealed meanwhile (watchdog, delete)
      if (i >= groups.length) {
        reveal(id);
        return;
      }
      clearTimeoutFn(entry.timer);
      entry.timer = setTimeoutFn(() => reveal(id), WATCHDOG_MS);
      let landed;
      try {
        landed = groups[i].map((specs) => diceBox.roll(specs).landed);
      } catch (err) {
        console.error('dicer: roll failed', err);
        reveal(id);
        return;
      }
      Promise.all(landed).then(
        () => next(i + 1),
        (err) => {
          console.error('dicer: roll failed', err);
          reveal(id);
        },
      );
    };
    next(0);
  }

  function onCreate(message) {
    const id = message?.id;
    if (!id) return;
    try {
      const interception = { willTrigger3DRoll: true };
      try {
        hooks.callAll('diceSoNiceMessagePreProcess', id, interception);
      } catch (err) {
        console.error('dicer: a diceSoNiceMessagePreProcess listener failed', err);
      }
      const linkedTo = flagOf(message, 'linkedTo');
      if (linkedTo != null && linkedTo !== '') {
        linkCompanion(id, linkedTo);
        hooks.callAll('diceSoNiceMessageProcessed', id, { willTrigger3DRoll: false });
        return;
      }
      const eligible = interception.willTrigger3DRoll ? eligiblePlan(message) : null;
      if (!eligible) {
        hooks.callAll('diceSoNiceMessageProcessed', id, { willTrigger3DRoll: false });
        return;
      }
      if (animating.has(id)) return;

      let resolve;
      const promise = new Promise((r) => (resolve = r));
      const userId = currentUserId();
      const own = userId != null && message.author?.id === userId;
      const hide = getSetting('immediatelyDisplayChatMessages') !== true;
      const entry = {
        elements: new Set(),
        companions: new Map(),
        timer: null,
        resolve,
        promise,
        own,
        hide,
      };
      animating.set(id, entry);
      if (hide) for (const el of elementsFor(id)) hideInto(entry, el);
      entry.timer = setTimeoutFn(() => reveal(id), WATCHDOG_MS);

      hooks.callAll('diceSoNiceMessageProcessed', id, { willTrigger3DRoll: true });
      const first = message.rolls[0];
      const context = {
        roll: first,
        user: message.author, // a v14 ChatMessage exposes its User as `author`, not `user`
        users: message.whisper?.length ? message.whisper : null,
        blind: false,
        dsnRoll: first,
      };
      const before = message.rolls.map((r) => ({ ghost: Boolean(r?.ghost), secret: Boolean(r?.secret) }));
      hooks.callAll('diceSoNiceRollStart', id, context);
      if (animating.get(id) !== entry) return; // a listener deleted the message
      // A blind context forces every view to none: nothing is thrown, the message shows at once.
      if (context.blind) {
        reveal(id);
        return;
      }

      const rolls = [context.dsnRoll ?? first, ...message.rolls.slice(1)];
      const views = viewsOf(message, { before, ...appearedFlags(context, before, message) });
      // RollStart can only change the views or replace the first roll. The maxDice budget is
      // shared, so any such change re-plans the whole message.
      const unchanged = rolls[0] === first && views.every((v, i) => v === eligible.views[i]);
      const plan = unchanged ? eligible.plan : planAll(rolls, message, views);
      throwGroups(id, entry, groupsOf(rolls, plan));
    } catch (err) {
      console.error('dicer: chat message gate failed', err);
      reveal(id);
    }
  }

  function onRender(message, html) {
    try {
      const id = message?.id;
      const entry = animating.get(id);
      const target = entry ? null : animating.get(companionOf.get(id));
      const holder = entry ?? target?.companions.get(id);
      if (!holder || !(entry ?? target).hide || !html?.classList) return;
      html.classList.add(HIDE);
      holder.elements.add(html);
      // renderChatMessageHTML fires before ChatLog connects the element. Its placement is known
      // one macrotask later (only microtasks separate the hook from replaceWith/append).
      setTimeoutFn(() => {
        try {
          if (holder.elements.has(html) && html.classList.contains(HIDE)) pinCard(html);
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
      const id = message?.id;
      const targetId = companionOf.get(id);
      if (targetId !== undefined) {
        companionOf.delete(id);
        animating.get(targetId)?.companions.delete(id);
      }
      reveal(id, { scroll: false });
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

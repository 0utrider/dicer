import { viewFor } from '../compat/privacy.js';
import { ghostRoll } from '../compat/sync.js';
import { isGmOnly } from '../areas/gm-only.js';
import { petFor } from '../pet/pet-for.js';
import { HIDE, pinCard, refreshCard, matchesIn, hiddenIn, isSelector } from './chat-hiding.js';
import { HAND_REPLAY_WAIT_MS } from '../hand/gate-hand.js';
import { filtered } from './roll-filters.js';

/**
 * The longest one rollOrder group may take to land, measured from that group's start (each
 * group re-arms it). When it fires, the message is revealed and the remaining groups are skipped.
 */
export const WATCHDOG_MS = 15000;

/** How many message ids the gate remembers a roll count for (to spot appended rolls). */
export const ROLL_COUNT_LIMIT = 200;
const VIEW_LOG_LIMIT = 50;
const FIRST_FRAME_LIMIT = 50;

const DSN_SCOPE = 'dice-so-nice';
const MODULE_SCOPE = 'dicer';

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
 * dropped, so every group throws something. Each group is an array of per-roll specs carrying
 * `allReal`: every roll in it is a real view here (a ghost never uses the GM private corner), and
 * `views`: each roll's own view in the group's order (one message can mix real and ghost rolls).
 */
function groupsOf(rolls, plan, views = [], secrets = []) {
  const byOrder = new Map();
  plan.forEach((specs, i) => {
    if (!specs.length) return;
    const order = rollOrderOf(rolls[i]);
    if (!byOrder.has(order)) byOrder.set(order, Object.assign([], { allReal: true, allSecret: true, views: [], idx: [] }));
    const group = byOrder.get(order);
    group.push(specs);
    group.views.push(views[i]);
    group.idx.push(i);
    if (views[i] !== 'real') group.allReal = false;
    if (secrets[i] !== true) group.allSecret = false;
  });
  return [...byOrder.keys()].sort((a, b) => a - b).map((order) => byOrder.get(order));
}

/** The views with every roll before `from` (already shown) set to 'none'. */
const onlyFrom = (views, from) => views.map((v, i) => (i >= from ? v : 'none'));

/**
 * The chat message gate: hides an eligible roll message, throws its dice, and reveals it when
 * they land (or the watchdog fires), firing the Dice So Nice hooks. Pure: every Foundry
 * dependency is injected, so it is unit-tested without Foundry.
 *
 * Guarantee: diceSoNiceRollComplete fires exactly once per animation (reveal is idempotent per
 * id), whether the dice land, the watchdog fires, the roll throws, a RollStart listener makes it
 * blind, or the message is deleted mid-roll. A message's rolls are thrown in rollOrder groups;
 * privacy views and RollStart happen once, before the first group.
 *
 * Appended rolls (updateChatMessage): the roll count of the last ROLL_COUNT_LIMIT ids is
 * remembered; an update that adds rolls to a known id animates only the new ones, through the
 * same PreProcess, privacy, RollStart and roll order path. While they fly the whole message is
 * hidden, or only the elements matching the update hide selector. One animation runs per id:
 * an append that arrives while the id animates is queued (appends merge) and starts when that
 * animation reveals; meanwhile the whole message is hidden. A delete drops the queued append.
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
 * @param {(authorId?: string) => Function} [deps.ghostDecorateFor] the per-die decorator of a ghost
 *   view (compat/ghost-look.js: themed ghost dice); it never sees the roll
 * @param {{ callAll(name: string, ...args): void }} deps.hooks
 * @param {(key: string) => any} deps.getSetting
 * @param {{ isAtBottom: boolean, scrollBottom(opts): Promise<void> } | null} [deps.chatUi]
 *   the ChatLog (`ui.chat`, read lazily when omitted); null disables scrolling
 * @param {() => string | undefined} [deps.currentUserId]
 * @param {() => { id?: string, isGM?: boolean } | undefined} [deps.currentUser] the viewing user,
 *   for the privacy matrix (none known: not a GM, not an author)
 * @param {(q: { rollerId?: string, gmPrivate: boolean }) => object | null} [deps.areaFor] the px
 *   area a throw lands in on this screen (area-resolver rectFor); null throws on the whole stage
 * @param {(id: string) => boolean} [deps.userIsGM] whether a whisper recipient is a GM
 * @param {object | null} [deps.hand] the hand gate (createHandGate; Task 8): hand rolls replay
 *   their thrower's trajectory here, and the thrower's own lingering throw is decorated (H-9)
 * @param {(message, start) => void} [deps.onStarted] after each RollStart (and the own lingering
 *   throws were read): main.js sends the thrower's hand throws then (sendHand)
 */
export function createMessageGate({
  diceBox,
  planThrow,
  decorateFor = () => undefined,
  ghostDecorateFor = () => () => ({ ghost: true }),
  hooks,
  getSetting,
  chatUi,
  currentUserId = () => globalThis.game?.user?.id,
  currentUser = () => globalThis.game?.user,
  areaFor = () => null,
  userIsGM = (id) => globalThis.game?.users?.get?.(id)?.isGM === true,
  setTimeoutFn = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutFn = (h) => globalThis.clearTimeout(h),
  documentRef = globalThis.document,
  now = () => globalThis.performance.now(),
  hand = null,
  onStarted = () => {},
}) {
  /** message id -> {blind, ghostAll, secretAll, count} of its last RollStart (count: rolls covered). */
  const starts = new Map();
  /** Fixed ring of the last FIRST_FRAME_LIMIT marks: ids[i] -> ms[i]; no allocation per mark. */
  const markIds = new Array(FIRST_FRAME_LIMIT).fill(null);
  const markMs = new Array(FIRST_FRAME_LIMIT).fill(0);
  let markHead = 0;
  function recordFirstFrame(id, ms) {
    markIds[markHead] = id;
    markMs[markHead] = ms;
    markHead = (markHead + 1) % FIRST_FRAME_LIMIT;
  }
  /** message id -> ms from interception to the first rendered frame of its throw, oldest first. */
  function firstFrames() {
    const out = {};
    for (let k = 0; k < FIRST_FRAME_LIMIT; k++) {
      const i = (markHead + k) % FIRST_FRAME_LIMIT;
      if (markIds[i] !== null) out[markIds[i]] = markMs[i];
    }
    return out;
  }

  /**
   * id -> { elements: Set<HTMLElement>, companions: Map<id, { elements }>, timer, resolve,
   * promise, own, hide, selector: string | null, pending: { message, from, count } | undefined }
   */
  const animating = new Map();
  /** companion id -> the id of the animating message it is linked to */
  const companionOf = new Map();
  /** id -> the message's roll count when last seen (LRU, oldest first) */
  const rollCounts = new Map();
  /** message id -> the view kinds ('real' | 'ghost' | 'none') of its rolls, never values. */
  const viewLog = new Map();
  function recordViews(id, views) {
    viewLog.delete(id);
    viewLog.set(id, views.slice());
    if (viewLog.size > VIEW_LOG_LIMIT) viewLog.delete(viewLog.keys().next().value);
  }
  let disabled = false;
  let updateSelector = null;
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
    // Roll filters (initiative, damage, others' rolls...): a roll this player hides is not shown
    const ctx = { mine: base.isAuthor, secret: base.blind || base.whispered, combat: !!globalThis.game?.combat?.started };
    return message.rolls.map((roll, i) => {
      // Flags are OR-ed: a flag seen before RollStart is never dropped by a later change.
      const view = viewFor({
        ...base,
        rollGhost: Boolean(roll?.ghost || before?.[i]?.ghost),
        rollSecret: secretAll || Boolean(roll?.secret || before?.[i]?.secret),
      });
      if (view === 'none' || filtered(roll, message, ctx, getSetting('rollFilters'), getSetting('rollFiltersDefault'))) return 'none';
      return ghostAll ? 'ghost' : view;
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

  /** Only GMs can see the message (blind or whispered to GMs only), or the group is all secret. */
  function gmOnly(message, group) {
    return isGmOnly({
      blind: Boolean(message.blind),
      secret: group.allSecret === true,
      recipients: message.whisper,
      isGm: userIsGM,
    });
  }

  /**
   * The area of one throw group: the roller's (P5-D1), or the GM private corner when every roll
   * in the group is real here and only GMs can see the message (the resolver also requires a GM
   * client and the setting). A failing lookup throws on the whole stage.
   */
  function areaOf(message, group) {
    try {
      const gmPrivate = group.allReal === true && gmOnly(message, group);
      return areaFor({ rollerId: message.author?.id, gmPrivate }) ?? null;
    } catch (err) {
      console.error('dicer: cannot resolve the roll area', err);
      return null;
    }
  }

  /**
   * Plans every roll against one shared maxDice budget. `views` are decided from the message's own
   * rolls, never from a listener's replacement, so a replaced roll cannot change what is shown.
   * A 'none' roll is not planned; a 'ghost' roll never resolves its real look and is planned from
   * its ghost shape (P3-R20: one die per term count, no explosions or rerolls).
   */
  function planAll(rolls, message, views) {
    let budget = Number(getSetting('maxDice')) || 20;
    const showExtra = getSetting('showExtraDice') !== false;
    return rolls.map((roll, i) => {
      const view = views[i] ?? 'none';
      // H-10: a hand roll seen real is replayed whole (the decoder's 100-dice cap), outside the budget.
      const whole = view === 'real' && hand?.isHand(roll) && getSetting('handReplay') !== false;
      if (view === 'none' || (budget <= 0 && !whole)) return [];
      const ghost = view === 'ghost';
      const decorate = ghost ? ghostDecorateFor(message.author?.id) : decoratorFor(message, roll);
      const { dice } = planThrow(ghost ? ghostRoll(roll) : roll, {
        maxDice: whole ? 100 : budget,
        showExtra,
        decorate,
      });
      if (!whole) budget -= dice.length;
      return dice;
    });
  }

  /**
   * The eligibility plan for the rolls from index `from` on, or null when they are not animated.
   * The plan is kept for the throw, so planAll runs once unless RollStart changes what it
   * depends on.
   */
  function eligiblePlan(message, from) {
    if (disabled || !getSetting('enabled') || !(message.rolls?.length > from)) return null;
    if (flagOf(message, 'skip') || flagOf(message, 'pendingCard')) return null;
    const views = onlyFrom(viewsOf(message), from);
    recordViews(message.id, views);
    const plan = planAll(message.rolls, message, views);
    return plan.some((specs) => specs.length > 0) ? { views, plan } : null;
  }

  function rememberCount(id, count) {
    rollCounts.delete(id);
    rollCounts.set(id, count);
    if (rollCounts.size > ROLL_COUNT_LIMIT) rollCounts.delete(rollCounts.keys().next().value);
  }

  /** Hides a message's element (and pins its notification card) for a hiding holder. */
  function hideInto(holder, el) {
    el.classList.add(HIDE);
    holder.elements.add(el);
    pinCard(el);
  }

  /**
   * With a selector, hides the matching elements inside `root` (re-found on each render) and
   * pins its card; without one, or when the selector cannot be used, hides `root` itself.
   * Returns whether `root` itself was hidden.
   */
  function hideIn(holder, root, selector) {
    const matches = selector ? matchesIn(root, selector) : null;
    if (!matches) {
      hideInto(holder, root);
      return true;
    }
    for (const el of matches) {
      el.classList.add(HIDE);
      holder.elements.add(el);
    }
    pinCard(root);
    return false;
  }

  function showElements(id, elements) {
    const roots = elementsFor(id);
    const inner = [...elements, ...roots].flatMap(hiddenIn);
    for (const el of new Set([...elements, ...roots, ...inner])) {
      el.classList.remove(HIDE);
      try {
        refreshCard(el);
      } catch (err) {
        console.error('dicer: cannot refresh a chat notification card', err);
      }
    }
  }

  /** `next: false` (a delete) drops a queued append instead of starting it. */
  function reveal(id, { scroll = true, next = true } = {}) {
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
    const pending = next ? entry.pending : undefined;
    if (pending && !animating.has(id)) {
      // Merged appends span more than the selector's match (e.g. the last roll): hide it whole.
      animate(pending.message, pending.from, pending.count > 1 ? null : updateSelector);
    }
  }

  /**
   * An append for an id that is still animating waits for that animation to reveal. Appends
   * merge (the earliest new roll on). Until then the whole message is hidden, so an earlier
   * append's selector cannot leave the new rolls showing.
   */
  function queueAppend(id, entry, message, from) {
    entry.pending = {
      message,
      from: Math.min(entry.pending?.from ?? from, from),
      count: (entry.pending?.count ?? 0) + 1,
    };
    if (!entry.hide || !entry.selector) return;
    entry.selector = null;
    for (const el of elementsFor(id)) hideInto(entry, el);
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

  /** The roller's pet for one roll seen as `view` (ghost per roll), or null. A failure never stops the roll. */
  function petOf(message, view) {
    try {
      return message.author?.id ? petFor({ user: message.author, view, getSetting }) : null;
    } catch {
      return null;
    }
  }

  /**
   * Task 8: a hand roll seen real here (another user's) replays its thrower's trajectory: waited
   * for (HAND_REPLAY_WAIT_MS at most), sent by the author who threw it (dicerHand.by), and
   * matching the message's results by key (the chunk's replayFor). Extras beyond the recording
   * follow as a forced throw. Anything else is a forced throw of the results within this screen's
   * maxDice (M2). The group's watchdog re-arms when either starts (M1): a replay gets the hand
   * group's budget, a forced throw the usual one.
   */
  function replayHand(id, entry, message, roll, specs, opts, cast) {
    const author = message.author?.id;
    const alive = () => animating.get(id) === entry;
    const decorate = decoratorFor(message, roll);
    return hand.waitFor(message.id, roll.options.dicerHand.id, author).then((decoded) => {
      if (!alive()) return;
      const p = hand.replay(decoded, {
        roll,
        author,
        specs,
        opts,
        cast,
        diceBox,
        alive,
        // Every result, same looks (the decoder's 100-dice cap): look-only specs come from it.
        full: () => planThrow(roll, { maxDice: 100, decorate }).dice,
      });
      clearTimeoutFn(entry.timer);
      entry.timer = setTimeoutFn(() => reveal(id), WATCHDOG_MS + (p ? HAND_REPLAY_WAIT_MS : 0));
      return (
        p ??
        cast(
          planThrow(roll, {
            maxDice: Number(getSetting('maxDice')) || 20,
            showExtra: getSetting('showExtraDice') !== false,
            decorate,
          }).dice,
        )
      );
    });
  }

  /**
   * Throws the rolls in ascending rollOrder groups, each after the previous one lands. Each group
   * gets its own watchdog. A watchdog, a failure or a delete reveals the message once, and the
   * remaining groups are never thrown.
   */
  function throwGroups(id, entry, groups, message, owned = []) {
    const next = (i) => {
      if (animating.get(id) !== entry) return; // revealed meanwhile (watchdog, delete)
      if (i >= groups.length) {
        reveal(id);
        return;
      }
      clearTimeoutFn(entry.timer);
      // A group holding a hand roll may wait for its trajectory first.
      const handIn = groups[i].idx.some((k) => hand?.isHand(message.rolls[k]));
      entry.timer = setTimeoutFn(
        () => reveal(id),
        WATCHDOG_MS + (handIn ? HAND_REPLAY_WAIT_MS : 0),
      );
      let landed;
      try {
        const area = areaOf(message, groups[i]);
        // No area: the whole stage, called exactly as before areas existed.
        // The rolls of a group share one area, so size it for the group's dice, not each roll's (DiceBox grows it).
        const total = groups[i].reduce((n, specs) => n + specs.length, 0);
        landed = groups[i].map((specs, j) => {
          let arm = i === 0 && j === 0 && entry.t0 !== undefined;
          let opts = area ? (total > specs.length ? { area, capacityDice: total } : { area }) : null;
          const pet = petOf(message, groups[i].views[j]);
          if (pet) opts = { ...opts, pet };
          const cast = (s = specs, o = opts) => {
            if (arm) {
              arm = false;
              const t0 = entry.t0;
              diceBox.armFirstFrame?.(() => recordFirstFrame(id, now() - t0));
            }
            const res = o ? diceBox.roll(s, o) : diceBox.roll(s);
            if (res?.handle) res.handle.messageId = id; // api flareInside finds a roll by its message
            return res.landed;
          };
          const k = groups[i].idx[j];
          const roll = message.rolls[k];
          // H-9: this client's own hand throw is not thrown again; its dice get their effects.
          // A live hand throw resolves before its dice land here: the card waits for the landing.
          if (owned[k]) {
            const h = owned[k];
            diceBox.slowLanded?.(h, specs); // still in the air: a natural 20 or 1 slows its landing
            return Promise.resolve(h.landed).then(() => {
              // Deleted or revealed (watchdog) meanwhile: no landed effects for a gone card.
              if (animating.get(id) === entry) diceBox.decorateLanded?.(h, specs);
            });
          }
          return hand?.isHand(roll) &&
            groups[i].views[j] === 'real' &&
            !entry.own &&
            getSetting('handReplay') !== false
            ? replayHand(id, entry, message, roll, specs, opts, cast)
            : cast();
        });
      } catch (err) {
        console.error('dicer: roll failed', err);
        reveal(id);
        return;
      }
      Promise.all(landed).then(
        () => next(i + 1),
        (err) => {
          console.error('dicer: roll failed', err);
          // A stale rejection (this animation was revealed meanwhile) must not reveal the next one.
          if (animating.get(id) === entry) reveal(id);
        },
      );
    };
    next(0);
  }

  /**
   * Animates the message's rolls from index `from` on (0 for a create, the first appended roll
   * for an update): PreProcess, linkedTo, eligibility, hiding, RollStart, then the throw. The
   * caller has checked that the id is not animating. `selector`: hide only the elements
   * matching it inside each rendered copy (null hides the whole message).
   */
  function animate(message, from, selector) {
    const id = message.id;
    const t0 = now();
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
      const eligible = interception.willTrigger3DRoll ? eligiblePlan(message, from) : null;
      if (!eligible) {
        hooks.callAll('diceSoNiceMessageProcessed', id, { willTrigger3DRoll: false });
        return;
      }
      if (animating.has(id)) return; // a PreProcess listener started one meanwhile

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
        selector: hide ? selector : null,
        pending: undefined,
        t0,
      };
      animating.set(id, entry);
      if (hide) for (const el of elementsFor(id)) hideIn(entry, el, entry.selector);
      entry.timer = setTimeoutFn(() => reveal(id), WATCHDOG_MS);

      hooks.callAll('diceSoNiceMessageProcessed', id, { willTrigger3DRoll: true });
      const first = message.rolls[from];
      const context = {
        roll: first,
        user: message.author, // a v14 ChatMessage exposes its User as `author`, not `user`
        // A copy, as showForRoll passes: a listener mutating it in place never reaches the message.
        users: message.whisper?.length ? [...message.whisper] : null,
        blind: false,
        dsnRoll: first,
      };
      const before = message.rolls.map((r) => ({
        ghost: Boolean(r?.ghost),
        secret: Boolean(r?.secret),
      }));
      hooks.callAll('diceSoNiceRollStart', id, context);
      if (animating.get(id) !== entry) return; // a listener deleted the message
      const flags = appearedFlags(context, before, message);
      // Task 8: what RollStart decided for the whole message, which the thrower's sendHand honours.
      const start = { blind: !!context.blind, ...flags, count: message.rolls.length };
      starts.delete(id);
      starts.set(id, start);
      if (starts.size > VIEW_LOG_LIMIT) starts.delete(starts.keys().next().value);
      // A blind context forces every view to none: nothing is thrown, the message shows at once.
      if (context.blind) {
        onStarted(message, start);
        reveal(id);
        return;
      }

      const rolls = message.rolls.slice();
      rolls[from] = context.dsnRoll ?? first;
      // This client's own hand throw seen ghost (a blind tray roll, a secret roll): its overlay
      // already threw ghosts here, so nothing is thrown again ('none'); they fade on their own.
      const views = onlyFrom(viewsOf(message, { before, ...flags }), from).map((v, i) =>
        own && v !== 'real' && hand?.isHand(message.rolls[i]) && hand.ownHandle(message.rolls[i])
          ? 'none'
          : v,
      );
      recordViews(id, views);
      // RollStart can only change the views or replace the first animated roll. The maxDice
      // budget is shared, so any such change re-plans every animated roll.
      const unchanged = rolls[from] === first && views.every((v, i) => v === eligible.views[i]);
      const plan = unchanged ? eligible.plan : planAll(rolls, message, views);
      // The order is the message's own, like the views: a replacement cannot reorder.
      // A roll is secret when it was, or RollStart made it (P5-R7); only used for the GM corner.
      const secrets = message.rolls.map(
        (r, i) => flags.secretAll || Boolean(r?.secret || before[i]?.secret),
      );
      // H-9, R8: this client's own hand throw seen real (its stored throw, read before sendHand
      // drops it); a ghost or none view takes the normal path.
      const owned = message.rolls.map((r, i) =>
        own && views[i] === 'real' && hand?.isHand(r) ? hand.ownHandle(r) : null,
      );
      onStarted(message, start);
      throwGroups(id, entry, groupsOf(message.rolls, plan, views, secrets), message, owned);
    } catch (err) {
      console.error('dicer: chat message gate failed', err);
      reveal(id);
    }
  }

  function onCreate(message) {
    const id = message?.id;
    if (!id) return;
    try {
      rememberCount(id, message.rolls?.length ?? 0);
    } catch (err) {
      console.error('dicer: chat message gate failed', err);
    }
    if (animating.has(id)) return; // a duplicate create: PreProcess fired already
    animate(message, 0, null);
  }

  /**
   * updateChatMessage: animates the rolls a known message gained. An unknown id (never seen, or
   * evicted) has no previous count, so nothing is animated rather than its old rolls.
   */
  function onUpdate(message, changes) {
    try {
      const id = message?.id;
      if (!id || !changes || typeof changes !== 'object' || !('rolls' in changes)) return;
      const count = message.rolls?.length ?? 0;
      const from = rollCounts.get(id);
      rememberCount(id, count);
      if (from === undefined || count <= from) return;
      const current = animating.get(id);
      if (current) queueAppend(id, current, message, from);
      else animate(message, from, updateSelector);
    } catch (err) {
      console.error('dicer: chat update gate failed', err);
    }
  }

  function onRender(message, html) {
    try {
      const id = message?.id;
      const entry = animating.get(id);
      const target = entry ? null : animating.get(companionOf.get(id));
      const holder = entry ?? target?.companions.get(id);
      if (!holder || !(entry ?? target).hide || !html?.classList) return;
      const whole = hideIn(holder, html, entry?.selector ?? null);
      // renderChatMessageHTML fires before ChatLog connects the element. Its placement is known
      // one macrotask later (only microtasks separate the hook from replaceWith/append).
      setTimeoutFn(() => {
        try {
          const hiding = whole
            ? holder.elements.has(html) && html.classList.contains(HIDE)
            : animating.get(id) === entry;
          if (hiding) pinCard(html);
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
      rollCounts.delete(id);
      reveal(id, { scroll: false, next: false });
    } catch (err) {
      console.error('dicer: chat delete gate failed', err);
    }
  }

  /**
   * The selector whose matches inside a message are hidden while its appended rolls fly (null:
   * the whole message). Returns false, keeping the previous one, for anything else than null or
   * a valid CSS selector string.
   */
  function setUpdateHideSelector(selector) {
    if (selector === null) {
      updateSelector = null;
      return true;
    }
    if (!isSelector(selector, documentRef)) return false;
    updateSelector = selector;
    return true;
  }

  return {
    onCreate,
    onUpdate,
    onRender,
    onDelete,
    setUpdateHideSelector,
    isAnimating: (id) => animating.has(id),
    /** Task 8: the message's last RollStart outcome here ({blind, ghostAll, secretAll, count}). */
    startOf: (id) => starts.get(id),
    /** Whether the message's chat card is hidden while its dice fly (immediate display off). */
    isHiding: (id) => animating.get(id)?.hide === true,
    /** Debug only: ms from interception to first frame, by message id (an id may be missing). */
    firstFrames,
    /** Debug only: the view kinds of the last messages, by id (never values). */
    recentViews: () => Object.fromEntries([...viewLog].map(([id, v]) => [id, v.slice()])),
    waitFor: (id) => animating.get(id)?.promise ?? Promise.resolve(true),
    get disabled() {
      return disabled;
    },
    set disabled(value) {
      disabled = Boolean(value);
    },
  };
}

/** The latest a hidden message stays hidden, measured from the start of its animation. */
export const WATCHDOG_MS = 15000;

const HIDE = 'dsn-hide';
const DSN_SCOPE = 'dice-so-nice';

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
 * @param {(roll, opts: { maxDice: number }) => { dice: object[] }} deps.planThrow
 * @param {{ callAll(name: string, ...args): void }} deps.hooks
 * @param {(key: string) => any} deps.getSetting
 */
export function createMessageGate({
  diceBox,
  planThrow,
  hooks,
  getSetting,
  setTimeoutFn = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutFn = (h) => globalThis.clearTimeout(h),
  documentRef = globalThis.document,
}) {
  /** id -> { elements: Set<HTMLElement>, timer, resolve, promise } */
  const animating = new Map();
  let disabled = false;

  function elementsFor(id) {
    const safe = String(id).replace(/["\\]/g, '\\$&');
    const found = documentRef?.querySelectorAll?.(`[data-message-id="${safe}"]`);
    return found ? [...found] : [];
  }

  /** Plans every roll against one shared maxDice budget. */
  function planAll(rolls) {
    let budget = Number(getSetting('maxDice')) || 20;
    return rolls.map((roll) => {
      if (budget <= 0) return [];
      const { dice } = planThrow(roll, { maxDice: budget });
      budget -= dice.length;
      return dice;
    });
  }

  function isEligible(message) {
    if (disabled || !getSetting('enabled')) return false;
    if (!message.isContentVisible) return false;
    if (message.flags?.[DSN_SCOPE]?.skip) return false;
    return planAll(message.rolls).some((specs) => specs.length > 0);
  }

  function reveal(id) {
    const entry = animating.get(id);
    if (!entry) return;
    animating.delete(id);
    clearTimeoutFn(entry.timer);
    for (const el of [...entry.elements, ...elementsFor(id)]) el.classList.remove(HIDE);
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
      const entry = { elements: new Set(), timer: null, resolve, promise };
      animating.set(id, entry);
      for (const el of elementsFor(id)) {
        el.classList.add(HIDE);
        entry.elements.add(el);
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
      if (context.blind) {
        reveal(id);
        return;
      }

      const rolls = [context.dsnRoll ?? first, ...message.rolls.slice(1)];
      const landed = planAll(rolls)
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
    } catch (err) {
      console.error('dicer: chat render gate failed', err);
      html?.classList?.remove(HIDE);
    }
  }

  function onDelete(message) {
    try {
      reveal(message?.id);
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

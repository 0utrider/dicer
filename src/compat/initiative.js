import { WATCHDOG_MS } from '../foundry/message-gate.js';

/** The class that hides a held initiative (see styles/dicer.css). */
export const HIDE_INITIATIVE = 'dicer-hide-initiative';

/** A hold never outlasts one gate watchdog by more than this. */
const HOLD_SLACK_MS = 1000;

/** v14 renders `.token-initiative` inside `li[data-combatant-id]`; `.initiative` is a fallback. */
const INITIATIVE_SELECTOR = '.token-initiative, .initiative';

/**
 * Keeps a combatant's initiative hidden in the combat tracker while the dice of its initiative
 * roll are still flying. The tracker shows the rolled value as soon as the combatant updates, which
 * would spoil the roll the chat gate is hiding.
 *
 * A hold ends when the gate reveals the creating animation (landed, watchdog, delete, failure), or
 * after WATCHDOG_MS + 1000 ms at the latest; the tracker is then re-rendered.
 *
 * @param {object} deps
 * @param {{ isAnimating(id): boolean, waitFor(id): Promise<unknown> }} deps.gate
 * @param {() => { combatants: Iterable } | null | undefined} deps.getCombat
 * @param {Document} [deps.documentRef]
 * @param {() => boolean} [deps.enabled] the hideInitiative setting
 * @param {() => void} [deps.rerender] re-renders the tracker (default: `ui.combat?.render()`)
 */
export function createInitiativeHider({
  gate,
  getCombat,
  documentRef = globalThis.document,
  enabled = () => true,
  rerender = () => globalThis.ui?.combat?.render(),
  setTimeoutFn = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutFn = (h) => globalThis.clearTimeout(h),
}) {
  /** combatant id -> number of live holds */
  const held = new Map();

  function combatantIdsOf(message) {
    const speaker = message.speaker ?? {};
    const key = speaker.token ? 'tokenId' : speaker.actor ? 'actorId' : null;
    if (!key) return [];
    const wanted = speaker.token ?? speaker.actor;
    const combatants = getCombat()?.combatants;
    if (!combatants) return [];
    const list = typeof combatants.values === 'function' ? [...combatants.values()] : [...combatants];
    return list.filter((c) => c?.[key] === wanted).map((c) => c.id);
  }

  function apply(root) {
    if (!root?.querySelectorAll || held.size === 0) return;
    for (const li of root.querySelectorAll('[data-combatant-id]')) {
      if (!held.has(li.dataset.combatantId)) continue;
      for (const el of li.querySelectorAll(INITIATIVE_SELECTOR)) el.classList.add(HIDE_INITIATIVE);
    }
  }

  function release(ids) {
    for (const id of ids) {
      const n = (held.get(id) ?? 0) - 1;
      if (n > 0) held.set(id, n);
      else held.delete(id);
    }
    try {
      rerender();
    } catch (err) {
      console.error('dicer: cannot re-render the combat tracker', err);
    }
  }

  function onCreateMessage(message) {
    try {
      const id = message?.id;
      if (!enabled() || !id || message.flags?.core?.initiativeRoll !== true) return;
      if (!gate.isAnimating(id)) return;
      const ids = combatantIdsOf(message);
      if (!ids.length) return;
      for (const cid of ids) held.set(cid, (held.get(cid) ?? 0) + 1);
      apply(documentRef);
      let done = false;
      let timer = null;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeoutFn(timer);
        release(ids);
      };
      timer = setTimeoutFn(finish, WATCHDOG_MS + HOLD_SLACK_MS);
      Promise.resolve(gate.waitFor(id)).then(finish, finish);
    } catch (err) {
      console.error('dicer: initiative hiding failed', err);
    }
  }

  function onRenderTracker(app, html) {
    try {
      apply(html?.querySelectorAll ? html : html?.[0]);
    } catch (err) {
      console.error('dicer: initiative hiding failed', err);
    }
  }

  return { onCreateMessage, onRenderTracker };
}

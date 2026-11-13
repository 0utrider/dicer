/**
 * The thrower's half of "everyone allowed sees the same throw" (lazy hand chunk; P6-D2): once its
 * chat message exists and this client's gate ran diceSoNiceRollStart for it, each of its own hand
 * rolls' recorded throw goes, encoded, only to the users whose view of that message is real (G1).
 * main.js calls sendHand from the gate's onStarted and after createChatMessage / updateChatMessage.
 */
import { handThrows } from './resolve.js';
import { encodeTrajectory } from './trajectory.js';
import { recipientsOf } from '../../api/dice3d.js';
import { SOCKET_EVENT } from '../../compat/sync.js';

/** The message's whisper list as user ids, or null (not whispered). */
const usersOf = (message) => {
  const u = (message.whisper ?? []).map((w) => (typeof w === 'string' ? w : w?.id));
  return u.length ? u : null;
};

/**
 * Who may replay this message's hand throw (recipientsOf over the message and `start`, the
 * thrower's gate's RollStart outcome {blind, ghostAll, secretAll}, as the gate honours it):
 * - nobody when any roll is a ghost, or RollStart made them all ghosts (H-7);
 * - only the GMs for a blind message, any secret roll, a RollStart that made the message blind or
 *   its rolls secret, and when no RollStart outcome is known (`start` missing: the gate did not
 *   animate it here; the safe default);
 * - else the whisper list and the GMs, or null for everyone (public; never the sender).
 */
export function handRecipients(message, gms, selfId, start) {
  const rolls = message.rolls ?? [];
  if (start?.ghostAll || rolls.some((r) => r?.ghost)) return [];
  return recipientsOf(
    {
      users: usersOf(message),
      blind: !start || start.blind || !!message.blind,
      secret: start?.secretAll || rolls.some((r) => r?.secret),
    },
    gms,
    selfId,
  );
}

/**
 * For every roll of `message` this user threw by hand (a non-fallback dicerHand with a stored
 * throw), sends `{v: 1, kind: 'hand', id, messageId, userId, trajectory}` to handRecipients and
 * drops the stored throw. `start`: the gate's RollStart outcome for the message; it covers the
 * rolls before `start.count`. A roll it does not cover waits while `pending` (the gate animates
 * the message: a queued append starts later, reads its lingering throw, and sends it from
 * onStarted); otherwise it goes to the GMs only.
 *
 * Users who can read the message but get no trajectory (nothing encodes, or the recipients were
 * narrowed) get a values-free `{..., none: true}` notice, so their gate throws at once instead of
 * waiting HAND_REPLAY_WAIT_MS. Never throws.
 */
export function sendHand(
  message,
  {
    start,
    pending = false,
    // The module socket, as sync.broadcast: `recipients` limits delivery server-side (P3-R12).
    broadcast = (p, to) => globalThis.game.socket.emit(SOCKET_EVENT, p, ...(to ? [{ recipients: to }] : [])),
    gms = globalThis.game?.users?.filter((u) => u.isGM).map((u) => u.id) ?? [],
    all = globalThis.game?.users?.map((u) => u.id) ?? [],
    selfId = globalThis.game?.user?.id,
  } = {},
) {
  (message?.rolls ?? []).forEach((roll, i) => {
    const h = roll?.options?.dicerHand;
    const entry = h && !h.fallback && h.by === selfId ? handThrows.get(h.id) : null;
    const covered = start && i < start.count;
    if (!entry || (!covered && pending)) return;
    handThrows.delete(h.id);
    try {
      const to = handRecipients(message, gms, selfId, covered ? start : null);
      const trajectory = to?.length !== 0 && entry.recording && encodeTrajectory(entry.recording);
      const p = { v: 1, kind: 'hand', id: h.id, messageId: message.id, userId: selfId };
      if (trajectory) broadcast({ ...p, trajectory }, to);
      const can =
        recipientsOf({ users: usersOf(message), blind: !!message.blind }, gms, selfId) ??
        all.filter((id) => id !== selfId);
      const rest = can.filter((id) => !trajectory || (to && !to.includes(id)));
      if (rest.length) broadcast({ ...p, none: true }, rest);
    } catch (err) {
      console.warn('dicer: cannot send a hand throw', err);
    }
  });
}

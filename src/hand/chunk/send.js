/**
 * The thrower's half of "everyone allowed sees the same throw" (lazy hand chunk; P6-D2): once its
 * chat message exists, each of its own hand rolls' recorded throw goes, encoded, only to the users
 * whose view of that message is real (G1). main.js calls sendHand from createChatMessage.
 */
import { handThrows } from './resolve.js';
import { encodeTrajectory } from './trajectory.js';
import { recipientsOf } from '../../api/dice3d.js';
import { SOCKET_EVENT } from '../../compat/sync.js';

/**
 * Who may replay this message's hand throw (recipientsOf over the message): null for everyone
 * (public; the server never echoes to the sender), the whisper list and the GMs, only the GMs for
 * a blind message or any secret roll, and nobody when any roll is a ghost (H-7).
 */
export function handRecipients(message, gms, selfId) {
  const rolls = message.rolls ?? [];
  if (rolls.some((r) => r?.ghost)) return [];
  const users = (message.whisper ?? []).map((u) => (typeof u === 'string' ? u : u?.id));
  return recipientsOf(
    { users: users.length ? users : null, blind: !!message.blind, secret: rolls.some((r) => r?.secret) },
    gms,
    selfId,
  );
}

/**
 * Sends `{v: 1, kind: 'hand', id, messageId, userId, trajectory}` for every roll of `message` this
 * user threw by hand (a non-fallback dicerHand with a stored throw) to handRecipients, then drops
 * the stored throw. A throw that does not encode (oversized, unrecorded) or has nobody to go to is
 * not sent: its receivers throw the result after HAND_REPLAY_WAIT_MS. Never throws.
 */
export function sendHand(
  message,
  {
    // The module socket, as sync.broadcast: `recipients` limits delivery server-side (P3-R12).
    broadcast = (p, to) => globalThis.game.socket.emit(SOCKET_EVENT, p, ...(to ? [{ recipients: to }] : [])),
    gms = globalThis.game?.users?.filter((u) => u.isGM).map((u) => u.id) ?? [],
    selfId = globalThis.game?.user?.id,
  } = {},
) {
  for (const roll of message?.rolls ?? []) {
    const h = roll?.options?.dicerHand;
    const entry = h && !h.fallback && h.by === selfId ? handThrows.get(h.id) : null;
    if (!entry) continue;
    handThrows.delete(h.id);
    try {
      const to = handRecipients(message, gms, selfId);
      const trajectory = to?.length !== 0 && entry.recording && encodeTrajectory(entry.recording);
      if (trajectory) {
        broadcast({ v: 1, kind: 'hand', id: h.id, messageId: message.id, userId: selfId, trajectory }, to);
      }
    } catch (err) {
      console.warn('dicer: cannot send a hand throw', err);
    }
  }
}
